import { _decorator, Button, Color, Component, EditBox, Label, Node, Sprite } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { LoginUiEvent, type ILoginViewState } from './LoginEvents';
import { serverStatusColor, serverStatusText } from './ServerSelectItem';

const { ccclass, property } = _decorator;
const STATUS_COLOR = new Color(166, 176, 166, 255);

@ccclass('LoginPage')
export class LoginPage extends Component {
    // ===== 编辑器拖拽绑定 =====
    @property({ type: Node, tooltip: '登录根节点 LoginRoot' })
    root: Node | null = null;

    @property({ type: EditBox, tooltip: '账号输入框 AccountEdit' })
    accountInput: EditBox = null!;

    @property({ type: EditBox, tooltip: '密码输入框 PasswordAccount' })
    passwordInput: EditBox = null!;

    @property({ type: Label, tooltip: '服务器按钮文字 ServerLab' })
    serverButtonLabel: Label = null!;

    @property(Sprite)
    serverStatusDot: Sprite = null!;

    @property({ type: Label, tooltip: '登录状态文字 StatusLabel' })
    statusLabel: Label | null = null;

    @property({ type: Label, tooltip: '版本号文字 VersionLabel' })
    versionLabel: Label = null!;

    @property({ type: Node, tooltip: '选择服务器按钮 ServerBtn' })
    serverButton: Node = null!;

    @property({ type: Node, tooltip: '登录按钮 LoginBtn' })
    loginButton: Node = null!;

    @property({ type: Node, tooltip: '注册按钮 RegisterBtn' })
    registerButton: Node = null!;

    // ===== 新增绑定（prefab 中需对应节点） =====
    @property({ type: Node, tooltip: '协议勾选框 AgreementToggle（点击切换勾选状态）' })
    agreementToggle: Node | null = null;

    @property({ type: Node, tooltip: '协议勾选图标 AgreementCheck（勾选时显示）' })
    agreementCheck: Node | null = null;

    @property({ type: Node, tooltip: '密码可见性切换按钮 PasswordToggleBtn（小眼睛图标）' })
    passwordToggleBtn: Node | null = null;

    @property({ type: Label, tooltip: '密码隐藏状态的眼睛斜线' })
    passwordToggleLabel: Label = null!;

    @property({ type: Node, tooltip: '渠道一键登录主按钮 PlatformLoginBtn（微信/抖音渠道显示）' })
    platformLoginBtn: Node | null = null;

    @property({ type: Node, tooltip: '账号密码登录区域 AccountPasswordArea（开发者模式显示）' })
    accountPasswordArea: Node | null = null;

    @property({ type: Node, tooltip: 'GM 按钮 GmBtn（仅开发/体验渠道显示）' })
    gmBtn: Node | null = null;


    onLoad(): void {
        this.repairStatusLabelBinding();
        this.serverButton.on(Button.EventType.CLICK, this.onServers, this);
        this.loginButton.on(Button.EventType.CLICK, this.onLogin, this);
        this.registerButton.on(Button.EventType.CLICK, this.onRegister, this);

        // 新增事件绑定
        if (this.agreementToggle) this.agreementToggle.on(Button.EventType.CLICK, this.onToggleAgreement, this);
        if (this.passwordToggleBtn) this.passwordToggleBtn.on(Button.EventType.CLICK, this.onTogglePasswordVisibility, this);
        if (this.platformLoginBtn) this.platformLoginBtn.on(Button.EventType.CLICK, this.onPlatformLogin, this);

        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' });
    }
    onDestroy(): void { EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' }); }

    restoreCredentials(value: { account: string; password: string }): void {
        this.accountInput.string = value.account;
        this.passwordInput.string = value.password;
    }
    render(state: ILoginViewState): void {
        this.versionLabel.string = state.version ? `客户端 v${state.version}` : '';
        this.serverButtonLabel.string = state.server
            ? `${state.server.name}　${serverStatusText(state.server)}　›` : '选择服务器　›';
        this.serverStatusDot.node.active = !!state.server;
        if (state.server) this.serverStatusDot.color = serverStatusColor(state.server);
        this.loginButton.getComponent(Button).interactable = !state.busy;
        this.registerButton.getComponent(Button).interactable = !state.busy;
        this.serverButton.getComponent(Button).interactable = !state.busy;
        const status = this.statusLabel;
        if (status) { status.string = state.status; status.color = STATUS_COLOR; }

        // 登录按钮文字
        const loginLabel = this.loginButton.getComponentInChildren(Label);
        if (loginLabel) loginLabel.string = state.loginButtonText;

        // 协议勾选状态
        if (this.agreementCheck) this.agreementCheck.active = state.agreed;

        // 密码可见性切换：用 inputFlag 控制密码模式
        this.passwordInput.inputFlag = state.showPassword
            ? EditBox.InputFlag.SENSITIVE
            : EditBox.InputFlag.PASSWORD;
        this.passwordToggleLabel.string = state.showPassword ? '' : '╱';
        if (this.agreementToggle) this.agreementToggle.getComponent(Button).interactable = !state.busy;
        if (this.passwordToggleBtn) this.passwordToggleBtn.getComponent(Button).interactable = !state.busy;

        // 渠道登录 / 账号密码区域切换
        if (this.platformLoginBtn) this.platformLoginBtn.active = state.platformLoginVisible;
        if (this.accountPasswordArea) this.accountPasswordArea.active = state.accountPasswordVisible;

        // GM 按钮可见性
        if (this.gmBtn) this.gmBtn.active = state.gmVisible;
    }
    private readonly onServers = (): void => { EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind: 'servers' }); };
    private readonly onLogin = (): void => { this.submit('login'); };
    private readonly onRegister = (): void => { this.submit('register'); };
    private readonly onPlatformLogin = (): void => { EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind: 'platform-login' }); };
    private readonly onToggleAgreement = (): void => {
        // 取当前勾选状态的反值，由 Controller 更新状态后 render 回来
        const currentlyChecked = this.agreementCheck?.active ?? false;
        EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind: 'toggle-agreement', agreed: !currentlyChecked });
    };
    private readonly onTogglePasswordVisibility = (): void => {
        EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind: 'toggle-password-visibility' });
    };
    private submit(kind: 'login' | 'register'): void {
        EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind, account: this.accountInput.string, password: this.passwordInput.string });
    }
    private repairStatusLabelBinding(): void {
        if (!this.statusLabel) this.statusLabel = (this.root ?? this.node).getChildByName('StatusLabel')?.getComponent(Label) ?? null;
    }
}
