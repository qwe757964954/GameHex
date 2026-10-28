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
    const events: string[] = [];
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Label: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: Base },
        '../../../framework/ui/PopupDef': { PopupCloseReason: { CloseButton: 2 } },
        // 返回按钮只派发 `ZCGameUiEvent.ReturnToMain`（视图不碰流程，回主界面由控制器决定）。
        '../../../framework/event/EventMgr': { EventMgr: { instance: { emit: (event: string) => events.push(event) } } },
        '../view/ZCGameHudEvents': { ZCGameUiEvent },
        './RunAwayPlayerItem': { RunAwayPlayerItem: class {} },
    });
    const popup = new GameRunAway();
    const listeners: Array<{ fn: Function; target: unknown }> = [];
    popup.returnButton = { node: { active: false, on: (_event: string, fn: Function, target: unknown) => listeners.push({ fn, target }) }, interactable: true };
    popup.titleLabel = { string: '' };
    // 按钮监听在 `onInit` 里绑（`PopupBase` 首次打开前调一次），夹具不走完整打开流程 ⇒ 手动调。
    popup.onInit();
    // `showReturn` 才是「有没有返回按钮」的开关（原先靠有没有 `summary` 推断，那个字段已随
    // 两行数据（`mine`/`enemy`）改版一起下线）。
    popup.onOpen({ title: '胜利', showReturn: true });
    assert.equal(popup.titleLabel.string, '胜利');
    assert.equal(popup.returnButton.node.active, true);
    assert.equal(popup.canCloseOnBlank(), false, '返回模式不许点空白关');
    const listener = listeners[0]; listener.fn.call(listener.target); listener.fn.call(listener.target);
    assert.deepEqual(events, [ZCGameUiEvent.ReturnToMain], '连点两下只派发一次（第二次 showReturn 已落）');
    assert.equal(popup.returnButton.interactable, false);
    popup.onOpen();
    assert.equal(popup.titleLabel.string, '伤害统计'); assert.equal(popup.returnButton.node.active, false);
    assert.equal(popup.canCloseOnBlank(), true);
    assert.equal(listeners.length, 1, '复用不重复绑定');
});

function gameFixture(status = 'playing') {
    // 事件中控是**纯 TS 单例**：夹具拿真模块，用例就能在同一个单例上派发 / 断言。
    // ⚠️ `EventMgr` 自己 `import './EventBus'` ⇒ 两个模块都要喂（相对路径按导入方解析）。
    const busModule = load('assets/script/framework/event/EventBus.ts', {});
    const managerModule = load('assets/script/framework/event/EventMgr.ts', { './EventBus': busModule });
    const opens: any[] = [], routes: string[] = [], toasts: string[] = [], pending: Array<(popup: any) => void> = [];
    /** `ProcedureManager.onSwitchSettled` 的订阅者（用例手动触发“切流落定 / 被取消”）。 */
    const switchWatchers: Array<(entered: boolean) => void> = [];
    const settleSwitch = (entered: boolean) => {
        for (const listener of [...switchWatchers]) listener(entered);
    };
    /** 收尾调用序列（`close` / `navigate`）—— 用来钉「先关页、后导航」的**先后**。 */
    const calls: string[] = [];
    const popup = { open: (options: unknown) => { opens.push(options); return new Promise(resolve => pending.push(resolve)); } };
    const dependencies: Record<string, unknown> = {
        //  组件桩要覆盖 ZCGame 用到的引擎面：`scheduleOnce`/`unschedule`（选点展示计时、金币闪烁等）。
        //  漏了它们会在 `shutdown()` 里以「不是函数」炸掉整条用例（2026-10-16 选点展示改定时器时踩到）。
        //  `isValid` 必须有：`ZCGame.leaving` 的第一项就是 `!this.isValid`（组件销毁后早退），
        //  桩缺它 ⇒ `!undefined` 恒真 ⇒ `update` 一进门就 return，`opens` 永远是空的。
        cc: { _decorator: decorator, Component: class { isValid = true; scheduleOnce() {} unschedule() {} }, Prefab: class {} },
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
        '../../framework/procedure/ProcedureManager': {
            ProcedureManager: {
                navigate: (route: string) => { calls.push(`navigate:${route}`); routes.push(route); },
                // 「确定」先关页再导航，切流被取消时靠这条订阅把页面补回来（2026-10-27）。
                // 桩返回可退订的空订阅；用例用 `switchWatchers` 手动触发「落定 / 被取消」。
                onSwitchSettled: (listener: (entered: boolean) => void) => {
                    switchWatchers.push(listener);
                    return () => {
                        const index = switchWatchers.indexOf(listener);
                        if (index >= 0) switchWatchers.splice(index, 1);
                    };
                },
            },
        },
        // 伤害统计上报（`buildStatistics` → `buildDamageStatistics`）的纯函数入口。
        '../battle/BattleStatisticsModel': { buildDamageStatistics: (rows: unknown) => rows },
        '../../framework/ui/PopupDef': { PopupLayer: { SYSTEM: 1 }, PopupCloseReason: { Manual: 0, Force: 3 } },
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
        // `buildStatistics`（伤害上报）按 `model.owners` 逐方取 `damageStats[owner].dealt`。
        owners: ['player', 'enemy'],
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
    // `phase` 控制器（`ZCBattlePhaseController`）是后加的：`openSettlement()` 只在
    // `Playing` / `SettlementPresentation` 才准过闸。夹具是 `Idle` 起步 ⇒ 不推这一下，
    // `update` 走到结算分支会被闸门挡掉，`opens` 永远为空（本文件这几条曾长期因此假红）。
    game.phase.startPlaying();
    // 界面意图一律走 `EventMgr` 中控，订阅集中在 `bindUiEvents`（`initialize` 里调）。
    // 夹具不走 `initialize`（它要加载整份战斗资源），所以这里手动绑一次 ——
    // 不绑的话 `mgr.emit(SettlementConfirm)` 没有任何接收方。
    game.bindUiEvents();
    return {
        game, state, mgr: managerModule.EventMgr.instance, opens, pending, routes, toasts, switchWatchers, settleSwitch, calls,
        get ticks() { return ticks; }, get hudDestroyed() { return hudDestroyed; }, get worldDestroyed() { return worldDestroyed; },
    };
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
        f.mgr.emit(ZCGameUiEvent.SettlementConfirm);
        assert.deepEqual(f.routes, ['main'], '确定 ⇒ 回主界面');
        // 2026-10-27 改口径：确定那一拍**立刻收页面**（`Manual`），不再等 `onLeave → shutdown()` 的 `Force`
        // —— 切流程要走「预加载 → 进入」两段，弹窗干等那几百毫秒就是「点了没反应」。
        assert.deepEqual(closed, [0], '确定即刻关页（Manual）');
        f.game.shutdown(); f.game.onDestroy();
        assert.equal(f.hudDestroyed, 1); assert.equal(f.worldDestroyed, 1);
        assert.deepEqual(closed, [0], 'shutdown 不该再关一次（句柄已摘）');
    }
});

