import { GameNet } from '../../net/GameNet';
import type { IBigMapCampGateway } from './BigMapCampRepository';
import { RequestSlgCampInfo, RequestSlgCampSimpleInfo } from './RequestBigMapCampMsg';

/** 复用游戏服 socket 与消息队列，不在 feature 内另开连接。 */
export class GameNetBigMapCampGateway implements IBigMapCampGateway {
    async fetchSimple(campIds: readonly number[]): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampSimpleInfo({ campIds: [...campIds] }, undefined,
            (rsp) => { response = rsp; }), false);
        return sent ? response : null;
    }

    async fetchDetail(campIds: readonly number[]): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampInfo({ campIds: [...campIds] }, undefined,
            (rsp) => { response = rsp; }), false);
        return sent ? response : null;
    }
}
