import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_EFFECT_BEAM_SPECS,
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_BEHAVIOR_SPECS,
    ZC_EFFECT_PATHS,
    ZC_EFFECT_TRAIL_SPECS,
    zcEffectMissilePathsForUnit,
    zcEffectPathsForBehavior,
    zcWarmupEffectPaths,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { buildZCBattleWarmupPaths } from '../assets/script/app/zcds/model/ZCGameResourcePlan';

const ROOT = join(__dirname, '..');
const FX_DIRECTORY = join(ROOT, 'assets/script/app/zcds/model');

/** 旧实现的手工预热顺序（`buildZCBattleWarmupPaths([],[],[])` 含击杀横栏实测 30 条）。*/
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
    'ui/game/ZCGameKillBanner',
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

/** 改造前 `ZCEffectCatalog` 各语义键对应的字面量路径（快照，不跟着实现改）。*/
const PATH_LITERALS = {
    stormEgg: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
    missileImpact: 'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中',
    missileBody: 'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能',
    windHurricane: 'units/projectiles/风法师_龙卷风/风法师_龙卷风',
    deerGuard: 'units/projectiles/鹿神守护/鹿神守护',
    bigFist: 'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效',
    sustainedAura: 'units/projectiles/持续光环伤害效果/持续光环伤害效果',
    lightningBullet: 'units/projectiles/雷弹攻击/雷弹攻击',
    // 2026-11-20：30231 的命中爆点（68016 / 68022 共用），单独挂 nodeScale 0.5。
    thunderBulletImpact: 'units/projectiles/雷弹命中/雷弹命中',
    // 2026-11-20 同轮：30717 的命中爆点（68008 杰克藕），同一口径 0.5。
    cidianBulletImpact: 'units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中',
    chargeDash: 'units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋',
    dashGuard: 'units/projectiles/刀盾兵_护盾/刀盾兵_护盾',
    nutAttack: 'units/projectiles/巨力坚果_普攻/巨力坚果_普攻',
    yulinDart: 'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻',
    yulinDartEmpowered: 'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化',
    clownDart: 'units/projectiles/三叶小丑_普攻/三叶小丑_普攻',
    axeBlade: 'units/projectiles/斧盾兵_反击气刃/斧盾兵_反击气刃',
    boxerStrike: 'units/projectiles/消灭学霸_普攻/消灭学霸_普攻',
    laserAttack: 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻',
    blink: 'units/projectiles/瞬间移动特效/瞬间移动特效',
    bolt: 'units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能',
    // 2026-11-19 第 23 批：闪电链换【闪电链水墨风】，与落雷分家（快照里也补上这一条）。
    chainArc: 'units/projectiles/闪电链水墨风/闪电链水墨风',
    burstImpact: 'units/projectiles/普攻爆炸/普攻爆炸',
    singleStrike: 'units/projectiles/长戟兵_撕裂/长戟兵_撕裂',
    splashMissile: 'units/projectiles/子弹_新怪物/通用箭矢',
    trapSpawn: 'units/projectiles/科学家_陷阱/科学家_陷阱_出现',
    trapIdle: 'units/projectiles/科学家_陷阱/科学家_陷阱',
    trapExpire: 'units/projectiles/科学家_陷阱爆炸/科学家_陷阱爆炸',
    selfAuraFlame: 'units/projectiles/大威天芦_火焰光环/大威天芦_火焰光环',
    lightningImpact: 'units/projectiles/雷电冲击/雷电冲击',
    selfAuraFire: 'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰',
    // 2026-11-20 第 33 批：101404 分裂菇的「生成分身」爆点（散帧序列，见 build_fission_spawn_fx.py）。
    fissionSpawn: 'units/projectiles/分裂菇_生成分身/分裂菇_生成分身',
    // 2026-11-23 第 42 批：仙桃行者 68009 的「重击」落地柱（大地之力 100904 首目标 + 武将技 36241）。
    // 散帧序列，见 tools/build_xiantao_quake_fx.py；锚点/层在 ZCEffectCatalog 里按路径覆盖。
    quakeStrike: 'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能',
    // 2026-11-23 第 42 批续：仙桃行者 68009 的**普通攻击**造型。
    // 🔴 用户纠正口径后的值：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」。
    // 它只作为路径常量流通（`pvpSkill 30718` 的 `effectPrefabPath`），目录里**没有 spec** ——
    // 锚点/层/尺寸/寿命全是兜底默认值，与长枪兵行 30171 逐字一致。
    spearSlash: 'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光',
    // 2026-11-23 第 43 批：文明之火（103503 改造）直接复用灼热地带那张图。
    // 同一个路径被火焰树妖 68003 自己的灼热地带（30811）用着 ⇒ 蓝色只能按事件染，
    // 目录里**不登记** tint（否则 68003 也会变蓝）。
    hotZone: 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能',
    iceCone: 'units/projectiles/冰法师_冰锥/冰法师_冰锥',
} as const;

