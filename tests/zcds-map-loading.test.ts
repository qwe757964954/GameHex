import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { configureZCMap, isRandomMapCandidate, ZC_MAP_ID } from '../assets/script/app/zcds/model/ZCGameModel';

const GAME_SOURCE = 'assets/script/app/zcds/ZCGame.ts';
const LOADER_SOURCE = 'assets/script/app/zcds/application/ZCGameLoader.ts';
/** 地图目录只在 ZCGame.ts 里定义一次，这里读回来，避免路径在两处漂移。 */
const MAP_DIRECTORY = readFileSync(GAME_SOURCE, 'utf8').match(/MAP_DIRECTORY = '([^']+)'/)![1];
const mapDirectory = `assets/resources/${MAP_DIRECTORY}`;
const assets = readdirSync(mapDirectory).filter((name) => name.endsWith('.json')).map((name) => ({
    name: name.slice(0, -5),
    json: JSON.parse(readFileSync(`${mapDirectory}/${name}`, 'utf8')),
}));

function makeGame(
    randomValues: number[],
    candidates = assets,
    requestedPlayerCount: 2 | 3 | 4 | null = null,
    constructorOverride?: 2 | 3 | 4,
) {
    const code = ts.transpileModule(readFileSync(LOADER_SOURCE, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const loaded: string[] = [];
    const random = Object.create(Math) as Math;
    random.random = () => randomValues.shift() ?? 0;
    const assetService = {
        load: async () => { throw new Error('unexpected prefab load'); },
        loadDir: async (path: string) => {
            loaded.push(path);
            return candidates;
        },
    };
    const cc = { JsonAsset: class {}, Prefab: class {} };
    const dependencies: Record<string, unknown> = {
        cc,
        '../model/ZCCombatCatalog': {},
        // 沙箱直接复用真实候选判据，避免测试替身与 2/3/4 人随机规则漂移。
        '../model/ZCGameModel': {
            configureZCMap,
            getZCLocalPlayerCountOverride: () => requestedPlayerCount,
            isRandomMapCandidate,
        },
        '../model/ZCGameRuntimeConfig': {},
    };
    const context = { exports: {} as { ZCGameLoader: new (assets: unknown, configs: unknown, mapDirectory: string, random: () => number, playerCountOverride?: 2 | 3 | 4) => { loadRandomMap(): Promise<boolean> } },
        require: (name: string) => dependencies[name],
        console: { info() {}, warn() {}, error() {} } };
    runInNewContext(code, context);
    return { game: new context.exports.ZCGameLoader(assetService, {}, MAP_DIRECTORY, random.random, constructorOverride), loaded };
}

/**
 * 随机池的独立判据（不复用被测的 `isRandomMapCandidate`，避免同义反复）：
 * 未声明 playerCount 的图按 2 人处理；2 / 3 / 4 人固定主城图都参与随机。
 */
const playerCountOf = (asset: { json: { playerCount?: number } | null }): number => asset.json?.playerCount ?? 2;
const soloMaps = assets.filter((asset) => playerCountOf(asset) === 2);
const multiMaps = assets.filter((asset) => playerCountOf(asset) !== 2);

test('随机池判据接受 2 / 3 / 4 人固定或自选主城图，并排除非法人数', () => {
    for (const layout of [
        undefined, null, {}, { playerCount: 2 }, { playerCount: 3 }, { playerCount: 4 },
        { playerCount: 4, cityMode: 'select' },
    ]) {
        assert.equal(isRandomMapCandidate(layout), true, JSON.stringify(layout));
    }
    for (const layout of [{ playerCount: 1 }, { playerCount: 5 }, { playerCount: 4, cityMode: 'other' }]) {
        assert.equal(isRandomMapCandidate(layout), false, JSON.stringify(layout));
    }
    assert.equal(isRandomMapCandidate({ playerCount: 3 }, 3), true);
    assert.equal(isRandomMapCandidate({ playerCount: 4 }, 3), false);
});

/** 与 ZCGameLoader 里的 ZC_SPAWN_SELECTION_WEIGHT 保持一致；改倍数时两处一起改。 */
const SPAWN_SELECTION_WEIGHT = 11;
const weightOf = (asset: { json: { cityMode?: string } | null }): number =>
    asset.json?.cityMode === 'select' ? SPAWN_SELECTION_WEIGHT : 1;

test('每局从地图资源目录按权重随机选一张图，每张图都有命中区间', async () => {
    assert.ok(assets.length > 1);
    const totalWeight = assets.reduce((sum, asset) => sum + weightOf(asset), 0);
    let prefix = 0;
    for (const asset of assets) {
        // 喂该图权重区间的中点，加权抽样必然落到它身上。
        const midpoint = (prefix + weightOf(asset) / 2) / totalWeight;
        prefix += weightOf(asset);
        const { game, loaded } = makeGame([midpoint]);
        assert.equal(await game.loadRandomMap(), true, asset.name);
        assert.deepEqual(loaded, [MAP_DIRECTORY]);
        assert.equal(ZC_MAP_ID, asset.name, asset.name);
    }
});

test('目录里只剩 3 / 4 人图时也能本地开局', async () => {
    assert.ok(multiMaps.length > 0, '地图目录里应已有多人图，否则这条用例失去意义');
    for (const asset of multiMaps) {
        assert.equal(await makeGame([0], [asset]).game.loadRandomMap(), true, asset.name);
        assert.equal(ZC_MAP_ID, asset.name);
    }
});

test('多人图排在候选首位时可以直接被抽中', async () => {
    const { game } = makeGame([0], [...multiMaps, ...soloMaps]);
    assert.equal(await game.loadRandomMap(), true);
    assert.equal(ZC_MAP_ID, multiMaps[0].name);
});

test('本地人数覆盖可以固定只抽 3 人或 4 人地图', async () => {
    for (const count of [3, 4] as const) {
        const expected = assets.find((asset) => playerCountOf(asset) === count)!;
        assert.ok(expected, `缺少 ${count} 人地图`);
        const { game } = makeGame([0], assets, count);
        assert.equal(await game.loadRandomMap(), true);
        assert.equal(ZC_MAP_ID, expected.name);
    }
});

test('调用方显式人数优先于全局覆盖，领地 PVE 可固定双人地图', async () => {
    const expected = assets.find((asset) => playerCountOf(asset) === 2)!;
    const { game } = makeGame([0], assets, 4, 2);
    assert.equal(await game.loadRandomMap(), true);
    assert.equal(ZC_MAP_ID, expected.name);
});

test('随机抽到无效地图时继续尝试，目录为空则停止初始化', async () => {
    const { game } = makeGame([0, 0], [{ name: 'broken', json: {} }, assets[0]]);
    assert.equal(await game.loadRandomMap(), true);
    assert.equal(ZC_MAP_ID, assets[0].name);
    assert.equal(await makeGame([], []).game.loadRandomMap(), false);
});

test('自选主城地图已参与随机选图', async () => {
    const pending = {
        name: 'select_pending',
        json: {
            id: 'select_pending', version: 2, rows: 8, columns: 6, mirrorVertical: true,
            cityMode: 'select', ascii: ['NNNNNN', '######', '######', '.####.'],
        },
    };
    const { game } = makeGame([0], [pending, assets[0]]);
    assert.equal(await game.loadRandomMap(), true);
    assert.equal(ZC_MAP_ID, pending.name);
});
