import { ScriptObject } from "../base/ScriptObject";
import type { ICallbackOwnerRegistry } from '../../core/runtime/CallbackOwner';
import { RequestMsg } from "./RequestMsg";

export class NetworkRequest<CmdReqMsg, CmdRspMsg> extends ScriptObject {
    public static __cname: string = "NetworkRequest";
    /**命令名称 */
    public messageName: string;
    /**命令序号 */
    public index: number;
    /**发送的数据 */
    public data: Uint8Array;
    /**使用中 */
    public isInUse: boolean;
    public timeStamp: number;
    /**服务器时间 */
    public serverTime: number;
    /**异步 */
    public promise: Promise<boolean>;
    /**成功回调 */
    public resolve: Function;
    /**失败回调 */
    public reject: Function;
    // private reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>;

    cancelled = false;
    private cancelCallback: (() => void) | null = null;

    needLoading = true;
    allowRetry = true;
    canSend: (() => boolean) | null = null;

    destroy() {
        this.cancel();
        // this.messageName = null;
        // this.index = null;
        this.data = null;
        this.isInUse = false;
        this.timeStamp = null;
        this.serverTime = null;
        this.promise = null;
        this.resolve = null;
        this.reject = null;
        this.needLoading = null
        this.canSend = null;
        // this.reqMsg = null
    }

    public packageRequest(
        index: number, data: Uint8Array, reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>, needLoading = true,
        owners?: ICallbackOwnerRegistry,
    ): void {
        if (reqMsg.caller && !owners) throw new Error('请求宿主必须注册到回调归属端口');
        this.messageName = reqMsg.getReqMsgProtoName();
        this.needLoading = needLoading;
        this.index = index;
        this.data = data;
        this.isInUse = true;
        this.cancelled = false;
        this.allowRetry = reqMsg.allowRetry;
        this.canSend = reqMsg.canSend;
        reqMsg.canSend = null;
        let callback = reqMsg.fCallback;
        let errorCallback = reqMsg.fErrorCallback;
        let caller = reqMsg.caller;
        reqMsg.fCallback = null;
        reqMsg.fErrorCallback = null;
        reqMsg.caller = null;
        const profiler = window['ModelCollectTimeConsumingLog'];
        const startedAt = Date.now();
        let stopOwner: (() => void) | null = null;
        let settled = false;
        const release = (): void => {
            callback = null;
            errorCallback = null;
            caller = null;
            this.cancelCallback = null;
            const stop = stopOwner;
            stopOwner = null;
            stop?.();
        };
        this.promise = new Promise<boolean>((resolve) => {
            this.cancelCallback = (): void => {
                if (settled) return;
                settled = true;
                this.cancelled = true;
                this.allowRetry = false;
                this.canSend = null;
                release();
                resolve(false);
            };
            this.resolve = (rsp: CmdRspMsg): void => {
                if (settled) { if (this.cancelled) this.returnToPool(); return; }
                settled = true;
                try {
                    if (profiler) profiler.collectLog({ timeStamp: startedAt, logType: 'net', info: this.messageName,
                        timeConsuming: Date.now() - startedAt });
                    if (callback && (!caller || !(('destroyed' in caller && caller.destroyed === true)
                        || ('disabled' in caller && caller.disabled === true)))) {
                        callback.call(caller, rsp);
                    }
                } finally {
                    release();
                    resolve(true);
                    this.returnToPool();
                }
            };
            this.reject = (message: string): void => {
                if (settled) { if (this.cancelled) this.returnToPool(); return; }
                settled = true;
                try {
                    if (errorCallback && (!caller || !(('destroyed' in caller && caller.destroyed === true)
                        || ('disabled' in caller && caller.disabled === true)))) {
                        errorCallback.call(caller, message);
                    }
                } finally {
                    release();
                    resolve(false);
                    this.returnToPool();
                }
            };
            if (caller && owners) stopOwner = owners.addCallerCleanup(caller, () => this.cancel());
        });
    }

    /** 只解除回调与等待；已发请求的响应仍由传输层消费公共缓存。 */
    cancel(): void {
        this.cancelCallback?.();
    }

    onReject(errMsg: string) {
        if (!this.reject) {
            return
        }
        this.reject(errMsg);
    }

    onTimeOut() {
        this.onReject("timeout");
    }



    returnToPool() {
        this.destroy();
    }
}
