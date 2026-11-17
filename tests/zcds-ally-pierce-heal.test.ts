/**
 * 第 10 批：102401「裂变共鸣」→「贯穿滋养」，机制换成「子弹穿过己方单位回血」。
 *
 * 用户口径（2026-11-17，两条消息合成最终版）
 * ──────────────────────────────────────────
 * 「102401 的技能机制修改，子弹穿过己方单位会回复生命值 3/4/5% 的生命值，
 *   一颗子弹最多给 3/4/5 个己方单位回复，**所有卡牌都移除普通攻击减少冷却时间的这个机制**，
 *   修改后同步相关的配置，并且修改技能名字」
 *
 * 拆成三件事，下面的用例一一对应：
 *   ① 配表：102401 三档主链三空 + `allyPierceHealPct` / `allyPierceMaxCount` 两个新参数，
 *      攻速留在子链 192401，名字改「贯穿滋养」；
 *   ② 全卡下线：`cdReduceOnHit` 这条 statId 从代码四处登记、字段、消费点、快照白名单、
 *      两份 JSON 全表一并拆除 —— 不是「留着不用」；
 *   ③ 结算：友军通道与 `hit` 互斥（不吃穿透、不扣伤害、不出命中事件），
 *      排除施法者本人、同一颗弹道对同一单位只回一次、**每颗弹道**各有 3/4/5 的额度。
 *
 * 🔴 三个最容易踩的点：
 *   ① 额度是**每颗弹道**的，不是每张卡的 —— 拷到弹道的 `allyHealLeft` 上逐颗自减，
 *      每帧回查 `skillParamJson` 会变成「整轮齐射共享 5 次」；
 *   ② 回血比例按**被治疗单位自己的最大生命**算，不是施法者的（法师血少、坦克血多，
 *      写成施法者的话这条被动对坦克几乎没有意义）；
 *   ③ 友军绝不能进 `hitIds` / 不能写 `remainingPierces`：那是敌军碰撞的名额，
 *      借它扣一次就等于「路过的友军替你挡了一发穿透」。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCProjectileState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCProjectileSystem } from '../assets/script/app/zcds/model/systems/ZCProjectileSystem';
import { readSource } from './helpers/source-text';

const REMOTE = 'assets/remoteRef';
const CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client';

// ── 共享：两份产物的读表工具 ─────────────────────────────────────────────────

function remoteRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`${REMOTE}/${name}.json`, 'utf8')) as { k: string[]; v: unknown[][] };
    return source.v.map((row) => Object.fromEntries(source.k.map((key, index) => [key, row[index]])));
}

function clientRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`${CLIENT}/${name}.json`, 'utf8')) as Array<Record<string, unknown>>;
}

function bothTables(name: string): Array<Array<Record<string, unknown>>> {
    return [remoteRows(name), clientRows(name)];
}

function skillParams(row: Record<string, unknown>): Record<string, number> {
    const raw = row.skillParamJson;
    if (raw === null || raw === undefined || raw === '') return {};
    return JSON.parse(String(raw)) as Record<string, number>;
}

const TIERS = [3, 4, 5];
const HEAL_PCT = [0.03, 0.04, 0.05];
const ATTACK_SPEED = [0.20, 0.22, 0.24];
const UNLOCK = [3, 10, 22];
const MAIN_MODIFIER = [94024011, 94024012, 94024013];
const SLOT_MODIFIER = [94924011, 94924012, 94924013];

// ── 一、配表 ────────────────────────────────────────────────────────────────

test('102401「贯穿滋养」：主链三空 + 两个新参数 + 混搭尾，名字跟着机制换', () => {
    for (const rows of bothTables('pvpSkillPlan')) {
        const hits = rows.filter((row) => Number(row.skillChainId) === 102401)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(hits.length, 3, '102401 三档');
        for (const [tier, row] of hits.entries()) {
            assert.equal(String(row.unitId), '68024', '归属 68024 急冻瓜');
            assert.equal(String(row.skillName), '贯穿滋养',
                `L${tier + 1} 必须改名：旧名「裂变共鸣」语义是 CD 共鸣，跟新机制毫无关系`);
            assert.equal(Number(row.modifierId), MAIN_MODIFIER[tier], `L${tier + 1} 修改器号不能动（J 表 upsert 靠它）`);
            assert.equal(Number(row.unlockHeroLevel), UNLOCK[tier], `L${tier + 1} 解锁档位（技能 1 口径 3/10/22）`);
            //  🔴 主链三空：这条被动的属性全走子链槽位与 `mix.*`，主链不挂任何 statId。
            assert.equal(row.statId ?? null, null, `L${tier + 1} 主链 statId 必须为空`);
            assert.equal(row.operation ?? null, null, `L${tier + 1} 主链 operation 必须为空`);
            assert.equal(row.value ?? null, null, `L${tier + 1} 主链 value 必须为空`);
            assert.equal(String(row.behaviorKey), 'skill_params', `L${tier + 1} 走参数袋车道`);

            const parameter = skillParams(row);
            assert.ok(Math.abs(parameter.allyPierceHealPct - HEAL_PCT[tier]) < 1e-9,
                `L${tier + 1} 单次回复 ${HEAL_PCT[tier] * 100}% 最大生命`);
            assert.equal(parameter.allyPierceMaxCount, TIERS[tier],
                `L${tier + 1} 每颗子弹最多回复 ${TIERS[tier]} 个己方单位`);
            //  混搭尾（三档同值，整卡 VP 缺口口径，与第 8 批一致）。
            assert.ok(Math.abs(parameter['mix.attack.addRate'] - 0.35) < 1e-9, `L${tier + 1} 攻击尾巴`);
            assert.ok(Math.abs(parameter['mix.attackRange.addRate'] - 0.35) < 1e-9, `L${tier + 1} 范围尾巴`);
            //  旧的冷却回退字段一个都不许在。
            assert.equal(parameter.cdReduceOnHit, undefined, `L${tier + 1} 参数袋里不许再有冷却回退`);
        }
    }
});

test('102401 攻速走子链 192401（三档同档解锁），与主链共用一个技能名', () => {
    for (const rows of bothTables('pvpSkillPlan')) {
        const slots = rows.filter((row) => Number(row.skillChainId) === 192401)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(slots.length, 3, '子链必须三档（漏一档 = 那一档尾巴凭空消失）');
        for (const [tier, row] of slots.entries()) {
            assert.equal(String(row.unitId), '68024');
            assert.equal(String(row.skillName), '贯穿滋养', `L${tier + 1} 子链名字要跟主链一致`);
            assert.equal(Number(row.modifierId), SLOT_MODIFIER[tier]);
            assert.equal(row.statId, 'attackSpeed', `L${tier + 1} 子链只承载攻速`);
            assert.equal(row.operation, 'addRate');
            assert.ok(Math.abs(Number(row.value) - ATTACK_SPEED[tier]) < 1e-9, `L${tier + 1} 攻速 ${ATTACK_SPEED[tier]}`);
            assert.equal(Number(row.unlockHeroLevel), UNLOCK[tier], `L${tier + 1} 与主链同档，否则尾巴会晚一格生效`);
        }
    }
});

test('K 表 102401 六行：名称 / 描述 / 解锁档位 / 两段修改器引用', () => {
    for (const rows of bothTables('armySkillLevelUp')) {
        const hits = rows.filter((row) => Number(row.id) === 102401)
            .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
        assert.equal(hits.length, 3, 'K 表三档');
        for (const [tier, row] of hits.entries()) {
            assert.equal(String(row.name), '贯穿滋养', `L${tier + 1} 名字`);
            assert.equal(Number(row.unlockarmylevel), UNLOCK[tier], `L${tier + 1} 解锁档位`);
            assert.equal(Number(row.armySkillType), 1, '被动技能');
            assert.deepEqual(row.modfiy, [MAIN_MODIFIER[tier], SLOT_MODIFIER[tier]],
                `L${tier + 1} 主链 + 子链两段引用，缺一段就等于少一条属性`);
            const desc = String(row.desc);
            //  卡片 UI 真读这一份（不是 pvpSkillPlan.desc），所以文案必须在这里也成立。
            assert.match(desc, new RegExp(`回复${TIERS[tier]}%最大生命`), `L${tier + 1} 描述要写清回复比例`);
            assert.match(desc, new RegExp(`最多回复${TIERS[tier]}个己方单位`), `L${tier + 1} 描述要写清每颗子弹的额度`);
            assert.match(desc, new RegExp(`攻击速度提高${Math.round(ATTACK_SPEED[tier] * 100)}%`), `L${tier + 1} 攻速文案`);
            assert.ok(!desc.includes('冷却'), `L${tier + 1} 描述里不许再提冷却：${desc}`);
        }
    }
});

test('全表守卫：两份 pvpSkillPlan 再没有任何一行写 cdReduceOnHit', () => {
    for (const rows of bothTables('pvpSkillPlan')) {
        const leftovers = rows.filter((row) => String(row.statId ?? '') === 'cdReduceOnHit'
            || String(row.skillParamJson ?? '').includes('cdReduceOnHit'));
        assert.equal(leftovers.length, 0,
            `「所有卡牌都移除普通攻击减少冷却时间的这个机制」⇒ 一个字节都不该剩，实际 ${leftovers.length} 行`);
    }
});

test('代码侧：cdReduceOnHit 的四处登记 + 字段 + 消费点 + 快照白名单都已拆干净', () => {
    const schema = readSource('assets/script/app/zcds/model/ZCStatSchema.ts');
    const runtime = readSource('assets/script/app/zcds/model/ZCModifierRuntime.ts');
    const resolution = readSource('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts');
    const codec = readSource('assets/script/app/zcds/model/ZCSnapshotCodec.ts');
    const types = readSource('assets/script/app/zcds/model/ZCGameTypes.ts');

    //  四处登记：`ZCStatId` 联合 / `STAT_IDS` / `UNIT_STAT_IDS` / `STAT_TO_PATCH`。
    assert.ok(!/'cdReduceOnHit'/.test(schema), 'ZCStatSchema 里还有 cdReduceOnHit 的登记');
    assert.ok(!/cdReduceOnHit\??:/.test(runtime), 'ZCModifierRuntime 上还留着 cdReduceOnHit 字段');
    assert.ok(!/reduceCooldownsOnHit/.test(resolution), '消费点 reduceCooldownsOnHit 没拆');
    assert.ok(!/ZC_CD_REDUCE_READY_KEYS/.test(resolution), '回退字段清单常量没拆');
    assert.ok(!/cdReducePaidAt/.test(types), 'ZCUnitState 上还留着同帧去重戳');
    assert.ok(!/cdReducePaidAt/.test(codec), '快照白名单里还留着 cdReducePaidAt');
});

test('卡牌 68024 的描述已换成「贯穿滋养」，三份源（两份 JSON）同步', () => {
    for (const rows of bothTables('pvpCard')) {
        const card = rows.find((row) => Number(row.id) === 68024);
        assert.ok(card, '找不到 68024 急冻瓜');
        const desc = String(card.description ?? '');
        assert.match(desc, /贯穿滋养/, `卡面描述要写新机制：${desc}`);
        assert.ok(!desc.includes('裂变共鸣'), `旧名必须清掉：${desc}`);
        assert.ok(!desc.includes('冷却'), `描述里不许再提冷却：${desc}`);
    }
});

// ── 二、结算：弹道穿行治疗 ───────────────────────────────────────────────────

type AllyPass = { projectileId: number; unitId: number };

function makeUnit(id: number, owner: string, x: number, hp = 1000, maxHp = 1000): ZCUnitState {
    return {
        id, owner, unitId: '68024', cardId: '68024', tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp, maxHp, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

function makeProjectile(overrides: Partial<ZCProjectileState> = {}): ZCProjectileState {
    return {
        id: 1, type: 'projectile', owner: ZCOwner.Player,
        sourceUnitId: 1, sourceCardId: '68024',
        targetKind: 'unit', targetId: 99, targetUnitId: 99,
        skillId: 30671, skillName: '急冻瓜普攻',
        effectKey: null, projectileKey: null, effectPrefabPath: null,
        fromX: 0, fromY: 0, toX: 400, toY: 0,
        x: 0, y: 0, previousX: 0, previousY: 0,
        velocityX: 500, velocityY: 0,
        baseDamage: 100, damage: 100, radius: 0,
        collisionRadius: 3, canHitAir: true,
        empowered: false, criticalHit: false,
        startedAt: 0, durationSeconds: 1,
        remainingPierces: 0, hitUnitIds: [],
        executeChance: 0, onHitStatusId: undefined, legacyBuffs: [],
        ...overrides,
    } as unknown as ZCProjectileState;
}

interface PassRun {
    passes: AllyPass[];
    hits: Array<{ id: number; damage: number }>;
    projectile: ZCProjectileState;
    remainingPierces: number;
    baseDamage: number;
}

/**
 * 跑一颗弹道的完整飞行过程，记录「穿过的友军」与「真正结算的敌人」。
 * `units` 必须包含施法者本人（id = 1）—— 它就是用来验证「排除自己」的。
 */
