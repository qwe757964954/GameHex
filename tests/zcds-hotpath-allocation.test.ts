// 命名空间/具名导入：tsconfig 未开 allowSyntheticDefaultImports，
// 避免新增一条全仓 tests 常见的 TS1259（default import）错误。
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * 帧循环堆分配守卫：20 Hz 逻辑步 / 60 fps update 里的临时数组、闭包与对象字面量。
 * 口径见 docs/AI架构与代码规范.md §3.4（严禁 update 每帧 new 临时数组/对象/节点）。
 *
 * 注意：ZCCombatEffectView.drawMissileTrail 的 `new Color(` **不在本守卫内** ——
 * 本次保留拖尾颜色写法；现有 new Color 源码断言不能代替真实引擎的颜色复制语义验证。
 */

/** 按方法签名切片，避免 `indexOf` 命中调用点导致切出空串 ⇒ 断言恒绿的假绿。 */
function methodBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.ok(start > 0, `找不到方法签名：${signature}`);
    const open = source.indexOf('{', start);
    assert.ok(open > start, `方法签名后必须有方法体：${signature}`);
    let depth = 0;
    for (let index = open; index < source.length; index++) {
        const char = source[index];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`方法体未闭合：${signature}`);
}

const TARGETS = [
    {
        name: 'ZCStatusEffect.tick',
        file: 'assets/script/app/zcds/model/ZCStatusEffect.ts',
        signature: 'tick(unitIds: readonly string[], dt: number): void {',
    },
    {
        name: 'ZCStatusResolutionSystem.tick',
        file: 'assets/script/app/zcds/model/systems/ZCStatusResolutionSystem.ts',
        signature: 'tick(state: ZCSnapshot, dt: number, context: IZCStatusResolutionContext): void {',
    },
    {
        name: 'ZCGame.update',
        file: 'assets/script/app/zcds/ZCGame.ts',
        signature: 'update(dt: number): void {',
    },
] as const;

// 目标数守卫：签名漂移导致某个目标取不到时，不允许「零断言通过」。
test('守卫目标必须全部存在且唯一', () => {
    assert.equal(TARGETS.length, 3);
    for (const target of TARGETS) {
        const source = readFileSync(target.file, 'utf8');
        const first = source.indexOf(target.signature);
        assert.ok(first > 0, `${target.name} 的方法签名必须存在`);
        assert.equal(source.indexOf(target.signature, first + 1), -1,
            `${target.name} 的方法签名必须唯一`);
        assert.ok(methodBody(source, target.signature).length > 40,
            `${target.name} 的方法体不能为空`);
    }
});

test('ZCStatusEffect.tick：状态推进不建临时数组、不建闭包、不用 spread', () => {
    const source = readFileSync(TARGETS[0].file, 'utf8');
    const body = methodBody(source, TARGETS[0].signature);
    assert.doesNotMatch(body, /\.map\s*\(/, '每逻辑步的 .map() 会为每个有状态单位再建一条数组');
    assert.doesNotMatch(body, /\.filter\s*\(/, '每逻辑步的 .filter() 会再建一条数组 + 一个闭包');
    assert.doesNotMatch(body, /Math\.max\s*\(\s*\.\.\./, 'spread 会把数组展开成临时参数列表');
    assert.doesNotMatch(body, /const\s+\w+\s*:\s*[\w<>]+\[\]\s*=\s*\[\s*\]/,
        '不允许每逻辑步新建收集数组');
});

test('ZCStatusResolutionSystem.tick：存活表不经过 filter().map() 链', () => {
    const source = readFileSync(TARGETS[1].file, 'utf8');
    const body = methodBody(source, TARGETS[1].signature);
    assert.doesNotMatch(body, /\.filter\s*\(/, 'filter 会建一条中间数组 + 一个闭包');
    assert.doesNotMatch(body, /\.map\s*\(/, 'map 会建一条中间数组 + 每个单位一个 tuple 数组');
    assert.doesNotMatch(body, /Array\.from\s*\(/, 'Array.from 会建迭代器与结果数组');
});

test('ZCGame.update：帧事件不每帧新建 payload 对象', () => {
    const source = readFileSync(TARGETS[2].file, 'utf8');
    const body = methodBody(source, TARGETS[2].signature);
    assert.doesNotMatch(body, /emit\s*\([^)]*\{\s*owner\s*:/,
        '每帧 emit 的对象字面量是稳定的 60 次/秒分配；改为复用帧内 payload');
});

test('状态结算及牵引不在每步创建容器，穿透记录不反复复制数组', () => {
    const source = readFileSync(TARGETS[1].file, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    for (const signature of [TARGETS[1].signature, 'private static tickLegacyTraction(']) {
        const body = methodBody(source, signature);
        assert.doesNotMatch(body, /new Map|Array\.from|:\s*\w+\[\]\s*=\s*\[\]/);
    }
    const projectile = readFileSync('assets/script/app/zcds/model/systems/ZCProjectileSystem.ts', 'utf8');
    assert.doesNotMatch(projectile, /hitUnitIds\s*=\s*\[\s*\.\.\./);
});

test('索敌候选循环只记标量，不为每个更优候选分配对象或闭包', () => {
    const source = readFileSync('assets/script/app/zcds/model/systems/ZCTargetingSystem.ts', 'utf8');
    const body = methodBody(source,
        'static acquire(unit: ZCUnitState, context: ZCTargetingContext, unitsOnly = false): ZCTargetSelection | null {');
    assert.doesNotMatch(body, /=>|best\s*=\s*\{/);
});
