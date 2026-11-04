import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { LoginController } from '../assets/script/app/login/LoginController';
import { LoginUiEvent } from '../assets/script/app/login/LoginEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';

test('LoginPage restores optional status binding, emits scoped inputs and fully renders button state', () => {
    class Label { string = ''; color: unknown; }
    const status = new Label();
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/login/LoginPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { _decorator: { ccclass: () => (v: unknown) => v, property: () => () => {} },
            Component: class { node = { getChildByName: () => ({ getComponent: () => status }) }; },
            Button: { EventType: { CLICK: 'click' } }, Label, Color: class {} };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE: 'ui:view-lifecycle' };
        if (name === './LoginEvents') return { LoginUiEvent };
        if (name === './ServerSelectItem') return { serverStatusText: () => '流畅' };
        throw new Error(name);
    } });
    const page = new exports.LoginPage();
    const handlers = new Map<string, () => void>(), buttons = [true, true, true].map(() => ({ interactable: true }));
    ['serverButton', 'loginButton', 'registerButton'].forEach((key, i) => {
        page[key] = { on: (_event: string, fn: () => void) => handlers.set(key, fn), getComponent: () => buttons[i] };
    });
    Object.assign(page, { accountInput: { string: '' }, passwordInput: { string: '' }, versionLabel: new Label(), serverButtonLabel: new Label() });
    const events: any[] = [], owner = {};
    EventMgr.instance.on(LoginUiEvent.Intent, (event: unknown) => events.push(event), owner);
    try {
        page.onLoad(); assert.equal(page.statusLabel, status);
        page.restoreCredentials({ account: 'a', password: 'secret' }); handlers.get('loginButton')();
        assert.equal(events.length, 1); assert.equal(events[0].owner, page); assert.equal(events[0].password, 'secret');
        page.render({ version: '1', status: 'ready', busy: true, server: null });
        assert.equal(status.string, 'ready'); assert.ok(buttons.every(value => !value.interactable));
        page.render({ version: '1', status: 'done', busy: false, server: null });
        assert.ok(buttons.every(value => value.interactable));
        assert.doesNotThrow(() => page.onDestroy());
    } finally { EventMgr.instance.offTarget(owner); }
});

test('login failures only show a tip and leave successful bootstrap status intact', async () => {
    const owner = {}, tips: string[] = [], states: any[] = [];
    const controller = new LoginController(createControllerContext(), {
        owner,
        service: { servers_: [], selectedServerId_: null, recentServerIds_: [], protocolReady_: true,
            restoreAccount: () => ({ account: '', password: '' }), bootstrap: async () => ({ ok: true }),
            login: async () => ({ ok: false, reason: '请输入账号和密码' }), register: async () => ({ ok: false }), setSelectedServer() {}, dispose() {} },
        config: {
            loadVersion: async () => ({ version: '1', url: '', index: '' })
        },
        view: {
            restoreCredentials() {},
            render: value => states.push(value)
        },
        feedback: {
            tip: value => tips.push(value)
        },
        servers: {
            openServers: async () => {},
            closeServers() {}
        },
        clock: {
            schedule: () => () => {}
        },
        navigation: {
            navigate() {}
        },
    });
    try {
        await controller.start(); EventMgr.instance.emit(LoginUiEvent.Intent, { owner, kind: 'login', account: '', password: '' });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(tips, ['请输入账号和密码']); assert.equal(states[states.length - 1].status, '服务器列表已就绪');
    } finally { controller.dispose(); }
});
