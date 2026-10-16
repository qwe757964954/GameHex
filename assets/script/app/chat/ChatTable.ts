/**
 * 「聊天」的**判定口径** —— 纯函数、零 import，可单测。
 *
 * 与 `FriendTable` / `GiftTable` 同一套分层：页面只依赖本文件的判定，
 * 数据读取与请求全在 `ChatRepository`。
 *
 * 几何 / 层的真源是 FGUI `assets/聊天/组件/组件_聊天_界面.xml`；
 * 本文件只表达**行为口径**，不碰坐标。
 */

// ============================================================
// 频道
// ============================================================

/** 频道号 —— 与 proto `ChatChannelType` 逐值一致（`protoCompiled.proto:3178`）。 */
export enum ChatChannel {
    /** 招募：显示「组队申请列表」，**不可发言**。 */
    Recruit = 0,
    /** 战区：老端 `ModelChat.chatChannelName[1]` 叫「系统」，纯只读（**底部无任何控件**）。 */
    Theater = 1,
    /** 世界。 */
    World = 2,
    /** 私聊：左侧私聊对象列表 + 右侧消息流。 */
    Private = 3,
    /** 联盟：需入盟才出现。 */
    Union = 4,
}

/** 页签的**基础**顺序（老端 `initTabList` 的数组字面量）。联盟是动态追加的第 5 个。 */
export const CHAT_CHANNEL_ORDER: readonly ChatChannel[] = [
    ChatChannel.Recruit,
    ChatChannel.Theater,
    ChatChannel.World,
    ChatChannel.Private,
];

/**
 * 实际页签清单（老端口径：入盟才 push `CHAT_CHANNEL_UNION`）。
 *
 * ⚠️ `isJoinedUnion` 由 `CmdUnion` 缓存有没有行推出 —— Demo3.8 **没有联盟业务模块**，
 * 所以这是「有数据就显示、没有就隐藏」的退化实现（老端走 `ModelLeague.IsJoinedLeague()`）。
 */
export function channelsFor(isJoinedUnion: boolean): ChatChannel[] {
    const out = CHAT_CHANNEL_ORDER.slice() as ChatChannel[];
    if (isJoinedUnion) out.push(ChatChannel.Union);
    return out;
}

/** 默认选中频道（老端 `selectType = ChatType.CHAT_CHANNEL_RECRUIT`）。 */
export const CHAT_DEFAULT_CHANNEL: ChatChannel = ChatChannel.Recruit;

/** 私聊频道（决定走 `privateList` + `headList`，且发言用第二个输入框）。 */
export function isPrivateChannel(channel: number): boolean {
    return channel === ChatChannel.Private;
}

/**
 * 该频道能否发言（= 底部是否出现输入条）。
 *
 * 逐项来自 FGUI 的 `gearDisplay`：
 *   - 输入条组 `n75`：`pages="2,4"`（世界 / 联盟）
 *   - 私聊输入组 `n105`：`pages="3"`（私聊）
 *   - 「该频道不可发言」`n98`：`pages="0"`（招募）
 *   - **战区（1）没有输入条**，但**有艾特按钮**（`按钮_艾特` 的 `pages="1,2,4"` 含 1）
 *     ⇒ 底部只剩一枚艾特按钮，不是整块空白（回查 `组件_聊天_界面.xml:61-62` 实测）
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

/** 页签 1/2/4 才显示「艾特」按钮（FGUI `按钮_艾特` 的 `gearDisplay pages="1,2,4"`）。 */
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
    /** 正文（**原始串**，`[:N]` 与 `[color=..]` 之类的标记还没展开）。 */
    readonly content: string;
    /** 发送时间（服务端毫秒）。 */
    readonly sendTime: number;
    readonly speaker: IChatSpeaker;
}