function runPass(projectile: ZCProjectileState, units: ZCUnitState[]): PassRun {
    const system = new ZCProjectileSystem();
    const projectiles: ZCProjectileState[] = [projectile];
    const passes: AllyPass[] = [];
    const hits: Array<{ id: number; damage: number }> = [];
    system.beginStep(units);
    for (let step = 0; step < 60; step += 1) {
        const now = 0.05 * (step + 1);
        system.update(projectiles, 0.05, {
            now,
            units,
            distanceScale: 0.3,
            structureTargets: () => {},
            hit: (shot, target) => { hits.push({ id: target.id, damage: Math.round(shot.baseDamage) }); },
            allyPass: (shot, unit) => { passes.push({ projectileId: shot.id, unitId: unit.id }); },
            effectiveDefinition: () => ({ bodyRadius: 6, flying: false }) as never,
        });
        if (!projectiles.length) break;
    }
    return {
        passes, hits, projectile,
        remainingPierces: projectile.remainingPierces ?? 0,
        baseDamage: projectile.baseDamage,
    };
}

test('穿过 3 个友军各回一次，第 4 个不再触发（额度 = 3）', () => {
    //  施法者 id=1 站在 60，验证完「排除自己」之后再看 3 个真友军。
    const units = [
        makeUnit(1, ZCOwner.Player, 60),
        makeUnit(2, ZCOwner.Player, 120),
        makeUnit(3, ZCOwner.Player, 180),
        makeUnit(4, ZCOwner.Player, 240),
        makeUnit(5, ZCOwner.Player, 300),
    ];
    const run = runPass(makeProjectile({ allyHealPct: 0.03, allyHealLeft: 3 }), units);
    assert.deepEqual(run.passes.map((pass) => pass.unitId), [2, 3, 4],
        '额度 3 ⇒ 只治疗前 3 个路过的友军；且施法者本人 1 被排除在外');
    assert.equal(run.projectile.allyHealLeft, 0, '额度用完即归零');
    assert.deepEqual(run.projectile.allyHealIds, [2, 3, 4], '去重名单要写回弹道（快照能还原它）');
});

