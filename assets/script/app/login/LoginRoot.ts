import { sys } from 'cc';
import {
    canEnterServer,
    createClientInfo,
    DEFAULT_VERSION_CONFIG,
    GameConfig,
    LoginGateway,
    selectRecommendedServer,
    ServerAddress,
    ServerInfoData,
    UserInfo,
    VersionConfig,
} from './LoginProtocol';
import { ProtocolCodec } from './ProtocolCodec';
import { LoginStatus } from '../generated/netProto/CmdInterface';
import { RequestRoleLogin } from '../generated/requestMsg/RequestRoleMsg';
import { CenterPaymentService } from '../../platform/payment/CenterPaymentService';

/** 登录业务流程结果 */
export interface LoginFlowResult {
    ok: boolean;
    reason?: string;
    session?: unknown;
    user?: UserInfo;
}

/** 选服变更回调 */
export type ServerSelectCallback = (server: ServerInfoData) => void;

/**
 * 登录业务根（LoginRoot）：纯业务逻辑，不继承 Component、不碰 UI。
 *
 * 负责：版本配置加载、协议校验、服务器列表获取、账号登录/注册、
 * 游戏服连接、角色登录、本地账号密码缓存。
 *
 * UI 层（LoginPage）只负责：读输入框、调本类方法、把结果渲染到控件。
 */
export class LoginRoot {
    gateway: LoginGateway | null = null;

    private gameConfig: GameConfig | null = null;
    private servers: ServerInfoData[] = [];
    private selectedServerId: number | null = null;
    private recentServerIds: number[] = [];
    private versionConfig: VersionConfig = DEFAULT_VERSION_CONFIG;
    private protocolReady = false;
    private busy = false;
    private disposed = false;

    // ---- 状态查询 ----
    get isBusy(): boolean { return this.busy; }
    get isDisposed(): boolean { return this.disposed; }
    get gameConfig_(): GameConfig | null { return this.gameConfig; }
    get servers_(): ServerInfoData[] { return this.servers; }
    get selectedServerId_(): number | null { return this.selectedServerId; }
    get recentServerIds_(): number[] { return this.recentServerIds; }
    get version_(): string { return this.versionConfig.version; }
    get channel_(): string { return this.gameConfig?.channel ?? ''; }
    get channelCode_(): string { return this.gameConfig?.channelCode ?? ''; }
    get isWss_(): boolean { return !!this.gameConfig?.isWss; }

    dispose(): void {
        this.disposed = true;
    }

    configureGateway(gateway: LoginGateway): void {
        this.gateway = gateway;
    }

    // ---- 本地账号缓存 ----
    restoreAccount(): { account: string; password: string } {
        const account = sys.localStorage.getItem('account_num') || '';
        const password = sys.localStorage.getItem('password_num') || '';
        const serverId = Number(sys.localStorage.getItem('select_server_id'));
        if (Number.isFinite(serverId) && serverId > 0) this.selectedServerId = serverId;
        return { account, password };
    }

    persistLogin(account: string, password: string, session: unknown): void {
        sys.localStorage.setItem('account_num', account);
        sys.localStorage.setItem('password_num', password);
        sys.localStorage.setItem('select_server_id', String(this.selectedServerId));
        sys.localStorage.setItem('login_session', JSON.stringify(session));
    }

    setSelectedServer(id: number): void {
        this.selectedServerId = id;
    }

    // ---- 启动流程 ----
    async bootstrap(versionConfigJson?: VersionConfig): Promise<{
        ok: boolean;
        reason?: string;
        servers: ServerInfoData[];
    }> {
        if (!this.gateway) return { ok: false, reason: '登录网络服务尚未装配', servers: [] };

        if (versionConfigJson) this.versionConfig = versionConfigJson;

        // 协议校验
        try {
            const report = new ProtocolCodec().validate();
            this.protocolReady = report.hasClientEnvelope && report.hasServerEnvelope && report.hasRoleLogin;
        } catch (reason) {
            this.protocolReady = false;
            console.error('[LoginRoot] protocol invalid', reason);
        }

        try {
            const result = await this.gateway.bootstrap(this.versionConfig);
            this.gameConfig = result.background.gameConfig;
            this.servers = result.servers;
            this.selectedServerId = selectRecommendedServer(this.servers);
            return { ok: true, servers: this.servers };
        } catch (error) {
            console.warn('[LoginRoot] 获取登录配置或服务器列表失败', error);
            this.gameConfig = null;
            this.servers = [];
            this.selectedServerId = null;
            return { ok: false, reason: '服务器列表获取失败，请检查网络后重试', servers: [] };
        }
    }

    get protocolReady_(): boolean { return this.protocolReady; }

