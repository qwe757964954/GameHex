/**
 * 主界面入口 open.url → 要打开的界面。
 * 显式白名单：只登记已落地界面，未登记返回 none。纯数据 + 纯函数，可单测。
 */

// ⚠️ 这个联合**必须写成单行**：`tests/seven-day.test.ts` 用字面正则
// `/EntrancePopupKey = 'firstRecharge' \| 'sevenDay'/` 钉它（防「顺手把整张表都登记进来」）。
// 要换成多行写法，得先同步那条守卫。
export type EntrancePopupKey = 'firstRecharge' | 'sevenDay' | 'monthCardGift' | 'gift' | 'activity' | 'battleToken' | 'friend' | 'mail' | 'chat' | 'role' | 'limitTimeBuy';

export type EntranceRoute =
    | { readonly kind: 'popup'; readonly key: EntrancePopupKey }
    | { readonly kind: 'none' };

/** 已接线弹窗：open.url → 弹窗 key。逐字匹配，键与策划表一致。 */
const POPUP_URLS: Readonly<Record<string, EntrancePopupKey>> = {
    LayerFirstRecharge: 'firstRecharge',
    LayerSevenDay: 'sevenDay',
    LayerGiftMonth: 'monthCardGift',
    // 礼包（open.json `refId = 103`，`tlRDResId = [409]`，条件 `battleLevel>=1` + `notTiShen`）。
    LayerGift: 'gift',
    // 活动（open.json `refId = 102`，右侧 `order = 2`，`icon = 图标_战斗选关_按钮_活动`，
    // 条件 `battleLevel(resId=1)` + `notTiShen`）。老端界面类名同名，
    // 弹窗类 = `LayerActivityPage`（`static prefabPath = 'ui/Activity/Activity'`）。
    LayerActivity: 'activity',
    // 战令（open.json `refId = 104`，**左列** `belond = 2`、`order = 3`，
    // `icon = 图标_战斗选关_按钮_战令`，`tipShow = 通关第1关解锁`，`RDExpr = "[RDBattleToken]"，
    // 条件 `battleLevel(resId=1)` + `notTiShen`）。老端界面类名同名。
    // 弹窗类 = `BattleTokenPage`（`static prefabPath = 'ui/BattleToken/BattleToken'`）。
    LayerBattleToken: 'battleToken',
    // 好友（open.json `refId = 206`，右侧 `order = 6`，`icon = 图标_主界面_好友`
    // → icon.json 解到 `图标_主界面/zjm_icon02_HaoYou`，`visibleCondition = [{}]` 无条件）。
    // 弹窗类 = `FriendPage`（`static prefabPath = 'ui/Friend/Friend'`）。
    LayerFriend: 'friend',
    // 邮件（open.json `refId = 301`，右侧 `order = 7`，`icon = 图标_战斗选关_按钮_邮件`，
    // `RDExpr = "[RDMail]"`，`visibleCondition = [{}]` 无条件）。
    // 弹窗类 = `MailPage`（`static prefabPath = 'ui/Mail/Mail'`）。
    LayerMail: 'mail',
    // 聊天（open.json `refId = 13`，`belond = 0`（**左右列之外**），`tipShow = 通关第5关解锁`，
    // `visibleCondition = [battleLevel(resId=5)]`，`RDExpr = "[RDChat]"`）。
    // 弹窗类 = `ChatPage`（`static prefabPath = 'ui/Chat/Chat'`）。
    //
    // 表里 `belond = 0` ⇒ 不会被左右入口列表收集；主界面由 BottomHud/ChatBar 承接聊天入口。
    //    这里登记是为了守住「入口白名单只两处」这条约定，并让表改成 belond 2/3 时能直接生效；
    //    按钮本身**不走**这条路由（它直接 `PopupManager.openAsync(ChatPage)`）。
    LayerChat: 'chat',
    // 角色主界面（open.json `refId = 2`，左列 belond=1、type=1，
    // `tipShow = 通关第1关解锁`，条件 `battleLevel(resId=1)`）。
    // 全屏页面（本轮含背包三页签）⇒ RolePage（`static prefabPath = 'ui/Role/Role'`）。
    TabRoleMain: 'role',
    // 限时活动（open.json `refId = 421`，`url = LayerLimitTimeBuy`，`belond = 0`（左右列之外），
    // `name = 限时礼包`，`RDExpr = "[RDLimitTime]"`，无条件）。
    // ⚠️ 老端 `LayerLimitTimeBuy` 本是「限时礼包」独立系统；本轮按山猫要求把该入口改接到
    // 「限时活动」三页签（每日任务 / 每日礼包 / 限购）⇒ LimitTimeActPage
    // （`static prefabPath = 'ui/LimitTimeAct/LimitTimeAct'`）。
    LayerLimitTimeBuy: 'limitTimeBuy',
};

/** url → 路由。未登记 / 空值返回 none，不抛。 */
export function resolveEntranceRoute(url: string | null | undefined): EntranceRoute {
    const key = typeof url === 'string' ? url.trim() : '';
    if (key.length > 0) {
        const popupKey = POPUP_URLS[key];
        if (popupKey) return { kind: 'popup', key: popupKey };
    }
    return { kind: 'none' };
}

export function isEntranceUrlRouted(url: string | null | undefined): boolean {
    return resolveEntranceRoute(url).kind !== 'none';
}

export function routedEntranceUrls(): readonly string[] {
    return Object.keys(POPUP_URLS);
}
