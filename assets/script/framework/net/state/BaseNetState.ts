
import { FSMState } from "../../fsm/FSMState";
import { NetSocket } from "../NetSocket";
import { NetStateType } from "../NetSocketBase";
import { NetworkRequest } from "../NetworkRequest";

export abstract class BaseNetState extends FSMState<NetStateType> {
    public static __cname: string = "BaseNetState";
    private _socket: NetSocket;
    get socket(): NetSocket {
        return this._socket;
    }
    set socket(value: NetSocket) {
        this._socket = value;
    }

    protected _isSwitchFinish: boolean
    get isSwitchFinish(): boolean {
        return this._isSwitchFinish
    }
    set isSwitchFinish(value: boolean) {
        this._isSwitchFinish = value;
    }

    destroy() {
        this._socket = null;
        super.destroy();
    }

    enter(p1?: any, p2?: any, p3?: any) {
        this._isSwitchFinish = false
    }

    exit(p1?: any, p2?: any, p3?: any): void { }
    update(p1?: any, p2?: any, p3?: any): void { }

    async work() {
        this._isSwitchFinish = true
    }

    /**连接成功 */
    async onConnect(suc: boolean) {
        this.warn("socket state onConnect: " + this.stateName)
    }
    /**异常 */
    async onError() {

    }
    /**断开连接 */
    async onClose() {
        this.warn("socket state onClose: " + this.stateName)
    }
    /**接收到数据 */
    async onReceiveMessage(mbuffer: Uint8Array) {
        this.warn("socket state onReceiveMessage: " + this.stateName)
    }
    /**发送数据 */
    addNetworkRequest(request: NetworkRequest<any, any>, isSendNow: boolean = false) {
        // request.onTimeOut();
        return false
    }


}