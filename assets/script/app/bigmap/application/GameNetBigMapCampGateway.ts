import { sendGameRequest } from '../../net/RequestGuard';
import { GameNet } from '../../net/GameNet';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
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
        return this.send((receive) => new RequestSlgCampSimpleInfo(
            { campIds: [...campIds] }, this, receive,
        ));
    }

    async fetchDetail(campIds: readonly number[]): Promise<unknown> {
        return this.send((receive) => new RequestSlgCampInfo(
            { campIds: [...campIds] }, this, receive,
        ));
    }

    async fetchRoles(campId: number): Promise<unknown> {
        return this.send((receive) => new RequestSlgCampRoleInfos({ campId }, this, receive));
    }

    async requestMove(body: IBigMapCampMoveRequest): Promise<unknown> {
        return this.send((receive) => {
            const request = new RequestSlgCampMove(
                { campId: body.campId, pos: body.pos, moveType: body.moveType },
                this,
                receive,
            );
            //迁城是写操作：重发可能真的执行两次（服务端按先到先得或直接拒），
            //与「领取/建造」同一口径 —— 关掉超时重发与重连恢复，失败只让上层重拉事实。
            request.allowRetry = false;
            return request;
        }, 5000);
    }

    /** 读/写共用的连接守卫、owner 守卫与回包有效性收口。 */
    private async send<CmdReqMsg, CmdRspMsg>(
        make: (receive: (rsp: unknown) => void) => RequestMsg<CmdReqMsg, CmdRspMsg>,
        expiresMs?: number,
    ): Promise<unknown> {
        if (this.isDisposed || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const status = await sendGameRequest(GameNet.instance, () => {
            const request = make((rsp) => { response = rsp; });
            if (expiresMs !== undefined) {
                const expiresAt = Date.now() + expiresMs;
                request.canSend = () => !this.isDisposed && this.isOwnerCurrent() && Date.now() < expiresAt;
            }
            return request;
        }, { timeoutMs: expiresMs, tag: 'BigMapCamp' });
        return status === 'ok' && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

}
