import { FW } from "../../FW";
import { Timer } from "../../utils/Timer";
import { ToolSet } from "../../utils/Toolset";
import { BaseNetState } from "./BaseNetState";

export class ReconnectNetState extends BaseNetState {
    public static __cname: string = "ReconnectNetState";
    private readonly _connectMaxTime: number = 9000
    private readonly _maxReconnectTime: number = 3
    private _reconnectTime: number
    private _toolSet: ToolSet
    private _timer: Timer
    /**
     * 本次连接尝试是否已处理过失败。
     * 网络失败时浏览器通常先 onerror 后 onclose（NetSocketBase 层也会去重一次），
     * 这里再兜一层，保证一次失败只触发一次重试，不会连开两个 socket。
     */
    private _failHandled: boolean = false
    constructor() {
        super("reconnect")
        this._reconnectTime = 0
        this._toolSet = ToolSet.createToolSet()
    }

    destroy() {
        this.clearTimer()
        ToolSet.destroyToolSet(this._toolSet)
        this._toolSet = null
        super.destroy()
    }

    async onConnectTimeOut() {
        let t = this
        t._failHandled = true
        let socket = t.socket
        if (t._reconnectTime >= t._maxReconnectTime) {
            t.log("switchTo_idle onConnectTimeOut: " + socket.socketName)
            await socket.switchTo("idle");
            t._isSwitchFinish = true
        } else {
            await t.reconnect()
        }
    }

    async onConnect(suc: boolean) {
        let t = this
        t.clearTimer()
        await t.socket.switchTo("connected")
    }

    async onError() {
        await this.handleConnectFail("onError")
    }

    async onClose() {
        await this.handleConnectFail("onClose")
    }

    /**
     * 连接被拒 / 提前关闭时不再傻等 9s 超时定时器：立即判定本次尝试失败，
     * 未达上限马上重连，达上限回 idle。
     */
    private async handleConnectFail(flag: string) {
        let t = this
        if (t._failHandled) {
            return
        }
        t._failHandled = true
        let socket = t.socket
        if (t._reconnectTime >= t._maxReconnectTime) {
            t.warn("switchTo_idle " + flag + ": " + socket.socketName)
            t.clearTimer()
            await socket.switchTo("idle")
            return
        }
        t.log("connect fail, retry immediately " + flag + ": " + socket.socketName)
        await t.reconnect()
    }

    async work() {
        let t = this
        await t.reconnect()
        t.isSwitchFinish = true
    }

    private clearTimer() {
        let t = this
        if (t._timer) {
            t._toolSet.removeDelay(t._timer)
            t._timer = null
        }
    }

    private async reconnect() {
        let t = this
        t.clearTimer()
        t._failHandled = false
        t._timer = t._toolSet.addDelay(t._connectMaxTime, t.onConnectTimeOut, t)
        let socket = t.socket
        socket.closeSocket(true);
        await FW.Task.delay(60)// 等关闭
        socket.connectByUrl(socket.connectUrl)
        t._reconnectTime++
    }

    exit(p1?: any, p2?: any, p3?: any) {
        let t = this
        t.clearTimer()
        t._failHandled = false
        t._reconnectTime = 0
        super.exit(p1, p2, p3);
    }

    enter(p1?: any, p2?: any, p3?: any) {
        super.enter(p1, p2, p3);
        this._failHandled = false
        this.socket.closeSocket(true);
    }
}
