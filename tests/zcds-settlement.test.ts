import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function load(file: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as any, console, require: (name: string) => {
        assert.ok(name in dependencies, name); return dependencies[name];
    } };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, context); return context.exports;
}
const decorator = { ccclass: () => (value: unknown) => value, property: () => () => {} };
const { ZCGameUiEvent } = load('assets/script/app/zcds/view/ZCGameHudEvents.ts', {});

/**
 * 弹窗替身：`open` 挂起（由用例手动兑现）。总线在**控制器自己**身上（`uiEvents`），订阅也在
 * `bindUiEvents` 里注册 —— 所以这里只要一个能 `close` 的壳，事件由用例直接往 `game.uiEvents` 派发。
 */
function popupStub(closed: number[] = []) {
    return { close: (reason: number) => closed.push(reason) };
}

test('结算按钮显示、空白关闭被拦截，返回只调用一次，复用时恢复统计预览', () => {
    class Base {
        enabledInHierarchy = true; isPopupOpen = true;
        close() { this.onClose(); } onClose() {} closeByButton() {}
    }
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Label: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: Base },
        '../../../framework/ui/PopupDef': { PopupCloseReason: { CloseButton: 2 } },
        './RunAwayPlayerItem': { RunAwayPlayerItem: class {} },
    });
    const popup = new GameRunAway(); let returned = 0;
    const listeners: Array<{ fn: Function; target: unknown }> = [];
    popup.returnButton = { node: { active: false, on: (_event: string, fn: Function, target: unknown) => listeners.push({ fn, target }) }, interactable: true };
    popup.summaryLabel = { string: '', node: { active: false } }; popup.titleLabel = { string: '' };
    popup.onOpen({ title: '胜利', summary: '对局结束', onReturnToMain: () => returned++ });
    assert.equal(popup.titleLabel.string, '胜利'); assert.equal(popup.summaryLabel.node.active, true);
    assert.equal(popup.returnButton.node.active, true); assert.equal(popup.canCloseOnBlank(), false);
    const listener = listeners[0]; listener.fn.call(listener.target); listener.fn.call(listener.target);
    assert.equal(returned, 1); assert.equal(popup.returnButton.interactable, false);
    popup.onOpen();
    assert.equal(popup.titleLabel.string, '伤害统计'); assert.equal(popup.returnButton.node.active, false);
    assert.equal(popup.summaryLabel.node.active, false); assert.equal(popup.canCloseOnBlank(), true);
    assert.equal(listeners.length, 1, '复用不重复绑定');
});

