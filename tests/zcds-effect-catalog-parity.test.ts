import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_EFFECT_MISSILE_BY_UNIT,
    ZC_EFFECT_SPECS,
    zcEffectAnchorOf,
    zcEffectFadeSecondsOf,
    zcEffectFacingOffsetOf,
    zcEffectFlightOf,
    zcEffectLayerOfPath,
    zcEffectLiftYOf,
    zcEffectMissileOf,
    zcEffectMissilePaths,
    zcEffectNodeScaleOf,
    zcEffectOverlayChildOf,
    zcEffectTintOf,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import {
    zcCombatEffectFadeSecondsOf,
    zcCombatEffectFacingOffsetOf,
    zcCombatEffectFlightOf,
    zcMissileFxOf,
    zcMissileFxPaths,
} from '../assets/script/app/zcds/model/ZCCombatEffectFlight';
import {
    zcCombatEffectAnchorOf,
    zcCombatEffectLayerOfPath,
    zcCombatEffectLiftY,
    zcCombatEffectOverlayChild,
} from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { zcCombatEffectTintOf } from '../assets/script/app/zcds/view/ZCCombatEffectTint';

/**
 * P1 迁移 parity：目录必须与改造前四张表逐键相等。
 *
 * 基线来自移动前逐字抄下的表值（`tests/fixtures/zc-effect-catalog-baseline.json`）。
 * 这条用例只回答「有没有搬错 / 搬漏」，不替代各模块原有的行为测试。
 */

interface IFlightBaseline {
    speed: number;
    minSeconds: number;
    maxSeconds: number;
    facingOffsetDegrees: number;
}

interface IMissileBaseline {
    missilePrefabPath: string;
    impactPrefabPath: string;
    arcOffset: number;
    speed?: number;
    count?: number;
}

interface IBaseline {
    nodeScale: Record<string, number>;
    anchor: Record<string, 'caster' | 'midpoint'>;
    liftY: Record<string, number>;
    layer: Record<string, 'ground' | 'top'>;
    overlayChild: Record<string, string>;
    flight: Record<string, IFlightBaseline>;
    facing: Record<string, number>;
    fade: Record<string, number>;
    tint: Record<string, [number, number, number]>;
    missile: Record<string, IMissileBaseline>;
}

const BASELINE = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'zc-effect-catalog-baseline.json'), 'utf8'),
) as IBaseline;

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-12;

test('① 目录条目集合 = 基线路径并集，且路径唯一', () => {
    const expectedPaths = new Set<string>([
        ...Object.keys(BASELINE.nodeScale),
        ...Object.keys(BASELINE.anchor),
        ...Object.keys(BASELINE.liftY),
        ...Object.keys(BASELINE.layer),
        ...Object.keys(BASELINE.overlayChild),
        ...Object.keys(BASELINE.flight),
        ...Object.keys(BASELINE.facing),
        ...Object.keys(BASELINE.fade),
        ...Object.keys(BASELINE.tint),
    ]);
    const actualPaths = ZC_EFFECT_SPECS.map((spec) => spec.prefabPath);
    assert.equal(new Set(actualPaths).size, actualPaths.length, '目录不允许重复路径');
    assert.deepEqual([...actualPaths].sort(), [...expectedPaths].sort());
});

test('② 尺寸 / 锚点 / 抬升 / 层级 / 叠层逐键 parity', () => {
    for (const [path, expected] of Object.entries(BASELINE.nodeScale)) {
        assert.ok(close(zcEffectNodeScaleOf(path), expected), `目录尺寸 ${path}: ${zcEffectNodeScaleOf(path)} != ${expected}`);
        assert.ok(close(zcCombatEffectNodeScaleOf(path), expected), `facade 尺寸 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.anchor)) {
        assert.equal(zcEffectAnchorOf(path), expected, `目录锚点 ${path}`);
        assert.equal(zcCombatEffectAnchorOf(path), expected, `facade 锚点 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.liftY)) {
        assert.equal(zcEffectLiftYOf(path), expected, `目录抬升 ${path}`);
        assert.equal(zcCombatEffectLiftY(path), expected, `facade 抬升 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.layer)) {
        assert.equal(zcEffectLayerOfPath(path), expected, `目录层级 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.overlayChild)) {
        assert.equal(zcEffectOverlayChildOf(path), expected, `目录叠层 ${path}`);
        assert.equal(zcCombatEffectOverlayChild(path), expected, `facade 叠层 ${path}`);
    }
});

