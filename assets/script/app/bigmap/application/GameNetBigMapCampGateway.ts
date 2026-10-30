import { GameNet } from '../../net/GameNet';
import type { IBigMapCampGateway } from './BigMapCampRepository';
import type { IBigMapCampMoveRequest } from '../model/BigMapCampMove';
import {
    RequestSlgCampInfo,
    RequestSlgCampMove,
    RequestSlgCampRoleInfos,
    RequestSlgCampSimpleInfo,
} from './RequestBigMapCampMsg';

/** 复用游戏服 socket 与消息队列，不在 feature 内另开连接。 */
export class GameNetBigMapCampGateway implements IBigMapCampGateway {
    private isDisposed = false;

    constructor(private readonly isOwnerCurrent: () => boolean = () => true) {}

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        GameNet.instance.removeCaller(this);
    }

    async fetchSimple(campIds: readonly number[]): Promise<unknown> {
        const net = GameNet.instance;
        if (this.isDisposed || !net.isConnected || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampSimpleInfo({ campIds: [...campIds] }, this,
            (rsp) => { response = rsp; }), false);
        return sent && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

    async fetchDetail(campIds: readonly number[]): Promise<unknown> {
        const net = GameNet.instance;
        if (this.isDisposed || !net.isConnected || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampInfo({ campIds: [...campIds] }, this,
            (rsp) => { response = rsp; }), false);
        return sent && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

    async fetchRoles(campId: number): Promise<unknown> {
        const net = GameNet.instance;
        if (this.isDisposed || !net.isConnected || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampRoleInfos({ campId }, this,
            (rsp) => { response = rsp; }), false);
        return sent && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

    async requestMove(body: IBigMapCampMoveRequest): Promise<unknown> {
        const net = GameNet.instance;
        if (this.isDisposed || !net.isConnected || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const request = new RequestSlgCampMove(
            { campId: body.campId, pos: body.pos, moveType: body.moveType },
            this,
            (rsp) => { response = rsp; },
        );
        // 迁城是**写操作**：重发可能真的执行两次（服务端按先到先得或直接拒），
        // 与「领取/建造」同一口径 —— 关掉超时重发与重连恢复，失败只让上层重拉事实。
        request.allowRetry = false;
        const sent = await net.send(request, false);
        return sent && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

}
