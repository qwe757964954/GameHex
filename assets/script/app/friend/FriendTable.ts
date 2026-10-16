/**
 * 「好友」的判定口径 —— **纯函数**，Node 单测可直接 import。
 *
 * 与老端的对应关系：
 *   `ModelFriend.getLeftSendTimes / getLeftGetTimes / canGetEnd / getGetEndList / isApplied`
 *   `LayerFriend.renderListItem / refreshView / onClickSearch` 里的全部分支
 *
 * 分工（对齐 `GiftTable` / `SevenDayTable`）：
 *   本文件只做「数据 → 语义」；文案在 `FriendTexts`、资源路径在 `FriendArt`。
 *   判定与文案 / 美术解耦，改文案不会动判定，判定也能脱离引擎跑单测。
 *
 * ⚠️ **依赖只有一个**：`../net/RequestGuard` 的 `toIdString` / `toCount`。
 *    那份文件自身 **零 import**（不碰 `cc`），所以本文件仍能在 Node 里独立跑 ——
 *    `CmdFriend.friendId / img / power` 都是 protobuf 的 `Long`，归一化必须有人做，
 *    放在这里（纯函数）比放 Repository（会拖进 `RefUtil` → `cc`）更好测。
 */
import { toCount, toIdString } from '../net/RequestGuard';


/** 三个页签。数值直接等于 FGUI `页签` controller 的 index，也等于老端 `LayerFriend.selectIndex`。 */
export enum FriendTab {
    list = 0,
    add = 1,
    black = 2,
}

/** 页签的稳定 key —— 文案查 `FriendTexts.FRIEND_TAB_LABELS`，不要在这里写中文。 */
export const FRIEND_TAB_KEYS: readonly string[] = ['list', 'add', 'black'];

/** 页签数（prefab 里必须正好这么多页签按钮，单测比对）。 */
export const FRIEND_TAB_COUNT = FRIEND_TAB_KEYS.length;

/**
 * 一行好友（归一化后的视图模型）。
 *
 * 三个页签共用它：好友列表读 `todaySend`、黑名单只用身份字段、
 * 「添加好友」页签把推荐 / 搜到的陌生人塞进来（此时三个 today* 都是 `false`）。
 */
export interface IFriendRow {
    /** `friendId`（`Long` → 十进制字符串）。翻页 / 复用节点后只能靠它认行。 */
    readonly id: string;
    readonly name: string;
    readonly level: number;
    /** 战力（`Long` → 十进制字符串，界面直接拼文案）。 */
    readonly power: string;
    /** 头像 id（`CmdFriend.img`，`Long` → 字符串；空串 = 无头像，只留框）。 */
    readonly avatarId: string;
    /** 是否在线（`CmdFriend.online`）。 */
    readonly online: boolean;
    /** 最后离线时间（毫秒）。`online` 为真时不使用。 */
    readonly lastOfflineMs: number;
    /** 今日已赠送体力。 */
    readonly todaySend: boolean;
    /** 今日**收到**了对方的体力（可领取）。 */
    readonly todayReceive: boolean;
    /** 今日已领取过。 */
    readonly todayTake: boolean;
}

/** 行右侧主按钮的语义。文案查 `FriendTexts.FRIEND_ROW_BUTTON_TEXT`。 */
export type FriendRowButtonKey = 'gift' | 'gifted' | 'apply' | 'applied' | 'remove';

export interface IFriendRowButton {
    readonly key: FriendRowButtonKey;
    /** `true` ⇒ 按钮置灰（`cc.Button.interactable = false` + 灰底图）。 */
    readonly gray: boolean;
}

/** 剩余次数 = `max(0, max - used)`。老端两个 getLeftXxxTimes 是同一形状。 */
export function leftTimes(maxTimes: number, usedTimes: number): number {
    const max = Number.isFinite(maxTimes) ? maxTimes : 0;
    const used = Number.isFinite(usedTimes) ? usedTimes : 0;
    const rest = max - used;
    return rest > 0 ? rest : 0;
}

/** 今日已赠送次数 / 剩余次数 → 文案用的两个数，都由本函数统一取整口径。 */
export function sendTimesOf(maxTimes: number, usedTimes: number): { readonly left: number; readonly max: number } {
    return { left: leftTimes(maxTimes, usedTimes), max: Number.isFinite(maxTimes) ? maxTimes : 0 };
}

