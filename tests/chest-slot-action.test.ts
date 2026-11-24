/**
 * 宝箱格那颗按钮「点了去哪」的回归网（2026-11-23 用户两条口径）。
 *
 * | # | 需求原文 | 以前的表现 |
 * | :-- | :-- | :-- |
 * | ① | 「有解锁中的宝箱，等待解锁按钮点击后的提示没有弹出。【已经在解锁其他宝箱】的提示丢失了」 | 一路落到弹详情，而详情主按钮此刻是**禁用**的 ⇒ 连点两次全是死路，零反馈 |
 * | ② | 「点击开启按钮直接打开宝箱界面了，不用再打开一次弹窗」 | `Open` 也先弹详情，开箱要多点一次 |
 *
 * 两条都是**分支走错**，不是文案或视图问题，所以判断被抽到了 `ChestTypes.chestActionRoute`
 * （零 `cc` 依赖）——这里既能按值验全表，也能在源码侧钉住 `MainPage` 真的照它分流。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as ChestTypes from '../assets/script/app/main/ChestTypes';
import { componentControllerModule, createControllerContext } from './helpers/controller-context';

// 命名导入一份、模块本体也留一份：沙箱里 `MainPage` 的 `require('./ChestTypes')` 要拿整个模块
// （它还取 `CHEST_SLOT_COUNT` / `formatChestCountdown` 等），少一个就是构造期 TypeError。
const {
    ChestActionRoute, ChestSlotAction, ChestSlotState,
    chestActionCaption, chestActionRoute, withChestActivationAvailability,
} = ChestTypes;
type IChestSlotData = ChestTypes.IChestSlotData;

const MAIN_PAGE = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');

/** 去掉行注释，免得注释里的词把顺序断言喂饱（本文件注释里就写着这些方法名）。 */
const stripped = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 取一个方法体：从签名到下一个同类签名（够用，不引解析器）。 */
const bodyOf = (source: string, from: string, to: string): string => {
    const start = source.indexOf(from);
    assert.ok(start >= 0, `找不到 ${from}`);
    const end = source.indexOf(to, start + from.length);
    return source.slice(start, end > start ? end : undefined);
};

const slotOf = (action: string, canActivate: boolean): IChestSlotData => ({
    index: 1,
    state: ChestSlotState.Counting,
    name: '木宝箱',
    remainSeconds: 100,
    totalSeconds: 200,
    action: action as IChestSlotData['action'],
    canActivate,
    cost: 0,
});

/**
 * 把 `MainPage` 塞进 `vm` 沙箱跑起来（`cc` 与各依赖全部打桩）。
 *
 * 桩表与 `tests/chest-detail-lifecycle.test.ts` 同一套 —— 那个文件已经用这份形状
 * 证明过 `MainPage` 能在这里构造出来。这里多记三样东西：
 *  · `tips`：页面弹过的提示；
 *  · `detailCalls`：`openChestDetail` 被点开的槽位（「开启」不该往这里走）；
 *  · `opened`：真正发出去的 `treasureRepository.open` 槽位。
 */
