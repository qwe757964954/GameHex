import type { INetRequestStatus } from '../../core/types/NetResult';
/**
 * 「聊天」的数据端口 —— 内存消息流 + 缓存 + 网络请求三合一。
 *
 * 与 `FriendRepository` / `GiftRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `ChatTable`（纯函数、可单测）。
 *
 * 消息为什么不走 `GameCache`：`protoCache.json` 里只有 `CmdChatRole`，没有
 * `CmdChatMsg`，服务端不会把聊天记录写进缓存。消息流只有两个来源 ——
 * `InitRsp` 回一整页、`BroMsg` 推一条，都只在报文里，所以自己存内存。
 *
 * 两处退化（原因都在对应方法上）：入盟判据退化成「缓存里有联盟行」，
 * 已读时间退化成 `Date.now()`（没有服务端时钟）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toIdString, withTimeout } from '../net/RequestGuard';
import {
    ChatChannel,
    chatKey,
    fallbackStageName,
    filterPrivateHeads,
    formatStageName,
    IChatMessage,
    IChatRole,
    IRecruitRow,
    isPrivateChannel,
    nextPrivateRoleId,
    normalizeMessage,
    normalizeMessages,
    normalizeRecruits,
    TF_BATTLE_TYPE_CHAPTER,
} from './ChatTable';
import {
    RequestChatDelTarget,
    RequestChatInit,
    RequestChatSend,
    RequestTeamRecruitInit,
} from './RequestChatMsg';

/** 某个频道的某一页。 */
export interface IChatPageData {
    readonly channel: number;
    /** 私聊 / 联盟的对象 id；其它频道恒 0。 */
    readonly id: number;
    readonly page: number;
    readonly list: readonly IChatMessage[];
}

/** 一条招募信息 + 解析好的关卡名（招募项要直接往 Label 上写）。 */
export interface IRecruitView extends IRecruitRow {
    /** 关卡名，形如 `1-3藏宝海湾`；查不到任何一环时退回 `第N层`。 */
    readonly stageName: string;
}

/** 一次界面刷新要的全部数据。 */
export interface IChatSnapshot {
    readonly selfId: string;
    /** 私聊对象列表（已过滤自己与系统播报）。 */
    readonly heads: readonly IChatRole[];
    /** 当前选中的私聊对象 id（拿不到时为空串）。 */
    readonly selectedRoleId: string;
    /** 是否已入盟（决定联盟页签显隐）。 */
    readonly joinedUnion: boolean;
    /** 当前频道当前页（没有则 `list` 为空）。 */
    readonly page: IChatPageData;
    /** 招募列表（频道 0 用；`sendTime` 升序，已带 `stageName`）。 */
    readonly recruits: readonly IRecruitView[];
    /** 各私聊对象的已读时间（`roleId -> 毫秒`）。 */
    readonly lastRead: ReadonlyMap<string, number>;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type ChatRequestResult = INetRequestStatus;

export interface IChatRepository {
    /** 读内存 + 读缓存，组装一次快照；不发任何请求。 */
    load(channel: number, selectedRoleId: string): Promise<IChatSnapshot>;

    /** 拉某频道某页。`id` 私聊 / 联盟才非 0。 */
    initChannel(channel: number, id: number, page: number, caller?: object): Promise<ChatRequestResult>;
    /** 拉招募列表（`CmdTeamRecruitInitReqMsg`，频道 0 用）。 */
    initRecruits(caller?: object): Promise<ChatRequestResult>;
    /** 发消息。 */
    sendMessage(channel: number, id: number, content: string, caller?: object): Promise<ChatRequestResult>;
    /** 删掉一个私聊对象。 */
    delTarget(roleId: string, caller?: object): Promise<ChatRequestResult>;

    /** 这个频道的这一页是否已经拉过（页面据此决定要不要补发 `Init`）。 */
    isInited(channel: number, id: number): boolean;
    /** 招募列表是否已经拉过。 */
    isRecruitsFetched(): boolean;

    /** 接广播（`CmdChatBroMsg`）。同一 `caller` 重复调用只生效一次。 */
    listen(caller: object, onMessage: (channel: number, id: number) => void): void;
    /** 断开广播监听。 */
    unlisten(caller: object): void;