test('额度 5 时一行 5 个友军全部回血（三档 3/4/5 的 L3）', () => {
    const units = [
        makeUnit(1, ZCOwner.Player, -40),
        ...[2, 3, 4, 5, 6].map((id, index) => makeUnit(id, ZCOwner.Player, 60 + index * 60)),
    ];
    const run = runPass(makeProjectile({ allyHealPct: 0.05, allyHealLeft: 5 }), units);
    assert.deepEqual(run.passes.map((pass) => pass.unitId), [2, 3, 4, 5, 6]);
});

test('同一颗弹道对同一个友军只回一次（跨两个扫掠步也不会重复）', () => {
    //  x=25 正好落在第 1 步末 / 第 2 步初的交界上 ⇒ 相邻两段扫掠都会碰到它。
    const units = [makeUnit(1, ZCOwner.Player, -40), makeUnit(2, ZCOwner.Player, 25)];
    const run = runPass(makeProjectile({ allyHealPct: 0.03, allyHealLeft: 5 }), units);
    assert.deepEqual(run.passes.map((pass) => pass.unitId), [2], '只回一次（`allyHealIds` 去重）');
    assert.equal(run.projectile.allyHealLeft, 4, '重复穿过不额外扣额度');
});

test('友军不吃穿透名额、不扣伤害、不产生命中事件（与 hit 是两条互斥通道）', () => {
    const units = [
        makeUnit(1, ZCOwner.Player, -40),
        makeUnit(2, ZCOwner.Player, 60),
        makeUnit(3, ZCOwner.Enemy, 180),
    ];
    const run = runPass(makeProjectile({ remainingPierces: 2, allyHealPct: 0.03, allyHealLeft: 3 }), units);
    assert.deepEqual(run.passes.map((pass) => pass.unitId), [2], '友军只被治疗');
    assert.deepEqual(run.hits.map((hit) => hit.id), [3], '命中事件只有敌军 —— 友军不能走 hit');
    assert.equal(run.remainingPierces, 1, '只有打敌军才扣穿透（2 → 1）；友军一次都不该扣');
    assert.equal(run.baseDamage, 100, '没配 pierceFalloff ⇒ 伤害不衰减；友军更不许改 baseDamage');
});

