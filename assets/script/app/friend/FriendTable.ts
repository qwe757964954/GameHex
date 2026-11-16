/**
 * 「好友」的判定与数据归一化 —— 纯函数，唯一依赖是 `../net/RequestGuard`，
 * 所以能在 Node 里直接单测（`tests/friend.test.ts` 这一段就是它的回归网）。
 *
 * 分工：本文件只做「协议对象 / 配置行 → 视图语义」；文案在 `FriendTexts`、资源名在 `FriendArt`。
 * 判定与文案、美术解耦，改文案不会动判定，也不反向依赖它们。
 */
import { toCount, toIdString } from '../net/RequestGuard';

/** 三个页签。数值等于 FGUI `页签` controller 的 index。 */
export enum FriendTab {
    List = 0,
    Add = 1,
    Black = 2,
}

/** 页签的稳定 key —— 文案查 `FriendTexts.FRIEND_TAB_LABELS`，不要在这里写中文。 */
export const FRIEND_TAB_KEYS: readonly string[] = ['list', 'add', 'black'];

/** 页签数（prefab 里必须正好这么多页签按钮，单测比对）。 */
export const FRIEND_TAB_COUNT = FRIEND_TAB_KEYS.length;

/**
 * 一行好友（归一化后的视图模型）。
 *
 * 三个页签共用：好友列表读 `todaySend`、黑名单只用身份字段、
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
    /** 今日收到了对方的体力（可领取）。 */
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

/** 剩余次数 = `max(0, max - used)`。 */
export function leftTimes(maxTimes: number, usedTimes: number): number {
    const max = Number.isFinite(maxTimes) ? maxTimes : 0;
    const used = Number.isFinite(usedTimes) ? usedTimes : 0;
    const rest = max - used;
    return rest > 0 ? rest : 0;
}

/** 「剩余 / 上限」两个数，取整口径统一走 `leftTimes`。 */
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

/** 按页签取主按钮语义，页面不必自己 switch。 */
export function rowButtonOf(tab: FriendTab, row: IFriendRow, applied: boolean): IFriendRowButton {
    if (tab === FriendTab.Add) return applyRowButton(applied);
    if (tab === FriendTab.Black) return blackRowButton();
    return friendRowButton(row);
}

/**
 * 「好友列表」页签的按钮是否可点。
 *
 * 与 `friendRowButton().gray` 不是一回事：已赠送会置灰，但次数用完时未赠送的那些
 * 也不可点（老端只弹提示、不置灰）。页面用本函数决定「点不点得动」，用 `gray` 决定「灰不灰」。
 */
export function canSendMore(leftSendTimes: number): boolean {
    return leftSendTimes > 0;
}

/** 今日可领取的好友（`todayReceive && !todayTake`）。 */
export function pickGetEndRows(rows: readonly IFriendRow[]): IFriendRow[] {
    const out: IFriendRow[] = [];
    for (const row of rows) {
        if (row.todayReceive && !row.todayTake) out.push(row);
    }
    return out;
}

/**
 * 「领取体力」按钮是否该亮红点：有可领的人且今日领取次数没满。
 * 只看前者会让次数用完后红点还亮着，只看后者会漏掉「该亮时不亮」。
 */
export function canGetEnd(rows: readonly IFriendRow[], maxTakeTimes: number): boolean {
    let canTake = 0;
    let taken = 0;
    for (const row of rows) {
        if (!row.todayReceive) continue;
        if (row.todayTake) taken += 1;
        else canTake += 1;
    }
    return canTake > 0 && taken < maxTakeTimes;
}

/** 今日已领取数量（与 `CmdRole.takeFriendEndCount` 同口径的本地推算）。 */
export function takenCount(rows: readonly IFriendRow[]): number {
    let taken = 0;
    for (const row of rows) {
        if (row.todayReceive && row.todayTake) taken += 1;
    }
    return taken;
}

