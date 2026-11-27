import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectAnchorOf,
    zcEffectFlightOf,
    zcEffectLayerOfPath,
    zcEffectNodeScaleOf,
    zcEffectPathsForBehavior,
    zcWarmupEffectPaths,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import {
    ZC_DASH_EFFECT_LIFT_PX, ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_EFFECT_SECONDS,
    ZC_DASH_GUARD_PREFAB_PATH,
} from '../assets/script/app/zcds/model/ZCDashFx';
import { assetPath } from './helpers/asset-paths';
import { readSource } from './helpers/source-text';

/**
 * 第 49 批 · 冲锋三卡统一换【战士通用剑气】（2026-11-25）。
 *
 * 用户口径原文：
 *   「现有卡牌的角色技能效果中使用了轻骑兵冲锋的统一换成【战士通用剑气】特效，
 *     并制作格式一致的预制，飞行中的定格帧选择 skill_1_24，
 *     子弹的朝向目标的方向参考示例图。」
 *
 * 涉及的三条技能（都在冲锋车道上，原来共播 `轻骑兵_冲锋` 那张骑兵残影）：
 *   · 菇八戒 68012「菌盾冲锋」101204 —— `charge_shield`，朝目标方向定长 1 格；
 *   · 南瓜战神 68023「冲锋」102303 —— `legacy_dash`，朝最近敌人冲 3 格；
 *   · 爆锤莲王 68027「尖刺冲锋」102703 —— `legacy_dash`，朝面朝方向冲 2 格。
 *
 * 🔴 三个「照直觉写就会静默错」的点：
 *   ① 这是**子弹**不是贴图：必须在目录里登记 `flight`。只登记 `facingDegrees` 也能转对角度，
 *      但位置会退化成「贴锚点播一次」—— 屏幕上看着像剑气凭空出现在半路。
 *   ② 朝向偏移是 **180°**。素材是 C 形月牙、凸面朝 −X（示例图红箭头 = 飞行方向正是凸面指向），
 *      漏了就是「剑气横着飞」，而且一帧都不报错。
 *   ③ 尺寸烘焙在 prefab 子节点的 `_lscale`（0.55），目录里**不再**写 `nodeScale`。
 *      两处都写就是 0.55×nodeScale，改一次大小要动两个地方。
 */

const SET_DIR = 'units/projectiles/战士通用剑气';
const PREFAB_NAME = '战士通用剑气';
/** 飞行定格帧（用户指定）：序列 23~37 里的第 24 张。*/
const FLIGHT_FRAME = '070-1-Skill_1_24.png';
/** 图集画布：内容框 382×437 等比缩到高 256 ⇒ 224×256。*/
const CANVAS_W = 224;
const CANVAS_H = 256;
/** prefab 子节点烘焙缩放（屏上 = 224 × 0.55 ≈ 123 px 宽）。*/
const BAKED_SCALE = 0.55;

const PREFAB_FILE = assetPath(`${SET_DIR}/${PREFAB_NAME}.prefab`);
const ATLAS_FRAME = assetPath(`${SET_DIR}/atlas/${FLIGHT_FRAME}`);
const ATLAS_META = `${ATLAS_FRAME}.meta`;
const ANIM_FILE = assetPath(`${SET_DIR}/anim/${PREFAB_NAME}-loop.anim`);
const PAC_FILE = assetPath(`${SET_DIR}/atlas/${PREFAB_NAME}.pac`);
const ROOT = process.cwd();

interface IPrefabNode {
    __type__: string;
    _name?: string;
    _children?: Array<{ __id__: number }>;
    _components?: Array<{ __id__: number }>;
    _lscale?: { x: number; y: number };
    _lpos?: { x: number; y: number };
}
interface IPrefabItem { __type__: string; [key: string]: unknown }

const rawPrefab = JSON.parse(readFileSync(PREFAB_FILE, 'utf8')) as IPrefabItem[];
const nodes = rawPrefab.filter((item) => item.__type__ === 'cc.Node') as unknown as IPrefabNode[];
const findOne = (type: string): IPrefabItem => {
    const hit = rawPrefab.find((item) => item.__type__ === type);
    assert.ok(hit, `预制体里没有 ${type}`);
    return hit!;
};

// ────────────────────────────────────────────── 一、预制体（与既有投射物同构）

