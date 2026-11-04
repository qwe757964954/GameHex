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
}

export class LoginController extends ControllerBase {
    private version = '';
    private status = '';
    private busy = true;
    private started = false;
    private openingServers = false;

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
        } else if (event.kind === 'servers') void this.openServers();
        else void this.submit(event);
    }
    private async openServers(): Promise<void> {
        if (this.openingServers || this.options.service.servers_.length === 0) return;
        this.openingServers = true;
        try {
            await this.options.servers.openServers({ owner: this.options.owner, servers: this.options.service.servers_, selectedServerId: this.options.service.selectedServerId_ });
        } catch (error) { if (!this.isDisposed) this.problem(error); }
        finally { this.openingServers = false; }
    }
    private async submit(event: Extract<ILoginIntent, { readonly kind: 'login' | 'register' }>): Promise<void> {
        this.busy = true;
        this.render();
        let entering = false;
        try {
            const account = event.account.trim();
            const result = event.kind === 'login'
                ? await this.options.service.login(account, event.password)
                : await this.options.service.register(account, event.password);
            if (this.isDisposed) return;
            if (!result.ok) { this.options.feedback.tip(result.reason || (event.kind === 'login' ? '登录失败' : '注册失败')); return; }
            if (event.kind === 'register') { this.options.feedback.tip('注册成功，请点击登录'); return; }
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
        this.options.view.render({ version: this.version, busy: this.busy, status: this.status,
            server: this.options.service.servers_.find(item => Number(item.serverId) === this.options.service.selectedServerId_) ?? null });
    }
}
