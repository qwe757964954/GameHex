import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { configureTerritoryMap, territoryNeighbors } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { buildTerritoryMonsterPatrols, TERRITORY_MONSTER_PATROL_STEP_MS } from '../assets/script/app/territory/model/TerritoryMonsterPatrol';
import { buildTerritoryMapLayout } from '../assets/script/app/territory/model/TerritoryMapLayout';
import { buildTerritoryViewState } from '../assets/script/app/territory/application/TerritoryViewState';
import type { ITerritoryViewState } from '../assets/script/app/territory/application/TerritoryModel';
import { loadTsModule } from './helpers/cc-sandbox';
import * as hexLayout from '../assets/script/core/hex/HexGridLayout';
import * as patrolModule from '../assets/script/app/territory/model/TerritoryMonsterPatrol';
import * as mapConfigModule from '../assets/script/app/territory/model/TerritoryMapConfig';
// @ts-ignore 编辑器与客户端使用同一组输入验证契约。
import { normalizeTerritoryMap } from '../tools/map-editor/formats/territory-format.js';

function sourceMap() {
    return { version: 1, mapKind: 'territoryChapter', id: 'patrol', name: 'test', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            { id: 'route', type: 'patrolChest', cellId: 1, footprint: [1], battleIds: [60001], patrolId: 50021 },
            { id: 'route', type: 'patrolChest', cellId: 5, footprint: [5], battleIds: [60001], unlock: { requiredCells: [1] } },
            { id: 'route', type: 'patrolChest', cellId: 2, footprint: [2], battleIds: [60001] },
            { id: 'other', type: 'patrolChest', cellId: 6, footprint: [6], battleIds: [60001], patrolId: 50005 },
        ] };
}

test('章节加载按 monsterCard.id 预载巡逻模型，重复 ID 只加载一次，错误 ID 明确失败', async () => {
    const source = sourceMap();
    source.sites[3].patrolId = 50021;
    const loads: string[] = [];
    const prefab = {};
    const loaded = loadTsModule<{ TerritoryChapterLoader: new (assets: unknown) => {
        load(chapter: number): Promise<{ art: { monsterPrefabs: Map<number, unknown> } }>;
    } }>('assets/script/app/territory/application/TerritoryChapterLoader.ts', { modules: {
        cc: { Prefab: class {} },
        '/TerritoryPageAssets': { loadTerritoryMapJson: async () => source, loadTerritoryBattleArt: async () => ({}) },
        '/TerritoryCampaignRepository': { loadTerritoryCampaign: async () => ({ stages: [], playerCardCount: 0 }) },
        '/TerritoryMapConfig': mapConfigModule,
        '/RefUtil': { RefUtil: { instance: { getRefAllAsync: async () => [{ id: 50021, unitPrefabPath: 'skel/monster' }] } } },
    } });
    assert.deepEqual(loaded.unresolved, []);
    const loader = new loaded.exports.TerritoryChapterLoader({ load: async (path: string) => {
        loads.push(path);
        return prefab;
    } });
    assert.equal((await loader.load(1)).art.monsterPrefabs.get(50021), prefab);
    assert.deepEqual(loads, ['skel/monster']);
    source.sites[0].patrolId = 99999;
    await assert.rejects(loader.load(1), /99999.*unitPrefabPath/);
});

test('相同站点 ID 的格子全部解锁后才从配置野怪 ID 的格子开始巡逻', () => {
    const map = configureTerritoryMap(sourceMap());
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked([1, 5]);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
    progress.markCellsUnlocked([2, 6]);
    const patrols = buildTerritoryMonsterPatrols(map, progress);
    assert.equal(patrols.length, 2);
    assert.equal(patrols[0].monsterId, 50021);
    assert.equal(patrols[0].route[0], 1);
    assert.deepEqual(new Set(patrols[0].route), new Set([1, 2, 5]));
    assert.deepEqual(patrols[1].route, [6], '相邻但 ID 不同的格子不并入路线');
    for (let i = 0; i < patrols[0].route.length; i += 1) {
        assert.ok(territoryNeighbors(patrols[0].route[i], map).includes(patrols[0].route[(i + 1) % patrols[0].route.length]));
    }
});

test('巡逻野怪按 battleIds 下标分配战斗，同战斗任一格占点即整片通过并停巡', () => {
    // 组内三格按 cellId 升序摊 [60001, 60002] ⇒ 1 → 60001、2 → 60002、5 → 60001。
    const map = configureTerritoryMap({ version: 1, mapKind: 'territoryChapter', id: 'patrol-battle',
        name: 'test', chapterId: 1, rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            { id: 'wave', type: 'patrolChest', cellId: 1, footprint: [1], battleIds: [60001, 60002], patrolId: 50021 },
            { id: 'wave', type: 'patrolChest', cellId: 2, footprint: [2], battleIds: [60001, 60002], patrolId: 50005 },
            { id: 'wave', type: 'patrolChest', cellId: 5, footprint: [5], battleIds: [60001, 60002] },
        ] });
    const progress = new TerritoryProgress(map, { unlockedCells: [1, 2, 5] });
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress).map(patrol => patrol.cellId), [1, 2]);
    // 占掉 5（与 1 同属 60001）⇒ 60001 整片通过：1 号格停巡，2 号格的 60002 没打，仍在。
    progress.markCellPassed(5);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress).map(patrol => patrol.cellId), [2]);
    progress.markCellPassed(2);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
});