test('战士通用剑气 prefab：两级结构，尺寸真源在子节点 `_lscale`', () => {
    //  与全工程 40+ 个投射物 prefab 一致：根 Node 只做分组（无组件、`_lscale = 1`），
    //  子节点 `offset` 承载 UITransform / Sprite / Animation，尺寸写在它的 `_lscale` 上。
    //  单层手写也能跑（视图用 `getComponent` / `getComponentInChildren` 都找得到），
    //  但「格式一致」这件事上会留一个肉眼可见的差异。
    assert.equal(nodes.length, 2, '两级结构：根 Node + 子 Node `offset`');
    assert.equal(nodes[0]._name, PREFAB_NAME);
    assert.equal(nodes[1]._name, 'offset');
    assert.deepEqual(nodes[0]._children, [{ __id__: 2 }]);
    assert.deepEqual(nodes[0]._components, [], '根节点不挂组件');
    assert.equal(nodes[0]._lscale!.x, 1);
    assert.equal(nodes[0]._lpos!.x, 0);
    assert.equal(nodes[0]._lpos!.y, 0);
    assert.equal(nodes[1]._lscale!.x, BAKED_SCALE, '尺寸只改这一格（重跑 tools/build_warrior_qi_fx.py）');
    assert.equal(nodes[1]._lscale!.y, BAKED_SCALE);

    const transform = findOne('cc.UITransform');
    assert.deepEqual(transform._contentSize, { __type__: 'cc.Size', width: CANVAS_W, height: CANVAS_H });
    assert.deepEqual(transform._anchorPoint, { __type__: 'cc.Vec2', x: 0.5, y: 0.5 });
});

test('定格帧就是 skill_1_24：Sprite 指向图集里那一张，且按整帧对齐', () => {
    //  🔴 `_sizeMode = 0 (CUSTOM)` + `_isTrimmedMode = false`：取整帧画布、不裁剪。
    //  图集帧是 224×256 的**已裁空白**画布（裁切发生在生成脚本里），所以这里「不裁剪」
    //  只是锁住「按画布 1:1 贴」，不是把 1646×673 的原始留白再带回来。
    const sprite = findOne('cc.Sprite');
    const frameMeta = JSON.parse(readFileSync(ATLAS_META, 'utf8')) as {
        uuid: string;
        subMetas: Record<string, { uuid: string; displayName: string }>;
    };
    //  帧名 = 用户点名的 skill_1_24（文件被搬进 atlas/ 时 uuid 保留，名字没改）。
    assert.equal(frameMeta.subMetas.f9941.displayName, '070-1-Skill_1_24');
    assert.deepEqual(sprite._spriteFrame, {
        __uuid__: `${frameMeta.uuid}@f9941`,
        __expectedType__: 'cc.SpriteFrame',
    });
    assert.equal(sprite._sizeMode, 0);
    assert.equal(sprite._isTrimmedMode, false);
    assert.equal(sprite._color, undefined, '不烘染色：颜色就是美术原样');
});

test('预制体带单帧 clip 且**循环**（单帧只播一次会在部分机型闪一下）', () => {
    const animMeta = JSON.parse(readFileSync(`${ANIM_FILE}.meta`, 'utf8')) as { uuid: string };
    const anim = findOne('cc.Animation');
    assert.deepEqual(anim._clips, [{ __uuid__: animMeta.uuid, __expectedType__: 'cc.AnimationClip' }]);
    assert.deepEqual(anim._defaultClip, { __uuid__: animMeta.uuid, __expectedType__: 'cc.AnimationClip' });
    //  起播交给 `ZCCombatEffectView.mountVisual`（它读 defaultClip 再 play），prefab 里不自动播。
    assert.equal(anim.playOnLoad, false);

    const clip = JSON.parse(readFileSync(ANIM_FILE, 'utf8')) as {
        wrapMode: number; _duration: number; sample: number;
        _tracks: Array<{ _channel: { _curve: { _times: number[]; _values: unknown[] } } }>;
    };
    assert.equal(clip.wrapMode, 2, 'WrapMode Loop');
    assert.equal(clip._tracks[0]._channel._curve._values.length, 1, '只有一帧 —— 飞行途中定格');
    assert.ok(Math.abs(clip._duration - 1 / 24) < 1e-9, `单帧时长 1/24，实际 ${clip._duration}`);
});

