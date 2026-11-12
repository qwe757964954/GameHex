import type { ServerInfoData, VersionConfig } from './LoginProtocol';

export const LoginUiEvent = { Intent: 'login:intent', ServerClosed: 'login:server-closed' } as const;

/** owner 为当前 LoginPage；弹窗与池化条目沿用该 owner，选择只传服务器 id。 */
export type ILoginIntent = { readonly owner: object } & (
    | { readonly kind: 'login' | 'register'; readonly account: string; readonly password: string }
    | { readonly kind: 'platform-login' }
    | { readonly kind: 'servers' }
    | { readonly kind: 'select'; readonly serverId: number }
    | { readonly kind: 'toggle-agreement'; readonly agreed: boolean }
    | { readonly kind: 'toggle-password-visibility' }
);

export interface IServerSelectContent {
    readonly owner: object;
    readonly servers: readonly ServerInfoData[];
    readonly selectedServerId: number | null;
}

export interface ILoginViewState {
    readonly version: string;
    readonly busy: boolean;
    readonly status: string;
    readonly server: ServerInfoData | null;
    /** 用户是否已勾选用户协议 */
    readonly agreed: boolean;
    /** 密码是否明文显示 */
    readonly showPassword: boolean;
    /** 是否展示渠道一键登录主按钮（微信/抖音渠道为 true，开发者模式为 false） */
    readonly platformLoginVisible: boolean;
    /** 是否展示账号密码登录区域（渠道登录为 false，开发者模式为 true） */
    readonly accountPasswordVisible: boolean;
    /** GM 按钮是否可见（仅开发/体验渠道显示） */
    readonly gmVisible: boolean;
    /** 登录主按钮文字 */
    readonly loginButtonText: string;
}

export interface ILoginResult { readonly ok: boolean; readonly reason?: string; readonly session?: unknown; }

export interface ILoginService {
    readonly servers_: readonly ServerInfoData[];
    readonly selectedServerId_: number | null;
    readonly recentServerIds_: readonly number[];
    readonly protocolReady_: boolean;
    /** 是否有已保存的登录会话（用于自动登录判断） */
    readonly hasSavedSession_: boolean;
    restoreAccount(): { account: string; password: string };
    /** 本机协议选择；无记录时为 false，取消勾选同样持久化。 */
    restoreAgreement(): boolean;
    saveAgreement(agreed: boolean): void;
    bootstrap(version: VersionConfig): Promise<ILoginResult>;
    login(account: string, password: string): Promise<ILoginResult>;
    register(account: string, password: string): Promise<ILoginResult & { session?: unknown }>;
    /** 渠道一键登录（微信/抖音授权） */
    loginWithPlatform(): Promise<ILoginResult>;
    setSelectedServer(id: number): void;
    dispose(): void;
}
