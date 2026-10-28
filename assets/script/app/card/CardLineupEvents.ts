/**
 * 「卡牌阵容 ↔ 布阵面板」这条链的**结果事件**契约（只放事件名与 payload 类型）。
 *
 * ## 为什么不是回调
 *
 * 布阵面板保存成功后，卡牌阵容页要重刷 —— 它显示的八卡读的是服务端「选中阵型」，而保存会改它。
 * 以前是：
 *
 * ```ts
 * const session: ILineupBoardOpenSession = { assets };
 * await LineupBoardPage.open({ userData: session, onClose: () => { if (session.saved) refresh(); } });
 * ```
 *
 * 两个问题：
 *   1. **结果绑在「关闭」上**：面板开着时点了保存，页面不会更新，要等玩家点右上角关闭；
 *   2. `saved` 是跨对象共享的临时可变字段，写的一侧和读的一侧要靠「这轮是不是我写的」互相猜。
 *
 * 改成事件后：保存成功当场派发，谁关心谁订阅，面板完全不知道外面有谁 —— 这也是
 * `docs/AI架构与代码规范.md` §2.1「视图只派发意图、不持有控制器回调」的一体两面。
 *
 * ⚠️ 本文件**不许 import `cc`**：`EventMgr` 是纯 TS 单例，这里必须能被单测直接 require。
 */

/** 本链条对外派发的全部事件名。 */
export const CardLineupEvent = {
    /** 布阵面板保存成功（服务端已确认，`draft.commit()` 之后）。payload = `ICardDeckSavedPayload`。 */
    DeckSaved: 'card-lineup-deck-saved',
    /**
     * 某张卡升级成功（服务端已确认）。payload = `IHeroUpgradedPayload`。
     *
     * 原来走的是 `ICardUpgradeOpenData.onUpgraded` 回调 —— 升级弹窗持有调用方的闭包，
     * 谁想听就得在打开时传一个进去（漏传 = 升级后外面不刷新，且零报错）。
     * 改成事件后弹窗只管"我升成功了"，外面谁关心谁订阅（`CardLineupPage` 拿它回写等级缓存）。
     */
    HeroUpgraded: 'card-lineup-hero-upgraded',
    /**
     * 技能行点了「↑ / ↓」。payload = `ISkillStepPayload`。
     *
     * 原来是注入式回调（`CardSkillRowView.host` ← `CardSkillListView.host` ← `CardSkillPage`），
     * 而且为了兜住「注入失败」还写了个沿父链**鸭子类型反射**找 `onSkillStep` 的兜底
     * —— 那套已经删了：行只派发意图，页面订阅，找不到宿主这种状态从根上不存在。
     */
    SkillStep: 'card-skill-step',
} as const;

/** `CardLineupEvent` 的取值类型（`as const` 派生，别手写第二份字符串字面量）。 */
export type CardLineupEventName = typeof CardLineupEvent[keyof typeof CardLineupEvent];

/** 保存成功时带的业务数据：够订阅方决定「要不要刷、刷哪一格」。 */
export interface ICardDeckSavedPayload {
    /** 被保存并置为选中的阵型编号（1 起）。 */
    readonly formationId: number;
    /** 保存后的完整英雄列表（服务端已确认）。 */
    readonly heroIds: readonly number[];
}

/** 升级成功时带的业务数据。 */
export interface IHeroUpgradedPayload {
    /** 英雄编号（与 `pvpCard.id` 同一套）。 */
    readonly heroId: number;
    /** 服务端确认后的新等级。 */
    readonly level: number;
}

/** 技能行按钮：`direction = -1` 本地往回看一档；`+1` 发技能升级请求。 */
export interface ISkillStepPayload {
    readonly skillId: number;
    readonly direction: 1 | -1;
}
