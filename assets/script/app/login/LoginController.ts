import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { GameRoute } from '../../core/runtime/GameRoute';
import { canEnterServer, type VersionConfig } from './LoginProtocol';
import { LoginUiEvent, type ILoginIntent, type ILoginService, type ILoginViewState, type IServerSelectContent } from './LoginEvents';

export interface ILoginControllerOptions {
    readonly owner: object;
    readonly service: ILoginService;
    readonly config: {
        readonly loadVersion: () => Promise<VersionConfig>;
    };
    readonly view: {
        readonly restoreCredentials: (value: { account: string; password: string }) => void;
        readonly render: (state: ILoginViewState) => void;
    };
    readonly feedback: {
        readonly tip: (message: string) => void;
    };
    readonly servers: {
        readonly openServers: (content: IServerSelectContent) => Promise<void>;
        readonly closeServers: () => void;
    };
    readonly clock: {
        readonly schedule: (callback: () => void, seconds: number) => () => void;
    };
    readonly navigation: {
        readonly navigate: (route: string, params?: unknown) => void;
    };
    /** 渠道配置：是否显示渠道一键登录按钮、GM按钮是否可见 */
    readonly channel: {
        readonly platformLoginVisible: boolean;
        readonly gmVisible: boolean;
    };
}

export class LoginController extends ControllerBase {
    private version = '';
    private status = '';
    private busy = true;
    private started = false;
    private openingServers = false;
    private agreed = false;
    private showPassword = false;
    /** 注册后自动登录时保存账号密码，避免重复输入 */
    private pendingAutoLogin: { account: string; password: string } | null = null;