    /** 某个私聊对象的已读时间（毫秒；没记录返回 0）。 */
    readTimeOf(roleId: string): number;
    /** 标记某私聊对象已读（内存 + 待存盘）。 */
    markRead(roleId: string): void;
    /** 把待存的已读时间写进 `localStorage`（关界面时调）。 */
    saveRead(): void;
    /** 登出时清干净（内存 + 已读缓存标记）。 */
    reset(): void;
}

/** 请求超时（与礼包 / 好友同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 已读时间的 `localStorage` 键前缀（后接 roleId）。 */
const READ_KEY_PREFIX = 'chatReadedData';

/** 内存里的一条频道数据（`list` 可变 —— `BroMsg` 要 push）。 */
interface IMutablePage {
    channel: number;
    id: number;
    page: number;
    list: IChatMessage[];
}

function readStorage(key: string): Record<string, number> {
    try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
        }
        return out;
    } catch (error) {
        console.warn('[Chat] 读已读缓存失败', error);
        return {};
    }
}

function writeStorage(key: string, value: Record<string, number>): void {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('[Chat] 写已读缓存失败', error);
    }
}

/** 生产环境 Repository。 */
export class RuntimeChatRepository implements IChatRepository {
    /** 各频道的内存消息流（`chatKey` -> 页数据）；服务端不推，也不在缓存表里。 */
    private readonly pages = new Map<string, IMutablePage>();

    /** 已经发过 `Init` 的页（每页只拉一次）。 */
    private readonly inited = new Set<string>();

    /** 招募列表原始行（只随 `CmdTeamRecruitInitRspMsg` 回来，没有推送也没有缓存）。 */
    private recruitsRaw: unknown[] = [];

    private recruitsFetched = false;

    /** `battleType_battleId` -> 关卡名（查表结果缓存，避免每次 `load` 重查）。 */
    private readonly stageNames = new Map<string, string>();

    /** 已读时间（`roleId -> 毫秒`）。首次使用时从 `localStorage` 载入。 */
    private readed: Record<string, number> | null = null;

    /** 已读有改动、还没落盘。 */
    private readDirty = false;

    /** 广播监听：一个 caller 一个回调。 */
    private readonly listeners = new Map<object, (channel: number, id: number) => void>();

    /** 已注册的广播分发器（只注册一次）。 */
    private broadcaster: object | null = null;

    // ============================================================
    // 读
    // ============================================================

    async load(channel: number, selectedRoleId: string): Promise<IChatSnapshot> {
        const selfId = this.selfId();
        const heads = filterPrivateHeads(this.cachedChatRoles(), selfId);
        const selected = nextPrivateRoleId(heads, selectedRoleId);
        const key = chatKey(channel, isPrivateChannel(channel) ? Number(selected || 0) : 0);
        return {
            selfId,
            heads,
            selectedRoleId: selected,
            joinedUnion: this.joinedUnion(),
            page: this.pageOf(key, channel),
            recruits: await this.buildRecruits(),
            lastRead: new Map(Object.entries(this.readedMap())),
        };
    }

    isInited(channel: number, id: number): boolean {
        return this.inited.has(chatKey(channel, id));
    }

    isRecruitsFetched(): boolean {
        return this.recruitsFetched;
    }

    // ============================================================
    // 招募列表（频道 0）
    // ============================================================

    private async buildRecruits(): Promise<IRecruitView[]> {
        const rows = normalizeRecruits(this.recruitsRaw);
        const out: IRecruitView[] = [];
        for (const row of rows) {
            out.push({ ...row, stageName: await this.stageNameOf(row) });
        }
        return out;
    }

    /** 关卡名（带缓存）。 */
    private async stageNameOf(row: IRecruitRow): Promise<string> {
        const key = `${row.battleType}_${row.battleId}`;
        const hit = this.stageNames.get(key);
        if (hit !== undefined) return hit;
        const name = await this.resolveStageName(row);
        this.stageNames.set(key, name);
        return name;
    }

