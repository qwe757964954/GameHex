import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sendGameRequest } from '../assets/script/app/net/RequestGuard';

test('sendGameRequest: 离线不发送，发送结果映射三态', async () => {
    let sends = 0;
    let builds = 0;
    const offline = await sendGameRequest(
        { isConnected: false, send: async () => { sends++; return true; } },
        () => { builds++; return {}; },
    );
    assert.equal(offline, 'offline');
    assert.equal(sends, 0);
    assert.equal(builds, 0);

    assert.equal(await sendGameRequest(
        { isConnected: true, send: async () => true },
        () => ({}),
    ), 'ok');
    assert.equal(await sendGameRequest(
        { isConnected: true, send: async () => false },
        () => ({}),
    ), 'failed');
});

test('sendGameRequest: 超时与 make 抛错都落 failed', async () => {
    const timeout = await sendGameRequest(
        { isConnected: true, send: () => new Promise<boolean>(() => {}) },
        () => ({}),
        { timeoutMs: 20, tag: 'Test' },
    );
    assert.equal(timeout, 'failed');
    const thrown = await sendGameRequest(
        { isConnected: true, send: async () => true },
        () => { throw new Error('boom'); },
    );
    assert.equal(thrown, 'failed');
});


test('sendGameRequest: 保留消息对象，超时取消真实发送 Promise，拒绝以 failed 落定', async () => {
    const message = {};
    let cancelled = 0;
    const pending = Object.assign(new Promise<boolean>(() => {}), { cancel: () => { cancelled++; } });
    const status = await sendGameRequest({ isConnected: true, send: (sent, cache) => {
        assert.equal(sent, message);
        assert.equal(cache, false);
        return pending;
    } }, () => message, { timeoutMs: 1 });
    assert.equal(status, 'failed');
    assert.equal(cancelled, 1);
    assert.equal(await sendGameRequest({ isConnected: true, send: () => Promise.reject(new Error('closed')) },
        () => message), 'failed');
});

/**
 * 守卫：`RequestGuard` 是 25 个 Node 用例唯一能直连的网络模块，它的零引擎依赖不能破。
 * 一旦这里 import 了 GameNet（哪怕只是为了给 net 参数加默认值），
 * GameNet → RequestGuard → GameNet 成环，且 `cc` 被带进 Node 进程，整套用例连 import 都过不去。
 */
test('RequestGuard 必须保持零引擎依赖：不引 GameNet / 不引 cc / net 不设默认值', () => {
    const src = readFileSync('assets/script/app/net/RequestGuard.ts', 'utf8');
    assert.doesNotMatch(src, /from '\.\/GameNet'/, 'RequestGuard 不能 import GameNet：会与 GameNet 成环');
    assert.doesNotMatch(src, /from 'cc'/, 'RequestGuard 不能 import cc：Node 里 import 本文件就会炸');
    assert.doesNotMatch(src, /=\s*GameNet\.instance/, 'net 参数不能设默认值：显式传参是 Node 用例可注入的前提');
});