function createPage() {
    const context = createControllerContext();
    const tips: string[] = [];
    let panel: { updateCountdown: (...args: unknown[]) => void; close: () => void } | null = null;
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(MAIN_PAGE, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Repository { dispose() {} }
    runInNewContext(code, { exports, console, require: (name: string) => {
        if (name.endsWith('/ComponentController')) return componentControllerModule(context);
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, SpriteFrame: class {},
            Vec2: class { constructor(public x = 0, public y = 0) {} static distance(): number { return 0; } } };
        if (name === '../../core/asset/ResourceScope') return { ResourceScope };
        if (name === './ChestTypes') return ChestTypes;
        if (name === './NewTreasureRepository') return { NewTreasureRepository: Repository };
        if (name === '../../framework/ui/PopupManager') return { PopupManager: { inst: { get: () => panel } } };
        if (name === '../ArtPaths') return { spriteFramePathOf: (s: string) => `${s}/spriteFrame` };
        if (name === '../itemdetail/ItemDetailTable') return { qualityNameOf: () => '精良', qualityFrameSuffixOf: () => '01' };
        if (name === '../itemdetail/ItemDetailArtLoader') return { itemQualityFrameRelPath: () => 'image/frame' };
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { offTarget() {} } } };
        if (name === '../net/GameNet') return { GameNet: { instance: { removeCaller() {} } } };
        if (name === '../net/CacheMgr') return { CacheMgr: { instance: { setEventUpdate() {}, removeEventUpdate() {} } } };
        if (name === '../../framework/FW') return { FW: { showTip: (text: string) => { tips.push(text); } } };
        return {};
    } });
    const page = new exports.MainPage();
    page.isValid = true;
    const { ComponentController } = componentControllerModule(context);
    const composition = new ComponentController('test-main-page-chest-action');
    page.initialize(composition.resources);

    const detailCalls: number[] = [];
    const opened: number[] = [];
    const openResults: string[] = [];
    let refreshed = 0;
    // 这两条真实实现都要碰 prefab / 弹窗，这里只留"被调到了"这一个事实
    page.openChestDetail = async (index: number) => { detailCalls.push(index); };
    page.refreshTreasureDisplay = () => { refreshed++; };
    page.renderChests = () => {};
    const setSlots = (slots: readonly unknown[]): void => {
        page.treasureRepository = {
            slots,
            open: async (index: number) => { opened.push(index); return openResults.shift() ?? 'ok'; },
            activate: async () => 'ok',
            detailOf: () => null,
        };
    };
    return { page, tips, detailCalls, opened, openResults, setSlots, refreshedCount: () => refreshed };
}

// ---------------------------------------------------------------------------
// ① 去向表（纯值）
// ---------------------------------------------------------------------------

test('去向表：空槽位进匹配；队列忙只提示；等完了直开；解锁 / 加速才弹详情', () => {
    assert.equal(chestActionRoute(ChestSlotAction.Battle, true), ChestActionRoute.Battle);
    assert.equal(chestActionRoute(ChestSlotAction.Battle, false), ChestActionRoute.Battle,
        '空槽位没有「能不能解锁」这回事，canActivate 不该影响它');

    assert.equal(chestActionRoute(ChestSlotAction.Activate, true), ChestActionRoute.Detail,
        '轮到这颗解锁了 ⇒ 先弹详情，让玩家看清能开出什么');
    assert.equal(chestActionRoute(ChestSlotAction.Activate, false), ChestActionRoute.Blocked,
        '写着「等待解锁」的按钮必须走「只提示」，不能再落进详情弹窗');

    assert.equal(chestActionRoute(ChestSlotAction.SpeedUp, true), ChestActionRoute.Detail);
    assert.equal(chestActionRoute(ChestSlotAction.SpeedUp, false), ChestActionRoute.Detail);

    assert.equal(chestActionRoute(ChestSlotAction.Open, true), ChestActionRoute.OpenDirect);
    assert.equal(chestActionRoute(ChestSlotAction.Open, false), ChestActionRoute.OpenDirect,
        '「开启」不看 canActivate —— 队列里那颗宝箱永远算不出 true，看它的话开启会退化成死路');
});

test('文案与去向必须成对：「等待解锁」的按钮，点了一定有反馈', () => {
    // 这两条是同一件事的两面：文案说「等待解锁」⇒ 去向必须是 Blocked（有提示），
    // 反过来文案写「解锁」却走 Blocked 就等于"点了没反应"。以前正是文案对了、去向错了。
    assert.equal(chestActionCaption(ChestSlotAction.Activate, false), '等待解锁');
    assert.equal(chestActionRoute(ChestSlotAction.Activate, false), ChestActionRoute.Blocked);
    assert.equal(chestActionCaption(ChestSlotAction.Activate, true), '解锁');
    assert.equal(chestActionRoute(ChestSlotAction.Activate, true), ChestActionRoute.Detail);
});

