import { GameNet } from '../../net/GameNet';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
import type { IBigMapSlgGateway, IBigMapSlgRequestBody, IBigMapSlgRequestName } from './BigMapSlgRepository';
import { bigMapServerInstanceId, bigMapServerUint } from '../model/BigMapServerState';
import {
    RequestSlgActionUpdate, RequestSlgGameInfo, RequestSlgBuildInfo, RequestSlgBuild, RequestSlgBuildUpgrade,
    RequestSlgBuildCancel, RequestSlgBuildMove, RequestSlgBuildCollect, RequestSlgBuildUnlockQueue,
} from './RequestBigMapSlgMsg';

/** 复用现有 Socket、缓存与广播分发；页面生命周期由 Repository 管理。 */
export class GameNetBigMapSlgGateway implements IBigMapSlgGateway {
    constructor(private readonly isOwnerCurrent: () => boolean) {}

    async request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected || !this.isOwnerCurrent()) return null;
        let response: unknown = null;
        const receive = (rsp: unknown): void => { if (this.isOwnerCurrent()) response = rsp; };
        const uint = (key: string): number => {
            const value = bigMapServerUint(body[key]);
            if (value === null) throw new Error(`[SLG] 非法请求字段 ${key}`);
            return value;
        };
        const id = (): number => {
            const value = bigMapServerInstanceId(body.buildInstId);
            if (!value) throw new Error('[SLG] 非法建筑实例 ID');
            return value;
        };
        /** 批量领取的实例列表：空数组、越界或非数字都拒绝，不编码截断。 */
        const ids = (): number[] => {
            const raw = body.buildInstIds;
            if (!Array.isArray(raw) || raw.length === 0) throw new Error('[SLG] 非法建筑实例 ID');
            return raw.map((value) => {
                const instanceId = bigMapServerInstanceId(value);
                if (!instanceId) throw new Error('[SLG] 非法建筑实例 ID');
                return instanceId;
            });
        };
        let request: RequestMsg<unknown, unknown>;
        switch (name) {
            case 'CmdSlgActionUpdateReqMsg': request = new RequestSlgActionUpdate({}, undefined, receive); break;
            case 'CmdSlgGameInfoReqMsg': request = new RequestSlgGameInfo({}, undefined, receive); break;
            case 'CmdSlgBuildInfoReqMsg': request = new RequestSlgBuildInfo({}, undefined, receive); break;
            case 'CmdSlgBuildReqMsg':
                request = new RequestSlgBuild({
                    buildingId: uint('buildingId'), position: uint('position'), instant: uint('instant'),
                }, undefined, receive);
                break;
            case 'CmdSlgBuildUpgradeReqMsg':
                request = new RequestSlgBuildUpgrade({ buildInstId: id(), instant: uint('instant') }, undefined, receive);
                break;
            case 'CmdSlgBuildCancelReqMsg': request = new RequestSlgBuildCancel({ buildInstId: id() }, undefined, receive); break;
            case 'CmdSlgBuildMoveReqMsg': request = new RequestSlgBuildMove({ buildInstId: id(), position: uint('position') }, undefined, receive); break;
            case 'CmdSlgBuildCollectReqMsg': request = new RequestSlgBuildCollect({ buildInstIds: ids() }, undefined, receive); break;
            case 'CmdSlgBuildUnlockQueueReqMsg': request = new RequestSlgBuildUnlockQueue({ queueId: uint('queueId') }, undefined, receive); break;
        }
        const expiresAt = Date.now() + 5000;
        request.canSend = () => this.isOwnerCurrent() && Date.now() < expiresAt;
        request.allowRetry = name === 'CmdSlgGameInfoReqMsg' || name === 'CmdSlgActionUpdateReqMsg'
            || name === 'CmdSlgBuildInfoReqMsg';
        const sent = await net.send(request, false);
        return sent && this.isOwnerCurrent() ? response : null;
    }

    subscribe(listener: (kind: 'game' | 'build') => void): () => void {
        const net = GameNet.instance;
        const caller: destroyable = { destroyed: false, destroy() { this.destroyed = true; } };
        const game = (): void => { if (this.isOwnerCurrent()) listener('game'); };
        const build = (): void => { if (this.isOwnerCurrent()) listener('build'); };
        net.addEvent('CmdSlgGameInfoBroMsg', caller, game);
        net.addEvent('CmdSlgBuildInfoBroMsg', caller, build);
        net.addEvent('reconnectSuccessAndLogin', caller, game);
        return () => {
            net.removeCallerEvent(caller);
            caller.destroy();
        };
    }
}