/** 已赠送数量（与 `CmdRole.sendFriendEndCount` 同口径的本地推算）。 */
export function sentCount(rows: readonly IFriendRow[]): number {
    let sent = 0;
    for (const row of rows) {
        if (row.todaySend) sent += 1;
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
 * 「最后在线」列的文案语义：在线给固定文案，离线给时长。
 * 页面拿这个结果去查 / 拼文案，本函数不产生中文字面量。
 */
export type FriendOnlineText =
    | { readonly kind: 'online' }
    | { readonly kind: 'offline'; readonly text: string };

export function onlineTextOf(row: IFriendRow, nowMs: number): FriendOnlineText {
    if (row.online) return { kind: 'online' };
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const gap = now - row.lastOfflineMs;
    // `lastOfflineTime = 0`（服务端没下来）时 gap 是「1970 到现在」，不能显示成上万天
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
 * 解析搜索框文本：纯数字按 roleId 搜（`targetName` 传空串），
 * 否则按名字搜（`targetId` 传 0）；搜自己返回 `self`，由页面当场提示、不发请求。
 */
export function parseSearch(text: string, selfId: string, selfName: string): SearchParse {
    const value = text.trim();
    if (!value) return { kind: 'empty' };
    const asNumber = Number(value);
    // `String(asNumber) === value` 把 '007' / '1e3' / '0x10' 挡在 id 之外，按名字搜
    if (Number.isFinite(asNumber) && String(asNumber) === value) {
        if (selfId && String(asNumber) === selfId) return { kind: 'self' };
        return { kind: 'id', id: asNumber };
    }
    if (selfName && value === selfName) return { kind: 'self' };
    return { kind: 'name', name: value };
}

/**
 * 列表页签要显示哪些行。三个页签的数据来源不同（「添加好友」是请求回来的，
 * 不在 `CacheMgr` 里），所以页面按页签取好数组再传进来，避免页面里散落 switch。
 */
export function rowsOfTab(tab: FriendTab, source: {
    readonly friendRows: readonly IFriendRow[];
    readonly suggestRows: readonly IFriendRow[];
    readonly blackRows: readonly IFriendRow[];
}): readonly IFriendRow[] {
    if (tab === FriendTab.Add) return source.suggestRows;
    if (tab === FriendTab.Black) return source.blackRows;
    return source.friendRows;
}

/** 今日已用次数：好友列表看赠送，其余页签看领取。 */
export function usedTimesOf(tab: FriendTab, rows: readonly IFriendRow[]): number {
    return tab === FriendTab.List ? sentCount(rows) : takenCount(rows);
}

// ============================================================
// 协议对象（`CmdFriend*`）→ 视图模型
// ============================================================

/**
 * `CmdFriend` / `CmdFriendApply` / `CmdFriendBlack` 的宽松形状。
 *
 * 三者前 9 个字段一致，「好友」多出 online / lastOfflineTime / today* 五个。
 * 一律用 `unknown` 接：运行时是 protobuf 的 `Long` / `number` / `boolean`，
 * 归一化交给 `toIdString` / `toCount`，这里不做类型假设（`Long` 是对象不是 number）。
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

/** `friendId` 认不出来（空串）时返回 `null` —— 认不出身份的行不能进列表（复用时会串行）。 */
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
        // `img` 是头像 id（`Long`）；空 = 无头像，只留框
        avatarId: toIdString(cmd.img),
        // `online` 缺省按离线算：按在线会撒一个假的「在线」标，按离线只是少一段时长
        online: cmd.online === true,
        lastOfflineMs: toCount(cmd.lastOfflineTime),
        todaySend: cmd.todaySend === true,
        todayReceive: cmd.todayReceive === true,
        todayTake: cmd.todayTake === true,
    };
}

/** 批量归一化，跳过认不出身份的项；非数组给空数组，不抛。 */
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
 * 指纹里的布尔字段片段。
 *
 * `toIdString` 只认 `string` / `number` / `Long` 形状，`boolean` 会落到最后的 `return ''`
 * ⇒ 四个布尔字段在指纹里全被抹成空串 ⇒ 服务端推了新数据、指纹却没变 ⇒
 * `pickPatchedCmd` 继续用旧补丁盖着（不报错，界面停在旧状态）。
 *
 * `false` / `0` 归 `'0'`、`true` / `1` 归 `'1'`：数字或布尔都算同一个值，只有真变了才变指纹。
 */
function flagOf(value: unknown): string {
    if (value === true) return '1';
    if (value === false) return '0';
    return toIdString(value);
}

/**
 * 一条 `CmdFriend` 的指纹 —— 判断「本地补丁还该不该留着」。
 *
 * 领取 / 赠送体力这几条请求的 Rsp 回带数据不会另外推给客户端，唯一数据源就是 Rsp，
 * 而 `GameCache` 只由服务端 `CmdCache` 写入、没有公开 upsert 接口 ⇒ 只能在 Repository
 * 里存一层本地补丁。风险是「服务端明天重置了今日次数、界面还拿旧补丁盖着」，
 * 解法就是打补丁时记下当时缓存行的指纹，`load()` 时指纹变了就丢补丁、以推送为准。
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

/** 本地补丁：Rsp 回带的那条 + 打补丁时缓存里那一条的指纹（`''` = 当时缓存里没有）。 */
export interface IFriendPatch {
    readonly cmd: unknown;
    readonly baseFingerprint: string;
}

/**
 * 缓存行 + 本地补丁 → 该用哪一条：
 * 没补丁用缓存行；补丁在且缓存行指纹没变（服务端还没推）用补丁；指纹变了用缓存行并丢补丁。
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

/** `gameConfig` 里的 7 个 `friend*` 上限键（表是 `[{key,value}]`）。 */
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

/** 读不到表时的兜底：全 0（老端每处都是 `… .value || 0`，这里保持同口径）。 */
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
 * 今日已赠送 / 已领取次数（`CmdRole.sendFriendEndCount` / `takeFriendEndCount`）。
 * 缺字段给 `null`，交给调用方决定要不要退回列表统计口径。
 */
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

/** 一行要铺的全部内容 —— 每一处都绝对赋值，虚拟列表会 clone 复用节点。 */
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
    /** 主按钮是否显示 —— 删除模式下「好友列表」页签要把整块藏掉。 */
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
    /** 是否显示「私聊」（Demo3.8 没有聊天模块，页面恒定传 `false`）。 */
    readonly chatAvailable: boolean;
    /** 「领取粮草」弹窗用：这次能领到多少体力。 */
    readonly endNum?: number;
}