function gameFixture(status = 'playing') {
    // 事件中控是**纯 TS 单例**：夹具拿真模块，用例就能在同一个单例上派发 / 断言。
    // ⚠️ `EventMgr` 自己 `import './EventBus'` ⇒ 两个模块都要喂（相对路径按导入方解析）。
    const busModule = load('assets/script/framework/event/EventBus.ts', {});
    const managerModule = load('assets/script/framework/event/EventMgr.ts', { './EventBus': busModule });
    const opens: any[] = [], routes: string[] = [], toasts: string[] = [], pending: Array<(popup: any) => void> = [];
    const popup = { open: (options: unknown) => { opens.push(options); return new Promise(resolve => pending.push(resolve)); } };
    const dependencies: Record<string, unknown> = {
        //  组件桩要覆盖 ZCGame 用到的引擎面：`scheduleOnce`/`unschedule`（选点展示计时、金币闪烁等）。
        //  漏了它们会在 `shutdown()` 里以「不是函数」炸掉整条用例（2026-10-16 选点展示改定时器时踩到）。
        cc: { _decorator: decorator, Component: class { scheduleOnce() {} unschedule() {} }, Prefab: class {} },
        './ui/GameRunAway': { GameRunAway: popup }, './ui/ZCGuidePanel': { ZCGuidePanel: popup },
        // 结算页换成蓝湖稿的 `ZCSettlementPage`（伤害统计仍走 GameRunAway）。
        './ui/ZCSettlementPage': { ZCSettlementPage: popup },
        // 以下两个都是 `ZCGame.ts` 的**值 import** ⇒ 白名单缺一个整份文件在 require 阶段就起不来：
        //  · 界面意图事件契约（HUD / 结算页 / 选点三处统一在它里面，2026-10-16）
        //  · 对局阶段控制器（`ZCBattlePhaseController`，纯 TS 无依赖 —— 之前漏了它，本文件 7 条用例
        //    全挂在 require 阶段，表现为「夹具跑不起来」）
        './view/ZCGameHudEvents': load('assets/script/app/zcds/view/ZCGameHudEvents.ts', {}),
        //  ZCGame 在 `app/zcds/` ⇒ 相对路径是两级（别照抄 view 下的三级）。
        '../../framework/event/EventMgr': managerModule,
        './application/ZCBattlePhaseController':
            load('assets/script/app/zcds/application/ZCBattlePhaseController.ts', {}),
        './model/ZCCombatCatalog': {}, './view/ZCGameHUDView': {}, './model/ZCGameModel': {},
        // `ZCGame` 用 `buildRankSeats` 组装排行榜（值 import ⇒ require 阶段就会解析）：
        // 白名单漏了它整份 ZCGame.ts 在 require 阶段就起不来（2026-10-14 补）。
        './model/ZCRankBoard': { buildRankSeats: () => [] },
        './view/ZCGameRankBoard': { ZCGameRankBoard: class {} },
        // zcds 统一日志开关（2026-10-15）：`ZCGame.ts` 的弹窗失败告警挂在它后面。
        // 沙箱 require 白名单缺它整份文件在 require 阶段就起不来。
        './ZCDCLogSwitch': { ZCDC_LOG_WARNINGS: true, ZCDC_LOG_DIAGNOSTICS: false },
        // 以下同属「require 白名单」：`ZCGame.ts` 的值 import，缺一个整文件就起不来。
        './model/ZCMapConfig': { ZC_OWNER_ORDER: ['player', 'enemy'], ZCOwner },
        './model/ZCMatchConfig': { captureZCMatchConfig: () => ({}) },
        './model/ZCSpawnSelection': {}, './view/ZCSpawnSelectionView': {},
        './view/ZCHudBossPanel': {}, './application/ZCClientCombatConfig': {},
        // 章节战斗结算广播（`CmdBattleResultBroMsg` 1002）：进对局挂订阅 + 章节局等它再弹。
        '../battle/BattleResultService': { BattleResultService: { ensureListening: () => {}, waitForChapterResult: () => Promise.resolve(null) } },
        '../showReward/RewardFrames': { resolveCmdGoodsFrames: () => Promise.resolve([]) },
        '../itemdetail/ItemDetailTable': { itemNumberTextOf: (n) => String(n) },
        './model/ZCGameRuntimeConfig': {}, './model/ZCSeededRandom': {}, './view/ZCGameRenderWorld': {},
        // 自由装饰摆放清单（`ZCGame.installMapDecor` 用）。
        // 这只是个沙箱 require 白名单：不补的话 `ZCGame.ts` 在 require 阶段就起不来，
        // 跟被测的结算行为毫无关系。
        './view/ZCGameViewUtil': {},
        // 装饰图的装配路径（`ArtPaths.decorFramePath`）。同上，纯白名单，用例不碰装饰。
        '../ArtPaths': {},
        // 头像加载入口（类静态方法）：结算用例不碰头像，给个空类壳保证 require 阶段解析得到。
        '../HeadArt': { HeadArt: {} },
        '../../framework/ref/RefUtil': {},
        // 吐司出口：ZCGame 经 FW.showTip 上报主动操作结果（framework 不反向依赖 app）
        '../../framework/FW': { FW: { showTip: (tip: string) => toasts.push(tip) } },
        '../../core/runtime/GameRoute': { GameRoute: { Main: 'main' } },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: { navigate: (route: string) => routes.push(route) } },
        '../../framework/ui/PopupDef': { PopupLayer: { SYSTEM: 1 }, PopupCloseReason: { Force: 3 } },
        // `ZCGame.openSettlement` 会按胜负上报（`finishBattle`），这三个符号是 ZCGame.ts 的
        // 既有 import —— 缺白名单会在 require 阶段整文件起不来，跟被测行为无关。
        // 用例不验上报，给个已兑现的替身即可。
        '../battle/BattleStartService': {
            finishBattle: () => Promise.resolve(null),
            BATTLE_RESULT_WIN: 1, BATTLE_RESULT_LOSE: 2,
        },
    };
    const { ZCGame } = load('assets/script/app/zcds/ZCGame.ts', dependencies);
    const game = new ZCGame(); let ticks = 0, hudDestroyed = 0, worldDestroyed = 0;
    const state = { status, elapsedSeconds: 125, resultReason: '敌方地块归零' };
    // `frameEvents` 是 `openSettlement` 上报时 `map` 的那份帧事件（`ZCGameModel` 上本来就空数组）。
    game.model = {
        snapshot: state, frameEvents: [],
        damageStats: { player: { dealt: 120, taken: 30 }, enemy: { dealt: 30, taken: 120 } },
        tick: () => ticks++,
        // `ZCGame.render` 每帧的入口：取渲染帧 + 取本帧表现事件（夹具写在这次 refactor 之前，缺一个就报
        // `createRenderFrame is not a function`）。
        createRenderFrame: () => ({ snapshot: state }),
        drainPresentationEvents: () => ({}),
        // `onHexClick` 会问模型能不能开发（夹具缺它时以「不是函数」炸在水下）。
        canPlayerDevelop: () => false,
    };
    // `settlementOverviewSettled: true` 让结算演出分支直接落到 `openSettlement()`（夹具不演镜头；
    // 缺它会让 `update` 去调 `startSettlementOverview`，桩里没这个方法 ⇒ 以「不是函数」炸掉）。
    game.hudView = {
        node: { destroy: () => hudDestroyed++ }, render() {},
        settlementOverviewSettled: true, startSettlementOverview() {},
        leftPlayer: { nameLabel: { string: '玩家' } }, rightPlayer: { nameLabel: { string: '对手' } },
    };
    // 结算扫场三方法必须给：`ZCGame.update` 在结算分支里逐帧调它们推进地块变色。
    // `startVictorySweep` 返 false（没起扫场）才会同帧落到 `openSettlement`，
    // 用例断的「结算只开一次」正是这条路径。
    game.renderWorld = {
        render() {}, renderDynamic() {}, renderStatic() {},
        startVictorySweep: () => false, advanceVictorySweep: () => false, clearVictorySweep() {},
        // 选点阶段才用得到（注入/摘除跟随基地的【确认位置】按钮）；退出对局的清理路径会调它，
        // 桩里必须给个空实现，否则 `restoreSpawnConfirmButton` 会以「不是函数」炸掉整条用例。
        setSpawnConfirmButton() {},
        // 同一条「退出对局的清理路径」：开局归属扩散波（请求 F，钉钉表 row11）在 `destroy` 里
        // 被收工，少这一个空实现同样会以「不是函数」炸掉整条用例。
        clearTerritoryClaimWave() {},
        destroy: () => worldDestroyed++,
    };
    return { game, state, mgr: managerModule.EventMgr.instance, opens, pending, routes, toasts, get ticks() { return ticks; }, get hudDestroyed() { return hudDestroyed; }, get worldDestroyed() { return worldDestroyed; } };
}

