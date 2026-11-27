import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import {
    ZC_BULLET_DROP_UNITS,
    ZC_BULLET_FLY_ARC_PX,
    ZC_BULLET_FLY_MAX_SECONDS,
    ZC_BULLET_FLY_MIN_SECONDS,
    ZC_BULLET_FLY_UNITS,
    ZC_BULLET_RAIN_MAX_SECONDS,
    ZC_BULLET_RAIN_MIN_SECONDS,
    zcBulletDropHeightOf,
    zcBulletFlyArcOffsetPx,
    zcBulletFlyArcPx,
    zcBulletFlyProgress,
    zcBulletFlySecondsFor,
} from '../assets/script/app/zcds/model/ZCProjectileDropStyle';
import { ZC_SKILL_RANGE_RING_PREFAB_PATH } from '../assets/script/app/zcds/model/ZCSkillRangeRingFx';

/**
 * 篮球天才「篮球火」三件事（2026-11-25 第 53 批）。
 *
 * 用户原话：
 * 「篮球少年的【篮球火】技能是以敌方为目标，在目标坐标释放命中区域，
 *   **子弹从本地移动到命中区域去，没有目标就不释放**，现在命中区域会出现在自己本体坐标」。
 *
 * 拆成三条判据：
 * ① 命中区域（地面区域 + 白圈）圆心**只认敌方单位坐标**，不可能是施法者自己的位置；
 * ② 子弹表现**从施法者飞向区域圆心**（不再从区域上方垂直落下）；
 * ③ 没有实体敌方单位（只剩城墙 / 建筑）时**不建区域、不结算**。
 *
 * 前两条用真实 `ZCGameModel` 全链路跑，第三条同理 —— 只改用例驱动的场景（去掉敌方单位）。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const VIEW_SOURCE = read('assets/script/app/zcds/view/ZCCombatEffectView.ts');
const ZONE_SOURCE = read('assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts');
const ATTACK_SOURCE = read('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts');

const TABLES = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity',
    'pvpTileGen', 'pvpTileGenParams', 'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan'];
const readRows = (name: string): unknown => {
    const s = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return Array.isArray(s)
        ? s
        : s.v.map((v: unknown[]) => Object.fromEntries(s.k.map((k: string, i: number) => [k, v[i]])));
};
loadPvpTables(Object.fromEntries(TABLES.map((n) => [n, readRows(n)])) as never);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

/** 篮球天才 30702 的强化那一击就是「篮球火」30848。 */
const SKILL_BASKETBALL_FIRE = 30848;

