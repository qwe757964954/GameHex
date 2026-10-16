import { Container } from "../container/Container";
import { EventProxy } from "../event/EventProxy";
import { FW } from "../FW";
import { TaskQueue } from "../task/TaskQueue";
import { NetSocketBase, NetStateType } from "./NetSocketBase";
import { NetworkRequest } from "./NetworkRequest";
import { ProtoMgr } from "./ProtoMgr";
import { BaseNetState } from "./state/BaseNetState";
import { ConnectedNetState } from "./state/ConnectedNetState";

export class NetSocket extends NetSocketBase {
    public static __cname: string = "NetSocket";
    /**协议事件 */
    private static _msgEventProxy = new EventProxy<string>();
    static get msgEventProxy() {
        return NetSocket._msgEventProxy
    }
    // private _eventProxy: EventProxy<"disconnect" | "error">
    // public get eventProxy() {
    //     return this._eventProxy;
    // }

    static heartbeatMsgName = "CmdSystemSyncTimeReqMsg";
    static heartbeatMsgRspName = "CmdSystemSyncTimeRspMsg";

    /**网络流程任务队列 */
    private _taskQueue: TaskQueue = new TaskQueue();
    get taskQueue(): TaskQueue {
        return this._taskQueue;
    }

    private _protoMgr: ProtoMgr;
    public set protoMgr(protoMgr) {
        this._protoMgr = protoMgr;
    }
    public get protoMgr() {
        return this._protoMgr;
    }
    /**
     * 断线重连弹窗是否正在显示。
     *
     * 源工程里这个值挂在 `GameStateRunning.getShowDisconnect()` 上，通过容器注入拿；
     * Demo3.8 没有 GameStateRunning，改成由业务侧直接赋值（默认 false，与源工程未弹窗时一致）。
     * 语义：弹窗已经弹出来了就别再切 reconnect 状态，避免重复走重连流程。
     */
    public showDisconnectDialog: boolean = false;


    /**成功回调 */
    private resolve: Function
    constructor(socketName: string, container: Container) {
        super(container);
        this._socketName = socketName;
        for (let state of this.tmState.values()) {
            state.socket = this
        }
        NetSocket.msgEventProxy.addListener("reconnectSuccessAndLogin", this, this.sendData)
    }

    destroy() {
        let t = this;
        t._protoMgr = null;
        t._taskQueue = null;
        let resolve = t.resolve;
        if (resolve) {
            resolve(false);
            t.resolve = null;
        }
        NetSocket.msgEventProxy.removeListener("reconnectSuccessAndLogin", this, this.sendData)
    }

    public async connect(): Promise<boolean> {
        let t = this;
        let isOk = await new Promise<boolean>((resolve, reject) => {
            if (t.destroyed) {
                resolve(false);
                return;
            }
            t.resolve = resolve;
            t.switchTo("connecting");
        })
        return isOk;
    }

    public async reconnect(param?): Promise<boolean> {
        let t = this
        let isOk = await new Promise<boolean>((resolve, reject) => {
            if (t.destroyed) {
                resolve(false);
                return;
            }
            t.resolve = resolve;
            t.switchTo("reconnect", param);
        })
        return isOk;
    }

    protected onConnect(e: any): void {
        this.getState().onConnect(e)
    }
    protected onError(e: any): void {
        this.getState().onError()
    }
    protected onClose(e: any): void {
        this.getState().onClose()
    }
    protected onReceiveMessage(mbuffer: Uint8Array): void {
        this.getState().onReceiveMessage(mbuffer)
    }

