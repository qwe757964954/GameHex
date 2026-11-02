import { _decorator, Button, Color, Component, EditBox, Label, Node } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { LoginUiEvent, type ILoginViewState } from './LoginEvents';
import { serverStatusText } from './ServerSelectItem';

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


    onLoad(): void {
        this.repairStatusLabelBinding();
        this.serverButton.on(Button.EventType.CLICK, this.onServers, this);
        this.loginButton.on(Button.EventType.CLICK, this.onLogin, this);
        this.registerButton.on(Button.EventType.CLICK, this.onRegister, this);
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
        this.loginButton.getComponent(Button).interactable = !state.busy;
        this.registerButton.getComponent(Button).interactable = !state.busy;
        this.serverButton.getComponent(Button).interactable = !state.busy;
        const status = this.statusLabel;
        if (status) { status.string = state.status; status.color = STATUS_COLOR; }
    }
    private readonly onServers = (): void => { EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind: 'servers' }); };
    private readonly onLogin = (): void => { this.submit('login'); };
    private readonly onRegister = (): void => { this.submit('register'); };
    private submit(kind: 'login' | 'register'): void {
        EventMgr.instance.emit(LoginUiEvent.Intent, { owner: this, kind, account: this.accountInput.string, password: this.passwordInput.string });
    }
    private repairStatusLabelBinding(): void {
        if (!this.statusLabel) this.statusLabel = (this.root ?? this.node).getChildByName('StatusLabel')?.getComponent(Label) ?? null;
    }
}
