import { TDic } from "../../collection/TDic";
import { FW } from "../../FW";
import { AppendMessage } from "../AppendMessage";
import { NetSocket } from "../NetSocket";
import { NetworkRequest } from "../NetworkRequest";
import { BaseNetState } from "./BaseNetState";



let M_interval = 8
export class ConnectedNetState extends BaseNetState {
    public static __cname: string = "ConnectedNetState";
    private _timeStame: number;
    set timeStamp(ts: number) { this._timeStame = ts; }
    get timeStamp(): number { return this._timeStame; }
    /**服务器消息标识 */
    // private serverIndex: number = 0;
    /**发送数据的promise信息 */
    private requestMap: Map<number, NetworkRequest<any, any>>;
    private requestMapState: Map<NetworkRequest<any, any>, boolean>
    /**附加数据 */
    private _tmAppendData: TDic<string, Uint8Array>
    /**请求响应时间,请求超过n毫秒，认为断线 */
    private readonly requestTimeout: number = 3000;
    // private readonly reveivedTimeout: number = 9000;
    // private _toolSet: ToolSet

    /** 源工程此处注入 Net（@injectField("Net")），但全文件从未使用该字段，Demo3.8 里直接删除。 */






    constructor() {
        super("connected");
        this.requestMap = new Map<number, NetworkRequest<any, any>>();
        this.requestMapState = new Map()
        this.timeStamp = 0;
        // this.serverIndex = 0
        this._tmAppendData = new TDic<string, Uint8Array>()
    }

    destroy() {
        let t = this;
        let requestMap = t.requestMap
        if (requestMap) {
            requestMap.clear();
        }
        t.requestMap = null;

        let tmTryReSend = this._tmTryReSend
        if (tmTryReSend) {
            tmTryReSend.clear();
        }
        t._tmTryReSend = null;

        let requestMapState = t.requestMapState
        if (requestMapState) {
            requestMapState.clear();
        }
        t.requestMapState = null;

        let _tmAppendData = t._tmAppendData;
        if (_tmAppendData) {
            _tmAppendData.clear();
        }
        t._tmAppendData = null;
        super.destroy();
    }

    async onError() {
        await this.SwitchToReconnectNetState()
    }

    async onClose() {
        NetSocket.msgEventProxy.execute("trtReconnect")
        // await this.SwitchToReconnectNetState()
        // await this.socket.switchTo("idle");
    }

