import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import type { Sprite, SpriteFrame } from 'cc';
import * as formationModel from '../assets/script/app/card/FormationModel';
import { resolveSelectedDeck } from '../assets/script/app/card/LineupPresets';
import * as skillList from '../assets/script/app/card/CardSkillList';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import * as descMarkup from '../assets/script/app/card/CardSkillDescMarkup';
import { CardLineupEvent } from '../assets/script/app/card/CardLineupEvents';
import { CardPopupEvent } from '../assets/script/app/card/CardPopupEvents';
import * as resTypes from '../assets/script/app/common/ResTypes';
import * as requestGuard from '../assets/script/app/net/RequestGuard';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { CardSkillListPresentation } from '../assets/script/app/card/CardPresentations';

/** 执行真实模块，仅替换引擎与外部 I/O；每次加载隔离模块缓存。 */
function loadRuntime<T>(file: string, dependencies: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/card/${file}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, {
        exports, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        require: (name: string) => {
            assert.ok(name in dependencies, `未声明的依赖：${name}`);
            return dependencies[name];
        },
    });
    return exports as T;
}

const decorators = { ccclass: () => (value: unknown) => value, property: () => () => {} };

test('布阵站台直接赋图，缺图清空，保留 prefab 的 RAW 与缩放', () => {
    const module = loadRuntime<typeof import('../assets/script/app/card/LineupBoardSlot')>('LineupBoardSlot', {
        cc: { Component: class {}, Vec2: class {}, _decorator: decorators },
        '../zcds/model/ZCCombatCatalog': {},
        './CardLineupTexts': { CARD_LINEUP_TEXTS }, './CardUnitPreview': {},
    });
    const slot = new module.LineupBoardSlot();
    const frame = {} as SpriteFrame;
    const scale = { x: 0.4, y: 0.4, z: 1 };
    slot.disc = { spriteFrame: null } as Sprite;
    slot.hero = { spriteFrame: null, sizeMode: 2, node: { scale } } as Sprite;
    slot.classBadge = { spriteFrame: null } as Sprite;
    slot.levelLabel = { string: '' } as typeof slot.levelLabel;
    slot.unitGroup = { active: false } as typeof slot.unitGroup;
    slot.render({ id: '68001' } as ZCDeckCard, { disc: frame, hero: frame, badge: frame });
    assert.equal(slot.hero.spriteFrame, frame);
    slot.render({ id: '68002' } as ZCDeckCard, { disc: null, hero: null, badge: null });
    assert.equal(slot.disc.spriteFrame, null);
    assert.equal(slot.hero.spriteFrame, null);
    assert.equal(slot.classBadge.spriteFrame, null);
    assert.equal(slot.hero.sizeMode, 2);
    assert.deepEqual(slot.hero.node.scale, scale);
    assert.equal(slot.unitGroup.active, true);
});

for (const existing of [false, true]) {
    test(`保存并选中方案 2 后，立即读缓存只能取到新阵容（${existing ? '覆盖' : '新增'}方案）`, async () => {
        let sends = 0;
        const caller = {};
        class RequestFormationOp {
            constructor(readonly body: { info: { formationId: number; heroId: number[]; select: number } },
                readonly owner: object, readonly success: (response: unknown) => void) {}
        }
        const service = loadRuntime<typeof import('../assets/script/app/card/FormationService')>('FormationService', {
            '../generated/requestMsg/RequestFormationMsg': { RequestFormationOp },
            '../net/GameNet': { GameNet: { instance: { isConnected: true, send: async (request: RequestFormationOp) => {
                sends++;
                assert.equal(request.owner, caller);
                assert.equal(request.body.info.select, 1);
                request.success({ info: request.body.info });
                return true;
            } } } },
            './FormationModel': formationModel,
        });
        service.applyFormation({ formationId: 1, heroIds: [68001], selected: true });
        if (existing) service.applyFormation({ formationId: 2, heroIds: [], selected: false });
        const previous = service.getCachedFormations();
        assert.equal((await service.saveFormation(2, [68002], caller)).kind, 'success');
        const formations = await service.fetchFormations({ maxAgeMs: 1500 });
        assert.equal(sends, 1, '保存后立即刷新应复用已确认的缓存');
        assert.deepEqual(Array.from(formations.filter(entry => entry.selected), entry => entry.formationId), [2]);
        const cards = [{ id: '68001' }, { id: '68002' }] as ZCDeckCard[];
        assert.equal(resolveSelectedDeck({ deck: cards, pool: [], formations })[0].id, '68002');
        assert.equal(previous[0].selected, true, '不能改写已发布的旧快照');
        service.applyFormation({ formationId: 1, heroIds: [], selected: false });
        assert.equal(service.getCachedFormations().find(entry => entry.selected).formationId, 2,
            '更新未选中方案不能清掉当前选中方案');
    });
}

