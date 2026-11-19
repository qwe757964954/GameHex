import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_BEHAVIOR_SPECS,
    ZC_EFFECT_PATHS,
    zcEffectMissilePathsForUnit,
    zcEffectPathsForBehavior,
    zcWarmupEffectPaths,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { buildZCBattleWarmupPaths } from '../assets/script/app/zcds/model/ZCGameResourcePlan';

const ROOT = join(__dirname, '..');
const FX_DIRECTORY = join(ROOT, 'assets/script/app/zcds/model');

/** 旧实现的手工预热顺序（`buildZCBattleWarmupPaths([],[],[])` 改造前实测 29 条）。*/
const EXPECTED_WARMUP = [
    'ui/game/ZCGameHUD',
    'ui/game/ZCGameBoard',
    'ui/game/ZCGameHex',
    'ui/game/ZCGameUnit',
    'ui/game/ZCGameEffect',
    'ui/game/ZCGameWall',
    'ui/game/ZCGameWallLayer',
    'ui/game/ZCGameFloatText',
    'ui/game/ZCGameCardReveal',
    'ui/game/ZCGameLegendBanner',
    'ui/game/ZCGameDecor',
    'units/effects/出生特效/出生特效',
    'units/effects/死亡特效/死亡特效',
    'units/effects/建筑死亡特效/建筑死亡特效',
    'units/effects/受击特效/射手受击/射手受击',
    'units/effects/受击特效/战士受击/战士受击',
    'units/effects/受击特效/法师受击/法师受击',
    'units/effects/受击特效/坦克受击/坦克受击',
    'ui/game/ZCSpawnSelection',
    'ui/game/ZCBossPanel',
    'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能',
    'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中',
    'units/projectiles/子弹_新怪物/通用箭矢',
    'units/projectiles/普攻爆炸/普攻爆炸',
    'units/projectiles/长戟兵_撕裂/长戟兵_撕裂',
    'units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋',
    'units/projectiles/刀盾兵_护盾/刀盾兵_护盾',
    'units/projectiles/三叶小丑_普攻/三叶小丑_普攻',
    'units/projectiles/风法师_龙卷风/风法师_龙卷风',
];

/** 行为键 → 目录给出的路径；与改造前每个 `ZC*Fx` 模块的输出逐项一致。*/
const EXPECTED_BEHAVIOR_PATHS: Readonly<Record<string, readonly string[]>> = {
    [ZC_EFFECT_BEHAVIOR_KEYS.blinkStrike]: [ZC_EFFECT_PATHS.blink],
    [ZC_EFFECT_BEHAVIOR_KEYS.boltStrike]: [ZC_EFFECT_PATHS.bolt],
    [ZC_EFFECT_BEHAVIOR_KEYS.chainDamage]: [ZC_EFFECT_PATHS.bolt],
    [ZC_EFFECT_BEHAVIOR_KEYS.selfAura]: [ZC_EFFECT_PATHS.sustainedAura],
    [ZC_EFFECT_BEHAVIOR_KEYS.trapPlace]: [
        ZC_EFFECT_PATHS.trapSpawn, ZC_EFFECT_PATHS.trapIdle, ZC_EFFECT_PATHS.trapExpire,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.splashShot]: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst]: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.burstAura]: [ZC_EFFECT_PATHS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.burstKnockback]: [ZC_EFFECT_PATHS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.fanSlow]: [ZC_EFFECT_PATHS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.singleStrike]: [ZC_EFFECT_PATHS.singleStrike],
    [ZC_EFFECT_BEHAVIOR_KEYS.chargeShield]: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
    [ZC_EFFECT_BEHAVIOR_KEYS.legacyDash]: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
    [ZC_EFFECT_BEHAVIOR_KEYS.windBolt]: [
        ZC_EFFECT_PATHS.clownDart, ZC_EFFECT_PATHS.windHurricane,
        ZC_EFFECT_PATHS.missileBody, ZC_EFFECT_PATHS.missileImpact,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.missileBarrage]: [
        ZC_EFFECT_PATHS.clownDart, ZC_EFFECT_PATHS.windHurricane,
        ZC_EFFECT_PATHS.missileBody, ZC_EFFECT_PATHS.missileImpact,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.stormZone]: [ZC_EFFECT_PATHS.windHurricane],
    [ZC_EFFECT_BEHAVIOR_KEYS.rayBeam]: [ZC_EFFECT_PATHS.lightningImpact],
};

