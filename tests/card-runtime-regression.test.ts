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
import { CardLineupEvent } from '../assets/script/app/card/CardLineupEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';

/** 执行真实模块，仅替换引擎与外部 I/O；每次加载隔离模块缓存。 */
function loadRuntime<T>(file: string, dependencies: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/card/${file}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, {
        exports, setTimeout, clearTimeout,
        console: { log() {}, warn() {} },
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

interface ISkillPageProbe {
    node: { isValid: boolean };
    titleNode: unknown;
    nameNode: unknown;
    closeButton: unknown;
    skillListNode: unknown;
    onInit(): void;
    onOpen(data: { heroId: number }): Promise<void>;
    onClose(): void;
    step(skillId: number, direction: 1 | -1, caller: object): Promise<void>;
}

for (const kind of ['failed', 'offline', 'success'] as const) {
    for (const state of ['open', 'closed', 'destroyed'] as const) {
        test(`技能升级 ${kind} 结果只更新仍打开的弹窗（${state}）`, async () => {
            let finish: (result: { kind: string }) => void = () => {};
            const pending = new Promise<{ kind: string }>(resolve => { finish = resolve; });
            const presentations: unknown[] = [];
            const tips: string[] = [];
            let reads = 0;
            const table = skillList.buildArmySkillTable([
                { id: 100101, skilllevel: 1, unlockarmylevel: 0, name: '测试技能', desc: '一级' },
                { id: 100101, skilllevel: 2, unlockarmylevel: 0, name: '测试技能', desc: '二级' },
            ]);
            const module = loadRuntime<{ CardSkillPage: new () => ISkillPageProbe }>('CardSkillPage', {
                cc: { _decorator: decorators, Button: { EventType: { CLICK: 'click' } } },
                '../../framework/ui/PopupBase': { PopupBase: class {} },
                '../common/Toast': { Toast: { show: (text: string) => { tips.push(text); } } },
                './CardRepository': { cardRepository: {
                    loadSkillList: async () => {
                        reads++;
                        return { table, skillIds: [100101], levels: [{ skillId: 100101, level: 1 }], heroLevel: 10 };
                    },
                    upgradeHeroSkill: () => pending,
                } },
                './CardLineupTexts': { CARD_LINEUP_TEXTS },
                './CardSkillListView': { CardSkillListView: class {} },
                './CardLineupEvents': { CardLineupEvent },
                '../../framework/event/EventMgr': { EventMgr },
                './CardSkillList': skillList,
            });
            const page = new module.CardSkillPage();
            page.node = { isValid: true };
            page.titleNode = { getComponent: () => ({ string: '' }) };
            page.closeButton = { on() {} };
            page.skillListNode = { getComponent: () => ({ render: (state: unknown) => { presentations.push(state); } }) };
            page.onInit();
            try {
                await page.onOpen({ heroId: 68001 });
                const request = page.step(100101, 1, page);
                if (state !== 'open') page.onClose();
                page.node.isValid = state !== 'destroyed';
                const count = presentations.length;
                finish({ kind });
                await request;
                assert.equal(presentations.length, count + (state === 'open' ? 1 : 0),
                    '只有仍打开的弹窗可以渲染请求结果');
                assert.equal(tips.length, state === 'open' && kind !== 'success' ? 1 : 0,
                    '取消请求不能弹出业务失败提示，打开的弹窗仍应提示失败');
                assert.equal(reads, state === 'open' && kind === 'success' ? 2 : 1,
                    '只有仍打开的弹窗可以在升级成功后刷新技能');
            } finally { page.onClose(); }
        });
    }
}

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