    constructor(context: IControllerContext, private readonly options: ILoginControllerOptions) {
        super(context, 'login');
        this.own(() => options.service.dispose());
        this.own(() => options.servers.closeServers());
    }
    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(LoginUiEvent.Intent, this.onIntent);
        this.options.view.restoreCredentials(this.options.service.restoreAccount());
        this.agreed = this.options.service.restoreAgreement();
        this.render();
        try {
            const version = await this.options.config.loadVersion();
            if (this.isDisposed) return;
            this.version = version.version;
            this.status = '正在获取服务器列表…';
            this.render();
            const result = await this.options.service.bootstrap(version);
            if (this.isDisposed) return;
            if (!result.ok) this.options.feedback.tip(result.reason || '服务器列表获取失败');
            else {
                this.status = '服务器列表已就绪';
                if (!this.options.service.protocolReady_) this.options.feedback.tip('协议资源待检查，可能无法登录');
            }
        } catch (error) {
            if (!this.isDisposed) this.problem(error);
        } finally {
            if (!this.isDisposed) { this.busy = false; this.render(); }
        }
    }
    private onIntent(event: ILoginIntent): void {
        if (event.owner !== this.options.owner || this.busy) return;
        if (event.kind === 'select') {
            const server = this.options.service.servers_.find(item => Number(item.serverId) === event.serverId);
            if (!server) { this.options.feedback.tip('选择的服务器不存在，请重新选择'); return; }
            const check = canEnterServer(server, Array.from(this.options.service.recentServerIds_));
            if (!check.ok) { this.options.feedback.tip(check.reason || '当前服务器不可进入'); return; }
            this.options.service.setSelectedServer(event.serverId);
            this.options.servers.closeServers();
            this.render();
        } else if (event.kind === 'servers') {
            void this.openServers();
        } else if (event.kind === 'toggle-agreement') {
            try {
                this.options.service.saveAgreement(event.agreed);
                this.agreed = event.agreed;
            } catch (error) { this.problem(error); }
            this.render();
        } else if (event.kind === 'toggle-password-visibility') {
            this.showPassword = !this.showPassword;
            this.render();
        } else if (event.kind === 'platform-login') {
            if (this.options.channel.platformLoginVisible) void this.submitPlatformLogin();
        } else {
            void this.submit(event);
        }
    }
    private async openServers(): Promise<void> {
        if (this.openingServers || this.options.service.servers_.length === 0) return;
        this.openingServers = true;
        try {
            await this.options.servers.openServers({ owner: this.options.owner, servers: this.options.service.servers_, selectedServerId: this.options.service.selectedServerId_ });
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { this.openingServers = false; }
    }
    /** 校验协议勾选，未勾选时弹提示并返回 false */
    private requireAgreement(): boolean {
        if (this.agreed) return true;
        this.options.feedback.tip('请先阅读并同意用户协议和隐私政策');
        return false;
    }
    private async submitPlatformLogin(): Promise<void> {
        if (!this.requireAgreement()) return;
        this.busy = true;
        this.render();
        let entering = false;
        try {
            const result = await this.options.service.loginWithPlatform();
            if (this.isDisposed) return;
            if (!result.ok) { this.options.feedback.tip(result.reason || '渠道登录失败'); return; }
            entering = true;
            this.status = '登录成功，正在进入游戏…';
            this.render();
            this.own(this.options.clock.schedule(() => {
                this.options.servers.closeServers();
                this.options.navigation.navigate(GameRoute.PostLogin, { session: result.session });
            }, 0.15));
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { if (!this.isDisposed && !entering) { this.busy = false; this.render(); } }
    }
    private async submit(event: Extract<ILoginIntent, { readonly kind: 'login' | 'register' }>): Promise<void> {
        if (!this.requireAgreement()) return;

        // 输入校验
        const account = event.account.trim();
        if (!account || !event.password) {
            this.options.feedback.tip('请输入账号和密码');
            return;
        }
        if (account.length < 4) {
            this.options.feedback.tip('账号长度至少 4 位');
            return;
        }
        if (event.password.length < 6) {
            this.options.feedback.tip('密码长度至少 6 位');
            return;
        }

        this.busy = true;
        this.render();
        let entering = false;
        try {
            const result = event.kind === 'login'
                ? await this.options.service.login(account, event.password)
                : await this.options.service.register(account, event.password);
            if (this.isDisposed) return;
            if (!result.ok) { this.options.feedback.tip(result.reason || (event.kind === 'login' ? '登录失败' : '注册失败')); return; }

            // 注册成功后自动登录，无需用户再点一次
            if (event.kind === 'register') {
                this.pendingAutoLogin = { account, password: event.password };
                this.options.feedback.tip('注册成功，正在自动登录…');
                const autoLoginResult = await this.options.service.login(account, event.password);
                if (this.isDisposed) return;
                if (!autoLoginResult.ok) {
                    this.options.feedback.tip(autoLoginResult.reason || '自动登录失败，请手动登录');
                    this.pendingAutoLogin = null;
                    return;
                }
                entering = true;
                this.status = '登录成功，正在进入游戏…';
                this.render();
                this.own(this.options.clock.schedule(() => {
                    this.options.servers.closeServers();
                    this.options.navigation.navigate(GameRoute.PostLogin, { account, session: autoLoginResult.session });
                }, 0.15));
                return;
            }

            entering = true;
            this.status = '登录成功，正在进入游戏…';
            this.render();
            this.own(this.options.clock.schedule(() => {
                this.options.servers.closeServers();
                this.options.navigation.navigate(GameRoute.PostLogin, { account, session: result.session });
            }, 0.15));
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { if (!this.isDisposed && !entering) { this.busy = false; this.render(); } }
    }
    private problem(error: unknown): void { this.options.feedback.tip(error instanceof Error ? error.message : String(error)); }
    private render(): void {
        this.options.view.render({
            version: this.version,
            busy: this.busy,
            status: this.status,
            server: this.options.service.servers_.find(item => Number(item.serverId) === this.options.service.selectedServerId_) ?? null,
            agreed: this.agreed,
            showPassword: this.showPassword,
            platformLoginVisible: this.options.channel.platformLoginVisible,
            accountPasswordVisible: !this.options.channel.platformLoginVisible,
            gmVisible: this.options.channel.gmVisible,
            loginButtonText: this.busy ? '登录中…' : '登录',
        });
    }
}