/** 「好友列表」页签按 `todaySend` 决定按钮：未赠送可点、已赠送置灰。 */
export function friendRowButton(row: IFriendRow): IFriendRowButton {
    return row.todaySend ? { key: 'gifted', gray: true } : { key: 'gift', gray: false };
}

/** 「添加好友」页签按「是否已申请过」决定按钮。 */
export function applyRowButton(applied: boolean): IFriendRowButton {
    return applied ? { key: 'applied', gray: true } : { key: 'apply', gray: false };
}

/** 「黑名单」页签的按钮永远是「移除」。 */
export function blackRowButton(): IFriendRowButton {
    return { key: 'remove', gray: false };
}

/** 按页签取主按钮语义（把上面三个收成一个入口，页面不必自己 switch）。 */
export function rowButtonOf(tab: FriendTab, row: IFriendRow, applied: boolean): IFriendRowButton {
    if (tab === FriendTab.add) return applyRowButton(applied);
    if (tab === FriendTab.black) return blackRowButton();
    return friendRowButton(row);
}

/**
 * 「好友列表」页签的按钮是否可点。
 *
 * ⚠️ 与 `friendRowButton().gray` **不是一回事**：已赠送会置灰，但**次数用完**时
 * 未赠送的那些也不可点（老端 `onItemBtnClick` 第一句就是这个判断，只弹提示不置灰）。
 * 页面用这个决定「点不点得动」，用 `gray` 决定「灰不灰」。
 */
export function canSendMore(leftSendTimes: number): boolean {
    return leftSendTimes > 0;
}

/** 今日可领取的好友（`todayReceive && !todayTake`）—— 老端 `ModelFriend.getGetEndList()`。 */
export function pickGetEndRows(rows: readonly IFriendRow[]): IFriendRow[] {
    const out: IFriendRow[] = [];
    for (const row of rows) {
        if (row && row.todayReceive && !row.todayTake) out.push(row);
    }
    return out;
}

/**
 * 「领取体力」按钮是否该亮红点 —— 老端 `ModelFriend.canGetEnd()`：
 * **有可领的人**（`canTake > 0`）**且**今日领取次数没满（`taked < maxTake`）。
 * 只有前者会让次数用完后红点还在；只有后者会让红点该亮时不亮。
 */
export function canGetEnd(rows: readonly IFriendRow[], maxTakeTimes: number): boolean {
    let canTake = 0;
    let taken = 0;
    for (const row of rows) {
        if (!row || !row.todayReceive) continue;
        if (row.todayTake) taken += 1;
        else canTake += 1;
    }
    return canTake > 0 && taken < maxTakeTimes;
}

/** 今日已领取数量（页面用它算「剩余次数」，与老端 `ModelRole.GetTakeEndCount()` 同口径）。 */
export function takenCount(rows: readonly IFriendRow[]): number {
    let taken = 0;
    for (const row of rows) {
        if (row && row.todayReceive && row.todayTake) taken += 1;
    }
    return taken;
}

/** 已赠送数量（对应老端 `ModelRole.GetSendEndCount()` 的本地推算口径）。 */
export function sentCount(rows: readonly IFriendRow[]): number {
    let sent = 0;
    for (const row of rows) {
        if (row && row.todaySend) sent += 1;
    }
    return sent;
}

/** 计数类文案的「当前/上限」—— 好友数与黑名单数共用。 */
export function countOfMax(current: number, max: number): { readonly current: number; readonly max: number } {
    const safeCurrent = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
    const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
    return { current: safeCurrent, max: safeMax };
}

/** 秒 → 「x天x小时 / x小时x分 / x分」；用于「最后在线」文案。 */
export function formatDuration(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    if (total >= 86400) {
        const days = Math.floor(total / 86400);
        const hours = Math.floor((total % 86400) / 3600);
        return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
    }
    if (total >= 3600) {
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
    }
    if (total >= 60) return `${Math.floor(total / 60)}分`;
    return `${total}秒`;
}

/**
 * 「最后在线」列的文案语义。
 *
 * 在线时是固定文案（`FriendTexts.FRIEND_ONLINE_TEXT`），离线时是时长 ——
 * 页面拿这个结果去查 / 拼文案，本函数不产生中文字面量。
 */
export type FriendOnlineText =
    | { readonly kind: 'online' }
    | { readonly kind: 'offline'; readonly text: string };