    /**
     * 查两张表拼关卡名。
     *
     * `guankaReward` 的索引字段是 `level`，老端把 `battleId` 直接当 `level` 传；
     * `guankaChapter` 的索引字段是 `chapter`，值是形如 `1-藏宝海湾` 的章节名。
     * 老端还有 `battleType=4` 的独立分支，本工程没有该类型的队伍落地过，
     * 这里只做章节关卡 + 兜底。
     */
    private async resolveStageName(row: IRecruitRow): Promise<string> {
        try {
            const reward = await RefUtil.instance.getRefAsync('guankaReward', 'level', row.battleId) as
                { chapter?: unknown; stage?: unknown } | null;
            const chapter = Number((reward?.chapter as number) ?? 0);
            const stage = Number((reward?.stage as number) ?? 0);
            if (!chapter) return fallbackStageName(row.battleId);

            if (row.battleType === TF_BATTLE_TYPE_CHAPTER) {
                const chapterRow = await RefUtil.instance.getRefAsync('guankaChapter', 'chapter', chapter) as
                    { chapterName?: unknown } | null;
                const chapterName = typeof chapterRow?.chapterName === 'string' ? chapterRow.chapterName : '';
                if (chapterName) return formatStageName(chapterName, stage);
            }
            return fallbackStageName(chapter);
        } catch (error) {
            console.warn('[Chat] 关卡名解析失败', error);
            return fallbackStageName(row.battleId);
        }
    }

    private pageOf(key: string, channel: number): IChatPageData {
        const hit = this.pages.get(key);
        if (hit) return hit;
        return { channel, id: 0, page: 0, list: [] };
    }

    private selfId(): string {
        try {
            const rows = CacheMgr.instance.getTlCmdRole() ?? [];
            for (const row of rows) {
                const id = toIdString((row as { id?: unknown } | null)?.id);
                if (id) return id;
            }
        } catch (error) {
            console.warn('[Chat] 读 CmdRole 失败', error);
        }
        return '';
    }

    /** 私聊对象原始行（`CmdChatRole` 缓存）。拿不到返回空数组，不抛。 */
    private cachedChatRoles(): unknown[] {
        try {
            return CacheMgr.instance.getTlCmdChatRole() ?? [];
        } catch (error) {
            console.warn('[Chat] 读 CmdChatRole 缓存失败', error);
            return [];
        }
    }

    /**
     * 是否入盟 —— `CmdUnion` 缓存里有联盟行就为真。
     *
     * 本工程没有联盟业务模块，这是「有数据就显示、没有就隐藏」的退化判据。
     */
    private joinedUnion(): boolean {
        try {
            const rows = CacheMgr.instance.getTlCmdUnion() ?? [];
            return rows.length > 0;
        } catch (error) {
            console.warn('[Chat] 读 CmdUnion 缓存失败', error);
            return false;
        }
    }

    // ============================================================
    // 已读
    // ============================================================

    private readedMap(): Record<string, number> {
        if (this.readed) return this.readed;
        const selfId = this.selfId();
        this.readed = selfId ? readStorage(READ_KEY_PREFIX + selfId) : {};
        return this.readed;
    }

    readTimeOf(roleId: string): number {
        return this.readedMap()[roleId] ?? 0;
    }

    markRead(roleId: string): void {
        if (!roleId) return;
        this.readedMap()[roleId] = Date.now();
        this.readDirty = true;
    }

    saveRead(): void {
        if (!this.readDirty) return;
        const selfId = this.selfId();
        if (!selfId) return;
        this.readDirty = false;
        writeStorage(READ_KEY_PREFIX + selfId, this.readedMap());
    }

    reset(): void {
        this.saveRead();
        this.pages.clear();
        this.inited.clear();
        this.recruitsRaw = [];
        this.recruitsFetched = false;
        this.stageNames.clear();
        this.readed = null;
        this.readDirty = false;
        for (const caller of [...this.listeners.keys()]) this.unlisten(caller);
    }

    // ============================================================
    // 广播
    // ============================================================