test('神器结果既进底部战报也弹吐司，开发地块等高频结果不弹', () => {
    const f = gameFixture();
    // 神器按钮：主动点击类操作，失败原因（充能不足 / 冷却中）必须强提示。
    f.game.applyResult({ ok: false, message: '神器尚未充满。' }, { toast: true });
    assert.deepEqual(f.toasts, ['神器尚未充满。']);

    f.game.applyResult({ ok: true, message: '神器【雷霆】发动：敌军受创并冻结 3 秒！' }, { toast: true });
    assert.deepEqual(f.toasts, ['神器尚未充满。', '神器【雷霆】发动：敌军受创并冻结 3 秒！']);
    // 默认不弹：点一次地就糊一条吐司会把屏幕占满，这些走战报栏即可。
    f.game.applyResult({ ok: false, message: '金币不足，需要 30。' });
    assert.deepEqual(f.toasts, ['神器尚未充满。', '神器【雷霆】发动：敌军受创并冻结 3 秒！']);
});

test('胜负和平局自动结算一次，结算页只吃胜负，返回使用主界面路由', async () => {
    // 新结算页（`ZCSettlement`）只吃「胜负」：标题套图（战斗胜利/战斗失败）由 `victory` 决定；
    // 伤害明细改由独立的伤害统计弹窗承载，不再塞进结算页（设计稿里没有统计表）。
    for (const status of ['victory', 'defeat', 'draw']) {
        const f = gameFixture(status); f.game.update(0.05); f.game.update(0.05);
        assert.equal(f.opens.length, 1); assert.equal(f.ticks, 1);
        const options = f.opens[0]; assert.equal(options.closeOnBlank, false); assert.equal(options.layer, 1);
        assert.equal(options.userData.victory, status === 'victory', `${status} 的胜负标记`);
        // 控制器在 `open().then` 里订阅弹窗节点的确定事件（订阅挂节点 ⇒ 弹窗销毁自动回收）。
        const closed: number[] = []; const page = popupStub(closed);
        f.pending[0](page); await flush();
        f.mgr.emit(ZCGameUiEvent.SettlementConfirm); assert.deepEqual(f.routes, ['main'], '确定 ⇒ 回主界面');
        f.game.shutdown(); f.game.onDestroy();
        assert.equal(f.hudDestroyed, 1); assert.equal(f.worldDestroyed, 1);
        assert.deepEqual(closed, [3]);
    }
});