test('不配 allyHealPct 时友军完全透明（存量弹道逐字不变）', () => {
    const units = [
        makeUnit(1, ZCOwner.Player, -40),
        makeUnit(2, ZCOwner.Player, 60),
        makeUnit(3, ZCOwner.Enemy, 180),
    ];
    //  🔴 只给额度、不给比例：这是「参数只填了一半」的脏配，必须当没配处理。
    const run = runPass(makeProjectile({ allyHealLeft: 3 }), units);
    assert.deepEqual(run.passes, [], '缺比例 ⇒ 一次 allyPass 都不许有');
    assert.deepEqual(run.hits.map((hit) => hit.id), [3], '敌军照旧');
});

test('死亡的友军不参与穿行治疗', () => {
    const dead = makeUnit(2, ZCOwner.Player, 60, 0);
    dead.battleState = 'dead';
    const units = [makeUnit(1, ZCOwner.Player, -40), dead, makeUnit(3, ZCOwner.Player, 120)];
    const run = runPass(makeProjectile({ allyHealPct: 0.03, allyHealLeft: 5 }), units);
    assert.deepEqual(run.passes.map((pass) => pass.unitId), [3], '尸体不该被治疗');
});

// ── 三、快照 ────────────────────────────────────────────────────────────────

test('弹道三个新字段已登记进快照校验（丢了就等于读档后白重算一遍）', () => {
    const source = readSource('assets/script/app/zcds/model/ZCSnapshotCodec.ts');
    assert.match(source, /projectile\.allyHealPct/, '比例要校验（0~1）');
    assert.match(source, /projectile\.allyHealLeft/, '剩余额度要校验（非负）');
    assert.match(source, /projectile\.allyHealIds/, '已治名单要校验（去重且 < nextUnitId）');
});

