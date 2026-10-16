import type { NetworkTransport } from '../../core/network/NetworkTransport';

export const DEFAULT_VERSION_CONFIG: VersionConfig = {
    index: 'tafang-internal',
    url: 'https://cdn-msdf.fdsf675.com/wechatgame/debug/tfneiwang.json',
    version: '0.6.0.0',
};

export interface VersionConfig {
    index: string;
    url: string;
    version: string;
}

export interface GameConfig {
    name?: string;
    url: string;
    backstageurl: string;
    channel?: string;
    channelCode: number;
    isWss?: boolean;
    version?: string;
    sdkType?: string;
}

export interface BackgroundConfig {
    gameConfig: GameConfig;
}

export interface ServerInfoData {
    serverId: string;
    name: string;
    serverOpenTime: number;
    status: number;
    warning?: string;
    [key: string]: unknown;
}

export const ServerStatus = {
    Recommend: 0,
    Maintenance: 1,
    Full: 2,
    New: 10,
} as const;

export interface UserInfo {
    code: string;
    time: number;
    token: string;
    openid?: string;
}

export interface RoleListItem {
    loginTime: number;
    roleId: number;
    selectServerId: number;
}

export interface ServerAddress {
    id: number;
    point: number;
    host: string;
    port: number;
    name: string;
    wssHost: string;
    wssPort: number;
}

export interface ActionLogin {
    roleId: number;
    token: string;
    time: number;
    roleList?: RoleListItem[];
    roleServerList?: number[];
    recentServerId?: number;
    selectServerId: number;
    state?: number;
    gameSecret?: string;
    gamePaySecret?: string;
    serverAddress: ServerAddress;
}

interface ApiEnvelope<T> {
    result?: boolean;
    content?: T;
    code?: number;
    data?: T;
    tips?: string;
}

/** @deprecated 仅用于兼容旧测试/调用方；新代码请注入 NetworkTransport。 */
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface LoginBootstrap {
    version: VersionConfig;
    background: BackgroundConfig;
    servers: ServerInfoData[];
}

/**
 * CC 2.4 源工程登录 HTTP 协议的 3.8 可测试实现。
 * 所有 URL 和请求字段均对应源工程 AppCustomData / YouaiSDK / ModelServer。
 */
export class LoginGateway {
    private readonly transport: NetworkTransport;

    constructor(transport: NetworkTransport | JsonFetcher) {
        this.transport = typeof transport === 'function'
            ? { requestJson: async <T>({ url }: { url: string }) => await transport(url) as T }
            : transport;
    }

    async bootstrap(version: VersionConfig = DEFAULT_VERSION_CONFIG): Promise<LoginBootstrap> {
        const configUrl = resolveVersionUrl(version.url, version.index);
        const background = await this.requestJson<BackgroundConfig>(configUrl);
        if (!background?.gameConfig?.url || !background.gameConfig.backstageurl) {
            throw new Error('远端 gameConfig 缺少登录中心或后台地址');
        }

        const response = await this.requestJson<ApiEnvelope<ServerInfoData[]>>(joinUrl(background.gameConfig.backstageurl, 'allServers.json'));
        const servers = response.data;
        if (response.code !== 200 || !Array.isArray(servers)) {
            throw new Error('服务器列表响应无效');
        }
        return { version, background, servers };
    }

    async loginAccount(config: GameConfig, account: string, password: string): Promise<UserInfo> {
        const url = withQuery(joinUrl(config.url, 'center/account/login'), { account, password });
        return this.unwrap<UserInfo>(await this.requestJson(url), '账号或密码错误');
    }

    async registerAccount(config: GameConfig, account: string, password: string): Promise<UserInfo> {
        const url = withQuery(joinUrl(config.url, 'center/account/register'), { account, password });
        return this.unwrap<UserInfo>(await this.requestJson(url), '注册失败，请稍后重试');
    }

    async queryRecentServers(config: GameConfig, user: UserInfo): Promise<ActionLogin> {
        return this.actionLogin(config, {
            type: 'recentserverlist',
            platform: config.channelCode,
            code: user.code,
            os: 'other',
        });
    }

    async loginServer(config: GameConfig, user: UserInfo, serverId: number): Promise<ActionLogin> {
        return this.actionLogin(config, {
            type: 'sdkAndRoleList',
            platform: config.channelCode,
            code: user.code,
            token: user.token,
            time: user.time,
            isWss: config.isWss ? 1 : 0,
            otherOpenId: user.openid || '',
            selectServerId: serverId,
            os: 'other',
        });
    }

    async enterServer(config: GameConfig, user: UserInfo, serverId: number): Promise<ActionLogin> {
        return this.actionLogin(config, {
            type: 'roleLoginServer',
            platform: config.channelCode,
            code: user.code,
            selectServerId: serverId,
            os: 'other',
        });
    }

