/**
 * 「聊天」的判定口径 —— 纯函数、零 import，可单测。
 *
 * 页面只依赖本文件的判定；数据读取与请求全在 `ChatRepository`。
 * 样式与坐标在 prefab（真源 FGUI `assets/聊天/组件/组件_聊天_界面.xml`），本文件不碰几何。
 */

// ============================================================
// 频道
// ============================================================

/** 频道号 —— 与 proto `ChatChannelType` 逐值一致。 */
export enum ChatChannel {
    /** 招募：显示组队申请列表，不可发言。 */
    Recruit = 0,
    /** 战区：系统播报，只读，底部只有艾特按钮。 */
    Theater = 1,
    /** 世界。 */
    World = 2,
    /** 私聊：左侧联系人列表 + 右侧消息流。 */
    Private = 3,
    /** 联盟：需入盟才出现。 */
    Union = 4,
}

/** 页签的基础顺序；联盟是动态追加的第 5 个。 */
export const CHAT_CHANNEL_ORDER: readonly ChatChannel[] = [
    ChatChannel.Recruit,
    ChatChannel.Theater,
    ChatChannel.World,
    ChatChannel.Private,
];

/**
 * 实际页签清单（入盟才追加联盟）。
 *
 * 入盟判据来自 `CmdUnion` 缓存有没有行 —— 本工程没有联盟业务模块，属于退化实现。
 */
export function channelsFor(isJoinedUnion: boolean): ChatChannel[] {
    const out = CHAT_CHANNEL_ORDER.slice() as ChatChannel[];
    if (isJoinedUnion) out.push(ChatChannel.Union);
    return out;
}

/** 默认选中频道。 */
export const CHAT_DEFAULT_CHANNEL: ChatChannel = ChatChannel.Recruit;

/** 私聊频道：走左侧联系人列表，发言用第二个输入条。 */
export function isPrivateChannel(channel: number): boolean {
    return channel === ChatChannel.Private;
}

/**
 * 该频道能否发言（= 底部是否出现输入条）。
 *
 * 来自 FGUI 的 `gearDisplay`：输入条组 `n75` 是 `pages="2,4"`，私聊输入组 `n105` 是
 * `pages="3"`；招募（0）显示「该频道不可发言」，战区（1）没有输入条。
 */
export function canSpeak(channel: number): boolean {
    return channel === ChatChannel.World
        || channel === ChatChannel.Union
        || channel === ChatChannel.Private;
}

/** 招募频道整块显示「该频道不可发言」。 */
export function isReadonlyChannel(channel: number): boolean {
    return channel === ChatChannel.Recruit;
}

/** 页签 1/2/4 才显示艾特按钮（FGUI `按钮_艾特` 的 `gearDisplay pages="1,2,4"`）。 */
export function needsAtButton(channel: number): boolean {
    return channel === ChatChannel.Theater
        || channel === ChatChannel.World
        || channel === ChatChannel.Union;
}

// ============================================================
// 消息 / 说话人
// ============================================================

/** 一条聊天消息（归一化后的形状）。 */
export interface IChatMessage {
    /** 频道。 */
    readonly channel: number;
    /** 私聊 / 联盟的对象 id（其它频道为 0）。 */
    readonly id: number;
    /** 消息自己的 id（私聊列表去重 / 定位用）。 */
    readonly chatId: number;
    /** 正文原始串，`[:N]` 与 `[color=..]` 之类的标记还没展开。 */
    readonly content: string;
    /** 发送时间（服务端毫秒）。 */
    readonly sendTime: number;
    readonly speaker: IChatSpeaker;
}

/** 说话人。 */
export interface IChatSpeaker {
    /** 玩家 id —— 字符串（`uint64` 一律 `toIdString`）。 */
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（`HeadArt.loadHeadFrame` 的入参，字符串）。 */
    readonly img: string;
    readonly serverId: number;
    readonly selectServerId: number;
}

/** `Long` / `string` / `number` 一律归一成十进制字符串；取不到返回空串。 */
export function toIdString(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return /^\d+$/.test(raw) ? raw : '';
    if (typeof raw === 'number') return Number.isFinite(raw) ? String(Math.trunc(raw)) : '';
    if (typeof raw === 'object') {
        const row = raw as { toString?: () => string };
        if (typeof row.toString === 'function') {
            const text = row.toString();
            if (/^\d+$/.test(text)) return text;
        }
    }
    return '';
}

/**
 * 数字字段的安全取值。
 *
 * `chatId` / `sendTime` / `img` 在 proto 里是 `uint64`，服务端解出来是 `Long` 对象
 * （`typeof` 为 `'object'`）。只判 `number` 会让它们静默变 0 —— 未读判定恒假、
 * 消息排序错乱，且不报错。
 */
