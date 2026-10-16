import { ScriptObject } from "../base/ScriptObject";
import { FW } from './../FW';
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

    needLoading = true;

    destroy() {
        // this.messageName = null;
        // this.index = null;
        this.data = null;
        this.isInUse = null;
        this.timeStamp = null;
        this.serverTime = null;
        this.promise = null;
        this.resolve = null;
        this.reject = null;
        this.needLoading = null
        // this.reqMsg = null
    }

    public packageRequest(index: number, data: Uint8Array, reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>, needLoading = true) {
        let t = this;
        t.messageName = reqMsg.getReqMsgProtoName()
        t.needLoading = needLoading
        t.index = index;
        t.data = data;
        t.isInUse = true;
        // t.reqMsg = reqMsg;
        // let win = window
        let logData = null
        let winModel = window["ModelCollectTimeConsumingLog"]
        if (winModel) {
            logData = {
                timeStamp: Date.now(),
                logType: "net",
                info: t.messageName
            }
        }
        t.promise = new Promise<boolean>((resolve, reject) => {
            let fCallback = reqMsg.fCallback;
            let fErrorCallback = reqMsg.fErrorCallback;
            let caller = reqMsg.caller;
            // reqMsg.fCallback = null;
            // reqMsg.fErrorCallback = null;
            t.resolve = (rsp: CmdRspMsg) => {
                if (winModel) {
                    let now = Date.now()
                    let timeConsuming = now - logData.timeStamp
                    logData.timeConsuming = timeConsuming
                    winModel.collectLog(logData)
                }
                // let fCallback = reqMsg.fCallback;
                if (fCallback) {
                    // let caller = reqMsg.caller;
                    if (caller == null) {
                        fCallback(rsp);
                    } else {
                        if (caller.destroyed !== true && caller.disabled !== true) {
                            fCallback.call(caller, rsp)
                        }
                    }
                }
                fCallback = null;
                resolve(true);
                if (t.needLoading || FW.ignoreShowloadingNet.indexOf(t.messageName) == -1) {
                    // t.log("removeLoading:net")
                    // FW.removeLoading()
                }
                t.returnToPool();
            }
            t.reject = (errMsg: string) => {
                // let fErrorCallback = reqMsg.fErrorCallback;
                if (fErrorCallback) {
                    // let caller = reqMsg.caller;
                    if (caller == null) {
                        fErrorCallback(errMsg);
                    } else {
                        if (caller.destroyed !== true && caller.disabled !== true) {
                            fErrorCallback.call(caller, errMsg);
                        }
                    }
                }
                fErrorCallback = null;
                resolve(false);

                if (t.needLoading || FW.ignoreShowloadingNet.indexOf(t.messageName) == -1) {
                    // t.log("removeLoading:net")
                    // FW.removeLoading()
                }
                t.returnToPool();
            }
        });
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