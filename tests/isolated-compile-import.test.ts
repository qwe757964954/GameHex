/**
 * 隔离编译下 import 擦除规则护栏（代码审查规范 §3.2 第 6 条）。
 *
 * 为什么要专门钉它：`outputs/audit-20261104/等价优化审核报告-第7轮.md` §5 断言
 * 「未使用的 value import 不会被擦除，会保留成真实 require，删整条会丢顶层副作用」，
 * 并拿 `tests/zcds-card-reveal-pop.test.ts:60` 的模块桩当「直接证据」。
 *
 * 2026-11-05 实测证伪：工程 `temp/tsconfig.cocos.json` 是 `module: ES2015` + `isolatedModules`、
 * **未开** `verbatimModuleSyntax`，TS 5.9.3 下未使用 value import 在 CommonJS 与 ES2015 输出里
 * 都会被擦除；真实 `ZCCardRevealView.ts` 转译产物里根本没有 `ZCDCLogSwitch`——那个桩是死分支，
 * 不能证明依赖存在。
 *
 * 但「只有 import type 能零风险删」的结论过窄：真正不能删的是**裸副作用导入**，
 * 以及所有**使用中的值导入**。本用例把这套口径固化成可执行判据。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..');
const COCOS_TSCONFIG = join(ROOT, 'temp', 'tsconfig.cocos.json');
const ZCGAME = 'assets/script/app/zcds/ZCGame.ts';
const CARD_REVEAL_VIEW = 'assets/script/app/zcds/view/ZCCardRevealView.ts';

function cocosOptions(): Record<string, unknown> {
    return JSON.parse(readFileSync(COCOS_TSCONFIG, 'utf8')).compilerOptions;
}

/** 用工程真源配置转译；module 覆盖成 CommonJS 只为让 require 可观测。 */
function emit(source: string, extra: ts.CompilerOptions = {}): string {
    const options = cocosOptions();
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2015,
            isolatedModules: Boolean(options.isolatedModules),
            experimentalDecorators: Boolean(options.experimentalDecorators),
            ...extra,
        },
    }).outputText;
}

const HAS_REQUIRE = (out: string) => out.includes('require("./m")');

test('D1 编译口径守卫：ES2015 + isolatedModules，且未开 verbatimModuleSyntax', () => {
    const options = cocosOptions();
    assert.equal(options.module, 'ES2015', '模块口径变了，下面四类 import 的结论要重测');
    assert.equal(options.isolatedModules, true);
    assert.equal(options.verbatimModuleSyntax, undefined,
        '一旦开启它，未使用 value import 会保留成 require，D2 的擦除结论整体翻转');
});

test('D2 擦除矩阵：只有「使用中的值导入」和「裸副作用导入」产生 require', () => {
    const cases = [
        { name: '未使用 value import', src: `import { X } from './m'; export const y = 1;`, has: false },
        { name: 'import type', src: `import type { X } from './m'; export const y: any = 1;`, has: false },
        { name: '使用中的 value import', src: `import { X } from './m'; export const y = X;`, has: true },
        { name: '裸副作用导入', src: `import './m'; export const y = 1;`, has: true },
    ];
    for (const item of cases) {
        const out = emit(item.src);
        assert.equal(HAS_REQUIRE(out), item.has,
            `${item.name}：当前编译口径下 require 存在性不符合预期，产物：${out.trim()}`);
    }
});

test('D3 裸副作用导入是唯一「未使用也不能删」的类别：删掉就少一次模块加载', () => {
    const loaded: string[] = [];
    const run = (source: string) => {
        loaded.length = 0;
        const out = emit(source);
        const module = { exports: {} as Record<string, unknown> };
        new Function('require', 'module', 'exports', out)(
            (name: string) => { loaded.push(name); return {}; },
            module,
            module.exports,
        );
    };

    run(`import './m'; export const y = 1;`);
    assert.deepEqual(loaded, ['./m'], '副作用导入必须真的加载模块');
    run(`export const y = 1;`);
    assert.deepEqual(loaded, [], '删掉这条 import 就少一次加载 ⇒ 不能当「未使用」清理');
});

test('D4 真实源码反例：符号只在注释里出现 ⇒ import 被擦除，夹具里的桩不是依赖证据', () => {
    const source = readFileSync(join(ROOT, CARD_REVEAL_VIEW), 'utf8');
    assert.match(source, /import \{ ZCDC_LOG_WARNINGS \} from '\.\.\/ZCDCLogSwitch';/);

    const codeReferences = source.split(/\r?\n/)
        .filter((line) => line.includes('ZCDC_LOG_WARNINGS'))
        .filter((line) => !line.trim().startsWith('//'));
    assert.equal(codeReferences.length, 1,
        '除 import 行外不应再有代码引用；若开始真用它，本用例的前提就变了，需重判');

    const out = emit(source);
    assert.equal(out.includes('ZCDCLogSwitch'), false,
        '当前编译口径下该 import 应被整条擦除；若出现说明编译选项已变，先看 D1');
});

test('D5 真实源码正例：使用中的值导入必须保留 require', () => {
    const source = readFileSync(join(ROOT, ZCGAME), 'utf8');
    assert.match(source, /import \{ ZCDC_LOG_DIAGNOSTICS, ZCDC_LOG_WARNINGS \} from '\.\/ZCDCLogSwitch';/);
    const out = emit(source);
    assert.ok(out.includes('require("./ZCDCLogSwitch")'),
        'ZCGame.ts 在正文里用了两个日志开关，删这条 import 会改变运行时依赖图');
});
