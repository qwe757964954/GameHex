import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * 领地配色真源 `view/TerritoryTheme.ts` 的判据。
 *
 *  ⚠️ 它 `import { Color } from 'cc'` ⇒ 不能直接 import 到 node 里跑；
 *  与 `territory-random-resource-render.test.ts` 同一手法：转译后塞进 `runInNewContext`，
 *  只桩一个 `Color`（记录 rgba 即可，不需要引擎行为）。
 */
class FakeColor {
    constructor(
        readonly r: number,
        readonly g: number,
        readonly b: number,
        readonly a: number,
    ) {}
}

interface IThemeExports {
    TERRITORY_COLORS: Record<string, FakeColor>;
    territoryStationTint: (state: string) => FakeColor;
    territoryBossTint: () => FakeColor;
    territoryUnboundTint: (type: string) => FakeColor;
}

function loadTheme(): IThemeExports {
    const source = readFileSync('assets/script/app/territory/view/TerritoryTheme.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const exported: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: exported,
        require: (id: string) => {
            if (id === 'cc') return { Color: FakeColor };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return exported as unknown as IThemeExports;
}

const rgba = (color: FakeColor): [number, number, number, number] =>
    [color.r, color.g, color.b, color.a];

// ── 山猫 2026-10-15：「关卡的解锁状态 用红色」──────────────────────────

test('不可解锁的站点底条 = 条件红 230,30,24（含关卡 / 首领 / 资源点 / 随机格）', () => {
    const { TERRITORY_COLORS, territoryStationTint } = loadTheme();
    // 口径是**所有站点类型**的不可解锁态，所以钉在 `locked` 常量本身 + 映射函数两处。
    assert.deepEqual(rgba(TERRITORY_COLORS.locked), [230, 30, 24, 255]);
    assert.deepEqual(rgba(territoryStationTint('locked')), [230, 30, 24, 255]);
});

test('底条红与「银币消耗」文字红同值 —— 同一个「条件不满足」语义', () => {
    const { TERRITORY_COLORS } = loadTheme();
    // 🔴 反例：底条改红了、条上的银币数字还是另一个红 ⇒ 看着像两件事。
    // 两处是独立的 `new Color(...)`，改一处忘另一处不会报错 —— 只能靠这条对拍。
    assert.deepEqual(rgba(TERRITORY_COLORS.locked), rgba(TERRITORY_COLORS.randomConditionText));
});

test('「已解锁但没绑关卡」的待配表据点不跟着变红（仍是中性灰棕）', () => {
    const { TERRITORY_COLORS, territoryUnboundTint } = loadTheme();
    // 它不是「没解锁」（格子已经开了），缺的是**配置**；跟着 locked 变红会让
    // 「还差条件」和「待配表」混成一件事 ⇒ 走单独的 `unbound`。
    assert.deepEqual(rgba(territoryUnboundTint('stage')), rgba(TERRITORY_COLORS.unbound));
    assert.deepEqual(rgba(TERRITORY_COLORS.unbound), [107, 93, 79, 255]);
    assert.notDeepEqual(rgba(territoryUnboundTint('stage')), rgba(TERRITORY_COLORS.locked));
});

// ── 回归保护：其余状态色没被顺手改掉 ───────────────────────────────────

test('其余状态色保持原值（可解锁金 / 已占领 / 已通关 / 探索中 / 首领暗红）', () => {
    const { TERRITORY_COLORS, territoryStationTint, territoryBossTint } = loadTheme();
    assert.deepEqual(rgba(TERRITORY_COLORS.gold), [245, 201, 92, 255]);
    assert.deepEqual(rgba(TERRITORY_COLORS.available), [74, 138, 92, 255]);
    assert.deepEqual(rgba(territoryStationTint('owned')), rgba(TERRITORY_COLORS.owned));
    assert.deepEqual(rgba(territoryStationTint('exploring')), rgba(TERRITORY_COLORS.exploring));
    assert.deepEqual(rgba(territoryStationTint('available')), rgba(TERRITORY_COLORS.available));
    assert.deepEqual(rgba(TERRITORY_COLORS.cleared), [43, 160, 110, 255]);
    // 首领色是 `danger` 暗红 —— 与新的 `locked` 正红**不是**一个色（否则首领和锁定看不出区别）。
    assert.deepEqual(rgba(territoryBossTint()), [160, 67, 57, 255]);
    assert.notDeepEqual(rgba(territoryBossTint()), rgba(TERRITORY_COLORS.locked));
});
