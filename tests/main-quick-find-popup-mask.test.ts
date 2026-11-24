import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * §3.56「弹窗在最上层 + 打开弹窗收起【快速寻敌】」的回归网。
 *
 * 真因（2026-11-23 截图）：`BigMapPlayerLevelPanel` 挂在
 * `ArenaRoot / MapRoot / MainTerritoryMap.node` 下，而 `MapRoot` 是 `ArenaRoot` 的**第 0 个**孩子；
 * `BeginGame`（快速寻敌）、`TopHud`、`BottomHud`、`ChestBar` 全是后画的兄弟，
 * `BottomNav` 更是 `MainRoot` 上比 `Content` 晚画的孩子 ⇒ 弹窗里的
 * `setSiblingIndex(本父最后)` 只在领地页内部生效，屏幕上黄色按钮仍压在弹窗上。
 *
 * 这里钉三件事：
 * 1. 弹窗由 PopupManager 统一管理层级和关闭，页面销毁时关闭该类弹窗；
 * 2. 显隐：弹窗开 → 隐藏 `BeginGame`；所有既有写入点（702 闸门重算 / 宝箱栏收起 / start）
 *    都不能把它顺手点亮；关 → 按「702 闸门 + 宝箱栏」的完整判据恢复；
 * 3. 不绕过 `open` 702、不破坏宝箱栏收起：未解锁 / 宝箱栏展开时永远不亮。
 */
const PAGE = 'assets/script/app/main/MainPage.ts';
const TERRITORY = 'assets/script/app/main/MainTerritoryMap.ts';
const PANEL = 'assets/script/app/territory/view/BigMapPlayerLevelPanel.ts';
const ARENA = 'assets/resources/ui/main/ArenaRoot.prefab';
const ROOT = 'assets/resources/ui/main/MainRoot.prefab';

const src = (path: string): string => readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');

// ============================================================
// 一、层级真源（prefab 结构 + 组件接线源码守卫）
// ============================================================

test('C1 主界面层级：MapRoot 先于 BeginGame，BottomNav 是 MainRoot 最后一个孩子', () => {
    const arena = JSON.parse(readFileSync(ARENA, 'utf8')) as any[];
    const arenaRoot = arena.find((o) => o?.__type__ === 'cc.Node' && o._name === 'ArenaRoot');
    assert.ok(arenaRoot);
    const arenaChildren = (arenaRoot._children ?? []).map((c: any) => arena[c.__id__]?._name);
    const mapIndex = arenaChildren.indexOf('MapRoot');
    const beginIndex = arenaChildren.indexOf('BeginGame');
    assert.ok(mapIndex >= 0 && beginIndex > mapIndex,
        `BeginGame 必须晚于 MapRoot 渲染，实测 [${arenaChildren.slice(0, 8).join(', ')}]`);

    const root = JSON.parse(readFileSync(ROOT, 'utf8')) as any[];
    const mainRoot = root.find((o) => o?.__type__ === 'cc.Node' && o._name === 'MainRoot');
    const rootChildren = (mainRoot._children ?? []).map((c: any) => root[c.__id__]?._name);
    assert.equal(rootChildren[rootChildren.length - 1], 'BottomNav',
        'BottomNav 是 MainRoot 最后一位 ⇒ 弹窗必须挂 MainRoot 且排最后才盖得住');
});