export function onlineTextOf(row: IFriendRow, nowMs: number): FriendOnlineText {
    if (row.online) return { kind: 'online' };
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const gap = now - row.lastOfflineMs;
    // 服务端时间没下来（`lastOfflineTime = 0`）时不要显示「1970 年到现在」
    if (!Number.isFinite(gap) || row.lastOfflineMs <= 0 || gap < 0) {
        return { kind: 'offline', text: '' };
    }
    return { kind: 'offline', text: formatDuration(gap / 1000) };
}

/** 搜索框输入 → 请求参数。 */
export type SearchParse =
    | { readonly kind: 'id'; readonly id: number }
    | { readonly kind: 'name'; readonly name: string }
    | { readonly kind: 'empty' }
    | { readonly kind: 'self' };

/**
 * 解析搜索框文本 —— 对齐老端 `LayerFriend.onClickSearch`：
 *   纯数字 ⇒ 按 roleId 搜（`targetName` 传空串）；否则按名字搜（`targetId` 传 0）。
 *   搜自己直接返回 `self`（老端当场弹提示、不发请求）。
 */
export function parseSearch(text: string, selfId: string, selfName: string): SearchParse {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value) return { kind: 'empty' };
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && String(asNumber) === value) {
        if (selfId && String(asNumber) === selfId) return { kind: 'self' };
        return { kind: 'id', id: asNumber };
    }
    if (selfName && value === selfName) return { kind: 'self' };
    return { kind: 'name', name: value };
}

/**
 * 列表页签要显示哪些行（三个页签的数据来源不同）。
 *
 * ⚠️ 「添加好友」页签的数据是**请求回来的**（推荐 / 搜索），不在 `CacheMgr` 里 ——
 * 老端也一样（`ModelFriend.suggestList` 是内存数组）。所以这里由页面按页签取好数组再传进来，
 * 本函数只负责「哪个页签对应哪一份」这件事，避免页面里散落 switch。
 */
export function rowsOfTab(tab: FriendTab, source: {
    readonly friendRows: readonly IFriendRow[];
    readonly suggestRows: readonly IFriendRow[];
    readonly blackRows: readonly IFriendRow[];
}): readonly IFriendRow[] {
    if (tab === FriendTab.add) return source.suggestRows;
    if (tab === FriendTab.black) return source.blackRows;
    return source.friendRows;
}

/**
 * 顶部「今日还可赠送 N 次」/「今日还可领取 N 次」的数值。
 * 老端用的是 `ModelRole.GetSendEndCount()/GetTakeEndCount()`（服务端计数字段）；
 * Demo3.8 没有 `ModelRole`，用**同名字段**（见 `IFriendCounters`）；
 * 字段缺失时才退回「列表里 today* 的统计」（`sentCount/takenCount`）。
 */
export function usedTimesOf(tab: FriendTab, rows: readonly IFriendRow[]): number {
    return tab === FriendTab.list ? sentCount(rows) : takenCount(rows);
}

// ============================================================
// 协议对象（`CmdFriend*`）→ 视图模型
// ============================================================

/**
 * 服务端 `CmdFriend` / `CmdFriendApply` / `CmdFriendBlack` 的**宽松形状**。
 *
 * 三个结构的前 9 个字段完全一样（见 `Cmd.d.ts` 3741/3766/3786 行），
 * 「好友」比另两个多 `online / lastOfflineTime / todaySend / todayReceive / todayTake`。
 * 这里一律用 `unknown` 接：真实运行时是 protobuf 的 `Long` / `number` / `boolean`，
 * 归一化交给 `toIdString` / `toCount`，**不在这里做类型假设**（`Long` 是对象不是 number）。
 */
export interface IFriendRaw {
    readonly friendId?: unknown;
    readonly name?: unknown;
    readonly level?: unknown;
    readonly power?: unknown;
    readonly img?: unknown;
    readonly headFrame?: unknown;
    readonly serverId?: unknown;
    readonly selectServerId?: unknown;
    readonly online?: unknown;
    readonly lastOfflineTime?: unknown;
    readonly todaySend?: unknown;
    readonly todayReceive?: unknown;
    readonly todayTake?: unknown;
}

/** `friendId` 认不出来（空串）时返回 `null` —— 认不出身份的行**不能进列表**（复用时会串行）。 */
export function normalizeFriendRow(raw: unknown): IFriendRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const cmd = raw as IFriendRaw;
    const id = toIdString(cmd.friendId);
    if (!id) return null;
    return {
        id,
        name: typeof cmd.name === 'string' ? cmd.name : '',
        level: toCount(cmd.level),
        power: toIdString(cmd.power),
        // `img` 是 `Long`（头像 id）；空 = 无头像，只留框（老端 `GetPlayerIcon` 也是这么兜的）
        avatarId: toIdString(cmd.img),
        // ⚠️ `online` 缺省时按**离线**算：老端 `info.online ? 在线 : 时长(...)`，
        //    缺省按离线只会显示一段空时长，按在线会撒一个假的「在线」标。
        online: cmd.online === true,
        lastOfflineMs: toCount(cmd.lastOfflineTime),
        todaySend: cmd.todaySend === true,
        todayReceive: cmd.todayReceive === true,
        todayTake: cmd.todayTake === true,
    };
}