test('③ 飞行 / 朝向 / 淡出 / 染色逐键 parity', () => {
    for (const [path, expected] of Object.entries(BASELINE.flight)) {
        assert.deepEqual(zcEffectFlightOf(path), expected, `目录飞行 ${path}`);
        assert.deepEqual(zcCombatEffectFlightOf(path), expected, `facade 飞行 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.facing)) {
        assert.equal(zcEffectFacingOffsetOf(path), expected, `目录朝向 ${path}`);
        assert.equal(zcCombatEffectFacingOffsetOf(path), expected, `facade 朝向 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.fade)) {
        assert.equal(zcEffectFadeSecondsOf(path), expected, `目录淡出 ${path}`);
        assert.equal(zcCombatEffectFadeSecondsOf(path), expected, `facade 淡出 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.tint)) {
        assert.deepEqual(zcEffectTintOf(path), expected, `目录染色 ${path}`);
        assert.deepEqual(zcCombatEffectTintOf(path), expected, `facade 染色 ${path}`);
    }
});

test('④ 导弹表与资源路径逐键 parity', () => {
    assert.deepEqual(ZC_EFFECT_MISSILE_BY_UNIT, BASELINE.missile);
    for (const [unitId, expected] of Object.entries(BASELINE.missile)) {
        assert.deepEqual(zcEffectMissileOf(unitId), expected, `目录导弹 ${unitId}`);
        assert.deepEqual(zcMissileFxOf(unitId), expected, `facade 导弹 ${unitId}`);
    }
    const expectedPaths = [...new Set(Object.values(BASELINE.missile).flatMap((fx) => [
        fx.missilePrefabPath,
        fx.impactPrefabPath,
    ]))].sort();
    assert.deepEqual([...zcEffectMissilePaths()].sort(), expectedPaths);
    assert.deepEqual([...zcMissileFxPaths()].sort(), expectedPaths);
});

test('⑤ 未登记路径的兜底与改造前逐字一致', () => {
    const unknown = 'units/projectiles/未登记/未登记';
    assert.equal(zcEffectNodeScaleOf(null), 1);
    assert.equal(zcEffectNodeScaleOf(''), 1);
    assert.equal(zcEffectNodeScaleOf(unknown), 1);
    assert.equal(zcCombatEffectNodeScaleOf(undefined), 1);
    assert.equal(zcEffectAnchorOf(unknown), 'caster');
    assert.equal(zcCombatEffectAnchorOf(null), 'caster');
    assert.equal(zcEffectLiftYOf(unknown), 0);
    assert.equal(zcEffectLayerOfPath(unknown), null);
    assert.equal(zcEffectOverlayChildOf(unknown), null);
    assert.equal(zcEffectFlightOf(unknown), null);
    assert.equal(zcEffectFacingOffsetOf(unknown), null);
    assert.equal(zcEffectFadeSecondsOf(unknown), 0);
    assert.equal(zcEffectTintOf(unknown), null);
    assert.equal(zcMissileFxOf('99999'), null);
    // 层级 facade 仍按事件类型回落：area 铺地，其余置顶。
    assert.equal(zcCombatEffectLayerOfPath(ZCCombatEventType.Area, unknown), 'ground');
    assert.equal(zcCombatEffectLayerOfPath(ZCCombatEventType.Melee, unknown), 'top');
    assert.equal(
        zcCombatEffectLayerOfPath(ZCCombatEventType.Area, 'units/projectiles/鹿神守护/鹿神守护'),
        'top',
    );
});

test('⑥ 旧模块不再各自保留路径表（迁移后只允许目录出现路径字面量）', () => {
    const facades = [
        'assets/script/app/zcds/view/ZCCombatEffectScale.ts',
        'assets/script/app/zcds/view/ZCCombatEffectTint.ts',
        'assets/script/app/zcds/view/ZCCombatEffectPlacement.ts',
        'assets/script/app/zcds/model/ZCCombatEffectFlight.ts',
    ];
    for (const relative of facades) {
        assert.doesNotMatch(read(relative), /'units\/projectiles\//, `${relative} 仍持有路径表`);
    }
    const catalog = read('assets/script/app/zcds/model/ZCEffectCatalog.ts');
    assert.match(catalog, /'units\/projectiles\/斧盾兵_反击气刃\/斧盾兵_反击气刃'/, '目录应持有飞行条目');
    assert.match(catalog, /'68010'/, '目录应持有导弹条目');
});
