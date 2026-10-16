/**
 * 「邮件」模块的判定口径 —— **零 import 的纯函数**（只依赖 `RequestGuard` 的两个转换工具，
 * 不引 `cc`、不引 `MailArt`、不引 `MailTexts`）⇒ 可被 `tsx --test` 直接单测。
 *
 * ⚠️ 本文件**不许出现任何文案字面量**（含四档相对时间模板）：`mailTimeText` 收
 *    `IMailRowViewTexts`，模板由 `MailTexts` 经页面传进来 —— 否则「改文案只动 `MailTexts`」
 *    这条约定会在邮件模块静默失效。
 *
 * ## 老端对照（`client/.../model/mail/ModelMail.ts` + `Xiulian/LayerMail.ts`）
 *
 * | 口径 | 老端 | 本文件 |
 * |---|---|---|
 * | 排序 | `up = !take \|\| !read` 置顶，同组按 `sendTime` **降序** | `sortMails` |
 * | 一键领取收集 | `!cmd.take` 的 id | `pickTakeIds` |
 * | 一键删除收集 | `read + take == 0`（已读且已领）的 id | `pickDeletableIds` |
 * | 行状态 | `setSelectedIndex("状态", take ? 2 : read ? 1 : 0)` | `mailStateOf` |
 * | 时间 | `TimeUtil.timeSec2HMSStr15` | `mailTimeText` |
 *
 * ## ⚠️ 布尔字段不能用 `toIdString`
 *
 * `toIdString` 只认 `string` / `number` / `Long` 形状，`boolean` 会落到它最后那句
 * `return ''` 上 —— 也就是说 `toIdString(true) === ''`。本模块的 `read` / `take`
 * 恰好是 `CmdMailSimple` 上的 **boolean**，一旦图省事拿 `toIdString` 去拼「指纹 / 键」就会
 * 得到空串（静默、不报错；友模块轮已经栽过一次）。这里**显式**用 `=== true` 归一。
 */

import { toCount, toIdString } from '../net/RequestGuard';

/** 一封邮件的展示行（全部字段已归一：`id` 是十进制字符串、时间为毫秒）。 */
export interface IMailRow {
    /** `CmdMailSimple.id`（`Long`）⇒ 十进制字符串。 */
    readonly id: string;
    readonly read: boolean;
    readonly take: boolean;
    /** 发送时间（毫秒；老端是秒，这里统一乘 1000）。 */
    readonly sendTime: number;
    readonly title: string;
}

/** 行状态 —— 对应 FGUI `组件_邮件_主界面Item` 的 `controller 状态` 三页。 */
export const MAIL_STATE_UNREAD = 0;
export const MAIL_STATE_READ = 1;
export const MAIL_STATE_TAKEN = 2;

/** `gameConfig` 表里两个键（FGUI 文案的 `{day}` / `{count}` 占位来源）。 */
export const MAIL_CONFIG_MAX_NUM = 'maxMailNum';
export const MAIL_CONFIG_VALID_DAYS = 'mailValid';
/** 表读不到时的兜底（与 `gameConfig` 现值一致：50 封 / 40 天）。 */
export const MAIL_MAX_NUM_DEFAULT = 50;
export const MAIL_VALID_DAYS_DEFAULT = 40;

export interface IMailConfig {
    /** 邮件数量上限（`maxMailNum`）。 */
    readonly maxNum: number;
    /** 未领取邮件的保留天数（`mailValid`）。 */
    readonly validDays: number;
}

/** 一条奖励（`CmdGoods` 归一：`resId` 数字、`number` 数字、`quality` 数字）。 */
export interface IMailReward {
    readonly resId: number;
    readonly number: number;
    readonly quality: number;
}

/** 归一后的邮件详情（`CmdMail`；`id` 同样是十进制字符串）。 */
export interface IMailDetail {
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly read: boolean;
    readonly take: boolean;
    readonly sendTime: number;
    readonly rewards: readonly IMailReward[];
}

// ============================================================
// 归一
// ============================================================

/** 一条 `CmdMailSimple` → `IMailRow`；没有合法 id 返回 `null`（不抛）。 */
export function normalizeMailRow(raw: unknown): IMailRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const id = toIdString(cmd.id);
    if (!id) return null;
    return {
        id,
        // ⚠️ boolean 字段显式判等（见文件头：`toIdString(true)` 是空串）
        read: cmd.read === true,
        take: cmd.take === true,
        // `sendTime` 是 Long（秒）⇒ 毫秒。`toCount` 对数/字符串/Long 都认。
        sendTime: toCount(cmd.sendTime) * 1000,
        title: typeof cmd.title === 'string' ? cmd.title : '',
    };
}

