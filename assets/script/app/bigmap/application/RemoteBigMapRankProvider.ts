import { GameNet } from '../../net/GameNet';
import { toCount, toIdString, withTimeout } from '../../net/RequestGuard';
import { RequestGetRank } from '../../generated/requestMsg/RequestRankMsg';
import { CmdRankType } from '../../generated/netProto/CmdInterface';
import type { IBigMapCityRankBoard, IBigMapCityRankEntry, IBigMapRankProvider } from '../model/BigMapRank';

/** 当前查看城池的服务端伤害榜；换城、超时及退出均释放真实请求归属。 */
export class RemoteBigMapRankProvider implements IBigMapRankProvider {
    private revision = 0;
    private isDisposed = false;
    private pending: { cityId: number; task: Promise<IBigMapCityRankBoard | null> } | null = null;

    constructor(private readonly roleId: string, private readonly isOwnerCurrent: () => boolean,
        private readonly timeoutMs = 5000) {}

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.revision += 1;
        GameNet.instance.removeCaller(this);
        this.pending = null;
    }

    fetchCityRank(cityId: number): Promise<IBigMapCityRankBoard | null> {
        if (this.isDisposed || !this.isOwnerCurrent() || !GameNet.instance.isConnected) return Promise.resolve(null);
        if (this.pending?.cityId === cityId) return this.pending.task;
        GameNet.instance.removeCaller(this);
        const revision = ++this.revision;
        const task = this.load(cityId, revision).finally(() => {
            if (revision === this.revision) this.pending = null;
        });
        this.pending = { cityId, task };
        return task;
    }

    private async load(cityId: number, revision: number): Promise<IBigMapCityRankBoard | null> {
        const net = GameNet.instance;
        let info: CmdRankData | null = null;
        // 53 的 type 承载 campId；unionId 是联盟上下文，此榜不传。
        const request = new RequestGetRank({ rankType: CmdRankType.SLG_CAMP_ROLE_HARM_RANK, showNum: 50, type: cityId },
            this, (rsp) => { info = rsp.rankInfo ?? null; });
        const expiresAt = Date.now() + this.timeoutMs;
        request.canSend = () => !this.isDisposed && revision === this.revision
            && this.isOwnerCurrent() && Date.now() < expiresAt;
        request.allowRetry = false;
        const sent = await withTimeout(net.send(request, false), this.timeoutMs, () => false);
        if (revision === this.revision) net.removeCaller(this);
        if (this.isDisposed || revision !== this.revision || !this.isOwnerCurrent()) return null;
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