    // ---- 登录 ----
    async login(account: string, password: string, net: any): Promise<LoginFlowResult> {
        if (this.busy || this.disposed) return { ok: false, reason: 'busy' };
        if (!account || !password) return { ok: false, reason: '请输入账号和密码' };
        if (!this.gameConfig) return { ok: false, reason: '登录中心尚未就绪，请稍后重试' };
        if (this.selectedServerId == null) return { ok: false, reason: '请先选择服务器' };

        const selected = this.servers.find((s) => Number(s.serverId) === this.selectedServerId);
        if (!selected) return { ok: false, reason: '选择的服务器不存在，请重新选择' };
        const allowed = canEnterServer(selected, this.recentServerIds);
        if (!allowed.ok) return { ok: false, reason: allowed.reason || '当前服务器不可进入' };

        this.busy = true;
        try {
            const user = await this.gateway!.loginAccount(this.gameConfig, account, password);
            if (this.disposed) return { ok: false, reason: 'disposed' };

            const recent = await this.gateway!.queryRecentServers(this.gameConfig, user);
            this.recentServerIds = recent.roleServerList || recent.roleList?.map((i: any) => i.selectServerId) || [];
            if (this.selectedServerId == null) {
                this.selectedServerId = selectRecommendedServer(this.servers, recent.recentServerId, this.recentServerIds);
            }
            const allowedAfter = canEnterServer(selected, this.recentServerIds, recent.state === 1);
            if (!allowedAfter.ok) return { ok: false, reason: allowedAfter.reason };

            await this.gateway!.loginServer(this.gameConfig, user, this.selectedServerId);
            const session = await this.gateway!.enterServer(this.gameConfig, user, this.selectedServerId);

            const connected = await this.connectGameServer(user, session, net);
            if (!connected.ok) return { ok: false, reason: connected.reason };

            CenterPaymentService.current?.configure({
                centerUrl: this.gameConfig.url,
                platform: this.gameConfig.channelCode,
                code: user.code,
                roleId: Number(session.roleId),
                sdkType: this.gameConfig.sdkType ?? '',
            });

            this.persistLogin(account, password, session);
            return { ok: true, session, user };
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        } finally {
            this.busy = false;
        }
    }

    // ---- 注册 ----
    async register(account: string, password: string): Promise<{ ok: boolean; reason?: string }> {
        if (this.busy || this.disposed) return { ok: false, reason: 'busy' };
        if (!account || !password) return { ok: false, reason: '请输入账号和密码' };
        if (!this.gameConfig) return { ok: false, reason: '登录中心尚未就绪，请稍后重试' };
        this.busy = true;
        try {
            await this.gateway!.registerAccount(this.gameConfig, account, password);
            sys.localStorage.setItem('account_num', account);
            sys.localStorage.setItem('password_num', password);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        } finally {
            this.busy = false;
        }
    }

    // ---- 游戏服连接 ----
    private async connectGameServer(user: UserInfo, session: any, net: any): Promise<{ ok: boolean; reason?: string }> {
        const address: ServerAddress = session?.serverAddress;
        if (!address || !address.host || !address.port) {
            return { ok: false, reason: '登录中心未返回游戏服地址' };
        }
        const useWss = !!(this.gameConfig?.isWss && address.wssHost);
        const host = useWss ? address.wssHost : address.host;
        const port = useWss ? (address.wssPort || address.port) : address.port;
        const label = address.name || `${host}:${port}`;

        try {
            await net.prepare();
        } catch (e) {
            return { ok: false, reason: `网络协议初始化失败：${e instanceof Error ? e.message : String(e)}` };
        }

        const connected = await net.connectServer(host, port, useWss);
        if (!connected) {
            net.closeSocket();
            return { ok: false, reason: `连接游戏服 ${label} 失败` };
        }

        const roleOk = await this.playerLogin(net, user, session, false);
        if (!roleOk.ok) {
            net.closeSocket();
            return roleOk;
        }
        if (typeof net.configureReconnectLogin === 'function') {
            net.configureReconnectLogin(() => this.playerLogin(net, user, session, true));
        }
        return { ok: true };
    }

    private async playerLogin(
        net: any,
        user: UserInfo,
        session: any,
        reconnect: boolean,
    ): Promise<{ ok: boolean; reason?: string }> {
        const version = this.versionConfig?.version ?? '';
        // ⚠️ 必须走工厂，不要手写对象字面量：`CmdClientInfo` 有 13 个 proto2 `required`
        // 字段，少一个就会在 `CmdClientInfo.encode` 抛 TypeError（新增无守卫、无条件写），
        // 表现为「链接成功」后立刻 `socket close 1005` 且没有任何异常堆栈。
        // 详见 LoginProtocol.createClientInfo 的注释与 tests/login-protocol.test.ts。
        const cmdClientInfo = createClientInfo(version, this.gameConfig?.channel ?? '');
        const param = {
            cmdClientInfo,
            platform: this.gameConfig!.channelCode,
            code: user.code,
            roleId: session.roleId,
            time: session.time,
            token: session.token,
            reconnect,
            openid: user.openid ?? '',
            selectServerId: session.selectServerId ?? this.selectedServerId,
        };

        let rsp: any = null;
        try {
            const caller = this as unknown as { destroy(): void; destroyed: boolean };
            await net.sendNow(new RequestRoleLogin(param, caller, (response: any) => { rsp = response; }));
        } catch (e) {
            return { ok: false, reason: `角色登录请求失败：${e instanceof Error ? e.message : String(e)}` };
        }

        if (rsp == null) return { ok: false, reason: '角色登录无响应' };
        const loginStatus = rsp.loginStatus as unknown as number;
        if (loginStatus === LoginStatus.WEI_HU) return { ok: false, reason: '游戏服维护中，请稍后再试' };
        if (loginStatus === LoginStatus.BAN) return { ok: false, reason: '该账号已被封禁' };
        return { ok: true };
    }
}
