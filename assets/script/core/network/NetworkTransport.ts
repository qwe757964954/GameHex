/** 与具体运行环境无关的网络请求。业务层只依赖此端口。 */
export interface NetworkRequest {
    readonly url: string;
    readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs?: number;
}

export interface NetworkTransport {
    requestJson<T = unknown>(request: NetworkRequest): Promise<T>;
}
