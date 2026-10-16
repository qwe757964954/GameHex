import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight'];
loadPvpTables(Object.fromEntries(names.map(name => {
    const table = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(table) ? table : table.v.map((row: unknown[]) => Object.fromEntries(table.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
const config = captureZCMatchConfig();

function createGame(count: number, dense: boolean) {
    let seed = 123456;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const snapshot = ZCGameModel.createInitialState(random, config);
    const playable = config.map.hexes.filter(hex => hex.playable);
    snapshot.units = Array.from({ length: count }, (_, index): ZCUnitState => {
        const owner = index % 2 ? 'enemy' : 'player';
        const definition = config.units[index % config.units.length];
        const hex = playable[dense ? Math.floor(playable.length / 2) + index % 6 : index * 7 % playable.length];
        return {
            id: index + 1, owner, unitId: definition.unitId, cardId: 'benchmark', tier: 1,
            sourceHexId: hex.id, targetHexId: null, progress: 0, hp: definition.maxHp, maxHp: definition.maxHp,
            battleState: 'target', stateTime: 0, targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
            nextAttackAt: 1.8, waitUntil: 0, attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
            facingRadians: 0, deathRemoveAt: 0, marchAngle: null, freeX: hex.x, freeY: hex.y, completedAttackCount: 0,
        };
    });
    snapshot.nextUnitId = count + 1;
    return new ZCGameModel(snapshot, random, config);
}

const results = [
    { name: 'empty', count: 0, dense: false },
    { name: '200-spread', count: 200, dense: false },
    { name: '200-dense', count: 200, dense: true },
].map(scenario => {
    const times: number[] = [];
    let digest = '';
    let remainingUnits = 0;
    for (let run = 0; run < 6; run++) {
        const game = createGame(scenario.count, scenario.dense);
        const hash = createHash('sha256');
        for (let step = 0; step < 240; step++) {
            const started = performance.now();
            game.tick(0.05);
            if (run > 0) times.push(performance.now() - started);
            // Check every step, including transient effects and damage accounting.
            hash.update(JSON.stringify([game.snapshot, game.damageStats, game.floatTexts]));
        }
        const current = hash.digest('hex');
        if (digest && current !== digest) throw new Error(`Non-deterministic scenario: ${scenario.name}`);
        digest = current;
        remainingUnits = game.snapshot.units.length;
    }
    times.sort((a, b) => a - b);
    return { ...scenario, steps: times.length, remainingUnits, meanMs: times.reduce((a, b) => a + b, 0) / times.length, p95Ms: times[Math.floor(times.length * 0.95)], digest };
});
mkdirSync('.codex-artifacts', { recursive: true });
const report = { node: process.version, results };
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const baseline = process.argv[3];
if (baseline) {
    const before = JSON.parse(readFileSync(baseline, 'utf8'));
    for (const result of results) {
        const original = before.results.find((entry: typeof result) => entry.name === result.name);
        if (!original || original.digest !== result.digest) throw new Error(`Gameplay changed: ${result.name}`);
    }
}
console.log(JSON.stringify(report, null, 2));