/** 说话人。 */
export interface IChatSpeaker {
    /** 玩家 id —— **字符串**（`uint64` 走 Long，一律 `toIdString`）。 */
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（`HeadArt.loadHeadFrame` 的入参，**字符串**）。 */
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
        const o = raw as { toString?: () => string };
        if (typeof o.toString === 'function') {
            const s = o.toString();
            if (/^\d+$/.test(s)) return s;
        }
    }
    return '';
}

/**
 * 数字字段的安全取值。
 *
 * ⚠️ 必须兼容 **`Long` 对象**：`CmdChatMsgClient.chatId` / `sendTime` 与 `CmdChatRole.img`
 *    在 proto 里都是 `uint64`，服务端解出来是 `Long`（`{low, high, unsigned}`），
 *    `typeof` 是 `'object'` —— 只判 `number` 会让它们**静默变 0**（聊天时间全变 0 ⇒
 *    未读判定恒假、消息排序错乱，且**不报错**）。
 */
function num(raw: unknown, fallback = 0): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw);
    if (raw && typeof raw === 'object') {
        const s = (raw as { toString?: () => string }).toString?.();
        if (typeof s === 'string' && /^-?\d+$/.test(s)) {
            const value = Number(s);
            if (Number.isFinite(value)) return value;
        }
    }
    return fallback;
}

/** 归一化一个说话人；缺 id 视为无效（返回 `null`）。 */
export function normalizeSpeaker(raw: unknown): IChatSpeaker | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const roleId = toIdString(o.roleId);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof o.name === 'string' ? o.name : '',
        img: toIdString(o.img),
        serverId: num(o.serverId),
        selectServerId: num(o.selectServerId),
    };
}

/** 归一化一条消息；缺 id 或缺 speaker 视为无效（返回 `null`）。 */
export function normalizeMessage(raw: unknown): IChatMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const speaker = normalizeSpeaker(o.speaker);
    if (!speaker) return null;
    return {
        channel: num(o.channel),
        id: num(o.id),
        chatId: num(o.chatId),
        content: typeof o.content === 'string' ? o.content : '',
        sendTime: num(o.sendTime),
        speaker,
    };
}

/** 批量归一化（丢掉无效项）。 */
export function normalizeMessages(raw: unknown): IChatMessage[] {
    if (!Array.isArray(raw)) return [];
    const out: IChatMessage[] = [];
    for (const item of raw) {
        const msg = normalizeMessage(item);
        if (msg) out.push(msg);
    }
    return out;
}

/** 这条消息是不是「我自己」发的（决定用左侧还是右侧气泡）。 */
export function isSelfMessage(msg: IChatMessage, selfId: string): boolean {
    return !!selfId && msg.speaker.roleId === selfId;
}

/**
 * 老端 `ChatData.getKey` 的等价物：招募 / 战区 / 世界 / 联盟 只按频道算 key，
 * 私聊才追加对象 id（因为私聊每个对象一条独立消息流）。
 */
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
    /** 头像 id（`HeadArt.loadHeadFrame` 的入参，**字符串**）。 */
    readonly img: string;
    readonly serverId: number;
    readonly selectServerId: number;
}

/** 归一化一个私聊对象；缺 id 返回 `null`。 */
export function normalizeChatRole(raw: unknown): IChatRole | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const roleId = toIdString(o.roleId);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof o.name === 'string' ? o.name : '',
        img: toIdString(o.img),
        serverId: num(o.serverId),
        selectServerId: num(o.selectServerId),
    };
}

/**
 * `roleId < 10000` 的判据。
 *
 * ⚠️ **不能用 `BigInt` 字面量**：工程 `tsconfig.json` 的 target 低于 ES2020
 *    ⇒ `10000n` 直接编译不过（TS2737）。也不能用 `Number()` 兜 —— `roleId` 是 `uint64`，
 *    超过 `Number.MAX_SAFE_INTEGER` 会丢精度（这里只是**大小判据**、结果不会翻转，
 *    但既然可以纯字符串比，就不必引入精度假设）。
 */
