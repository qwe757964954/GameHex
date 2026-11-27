import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText, ZCProjectileState, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { resolveUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZC_EFFECT_PATHS, ZC_EFFECT_SPECS, zcEffectAnchorOf } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from '../assets/script/app/zcds/model/ZCEffectTuning';
import {
    ZC_EMPOWERED_FX_OVERRIDES, ZC_QUAKE_STRIKE_PREFAB_PATH, ZC_QUAKE_STRIKE_SECONDS,
    pushQuakeStrikeVisualEvent, zcEmpoweredFxOverrideOf,
} from '../assets/script/app/zcds/model/ZCQuakeFx';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 42 批 · 仙桃行者 68009「大地之力」首目标重击 + 重骑兵武将技换图（2026-11-23）。
 *
 * 🔴 2026-11-24 第 44 批：100904 已被用户整条换成「腾云驾雾」（`dash_chain` 四段突进连击），
 *    真实配表里**不再有** `quakeFirstRate` / `quakeRadius` —— 所以 ①② 改成钉新口径，
 *    而 ⑧~⑬ 退化成 `TIER1_PARAMS` **纯行为夹具**：它们守的是「重击柱那条判定链的算法」
 *    （首目标倍率只在强化那一击生效、落点圆不含首目标），那条代码还在，谁来配都还是这套规矩。
 *
 * 用户原话：
 *  1. 「大地之力新增效果，第一个被攻击的目标受到 300%/370%/450% 的伤害，并在该目标位置播放
 *     【仙桃行者_重击技能】特效，特效落点的圆圈内所有敌人受到第一个目标一致的伤害，
 *     其他的效果保持不变」；
 *  2. 「所有使用了【重骑兵_武将技能的】统一更换为【仙桃行者_重击技能】特效，
 *     并且该特效的释放一定是在目标的坐标位置播放」。
 *
 * 这一批有四个「照字面配就会静默出错」的点，正是本文件要钉住的：
 *
 *  1. **`quakeFirstRate` 只在强化那一击生效**。计划行按 `${unitId}:${pvpSkillId}` 合并成一袋，
 *     68009 的普攻（30718）与大地之力（30844 走同一份参数袋）共用它 —— 不设 `empowered` 闸门
 *     就等于把这张卡**每一次普攻**都变成 300%。与 `pierceCount` 同一个坑。
 *  2. **判定圆里不含首目标**。首目标刚吃完 300% 的直击，再进一次落点圆就是 600%。
 *     所以落点圆刻意与「凤凰降临」的 `burstRadius`（含主目标）分成两套键。
 *  3. **「第一个被攻击的目标」= 这颗弹道命中的第一个单位**，判据是 `hitUnitIds` 为空
 *     （`ZCProjectileSystem` 在 `context.hit()` 之后才记 id）。顺手蹭到的**城墙 / 建筑不算**。
 *  4. **武将技行自带的美术默认不播**（2026-11-19 定案 A：强化那一击一律借普攻行的图）。
 *     所以 36241 换图必须走 `ZC_EMPOWERED_FX_OVERRIDES` 名单，光改 `pvpSkill` 那一格是**看不出效果**的。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const ROOT = process.cwd();