function num(raw: unknown, fallback = 0): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw);
    if (raw && typeof raw === 'object') {
        const text = (raw as { toString?: () => string }).toString?.();
        if (typeof text === 'string' && /^-?\d+$/.test(text)) {
            const value = Number(text);
            if (Number.isFinite(value)) return value;
        }
    }
    return fallback;
}

/**
 * 角色行归一化。
 *
 * 说话人、私聊对象、好友行三处字段同构，只有主键名不同：
 * `CmdChatRole` / 说话人用 `roleId`，`CmdFriend` 用 `friendId`。
 */
function toRole(raw: unknown, idKey: 'roleId' | 'friendId'): IChatRole | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const roleId = toIdString(row[idKey]);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof row.name === 'string' ? row.name : '',
        img: toIdString(row.img),
        serverId: num(row.serverId),
        selectServerId: num(row.selectServerId),
    };
}

/** 归一化一个说话人；缺 id 视为无效。 */
export function normalizeSpeaker(raw: unknown): IChatSpeaker | null {
    return toRole(raw, 'roleId');
}

/** 归一化一条消息；缺 id 或缺 speaker 视为无效。 */
export function normalizeMessage(raw: unknown): IChatMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const speaker = normalizeSpeaker(row.speaker);
    if (!speaker) return null;
    return {
        channel: num(row.channel),
        id: num(row.id),
        chatId: num(row.chatId),
        content: typeof row.content === 'string' ? row.content : '',
        sendTime: num(row.sendTime),
        speaker,
    };
}

/** 批量归一化（丢掉无效项）。 */
export function normalizeMessages(raw: unknown): IChatMessage[] {
    if (!Array.isArray(raw)) return [];
    const out: IChatMessage[] = [];
    for (const item of raw) {
        const message = normalizeMessage(item);
        if (message) out.push(message);
    }
    return out;
}

/** 这条消息是不是我自己发的（决定用左侧还是右侧气泡）。 */
export function isSelfMessage(message: IChatMessage, selfId: string): boolean {
    return !!selfId && message.speaker.roleId === selfId;
}

/** 消息流的 key：私聊每个对象一条独立流，其余频道整条频道共用一条流。 */
export function chatKey(channel: number, id: number = 0): string {
    if (channel === ChatChannel.Recruit
        || channel === ChatChannel.Theater
        || channel === ChatChannel.World
        || channel === ChatChannel.Union) {
        return String(channel);
    }
    return `${channel}_${id}`;
}

// ============================================================
// 私聊对象
// ============================================================

/** 私聊对象（`CmdChatRole` 一行）。 */
export interface IChatRole {
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（`HeadArt.loadHeadFrame` 的入参，字符串）。 */
    readonly img: string;
    readonly serverId: number;
    readonly selectServerId: number;
}

/** 归一化一个私聊对象；缺 id 返回 `null`。 */
export function normalizeChatRole(raw: unknown): IChatRole | null {
    return toRole(raw, 'roleId');
}

/**
 * `roleId < 10000` —— 服务端用这一区间播系统消息。
 *
 * 纯字符串比较：`uint64` 走 `Number()` 会丢精度，`BigInt` 字面量又过不了当前编译目标。
 */
export function isSystemRoleId(id: string): boolean {
    const digits = id.replace(/^0+/, '') || '0';
    if (digits.length < 5) return true;
    if (digits.length > 5) return false;
    return digits <= '09999';
}

/**
 * 私聊对象列表过滤：去掉自己（服务端有可能把自己也塞进来），
 * 并去掉 `roleId < 1e4` 的系统播报。
 *
 * 保持服务端下发的顺序，不额外排序，否则「最新聊过的人」会被打乱。
 */
export function filterPrivateHeads(rows: readonly unknown[], selfId: string): IChatRole[] {
    const out: IChatRole[] = [];
    for (const raw of rows) {
        const role = normalizeChatRole(raw);
        if (!role) continue;
        if (selfId && role.roleId === selfId) continue;
        if (isSystemRoleId(role.roleId)) continue;
        out.push(role);
    }
    return out;
}

/** 选中项失效时退回第一个；空列表给空串。 */
export function nextPrivateRoleId(rows: readonly IChatRole[], current: string): string {
    for (const row of rows) {
        if (row.roleId === current) return current;
    }
    return rows.length > 0 ? rows[0].roleId : '';
}

// ============================================================
// 艾特用的好友行（`CmdFriend`）
// ============================================================

/**
 * 好友行 → 与 `IChatRole` 同一形状（主键是 `friendId`）。
 *
 * 艾特弹窗用的是好友列表；自己不会是自己的好友，因此不做额外过滤。
 */
export function normalizeFriendAsRole(raw: unknown): IChatRole | null {
    return toRole(raw, 'friendId');
}

