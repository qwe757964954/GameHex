import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { GameRoute } from '../../core/runtime/GameRoute';
import { canEnterServer, type VersionConfig } from './LoginProtocol';
import { LoginUiEvent, type ILoginIntent, type ILoginService, type LoginOutput } from './LoginEvents';

export interface ILoginControllerOptions {
    readonly service: ILoginService;
    readonly config: {
        readonly loadVersion: () => Promise<VersionConfig>;
    };
    readonly clock: {
        readonly schedule: (callback: () => void, seconds: number) => () => void;
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
    private agreed = false;
    private showPassword = false;

    constructor(context: IControllerContext, private readonly options: ILoginControllerOptions) {
        super(context, 'login');
        this.own(() => options.service.dispose());
        this.own(() => this.emitOutput({ kind: 'closeServers' }));
    }
    async start(): Promise<void> {
        if (this.isDisposed) return;
        this.listen(LoginUiEvent.Intent, this.onIntent);
        this.emitOutput({ kind: 'restoreCredentials', value: this.options.service.restoreAccount() });
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
            if (!result.ok) this.tip(result.reason || '服务器列表获取失败');
            else {
                this.status = '服务器列表已就绪';
                if (!this.options.service.protocolReady_) this.tip('协议资源待检查，可能无法登录');
            }
        } catch (error) {
            if (!this.isDisposed) this.problem(error);
        } finally {
            if (!this.isDisposed) { this.busy = false; this.render(); }
        }
    }
    private onIntent(event: ILoginIntent): void {
        if (this.busy) return;
        if (event.kind === 'select') {
            const server = this.options.service.servers_.find(item => Number(item.serverId) === event.serverId);
            if (!server) { this.tip('选择的服务器不存在，请重新选择'); return; }
            const check = canEnterServer(server, Array.from(this.options.service.recentServerIds_));
            if (!check.ok) { this.tip(check.reason || '当前服务器不可进入'); return; }
            this.options.service.setSelectedServer(event.serverId);
            this.emitOutput({ kind: 'closeServers' });
            this.render();
        } else if (event.kind === 'servers') {
            this.openServers();
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
    private openServers(): void {
        if (this.options.service.servers_.length === 0) return;
        this.emitOutput({
            kind: 'openServers',
            servers: this.options.service.servers_,
            selectedServerId: this.options.service.selectedServerId_,
        });
    }
    /** 校验协议勾选，未勾选时弹提示并返回 false */
    private requireAgreement(): boolean {
        if (this.agreed) return true;
        this.tip('请先阅读并同意用户协议和隐私政策');
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
            if (!result.ok) { this.tip(result.reason || '渠道登录失败'); return; }
            entering = true;
            this.scheduleEnter({ session: result.session });
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { if (!this.isDisposed && !entering) { this.busy = false; this.render(); } }
    }
    private async submit(event: Extract<ILoginIntent, { readonly kind: 'login' | 'register' }>): Promise<void> {
        if (!this.requireAgreement()) return;

        // 输入校验
        const account = event.account.trim();
        if (!account || !event.password) {
            this.tip('请输入账号和密码');
            return;
        }
        if (account.length < 4) {
            this.tip('账号长度至少 4 位');
            return;
        }
        if (event.password.length < 6) {
            this.tip('密码长度至少 6 位');
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
            if (!result.ok) { this.tip(result.reason || (event.kind === 'login' ? '登录失败' : '注册失败')); return; }

            // 注册成功后自动登录，无需用户再点一次
            if (event.kind === 'register') {
                this.tip('注册成功，正在自动登录…');
                const autoLoginResult = await this.options.service.login(account, event.password);
                if (this.isDisposed) return;
                if (!autoLoginResult.ok) {
                    this.tip(autoLoginResult.reason || '自动登录失败，请手动登录');
                    return;
                }
                entering = true;
                this.scheduleEnter({ account, session: autoLoginResult.session });
                return;
            }

            entering = true;
            this.scheduleEnter({ account, session: result.session });
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { if (!this.isDisposed && !entering) { this.busy = false; this.render(); } }
    }
    private scheduleEnter(params: unknown): void {
        this.status = '登录成功，正在进入游戏…';
        this.render();
        this.own(this.options.clock.schedule(() => {
            this.emitOutput({ kind: 'closeServers' });
            this.navigate(GameRoute.PostLogin, params);
        }, 0.15));
    }
    private navigate(route: string, params?: unknown): void {
        this.emitOutput({ kind: 'navigate', route, params });
    }
    private tip(message: string): void {
        this.emitOutput({ kind: 'tip', message });
    }
    private problem(error: unknown): void { this.tip(error instanceof Error ? error.message : String(error)); }
    private render(): void {
        this.emitOutput({
            kind: 'render',
            state: {
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
            },
        });
    }
    private emitOutput(output: LoginOutput): void {
        EventMgr.instance.emit(LoginUiEvent.Output, output, this);
    }
}
