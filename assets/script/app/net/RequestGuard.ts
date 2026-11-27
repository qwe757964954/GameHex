/**
 * 网络请求的通用守卫工具，纯函数、零引擎依赖，Node 单测可直接 import。
 */
import { ResourceScope } from '../../core/asset/ResourceScope';
import { toCount, toIdString, toPositiveInt } from '../../core/value/Coerce';
import { WRITE_TIMEOUT_MS } from './Timeouts';

export { toCount, toIdString, toPositiveInt };

/** 网络发送端口（不依赖 GameNet，便于 Node 单测注入）。 */
export interface IGameSendPort {
    readonly isConnected: boolean;
    send(message: unknown, cache: boolean): Promise<boolean>;
}

/** 支持按宿主统一注销的网络端口（供会话级发送器使用）。 */
export interface IScopedNetPort extends IGameSendPort {
    removeCaller(caller: object): void;
}

/** 网络请求三态；与 `core/types/NetResult` 同口径。 */
export type GameRequestStatus = 'ok' | 'offline' | 'failed';
export type CancellableRequest<T> = Promise<T> & { cancel(): void };

/** 会话级请求四态：明确区分服务端 `CmdTips` 拒单（`rejected`）与未发/未确认。 */
export type ScopedRequestStatus = 'ok' | 'rejected' | 'offline' | 'unconfirmed';

export type ScopedRequestOutcome<TResponse = unknown> =
    | { readonly status: 'ok'; readonly response: TResponse }
    | { readonly status: Exclude<ScopedRequestStatus, 'ok'> };

export interface IScopedRequestMessage {
    allowRetry: boolean;
    canSend: (() => boolean) | null;
    fErrorCallback: Function;
}

export interface IScopedRequestOptions {
    readonly timeoutMs?: number;
    readonly expiresMs?: number;
    readonly tag?: string;
    readonly allowRetry?: boolean;
    /** 单次请求结束后立即注销宿主（如串行榜单查询在超时的情况下立即释放底层挂起项）。 */
    readonly releaseCallerOnSettled?: boolean;
    readonly onBlock?: (status: Exclude<ScopedRequestStatus, 'ok'>, failure: string | null) => void;
}

export interface IScopedNetSenderOptions {
    readonly name?: string;
    readonly scope?: ResourceScope;
    readonly isAlive?: () => boolean;
}

/**
 * 绑定会话作用域的网络请求发送器。
 *
 * 将宿主存活检查、`canSend` 有效期、`fErrorCallback` 四态归类与释放时唯一一次 `removeCaller`
 * 收口到同一处，业务网关只需保留协议构造与入参校验。
 */
export class ScopedNetSender {
    readonly scope: ResourceScope;
    private readonly isAlive: () => boolean;

    constructor(
        private readonly net: () => IScopedNetPort,
        private readonly caller: object,
        options?: IScopedNetSenderOptions,
    ) {
        this.scope = options?.scope ?? new ResourceScope(options?.name ?? 'scoped-net');
        this.isAlive = options?.isAlive ?? (() => true);
        this.scope.defer(() => {
            this.net().removeCaller(this.caller);
        });
    }

    get disposed(): boolean {
        return this.scope.disposed;
    }

    get alive(): boolean {
        return !this.scope.disposed && this.isAlive();
    }

    dispose(): void {
        this.scope.dispose();
    }

    async send<TResponse = unknown>(
        make: (receive: (response: TResponse) => void) => IScopedRequestMessage,
        options?: IScopedRequestOptions,
    ): Promise<ScopedRequestOutcome<TResponse>> {
        if (this.scope.disposed) {
            options?.onBlock?.('offline', 'disposed');
            return { status: 'offline' };
        }
        if (!this.isAlive()) {
            options?.onBlock?.('offline', 'owner_switched');
            return { status: 'offline' };
        }
        let response: TResponse | null = null;
        let hasResponse = false;
        let failure: string | null = null;
        const request = make((rsp) => {
            response = rsp;
            hasResponse = true;
        });
        const timeoutMs = options?.timeoutMs ?? WRITE_TIMEOUT_MS;
        const expiresMs = options?.expiresMs;
        if (expiresMs !== undefined) {
            const expiresAt = Date.now() + expiresMs;
            request.canSend = () => !this.scope.disposed && this.isAlive() && Date.now() < expiresAt;
        } else {
            request.canSend = () => !this.scope.disposed && this.isAlive();
        }
        if (options?.allowRetry !== undefined) {
            request.allowRetry = options.allowRetry;
        }
        // 传输层失败原因（server_error / timeout / cancelled / send fail）在 onReject 时先回填再 resolve(false)。
        request.fErrorCallback = (reason: string | null): void => {
            failure = reason;
        };
        const net = this.net();
        let status: GameRequestStatus;
        try {
            status = await sendGameRequest(net, () => request, { timeoutMs, tag: options?.tag });
        } finally {
            if (options?.releaseCallerOnSettled) {
                net.removeCaller(this.caller);
            }
        }
        if (status === 'offline') {
            options?.onBlock?.('offline', 'offline');
            return { status: 'offline' };
        }
        if (this.scope.disposed || !this.isAlive()) {
            if (failure === 'cancelled' || failure === 'send fail') {
                options?.onBlock?.('offline', failure);
                return { status: 'offline' };
            }
            options?.onBlock?.('unconfirmed', failure ?? 'owner_changed');
            return { status: 'unconfirmed' };
        }
        if (failure === 'server_error') {
            options?.onBlock?.('rejected', failure);
            return { status: 'rejected' };
        }
        if (status !== 'ok') {
            if (failure === 'cancelled' || failure === 'send fail') {
                options?.onBlock?.('offline', failure);
                return { status: 'offline' };
            }
            options?.onBlock?.('unconfirmed', failure);
            return { status: 'unconfirmed' };
        }
        if (!hasResponse) {
            options?.onBlock?.('unconfirmed', 'missing_response');
            return { status: 'unconfirmed' };
        }
        return { status: 'ok', response: response as TResponse };
    }
}