function isSmallRoleId(id: string): boolean {
    const s = id.replace(/^0+/, '') || '0';
    if (s.length < 5) return true;
    if (s.length > 5) return false;
    return s <= '09999';
}

/** 对外的同义判据（页面判「点头像该不该提示『该玩家不可查看』」，老端 `onClickPlayerInfo`）。 */
export function isSystemRoleId(id: string): boolean {
    return isSmallRoleId(id);
}

/**
 * 私聊对象列表的过滤（老端 `upDateHeadList`）。
 *
 * 两条规则，逐字照抄：
 *   ① 过滤掉自己 —— 服务端**有可能把自己也塞进来**；
 *   ② 只留 `roleId >= 1e4` 的 —— 低于 1e4 的是系统播报（老端 `onClickPlayerInfo` 同判据）。
 *
 * ⚠️ 排序：老端保持服务端下发的顺序（`GetBagAsArray`），**不额外排序**，
 *    否则「最新聊过的人」会被打乱。
 */
export function filterPrivateHeads(rows: readonly unknown[], selfId: string): IChatRole[] {
    const out: IChatRole[] = [];
    for (const raw of rows) {
        const role = normalizeChatRole(raw);
        if (!role) continue;
        if (selfId && role.roleId === selfId) continue;
        if (isSmallRoleId(role.roleId)) continue;
        out.push(role);
    }
    return out;
}

/** 选中项失效时挑下一个（老端：拿第一个）。取不到返回空串。 */
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
 * 好友行 → 与 `IChatRole` 同一形状（`CmdFriend` 的主键叫 `friendId`，其余字段同构）。
 *
 * 老端 `LayerChat.onAtClick` 用的就是**好友列表**（`VOFriendBag.GetBagAsArray()`），
 * Demo3.8 走 `CacheMgr.getTlCmdFriend()`（好友模块同一张缓存）。**不额外过滤** ——
 * 老端也没过滤（自己不会是自己的好友）。
 */
export function normalizeFriendAsRole(raw: unknown): IChatRole | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const roleId = toIdString(o.friendId);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof o.name === 'string' ? o.name : '',
        img: toIdString(o.img),
        serverId: num(o.serverId),
        selectServerId: num(o.selectServerId),
    };
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

/**
 * 战区频道里所有消息统一用的**系统头像 id**（老端 `renderListItem` 里
 * `if (selectType === CHAT_CHANNEL_THEATER) headIcon = 70003`）。
 *
 * 战区是系统播报，说话人自己带的头像是玩家头像（无意义）⇒ 整块换成官方图标。
 */
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

/** `TF_BattleType.challengeChapter` —— 章节关卡（老端 `GetInstanceName` 的 1 号分支）。 */
export const TF_BATTLE_TYPE_CHAPTER = 1;

/** 归一化一条招募信息；缺 `roleId` 返回 `null`。 */
export function normalizeRecruit(raw: unknown): IRecruitRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const roleId = toIdString(o.roleId);
    if (!roleId) return null;
    return {
        roleId,
        name: typeof o.name === 'string' ? o.name : '',
        img: toIdString(o.img),
        level: num(o.level),
        power: num(o.power),
        serverId: num(o.serverId),
        selectServerId: num(o.selectServerId),
        battleType: num(o.battleType),
        battleId: num(o.battleId),
        sendTime: num(o.sendTime),
    };
}