interface ISkillControllerProbe {
    start(): Promise<void>;
    step(skillId: number, direction: 1 | -1): Promise<void>;
    dispose(): void;
    readonly isDisposed: boolean;
}
type SkillControllerCtor = new (context: unknown, options: Record<string, unknown>) => ISkillControllerProbe;

interface ISkillViewProbe {
    skillSkin: { active: boolean };
    nameLabel: { string: string };
    upgradeButton: { interactable: boolean; node: { on(...args: unknown[]): void } };
    tierScroll: { refreshList(count: number): void; renderItemFn: (node: unknown, index: number) => void };
    onInit(): void;
    onOpen(data?: unknown): void;
    onClose(): void;
    render(state: unknown): void;
    notify(kind: 'offline' | 'failed'): void;
}

const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });

const SKILL_PAGE_TABLE = skillList.buildArmySkillTable([
    { id: 100101, skilllevel: 1, unlockarmylevel: 0, name: '测试技能', desc: '一级' },
    { id: 100101, skilllevel: 2, unlockarmylevel: 14, name: '测试技能', desc: '二级' },
    { id: 100101, skilllevel: 3, unlockarmylevel: 20, name: '测试技能', desc: '三级' },
]);

interface ISkillFixture {
    controller: ISkillControllerProbe;
    renders: Array<CardSkillListPresentation | null>;
    state: { sends: number; reads: number; closes: number; tips: number; removed: number };
    view: {
        render: (state: CardSkillListPresentation | null) => void;
        close: () => void;
        notify: (kind: 'offline' | 'failed') => void;
    };
}

/**
 * 加载真实 CardSkillController，只替换引擎与外部 I/O；ControllerBase 用真实类，
 * 不复制框架逻辑。repositories / view 端口由 options 注入。
 */
function makeSkillController(options: {
    heroId?: number;
    skillId?: number;
    level?: number;
    heroLevel?: number;
    upgradeResult?: unknown;
    refreshThrows?: boolean;
    loadSkillList?: () => Promise<unknown>;
    upgradeHeroSkill?: () => Promise<unknown>;
    onError?: (error: unknown) => void;
} = {}): ISkillFixture {
    const state = { sends: 0, reads: 0, closes: 0, tips: 0, removed: 0 };
    const renders: Array<CardSkillListPresentation | null> = [];
    const level = options.level ?? 1;
    const repository = {
        loadSkillList: options.loadSkillList ?? (async () => {
            state.reads += 1;
            if (options.refreshThrows && state.reads >= 2) throw new Error('config read failed');
            return {
                table: SKILL_PAGE_TABLE,
                skillIds: [100101],
                levels: [{ skillId: 100101, level }],
                heroLevel: options.heroLevel ?? 20,
            };
        }),
        upgradeHeroSkill: options.upgradeHeroSkill ?? (async () => {
            state.sends += 1;
            return options.upgradeResult ?? { kind: 'success', level: level + 1 };
        }),
    };
    const view = {
        render: (value: CardSkillListPresentation | null) => { renders.push(value); },
        close: () => { state.closes += 1; },
        notify: () => { state.tips += 1; },
    };
    const module = loadRuntime<{ CardSkillController: SkillControllerCtor }>('CardSkillController', {
        '../../framework/controller/ControllerBase': { ControllerBase },
        './CardLineupEvents': { CardLineupEvent },
        './CardPopupEvents': { CardPopupEvent },
        './CardSkillList': skillList,
    });
    const controller = new module.CardSkillController({}, {
        owner: view,
        data: { heroId: options.heroId ?? 68001, skillId: options.skillId ?? 100101 },
        repository,
        view,
        requests: { removeCaller: () => { state.removed += 1; } },
        failed: options.onError ?? (() => {}),
    });
    return { controller, renders, state, view };
}

function lastPresentation(f: ISkillFixture): CardSkillListPresentation {
    const last = f.renders[f.renders.length - 1];
    assert.ok(last, '应当有至少一次渲染');
    return last;
}

