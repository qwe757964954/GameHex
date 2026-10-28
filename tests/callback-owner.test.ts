import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { TMap } from '../assets/script/framework/collection/TMap';

function load<T>(path: string, name: string): new () => T {
    const exported: Record<string, new () => T> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    runInNewContext(code, {
        exports: exported, window: {}, console, Promise,
        require(id: string) {
            if (id.endsWith('/TMap')) return { TMap };
            if (id.endsWith('/ScriptObject')) return { ScriptObject: class {
                destroyed = false;
                assert(value: unknown) { assert.ok(value); }
                error(message: string) { throw new Error(message); }
                destroy() { this.destroyed = true; }
            } };
            if (id.endsWith('/Utils')) return { Utils: { error: (message: string) => { throw new Error(message); } } };
            if (id.endsWith('/FW')) return { FW: { ignoreShowloadingNet: [] } };
            return {};
        },
    });
    return exported[name];
}

interface IProxy {
    addListener(event: string, caller: object, callback: (this: object) => void): void;
    execute(event: string): void;
    removeCallerListener(caller: object): void;
    addCallerCleanup(caller: object, cleanup: () => void): () => void;
}

test('基础事件入口不区分引擎宿主类型，也不引用 cc 类型', () => {
    const path = 'assets/script/framework/event/EventProxy.ts';
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    function visit(node: ts.Node): void {
        if (ts.isQualifiedName(node) && node.left.getText(source) === 'cc') violations.push(node.getText(source));
        if (ts.isMethodDeclaration(node) && /^(add|remove)(Node|GObject)Listener$/.test(node.name.getText(source))) {
            violations.push(node.name.getText(source));
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual(violations, [], '事件宿主统一为 object，不增加引擎专用包装');
});

test('事件由显式解绑结束订阅，不读取组件 isValid 作为派发开关', () => {
    const Proxy = load<IProxy>('assets/script/framework/event/EventProxy.ts', 'EventProxy');
    const proxy = new Proxy();
    const component = { isValid: true };
    const seen: object[] = [];
    proxy.addListener('change', component, function () { seen.push(this); });
    proxy.execute('change');
    assert.deepEqual(seen, [component]);
    component.isValid = false;
    proxy.execute('change');
    assert.equal(seen.length, 2);
    proxy.removeCallerListener(component);
    component.isValid = true;
    proxy.execute('change');
    assert.equal(seen.length, 2);
});

test('普通订阅对象可以直接传；ScriptObject 的 destroyed 标记仍能阻止事件派发', () => {
    const Proxy = load<IProxy>('assets/script/framework/event/EventProxy.ts', 'EventProxy');
    const proxy = new Proxy();
    const owner = {};
    const script = { destroyed: false };
    let plainCalls = 0;
    let scriptCalls = 0;
    proxy.addListener('plain', owner, () => { plainCalls++; });
    proxy.addListener('script', script, () => { scriptCalls++; });
    proxy.execute('plain');
    proxy.execute('script');
    script.destroyed = true;
    proxy.execute('script');
    assert.equal(plainCalls, 1);
    assert.equal(scriptCalls, 1);
    proxy.removeCallerListener(owner);
    proxy.execute('plain');
    assert.equal(plainCalls, 1);
});

interface IRequest {
    promise: Promise<boolean>;
    resolve(message: object): void;
    reject(message: string): void;
    packageRequest(index: number, data: Uint8Array, msg: object, loading: boolean, callbacks?: IProxy): void;
}

test('解除宿主立即取消请求 Promise，迟到成功与失败回包均不再调用它', async () => {
    const Request = load<IRequest>('assets/script/framework/net/NetworkRequest.ts', 'NetworkRequest');
    const Proxy = load<IProxy>('assets/script/framework/event/EventProxy.ts', 'EventProxy');
    for (const success of [true, false]) {
        const request = new Request();
        const component = { isValid: true };
        let calls = 0;
        const callbacks = new Proxy();
        request.packageRequest(1, new Uint8Array(), {
            caller: component, fCallback: () => { calls++; }, fErrorCallback: () => { calls++; },
            getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true,
        }, false, callbacks);
        const pending = request.promise;
        const lateSuccess = request.resolve;
        const lateFailure = request.reject;
        callbacks.removeCallerListener(component);
        assert.equal(await Promise.race([pending, Promise.resolve('still pending')]), false);
        callbacks.removeCallerListener(component);
        if (success) lateSuccess({}); else lateFailure('failed');
        assert.equal(await pending, false);
        assert.equal(calls, 0);
    }
});

test('宿主重开后新请求不受上一轮取消影响，其他宿主请求正常完成', async () => {
    const Request = load<IRequest>('assets/script/framework/net/NetworkRequest.ts', 'NetworkRequest');
    const Proxy = load<IProxy>('assets/script/framework/event/EventProxy.ts', 'EventProxy');
    const callbacks = new Proxy();
    const owner = {};
    const other = {};
    const seen: string[] = [];
    const make = (caller: object, tag: string) => {
        const request = new Request();
        request.packageRequest(1, new Uint8Array(), {
            caller, fCallback: () => seen.push(tag), getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true,
        }, false, callbacks);
        return request;
    };
    const old = make(owner, 'old');
    const unrelated = make(other, 'other');
    callbacks.removeCallerListener(owner);
    assert.equal(await Promise.race([old.promise, Promise.resolve('still pending')]), false);
    const fresh = make(owner, 'fresh');
    unrelated.resolve({});
    fresh.resolve({});
    callbacks.removeCallerListener(owner);
    assert.deepEqual(seen, ['other', 'fresh']);
});

test('活着的组件和普通请求宿主保持回调 this；disabled / destroyed 宿主仍被拦截', async () => {
    const Request = load<IRequest>('assets/script/framework/net/NetworkRequest.ts', 'NetworkRequest');
    const Proxy = load<IProxy>('assets/script/framework/event/EventProxy.ts', 'EventProxy');
    for (const [owner, expected] of [
        [{ isValid: true }, 1], [{ isValid: false }, 1], [{}, 1], [{ destroyed: true }, 0], [{ disabled: true }, 0],
    ] as const) {
        const request = new Request();
        const seen: object[] = [];
        request.packageRequest(1, new Uint8Array(), {
            caller: owner, fCallback: function (this: object) { seen.push(this); },
            getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true,
        }, false, new Proxy());
        const pending = request.promise;
        request.resolve({});
        assert.equal(await pending, true);
        assert.equal(seen.length, expected);
        if (expected) assert.equal(seen[0], owner);
    }
});

test('业务代码直接传回调归属对象，禁止用 destroyable / any / never 断言绕过契约', () => {
    const violations: string[] = [];
    const ownerArguments: Record<string, number> = {
        addEvent: 1, removeEvent: 1, removeCallerEvent: 0, removeCaller: 0,
        addListener: 1, removeListener: 1, addNodeListener: 1, removeNodeListener: 1, removeCallerListener: 0,
        setEvent: 2, setEventUpdate: 1, removeEventUpdate: 1,
        setEventChange: 1, removeEventChange: 1, setEventAdd: 1, removeEventAdd: 1,
        removeEventCaller: 1, removeEventCallerAllCache: 0, AddScriptListener: 2,
        setViewResizeEvent: 0, removeViewResizeEvent: 0, addOnHide: 0, removeOnHide: 0, addOnShow: 0, removeOnShow: 0,
    };
    function scan(directory: string): void {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'generated') continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { scan(path); continue; }
            if (!entry.name.endsWith('.ts')) continue;
            const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
            function visit(node: ts.Node): void {
                let argument: ts.Expression | undefined;
                if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                    const name = node.expression.name.text;
                    const index = name === 'removeEvent' && node.arguments.length === 4 ? 2
                        : name === 'addListener' && node.arguments.length === 4 ? 3 : ownerArguments[name];
                    if (index !== undefined) argument = node.arguments[index];
                } else if (ts.isNewExpression(node) && /^Request/.test(node.expression.getText(source))) {
                    argument = node.arguments?.[1];
                }
                while (argument && ts.isParenthesizedExpression(argument)) argument = argument.expression;
                if (argument && (ts.isAsExpression(argument) || ts.isTypeAssertionExpression(argument))) {
                    violations.push(`${path}:${source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1}`);
                }
                if (ts.isAsExpression(node)) {
                    const type = node.type.getText(source);
                    let value = node.expression;
                    while (ts.isAsExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
                    const owner = value.getText(source);
                    if (type === 'destroyable' || (/^(this|caller|redDot|GMCommandTable|this\.(broListener|listener))$/.test(owner)
                        && /^(any|never)$/.test(type))) {
                        violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
                    }
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    scan('assets/script/app');
    assert.deepEqual(violations, []);
});