/** 批量归一化（**跳过**认不出身份的项；不抛）。 */
export function normalizeFriendRows(list: readonly unknown[]): IFriendRow[] {
    const out: IFriendRow[] = [];
    if (!Array.isArray(list)) return out;
    for (const raw of list) {
        const row = normalizeFriendRow(raw);
        if (row) out.push(row);
    }
    return out;
}

/**
 * 指纹里的**布尔字段**片段。
 *
 * ⚠️ 不能直接把 boolean 丢给 `toIdString` —— 它只认 `string` / `number` / `Long` 形状，
 *    `boolean` 落在最后 `return ''` 上 ⇒ `online` / `todaySend` / `todayReceive` / `todayTake`
 *    这四个字段**在指纹里全部被抹成空串** ⇒ 服务端推了「今日已赠送」的新数据、指纹却不变
 *    ⇒ `pickPatchedCmd` 继续用旧补丁盖着，界面永远停在领奖前的状态（**不报错**）。
 *
 * `false` 与 `0` 都归成 `'0'`、`true` 与 `1` 都归成 `'1'`：服务端给数字或布尔都算同一个值，
 * 只有「真的变了」才让指纹变。
 */
function flagOf(value: unknown): string {
    if (value === true) return '1';
    if (value === false) return '0';
    return toIdString(value);
}

/**
 * 一条 `CmdFriend` 的**指纹** —— 用来判断「本地补丁还该不该留着」。
 *
 * 起因：`CmdFriendGetEnd*` / `CmdFriendSendEndOneKey` 这类请求**没有携带数据的推送**
 * （`Cmd.d.ts` 里 `…GetEndBroMsg` 根本不存在、`CmdFriendSendEndOneKeyBroMsg` 是空消息），
 * 唯一的数据来源就是 Rsp 里那个 `friend` / `friendList`。
 * 老端把 Rsp 直接 `VOBag.UpdateFriend(rsp.friend)` 落地；Demo3.8 的 `GameCache` 只由
 * 服务端 `CmdCache` 推送写入（`GameCacheMgr.handleCache`），**没有公开的 upsert 接口**
 * ⇒ 只能在 Repository 里存一层「本地补丁」。
 *
 * 留着补丁的风险是「明天服务端重置了今日次数，界面还拿旧补丁覆盖」。
 * 解法就是本函数：打补丁时记下**当时缓存里那一条**的指纹，`load()` 时若指纹变了
 * （说明服务端推过新数据）就丢补丁、用缓存。
 */
export function friendFingerprint(raw: unknown): string {
    if (!raw || typeof raw !== 'object') return '';
    const cmd = raw as IFriendRaw;
    return [
        toIdString(cmd.friendId),
        toIdString(cmd.name),
        toIdString(cmd.level),
        toIdString(cmd.power),
        toIdString(cmd.img),
        toIdString(cmd.headFrame),
        flagOf(cmd.online),
        toIdString(cmd.lastOfflineTime),
        flagOf(cmd.todaySend),
        flagOf(cmd.todayReceive),
        flagOf(cmd.todayTake),
    ].join('|');
}

/** 本地补丁：Rsp 回带的那条 + 打补丁时**缓存里那一条**的指纹（`''` = 当时缓存里没有）。 */
export interface IFriendPatch {
    readonly cmd: unknown;
    readonly baseFingerprint: string;
}

/**
 * 缓存行 + 本地补丁 → 该用哪一条。
 *
 * | 情况 | 结果 |
 * |---|---|
 * | 没有补丁 | 用缓存行 |
 * | 有补丁、缓存行指纹**没变**（服务端还没推） | 用补丁（`Rsp` 是唯一数据源） |
 * | 有补丁、缓存行指纹**变了**（服务端推过） | 用缓存行，并丢弃补丁 |
 */
