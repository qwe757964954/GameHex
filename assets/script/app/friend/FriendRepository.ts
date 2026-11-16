/**
 * 「好友」的数据端口：缓存 + 配置表 + 网络请求。
 *
 * 页面只依赖本文件的接口，判定逻辑全在 `FriendTable`（纯函数、可单测），
 * 本文件只负责把数据搬进来、把请求发出去。
 *
 * 数据来源：
 *   - `CmdFriend` / `CmdFriendApply` / `CmdFriendBlack`：服务端推的缓存，每次 `load()` 现读
 *     `CacheMgr`，不另存快照；
 *   - `CmdRole`：自身 id / 名字 + 今日已赠送 / 已领取次数；
 *   - `gameConfig`：7 个 `friend*` 上限；
 *   - 推荐列表 / 我申请过谁：只在 Rsp 或纯客户端状态里，没有推送，所以本类自己存（仅本会话有效）。
 *
 * 领取 / 赠送体力这几条请求的 Rsp 回带数据不会另外推，`GameCache` 也没有公开的 upsert 接口，
 * 因此 Rsp 结果存进 `localPatches`，用指纹（`FriendTable.pickPatchedCmd`）判断何时作废。
 *
 * 请求统一三态 `'ok' | 'offline' | 'failed'`：离线早退、写请求 `withTimeout` 兜底，
 * `catch` 一律返 `'failed'` —— `GameNet.send` 没有按请求的超时，服务端不回应就永悬。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toIdString, withTimeout } from '../net/RequestGuard';
import {
    friendFingerprint,
    IFriendConfig,
    IFriendPatch,
    IFriendRow,
    leftTimes,
    normalizeFriendRow,
    normalizeFriendRows,
    parseFriendConfig,
    pickPatchedCmd,
    readFriendCounters,
    SearchParse,
    sentCount,
    takenCount,
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
    /** 「添加好友」页签（内存：推荐 / 搜索）。 */
    readonly suggestRows: readonly IFriendRow[];
    /** 我申请过谁的集合（内存）。「添加好友」页签的按钮据此置灰。 */
    readonly appliedIds: ReadonlySet<string>;
    readonly config: IFriendConfig;
    /** 今日还可赠送次数（上限 - `CmdRole.sendFriendEndCount`）。 */
    readonly leftSendTimes: number;
    /** 今日还可领取次数（上限 - `CmdRole.takeFriendEndCount`）。 */
    readonly leftGetTimes: number;
    /** 自己（搜索自己时老端会拦一道「不能搜索自己」）。 */
    readonly selfId: string;
    readonly selfName: string;
    /** 这次快照的时间基准（毫秒）——「离线多久」按它算。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type FriendRequestResult = 'ok' | 'offline' | 'failed';

export interface IFriendRepository {
    /** 读缓存 + 读表，组装一次快照；不发任何请求。 */
    load(nowMs?: number): Promise<IFriendSnapshot>;

    /** 好友申请（对方会收到一条申请）。 */
    apply(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 通过别人的申请。 */
    agree(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 拒绝别人的申请。 */
    refuse(targetId: string, caller?: object): Promise<FriendRequestResult>;
    /** 删除好友（批量，唯一一个数组请求体）。 */
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

/** 写请求超时（与礼包 / 首充 / 七日同口径）。 */
const WRITE_TIMEOUT_MS = 5000;

/** 读一张配置表的全部行；表缺失（`getRefAllAsync` 可能返回 undefined）时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读缓存里一张表的全部行。缓存访问异常时只告警，不向上抛。 */
function readCacheRows(table: 'CmdFriend' | 'CmdFriendApply' | 'CmdFriendBlack'): unknown[] {
    try {
        const cache = CacheMgr.instance;
        if (table === 'CmdFriend') return cache.getTlCmdFriend();
        if (table === 'CmdFriendApply') return cache.getTlCmdFriendApply();
        return cache.getTlCmdFriendBlack();
    } catch (error) {
        console.warn(`[Friend] 读 ${table} 缓存失败`, error);
        return [];
    }
}

/** 读 `CmdRole` 的第一行；拿不到返回 `null`。 */
function readRole(): unknown {
    try {
        for (const row of CacheMgr.instance.getTlCmdRole()) {
            if (row) return row;
        }
    } catch (error) {
        console.warn('[Friend] 读 CmdRole 缓存失败', error);
    }
    return null;
}

/** 生产环境 Repository。 */
export class RuntimeFriendRepository implements IFriendRepository {
    /** 推荐 / 搜索结果（内存）。 */
    private suggestRaw: unknown[] = [];

    /** 我申请过谁（内存）。 */
    private readonly appliedIds = new Set<string>();

    /** 服务端 Rsp 回带、但不会另推的字段补丁（见文件头）。 */
    private readonly localPatches = new Map<string, IFriendPatch>();

    async load(nowMs: number = Date.now()): Promise<IFriendSnapshot> {
        const config = parseFriendConfig(await readRows('gameConfig'));

        const role = readRole() as { readonly id?: unknown; readonly name?: unknown } | null;
        const selfId = toIdString(role?.id);
        const selfName = typeof role?.name === 'string' ? role.name : '';

        const friendRows = this.readPatchedRows('CmdFriend');
        const applyRows = normalizeFriendRows(readCacheRows('CmdFriendApply'));
        const blackRows = normalizeFriendRows(readCacheRows('CmdFriendBlack'));
        const suggestRows = normalizeFriendRows(this.suggestRaw);

        // 「已用」优先取 `CmdRole` 的计数字段；字段缺失（老服务端 / 缓存还没到）时
        // 退回列表里 today* 的统计，避免整块显示 0 次。
        const counters = readFriendCounters(role);
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
        return this.request(
            (id) => new RequestFriendsApply({ targetId: id }, caller, () => {
                // 老端在发之前就 push 进 applyList（发失败也标成「已申请」）；
                // 这里成功才记 —— 失败时按钮不置灰，还能再点一次。
                this.appliedIds.add(targetId);
            }),
            targetId,
        );
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
        return this.send(() => new RequestFriendsRemove({ targetId: ids }, caller));
    }

    async black(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendsBlack({ targetId: id }, caller), targetId);
    }

    async blackRemove(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request((id) => new RequestFriendBlackRemove({ targetId: id }, caller), targetId);
    }

    async search(parsed: SearchParse, caller?: object): Promise<FriendRequestResult> {
        if (parsed.kind !== 'id' && parsed.kind !== 'name') return 'failed';
        // 先清空推荐列表，再把结果放进去（搜不到就是空列表）
        this.suggestRaw = [];
        const body = parsed.kind === 'id'
            ? { targetId: String(parsed.id), targetName: '' }
            : { targetId: '0', targetName: parsed.name };
        return this.send(() => new RequestFriendsSearch(body, caller, (rsp) => {
            this.suggestRaw = rsp?.friend ? [rsp.friend] : [];
        }));
    }

    async refreshSuggest(caller?: object): Promise<FriendRequestResult> {
        // 先清空；Rsp 的 `suggestList` 是全量替换
        this.suggestRaw = [];
        return this.send(() => new RequestdFriendRefreshSuggest({}, caller, (rsp) => {
            this.suggestRaw = Array.isArray(rsp?.suggestList) ? rsp.suggestList : [];
        }));
    }

    // ---- 体力（领取 / 赠送）：这四条的 Rsp 是唯一数据源，要打本地补丁 ----

    async getEnd(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request(
            () => new RequestFriendGetEnd({ targetId }, caller, (rsp) => this.patchOne(rsp?.friend)),
            targetId,
        );
    }

    async getEndOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestFriendGetEndOneKey({}, caller, (rsp) => this.patchMany(rsp?.friendList)));
    }

    async sendEnd(targetId: string, caller?: object): Promise<FriendRequestResult> {
        return this.request(
            () => new RequestFriendSendEnd({ targetId }, caller, (rsp) => this.patchOne(rsp?.friend)),
            targetId,
        );
    }

    async sendEndOneKey(caller?: object): Promise<FriendRequestResult> {
        return this.send(() => new RequestFriendSendEndOneKey({}, caller, (rsp) => this.patchMany(rsp?.friendList)));
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
     * 必须发字符串：生成的请求类构造函数是裸赋值，真正的换算在编码时由 `LongBits.from`
     * 做 —— 它认 `Long` / `number` / 十进制字符串，其余形状（普通对象）会被当成 zero，
     * id 就静默变成 0。发字符串是唯一稳的口径（`uint64` 超 2^53 也不丢精度）。
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
            const sent = await withTimeout(net.send(make(), false), WRITE_TIMEOUT_MS, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Friend] 请求失败', error);
            return 'failed';
        }
    }

    /** 读一张表，并把本地补丁叠上去（指纹变了就丢补丁，见文件头）。 */
    private readPatchedRows(table: 'CmdFriend' | 'CmdFriendApply' | 'CmdFriendBlack'): IFriendRow[] {
        const out: IFriendRow[] = [];
        for (const item of readCacheRows(table)) {
            const id = toIdString((item as { friendId?: unknown } | null)?.friendId);
            const patch = id ? this.localPatches.get(id) : undefined;
            const picked = pickPatchedCmd(item, patch);
            if (picked.dropPatch && id) this.localPatches.delete(id);
            const row = normalizeFriendRow(picked.cmd);
            if (row) out.push(row);
        }
        return out;
    }

    /** 给一条 `CmdFriend` 打补丁（`baseFingerprint` 记录当时缓存里那条的指纹）。 */
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

/** 写请求超时给测试用（避免测试里硬编码 5000）。 */
export const FRIEND_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;
