import { RequestMsg } from '../../framework/net/RequestMsg';
import { GameNet } from '../net/GameNet';
import { toReqProtoName } from './GameSocketProtocol';

declare global {
    interface Window {
        /** 浏览器控制台协议调试入口，见 {@link GameSocketBridge.install}。 */
        GameSocket?: GameSocketDebugApi;
    }
}

/**
 * 用任意协议名构造请求消息：省去为每个协议新建 `RequestMsg` 子类。
 * `GameNet.send` 只依赖 `getReqMsgProtoName()` 出协议名，其余走统一封包链路。
 */
class RawRequestMsg<CmdReqMsg, CmdRspMsg> extends RequestMsg<CmdReqMsg, CmdRspMsg> {
    constructor(
        private readonly protoName: string,
        cmdReqMsg: CmdReqMsg,
        fCallback?: (rsp: CmdRspMsg) => void,
        fErrorCallback?: Function,
    ) {
        super(cmdReqMsg, undefined, fCallback, fErrorCallback);
    }

    getReqMsgProtoName(): string {
        return this.protoName;
    }
}

/** 浏览器控制台协议调试入口（`window.GameSocket`），语义与 tools/proto-debugger 一致。 */
export interface GameSocketDebugApi {
    /** 发送协议：协议名带 `RspMsg`/裸名都会换算到 `ReqMsg`；返回是否已入队。 */
    send(protoName: string, json?: unknown): Promise<boolean>;
    /** 全部可发送的请求协议名。 */
    readonly protocols: string[];
    /** 请求对应响应的回调（解码后的业务数据）。 */
    onResponse: ((name: string, data: unknown) => void) | null;
    /** 服务器返回错误（`result=false` 的 CmdTips）回调。 */
    onTips: ((tips: string) => void) | null;
    /** 当前是否已连上游戏服。 */
    isConnected(): boolean;
}

/**
 * 把协议调试 API 挂到 `window.GameSocket` 的组合根入口。
 *
 * 与独立调试台不同，这里直接复用游戏内的连接与登录态：`send` 走
 * `GameNet.send` → `ClientCmdData` 外包 protobuf → 游戏当前这条 WebSocket，
 * 回包经 `NetworkRequest.resolve` 解出业务数据后再转发给 `onResponse`。
 * 仅在有 `window` 的平台（Web/小游戏等）生效，由组合根幂等安装。
 * 注意：桥不绕过服务端鉴权，GM 类指令是否可执行仍由服务端决定。
 */
export class GameSocketBridge {
    private static installed = false;

    private constructor() {}

    /** 幂等安装：只在带 `window` 的平台挂载，重复进场景不会重复覆盖。 */
    static install(): void {
        if (GameSocketBridge.installed || typeof window === 'undefined') {
            return;
        }
        GameSocketBridge.installed = true;
        window.GameSocket = GameSocketBridge.createApi();
    }

    private static createApi(): GameSocketDebugApi {
        const api: GameSocketDebugApi = {
            send: (protoName, json) => GameSocketBridge.sendProto(api, protoName, json),
            get protocols(): string[] {
                return GameNet.instance.protoMgr?.listReqMsgNames() ?? [];
            },
            onResponse: null,
            onTips: null,
            isConnected: () => GameNet.instance.isConnected,
        };
        return api;
    }

    private static async sendProto(
        api: GameSocketDebugApi,
        protoName: string,
        json?: unknown,
    ): Promise<boolean> {
        const protoMgr = GameNet.instance.protoMgr;
        if (protoMgr == null) {
            console.warn('[GameSocket] 网络未初始化：登录流程尚未建立 ProtoMgr，暂不能发送');
            return false;
        }
        const reqName = toReqProtoName(protoName);
        if (protoMgr.getMessageId(reqName) == null) {
            console.warn(`[GameSocket] 不存在协议 ${protoName}（换算为 ${reqName} 后未在 MessageId 定义）`);
            return false;
        }
        const msg = new RawRequestMsg<unknown, unknown>(reqName, json ?? {}, (rsp) => {
            api.onResponse?.(reqName, rsp);
        }, (errMsg) => {
            console.warn(`[GameSocket] ${reqName} 请求失败：`, errMsg);
            api.onTips?.(String(errMsg));
        });
        return GameNet.instance.send(msg, false);
    }
}
