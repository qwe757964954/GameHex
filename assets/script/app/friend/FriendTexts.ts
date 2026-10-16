/**
 * 「好友」模块的全部文案 —— **改文案只动这一个文件**。
 *
 * 来源（逐条可回溯）：
 *   · FGUI `好友/组件/组件_好友.xml` 的 `Button title` / `text` 字面量
 *   · FGUI `好友/组件/弹窗_好友_申请列表.xml` / `弹窗_好友_领取粮草.xml` 同款
 *   · 老端 `FW.G_W("XXX")` 的语言表键（在注释里标出原键名，便于以后接多语言）
 *
 * ⚠️ 老端靠 `StringUtil.format(模板, 参数)` 做占位；这里保留 `{0}` 形式，
 *   由 `formatText` 替换，**不引老端的 StringUtil**（它带框架依赖）。
 */

/** 带 `{0}` 占位符的文案。 */
export type FriendTextTemplate = string;

/** `{0}` / `{1}` 顺序替换；缺参保留原样（便于一眼看出漏传）。 */
export function formatText(template: FriendTextTemplate, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, indexText: string) => {
        const index = Number(indexText);
        const value = args[index];
        return value === undefined || value === null ? whole : String(value);
    });
}

/** 三个页签的标题（`FriendTab` 的顺序 = `FRIEND_TAB_KEYS` 的顺序）。 */
export const FRIEND_TAB_LABELS: readonly string[] = ['好友列表', '添加好友', '黑名单'];

/** 三个弹窗的标题栏（老端 `LayerFriend_Text` / `LayerFriend_Text_1` / `LayerFriend_Text_2`）。 */
export const FRIEND_TITLE = '好友';
export const FRIEND_APPLY_TITLE = '好友申请';
export const FRIEND_GET_END_TITLE = '领取体力';

/** 主容器底部 / 右上角的按钮文案（FGUI `Button title` 原值）。 */
export const FRIEND_BTN_REMOVE_MODE = '批量删除';
export const FRIEND_BTN_REMOVE_MODE_BACK = '返回';
export const FRIEND_BTN_SEND_ONE_KEY = '一键赠送';
export const FRIEND_BTN_GET_END = '领取体力';
export const FRIEND_BTN_REFRESH = '换一批';
export const FRIEND_BTN_APPLY_LIST = '好友申请';
export const FRIEND_BTN_REMOVE_ONE_KEY = '一键删除';
export const FRIEND_BTN_SEARCH = '搜索';

/** 申请列表弹窗的两个按钮。 */
export const FRIEND_BTN_REFUSE_ONE_KEY = '一键拒绝';
export const FRIEND_BTN_AGREE_ONE_KEY = '一键同意';
export const FRIEND_APPLY_EMPTY = '暂无申请';

/** 领取体力弹窗的按钮。 */
export const FRIEND_BTN_GET_END_ONE_KEY = '一键领取';

/** 行内按钮（老端 `REMOVE_BTN` / `GIFT_BTN_1` / `GIFT_BTN_2` / `APPLY_BTN`）。 */
export const FRIEND_ROW_BUTTON_TEXT: Readonly<Record<string, string>> = {
    /** 未赠送过 → 可点。 */
    gift: '赠送',
    /** 已赠送 → 置灰（老端 `GIFT_BTN_1`）。 */
    gifted: '已赠送',
    /** 未申请过 → 可点（老端 `APPLY_BTN`）。 */
    apply: '申请',
    /** 已申请 → 置灰。 */
    applied: '已申请',
    /** 黑名单行。 */
    remove: '移除',
};

/** 好友行里的两个「按钮」：私聊（仅好友列表页签）。 */
export const FRIEND_BTN_CHAT = '私聊';

/** 计数类文案（老端 `FRIEND_NUM` / `BLACK_LIST`）。 */
export const FRIEND_COUNT_TEMPLATE = '好友数：{0}/{1}';
export const FRIEND_BLACK_COUNT_TEMPLATE = '黑名单：{0}/{1}';

/** 剩余次数（老端 `FRIEND_SEND_END_TIMES` / `FRIEND_GET_END_TIMES`）。 */
export const FRIEND_SEND_TIMES_TEMPLATE = '今日还可赠送{0}次';
export const FRIEND_GET_END_TIMES_TEMPLATE = '今日还可领取{0}次';

/** 批量删除的人数提示（老端 `FRIEND_REMOVE_SELECT_TEXT`）。 */
export const FRIEND_REMOVE_SELECT_TEMPLATE = '已选择：{0}人';