test('队列里有一个在倒计时 ⇒ 其余未激活的宝箱全部 canActivate=false（Blocked 的真实来源）', () => {
    const slots = withChestActivationAvailability([
        { ...slotOf(ChestSlotAction.SpeedUp, false), index: 1 },
        { ...slotOf(ChestSlotAction.Activate, false), index: 2 },
        { ...slotOf(ChestSlotAction.Activate, false), index: 3 },
    ]);
    assert.equal(slots[1].canActivate, false);
    assert.equal(slots[2].canActivate, false);
    assert.equal(chestActionRoute(slots[1].action, slots[1].canActivate), ChestActionRoute.Blocked);
    assert.equal(chestActionCaption(slots[1].action, slots[1].canActivate), '等待解锁');
});

// ---------------------------------------------------------------------------
// ② MainPage 照表分流（源码）
// ---------------------------------------------------------------------------

test('MainPage.onChestAction 只按 chestActionRoute 分流，四条去向各一处', () => {
    const source = stripped(MAIN_PAGE);
    const body = bodyOf(source, 'private async onChestAction', 'private async openChestFromBar');

    assert.match(body, /const route = chestActionRoute\(item\.action, item\.canActivate\)/,
        '去向必须由 chestActionRoute 算，别在页面里再手写一遍 if 链');
    for (const route of ['Battle', 'Blocked', 'OpenDirect']) {
        assert.ok(body.includes(`ChestActionRoute.${route}`), `onChestAction 没有处理 ${route} 分支`);
    }
    // 「开启」不许再弹详情：`OpenDirect` 分支必须 return，不能往下落到 `openChestDetail`
    const openBranch = body.slice(body.indexOf('ChestActionRoute.OpenDirect'));
    assert.match(openBranch, /await this\.openChestFromBar\(item\.index\);[\s\S]*?return;/,
        '「开启」要直接开箱并 return，落到下面那行 `openChestDetail` 就又弹窗了');
    // 兜底那行只该被 Activate / SpeedUp 走到
    assert.match(body, /await this\.openChestDetail\(item\.index\);/);
});

test('「已经在解锁其他宝箱」的提示：栏位点击、详情主按钮兜底、请求被拒三处都有', () => {
    assert.match(MAIN_PAGE, /chestAlreadyUnlocking: '已经在解锁其他宝箱'/,
        '提示文案就是用户点名的那一句，一个字都不许改');

    const source = stripped(MAIN_PAGE);
    const action = bodyOf(source, 'private async onChestAction', 'private async openChestFromBar');
    assert.ok(action.includes('FW.showTip(MAIN_PAGE_TEXTS.chestAlreadyUnlocking)'),
        '栏位那颗「等待解锁」点了必须给提示（用户 2026-11-23 的第 3 条）');

    // 详情主按钮：`openEnabled = canActivate || action === Open` ⇒ 忙的时候它是灰的，
    // 但灰按钮在某些路径下仍会冒泡出 CLICK，兜一句同样的提示。
    const detailOpen = bodyOf(source, 'private readonly onChestDetailOpen', 'private async runTreasureAction');
    assert.ok(detailOpen.includes('FW.showTip(MAIN_PAGE_TEXTS.chestAlreadyUnlocking)'),
        '详情主按钮在「还轮不到解锁」时也要提示，不能闷声什么也不做');

    // 仓库侧 `activate` 会返回 `activation-blocked`（栏位数据可能比服务端慢一拍），
    // 这条以前是"只刷新、不提示"。
    const runAction = bodyOf(source, 'private async runTreasureAction', 'private refreshTreasureDisplay');
    const blocked = runAction.slice(runAction.indexOf("result === 'activation-blocked'"));
    assert.ok(blocked.slice(0, 400).includes('FW.showTip(MAIN_PAGE_TEXTS.chestAlreadyUnlocking)'),
        '请求被判定为 activation-blocked 时同样要提示');
});

