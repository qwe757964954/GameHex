/**
 * 界面**意图事件**的唯一契约（**只有事件名**）：view 派发 → 控制器 `ZCBattleRuntimeController` 订阅。
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
    /** GM：增加本局我方金币，payload 为数量；同步返回 DebugAddGoldResult（message）。 */
    DebugAddGold = 'zcgame-debug-add-gold',
    DebugAddGoldResult = 'zcgame-debug-add-gold-result',
    /** GM：设置本局我方后续翻格的指定卡；同步返回 DebugDrawCardResult。 */
    DebugDrawCard = 'zcgame-debug-draw-card',
    DebugDrawCardResult = 'zcgame-debug-draw-card-result',
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
     * 接功能时在 `ZCBattleRuntimeController` 里订阅即可，页面不需要改。
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
    /** 展示缺图请求；owner 为本局 ZCGame，控制器按兵种配置解析资源路径。 */
    RequestUnitArt = 'zcgame-ui-request-unit-art',
    /**
     * 展示缺**技能特效**美术请求；owner 为本局 ZCGame，payload 直接带 prefab 路径。
     *
     * 与 `RequestUnitArt` 同型但缺口在另一条链上：本局特效清单由
     * `buildZCVisualResourcePlan(heroIds)` 按后端英雄名单算，兵营产兵 / 波次兵 / GM 临时加的兵
     * 不在名单里 ⇒ 它们的普攻与技能特效路径**一条都不会被加载**，战场上就是「这个兵的子弹不见了」，
     * 而且连「加载失败」都不会报（压根没被要求加载）。
     * 派发方是 `ZCGameRenderWorld`（它才知道哪条路径取不到）。
     */
    RequestEffectArt = 'zcgame-ui-request-effect-art',
}

export interface IZCDebugDrawCardIntent {
    readonly cardId: string;
    readonly count: number;
}

export interface IZCDebugDrawCardResult {
    readonly message: string;
}

export interface IZCRequestUnitArtIntent {
    readonly owner: object;
    readonly unitId: string;
}

export interface IZCRequestEffectArtIntent {
    readonly owner: object;
    /** 资源路径（= `effectVisualPrefabs` 的 key，如 `units/projectiles/磁电菇_子弹攻击/磁电菇_子弹攻击`）。 */
    readonly path: string;
}
