import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildZCClientCombatConfig } from '../assets/script/app/zcds/application/ZCClientCombatConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap, ownersForPlayerCount } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCHexState } from '../assets/script/app/zcds/model/ZCGameTypes';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];
loadPvpTables(Object.fromEntries(tableNames.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);

test('local 2/3/4-player battles initialize every owner and preserve deterministic snapshots', () => {
    const baseline = JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8'));
    try {
        for (const playerCount of [2, 3, 4] as const) {
            const mapName = playerCount === 2 ? 'standard' : `standard_${playerCount}`;
            configureZCMap(JSON.parse(readFileSync(`assets/resources/config/maps/${mapName}.json`, 'utf8')));
            const built = buildZCClientCombatConfig(captureZCMatchConfig(), null);
            const owners = ownersForPlayerCount(playerCount);
            assert.deepEqual(Object.keys(built.config.modifiers ?? {}), owners, mapName);
            assert.deepEqual(built.skipped, [], mapName);

            const largeStep = new ZCGameModel(null, () => .1, built.config);
            const smallSteps = new ZCGameModel(null, () => .1, built.config);
            assert.equal(largeStep.snapshot.hexes.filter((hex) => hex.building === 'hq').length, playerCount, mapName);
            assert.deepEqual(Object.keys(largeStep.snapshot.goldByOwner ?? {}), owners, mapName);

            const beforeDevelopment = Object.fromEntries(owners.slice(1).map((owner) => [
                owner,
                largeStep.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length,
            ]));
            const duration = built.config.rules.enemyAiIntervalSeconds + .1;
            largeStep.tick(duration);
            for (let elapsed = 0; elapsed < duration - 1e-9; elapsed += .05) smallSteps.tick(Math.min(.05, duration - elapsed));
            assert.deepEqual(smallSteps.exportSnapshot(), largeStep.exportSnapshot(), `${mapName}: frame partition`);

            for (const owner of owners.slice(1)) {
                const developed = largeStep.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length;
                assert.ok(developed > beforeDevelopment[owner], `${mapName}:${owner}`);
            }

            const restored = new ZCGameModel(largeStep.exportSnapshot(), () => .1, built.config);
            largeStep.tick(.5);
            restored.tick(.5);
            assert.deepEqual(restored.exportSnapshot(), largeStep.exportSnapshot(), `${mapName}: snapshot restore`);
        }
    } finally {
        configureZCMap(baseline);
    }
});

test('多人局某玩家最后建筑被摧毁后，其剩余空地归中立，不能被残兵重新占回', () => {
    const baseline = JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8'));
    try {
        configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/standard_4.json', 'utf8')));
        const config = buildZCClientCombatConfig(captureZCMatchConfig(), null).config;
        const seed = new ZCGameModel(null, () => .1, config);
        const snapshot = seed.exportSnapshot();
        const target = snapshot.hexes.find(hex => hex.owner === 'enemy2' && hex.building === 'hq')!;
        const ground = snapshot.hexes.find(hex => hex.owner === 'enemy2' && hex.building === 'none')!;
        assert.ok(target && ground);
        target.hp = 1; target.wallHp = 0;
        const survivorLand = snapshot.hexes.filter(hex => hex.owner === 'enemy3').length;
        const game = new ZCGameModel(snapshot, () => .1, config);
        const internal = game as unknown as {
            damageBuilding(attacker: { owner: 'player' | 'enemy2' }, hex: ZCHexState, damage: number): void;
            captureEmptyTile(hex: ZCHexState, owner: 'enemy2'): void;
        };
        const liveTarget = game.snapshot.hexes[target.id] as ZCHexState;
        internal.damageBuilding({ owner: 'player' }, liveTarget, 100);
        assert.equal(game.territoryCountOf('enemy2'), 0, '出局席位不再占有空地，顶部显示出局');
        assert.equal(game.snapshot.hexes[ground.id].owner, 'neutral');
        assert.equal(game.territoryCountOf('enemy3'), survivorLand, '其他玩家地块不受影响');
        internal.captureEmptyTile(game.snapshot.hexes[ground.id] as ZCHexState, 'enemy2');
        assert.equal(game.snapshot.hexes[ground.id].owner, 'neutral', '出局玩家残兵不能重新取得地块');
        const otherHome = game.snapshot.hexes.find(hex => hex.owner === 'enemy3' && hex.building === 'hq') as ZCHexState;
        otherHome.hp = 1; otherHome.wallHp = 0;
        internal.damageBuilding({ owner: 'enemy2' }, otherHome, 100);
        assert.equal(otherHome.owner, 'neutral', '出局玩家残兵拆建筑也不能重新获得归属');
        const extraSnapshot = structuredClone(snapshot);
        const extra = extraSnapshot.hexes[ground.id];
        extra.building = 'barracks'; extra.hp = 1; extra.maxHp = 1; extra.wallHp = 0;
        const stillAlive = new ZCGameModel(extraSnapshot, () => .1, config);
        const aliveInternal = stillAlive as unknown as typeof internal;
        aliveInternal.damageBuilding({ owner: 'player' }, stillAlive.snapshot.hexes[target.id] as ZCHexState, 100);
        assert.ok(stillAlive.territoryCountOf('enemy2') > 0, '还有存活建筑时不能提前清除归属');
        aliveInternal.damageBuilding({ owner: 'player' }, stillAlive.snapshot.hexes[ground.id] as ZCHexState, 100);
        assert.equal(stillAlive.territoryCountOf('enemy2'), 0, '最后一座建筑被击毁才真正出局');
    } finally {
        configureZCMap(baseline);
    }
});
