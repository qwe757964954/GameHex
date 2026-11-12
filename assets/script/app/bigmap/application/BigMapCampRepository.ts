import { withTimeout } from '../../net/RequestGuard';
import { isBigMapCampId, normalizeBigMapCampInfos, type IBigMapCampInfo } from '../model/BigMapCampInfo';
import { normalizeBigMapCampRoleInfos, type IBigMapCampRoleInfo, type IBigMapRoleEvent } from '../model/BigMapCampRoleInfo';
import {
    BIGMAP_CAMP_MOVE_TEXT,
    BIGMAP_CAMP_MOVE_TYPE,
    isBigMapCampMoveSucceeded,
    normalizeBigMapCampMoveRequest,
    type BigMapCampMoveType,
    type IBigMapCampMoveRequest,
    type IBigMapCampMoveResult,
} from '../model/BigMapCampMove';

export interface IBigMapCampGateway {
    dispose?(): void;
    fetchSimple(campIds: readonly number[]): Promise<unknown>;
    fetchDetail(campIds: readonly number[]): Promise<unknown>;
    /**
     * 据点角色列表（`CmdSlgCampRoleInfosReqMsg`，一次一个 `campId`）。
     *
     * 与 `fetchDetail` 分开：角色是**详情展开后**才需要的附加信息，
     * 和据点状态（占领/开放）来自两条不同协议，任一条失败都不该拖垮另一条。
     */
    fetchRoles(campId: number): Promise<unknown>;
    /** 迁城（`CmdSlgCampMoveReqMsg`）——**写操作**，与上面三条读请求分开走。 */
    requestMove(body: IBigMapCampMoveRequest): Promise<unknown>;

}

export const BIGMAP_CAMP_REFRESH_SECONDS = 5;
const READ_TIMEOUT_MS = 5000;

/** 页面级缓存：不落盘，销毁后所有迟到回包失效；网络实现由入口注入。 */
export class BigMapCampRepository {
    private readonly snapshots = new Map<number, IBigMapCampInfo>();
    private readonly appliedRevisions = new Map<number, number>();
    private readonly updatedAt = new Map<number, number>();
    private readonly pending = new Map<string, Promise<boolean>>();
    private readonly simplePendingIds = new Set<number>();
    /** 在途的简略请求（补发要等它们全部落定，见 `scheduleSimpleFollowUp`）。 */
    private readonly simpleTasks = new Set<Promise<boolean>>();
    /** 被「同批在途」丢掉的那一轮可见集合；只保留最新一份。 */
    private followUpIds: readonly number[] | null = null;
    private followUpQueued = false;
    /** 据点角色列表（`campId` → 该据点内的角色）。空数组是**有效事实**（据点里没人）。 */
    private readonly roleSnapshots = new Map<number, readonly IBigMapCampRoleInfo[]>();
    private readonly roleRevisions = new Map<number, number>();
    /**
     * 角色名单的新鲜度时间戳（与据点状态的 `updatedAt` 分开记：两条协议各自过期）。
     *
     * 视野补发（`refreshRolesFor`）靠它压住流量 —— 地图上按 `pos` 摆玩家标记，名单必须跟着滑动走，
     * 但同一座城在窗口内不许重发，否则一次长拖就是同一批城反复刷屏。
     */
    private readonly roleUpdatedAt = new Map<number, number>();
    /** 正在迁城的据点 id（0 = 空闲）。迁城是写操作，同页串行。 */
    private movingCampId = 0;
    /** 缓存变化监听（Presenter 用它把角色广播转成一次视图重绘）。 */
    private listeners: (() => void)[] = [];
    private revision = 0;
    private isDisposed = false;

    constructor(private readonly gateway: IBigMapCampGateway, private readonly now = Date.now) {}

    get(campId: number): IBigMapCampInfo | null {
        return this.snapshots.get(campId) ?? null;
    }

    /**
     * 已知被占领的据点 id（`opType = 1`）。
     *
     * 只覆盖「客户端刷到过」的据点 —— 服务器不下发全量归属，所以它是**下界**：
     * 用来补 `occupiedCityIds` 判前置城池，不能当成全服占领表。
     */
    occupiedCampIds(): readonly number[] {
        const ids: number[] = [];
        for (const info of this.snapshots.values()) if (info.opType === 1) ids.push(info.campId);
        return ids;
    }

    /** 已缓存的角色列表；`null` = 还没成功查过（与「查过、确实没人」的空数组不同）。 */
    rolesOf(campId: number): readonly IBigMapCampRoleInfo[] | null {
        return this.roleSnapshots.get(campId) ?? null;
    }

