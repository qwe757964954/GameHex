import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState, ZCOwner } from '../assets/script/app/zcds/model/ZCGameTypes';

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

const layout = JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout;
configureZCMap(layout);
const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });

function makeUnit(id: number, owner: ZCOwner, hexId: number): ZCUnitState {
    const definition = base.units[0];
    const hex = base.map.hexes[hexId];
    return {
        id, owner, unitId: definition.unitId, cardId: 'test', tier: 1,
        sourceHexId: hexId, targetHexId: null, progress: 0, hp: definition.maxHp, maxHp: definition.maxHp,
        battleState: 'idle', stateTime: 0, targetUnitId: null, targetWallHexId: null,
        targetBuildingHexId: null, nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: hex.x, freeY: hex.y, completedAttackCount: 0,
    };
}

test('任意一方小兵穿过对方废墟，废墟立即归属经过方（双方同格除外）', () => {
    // 三种场景：废墟归 player→enemy 经过；废墟归 enemy→player 经过；己方废墟→己方经过（激活）。
    const cases: ReadonlyArray<{ ruinOwner: ZCOwner; passer: ZCOwner }> = [
        { ruinOwner: 'player', passer: 'enemy' },
        { ruinOwner: 'enemy', passer: 'player' },
        { ruinOwner: 'player', passer: 'player' },
        { ruinOwner: 'enemy', passer: 'enemy' },
    ];
    for (const { ruinOwner, passer } of cases) {
        // 找一个可通行格作为废墟，要求存在对侧两个相邻格（直线穿过废墟中心）。
        let pair: { ruin: typeof base.map.hexes[number]; start: typeof base.map.hexes[number]; to: typeof base.map.hexes[number] } | null = null;
        for (const h of base.map.hexes) {
            if (!h.playable) continue;
            const adj = h.neighbors.filter((n) => base.map.hexes[n].playable).map((n) => base.map.hexes[n]);
            for (const a of adj) for (const b of adj) {
                const ax = a.x - h.x, ay = a.y - h.y;
                const bx = b.x - h.x, by = b.y - h.y;
                if ((ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by) < -0.85) {
                    pair = { ruin: h, start: a, to: b };
                }
            }
            if (pair) break;
        }
        assert.ok(pair, '预制条件：存在带对侧相邻的可通行格');
        const { ruin, start, to } = pair!;
        const match: ZCMatchConfig = {
            ...base, map: { ...base.map, cityMode: 'fixed' },
            rules: { ...base.rules, enemyAiIntervalSeconds: 10000, captureRequireSupply: false },
            units: base.units.map((d) => ({ ...d, moveSpeed: 0 })),
        };
        const snapshot = ZCGameModel.createInitialState(() => .1, match);
        // 把目标格设为归 ruinOwner 的废墟。
        snapshot.hexes[ruin.id].state = 'ruins';
        snapshot.hexes[ruin.id].owner = ruinOwner;
        snapshot.hexes[ruin.id].building = 'none';
        snapshot.hexes[ruin.id].developmentResolved = false;
        snapshot.hexes[ruin.id].wallHp = 0;
        snapshot.hexes[ruin.id].wallMaxHp = 0;
        const runner = makeUnit(1, passer, start.id);
        snapshot.units = [runner];
        snapshot.nextUnitId = 2;
        const game = new ZCGameModel(snapshot, () => .1, match);
        const system = (game as any).captureSystem;
        const state = (game as any).state;
        system.beginStep(state.units);
        // 小兵穿过废墟中心，落到另一侧（落点离开废墟）。
        state.units[0].freeX = to.x;
        state.units[0].freeY = to.y;
        system.update(state, .05, (hex: any, o: any) => (game as any).captureEmptyTile(hex, o));
        assert.equal(state.hexes[ruin.id].owner, passer, `${passer} 穿过 ${ruinOwner} 废墟应归属 ${passer}`);
        assert.notEqual(state.hexes[ruin.id].state, 'ruins', '易手后不再是废墟态');
    }
});

test('小兵经过中立资源格后归属行军方，但不领取资源', () => {
    let pair: {
        resource: typeof base.map.hexes[number];
        start: typeof base.map.hexes[number];
        to: typeof base.map.hexes[number];
    } | null = null;
    for (const resource of base.map.hexes) {
        if (!resource.playable) continue;
        const adjacent = resource.neighbors
            .filter((id) => base.map.hexes[id].playable)
            .map((id) => base.map.hexes[id]);
        for (const start of adjacent) for (const to of adjacent) {
            if (start.id === to.id) continue;
            const sx = start.x - resource.x, sy = start.y - resource.y;
            const tx = to.x - resource.x, ty = to.y - resource.y;
            const alignment = (sx * tx + sy * ty) / Math.hypot(sx, sy) / Math.hypot(tx, ty);
            if (alignment < -0.85) pair = { resource, start, to };
        }
        if (pair) break;
    }
    assert.ok(pair, '预制条件：存在可直线穿过的中立格');

    const { resource, start, to } = pair!;
    const match: ZCMatchConfig = {
        ...base,
        map: { ...base.map, cityMode: 'fixed' },
        rules: {
            ...base.rules,
            captureRequireSupply: false,
            captureSeconds: .05,
            enemyAiIntervalSeconds: 10000,
        },
        units: base.units.map((definition) => ({ ...definition, moveSpeed: 0 })),
    };
    const snapshot = ZCGameModel.createInitialState(() => .1, match);
    snapshot.hexes[resource.id].owner = 'neutral';
    snapshot.hexes[resource.id].neutralResourceId = 'gold';
    snapshot.hexes[resource.id].developmentResolved = false;
    snapshot.hexes[resource.id].building = 'none';
    snapshot.hexes[resource.id].wallHp = 0;
    const runner = makeUnit(1, 'player', start.id);
    snapshot.units = [runner];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => .1, match);
    const system = (game as any).captureSystem;
    const state = (game as any).state;
    system.beginStep(state.units);
    state.units[0].freeX = to.x;
    state.units[0].freeY = to.y;

    system.update(state, .05, (hex: any, owner: any) => (game as any).captureEmptyTile(hex, owner));

    assert.equal(state.hexes[resource.id].owner, 'player');
    assert.equal(state.hexes[resource.id].neutralResourceId, 'gold', '经过只改归属，不领取资源');
    assert.equal(state.hexes[resource.id].developmentResolved, false);
});