    listen(caller: object, onMessage: (channel: number, id: number) => void): void {
        this.listeners.set(caller, onMessage);
        if (this.broadcaster) return;
        this.broadcaster = {};
        GameNet.instance.addEvent('CmdChatBroMsg', this.broadcaster, (msg: any) => this.onBroadcast(msg));
    }

    unlisten(caller: object): void {
        this.listeners.delete(caller);
        if (this.listeners.size === 0 && this.broadcaster) {
            GameNet.instance.removeCallerEvent(this.broadcaster);
            this.broadcaster = null;
        }
    }

    /** `CmdChatBroMsg { channel, id, content: CmdChatMsgClient }`。 */
    private onBroadcast(raw: any): void {
        const channel = Number(raw?.channel ?? 0);
        const message = normalizeMessage(raw?.content);
        if (!message) return;
        // 私聊的对象 id 在 `id` 上；其它频道恒 0
        const objectId = Number(toIdString(raw?.id) || 0);
        const key = chatKey(channel, objectId);
        const hit = this.pages.get(key);
        if (hit) {
            hit.list.push(message);
        } else {
            this.pages.set(key, { channel, id: objectId, page: 1, list: [message] });
        }
        for (const fn of this.listeners.values()) fn(channel, objectId);
    }

    // ============================================================
    // 请求
    // ============================================================

    async initChannel(channel: number, id: number, page: number, caller?: object): Promise<ChatRequestResult> {
        this.inited.add(chatKey(channel, id));
        return this.send(() => new RequestChatInit(
            { channel, page, id: id ? String(id) : '0' } as never,
            caller,
            (rsp: any) => {
                // Rsp 回的 channel / id 才是真源（服务端可能纠正请求里的值），
                // 按 Rsp 落 key，否则 `load` 读不到刚拉回来的那一页。
                const rspChannel = Number(rsp?.channel ?? channel);
                const rspId = Number(toIdString(rsp?.id) || 0);
                this.pages.set(chatKey(rspChannel, rspId), {
                    channel: rspChannel,
                    id: rspId,
                    page: Number(rsp?.page ?? page),
                    list: normalizeMessages(rsp?.list),
                });
            },
        ), READ_TIMEOUT_MS);
    }

    /**
     * 拉招募列表。
     *
     * 只有这一包能发：同族的 `CmdTeamRecruitSend` / `CmdTeamRecruitJoin` 都要求
     * `attr: CmdBattleRoleAttr`（战前属性快照），本工程造不出来。
     */
    async initRecruits(caller?: object): Promise<ChatRequestResult> {
        this.recruitsFetched = true;
        return this.send(() => new RequestTeamRecruitInit(
            {} as never,
            caller,
            (rsp: any) => {
                this.recruitsRaw = rsp?.infoList?.recruitList ?? [];
            },
        ), READ_TIMEOUT_MS);
    }

    async sendMessage(channel: number, id: number, content: string, caller?: object): Promise<ChatRequestResult> {
        const text = content.trim();
        if (!text) return 'failed';
        return this.send(() => new RequestChatSend(
            { channel, content: text, id: id ? String(id) : '0' } as never,
            caller,
        ), WRITE_TIMEOUT_MS);
    }

    async delTarget(roleId: string, caller?: object): Promise<ChatRequestResult> {
        const id = toIdString(roleId);
        if (!id) return 'failed';
        return this.send(() => new RequestChatDelTarget(
            { id } as never,
            caller,
            () => {
                // 本地同步删掉消息流，别等下一次 `load` 才发现对象没了
                const key = chatKey(ChatChannel.Private, Number(id));
                this.pages.delete(key);
                this.inited.delete(key);
            },
        ), WRITE_TIMEOUT_MS);
    }

    /** 统一的发包 + 三态收口（离线早退 / `withTimeout` / `catch` 返 failed）。 */
    private async send(make: () => any, timeoutMs: number): Promise<ChatRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            const sent = await withTimeout(net.send(make(), false), timeoutMs, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Chat] 请求失败', error);
            return 'failed';
        }
    }
}

export const chatRepository: IChatRepository = new RuntimeChatRepository();

/** 读 / 写超时常量（测试据此断言口径，避免硬编码）。 */
export const CHAT_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const CHAT_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;
