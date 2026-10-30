/**
 * 「好友」的数据端口 —— **缓存 + 配置表 + 网络请求** 三合一的 Repository。
 *
 * 与 `GiftRepository` / `SevenDayRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `FriendTable`（纯函数、可单测），本文件只负责「把数据搬进来 / 把请求发出去」。
 *
 * ## 数据来源
 *
 * | 来源 | 内容 | 走哪 |
 * |---|---|---|
 * | 缓存 `CmdFriend` / `CmdFriendApply` / `CmdFriendBlack` | 好友 / 申请 / 黑名单三张表 | `CacheMgr`（**服务端推**，见下） |
 * | 缓存 `CmdRole` | 自身 id / 名字 + 今日已赠送 / 已领取次数 | `CacheMgr.getTlCmdRole()` |
 * | 配置表 `gameConfig` | 7 个 `friend*` 上限 | `RefUtil.instance.getRefAllAsync('gameConfig')` |
 * | 内存（**只在本会话有效**） | 推荐列表 / 我申请过谁 | 本类自己存（老端 `ModelFriend` 同理） |
 *
 * ## 为什么三张表**不自己存快照**
 *
 * `assets/resources/config/protoCache.json` 里**有** `CmdFriend` / `CmdFriendApply` /
 * `CmdFriendBlack`（`tlKey = friendId`）⇒ 服务端**会主动推**（`GameCacheMgr.handleCache`
 * 按 `CmdCache` 写进 `GameCache`）⇒ 每次 `load()` 现读 `CacheMgr`，不复制一份。
 *
 * 反例（**必须自己存**的两样）：
 *   ① **推荐列表**（`CmdFriendRefreshSuggestRspMsg.suggestList` / 搜索结果）—— 只在 Rsp 里，
 *      没有推送、也不在任何缓存表里（老端 `ModelFriend.suggestList` 同样是内存数组）；
 *   ② **我申请过谁**（老端 `ModelFriend.applyList`）—— 纯客户端状态，服务端不回带。
 *
 * ## 一处**本地补丁**（`localPatches`）—— 唯一一处「自己存了服务端对象」的地方
 *
 * `CmdFriendGetEnd*` / `CmdFriendSendEndOneKey` 这四条请求**没有携带数据的推送**：
 * `…GetEndBroMsg` 在 `Cmd.d.ts` 里根本不存在，`CmdFriendSendEndOneKeyBroMsg` 是**空消息**
 * ⇒ 唯一数据来源就是 Rsp 里的 `friend` / `friendList`。老端直接
 * `VOBag.UpdateFriend(rsp.friend)` 落地；Demo3.8 的 `GameCache` **只由服务端 `CmdCache` 写入**
 * （`handleCache`），没有公开的 upsert 接口 ⇒ 这里存一层「本地补丁」顶上。
 *
 * 补丁不会一直盖着：`FriendTable.pickPatchedCmd` 记下了打补丁时缓存行的**指纹**，
 * `load()` 时若指纹变了（= 服务端推过新数据）就丢弃补丁、以推送为准。
 * 这样既不会「领了没反应」，也不会「明天服务端重置了今日次数、界面还拿旧补丁覆盖」。
 *
 * ## 请求三态
 *
 * 每个请求都是 `'ok' | 'offline' | 'failed'`：**离线早退**、`withTimeout` 兜底
 * （读 800ms / 写 5000ms），`catch` 一律返 `'failed'` —— 绝不把 Promise 悬着
 * （`GameNet.send` 没有按请求的超时，服务端不回应就永悬）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toIdString, withTimeout } from '../net/RequestGuard';
import {
    FRIEND_CONFIG_DEFAULTS,
    friendFingerprint,
    IFriendConfig,
    IFriendPatch,
    IFriendRow,
    normalizeFriendRow,
    normalizeFriendRows,
    parseFriendConfig,
    pickPatchedCmd,
    readFriendCounters,
    SearchParse,
    sentCount,
    takenCount,
    leftTimes,
} from './FriendTable';
import {
    RequestdFriendAgreeOneKey,
    RequestdFriendRefreshSuggest,
    RequestdFriendRefuseOneKey,
    RequestFriendBlackRemove,
    RequestFriendGetEnd,
    RequestFriendGetEndOneKey,
    RequestFriendsAdd,
    RequestFriendsApply,
    RequestFriendsBlack,
    RequestFriendsRefuse,
    RequestFriendsRemove,
    RequestFriendsSearch,
    RequestFriendSendEnd,
    RequestFriendSendEndOneKey,
} from './RequestFriendMsg';

/** 一次界面刷新要的全部数据。 */
export interface IFriendSnapshot {
    /** 「好友列表」页签（`CmdFriend` 缓存）。 */
    readonly friendRows: readonly IFriendRow[];
    /** 「好友申请」弹窗（`CmdFriendApply` 缓存）。 */
    readonly applyRows: readonly IFriendRow[];
    /** 「黑名单」页签（`CmdFriendBlack` 缓存）。 */
    readonly blackRows: readonly IFriendRow[];
    /** 「添加好友」页签（**内存**：推荐 / 搜索）。 */
    readonly suggestRows: readonly IFriendRow[];
    /** 我申请过谁的集合（**内存**）。「添加好友」页签的按钮据此置灰。 */
    readonly appliedIds: ReadonlySet<string>;
    readonly config: IFriendConfig;
    /** 今日还可赠送次数（上限 - `CmdRole.sendFriendEndCount`）。 */
    readonly leftSendTimes: number;
    /** 今日还可领取次数（上限 - `CmdRole.takeFriendEndCount`）。 */
    readonly leftGetTimes: number;
    /** 自己（判据：搜索自己时老端会拦一道「不能搜索自己」）。 */
    readonly selfId: string;
    readonly selfName: string;
    /** 这次快照的时间基准（毫秒）——「离线多久」按它算。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type FriendRequestResult = 'ok' | 'offline' | 'failed';

export interface IFriendRepository {
    /** 读缓存 + 读表，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<IFriendSnapshot>;

    /** 好友申请（对方会收到一条申请）。 */
    apply(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 通过别人的申请。 */
    agree(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 拒绝别人的申请。 */
    refuse(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 删除好友（**批量**，唯一一个数组请求体）。 */
    remove(targetIds: readonly string[], caller?: object): Promise<FriendRequestResult>;
    /** 拉黑。 */
    black(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 移出黑名单。 */
    blackRemove(targetId: string, caller?: object): Promise<FriendRequestResult>;

    /** 搜索（`parseSearch` 的结果直接传进来）。 */
    search(parsed: SearchParse, caller?: object): Promise<FriendRequestResult>;
    /** 「换一批」/ 切到「添加好友」页签时刷新推荐列表。 */
    refreshSuggest(caller?: object): Promise<FriendRequestResult>;

    /** 领取某个好友的体力。 */
    getEnd(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 一键领取。 */
    getEndOneKey(caller?: object): Promise<FriendRequestResult>;
    /** 赠送体力。 */
    sendEnd(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 一键赠送。 */
    sendEndOneKey(caller?: object): Promise<FriendRequestResult>;

    /** 一键同意全部申请。 */
    agreeOneKey(caller?: object): Promise<FriendRequestResult>;
    /** 一键拒绝全部申请。 */
    refuseOneKey(caller?: object): Promise<FriendRequestResult>;
}

/** 请求超时（与礼包 / 首充 / 七日同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读缓存里一张表的全部行（拿不到返回空数组，**不抛**）。 */
function readCacheRows(table: 'CmdFriend' | 'CmdFriendApply' | 'CmdFriendBlack'): unknown[] {
    try {
        const mgr = CacheMgr.instance as any;
        if (table === 'CmdFriend') return mgr.getTlCmdFriend() ?? [];
        if (table === 'CmdFriendApply') return mgr.getTlCmdFriendApply() ?? [];
        return mgr.getTlCmdFriendBlack() ?? [];
    } catch (error) {
        console.warn(`[Friend] 读 ${table} 缓存失败`, error);
        return [];
    }
}

/** 读 `CmdRole` 的第一行；拿不到返回 `null`。 */
function readRole(): unknown {
    try {
        const rows = CacheMgr.instance.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (row) return row;
        }
    } catch (error) {
        console.warn('[Friend] 读 CmdRole 缓存失败', error);
    }
    return null;
}

/** 生产环境 Repository。 */
export class RuntimeFriendRepository implements IFriendRepository {
    /** 推荐 / 搜索结果（**内存**，老端 `ModelFriend.suggestList`）。 */
    private suggestRaw: unknown[] = [];

    /** 我申请过谁（**内存**，老端 `ModelFriend.applyList`）。 */
    private readonly appliedIds = new Set<string>();

    /** 服务端 Rsp 回带、但不会另推的字段补丁（见类头注释）。 */
    private readonly localPatches = new Map<string, IFriendPatch>();

    async load(nowMs: number = Date.now()): Promise<IFriendSnapshot> {
        const configRows = await readRows('gameConfig');
        const config = configRows.length > 0 ? parseFriendConfig(configRows) : FRIEND_CONFIG_DEFAULTS;

        const role = readRole();
        const counters = readFriendCounters(role);
        const selfId = toIdString((role as { id?: unknown } | null)?.id);
        const selfName = typeof (role as { name?: unknown } | null)?.name === 'string'
            ? ((role as { name: string }).name)
            : '';

        const friendRows = this.readPatchedRows('CmdFriend');
        const applyRows = normalizeFriendRows(readCacheRows('CmdFriendApply'));
        const blackRows = normalizeFriendRows(readCacheRows('CmdFriendBlack'));
        const suggestRows = normalizeFriendRows(this.suggestRaw);

        // 赠送 / 领取次数的「已用」部分：优先用 `CmdRole` 的计数字段（老端 `ModelRole.GetSendEndCount()`）；
        // 字段缺失（老服务端 / 缓存还没到）时才退回「列表里 today* 的统计」，避免整块显示 0 次。
        const usedSent = counters.sent === null ? sentCount(friendRows) : counters.sent;
        const usedTaken = counters.taken === null ? takenCount(friendRows) : counters.taken;

        return {
            friendRows,
            applyRows,
            blackRows,
            suggestRows,
            appliedIds: new Set<string>(this.appliedIds),
            config,
            leftSendTimes: leftTimes(config.sendEndTimes, usedSent),
            leftGetTimes: leftTimes(config.takeEndTimes, usedTaken),
            selfId,
            selfName,
            now: nowMs,
        };
    }

    // ============================================================
    // 请求
    // ============================================================

    async apply(targetId: string, caller?: object): Promise<FriendRequestResult> {
        const result = await this.request(
            (id) => new RequestFriendsApply({ targetId: id }, caller, () => {
                // 老端在**发之前**就 push 进 applyList（发失败也标成「已申请」）；
                // 这里改成**成功才记** —— 失败时按钮不置灰，还能再点一次。
                this.appliedIds.add(targetId);
            }),
            targetId,
        );
        return result;
    }

    async agree(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendsAdd({ targetId: id }, caller), targetId);
    }

    async refuse(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendsRefuse({ targetId: id }, caller), targetId);
    }

    async remove(targetIds: readonly string[], caller?: object): Promise<FriendRequestResult> {
        const ids = this.cleanIds(targetIds);
        if (ids.length === 0) return 'failed';
        // 本地也把「申请过」的记录清掉：删掉的人不该再显示「已申请」
        for (const id of ids) this.appliedIds.delete(id);
        return this.send(() => new RequestFriendsRemove({ targetId: ids as any }, caller));
    }

    async black(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendsBlack({ targetId: id }, caller), targetId);
    }

    async blackRemove(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendBlackRemove({ targetId: id }, caller), targetId);
    }

    async search(parsed: SearchParse, caller?: object): Promise<FriendRequestResult> {
        if (parsed.kind !== 'id' && parsed.kind !== 'name') return 'failed';
        // 老端 `requetSearch`：**先清空**推荐列表，再把结果 push 进去（搜不到就是空列表）
        this.suggestRaw = [];
        if (parsed.kind === 'id') {
            return this.send(() => new RequestFriendsSearch(
                { targetId: String(parsed.id), targetName: '' },
                caller,
                (rsp: any) => { this.suggestRaw = rsp?.friend ? [rsp.friend] : []; },
            ));
        }
        return this.send(() => new RequestFriendsSearch(
            { targetId: '0', targetName: parsed.name },
            caller,
            (rsp: any) => { this.suggestRaw = rsp?.friend ? [rsp.friend] : []; },
        ));
    }

    async refreshSuggest(caller?: object): Promise<FriendRequestResult> {
        // 老端 `requetRefreshSuggest`：先清空，Rsp 的 `suggestList` 是**全量替换**
        this.suggestRaw = [];
        return this.send(() => new RequestdFriendRefreshSuggest({}, caller, (rsp: any) => {
            this.suggestRaw = Array.isArray(rsp?.suggestList) ? rsp.suggestList : [];
        }));
    }

    // ---- 体力（领取 / 赠送）—— 这四条的 Rsp 是唯一数据源，要打本地补丁 ----

    async getEnd(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request(
            () => new RequestFriendGetEnd({ targetId }, caller, (rsp: any) => this.patchOne(rsp?.friend)),
            targetId,
        );
    }

    async getEndOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestFriendGetEndOneKey({}, caller, (rsp: any) => this.patchMany(rsp?.friendList)));
    }

    async sendEnd(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request(
            () => new RequestFriendSendEnd({ targetId }, caller, (rsp: any) => this.patchOne(rsp?.friend)),
            targetId,
        );
    }

    async sendEndOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestFriendSendEndOneKey({}, caller, (rsp: any) => this.patchMany(rsp?.friendList)));
    }

    async agreeOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestdFriendAgreeOneKey({}, caller));
    }

    async refuseOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestdFriendRefuseOneKey({}, caller));
    }

    // ============================================================
    // 内部工具
    // ============================================================

    /**
     * 把 `targetId` 过一遍 `toIdString` 再发。
     *
     * ⚠️ 必须发**字符串**：`protoCompiledStatic.ts` 生成的请求类构造函数是**裸赋值**
     * （`this[key] = properties[key]`，不做 `Long.fromValue`），真正的换算在编码时由
     * `LongBits.from` 做 —— 它认 `Long` / `number` / **十进制字符串**，其余形状（普通对象）
     * 会被当成 `zero` ⇒ **id 静默变成 0**。发字符串是唯一稳的口径（`uint64` 超 2^53 也不丢精度）。
     */
    private request(
        make: (id: string) => any,
        targetId: string,
    ): Promise<FriendRequestResult> {
        const id = toIdString(targetId);
        if (!id) return Promise.resolve('failed');
        return this.send(() => make(id));
    }

    private cleanIds(ids: readonly string[]): string[] {
        const out: string[] = [];
        for (const raw of ids) {
            const id = toIdString(raw);
            if (id && !out.includes(id)) out.push(id);
        }
        return out;
    }

    /** 统一的发包 + 三态收口。 */
    private async send(make: () => any): Promise<FriendRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(net.send(make(), false), WRITE_TIMEOUT_MS, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Friend] 请求失败', error);
            return 'failed';
        }
    }

    /** 读一张表，并把本地补丁叠上去（指纹变了就丢补丁，见类头注释）。 */
    private readPatchedRows(table: 'CmdFriend' | 'CmdFriendApply' | 'CmdFriendBlack'): IFriendRow[] {
        const raw = readCacheRows(table);
        const out: IFriendRow[] = [];
        for (const item of raw) {
            const id = toIdString((item as { friendId?: unknown } | null)?.friendId);
            const patch = id ? this.localPatches.get(id) : undefined;
            const picked = pickPatchedCmd(item, patch);
            if (picked.dropPatch && id) this.localPatches.delete(id);
            const row = normalizeFriendRow(picked.cmd);
            if (row) out.push(row);
        }
        return out;
    }

    /** 给一条 `CmdFriend` 打补丁（`baseFingerprint` 记录**当前缓存里**那条的指纹）。 */
    private patchOne(cmd: unknown): void {
        const row = normalizeFriendRow(cmd);
        if (!row) return;
        const cached = this.findCached(row.id);
        this.localPatches.set(row.id, {
            cmd,
            baseFingerprint: cached ? friendFingerprint(cached) : '',
        });
    }

    private patchMany(list: unknown): void {
        if (!Array.isArray(list)) return;
        for (const item of list) this.patchOne(item);
    }

    /** 在 `CmdFriend` 缓存里找一条原始对象（不是归一化后的）。 */
    private findCached(friendId: string): unknown | null {
        for (const item of readCacheRows('CmdFriend')) {
            if (toIdString((item as { friendId?: unknown } | null)?.friendId) === friendId) return item;
        }
        return null;
    }
}

export const friendRepository: IFriendRepository = new RuntimeFriendRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const FRIEND_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const FRIEND_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;