/** 纯 View 夹具：只用于验证挂点缺失当场抛错。 */
function makeSkillPageView() {
    const state = { closes: 0, tips: 0, tiers: [] as unknown[][] };
    const module = loadRuntime<{ CardSkillPage: new () => ISkillViewProbe }>('CardSkillPage', {
        cc: {
            _decorator: decorators, Color: class {},
            Button: { EventType: { CLICK: 'click' } },
            Label: class {}, Node: class {}, Sprite: class {},
        },
        '../../framework/ui/PopupBase': { PopupBase: class { close() { state.closes += 1; } } },
        '../../framework/event/EventMgr': { EventMgr },
        '../common/Toast': { Toast: { show: () => { state.tips += 1; } } },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
        './CardSkillTierView': { CardSkillTierView: class {} },
        '../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        './CardPopupEvents': { CardPopupEvent },
        './CardSkillList': skillList,
    });
    const page = new module.CardSkillPage();
    const label = () => ({ string: '', node: { active: false, parent: { active: false } } });
    Object.assign(page, {
        nameLabel: label(), kindLabel: label(), cooldownLabel: label(), cooldownValue: label(),
        upgradeLabel: label(), coinLabel: label(), materialLabel: label(),
        coinIcon: { spriteFrame: null, node: { parent: { active: false } } },
        materialIcon: { spriteFrame: null, node: { parent: { active: false } } },
        upgradeButton: { interactable: false, node: { on() {} } },
        tierScroll: {
            renderItemFn: null,
            refreshList(count: number) {
                state.tiers.length = count;
                for (let i = 0; i < count; i++) this.renderItemFn({ getComponent: () => ({ render: (...args: unknown[]) => state.tiers[i] = args }) }, i);
            },
        },
        skillSkin: { active: false },
    });
    return { page, state };
}

for (const kind of ['failed', 'offline', 'success'] as const) {
    for (const state of ['open', 'closed', 'destroyed'] as const) {
        test(`技能升级 ${kind} 结果只更新仍打开的弹窗（${state}）`, async () => {
            let finish: (result: { kind: string }) => void = () => {};
            const pending = new Promise<{ kind: string }>(resolve => { finish = resolve; });
            const f = makeSkillController({ level: 1, upgradeHeroSkill: () => pending });
            try {
                await f.controller.start();
                const request = f.controller.step(100101, 1);
                await tick();
                if (state !== 'open') f.controller.dispose();
                if (state === 'destroyed') {
                    f.view.render = () => assert.fail('已销毁的视图不应再收到渲染');
                }
                const count = f.renders.length;
                finish({ kind });
                await request;
                assert.equal(f.renders.length, count + (state === 'open' ? 1 : 0),
                    '只有仍存活的会话可以渲染请求结果');
                assert.equal(f.state.tips, state === 'open' && kind !== 'success' ? 1 : 0,
                    '取消的会话不能弹业务失败提示');
                assert.equal(f.state.reads, state === 'open' && kind === 'success' ? 2 : 1,
                    '只有仍存活的会话可以在升级成功后刷新技能');
            } finally { f.controller.dispose(); }
        });
    }
}

test('预览降档后按 ↑ 只是回到服务端档，不发升级包', async () => {
    const f = makeSkillController({ level: 2 });
    try {
        await f.controller.start();
        assert.equal(lastPresentation(f).rows[0].level, 2);
        await f.controller.step(100101, -1);
        assert.equal(lastPresentation(f).rows[0].level, 1, '↓ 只改本地预览');
        assert.equal(lastPresentation(f).rows[0].source, 'local');
        await f.controller.step(100101, 1);
        assert.equal(f.state.sends, 0, '预览档落后于服务端档时 ↑ 不能发包消耗材料');
        assert.equal(lastPresentation(f).rows[0].level, 2);
        assert.equal(lastPresentation(f).rows[0].source, 'server');
    } finally { f.controller.dispose(); }
});

test('升级成功后刷新失败：不卡 busy，档位取服务端确认值', async () => {
    const f = makeSkillController({
        level: 1,
        refreshThrows: true,
        upgradeResult: { kind: 'success', level: 3 },
    });
    try {
        await f.controller.start();
        await f.controller.step(100101, 1);   // 不得 reject
        const last = lastPresentation(f);
        assert.equal(last.busy, false, '刷新失败也必须把 busy=false 落到视图');
        assert.equal(last.rows[0].level, 3, '服务端连升两档时显示确认值，不是猜的 level+1');
        assert.equal(f.state.sends, 1);
    } finally { f.controller.dispose(); }
});

test('技能弹窗视图接入真实控制器，打开只取数一次且支持展示命令', async () => {
    const { page, state } = makeSkillPageView();
    const f = makeSkillController();
    try {
        page.onInit();
        page.onOpen({ heroId: 68001, cardName: '测试卡' });
        f.view.render = value => { f.renders.push(value); page.render(value); };
        f.view.notify = kind => page.notify(kind);
        await f.controller.start();
        assert.equal(f.state.reads, 1);
        assert.equal(lastPresentation(f).heroId, 68001);
        assert.equal(page.skillSkin.active, true);
        assert.equal(state.tips, 0);
        page.notify('failed');
        assert.equal(state.tips, 1);
    } finally { f.controller.dispose(); page.onClose(); }
});

