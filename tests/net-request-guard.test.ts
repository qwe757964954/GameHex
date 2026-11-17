import assert from 'node:assert/strict';
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