    /**
     * 拉某座据点的角色列表。
     *
     * 返回 `true` = 这次真的拿到了（哪怕是空列表）；`false` = 超时/断线/坏包/已销毁 ——
     * 调用方据此决定「维持原样」还是「显示失败」，**不要**用 `false` 去清空已有列表。
     */
    refreshRoles(campId: number, force = false): Promise<boolean> {
        if (this.isDisposed || !isBigMapCampId(campId)) return Promise.resolve(false);
        const key = `roles:${campId}`;
        const pending = this.pending.get(key);
        if (force) this.roleRevisions.set(campId, ++this.revision);
        if (pending) return force ? pending.then(() => this.refreshRoles(campId)) : pending;
        const revision = ++this.revision;
        const request = this.loadRoles(campId, revision).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
        return request;
    }

    /**
     * 视野内据点的**名单补发**（`CmdSlgCampRoleInfosReqMsg`）—— 滑动 / 缩放后由
     * `BigMapModel.refreshVisibleCamps` 调用。
     *
     * 口径（2026-11-11 山猫）：*「据点名单要跟据点信息一样，滑动的时候请求」* ——
     * 因为地图上要按 `role.pos` 摆玩家标记，没名单就没有标记。代价靠两把闸门压住：
     * ① `BIGMAP_CAMP_REFRESH_SECONDS` 新鲜窗口，窗口内同一座城不重发；
     * ② 在途复用 `refreshRoles` 的 `roles:<id>` 锁（拖到某城的同时点开它，也只发一条）。
     *
     * @returns `true` = 本轮至少有一座城真的拿到了名单（空列表也算），调用方据此重绘
     */
    refreshRolesFor(campIds: readonly number[], force = false): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        const window = BIGMAP_CAMP_REFRESH_SECONDS * 1000;
        const due = Array.from(new Set(campIds.filter(isBigMapCampId)))
            .filter((id) => force || this.now() - (this.roleUpdatedAt.get(id) ?? -Infinity) >= window);
        if (due.length === 0) return Promise.resolve(false);
        return Promise.all(due.map((id) => this.refreshRoles(id, force)))
            .then((results) => results.some(Boolean));
    }

    /**
     * 迁城：把 `campId` 这个据点挪到 `pos`。
     *
     * ## 三件必须做对的事
     *
     * 1. **串行**：`movingCampId !== 0` 直接拒 —— 迁城是改「我在哪座城」的写操作，
     *    连点两次第二发必然基于已过期的落点，服务端还可能按先到先得处理。
     * 2. **回包必须属于本次请求**（`isBigMapCampMoveSucceeded` 比 `req` 三项），
     *    否则迟到/串包会被当成功（见 `BigMapCampMove.ts` 文件头）。
     * 3. **失败不清缓存**：一次超时不该把已展示的据点状态、角色列表抹掉，
     *    交给调用方决定重拉（Presenter 成功后本来就会重拉）。
     *
     * 成功后**不在这里**改任何快照 —— 迁城会牵动 `SlgGameInfo.toCampId`（我在哪座城）、
     * 据点状态和据点内角色三处，由调用方统一重拉，避免仓库自己猜新状态。
     */
    async moveCamp(
        campId: number,
        pos: number,
        moveType: BigMapCampMoveType = BIGMAP_CAMP_MOVE_TYPE.Normal,
    ): Promise<IBigMapCampMoveResult> {
        if (this.isDisposed) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.disposed };
        const request = normalizeBigMapCampMoveRequest(campId, pos, moveType);
        if (!request) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.invalid };
        if (this.movingCampId !== 0) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.busy };
        this.movingCampId = request.campId;
        try {
            const response = await withTimeout(
                this.gateway.requestMove(request),
                READ_TIMEOUT_MS,
                () => null,
            );
            if (this.isDisposed) return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.disposed };
            if (!isBigMapCampMoveSucceeded(response, request)) {
                return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.failed };
            }
            return { ok: true, message: BIGMAP_CAMP_MOVE_TEXT.moved };
        } catch {
            return { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.failed };
        } finally {
            this.movingCampId = 0;
        }
    }

    /** 按角色身份跨据点迁移；未查询的目标不补造名单，广播版本阻止旧查询回写。 */
    applyRoleEvent(campId: number, event: IBigMapRoleEvent): boolean {
        if (this.isDisposed || !event) return false;
        let changed = false;
        for (const [oldCampId, roles] of this.roleSnapshots) {
            if (oldCampId === campId) continue;
            const next = roles.filter((role) => role.roleId !== event.role.roleId);
            if (next.length === roles.length) continue;
            this.roleSnapshots.set(oldCampId, next);
            this.roleRevisions.set(oldCampId, ++this.revision);
            changed = true;
        }
        if (isBigMapCampId(campId)) this.roleRevisions.set(campId, ++this.revision);
        const current = this.roleSnapshots.get(campId);
        if (!current) {
            if (changed) this.notify();
            return changed;
        }
        // 两把钥匙同时摘：
        //  · **roleId** —— 这个角色自己的旧记录（`Move` 后 pos 变了，按 pos 找不到它）；
        //  · **pos**     —— 新位置原来站着的人（一格一人，被顶掉的那条必须消失，
        //                  否则列表会同时显示两条 `格 12`，而查询回包是按 pos 去重的 —— 两边不一致）。
        const next = current.filter((role) => role.roleId !== event.role.roleId && role.pos !== event.role.pos);
        next.push(event.role);
        next.sort((a, b) => a.pos - b.pos);
        this.roleSnapshots.set(campId, next);
        this.notify();
        return true;
    }

    /** 缓存变化通知（角色广播是异步来的，视图要靠它重绘）。 */
    onChanged(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((item) => item !== listener);
        };
    }

    private notify(): void {
        for (const listener of this.listeners.slice()) {
            if (this.listeners.includes(listener)) listener();
        }
    }

    refreshSimple(campIds: readonly number[], fullBatch = false): Promise<boolean> {
        return this.refresh(campIds, false, fullBatch);
    }

    refreshDetail(campIds: readonly number[], force = false): Promise<boolean> {
        if (force) {
            const revision = ++this.revision;
            for (const id of campIds) this.appliedRevisions.set(id, revision);
            const key = `detail:${Array.from(new Set(campIds.filter(isBigMapCampId))).sort((a, b) => a - b).join(',')}`;
            const pending = this.pending.get(key);
            if (pending) return pending.then(() => this.refreshDetail(campIds));
        }
        return this.refresh(campIds, true);
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.gateway.dispose?.();
        this.listeners = [];
        this.snapshots.clear();
        this.pending.clear();
        this.simplePendingIds.clear();
        this.simpleTasks.clear();
        this.followUpIds = null;
        this.followUpQueued = false;
        this.appliedRevisions.clear();
        this.updatedAt.clear();
        this.roleSnapshots.clear();
        this.roleRevisions.clear();
        this.roleUpdatedAt.clear();
        this.movingCampId = 0;
    }

    private refresh(campIds: readonly number[], isDetail: boolean, fullBatch = false): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        const ids = Array.from(new Set(campIds.filter(isBigMapCampId))).sort((a, b) => a - b);
        if (ids.length === 0) return Promise.resolve(false);
        // 🔴 只发「没缓存或已过期」的城：视野集合一变（快速滑动/缩放）时，旧城不再跟着重发。
        // 否则 `campIds` 每变一次就把整批城重查一遍 —— 日志里表现为同一批 campId 反复刷屏。
        //
        // 整批刷新（`fullBatch` / 详情）**也要过这道新鲜度闸门**，它只决定「发的时候要不要拆包」，
        // 不决定「要不要发」：只要这一批里没有任何过期/未查过的城，一条都不许发。
        // 以前这里写成 `isDetail || fullBatch ? ids : 过滤`，等于整批刷新把 `updatedAt` 这张
        // 「查过了」的标记整个绕过 ⇒ 视图只要因为裁剪边界抖动重新上报同一批可见据点
        // （`marker.node.active` 翻一下就算「新城进视野」），就又是一条 `CmdSlgCampSimpleInfoReqMsg`。
        const stale = ids.filter((id) => this.now() - (this.updatedAt.get(id) ?? -Infinity)
            >= BIGMAP_CAMP_REFRESH_SECONDS * 1000);
        // 简略包：整批都还新鲜 ⇒ 一条都不发（详情是玩家点出来的，不受简略缓存限制）。
        if (!isDetail && stale.length === 0) return Promise.resolve(false);
        let due = isDetail || fullBatch ? ids : stale;
        let key = `${isDetail ? 'detail' : 'simple'}:${due.join(',')}`;
        const pending = this.pending.get(key);
        if (pending) return pending;
        if (!isDetail) {
            // 可见区域整批刷新不拆集合；重叠请求尚未完成时本轮不发，但**不能就这么丢掉**：
            // 这一轮里新进视野的城在在途那批里没有，丢掉就等于它的 `opType` 永远拿不到
            // （而 `BigMapModel` 的名单预取和本方法同挂一个 `Promise.all`，照样发出去了 ——
            //   日志里就是「Simple 只 3 个城，RoleInfos 却 4 条，其中两座城不在这次可见集合里」）。
            // 兜法：登记这次被丢的可见集合，等在途落地后按**最新**集合补一轮；
            // 补发同样过上面的新鲜度闸门，所以在途那批已经覆盖到的城不会再发一遍。
            if (fullBatch && due.some((id) => this.simplePendingIds.has(id))) {
                this.scheduleSimpleFollowUp(ids);
                return Promise.resolve(false);
            }
            due = due.filter((id) => !this.simplePendingIds.has(id));
            if (due.length === 0) return Promise.resolve(false);
            key = `simple:${due.join(',')}`;
            for (const id of due) this.simplePendingIds.add(id);
        }
        const revision = ++this.revision;
        const request = this.load(due, isDetail, revision).finally(() => {
            this.pending.delete(key);
            if (!isDetail) for (const id of due) this.simplePendingIds.delete(id);
        });
        this.pending.set(key, request);
        if (!isDetail) {
            this.simpleTasks.add(request);
            const release = (): void => { this.simpleTasks.delete(request); };
            void request.then(release, release);
        }
        return request;
    }

    /**
     * 被「同批在途」丢掉的那一轮可见集合，等在途落地后按**最新**集合补发一次。
     *
     * 只补一次、只保留最新集合：补发时照样走上面的新鲜度闸门，在途那批已经覆盖到的城不会再发；
     * `load` 自带 5s 硬超时，`waitSimpleIdle()` 不会永久挂住。
     */
    private scheduleSimpleFollowUp(ids: readonly number[]): void {
        this.followUpIds = ids;
        if (this.followUpQueued) return;
        this.followUpQueued = true;
        void this.waitSimpleIdle().then(() => {
            this.followUpQueued = false;
            const next = this.followUpIds;
            this.followUpIds = null;
            if (next == null || this.isDisposed) return;
            void this.refresh(next, false, true);
        });
    }

    private async waitSimpleIdle(): Promise<void> {
        while (this.simpleTasks.size > 0) await Promise.all([...this.simpleTasks]);
    }

    private async loadRoles(campId: number, revision: number): Promise<boolean> {
        try {
            const response = await withTimeout(this.gateway.fetchRoles(campId), READ_TIMEOUT_MS, () => null);
            if (this.isDisposed) return false;
            const infos = normalizeBigMapCampRoleInfos(response, campId);
            // `null` = 整包不可用（超时 / 串包 / 结构坏）⇒ 保留旧快照，别把列表抹空。
            if (!infos) return false;
            if (revision < (this.roleRevisions.get(campId) ?? 0)) return false;
            this.roleSnapshots.set(campId, infos);
            this.roleRevisions.set(campId, revision);
            // 只有真的拿到包才刷新时间戳：超时 / 坏包不该把这座城顶进「刚查过」，
            // 否则滑动时它要再等一个窗口才有机会补上。
            this.roleUpdatedAt.set(campId, this.now());
            return true;
        } catch {
            return false;
        }
    }

    private async load(ids: readonly number[], isDetail: boolean, revision: number): Promise<boolean> {
        try {
            const response = await withTimeout(
                isDetail ? this.gateway.fetchDetail(ids) : this.gateway.fetchSimple(ids),
                READ_TIMEOUT_MS, () => null,
            );
            if (this.isDisposed) return false;
            const infos = normalizeBigMapCampInfos(response, isDetail);
            if (!infos) return false;
            const requested = new Set(ids);
            let received = false;
            for (const info of infos) {
                if (!requested.has(info.campId)) continue;
                received = true;
                if (revision < (this.appliedRevisions.get(info.campId) ?? 0)) continue;
                this.snapshots.set(info.campId, this.merge(info));
                this.appliedRevisions.set(info.campId, revision);
                this.updatedAt.set(info.campId, this.now());
            }
            return received;
        } catch {
            return false;
        }
    }

    /**
     * 简略包只覆盖 `opType`，详情包整条替换。
     *
     * 两份协议字段不同：简略包没有占领者。直接 `set` 会让一次可见范围刷新把已经查到的
     * 占领者名字抹掉（表现为「弹窗刷新一下就变成未占领 · 无名」）。
     */
    private merge(next: IBigMapCampInfo): IBigMapCampInfo {
        const old = this.snapshots.get(next.campId);
        if (next.detailed || !old) return next;
        return {
            ...old,
            campId: next.campId,
            opType: next.opType,
            // 简略包说「没人占」时占领者必须跟着清空，否则留下「未占领 · 张三」的僵尸字段。
            occupyRoleId: next.opType === 1 ? old.occupyRoleId : '',
            occupyRoleName: next.opType === 1 ? old.occupyRoleName : '',
        };
    }
}
