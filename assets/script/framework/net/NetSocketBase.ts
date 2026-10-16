
import { Container } from "../container/Container";
import { FSM } from "../fsm/FSM";
import { Socket } from "./Socket";
import { BaseNetState } from "./state/BaseNetState";
import { ConnectedNetState } from "./state/ConnectedNetState";
import { ConnectingNetState } from "./state/ConnectingNetState";
import { IdleNetState } from "./state/IdleNetState";
import { ReconnectNetState } from "./state/ReconnectNetState";

export type NetStateType = | "idle" | "connected" | "reconnect" | "connecting"
export abstract class NetSocketBase extends FSM<NetStateType, BaseNetState> {
    public static __cname: string = "NetSocketBase";
    private _connectUrl: string;
    get connectUrl(): string {
        return this._connectUrl;
    }
    /** websocket对象 */
    protected socket: Socket = null;
    /**socket名字 */
    protected _socketName: string;
    get socketName(): string {
        return this._socketName;
    }
    private isOnError: boolean;
    private isOnClose: boolean;
    get isDisconnect(): boolean {
        return (this.isOnError || this.isOnClose);
    }

    protected abstract onConnect(e: any): void;
    protected abstract onError(e: any): void;
    protected abstract onClose(e: any): void;
    protected abstract onReceiveMessage(mbuffer: Uint8Array): void;

    constructor(container: Container) {
        super(new IdleNetState(), new ConnectingNetState(), new ConnectedNetState(), new ReconnectNetState());

        for (let [_, state] of this.tmState) {
            container.collectObj(state)
        }

        this.isOnError = false;
        this.isOnClose = false;
        this.init()
    }

    init() {
        let socket = new Socket();
        this.socket = socket;
        socket.eventProxy.addListener("open", this, this.onSocketConnect)
        socket.eventProxy.addListener("error", this, this.onSocketError)
        socket.eventProxy.addListener("close", this, this.onSocketClose)
        socket.eventProxy.addListener("message", this, this.onSocketMessage)
    }

    destroy() {
        let socket = this.socket;
        socket.eventProxy.removeAll();
        socket.destroy();
        this.socket = null;
        super.destroy();
    }


    /**
     * 连接到指定的主机和端口
     * @param host 服务器地址
     * @param port 服务器端口
     */
    setConnectInfo(host: string, port: number, isWss: boolean = false) {
        let tlUrl: string[] = []
        if (host.indexOf("ws:") < 0) {
            tlUrl.push(isWss ? "wss://" : "ws://")
        }
        tlUrl.push(host, ":", port.toString(), "/server")
        this._connectUrl = tlUrl.join("")
        this.log("ws_url: " + this._connectUrl);
    }

    /**关闭连接 */
    closeSocket(notEvent: boolean = false) {
        let socket = this.socket
        if (socket == null) {
            return
        }
        socket.close(notEvent);
    }

    /**是否在连接 */
    get isSocketConnected(): boolean {
        let socket = this.socket
        if (socket == null) {
            return false
        }
        return socket.connected;
    }

    getConnectedStr(): string {
        let socket = this.socket
        if (socket == null) {
            return "null"
        }
        return (socket.connected ? "ture" : "false");
    }

    public connectByUrl(url: string) {
        this.isOnError = false
        this.isOnClose = false
        this.log("=== socket connectByUrl currFrame: " + url + " connected:" + this.getConnectedStr());
        this.socket.connectByUrl(url);
    }

    private onSocketConnect(e: any) {
        if (this.destroyed) {
            return
        }
        this.isOnError = false
        this.isOnClose = false
        this.log("socket connect success currFrame: " + this.socketName + " connected:" + this.getConnectedStr());
        this.onConnect(e)
    }


    private onSocketError(e: any) {
        if (this.destroyed) {
            return
        }
        this.error("socket error currFrame: " + this.socketName + " connected:" + this.getConnectedStr(), e);
        if (this.isDisconnect) {
            this.isOnError = true
            return
        }
        this.isOnError = true
        this.onError(e)
    }
    private onSocketClose(e: any) {
        if (this.destroyed) {
            return
        }
        this.log("socket close currFrame: " + this.socketName + " connected:" + this.getConnectedStr(), e);
        if (this.isDisconnect) {
            this.isOnClose = true
            return
        }
        this.isOnClose = true
        this.onClose(e)
    }

    private onSocketMessage(data: any) {
        if (this.destroyed) {
            return
        }
        if (!(data instanceof ArrayBuffer)) {
            this.error("socket onSocketMessage error" + data);
            this.onReceiveMessage(null)
            return
        }

        let socket = this.socket
        socket.input.clear();
        socket.input.writeArrayBuffer(data);
        socket.input.pos = 0;

        let mbuffer: Uint8Array = socket.input.getUint8Array(0, socket.input.length);
        this.onReceiveMessage(mbuffer)
    }

    /**
     * @param data encodeData
     */
    protected sendMessage(data: any): boolean {
        if (!data) {
            this.error("socket sendMessage data null:", data);
            return false
        }
        if (this.destroyed) {
            this.warn("socket sendMessage fail destroyed");
            return false
        }
        let socket = this.socket;
        if (socket == null || !socket.connected) {
            this.warn("socket sendMessage fail");
            return false;
        }
        socket.output.writeArrayBuffer(data);
        socket.flush();
        return true;
    }
}