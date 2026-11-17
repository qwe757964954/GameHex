/**
 * `function-body-layout` 检查器的最小护栏。
 *
 * 覆盖口径：
 *  1. A 类（跨行函数体首句未换行）在函数声明 / 方法 / 构造函数 / getter / setter / 函数表达式 / 块体箭头里都能检出；
 *  2. 已经正确换行的示例通过；
 *  3. 表达式箭头函数（`x => x.id`）保持单行不算违规；
 *  4. 字符串与注释里的「伪代码」不误报；类型声明、对象字面量不被当成函数；
 *  5. 基线按「文件 + 函数身份」比较，行号平移不影响判定；
 *  6. AST 指纹能区分「只动空白」与「改了 token」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectSourceFiles,
    compareSyntax,
    newViolations,
    scanFile,
    scanSource,
} from '../tools/verify/function-body-layout.mjs';

const A_DECLARATION = `function pick(a: number): number {    const b = a + 1;
    return b;
}`;

const A_CLASS = `class Box {
    private value = 0;
    constructor() {    this.value = 1;
    }
    get current(): number {    return this.value;
    }
    set current(next: number) {    this.value = next;
    }
    run(): void {    this.value += 1;
    }
}`;

const A_FUNCTION_EXPRESSION = `const run = function (x: number) {    return x;
};`;

const A_BLOCK_ARROW = `const run = (x: number) => {    const y = x + 1;
    return y;
};`;

const CLEAN_SAMPLE = `interface Spec {
    run(): void;
}
type Fn = (x: number) => number;
const id = (x: number) => x.id;
const pick = (x: { id: string }) => x.id;
const holder = { label: 'x', run() { return 1; } };
const run = (x: number) => {
    const y = x + 1;
    return y;
};
function done(a: number): number {
    const b = a + 1;
    return b;
}`;

const TRICKY_TEXT = `// function commented() {    const a = 1;
//     return a;
// }
/* class C {
    method() {    const b = 2;
        return b;
    }
} */
const text = "function inString() {    const c = 3; }";
const nested = 'brace { with } quotes';
`;

test('A 类：函数体首句与左花括号同行会被检出', () => {
    const findings = scanSource(A_DECLARATION, 'sample.ts');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'A');
    assert.equal(findings[0].name, 'pick');
    assert.equal(findings[0].kindTag, 'function');
});

test('A 类：方法、构造函数、getter、setter 都会检出且身份可区分', () => {
    const findings = scanSource(A_CLASS, 'sample.ts');
    const tags = findings.map((f) => f.kindTag).sort();
    assert.deepEqual(tags, ['constructor', 'get', 'method', 'set']);
    assert.ok(findings.every((f) => f.category === 'A'));
    assert.equal(new Set(findings.map((f) => f.id)).size, 4, '四个函数的基线身份必须互不相同');
});

test('A 类：函数表达式与块体箭头回调同样受约束', () => {
    const fn = scanSource(A_FUNCTION_EXPRESSION, 'sample.ts');
    assert.equal(fn.length, 1);
    assert.equal(fn[0].kindTag, 'function-expression');
    const arrow = scanSource(A_BLOCK_ARROW, 'sample.ts');
    assert.equal(arrow.length, 1);
    assert.equal(arrow[0].kindTag, 'arrow');
    assert.match(arrow[0].name, /run/);
});

test('正确示例通过：非空函数体从下一行开始', () => {
    const findings = scanSource(CLEAN_SAMPLE, 'sample.ts');
    const a = findings.filter((f) => f.category === 'A');
    assert.deepEqual(a, [], '已换行的函数体不应命中');
    const b = findings.filter((f) => f.category === 'B');
    assert.equal(b.length, 1, '对象字面量里的单行方法只算 B，且对象属性不被当成函数');
});

test('表达式箭头函数保持单行通过，不产生任何命中', () => {
    const source = `const byId = (x: { id: string }) => x.id;
