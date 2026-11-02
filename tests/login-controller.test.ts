import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginController } from '../assets/script/app/login/LoginController';
import { LoginUiEvent, type ILoginViewState } from '../assets/script/app/login/LoginEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
    const owner = {}, states: ILoginViewState[] = [], tips: string[] = [], routes: unknown[] = [];
    const timers = new Set<() => void>();
    const credentials: unknown[] = [];
    let logins = 0, disposed = 0, opened = 0, closed = 0;
    const service = {
        servers_: [{ serverId: '1', name: '一区', status: 0, serverOpenTime: 1 }], selectedServerId_: 1,
        recentServerIds_: [] as number[], protocolReady_: true,
        restoreAccount: () => ({ account: 'saved', password: 'saved-password' }),
        bootstrap: async () => ({ ok: true }),
        login: async (_account: string, _password: string): Promise<{ ok: boolean; session?: unknown }> => { logins++; return { ok: true, session: {} }; },
        register: async () => ({ ok: true }), setSelectedServer(id: number) { this.selectedServerId_ = id; },
        dispose() { disposed++; },
    };
    const options = { owner, service,
        loadVersion: async () => ({ version: '1', url: 'url', index: 'index' }),
        restoreCredentials: (value: unknown) => credentials.push(value), render: (state: ILoginViewState) => states.push(state),
        tip: (message: string) => tips.push(message), openServers: async () => { opened++; }, closeServers: () => { closed++; },
        schedule: (callback: () => void, _seconds: number) => { timers.add(callback); return () => { timers.delete(callback); }; },
        navigate: (_route: string, params?: unknown) => routes.push(params),
    };
    const controller = new LoginController(createControllerContext(), options);
    const intent = (kind: 'login' | 'register' | 'servers' | 'select', extra = {}) => EventMgr.instance.emit(LoginUiEvent.Intent, { owner, kind, account: ' a ', password: 'secret', ...extra });
    return { controller, service, options, owner, states, tips, routes, timers, credentials, intent, get logins() { return logins; }, get disposed() { return disposed; }, get opened() { return opened; }, get closed() { return closed; } };
}

test('login initializes once, isolates intents and keeps successful login busy until delayed navigation', async () => {
    const h = fixture();
    try {
        await h.controller.start();
        assert.equal(h.credentials.length, 1);
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
        h.intent('register'); await tick();
        assert.ok(h.tips.includes('offline')); assert.equal(h.states[h.states.length - 1].busy, false);
    } finally { h.controller.dispose(); }
});