export function pickPatchedCmd(
    cacheCmd: unknown,
    patch: IFriendPatch | null | undefined,
): { readonly cmd: unknown; readonly dropPatch: boolean } {
    if (!patch) return { cmd: cacheCmd, dropPatch: false };
    if (friendFingerprint(cacheCmd) === patch.baseFingerprint) {
        return { cmd: patch.cmd, dropPatch: false };
    }
    return { cmd: cacheCmd, dropPatch: true };
}

// ============================================================
// `gameConfig` 配置表
// ============================================================

/**
 * 老端 `ModelFriend` 从 `RefMgrgameConfig` 读的 7 个键（`gameConfig.json` 是 `[{key,value}]`）。
 *
 * | 字段 | `gameConfig.key` | 老端方法 |
 * |---|---|---|
 * | `maxFriends` | `friendMaxCount` | `getFriendMaxNum` |
 * | `maxBlacks` | `friendBlackMaxCount` | `getBlackMaxNum` |
 * | `maxApplies` | `friendApplyMaxCount` | （申请列表上限，老端没直接读） |
 * | `sendEndTimes` | `friendSendEndTimes` | `getLeftSendTimes` 的上限 |
 * | `takeEndTimes` | `friendTakeEndTimes` | `getGetEndMaxNum` / `getLeftGetTimes` 的上限 |
 * | `endPerTime` | `friendAddEndPerTime` | `getAddEndNum` |
 * | `suggestPerPage` | `friendSuggestPerPage` | （推荐每页条数） |
 */
export interface IFriendConfig {
    readonly maxFriends: number;
    readonly maxBlacks: number;
    readonly maxApplies: number;
    readonly sendEndTimes: number;
    readonly takeEndTimes: number;
    readonly endPerTime: number;
    readonly suggestPerPage: number;
}

export const FRIEND_CONFIG_KEYS: Readonly<Record<keyof IFriendConfig, string>> = {
    maxFriends: 'friendMaxCount',
    maxBlacks: 'friendBlackMaxCount',
    maxApplies: 'friendApplyMaxCount',
    sendEndTimes: 'friendSendEndTimes',
    takeEndTimes: 'friendTakeEndTimes',
    endPerTime: 'friendAddEndPerTime',
    suggestPerPage: 'friendSuggestPerPage',
};

/** 读不到表时的兜底：**全 0**。老端每处都是 `… .value || 0`，这里保持同口径。 */
export const FRIEND_CONFIG_DEFAULTS: IFriendConfig = {
    maxFriends: 0,
    maxBlacks: 0,
    maxApplies: 0,
    sendEndTimes: 0,
    takeEndTimes: 0,
    endPerTime: 0,
    suggestPerPage: 0,
};

/** `gameConfig` 行（`[{key, value}]`）→ 配置。缺项取 `FRIEND_CONFIG_DEFAULTS`。 */
export function parseFriendConfig(rows: readonly unknown[]): IFriendConfig {
    const found = new Map<string, unknown>();
    if (Array.isArray(rows)) {
        for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as { key?: unknown; value?: unknown };
            if (typeof row.key === 'string') found.set(row.key, row.value);
        }
    }
    const pick = (field: keyof IFriendConfig): number => {
        const value = found.get(FRIEND_CONFIG_KEYS[field]);
        if (value === undefined || value === null || value === '') return FRIEND_CONFIG_DEFAULTS[field];
        return toCount(value);
    };
    return {
        maxFriends: pick('maxFriends'),
        maxBlacks: pick('maxBlacks'),
        maxApplies: pick('maxApplies'),
        sendEndTimes: pick('sendEndTimes'),
        takeEndTimes: pick('takeEndTimes'),
        endPerTime: pick('endPerTime'),
        suggestPerPage: pick('suggestPerPage'),
    };
}

/**
 * 今日已赠送 / 已领取次数 —— 老端读 `ModelRole.GetSendEndCount()/GetTakeEndCount()`，
 * 对应的就是 `CmdRole.sendFriendEndCount` / `takeFriendEndCount`（`Cmd.d.ts` 2376/2377 行）。
 */
export interface IFriendCounters {
    readonly sent: number;
    readonly taken: number;
}

/** `CmdRole` → 计数（缺字段给 `null`，交给调用方决定要不要退回列表统计口径）。 */
export function readFriendCounters(role: unknown): { readonly sent: number | null; readonly taken: number | null } {
    if (!role || typeof role !== 'object') return { sent: null, taken: null };
    const cmd = role as { sendFriendEndCount?: unknown; takeFriendEndCount?: unknown };
    return {
        sent: cmd.sendFriendEndCount === undefined || cmd.sendFriendEndCount === null ? null : toCount(cmd.sendFriendEndCount),
        taken: cmd.takeFriendEndCount === undefined || cmd.takeFriendEndCount === null ? null : toCount(cmd.takeFriendEndCount),
    };
}

