import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { buildSettlementMvp } from '../assets/script/app/zcds/model/ZCSettlementMvp';

/**
 * 结算 MVP 的**逐卡伤害归属**（`ZCGameModel.damageCards`）。
 *
 * MVP 立绘位卖的是「本局赢家输出最高的**卡**」的骨骼模型，per-owner 的 `damageStats` 分不出
 * 同阵营多张卡 ⇒ 模型必须按「实例 → 卡身份」记账，并且单位死亡 / 子弹飞行期间不能丢归属。
 * 这条用一局真实射击覆盖三条路径：
 *  ① 打单位：攻击方的卡 +伤害，被打的卡 +承伤；
 *  ② 打城墙：攻击方的卡 +伤害（城墙没有卡身份，不进承伤）；
 *  ③ `damageStats` 的 owner 口径不受影响（老结算 / 统计上报还在用）。
 */

const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams'];
const tables = Object.fromEntries(names.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source)
        ? source
        : source.v.map((row: unknown[]) => Object.fromEntries(source.k.map((key: string, i: number) => [key, row[i]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

const captured = captureZCMatchConfig();
const config: ZCMatchConfig = {
    ...captured,
    rules: { ...captured.rules, enemyAiIntervalSeconds: 10000 },
    units: captured.units.map(definition => ({
        ...definition,
        moveSpeed: 0,
        attackRange: 600,
        attackInterval: 10000,
        attackProfile: { ...definition.attackProfile, mode: 'projectile' },
    })),
};
const definition = config.units.find(item => !item.flying)!;

function makeUnit(id: number, owner: 'player' | 'enemy', cardId: string, x: number, y: number): ZCUnitState {
    return {
        id, owner, unitId: definition.unitId, cardId, tier: 1, sourceHexId: config.map.playerHomeId,
        targetHexId: null, progress: 0, hp: definition.maxHp, maxHp: definition.maxHp,
        battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000,
        attackHitDone: false, hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

/** 与 `zcds-projectile-structure-block.test.ts` 同一套直线布局：A（我方）→ B（中间格）→ C（敌方）。*/
function layout(): { homeId: number; midId: number; farId: number } {
    const homeId = config.map.playerHomeId;
    const home = config.map.hexes[homeId];
    const midId = home.neighbors[0];
    const mid = config.map.hexes[midId];
    const dirX = mid.x - home.x;
    const dirY = mid.y - home.y;
    const length = Math.hypot(dirX, dirY) || 1;
    let farId = -1;
    let bestDot = -Infinity;
    for (const id of mid.neighbors) {
        if (id === homeId) continue;
        const hex = config.map.hexes[id];
        const dot = ((hex.x - mid.x) * dirX + (hex.y - mid.y) * dirY) / length;
        if (dot > bestDot) { bestDot = dot; farId = id; }
    }
    assert.ok(farId >= 0 && bestDot > 0, '地图上必须找到 A→B→C 三点共线的三格');
    return { homeId, midId, farId };
}

/** 打一枪（B 的归属决定子弹撞墙还是穿过去打 C 的兵），返回跑完的模型。*/
function shoot(midOwner: 'player' | 'enemy', wallHp: number): ZCGameModel {
    const { homeId, midId, farId } = layout();
    const snapshot = ZCGameModel.createInitialState(() => 0.1, config);
    const wallMax = Math.max(500, Math.round(definition.maxHp * 5));
    Object.assign(snapshot.hexes[midId], {
        owner: midOwner, state: 'developed', developmentResolved: true,
        building: 'tower', tier: 1, hp: 1000, maxHp: 1000,
        wallHp, wallMaxHp: wallMax, constructionRemainingSeconds: 0, constructionTotalSeconds: 0,
    });
    const home = config.map.hexes[homeId];
    const far = config.map.hexes[farId];
    snapshot.units = [
        makeUnit(1, 'player', 'player-card', home.x, home.y),
        makeUnit(2, 'enemy', 'enemy-card', far.x, far.y),
    ];
    snapshot.nextUnitId = 3;
    const model = new ZCGameModel(snapshot, () => 0.1, config);
    const attacker = model.snapshot.units[0];
    attacker.targetUnitId = 2;
    (model as unknown as { sendAttack(unit: ZCUnitState): void }).sendAttack(attacker);
    for (let step = 0; step < 200 && model.snapshot.projectiles.length > 0; step += 1) model.tick(0.05);
    return model;
}

test('打单位：攻击方的卡记输出，被打的卡记承伤（owner 统计同步）', () => {
    const model = shoot('player', Math.max(500, Math.round(definition.maxHp * 5)));
    const cards = model.damageCards;
    const attacker = cards.find(card => card.cardId === 'player-card');
    const target = cards.find(card => card.cardId === 'enemy-card');
    assert.ok(attacker, '攻击方的卡必须进逐卡账本');
    assert.ok(attacker.damage > 0, '子弹命中敌人 ⇒ 输出 > 0');
    assert.equal(attacker.damageTaken, 0, '攻击方没挨打');
    // 目标已被打掉：死亡摘除后仍要保留承伤归属
    assert.ok(target, '被打的卡必须进逐卡账本（死亡也不能丢）');
    assert.ok(target.damageTaken > 0);
    assert.equal(target.damage, 0);
    // 老的 per-owner 统计口径不变
    assert.ok(model.damageStats.player.dealt > 0);
    assert.ok(model.damageStats.enemy.taken > 0);
});

test('打城墙：城墙没有卡身份 ⇒ 只有输出进卡账本，没有承伤', () => {
    const model = shoot('enemy', Math.max(500, Math.round(definition.maxHp * 5)));
    const attacker = model.damageCards.find(card => card.cardId === 'player-card');
    assert.ok(attacker, '拆墙也算这张卡的输出');
    assert.ok(attacker.damage > 0);
    assert.equal(model.damageCards.find(card => card.cardId === 'enemy-card'), undefined,
        '墙不是卡牌兵 ⇒ 不给敌方卡记承伤');
});

test('逐卡账本可以直接喂 `buildSettlementMvp`：赢家阵营输出最高的卡当选', () => {
    const model = shoot('player', Math.max(500, Math.round(definition.maxHp * 5)));
    const cards = model.damageCards.map(card => ({
        ...card, name: card.cardId, prefabPath: `units/${card.cardId}`, prefabSize: 1, level: 0,
    }));
    const mvp = buildSettlementMvp(cards, 'player');
    assert.ok(mvp, '本局有输出 ⇒ 必须出 MVP');
    assert.equal(mvp.cardId, 'player-card');
    assert.equal(mvp.owner, 'player');
    assert.equal(mvp.dealtRateText, '100%');
});