/**
 * 批量归一化 + **按 `sendTime` 升序**。
 *
 * ⚠️ 升序是**照抄老端**（`ModelTeam.RequestRecruitList` 里
 *    `list.sort((a, b) => a.sendTime - b.sendTime)`）—— 别「顺手」改成降序，
 *    老端列表是从上往下越新的越靠下。
 */
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
 * 「关卡名」的后半段：把章节名里的**第一个** `-` 替换成 `-<关卡号>`。
 *
 * 老端原文（`client/.../chat/LayerChat.ts:291`）：
 *   `GetInstanceName(data.battleType, chapter).replace("-", \`-${stage}\`)`
 * —— 是 `replace` 而**不是**插入。`chapterName = '1-藏宝海湾'`、关卡 3 ⇒ `'1-3藏宝海湾'`
 * （原章节名里那个 `-` 被吃掉了，所以显示成「1-3藏宝海湾」而不是「1-3-藏宝海湾」）。
 * 同一写法另有 `LayerBeinvited.ts:89`，可交叉印证。
 *
 * ⚠️ `String.replace` 只换**第一处**（不是 `replaceAll`），照抄。
 */
export function formatStageName(chapterName: string, stage: number): string {
    if (!chapterName) return '';
    return chapterName.replace('-', `-${stage}`);
}

/** 查不到章节行时的兜底（老端 `GetInstanceName` 的 `default` 分支）。 */
export function fallbackStageName(chapter: number): string {
    return `第${chapter % 10000}层`;
}

/** 招募项里一个可动件的目标位置（Cocos 局部坐标：**相对父节点中心、y 向上**）。 */
export interface IPoint {
    readonly x: number;
    readonly y: number;
}

/** 招募项的「自己 / 别人」两档版面。 */
export interface IRecruitLayout {
    /** 底板 `n69`。 */
    readonly background: IPoint;
    /** 头像框 `com_head`。 */
    readonly head: IPoint;
    /** 玩家名。 */
    readonly name: IPoint;
    /** `InfoGroup`（关卡名 / 宣言 / 战力 / 加入按钮 的容器）。 */
    readonly infoGroup: IPoint;
    /** 玩家名的水平对齐（老端 `tf.align = isSelf ? RIGHT : LEFT`）。 */
    readonly nameAlign: 'left' | 'right';
}

/**
 * 招募项的版面 = FGUI `组件_聊天_招募项.xml` 的 `自己` 控制器
 * （4 处 `gearXY`，两档值逐字照抄）。
 *
 * ## 换算口径（父框 530×259，父中心 = (265, 129.5)）
 *
 * `pos.x = 子中心x − 265`、`pos.y = 129.5 − 子中心y`；子中心 = FGUI 的 `xy` **左上角** + size/2
 * （本组件的 5 个元素都**没有** `anchor="true"` ⇒ `xy` 是左上角，`pivot` 只影响旋转轴心）。
 *
 * | 元素 | 默认(别人) xy · size | 自己档 gearXY | 默认 pos | 自己 pos |
 * |---|---|---|---|---|
 * | `n69` 底板 | (117,31) 420×229 | `-6,31` | (62, -16) | (-61, -16) |
 * | `com_head` | (6,43) 110×110 | `412,43` | (-204, 31.5) | (202, 31.5) |
 * | 玩家名 | (126,4) 84×29 | `326,4` | (-97, 111) | (103, 111) |
 * | `group n77` | (189,44) 301×161 | `64,44` | (74.5, 5) | (-50.5, 5) |
 *
 * ⚠️ `group n77` 的 `gearXY` 是**作用在组上**的 —— 组内 4 件（关卡名 / 宣言 / 战力 / 按钮）
 *    坐标**不变**，整体跟着组走。这也正是可可节点树里把 4 件挂到 `InfoGroup` 下的原因。
 * ⚠️ 与 `FriendTable.rowGroupPosition` 同一处置：**样式在 prefab、随状态变的位置进这张表**
 *    （代码里 `setPosition` 覆盖 prefab 的默认值，prefab 存的就是「别人」那一档）。
 */
export function recruitLayout(isSelf: boolean): IRecruitLayout {
    return isSelf
        ? {
            background: { x: -61, y: -16 },
            head: { x: 202, y: 31.5 },
            name: { x: 103, y: 111 },
            infoGroup: { x: -50.5, y: 5 },
            nameAlign: 'right',
        }
        : {
            background: { x: 62, y: -16 },
            head: { x: -204, y: 31.5 },
            name: { x: -97, y: 111 },
            infoGroup: { x: 74.5, y: 5 },
            nameAlign: 'left',
        };
}

