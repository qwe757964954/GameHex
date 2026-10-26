/**
 * 平台层网络实现（FetchNetworkTransport）单测
 * ------------------------------------------------------------------
 * 背景：微信小游戏包在开发者工具里报了三件事，其中两件出在这一层：
 *   1. `fetch is not defined` —— 微信适配层（build/wechatgame/web-adapter.js）的全局白名单里
 *      只有 XMLHttpRequest / WebSocket / Image / localStorage / location，
 *      **没有 fetch、也没有 AbortController**（原生侧有 fetch 只是因为 jsb-adapter 自己挂了 polyfill）；
 *   2. 请求挂死后登录永远停在「正在登录」—— 老写法 `const timer = controller ? setTimeout(...) : undefined`
 *      在没有 AbortController 的环境里连定时器都不建，12s 超时是死代码。
 *
 * 还顺带修掉一个**误报**：微信开发者工具里 `globalThis.location` 是工具页面自己的 location
 * （hostname 常常就是 127.0.0.1），真机上适配层给的 location 连 hostname 都没有。
 * 于是同一个 `isLocalDebugEnvironment()` 判断在工具里为真 → 先绕一圈 127.0.0.1:8099 代理（必失败）
 * → 再直连（同样失败）→ 最后把「环境缺 fetch」报成「目标站未开启 CORS」。
 *
 * 这里用假 fetch / 假 XMLHttpRequest 顶替运行时全局，逐条锁住上述行为；
 * 末尾再用源码断言防止有人把超时改回 AbortController。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FetchNetworkTransport } from '../assets/script/platform/network/FetchNetworkTransport';

/** 会被替换的运行时全局。未显式传值的会被设成 undefined，模拟「该能力不存在」。 */
const REPLACED_GLOBALS = ['fetch', 'XMLHttpRequest', 'AbortController', 'location'] as const;
type ReplacedGlobal = typeof REPLACED_GLOBALS[number];

async function withGlobals(
    values: Partial<Record<ReplacedGlobal, unknown>>,
    body: () => Promise<void>,
): Promise<void> {
    const saved = REPLACED_GLOBALS.map((key) => ({
        key,
        descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
    }));
    for (const key of REPLACED_GLOBALS) {
        Object.defineProperty(globalThis, key, {
            value: Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined,
            configurable: true,
            writable: true,
        });
    }
    try {
        await body();
    } finally {
        for (const { key, descriptor } of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete (globalThis as Record<string, unknown>)[key];
        }
    }
}

/**
 * 假 XMLHttpRequest。行为对齐微信适配层实测实现（web-adapter.js 的模块 25）：
 * `timeout` 透传给 wx.request；wx.request 的 success 回调**任何 HTTP 状态码都算 success**
 * （所以 4xx/5xx 也会派发 onload，判失败必须自己看 status）；DONE 的 readystatechange 在 load 之前。
 */
class FakeXhr {
    static plan: ((xhr: FakeXhr) => void) | null = null;

    method = '';
    url = '';
    timeout = 0;
    body: string | null = null;
    headers: Record<string, string> = {};
    status = 0;
    statusText = '';
    readyState = 0;
    responseText = '';
    onload: (() => void) | null = null;
    onreadystatechange: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onerror: (() => void) | null = null;

    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
        this.readyState = 1;
    }

    setRequestHeader(key: string, value: string): void {
        this.headers[key] = value;
    }

    send(body: string | null): void {
        this.body = body;
        if (FakeXhr.plan) FakeXhr.plan(this);
    }

    /** 模拟适配层成功回调序列：DONE 的 readystatechange → load。 */
    respond(status: number, text: string): void {
        this.status = status;
        this.statusText = status >= 400 ? 'Error' : 'OK';
        this.responseText = text;
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
    }
}

/** 假 fetch，返回最小可用的 Response 形状（ok/status/text）。 */
function fakeFetch(log: string[], payload: string, status = 200): unknown {
    return async (url: string) => {
        log.push(String(url));
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => payload,
        };
    };
}