test('缺少合法 heroId 时关闭面板且不取数', async () => {
    const f = makeSkillController({ heroId: 0 });
    try {
        await f.controller.start();
        assert.equal(f.state.closes, 1, '非法入参必须显式关闭');
        assert.equal(f.state.reads, 0, '不能拿 heroId=0 去读全表技能');
    } finally { f.controller.dispose(); }
});

test('升级失败提示只弹一次，后续纯渲染不重复 Toast', async () => {
    const f = makeSkillController({ level: 2, upgradeResult: { kind: 'failed' } });
    try {
        await f.controller.start();
        await f.controller.step(100101, 1);
        assert.equal(f.state.tips, 1);
        await f.controller.step(100101, -1);
        assert.equal(f.state.tips, 1, 'render 不得夹带一次性 Toast');
    } finally { f.controller.dispose(); }
});

test('站台换卡与空补图均清除旧品质盘和角标，模型展示不被补图打断', () => {
    const module = loadRuntime<typeof import('../assets/script/app/card/CardLineupSlot')>('CardLineupSlot', {
        cc: { Component: class {}, _decorator: decorators },
        '../zcds/model/ZCCombatCatalog': {},
        './CardLineupTexts': { CARD_LINEUP_TEXTS }, './CardUnitPreview': {},
    });
    const slot = new module.CardLineupSlot();
    const frame = { originalSize: { width: 100, height: 100 } } as SpriteFrame;
    slot.disc = { spriteFrame: frame } as Sprite;
    slot.classBadge = { spriteFrame: frame } as Sprite;
    slot.hero = { spriteFrame: frame, enabled: true, node: { active: true, setScale() {} } } as unknown as Sprite;
    Object.assign(slot, { node: { getComponent: () => ({ opacity: 255 }) }, levelLabel: { string: '' } });
    const empty = { disc: null, hero: null, badge: null };
    slot.render({ id: '68002' } as ZCDeckCard, empty, 4);
    assert.equal(slot.disc.spriteFrame, null);
    assert.equal(slot.classBadge.spriteFrame, null);
    assert.equal(slot.hero.spriteFrame, null);
    slot.disc.spriteFrame = frame;
    slot.classBadge.spriteFrame = frame;
    slot.hero.spriteFrame = frame;
    slot.hero.enabled = false;
    slot.applyStaticArt(empty);
    assert.equal(slot.disc.spriteFrame, null);
    assert.equal(slot.classBadge.spriteFrame, null);
    assert.equal(slot.hero.enabled, false, '模型正在显示时不能重新启用静态立绘');
    assert.equal(slot.hero.spriteFrame, frame);
    slot.hero.enabled = true;
    slot.applyStaticArt(empty);
    assert.equal(slot.hero.spriteFrame, null, '静态展示恢复后，缺图必须清空');
});

test('阵容纯数据刷新复用单位预览，换兵种、显式清空和空位释放模型', () => {
    let created = 0, destroyed = 0;
    let rejected: unknown = null;
    const sizes: number[] = [];
    const module = loadRuntime<typeof import('../assets/script/app/card/CardLineupSlot')>('CardLineupSlot', {
        cc: { Component: class {}, _decorator: decorators },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
        './CardUnitPreview': { CardUnitPreview: class {
            private prefab: unknown = null;
            show(prefab: unknown, size: number) {
                if (prefab === rejected) return false;
                if (prefab !== this.prefab) { this.clear(); created++; this.prefab = prefab; }
                sizes.push(size);
                return true;
            }
            clear() { if (this.prefab) destroyed++; this.prefab = null; }
        } },
    });
    const slot = new module.CardLineupSlot();
    Object.assign(slot, { disc: {}, classBadge: {}, hero: {}, levelLabel: {},
        node: { active: true, getComponent: () => ({ opacity: 255 }) } });
    const card = { id: '1', unitId: 'soldier', unitPrefabPath: 'units/soldier', prefabSize: 1 } as ZCDeckCard;
    const frames = { disc: null, hero: null, badge: null };
    const prefab = {} as import('cc').Prefab;
    slot.render(card, frames, 1);
    slot.applyPreview(prefab);
    for (let level = 2; level <= 100; level++) slot.render({ ...card, prefabSize: 1.5 }, frames, level);
    assert.equal(created, 1);
    assert.equal(destroyed, 0);
    assert.equal(sizes.at(-1), 1.5, '复用模型仍更新体型');
    slot.render({ ...card, unitPrefabPath: 'units/new' }, frames, 100);
    assert.equal(destroyed, 1, '同 id 换美术必须清除旧模型');
    slot.applyPreview(prefab);
    slot.render({ ...card, unitPrefabPath: 'units/new' }, frames, 100, null);
    assert.equal(destroyed, 2, '显式 null 必须清除');
    slot.applyPreview(prefab);
    slot.setEmpty();
    assert.equal(destroyed, 3);
    slot.render(card, frames, 1);
    assert.equal(created, 3, '空位回收后不得复活旧预览');
    const fallback = {} as SpriteFrame;
    rejected = {};
    slot.render(card, { ...frames, hero: fallback }, 1, rejected as import('cc').Prefab);
    assert.equal(slot.hero.spriteFrame, fallback, '无法显示模型时必须恢复静态立绘');
});

