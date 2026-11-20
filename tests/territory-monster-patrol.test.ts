import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
import * as tableParserModule from '../assets/script/app/zcds/model/ZCPvpTableParser';
// @ts-ignore 编辑器与客户端使用同一组输入验证契约。
import { normalizeTerritoryMap } from '../tools/map-editor/formats/territory-format.js';

/**
 * 一片巡逻区 = **同一个 `site.id`**（客户端与编辑器同一口径）。
 * 区域 A = 1/2/5（`patrol_1`，锚点格 1 带 `patrolId`），区域 B = 6（`patrol_6` ⇒ 另一片）。
 */
function sourceMap() {
    return { version: 1, mapKind: 'territoryChapter', id: 'patrol', name: 'test', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            { id: 'patrol_1', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 60001, patrolId: 50021 },
            { id: 'patrol_1', type: 'patrolChest', cellId: 5, footprint: [5], battleId: 60001 },
            { id: 'patrol_1', type: 'patrolChest', cellId: 2, footprint: [2], battleId: 60001 },
            { id: 'patrol_6', type: 'patrolChest', cellId: 6, footprint: [6], battleId: 60001, patrolId: 50005, unlock: { requiredCells: [2] } },
        ] };
}

test('章节加载按 monsterCard.id 预载巡逻模型，重复 ID 只加载一次，错误 ID 明确失败', async () => {
    const source = sourceMap();
    source.sites[3].patrolId = 50021;
    const loads: string[] = [];
    const prefab = {};
    // 每个用例都要能改这一行：体型系数缺失 / 填 0 的表现都在这儿验。
    let monsterRow: Record<string, unknown> = { id: 50021, unitPrefabPath: 'skel/monster', prefabSize: 1.5 };
    const loaded = loadTsModule<{ TerritoryChapterLoader: new (assets: unknown) => {
        load(chapter: number): Promise<{ art: {
            monsterPrefabs: Map<number, unknown>;
            monsterPrefabSizes: Map<number, number>;
            monsterOutlineMaterial: unknown;
        } }>;
    } }>('assets/script/app/territory/application/TerritoryChapterLoader.ts', { modules: {
        cc: { Prefab: class {}, EffectAsset: class {}, Material: class { initialize() {} } },
        '/TerritoryPageAssets': { loadTerritoryMapJson: async () => source, loadTerritoryBattleArt: async () => ({}) },
        '/TerritoryCampaignRepository': { loadTerritoryCampaign: async () => ({ stages: [], playerCardCount: 0 }) },
        '/TerritoryMapConfig': mapConfigModule,
        '/TerritoryMonsterPatrol': patrolModule,
        // 体型系数必须走 `ZCPvpTableParser` 的同一个解析入口，不许在领地侧另写一份。
        '/ZCPvpTableParser': tableParserModule,
        '/RefUtil': { RefUtil: { instance: { getRefAllAsync: async () => [monsterRow] } } },
    } });
    assert.deepEqual(loaded.unresolved, []);
    const loader = new loaded.exports.TerritoryChapterLoader({ load: async (path: string) => {
        // 描边 shader 缺席要能降级（只压暗、不描边），不许整章加载失败。
        if (path === patrolModule.TERRITORY_PATROL_OUTLINE_EFFECT_PATH) return null;
        loads.push(path);
        return prefab;
    } });
    const bundle = await loader.load(1);
    assert.equal(bundle.art.monsterPrefabs.get(50021), prefab);
    assert.equal(bundle.art.monsterPrefabSizes.get(50021), 1.5, 'monsterCard.prefabSize 要跟着 prefab 一起取出来');
    assert.equal(bundle.art.monsterOutlineMaterial, null, 'shader 没加载到 ⇒ 只压暗、不画红描边');
    assert.deepEqual(loads, ['skel/monster']);

    monsterRow = { id: 50021, unitPrefabPath: 'skel/monster' };
    assert.equal((await loader.load(1)).art.monsterPrefabSizes.get(50021), 1, '表列留空 ⇒ 1（不缩放）');
    monsterRow = { id: 50021, unitPrefabPath: 'skel/monster', prefabSize: 0 };
    await assert.rejects(loader.load(1), /prefabSize/, '填 0 会让怪凭空消失，必须当场炸');
    monsterRow = { id: 50021, unitPrefabPath: 'skel/monster', prefabSize: 1.5 };

    source.sites[0].patrolId = 99999;
    await assert.rejects(loader.load(1), /99999.*unitPrefabPath/);
});

