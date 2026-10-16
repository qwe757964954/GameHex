import type { NetworkRequest, NetworkTransport } from '../../core/network/NetworkTransport';

export interface FetchNetworkTransportOptions {
    readonly defaultTimeoutMs?: number;
    readonly localProxyOrigin?: string;
}

/** 运行时实际可用的 HTTP 能力。 */
type HttpCapability = 'fetch' | 'xhr' | 'none';

/**
 * 平台层网络实现：**fetch 优先，没有 fetch 就回落 XMLHttpRequest**。
 *
 * 为什么不只用 fetch（2026-09-18 实测三端产物得出）：
 *   | 产物        | 全局 fetch                  | XMLHttpRequest          | location.hostname |
 *   | web-mobile  | 浏览器原生                  | 浏览器原生              | 真实页面           |
 *   | android     | jsb-adapter 自带 polyfill   | jsb-adapter 提供        | undefined          |
 *   | wechatgame  | **不存在**                  | 适配层提供（wx.request）| 真机 undefined     |
 *
 * 微信小游戏适配层（build/wechatgame/web-adapter.js）导出的全局白名单里只有
 * XMLHttpRequest / WebSocket / Image / localStorage / location…，**既没有 fetch 也没有 AbortController**，
 * 所以在微信里直接调 `fetch(...)` 只会抛 `fetch is not defined`。原生侧之所以一直没事，
 * 是因为 jsb-adapter 自己挂了一份 `jsbWindow.fetch = require('./fetch').fetch`（`fetch.polyfill === true`，
 * 底层照样是 XMLHttpRequest），所以回落分支在原生与 Web 上都不会走到。
 *
 * 超时为什么不能挂在 AbortController 上：微信里 `typeof AbortController === 'undefined'`，
 * 旧写法 `const timer = controller ? setTimeout(...) : undefined` 会**连定时器都不建**，
 * 超时彻底失效 —— 请求挂死后登录界面永远停在「正在登录」。
 * 这里改成 `Promise.race` + `setTimeout`，超时语义与传输方式解耦；
 * AbortController 退化为「有就用它顺手释放连接」，没有也不影响超时成立。
 *
 * 类名沿用 FetchNetworkTransport（组合根与测试已按此名接线），实现上已是双通道。
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
            const proxiedRequest: NetworkRequest = {
                ...request,
                url: `${this.localProxyOrigin}/proxy?url=${encodeURIComponent(request.url)}`,
            };
            try {
                return await this.requestJsonOnce<T>(proxiedRequest, capability);
            } catch (proxyError) {
                try {
                    return await this.requestJsonOnce<T>(request, capability);
                } catch (directError) {
                    throw new Error(
                        `网络请求失败：直连 ${this.errorMessage(directError)}，`
                        + `本地调试代理亦不可用（${this.errorMessage(proxyError)}）。`
                        + `浏览器预览被 CORS 拦截时，请在项目根目录执行 npm run proxy 启动 ${this.localProxyOrigin} 后重试。`
                        + `（${describeRequest(request)}）`,
                    );
                }
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
        const response = await fetch(request.url, {
            method: request.method ?? 'GET',
            headers: request.headers,
            body: request.body,
            signal: controller?.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // 用 text() 而不是 json()：原生 polyfill 的 json() 就是 text().then(JSON.parse)，
        // 但直接 JSON.parse 抛出来的话错误原因只剩一句 SyntaxError，拿不到响应体内容。
        return this.parseJson(await response.text());
    }

    /**
     * 微信适配层的 XMLHttpRequest 会把 `timeout` 透传给 `wx.request`（`timeout: this.timeout || void 0`），
     * 并在 wx.request 的 fail 里按 errMsg 派发 `ontimeout` / `onabort` / `onerror`，
     * 所以这里显式设 timeout，让底层连接能真正被释放，而不是只让上层 Promise 提前 reject。
     *
     * `onreadystatechange` 与 `onload` 都挂：两套适配层都实现 onload，但万一某个运行环境只派发
     * readystatechange，请求就会一直挂着 —— 而这正是本次要修掉的失败模式，用 settled 去重后两个都挂成本极低。
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
        // 只有 4xx/5xx 才算 HTTP 失败；status === 0 表示「压根没拿到 HTTP 状态」，
        // 交给下面的 body 解析去给出更具体的原因（微信里常见是一段 HTML 错误页）。
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
            return JSON.parse(text) as unknown;
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
     * 本地调试代理只解决「浏览器 fetch 被 CORS 拦下」，所以只在 fetch 通道且确实在本机调试时启用。
     *
     * 老逻辑漏了这一层：微信开发者工具里 `globalThis.location` 是工具页面自己的 location
     * （hostname 常常就是 127.0.0.1），真机上适配层给的 location 又是 `{href:'game.js', protocol:'', reload}`、
     * 连 hostname 都没有 —— 同一个判断在真机与工具里结果相反。于是工具里会先绕一圈
     * `http://127.0.0.1:8099/proxy?url=...`（必然失败），再直连（同样失败），
     * 最后把一个纯粹的「环境缺 fetch」误报成「目标站未开启 CORS」。
     * 微信本来就没有 CORS 概念（XHR 底层是 wx.request，域名走白名单配置），走代理没有任何意义。
     */
    private shouldUseLocalProxy(request: NetworkRequest, capability: HttpCapability): boolean {
        if (capability !== 'fetch') return false;
        if (!/^https?:\/\//i.test(request.url)) return false;
        if (request.url.startsWith(this.localProxyOrigin)) return false;
        return this.isLocalDebugEnvironment();
    }

    private isLocalDebugEnvironment(): boolean {
        const host = globalThis.location?.hostname;
        if (!host) return false;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]') return true;
        return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

function describeRequest(request: NetworkRequest): string {
    return `${request.method ?? 'GET'} ${request.url}`;
}
