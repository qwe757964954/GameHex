import { RequestMsg } from '../../../framework/net/RequestMsg';
import { GameNet } from '../../net/GameNet';

export const GUIDE_FUNCTION_ID = 1;

export interface IGuideGateway {
    load(): Promise<CmdFunctionGuideInfo | null>;
    update(completedStepId: string): Promise<boolean>;
    dispose(): void;
}

export class RequestFunctionGuideInfo extends RequestMsg<CmdFunctionGuideInfoReqMsg, CmdFunctionGuideInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdFunctionGuideInfoReqMsg'; }
}

export class RequestFunctionGuideUpdate extends RequestMsg<CmdFunctionGuideUpdateReqMsg, CmdFunctionGuideUpdateRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdFunctionGuideUpdateReqMsg'; }
}

/** 请求按顺序发送，避免快速推进时较旧的进度最后抵达服务端。 */
export class GameNetGuideGateway implements IGuideGateway {
    private disposed = false;
    private pending: Promise<unknown> = Promise.resolve();

    load(): Promise<CmdFunctionGuideInfo | null> {
        const result = this.read();
        this.pending = result;
        return result;
    }

    update(completedStepId: string): Promise<boolean> {
        const result = this.pending.then(() => this.write(completedStepId));
        this.pending = result;
        return result;
    }

    dispose(): void {
        this.disposed = true;
        GameNet.instance.removeCaller(this);
    }

    private async read(): Promise<CmdFunctionGuideInfo | null> {
        if (this.disposed) return null;
        if (!GameNet.instance.isConnected) {
            console.info('[GuideProto] 游戏服未连接，跳过查询');
            return null;
        }
        const payload: CmdFunctionGuideInfoReqMsg = { funcId: GUIDE_FUNCTION_ID };
        console.info('[GuideProto] 查询请求', JSON.stringify(payload));
        let response: CmdFunctionGuideInfoRspMsg | null = null;
        try {
            const request = new RequestFunctionGuideInfo(payload, this, rsp => {
                response = rsp;
                console.info('[GuideProto] 查询原始回包（暂不覆盖本地进度）', JSON.stringify(rsp));
            });
            request.canSend = () => !this.disposed;
            const ok = await GameNet.instance.send(request, false);
            if (this.disposed) return null;
            const info = response?.infos;
            if (!ok || !info || info.funcId !== GUIDE_FUNCTION_ID
                || !isUint32(info.step1) || !isUint32(info.step2)) {
                console.warn('[GuideProto] 查询失败或回包字段非法');
                return null;
            }
            return { funcId: info.funcId, step1: info.step1, step2: info.step2 };
        } catch (error) {
            if (!this.disposed) console.warn('[GuideProto] 查询异常', error);
            return null;
        }
    }

    private async write(completedStepId: string): Promise<boolean> {
        if (this.disposed || !GameNet.instance.isConnected) return false;
        const parts = /^(\d+)-(\d+)$/.exec(completedStepId);
        if (!parts) return false;
        const step1 = Number(parts[1]);
        const step2 = Number(parts[2]);
        if (!isUint32(step1) || !isUint32(step2) || step1 === 0 || step2 === 0) return false;
        // 当前按刚完成 stepId 拆分上报；远端恢复等后端确认语义后再启用。
        const payload: CmdFunctionGuideUpdateReqMsg = { info: { funcId: GUIDE_FUNCTION_ID, step1, step2 } };
        console.info(`[GuideProto] 更新请求 localCompletedStep=${completedStepId}`, JSON.stringify(payload));
        let response: CmdFunctionGuideUpdateRspMsg | null = null;
        try {
            const request = new RequestFunctionGuideUpdate(payload, this, rsp => {
                response = rsp;
                console.info('[GuideProto] 更新原始回包', JSON.stringify(rsp));
            });
            request.allowRetry = false;
            request.canSend = () => !this.disposed;
            const ok = await GameNet.instance.send(request, false);
            if (this.disposed) return false;
            const succeeded = ok && response?.succ === 1;
            if (!succeeded) console.warn(`[GuideProto] 更新未确认 localCompletedStep=${completedStepId}`);
            return succeeded;
        } catch (error) {
            if (!this.disposed) console.warn('[GuideProto] 更新异常', error);
            return false;
        }
    }
}

function isUint32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
