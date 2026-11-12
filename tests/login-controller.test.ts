import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginController } from '../assets/script/app/login/LoginController';
import { LoginUiEvent, type ILoginViewState } from '../assets/script/app/login/LoginEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(agreementStorage = { value: false }) {
    const owner = {}, states: ILoginViewState[] = [], tips: string[] = [], routes: unknown[] = [];
    const timers = new Set<() => void>();
    const credentials: unknown[] = [];
    let logins = 0, registrations = 0, disposed = 0, opened = 0, closed = 0, platformLogins = 0;
    const service = {
        servers_: [{ serverId: '1', name: '一区', status: 0, serverOpenTime: 1 }], selectedServerId_: 1,
        recentServerIds_: [] as number[], protocolReady_: true, hasSavedSession_: false,
        restoreAccount: () => ({ account: 'saved', password: '' }),
        restoreAgreement: () => agreementStorage.value,
        saveAgreement: (agreed: boolean) => { agreementStorage.value = agreed; },
        bootstrap: async () => ({ ok: true }),
        login: async (_account: string, _password: string): Promise<{ ok: boolean; session?: unknown }> => { logins++; return { ok: true, session: {} }; },
        register: async () => { registrations++; return { ok: true }; },
        loginWithPlatform: async (): Promise<{ ok: boolean; session?: unknown }> => { platformLogins++; return { ok: true, session: {} }; },
        setSelectedServer(id: number) { this.selectedServerId_ = id; },
        dispose() { disposed++; },
    };
    const options = { owner, service,
        config: { loadVersion: async () => ({ version: '1', url: 'url', index: 'index' }) },
        view: { restoreCredentials: (value: unknown) => credentials.push(value), render: (state: ILoginViewState) => states.push(state) },
        feedback: { tip: (message: string) => tips.push(message) },
        servers: { openServers: async () => { opened++; }, closeServers: () => { closed++; } },
        clock: { schedule: (callback: () => void, _seconds: number) => { timers.add(callback); return () => { timers.delete(callback); }; } },
        navigation: { navigate: (_route: string, params?: unknown) => routes.push(params) },
        channel: { platformLoginVisible: false, gmVisible: true },
    };
    const controller = new LoginController(createControllerContext(), options);
    const intent = (kind: 'login' | 'register' | 'servers' | 'select' | 'platform-login' | 'toggle-agreement' | 'toggle-password-visibility', extra = {}) => EventMgr.instance.emit(LoginUiEvent.Intent, { owner, kind, account: 'testuser', password: 'secret123', ...extra });
    return { controller, service, options, owner, states, tips, routes, timers, credentials, intent, get logins() { return logins; }, get registrations() { return registrations; }, get disposed() { return disposed; }, get opened() { return opened; }, get closed() { return closed; }, get platformLogins() { return platformLogins; } };
}

test('login initializes once, isolates intents and keeps successful login busy until delayed navigation', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        assert.equal(h.credentials.length, 1);
        // 先勾选协议，否则登录会被拦截
        h.intent('toggle-agreement', { agreed: true });
        EventMgr.instance.emit(LoginUiEvent.Intent, { owner: {}, kind: 'login' });
        h.intent('login'); h.intent('login'); await tick(); h.intent('login');
        assert.equal(h.logins, 1); assert.equal(h.routes.length, 0); assert.equal(h.timers.size, 1);
        assert.equal(h.states[h.states.length - 1].busy, true);
        for (const callback of [...h.timers]) callback();
        assert.equal(h.routes.length, 1);
    } finally { h.controller.dispose(); }
});

test('disposing during bootstrap, account work or delayed navigation prevents late output', async () => {
    for (const step of ['bootstrap', 'login', 'delay']) {
        const h = fixture(), boot = deferred<{ ok: boolean }>(), login = deferred<{ ok: boolean }>();
        if (step === 'bootstrap') h.service.bootstrap = () => boot.promise;
        const ready = h.controller.start();
        if (step !== 'bootstrap') {
            await ready;
            h.intent('toggle-agreement', { agreed: true });
            if (step === 'login') h.service.login = () => login.promise;
            h.intent('login'); await tick();
        }
        const outputs = h.states.length;
        h.controller.dispose(); h.controller.dispose(); boot.resolve({ ok: true }); login.resolve({ ok: true });
        await ready; await tick();
        assert.equal(h.states.length, outputs); assert.equal(h.routes.length, 0);
        assert.equal(h.timers.size, 0); assert.equal(h.disposed, 1);
        h.intent('login'); assert.equal(h.logins, step === 'delay' ? 1 : 0);
    }
});