    protected async onSwitch(from: BaseNetState, to: BaseNetState) {
        if (from == null || to == null) {
            return
        }
        let t = this
        let state = t.getState()
        await state.work()
        if (!state.isSwitchFinish) {
            await new Promise<boolean>((resolve, reject) => {
                while (!state.isSwitchFinish) { }
                resolve(state.isSwitchFinish);
            });
        }
        let lastStateType = from.stateName
        let nextStateType = to.stateName

        //连接成功
        if (lastStateType == "connecting" && nextStateType == "connected") {
            if (t.resolve != null) {
                t.resolve(true)
                t.resolve = null
            }
        }

        // //连接失败
        if (lastStateType == "connecting" && nextStateType == "idle") {
            if (t.resolve != null) {
                t.resolve(false)
                t.resolve = null
                NetSocket.msgEventProxy.execute("connectFail")
            }
        }

        // //连接或者重连中断线
        if (lastStateType == "connected" && nextStateType == "reconnect") {
            /**重连 */
            // //广播一个通知
            let tlRequest = t.tlRequest
            if (tlRequest.length > 0) {
                let len = tlRequest.length
                for (let i = len - 1; i > 0; i--) {
                    let request = tlRequest[i]
                    if (request.messageName === NetSocket.heartbeatMsgName) {
                        tlRequest.splice(i, 1)
                        request.onTimeOut();
                    }
                }
            }
            NetSocket.msgEventProxy.execute("reconnect")
        }


        // //连接或者重连中断线
        if (lastStateType == "connected" && nextStateType == "idle") {
            /**重连 */
            // //广播一个通知
            // this.ClearAllRequest()
            NetSocket.msgEventProxy.execute("disconnect")
        }

        if (lastStateType == "reconnect" && nextStateType == "idle") {
            // 重连失败
            // this.ClearAllRequest()
            // //广播一个通知
            NetSocket.msgEventProxy.execute("connectFail")
            if (t.resolve != null) {
                t.resolve(false)
                t.resolve = null
            }
        }

        //连接成功
        if (lastStateType == "reconnect" && nextStateType == "connected") {
            // 重连成功
            // //广播一个通知
            NetSocket.msgEventProxy.execute("reconnectSuccess")
            if (t.resolve != null) {
                t.resolve(true)
                t.resolve = null
            }
        }
    }

    private tlRequest: NetworkRequest<any, any>[] = []
    addNetworkRequest(request: NetworkRequest<any, any>, sendNow: boolean = false) {
        if (sendNow) {
            let state = this.getState()
            if (state != null) {
                return state.addNetworkRequest(request)
            }
        } else {
            let tlRequest = this.tlRequest
            tlRequest.push(request)
            this.sendData()
        }
        return true
        // let state = this.getState()
        // if (state != null) {
        //     return state.addNetworkRequest(request)
        // }
        // return false
    }

    /**发送数据 */
    async sendData(): Promise<boolean> {
        let t = this
        if (!t.tlRequest || t.tlRequest.length <= 0) {
            return false
        }

        let state = this.getState()
        if (t.isSending || !(state instanceof ConnectedNetState)) {
            return false
        }
        t.isSending = true
        while (true) {
            let request = t.tlRequest.shift()
            if (!request) {
                break
            }
            if (!request.data) {
                console.error("sendData request.data null:", request?.messageName)
                continue
            }
            state = this.getState()
            if (!(state instanceof ConnectedNetState)) {
                break
            }
            let isOk = state.addNetworkRequest(request)
            if (!isOk) {
                if (request?.messageName == NetSocket.heartbeatMsgName) {
                    request.onReject("send fail")
                } else {
                    t.tlRequest.unshift(request)
                }
                break
            }
            await FW.Task.delay(1)
        }
        t.isSending = false
        return true
    }

    receiveMsgAfterSend() {
        let t = this
        t.sendData()
    }

    sendRequest(request: NetworkRequest<any, any>): boolean {
        if (!request?.data) {
            this.error("sendRequest fail request.data null: " + (request?.messageName || "") + " " + (request.index ?? ""));
            return false
        }
        let isOK = this.sendMessage(request.data)
        if (isOK) {
            // if (request.messageName != NetSocket.heartbeatMsgName) {
            //     this.log("send: ", request.messageName, request.index);
            // }
        } else {
            this.error("send fail: ", request.messageName, request.index);
        }
        return isOK;
    }


    async switchTo(type: NetStateType, p1?: any, p2?: any, p3?: any) {
        if (type == "reconnect" && this.showDisconnectDialog && !p1) {
            type = "idle"
        }
        super.switchTo(type, p1 || type, p2, p3)
    }

    private isSending = false;

    ReconnectNetStateToRestoreRequest(request: NetworkRequest<any, any>) {
        if (!request?.data) {
            return
        }
        for (let r of this.tlRequest) {
            if (r === request) {
                return
            }
        }
        this.tlRequest.unshift(request)
    }

    ClearAllRequest() {
        let tlRequest = this.tlRequest
        if (tlRequest.length > 0) {
            for (let request of tlRequest) {
                request.onTimeOut()
            }
        }
        tlRequest.length = 0
    }

}