// ============================================================
// 行视图模型（页面只负责往节点上写，判定全在这里）
// ============================================================

/** 行文案包（由页面从 `FriendTexts` 组装后传进来 —— 本文件不出现中文字面量）。 */
export interface IFriendRowTexts {
    readonly gift: string;
    readonly gifted: string;
    readonly apply: string;
    readonly applied: string;
    readonly remove: string;
    readonly take: string;
    readonly powerPrefix: string;
    readonly online: string;
    readonly endNumTemplate: string;
}

/** 一行要铺的全部内容（**每一处都绝对赋值** —— 虚拟列表会 clone 复用）。 */
export interface IFriendRowView {
    readonly id: string;
    readonly name: string;
    readonly level: string;
    readonly powerText: string;
    /** 头像 id；空串 = 无头像（只留框）。 */
    readonly avatarId: string;
    /** 右上角「在线 / 离线多久」，空串 = 不显示。 */
    readonly durationText: string;
    readonly actionText: string;
    readonly actionGray: boolean;
    /** 主按钮是否可点（次数用完 / 已赠送 / 已申请时为 `false`，但仍显示）。 */
    readonly actionEnabled: boolean;
    /** 私聊按钮（仅「好友列表」页签、且不在删除模式）。 */
    readonly showChat: boolean;
    /**
     * 主按钮是否显示。
     *
     * ⚠️ 三个页签里只有「好友列表」在**删除模式**下要把主按钮整块藏掉 ——
     * FGUI `组件_好友项` 的 `btn` 上写着 `gearDisplay controller="展示删除界面" pages="0"`，
     * 就是这条。漏了**不报错**，只是删除模式下「赠送」按钮还在，且和刚冒出来的勾选框挤在一起。
     */
    readonly showAction: boolean;
    /** 勾选框（仅「好友列表」页签、且在删除模式）。 */
    readonly showCheck: boolean;
    readonly checkSelected: boolean;
    /** 右侧「体力数:N」（仅「领取粮草」弹窗的行）。 */
    readonly endNumText: string;
}

/** `buildFriendRowView` 的可选上下文。 */
export interface IFriendRowViewOptions {
    /** `now`（毫秒）；用于算「离线多久」。 */
    readonly nowMs: number;
    /** 是否在「批量删除」模式（只影响好友列表页签）。 */
    readonly deleteMode: boolean;
    /** 该行是否被勾选（只影响好友列表页签）。 */
    readonly checked: boolean;
    /** 「添加好友」页签用：是否已申请过。 */
    readonly applied: boolean;
    /** 「好友列表」页签用：今日剩余赠送次数（`<= 0` 时主按钮不可点）。 */
    readonly leftSendTimes: number;
    /** 是否显示「私聊」（Demo3.8 没有聊天模块，页面传 `false` 会走另一条分支，见页面注释）。 */
    readonly chatAvailable: boolean;
    /** 「领取粮草」弹窗用：这次能领到多少体力。 */
    readonly endNum?: number;
}

/**
 * 一行的视图模型 —— 三个页签共用（FGUI 就是**同一份 `组件_好友项` + `页签` controller**，
 * 老端 `item.setSelectedIndex("页签", this.selectIndex)`；见 `组件_好友项.xml`）。
 *
 * `kind` 决定主按钮语义：
 *   `list`  → 赠送 / 已赠送（跟 `todaySend`）
 *   `add`   → 申请 / 已申请（跟 `applied`）
 *   `black` → 移除
 *   `take`  → 领取（领取粮草弹窗的行）
 */
