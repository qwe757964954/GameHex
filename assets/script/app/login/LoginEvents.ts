import type { ServerInfoData, VersionConfig } from './LoginProtocol';

export const LoginUiEvent = { Intent: 'login:intent', ServerClosed: 'login:server-closed' } as const;
/** owner 为当前 LoginPage；弹窗与池化条目沿用该 owner，选择只传服务器 id。 */
export type ILoginIntent = { readonly owner: object } & (
    | { readonly kind: 'login' | 'register'; readonly account: string; readonly password: string }
    | { readonly kind: 'servers' }
    | { readonly kind: 'select'; readonly serverId: number }
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
}
export interface ILoginResult { readonly ok: boolean; readonly reason?: string; readonly session?: unknown; }
export interface ILoginService {
    readonly servers_: readonly ServerInfoData[];
    readonly selectedServerId_: number | null;
    readonly recentServerIds_: readonly number[];
    readonly protocolReady_: boolean;
    restoreAccount(): { account: string; password: string };
    bootstrap(version: VersionConfig): Promise<ILoginResult>;
    login(account: string, password: string): Promise<ILoginResult>;
    register(account: string, password: string): Promise<ILoginResult>;
    setSelectedServer(id: number): void;
    dispose(): void;
}
