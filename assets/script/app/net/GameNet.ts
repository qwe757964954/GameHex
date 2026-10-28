import { director, Director, game } from 'cc';
import { ScriptObject } from '../../framework/base/ScriptObject';
import { Container } from '../../framework/container/Container';
import { FW } from '../../framework/FW';
import { NetSocket } from '../../framework/net/NetSocket';
import { NetworkRequest } from '../../framework/net/NetworkRequest';
import { ProtoMgr } from '../../framework/net/ProtoMgr';
import { RequestMsg } from '../../framework/net/RequestMsg';
import { PopupLayer } from '../../framework/ui/PopupDef';
import { CommonTips } from '../common/CommonTips';
import { CacheMgr } from './CacheMgr';
import { RequestHeartbeat } from './HeartbeatMsg';

export interface ReconnectLoginResult {
    ok: boolean;
    reason?: string;
}

export type ReconnectLoginHandler = () => Promise<ReconnectLoginResult>;

/**
 * 游戏服 socket 连接（对齐源工程 app/net/Net.ts 的职责，但去掉容器注入）。
 *
 * 源工程里 `Net` 依赖 `@injectField("ModelMgr")` 才能拿到服务器地址，Demo3.8 的业务层
 * 不建 DI 容器，所以这里把「拿地址」这一点外置：由调用方（LoginPage）把中心服返回的
 * `serverAddress.host / port` 直接传进 `connectServer()`。
 *
 * 地址口径与源工程 SubServerDefault 完全一致：`ws://<host>:<port>/server`
 * （SubServerDefault.GetIsWSS() 恒为 false；只有微信分包 SubServerWX 才走 wss）。
 */
export class GameNet extends ScriptObject {
    public static __cname: string = 'GameNet';

    private static _instance: GameNet | null = null;
    static get instance(): GameNet {
        if (GameNet._instance == null) {
            GameNet._instance = new GameNet();
        }
        return GameNet._instance;
    }

    /**
     * 建连超时（毫秒）。
     *
     * 源工程靠 `ConnectingNetState` 里的 `ToolSet.addDelay(15000)` 兜超时，而 ToolSet 的定时器
     * 挂在 `UpdateBeat` 上 —— Demo3.8 的 `window.frameworkUpdate`（framework/moduleMainframework.ts
     * 里定义的那个）**没有任何地方调用**，UpdateBeat 不会走，框架层的 Timer 全是死的。
     * 所以这里不依赖框架定时器，自己用 setTimeout 兜一个，避免连接卡住时整个登录流程挂死。
     */
    private static readonly CONNECT_TIMEOUT_MS: number = 15000;

    /**
     * 心跳间隔（毫秒）。
     * 心跳在途后由 ConnectedNetState 的 requestTimeout(3s) + 重发 1 次兜底，
     * 正常约 6s 内可判定断线并弹窗；上一心跳未回时不叠加新心跳。
     */
    private static readonly HEARTBEAT_INTERVAL_MS: number = 5000;

    private _netSocket: NetSocket | null = null;
    private _protoMgr: ProtoMgr | null = null;
    private _clientIndex: number = 0;
    private _prepareTask: Promise<void> | null = null;
    private _ticking: boolean = false;
    private _tickHandler: (() => void) | null = null;
    private _reconnectLoginHandler: ReconnectLoginHandler | null = null;
    private _reconnecting: boolean = false;
    private _reconnectEventsBound: boolean = false;
    private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private _heartbeatPending: boolean = false;

    get netSocket(): NetSocket | null {
        return this._netSocket;
    }

    get protoMgr(): ProtoMgr | null {
        return this._protoMgr;
    }

    /** 当前是否有一条已建立的连接。 */
    get isConnected(): boolean {
        const netSocket = this._netSocket;
        return netSocket != null && netSocket.isSocketConnected;
    }

    /** 已经连上的 url，便于日志/排查。 */
    get connectUrl(): string {
        const netSocket = this._netSocket;
        return netSocket != null ? netSocket.connectUrl : '';
    }

    // ========================================================================
    // 初始化
    // ========================================================================

    /**
     * 建 NetSocket 并加载协议。可重复调用；并发调用共用同一次初始化。
     * 协议运行时是**随包的静态模块** `lib/protobuf/protoCompiledStatic`（见 ProtoCoder.init 的说明），
     * 不再从 `resources/config/protoCompiled.json` 走反射模式 —— 那条路依赖 `Function(...)`，微信小游戏禁用。
     */
    prepare(): Promise<void> {
        if (this._prepareTask == null) {
            this._prepareTask = this.doPrepare().catch((error) => {
                this._prepareTask = null;
                throw error;
            });
        }
        return this._prepareTask;
    }

