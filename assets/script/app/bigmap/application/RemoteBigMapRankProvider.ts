import { GameNet } from '../../net/GameNet';
import { toCount, toIdString, withTimeout } from '../../net/RequestGuard';
import { RequestGetRank } from '../../generated/requestMsg/RequestRankMsg';
import { CmdRankType } from '../../generated/netProto/CmdInterface';
import type { IBigMapCityRankBoard, IBigMapCityRankEntry, IBigMapRankProvider } from '../model/BigMapRank';

/** 城池伤害榜按城去重并串行查询，共用真实宿主，避免视野预取相互取消。 */
export class RemoteBigMapRankProvider implements IBigMapRankProvider {
    private isDisposed = false;
    private readonly pending = new Map<number, Promise<IBigMapCityRankBoard | null>>();
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly roleId: string, private readonly isOwnerCurrent: () => boolean,
        private readonly timeoutMs = 5000) {}

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        GameNet.instance.removeCaller(this);
        this.pending.clear();
    }

    fetchCityRank(cityId: number): Promise<IBigMapCityRankBoard | null> {
        if (this.isDisposed || !this.isOwnerCurrent() || !GameNet.instance.isConnected) return Promise.resolve(null);
        const pending = this.pending.get(cityId);
        if (pending) return pending;
        const task = this.queue.then(() => this.load(cityId)).finally(() => {
            this.pending.delete(cityId);
        });
        this.pending.set(cityId, task);
        this.queue = task.catch(() => null);
        return task;
    }

    private async load(cityId: number): Promise<IBigMapCityRankBoard | null> {
        const net = GameNet.instance;
        if (this.isDisposed || !this.isOwnerCurrent() || !net.isConnected) return null;
        let info: CmdRankData | null = null;
        // 53 的 type 承载 campId；unionId 是联盟上下文，此榜不传。
        const request = new RequestGetRank({ rankType: CmdRankType.SLG_CAMP_ROLE_HARM_RANK, showNum: 50, type: cityId },
            this, (rsp) => { info = rsp.rankInfo ?? null; });
        const expiresAt = Date.now() + this.timeoutMs;
        request.canSend = () => !this.isDisposed
            && this.isOwnerCurrent() && Date.now() < expiresAt;
        request.allowRetry = false;
        let sent: boolean;
        try {
            sent = await withTimeout(net.send(request, false), this.timeoutMs, () => false);
        } finally {
            net.removeCaller(this);
        }
        if (this.isDisposed || !this.isOwnerCurrent()) return null;
        if (!sent || !info) return null;
        const entry = (role: CmdRankRole): IBigMapCityRankEntry => ({
            roleId: toIdString(role.roleId), name: role.roleName ?? '', avatarId: toIdString(role.roleImg),
            rank: role.rank, warScore: toCount(role.value), isPlayer: toIdString(role.roleId) === this.roleId,
        });
        const entries = (info.rankList ?? []).filter((role) => role.rank > 0).map(entry);
        const mine = info.myRank ? entry(info.myRank) : entries.find((row) => row.isPlayer);
        return {
            cityId, entries, playerRank: mine && mine.rank > 0 ? mine.rank : 0,
            playerWarScore: mine?.warScore ?? 0,
            attackerCount: entries.length, topWarScore: entries[0]?.warScore ?? 0,
        };
    }
}
