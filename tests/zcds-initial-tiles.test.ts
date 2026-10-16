import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap, isRandomMapCandidate, ZC_MAP_HOMES, ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { getPvpRuntimeRules, loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { createPvpTileTypes, ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import { createSeededRandom } from '../assets/script/app/zcds/model/ZCSeededRandom';

/**
 * 初始地块的「金矿保底」口径（2026-09-30 由「全场合计」改成「每席位各保底」）。
 *
 * 原实现是在**所有席位主城邻格的并集**里随机挑 `initialGuaranteedMine` 格：2 人镜像图上一次
 * `assign` 会同时落到双方（够用），但 3 / 4 人非镜像图（`mirrorId === id`）有 18 / 24 个邻格，
 * 只挑 1 格 ⇒ 多数席位一个都没有（实测 `PVP4-1` / `standard_4` 玩家侧 78% 的开局没有可开发金矿）。
 * 本用例是这条口径的回归网：**每张候选图的每个席位**都得拿到保底。
 */

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

/** 地图目录只在 `ZCGame.ts` 里定义一次，这里读回来，避免路径在两处漂移。 */
const MAP_DIRECTORY = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8')
    .match(/MAP_DIRECTORY = '([^']+)'/)![1];
const candidateLayouts = readdirSync(`assets/resources/${MAP_DIRECTORY}`)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(`assets/resources/${MAP_DIRECTORY}/${name}`, 'utf8')) as ZCMapLayout)
    .filter((layout) => isRandomMapCandidate(layout, null));

const SEEDS = 24;
const seedOf = (seed: number): string => `初始地块保底-${seed}`;

/** 按「席位」列出主城邻格里的 `mine` 个数（自选主城图开局无固定 homes，返回空数组）。 */
function ringMineCounts(seed: number, guaranteedOverride?: number): number[] {
    const config = captureZCMatchConfig(undefined);
    const match = guaranteedOverride === undefined ? config : {
        ...config,
        rules: { ...config.rules, initialGuaranteedMine: guaranteedOverride },
    } as ZCMatchConfig;
    const types = createPvpTileTypes(createSeededRandom(seedOf(seed)), match);
    return match.map.homes!.map((homeId) => (
        match.map.hexes[homeId].neighbors.filter((id) => types[id] === ZCPvpTileType.Mine).length
    ));
}

test('保底按「每席位」下发：每张候选图的每个席位都有可开发金矿（真地图 × 多种子）', () => {
    const perHome = Math.max(0, Math.floor(getPvpRuntimeRules().initialGuaranteedMine));
    assert.ok(perHome >= 1, `initialGuaranteedMine 应 ≥ 1（现在 ${perHome}），否则这条用例失去意义`);
    let seatsChecked = 0;
    for (const layout of candidateLayouts) {
        configureZCMap(layout);
        // 自选主城图开局没有固定 homes（主城由选点产生），它的保底在选点结束后才跑，这里跳过。
        if (!ZC_MAP_HOMES.length) continue;
        const homeCount = ZC_MAP_HOMES.length;
        for (let seed = 1; seed <= SEEDS; seed += 1) {
            const counts = ringMineCounts(seed);
            assert.equal(counts.length, homeCount, `${layout.id} 席位数量应与地图声明一致`);
            counts.forEach((count, seat) => {
                assert.ok(count >= perHome, `${layout.id} 席位 ${seat} 主城邻格只有 ${count} 个金矿（要 ≥ ${perHome}）`);
            });
            seatsChecked += homeCount;
        }
    }
    assert.ok(seatsChecked > 40, `至少要覆盖多张多人图，实际只有 ${seatsChecked} 个席位样本`);
});

test('保底数量跟配置走：调成 2 时每席位至少 2 个，调成 0 时不强行塞', () => {
    // 用一张 4 人非镜像图（`mirrorId === id`，最能暴露「全场合计」的旧口径）。
    const layout = candidateLayouts.find((item) => item.homes?.length === 4)!;
    assert.ok(layout, '地图目录里应有 4 人图');
    configureZCMap(layout);

    for (let seed = 1; seed <= SEEDS; seed += 1) {
        for (const count of ringMineCounts(seed, 2)) {
            assert.ok(count >= 2, `保底调成 2 时每席位至少要 2 个金矿，实际 ${count}`);
        }
    }

    // 0 = 不保底：总得存在「某个席位一个金矿都没有」的开局，否则说明保底没被关掉。
    let zeroSeen = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
        zeroSeen += ringMineCounts(seed, 0).filter((count) => count === 0).length;
    }
    assert.ok(zeroSeen > 0, 'initialGuaranteedMine = 0 时不该再强塞金矿');
});

test('初始地块分布是随机源的纯函数：同种子逐位一致，不同种子会变', () => {
    configureZCMap(candidateLayouts.find((item) => item.homes?.length === 4)!);
    const match = captureZCMatchConfig(undefined);
    const first = createPvpTileTypes(createSeededRandom(seedOf(1)), match);
    const again = createPvpTileTypes(createSeededRandom(seedOf(1)), match);
    assert.deepEqual(again, first, '同种子必须产出同一副地块（服务端 seed 可复现）');
    const other = createPvpTileTypes(createSeededRandom(seedOf(2)), match);
    assert.notDeepEqual(other, first, '换种子应当换布局');
});