    private async doPrepare(): Promise<void> {
        let netSocket = this._netSocket;
        if (netSocket == null) {
            netSocket = new NetSocket('main', Container.inst());
            netSocket.protoMgr = ProtoMgr.get();
            this._netSocket = netSocket;
        }
        const protoMgr = netSocket.protoMgr;
        if (protoMgr == null) {
            throw new Error('ProtoMgr 未装配');
        }
        this._protoMgr = protoMgr;
        await protoMgr.protoCoder.init();
        // 收到的包可能带 cmdCaches（ServerCmdData.cmdCaches），连接态的收包路径会调
        // FW.CacheMgr.handleCmdCache → new GameCache(name)，而 GameCache 构造要读
        // GameCacheMgr.protoCacheMessage（config/protoCache）和 ProtoMgr 的
        // CmdCacheUpdateByField 解析类。必须在连上之前初始化，否则第一包就抛。
        // 这里显式把 CacheMgr 单例交给 FW，让**收包写入**与**业务读取**共用同一份缓存
        // （老客户端是 DI 容器装配的；两个实例会各持一份 GameCache，读会永远为空）。
        FW.CacheMgr = CacheMgr.instance;
        await FW.CacheMgr.init();
        this.bindReconnectEvents();
        this.startTick();
        this.startHeartbeat();
    }

    /**
     * 保存角色重登录入口。首次角色登录成功后由 LoginRoot 注入；断线弹窗只有在它就绪后才会出现，
     * 避免首次建连失败也被误判成“游戏中断线”。
     */
    configureReconnectLogin(handler: ReconnectLoginHandler | null): void {
        this._reconnectLoginHandler = handler;
    }

    private bindReconnectEvents(): void {
        if (this._reconnectEventsBound) return;
        this._reconnectEventsBound = true;
        NetSocket.msgEventProxy.addListener('trtReconnect', this, this.onTransportDisconnected);
    }

    private onTransportDisconnected(): void {
        this.showReconnectDialog();
    }

    /**
     * 对齐老客户端 `LayerDisconnect`：复用全局共用提示框，且断线提示必须盖住业务弹窗。
     * 这里禁止右上角、取消与点空白关闭，玩家点击“确定”才进入重连流程。
     */
    private showReconnectDialog(): void {
        const netSocket = this._netSocket;
        if (
            netSocket == null
            || this._reconnectLoginHandler == null
            || this._reconnecting
            || netSocket.showDisconnectDialog
        ) {
            return;
        }

        netSocket.showDisconnectDialog = true;
        void CommonTips.open({
            layer: PopupLayer.TOP,
            closeOnBlank: false,
            allowMultiple: true,
            userData: {
                title: '提示',
                content: '检测到网络已断开，重新连接!',
                sureText: '确定',
                showCancel: false,
                showClose: false,
                onSure: () => { void this.reconnectAndLogin(); },
            },
            onClose: () => {
                if (this._netSocket === netSocket) netSocket.showDisconnectDialog = false;
            },
        }).then((popup) => {
            // 场景切换窗口期可能还没有 PopupManager；不能把“正在显示”的闸门永久锁死。
            if (popup == null && this._netSocket === netSocket) {
                netSocket.showDisconnectDialog = false;
            }
        });
    }

