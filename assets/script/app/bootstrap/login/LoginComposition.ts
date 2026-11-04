import { instantiate, JsonAsset, Node, Prefab, Vec3 } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import type { NetworkTransport } from '../../../core/network/NetworkTransport';
import { FW } from '../../../framework/FW';
import { LoginController } from '../../login/LoginController';
import { LoginRoot } from '../../login/LoginRoot';
import { LoginPage } from '../../login/LoginPage';
import { LoginGateway, DEFAULT_VERSION_CONFIG, type VersionConfig } from '../../login/LoginProtocol';
import type { ILoginService, IServerSelectContent } from '../../login/LoginEvents';
import { LoginUiEvent } from '../../login/LoginEvents';
import { ServerSelectPanel } from '../../login/ServerSelectPanel';
import { GameNet } from '../../net/GameNet';

/** 登录组合根拥有页面、控制器及平台适配器；页面不持有业务对象。 */
export class LoginComposition extends ControllerBase {
    private prefab: Prefab | null = null;
    private node: Node | null = null;
    private panel: ServerSelectPanel | null = null;
    constructor(context: IControllerContext, private readonly network: NetworkTransport, private readonly host: Node) {
        super(context, 'login-composition');
    }
    async preload(context: ProcedurePreloadContext): Promise<void> {
        const prefab = await this.resources.assets.load('ui/login/LoginRoot', Prefab, { scope: context.resources });
        if (context.cancelled || this.isDisposed) return;
        this.prefab = prefab;
    }
    mount(): void {
        if (!this.prefab || this.isDisposed) throw new Error('LoginRoot 尚未预加载');
        try {
            const node = instantiate(this.prefab);
            this.node = node;
            const page = node.getComponent(LoginPage);
            const controller = this.createController(page);
            this.own(() => controller.dispose());
            this.listen(LoginUiEvent.ServerClosed, (event: { owner: object; panel: ServerSelectPanel }) => {
                if (event.owner === page && event.panel === this.panel) this.panel = null;
            });
            this.listen(VIEW_LIFECYCLE, (event: IViewLifecycle) => {
                if (event.owner !== page) return;
                if (event.phase === 'ready') void controller.start();
                else if (event.phase === 'destroyed') this.dispose();
            });
            node.setPosition(Vec3.ZERO);
            node.setParent(this.host);
        } catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[LoginComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private createController(page: LoginPage): LoginController {
        const root = new LoginRoot();
        root.configureGateway(new LoginGateway(this.network));
        return new LoginController(this.resources, {
            owner: page,
            service: createLoginService(root),
            config: {
                loadVersion: () => this.loadVersion()
            },
            view: page,
            feedback: {
                tip: text => FW.showTip(text)
            },
            servers: {
                openServers: content => this.openServers(content),
                closeServers: () => this.closeServers(),
            },
            clock: {
                schedule: (callback, seconds) => { page.scheduleOnce(callback, seconds); return () => page.unschedule(callback); }
            },
            navigation: {
                navigate: (route, params) => ProcedureManager.navigate(route, params)
            },
        });
    }
    private async openServers(content: IServerSelectContent): Promise<void> {
        if (this.panel) return;
        const panel = await ServerSelectPanel.open({ userData: content });
        if (this.isDisposed) { if (panel?.isValid) panel.close(); return; }
        if (panel?.isValid) this.panel = panel;
    }
    private closeServers(): void {
        const panel = this.panel;
        this.panel = null;
        if (panel?.isValid) panel.close();
    }
    private async loadVersion(): Promise<VersionConfig> {
        try {
            const asset = await this.resources.assets.load('config/app_version', JsonAsset);
            if (this.isDisposed) return DEFAULT_VERSION_CONFIG;
            return asset.json as VersionConfig;
        } catch (error) {
            if (!this.isDisposed) console.warn('[LoginComposition] 使用默认版本配置', error);
            return DEFAULT_VERSION_CONFIG;
        }
    }
    dispose(): void {
        this.releaseInputs();
        const node = this.node;
        this.node = null;
        this.prefab = null;
        try { if (node?.isValid) node.destroy(); }
        finally { super.dispose(); }
    }
}

function createLoginService(root: LoginRoot): ILoginService {
    return {
        get servers_() { return root.servers_; }, get selectedServerId_() { return root.selectedServerId_; },
        get recentServerIds_() { return root.recentServerIds_; }, get protocolReady_() { return root.protocolReady_; },
        restoreAccount: () => root.restoreAccount(), bootstrap: version => root.bootstrap(version),
        login: (account, password) => root.login(account, password, GameNet.instance),
        register: (account, password) => root.register(account, password),
        setSelectedServer: id => root.setSelectedServer(id), dispose: () => root.dispose(),
    };
}