test('单技能皮肤：三个档位来自所选技能，关闭清空并禁用升级', () => {
    const f = makeSkillPageView();
    f.page.onInit(); f.page.onOpen();
    assert.equal(f.page.skillSkin.active, false);
    f.page.render({ rows: [{ skill: SKILL_PAGE_TABLE.get(100101), level: 1 }], heroLevel: 20, canUpgrade: true });
    assert.equal(f.page.skillSkin.active, true);
    assert.equal(f.page.nameLabel.string, '测试技能');
    assert.deepEqual(f.state.tiers.map(args => (args[0] as { level: number }).level), [1,2,3]);
    assert.equal(f.page.upgradeButton.interactable, true);
    f.page.onClose();
    assert.equal(f.page.skillSkin.active, false);
    assert.equal(f.page.upgradeButton.interactable, false);
    assert.equal(f.page.nameLabel.string, '');
});

test('技能皮肤：等级目标、请求中与满级状态跟随真实渲染数据', () => {
    const { CardSkillSlotView } = loadRuntime<typeof import('../assets/script/app/card/CardSkillSlotView')>('CardSkillSlotView', {
        cc: { _decorator: decorators, Component: class {} },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
        './CardSkillList': skillList,
    });
    const slot = new CardSkillSlotView();
    slot.nameLabel = { string: '' } as typeof slot.nameLabel;
    slot.levelLabel = { string: '' } as typeof slot.levelLabel;
    slot.descLabel = { string: '' } as typeof slot.descLabel;
    slot.lockTip = { string: '', node: { active: false } } as typeof slot.lockTip;
    slot.upgradeLock = { active: false } as typeof slot.upgradeLock;
    slot.nextButton = { interactable: true } as typeof slot.nextButton;
    slot.nextLabel = { string: '' } as typeof slot.nextLabel;
    slot.progressionLabel = { string: '' } as typeof slot.progressionLabel;
    const skill = SKILL_PAGE_TABLE.get(100101);
    const item = { skill, level: 1, desc: '射程提高10%', source: 'server' as const };
    const data = { heroId: 68001, heroLevel: 20, busy: false, phase: 'idle' as const, rows: [item] };
    slot.render(item, data, undefined);
    assert.equal(slot.levelLabel.string, 'Lv.1/3');
    assert.equal(slot.progressionLabel.string, 'Lv.1 → Lv.2');
    assert.equal(slot.nextButton.interactable, true);
    for (const heroLevel of [0, 13]) {
        slot.render(item, { ...data, heroLevel }, undefined);
        assert.equal(slot.upgradeLock.active, true);
        assert.equal(slot.lockTip.node.active, true);
        assert.equal(slot.lockTip.string, `${CARD_LINEUP_TEXTS.skillLocked}（14）`);
        assert.equal(slot.nextButton.interactable, false);
    }
    slot.render(item, { ...data, heroLevel: 14 }, undefined);
    assert.equal(slot.upgradeLock.active, false);
    assert.equal(slot.lockTip.node.active, false);
    assert.equal(slot.nextButton.interactable, true);
    slot.render(item, { ...data, busy: true }, undefined);
    assert.equal(slot.nextButton.interactable, false);
    assert.equal(slot.nextLabel.string, '升级中');
    slot.render({ ...item, level: 3 }, data, undefined);
    assert.equal(slot.nextButton.interactable, false);
    assert.equal(slot.progressionLabel.string, '');
    assert.equal(slot.levelLabel.string, 'Lv.3（满级）');
});

for (const [heroLevel, level, sends] of [[0, 1, 0], [13, 1, 0], [14, 1, 1], [19, 2, 0], [20, 2, 1], [99, 3, 0]]) {
    test(`技能升级等级门槛：英雄${heroLevel}级、技能${level}档发包${sends}次`, async () => {
        const f = makeSkillController({ heroLevel, level });
        await f.controller.start();
        await f.controller.step(100101, 1);
        assert.equal(f.state.sends, sends);
        assert.equal(lastPresentation(f).busy, false);
        if (!sends) assert.equal(lastPresentation(f).rows[0].level, level);
        f.controller.dispose();
    });
}


