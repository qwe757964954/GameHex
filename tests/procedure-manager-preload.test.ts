import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

/** ProcedureManager 现在还会驱动框架的 `UpdateBeat`（见 `update()` 里的说明）。 */
function trampolineCounter() {
    const calls: number[] = [];
    return { calls, UpdateBeat: { loop: (dt: number) => { calls.push(dt); } } };
}

/** 把一个 UpdateBeat stub 装进 vm 上下文可用的 require。 */
function requireWithUpdateBeat(updateBeat: { UpdateBeat: { loop: (dt: number) => void } }) {
    return (name: string) => {
        if (name === 'cc') {
            return {
                _decorator: { ccclass: () => (value: unknown) => value },
                Component: class {},
            };
        }
        if (name === '../../core/asset/ResourceScope') return { ResourceScope };
        if (name === './ProcedureBase') return {};
        if (name === '../utils/UpdateBeat') return updateBeat;
        throw new Error(`unexpected dependency: ${name}`);
    };
}

test('流程预加载失败时保留当前界面并允许再次切换', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/framework/procedure/ProcedureManager.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const context = {
        exports: {} as { ProcedureManager: new () => any },
        require: requireWithUpdateBeat(trampolineCounter()),
        console: { error() {} },
    };
    runInNewContext(code, context);

    class CurrentProcedure {
        className = 'CurrentProcedure';
        entered = 0;
        left = 0;
        onInit() {}
        onPreload() {}
        onEnter() { this.entered += 1; }
        onLeave() { this.left += 1; }
        onUpdate() {}
        _adoptResourceScope() {}
        destroy() {}
    }
    class FailedProcedure extends CurrentProcedure {
        className = 'FailedProcedure';
        async onPreload() { throw new Error('resource missing'); }
    }

    const manager = new context.exports.ProcedureManager();
    manager.onLoad();
    manager.startProcedure(CurrentProcedure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const current = manager.currentProcedure as CurrentProcedure;
    assert.equal(current.entered, 1);

    manager.changeProcedure(FailedProcedure);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(manager.currentProcedure, current);
    assert.equal(current.left, 0);
    assert.equal(manager.switching, false);
});

test('目标流程进入失败时释放其资源并清空当前流程，允许重新进入', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/framework/procedure/ProcedureManager.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const context = {
        exports: {} as { ProcedureManager: new () => any },
        require: requireWithUpdateBeat(trampolineCounter()),
        console: { error() {} },
    };
    runInNewContext(code, context);

    let releaseCount = 0;
    class UnstableProcedure {
        className = 'UnstableProcedure';
        enters = 0;
        leaves = 0;
        onInit() {}
        onPreload(_params?: unknown, preload?: { resources: ResourceScope }) {
            preload?.resources.defer(() => { releaseCount += 1; });
        }
        onEnter() {
            this.enters += 1;
            if (this.enters === 1) throw new Error('initialize failed');
        }
        onLeave() { this.leaves += 1; }
        onUpdate() {}
        _adoptResourceScope() {}
        destroy() {}
    }

    const manager = new context.exports.ProcedureManager();
    manager.onLoad();
    const procedure = manager.registerProcedure(UnstableProcedure) as UnstableProcedure;
    manager.changeProcedure(UnstableProcedure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(procedure.leaves, 1, '失败流程应执行自己的销毁清理');
    assert.equal(manager.currentProcedure, null, '失败流程不能留在 current 阻止重试');
    assert.equal(manager.switching, false);
    assert.equal(releaseCount, 1, '失败进入的资源作用域应释放');

    manager.changeProcedure(UnstableProcedure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(manager.currentProcedure, procedure);
    assert.equal(procedure.enters, 2);
});

test('路由只进入最后一次导航，并清理过期预加载', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/framework/procedure/ProcedureManager.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const context = {
        exports: {} as { ProcedureManager: new () => any },
        require: requireWithUpdateBeat(trampolineCounter()),
        console: { error() {} },
    };
    runInNewContext(code, context);

    let finishSlow!: () => void;
    let released = 0;
    class SlowProcedure {
        className = 'SlowProcedure';
        cancelled = 0;
        entered = 0;
        onInit() {}
        onPreload(_params?: unknown, preload?: { resources: ResourceScope }) {
            preload?.resources.defer(() => { released += 1; });
            return new Promise<void>((resolve) => { finishSlow = resolve; });
        }
        onPreloadCancelled() { this.cancelled += 1; }
        onEnter() { this.entered += 1; }
        onLeave() {}
        onUpdate() {}
        _adoptResourceScope() {}
        destroy() {}
    }
    class FastProcedure extends SlowProcedure {
        className = 'FastProcedure';
        onPreload() { return Promise.resolve(); }
    }

    const manager = new context.exports.ProcedureManager();
    manager.onLoad();
    manager.configure({ assets: {}, configs: {}, network: {} });
    const slow = manager.registerRoute('slow', SlowProcedure) as SlowProcedure;
    const fast = manager.registerRoute('fast', FastProcedure) as FastProcedure;

    manager.navigate('slow');
    manager.navigate('fast');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(manager.currentProcedure, fast);
    assert.equal(fast.entered, 1);
    assert.equal(released, 1, '新导航应立即释放旧预加载作用域');

    finishSlow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(slow.entered, 0);
    assert.equal(slow.cancelled, 1);
    assert.equal(manager.currentProcedure, fast);
});

/**
 * 回归：「框架计时器必须有每帧驱动」。
 *
 * 踩过的坑（2026-09-18）：`UpdateBeat` 在工程里没有任何调用方，于是 `FW.Task.delay()`
 * 永不 resolve，而 `NetSocket.sendData()` 的发送泵正是
 * `while (true) { …; await FW.Task.delay(1) }` —— 第一次 `GameNet.send()` 之后
 * `isSending` 永远停在 `true`，此后所有 `send()` 只入队不发包、promise 永不 resolve、
 * 且不打任何日志。现象：角色页只有第一次进能拉到数据，第二次不刷新。
 */
test('ProcedureManager.update 每帧驱动 UpdateBeat（首个流程进来之前也要驱动）', async () => {
    const code = ts.transpileModule(readFileSync('assets/script/framework/procedure/ProcedureManager.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const counter = trampolineCounter();
    const context = {
        exports: {} as { ProcedureManager: new () => any },
        require: requireWithUpdateBeat(counter),
        console: { error() {} },
    };
    runInNewContext(code, context);

    class ProbeProcedure {
        className = 'ProbeProcedure';
        updates: number[] = [];
        onInit() {}
        onPreload() {}
        onEnter() {}
        onLeave() {}
        onUpdate(dt: number) { this.updates.push(dt); }
        _adoptResourceScope() {}
        destroy() {}
    }

    const manager = new context.exports.ProcedureManager();
    manager.onLoad();

    //  关键：网络在首个流程 onEnter 之前就已经在建连/发包，所以没流程时也必须驱动。
    manager.update(0.02);
    assert.deepEqual(counter.calls, [0.02], '没有当前流程时也要驱动 UpdateBeat（否则发送泵停在第一包）');

    const probe = manager.registerProcedure(ProbeProcedure) as ProbeProcedure;
    manager.startProcedure(ProbeProcedure);
    await new Promise<void>((resolve) => setImmediate(resolve));
    manager.update(0.02);
    assert.equal(counter.calls.length, 2, '有当前流程时依旧每帧驱动');
    assert.equal(counter.calls[1], 0.02, '传下去的 dt 必须是同一帧的 dt（计时器按秒计时）');
    assert.ok(probe.updates.length >= 1, '同一个 dt 仍然照常切分给流程的 onUpdate');
});
