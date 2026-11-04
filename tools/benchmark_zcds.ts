import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { ownersForPlayerCount } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCGameRenderFrame } from '../assets/script/app/zcds/model/ZCGameRenderFrame';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond', 'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight'];
loadPvpTables(Object.fromEntries(names.map(name => {
    const table = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(table) ? table : table.v.map((row: unknown[]) => Object.fromEntries(table.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
const config = captureZCMatchConfig();

function createGame(count: number, dense: boolean, matchConfig: ZCMatchConfig = config, projectileOnly = false) {
    let seed = 123456;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const snapshot = ZCGameModel.createInitialState(random, matchConfig);
    const playable = matchConfig.map.hexes.filter(hex => hex.playable);
    const owners = ownersForPlayerCount(matchConfig.map.playerCount ?? 2);
    const unitDefinitions = projectileOnly ? matchConfig.units.filter(unit => unit.attackProfile.mode === 'projectile') : matchConfig.units;
    if (!unitDefinitions.length) throw new Error('弹道基准缺少远程单位配置');
    snapshot.units = Array.from({ length: count }, (_, index): ZCUnitState => {
        const owner = owners[index % owners.length];
        const definition = unitDefinitions[index % unitDefinitions.length];
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
    return new ZCGameModel(snapshot, random, matchConfig);
}

const results = [
    { name: 'empty', count: 0, dense: false },
    { name: '200-spread', count: 200, dense: false },
    { name: '200-dense', count: 200, dense: true },
].map(scenario => {
    const times: number[] = [];
    let digest = '';
    let presentationDigest = '';
    const projectionTimes: number[] = [];
    let remainingUnits = 0;
    for (let run = 0; run < 6; run++) {
        const game = createGame(scenario.count, scenario.dense);
        const hash = createHash('sha256');
        const presentationHash = createHash('sha256');
        for (let step = 0; step < 240; step++) {
            const started = performance.now();
            game.tick(0.05);
            if (run > 0) times.push(performance.now() - started);
            // Check every step, including transient effects and damage accounting.
            hash.update(JSON.stringify([game.snapshot, game.damageStats, game.floatTexts]));
            const projectionStarted = performance.now();
            const frame = game.createRenderFrame();
            const events = game.drainPresentationEvents();
            if (run > 0) projectionTimes.push(performance.now() - projectionStarted);
            presentationHash.update(JSON.stringify([frame.floatTexts, frame.hitFxs, frame.cardReveals,
                frame.hexActivations, frame.neutralRewards, events]));
        }
        const current = hash.digest('hex');
        if (digest && current !== digest) throw new Error(`Non-deterministic scenario: ${scenario.name}`);
        digest = current;
        const currentPresentation = presentationHash.digest('hex');
        if (presentationDigest && currentPresentation !== presentationDigest) throw new Error(`Non-deterministic presentation: ${scenario.name}`);
        presentationDigest = currentPresentation;
        remainingUnits = game.snapshot.units.length;
    }
    times.sort((a, b) => a - b);
    return { ...scenario, steps: times.length, remainingUnits, meanMs: times.reduce((a, b) => a + b, 0) / times.length, p95Ms: times[Math.floor(times.length * 0.95)], projection: summarize(projectionTimes), digest, presentationDigest };
});
function summarize(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return { meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95Ms: sorted[Math.floor(sorted.length * .95)] };
}

function fixtureConfig(name: string): ZCMatchConfig {
    configureZCMap(JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8')));
    return captureZCMatchConfig();
}

function developNext(model: ZCGameModel): void {
    const hex = model.snapshot.hexes.find(hex => model.canPlayerDevelop(hex.id)
        && hex.developmentCost <= model.snapshot.playerGold);
    if (hex) model.developHex(hex.id);
}

function projectionState(frame: ZCGameRenderFrame) {
    return [Array.from(frame.hexesById, ([id, hex]) => [id, hex.canDevelop, hex.cooldown, hex.activation,
        [...hex.connectedDevelopedHexIds].sort((a, b) => a - b)]),
        // 定义表现在包含本局所有兵种，只比较真实在场单位会读取的定义。
        Array.from(new Set(frame.snapshot.units.map(unit => unit.unitId)), id => [id, frame.unitDefinitionsById.get(id)])];
}

const displayScenarios = [
    { name: '60hz-2p', config, count: 200, dense: false },
    { name: '60hz-3p', config: fixtureConfig('zcds-map-v3-neutral-3p'), count: 200, dense: false },
    { name: '60hz-4p', config: fixtureConfig('zcds-map-v3-4p'), count: 200, dense: false },
    { name: '60hz-projectiles', config, count: 200, dense: true, projectileOnly: true },
    { name: '60hz-terrain', config, count: 200, dense: false, develop: true },
];
const displayResults = displayScenarios.map(scenario => {
    const ticks: number[] = [], projections: number[] = [], pipelines: number[] = [];
    let digest = '';
    let counts = { hexProjectionBuilds: 0, definitionTableChanges: 0, terrainChanges: 0, peakProjectiles: 0 };
    // 首轮预热；哈希与引用统计均在计时区间之外，不纳入模型管线耗时。
    for (let run = 0; run < 4; run++) {
        const model = createGame(scenario.count, scenario.dense, scenario.config, scenario.projectileOnly);
        const hash = createHash('sha256');
        let previous = model.createRenderFrame();
        const observed = { hexProjectionBuilds: 0, definitionTableChanges: 0, terrainChanges: 0, peakProjectiles: 0 };
        for (let index = 0; index < 720; index++) {
            if (scenario.develop && index % 6 === 0) developNext(model);
            const started = performance.now();
            model.tick(1 / 60);
            const afterTick = performance.now();
            const frame = model.createRenderFrame(), events = model.drainPresentationEvents();
            const finished = performance.now();
            if (run > 0) {
                ticks.push(afterTick - started); projections.push(finished - afterTick); pipelines.push(finished - started);
            }
            if (frame.hexesById !== previous.hexesById) observed.hexProjectionBuilds++;
            if (frame.unitDefinitionsById !== previous.unitDefinitionsById) observed.definitionTableChanges++;
            if (frame.terrainRevision !== previous.terrainRevision) observed.terrainChanges++;
            observed.peakProjectiles = Math.max(observed.peakProjectiles, model.snapshot.projectiles.length);
            hash.update(JSON.stringify([model.snapshot, model.damageStats, frame.floatTexts, frame.hitFxs,
                frame.cardReveals, frame.hexActivations, frame.neutralRewards, events, projectionState(frame)]));
            previous = frame;
        }
        const current = hash.digest('hex');
        if (digest && current !== digest) throw new Error(`Non-deterministic display pipeline: ${scenario.name}`);
        digest = current; counts = observed;
    }
    return { name: scenario.name, framesPerRun: 720, tick: summarize(ticks), projection: summarize(projections),
        modelPipeline: summarize(pipelines), ...counts, digest };
});

// 单独的诊断轮次计数索敌；包装计时会扰动热路径，不能与上述未插桩耗时混为一谈。
const targetingProfiles = displayScenarios.map(scenario => {
    const original = ZCTargetingSystem.acquire;
    let calls = 0, targetingMs = 0, tickMs = 0;
    ZCTargetingSystem.acquire = (...args) => {
        const started = performance.now();
        try { return original(...args); }
        finally { calls++; targetingMs += performance.now() - started; }
    };
    try {
        const model = createGame(scenario.count, scenario.dense, scenario.config, scenario.projectileOnly);
        for (let frame = 0; frame < 720; frame++) {
            if (scenario.develop && frame % 6 === 0) developNext(model);
            const started = performance.now(); model.tick(1 / 60); tickMs += performance.now() - started;
        }
    } finally { ZCTargetingSystem.acquire = original; }
    return { name: scenario.name, calls, targetingMs, instrumentedTickMs: tickMs };
});

// 大片领地只占一份连通成员表，冷启动可直接观察存储规模，不用堆内存差推算分配。
const connectedSeed = createGame(0, false), connectedSnapshot = connectedSeed.exportSnapshot();
for (const hex of connectedSnapshot.hexes) { hex.owner = 'player'; hex.developmentResolved = true; }
const connectedModel = new ZCGameModel(connectedSnapshot, () => .1, config);
const connectedFrame = connectedModel.createRenderFrame();
const groups = new Set(Array.from(connectedFrame.hexesById.values(), hex => hex.connectedDevelopedHexIds));
const connectivity = { hexes: connectedSnapshot.hexes.length, uniqueMemberArrays: groups.size,
    storedHexIds: Array.from(groups).reduce((sum, ids) => sum + ids.length, 0) };

mkdirSync('.codex-artifacts', { recursive: true });
const report = { schemaVersion: 2, node: process.version, results, displayResults, targetingProfiles, connectivity };
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const baseline = process.argv[3];
if (baseline) {
    const before = JSON.parse(readFileSync(baseline, 'utf8'));
    for (const result of results) {
        const original = before.results.find((entry: typeof result) => entry.name === result.name);
        if (!original || original.digest !== result.digest) throw new Error(`Gameplay changed: ${result.name}`);
        if (original.presentationDigest && original.presentationDigest !== result.presentationDigest) throw new Error(`Presentation changed: ${result.name}`);
    }
    if (before.schemaVersion >= 2) for (const result of displayResults) {
        if (before.displayResults.find((entry: typeof result) => entry.name === result.name)?.digest !== result.digest) {
            throw new Error(`Display pipeline changed: ${result.name}`);
        }
    }
}
console.log(JSON.stringify(report, null, 2));