/** 一只站桩的篮球天才（68030）；`targetUnitId` 由调用方给。 */
function standUnit(id: number, owner: string, x: number, targetUnitId: number | null): Record<string, unknown> {
    return {
        id, owner, unitId: '68030', cardId: '68030', tier: 6,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 4000, maxHp: 4000, battleState: 'idle', stateTime: 0,
        targetUnitId, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IRun {
    readonly credits: Record<string, unknown>[];
    readonly caster: Record<string, any> | undefined;
    readonly structureLocked: boolean;
    readonly state: Record<string, any>;
}

/**
 * 跑一段真实对局，收集所有「篮球火」的表现事件。
 *
 * 🔴 只收 `sourceUnitId === 1`（我方那只）：AI 侧的 68030 也会放篮球火，
 * 一条 `filter(skillId)` 会把两边混在一起，届时「圆心在 -80」其实是**敌方那发**
 * 打在我方身上的正常落点（第 53 批第一次跑用例就栽在这里）。
 *
 * @param withEnemy 给不给一个真敌方单位。不给时实测会退化成「打城墙 / 打建筑」
 *   （`targetWallHexId` / `targetBuildingHexId` 非空），正好是第 ③ 条要盖住的那条路径。
 */
function runMatch(withEnemy: boolean, seconds = 40): IRun {
    const captured = captureZCMatchConfig();
    const config: Record<string, unknown> = {
        ...captured,
        rules: { ...(captured as any).rules, combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000 },
        units: (captured as any).units.map((d: Record<string, unknown>) => ({
            ...d, maxHp: 4000, moveSpeed: 0, bodyRadius: 4, attack: 100,
        })),
    };
    const snapshot = ZCGameModel.createInitialState(() => 0.5, config as never);
    const caster = standUnit(1, 'player', -80, withEnemy ? 2 : null);
    (caster as any).sourceHexId = (config as any).map.playerHomeId;
    const units: Record<string, unknown>[] = [caster];
    if (withEnemy) {
        const enemy = standUnit(2, 'enemy', 60, 1);
        (enemy as any).sourceHexId = (config as any).map.enemyHomeId;
        units.push(enemy);
    }
    (snapshot as any).units = units;
    (snapshot as any).nextUnitId = 10;
    const model = new ZCGameModel(snapshot, () => 0.5, config as never);
    const state: Record<string, any> = (model as any).state;
    const credits: Record<string, unknown>[] = [];
    let structureLocked = false;
    const ticks = Math.round(seconds / 0.05);
    for (let i = 0; i < ticks; i += 1) {
        model.tick(0.05);
        const self = (state.units as Record<string, any>[]).find((u) => u.id === 1);
        if (self && (self.targetWallHexId !== null || self.targetBuildingHexId !== null)) structureLocked = true;
        for (const event of state.combatEvents as Record<string, any>[]) {
            if (event.skillId !== SKILL_BASKETBALL_FIRE) continue;
            if (event.sourceUnitId !== 1) continue;
            if (credits.includes(event)) continue;
            credits.push(event);
        }
    }
    const live = (state.units as Record<string, any>[]).find((u) => u.id === 1);
    return { credits, caster: live, structureLocked, state };
}

test('① 名单：篮球天才走「飞入段」，不再从上方落下', () => {
    assert.deepEqual([...ZC_BULLET_FLY_UNITS], ['68030'], '只有篮球火走飞入');
    assert.ok(!ZC_BULLET_DROP_UNITS.includes('68030'), '篮球火必须**退出**垂直下落名单');
    assert.equal(zcBulletDropHeightOf('68030'), 0, '不再给 startFromPx 的竖直起始高度');
    assert.ok(zcBulletFlyArcPx('68030') > 0, '飞入要带抛物峰高');
    //  两张表不许有交集：同一张卡要么掉、要么飞，同时成立等于两个位移叠加。
    for (const unitId of ZC_BULLET_FLY_UNITS) {
        assert.ok(!ZC_BULLET_DROP_UNITS.includes(unitId), `${unitId} 不能同时在两张表里`);
    }
});

test('① 飞入时长按距离算并夹在 [0.15, 0.55]，名单外返回 0', () => {
    assert.equal(zcBulletFlySecondsFor('68030', 0), ZC_BULLET_FLY_MIN_SECONDS, '贴脸也留一点过程');
    assert.equal(zcBulletFlySecondsFor('68030', 1e9), ZC_BULLET_FLY_MAX_SECONDS, '远距离别飞太久');
    const mid = zcBulletFlySecondsFor('68030', 240);
    assert.ok(mid > ZC_BULLET_FLY_MIN_SECONDS && mid < ZC_BULLET_FLY_MAX_SECONDS, '中距离按距离插值');
    assert.equal(zcBulletFlySecondsFor('68024', 240), 0, '名单外（急冻瓜仍走下落）返回 0');
    assert.equal(zcBulletFlySecondsFor(null, 240), 0);
    assert.equal(zcBulletFlySecondsFor(undefined, 240), 0);
    //  `NaN` 距离不能泄进时长（会让整条事件 `durationSeconds` 变 NaN，视图整层矩阵跟着坏）。
    assert.equal(zcBulletFlySecondsFor('68030', Number.NaN), ZC_BULLET_FLY_MIN_SECONDS);
});

test('① 抛物线：起飞 0、正中最高、落地 0；进度越界夹住', () => {
    assert.equal(zcBulletFlyProgress(0, 0.4), 0);
    assert.equal(zcBulletFlyProgress(0.4, 0.4), 1);
    assert.equal(zcBulletFlyProgress(-1, 0.4), 0, '越界夹住');
    assert.equal(zcBulletFlyProgress(99, 0.4), 1);
    assert.equal(zcBulletFlyProgress(0.2, 0), 1, '时长不成立时视为已落地');
    assert.equal(zcBulletFlyProgress(Number.NaN, 0.4), 1);
    assert.equal(zcBulletFlyArcOffsetPx(ZC_BULLET_FLY_ARC_PX, 0), 0, '离手那一刻不抬升');
    assert.equal(zcBulletFlyArcOffsetPx(ZC_BULLET_FLY_ARC_PX, 1), 0, '落地那一刻不悬空');
    assert.equal(zcBulletFlyArcOffsetPx(ZC_BULLET_FLY_ARC_PX, 0.5), ZC_BULLET_FLY_ARC_PX, '正中最高的那一拍');
    assert.equal(zcBulletFlyArcOffsetPx(Number.NaN, 0.5), 0, 'NaN 不许进 setPosition');
    assert.equal(zcBulletFlyArcOffsetPx(0, 0.5), 0);
});

test('② 真实对局：区域与白圈都钉在敌方单位坐标，不是施法者脚下', () => {
    const run = runMatch(true);
    const fires = run.credits.filter((e: any) => e.type === 'area');
    assert.ok(fires.length > 0, `40 秒内必须至少放一次篮球火（拿到 ${run.credits.length} 条事件）`);
    const casterX = run.caster?.freeX ?? Number.NaN;
    const casterY = run.caster?.freeY ?? Number.NaN;

    const zones = (run.state.groundZones as Record<string, any>[]).filter((z) => z.skillId === SKILL_BASKETBALL_FIRE);
    const rings = fires.filter((e: any) => e.effectPrefabPath === ZC_SKILL_RANGE_RING_PREFAB_PATH);
    const balls = fires.filter((e: any) => e.effectPrefabPath !== ZC_SKILL_RANGE_RING_PREFAB_PATH);
    //  打出强化那一击之后，区域可能已经过期 —— 只要有一处能验证就够。
    assert.ok(rings.length > 0, '篮球火必须画白圈');
    for (const ring of rings) {
        //  敌人站在 60，施法者在 -80：圆心必须落在敌人身上。
        assert.ok(Math.abs(ring.fromX - 60) < 1e-6, `白圈圆心 x = ${ring.fromX}，必须在敌方单位坐标（60）上`);
        assert.ok(Math.abs(ring.fromX - casterX) > 1, '白圈圆心不许落在施法者自己的 x 上');
        assert.equal(ring.fromX, ring.toX, '白圈 from/to 同点（它不是会飞的弹道）');
    }

    const flying = balls.filter((e: any) => (e.flyInSeconds ?? 0) > 0);
    assert.ok(flying.length > 0, '篮球火的表现事件必须带飞入段（第 53 批）');
    for (const event of flying) {
        //  ② 子弹从施法者出发：起点就是施法者坐标。
        assert.ok(Math.abs(event.flyFromX - casterX) < 1e-6, `飞入起点 x = ${event.flyFromX} 必须是施法者 ${casterX}`);
        assert.ok(Math.abs(event.flyFromY - casterY) < 1e-6, '飞入起点 y 必须是施法者');
        //  ① 命中区域在目标坐标：`to` 就是区域圆心，不是起点。
        assert.ok(Math.abs(event.toX - 60) < 1e-6, `飞入终点 x = ${event.toX} 必须是敌方单位坐标`);
        //  第 56 批：68030 改走「弹道雨」通道（150 px/s）⇒ 上限换成弹道雨自己的那一条。
        //  0.55 是「600 px/s 飞 40px」的单颗飞入夹子，拿它夹 150 px/s 会把弧线抹平。
        const rainUpper = event.flyToX !== undefined;
        const minSeconds = rainUpper ? ZC_BULLET_RAIN_MIN_SECONDS : ZC_BULLET_FLY_MIN_SECONDS;
        const maxSeconds = rainUpper ? ZC_BULLET_RAIN_MAX_SECONDS : ZC_BULLET_FLY_MAX_SECONDS;
        assert.ok(event.flyInSeconds >= minSeconds && event.flyInSeconds <= maxSeconds,
            `飞入时长 ${event.flyInSeconds} 越界（${minSeconds}~${maxSeconds}）`);
        //  68030 已退出下落名单 ⇒ `dropFromPx` 恒 0（字段在，但不产生竖直偏移）。
        assert.ok(!event.dropFromPx, '同一帧不许既有下落又有飞入');
        assert.ok(event.flyArcPx > 0, '飞入要带抛物峰高');
        //  事件寿命必须容下整段飞行，否则会「飞到一半凭空消失」。
        assert.ok(event.durationSeconds >= event.flyInSeconds,
            `事件寿命 ${event.durationSeconds} 短于飞行 ${event.flyInSeconds}`);
    }
    for (const zone of zones) {
        assert.ok(Math.abs(zone.x - 60) < 1e-6, `区域判定圆心 x = ${zone.x} 必须是敌方单位坐标`);
    }
});

test('③ 真实对局：没有敌方单位（只剩城墙 / 建筑）就不放篮球火', () => {
    const run = runMatch(false);
    const fires = run.credits.filter((e: any) => e.type === 'area' && e.skillId === SKILL_BASKETBALL_FIRE);
    assert.equal(fires.length, 0, `没有敌方单位时一条篮球火表现都不许有（拿到 ${fires.length} 条）`);
    const zones = (run.state.groundZones as Record<string, any>[]).filter((z) => z.skillId === SKILL_BASKETBALL_FIRE);
    assert.equal(zones.length, 0, '一个 30848 区域都不许建');
    //  前提校验：这一局确实「退化成了打城墙 / 打建筑」—— 否则本用例什么都没测到。
    assert.ok(run.structureLocked, '场景应当退化成「锁定城墙 / 建筑」，正是要盖住的那条路径');
    //  前提校验 2：在放不出来之前必须先「有在出手」（强化那一击走 CD 节拍），
    //  否则「没区域」可能只是因为它一次都没打。`finishedAttackCount` 由模型自己累计。
    const attacks = run.state.units.find((u: any) => u.id === 1)?.completedAttackCount ?? 0;
    assert.ok(attacks > 0, `必须确实出手过（completedAttackCount = ${attacks}）`);
});

test('③ 闸门只盖「原地 · 以目标为圆心」这一档，自体中心与移动区域不受影响', () => {
    //  闸门本体：`target.kind !== 'unit'` 就直接 return。
    assert.match(
        ATTACK_SOURCE,
        /if \(!zoneMovingEarly && !zoneSelfCenteredEarly && target\.kind !== 'unit'\) \{/,
        '条件必须排除 moving 与 selfCentered 两档',
    );
    //  `zoneSelfCentered` / `zoneMoveSpeed` 的取值口径与后面 `selfCentered` / `moving` 同一套。
    assert.match(ATTACK_SOURCE, /const zoneSelfCenteredEarly = skillParams \? \(skillParams\.zoneSelfCentered \?\? 0\) > 0 : false;/);
    assert.match(ATTACK_SOURCE, /const zoneMovingEarly = empowered && skillParams \? \(skillParams\.zoneMoveSpeed \?\? 0\) > 0 : false;/);
    //  圆心仍然只认 `target.x/y`（不许被闸门顺手改成 `from`）。
    assert.match(ATTACK_SOURCE, /: \(selfCentered \? from\.x : target\.x \+ Math\.cos\(angle\) \* offset\);/);
});

test('② 视图按「自己的飞行时长」插值，落下与飞入互斥', () => {
    assert.match(
        VIEW_SOURCE,
        /const t = zcBulletFlyProgress\(now - event\.startedAt, flySeconds\);/,
        '飞行进度用自己的时长，不是事件进度（事件要活满区域寿命）',
    );
    //  第 55 批（2026-11-26）：飞入段从「对称抛物线」升级成**二次贝塞尔** ——
    //  抛物线只有峰高一个自由度，一批子弹会重叠成同一条线；贝塞尔多一个横向控制点，
    //  才散得开扇形。峰高口径不变：`flyArcPx` 仍是中点处的抬升量（见 `zcBulletRainPath`）。
    assert.match(
        VIEW_SOURCE,
        /const landX = event\.flyToX \?\? event\.toX;/,
        '落点优先 flyTo（弹道雨的随机落点），缺省退回判定圆心 to',
    );
    assert.match(
        VIEW_SOURCE,
        /const path = zcBulletRainPath\(/,
        '轨迹用二次贝塞尔求值，不再是单条抛物线',
    );
    assert.match(
        VIEW_SOURCE,
        /zcBezierXAt\(path, t\),/,
        'x 按贝塞尔进度走（从起点到落点，不是线性插值）',
    );
    assert.match(
        VIEW_SOURCE,
        /zcBezierYAt\(path, t\) \+ \(event\.visualLiftPx \?\? 0\),/,
        'y 按贝塞尔进度走 + 表现抬升',
    );
    assert.match(
        VIEW_SOURCE,
        /const flyingIn = flySeconds > 0 && event\.flyFromX !== undefined && event\.flyFromY !== undefined;/,
        '缺字段一律退回原地播（存量逐字不变）',
    );
    //  区域一侧：起点取的是**施法者现在的位置**（`unitPosition(source)`），不是 `zone` 自己的坐标。
    //  并且只取一次就拆成两个数 —— `unitPosition` 返回的是每单位复用的 scratch。
    assert.match(
        ZONE_SOURCE,
        /const origin = context\.unitPosition\(source\);/,
        '飞入起点必须是施法者坐标',
    );
    assert.match(
        ZONE_SOURCE,
        /flySeconds = zcBulletFlySecondsFor\(sourceUnitId, Math\.hypot\(zone\.x - originX, zone\.y - originY\)\);/,
        '飞行时长按「施法者 → 圆心」的距离算',
    );
    assert.match(
        ZONE_SOURCE,
        /durationSeconds: Math\.max\(zone\.waveInterval, zcEffectDurationOf\(zone\.effectPrefabPath\), flySeconds\),/,
        '寿命要容下整段飞行',
    );
});
