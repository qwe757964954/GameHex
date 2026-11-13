import type { NetworkRequest, NetworkTransport } from '../../core/network/NetworkTransport';

export interface FetchNetworkTransportOptions {
    readonly defaultTimeoutMs?: number;
    readonly localProxyOrigin?: string;
}

/** 运行时实际可用的 HTTP 能力。 */
type HttpCapability = 'fetch' | 'xhr' | 'none';

/** fetch 尚未收到响应即被网络/CORS 拒绝；响应体错误不得触发代理重发。 */
class FetchConnectionError extends Error {}

/**
 * fetch 优先、无 fetch 回落 XMLHttpRequest。微信小游戏适配层的全局白名单里
 * 既没有 fetch 也没有 AbortController（原生与 Web 有 fetch，原生是 jsb-adapter
 * 挂的 polyfill），所以超时不挂 AbortController：旧写法在没有它的环境里连定时器
 * 都不建，超时完全失效。这里用 Promise.race + setTimeout 保证超时，
 * AbortController 只在存在时顺手 abort 连接。类名沿用，组合根已按此接线。
 */
export class FetchNetworkTransport implements NetworkTransport {
    private readonly defaultTimeoutMs: number;
    private readonly localProxyOrigin: string;

    constructor(options: FetchNetworkTransportOptions = {}) {
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 12_000;
        this.localProxyOrigin = options.localProxyOrigin ?? 'http://127.0.0.1:8099';
    }

    async requestJson<T = unknown>(request: NetworkRequest): Promise<T> {
        const capability = this.httpCapability();
        if (capability === 'none') {
            throw new Error(
                '网络请求失败：当前运行环境没有可用的 HTTP 实现（fetch 与 XMLHttpRequest 均不存在）',
            );
        }

        if (this.shouldUseLocalProxy(request, capability)) {
            let directError: unknown;
            try {
                return await this.requestJsonOnce<T>(request, capability);
            } catch (error) {
                // 只有浏览器网络/CORS 拒绝才尝试代理；已收到 HTTP 响应、解析错误或超时不重发。
                if (!(error instanceof FetchConnectionError)) {
                    throw new Error(`网络请求失败：${this.errorMessage(error)}（${describeRequest(request)}）`);
                }
                directError = error;
            }
            const proxiedRequest: NetworkRequest = {
                ...request,
                url: `${this.localProxyOrigin}/proxy?url=${encodeURIComponent(request.url)}`,
            };
            try {
                return await this.requestJsonOnce<T>(proxiedRequest, capability);
            } catch (proxyError) {
                    throw new Error(
                        `网络请求失败：直连 ${this.errorMessage(directError)}，`
                        + `本地调试代理亦不可用（${this.errorMessage(proxyError)}）。`
                        + `浏览器预览被 CORS 拦截时，请在项目根目录执行 npm run proxy 启动 ${this.localProxyOrigin} 后重试。`
                        + `（${describeRequest(request)}）`,
                    );
            }
        }

        try {
            return await this.requestJsonOnce<T>(request, capability);
        } catch (error) {
            throw new Error(`网络请求失败：${this.errorMessage(error)}（${describeRequest(request)}）`);
        }
    }

    private requestJsonOnce<T>(request: NetworkRequest, capability: HttpCapability): Promise<T> {
        const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
        if (capability === 'fetch') {
            const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
            return this.withTimeout<T>(
                this.readFetchJson(request, controller) as Promise<T>,
                timeoutMs,
                `请求超时 ${timeoutMs}ms`,
                controller ? () => controller.abort() : undefined,
            );
        }

        return this.withTimeout<T>(
            this.readXhrJson(request, timeoutMs) as Promise<T>,
            timeoutMs,
            `请求超时 ${timeoutMs}ms`,
        );
    }

    private async readFetchJson(request: NetworkRequest, controller?: AbortController): Promise<unknown> {
        let response: Response;
        try {
            response = await fetch(request.url, {
                method: request.method ?? 'GET',
                headers: request.headers,
                body: request.body,
                signal: controller?.signal,
            });
        } catch (error) {
            if (error instanceof TypeError) throw new FetchConnectionError(error.message);
            throw error;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // 走 text() 再手动解析：JSON.parse 失败时能把响应体内容带进错误信息。
        return this.parseJson(await response.text());
    }

    /**
     * 显式设 xhr.timeout：微信适配层会透传给 wx.request，让底层连接真正释放，
     * 而不只是上层 Promise 提前 reject。onload 与 onreadystatechange 都挂，
     * 用 settled 去重，防止个别环境只派发其中一种。
     */
    private readXhrJson(request: NetworkRequest, timeoutMs: number): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let settled = false;
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                fn();
            };