test('server selection is validated centrally and registration failures restore interactability', async () => {
    const h = fixture();
    try {
        await h.controller.start(); h.intent('servers'); await tick(); assert.equal(h.opened, 1);
        h.intent('select', { serverId: 999 }); assert.equal(h.service.selectedServerId_, 1);
        h.intent('select', { serverId: 1 }); assert.equal(h.closed, 1);
        h.service.register = async () => { throw new Error('offline'); };
        h.intent('toggle-agreement', { agreed: true });
        h.intent('register'); await tick();
        assert.ok(h.tips.includes('offline')); assert.equal(h.states[h.states.length - 1].busy, false);
    } finally { h.controller.dispose(); }
});

test('login without agreement shows tip and does not call service login', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        // 未勾选时不得触发登录。
        h.intent('toggle-agreement', { agreed: false });
        h.intent('login'); await tick();
        assert.equal(h.logins, 0);
        assert.ok(h.tips.some(t => t.includes('协议')));
    } finally { h.controller.dispose(); }
});

test('registration succeeds then auto-logs in without extra user click', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        h.intent('toggle-agreement', { agreed: true });
        h.intent('register'); await tick(); await tick();
        // 注册成功后自动登录一次
        assert.equal(h.logins, 1);
        assert.equal(h.tips.some(t => t.includes('注册成功')), true);
    } finally { h.controller.dispose(); }
});

test('registration cannot bypass agreement and start automatic login', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        h.intent('register');
        await tick();
        assert.equal(h.registrations, 0);
        assert.equal(h.logins, 0);
        assert.equal(h.timers.size, 0);
        assert.ok(h.tips.some(text => text.includes('协议')));
    } finally { h.controller.dispose(); }
});

test('agreement starts unchecked and restores both checked and unchecked choices after reopening', async () => {
    const storage = { value: false };
    for (const [initial, next] of [[false, true], [true, false], [false, false]]) {
        const h = fixture(storage);
        try {
            await h.controller.start();
            assert.equal(h.states[0].agreed, initial);
            h.intent('toggle-agreement', { agreed: next });
            assert.equal(storage.value, next);
            assert.equal(h.states[h.states.length - 1].agreed, next);
            if (!next) {
                h.intent('login');
                await tick();
                assert.equal(h.logins, 0);
            }
        } finally { h.controller.dispose(); }
    }
});

test('failed agreement save leaves the displayed and effective state unchanged', async () => {
    const h = fixture();
    h.service.saveAgreement = () => { throw new Error('storage unavailable'); };
    try {
        await h.controller.start();
        h.intent('toggle-agreement', { agreed: true });
        assert.equal(h.states[h.states.length - 1].agreed, false);
        h.intent('login');
        await tick();
        assert.equal(h.logins, 0);
        assert.ok(h.tips.includes('storage unavailable'));
    } finally { h.controller.dispose(); }
});

test('platform login intent works when channel is configured', async () => {
    const h = fixture();
    h.options.channel.platformLoginVisible = true;
    try {
        await h.controller.start();
        h.intent('toggle-agreement', { agreed: true });
        h.intent('platform-login');
        await new Promise(r => setTimeout(r, 100));
        // 核心验证：渠道登录接口被调用
        assert.equal(h.platformLogins, 1);
    } finally { h.controller.dispose(); }
});

test('unconfigured channel keeps account login visible and rejects platform login intent', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        const state = h.states[h.states.length - 1];
        assert.equal(state.platformLoginVisible, false);
        assert.equal(state.accountPasswordVisible, true);
        assert.equal(state.agreed, false);
        h.intent('toggle-agreement', { agreed: true });
        h.intent('platform-login');
        await tick();
        assert.equal(h.platformLogins, 0);
        assert.equal(h.states[h.states.length - 1].busy, false);
        h.intent('login');
        await tick();
        assert.equal(h.logins, 1);
    } finally { h.controller.dispose(); }
});