test('微信环境（无 fetch）回落到 XMLHttpRequest 并解析 JSON', async () => {
    const calls: FakeXhr[] = [];
    await withGlobals({ XMLHttpRequest: FakeXhr }, async () => {
        FakeXhr.plan = (xhr) => {
            calls.push(xhr);
            xhr.respond(200, '{"code":200,"data":[{"serverId":"1"}]}');
        };
        const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
        const result = await transport.requestJson<{ code: number; data: unknown[] }>({
            url: 'https://cdn.example.com/allServers.json',
        });
        assert.equal(result.code, 200);
        assert.equal(result.data.length, 1);
    });

    assert.equal(calls.length, 1, '应当恰好发出一个 XMLHttpRequest');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, 'https://cdn.example.com/allServers.json');
    assert.equal(calls[0].timeout, 500, 'timeout 必须透传给底层（微信适配层会转给 wx.request）');
});

test('有 fetch 时不会回落 XMLHttpRequest', async () => {
    const fetched: string[] = [];
    const xhrCalls: FakeXhr[] = [];
    await withGlobals(
        { fetch: fakeFetch(fetched, '{"ok":1}'), XMLHttpRequest: FakeXhr },
        async () => {
            FakeXhr.plan = (xhr) => {
                xhrCalls.push(xhr);
                xhr.respond(200, '{"ok":0}');
            };
            const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
            const result = await transport.requestJson<{ ok: number }>({ url: 'https://cdn.example.com/a.json' });
            assert.equal(result.ok, 1);
        },
    );

    assert.equal(fetched.length, 1);
    assert.equal(xhrCalls.length, 0, 'fetch 可用时不应该再走 XHR');
});

test('没有 AbortController 时超时依然生效（微信里 AbortController 不存在）', async () => {
    await withGlobals({ XMLHttpRequest: FakeXhr }, async () => {
        // plan 故意什么都不做：请求永远不返回，只能靠 Promise.race 的定时器兜住。
        FakeXhr.plan = () => undefined;
        const transport = new FetchNetworkTransport({ defaultTimeoutMs: 30 });
        await assert.rejects(
            () => transport.requestJson({ url: 'https://cdn.example.com/hang.json' }),
            /请求超时 30ms/,
        );
    });
});

test('微信适配层把 4xx/5xx 也派发给 onload，必须按 status 判失败', async () => {
    await withGlobals({ XMLHttpRequest: FakeXhr }, async () => {
        FakeXhr.plan = (xhr) => xhr.respond(500, '<html><body>500</body></html>');
        const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
        await assert.rejects(
            () => transport.requestJson({ url: 'https://cdn.example.com/boom.json' }),
            /HTTP 500/,
        );
    });
});

test('响应不是 JSON 时给出可读原因（微信里常见是一段 HTML 错误页）', async () => {
    await withGlobals({ XMLHttpRequest: FakeXhr }, async () => {
        FakeXhr.plan = (xhr) => xhr.respond(200, '<html><body>not json</body></html>');
        const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
        await assert.rejects(
            () => transport.requestJson({ url: 'https://cdn.example.com/html.json' }),
            /响应不是合法 JSON.*not json/s,
        );
    });
});

test('fetch 与 XMLHttpRequest 都不存在时给出明确错误，而不是 ReferenceError', async () => {
    await withGlobals({}, async () => {
        const transport = new FetchNetworkTransport();
        await assert.rejects(
            () => transport.requestJson({ url: 'https://cdn.example.com/a.json' }),
            /没有可用的 HTTP 实现/,
        );
    });
});

test('微信开发者工具里 location 泄露成 127.0.0.1，也不会去绕本地调试代理', async () => {
    const calls: FakeXhr[] = [];
    await withGlobals(
        { XMLHttpRequest: FakeXhr, location: { hostname: '127.0.0.1' } },
        async () => {
            FakeXhr.plan = (xhr) => {
                calls.push(xhr);
                xhr.respond(200, '{"ok":1}');
            };
            const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
            await transport.requestJson({ url: 'https://cdn.example.com/a.json' });
        },
    );

    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://cdn.example.com/a.json',
        '微信没有 CORS 概念，不该把请求绕到 http://127.0.0.1:8099/proxy',
    );
});