/** 批量归一化好友行（丢掉无效项，保持服务端顺序）。 */
export function normalizeFriends(raw: unknown): IChatRole[] {
    if (!Array.isArray(raw)) return [];
    const out: IChatRole[] = [];
    for (const item of raw) {
        const role = normalizeFriendAsRole(item);
        if (role) out.push(role);
    }
    return out;
}

// ============================================================
// 招募（`CmdRecruitInfo`）—— 页签 0 的列表
// ============================================================

/** 战区消息统一使用的系统头像 id（战区是系统播报，说话人自带的头像无意义）。 */
export const CHAT_THEATER_HEAD_ID = '70003';

/** 一条招募信息（`CmdRecruitInfo` 归一化后）。 */
export interface IRecruitRow {
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（`HeadArt.loadHeadFrame` 的入参）。 */
    readonly img: string;
    readonly level: number;
    readonly power: number;
    readonly serverId: number;
    readonly selectServerId: number;
    /** 战斗类型（`TF_BattleType`）。 */
    readonly battleType: number;
    /** 关卡 id（用来查章节）。 */
    readonly battleId: number;
    /** 服务端下发时间（列表排序用）。 */
    readonly sendTime: number;
}

/** `TF_BattleType.challengeChapter` —— 章节关卡。 */
export const TF_BATTLE_TYPE_CHAPTER = 1;

/** 归一化一条招募信息；缺 `roleId` 返回 `null`。 */
export function normalizeRecruit(raw: unknown): IRecruitRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const roleId = toIdString(row.roleId);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof row.name === 'string' ? row.name : '',
        img: toIdString(row.img),
        level: num(row.level),
        power: num(row.power),
        serverId: num(row.serverId),
        selectServerId: num(row.selectServerId),
        battleType: num(row.battleType),
        battleId: num(row.battleId),
        sendTime: num(row.sendTime),
    };
}

/** 批量归一化并按 `sendTime` 升序（越新的越靠下，与老端列表一致）。 */
export function normalizeRecruits(raw: unknown): IRecruitRow[] {
    if (!Array.isArray(raw)) return [];
    const out: IRecruitRow[] = [];
    for (const item of raw) {
        const row = normalizeRecruit(item);
        if (row) out.push(row);
    }
    out.sort((a, b) => a.sendTime - b.sendTime);
    return out;
}

/** 这条招募是不是我自己发的（决定「点击加入」是否直接提示不能加入自己）。 */
export function isSelfRecruit(row: IRecruitRow, selfId: string): boolean {
    return !!selfId && row.roleId === selfId;
}

/**
 * 关卡名的后半段：把章节名里的第一个 `-` 替换成 `-<关卡号>`。
 *
 * 是 `replace` 而不是插入：`'1-藏宝海湾'` + 关卡 3 ⇒ `'1-3藏宝海湾'`（原分隔符被吃掉）。
 */
export function formatStageName(chapterName: string, stage: number): string {
    if (!chapterName) return '';
    return chapterName.replace('-', `-${stage}`);
}

/** 查不到章节行时的兜底。 */
export function fallbackStageName(chapter: number): string {
    return `第${chapter % 10000}层`;
}

// ============================================================
// 未读
// ============================================================

/**
 * 某条私聊流有没有未读。
 *
 * 判据是「首条或末条的 `sendTime` 晚于本地已读时间」—— 同时看首尾两条，
 * 因为中间可能补拉过历史。
 */
export function hasUnread(messages: readonly IChatMessage[], lastReadTime: number): boolean {
    if (messages.length === 0) return false;
    const last = messages[messages.length - 1];
    const first = messages[0];
    return last.sendTime > lastReadTime || first.sendTime > lastReadTime;
}

// ============================================================
// 表情（富文本）
// ============================================================

/** 表情总数（FGUI 图片目录里 `emoji_0..43` 共 44 张）。 */
export const EMOJI_COUNT = 44;

/** 全部表情标签（`[:N]` 里的 N）。 */
export function emojiTags(): string[] {
    const out: string[] = [];
    for (let i = 0; i < EMOJI_COUNT; i++) out.push(String(i));
    return out;
}

/**
 * 把正文里的 `[:N]` 展开成富文本的 `<img>` 标签。
 *
 * `srcOf` 由调用方给（`ChatArt.emojiRichSrc`），本文件保持零 import；
 * 越界的 N 原样保留，交给富文本自己忽略。
 */
export function parseEmoji(text: string, srcOf: (index: number) => string): string {
    if (!text) return '';
    return text.replace(/\[:(\d+)\]/g, (whole: string, indexText: string) => {
        const index = Number(indexText);
        if (!Number.isInteger(index) || index < 0 || index >= EMOJI_COUNT) return whole;
        const src = srcOf(index);
        return src ? `<img src='${src}'/>` : whole;
    });
}

/** 艾特某人时插进输入框的富文本。 */
export function atTag(name: string): string {
    return `[color=#00ff00]@${name}[/color]`;
}