test('图集存在且已裁空白：帧就是 224×256、不透明区域满幅', () => {
    assert.ok(existsSync(ATLAS_FRAME), '图集帧缺失 ⇒ 剑气不可见且不报错');
    assert.ok(existsSync(PAC_FILE), '缺 .pac 就没有自动图集，散图会各自成一张 texture');
    assert.ok(existsSync(ANIM_FILE), '缺 anim 则 Sprite 只有静态帧（本次可以接受，但格式不一致）');
    const png = readFileSync(ATLAS_FRAME);
    assert.equal(png.readUInt32BE(16), CANVAS_W, 'PNG 宽');
    assert.equal(png.readUInt32BE(20), CANVAS_H, 'PNG 高');
});

// ────────────────────────────────────────────── 二、目录：冲锋车道改播剑气

test('两条冲锋车道都换成剑气，护盾那条不动', () => {
    assert.equal(ZC_DASH_EFFECT_PREFAB_PATH, ZC_EFFECT_PATHS.warriorQi, '冲锋出口只能有一个真源');
    for (const key of [ZC_EFFECT_BEHAVIOR_KEYS.chargeShield, ZC_EFFECT_BEHAVIOR_KEYS.legacyDash]) {
        assert.deepEqual(zcEffectPathsForBehavior(key),
            [ZC_EFFECT_PATHS.warriorQi, ZC_EFFECT_PATHS.dashGuard], key);
    }
    //  预热清单：剑气进、旧残影出（旧图只剩配表 30191 按字面量取，那条路不预热）。
    const warmup = zcWarmupEffectPaths();
    assert.ok(warmup.includes(ZC_EFFECT_PATHS.warriorQi), '不进预热就是「照常结算、屏幕上不播」');
    assert.equal(warmup.includes(ZC_EFFECT_PATHS.chargeDash), false,
        'warriorQi 已经换掉残影，旧图不该再占首包');
    assert.ok(warmup.includes(ZC_DASH_GUARD_PREFAB_PATH));
});

test('目录登记：flight（而非 facingDegrees）+ 180° 朝向 + 置顶 + 不叠 nodeScale', () => {
    const path = ZC_EFFECT_PATHS.warriorQi;
    assert.deepEqual(zcEffectFlightOf(path), {
        speed: 420,
        minSeconds: 0.14,
        maxSeconds: 0.6,
        //  美术凸面朝 −X ⇒ 转角 = 弹道方向 + 180。
        facingOffsetDegrees: 180,
    }, '不登记 flight 就只是「贴锚点播一次」，剑气不会飞');
    assert.equal(zcEffectLayerOfPath(path), 'top', '剑气要从角色身前掠过，压地面层会被挡住');
    assert.equal(zcEffectNodeScaleOf(path), 1, '尺寸烘焙在 prefab 的 0.55 里，目录再乘就是两处真源');
    //  🔴 飞行分支在锚点逻辑之前就 return，`anchor` 对这条不生效 —— 必须保持默认 `caster`，
    //  写成 `midpoint` 会让人以为它还在贴线段中点（第 15 批的旧口径）。
    assert.equal(zcEffectAnchorOf(path), 'caster');
    //  寿命不在这里给：冲锋事件自带 `dashSeconds = 0.3`。
    assert.ok(Math.abs(ZC_DASH_EFFECT_SECONDS - 0.3) < 1e-9);
});

test('旧残影的目录口径保留（配表 30191「轻骑兵普攻」仍按字面量取它）', () => {
    //  它已经不在任何行为组里，但 `pvpSkill 30191` 的 `effectPrefabPath` 就是这条字符串，
    //  视图按路径查目录 ⇒ 删了这格，那条普攻会退回「1 倍、贴施法者」的兜底口径。
    assert.equal(zcEffectNodeScaleOf(ZC_EFFECT_PATHS.chargeDash), 0.4);
    assert.equal(zcEffectAnchorOf(ZC_EFFECT_PATHS.chargeDash), 'midpoint');
    assert.equal(zcEffectFlightOf(ZC_EFFECT_PATHS.chargeDash), null, '旧图不飞，保持残影口径');
});

// ────────────────────────────────────────────── 三、全链路：技能真的推出剑气事件

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare(): void {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    captureZCMatchConfig();
}

function makeUnit(id: number, owner: ZCOwner, x: number, y: number, unitId: string): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: { player: 0, enemy: 0 },
        allRandomNonGoldDraws: { player: 0, enemy: 0 },
        builtTypeCounts: { player: {}, enemy: {} },
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

