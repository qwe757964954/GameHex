import { withTimeout } from '../../net/RequestGuard';
import { isBigMapCampId, normalizeBigMapCampInfos, type IBigMapCampInfo } from '../model/BigMapCampInfo';

export interface IBigMapCampGateway {
    fetchSimple(campIds: readonly number[]): Promise<unknown>;
    fetchDetail(campIds: readonly number[]): Promise<unknown>;
}

export const BIGMAP_CAMP_REFRESH_SECONDS = 5;
const READ_TIMEOUT_MS = 5000;

/** 页面级缓存：不落盘，销毁后所有迟到回包失效；网络实现由入口注入。 */
export class BigMapCampRepository {
    private readonly snapshots = new Map<number, IBigMapCampInfo>();
    private readonly appliedRevisions = new Map<number, number>();
    private readonly updatedAt = new Map<number, number>();
    private readonly pending = new Map<string, Promise<boolean>>();
    private revision = 0;
    private isDisposed = false;

    constructor(private readonly gateway: IBigMapCampGateway, private readonly now = Date.now) {}

    get(campId: number): IBigMapCampInfo | null {
        return this.snapshots.get(campId) ?? null;
    }

    refreshSimple(campIds: readonly number[]): Promise<boolean> {
        return this.refresh(campIds, false);
    }

    refreshDetail(campIds: readonly number[]): Promise<boolean> {
        return this.refresh(campIds, true);
    }

    dispose(): void {
        this.isDisposed = true;
        this.snapshots.clear();
        this.pending.clear();
        this.appliedRevisions.clear();
        this.updatedAt.clear();
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