// ── 四、全链路：真的把血加上去 ───────────────────────────────────────────────

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

function battleUnit(id: number, owner: 'player' | 'enemy', x: number, hp: number, maxHp = 1000): ZCUnitState {
    const definition = matchConfig.units.find((item) => !item.flying)!;
    return {
        id, owner, unitId: definition.unitId, cardId: '68024', tier: 1,
        sourceHexId: matchConfig.map.playerHomeId, targetHexId: null, progress: 0,
        hp, maxHp, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

test('全链路：弹道穿过友军真的回 3% 最大生命，且封顶 maxHp（走 healUnit）', () => {
    //  友军 1000 血里只剩 500 ⇒ 回 1000 × 3% = 30 ⇒ 530。
    const units = [
        battleUnit(1, 'player', -80, 1000),
        battleUnit(2, 'player', -20, 500),
        battleUnit(3, 'enemy', 300, 1000),
    ];
    const snapshot = ZCGameModel.createInitialState(() => 0.1, matchConfig);
    snapshot.units = units;
    snapshot.nextUnitId = 10;
    const model = new ZCGameModel(snapshot, () => 0.1, matchConfig);

    const projectile = makeProjectile({
        owner: ZCOwner.Player, sourceUnitId: 1, targetId: 3, targetUnitId: 3,
        fromX: -80, fromY: 0, x: -80, y: 0, toX: 300, toY: 0,
        velocityX: 100, durationSeconds: 5,
        allyHealPct: 0.03, allyHealLeft: 3,
    });
    (model as unknown as { state: { projectiles: ZCProjectileState[] } }).state.projectiles.push(projectile);

    for (let step = 0; step < 30; step += 1) model.tick(0.05);

    const ally = (model as unknown as { state: { units: ZCUnitState[] } }).state.units.find((unit) => unit.id === 2)!;
    assert.ok(Math.abs(ally.hp - 530) < 1e-6, `友军要回 30 点血（实际 ${ally.hp}）`);
    assert.equal(projectile.allyHealLeft, 2, '额度已扣一次');
});

test('全链路：满血友军被穿过不回出溢出（healUnit 封顶 maxHp）', () => {
    const units = [
        battleUnit(1, 'player', -80, 1000),
        battleUnit(2, 'player', -20, 1000),
        battleUnit(3, 'enemy', 300, 1000),
    ];
    const snapshot = ZCGameModel.createInitialState(() => 0.1, matchConfig);
    snapshot.units = units;
    snapshot.nextUnitId = 10;
    const model = new ZCGameModel(snapshot, () => 0.1, matchConfig);
    const projectile = makeProjectile({
        owner: ZCOwner.Player, sourceUnitId: 1, targetId: 3, targetUnitId: 3,
        fromX: -80, fromY: 0, x: -80, y: 0, toX: 300, toY: 0,
        velocityX: 100, durationSeconds: 5,
        allyHealPct: 0.05, allyHealLeft: 5,
    });
    (model as unknown as { state: { projectiles: ZCProjectileState[] } }).state.projectiles.push(projectile);

    for (let step = 0; step < 30; step += 1) model.tick(0.05);

    const ally = (model as unknown as { state: { units: ZCUnitState[] } }).state.units.find((unit) => unit.id === 2)!;
    assert.equal(ally.hp, 1000, '封顶 maxHp，不许超过');
    assert.equal(projectile.allyHealLeft, 4, '额度照样扣 —— 满血路过也算「用掉一个名额」');
});