test('预热路径保持改造前的 29 条集合与顺序', () => {
    assert.deepEqual(buildZCBattleWarmupPaths([], [], []), EXPECTED_WARMUP);
});

test('目录 warmup 子集只含行为技能新增的 9 条，不把按需资源塞进首包', () => {
    assert.deepEqual(zcWarmupEffectPaths(), [
        ZC_EFFECT_PATHS.missileBody,
        ZC_EFFECT_PATHS.missileImpact,
        ZC_EFFECT_PATHS.splashMissile,
        ZC_EFFECT_PATHS.burstImpact,
        ZC_EFFECT_PATHS.singleStrike,
        ZC_EFFECT_PATHS.chargeDash,
        ZC_EFFECT_PATHS.dashGuard,
        ZC_EFFECT_PATHS.clownDart,
        ZC_EFFECT_PATHS.windHurricane,
    ]);
});

test('每个 behaviorKey 的路径组与改造前逐项一致', () => {
    assert.equal(ZC_EFFECT_BEHAVIOR_SPECS.length, Object.keys(EXPECTED_BEHAVIOR_PATHS).length);
    for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
        const expected = EXPECTED_BEHAVIOR_PATHS[spec.behaviorKey];
        assert.ok(expected, `目录出现未登记期望的行为键 ${spec.behaviorKey}`);
        assert.deepEqual(zcEffectPathsForBehavior(spec.behaviorKey), expected, spec.behaviorKey);
        assert.deepEqual(spec.prefabPaths, expected, `${spec.behaviorKey} 的目录值与期望不一致`);
    }
});

test('self_aura 按单位覆盖，未登记单位回落默认光柱', () => {
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, '68025'), [
        ZC_EFFECT_PATHS.selfAuraFlame,
    ]);
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, '68016'), [
        ZC_EFFECT_PATHS.lightningImpact,
    ]);
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, '68026'), [
        ZC_EFFECT_PATHS.selfAuraFire,
    ]);
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, '68099'), [
        ZC_EFFECT_PATHS.sustainedAura,
    ]);
});

test('追踪导弹只在按单位表里登记 68010 的弹体 / 命中', () => {
    assert.deepEqual(zcEffectMissilePathsForUnit('68010'), [
        ZC_EFFECT_PATHS.missileBody, ZC_EFFECT_PATHS.missileImpact,
    ]);
    assert.deepEqual(zcEffectMissilePathsForUnit('68013'), []);
});

test('68013 同时带 wind_bolt 与 missile_barrage 时只收四条唯一路径', () => {
    const wind = zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.windBolt);
    const barrage = zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.missileBarrage);
    assert.deepEqual([...new Set([...wind, ...barrage])], [
        ZC_EFFECT_PATHS.clownDart, ZC_EFFECT_PATHS.windHurricane,
        ZC_EFFECT_PATHS.missileBody, ZC_EFFECT_PATHS.missileImpact,
    ]);
});

test('Fx facade 文件不再自带路径字面量，路径统一由目录提供', () => {
    const files = readdirSync(FX_DIRECTORY).filter(file => file.startsWith('ZC') && file.endsWith('Fx.ts'));
    assert.ok(files.length >= 14, `Fx facade 数量异常：${files.length}`);
    for (const file of files) {
        const source = readFileSync(join(FX_DIRECTORY, file), 'utf8');
        assert.equal(source.includes('units/projectiles/'), false, `${file} 仍写死特效路径`);
        assert.equal(source.includes('units/effects/'), false, `${file} 仍写死受击/出生特效路径`);
    }
});
