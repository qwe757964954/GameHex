import {
    _decorator,
    Color,
    Component,
    EditBox,
    Label,
    Node,
    resources,
} from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import {
    DEFAULT_VERSION_CONFIG,
    LoginGateway,
    ServerInfoData,
    VersionConfig,
} from './LoginProtocol';
import { LoginRoot } from './LoginRoot';
import { ServerSelectOptions, ServerSelectPanel } from './ServerSelectPanel';
import { serverStatusText } from './ServerSelectItem';
import { GameNet } from '../net/GameNet';
import { Toast } from '../common/Toast';

const { ccclass, property } = _decorator;

const STATUS_COLOR = new Color(166, 176, 166, 255);

/**
 * 登录页 UI（LoginPage）：纯视图组件。
 *
 * 只负责：读输入框、绑按钮、把状态文字渲染到 Label。
 * 所有业务流程（网络、登录、注册、选服、连接游戏服）都在 LoginRoot。
 */
@ccclass('LoginPage')
export class LoginPage extends Component {
    // ===== 编辑器拖拽绑定 =====
    @property({ type: Node, tooltip: '登录根节点 LoginRoot' })
    root: Node = null;

    @property({ type: EditBox, tooltip: '账号输入框 AccountEdit' })
    accountInput: EditBox = null;

    @property({ type: EditBox, tooltip: '密码输入框 PasswordAccount' })
    passwordInput: EditBox = null;

    @property({ type: Label, tooltip: '服务器按钮文字 ServerLab' })
    serverButtonLabel: Label = null;

    @property({ type: Label, tooltip: '登录状态文字 StatusLabel' })
    statusLabel: Label = null;

    @property({ type: Label, tooltip: '版本号文字 VersionLabel' })
    versionLabel: Label = null;

    @property({ type: Node, tooltip: '选择服务器按钮 ServerBtn' })
    serverButton: Node = null;

    @property({ type: Node, tooltip: '登录按钮 LoginBtn' })
    loginButton: Node = null;

    @property({ type: Node, tooltip: '注册按钮 RegisterBtn' })
    registerButton: Node = null;

    // ===== 业务根（不进 Inspector）=====
    private rootLogic = new LoginRoot();
    private serverSelectPanel: ServerSelectPanel | null = null;
    private openingServerPanel = false;
    private disposed = false;
    private warnedMissingStatusLabel = false;

    configureGateway(gateway: LoginGateway): void {
        this.rootLogic.configureGateway(gateway);
    }

    onLoad(): void {
        console.info('[LoginPage] 开始装配登录页');
        this.disposed = false;
        this.repairStatusLabelBinding();
        this.bindButtons();
        const { account, password } = this.rootLogic.restoreAccount();
        this.accountInput.string = account;
        this.passwordInput.string = password;
        console.info('[LoginPage] 输入框和按钮装配完成');
        void this.initialize().catch((error: unknown) => {
            if (this.disposed) return;
            console.error('[LoginPage] 登录页初始化异常', error);
            this.showProblem('登录页初始化失败，请重新启动后重试');
        });
    }

    onDestroy(): void {
        this.disposed = true;
        this.rootLogic.dispose();
        this.unscheduleAllCallbacks();
    }

    private resolveRoot(): Node {
        if (this.root) return this.root;
        this.root = this.node;
        return this.root;
    }

    private bindButtons(): void {
        this.serverButton?.on(Node.EventType.TOUCH_END, () => void this.openServerList(), this);
        this.loginButton?.on(Node.EventType.TOUCH_END, () => void this.login(), this);
        this.registerButton?.on(Node.EventType.TOUCH_END, () => void this.register(), this);
    }

    private async initialize(): Promise<void> {
        // 读版本配置
        console.info('[LoginPage] 开始读取包内版本配置');
        const versionConfig = await this.loadVersionConfig();
        if (this.disposed) return;
        console.info('[LoginPage] 包内版本配置已就绪');

        if (this.versionLabel) this.versionLabel.string = `客户端 v${versionConfig.version}`;
        this.setStatus('正在获取服务器列表…');

        const result = await this.rootLogic.bootstrap(versionConfig);
        if (this.disposed) return;
        console.info(`[LoginPage] 服务器列表初始化结束：${result.ok ? '成功' : '失败'}，${result.servers.length} 个服务器`);

        if (!result.ok) {
            this.updateServerButton();
            this.showProblem(result.reason || '服务器列表获取失败');
            return;
        }

        this.updateServerButton();
        this.setStatus('服务器列表已就绪');
        if (!this.rootLogic.protocolReady_) Toast.show('协议资源待检查，可能无法登录');
    }

