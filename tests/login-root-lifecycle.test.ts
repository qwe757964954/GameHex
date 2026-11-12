import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as LoginProtocol from '../assets/script/app/login/LoginProtocol';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve: (value?: unknown) => void = () => {}; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(block = '', storage = new Map<string, string>()) {
    const exports: Record<string, any> = {}, gate = deferred(), calls: string[] = [], writes: string[] = [], owners: object[] = [];
    let reconnect: (() => Promise<unknown>) | null = null;
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/login/LoginRoot.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (name === 'cc') return { sys: { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { writes.push(key); storage.set(key, value); } } } };
        if (name === './LoginProtocol') return LoginProtocol;
        if (name === './ProtocolCodec') return { ProtocolCodec: class { validate() { return { hasClientEnvelope: true, hasServerEnvelope: true, hasRoleLogin: true }; } } };
        if (name.endsWith('/CmdInterface')) return { LoginStatus: { WEI_HU: 8, BAN: 9 } };
        if (name.endsWith('/RequestRoleMsg')) return { RequestRoleLogin: class { constructor(public params: unknown, public caller: object, public callback: (v: unknown) => void) {} } };
        if (name.endsWith('/CenterPaymentService')) return { CenterPaymentService: { current: { configure() { calls.push('payment'); } } } };
        throw new Error(name);
    } });
    const step = async (name: string, value?: unknown) => { calls.push(name); if (block === name) await gate.promise; return value; };
    const config = { url: 'center', backstageurl: 'backstage', channelCode: 1, channel: 'test' };
    const session = { roleId: 1, time: 1, token: 't', selectServerId: 1, serverAddress: { host: 'localhost', port: 1234 } };
    const root = new exports.LoginRoot();
    root.configureGateway({
        bootstrap: () => step('bootstrap', { background: { gameConfig: config }, servers: [{ serverId: '1', name: 'one', status: 0 }] }),
        loginAccount: () => step('account', { code: 'code' }), queryRecentServers: () => step('recent', { roleServerList: [] }),
        loginServer: () => step('loginServer'), enterServer: () => step('enterServer', session), registerAccount: () => step('register'),
    });
    const net = {
        prepare: () => step('prepare'), connectServer: () => step('connect', true), closeSocket: () => calls.push('close'),
        removeCaller: (owner: object) => { owners.push(owner); calls.push('remove'); },
        sendNow: async (request: any) => { owners.push(request.caller); await step('role'); request.callback({ loginStatus: 1 }); return true; },
        configureReconnectLogin: (login: () => Promise<unknown>) => { reconnect = login; calls.push('reconnect'); },
    };
    return { root, net, gate, calls, writes, owners, get reconnect() { return reconnect; } };
}
test('login service stops every pending stage after disposal; late bootstrap/register never write state or credentials', async () => {
    for (const stage of ['bootstrap', 'account', 'recent', 'loginServer', 'enterServer', 'prepare', 'connect', 'role', 'register']) {
        const h = fixture(stage);
        if (stage !== 'bootstrap') await h.root.bootstrap();
        const pending = stage === 'bootstrap' ? h.root.bootstrap()
            : stage === 'register' ? h.root.register('a', 'p') : h.root.login('a', 'p', h.net);
        await tick(); assert.equal(h.calls[h.calls.length - 1], stage);
        h.root.dispose(); h.root.dispose(); const count = h.calls.length;
        h.gate.resolve(); const result = await pending;
        assert.equal(result.ok, false, stage); assert.equal(h.calls.length, count, stage);
        assert.deepEqual(h.writes, [], stage);
        if (stage === 'bootstrap') assert.equal(h.root.servers_.length, 0);
    }
});

test('agreement only restores explicit consent and persists both choices across login service instances', () => {
    const storage = new Map<string, string>([['login_session', '{}'], ['account_num', 'saved']]);
    const first = fixture('', storage);
    assert.equal(first.root.restoreAgreement(), false);
    first.root.saveAgreement(true);
    first.root.dispose();
    const second = fixture('', storage);
    assert.equal(second.root.restoreAgreement(), true);
    second.root.saveAgreement(false);
    second.root.dispose();
    assert.equal(fixture('', storage).root.restoreAgreement(), false);
    for (const invalid of ['', '1', 'false', 'corrupt']) {
        storage.set('login_agreed', invalid);
        assert.equal(fixture('', storage).root.restoreAgreement(), false, invalid);
    }
});
test('successful login preserves connection and reconnect owner after controller/service disposal', async () => {
    const h = fixture(); await h.root.bootstrap();
    assert.equal((await h.root.login('a', 'p', h.net)).ok, true);
    assert.ok(h.writes.includes('login_session'));
    h.root.dispose(); assert.equal(h.calls.includes('close'), false);
    assert.equal(h.owners[0], h.root);
    assert.equal((await h.reconnect()).ok, true);
    assert.equal(h.owners[h.owners.length - 1], h.net);
});