const add = (a: number, b: number) => a + b;
const noop = () => undefined;`;
    assert.deepEqual(scanSource(source, 'sample.ts'), []);
});

test('字符串与注释中的伪代码不误报', () => {
    const findings = scanSource(TRICKY_TEXT, 'sample.ts');
    assert.deepEqual(findings, [], 'AST 只看真实语法节点，注释与字符串里的花括号不是函数体');
});

test('类型声明与普通对象字面量不会被当成函数', () => {
    const source = `interface Runner {
    run(): void;
    readonly id: string;
}
type Handler = (event: string) => void;
declare function declared(a: number): number;
const config = { retry: 3, label: 'x', nested: { enabled: true } };`;
    assert.deepEqual(scanSource(source, 'sample.ts'), []);
});

test('基线按文件 + 函数身份比较：行号平移不影响结果', () => {
    const atTop = scanSource(A_DECLARATION, 'same.ts');
    const shifted = scanSource(`\n\n${A_DECLARATION}`, 'same.ts');
    assert.equal(atTop[0].id, shifted[0].id, '身份不能包含行号');
    assert.notEqual(atTop[0].line, shifted[0].line, '行号本身应当变化，证明确实发生了平移');
    const baseline = new Map([['same.ts', new Set([atTop[0].id])]]);
    assert.deepEqual(newViolations(shifted, baseline, () => null), [], '基线已有的 A 类不算新增');
});

test('增量门禁：新函数新增 A 类会被拦，无可比基线时按新增处理', () => {
    const current = scanSource(A_DECLARATION, 'same.ts');
    const emptyBaseline = new Map([['same.ts', new Set<string>()]]);
    const added = newViolations(current, emptyBaseline, () => null);
    assert.equal(added.length, 1);
    assert.equal(added[0].reason, 'new');

    const previous = new Set([current[0].id]);
    assert.deepEqual(newViolations(current, null, () => previous), [], '有 VCS 上一版时按函数身份对齐');
    const noBaseline = newViolations(current, null, () => null);
    assert.equal(noBaseline.length, 1, '比较不了不能当成通过');
    assert.equal(noBaseline[0].reason, 'no-baseline');
});

test('AST 指纹：换行缩进等价，token 改动必须识别', () => {
    const before = `function f() {    const a = 1;
    return a + 1;
}`;
    const after = `function f() {
    const a = 1;
    return a + 1;
}`;
    assert.equal(compareSyntax(before, after, 'sample.ts').equal, true);
    const changed = after.replace('a + 1', 'a + 2');
    const diff = compareSyntax(before, changed, 'sample.ts');
    assert.equal(diff.equal, false);
    assert.match(diff.before ?? '', /:1$/, '第一处差异必须落在被改动的字面量上');
    assert.match(diff.after ?? '', /:2$/);
});

test('仓库扫描范围排除第三方、生成协议、声明文件与构建产物', () => {
    const collection = collectSourceFiles();
    assert.ok(collection.files.length > 500, `源码数量异常：${collection.files.length}`);
    assert.ok(!collection.files.some((f) => f.startsWith('assets/script/lib/')), '第三方/生成协议目录必须排除');
    assert.ok(!collection.files.some((f) => f.startsWith('assets/script/vscrollview/')), '第三方组件目录必须排除');
    assert.ok(!collection.files.some((f) => /\.d\.(ts|mts|cts)$/.test(f)), '声明文件必须排除');
    assert.ok(!collection.files.some((f) => f.includes('/node_modules/') || f.startsWith('library/')
        || f.startsWith('temp/') || f.startsWith('build/') || f.startsWith('native/')), '构建产物必须排除');
});

test('检查器自身符合它检查的规则', () => {
    const findings = scanFile('tools/verify/function-body-layout.mjs');
    assert.deepEqual(findings.filter((f) => f.category === 'A'), []);
});