test('openChestFromBar 是「开启」的唯一落点：直接发协议，不碰详情弹窗与 detailSlot', () => {
    const source = stripped(MAIN_PAGE);
    const body = bodyOf(source, 'private async openChestFromBar', 'private async openChestDetail');

    assert.match(body, /const result = await this\.treasureRepository\.open\(index\);/, '必须走仓库的 open');
    assert.ok(!body.includes('openChestDetail'), '「直接开」不许回头再弹详情');
    assert.ok(!body.includes('this.detailSlot'), '不碰 detailSlot —— 那条属于弹窗那条路，改了会让正在看的弹窗指错箱子');
    // 收尾口径与弹窗那条一致：同四条结果、同一组文案
    for (const result of ['ok', 'busy', 'offline', 'failed', 'protocol-missing']) {
        assert.ok(body.includes(`'${result}'`), `openChestFromBar 没处理 ${result}`);
    }
});

// ---------------------------------------------------------------------------
// ③ 真跑一遍 `onChestAction`（沙箱里的 MainPage）
// ---------------------------------------------------------------------------

test('真跑：点「等待解锁」→ 只弹提示，既不发请求也不弹详情', async () => {
    const { page, tips, detailCalls, opened, setSlots } = createPage();
    setSlots([{ ...slotOf(ChestSlotAction.Activate, false), index: 2 }]);

    await page.onChestAction(0);

    assert.deepEqual(tips, ['已经在解锁其他宝箱'], '用户 2026-11-23 第 3 条：这句提示必须出现');
    assert.deepEqual(detailCalls, [], '不该弹详情 —— 详情主按钮此刻是禁用的，进去还是死路');
    assert.deepEqual(opened, [], '更不该偷偷发解锁请求');
});

test('真跑：点「开启」→ 直接开箱，不弹详情弹窗', async () => {
    const { page, tips, detailCalls, opened, setSlots, refreshedCount } = createPage();
    setSlots([{ ...slotOf(ChestSlotAction.Open, false), index: 3, state: ChestSlotState.Ready }]);

    await page.onChestAction(0);

    assert.deepEqual(opened, [3], '用户 2026-11-23 第 4 条：点一下就该发 open（槽位号取 1~4 的 index）');
    assert.deepEqual(detailCalls, [], '「开启」不该再弹一层详情');
    assert.deepEqual(tips, [], '开成功不用提示');
    assert.equal(refreshedCount(), 1, '开完要刷新宝箱栏，否则那一格还停在"可开启"');
});

test('真跑：点「解锁」（轮到它了）→ 仍走详情，让玩家看清能开出什么', async () => {
    const { page, tips, detailCalls, opened, setSlots } = createPage();
    setSlots([{ ...slotOf(ChestSlotAction.Activate, true), index: 1 }]);

    await page.onChestAction(0);

    assert.deepEqual(detailCalls, [1], '解锁要弹详情（能开出什么 + 立即开要多少）');
    assert.deepEqual(opened, []);
    assert.deepEqual(tips, []);
});

test('真跑：直接开失败按结果给不同提示，busy 静默（避免连点刷屏）', async () => {
    const { page, tips, openResults, setSlots } = createPage();
    setSlots([{ ...slotOf(ChestSlotAction.Open, false), index: 1, state: ChestSlotState.Ready }]);

    openResults.push('offline');
    await page.onChestAction(0);
    assert.deepEqual(tips, ['网络未连接'], 'offline 要说人话');

    tips.length = 0;
    openResults.push('protocol-missing');
    await page.onChestAction(0);
    assert.deepEqual(tips, ['开箱协议消息号未配置']);

    tips.length = 0;
    openResults.push('busy');
    await page.onChestAction(0);
    assert.deepEqual(tips, [], 'busy = 上一次请求还在飞，再弹一句只会刷屏');
});