test('多格 footprint 全部解锁才启动，已占领格仍属于巡逻路线', () => {
    const source = sourceMap();
    source.sites = [
        { id: 'route', type: 'patrolChest', cellId: 1, footprint: [1], battleIds: [60001, 60002], patrolId: 50021 },
        { id: 'route', type: 'patrolChest', cellId: 5, footprint: [5], battleIds: [60001, 60002] },
    ];
    const map = configureTerritoryMap(source);
    // 5 号格已占领（60002 通过），1 号格的 60001 还没打 ⇒ 这一只仍在巡逻。
    const progress = new TerritoryProgress(map, { ownedCells: [0, 5] });
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
    progress.markCellsUnlocked([1]);
    assert.deepEqual(new Set(buildTerritoryMonsterPatrols(map, progress)[0].route), new Set([1, 5]));
});

test('编辑器与客户端接受巡逻同 ID 和组内依赖，仍拒绝普通站点重名与断开的路线', () => {
    assert.equal(normalizeTerritoryMap(sourceMap()).map.sites.length, 4);
    for (const parse of [configureTerritoryMap, (raw: unknown) => normalizeTerritoryMap(raw)]) {
        const disconnected = sourceMap();
        disconnected.sites[1].cellId = 15;
        disconnected.sites[1].footprint = [15];
        assert.throws(() => parse(disconnected), /contiguous/);
        const duplicate = sourceMap();
        duplicate.sites[1] = { ...duplicate.sites[1], type: 'stage' };
        assert.throws(() => parse(duplicate), /duplicate site id/);
    }
});

test('已发布巡逻投影不随实时进度变化，无野怪 ID 的旧地图不生成野怪', () => {
    const map = configureTerritoryMap(sourceMap());
    const progress = new TerritoryProgress(map);
    const state = { map, progress, wallet: { silver: 0, stamina: 0 }, siteOpenableCells: [], pendingFixedResourceCells: [] } as unknown as ITerritoryViewState;
    const before = buildTerritoryViewState(state);
    progress.markCellsUnlocked([1, 2, 5]);
    assert.equal(buildTerritoryViewState(state).monsterPatrols.length, 1);
    assert.deepEqual(before.monsterPatrols, []);
    for (const site of map.sites) delete site.patrolId;
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
});

test('巡逻表现按绝对时间移动，重复渲染不中断，撤销与换章清理旧模型', () => {
    class Transform {}
    class Skeleton {
        skeletonData = { getRuntimeData: () => ({ height: 100, animations: [{ name: 'idle' }, { name: 'move' }] }) };
        animation = '';
        setAnimation(_track: number, animation: string) {
            this.animation = animation;
        }
    }
    class VisualNode {
        layer = 1;
        children: VisualNode[] = [];
        skeleton = new Skeleton();
        position = { x: 0, y: 0 };
        scale = { x: 1, y: 1 };
        destroyed = false;
        getComponent() {
            return new Transform();
        }
        getComponentInChildren() {
            return this.skeleton;
        }
        setParent() {}
        setPosition(x: number, y: number) {
            this.position = { x, y };
        }
        setScale(x: number, y: number) {
            this.scale = { x, y };
        }
        destroy() {
            this.destroyed = true;
        }
    }
    const nodes: VisualNode[] = [];
    const loaded = loadTsModule<{ TerritoryMonsterPatrolView: new (parent: unknown) => {
        sync(...args: unknown[]): void; step(now: number): void; clear(): void;
    } }>('assets/script/app/territory/view/TerritoryMonsterPatrolView.ts', { modules: {
        cc: { sp: { Skeleton }, UITransform: Transform, instantiate: () => {
            const node = new VisualNode();
            nodes.push(node);
            return node;
        } },
        '/HexGridLayout': hexLayout,
        '/TerritoryMonsterPatrol': patrolModule,
    } });
    assert.deepEqual(loaded.unresolved, []);
    const view = new loaded.exports.TerritoryMonsterPatrolView({ layer: 1 });
    const map = configureTerritoryMap(sourceMap());
    const layout = buildTerritoryMapLayout(map);
    const patrols = buildTerritoryMonsterPatrols(map, new TerritoryProgress(map, { unlockedCells: [1, 2, 5] }));
    const prefabs = new Map([[50021, {}]]);
    view.sync(map, layout, patrols, prefabs, 1000);
    const from = layout.points.get(1);
    const to = layout.points.get(patrols[0].route[1]);
    view.step(1000 + TERRITORY_MONSTER_PATROL_STEP_MS / 2);
    assert.equal(nodes[0].position.x, (from.x + to.x) / 2);
    assert.equal(nodes[0].position.y, (from.y + to.y) / 2 + hexLayout.HEX_GRID_CONTENT_LIFT);
    assert.equal(nodes[0].skeleton.animation, 'move');
    const middle = { ...nodes[0].position };
    view.sync(map, layout, patrols, prefabs, 1000 + TERRITORY_MONSTER_PATROL_STEP_MS / 2);
    assert.deepEqual(nodes[0].position, middle);
    assert.equal(nodes.length, 1);
    view.step(1000 + TERRITORY_MONSTER_PATROL_STEP_MS * patrols[0].route.length);
    assert.equal(nodes[0].position.x, from.x, '循环回到出生格');
    view.sync({}, layout, patrols, prefabs, 10000);
    assert.equal(nodes[0].destroyed, true);
    assert.equal(nodes.length, 2);
    view.sync(map, layout, [], prefabs, 10001);
    assert.equal(nodes[1].destroyed, true);
    view.clear();
});