test('同一片巡逻区（同 site.id）全部解锁后才从 patrolId 格开始整片巡逻', () => {
    const map = configureTerritoryMap(sourceMap());
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked([1, 2]);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), [], '区域 A 还差 5 号格没解锁');
    progress.markCellsUnlocked([5]);
    const patrols = buildTerritoryMonsterPatrols(map, progress);
    assert.equal(patrols.length, 1, '区域 B（6 号格）自己没解锁，不该出怪');
    assert.equal(patrols[0].monsterId, 50021);
    assert.equal(patrols[0].route[0], 1);
    assert.equal(map.sites.filter((site) => site.id === 'patrol_1').length, 3, '一片巡逻区在同 id 下有三格');
    // 一片巡逻区 = 同一个 `site.id`（2026-11-18 口径），三格同 id 拼成一条整片路线。
    assert.deepEqual(new Set(patrols[0].route), new Set([1, 2, 5]));
    assert.ok(!patrols[0].route.includes(6), '另一片区域（前置不同）不并入路线');
    for (let i = 0; i < patrols[0].route.length; i += 1) {
        assert.ok(territoryNeighbors(patrols[0].route[i], map).includes(patrols[0].route[(i + 1) % patrols[0].route.length]));
    }
});

test('同片共用 battleId：任一格占点即整片通过并停巡，另一片不受影响', () => {
    const map = configureTerritoryMap({ version: 1, mapKind: 'territoryChapter', id: 'patrol-battle',
        name: 'test', chapterId: 1, rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            // 片 A：1（锚点）+ 5，共用 60001
            { id: 'wave_a', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 60001, patrolId: 50021 },
            { id: 'wave_a', type: 'patrolChest', cellId: 5, footprint: [5], battleId: 60001 },
            // 片 B：2 单独一片，自己一场
            { id: 'wave_b', type: 'patrolChest', cellId: 2, footprint: [2], battleId: 60002, patrolId: 50005 },
        ] });
    const progress = new TerritoryProgress(map, { unlockedCells: [1, 2, 5] });
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress).map(patrol => patrol.cellId), [1, 2]);
    // 片 A 的 5 号格占点 ⇒ 60001 整片通过：1 号格的野怪停巡；片 B 的 60002 没打，仍在。
    progress.markCellPassed(5);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress).map(patrol => patrol.cellId), [2]);
    progress.markCellPassed(2);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
});

test('同片格子要全部解锁才启动；片内任一格已占点 ⇒ 整片不再出怪', () => {
    const source = sourceMap();
    source.sites = [
        { id: 'route', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 60001, patrolId: 50021 },
        { id: 'route', type: 'patrolChest', cellId: 5, footprint: [5], battleId: 60001 },
    ];
    const map = configureTerritoryMap(source);
    const progress = new TerritoryProgress(map, { ownedCells: [0] });
    progress.markCellsUnlocked([1]);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), [], '5 号格还锁着，整片还不能出怪');
    progress.markCellsUnlocked([5]);
    assert.deepEqual(new Set(buildTerritoryMonsterPatrols(map, progress)[0].route), new Set([1, 5]));

    // 同片共用 60001：5 号格一占点，这一片就算打过 ⇒ 1 号格的怪也停巡。
    progress.markCellPassed(5);
    assert.deepEqual(buildTerritoryMonsterPatrols(map, progress), []);
});

