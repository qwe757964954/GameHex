import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('LoginPage 可恢复 StatusLabel 绑定，销毁后忽略异步状态更新', () => {
    const code = ts.transpileModule(readFileSync('assets/script/app/login/LoginPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Color {
        constructor(public r: number, public g: number, public b: number, public a: number) {}
    }
    class Label {
        string = '';
        color: Color | null = null;
    }
    const fallbackLabel = new Label();
    const statusNode = { getComponent: (type: unknown) => type === Label ? fallbackLabel : null };
    class Node {
        static EventType = { TOUCH_END: 'touch-end' };
        getChildByName(name: string) { return name === 'StatusLabel' ? statusNode : null; }
    }
    class Component {
        node = new Node();
        unscheduleAllCallbacks() {}
    }
    class LoginGateway {}
    const toasts: string[] = [];
    const dependencies: Record<string, unknown> = {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Color, Component, Label, Node,
            resources: {},
            sys: { localStorage: { getItem: () => null, setItem() {} } },
        },
        '../procedure/ProcedureMain': { ProcedureMain: class {} },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: { switchTo() {} } },
        './LoginProtocol': {
            canEnterServer: () => ({ ok: true }),
            DEFAULT_VERSION_CONFIG: { version: 'test' },
            LoginGateway,
            selectRecommendedServer: () => null,
        },
        './ProtocolCodec': { ProtocolCodec: class {} },
        './ServerSelectPanel': { ServerSelectPanel: class {} },
        './ServerSelectItem': { serverStatusText: () => '' },
        '../common/Toast': { Toast: { show: (message: string) => toasts.push(message) } },
    };
    const context = {
        exports: {} as { LoginPage: new () => any },
        require: (name: string) => dependencies[name],
        console: { warn() {}, error() {}, log() {} },
    };
    runInNewContext(code, context);

    const page = new context.exports.LoginPage();
    page.root = page.node;
    page.statusLabel = null;
    page.setStatus('连接中');
    assert.equal(page.statusLabel, fallbackLabel);
    assert.equal(fallbackLabel.string, '连接中');

    page.onDestroy();
    page.statusLabel = null;
    assert.doesNotThrow(() => page.setStatus('过期的异步结果'));
    assert.equal(fallbackLabel.string, '连接中');
    assert.deepEqual(toasts, [], '销毁后不再弹任何提示');
});

test('LoginPage 登录校验失败时只弹吐司（不再弹 CommonTips），状态栏不再写失败文案', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/app/login/LoginPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Color {
        constructor(public r: number, public g: number, public b: number, public a: number) {}
    }
    class Label {
        string = '';
        color: Color | null = null;
    }
    class Node {
        static EventType = { TOUCH_END: 'touch-end' };
        getChildByName() { return null; }
    }
    class Component {
        node = new Node();
        unscheduleAllCallbacks() {}
    }
    const toasts: string[] = [];
    const dependencies: Record<string, unknown> = {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Color, Component, Label, Node,
            resources: {},
            sys: { localStorage: { getItem: () => null, setItem() {} } },
        },
        '../../core/runtime/GameRoute': { GameRoute: { Main: 'main' } },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: { navigate() {} } },
        './LoginProtocol': {
            canEnterServer: () => ({ ok: true }),
            DEFAULT_VERSION_CONFIG: { version: 'test' },
            LoginGateway: class {},
            selectRecommendedServer: () => null,
        },
        './ProtocolCodec': { ProtocolCodec: class {} },
        './ServerSelectPanel': { ServerSelectPanel: class {} },
        './ServerSelectItem': { serverStatusText: () => '' },
        '../net/GameNet': { GameNet: { instance: {} } },
        '../generated/netProto/CmdInterface': { LoginStatus: {} },
        '../generated/requestMsg/RequestRoleMsg': { RequestRoleLogin: class {} },
        '../common/Toast': { Toast: { show: (message: string) => toasts.push(message) } },
    };
    const context = {
        exports: {} as { LoginPage: new () => any },
        // 刻意不铺 '../common/CommonTips' 的桩：登录页一旦重新 import 它，这里会直接抛 TypeError。
        require: (name: string) => dependencies[name],
        console: { warn() {}, error() {}, log() {} },
    };
    runInNewContext(code, context);

    const page = new context.exports.LoginPage();
    page.accountInput = { string: '' };
    page.passwordInput = { string: '' };
    page.statusLabel = new Label();

    await page.login();

    assert.deepEqual(toasts, ['请输入账号和密码'], '登录问题只走吐司，一条不多不少');
    assert.equal(page.statusLabel.string, '', '状态栏不再承载失败文案');
});

/**
 * 状态栏口径防回归：StatusLabel 只承载白名单文案（成功 / 进行中）。
 * 任何新的过程态或失败文案写进状态栏 —— 也就是绕开吐司 —— 都会在这里被拦下。
 */
test('LoginPage 状态栏只写白名单文案（登录过程态与失败一律走吐司）', () => {
    const code = readFileSync('assets/script/app/login/LoginPage.ts', 'utf8');
    const calls = [...code.matchAll(/this\.setStatus\((.+?)\);/g)].map((match) => match[1].trim());
    assert.ok(calls.length > 0, '至少应统计到状态栏写入点（正则失效时报警）');

    const allowed = new Set([
        "'正在获取服务器列表…'",
        "'服务器列表已就绪'",
        '`已连接 ${label}，正在登录角色…`',
        "'登录成功，正在进入游戏…'",
        "'正在注册…'",
        "'注册成功，点击登录即可进入游戏'",
    ]);
    for (const call of calls) {
        assert.ok(allowed.has(call), `状态栏出现了白名单外的文案：${call}`);
    }

    // 回归点：bootstrap 成功分支必须给状态栏收尾。
    // 少了这一句，状态栏会永远停在「正在获取服务器列表…」——安卓包上就是这么被误判成「没网络」的。
    const successPath = code.slice(
        code.indexOf('await this.gateway.bootstrap('),
        code.indexOf("this.showProblem('服务器列表获取失败"),
    );
    assert.ok(successPath.length > 0, '未能定位 bootstrap 成功分支（正则失效时报警）');
    assert.match(
        successPath,
        /this\.setStatus\('服务器列表已就绪'\)/,
        '服务器列表拿到后必须收尾，不能一直停在「正在获取服务器列表…」',
    );

    // 被移除的登录过程态不得复活
    for (const removed of ['正在校验网络协议', '正在验证账号', '正在准备网络协议', '正在连接 ${']) {
        assert.ok(!code.includes(removed), `登录过程态「${removed}」应保持移除（改走吐司）`);
    }

    // 失败提示只走吐司：不得再弹 CommonTips，也不得写状态栏
    const showProblem = code.slice(code.indexOf('private showProblem('));
    assert.match(showProblem.slice(0, 600), /Toast\.show\(message\)/, '问题提示要走吐司');
    assert.ok(!showProblem.slice(0, 600).includes('CommonTips'), '问题提示不得再弹 CommonTips 弹窗');
    assert.ok(!showProblem.slice(0, 600).includes('setStatus'), '问题提示不得再写状态栏');
    assert.ok(
        !code.includes("from '../common/CommonTips'"),
        '登录页不再依赖 CommonTips（连 import 一起清掉，避免又被接回去）',
    );
});