const CLIENT_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClient(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`${CLIENT_DIR}/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { data: Array<Record<string, unknown>> };
    return Array.isArray(source) ? source : source.data;
}

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

// ────────────────────────────────────────────── 一、配表真值（两份产物都要对）

/**
 * 腾云驾雾 100904 的三档（2026-11-24 第 44 批起）：车道换成 `dash_chain`，
 * 参数就是「四段突进」那一套，不再是旧机制那三个 `quake*` 键。
 *
 * 旧口径（2026-11-23 第 42 批）是「穿透冲击波 + 首目标 300% 重击 + 落点圆」，
 * 本批整条被用户换掉：「以150px速度突进到目标1身前 攻击1次，以目标1为圆心 200px为半径，
 * 内索取额外3个目标（合计4人），依次突进到这些目标身前攻击1次……再回到目标1的位置」。
 * ⇒ 四个旧键（`damageRate` / `pierceCount` / `quakeFirstRate` / `quakeRadius`）整批退场，
 * 下面 ⑧~⑬ 那几条改打**纯行为夹具**（`TIER1_PARAMS`），继续守着重击柱那条判定链的算法。
 */
const DASH_TIERS: Array<{ level: number; modifierId: number; rate: number }> = [
    { level: 1, modifierId: 94009041, rate: 3.5 },
    { level: 2, modifierId: 94009042, rate: 4.1 },
    { level: 3, modifierId: 94009043, rate: 4.8 },
];

const DASH_SPEED = 150;
const DASH_SPREAD_RADIUS = 200;
const DASH_COUNT = 4;
const DASH_STOP_DISTANCE = 30;
const DASH_HIT_RADIUS = 40;

/** 落点圆半径（逻辑 px）：仍是重击柱那圈地面裂纹的口径，⑧ 那几条纯行为夹具还在用它。*/
const QUAKE_RADIUS_LOGICAL = 54;

test('① 腾云驾雾 100904 三档：车道 dash_chain，速度 150 / 半径 200 / 4 段 / 350·410·480%', () => {
    prepare();
    //  两份产物都要读：远程（`assets/remoteRef`）与客户端（`doc/.../client`）平时各自被外部进程覆盖，
    //  只改一份就会「编辑器里对、真机不对」。
    const sources: Array<[string, Array<Record<string, unknown>>]> = [
        ['remoteRef', readRows('pvpSkillPlan')],
        ['client', readClient('pvpSkillPlan')],
    ];
    for (const [label, rows] of sources) {
        for (const tier of DASH_TIERS) {
            const row = rows.find((entry) => Number(entry.modifierId) === tier.modifierId);
            assert.ok(row, `${label} 缺 pvpSkillPlan ${tier.modifierId}`);
            assert.equal(Number(row!.skillChainId), 100904, `${label} ${tier.modifierId} 链号漂了`);
            assert.equal(String(row!.unitId), '68009', `${label} ${tier.modifierId} 不是仙桃行者`);
            assert.equal(Number(row!.skillLevel), tier.level);
            assert.equal(row!.skillName, '腾云驾雾', `${label} L${tier.level} 名字没改`);
            //  🔴 车道必须真的换成 `dash_chain`：`skill_params` 是「没有自己的行为、只带数据」的
            //  袋子，留着它 = 新增的 `applyDashChain` 一次都不会被调（那才是「改了没效果」）。
            assert.equal(row!.behaviorKey, 'dash_chain', `${label} L${tier.level} 车道没换`);
            //  这条车道没有冷却也没有累计计数 ⇒ 两格都必须是 0 / 空。
            assert.equal(row!.stateMode, 'none');
            const params = JSON.parse(String(row!.skillParamJson)) as Record<string, number>;
            assert.equal(params.dashChainSpeed, DASH_SPEED,
                `${label} L${tier.level} 突进速度应为表值 ${DASH_SPEED}`);
            assert.equal(params.dashChainSpreadRadius, DASH_SPREAD_RADIUS,
                `${label} L${tier.level} 索取半径应为 ${DASH_SPREAD_RADIUS}`);
            assert.equal(params.dashChainCount, DASH_COUNT,
                `${label} L${tier.level} 合计应打 ${DASH_COUNT} 人`);
            assert.equal(params.dashChainStopDistance, DASH_STOP_DISTANCE);
            assert.equal(params.dashChainHitRadius, DASH_HIT_RADIUS);
            assert.equal(params.dashChainDamageRate, tier.rate,
                `${label} L${tier.level} 倍率应为 ${tier.rate}`);
            //  旧机制的四个键一个都不许留：留着 `quakeFirstRate` 就是「同一击两条判定」。
            for (const stale of ['damageRate', 'pierceCount', 'quakeFirstRate', 'quakeRadius']) {
                assert.equal(params[stale], undefined,
                    `${label} L${tier.level} 旧键 ${stale} 还在（旧机制没清干净）`);
            }
            //  描述两处都要说人话：卡牌 UI 真读的是 `armySkillLevelUp.desc`，这里是技能面板那份。
            assert.match(String(row!.desc), /突进/, `${label} L${tier.level} desc 没写突进`);
            assert.match(String(row!.desc), /重击特效/, `${label} L${tier.level} desc 没写重击特效`);
            assert.ok(String(row!.desc).includes(`${Math.round(tier.rate * 100)}%`),
                `${label} L${tier.level} desc 里没有 ${Math.round(tier.rate * 100)}%`);
        }
    }
});

test('② armySkillLevelUp 100904 三档同样改名 / 改描述（卡牌 UI 真读这一份）', () => {
    prepare();
    for (const [label, rows] of [
        ['remoteRef', readRows('armySkillLevelUp')],
        ['client', readClient('armySkillLevelUp')],
    ] as Array<[string, Array<Record<string, unknown>>]>) {
        const tiers = rows.filter((row) => Number(row.id) === 100904)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(tiers.length, 3, `${label} 100904 应有三档`);
        for (const [index, row] of tiers.entries()) {
            assert.equal(row.name, '腾云驾雾');
            assert.match(String(row.desc), /突进/, `${label} L${row.skilllevel} 描述缺「突进」`);
            assert.match(String(row.desc), /重击特效/, `${label} L${row.skilllevel} 描述缺「重击特效」`);
            const expected = `${Math.round(DASH_TIERS[index].rate * 100)}%`;
            assert.ok(String(row.desc).includes(expected),
                `${label} L${row.skilllevel} 描述里没有 ${expected}`);
        }
    }
});

test('③ 重骑兵武将技 36241 换成重击柱；全表再没有任何一行指向【重骑兵_武将技能】', () => {
    prepare();
    for (const [label, rows] of [
        ['remoteRef', readRows('pvpSkill')],
        ['client', readClient('pvpSkill')],
    ] as Array<[string, Array<Record<string, unknown>>]>) {
        const row = rows.find((entry) => Number(entry.skillId) === 36241);
        assert.ok(row, `${label} 缺 pvpSkill 36241`);
        assert.equal(row!.name, '重骑兵武将技');
        assert.equal(row!.effectPrefabPath, ZC_QUAKE_STRIKE_PREFAB_PATH,
            `${label} 36241 还在用旧图`);
        //  「所有使用了【重骑兵_武将技能的】统一更换」= 全表清零，不留尾巴。
        const leftovers = rows.filter((entry) => String(entry.effectPrefabPath ?? '').includes('重骑兵_武将技能'));
        assert.deepEqual(leftovers.map((entry) => entry.skillId), [],
            `${label} 仍有行指向【重骑兵_武将技能】`);
    }
});

test('④ 表现资源：仙桃行者 / 重骑兵两队都能收到重击柱，其他队收不到', () => {
    //  走行为键 `skill_params`（大地之力挂在这条车道）与 `empoweredProfile.effectPrefabPath`（36241）两条路。
    const unit = (unitId: string, empoweredPath: string | null = null) => ({
        unitId,
        prefabPath: '',
        attackProfile: { effectPrefabPath: 'units/projectiles/普攻/普攻', impactEffectPrefabPath: null },
        empoweredProfile: { effectPrefabPath: empoweredPath, impactEffectPrefabPath: null },
    });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const adapters = (plans: Array<{ enabled: boolean; unitId: string; behaviorKey: string }>) => ({
        skillPlans: plans, textOverrides: new Map(),
    });

    const withXiantao = buildZCVisualResourcePlan(
        [unit('68009')], adapters([plan('68009', 'skill_params')]));
    assert.ok(withXiantao.effectPaths.includes(ZC_QUAKE_STRIKE_PREFAB_PATH),
        '68009 的重击柱没进本局加载清单（编辑器里有、实战里一次不播）');

    //  重骑兵 68015：普攻行 30241 的 `empoweredSkillId = 36241`，走 `empoweredProfile` 那条路。
    const withHeavyCavalry = buildZCVisualResourcePlan(
        [unit('68015', ZC_QUAKE_STRIKE_PREFAB_PATH)], adapters([plan('68015', 'skill_params')]));
    assert.ok(withHeavyCavalry.effectPaths.includes(ZC_QUAKE_STRIKE_PREFAB_PATH),
        '68015 的强化那一击要播它，就必须在加载清单里');

    //  别的卡不许被顺手带上（否则等于给所有队多下一份 29 帧散图）。
    const without = buildZCVisualResourcePlan([unit('68001')], adapters([plan('68001', 'skill_params')]));
    assert.equal(without.effectPaths.includes(ZC_QUAKE_STRIKE_PREFAB_PATH), false);

    //  普攻那张刀光走另一条路：`attackProfile.effectPrefabPath`（真表里 30718 就是它）。
    //  这里用**真定义**跑一遍，把「配表 → 定义 → 本局清单」串起来：
    //  配表填了但清单没收到 = 编辑器里看得见、实战里一片空白。
    const real = resolveUnitDefinition('68009');
    assert.equal(real.attackProfile.effectPrefabPath, ZC_EFFECT_PATHS.spearSlash,
        '真表 30718 的普攻造型不是「长枪兵普攻_刀光」（配表没生效或被外部覆盖）');
    const withSpear = buildZCVisualResourcePlan([real], adapters([plan('68009', 'skill_params')]));
    assert.ok(withSpear.effectPaths.includes(ZC_EFFECT_PATHS.spearSlash),
        '68009 的普攻刀光没进本局加载清单');
    assert.ok(withSpear.effectPaths.includes(ZC_QUAKE_STRIKE_PREFAB_PATH),
        '68009 的重击柱也要在清单里（强化那一击）');
});

// ────────────────────────────────────────────── 二、表现登记

test('⑤ 重击柱登记：target 锚点（落在目标坐标）+ 落点即圆心，且不进目录的 nodeScale', () => {
    assert.equal(ZC_QUAKE_STRIKE_PREFAB_PATH, ZC_EFFECT_PATHS.quakeStrike);
    assert.equal(zcEffectAnchorOf(ZC_QUAKE_STRIKE_PREFAB_PATH), 'target');
    const spec = ZC_EFFECT_SPECS.find((entry) => entry.prefabPath === ZC_QUAKE_STRIKE_PREFAB_PATH);
    assert.ok(spec, '目录里没有重击柱');
    assert.equal(spec!.layer, 'top', '这根柱子是「打在空中的一下」，不能被 area 默认压回地面');
    assert.equal(spec!.nodeScale, undefined,
        '尺寸只认 prefab 烘焙那一份 —— 目录再写一次就是两个真源');

    //  时长必须等于 clip 长度：29 帧 ÷ 24fps。短一截就被事件寿命截断在半路。
    assert.equal(ZC_QUAKE_STRIKE_SECONDS, 29 / 24);
    assert.equal(ZC_EFFECT_TUNING.quakeStrikeSeconds, ZC_QUAKE_STRIKE_SECONDS);

    //  prefab 落点：那圈地面裂纹的中心不在画布中心，`_lpos.y` 就是把它挪到脚下的补偿。
    const prefab = JSON.parse(readFileSync(
        assetPath('units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能.prefab'), 'utf8',
    )) as Array<Record<string, any>>;
    //  两级节点：根只做容器，落点补偿挂在 `offset` 子节点上（生成脚本的固定骨架）。
    const root = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._parent === null);
    assert.ok(root, 'prefab 要有根节点');
    const offset = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'offset');
    assert.ok(offset, 'prefab 要有 offset 子节点（美术居中补偿就挂在这里）');
    //  尺寸全烘进画布（144×321）⇒ 根与 offset 都不留缩放，两个真源会互相打架。
    assert.deepEqual([root!._lscale.x, root!._lscale.y], [1, 1],
        `根节点不该再有缩放，实际 ${root!._lscale.x}`);
    assert.ok(Math.abs(offset!._lscale.x - 1) < 1e-9,
        `offset 缩放应为 1（尺寸在画布里），实际 ${offset!._lscale.x}`);
    assert.ok(Math.abs(offset!._lpos.y - 116.92) < 0.01,
        `offset 的 y 偏移应为 116.92（144×321 画布里那圈裂纹的中心），实际 ${offset!._lpos.y}`);
    const size = prefab.find((entry) => entry.__type__ === 'cc.UITransform');
    assert.deepEqual([size!._contentSize.width, size!._contentSize.height], [144, 321],
        '内容尺寸应与烘焙画布一致');
});

test('⑥ 名单覆盖：36241 → 重击柱；30844 登记为「不播」；没登记的一律回落（定案 A 口径不变）', () => {
    assert.equal(ZC_EMPOWERED_FX_OVERRIDES[36241], ZC_QUAKE_STRIKE_PREFAB_PATH);
    assert.equal(zcEmpoweredFxOverrideOf(36241), ZC_QUAKE_STRIKE_PREFAB_PATH);
    //  🔴 `null` 与「没登记」是两件事：`null` = 明确不播（30844 换了形态，表现交给重击柱），
    //  `undefined` = 照旧借普攻行的图。用 `??` 把两者合并会让「拖着地面枪阵飞」这个 bug 回来。
    //  第 44 批之后这一击连弹道都不出了（`prepareAttack` 见到 `dashChainSpeed` 就 return null），
    //  但名单里的 `null` 必须留着：它是「这张卡的强化那一击不借普攻图」的唯一声明处。
    assert.equal(ZC_EMPOWERED_FX_OVERRIDES[30844], null, '腾云驾雾（原大地之力）必须显式登记为不播');
    assert.equal(zcEmpoweredFxOverrideOf(30844), null);
    for (const other of [30241, 36221, 36216, 36171, 0, undefined, null]) {
        assert.equal(zcEmpoweredFxOverrideOf(other), undefined, `「${other}」不该被名单命中`);
    }
    //  名单制的意义：`pvpSkill` 全表 36xxx 行都自带美术，放开就是回退到定案 A 之前。
    const rows = readRows('pvpSkill');
    const empoweredRows = rows.filter((row) => Number(row.skillId) >= 36000 && row.effectPrefabPath);
    assert.ok(empoweredRows.length > 5, '武将技行自带美术是普遍现象，名单必须保持很小');
    assert.deepEqual(Object.keys(ZC_EMPOWERED_FX_OVERRIDES).sort(), ['30844', '36241']);
});

test('⑦ 快照白名单：quakeDamage / quakeRadius / quakeEffectSeconds 必须能存能读', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['quakeDamage', 'quakeRadius', 'quakeEffectSeconds']) {
        assert.match(codec, new RegExp(`projectile\\.${key}`),
            `ZCSnapshotCodec 字段白名单缺 ${key}（不还原 = 读档后这一步变成普通直击）`);
    }
});

// ────────────────────────────────────────────── 三、出手：三个键只在强化那一击出现

const XIANTAO_ATTACK = 30718;
const XIANTAO_EMPOWERED = 30844;

const DEFINITION = {
    unitId: '68009', name: '仙桃行者', maxHp: 1200, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: true, prefabPath: '', prefabSize: 1,
    attackProfile: {
        //  真表：30718 仙桃行者普攻 = 近战、每 5 次普攻触发一次强化。
        skillId: XIANTAO_ATTACK, name: '仙桃行者普攻', mode: 'melee',
        areaRadius: 0, damageRate: 1, trigger: 'every_n_attacks',
        empoweredEvery: 5, empoweredSkillId: XIANTAO_EMPOWERED, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
        //  真表 30718 的值（2026-11-23 起）：普通攻击播「长枪兵普攻_刀光」。
        effectPrefabPath: ZC_EFFECT_PATHS.spearSlash,
        impactEffectPrefabPath: null,
    } satisfies ZCAttackProfile,
    //  真表：30844 = 强化那一击的武将技行（第 44 批起名字是「腾云驾雾」）。
    //  🔴 `mode` 仍是 `projectile`：新机制在 `prepareAttack` 里就 `return null` 了，这条弹道
    //  分支不会执行；本文件 ⑧~⑬ 的夹具就是要让它照旧跑一遍（那套算法没删）。
    empoweredProfile: {
        skillId: XIANTAO_EMPOWERED, name: '腾云驾雾', mode: 'projectile',
        projectileSpeed: 800, areaRadius: 0, damageRate: 1, empoweredEvery: 0,
        empoweredSkillId: 0, secondarySkillId: 0, durationSeconds: 0, waves: 1,
        legacyEffectKeys: [], effectPrefabPath: 'units/projectiles/重骑兵_践踏/重骑兵_践踏',
        impactEffectPrefabPath: null,
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function makeUnit(id: number, owner: ZCOwner, x: number, unitId = '68009'): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

interface IHarness {
    context: IZCAttackResolutionContext;
    pushed: ZCProjectileState[];
    hits: Array<{ unitId: number; damage: number }>;
}

function attackContext(
    units: ZCUnitState[],
    params: Record<string, number> | null,
    target: { id: number; x: number; y: number } | null,
): IHarness {
    const pushed: ZCProjectileState[] = [];
    const hits: Array<{ unitId: number; damage: number }> = [];
    const runtime = params
        ? ({
            //  🔴 夹具，不是真表：真表里 100904 第 44 批已改成 `dash_chain`。
            //  这里故意还用 `skill_params` —— ⑧~⑬ 守的是重击柱判定链本身。
            skillChainId: 100904, behaviorKey: 'skill_params', trigger: 'none', stateMode: 'none',
            parameters: { ...params },
        } as unknown as ZCSkillRuntimeDefinition)
        : null;
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => 0 } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (unit: ZCUnitState, damage: number) => {
            hits.push({ unitId: unit.id, damage: Math.round(damage) });
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            //  🔴 键是 `${unitId}:${普攻 skillId}` —— 大地之力的参数袋挂在**普攻行** 30718 上。
            [ZCOwner.Player]: new Map([[`68009:${XIANTAO_ATTACK}`, runtime]]),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => (target
            ? { kind: 'unit', id: target.id, x: target.x, y: target.y, bodyRadius: 24, cardId: '68001' }
            : null),
        evaluateLegacySkill: () => ({
            buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0,
        }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        //  候选一律给全集：落点圆的过滤在 `resolveProjectileHit` 里按真实距离做，
        //  这里再筛一次等于替被测代码挡子弹（会漏掉「圆心算错」这类错）。
        unitsInRadius: () => units,
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: (projectile: ZCProjectileState) => { pushed.push(projectile); },
    } as unknown as IZCAttackResolutionContext;
    return { context, pushed, hits };
}

/** 纯行为夹具（2026-11-24 第 44 批起不再是真表数值）：旧「大地之力 I 级」那四个键。*/
const TIER1_PARAMS = { damageRate: 1.2, pierceCount: 99, quakeFirstRate: 3, quakeRadius: QUAKE_RADIUS_LOGICAL };

test('⑧ 强化那一击的弹道：quakeDamage=300（不含克制）/ quakeRadius=54×0.3 / 时长 29÷24', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context } = attackContext(units, TIER1_PARAMS, { id: enemy.id, x: 40, y: 0 });
    //  第 5 次普攻 = 强化那一击（`completedAttackCount` 在消费时自增到 5）。
    caster.completedAttackCount = 4;

    ZCAttackResolutionSystem.sendAttack(state, caster, context);
    assert.equal(state.projectiles.length, 1, '强化那一击应射出一枚波动弹');
    const projectile = state.projectiles[0];
    //  面板 100 × 大地之力 120% = 120（其余穿透目标仍吃这一份）。
    assert.equal(projectile.baseDamage, 120);
    //  首目标基数 = 面板 100 × 300%，不含克制、不含暴击（克制是逐个受击者算的）。
    assert.equal(projectile.quakeDamage, 300);
    assert.ok(Math.abs((projectile.quakeRadius ?? 0) - QUAKE_RADIUS_LOGICAL * 0.3) < 1e-9,
        `落点圆半径应 = ${QUAKE_RADIUS_LOGICAL} × 0.3 世界 px，实际 ${projectile.quakeRadius}`);
    assert.ok(Math.abs((projectile.quakeEffectSeconds ?? 0) - ZC_QUAKE_STRIKE_SECONDS) < 1e-9);
    //  🔴 强化那一击**不许拖普攻那张地面枪阵**：它换了形态（近战 → 弹道），
    //  表现由落点重击柱负责（`ZC_EMPOWERED_FX_OVERRIDES[30844] = null`）。
    assert.equal(projectile.effectPrefabPath, null,
        '强化那一击的弹道又拖上了普攻贴图（地面枪阵会跟着飞，再叠一根柱子）');
    assert.equal(projectile.effectScale, undefined, '名单登记为不播时不该再挂尺寸倍率');
});

test('⑨ 普通普攻：播「长枪兵普攻_刀光」（贴出手点、走兜底）、不吃 quake 三键', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context } = attackContext(units, TIER1_PARAMS, { id: enemy.id, x: 40, y: 0 });
    caster.completedAttackCount = 0;   // 第 1 次普攻：不强化

    ZCAttackResolutionSystem.sendAttack(state, caster, context);
    //  普攻行是近战 ⇒ 不产生弹道；「没有这几个键」这件事只能从事件上看。
    assert.equal(state.projectiles.length, 0, '普通普攻是近战，不该出弹道');
    assert.ok(state.combatEvents.length >= 1);
    const attack = state.combatEvents[0];
    //  需求（2026-11-23）：「仙桃行者，普通攻击也要播放 长枪兵的武将技能特效」，
    //  随后用户纠正：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」。
    assert.equal(attack.effectPrefabPath, ZC_EFFECT_PATHS.spearSlash);
    //  🔴 锚点走兜底 `caster`：刀光 64×42 就是贴在本体出手点的一下挥击，
    //  不是「砸在目标脚下」的地面技 —— 那套（`target`）只属于重击柱。
    assert.equal(zcEffectAnchorOf(attack.effectPrefabPath), 'caster');
    //  🔴 目录**不登记**它：锚点 / 层 / 尺寸 / 寿命全是默认值，与长枪兵行 30171 逐字一致。
    //  一旦有人把它塞进 `ZC_EFFECT_SPECS` 调参，等于同一份美术出现第二个真源。
    assert.equal(
        ZC_EFFECT_SPECS.some((spec) => spec.prefabPath === attack.effectPrefabPath), false,
        '刀光不该进目录：长枪兵自己那行 30171 也是不登记的直接播放',
    );
    //  clip 是 12fps / 0.667s，但**故意不抬事件寿命** —— 长枪兵原版同样被近战默认
    //  `defaultAttackTravelSeconds`（0.32s）截断，这才是用户说的「旧值观感」。
    assert.ok(
        Math.abs(attack.durationSeconds - ZC_EFFECT_TUNING.defaultAttackTravelSeconds) < 1e-9,
        `普攻事件寿命应保持默认 0.32s，实际 ${attack.durationSeconds}s`,
    );
    for (const event of state.combatEvents) {
        assert.equal(event.empowered, false);
        assert.equal((event as unknown as Record<string, unknown>).quakeDamage, undefined);
    }
});

test('⑨-1 配表真值：pvpSkill 30718 两份产物都指向「长枪兵普攻_刀光」', () => {
    prepare();
    for (const [label, rows] of [
        ['remoteRef', readRows('pvpSkill')],
        ['client', readClient('pvpSkill')],
    ] as Array<[string, Array<Record<string, unknown>>]>) {
        const row = rows.find((entry) => Number(entry.skillId) === 30718);
        assert.ok(row, `${label} 缺 pvpSkill 30718`);
        assert.equal(row!.name, '仙桃行者普攻');
        assert.equal(row!.effectPrefabPath, ZC_EFFECT_PATHS.spearSlash,
            `${label} 30718 还没换成「长枪兵普攻_刀光」`);
    }
    //  源表 `PVP-技能.xlsx` 行 64 由 `align_pvp_skill_to_json.py` 对齐（不在测试里解 zip，
    //  本项目测试没有读 xlsx 的先例；改完用脚本回读，见 tools/config/patch_xiantao_spear_fx.js 的说明）。
});

test('⑩ 结算：首目标吃 300%，落点圆内旁人也吃 300%，圆外不吃，且不重复打首目标', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const bystander = makeUnit(3, ZCOwner.Enemy, 44, '68028');   // 距圆心 4 世界 px < 16.2
    const faraway = makeUnit(4, ZCOwner.Enemy, 400, '68028');     // 圆外
    const ally = makeUnit(5, ZCOwner.Player, 41, '68001');        // 自己人：不炸
    const units = [caster, first, bystander, faraway, ally];
    const state = makeState(units);
    const { context, hits } = attackContext(units, TIER1_PARAMS, null);
    const projectile = {
        id: 1, type: 'projectile', owner: ZCOwner.Player, sourceUnitId: caster.id, sourceCardId: '68009',
        targetKind: 'unit', targetId: first.id, skillId: XIANTAO_EMPOWERED, skillName: '大地之力',
        effectPrefabPath: null, fromX: 0, fromY: 0, toX: 40, toY: 0, x: 40, y: 0,
        baseDamage: 120, quakeDamage: 300, quakeRadius: QUAKE_RADIUS_LOGICAL * 0.3,
        quakeEffectSeconds: ZC_QUAKE_STRIKE_SECONDS,
        hitUnitIds: [], remainingPierces: 99, pierceFalloff: 0, empowered: true,
        startedAt: 0, durationSeconds: 1,
    } as unknown as ZCProjectileState;

    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'unit', id: first.id, x: 40, y: 0, bodyRadius: 24, cardId: '68028' }, context);

    const byUnit = new Map(hits.map((hit) => [hit.unitId, hit.damage]));
    assert.equal(byUnit.get(first.id), 300, '第一个被攻击的目标必须吃 300%');
    assert.equal(byUnit.get(bystander.id), 300, '落点圆内旁人吃「与首目标一致」的伤害');
    assert.equal(byUnit.has(faraway.id), false, '圆外的敌人不该被打到');
    assert.equal(byUnit.has(ally.id), false, '自己人不吃落点圆');
    assert.equal(hits.filter((hit) => hit.unitId === first.id).length, 1,
        '首目标只结算一次（圆内不许再打一遍，否则等于 600%）');

    //  纯表现事件：落在**命中点**（= 目标坐标），radius / damage 都是 0。
    const quakeEvents = state.combatEvents.filter((event) => event.effectPrefabPath === ZC_QUAKE_STRIKE_PREFAB_PATH);
    assert.equal(quakeEvents.length, 1, '首目标那一拍只该推一条重击表现');
    const quake = quakeEvents[0];
    assert.equal(quake.fromX, 40);
    assert.equal(quake.fromY, 0);
    assert.equal(quake.toX, 40);
    assert.equal(quake.toY, 0);
    assert.equal(quake.radius, 0);
    assert.equal(quake.damage, 0, '表现事件不许二次扣血');
    assert.equal(quake.durationSeconds, ZC_QUAKE_STRIKE_SECONDS);
});

test('⑪ 第二个被穿透的目标仍吃 120%，也不再多播一条重击', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const second = makeUnit(3, ZCOwner.Enemy, 60, '68028');
    const units = [caster, first, second];
    const state = makeState(units);
    const { context, hits } = attackContext(units, TIER1_PARAMS, null);
    const projectile = {
        id: 1, type: 'projectile', owner: ZCOwner.Player, sourceUnitId: caster.id, sourceCardId: '68009',
        targetKind: 'unit', targetId: first.id, skillId: XIANTAO_EMPOWERED, skillName: '大地之力',
        effectPrefabPath: null, fromX: 0, fromY: 0, toX: 40, toY: 0, x: 40, y: 0,
        baseDamage: 120, quakeDamage: 300, quakeRadius: QUAKE_RADIUS_LOGICAL * 0.3,
        quakeEffectSeconds: ZC_QUAKE_STRIKE_SECONDS,
        hitUnitIds: [], remainingPierces: 99, pierceFalloff: 0, empowered: true,
        startedAt: 0, durationSeconds: 1,
    } as unknown as ZCProjectileState;

    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'unit', id: first.id, x: 40, y: 0, bodyRadius: 24, cardId: '68028' }, context);
    //  `ZCProjectileSystem` 是在 `context.hit()` 之后才把 id 记进 `hitUnitIds` 的。
    projectile.hitUnitIds.push(first.id);
    projectile.x = 60;
    projectile.y = 0;
    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'unit', id: second.id, x: 60, y: 0, bodyRadius: 24, cardId: '68028' }, context);

    assert.equal(hits.filter((hit) => hit.unitId === second.id)[0].damage, 120,
        '「其他的效果保持不变」= 后续穿透目标仍按 120%');
    assert.equal(state.combatEvents.filter(
        (event) => event.effectPrefabPath === ZC_QUAKE_STRIKE_PREFAB_PATH).length, 1,
    '重击柱只在首目标那一拍播一次');
});

test('⑫ 先蹭到城墙不算「第一个被攻击的目标」（否则首目标那份让给墙就白给了）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, first];
    const state = makeState(units);
    const { context, hits } = attackContext(units, TIER1_PARAMS, null);
    const projectile = {
        id: 1, type: 'projectile', owner: ZCOwner.Player, sourceUnitId: caster.id, sourceCardId: '68009',
        targetKind: 'unit', targetId: first.id, skillId: XIANTAO_EMPOWERED, skillName: '大地之力',
        effectPrefabPath: null, fromX: 0, fromY: 0, toX: 40, toY: 0, x: 40, y: 0,
        baseDamage: 120, quakeDamage: 300, quakeRadius: QUAKE_RADIUS_LOGICAL * 0.3,
        quakeEffectSeconds: ZC_QUAKE_STRIKE_SECONDS,
        hitUnitIds: [], remainingPierces: 99, pierceFalloff: 0, empowered: true,
        startedAt: 0, durationSeconds: 1,
    } as unknown as ZCProjectileState;

    //  城墙：`hexes` 里没有这个 id ⇒ 不结算任何伤害，但「首击」的资格必须还在。
    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'wall', id: 999, x: 10, y: 0, bodyRadius: 0, cardId: null }, context);
    assert.equal(hits.length, 0);
    assert.equal(state.combatEvents.filter(
        (event) => event.effectPrefabPath === ZC_QUAKE_STRIKE_PREFAB_PATH).length, 0,
    '打在墙上不该播重击');

    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'unit', id: first.id, x: 40, y: 0, bodyRadius: 24, cardId: '68028' }, context);
    assert.equal(hits.find((hit) => hit.unitId === first.id)?.damage, 300,
        '蹭到城墙之后，第一个被打到的**单位**仍然是首目标');
});

test('⑬ 没有配 quakeFirstRate 的卡（旧弹道）行为逐字不变', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, first];
    const state = makeState(units);
    const { context, hits } = attackContext(units, { damageRate: 1.2, pierceCount: 99 }, null);
    const projectile = {
        id: 1, type: 'projectile', owner: ZCOwner.Player, sourceUnitId: caster.id, sourceCardId: '68009',
        targetKind: 'unit', targetId: first.id, skillId: XIANTAO_EMPOWERED, skillName: '大地之力',
        effectPrefabPath: null, fromX: 0, fromY: 0, toX: 40, toY: 0, x: 40, y: 0,
        baseDamage: 120, hitUnitIds: [], remainingPierces: 99, pierceFalloff: 0, empowered: true,
        startedAt: 0, durationSeconds: 1,
    } as unknown as ZCProjectileState;

    ZCAttackResolutionSystem.resolveProjectileHit(state, projectile,
        { kind: 'unit', id: first.id, x: 40, y: 0, bodyRadius: 24, cardId: '68028' }, context);
    assert.equal(hits[0].damage, 120, '三个键都没有 ⇒ 首目标仍按 baseDamage');
    assert.equal(state.combatEvents.filter(
        (event) => event.effectPrefabPath === ZC_QUAKE_STRIKE_PREFAB_PATH).length, 0);
});

test('⑭ 表现 facade：from == to == 落点，radius/damage 为 0，时长固定取 clip 长度', () => {
    const state = makeState([]);
    pushQuakeStrikeVisualEvent(state, -12.5, 33.25, 7.5, {
        owner: ZCOwner.Enemy, sourceUnitId: 9, skillId: 36241, skillName: '重骑兵武将技',
    });
    assert.equal(state.combatEvents.length, 1);
    const event = state.combatEvents[0];
    assert.equal(event.effectPrefabPath, ZC_QUAKE_STRIKE_PREFAB_PATH);
    assert.equal(event.type, 'melee');
    assert.deepEqual([event.fromX, event.fromY, event.toX, event.toY], [-12.5, 33.25, -12.5, 33.25]);
    assert.equal(event.radius, 0);
    assert.equal(event.damage, 0);
    assert.equal(event.startedAt, 7.5);
    assert.equal(event.durationSeconds, ZC_QUAKE_STRIKE_SECONDS);
    assert.equal(event.empowered, false, '这条是纯表现，不该被当成强化击再乘一次倍率');
});