test('编辑器与客户端接受巡逻同 ID 和组内依赖，仍拒绝普通站点重名与断开的路线', () => {
    assert.equal(normalizeTerritoryMap(sourceMap()).map.sites.length, 4);
    // 同 ID 且连通 ⇒ 合法（一片巡逻区就是这么声明的）。
    assert.equal(configureTerritoryMap(sourceMap()).sites.length, 4);
    assert.equal(normalizeTerritoryMap(sourceMap()).map.sites.length, 4);
    for (const parse of [configureTerritoryMap, (raw: unknown) => normalizeTerritoryMap(raw)]) {
        // 同 id 但拍不连通 ⇒ 拒绝（editor 与客户端都要）。
        const disconnected = sourceMap();
        disconnected.sites[1].cellId = 15;
        disconnected.sites[1].footprint = [15];
        assert.throws(() => parse(disconnected), /contiguous/);
        // 巡逻格与普通站点同名 ⇒ 拒绝（只有巡逻宝箱允许同 id）。
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

/**
 * 巡逻节点桩：`instantiate` 出来的东西只需要 `layer` / `children` / `setScale` 这一组，
 * 断言直接读它记账的 position / scale / destroyed。
 */
interface IPatrolFakeNode {
    layer: number;
    active: boolean;
    siblingIndex: number;
    children: IPatrolFakeNode[];
    skeleton: {
        skeletonData: unknown;
        animation: string;
        color: { r: number; g: number; b: number } | null;
        getCurrent(): { trackTime: number };
        setAnimation(track: number, animation: string): void;
    };
    position: { x: number; y: number };
    scale: { x: number; y: number };
    destroyed: boolean;
    getComponent(): object;
    getComponentInChildren(): unknown;
    setParent(): void;
    setSiblingIndex(index: number): void;
    setPosition(x: number, y: number): void;
    setScale(x: number, y: number): void;
    destroy(): void;
}

interface IPatrolViewLike {
    sync(map: object, layout: unknown, patrols: unknown, prefabs: unknown, now: number,
        options?: { outlineMaterial?: unknown; prefabSizes?: ReadonlyMap<number, number>; clearedCells?: ReadonlySet<number> }): void;
    step(now: number): void;
    clear(): void;
}

/**
 * `TerritoryMonsterPatrolView` 的 cc 桩。
 *
 * 抽成工厂而不是让每个用例各写一份：移动/清理与体型系数两组断言共用同一套节点记账，
 * 各写一份的话 `skeletonData.height` 一改就会只绿一半。
 */
function createPatrolSandbox(): { view: IPatrolViewLike; nodes: IPatrolFakeNode[] } {
    class Transform {}
    class FakeColor {
        constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
    }
    class Skeleton {
        skeletonData = { getRuntimeData: () => ({ height: 100, animations: [{ name: 'idle' }, { name: 'move' }] }) };
        animation = '';
        color: FakeColor | null = null;
        getCurrent() { return { trackTime: 0 }; }
        setAnimation(_track: number, animation: string) {
            this.animation = animation;
        }
    }
    class VisualNode {
        layer = 1;
        active = true;
        siblingIndex = -1;
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
        setSiblingIndex(index: number) { this.siblingIndex = index; }
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
    const loaded = loadTsModule<{ TerritoryMonsterPatrolView: new (parent: unknown) => IPatrolViewLike }>(
        'assets/script/app/territory/view/TerritoryMonsterPatrolView.ts', { modules: {
            cc: { Color: FakeColor, sp: { Skeleton }, UITransform: Transform, instantiate: () => {
                const node = new VisualNode();
                nodes.push(node);
                return node;
            } },
            '/HexGridLayout': hexLayout,
            '/TerritoryMonsterPatrol': patrolModule,
        } });
    assert.deepEqual(loaded.unresolved, []);
    return { view: new loaded.exports.TerritoryMonsterPatrolView({ layer: 1 }), nodes };
}

test('巡逻表现按绝对时间移动，重复渲染不中断，撤销与换章清理旧模型', () => {
    const { view, nodes } = createPatrolSandbox();
    const map = configureTerritoryMap(sourceMap());
    const layout = buildTerritoryMapLayout(map);
    const patrols = buildTerritoryMonsterPatrols(map, new TerritoryProgress(map, { unlockedCells: [1, 2, 5] }));
    const prefabs = new Map([[50021, {}]]);
    view.sync(map, layout, patrols, prefabs, 1000);
    assert.deepEqual(
        [nodes[0].skeleton.color?.r, nodes[0].skeleton.color?.g, nodes[0].skeleton.color?.b],
        [0x82, 0x82, 0x82], '没挑战成功 ⇒ 主骨架压成 #828282（战斗内其他玩家卡牌同款）');
    assert.equal(nodes.length, 1, '没传描边材质 ⇒ 不建放大副本，不许退化成红色怪');
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

test('章节 1 五片巡逻区全解锁时，每只野怪都有整片路线（不许单格待机）', () => {
    const source = JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const map = configureTerritoryMap(source);
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked(map.sites
        .filter(site => site.type === 'patrolChest')
        .map(site => site.cellId));
    const patrols = buildTerritoryMonsterPatrols(map, progress);
    assert.equal(patrols.length, 5, '五片巡逻区各一只（每片只有一个格填 patrolId）');
    for (const patrol of patrols) {
        assert.ok(patrol.route.length > 3,
            `patrol@${patrol.cellId} 的路线只有 ${patrol.route.length} 格 —— 野外看到的就是"站着不动"`);
    }
});

test('分组只看 site.id：同片 battleId 写歪也仍是一整片路线', () => {
    const source = sourceMap();
    source.sites = [
        { id: 'route', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 60001, patrolId: 50021 },
        // 同 id、battleId 写歪：分组不看它 ⇒ 仍是同一片，路线要覆盖两格
        { id: 'route', type: 'patrolChest', cellId: 5, footprint: [5], battleId: 60002 },
    ];
    const map = configureTerritoryMap(source);
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked([1, 5]);
    const patrols = buildTerritoryMonsterPatrols(map, progress);
    assert.equal(patrols.length, 1);
    assert.deepEqual(new Set(patrols[0].route), new Set([1, 5]), '同 id 就是一片，不能被 battleId 拆开');
});

/**
 * 巡逻野怪的体型（`monsterCard.prefabSize`）—— 与战斗内 `ZCUnitView` 同一条口径：
 * 「塞进六边格」的技术归一 × 策划的体型系数。顺序反了巨型怪的格子会撑爆。
 */
test('巡逻野怪按 monsterCard.prefabSize 缩放：在六边格归一之上相乘，缺省 1，改值重建', () => {
    const { view, nodes } = createPatrolSandbox();
    const map = configureTerritoryMap(sourceMap());
    const layout = buildTerritoryMapLayout(map);
    const patrols = buildTerritoryMonsterPatrols(map, new TerritoryProgress(map, { unlockedCells: [1, 2, 5] }));
    const prefabs = new Map([[50021, {}]]);
    // 桩里骨架高 100 ⇒ 技术归一 = HEX_GRID_FACE_HEIGHT * 0.8 / 100（与视图同一条式子）。
    const base = hexLayout.HEX_GRID_FACE_HEIGHT * 0.8 / 100;

    // ① 不传 sizes（老调用方 / 表列留空）⇒ 只做归一，等价 prefabSize = 1
    view.sync(map, layout, patrols, prefabs, 1000);
    assert.ok(Math.abs(nodes[0].scale.y - base) < 1e-6, `缺省应只做网格归一，实际 ${nodes[0].scale.y}`);
    assert.equal(nodes.length, 1);

    // ② 1.5 倍（冰霜巨龙 / 独眼巨人）：乘在归一之上，不是把它顶掉
    view.sync(map, layout, patrols, prefabs, 1000, { prefabSizes: new Map([[50021, 1.5]]) });
    assert.equal(nodes.length, 2, '体型变了要按新值重建 —— 复用旧 scale 会永远停在旧大小');
    assert.equal(nodes[0].destroyed, true, '旧节点要销毁，不然两只怪叠在一格');
    assert.ok(Math.abs(nodes[1].scale.y - base * 1.5) < 1e-6, `1.5 倍未生效：${nodes[1].scale.y}`);

    // ③ 同值重复 sync 不许重建（每次渲染都重建会打断骨架动画）
    view.sync(map, layout, patrols, prefabs, 1000, { prefabSizes: new Map([[50021, 1.5]]) });
    assert.equal(nodes.length, 2);

    // ④ 缩小的那只同样按表走（0.8）
    view.sync(map, layout, patrols, prefabs, 1000, { prefabSizes: new Map([[50021, 0.8]]) });
    assert.equal(nodes.length, 3);
    assert.ok(Math.abs(nodes[2].scale.y - base * 0.8) < 1e-6, `0.8 倍未生效：${nodes[2].scale.y}`);
});