test('主动撤退打开结算并停止逻辑，结算期间不开发地块或打开统计', () => {
    const f = gameFixture(); f.game.openSettlement(true); f.game.update(0.05);
    f.game.onHexClick(1); f.game.openRunAway(); f.game.openSettlement(true);
    assert.equal(f.ticks, 0); assert.equal(f.opens.length, 1);
    assert.equal(f.opens[0].userData.victory, false, '撤退算失败（与上报口径一致）');
});

test('退出后迟到的结算立即关闭，回调不能发起导航，已有统计与指南一起清理', async () => {
    const f = gameFixture('victory'); const reasons: number[] = [];
    f.game.damagePopup = { close: (reason: number) => reasons.push(reason) };
    f.game.guidePopup = { close: (reason: number) => reasons.push(reason) };
    f.game.update(0.05); f.game.onDestroy();
    // 离场后才兑现的弹窗：控制器走 `leaving` 分支强行关掉、**不订阅**确定事件
    // ⇒ 之后就算派发也不许再导航。
    const page = popupStub(reasons);
    f.pending[0](page); await flush();
    f.mgr.emit(ZCGameUiEvent.SettlementConfirm);
    assert.deepEqual(f.routes, []); assert.deepEqual(reasons, [3, 3, 3]);
});

test('退出后迟到的统计预览也会清理（"加载期间不重复打开"已交给 PopupManager 去重）', async () => {
    const f = gameFixture(); let closed = 0;
    //  旧口径靠 `ZCGame.damagePopupLoading` 拦「加载期间重复点」；那次简化之后去重交给
    // `PopupManager.openAsync`（同一 `prefabPath` 返回同一次任务 / 已打开返回现有实例）。
    // ⚠️ 本夹具把 `GameRunAway.open` 整个换成桩（根本不进 PopupManager）⇒ **观测不到**去重，
    //   所以不再断言它；去重本身由"真引擎连发两次 open"的探针覆盖（见 tmp/_rank_blank_probe.mjs 同族）。
    f.game.openRunAway();
    assert.equal(f.opens.length, 1);
    f.game.onDestroy(); f.pending[0]({ close: () => closed++ }); await flush();
    assert.equal(closed, 1);
});

test('结算 Prefab 按钮与说明绑定完整，复用现有按钮贴图且位于面板内', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/game/GameRunAway.prefab', 'utf8'));
    for (const object of prefab) {
        JSON.stringify(object, (key, value) => { if (key === '__id__') assert.ok(value >= 0 && value < prefab.length); return value; });
    }
    const script = prefab.find((x: any) => x.returnButton && x.summaryLabel);
    const button = prefab[script.returnButton.__id__]; assert.equal(button.__type__, 'cc.Button');
    const node = prefab[button.node.__id__]; assert.equal(node._active, false);
    const sprite = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.Sprite');
    const meta = JSON.parse(readFileSync('assets/resources/image/common/anniu_01.png.meta', 'utf8'));
    assert.equal(sprite._spriteFrame.__uuid__, meta.subMetas.f9941.uuid);
    const transform = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    const panel = prefab[node._parent.__id__];
    const panelTransform = panel._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    assert.ok(Math.abs(node._lpos.y) + transform._contentSize.height / 2 < panelTransform._contentSize.height / 2);
    assert.equal(prefab[script.summaryLabel.__id__].__type__, 'cc.Label');
});