/** 战力前缀（老端 `COMBAT_POWER_TEXT`）与在线标（`ONLINE_TEXT`）。 */
export const FRIEND_POWER_PREFIX = '战力：';
export const FRIEND_ONLINE_TEXT = '在线';

/** 领取行的体力数（老端 `GIFT_NUM`）。 */
export const FRIEND_END_NUM_TEMPLATE = '体力数:{0}';
/** 行的主按钮（领取体力弹窗的行）。 */
export const FRIEND_ROW_GET_END_TEXT = '领取';

/** 搜索框占位（FGUI `label_player` 的 `prompt`）。 */
export const FRIEND_SEARCH_PROMPT = '请输入玩家名称';

/** 顶部提示。 */
export const FRIEND_TIP_SEND_MAX = '今日赠送次数已用完';
export const FRIEND_TIP_GET_MAX = '今日领取次数已用完';
export const FRIEND_TIP_CANT_SEARCH_SELF = '不能搜索自己';
export const FRIEND_TIP_NOT_FRIEND = '还不是好友，无法私聊';
/**
 * 私聊按钮点不动时的提示 —— **Demo3.8 没有聊天模块**（老端走 `ModelTeam` / 聊天服）。
 *
 * 与「有聊天模块」的区别很重要：老端的私聊按钮**会显示**（`页签=0` 且不在删除模式），
 * 这里 `chatAvailable = false` ⇒ 按钮**根本不显示**（见 `buildFriendRowView` 的 `showChat`）。
 * 所以本条提示只在这行按钮被别处打开时才用得上，留着是为了**不静默**（点不动必须有回音）。
 */
export const FRIEND_TIP_CHAT_MISSING = '聊天功能暂未开放';
/** 搜索框空着就点了搜索。 */
export const FRIEND_TIP_SEARCH_EMPTY = '请输入玩家名称或ID';

/** 请求结果提示（老端 `FW.showTip` 的对应键）。 */
export const FRIEND_TIP_APPLY_OK = '申请成功';
export const FRIEND_TIP_AGREE_OK = '添加成功';
export const FRIEND_TIP_REFUSE_OK = '拒绝成功';
export const FRIEND_TIP_DELETE_OK = '删除成功';
export const FRIEND_TIP_REMOVE_BLACK_OK = '移出黑名单成功';
export const FRIEND_TIP_SEND_OK = '赠送成功';
export const FRIEND_TIP_GET_OK = '领取成功';
export const FRIEND_TIP_AGREE_ONE_KEY_OK = '已同意全部申请';
export const FRIEND_TIP_REFUSE_ONE_KEY_OK = '已拒绝全部申请';
export const FRIEND_TIP_REFRESH_EMPTY = '暂时没有推荐的好友';
export const FRIEND_TIP_REQUEST_FAILED = '操作失败，请稍后再试';
export const FRIEND_TIP_OFFLINE = '网络未连接，操作未生效';

/**
 * 「行文案包」—— `FriendTable.IFriendRowTexts` 需要的 9 条**结构等价**常量。
 *
 * 为什么是常量而不是一个 `buildRowTexts()` 函数：三个页面（主容器 / 申请列表 / 领取体力）
 * 每一次铺行都要它，函数调用没有额外信息量。
 *
 * 为什么不写成 `: IFriendRowTexts`（直接标类型）：那会让本文件 import `FriendTable` ——
 * 依赖方向就成了「文案 → 判定」，而 `FriendTable` 的注释里明确写了它**不引** `FriendTexts`
 * 的 `formatText` 就是为了保住这条单向边。这里靠**结构相等**（同名字段、同类型）满足
 * 类型检查：页面 `rowTexts(): IFriendRowTexts { return FRIEND_ROW_TEXTS; }` 能直接过编译，
 * 两边谁改了字段名，编译当场报错（不会静默少一个文案）。
 */
export const FRIEND_ROW_TEXTS = {
    gift: FRIEND_ROW_BUTTON_TEXT.gift,
    gifted: FRIEND_ROW_BUTTON_TEXT.gifted,
    apply: FRIEND_ROW_BUTTON_TEXT.apply,
    applied: FRIEND_ROW_BUTTON_TEXT.applied,
    remove: FRIEND_ROW_BUTTON_TEXT.remove,
    take: FRIEND_ROW_GET_END_TEXT,
    powerPrefix: FRIEND_POWER_PREFIX,
    online: FRIEND_ONLINE_TEXT,
    endNumTemplate: FRIEND_END_NUM_TEMPLATE,
} as const;