/**
 * 一行的视图模型 —— 三个页签共用（FGUI 就是同一份 `组件_好友项` + `页签` controller）。
 *
 * `kind` 决定主按钮语义：`list` 赠送 / 已赠送（跟 `todaySend`）、`add` 申请 / 已申请（跟 `applied`）、
 * `black` 移除、`take` 领取（领取粮草弹窗的行）。
 */
export function buildFriendRowView(
    kind: FriendTab | 'take',
    row: IFriendRow,
    texts: IFriendRowTexts,
    options: IFriendRowViewOptions,
): IFriendRowView {
    const isTake = kind === 'take';
    const isList = kind === FriendTab.List;
    const isAdd = kind === FriendTab.Add;

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
    }

    // 可点性 ≠ 灰度：次数用完时未赠送的那些也只是不可点
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
        // 删除模式只藏「好友列表」页签的主按钮（FGUI `btn` 上是 `gearDisplay 展示删除界面=0`）；
        // 申请 / 移除那两个按钮没有这个 controller，一直显示。
        showAction: !(isList && options.deleteMode),
        showCheck: isList && options.deleteMode,
        checkSelected: options.checked,
        endNumText: isTake ? formatOne(texts.endNumTemplate, options.endNum ?? 0) : '',
    };
}

/** `{0}` 替换（本文件不引 `FriendTexts`，见文件头的分层约定）。 */
function formatOne(template: string, value: string | number): string {
    return template.replace('{0}', String(value));
}

/** `{0}` / `{1}` 顺序替换。 */
function formatTwo(template: string, a: number, b: number): string {
    return template.replace('{0}', String(a)).replace('{1}', String(b));
}

// ============================================================
// 版面判定（FGUI controller 的 gearDisplay 链，最容易静默失效的一块）
// ============================================================

/**
 * 主容器一次的版面状态。
 *
 * 真源是 prefab 里各元素的 `gearDisplay`（按 `页签`）/ `gearDisplay2`（按 `展示删除界面`），
 * 改 prefab 的显隐规则要同步这里。
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
 * 三个页签「哪个按钮在哪个页签可见」散在 prefab 的多条 `gearDisplay` 里，改一处忘一处
 * 不会报错，只会让按钮出现在错误的页签下；收成一个纯函数 + 一张单测表才好守。
 */
export function resolveFriendLayout(input: IFriendLayoutInput): IFriendLayout {
    const { tab, deleteMode, texts } = input;
    const isList = tab === FriendTab.List;
    const isAdd = tab === FriendTab.Add;
    const isBlack = tab === FriendTab.Black;

    return {
        showFriendCount: isList,
        friendCountText: isList ? countText(texts.friendCount, input.friendCount, input.friendMax) : '',
        showBlackCount: isBlack,
        blackCountText: isBlack ? countText(texts.blackCount, input.blackCount, input.blackMax) : '',
        showSendTimes: isList && !deleteMode,
        sendTimesText: isList ? formatOne(texts.sendTimes, input.leftSendTimes) : '',
        showRemoveCount: isList && deleteMode,
        removeCountText: isList ? formatOne(texts.removeSelect, input.removeCount) : '',
        showBatchRemove: isList,
        batchRemoveText: deleteMode ? texts.batchRemoveBack : texts.batchRemove,
        // FGUI `颜色` controller：删除模式 Blue（次），否则 Orange（主）
        batchRemoveGold: !deleteMode,
        showSendOneKey: isList && !deleteMode,
        showGetEnd: isList && !deleteMode,
        showRemoveOneKey: isList && deleteMode,
        showRefresh: isAdd,
        showApplyList: isAdd,
        showSearch: isAdd,
    };
}

/**
 * 计数文案的统一入口（`好友数：n/max` / `黑名单：n/max`）。
 * 走 `countOfMax` 把非法值先收成 0（负号 / NaN 不往界面上写）。
 */
export function countText(template: string, current: number, max: number): string {
    const pair = countOfMax(current, max);
    return formatTwo(template, pair.current, pair.max);
}
