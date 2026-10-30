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
    /** 据点角色列表（`campId` → 该据点内的角色）。空数组是**有效事实**（据点里没人）。 */
    private readonly roleSnapshots = new Map<number, readonly IBigMapCampRoleInfo[]>();
    private readonly roleRevisions = new Map<number, number>();
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
    refreshRoles(campId: number): Promise<boolean> {
        if (this.isDisposed || !isBigMapCampId(campId)) return Promise.resolve(false);
        const key = `roles:${campId}`;
        const pending = this.pending.get(key);
        if (pending) return pending;
        const revision = ++this.revision;
        const request = this.loadRoles(campId, revision).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
        return request;
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

    refreshSimple(campIds: readonly number[]): Promise<boolean> {
        return this.refresh(campIds, false);
    }

    refreshDetail(campIds: readonly number[]): Promise<boolean> {
        return this.refresh(campIds, true);
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.gateway.dispose?.();
        this.listeners = [];
        this.snapshots.clear();
        this.pending.clear();
        this.appliedRevisions.clear();
        this.updatedAt.clear();
        this.roleSnapshots.clear();
        this.roleRevisions.clear();
        this.movingCampId = 0;
    }

    private refresh(campIds: readonly number[], isDetail: boolean): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        const ids = [...new Set(campIds.filter(isBigMapCampId))].sort((a, b) => a - b);
        const key = `${isDetail ? 'detail' : 'simple'}:${ids.join(',')}`;
        const pending = this.pending.get(key);
        if (pending) return pending;
        if (ids.length === 0) return Promise.resolve(false);
        if (!isDetail && ids.every((id) => this.now() - (this.updatedAt.get(id) ?? -Infinity)
            < BIGMAP_CAMP_REFRESH_SECONDS * 1000)) return Promise.resolve(false);
        const revision = ++this.revision;
        const request = this.load(ids, isDetail, revision).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
        return request;
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
            const infos = normalizeBigMapCampInfos(response);
            if (!infos) return false;
            const requested = new Set(ids);
            let received = false;
            for (const info of infos) {
                if (!requested.has(info.campId)) continue;
                received = true;
                if (revision < (this.appliedRevisions.get(info.campId) ?? 0)) continue;
                this.snapshots.set(info.campId, info);
                this.appliedRevisions.set(info.campId, revision);
                this.updatedAt.set(info.campId, this.now());
            }
            return received;
        } catch {
            return false;
        }
    }
}