/** `tlCmdMailSimple` → `IMailRow[]`；丢 null、丢重复 id。 */
export function normalizeMailRows(raw: readonly unknown[] | null | undefined): IMailRow[] {
    const out: IMailRow[] = [];
    const seen = new Set<string>();
    for (const item of raw ?? []) {
        const row = normalizeMailRow(item);
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
    }
    return out;
}

/**
 * 老端排序口径（逐字对照 `ModelMail.UpdateMailList`）：
 * ```
 * let up1 = !n1.take || !n1.read, up2 = !n2.take || !n2.read
 * if (up1 != up2) return up1 ? -1 : 1        // 有未领 / 未读的置顶
 * return n2.sendTime - n1.sendTime           // 同组：新的在前
 * ```
 * 用 `Array.from` 复制再排（不改入参；`[...x]` 在本工程会被 Babel 降级成 `[].concat`，禁用）。
 */
export function sortMails(rows: readonly IMailRow[]): IMailRow[] {
    const out = Array.from(rows);
    out.sort((n1, n2) => {
        const up1 = !n1.take || !n1.read;
        const up2 = !n2.take || !n2.read;
        if (up1 !== up2) return up1 ? -1 : 1;
        return n2.sendTime - n1.sendTime;
    });
    return out;
}

/** 一键领取要发的 id：`!take`（老端 `if (!cmd.take) tlIds.push(cmd.id)`）。 */
export function pickTakeIds(rows: readonly IMailRow[]): string[] {
    const out: string[] = [];
    for (const row of rows) {
        if (!row.take && row.id) out.push(row.id);
    }
    return out;
}

/**
 * 一键删除要发的 id：**已读且已领**（`read + take == 0`，老端的 `read` / `take` 是「未读 / 未领」的 1/0）。
 * 空数组 ⇒ 调用方给提示，不发请求（老端 `FW.showTip(MAIL_NO_DELETABLE)`）。
 */
export function pickDeletableIds(rows: readonly IMailRow[]): string[] {
    const out: string[] = [];
    for (const row of rows) {
        if (row.read && row.take && row.id) out.push(row.id);
    }
    return out;
}

/** 行状态（FGUI `状态` 的三页）：0 未读 / 1 已读 / 2 已领取。 */
export function mailStateOf(row: Pick<IMailRow, 'read' | 'take'>): number {
    if (row.take) return MAIL_STATE_TAKEN;
    return row.read ? MAIL_STATE_READ : MAIL_STATE_UNREAD;
}

// ============================================================
// 时间（老端 `TimeUtil.timeSec2HMSStr15`）
// ============================================================

/**
 * 该时间所在日的次日 0 点（毫秒）。
 *
 * ⚠️ 老端函数名写作 `getNextDay12`，但**实现出来是「次日 0 点」不是中午 12 点**
 *   （`time_left.hour = 24 - h - 1` + `60 - m - 1` 分 + `60 - s` 秒 ⇒ 正好补到次日 00:00:00）。
 *   这里按**实测语义**实现，不按名字。
 */
export function nextDayStart(ms: number): number {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime() + 86400000;
}

/** 该时间所在日的 0 点（毫秒）。 */
export function dayStart(ms: number): number {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * 相对时间文案的四个模板 + 行状态文本 —— 全部由调用方（`MailPage`）从 `MailTexts` 取。
 * 本文件只做「算哪一档、数值多少」，一个中文字面量都不留（文件头那条约定）。
 */
export interface IMailRowViewTexts {
    /** 「已读」（FGUI `状态` 的 `gearText`）。 */
    readonly readText: string;
    /** `{0}天前`。 */
    readonly timeDays: string;
    /** `{0}小时前`。 */
    readonly timeHours: string;
    /** `{0}分钟前`。 */
    readonly timeMinutes: string;
    /** `刚刚`。 */
    readonly timeJustNow: string;
}

/** `{0}` 顺序替换（与 `MailTexts.formatText` 同口径；本文件不 import 它）。 */
function fillTimeText(template: string, value: number): string {
    return typeof template === 'string' ? template.replace(/\{0\}/g, String(value)) : '';
}

/**
 * 相对时间文案：`{0}天前` / `{0}小时前` / `{0}分钟前` / `刚刚`（四档，与老端同）。
 *
 * 老端的两分支基准：
 * ```
 * let nt = getNextDay12(sendTime)         // 次日 0 点
 * if (now > nt) sendTime = getDayHourTime(sendTime, 0)   // 跨天了 ⇒ 按当天 0 点算
 * time = now - sendTime
 * ```
 * 即「**跨过次日后按天算**」—— 所以昨天 23:00 的邮件在今天 00:10 看到是「1天前」。
 *
 * ⚠️ `days` 用**总小时数**除 24（老端 `TimeUtil.timeSec2HMS` 的 `h = floor(time/3600)`
 *   是**总**小时，不是 24 进制的小时位）⇒ 3 天前的 12:00 在 10:00 看到是「3天前」
 *   （82 小时 / 24 = 3），不是「2天前」。这一档容易按直觉写错，`tests/mail.test.ts` A10 钉住。
 */
export function mailTimeText(sendTimeMs: number, nowMs: number, texts: IMailRowViewTexts): string {
    if (!texts) return '';
    if (!Number.isFinite(sendTimeMs) || sendTimeMs <= 0) return '';
    if (!Number.isFinite(nowMs) || nowMs <= 0) return '';
    const base = nowMs > nextDayStart(sendTimeMs) ? dayStart(sendTimeMs) : sendTimeMs;
    const diff = Math.max(0, nowMs - base);
    const totalHours = Math.floor(diff / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) return fillTimeText(texts.timeDays, days);
    if (hours > 0) return fillTimeText(texts.timeHours, hours);
    const minutes = Math.floor(diff / 60000);
    if (minutes > 0) return fillTimeText(texts.timeMinutes, minutes);
    return texts.timeJustNow;
}

// ============================================================
// 配置 / 文案
// ============================================================

/** 读 `gameConfig` 的两个键；表缺失 / 值非法时用兜底值（50 / 40）。 */
export function parseMailConfig(rows: readonly unknown[] | null | undefined): IMailConfig {
    let maxNum = MAIL_MAX_NUM_DEFAULT;
    let validDays = MAIL_VALID_DAYS_DEFAULT;
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const key = typeof row.key === 'string' ? row.key : '';
        const value = toCount(row.value);
        if (key === MAIL_CONFIG_MAX_NUM && value > 0) maxNum = value;
        else if (key === MAIL_CONFIG_VALID_DAYS && value > 0) validDays = value;
    }
    return { maxNum, validDays };
}