test('单技能行：生命周期绑定 CLICK，复用后发送当前技能', () => {
    const events: unknown[][] = [];
    const handlers: Array<{ type: string; handler: () => void; caller: unknown }> = [];
    const removed: unknown[][] = [];
    const { CardSkillRowView } = loadRuntime<typeof import('../assets/script/app/card/CardSkillRowView')>('CardSkillRowView', {
        cc: { _decorator: decorators, Component: class {}, Button: { EventType: { CLICK: 'click' } } },
        './CardSkillSlotView': { CardSkillSlotView: class {} },
        './CardLineupEvents': { CardLineupEvent },
        '../../framework/event/EventMgr': { EventMgr: { instance: { emit: (...args: unknown[]) => events.push(args) } } },
    });
    const row = new CardSkillRowView();
    const rendered: unknown[][] = [];
    row.slot = { render: (...args: unknown[]) => rendered.push(args) } as typeof row.slot;
    row.upgradeButton = { node: {
        on: (type: string, handler: () => void, caller: unknown) => handlers.push({ type, handler, caller }),
        off: (...args: unknown[]) => removed.push(args),
    } } as typeof row.upgradeButton;
    row.onLoad();
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].type, 'click');
    const item = { skill: SKILL_PAGE_TABLE.get(100101), level: 1, desc: '一级', source: 'server' as const };
    row.render(item, null);
    row.render({ ...item, skill: { ...item.skill, skillId: 100102 } }, null);
    assert.equal(handlers.length, 1, '重复渲染不重复监听');
    handlers[0].handler.call(handlers[0].caller);
    assert.deepEqual(JSON.parse(JSON.stringify(events)), [[CardLineupEvent.SkillStep, { skillId: 100102, direction: 1 }]]);
    assert.equal(rendered.length, 2);
    assert.equal(removed.length,0,'按钮子节点的销毁由引擎处理，组件销毁时不再访问已拆除的子节点');
});