    private async actionLogin(config: GameConfig, params: Record<string, string | number>): Promise<ActionLogin> {
        const url = withQuery(joinUrl(config.url, 'center/action/login'), params);
        return this.unwrap<ActionLogin>(await this.requestJson(url), '分服登录失败');
    }

    private requestJson<T = unknown>(url: string): Promise<T> {
        return this.transport.requestJson<T>({ url, method: 'GET' });
    }

    private unwrap<T>(value: unknown, fallback: string): T {
        const response = value as ApiEnvelope<T>;
        if (!response?.result || response.content == null) {
            throw new Error(response?.tips || fallback);
        }
        return response.content;
    }
}

export function resolveVersionUrl(template: string, versionFlag: string): string {
    return template.includes('{0}') ? template.replace('{0}', encodeURIComponent(versionFlag)) : template;
}

export function joinUrl(origin: string, path: string): string {
    return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function withQuery(origin: string, params: Record<string, string | number | boolean | undefined>): string {
    const query = Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    return `${origin}${origin.includes('?') ? '&' : '?'}${query}`;
}

export function selectRecommendedServer(
    servers: ServerInfoData[],
    recentServerId?: number,
    recentServerIds: number[] = [],
): number | null {
    const canUse = (item: ServerInfoData) => canEnterServer(item, recentServerIds).ok;
    if (recentServerId) {
        const recent = servers.find((item) => Number(item.serverId) === recentServerId);
        if (recent && canUse(recent)) return recentServerId;
    }
    const sorted = servers.filter(canUse).slice().sort((a, b) => b.serverOpenTime - a.serverOpenTime);
    return sorted.length ? Number(sorted[0].serverId) : null;
}

export function canEnterServer(server: ServerInfoData, recentServerIds: number[] = [], whiteList = false): { ok: boolean; reason?: string } {
    if (whiteList) return { ok: true };
    if (server.status === ServerStatus.Maintenance) return { ok: false, reason: '该服维护中，请选择其他服进入' };
    const hasRole = recentServerIds.some((id) => id === Number(server.serverId));
    if (server.status === ServerStatus.Full && !hasRole) return { ok: false, reason: '该服已爆满，请选择最新服进入' };
    return { ok: true };
}

/**
 * `CmdClientInfo` 的 proto2 `required` 字段清单（源：`client_proto/protoCompiled.proto`）。
 *
 * ⚠️ 一个都不能缺，否则**角色登录发不出去**。原因链（2026-09-23 实测）：
 *   1. `CmdRoleLoginReqMsg.encode` 对 `cmd_client_info` 是**无守卫**递归：
 *      `CmdClientInfo.encode(message.cmdClientInfo, writer.uint32(10).fork(), q + 1)`
 *   2. `CmdClientInfo.encode` 对 required 也是**无守卫无条件写**：
 *      `writer.uint32(10).string(message.imei)`
 *   3. 业务层传的是**普通对象字面量**，不是 `CmdClientInfo` 实例 ——
 *      读不到 pbjs 在 `CmdClientInfo.prototype.imei = ""` 上的兜底默认值
 *   4. → `writer.uint32(10).string(undefined)` 抛
 *      `TypeError: The "string" argument must be of type string...`
 *   5. → `ProtoCoder.encode` 抛 → `GameNet.pushRequest` 的 Promise reject →
 *      `LoginRoot.playerLogin` catch 返 false → `connectGameServer` 调 `closeSocket()`
 *      → 现象是 **WS 握手成功、`链接成功` 已打印、发完 `CmdRoleLoginReqMsg` 立刻
 *      `socket close code 1005 wasClean=true`**，且本地没有任何异常堆栈。
 */
export const CMD_CLIENT_INFO_REQUIRED_FIELDS = [
    'imei',
    'mac',
    'idfa',
    'mobileBrand',
    'mobileModel',
    'versionName',
    'versionCode',
    'systemName',
    'systemVersion',
    'networkType',
    'bigChannel',
    'smallChannel',
    'smallChannelPack',
] as const;

/** `createClientInfo()` 的产物形状：13 个 required 字段 + 2 个 optional。 */
export type ClientInfoPayload = Record<(typeof CMD_CLIENT_INFO_REQUIRED_FIELDS)[number], string> & {
    appType: string;
    appId: string;
};

/**
 * 组装 `CmdRoleLoginReqMsg.cmd_client_info`。
 *
 * 服务端不校验这些字段的内容（拆分前的 `LoginPage.playerLogin` 也全填空串），
 * 但 proto 声明是 required，**必须每个 key 都存在且是字符串**。
 */
export function createClientInfo(version: string, channel: string): ClientInfoPayload {
    return {
        imei: '',
        mac: '',
        idfa: '',
        mobileBrand: '',
        mobileModel: '',
        versionName: version,
        versionCode: version,
        systemName: '',
        systemVersion: '',
        networkType: '',
        bigChannel: channel,
        smallChannel: '',
        smallChannelPack: '',
        appType: '',
        appId: '',
    };
}


