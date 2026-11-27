/**
 * `constant-guard` 的最小护栏。
 *
 * 覆盖口径（对应《工程常量泛滥治理方案》§4 Phase 4 的四条拦截规则）：
 *  1. C1/C2 死导出与过度导出：外部零引用才判，`typeof` 派生公共类型时不算过度导出；
 *  2. C4/C5/C6 颜色、enum、冻结：Theme 文件与非 const enum 的边界；
 *  3. C7/C8 MVC 归属：model 层的样式文件/字号色号、跨 feature 直连 Art/Texts；
 *  4. C3/C10 多真源：与公共真源同值、跨文件同名；
 *  5. 基线按 `rule|file|symbol` 比较，行号平移不影响判定；
 *  6. CLI `audit --json` 能跑通并返回可解析统计。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
    RULES,
    analyzeSource,
    atomicWarnings,
    duplicateViolations,
    newViolations,
} from '../tools/verify/constant-guard.mjs';

const ROOT = join(__dirname, '..');

function countRule(violations: Array<{ rule: string }>, rule: string): number {
    return violations.filter((item) => item.rule === rule).length;
}

test('C1：全仓零引用的导出判死；有外部引用不判', () => {
    const text = [
        'export const DEAD_ONE = 1;',
        'export const SHARED_ONE = 2;',
    ].join('\n');
    const dead = analyzeSource('assets/script/app/demo/Dead.ts', text, { externalCounts: new Map() });
    assert.equal(countRule(dead, 'C1'), 2);

    const alive = analyzeSource('assets/script/app/demo/Dead.ts', text, {
        externalCounts: new Map([['SHARED_ONE', 3]]),
    });
    assert.equal(countRule(alive, 'C1'), 1);
    assert.equal(alive.find((item) => item.rule === 'C1')?.symbol, 'DEAD_ONE');
});

test('C2：仅本文件消费判过度导出；typeof 派生公共类型时豁免', () => {
    const onlyInternal = [
        'export const INTERNAL_ONLY = 42;',
        'export function read(): number {',
        '    return INTERNAL_ONLY;',
        '}',
    ].join('\n');
    assert.equal(countRule(analyzeSource('assets/script/app/demo/Only.ts', onlyInternal), 'C2'), 1);

    const typeSource = [
        'export const DICT = { a: 1 } as const;',
        'export type DictValue = typeof DICT[keyof typeof DICT];',
    ].join('\n');
    assert.equal(countRule(analyzeSource('assets/script/app/demo/Only.ts', typeSource), 'C2'), 0);

    const canonical = 'export const ITEM_TABLE = \'item\';';
    assert.equal(countRule(analyzeSource('assets/script/core/config/TableNames.ts', canonical), 'C2'), 0);
});

test('C11：仅测试/工具引用的导出判违规；生产有引用则放行', () => {
    const text = 'export const TEST_ONLY = 1;';
    const testOnly = analyzeSource('assets/script/app/demo/Demo.ts', text, {
        externalCounts: new Map([['TEST_ONLY', 2]]),
        productionCounts: new Map([['TEST_ONLY', 0]]),
    });
    assert.equal(countRule(testOnly, 'C11'), 1);

    const productionUsed = analyzeSource('assets/script/app/demo/Demo.ts', text, {
        externalCounts: new Map([['TEST_ONLY', 2]]),
        productionCounts: new Map([['TEST_ONLY', 1]]),
    });
    assert.equal(countRule(productionUsed, 'C11'), 0);
});

test('C4：非 Theme 的裸 new Color 判违规，Theme 与注释豁免', () => {
    const view = [
        'const HILITE = new Color(255, 200, 0, 255);',
        '// 说明里提到 new Color(1, 2, 3) 不算',
    ].join('\n');
    assert.equal(countRule(analyzeSource('assets/script/app/demo/view/DemoView.ts', view), 'C4'), 1);

    const theme = 'const HILITE = Object.freeze(new Color(255, 200, 0, 255));';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/view/DemoTheme.ts', theme), 'C4'), 0);
});

test('C5/C6：非 const enum 与未冻结的导出字面量', () => {
    const enumText = 'export enum DemoKind { A, B }';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/DemoTable.ts', enumText), 'C5'), 1);

    const constEnum = 'export const enum DemoKind { A, B }';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/DemoTable.ts', constEnum), 'C5'), 0);

    const mutable = 'export const DEMO_LIST = [1, 2, 3];';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/DemoTable.ts', mutable), 'C6'), 1);

    const frozen = [
        'export const DEMO_LIST = Object.freeze([1, 2, 3]);',
        'export const DEMO_DICT = { a: 1 } as const;',
    ].join('\n');
    assert.equal(countRule(analyzeSource('assets/script/app/demo/DemoTable.ts', frozen), 'C6'), 0);
});

test('C7：model 层的样式文件与字号/色号', () => {
    const styleFile = 'export const DEMO_STYLE = { fontSize: 20 };';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/model/DemoStyle.ts', styleFile), 'C7'), 2);

    const inline = [
        'const TITLE = {',
        '    fontSize: 28,',
        '    color: \'#ffcc00\',',
        '};',
    ].join('\n');
    assert.equal(countRule(analyzeSource('assets/script/app/demo/model/DemoTable.ts', inline), 'C7'), 2);

    const viewText = 'const TITLE = { fontSize: 28, color: \'#ffcc00\' };';
    assert.equal(countRule(analyzeSource('assets/script/app/demo/view/DemoView.ts', viewText), 'C7'), 0);
});

test('C8：跨 feature 直连 Art/Texts 判违规，同 feature 与 common 豁免', () => {
    const cross = 'import { DEMO_ART } from \'../store/StoreArt\';';
    assert.equal(countRule(analyzeSource('assets/script/app/card/Demo.ts', cross), 'C8'), 1);

    const same = 'import { DEMO_ART } from \'./CardArt\';';
    assert.equal(countRule(analyzeSource('assets/script/app/card/Demo.ts', same), 'C8'), 0);

    const common = 'import { DEMO_ART } from \'../common/CommonArt\';';
    assert.equal(countRule(analyzeSource('assets/script/app/card/Demo.ts', common), 'C8'), 0);
});

test('C3/C10：与公共真源同值、跨文件同名', () => {
    const files = [
        { rel: 'assets/script/core/config/TableNames.ts', text: 'export const ITEM_TABLE = \'item\';' },
        { rel: 'assets/script/app/demo/DemoTable.ts', text: 'export const MY_ITEM = \'item\';' },
    ];
    const duplicates = duplicateViolations(files);
    assert.equal(countRule(duplicates, 'C3'), 1);
    assert.equal(duplicates[0].file, 'assets/script/app/demo/DemoTable.ts');

    const sameName = [
        { rel: 'assets/script/app/a/ATable.ts', text: 'export const SHARED_NAME = \'a\';' },
        { rel: 'assets/script/app/b/BTable.ts', text: 'export const SHARED_NAME = \'b\';' },
    ];
    assert.equal(countRule(duplicateViolations(sameName), 'C10'), 2);
});

test('C9：新文件扁平导出超预算给 warn，公共真源豁免', () => {
    const counts = new Map<string, number>([
        ['assets/script/app/demo/BigArt.ts', 24],
        ['assets/script/app/ArtPaths.ts', 59],
    ]);
    const warnings = atomicWarnings(counts, new Map());
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].file, 'assets/script/app/demo/BigArt.ts');
    assert.equal(RULES.C9.severity, 'warn');
});

test('基线：指纹不含行号，平移后仍是同一条', () => {
    const before = analyzeSource('assets/script/app/demo/Dead.ts', 'export const DEAD_ONE = 1;');
    const after = analyzeSource('assets/script/app/demo/Dead.ts', '\n\n// 头部注释\nexport const DEAD_ONE = 1;');
    const beforeOne = before.find((item) => item.rule === 'C1');
    const afterOne = after.find((item) => item.rule === 'C1');
    assert.ok(beforeOne && afterOne);
    assert.equal(beforeOne.fingerprint, afterOne.fingerprint);
    assert.notEqual(beforeOne.line, afterOne.line);

    const baseline = { fingerprints: new Set([beforeOne.fingerprint]), files: new Map() };
    assert.deepEqual(newViolations([afterOne], baseline), []);

    const fresh = analyzeSource('assets/script/app/demo/Dead.ts', 'export const DEAD_TWO = 2;');
    const freshOne = fresh.find((item) => item.rule === 'C1');
    assert.ok(freshOne);
    assert.equal(newViolations([freshOne], baseline).length, 1);
});

test('CLI：audit --json 输出可解析统计', () => {
    const result = spawnSync(process.execPath, ['tools/verify/constant-guard.mjs', 'audit', '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.files > 800);
    assert.ok(report.exportConst > 1500);
});