/**
 * 自动删除提示的两个数（`{0}` 天 / `{1}` 封）。
 * 抽成函数是为了让 `MailTexts` 只放模板、本文件只放口径，页面拼装时一眼能看出哪个是哪个。
 */
export function autoDeleteArgs(config: IMailConfig): readonly [number, number] {
    return [config.validDays, config.maxNum];
}

// ============================================================
// 详情：正文与奖励
// ============================================================

/** 正文是不是「长文本」——老端按 `<br/>` 切分，切出多于一段就走滚动列表。 */
export function isLongText(content: string): boolean {
    return typeof content === 'string' && content.split('<br/>').length > 1;
}

/** 长文本切分（老端 `content.split("<br/>")`）；空串给空数组。 */
export function splitMailLines(content: string): string[] {
    if (typeof content !== 'string' || content.length === 0) return [];
    return content.split('<br/>');
}

/**
 * FGUI 详情页 `列表_奖励列表` 预摆的 item 数（8）。
 *
 * ⚠️ 它**不是**「只能显示 8 个」——老端 `LayerMailVerbose.InitList()` 用的是
 * `initVirtualList`，格数跟着数据走。新端同理（横向 `VirtualScrollView`），
 * 这里只用来在超出时给一条告警（`MailDetailPage.present`），与活动模块同口径。
 */
export const MAIL_REWARD_SLOT_COUNT = 8;

/**
 * 奖励列表容器的四个口径（FGUI `列表_奖励列表`：`xy=102,775 size=515,100`
 * `layout="row" colGap="10" align="center" vAlign="middle" overflow="scroll"`）。
 *
 * 🔴 **`align="center"` 只在「内容装得下」时生效** —— FGUI `GList.handleAlign` 源码：
 * ```js
 * if (contentWidth < this.viewWidth) {
 *     if (this._align == AlignType.Center) newOffsetX = Math.floor((this.viewWidth - contentWidth) / 2);
 *     ...
 * }
 * ```
 * 超宽时 `newOffsetX` 恒为 `0`（内容从容器左边排起，不做负向偏移）。所以 5 格（490 ≤ 515）
 * 居中、**1 格居中偏 212px**、6 格起（590 > 515）从左边排起 —— 这一档差得很明显。
 *
 * 2026-09-29 起这条口径**由组件承接**（`VirtualScrollView.autoCenter`：同一公式
 * `(视口−内容)/2`、同样只在小内容时生效），宿主不再逐格写坐标；这四个数就是 prefab 上
 * `RewardList` / item 模板必须落到的值（`tests/mail.test.ts` C4 逐个核）。
 */
export const MAIL_REWARD_LIST_WIDTH = 515;
export const MAIL_REWARD_LIST_HEIGHT = 100;
export const MAIL_REWARD_SLOT_SIZE = 90;
export const MAIL_REWARD_SLOT_GAP = 10;

/**
 * 详情正文框的两个高度（FGUI `文本_内容` 的 `gearSize controller="奖励领取"`）：
 * `奖励领取=1`（有奖励）→ 400，`default`（无奖励）→ 580。
 * prefab 里固定写 400，无奖励时由 `MailDetailPage.applyContentHeight` 拉到 580。
 */
