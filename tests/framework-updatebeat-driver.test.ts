/**
 * 回归：**框架的 `UpdateBeat` 必须每帧被驱动**（`ProcedureManager.update()` 负责），
 * 因为 `FW.Task.delay()` / `Timer` 全部挂在它上面。
 *
 * 为什么值得单独钉一条测试（2026-09-18 踩的坑）：
 *
 * ```
 * NetSocket.sendData()        // 发送泵
 *   while (true) {
 *     …state.addNetworkRequest(request)
 *     await FW.Task.delay(1)   // → Timer → UpdateBeat.addListener
 *   }
 *   t.isSending = false        // ← 这一行永远到不了
 * ```
 *
 * `UpdateBeat.loop(dt)` 在本工程原本没有任何调用方（老客户端由引擎主循环调
 * `window.frameworkUpdate`，那个函数没人调；`DemoMain` 调了但没挂进场景），于是：
 *
 *   1. `FW.Task.delay` 永不 resolve → `isSending` 永远停在 `true`；
 *   2. 之后每一次 `GameNet.send()` 只入队、**不发包**，promise 永不 resolve；
 *   3. 全程**一条日志都没有**（`addNetworkRequest` 无条件返回 true，超时定时器也是死的）。
 *
 * 表现就是「角色页第一次进能拉到数据、第二次不刷新」。
 *
 * 这里不 stub `Pool` / `Timer`，直接跑真的框架实现（`cc` 侧只给形状），
 * 只把用不到的 `Func` / `FrameTimer` / `FW` 挡掉，避免把半个框架拖进来。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const FRAMEWORK = 'assets/script/framework';

/** 真跑的框架模块（相对仓库根）。 */
const REAL_MODULES: readonly string[] = [
    `${FRAMEWORK}/base/ScriptObject.ts`,
    `${FRAMEWORK}/log/Log.ts`,
    `${FRAMEWORK}/pool/Pool.ts`,
    `${FRAMEWORK}/utils/UpdateBeat.ts`,
    `${FRAMEWORK}/utils/Timer.ts`,
];

/** `cc` 只需要"存在"：这条链上被调到的都是纯展示 / 尺寸接口。 */
const CC_STUB = { view: {}, _decorator: {}, assetManager: {}, macro: {}, Size: class {}, Vec2: class {}, Rect: class {} };

interface FrameworkContext {
    Timer: {
        getTimer(func: (time?: unknown) => void, caller?: unknown, duration?: number, loop?: number): { start(): void; stop(): void };
    };
    UpdateBeat: { loop(dt: number): void };
}

/**
 * 把指定模块 transpile 成 CommonJS 后在同一个 vm context 里互相 require。
 * 未登记的相对依赖一律给一个宽容的空 stub（用得到的成员都在 REAL_MODULES 里）。
 */
function createFrameworkContext(): FrameworkContext {
    const loaded = new Map<string, unknown>();
    const exports = {} as FrameworkContext;

    const loadModule = (file: string): unknown => {
        if (loaded.has(file)) return loaded.get(file);
        const source = readFileSync(file, 'utf8');
        const code = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        const dir = path.posix.dirname(file);
        const moduleExports: Record<string, unknown> = {};
        loaded.set(file, moduleExports);
        runInNewContext(code, {
            exports: moduleExports,
            require: (name: string) => {
                if (name === 'cc') return CC_STUB;
                if (name === 'cc/env') return {};
                if (!name.startsWith('.')) throw new Error(`unexpected package: ${name}`);
                const resolved = `${path.posix.normalize(path.posix.join(dir, name))}.ts`;
                return REAL_MODULES.includes(resolved) ? loadModule(resolved) : {};
            },
            console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        });
        return moduleExports;
    };

    loadModule(`${FRAMEWORK}/utils/Timer.ts`);
    for (const file of REAL_MODULES) {
        const moduleExports = loadModule(file) as Record<string, unknown>;
        if (moduleExports.Timer) exports.Timer = moduleExports.Timer as FrameworkContext['Timer'];
        if (moduleExports.UpdateBeat) exports.UpdateBeat = moduleExports.UpdateBeat as FrameworkContext['UpdateBeat'];
    }
    return exports;
}

test('Timer 只在 UpdateBeat.loop 被调用时推进 —— 发送泵的 await 靠它才能走到 isSending=false', () => {
    const { Timer, UpdateBeat } = createFrameworkContext();

    let fired = 0;
    // 复刻 `FW.Task.delay(1)`：一次性定时器(loop=1)，回调里自己 stop（旧实现就是
    // `resolve(); frameTimer.stop()`）。
    const once = Timer.getTimer(() => {
        fired += 1;
        once.stop();
    }, undefined, 1, 1);
    once.start();

    // 关键断言：没人调用 UpdateBeat.loop 时，1 秒的定时器永远不到点。
    // 这正是 `NetSocket.sendData()` 的 `await FW.Task.delay(1)` 卡死的方式。
    assert.equal(fired, 0, '未被驱动前不能触发');

    UpdateBeat.loop(0.6);
    assert.equal(fired, 0, '累计 0.6s < 1s，不该触发');

    UpdateBeat.loop(0.6);
    assert.equal(fired, 1, '被驱动到 1.2s 后必须触发一次');

    // 一次性定时器触发即停：再驱动也不会重复触发
    UpdateBeat.loop(5);
    assert.equal(fired, 1, 'loop=1 的定时器只触发一次');

    // 周期定时器（`Toolset.addInterval` 那类）靠每帧驱动持续触发
    let repeated = 0;
    const loopTimer = Timer.getTimer(() => { repeated += 1; }, undefined, 1, -1);
    loopTimer.start();
    UpdateBeat.loop(1.1);
    UpdateBeat.loop(1.1);
    assert.equal(repeated, 2, 'loop=-1 的定时器每满 1 秒触发一次');
    loopTimer.stop();
});
