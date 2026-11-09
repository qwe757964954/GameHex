import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

/**
 * 2026-11-06 需求：「单位角色子弹攻击如果是只造成一次伤害的，只会伤害接触的单位
 * （角色 / 城墙 / 建筑），不会穿透」。
 *
 * 改前 `projectileStructureTarget` 在 `targetKind === 'unit'` 时直接 `null` ⇒ 子弹锁定敌人时
 * 城墙 / 建筑**完全不参与判定**，会出现「子弹穿过城墙打掉里面的单位」。
 *
 * 这一条钉三件事：
 *  ① 单段子弹（`remainingPierces = 0`）飞向墙后的单位 ⇒ 被墙拦下：**墙掉血、单位满血**；
 *  ② 墙体拦下之后子弹**不再往前飞**（一次性伤害的子弹不穿透）；
 *  ③ 自家格的墙不拦自己的子弹（`owner === projectile.owner` 跳过），否则会自伤城墙。
 */

const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight'];
const tables = Object.fromEntries(names.map(name => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => Object.fromEntries(source.k.map((key: string, i: number) => [key, row[i]])))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

const captured = captureZCMatchConfig();
//  ⚠️ 不要覆盖 `combatDistanceScale`：结构目标的判定半径 = `STRUCTURE_TARGET_BODY_RADIUS × scale`，
//  真实值 0.3 时正好约等于一格半径（21）；改成 1 会变成 80，三格之外都会被误判成"撞墙"。
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

function makeUnit(id: number, owner: 'player' | 'enemy', x: number, y: number): ZCUnitState {
    return {
        id, owner, unitId: definition.unitId, cardId: 'test', tier: 1, sourceHexId: config.map.playerHomeId,
        targetHexId: null, progress: 0, hp: definition.maxHp, maxHp: definition.maxHp,
        battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000,
        attackHitDone: false, hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

/** 选一格「射手格 A → 中间格 B → 目标格 C」的直线布局（B、C 都从 A 的邻居方向延伸出去）。 */
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
    assert.ok(farId >= 0 && bestDot > 0, '地图上必须能找到 A→B→C 三点共线的三格，否则这条测试测不到"穿墙"');
    return { homeId, midId, farId };
}

interface ISendAttackHarness {
    sendAttack(unit: ZCUnitState): void;
}

/**
 * 摆一局「我方单位在 A、敌方单位在 C、B 有墙/有楼」，让射手朝 C 的敌人开一枪。
 *
 * @param options.midOwner 中间格归属：`'enemy'` = 敌方（应该拦）；`'player'` = 自家（不该拦）。
 * @param options.wallHp  中间格的墙血；`0` ⇒ 墙已破，由建筑接手拦截。
 */
function runShot(options: { midOwner: 'enemy' | 'player'; wallHp?: number }): {
    wallBefore: number;
    wallAfter: number;
    buildingBefore: number;
    buildingAfter: number;
    unitAfter: number;
    unitMax: number;
    flying: number;
} {
    const { homeId, midId, farId } = layout();
    const snapshot = ZCGameModel.createInitialState(() => 0.1, config);
    const wallMax = Math.max(500, Math.round(definition.maxHp * 5));
    const wallHp = options.wallHp ?? wallMax;
    Object.assign(snapshot.hexes[midId], {
        owner: options.midOwner, state: 'developed', developmentResolved: true,
        building: 'tower', tier: 1, hp: 1000, maxHp: 1000,
        wallHp, wallMaxHp: wallMax, constructionRemainingSeconds: 0, constructionTotalSeconds: 0,
    });
    const home = config.map.hexes[homeId];
    const far = config.map.hexes[farId];
    snapshot.units = [
        makeUnit(1, 'player', home.x, home.y),
        makeUnit(2, 'enemy', far.x, far.y),
    ];
    snapshot.nextUnitId = 3;

    const model = new ZCGameModel(snapshot, () => 0.1, config);
    //  ⚠️ `ZCGameModel` 会深拷快照 —— 必须读 `model.snapshot` 上那份，否则永远读到改动前的值。
    const live = model.snapshot.hexes[midId];
    const wallBefore = live.wallHp;
    const buildingBefore = live.hp;
    const attacker = model.snapshot.units[0];
    attacker.targetUnitId = 2;

    (model as unknown as ISendAttackHarness).sendAttack(attacker);
    let flying = model.snapshot.projectiles.length;
    for (let step = 0; step < 200 && flying > 0; step += 1) {
        model.tick(0.05);
        flying = model.snapshot.projectiles.length;
    }
    return {
        wallBefore,
        wallAfter: model.snapshot.hexes[midId].wallHp,
        buildingBefore,
        buildingAfter: model.snapshot.hexes[midId].hp,
        unitAfter: model.snapshot.units[1].hp,
        unitMax: definition.maxHp,
        flying,
    };
}

test('单段子弹被路径上的敌方城墙拦下：墙掉血、墙后的单位满血', () => {
    const result = runShot({ midOwner: 'enemy' });
    assert.equal(result.flying, 0, '弹道必须已经结束（没有在飞），否则断言的是"还没打到"');
    assert.ok(result.wallAfter < result.wallBefore,
        `墙没掉血（${result.wallBefore} → ${result.wallAfter}）：子弹穿过去了，结构目标没参与判定`);
    assert.equal(result.unitAfter, result.unitMax,
        `墙后的单位掉了血（${result.unitAfter}/${result.unitMax}）：一次性伤害的子弹不该穿透城墙`);
});

test('墙破之后由建筑接着拦：一次性伤害的子弹同样不会打到楼后的单位', () => {
    const result = runShot({ midOwner: 'enemy', wallHp: 0 });
    assert.equal(result.flying, 0, '弹道必须已经结束');
    assert.ok(result.buildingAfter < result.buildingBefore,
        `建筑没掉血（${result.buildingBefore} → ${result.buildingAfter}）：子弹穿过楼打到了后面的单位`);
    assert.equal(result.unitAfter, result.unitMax,
        `楼后的单位掉了血（${result.unitAfter}/${result.unitMax}）：一次性伤害的子弹不该穿透建筑`);
});

test('自家格的墙不拦自己的子弹（不会打到自己的城墙）', () => {
    const result = runShot({ midOwner: 'player' });
    assert.equal(result.wallAfter, result.wallBefore,
        `自己格的墙掉了血（${result.wallBefore} → ${result.wallAfter}）：子弹打到了自家城墙`);
    assert.ok(result.unitAfter < result.unitMax,
        `目标单位没掉血（${result.unitAfter}/${result.unitMax}）：自家墙不该拦自己的子弹`);
});
