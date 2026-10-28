import { GameNet } from '../../net/GameNet';
import type { IBigMapCampGateway } from './BigMapCampRepository';
import type { IBigMapCampMoveRequest } from '../model/BigMapCampMove';
import { normalizeBigMapRoleEvent, type IBigMapRoleEvent } from '../model/BigMapCampRoleInfo';
import {
    RequestSlgCampInfo,
    RequestSlgCampMove,
    RequestSlgCampRoleInfos,
    RequestSlgCampSimpleInfo,
} from './RequestBigMapCampMsg';

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

    async fetchRoles(campId: number): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let response: unknown = null;
        const sent = await net.send(new RequestSlgCampRoleInfos({ campId }, undefined,
            (rsp) => { response = rsp; }), false);
        return sent ? response : null;
    }

    async requestMove(body: IBigMapCampMoveRequest): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let response: unknown = null;
        const request = new RequestSlgCampMove(
            { campId: body.campId, pos: body.pos, moveType: body.moveType },
            undefined,
            (rsp) => { response = rsp; },
        );
        // 迁城是**写操作**：重发可能真的执行两次（服务端按先到先得或直接拒），
        // 与「领取/建造」同一口径 —— 关掉超时重发与重连恢复，失败只让上层重拉事实。
        request.allowRetry = false;
        const sent = await net.send(request, false);
        return sent ? response : null;
    }

    /**
     * 角色事件广播。⚠️ 与另外三条（请求-响应）不同：这是 **push**。
     * 回调第一参是 `ConnectedNetState` 里 `msgEventProxy.execute(name, rspData, socketName)`
     * 直接传下来的解码后消息体 —— 不是无参的失效通知（对比 `GameNetBigMapSlgGateway.subscribe`）。
     */
    subscribeRoleEvents(listener: (event: IBigMapRoleEvent) => void): () => void {
        const net = GameNet.instance;
        const caller: destroyable = { destroyed: false, destroy() { this.destroyed = true; } };
        net.addEvent('CmdSlgGameRoleInfoBroMsg', caller, (message: unknown) => {
            const event = normalizeBigMapRoleEvent(message);
            // 认不出来的事件（未知 eventType / 坏 info）**直接丢**，不能让脏包改缓存。
            if (event) listener(event);
        });
        return () => {
            net.removeCallerEvent(caller);
            caller.destroy();
        };
    }
}