    onReceiveMessage(mbuffer: Uint8Array) {
        if (mbuffer == null) {
            this.error("onMessage mbuffer null")
            return
        }
        let socket = this.socket
        let protoMgr = socket.protoMgr
        let serverCmdData = protoMgr.decode(mbuffer)

        let clientIndex = serverCmdData.clientIndex
        let networkRequest = this.requestMap.get(clientIndex);

        let msgEventProxy = NetSocket.msgEventProxy;

        let isSendMsg = false;
        if (networkRequest != null) {
            isSendMsg = true
        }

        //请求失败也可能有缓存变化
        let cmdCaches: CmdCache[] = serverCmdData.cmdCaches
        if (cmdCaches && cmdCaches.length > 0) {
            for (let i = 0, len = cmdCaches.length; i < len; i++) {
                FW.CacheMgr.handleCmdCache(cmdCaches[i]);
            }
        }
        if (serverCmdData.result) {
            const messageIds: number[] = serverCmdData.messageIds
            const splits: number[] = serverCmdData.splits
            let data: Uint8Array = serverCmdData.data
            if (serverCmdData.compress) {
                let inflate = new Zlib.Inflate(data)
                data = inflate.decompress()
            }
            let rspData: any
            let rspMsgName: string
            let messageId: number
            let lastIndex: number = 0
            for (let i = 0, len = messageIds.length; i < len; i++) {
                messageId = messageIds[i]
                rspMsgName = protoMgr.getRspMsg(messageId)
                // this.log(rspMsgName)
                rspData = protoMgr.decodeDataById(messageId, data.subarray(lastIndex, splits[i]))
                lastIndex = splits[i]

                let receiveTip: string;
                if (protoMgr.isBro(messageId)) {
                    receiveTip = "receiveBroMsg: " + rspMsgName
                } else if (protoMgr.isCacheApp(messageId)) {
                    receiveTip = "receiveCacheApp: " + rspMsgName
                } else {
                    if (networkRequest != null) {
                        let messageName = networkRequest.messageName
                        this.requestMap.delete(clientIndex)
                        this.requestMapState.delete(networkRequest)
                        this._tmTryReSend.delete(networkRequest)
                        this.removeAppendData(messageName)
                        if (!networkRequest.resolve) {
                            this.error("resolve null, 叫服务器检查,协议可能返回了多次", rspMsgName, clientIndex)
                        } else {
                            networkRequest.resolve(rspData)
                        }
                        // let timeStamp = networkRequest.timeStamp
                        // if (rspMsgName != "CmdSystemSyncTimeRspMsg") {
                        //     let costTime = this.timeStamp - timeStamp
                        //     if (costTime > 0) {
                        //         this.log(["time:", messageName, clientIndex, costTime + "毫秒"].join(" "))
                        //     }
                        // }
                    } else {
                        this.error('返回协议没有找到发送的msgResult' + rspMsgName)
                    }
                }
                if (rspMsgName != NetSocket.heartbeatMsgRspName)
                    this.log("recived", rspMsgName, clientIndex, rspData)
                    
                msgEventProxy.execute(rspMsgName, rspData, this.socket.socketName)
                //msgEventProxy.dispatchEvent("receive", rspMsgName, this.socket.socketName)

                // if (!receiveTip && rspMsgName != "CmdSystemSyncTimeRspMsg") {
                //     receiveTip = "receive: " + rspMsgName + " " + clientIndex;
                // }
                // if (receiveTip) {
                //     this.log(receiveTip)
                // }
            }
        } else {
            let tip: string;
            let rspData: CmdTips = protoMgr.decodeDataByName("CmdTips", serverCmdData.data)
            console.log(rspData)
            if (rspData && rspData.content) {
                tip = rspData.content
                FW.showTip(tip)
                msgEventProxy.execute("errorTips", rspData)
                if ("error: Not logged in" == tip || clientIndex == 0) {
                    this.SwitchToReconnectNetState()
                    networkRequest = null
                }
            }
            if (networkRequest != null) {
                this.requestMap.delete(clientIndex);
                this.requestMapState.delete(networkRequest)
                this._tmTryReSend.delete(networkRequest)
                // 防止重复提示,这里不传errMsg
                networkRequest.onReject("server_error")
            }

            const messageIds: number[] = serverCmdData.messageIds
            for (let i = 0, len = messageIds.length; i < len; i++) {
                let rspMsgName = protoMgr.getRspMsg(messageIds[i])
                if (rspMsgName) {
                    let receiveTip = "receive error: " + rspMsgName + " " + clientIndex;
                    this.warn(receiveTip)
                }
            }
        }

        if (isSendMsg) {
            this.socket.receiveMsgAfterSend()
        }

        return clientIndex
    }

    addNetworkRequest(request: NetworkRequest<any, any>, isSendNow: boolean = false) {
        let t = this;
        if (request.canSend && !request.canSend()) {
            request.onReject('cancelled');
            return false;
        }
        if (t.isSwitchFinish) {
            t.requestMap.set(request.index, request);
            t.requestMapState.set(request, isSendNow)
            request.timeStamp = t.timeStamp;
            this._tmTryReSend.set(request, 0)
            // return t.socket.sendData(request.data);
            let isOK = t.socket.sendRequest(request);
            if (!isOK) {
                if (request?.messageName == NetSocket.heartbeatMsgName || request.allowRetry === false) {
                    t.requestMap.delete(request.index);
                    t.requestMapState.delete(request)
                    t._tmTryReSend.delete(request)
                    // 不补这一下，sendNow 的 Promise 会永久悬置；resolve(false) 后
                    // GameNet 复位 heartbeatPending，下个周期再试。
                    request.onReject("send fail")
                }
            }
            return isOK
        } else {
            // request.onTimeOut();
        }
        return false
    }

    tryNetworkRequest(request: NetworkRequest<any, any>) {
        if (request.allowRetry === false || (request.canSend && !request.canSend())) {
            this.rejectRequest(request, 'cancelled');
            return;
        }
        request.timeStamp = this.timeStamp
        let times: number = this._tmTryReSend.get(request) + 1
        this._tmTryReSend.set(request, times)
        this.socket.sendRequest(request)
        // FW.showTip(FW.G_W("网络有延时,请稍后!"))
      //  this.log("tryNetworkRequest")
    }

