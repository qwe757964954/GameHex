/**
 * 「好友」模块里由代码写进控件的文案 —— 改文案只动这一个文件。来源是老端 FGUI 的
 * `Button title` / `text` 字面量与语言表键。
 *
 * prefab 上静态的那部分（三个弹窗标题、搜索框 prompt、行内「私聊」按钮文案）留在 prefab，
 * 这里不再抄一份：代码不消费的常量改了也不会生效，只会误导。
 *
 * 占位统一用 `{0}`，由 `formatText` 替换（不引老端带框架依赖的 `StringUtil`）。
 */

import { formatPlaceholders } from '../../core/text/Placeholder';

/** `{0}` / `{1}` 顺序替换；缺参保留原样（便于一眼看出漏传）。 */
export function formatText(template: string, ...args: readonly (string | number)[]): string {
    return formatPlaceholders(template, args, { missing: 'keep', nullish: 'keep' });
}

/** 三个页签的标题（顺序 = `FRIEND_TAB_KEYS` 的顺序）。 */
export const FRIEND_TAB_LABELS: readonly string[] = ['好友列表', '添加好友', '黑名单'];

/** 主容器底部 / 右上角的按钮文案（FGUI `Button title` 原值；v2 右上角改为「管理」）。 */
export const FRIEND_BTN_REMOVE_MODE = '管理';
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

/** 计数类文案（老端 `FRIEND_NUM` / `BLACK_LIST`；v2 只保留数字，前缀在 prefab 静态标签上）。 */
export const FRIEND_COUNT_TEMPLATE = '{0}/{1}';
export const FRIEND_BLACK_COUNT_TEMPLATE = '{0}/{1}';

/** 剩余次数（老端 `FRIEND_SEND_END_TIMES` / `FRIEND_GET_END_TIMES`；v2 只保留数字）。 */
export const FRIEND_SEND_TIMES_TEMPLATE = '{0} 次';
export const FRIEND_GET_END_TIMES_TEMPLATE = '今日还可领取{0}次';

/** 批量删除的人数提示（老端 `FRIEND_REMOVE_SELECT_TEXT`）。 */
export const FRIEND_REMOVE_SELECT_TEMPLATE = '已选择 {0} 人';

/** v2 区块标签行的标题 / 人数。 */
export const FRIEND_TAG_LIST = '好友列表';
export const FRIEND_TAG_ADD = '推荐好友';
export const FRIEND_TAG_BLACK = '黑名单';
export const FRIEND_TAG_REMOVE = '批量删除';
export const FRIEND_TAG_COUNT_TEMPLATE = '{0} 人';

/** 战力前缀（老端 `COMBAT_POWER_TEXT`）与在线标（`ONLINE_TEXT`）。 */
export const FRIEND_POWER_PREFIX = '战力：';
export const FRIEND_ONLINE_TEXT = '在线';

/** 领取行的体力数（老端 `GIFT_NUM`）。 */
export const FRIEND_END_NUM_TEMPLATE = '体力数:{0}';
/** 行的主按钮（领取体力弹窗的行）。 */
const FRIEND_ROW_GET_END_TEXT = '领取';

/** 顶部提示。 */
export const FRIEND_TIP_SEND_MAX = '今日赠送次数已用完';
export const FRIEND_TIP_GET_MAX = '今日领取次数已用完';
export const FRIEND_TIP_CANT_SEARCH_SELF = '不能搜索自己';
export const FRIEND_TIP_NOT_FRIEND = '还不是好友，无法私聊';
/**
 * 私聊点不动时的提示。Demo3.8 没有聊天模块，`chatAvailable = false` ⇒ 私聊按钮根本不显示
 * （见 `buildFriendRowView` 的 `showChat`），这条只在这行按钮被别处打开时才用得上 ——
 * 留着是为了点不动也有回音，不静默。
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
 * 行文案包 —— `FriendTable.IFriendRowTexts` 需要的 9 条。
 *
 * 不写成 `: IFriendRowTexts`：那会让本文件 import `FriendTable`，依赖方向就成了「文案 → 判定」，
 * 而 `FriendTable` 刻意不引 `FriendTexts` 正是为了保住这条单向边。这里靠结构相等满足类型检查，
 * 谁改了字段名，编译当场报错，不会静默少一条文案。
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