            xhr.open(request.method ?? 'GET', request.url);
            if (timeoutMs > 0) xhr.timeout = timeoutMs;
            if (request.headers) {
                const headers = request.headers;
                for (const key of Object.keys(headers)) xhr.setRequestHeader(key, headers[key]);
            }
            xhr.onload = () => settle(() => this.resolveXhrJson(xhr, resolve, reject));
            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) settle(() => this.resolveXhrJson(xhr, resolve, reject));
            };
            xhr.ontimeout = () => settle(() => reject(new Error(`请求超时 ${timeoutMs}ms`)));
            xhr.onerror = () => settle(() => {
                reject(new Error(`网络不可达${xhr.statusText ? `（${xhr.statusText}）` : ''}`));
            });
            xhr.send(request.body ?? null);
        });
    }

    private resolveXhrJson(
        xhr: XMLHttpRequest,
        resolve: (value: unknown) => void,
        reject: (reason: Error) => void,
    ): void {
        // status 0 表示没拿到 HTTP 状态，交给 body 解析给出具体原因（微信里常见是 HTML 错误页）。
        if (xhr.status >= 400) {
            reject(new Error(`HTTP ${xhr.status}${xhr.statusText ? ` ${xhr.statusText}` : ''}`));
            return;
        }
        try {
            resolve(this.parseJson(xhr.responseText));
        } catch (error) {
            reject(error instanceof Error ? error : new Error(this.errorMessage(error)));
        }
    }

    /** 同步解析，便于 XHR 分支在 try/catch 里直接给出可读原因（微信里 responseText 可能是一段 HTML 错误页）。 */
    private parseJson(text: string): unknown {
        if (text == null || text === '') throw new Error('响应体为空，无法解析为 JSON');
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`响应不是合法 JSON：${this.errorMessage(error)}；原始内容前 80 字：${text.slice(0, 80)}`);
        }
    }

    private async withTimeout<T>(
        task: Promise<T>,
        timeoutMs: number,
        reason: string,
        onTimeout?: () => void,
    ): Promise<T> {
        if (!(timeoutMs > 0)) return task;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                if (onTimeout) onTimeout();
                reject(new Error(reason));
            }, timeoutMs);
        });
        try {
            return await Promise.race([task, timeout]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    private httpCapability(): HttpCapability {
        if (typeof fetch === 'function') return 'fetch';
        if (typeof XMLHttpRequest === 'function') return 'xhr';
        return 'none';
    }

    /**
     * 代理只解决浏览器 fetch 被 CORS 拦截，所以只在 fetch 通道、GET、HTTP(S)
     * 且本机调试环境下启用。微信没有 CORS 概念（XHR 底层是 wx.request），
     * 而微信工具的 location 会泄露成 127.0.0.1、真机又没有 hostname，
     * 不挡住会把环境缺 fetch 误报成目标站未开 CORS。
     */
    private shouldUseLocalProxy(request: NetworkRequest, capability: HttpCapability): boolean {
        if (capability !== 'fetch') return false;
        if (request.method && request.method !== 'GET') return false;
        if (!/^https?:\/\//i.test(request.url)) return false;
        if (request.url.startsWith(this.localProxyOrigin)) return false;
        const origin = globalThis.location?.origin;
        if (origin && new URL(request.url).origin === origin) return false;
        return this.isLocalDebugEnvironment();
    }

    private isLocalDebugEnvironment(): boolean {
        const host = globalThis.location?.hostname;
        if (!host) return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]') return true;
        return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    }

    private errorMessage(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return message.replace(/https?:\/\/[^\s"'<>]+/gi, url => url.split(/[?#]/, 1)[0]);
    }
}

function describeRequest(request: NetworkRequest): string {
    return `${request.method ?? 'GET'} ${request.url.split(/[?#]/, 1)[0]}`;
}