/** 行为键 → 目录给出的路径；与改造前每个 `ZC*Fx` 模块的输出逐项一致。*/
const EXPECTED_BEHAVIOR_PATHS: Readonly<Record<string, readonly string[]>> = {
    [ZC_EFFECT_BEHAVIOR_KEYS.blinkStrike]: [PATH_LITERALS.blink],
    [ZC_EFFECT_BEHAVIOR_KEYS.boltStrike]: [PATH_LITERALS.bolt],
    [ZC_EFFECT_BEHAVIOR_KEYS.chainDamage]: [PATH_LITERALS.chainArc],
    [ZC_EFFECT_BEHAVIOR_KEYS.selfAura]: [PATH_LITERALS.sustainedAura],
    //  2026-11-19 蘑菇爆炸 101704：炸开的 prefab 按单位换成了通用爆点
    //  （`ZCTrapFx.ZC_TRAP_EXPIRE_PREFAB_BY_UNIT`）⇒ 清单多收一条 `burstImpact`。
    [ZC_EFFECT_BEHAVIOR_KEYS.trapPlace]: [
        PATH_LITERALS.trapSpawn, PATH_LITERALS.trapIdle, PATH_LITERALS.trapExpire,
        PATH_LITERALS.burstImpact,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.splashShot]: [PATH_LITERALS.splashMissile, PATH_LITERALS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst]: [PATH_LITERALS.splashMissile, PATH_LITERALS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.burstAura]: [PATH_LITERALS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.burstKnockback]: [PATH_LITERALS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.fanSlow]: [PATH_LITERALS.burstImpact],
    [ZC_EFFECT_BEHAVIOR_KEYS.singleStrike]: [PATH_LITERALS.singleStrike],
    [ZC_EFFECT_BEHAVIOR_KEYS.chargeShield]: [PATH_LITERALS.chargeDash, PATH_LITERALS.dashGuard],
    [ZC_EFFECT_BEHAVIOR_KEYS.legacyDash]: [PATH_LITERALS.chargeDash, PATH_LITERALS.dashGuard],
    [ZC_EFFECT_BEHAVIOR_KEYS.windBolt]: [
        PATH_LITERALS.clownDart, PATH_LITERALS.windHurricane,
        PATH_LITERALS.missileBody, PATH_LITERALS.missileImpact,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.missileBarrage]: [
        PATH_LITERALS.clownDart, PATH_LITERALS.windHurricane,
        PATH_LITERALS.missileBody, PATH_LITERALS.missileImpact,
    ],
    [ZC_EFFECT_BEHAVIOR_KEYS.stormZone]: [PATH_LITERALS.windHurricane],
    //  2026-11-23 第 43 批换图：射线集束要「和镭射飞龙普攻颜色一致」（用户口径），
    //  原来那张【雷电冲击】是青蓝、镭射飞龙是正红，乘算做不到 ⇒ 直接用同一张红图。
    [ZC_EFFECT_BEHAVIOR_KEYS.rayBeam]: [PATH_LITERALS.laserAttack],
    //  文明之火（103503 改造）：目标点周围撒 3 块火焰区域，图同灼热地带。
    [ZC_EFFECT_BEHAVIOR_KEYS.fireZone]: [PATH_LITERALS.hotZone],
    //  2026-11-20 第 33 批：召唤（`summon_unit`）的分身生成爆点。
    //  第 34 批追加「舞王脚底持续光环」（借用 self_aura 那份 prefab，但那条车道只覆盖
    //  self_aura 自己的单位，召唤这一组必须自己再收一次）。
    //  不进预热（`warmup` 未标）⇒ 本局没有分裂菇 / 艺术家就不下这些资源。
    [ZC_EFFECT_BEHAVIOR_KEYS.summonUnit]: [PATH_LITERALS.fissionSpawn, PATH_LITERALS.sustainedAura],
    //  2026-11-21 第 37 批：`skill_params`（只带数据的参数袋车道）本身没有造型，但巨力坚果 68002
    //  的「亡者护盾」挂在这条车道上 ⇒ 按单位覆盖补收 `刀盾兵_护盾`。公共清单仍是空，
    //  其余卡在这条车道一个资源都不多收。
    [ZC_EFFECT_BEHAVIOR_KEYS.skillParams]: [],
    //  2026-11-21 第 38 批：`self_cast`（冷却型自身施法）同样没造型槽。波利奥 68006 的
    //  「吃口菠萝」100603 是群体治疗，视觉上要给半径内每个己方单位挂一圈刀盾兵_护盾 ⇒
    //  按单位覆盖补收。嗜血 100703 / 迅击 100903 同车道但零资源。
    [ZC_EFFECT_BEHAVIOR_KEYS.selfCast]: [],
};

test('路径语义键的字面量保持改造前快照', () => {
    assert.deepEqual(ZC_EFFECT_PATHS, PATH_LITERALS);
});

test('预热路径保持 30 条集合与顺序（含击杀横栏）', () => {
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

test('弹道拖尾与光束数值仍与改造前逐项一致', () => {
    assert.deepEqual(ZC_EFFECT_TRAIL_SPECS[ZC_EFFECT_PATHS.missileBody], {
        startX: -26, length: 100, rootHalfWidth: 20, tipHalfWidth: 2,
        slices: 12, color: [255, 255, 255], alpha: 0.62,
    });
    //  2026-11-19 第二轮：用户「三角形拖尾要保留」⇒ 恢复登记；宿主 0.35，本地值 = 屏上 ÷ 0.35。
    assert.deepEqual(ZC_EFFECT_TRAIL_SPECS[ZC_EFFECT_PATHS.lightningBullet], {
        startX: -57.142857, length: 157.142857,
        rootHalfWidth: 22.857143, tipHalfWidth: 2.857143,
        slices: 12, color: [255, 255, 255], alpha: 0.6,
    });
    assert.deepEqual(ZC_EFFECT_BEAM_SPECS[ZC_EFFECT_PATHS.laserAttack], {
        muzzleForward: 8, muzzleLift: 44,
        contentStart: 72 / 700, contentEnd: 628 / 700,
        widthScale: 0.8, coreWidth: 10, tailLift: 30,
        widthMultiplierBySkill: { 30845: 1.3 },
        overShootBySkill: { 30845: 1620 },
    });
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