test('浏览器本地预览直连成功不探测调试代理', async () => {
    const fetched: string[] = [];
    await withGlobals(
        {
            fetch: async (url: string) => {
                fetched.push(String(url));
                const payload = String(url).includes('/proxy?url=') ? '{"via":"proxy"}' : '{"via":"direct"}';
                return { ok: true, status: 200, text: async () => payload };
            },
            location: { hostname: 'localhost' },
        },
        async () => {
            const transport = new FetchNetworkTransport({ defaultTimeoutMs: 500 });
            const result = await transport.requestJson<{ via: string }>({ url: 'https://cdn.example.com/a.json' });
            assert.equal(result.via, 'direct');
        },
    );

    assert.equal(fetched.length, 1);
    assert.ok(
        fetched.length === 1 && !fetched[0].includes('/proxy?url='),
        `直连可用时不应绕代理，实际请求：${fetched[0]}`,
    );
});

test('浏览器跨域网络失败只对读取请求回退一次代理', async () => {
    const calls:string[]=[];
    await withGlobals({location:{hostname:'localhost'},fetch:async(url:string)=>{
        calls.push(String(url));if(!String(url).includes('/proxy?url='))throw new TypeError('Failed to fetch');
        return {ok:true,status:200,text:async()=>'{}'};
    }},async()=>{await new FetchNetworkTransport().requestJson({url:'https://game.example.com/list.json'});});
    assert.equal(calls.length,2);assert.ok(calls[1].includes('/proxy?url='));
});

test('HTTP 业务失败、JSON 错误、超时与写请求不通过代理重复发送', async () => {
    for(const failure of ['http','json','timeout','post']){
        let calls=0;
        await withGlobals({location:{hostname:'localhost'},fetch:async()=>{
            calls++;
            if(failure==='post')throw new TypeError('Failed to fetch');
            if(failure==='timeout')return new Promise(()=>{});
            return {ok:failure!=='http',status:failure==='http'?401:200,text:async()=>'<html>'};
        }},async()=>{
            await assert.rejects(new FetchNetworkTransport({defaultTimeoutMs:5}).requestJson({url:'https://game.example.com/action',method:failure==='post'?'POST':'GET'}));
        });
        assert.equal(calls,1,failure);
    }
});

test('平台层源码：超时不得再挂在 AbortController 上，且必须保留 XHR 回落', () => {
    const source = readFileSync('assets/script/platform/network/FetchNetworkTransport.ts', 'utf8');
    // 注释里会引用旧写法，必须剥掉注释再断言，否则断言会被自己的说明文字打脸。
    const code = stripComments(source);
    assert.match(code, /Promise\.race\(\[task, timeout\]\)/, '超时应当由 Promise.race 保证');
    assert.doesNotMatch(
        code,
        /controller\s*\?\s*setTimeout/,
        '旧写法在没有 AbortController 的环境里连定时器都不建，等于没有超时',
    );
    assert.match(code, /typeof XMLHttpRequest === 'function'/, '必须保留 XMLHttpRequest 回落');
});

function stripComments(source: string): string {
    let out = '';
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '/' && next === '/') {
            const lineEnd = source.indexOf('\n', index);
            index = lineEnd < 0 ? source.length : lineEnd;
            continue;
        }
        if (char === '/' && next === '*') {
            const blockEnd = source.indexOf('*/', index + 2);
            index = blockEnd < 0 ? source.length : blockEnd + 2;
            continue;
        }
        out += char;
        index += 1;
    }
    return out;
}


test('已收到 HTTP 响应后 body 解码 TypeError 只报错，不再次请求代理', async () => {
    const calls: string[] = [];
    await withGlobals({ location: { hostname: 'localhost', origin: 'http://localhost:7456' },
        fetch: async (url: string) => {
            calls.push(url);
            return { ok: true, status: 200, text: async () => { throw new TypeError('Error decoding response body'); } };
        },
    }, async () => {
        await assert.rejects(new FetchNetworkTransport().requestJson({ url: 'https://cdn.example.com/data.json' }), /Error decoding response body/);
        assert.deepEqual(calls, ['https://cdn.example.com/data.json']);
    });
});