export interface IGameRequestOptions {
    readonly timeoutMs?: number;
    readonly tag?: string;
}

export interface IGameRequestResultOptions<TResponse, TResult> extends IGameRequestOptions {
    readonly event: string;
    readonly decode: (response: TResponse) => TResult | null;
}

/** 主动取消会结束等待，并阻止该请求发布结果。 */
export function sendGameRequestResult<TResponse, TResult>(
    net: IGameSendPort,
    make: ((receive: (response: TResponse) => void) => unknown) | null,
    options: IGameRequestResultOptions<TResponse, TResult>,
    publish: (event: string, result: TResult | null) => void,
): CancellableRequest<TResult | null> {
    let cancelled = false;
    let response: TResponse | null = null;
    const status: Promise<GameRequestStatus> & { cancel?: () => void } = make
        ? sendGameRequest(net, () => make(value => { response = value; }), options)
        : Promise.resolve('failed');
    const result = status.then(outcome => {
        if (cancelled) return null;
        let value: TResult | null = null;
        try {
            if (outcome === 'ok' && response !== null) value = options.decode(response);
        } catch (error) {
            console.warn(`[${options.tag ?? 'Request'}] 响应解析失败`, error);
        }
        try {
            publish(options.event, value);
        } catch (error) {
            console.error(`[${options.tag ?? 'Request'}] 响应事件处理失败`, error);
        }
        return value;
    });
    return Object.assign(result, { cancel() {
        cancelled = true;
        status.cancel?.();
    } });
}

/**
 * 统一「离线判定 → 发送 → 硬超时 → 三态」壳；响应回调仍由 `make()` 创建的消息对象持有。
 * 超时默认 5000ms（写请求口径）；读请求传 `timeoutMs`。
 */
export function sendGameRequest(
    net: IGameSendPort,
    make: () => unknown,
    options?: IGameRequestOptions,
): Promise<GameRequestStatus> & { cancel?: () => void } {
    // strict 关闭、运行时仍可能被 JS 侧传进空值，这里的 `?.` 是运行期防御，不是类型兜底。
    if (!net?.isConnected) return Promise.resolve('offline');
    try {
        const sent = withTimeout(
            net.send(make(), false),
            options?.timeoutMs ?? WRITE_TIMEOUT_MS,
            () => false,
        );
        return Object.assign(sent.then((ok): GameRequestStatus => ok === true ? 'ok' : 'failed'), { cancel: sent.cancel });
    } catch (error) {
        console.warn(`[${options?.tag ?? 'Request'}] 请求失败`, error);
        return Promise.resolve('failed');
    }
}

/**
 * 给一个 Promise 兜**硬超时**：`ms` 内没兑现就用 `fallback()` 顶上，**保证一定兑现**。
 *
 * 为什么必须有它：`GameNet.send` 只在「收到回包」或「断线」时兑现
 * （`NetSocket.onTimeOut()` 只在断线清心跳 / `ClearAllRequest()` 里被调用），
 * **没有按请求的超时** —— 服务端不认识某条消息、干脆不回应时，那个 Promise 会**永远悬着**。
 * 更常见的一种是：协议只加了 message 定义、**没登记 MessageId**，`GameNet` 虽然会 reject，
 * 但 reject 之前已经打过日志；调用方若不是每个分支都 catch，整条流程就卡住。
 *
 * 超时会取消支持 cancel 的请求，释放业务回调；普通 Promise 只结束等待。
 */
export function withTimeout<T>(promise: Promise<T> & { cancel?: () => void }, ms: number, fallback: () => T): CancellableRequest<T> {
    let cancel: () => void;
    const result = new Promise<T>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (value: T): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            resolve(value);
        };
        cancel = (): void => {
            if (settled) return;
            promise.cancel?.();
            finish(fallback());
        };
        timer = setTimeout(cancel, Math.max(0, ms));
        void promise.then(finish, cancel);
    });
    return Object.assign(result, { cancel });
}