test('技能视图脚本可编译，装饰器前没有残留注释文本', () => {
    for (const name of ['CardSkillListView', 'CardSkillRowView', 'CardSkillSlotView']) {
        const file = `assets/script/app/card/${name}.ts`;
        const result = ts.transpileModule(readFileSync(file, 'utf8'), {
            fileName: file,
            reportDiagnostics: true,
            compilerOptions: { experimentalDecorators: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
        });
        const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
        assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
    }
});


test('单技能会话只接受自身升级意图，不会升级同卡的其他技能', async () => {
    const table = skillList.buildArmySkillTable([
        { id: 100101, skilllevel: 1, name: 'A' }, { id: 100101, skilllevel: 2 },
        { id: 100102, skilllevel: 1, name: 'B' }, { id: 100102, skilllevel: 2 },
    ]);
    const f = makeSkillController({ loadSkillList: async () => ({ table, skillIds: [100101,100102], levels: [], heroLevel: 20 }) });
    try {
        await f.controller.start();
        assert.deepEqual(Array.from(lastPresentation(f).rows, row => row.skill.skillId), [100101]);
        await f.controller.step(100102, 1);
        EventMgr.instance.emit(CardPopupEvent.SkillIntent, { owner: {} }); await tick();
        assert.equal(f.state.sends, 0);
        EventMgr.instance.emit(CardPopupEvent.SkillIntent, { owner: f.view }); await tick();
        assert.equal(f.state.sends, 1);
        f.controller.dispose();
        EventMgr.instance.emit(CardPopupEvent.SkillIntent, { owner: f.view }); await tick();
        assert.equal(f.state.sends, 1);
    } finally { f.controller.dispose(); }
});

for (const skillId of [0, 999999]) {
    test(`技能入参 ${skillId} 无效或不属于英雄时关闭且不发升级`, async () => {
        const f = makeSkillController({ skillId });
        try {
            await f.controller.start();
            assert.equal(f.state.closes, 1);
            assert.equal(f.state.sends, 0);
            if (skillId === 0) assert.equal(f.state.reads, 0);
        } finally { f.controller.dispose(); }
    });
}

for (const owned of [2, 3]) {
    test(`单技能升级读取目标档两种消耗，材料持有 ${owned}/3 时按实际数量判定`, async () => {
        const table = skillList.buildArmySkillTable([
            { id: 100101, skilllevel: 1 },
            { id: 100101, skilllevel: 2, costCoinID: 7, costCoinNum: 1000, costArmySkillLevelID: 10300, costArmySkillLevelNum: 3 },
        ]);
        const costItems = new Map([
            [7, { itemId: 7, name: '金币', owned: 1000, frame: null }],
            [10300, { itemId: 10300, name: '技能材料', owned, frame: null }],
        ]);
        const f = makeSkillController({ loadSkillList: async () => ({ table, skillIds: [100101], levels: [], heroLevel: 20, costItems }) });
        try {
            await f.controller.start();
            const state = lastPresentation(f);
            assert.deepEqual(Array.from(state.costs, c => [c.itemId,c.need,c.owned]), [[7,1000,1000],[10300,3,owned]]);
            assert.equal(state.canUpgrade, owned === 3);
            await f.controller.step(100101, 1);
            assert.equal(f.state.sends, owned === 3 ? 1 : 0);
        } finally { f.controller.dispose(); }
    });
}

test('单技能档位复用时完整切换解锁背景、锁提示和实际描述', () => {
    const { CardSkillTierView } = loadRuntime<typeof import('../assets/script/app/card/CardSkillTierView')>('CardSkillTierView', {
        cc: { _decorator: decorators, Component: class { node = { active: true }; }, Color: class {}, Label: class {}, Node: class {}, UITransform: class {}, RichText: class {} },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
        //  数字着色走真实纯函数模块（不复制算法）。
        './CardSkillDescMarkup': descMarkup,
    });
    const tier = new CardSkillTierView();
    Object.assign(tier, {
        unlockedBackground: { active: false }, lockedBackground: { active: false }, lockRoot: { active: false },
        tierLabel: { string: '' }, descLabel: { string: '', maxWidth: 0 }, lockLabel: { string: '' },
        rowTransform: { height: 141 }, descTransform: { height: 81, width: 428 },
        boostNumberColor: { r: 24, g: 115, b: 30 }, plainNumberColor: { r: 28, g: 74, b: 168 },
    });
    const row = SKILL_PAGE_TABLE.get(100101).levels[1];
    tier.render(row, 1, 13);
    assert.equal(tier.lockRoot.active, true); assert.equal(tier.lockedBackground.active, true);
    assert.equal(tier.tierLabel.string, '2阶'); assert.equal(tier.lockLabel.string, '英雄等级14级解锁');
    assert.equal(tier.descLabel.string, '<b>二级</b>', '档位描述原本是粗体，换 RichText 后用 <b> 保住');
    assert.equal(tier.descLabel.maxWidth, 428, 'RichText 靠 maxWidth 换行，宽度要跟节点一致');
    tier.render(row, 2, 14);
    assert.equal(tier.lockRoot.active, false); assert.equal(tier.lockedBackground.active, false);
    assert.equal(tier.unlockedBackground.active, true);
    tier.descTransform.height = 200; tier.render(row, 2, 14);
    assert.equal(tier.rowTransform.height, 260, '长说明撑高行，不缩字号');
    tier.render(null, 0, 0);
    assert.equal(tier.node.active, false); assert.equal(tier.tierLabel.string, '');
});

test('档位描述的数字按增益/普通两色染色，且整段保持粗体', () => {
    const { CardSkillTierView } = loadRuntime<typeof import('../assets/script/app/card/CardSkillTierView')>('CardSkillTierView', {
        cc: { _decorator: decorators, Component: class { node = { active: true }; }, Color: class {}, Label: class {}, Node: class {}, UITransform: class {}, RichText: class {} },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
        './CardSkillDescMarkup': descMarkup,
    });
    const tier = new CardSkillTierView();
    Object.assign(tier, {
        unlockedBackground: { active: false }, lockedBackground: { active: false }, lockRoot: { active: false },
        tierLabel: { string: '' }, descLabel: { string: '', maxWidth: 0 }, lockLabel: { string: '' },
        rowTransform: { height: 141 }, descTransform: { height: 81, width: 428 },
        boostNumberColor: { r: 24, g: 115, b: 30 }, plainNumberColor: { r: 28, g: 74, b: 168 },
    });
    //  截图那一条：额外发射1发（蓝）、攻击速度提高14%（绿）、伤害提高8%（绿）。
    const row = { skillId: 100101, level: 1, unlockHeroLevel: 0, skillType: 1, desc: '普攻额外发射1发，攻击速度提高14%，伤害提高8%' };
    tier.render(row, 1, 1);
    assert.equal(
        tier.descLabel.string,
        '<b>普攻额外发射<color=#1C4AA8>1</color>发，攻击速度提高<color=#18731E>14%</color>，伤害提高<color=#18731E>8%</color></b>',
    );
});

test('技能解锁文案三处同口径：运行时前缀 / 不足提示 / prefab 占位都不写「角色等级」', () => {
    // 判据是 heroLevel（这张卡/英雄自己的等级），不是 CmdRole.lv 的「角色等级」。
    // 以前运行时文案写「角色等级N级解锁」、提示写「英雄等级不足」、prefab 画死
    // 「角色等级29级解锁」，三处各说各的，玩家按主公等级对不上号。
    const rows = JSON.parse(readFileSync('assets/bundles/main-pages/ui/card/CardSkill.prefab', 'utf8')) as
        { __type__?: string; _string?: string }[];
    const placeholders = rows
        .filter(row => row.__type__ === 'cc.Label' && typeof row._string === 'string'
            && row._string.includes(CARD_LINEUP_TEXTS.skillUnlockSuffix))
        .map(row => String(row._string));
    assert.equal(placeholders.length, 1, 'CardSkill.prefab 里应只有一处解锁占位文案');
    assert.ok(CARD_LINEUP_TEXTS.skillLocked.startsWith(CARD_LINEUP_TEXTS.skillUnlockPrefix));
    assert.ok(placeholders[0].startsWith(CARD_LINEUP_TEXTS.skillUnlockPrefix));
    for (const text of [CARD_LINEUP_TEXTS.skillUnlockPrefix, CARD_LINEUP_TEXTS.skillLocked, placeholders[0]]) {
        assert.ok(!text.includes('角色等级'), `技能解锁文案不能写成角色等级：${text}`);
    }
});


test('技能仓库区分角色货币和背包材料，同时按英雄读取技能类型与冷却', async () => {
    const source = readFileSync('assets/script/app/card/CardRepository.ts', 'utf8');
    const dependencies: Record<string, unknown> = {};
    for (const match of source.matchAll(/from '([^']+)'/g)) dependencies[match[1]] = {};
    const frame = {};
    const iconPaths: string[] = [];
    Object.assign(dependencies, {
        './CardSkillList': skillList,
        './CardLineupDecks': {
            loadArmySkillLevelUpRows: async () => [
                { id: 100101, skilllevel: 1, costCoinID: 7, costCoinNum: 1000, costArmySkillLevelID: 10300, costArmySkillLevelNum: 3 },
            ],
            loadPvpCatalogCards: async () => [{ id: '68001', skillIds: [100101] }],
        },
        './PvpHeroService': { getCachedPvpHeroInfo: () => ({ level: 29, skills: [{ skillId: 100101, level: 1 }] }) },
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async (table: string) => table === 'roleProperty'
            ? [{ resId: 7, key: 'gold', name: '银币', icon: '图标_铜币' }]
            : [
                { unitId: 68002, enabled: 1, skillChainId: 100101, skillKind: 'passive_stat', cooldown: 99 },
                { unitId: 68001, enabled: 1, skillChainId: 100101, skillKind: 'active', cooldown: 12 },
            ] } } },
        './ItemBag': { createItemCounter: () => (id: string) => id === '10300' ? 5 : 99 },
        '../main/MainRoleRow': { readRoleRow: () => ({ gold: 5500 }) },
        '../common/ResTypes': resTypes,
        '../net/RequestGuard': requestGuard,
        '../itemdetail/ItemDetailRepository': { itemDetailRepository: { loadItemRow: async (id: number) => {
            assert.notEqual(id, 7, '银币来自角色资源表，不查询道具表');
            return { name: String(id), icon: `icons/${id}` };
        } } },
        '../itemdetail/ItemDetailArtLoader': { loadItemIconArt: async (path: string) => { iconPaths.push(path); return frame; } },
    });
    const { RuntimeCardRepository } = loadRuntime<typeof import('../assets/script/app/card/CardRepository')>('CardRepository', dependencies);
    const state = await new RuntimeCardRepository().loadSkillList(68001);
    assert.equal(state.costItems.get(7).owned, 5500, '货币不能误读背包里的 99');
    assert.equal(state.costItems.get(10300).owned, 5);
    assert.equal(state.costItems.get(7).frame, frame);
    assert.equal(state.costItems.get(7).name, '银币');
    assert.ok(iconPaths.includes('icons/resource/图标_铜币/spriteFrame'));
    assert.ok(iconPaths.includes('icons/10300'));
    assert.equal(state.skillDetails.get(100101).kind, 'active');
    assert.equal(state.skillDetails.get(100101).cooldown, 12);
});


test('Tier 虚拟列表条数跟随配置，超过三档也能展示并在空态清空', () => {
    const f = makeSkillPageView(); f.page.onInit();
    const skill = SKILL_PAGE_TABLE.get(100101);
    f.page.render({ rows: [{ skill: { ...skill, levels: [...skill.levels, { ...skill.levels[2], level: 4, desc: '第四档' }] }, level: 1 }], heroLevel: 20 });
    assert.equal(f.state.tiers.length, 4);
    assert.equal((f.state.tiers[3][0] as { desc: string }).desc, '第四档');
    f.page.render(null); assert.equal(f.state.tiers.length, 0);
});
