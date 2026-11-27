import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZC_EFFECT_PATHS, zcEffectDurationOf, zcEffectNodeScaleOf } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { zcCombatEffectLayerOf, zcCombatEffectLayerOfPath } from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import type { ZCCombatEvent, ZCProjectileState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';
import { readSource } from './helpers/source-text';

/**
 * 第 47 批 · 治疗类技能表现统一（2026-11-25）。
 *
 * 用户口径原文：
 *   「释放治疗类技能时，数字 UI 是绿色的前面带 + 号，字体大小和伤害一致，
 *     移动轨迹是直线上移 75px，持续 0.2s，播放【通用治疗特效】，
 *     制作统一格式的预制体，特效大小跟随角色模型大小轻微调整」。
 *
 * 拆成四块，下面的用例一一对应：
 *   ① 飘字：绿 + `+` + 字号 30（这三项是现状，用例锁住不许回退）；
 *      **轨迹换成直线上升 75px、0.2s**（改前走伤害那条「按 id 散 5 条横轨 + 无标记向下坠」）。
 *   ② 特效：Spine `eff_cost_01` 的唯一动画 `eff_buff_heal`，一次性（不循环）。
 *   ③ 预制体：与 `鹿神守护` 同构的两级结构（根 Node + 子 Node `spine`）。
 *   ④ 尺寸：`nodeScale 0.5`（2026-11-25 实机口径「缩小成 50%」，核心光斑 ≈ 半个角色宽）× 体型半程跟随。
 *
 * 🔴 三个「照直觉写就会静默错」的点：
 *   ① 事件寿命必须 ≥ clip。素材是 1.0s（从二进制读出来的），短了播一半就被摘、长了停在末帧，
 *      两个方向都**不报错**。
 *   ② `loop` 必须显式 `false`。`ZCCombatEffectView.applySpineAnimation` 原来硬编码 `true`，
 *      一次性演出循环了就没有「播完」这回事。
 *   ③ 光环要 `layer: 'top'` + 事件级 `visualLiftPx`。`area` 默认压地面层、且读的是
 *      **事件级**抬升（目录里的 `liftY` 只有弹道分支读），写错位置的表现是「光环贴在地面上」。
 */

const HEAL_PATH = ZC_EFFECT_PATHS.healAura;
const ASSET_DIR = 'units/projectiles/通用治疗特效';
const PREFAB_NAME = '通用治疗特效';
/** 素材里唯一的动画名（`eff_cost_01.skel` 动画段 count = 1，名字紧跟其后）。*/
const CLIP = 'eff_buff_heal';
/** 飘字与光环的三个需求数值（需求原文直给，不在别处推导）。*/
const HEAL_RISE_PX = 75;
const HEAL_SECONDS = 0.2;
const HEAL_AURA_LIFT_PX = 49;

interface IPrefabComponent { __type__: string; [key: string]: unknown }
interface IPrefabNode {
    __type__: string;
    _name?: string;
    _children?: Array<{ __id__: number }>;
    _lpos?: { x: number; y: number };
    _lscale?: { x: number; y: number };
}

const PREFAB_FILE = assetPath(`${ASSET_DIR}/${PREFAB_NAME}.prefab`);

function readPrefab(): { nodes: IPrefabNode[]; components: IPrefabComponent[] } {
    const raw = JSON.parse(readFileSync(PREFAB_FILE, 'utf8')) as Array<Record<string, unknown>>;
    return {
        nodes: raw.filter((item) => item.__type__ === 'cc.Node') as unknown as IPrefabNode[],
        components: raw as unknown as IPrefabComponent[],
    };
}

function skeletonOf(): IPrefabComponent {
    const skeleton = readPrefab().components.find((item) => item.__type__ === 'sp.Skeleton');
    assert.ok(skeleton, '预制体里没有 sp.Skeleton：那它不会画出任何东西');
    return skeleton;
}

// ────────────────────────────────────────────── 一、预制体结构（照 `鹿神守护` 的两级结构）

test('治疗特效 prefab：根 Node + 子 Node `spine`，骨架挂在子节点上', () => {
    const { nodes, components } = readPrefab();
    assert.equal(nodes.length, 2, '两级结构：根 Node 管摆位，子 Node `spine` 管骨架');
    assert.equal(nodes[0]._name, PREFAB_NAME);
    assert.equal(nodes[1]._name, 'spine', '子节点名必须是 spine（`getComponentInChildren` 找的是组件不是名字，但作者口径统一）');
    //  根节点必须是子节点的父（`_children` 指向 __id__ 2 = 第一个子 Node）。
    assert.deepEqual(nodes[0]._children?.map((child) => child.__id__), [2]);
    //  根节点不位移：落点由模型给的 to 坐标决定，根节点再有偏移就是「每次都偏一截」（§42/§44/§46 同口径）。
    assert.equal(nodes[0]._lpos?.x, 0);
    assert.equal(nodes[0]._lpos?.y, 0);
    //  `_lscale` 必须留 1：`ZCCombatEffectView.render` 每帧用 `node.setScale` 覆盖宿主缩放，
    //  把尺寸烘进 prefab 的 `_lscale` 会被整份抹掉 —— 尺寸只走目录 `nodeScale` 与事件 `effectScale`。
    assert.equal(nodes[0]._lscale?.x, 1);
    assert.equal(nodes[1]._lscale?.x, 1);

    const skeletonNode = components.find((item) => item.__type__ === 'sp.Skeleton')?.node as { __id__: number };
    assert.equal(skeletonNode.__id__, 2, 'sp.Skeleton 必须挂在子节点 spine 上');
});

test('治疗特效 prefab：骨架引用的是本目录的 skel，动画 `eff_buff_heal` 一次性播', () => {
    const meta = JSON.parse(readFileSync(`${assetPath(`${ASSET_DIR}/eff_cost_01.skel`)}.meta`, 'utf8')) as
        { uuid: string; importer: string };
    assert.equal(meta.importer, 'spine-data');
    const skeleton = skeletonOf();
    assert.equal((skeleton._skeletonData as { __uuid__: string }).__uuid__, meta.uuid,
        '骨架 uuid 与 eff_cost_01.skel.meta 不一致 ⇒ 画面上什么都没有，且不报错');
    assert.equal(skeleton.defaultAnimation, CLIP, '动画名写错不会报错，只是骨架一动不动');
    assert.equal(skeleton.loop, false, '一次性演出必须 loop=false，否则没有「播完」这回事');
    assert.equal(skeleton._premultipliedAlpha, true, '与鹿神守护同口径（预乘 alpha，描边不出黑边）');
    assert.equal(skeleton.defaultSkin, 'default');
    //  颜色必须是白的：整棵子树的染色由事件级 tint 决定，prefab 自带色会乘进去。
    assert.deepEqual(skeleton._color, { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 });
});

// ────────────────────────────────────────────── 二、目录登记

test('目录登记：置顶层 + clip 寿命 1.0s + nodeScale 0.5', () => {
    assert.equal(HEAL_PATH, `${ASSET_DIR}/${PREFAB_NAME}`);
    //  一次性 Spine 演出 1.0s（素材实测，见 ZC_EFFECT_TUNING.healAuraSeconds 的注释）。
    assert.equal(ZC_EFFECT_TUNING.healAuraSeconds, 1.0);
    assert.equal(zcEffectDurationOf(HEAL_PATH), 1.0, '目录寿命与常量必须同源');
    //  🔴 `area` 类默认压地面层，治疗光环必须置顶才不会被站在圈里的角色挡住。
    assert.equal(zcCombatEffectLayerOfPath('area', HEAL_PATH), 'top');
    assert.equal(zcCombatEffectLayerOf('area'), 'ground', '未登记的 area 仍是地面层（存量逐字不变）');

    const source = readSource('assets/script/app/zcds/model/ZCEffectCatalog.ts');
    //  2026-11-25 实机口径「治疗特效缩小成 50%」：基准 1.0（核心光斑 ≈ 一个角色宽）→ 0.5。
    //  🔴 这条只是「全局基准」变了一半，体型半程跟随（事件级 `effectScale`）在其上再乘，
    //  所以身体大的单位仍然会大一点点，不是一刀切死尺寸。
    assert.match(source, /prefabPath: ZC_EFFECT_PATHS\.healAura,\s*\n\s*nodeScale: 0\.5,/,
        'nodeScale 必须停在 0.5（实机缩 50% 后的基准）');
    assert.equal(zcEffectNodeScaleOf(HEAL_PATH), 0.5);
});

// ────────────────────────────────────────────── 三、飘字：直线上升 75px / 0.2s

test('治疗飘字：直线上升 75px，不再套伤害的横轨 + 下坠', () => {
    const view = readSource('assets/script/app/zcds/view/ZCFloatTextView.ts');
    assert.match(view, /healRiseDistance = 75/, '上升距离由需求直给 75px');
    //  专用分支必须存在，且在伤害通用段（`floatTextDrift`）**之前**返回 ——
    //  否则会先被算出横轨与方向符号，再也没机会走直线。
    const healBranch = view.indexOf("if (text.kind === 'heal') {");
    const damageBlock = view.indexOf('const drift = floatTextDrift(');
    assert.ok(healBranch > 0, '找不到 heal 专用分支');
    assert.ok(damageBlock > 0, '找不到伤害通用段');
    assert.ok(healBranch < damageBlock, 'heal 分支必须排在伤害通用段之前（否则永远走不到）');
    const branchBody = view.slice(healBranch, damageBlock);
    assert.match(branchBody, /this\.healRiseDistance \* progress/,
        '直线上升用 progress（匀速走完整条时长），用 enter 会在入场结束时提前停住');
    assert.ok(!/DAMAGE_LANES|damageTravelSign/.test(branchBody),
        '治疗不许套横轨 / 方向符号：那是伤害语义，套上去会「一半往天上、一半往地里」');

    //  模型侧：0.2s 与伤害的 0.85s 各在各的常量上（合用一个就会被配表顺手改掉）。
    const model = readSource('assets/script/app/zcds/model/ZCGameModel.ts');
    assert.match(model, /const FLOAT_TEXT_HEAL_SECONDS = 0\.2;/);
    assert.match(model, /durationSeconds: FLOAT_TEXT_HEAL_SECONDS/,
        'presentHeal 必须推治疗自己的时长；改回 floatTextDamageSeconds 就是「75px 被拉成 0.85s 慢飘」');
});

test('治疗飘字：绿 + `+` 前缀 + 与伤害同字号（现状锁死，不许回退）', () => {
    const view = readSource('assets/script/app/zcds/view/ZCFloatTextView.ts');
    //  绿色 (91, 255, 49)，`+` 号拼在数值里。
    assert.match(view, /HEAL_COLOR = new Color\(91, 255, 49, 255\)/);
    assert.match(view, /case 'heal': return \{ prefix: '', value: `\+\$\{value\}` \};/);
    //  字号：heal 不在放大 / 压平的名单里 ⇒ 落到 DEFAULT_FONT_SIZE（与普通伤害同一个 30）。
    assert.match(view, /DEFAULT_FONT_SIZE = 30/);
    const fontLine = /const fontSize = text\.takenFromPlayer \? ZCFloatTextView\.DEFAULT_FONT_SIZE([\s\S]*?)ZCFloatTextView\.DEFAULT_FONT_SIZE;/.exec(view);
    assert.ok(fontLine, '找不到字号取值链');
    assert.ok(!/heal/.test(fontLine![1]), '治疗不许在字号上被单独放大 / 缩小：需求要求与伤害一致');
    //  需求里的三个数不许只在注释里「成立」。
    assert.equal(HEAL_RISE_PX, 75);
    assert.equal(HEAL_SECONDS, 0.2);
});

// ────────────────────────────────────────────── 四、Spine 一次性播放通道

test('视图：spineLoop 由事件驱动，缺省仍是循环（存量逐字不变）', () => {
    const view = readSource('assets/script/app/zcds/view/ZCCombatEffectView.ts');
    assert.match(view, /this\.applySpineAnimation\(event\.spineAnimation, event\.spineLoop !== false\)/,
        '缺省必须按「循环」处理，否则鹿神守护的走 / 停动画会播一次就定住');
    assert.match(view, /skeleton\.setAnimation\(0, clip, loop\)/, '循环位必须真的传给 setAnimation');
    assert.match(view, /const key = loop \? `\$\{clip\}\\u0001loop` : clip;/,
        '判「要不要重设」必须连循环位一起比：同名 clip 两种循环位是两个播放状态');
    //  类型侧登记。
    const types = readSource('assets/script/app/zcds/model/ZCGameTypes.ts');
    assert.match(types, /spineLoop\?: boolean;/);
});

// ────────────────────────────────────────────── 五、模型全链路

const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity',
    'pvpTileGen', 'pvpTileGenParams'];
