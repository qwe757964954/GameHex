/**
 * 跨文件改动「先写定义再写调用点」的护栏（规则 402 / 代码审查规范 §4）。
 *
 * 真源 `checkDefinitions` 在 tools/verify/verify.mjs，复用该文件已有的 `resolveSpec`，
 * 只检查改动集内**互相引用**的相对 import —— 这类组合正是同事整包提交时最容易只带一半的。
 *
 * 夹具走「真实路径 + 注入 read」：路径必须真实存在（resolveSpec 要 stat），内容可伪造，
 * 因此不需要在 tests/ 下造临时 .ts 文件（工程 tsconfig 无 include，多一个就 TS6200）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDefinitions, exportedNamesOf } from '../tools/verify/verify.mjs';

const CALLER = 'tests/verify-route.test.ts';
const DEFINER = 'tests/auto-atlas-capacity.test.ts';

const readPair = (callerSource: string, definerSource: string) => (file: string) =>
    file === CALLER ? callerSource : definerSource;

test('F1 导出符号解析覆盖常见形态，export * 显式判为不可判定', () => {
    const names = exportedNamesOf(`
export const a = 1;
export function b() {}
export class C {}
export interface D {}
export type E = string;
export enum F {}
export declare const g: number;
export abstract class H {}
export { h, i as j };
export type { K };
export default function main() {}
`);
    assert.ok(names, '普通源不该被判为不可判定');
    for (const name of ['a', 'b', 'C', 'D', 'E', 'F', 'g', 'H', 'h', 'j', 'K', 'default']) {
        assert.ok(names!.has(name), `漏解析导出符号 ${name}`);
    }
    assert.equal(exportedNamesOf(`export * from './y';`), null,
        '星号导出无法静态判定，必须跳过而不是误报一堆缺定义');
});

test('F2 定义存在 ⇒ 零问题，且检查计数不为 0（防「解析不到就 continue」式假绿）', () => {
    const result = checkDefinitions([CALLER, DEFINER], {
        read: readPair(
            `import { foo } from './auto-atlas-capacity.test'; export const x = 1;`,
            `export const foo = 1;`,
        ),
    });
    assert.equal(result.checked, 1, '必须真的检查到引用，0 次执行等于没护栏');
    assert.deepEqual(result.issues, []);
});

test('F3 定义被覆盖 / 删掉 ⇒ 点名文件、目标与符号', () => {
    const result = checkDefinitions([CALLER, DEFINER], {
        read: readPair(
            `import { foo, missing } from './auto-atlas-capacity.test'; export const x = 1;`,
            `export const foo = 1;`,
        ),
    });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].file, CALLER);
    assert.equal(result.issues[0].target, DEFINER);
    assert.equal(result.issues[0].name, 'missing');
    assert.match(result.issues[0].reason, /没有导出/);
});

test('F4 定义尚未入库（HEAD 里没有）⇒ 报「中间态跑不起来」', () => {
    const read = readPair(
        `import { foo } from './auto-atlas-capacity.test'; export const x = 1;`,
        `export const foo = 1;`,
    );
    const pending = checkDefinitions([CALLER, DEFINER], {
        read,
        headOf: () => `export const old = 1;`,
    });
    assert.equal(pending.issues.length, 1);
    assert.match(pending.issues[0].reason, /定义尚未入库/);

    const newFile = checkDefinitions([CALLER, DEFINER], { read, headOf: () => null });
    assert.deepEqual(newFile.issues, [], 'HEAD 里整个文件都不存在时不该误报（新文件随整包一起提交即可）');
});

test('F5 真实源码抽样：既有测试 import verify.mjs 的五个函数都能找到导出', () => {
    const result = checkDefinitions([CALLER, 'tools/verify/verify.mjs']);
    assert.ok(result.checked >= 5, `应至少检查到 5 个真实引用，实际 ${result.checked}`);
    assert.deepEqual(result.issues, [],
        `真实组合出现误报，说明导出解析正则漏了形态：${JSON.stringify(result.issues)}`);
});

test('F6 不可判定的目标文件走 skipped，不产生假阳性', () => {
    const result = checkDefinitions([CALLER, DEFINER], {
        read: readPair(
            `import { foo } from './auto-atlas-capacity.test'; export const x = 1;`,
            `export * from './y';`,
        ),
    });
    assert.equal(result.skipped, 1);
    assert.equal(result.issues.length, 0);
});