    private loadVersionConfig(): Promise<VersionConfig> {
        return new Promise((resolve) => {
            resources.load('config/app_version', (error: Error | null, asset: any) => {
                if (!error && asset?.json) resolve(asset.json as VersionConfig);
                else {
                    console.warn('[LoginPage] 使用内置 app_version', error);
                    resolve(DEFAULT_VERSION_CONFIG);
                }
            });
        });
    }

    private async login(): Promise<void> {
        if (this.rootLogic.isBusy || this.disposed) return;
        const account = this.accountInput.string.trim();
        const password = this.passwordInput.string;

        this.busyUI(true);
        try {
            const result = await this.rootLogic.login(account, password, GameNet.instance);
            if (this.disposed) return;
            if (!result.ok) {
                this.showProblem(result.reason || '登录失败');
                return;
            }
            this.setStatus('登录成功，正在进入游戏…');
            this.scheduleOnce(() => this.enterGame({ account, session: result.session }), 0.15);
        } finally {
            this.busyUI(false);
        }
    }

    private async register(): Promise<void> {
        if (this.rootLogic.isBusy || this.disposed) return;
        const account = this.accountInput.string.trim();
        const password = this.passwordInput.string;

        this.busyUI(true);
        try {
            this.setStatus('正在注册…');
            const result = await this.rootLogic.register(account, password);
            if (this.disposed) return;
            if (!result.ok) {
                this.showProblem(result.reason || '注册失败');
                return;
            }
            Toast.show('注册成功，请点击登录');
        } finally {
            this.busyUI(false);
        }
    }

    private busyUI(busy: boolean): void {
        // UI 层的 busy 只控制按钮可点；根层已在 LoginRoot.busy
        this.loginButton?.getComponent('Button') && (this.loginButton.getComponent('Button').interactable = !busy);
        this.registerButton?.getComponent('Button') && (this.registerButton.getComponent('Button').interactable = !busy);
    }

    private enterGame(params?: { account: string; session: unknown }): void {
        this.serverSelectPanel?.close();
        this.serverSelectPanel = null;
        ProcedureManager.navigate(GameRoute.PostLogin, params);
    }

    private async openServerList(): Promise<void> {
        if (this.disposed || this.serverSelectPanel || this.openingServerPanel) return;
        const servers = this.rootLogic.servers_;
        if (servers.length === 0) return;
        this.openingServerPanel = true;
        try {
            // 走弹窗框架（PopupManager 栈）：不再自己 instantiate，遮罩 / 点空白关闭 / 深度排序由 PopupBase 负责。
            const panel = await ServerSelectPanel.open({
                userData: {
                    servers,
                    selectedServerId: this.rootLogic.selectedServerId_,
                    recentServerIds: this.rootLogic.recentServerIds_,
                    onSelect: (server: ServerInfoData) => {
                        this.rootLogic.setSelectedServer(Number(server.serverId));
                        this.updateServerButton();
                    },
                    onReject: (message: string) => this.showProblem(message),
                    onClose: () => { this.serverSelectPanel = null; },
                } satisfies ServerSelectOptions,
            });
            if (this.disposed) { panel?.close(); return; }
            if (!panel) { this.showProblem('选服面板打开失败'); return; }
            this.serverSelectPanel = panel;
        } catch (error) {
            if (this.disposed) return;
            console.warn('[LoginPage] 选服面板加载失败', error);
            this.showProblem('选服面板加载失败');
        } finally {
            this.openingServerPanel = false;
        }
    }

    private updateServerButton(): void {
        if (this.disposed || !this.serverButtonLabel) return;
        const server = this.rootLogic.servers_.find((s) => Number(s.serverId) === this.rootLogic.selectedServerId_);
        this.serverButtonLabel.string = server ? `${server.name}　${serverStatusText(server)}　›` : '选择服务器　›';
    }

    private setStatus(message: string): void {
        if (this.disposed) return;
        this.repairStatusLabelBinding();
        if (!this.statusLabel) {
            if (!this.warnedMissingStatusLabel) {
                this.warnedMissingStatusLabel = true;
                console.warn('[LoginPage] StatusLabel 未绑定：', message);
            }
            return;
        }
        this.statusLabel.string = message;
        this.statusLabel.color = STATUS_COLOR;
    }

    private showProblem(message: string): void {
        if (this.disposed) return;
        Toast.show(message);
    }

    private repairStatusLabelBinding(): void {
        if (this.statusLabel || this.disposed) return;
        this.statusLabel = this.resolveRoot().getChildByName('StatusLabel')?.getComponent(Label) ?? null;
    }
}