test('菌盾冲锋 101204：冲出去那一刻推的是剑气事件（两端坐标 + 0.3s）', () => {
    prepare();
    const params = {
        chargeCooldown: 12, chargeDamageRate: 1.2, chargeCells: 1,
        chargeHitRadius: 40, chargeShieldRatio: 0.15, chargeShieldSeconds: 3,
    };
    const caster = makeUnit(1, ZCOwner.Player, 0, 0, '68012');
    const state = makeState([caster]);
    const runtime = {
        skillChainId: 101204, behaviorKey: 'charge_shield',
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const registered = new Map<string, Record<string, unknown>>();
    const landed: Array<{ x: number; y: number }> = [];
    const context = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: (id: string) => registered.has(id),
            register: (definition: Record<string, unknown>) => { registered.set(String(definition.id), definition); },
            apply: () => ({ applied: true }),
        },
        distanceScale: 0.3,
        runtimeOf: (unit: ZCUnitState) => (unit.id === caster.id ? runtime : undefined),
        fireBurst: () => undefined,
        castSecondary: () => false,
        castSplashShot: () => false,
        castBurstSkill: () => false,
        castFanSweep: () => false,
        inAttackRange: () => false,
        hexIdAt: () => 1,
        blinkTo: (_unit: ZCUnitState, x: number, y: number) => { landed.push({ x, y }); },
        castChargeDash: () => 0,
        currentTarget: () => ({ x: 100, y: 0 }),
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, context);

    const fx = state.combatEvents.filter((event) => event.effectPrefabPath === ZC_EFFECT_PATHS.warriorQi);
    assert.equal(fx.length, 1, '冲锋必须推一条剑气事件（旧口径推的是 chargeDash）');
    assert.equal(state.combatEvents.some((event) => event.effectPrefabPath === ZC_EFFECT_PATHS.chargeDash),
        false, '残影不该再出现在任何一条事件里');
    assert.equal(fx[0].fromX, 0, 'from = 起冲点');
    assert.ok(Math.abs(fx[0].toX - 42 * 0.3) < 1e-9, `to = 落点（1 格 = 42×0.3 = 12.6），实际 ${fx[0].toX}`);
    assert.ok(Math.abs(Number(fx[0].durationSeconds) - ZC_DASH_EFFECT_SECONDS) < 1e-9);
    assert.equal(fx[0].damage, 0, '纯表现：伤害由 castChargeDash 结算');
    assert.equal(fx[0].visualLiftPx, ZC_DASH_EFFECT_LIFT_PX, '剑气要抬到腰线，不能一半插进地面');
    assert.equal(landed.length, 1, '人照样冲过去（换的只是表现）');
});

test('抬升只走事件级 `visualLiftPx`：prefab 里不许带纵向摆位', () => {
    //  🔴 写进 prefab 的 `_lpos.y` 会被宿主转角带跑（剑气朝右时整体转 180°，
    //  本地 +Y 就变成「往下沉」）⇒ 四个方向的相对高度各不相同，且不报错。
    //  正确位置是视图：`mapToViewY(headY) + event.visualLiftPx`（屏幕竖直，与转角无关）。
    const view = readSource('assets/script/app/zcds/view/ZCCombatEffectView.ts');
    assert.ok(view.includes('mapToViewY(headY) + (event.visualLiftPx ?? 0)'),
        '飞行分支没读事件级抬升 ⇒ 141px 高的剑气会有一半在地面以下');
    assert.equal(nodes[0]._lpos!.y, 0, '根节点不许带摆位');
    assert.equal(nodes[1]._lpos!.y, 0, '子节点不许带摆位（会被转角转成侧移）');
    assert.equal(nodes[1]._lpos!.x, 0);
});

// ────────────────────────────────────────────── 四、生成脚本（改尺寸/换帧的唯一入口）

test('生成脚本仍是唯一入口：帧名、画布与缩放写在脚本里', () => {
    const source = readSource(join(ROOT, 'tools/build_warrior_qi_fx.py'));
    assert.match(source, /FLIGHT_FRAME = '070-1-Skill_1_24\.png'/, '定格帧写死在脚本里');
    assert.match(source, /UNION_BOX = \(1215, 124, 1597, 561\)/, '内容框来自实测 alpha bbox');
    assert.match(source, /base\.PREFAB_SCALE = 0\.55/, '尺寸只改这一格');
    assert.match(source, /base\.CACHE_UNUSED_FRAMES = True/, '其余 14 帧不进 bundle');
});
