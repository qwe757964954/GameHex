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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSource, readSource } from './helpers/source-text';
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


/**
 * 换行符形态守卫（2026-11-11）：`ZCGameModel.ts` 曾因整份 LF→CRLF 让 `svn diff`
 * 从 +12/-1 假性膨胀到 4700 行，且硬编码 '\n' 的源码文本断言用例会集体假红。
 * 判据按「基线 CRLF=0 → 当前 CRLF>0」逐文件比对，覆盖改动集 + 固定点名集
 * （点名集保证工作副本干净时也不会「零执行假绿」）。
 */
const LINE_ENDING_WATCH = [
    'assets/script/app/zcds/model/ZCGameModel.ts',
    'assets/script/app/zcds/model/systems/ZCProjectileSystem.ts',
    'assets/script/app/zcds/model/systems/ZCStatusResolutionSystem.ts',
    'docs/zcds-performance.md',
    'tests/zcds-legacy-skill-effect.test.ts',
    'tests/zcds-status-resolution.test.ts',
    'tests/zcds-hotpath-allocation.test.ts',
];

test('F7 换行符形态守卫：基线 LF 的文件不得被整份转成 CRLF', () => {
    const root = process.cwd();
    const scope = new Set(LINE_ENDING_WATCH);
    try {
        const xml = execFileSync('svn', ['status', '--xml', '.'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        for (const m of xml.matchAll(/path="([^"]+\.(?:ts|md|json|meta|txt))"/g)) {
            scope.add(m[1].replace(/\\/g, '/'));
        }
    } catch { /* 非 SVN 环境或无改动：仍要实检点名集 */ }
    const offenders: string[] = [];
    let checked = 0;
    for (const file of scope) {
        const rel = file.replace(/\\/g, '/');
        const full = join(root, rel);
        if (!existsSync(full)) continue;
        let base: string;
        try {
            base = execFileSync('svn', ['cat', rel],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        } catch { continue; } // 未入库文件没有基线
        const wc = readFileSync(full, 'utf8');
        checked += 1;
        const baseCrlf = base.split('\r\n').length - 1;
        const wcCrlf = wc.split('\r\n').length - 1;
        if (baseCrlf === 0 && wcCrlf > 0) offenders.push(`${rel} (基线 LF → 现 CRLF ${wcCrlf} 行)`);
    }
    assert.ok(checked >= LINE_ENDING_WATCH.length,
        `点名集必须被实检，实际只查到 ${checked} 个文件`);
    assert.deepEqual(offenders, [],
        '基线 LF 的文件被整份转成 CRLF：转回 LF 再提交，否则 diff 噪声 + 源码文本断言假红');
});


test('F8 源码文本归一 helper：CRLF 输入等价，且新增断言有可用入口', () => {
    assert.equal(normalizeSource('a\r\nb\rc\n'), 'a\nb\nc\n');
    assert.equal(normalizeSource('a\nb\n'), 'a\nb\n', '已是 LF 时保持原样');
    const self = readSource('tests/helpers/source-text.ts');
    assert.ok(self.includes('export function normalizeSource'));
    assert.ok(self.includes('export function readSource'));
    assert.equal(self.includes('\r'), false, 'helper 自身必须是 LF，否则双保险从根上失效');
});
