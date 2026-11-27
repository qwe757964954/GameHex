import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
import { GameNet } from '../../net/GameNet';
import { ScopedNetSender, type ScopedRequestOutcome } from '../../net/RequestGuard';
import type { IBigMapCampMoveRequest } from '../model/BigMapCampMove';
import type { IBigMapCampGateway } from './BigMapCampRepository';
import {
    RequestSlgCampInfo,
    RequestSlgCampMove,
    RequestSlgCampRoleInfos,
    RequestSlgCampSimpleInfo,
} from './RequestBigMapCampMsg';

/** 复用游戏服 socket 与消息队列，会话生命周期交由 ScopedNetSender 管理。 */
export class GameNetBigMapCampGateway implements IBigMapCampGateway {
    private readonly sender: ScopedNetSender;

    constructor(isOwnerCurrent: () => boolean = () => true, scope?: ResourceScope) {
        this.sender = new ScopedNetSender(() => GameNet.instance, this, {
            name: 'bigmap-camp-gateway',
            scope,
            isAlive: isOwnerCurrent,
        });
    }

    dispose(): void {
        this.sender.dispose();
    }

    fetchSimple(campIds: readonly number[]): Promise<unknown> {
        return this.fetch((receive) => new RequestSlgCampSimpleInfo({ campIds: [...campIds] }, this, receive));
    }

    fetchDetail(campIds: readonly number[]): Promise<unknown> {
        return this.fetch((receive) => new RequestSlgCampInfo({ campIds: [...campIds] }, this, receive));
    }

    fetchRoles(campId: number): Promise<unknown> {
        return this.fetch((receive) => new RequestSlgCampRoleInfos({ campId }, this, receive));
    }

    requestMove(body: IBigMapCampMoveRequest): Promise<ScopedRequestOutcome> {
        //迁城是写操作：重发可能真的执行两次（服务端按先到先得或直接拒），
        //与「领取/建造」同一口径 —— 关掉超时重发与重连恢复，并保留四态以区分 CmdTips 拒单。
        return this.sender.send(
            (receive) => new RequestSlgCampMove(
                { campId: body.campId, pos: body.pos, moveType: body.moveType },
                this,
                receive,
            ),
            { expiresMs: 5000, tag: 'BigMapCamp', allowRetry: false },
        );
    }

    private async fetch<CmdReqMsg, CmdRspMsg>(
        make: (receive: (rsp: unknown) => void) => RequestMsg<CmdReqMsg, CmdRspMsg>,
    ): Promise<unknown> {
        const outcome = await this.sender.send(make, { tag: 'BigMapCamp' });
        return outcome.status === 'ok' ? outcome.response : null;
    }
}