export const MAIL_CONTENT_HEIGHT_WITH_REWARD = 400;
export const MAIL_CONTENT_HEIGHT_NO_REWARD = 580;

/**
 * 短文本的展示正文：把 `<br/>` 换成换行（老端短文本分支直接 `setText(content)`，
 * 但 FGUI 的 `richtext` 认 `<br/>` 为换行，普通 Label 不认 ⇒ 必须换掉）。
 */
export function plainMailContent(content: string): string {
    return typeof content === 'string' ? content.split('<br/>').join('\n') : '';
}

/** `CmdGoodsList.tlCmdGoods` → 奖励数组（`number` 是**字符串**的 Long ⇒ `toCount`）。 */
export function mailRewardsOf(cmdGoodsList: unknown): IMailReward[] {
    if (!cmdGoodsList || typeof cmdGoodsList !== 'object') return [];
    const list = (cmdGoodsList as Record<string, unknown>).tlCmdGoods;
    if (!Array.isArray(list)) return [];
    const out: IMailReward[] = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const goods = raw as Record<string, unknown>;
        const resId = toCount(goods.resId);
        if (resId <= 0) continue;
        out.push({
            resId,
            number: toCount(goods.number),
            quality: toCount(goods.quality),
        });
    }
    return out;
}

/** `CmdGoods[]` → 奖励数组（`CmdMailTakeRewardRspMsg.tlReward` 是**裸数组**，不是 `CmdGoodsList`）。 */
export function mailRewardsOfArray(raw: readonly unknown[] | null | undefined): IMailReward[] {
    const out: IMailReward[] = [];
    for (const item of raw ?? []) {
        if (!item || typeof item !== 'object') continue;
        const goods = item as Record<string, unknown>;
        const resId = toCount(goods.resId);
        if (resId <= 0) continue;
        out.push({ resId, number: toCount(goods.number), quality: toCount(goods.quality) });
    }
    return out;
}

/** `CmdMail` → `IMailDetail`；没有合法 id 返回 `null`。 */
export function normalizeMailDetail(raw: unknown): IMailDetail | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as Record<string, unknown>;
    const id = toIdString(cmd.id);
    if (!id) return null;
    return {
        id,
        title: typeof cmd.title === 'string' ? cmd.title : '',
        content: typeof cmd.content === 'string' ? cmd.content : '',
        read: cmd.read === true,
        take: cmd.take === true,
        sendTime: toCount(cmd.sendTime) * 1000,
        rewards: mailRewardsOf(cmd.cmdGoodsList),
    };
}

/** 详情页按钮文案的判据：已领取 ⇒ 显示「删除」，否则「领取」（FGUI `gearText 是否领取` 两页）。 */
export function detailButtonText(take: boolean, takeText: string, deleteText: string): string {
    return take ? deleteText : takeText;
}

// ============================================================
// 行视图
// ============================================================

/** `MailRow.render()` 需要的全部展示信息（与 `IMailRow` 分开：视图不该看见 `read` / `take` 原字段）。 */
export interface IMailRowView {
    readonly id: string;
    readonly title: string;
    readonly timeText: string;
    /** 0 未读 / 1 已读 / 2 已领取（`MailRow` 据此换行底图、切两处显隐）。 */
    readonly state: number;
    /** 右侧状态文本（未读 / 已领取时为空串）。 */
    readonly stateText: string;
}

/**
 * `IMailRow` → `IMailRowView`。
 *
 * 三态与 FGUI 的 `gearDisplay` / `gearText` 一一对应：
 * | state | 底图 | `状态` 文本 | `n26` 印章 |
 * |---|---|---|---|
 * | 0 未读 | `frame_Zhikuang06` | 隐藏 | 隐藏 |
 * | 1 已读 | `frame_Zhikuang06_b` | 「已读」 | 隐藏 |
 * | 2 已领取 | `frame_Zhikuang06_b` | 隐藏（gearText 改的那一支被 gearDisplay 挡掉） | 显示 |
 *
 * 底图与「哪一态显示文本 / 印章」由 `MailArt` 按 `state` 出（`MailRow` 消费）——
 * 本文件不引 `MailArt`，所以这里只给 `state`，不复述一遍那张表。
 */
export function buildMailRowView(
    row: IMailRow,
    texts: IMailRowViewTexts,
    nowMs: number,
): IMailRowView {
    const state = mailStateOf(row);
    return {
        id: row.id,
        // 视图边界再兜一次：`Label.string = undefined` 会把这个字面量印到界面上
        title: typeof row.title === 'string' ? row.title : '',
        timeText: mailTimeText(row.sendTime, nowMs, texts),
        state,
        stateText: state === MAIL_STATE_READ ? texts.readText : '',
    };
}
