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
import { EngineMain } from '../../../engine/EngineMain';
import { WxUtil } from '../../../framework/utils/WxUtil';
import { TTUtil } from '../../../framework/utils/TTUtil';

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
        // 注入平台登录 SDK（微信 wx.login / 抖音 tt.login）
        const platformProvider = createPlatformLoginProvider();
        if (platformProvider) root.configurePlatformLogin(platformProvider);
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
            channel: resolveChannelConfig(),
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
        get hasSavedSession_() { return root.hasSavedSession_; },
        restoreAccount: () => root.restoreAccount(), bootstrap: version => root.bootstrap(version),
        restoreAgreement: () => root.restoreAgreement(), saveAgreement: agreed => root.saveAgreement(agreed),
        login: (account, password) => root.login(account, password, GameNet.instance),
        register: (account, password) => root.register(account, password),
        loginWithPlatform: () => root.loginWithPlatform(GameNet.instance),
        setSelectedServer: id => root.setSelectedServer(id), dispose: () => root.dispose(),
    };
}

/** 根据运行渠道计算登录界面的展示配置 */
function resolveChannelConfig(): { platformLoginVisible: boolean; gmVisible: boolean } {
    // 渠道登录尚未配置，各平台先统一使用账号登录。
    if (EngineMain.isMiniGameWeiXin) {
        return {
            platformLoginVisible: false,
            gmVisible: WxUtil.isDevelop() || WxUtil.isTrial(),
        };
    }
    // 抖音 GM 按钮仅开发/预览版可见。
    if (EngineMain.isMiniGameDouyin) {
        return {
            platformLoginVisible: false,
            gmVisible: TTUtil.isDevelop() || TTUtil.isTrial(),
        };
    }
    // 开发者模式 / 浏览器：显示账号密码登录，GM按钮可见
    return {
        platformLoginVisible: false,
        gmVisible: true,
    };
}

/** 创建平台登录 Provider（微信 wx.login / 抖音 tt.login），非小游戏渠道返回 null */
function createPlatformLoginProvider(): { fetchCode: () => Promise<string> } | null {
    // 微信小游戏：wx.login 获取临时登录凭证 code
    if (EngineMain.isMiniGameWeiXin) {
        return {
            fetchCode: () => new Promise<string>((resolve, reject) => {
                const wx = (window as any).wx;
                if (!wx?.login) { reject(new Error('微信登录接口不可用')); return; }
                wx.login({
                    success: (res: { code: string }) => {
                        if (res.code) resolve(res.code);
                        else reject(new Error('微信登录未返回 code'));
                    },
                    fail: (err: { errMsg: string }) => reject(new Error(err.errMsg || '微信登录失败')),
                });
            }),
        };
    }
    // 抖音小游戏：tt.login 获取临时登录凭证 code
    if (EngineMain.isMiniGameDouyin) {
        return {
            fetchCode: () => new Promise<string>((resolve, reject) => {
                const tt = (window as any).tt;
                if (!tt?.login) { reject(new Error('抖音登录接口不可用')); return; }
                tt.login({
                    success: (res: { code: string }) => {
                        if (res.code) resolve(res.code);
                        else reject(new Error('抖音登录未返回 code'));
                    },
                    fail: (err: { errMsg: string }) => reject(new Error(err.errMsg || '抖音登录失败')),
                });
            }),
        };
    }
    // 开发者模式：无平台 SDK，返回 null，由 UI 层降级到账号密码登录
    return null;
}