// ⚠️ 招募项 **`InfoGroup` 组内**的 4 件（关卡名 / 宣言 / 战力 / 加入按钮）是**静态**的
//    （FGUI 只对「组」下 gearXY，组内不做位移）⇒ 它们的坐标**写在 prefab 里**，
//    本文件不表达。反解口径（组中心 = FGUI (339.5, 124.5)）：
//
//    | 元素 | FGUI xy · size | 子中心 | 相对组中心 |
//    |---|---|---|---|
//    | 关卡名 | (294,44) 88×39 | (338, 63.5) | (-1.5, 61) |
//    | 宣言 | (203,108) 264×29 `pivot 0,.5` | 轴心 (203, 122.5) | (-136.5, 2) |
//    | 战力 | (189,166) 110×29 | (244, 180.5) | (-95.5, -56) |
//    | 加入按钮 | (378,159) 112×46 | (434, 182) | (94.5, -57.5) |
//
//    其余两个子组件（私聊头像项 117×146 / 艾特项 240×116）**一个 controller 都没有**
//    ⇒ 几何全静态，同样只存在于 prefab（生成器 `tmp/gen_chat.mjs` 从 XML 直接算）。
//
// ## 反解时最容易错的两处（本模块实测）
//
// ① **`pivot` + `anchor="true"` 的 `xy` 是轴心点、不是左上角**（MEMORY 规则 58）——
//    私聊头像项的 `玩家名 (54,98) pivot="0.5,0" anchor="true"`：按左上角算会偏 (42, 29)。
// ② **`scale` 围绕 `pivot` 缩放，`xy` 仍是缩放前的左上角** ——
//    同项的 `按钮_删除 (70,-13) scale="0.5,0.5"`（组件自身 `pivot="0.5,0.5"`）：
//    渲染左上角 = `xy + size*(1-s)*0.5` = (85, 3)，不是 (70, -13)。

// ============================================================
// 未读
// ============================================================

/**
 * 某条私聊流有没有未读（老端 `ModelChat.hasNewChat`）。
 *
 * 判据 = 「最后一条或第一条的 `sendTime` > 本地已读时间」——
 * 老端特意同时看首尾两条（中间可能有补拉的历史），逐字照抄。
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

/** 表情总数（FGUI 图片目录里 `emoji_0..43` 共 44 张；老端 `EmojiParser` 同值）。 */
export const EMOJI_COUNT = 44;

/** 全部表情标签（`[:N]` 里的 N）。 */
export function emojiTags(): string[] {
    const out: string[] = [];
    for (let i = 0; i < EMOJI_COUNT; i++) out.push(String(i));
    return out;
}

/**
 * 把正文里的 `[:N]` 展开成富文本的 `<img>` 标签（老端 `EmojiParser`）。
 *
 * ⚠️ `srcOf` 由调用方给（`ChatArt.emojiRichSrc`）—— 本文件是纯函数、零 import，
 *    不直接依赖资源路径口径。
 * ⚠️ 越界的 N 原样保留（老端也是照发，服务端 / 富文本自己忽略）。
 */
export function parseEmoji(text: string, srcOf: (index: number) => string): string {
    if (!text) return '';
    return text.replace(/\[:(\d+)\]/g, (whole: string, n: string) => {
        const index = Number(n);
        if (!Number.isInteger(index) || index < 0 || index >= EMOJI_COUNT) return whole;
        const src = srcOf(index);
        return src ? `<img src='${src}'/>` : whole;
    });
}

/** 艾特某人时插进输入框的富文本（老端 `onClickAtRole` 的 `[color=#00ff00]@名字[/color]`）。 */
export function atTag(name: string): string {
    return `[color=#00ff00]@${name}[/color]`;
}