test('确定先关页再导航；切流被取消时把结算页补回来（不许把人留在死局）', async () => {
    const f = gameFixture('victory');
    f.game.update(0.05); f.game.update(0.05);
    assert.equal(f.opens.length, 1, '终局弹一次结算页');

    const closed: number[] = [];
    // 用带调用序列的壳：`calls` 里同时记 close 与 navigate，才能钉住**先后**。
    const page = { close: (reason: number) => { closed.push(reason); f.calls.push('close'); } };
    f.pending[0](page); await flush();

    f.mgr.emit(ZCGameUiEvent.SettlementConfirm);
    // ① 先关页（Manual = 0），再发起导航 —— 顺序反了就等于「点了没反应」。
    assert.deepEqual(f.calls, ['close', 'navigate:main'], '收尾序列必须是「先关页 → 再导航」');
    assert.deepEqual(closed, [0], '确定那一拍就关页');

    // ② 切流被取消（预加载失败 / 被别的切换顶掉）⇒ 必须补一页回来，否则 phase 已是 Settlement
    //    ⇒ `openSettlement` 再也进不来，页面没了但人还在对局里 = 死局。
    f.settleSwitch(false);
    await flush();
    assert.equal(f.opens.length, 2, '切流被取消要重弹结算页');
    assert.deepEqual(f.opens[1].userData, f.opens[0].userData, '复用首次那份 userData（奖励帧已解析好）');
    assert.equal(f.switchWatchers.length, 0, '回调里必须 stop() 自己（该订阅不是一次性的）');

    // ③ 补回来那一页再点确定，这次切流成功 ⇒ 不再重开。
    const again = popupStub(closed);
    f.pending[1](again); await flush();
    f.mgr.emit(ZCGameUiEvent.SettlementConfirm);
    assert.deepEqual(closed, [0, 0], '第二页同样立刻关');
    f.settleSwitch(true);
    await flush();
    assert.equal(f.opens.length, 2, '切流成功不重开');
    assert.equal(f.switchWatchers.length, 0, '成功同样退订');
    f.game.shutdown();
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
    const prefab = JSON.parse(readFileSync('assets/bundles/battle/ui/game/GameRunAway.prefab', 'utf8'));
    for (const object of prefab) {
        JSON.stringify(object, (key, value) => { if (key === '__id__') assert.ok(value >= 0 && value < prefab.length); return value; });
    }
    const script = prefab.find((x: any) => x.returnButton && x.titleLabel);
    const button = prefab[script.returnButton.__id__]; assert.equal(button.__type__, 'cc.Button');
    const node = prefab[button.node.__id__]; assert.equal(node._active, false);
    const sprite = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.Sprite');
    const meta = JSON.parse(readFileSync('assets/resources/image/common/anniu_01.png.meta', 'utf8'));
    assert.equal(sprite._spriteFrame.__uuid__, meta.subMetas.f9941.uuid);
    const transform = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    const panel = prefab[node._parent.__id__];
    const panelTransform = panel._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    assert.ok(Math.abs(node._lpos.y) + transform._contentSize.height / 2 < panelTransform._contentSize.height / 2);
    // 原先断言的是 `summaryLabel`（一行说明文字）—— 两行数据（`mine`/`enemy`）改版后那个属性
    // 已从 `GameRunAway` 下线，现在必填的文本引用只剩标题 `titleLabel`。
    assert.equal(prefab[script.titleLabel.__id__].__type__, 'cc.Label');
});