const tables = Object.fromEntries(names.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source)
        ? source
        : source.v.map((row: unknown[]) => Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
const captured = captureZCMatchConfig();
const matchConfig: ZCMatchConfig = {
    ...captured,
    rules: { ...captured.rules, combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000 },
    units: captured.units.map((definition) => ({
        ...definition, maxHp: 1000, moveSpeed: 0, bodyRadius: 4,
        attack: 100, attackProfile: { ...definition.attackProfile, mode: 'projectile', projectileSpeed: 100, collisionRadius: 1 },
    })),
};

function battleUnit(id: number, owner: 'player' | 'enemy', x: number, hp: number, bodyScale?: number): ZCUnitState {
    const definition = matchConfig.units.find((item) => !item.flying)!;
    return {
        id, owner, unitId: definition.unitId, cardId: '68024', tier: 1,
        sourceHexId: matchConfig.map.playerHomeId, targetHexId: null, progress: 0,
        hp, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
        bodyScale,
    } as unknown as ZCUnitState;
}

function makeProjectile(overrides: Partial<ZCProjectileState> = {}): ZCProjectileState {
    return {
        id: 1, type: 'projectile', owner: ZCOwner.Player,
        sourceUnitId: 1, sourceCardId: '68024',
        targetKind: 'unit', targetId: 99, targetUnitId: 99,
        skillId: 30671, skillName: '急冻瓜普攻',
        effectKey: null, projectileKey: null, effectPrefabPath: null,
        fromX: -80, fromY: 0, toX: 300, toY: 0,
        x: -80, y: 0, previousX: -80, previousY: 0,
        velocityX: 100, velocityY: 0,
        baseDamage: 100, damage: 100, radius: 0,
        collisionRadius: 1, canHitAir: true,
        empowered: false, criticalHit: false,
        startedAt: 0, durationSeconds: 5,
        remainingPierces: 0, hitUnitIds: [],
        executeChance: 0, onHitStatusId: undefined, legacyBuffs: [],
        ...overrides,
    } as unknown as ZCProjectileState;
}

interface IModelInternals {
    state: {
        combatEvents: ZCCombatEvent[];
        units: ZCUnitState[];
        projectiles: ZCProjectileState[];
        elapsedSeconds: number;
    };
    presentHealAura(unit: ZCUnitState, position: { x: number; y: number }): void;
}

function buildModel(units: ZCUnitState[]): { model: ZCGameModel; internals: IModelInternals } {
    const snapshot = ZCGameModel.createInitialState(() => 0.1, matchConfig);
    snapshot.units = units;
    snapshot.nextUnitId = 10;
    const model = new ZCGameModel(snapshot, () => 0.1, matchConfig);
    return { model, internals: model as unknown as IModelInternals };
}

function healAuras(events: readonly ZCCombatEvent[]): ZCCombatEvent[] {
    return events.filter((event) => event.effectPrefabPath === HEAL_PATH);
}

test('治疗光环事件：area / 不结算 / 一次性 / 抬到身体中心', () => {
    const { internals } = buildModel([battleUnit(1, 'player', 0, 500)]);
    internals.presentHealAura(internals.state.units[0], { x: 0, y: 0 });
    const auras = healAuras(internals.state.combatEvents);
    assert.equal(auras.length, 1);
    const aura = auras[0];
    assert.equal(aura.type, 'area', '原地播：不参与弹道与碰撞');
    assert.equal(aura.effectPrefabPath, HEAL_PATH);
    assert.equal(aura.fromX, 0);
    assert.equal(aura.fromY, 0);
    assert.equal(aura.toX, 0);
    assert.equal(aura.toY, 0);
    //  🔴 纯表现：`damage 0` + `skillId 0` ⇒ 不进伤害统计、也不进大招通报
    //  （`isActiveSkillCast` 第一道闸就是 `skillId <= 0`）。
    assert.equal(aura.damage, 0);
    assert.equal(aura.skillId, 0);
    //  寿命 = clip 时长，短了播一半就被摘。
    assert.equal(aura.durationSeconds, ZC_EFFECT_TUNING.healAuraSeconds);
    //  一次性 Spine。
    assert.equal(aura.spineAnimation, CLIP);
    assert.equal(aura.spineLoop, false);
    //  事件级抬升（`area` 分支只读这个，目录的 liftY 是弹道专用）。
    assert.equal(aura.visualLiftPx, HEAL_AURA_LIFT_PX);
    //  体型 1 ⇒ 基准尺寸。
    assert.equal(aura.effectScale, 1);
});

test('特效大小跟随角色模型大小**轻微**调整（半程跟随 + 钳位）', () => {
    const cases: Array<[number, number]> = [
        [1, 1],        // 标准体型
        [2, 1.5],      // 战神附体：跟一半，不能 2 倍（否则光斑比人还大）
        [0.5, 0.75],   // 缩小：钳在下限
        [3, 2],        // 巨型：钳在上限
    ];
    for (const [body, expected] of cases) {
        const { internals } = buildModel([battleUnit(1, 'player', 0, 500, body)]);
        internals.presentHealAura(internals.state.units[0], { x: 0, y: 0 });
        const aura = healAuras(internals.state.combatEvents)[0];
        assert.ok(Math.abs((aura.effectScale as number) - expected) < 1e-9,
            `bodyScale ${body} 的光环倍率应为 ${expected}，实际 ${aura.effectScale}`);
        //  抬升跟着一起变：光环罩在身体中心，体型变大中心也变高。
        assert.ok(Math.abs((aura.visualLiftPx as number) - HEAL_AURA_LIFT_PX * expected) < 1e-9);
    }
});

test('节流：同一单位 0.35s 内只闪一次（吸血刀刀触发不许刷屏）', () => {
    const { internals } = buildModel([battleUnit(1, 'player', 0, 500)]);
    const unit = internals.state.units[0];
    internals.presentHealAura(unit, { x: 0, y: 0 });
    internals.presentHealAura(unit, { x: 0, y: 0 });
    assert.equal(healAuras(internals.state.combatEvents).length, 1, '同一拍的第二次治疗不该再起一个光环');
    //  换一个单位不受别人影响（节流是 per-unit）。
    internals.presentHealAura(battleUnit(2, 'player', 0, 500), { x: 0, y: 0 });
    assert.equal(healAuras(internals.state.combatEvents).length, 2);
    //  过了一个间隔就该再来一次。
    internals.state.elapsedSeconds += 0.4;
    internals.presentHealAura(unit, { x: 0, y: 0 });
    assert.equal(healAuras(internals.state.combatEvents).length, 3);
});

test('全链路：弹道穿过友军回血 ⇒ 绿字 0.2s + 光环事件同一拍产生', () => {
    const { model, internals } = buildModel([
        battleUnit(1, 'player', -80, 1000),
        battleUnit(2, 'player', -20, 500),
        battleUnit(3, 'enemy', 300, 1000),
    ]);
    internals.state.projectiles.push(makeProjectile({
        owner: ZCOwner.Player, sourceUnitId: 1, targetId: 3, targetUnitId: 3,
        fromX: -80, fromY: 0, x: -80, y: 0, toX: 300, toY: 0,
        velocityX: 100, durationSeconds: 5,
        allyHealPct: 0.03, allyHealLeft: 3,
    }));

    //  飘字只活 0.2s ⇒ 一旦出现就停下断言（多跑几步它就到期被清了，断言会「莫名找不到」）。
    let found = false;
    for (let step = 0; step < 20 && !found; step += 1) {
        model.tick(0.05);
        found = model.floatTexts.some((text) => text.kind === 'heal');
    }
    assert.ok(found, '整段飞行里一次治疗飘字都没出现：要么没治上，要么没走 presentHeal');

    const ally = internals.state.units.find((unit) => unit.id === 2)!;
    assert.ok(Math.abs(ally.hp - 530) < 1e-6, `友军要回 30 点血（实际 ${ally.hp}）`);

    //  飘字：kind = heal、时长 0.2s（不是伤害的 0.85s）。
    const healTexts = model.floatTexts.filter((text) => text.kind === 'heal');
    assert.equal(healTexts.length, 1, '一次回血一条飘字');
    assert.ok(Math.abs(healTexts[0].durationSeconds - HEAL_SECONDS) < 1e-9,
        `治疗飘字时长应为 ${HEAL_SECONDS}s（实际 ${healTexts[0].durationSeconds}）`);
    assert.equal(healTexts[0].value, 30);

    //  光环：与回血同一拍产生，落在被治疗者身上。
    const auras = healAuras(internals.state.combatEvents);
    assert.equal(auras.length, 1, '一次回血一次光环');
    assert.equal(auras[0].sourceUnitId, 2, '光环挂在**被治疗者**身上，不是施法者');
    assert.equal(auras[0].owner, ZCOwner.Player);
});

test('伤害飘字时长不受影响（治疗改成 0.2s 不许连带改伤害）', () => {
    const model = readSource('assets/script/app/zcds/model/ZCGameModel.ts');
    //  三处伤害飘字仍然读配表 / 兜底 0.85s。
    const hits = model.match(/durationSeconds: this\.rules\.floatTextDamageSeconds \?\? FLOAT_TEXT_DAMAGE_SECONDS/g) ?? [];
    assert.ok(hits.length >= 3, `伤害飘字的调用点少了（实际 ${hits.length} 处）`);
    assert.match(model, /const FLOAT_TEXT_DAMAGE_SECONDS = 0\.85;/);
});