    enter(p1?: any, p2?: any, p3?: any) {
        console.log("链接成功")
        super.enter(p1, p2, p3);
        let t = this
        t.clearSendInfo();
        t.timeStamp = 0;
    }
    exit(p1?: any, p2?: any, p3?: any) {
        // this.clearSendInfo();
        if (p1 === "reconnect") {
            this.DoReconnectNet()
        } else {
            this.clearSendInfo();
        }
        super.exit(p1, p2, p3);
    }



    private _tmTryReSend: Map<NetworkRequest<any, any>, number> = new Map()
    private rejectRequest(request: NetworkRequest<any, any>, reason: string): void {
        this.requestMap.delete(request.index);
        this.requestMapState.delete(request);
        this._tmTryReSend.delete(request);
        request.onReject(reason);
    }
    update(p1?: any, p2?: any, p3?: any) {
        let t = this;
        if (t.isSwitchFinish) {
            let deltaTime = p1;
            t.timeStamp = t.timeStamp + deltaTime;
            let now = t.timeStamp;
            let requestMap = t.requestMap;
            let requestTimeout = t.requestTimeout
            for (let [clientIndex, request] of requestMap) {
                if (!request || !request.data) {
                    this.requestMap.delete(clientIndex)
                    this.requestMapState.delete(request)
                    this._tmTryReSend.delete(request)
                    console.error("update request.data null:", request?.messageName)
                    continue
                }
                if (request.canSend && !request.canSend()) {
                    this.rejectRequest(request, 'cancelled');
                    continue;
                }
                if (now - request.timeStamp > requestTimeout) {
                    if (request.allowRetry === false) {
                        this.rejectRequest(request, 'timeout');
                        continue;
                    }
                    this.error("协议超时", request.messageName, request.index);
                    let sendTime = t._tmTryReSend.get(request)
                    if (sendTime == null || sendTime >= 1) {
                        this.SwitchToReconnectNetState()
                    } else {
                        this.tryNetworkRequest(request)
                    }
                    break;
                }
            }
        }
    }

    removeAppendData(messageName) {
        this._tmAppendData.remove(messageName);
    }

    /**清理发送数据 */
    clearSendInfo() {
        let requestMap = this.requestMap
        if (requestMap != null) {
            for (let [_, networkRequest] of requestMap) {
                if (networkRequest.isInUse && networkRequest.reject != null) {
                    // 因为现在没发送的要重发，所以不能清理，心跳的可以清除
                    if (networkRequest.messageName == NetSocket.heartbeatMsgName) {
                        networkRequest.onReject(null);
                        requestMap.delete(networkRequest.index)
                        this.requestMapState?.delete(networkRequest)
                        this._tmTryReSend?.delete(networkRequest)
                    }
                }
            }
            // requestMap.clear();
        }
        // this.requestMapState?.clear()
    }

    async SwitchToReconnectNetState() {
        // 断线后先交给业务层弹共用确认框；玩家点“确定”后 GameNet 才真正切 reconnect。
        // showDisconnectDialog 是同步置位的，可同时拦住 onerror / onclose / 协议超时的重复通知。
        if (this.socket.showDisconnectDialog) return
        NetSocket.msgEventProxy.execute("trtReconnect")
    }

    private DoReconnectNet() {
        let requestMap = this.requestMap
        let requestMapState = this.requestMapState
        if (requestMap.size > 0) {
            let tlRequestData: { index: number, networkRequest: NetworkRequest<any, any> }[] = []
            for (let [_, networkRequest_] of requestMap) {
                tlRequestData.push({ index: _, networkRequest: networkRequest_ })
            }
            if (tlRequestData.length > 1) {
                tlRequestData.sort((a, b) => {
                    return a.index - b.index
                })
            }
            let len = tlRequestData.length
            for (let i = 0; i < len; i++) {
                let networkRequest_ = tlRequestData[i].networkRequest
                if (networkRequest_.allowRetry === false || (networkRequest_.canSend && !networkRequest_.canSend())
                    || requestMapState.get(networkRequest_)) {
                    networkRequest_.onReject(null)
                } else {
                    // 协议按顺序发送，上个协议回来才会继续从队列拿出其他协议继续发送，所以这里理论上只有一个
                    if (networkRequest_.messageName === NetSocket.heartbeatMsgName) {
                        networkRequest_.onReject(null)
                    } else {
                        this.socket.ReconnectNetStateToRestoreRequest(networkRequest_)
                    }
                }
            }
        }
        requestMap.clear()
        requestMapState.clear()
    }
}