export function buildFriendRowView(
    kind: FriendTab | 'take',
    row: IFriendRow,
    texts: IFriendRowTexts,
    options: IFriendRowViewOptions,
): IFriendRowView {
    const isTake = kind === 'take';
    const isList = kind === FriendTab.list;
    const isAdd = kind === FriendTab.add;
    const isBlack = kind === FriendTab.black;

    let actionText: string = texts.remove;
    let actionGray = false;
    if (isList) {
        actionText = row.todaySend ? texts.gifted : texts.gift;
        actionGray = row.todaySend;
    } else if (isAdd) {
        actionText = options.applied ? texts.applied : texts.apply;
        actionGray = options.applied;
    } else if (isTake) {
        actionText = texts.take;
        // 「领取粮草」弹窗只列 `todayReceive && !todayTake` 的人 ⇒ 一定能领，不置灰
        actionGray = false;
    } else if (isBlack) {
        actionText = texts.remove;
        actionGray = false;
    }

    // 可点性 ≠ 灰度：次数用完时未赠送的那些也只是不可点（老端 `onItemBtnClick` 第一句判断）
    let actionEnabled = true;
    if (isList) actionEnabled = !row.todaySend && canSendMore(options.leftSendTimes);
    else if (isAdd) actionEnabled = !options.applied;

    const duration = onlineTextOf(row, options.nowMs);
    const durationText = isList ? (duration.kind === 'online' ? texts.online : duration.text) : '';

    const powerNumber = row.power === '' ? '0' : row.power;

    return {
        id: row.id,
        name: row.name,
        level: String(row.level),
        powerText: `${texts.powerPrefix}${powerNumber}`,
        avatarId: row.avatarId,
        durationText,
        actionText,
        actionGray,
        actionEnabled,
        showChat: isList && !options.deleteMode && options.chatAvailable,
        // 删除模式只藏「好友列表」页签的主按钮（`btn` 的 `gearDisplay 展示删除界面=0`）；
        // 申请 / 移除那两个按钮没有 `展示删除界面` 这个 controller，一直显示。
        showAction: !(isList && options.deleteMode),
        showCheck: isList && options.deleteMode,
        checkSelected: options.checked,
        endNumText: isTake ? formatTextLike(texts.endNumTemplate, options.endNum ?? 0) : '',
    };
}

/**
 * 行左侧那一组（头像框 / 头像 / 等级标签 / 等级数字 / 玩家名 / 战力）的**整组位移**。
 *
 * FGUI `组件_好友项.xml` 里这 6 个节点都属于 `group n80`，组上挂着
 * `gearXY controller="展示删除界面" pages="0,1" values="30,20|73,26"` ——
 * 也就是说**进入删除模式时整组右移 43、下移 6**，把左边让出来给勾选框。
 *
 * 算成 Cocos 的局部坐标（行 564×133，行中心在 item 空间的 (282, 66.5)）：
 *   常态   组中心 = (30+116,  20+40.5) = (146, 60.5) → (-136,  6)
 *   删除态 组中心 = (73+116,  26+40.5) = (189, 66.5) → ( -93,  0)
 *
 * ⚠️ 漏掉这条**不会报错**：勾选框会直接压在头像框上（勾选框在 (22,42) 50×50，
 *    头像框在 (37,20) 81×81 —— 两者本来重叠）。单测看不见，只有端到端探针 /
 *    对着效果图看才发现。
 */
export const FRIEND_ROW_GROUP_NORMAL: { readonly x: number; readonly y: number } = { x: -136, y: 6 };
export const FRIEND_ROW_GROUP_DELETE: { readonly x: number; readonly y: number } = { x: -93, y: 0 };

/** 按是否删除模式给整组位置（`FriendRow.render` 的唯一入口）。 */
export function rowGroupPosition(deleteMode: boolean): { readonly x: number; readonly y: number } {
    return deleteMode ? FRIEND_ROW_GROUP_DELETE : FRIEND_ROW_GROUP_NORMAL;
}

/**
 * `{0}` 替换的**极简本地实现** —— 不引 `FriendTexts.formatText`（那会把「文案」模块拉进
 * 「判定」模块的依赖链；虽然两边都引擎无关，但依赖方向应当是「文案 → 判定」之外并列）。
 * 只支持 `{0}`（`endNumTemplate` 只有一个占位）。
 */
function formatTextLike(template: string, value: number): string {
    return template.replace('{0}', String(value));
}

// ============================================================
// 版面判定（FGUI 两个 controller 的 gearDisplay 链，最容易「静默失效」的一块）
// ============================================================

/**
 * 主容器一次的版面状态。
 *
 * 真源 = `组件_好友.xml` 里每个元素的 `gearDisplay`（按 `页签`）/ `gearDisplay2`（按 `展示删除界面`）：
 *
 * | 元素 | 页签 | 删除界面 | 备注 |
 * |---|---|---|---|
 * | `list` | 全部 | 全部 | |
 * | `按钮_批量删除` | 0 | 全部 | 文案随删除界面在「批量删除 / 返回」间切 |
 * | `按钮_一键赠送` | 0 | 0 | |
 * | `按钮_领取粮草` | 0 | 0 | |
 * | `按钮_一键删除` | 0 | 1 | |
 * | `文本_好友数` | 0 | — | |
 * | `文本_赠送次数` | 0 | 0 | |
 * | `文本_删除人数` | 0 | 1 | |
 * | `按钮_换一批` | 1 | — | |
 * | `按钮_好友申请` | 1 | — | |
 * | `按钮_搜索` / `n66` / `label_player` | 1 | — | |
 * | `文本_黑名单数` | 2 | — | |
 */
