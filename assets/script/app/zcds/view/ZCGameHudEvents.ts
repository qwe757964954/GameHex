/**
 * 界面**意图事件**的唯一契约（**只有事件名**）：view 派发 → 控制器 `ZCGame` 订阅。
 *
 * 三处界面的名字统一放这里：`ZCGameHUDView` / `ZCSettlementPage` / `ZCSpawnSelectionView`；
 * 棋盘点击（`HexClick`）由 `ZCGameRenderWorld` 派发。
 *
 * ## 走事件中控（不自建派发器、也不用参数传）
 *
 * 派发与订阅都走 `framework/event/EventMgr`（纯 TS 单例，内部是 `EventBus`）：
 *
 * ```ts
 * EventMgr.instance.emit(ZCGameUiEvent.HexClick, hexId);          // 派发（要带值就给第二个参数）
 * EventMgr.instance.on(ZCGameUiEvent.OpenRank, this.onHudOpenRank, this);   // 订阅
 * ```
 *
 * 不用 `node.on`：契约不绑引擎、纯逻辑单测能直接 require。同目录的 `EventProxy`（网络那套）与
 * `FWEventCenter`（框架自有事件）都是引擎向的，界面意图不挂它们。
 *
 * ## 为什么不是回调
 *
 * 视图只该知道「玩家点了什么」，不该持有控制器的回调。`initialize({ openRank: () => … })` 那套把对局流程的
 * 入口反向塞进视图，视图复用要重设一遍，而且**漏传一个就是点了没反应且零报错**（`openRank` 曾被漏传）。
 *
 * ⚠️ 分层：本文件**不许 import `cc`**（规则 78），它要被纯逻辑单测直接 require。
 */

/** 本工程界面层向外派发的全部意图。 */
export enum ZCGameUiEvent {
    /** HUD：神器（能不能用由模型判 —— 充能 / 冷却）。 */
    UseArtifact = 'zcgame-ui-use-artifact',
    /** HUD：打开战斗指南。 */
    OpenGuide = 'zcgame-ui-open-guide',
    /** HUD：打开伤害统计（`GameRunAway`）。 */
    OpenDamageStats = 'zcgame-ui-open-damage-stats',
    /** HUD：打开对局内排行榜。 */
    OpenRank = 'zcgame-ui-open-rank',
    /** HUD：撤退（走二次确认 / 结算）。 */
    Retreat = 'zcgame-ui-retreat',
    /** HUD：镜头一键复位（回到初始点位，主城落在中心点下方 100px）。 */
    ResetCamera = 'zcgame-ui-reset-camera',
    /** 结算页：点「确定」—— 结算页唯一的收尾动作。 */
    SettlementConfirm = 'zcgame-ui-settlement-confirm',
    /**
     * 结算页：「双倍奖励」。
     *
     * 本期**没有接线**（页面按 `hasDoubleReward` 把按钮置灰），事件先占位 ——
     * 接功能时在 `ZCGame` 里订阅即可，页面不需要改。
     */
    SettlementDoubleReward = 'zcgame-ui-settlement-double-reward',
    /** 结算页：「变强途径」入口（**payload = `'equip' | 'hero' | 'rune'`**）。本期同样未接线。 */
    SettlementGrowEntry = 'zcgame-ui-settlement-grow-entry',
    /** 选点：绿勾「确认位置」（失效态也派发，由选点模型给原因文案）。 */
    SpawnConfirm = 'zcgame-ui-spawn-confirm',
    /** 选点：左下「收回提示 / 显示提示」。 */
    SpawnToggleHints = 'zcgame-ui-spawn-toggle-hints',
    /** 伤害统计弹窗（`GameRunAway`）的「返回主界面」按钮。 */
    ReturnToMain = 'zcgame-ui-return-to-main',
    /** 棋盘：点了某一格（**payload = 格子 id**）；派发方是 `ZCGameRenderWorld`（它才知道是哪一格）。 */
    HexClick = 'zcgame-ui-hex-click',
}