    /** 点击断线弹窗“确定”后的完整恢复：Socket 重连 -> 角色重登录 -> 恢复积压请求。 */
    private async reconnectAndLogin(): Promise<boolean> {
        if (this._reconnecting) return false;
        const netSocket = this._netSocket;
        const login = this._reconnectLoginHandler;
        if (netSocket == null || login == null) return false;

        this._reconnecting = true;
        let restored = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            const guard = new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), GameNet.CONNECT_TIMEOUT_MS);
            });
            // 显式传 `reconnect`：既越过“断线弹窗正在显示”的状态闸门，也让 ConnectedNetState
            // 把未完成请求移回待发送队列，不能传 true（true 会走清理分支，积压请求无法恢复）。
            const connected = await Promise.race([netSocket.reconnect('reconnect'), guard]);
            if (!connected) {
                await netSocket.switchTo('idle');
                return false;
            }

            const result = await login();
            if (!result.ok) {
                if (result.reason) FW.showTip(result.reason);
                await netSocket.switchTo('idle');
                return false;
            }

            restored = true;
            // 旧心跳随重连被废弃，复位 pending，让心跳循环尽快恢复
            this._heartbeatPending = false;
            NetSocket.msgEventProxy.execute('reconnectSuccessAndLogin');
            return true;
        } catch (error) {
            this.error('断线重连失败', error);
            await netSocket.switchTo('idle');
            return false;
        } finally {
            if (timer != null) clearTimeout(timer);
            this._reconnecting = false;
            if (!restored) this.showReconnectDialog();
        }
    }

    // ========================================================================
    // 连接
    // ========================================================================

    /**
     * 连接游戏服。
     * @param host 中心服 `roleLoginServer` 返回的 serverAddress.host
     * @param port serverAddress.port
     * @param isWss 是否 wss；默认 false，与源工程 SubServerDefault 一致
     * @returns 连接是否成功
     */
    async connectServer(host: string, port: number, isWss: boolean = false): Promise<boolean> {
        if (!host || !port) {
            this.error('connectServer 参数非法', host, port);
            return false;
        }
        await this.prepare();
        const netSocket = this._netSocket;
        if (netSocket == null) {
            this.error('connectServer 失败：NetSocket 未创建');
            return false;
        }
        await netSocket.switchTo('idle');
        netSocket.setConnectInfo(host, port, isWss);

        let timer: ReturnType<typeof setTimeout> | null = null;
        const guard = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), GameNet.CONNECT_TIMEOUT_MS);
        });
        let ok = false;
        try {
            ok = await Promise.race([netSocket.connect(), guard]);
        } finally {
            if (timer != null) {
                clearTimeout(timer);
                timer = null;
            }
        }
        if (!ok) {
            this.error('连接游戏服失败：' + netSocket.connectUrl);
            await netSocket.switchTo('idle');
        }
        return ok;
    }

    /** 关闭链接（不发 close 事件）。 */
    closeSocket(): void {
        const netSocket = this._netSocket;
        if (netSocket != null) {
            netSocket.closeSocket();
        }
    }

    /** 回到 idle 状态，等价源工程 `Net.closeSocket()`。 */
    async resetNetState(): Promise<void> {
        const netSocket = this._netSocket;
        if (netSocket != null) {
            await netSocket.switchTo('idle');
        }
    }

    // ========================================================================
    // 收发协议
    // ========================================================================

    /** 入队发送（依次发出）。 */
    send<CmdReqMsg, CmdRspMsg>(reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>, needLoading: boolean = true): Promise<boolean> {
        return this.pushRequest(reqMsg, needLoading, false);
    }

    /** 立即发送（插队，登录这类必须优先的请求用这个）。 */
    sendNow<CmdReqMsg, CmdRspMsg>(reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>, needLoading: boolean = true): Promise<boolean> {
        return this.pushRequest(reqMsg, needLoading, true);
    }

    private pushRequest<CmdReqMsg, CmdRspMsg>(
        reqMsg: RequestMsg<CmdReqMsg, CmdRspMsg>,
        needLoading: boolean,
        sendNow: boolean,
    ): Promise<boolean> {
        const netSocket = this._netSocket;
        const protoMgr = this._protoMgr;
        if (netSocket == null || protoMgr == null) {
            this.error('send 失败：网络未初始化');
            return Promise.resolve(false);
        }

        const messageName = reqMsg.getReqMsgProtoName();
        if (messageName !== NetSocket.heartbeatMsgName) {
            this.log('sending: ', messageName, reqMsg.cmdReqMsg, 'loading', needLoading);
        }
        if (FW.ignoreShowloadingNet.indexOf(messageName) !== -1) {
            needLoading = false;
        }

        return new Promise<boolean>((resolve, reject) => {
            const data = this.createCmdClientData(messageName, reqMsg.cmdReqMsg);
            if (data == null) {
                reject(new Error('协议编码失败：' + messageName));
                return;
            }
            const request = new NetworkRequest<CmdReqMsg, CmdRspMsg>();
            request.packageRequest(this._clientIndex, data, reqMsg, needLoading, this.callbackOwners);
            request.promise.then(resolve).catch(reject);
            const isOK = netSocket.addNetworkRequest(request, sendNow);
            if (!isOK) {
                this.error('send add fail: ' + request.messageName + ' ' + request.index);
            }
        });
    }

    /** 组装 ClientCmdData —— 与源工程 app/net/Net.ts 的 createCmdClientData 一致。 */
    private createCmdClientData(messageName: string, param: any): Uint8Array | null {
        const protoMgr = this._protoMgr;
        if (protoMgr == null) {
            return null;
        }
        const messageId = protoMgr.getMessageId(messageName);
        if (!messageId) {
            this.error('不存在协议 ' + messageName + '：MessageId 中没定义');
            return null;
        }
        const data = protoMgr.encode(messageName, param == null ? {} : param);
        this._clientIndex = this._clientIndex + 1;
        const clientCmdData: ClientCmdData = {
            messageId: messageId,
            clientIndex: this._clientIndex,
            data: data,
            appendData: null,
        };
        return protoMgr.encode('ClientCmdData', clientCmdData);
    }

    // ========================================================================
    // 广播事件
    // ========================================================================

    addEvent(name: string, caller: object, listener: Function): void {
        NetSocket.msgEventProxy.addListener(name, caller, listener);
    }

    removeEvent(name: string, caller: object, listener: Function): void {
        NetSocket.msgEventProxy.removeListener(name, caller, listener);
    }

    removeCallerEvent(caller: object): void {
        this.removeCaller(caller);
    }

    /** 同一宿主的广播监听与未完成请求回调一起解除。 */
    removeCaller(caller: object): void {
        NetSocket.msgEventProxy.removeCallerListener(caller);
    }

    get callbackOwners() {
        return NetSocket.msgEventProxy;
    }

    // ========================================================================
    // 每帧驱动
    // ========================================================================

    /**
     * 驱动 socket（收发包、超时清理、心跳）。
     *
     * 源工程由 `NetMgr`（挂在 `UpdateBeat` 上）驱动，而 Demo3.8 的 UpdateBeat 没人 tick，
     * 所以这里改挂 `director` 的 AFTER_UPDATE。
     */
    update(dt: number): void {
        const netSocket = this._netSocket;
        if (netSocket != null) {
            netSocket.update(dt);
        }
    }

    private startTick(): void {
        if (this._ticking) return;
        this._ticking = true;
        // 用 `game.deltaTime`，别用 `director.getDeltaTime()`：后者自 3.3 起废弃（3.8 里边
        // 每次调用都会打一条 deprecation warn 刷屏），而它的实现本来就是
        // `return cclegacy.game.deltaTime` —— 换过去取值完全一致。
        const handler = () => {
            this.update(game.deltaTime);
        };
        this._tickHandler = handler;
        director.on(Director.EVENT_AFTER_UPDATE, handler);
    }

    private stopTick(): void {
        const handler = this._tickHandler;
        if (!this._ticking || handler == null) return;
        director.off(Director.EVENT_AFTER_UPDATE, handler);
        this._tickHandler = null;
        this._ticking = false;
    }

    // ========================================================================
    // 心跳（定时对时 + 断线探测）
    // ========================================================================

    private startHeartbeat(): void {
        if (this._heartbeatTimer != null) return;
        NetSocket.msgEventProxy.addListener(
            NetSocket.heartbeatMsgRspName, this, this.onHeartbeatRsp);
        const loop = (): void => {
            this._heartbeatTimer = setTimeout(loop, GameNet.HEARTBEAT_INTERVAL_MS);
            void this.sendHeartbeat();
        };
        // 首次延迟一个间隔，避开登录协议密集期
        this._heartbeatTimer = setTimeout(loop, GameNet.HEARTBEAT_INTERVAL_MS);
    }

    private onHeartbeatRsp(): void {
        this._heartbeatPending = false;
    }

    private async sendHeartbeat(): Promise<void> {
        // 上一心跳未回（可能正在超时/重发判定中）或当前未连接，跳过本轮，不叠加
        if (this._heartbeatPending || !this.isConnected) return;
        this._heartbeatPending = true;
        try {
            // CmdSystemSyncTimeReqMsg 是空消息，构造仍要求传载荷，给空对象
            const ok = await this.sendNow(new RequestHeartbeat({}), false);
            if (!ok) this._heartbeatPending = false;
        } catch {
            this._heartbeatPending = false;
        }
    }

    private stopHeartbeat(): void {
        if (this._heartbeatTimer != null) {
            clearTimeout(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        NetSocket.msgEventProxy.removeListener(
            NetSocket.heartbeatMsgRspName, this, this.onHeartbeatRsp);
        this._heartbeatPending = false;
    }

    destroy(): void {
        this.stopTick();
        this.stopHeartbeat();
        NetSocket.msgEventProxy.removeAll();
        if (this._reconnectEventsBound) {
            NetSocket.msgEventProxy.removeListener('trtReconnect', this, this.onTransportDisconnected);
            this._reconnectEventsBound = false;
        }
        const netSocket = this._netSocket;
        if (netSocket != null) {
            netSocket.destroy();
            this._netSocket = null;
        }
        this._reconnectLoginHandler = null;
        this._reconnecting = false;
        this._protoMgr = null;
        this._prepareTask = null;
        this._clientIndex = 0;
        super.destroy();
    }
}