export interface IFriendLayout {
    readonly showFriendCount: boolean;
    readonly friendCountText: string;
    readonly showBlackCount: boolean;
    readonly blackCountText: string;
    readonly showSendTimes: boolean;
    readonly sendTimesText: string;
    readonly showRemoveCount: boolean;
    readonly removeCountText: string;
    readonly showBatchRemove: boolean;
    readonly batchRemoveText: string;
    readonly batchRemoveGold: boolean;
    readonly showSendOneKey: boolean;
    readonly showGetEnd: boolean;
    readonly showRemoveOneKey: boolean;
    readonly showRefresh: boolean;
    readonly showApplyList: boolean;
    readonly showSearch: boolean;
}

/** `resolveFriendLayout` 的输入。 */
export interface IFriendLayoutInput {
    readonly tab: FriendTab;
    readonly deleteMode: boolean;
    readonly friendCount: number;
    readonly friendMax: number;
    readonly blackCount: number;
    readonly blackMax: number;
    readonly removeCount: number;
    readonly leftSendTimes: number;
    readonly leftGetTimes: number;
    /** 文案包（由页面从 `FriendTexts` 组装）。 */
    readonly texts: {
        readonly friendCount: string;
        readonly blackCount: string;
        readonly sendTimes: string;
        readonly removeSelect: string;
        readonly batchRemove: string;
        readonly batchRemoveBack: string;
    };
}

/**
 * 主容器版面 —— 纯函数，单测直接断言 17 个开关。
 *
 * ⚠️ 三个页签的「哪个按钮在哪个页签可见」散在 FGUI 的 15 条 `gearDisplay` 里，
 *    改一处忘一处**不会报错**，只会让按钮在错误的页签下出现 / 消失
 *    （记忆规则 54/55 那类静默失效）。收成一个纯函数 + 一张单测表是唯一稳的做法。
 */
export function resolveFriendLayout(input: IFriendLayoutInput): IFriendLayout {
    const { tab, deleteMode, texts } = input;
    const isList = tab === FriendTab.list;
    const isAdd = tab === FriendTab.add;
    const isBlack = tab === FriendTab.black;

    return {
        showFriendCount: isList,
        friendCountText: isList ? countText(texts.friendCount, input.friendCount, input.friendMax) : '',
        showBlackCount: isBlack,
        blackCountText: isBlack ? countText(texts.blackCount, input.blackCount, input.blackMax) : '',
        showSendTimes: isList && !deleteMode,
        sendTimesText: isList ? format1(texts.sendTimes, input.leftSendTimes) : '',
        showRemoveCount: isList && deleteMode,
        removeCountText: isList ? format1(texts.removeSelect, input.removeCount) : '',
        showBatchRemove: isList,
        batchRemoveText: deleteMode ? texts.batchRemoveBack : texts.batchRemove,
        // `颜色` controller：老端 `setSelectedPage("颜色", isDeletView ? "Blue" : "Orange")`
        // ⇒ 删除模式是 dark(次)，否则 gold(主)
        batchRemoveGold: !deleteMode,
        showSendOneKey: isList && !deleteMode,
        showGetEnd: isList && !deleteMode,
        showRemoveOneKey: isList && deleteMode,
        showRefresh: isAdd,
        showApplyList: isAdd,
        showSearch: isAdd,
    };
}

/** `{0}` 替换（本文件不引 `FriendTexts`，见 `formatTextLike` 的注释）。 */
function format1(template: string, a: number): string {
    return template.replace('{0}', String(a));
}

function format2(template: string, a: number, b: number): string {
    return template.replace('{0}', String(a)).replace('{1}', String(b));
}

/**
 * 计数文案的统一入口（`好友数：n/max` / `黑名单：n/max`）。
 * 走 `countOfMax` 把两边的非法值先收成 0（负号 / NaN 不往界面上写）。
 */
export function countText(template: string, current: number, max: number): string {
    const pair = countOfMax(current, max);
    return format2(template, pair.current, pair.max);
}

