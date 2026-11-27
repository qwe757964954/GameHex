import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
import { GameNet } from '../../net/GameNet';
import { ScopedNetSender, type ScopedRequestStatus } from '../../net/RequestGuard';
import { bigMapServerInstanceId, bigMapServerUint } from '../model/BigMapServerState';
import type {
    IBigMapSlgGateway, IBigMapSlgRequestBody, IBigMapSlgRequestName, IBigMapSlgRequestOutcome,
} from './BigMapSlgRepository';
import {
    RequestSlgActionUpdate,
    RequestSlgBuild,
    RequestSlgBuildCancel,
    RequestSlgBuildCollect,
    RequestSlgBuildInfo,
    RequestSlgBuildMove,
    RequestSlgBuildUnlockQueue,
    RequestSlgBuildUpgrade,
    RequestSlgGameInfo,
} from './RequestBigMapSlgMsg';

/**
 *同一类问题只吼一次。
 *
 * 为什么必须留下这条日志：请求被拦下时界面只有一句提示，看不出它到底有没有发出去 ——
 * 2026-11-11 用户反馈「放置时提示正在同步、服务器没收到请求」，就是被这层静默挡住的。
 */
const warnedOnce = new Set<string>();
function warnOnce(reason: string): void {
    if (warnedOnce.has(reason)) return;
    warnedOnce.add(reason);
    console.warn(`[BigMap] SLG ${reason}`);
}

/** 复用现有 Socket、缓存与广播分发；会话生命周期交由 ScopedNetSender 管理。 */
export class GameNetBigMapSlgGateway implements IBigMapSlgGateway {
    private readonly sender: ScopedNetSender;

    constructor(isOwnerCurrent: () => boolean = () => true, scope?: ResourceScope) {
        this.sender = new ScopedNetSender(() => GameNet.instance, this, {
            name: 'bigmap-slg-gateway',
            scope,
            isAlive: isOwnerCurrent,
        });
    }

    dispose(): void {
        this.sender.dispose();
    }

    request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<IBigMapSlgRequestOutcome> {
        const allowRetry = name === 'CmdSlgGameInfoReqMsg' || name === 'CmdSlgActionUpdateReqMsg'
            || name === 'CmdSlgBuildInfoReqMsg';
        return this.sender.send(
            (receive) => this.buildRequest(name, body, receive),
            {
                timeoutMs: 5000,
                expiresMs: 5000,
                tag: 'SLG',
                allowRetry,
                onBlock: (status, failure) => {
                    this.reportBlock(name, status, failure);
                },
            },
        );
    }

    private buildRequest(
        name: IBigMapSlgRequestName,
        body: IBigMapSlgRequestBody,
        receive: (rsp: unknown) => void,
    ): RequestMsg<unknown, unknown> {
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
        switch (name) {
            case 'CmdSlgActionUpdateReqMsg': return new RequestSlgActionUpdate({}, this, receive);
            case 'CmdSlgGameInfoReqMsg': return new RequestSlgGameInfo({}, this, receive);
            case 'CmdSlgBuildInfoReqMsg': return new RequestSlgBuildInfo({}, this, receive);
            case 'CmdSlgBuildReqMsg':
                return new RequestSlgBuild({
                    buildingId: uint('buildingId'), position: uint('position'), instant: uint('instant'),
                }, this, receive);
            case 'CmdSlgBuildUpgradeReqMsg':
                return new RequestSlgBuildUpgrade({ buildInstId: id(), instant: uint('instant') }, this, receive);
            case 'CmdSlgBuildCancelReqMsg': return new RequestSlgBuildCancel({ buildInstId: id() }, this, receive);
            case 'CmdSlgBuildMoveReqMsg': return new RequestSlgBuildMove({ buildInstId: id(), position: uint('position') }, this, receive);
            case 'CmdSlgBuildCollectReqMsg': return new RequestSlgBuildCollect({ buildInstIds: ids() }, this, receive);
            case 'CmdSlgBuildUnlockQueueReqMsg': return new RequestSlgBuildUnlockQueue({ queueId: uint('queueId') }, this, receive);
        }
    }

    private reportBlock(
        name: IBigMapSlgRequestName,
        status: Exclude<ScopedRequestStatus, 'ok'>,
        failure: string | null,
    ): void {
        if (status === 'rejected') {
            console.warn(`[BigMap] SLG ${name} 被服务端拒绝：CmdTips 已提示原因，基地快照不变`);
            return;
        }
        if (failure === 'disposed') {
            return;
        }
        if (failure === 'owner_switched') {
            warnOnce('存档已切换 / 页面已关闭：请求没有发出');
            return;
        }
        if (failure === 'offline') {
            warnOnce('网络未连接：请求没有发出');
            return;
        }
        if (failure === 'cancelled' || failure === 'send fail') {
            warnOnce(`发送失败 ${name}（${failure}）：请求没有发出`);
            return;
        }
        if (failure === 'owner_changed') {
            warnOnce('存档已切换 / 页面已关闭：回包不交付');
            return;
        }
        warnOnce(`未确认 ${name}（${failure ?? '超时 / 无回包'}）：回包没到，服务端可能已执行`);
    }
}
