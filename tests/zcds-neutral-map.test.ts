import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap, ZC_HEX_CONFIG, ZC_INITIAL_TERRITORY, ZCGameModel, ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
] as const;
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

const legacyLayout = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout;
const neutralLayout: ZCMapLayout = {
    id: 'neutral-test', version: 2, rows: 8, columns: 6,
    mirror180: false, mirrorVertical: true,
    ascii: ['NNNNNN', '######', '######', '.####.'],
    playerHome: { row: 6, column: 2 }, enemyHome: { row: 1, column: 2 },
};

function stationaryUnit(match: ZCMatchConfig, hexId: number): ZCUnitState {
    const definition = match.units[0];
    const hex = match.map.hexes[hexId];
    return {
        id: 1, owner: 'player', unitId: definition.unitId, cardId: 'neutral-test', tier: 1,
        sourceHexId: hexId, targetHexId: null, progress: 0,
        hp: definition.maxHp, maxHp: definition.maxHp,
        battleState: 'idle', stateTime: 0, targetUnitId: null,
        targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0,
        deathRemoveAt: 0, marchAngle: null, freeX: hex.x, freeY: hex.y, completedAttackCount: 0,
    };
}

test('v2 中立格可通行、参与邻接并以可占据状态进入对局，虚空仍不可通行', () => {
    configureZCMap(neutralLayout);
    try {
        assert.equal(ZC_INITIAL_TERRITORY, 16);
        const neutral = ZC_HEX_CONFIG.filter((hex) => hex.playable && hex.row >= 3 && hex.row <= 4);
        assert.equal(neutral.length, 12);
        assert.ok(neutral.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].row === 7 - hex.row));
        assert.ok(neutral.every((hex) => hex.neighbors.some((id) => ZC_HEX_CONFIG[id].playable)));
        const voids = ZC_HEX_CONFIG.filter((hex) => !hex.playable);
        assert.equal(voids.length, 4);
        assert.ok(voids.every((hex) => hex.neighbors.length === 0));

        const game = new ZCGameModel(null, () => 0.1);
        assert.equal(game.playerTerritoryCount, 16);
        assert.equal(game.enemyTerritoryCount, 16);
        assert.equal(game.snapshot.hexes.filter((hex) => hex.owner === 'neutral' && ZC_HEX_CONFIG[hex.id].playable).length, 12);
        assert.ok(neutral.every((config) => game.snapshot.hexes[config.id].state === 'occupiable'));
        assert.ok(neutral.every((config) => typeof game.snapshot.hexes[config.id].tileType === 'string'));
        assert.ok(voids.every((config) => game.snapshot.hexes[config.id].tileType === null));
        assert.equal(ZCGameModel.isValidSnapshot(game.exportSnapshot()), true);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('有补给的单位可以占领地图原生中立格', () => {
    configureZCMap(neutralLayout);
    try {
        const base = captureZCMatchConfig();
        const match: ZCMatchConfig = {
            ...base,
            rules: { ...base.rules, captureSeconds: 0.1, enemyAiIntervalSeconds: 10000 },
            units: base.units.map((definition) => ({ ...definition, moveSpeed: 0 })),
        };
        const tile = match.map.hexes.find((hex) => match.map.owners[hex.id] === 'neutral'
            && hex.neighbors.some((id) => match.map.owners[id] === 'player'))!;
        const snapshot = ZCGameModel.createInitialState(() => 0.1, match);
        snapshot.units = [stationaryUnit(match, tile.id)];
        snapshot.nextUnitId = 2;
        const game = new ZCGameModel(snapshot, () => 0.1, match);
        game.tick(0.1);
        assert.equal(game.snapshot.hexes[tile.id].owner, 'player');
        assert.equal(game.snapshot.hexes[tile.id].captureOwner, null);
        assert.equal(game.snapshot.hexes[tile.id].captureSeconds, 0);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('v1 拒绝中立字符，v2 主城仍必须位于本方领土', () => {
    const base = { ...neutralLayout, version: undefined };
    assert.throws(() => configureZCMap(base), /字符画/);
    assert.throws(() => configureZCMap({ ...neutralLayout,
        playerHome: { row: 4, column: 2 }, enemyHome: { row: 3, column: 2 } }), /主城必须位于本方地块/);
    configureZCMap(legacyLayout);
});

/** 中立格要从「被建立过的己方格」往外扩，所以拿一对「中立格 + 它的己方邻格」当夹具。 */
function neutralNextTo(owners: Record<number, string>, owner: 'player' | 'enemy') {
    const match = captureZCMatchConfig();
    const tile = match.map.hexes.find((hex) => owners[hex.id] === 'neutral'
        && hex.neighbors.some((id) => owners[id] === owner))!;
    const anchor = tile.neighbors.find((id) => owners[id] === owner)!;
    return { match, tile, anchor };
}

test('中立格与己方已开发锚点相邻即可开发，开发即宣告归属', () => {
    configureZCMap(neutralLayout);
    try {
        const base = captureZCMatchConfig();
        const match: ZCMatchConfig = { ...base, rules: { ...base.rules, enemyAiIntervalSeconds: 10000 } };
        const owners = match.map.owners;
        const { tile, anchor } = neutralNextTo(owners, 'player');

        // ① 没有锚点时：中立格仍是「可占据」，整张图一个可开发的都没有 ——
        //    规则只从「建立」（开发/建筑）那几格往外扩，不是把中立格整体放开。
        const virgin = new ZCGameModel(ZCGameModel.createInitialState(() => 0.1, match), () => 0.1, match);
        assert.equal(virgin.snapshot.hexes[tile.id].state, 'occupiable');
        assert.equal(virgin.snapshot.hexes.filter((hex) => hex.owner === 'neutral' && hex.state === 'developable').length, 0);
        assert.equal(virgin.canPlayerDevelop(tile.id), false);
        // 虚空格（中立 + 不可通行）永远不可开发，哪怕它挨着谁。
        assert.ok(match.map.hexes.filter((hex) => !hex.playable).every((hex) => !virgin.canPlayerDevelop(hex.id)));

        // ② 把己方邻格标成「已建立」→ 中立格被点亮。
        const snapshot = ZCGameModel.createInitialState(() => 0.1, match);
        snapshot.playerGold = 10_000;
        snapshot.hexes[anchor].developmentResolved = true;
        const game = new ZCGameModel(snapshot, () => 0.1, match);
        assert.equal(game.snapshot.hexes[tile.id].state, 'developable');
        assert.equal(game.canPlayerDevelop(tile.id), true);
        assert.equal(game.canDevelopFor('enemy', tile.id), false, '本方锚点只点亮本方，不替敌方开门');

        // ③ 开发 = 花钱买地：扣金币、拿到归属、领地和已开发数都 +1。
        const territoryBefore = game.playerTerritoryCount;
        const goldBefore = game.snapshot.playerGold;
        const cost = game.snapshot.hexes[tile.id].developmentCost;
        assert.equal(game.developHex(tile.id).ok, true);
        assert.equal(game.snapshot.hexes[tile.id].owner, 'player');
        assert.equal(game.snapshot.playerGold, goldBefore - cost);
        assert.equal(game.playerTerritoryCount, territoryBefore + 1);
        assert.equal(game.snapshot.hexes[tile.id].developmentResolved, true);
        assert.equal(game.canPlayerDevelop(tile.id), false, '同一格不能重复开发');
        assert.equal(ZCGameModel.isValidSnapshot(game.exportSnapshot()), true);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('中立格只认本方锚点：贴着敌方的我方买不了，敌方 AI 会买', () => {
    configureZCMap(neutralLayout);
    try {
        const base = captureZCMatchConfig();
        const match: ZCMatchConfig = { ...base, rules: { ...base.rules, enemyAiIntervalSeconds: 0.05 } };
        const owners = match.map.owners;
        const { tile, anchor } = neutralNextTo(owners, 'enemy');

        const snapshot = ZCGameModel.createInitialState(() => 0.1, match);
        snapshot.hexes[anchor].developmentResolved = true;
        // 让这一格成为 AI 唯一买得起的地：其余格标成天价，选谁就不再取决于随机。
        for (const hex of snapshot.hexes) hex.developmentCost = 9999;
        snapshot.hexes[tile.id].developmentCost = 25;
        snapshot.enemyGold = 100;
        snapshot.playerGold = 10_000;
        snapshot.aiClock = 1000;
        const game = new ZCGameModel(snapshot, () => 0.1, match);

        assert.equal(game.snapshot.hexes[tile.id].state, 'developable', '任一方锚点都会点亮它');
        assert.equal(game.canDevelopFor('enemy', tile.id), true);
        assert.equal(game.canPlayerDevelop(tile.id), false, '我方锚点不挨着这格 → 买不了');

        game.tick(0.1); // 推进到 AI 出手
        assert.equal(game.snapshot.hexes[tile.id].owner, 'enemy', 'AI 也走「开发即得地」这条路');
        assert.equal(game.canPlayerDevelop(tile.id), false, '敌对格永远不可开发');
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('废墟及小兵占领后的空地均不解锁周边己方格或中立格', () => {
    configureZCMap(neutralLayout);
    try {
        for (const owner of ['player', 'enemy'] as const) {
            for (const tileOwner of ['neutral', owner] as const) {
                const { match: base, tile, anchor } = neutralNextTo(captureZCMatchConfig().map.owners, owner);
                const match: ZCMatchConfig = {
                    ...base,
                    rules: { ...base.rules, enemyAiIntervalSeconds: 10000 },
                    units: base.units.map((definition) => ({ ...definition, moveSpeed: 0 })),
                };
                const snapshot = ZCGameModel.createInitialState(() => 0.1, match);
                snapshot.hexes[tile.id].owner = tileOwner;
                snapshot.hexes[anchor].state = 'ruins';
                snapshot.hexes[anchor].building = 'none';
                snapshot.hexes[anchor].developmentResolved = false;
                snapshot.hexes[anchor].hp = 0;
                snapshot.hexes[anchor].maxHp = 0;
                const runner = stationaryUnit(match, anchor);
                runner.owner = owner;
                snapshot.units = [runner];
                snapshot.nextUnitId = 2;
                const game = new ZCGameModel(snapshot, () => 0.1, match);
                const expectedState = tileOwner === 'neutral' ? 'occupiable' : 'occupied';

                assert.equal(game.snapshot.hexes[anchor].state, 'ruins');
                assert.equal(game.snapshot.hexes[tile.id].state, expectedState, '废墟不提供开发锚点');
                assert.equal(game.canDevelopFor(owner, tile.id), false);

                game.tick(0.05);
                assert.equal(game.snapshot.hexes[anchor].owner, owner);
                assert.equal(game.snapshot.hexes[anchor].state, 'occupied', '小兵经过后只占据空地');
                assert.equal(game.snapshot.hexes[anchor].developmentResolved, false);
                assert.equal(game.snapshot.hexes[tile.id].state, expectedState, '占领也不解锁周边');
                assert.equal(game.canDevelopFor(owner, tile.id), false);
            }
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});