test('C2 玩家关卡弹窗沿用 PopupBase 的打开和关闭入口', () => {
    const code = src(PANEL);
    assert.match(code, /class BigMapPlayerLevelPanel extends PopupBase/);
    assert.doesNotMatch(code, /^\s*(?:open|close|dispose)\(/m, '沿用 PopupBase.close 以保证出栈');
});

test('C3 领地页读取弹窗生命周期状态，销毁时由管理器关闭或取消加载', () => {
    const code = src(TERRITORY);
    assert.match(code, /get playerStageOpen\(\): boolean \{\s*return PopupManager\.inst\.get\(BigMapPlayerLevelPanel\)\?\.isPopupOpen === true;/);
    const teardown = /onDestroy\(\): void \{([\s\S]*?)\n    \}/.exec(code)?.[1];
    assert.match(teardown ?? '', /PopupManager\.inst\.closeByClass\(BigMapPlayerLevelPanel\);/);
});

// ============================================================
// 二、MainPage 接线守卫
// ============================================================

test('C4 快速寻敌既有判据一律保留：702 闸门 + 宝箱栏收起不能绕过', () => {
    const code = src(PAGE);
    assert.equal(/this\.startButton\.active = true;/.test(code), false);
    assert.match(code, /this\.startButton\.active = this\.quickFindUnlocked;/);
    assert.match(code, /this\.startButton\.active = gate\.unlocked && !\(this\.chestBar \? this\.chestBar\.opened : false\);/);
    assert.match(code, /this\.startButton\.active = this\.quickFindUnlocked && !open;/);
    assert.match(code, /if \(!this\.quickFindUnlocked\) return;/);
});

test('C5 三处既有写入点后面都补遮罩，关弹窗的恢复只在 update 边沿写一次', () => {
    const code = src(PAGE);
    assert.equal((code.match(/this\.maskQuickFindForPopup\(\);/g) ?? []).length, 3,
        'start / applyQuickFindGate / setChestPanelOpen 三处都要补遮罩');
    assert.match(code, /update\(dt: number\): void \{[\s\S]*?this\.syncQuickFindOnPopupEdge\(\);[\s\S]*?\}/,
        '弹窗开关是电平变化，没有事件可订阅 ⇒ 只能在 update 里比边沿');
    assert.match(code, /private maskQuickFindForPopup\(\): void \{[\s\S]*?if \(!this\.stagePanelOpen\(\)\) return;[\s\S]*?this\.startButton\.active = false;/,
        '遮罩只写 false，不负责恢复（避免与引导层互相顶）');
    assert.match(code, /private stagePanelOpen\(\): boolean \{[\s\S]*?this\.territoryMap\?\.playerStageOpen === true/,
        '使用领地页公开的弹窗状态');
    assert.match(code, /private syncQuickFindOnPopupEdge\(\): void \{[\s\S]*?if \(masked === this\.stagePopupMasked\) return;/,
        '只在边沿写，不许每帧无条件写 active');
    assert.match(code, /this\.startButton\.active = this\.quickFindUnlocked\s*&& !\(this\.chestBar \? this\.chestBar\.opened : false\);/,
        '关弹窗那一拍仍要按 702 + 宝箱栏的完整判据恢复');
});

// ============================================================
// 三、行为对拍（VM 夹具：直接驱动私有方法，不跑整页生命周期）
// ============================================================

function loadPage(): new () => any {
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync(PAGE, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    const cc = {
        _decorator: { ccclass: () => (type: unknown) => type, property: () => () => undefined },
        Component: class {}, Button: { EventType: { CLICK: 'click' } },
        Node: class {}, UITransform: class {}, Sprite: class {}, SpriteFrame: class {},
        Vec2: class { constructor(public x = 0, public y = 0) {} },
        Vec3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
        EventTouch: class {},
    };
    const stub = (id: string): any => {
        if (id === 'cc') return cc;
        if (id.endsWith('/EventMgr')) return { EventMgr: { instance: { on() {}, emit() {}, offTarget() {} } } };
        if (id.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE: 'ui:view-lifecycle' };
        if (id.endsWith('/PopupManager')) return { PopupManager: { inst: { get: () => null, count: 0 } } };
        if (id.endsWith('/NewTreasureRepository')) return {
            NewTreasureRepository: class { slots: unknown[] = []; dispose() {} load() { return Promise.resolve('ok'); } },
        };
        if (id.endsWith('/ChestTypes')) return {
            CHEST_SLOT_COUNT: 4,
            ChestSlotAction: { Open: 0, Battle: 1 },
            ChestSlotState: { Empty: 0 },
            chestActionCaption: () => '', formatChestCountdown: () => '',
        };
        if (id.endsWith('/ChestDropFlight')) return { chestDropHitScale: () => null };
        if (id.endsWith('/ChestEvents')) return { CHEST_EVENTS: {} };
        return {};
    };
    runInNewContext(code, { exports, require: stub });
    assert.ok(exports.MainPage);
    return exports.MainPage;
}

interface IFixture {
    page: any;
    writes: boolean[];
    get active(): boolean;
    set active(value: boolean);
    set popup(open: boolean);
    set unlocked(value: boolean);
    set chestOpen(value: boolean);
    tick(): void;
}

function fixture(options: { unlocked?: boolean; chestOpen?: boolean; popup?: boolean } = {}): IFixture {
    const Page = loadPage();
    const page = new Page();
    const writes: boolean[] = [];
    let active = true;
    const startButton = {
        on() {},
        get active() { return active; },
        set active(value: boolean) { writes.push(value); active = value; },
    };
    const chestBar = {
        opened: options.chestOpen ?? false,
        setOpen(value: boolean) { this.opened = value; },
    };
    const territoryMap = { playerStageOpen: options.popup ?? false };
    page.startButton = startButton;
    page.chestBar = chestBar;
    page.territoryMap = territoryMap;
    page.quickFindUnlocked = options.unlocked ?? true;
    page.stagePopupMasked = false;
    page.chestBlankCatcher = null;
    page.chestDropFlight = null;
    page.chestDropHitElapsed = -1;
    return {
        page, writes,
        get active() { return startButton.active; },
        set active(value: boolean) { startButton.active = value; },
        set popup(open: boolean) { territoryMap.playerStageOpen = open; },
        set unlocked(value: boolean) { page.quickFindUnlocked = value; },
        set chestOpen(value: boolean) { chestBar.opened = value; },
        tick() { page.update(0.016); },
    };
}

test('C6 弹窗打开 → 隐藏；领地重绘 / 宝箱栏收起都不许把按钮点亮', () => {
    const f = fixture();
    f.popup = true;
    f.tick();
    assert.equal(f.active, false, '打开弹窗后【快速寻敌】必须隐藏');

    // 模拟一次「领地页重绘 → refreshOpenGates → applyQuickFindGate」把按钮点亮
    f.active = true;
    f.page.maskQuickFindForPopup();
    assert.equal(f.active, false, '闸门重算后要立刻压回去');

    // 模拟「弹窗开着时收起宝箱栏」：既有写入点会写 true，遮罩必须再压一次
    f.active = true;
    f.page.setChestPanelOpen(false);
    assert.equal(f.active, false, '收起宝箱栏不许让弹窗期间的按钮露出来');
});

test('C7 关闭弹窗才展示：只在关的那一拍写一次 true', () => {
    const f = fixture();
    f.popup = true;
    f.tick();
    assert.equal(f.active, false);
    const before = f.writes.length;
    f.popup = false;
    f.tick();
    assert.equal(f.active, true, '关闭弹窗才展示');
    assert.deepEqual(f.writes.slice(before), [true], '恢复只写一次，不许每帧刷 active');
    f.tick();
    f.tick();
    assert.deepEqual(f.writes.slice(before), [true], '电平没变时一个字都不该再写（引导层也管这颗节点）');
});

test('C8 702 未解锁时，关弹窗也不点亮', () => {
    const f = fixture({ unlocked: false });
    f.popup = true;
    f.tick();
    assert.equal(f.active, false);
    f.popup = false;
    f.tick();
    assert.equal(f.active, false, '不能绕过 open 702 闸门');
});

test('C9 宝箱栏展开时，关弹窗也不点亮', () => {
    const f = fixture({ chestOpen: true });
    f.popup = true;
    f.tick();
    assert.equal(f.active, false);
    f.popup = false;
    f.tick();
    assert.equal(f.active, false, '不能破坏「宝箱栏展开时收起快速寻敌」既有口径');
});

test('C10 没有领地地图宿主（预览 / 测试桩）时不能抛，也不能误藏', () => {
    const Page = loadPage();
    const page = new Page();
    let active = true;
    page.startButton = { on() {}, get active() { return active; }, set active(v: boolean) { active = v; } };
    page.chestBar = { opened: false, setOpen() {} };
    page.territoryMap = null;
    page.quickFindUnlocked = true;
    page.stagePopupMasked = false;
    page.chestDropFlight = null;
    page.chestDropHitElapsed = -1;
    assert.doesNotThrow(() => page.syncQuickFindOnPopupEdge());
    assert.equal(active, true, '没有领地页 ⇒ 没有据点弹窗 ⇒ 不该动这颗按钮');
    assert.doesNotThrow(() => page.maskQuickFindForPopup());
    assert.equal(active, true);
});
