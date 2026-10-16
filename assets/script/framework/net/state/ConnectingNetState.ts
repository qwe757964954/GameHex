import { Timer } from "../../utils/Timer";
import { ToolSet } from "../../utils/Toolset";
import { NetworkRequest } from "../NetworkRequest";
import { BaseNetState } from "./BaseNetState";

export class ConnectingNetState extends BaseNetState {
    public static __cname: string = "ConnectingNetState";
    /** 连接回调,成功返回true,失败或异常返回false */
    private connectResolve: any;
    private readonly _connectMaxTime: number = 15000
    private _toolSet: ToolSet
    private _timer: Timer
    constructor() {
        super("connecting")
        this._toolSet = ToolSet.createToolSet()
    }

    destroy() {
        if (this._timer) {
            this._toolSet.removeDelay(this._timer)
            this._timer = null
        }
        ToolSet.destroyToolSet(this._toolSet)
        this._toolSet = null
        super.destroy()
    }

    async onConnectTimeOut() {
        let socket = this.socket
        this.log("switchTo_idle onConnectTimeOut: " + socket.socketName)
        await socket.switchTo("idle");
        this.finishWork()
    }

    async onConnect(suc: boolean) {
        let socket = this.socket
        this.finishWork(suc)
        await socket.switchTo("connected");

    }

    async onError() {
        let socket = this.socket
        this.warn("switchTo_idle onError: " + socket.socketName)
        await socket.switchTo("idle");
        this.finishWork()
    }

    async onClose() {
        let socket = this.socket
        this.warn("switchTo_idle onClose: " + socket.socketName)
        await this.socket.switchTo("idle");
        this.finishWork()
    }

    async work() {
        let t = this
        t._timer = t._toolSet.addDelay(t._connectMaxTime, t.onConnectTimeOut, t)
        await new Promise<boolean>((resolve, reject) => {
            let socket = t.socket
            socket.connectByUrl(socket.connectUrl);
            t.connectResolve = resolve
        });
        t.isSwitchFinish = true
    }

    private finishWork(isOk: boolean = false) {
        let connectResolve = this.connectResolve
        if (connectResolve != null) {
            this.connectResolve = null
            connectResolve(isOk);
        } else {
            this._isSwitchFinish = true
        }
        if (this._timer) {
            if (this._timer) {
                this._toolSet.removeDelay(this._timer)
                this._timer = null
            }
        }
    }


    exit(p1?: any, p2?: any, p3?: any) {
        let t = this
        if (t._timer) {
            if (t._timer) {
                t._toolSet.removeDelay(t._timer)
                t._timer = null
            }
        }
        super.exit(p1, p2, p3);
    }
}