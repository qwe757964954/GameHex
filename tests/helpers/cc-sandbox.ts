/**
 * 统一 TS 沙箱：`typescript.transpileModule` + `node:vm`。
 *
 * ## 为什么要有这个文件
 *
 * 视图 / 控制器直接 `import` 会拖进 `cc` 的完整运行时，node 里跑不起来。工程的做法是
 * 「读源码 → 转成 CommonJS → 在 vm 里跑 → 用模块桩表顶替 `cc` 和内部依赖」。
 * 这套脚手架**在 134 个测试文件里各抄了一遍**（310 个 `runInNewContext` 调用点），
 * 其中 67 个文件各自实现 `_decorator` 桩，写法互不相同。
 *
 * 抄 67 份的真实代价不是重复代码，而是**假绿**：
 *
 * ```ts
 * runInNewContext(code, { exports, require: (name) => {
 *     if (name === 'cc') return { _decorator: {...}, Component: class {} };
 *     return {};                    // ← 桩表没命中就静默给空对象
 * }});
 * ```
 *
 * `return {}` 让「漏写一个模块桩」表现为 `undefined`，而不是报错：只要那条代码路径在本次
 * 断言里没被走到，用例照样绿，而它到底有没有被真正执行过没人知道。更糟的是模块桩与
 * 被测模块**耦合演进**——源码新增一个 import，桩没跟着改，测试不会红，只会开始测空气。
 *
 * 本 helper 把兜底行为保持不变（仍返回 `{}`，不让历史用例集体变红），但把**每一次兜底
 * 都记进 `unresolved`**，让「我这个用例其实只桩了一半」变成可断言、可排查的事实。
 *
 * ## 用法
 *
 * ```ts
 * const { exports, unresolved } = loadTsModule<{ BigMapPage: PageCtor }>(
 *     'assets/script/app/bigmap/view/BigMapPage.ts',
 *     {
 *         modules: {
 *             cc: ccStub({ EventTouch: class {}, Graphics: FakeGraphics }),
 *             '/EventMgr': { EventMgr },
 *             '/ResourceScope': { ResourceScope },
 *         },
 *     },
 * );
 * ```
 *
 * **新增沙箱用例请断言 `unresolved`**：要么 `assert.deepEqual(unresolved, [])`，
 * 要么把它列成常量并写清为什么可以空转（典型是只被当作类型使用的 import —— 那类
 * import 会在转译时被擦掉，根本不会触发 `require`，所以不会出现在列表里）。
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export interface SandboxOptions {
    /**
     * 模块桩表。键是 `require` 收到的模块 id 或它的**后缀**：
     * - `'cc'`：只精确命中 `cc`；
     * - `'/EventMgr'`：命中 `../../framework/event/EventMgr` 这类相对路径；
     * - `'/ProcedureBase'`：同上，按后缀。
     *
     * 只写前缀或裸名（`'EventMgr'`）也行，但容易和别的模块名撞后缀，优先写带 `/` 的形式。
     */
    modules?: Record<string, unknown>;
    /** 额外注入沙箱的全局量（`console`、`setTimeout` 之类）。 */
    globals?: Record<string, unknown>;
}

export interface SandboxResult<T> {
    exports: T;
    /** 被 `require` 到但桩表没命中的模块 id（按发生顺序）。空数组 = 桩表是完整的。 */
    unresolved: string[];
}

/** 按「精确相等 / 后缀命中」查桩表；返回 `undefined` 表示没写桩。 */
function stubOf(modules: Record<string, unknown>, id: string): { hit: true; value: unknown } | { hit: false } {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return { hit: true, value: modules[id] };
    for (const key of Object.keys(modules)) {
        if (key.startsWith('/') && id.endsWith(key)) return { hit: true, value: modules[key] };
    }
    return { hit: false };
}

/**
 * 读取工程内 TS 源码并在沙箱里执行，返回其 `exports`。
 *
 * @param file 相对工程根的路径（与 `readFileSync` 的既有用法一致）
 */
export function loadTsModule<T = Record<string, unknown>>(file: string, opts: SandboxOptions = {}): SandboxResult<T> {
    const source = readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        experimentalDecorators: true,
    } }).outputText;

    const modules = opts.modules ?? {};
    const exports: Record<string, unknown> = {};
    const unresolved: string[] = [];

    const requireStub = (id: string): unknown => {
        const found = stubOf(modules, id);
        if (found.hit) return found.value;
        // 保持历史行为（回空对象，不让存量用例集体变红），但把兜底记下来。
        unresolved.push(id);
        return {};
    };

    runInNewContext(code, { exports, require: requireStub, ...(opts.globals ?? {}) }, { filename: file });
    return { exports: exports as T, unresolved };
}

/**
 * `cc` 模块的最小桩：`_decorator` 全套 + `Component` 基类，其余按需覆盖。
 *
 * `_decorator` 里成员的返回值**必须是「吃配置、回装饰器」的高阶函数**——写成
 * `() => {}` 会让 `@property({ type: Node })` 求值成 `undefined` 再被当装饰器调用，
 * 报错信息（`x is not a function`）离现场很远。
 */
export function ccStub(parts: Record<string, unknown> = {}): Record<string, unknown> {
    const identity = () => (value: unknown) => value;
    return {
        _decorator: {
            ccclass: identity,
            property: () => () => undefined,
            menu: () => () => undefined,
            executeInEditMode: identity,
            requireComponent: identity,
            disallowMultiple: identity,
            inheritDoc: () => undefined,
        },
        Component: class {},
        ...parts,
    };
}
