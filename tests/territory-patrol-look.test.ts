import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import * as patrolModule from '../assets/script/app/territory/model/TerritoryMonsterPatrol';
import { buildTerritoryViewState } from '../assets/script/app/territory/application/TerritoryViewState';
import type { ITerritoryViewState } from '../assets/script/app/territory/application/TerritoryModel';
import { loadTsModule } from './helpers/cc-sandbox';
import * as hexLayout from '../assets/script/core/hex/HexGridLayout';

/**
 * 2026-11-19 用户原话：
 * 「新增的巡逻宝箱怪没有挑战成功前和普通的关卡地块一致
 *   1.激活后的地块是红色的
 *   2.巡逻的宝箱怪和战斗内的其他玩家卡牌一样叠加暗色和红色描边（一样的形式
 *   3.战斗胜利后这个形象取消叠加，回复正常的颜色，地块同理（和关卡一致」
 *
 * 地块那两条在 `territory-tile-frames.test.ts`（共用它的 paintHexes 桩表），
 * 本文件只管**形象**：压暗 / 放大副本红描边 / 胜利后恢复 / 与战斗内真源同源。
 */
const VIEW_PATH = 'assets/script/app/territory/view/TerritoryMonsterPatrolView.ts';
const VIEW_SRC = readFileSync(VIEW_PATH, 'utf8');
const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
const VIEW_STATE_SRC = readFileSync('assets/script/app/territory/application/TerritoryViewState.ts', 'utf8');
const LOADER_SRC = readFileSync('assets/script/app/territory/application/TerritoryChapterLoader.ts', 'utf8');
const ZC_UNIT_VIEW_SRC = readFileSync('assets/script/app/zcds/view/ZCUnitView.ts', 'utf8');
const ZC_THEME_SRC = readFileSync('assets/script/app/zcds/view/ZCTheme.ts', 'utf8');
const ZC_LOADER_SRC = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');

function sourceMap() {
    return { version: 1, mapKind: 'territoryChapter', id: 'patrol-look', name: 'test',
        chapterId: 1, rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            // 片 A：两格同 site.id / 同 battleId（与 chapter_01 一样每格一个站点）。
            { id: 'wave_a', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 60001, patrolId: 50021 },
            { id: 'wave_a', type: 'patrolChest', cellId: 2, footprint: [2], battleId: 60001 },
            // 片 B：另一场战斗，A 打赢不该把它一起变绿 / 停巡。
            { id: 'wave_b', type: 'patrolChest', cellId: 5, footprint: [5], battleId: 60002, patrolId: 50005 },
        ] };
}

// ── 一、判据真源：巡逻区「整片通过」 ──────────────────────────────────────

test('★ 同 battleId 任一格占点 ⇒ 整片（含 footprint）通过，另一片不受影响', () => {
    const map = configureTerritoryMap(sourceMap());
    const sites = map.sites;
    assert.equal(patrolModule.territoryPatrolPassedCells(sites, { isOwned: () => false }).size, 0,
        '还没打 ⇒ 没有一片通过');
    // 只占点 1 号格也要让 2 号格一起恢复（逐格 isOwned 会漏）。
    const passed = patrolModule.territoryPatrolPassedCells(sites, { isOwned: (id) => id === 1 });
    assert.deepEqual(Array.from(passed).sort((a, b) => a - b), [1, 2]);
    assert.equal(passed.has(5), false, '60002 是另一片 ⇒ 仍待挑战');
    // footprint 是「一格站点带多块地」的旧图形态：不铺开就只有锚点格转绿。
    const withFootprint = [
        { id: 'legacy', type: 'patrolChest', cellId: 1, footprint: [1, 9], battleId: 60001 },
    ] as never;
    assert.deepEqual(
        Array.from(patrolModule.territoryPatrolPassedCells(withFootprint, { isOwned: (id) => id === 1 }))
            .sort((a, b) => a - b),
        [1, 9]);
});

test('★ 野怪生灭与地块通过共用同一份判据：A 停巡、B 继续巡逻', () => {
    const map = configureTerritoryMap(sourceMap());
    const isCellUnlocked = (id: number) => [1, 2, 5].includes(id);
    const allPatrols = patrolModule.buildTerritoryMonsterPatrols(map,
        { isCellUnlocked, isOwned: () => false });
    assert.equal(allPatrols.length, 2);
    const remaining = patrolModule.buildTerritoryMonsterPatrols(map,
        { isCellUnlocked, isOwned: (id) => id === 1 });
    assert.equal(remaining.length, 1, 'A 片通过 ⇒ 那只怪不再生成（叠加自然随之消失）');
    assert.equal(remaining[0].cellId, 5, 'B 片照旧巡逻');
});

test('★ 发布帧把「已通过集合」和「巡逻野怪列表」同一拍冻结', () => {
    const map = configureTerritoryMap(sourceMap());
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked([1, 2, 5]);
    const state = { map, progress, wallet: { silver: 0, stamina: 0 },
        siteOpenableCells: [], pendingFixedResourceCells: [] } as unknown as ITerritoryViewState;
    const before = buildTerritoryViewState(state);
    assert.equal(before.patrolPassedCells.size, 0);
    assert.equal(before.monsterPatrols.length, 2);
    // 实时进度后来变了，已发布帧不许跟着变（延迟一帧渲染会读到新值 ⇒ 地块与怪不同步）。
    progress.applyServerState({ unlockCells: [1, 2, 5], passCells: [1] });
    const later = buildTerritoryViewState(state);
    assert.equal(before.patrolPassedCells.size, 0, '旧帧仍是没有通过');
    assert.equal(before.monsterPatrols.length, 2, '旧帧的怪也还在');
    assert.ok(later.patrolPassedCells.has(2), '新帧整片一起通过');
    assert.equal(later.monsterPatrols.length, 1, '新帧 A 片野怪停巡');
});

// ── 二、形象：VM 跑真 TerritoryMonsterPatrolView ─────────────────────────

class FakeColor {
    constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
}

class FakeSkeleton {
    skeletonData = { getRuntimeData: () => ({ height: 100, animations: [{ name: 'idle' }, { name: 'move' }] }) };
    color: FakeColor | null = null;
    customMaterial: unknown = null;
    premultipliedAlpha = false;
    clip = '';
    current = { trackTime: 0 };
    setAnimation(_track: number, clip: string) { this.clip = clip; return this.current; }
    getCurrent(_track: number) { return this.current; }
}

class FakeNode {
    name = 'Monster';
    layer = 0;
    active = true;
    siblingIndex = -1;
    parent: FakeNode | null = null;
    children: FakeNode[] = [];
    skeleton = new FakeSkeleton();
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    destroyed = 0;
    getComponent() { return {}; }
    getComponentInChildren() { return this.skeleton; }
    setParent(parent: FakeNode) { this.parent = parent; parent.children.push(this); }
    setSiblingIndex(index: number) { this.siblingIndex = index; }
    setPosition(x: number, y: number, z: number) { this.position = { x, y, z }; }
    setScale(x: number, y: number, z: number) { this.scale = { x, y, z }; }
    destroy() { this.destroyed += 1; }
}

function loadPatrolView() {
    const nodes: FakeNode[] = [];
    const loaded = loadTsModule<{ TerritoryMonsterPatrolView: new (parent: FakeNode) => {
        sync(...args: unknown[]): void; step(now: number): void; clear(): void;
    } }>(VIEW_PATH, { modules: {
        cc: {
            Color: FakeColor,
            sp: { Skeleton: FakeSkeleton },
            UITransform: class {},
            instantiate: () => { const node = new FakeNode(); nodes.push(node); return node; },
        },
        '/HexGridLayout': hexLayout,
        '/TerritoryMonsterPatrol': patrolModule,
    } });
    assert.deepEqual(loaded.unresolved, []);
    return { view: new loaded.exports.TerritoryMonsterPatrolView(new FakeNode()), nodes };
}

const MAP = {};
const LAYOUT = { points: new Map<number, { x: number; y: number }>([
    [1, { x: 0, y: 0 }], [2, { x: 10, y: 0 }], [9, { x: 20, y: 0 }],
]) };
const PATROLS = [{ cellId: 1, monsterId: 50021, route: [1, 2] }];
const PREFABS = new Map<number, unknown>([[50021, {}]]);
const MATERIAL = { name: 'unit-outline-copy-material' };

function rgb(color: FakeColor | null): number[] {
    return color ? [color.r, color.g, color.b] : [];
}

test('★★★ 未挑战成功：主骨架 #828282 + 放大 1.08 的红色描边副本（与战斗内同形）', () => {
    const { view, nodes } = loadPatrolView();
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1000, { outlineMaterial: MATERIAL });
    assert.equal(nodes.length, 2, '本体 + 描边副本各一份 prefab 实例');
    const main = nodes[0];
    const copy = nodes[1];
    assert.deepEqual(rgb(main.skeleton.color), [0x82, 0x82, 0x82], '主骨架压暗');
    assert.equal(copy.parent, main, '副本挂在本体下面 ⇒ 朝向 / 位移自动跟随');
    assert.equal(copy.siblingIndex, 0, '副本排在本体原骨架之前（先画副本才有「边」）');
    assert.equal(copy.scale.x, 1.08, '整只角色放大 1.08');
    assert.equal(copy.skeleton.customMaterial, MATERIAL, '副本挂 unit-outline-copy 材质');
    assert.equal(copy.skeleton.premultipliedAlpha, true, 'shader 按预乘口径输出');
    assert.deepEqual(rgb(copy.skeleton.color), [251, 73, 105], '描边染敌方红');
    assert.equal(copy.skeleton.clip, main.skeleton.clip, '副本与本体同一段动画');
    assert.equal(copy.active, true, '未打赢 ⇒ 描边显示');
});

test('★★★ 挑战成功：主骨架回原色、描边副本收起；状态翻转可双向恢复（绝对写）', () => {
    const { view, nodes } = loadPatrolView();
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1000,
        { outlineMaterial: MATERIAL, clearedCells: new Set([1]) });
    assert.deepEqual(rgb(nodes[0].skeleton.color), [255, 255, 255], '胜利 ⇒ 恢复原色');
    assert.equal(nodes[1].active, false, '胜利 ⇒ 红描边取消');
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1100,
        { outlineMaterial: MATERIAL, clearedCells: new Set() });
    assert.deepEqual(rgb(nodes[0].skeleton.color), [0x82, 0x82, 0x82],
        '节点按 cellId 复用 ⇒ 不许残留上一次的白');
    assert.equal(nodes[1].active, true, '副本重新显示，不靠「只在创建时染一次」');
    assert.equal(nodes.length, 2, '重渲染不重建节点');
});

test('★★ shader 缺失 ⇒ 不建放大副本，但仍压暗（绝不退化成一只放大的红怪）', () => {
    const { view, nodes } = loadPatrolView();
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1000, { outlineMaterial: null });
    assert.equal(nodes.length, 1);
    assert.deepEqual(rgb(nodes[0].skeleton.color), [0x82, 0x82, 0x82]);
    assert.equal(nodes[0].active, true);
});

test('★★ 副本与本体锁相：step 把轨道时间对齐，红边不许慢半拍', () => {
    const { view, nodes } = loadPatrolView();
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1000, { outlineMaterial: MATERIAL });
    nodes[0].skeleton.current.trackTime = 0.375;
    nodes[1].skeleton.current.trackTime = 0.01;
    view.step(1200);
    assert.equal(nodes[1].skeleton.current.trackTime, 0.375);
    // 胜利后副本收起 ⇒ 不再写副本轨道（下一帧恢复显示时才重新对齐）。
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1200,
        { outlineMaterial: MATERIAL, clearedCells: new Set([1]) });
    nodes[0].skeleton.current.trackTime = 0.9;
    nodes[1].skeleton.current.trackTime = 0.375;
    view.step(1300);
    assert.equal(nodes[1].skeleton.current.trackTime, 0.375, '隐藏的副本不参与锁相');
});

test('★ clear 只 destroy 本体一次（副本是子节点，不许重复销毁）', () => {
    const { view, nodes } = loadPatrolView();
    view.sync(MAP, LAYOUT, PATROLS, PREFABS, 1000, { outlineMaterial: MATERIAL });
    view.clear();
    assert.equal(nodes[0].destroyed, 1);
    assert.equal(nodes[1].destroyed, 0, '副本随本体销毁，不单独 destroy');
});

// ── 三、同源守卫：数值 / shader 与战斗内「其他玩家卡牌」不许漂移 ──────────

test('★★ 暗色 / 红边 / 放大倍数 / shader 全部读战斗内真源（防魔数漂移）', () => {
    assert.match(ZC_UNIT_VIEW_SRC, /OTHER_PLAYER_TINT\s*=\s*new Color\(0x82, 0x82, 0x82, 255\)/);
    assert.deepEqual([...patrolModule.TERRITORY_PATROL_DIM_RGB], [0x82, 0x82, 0x82],
        '战斗内改了暗色，这里必须一起改（源码守卫会红）');
    assert.match(ZC_THEME_SRC, /enemyEdge:\s*new Color\(251, 73, 105, 255\)/);
    assert.deepEqual([...patrolModule.TERRITORY_PATROL_EDGE_RGB], [251, 73, 105]);
    assert.match(ZC_UNIT_VIEW_SRC, /OUTLINE_COPY_SCALE\s*=\s*1\.08/);
    assert.equal(patrolModule.TERRITORY_PATROL_OUTLINE_SCALE, 1.08);
    assert.match(ZC_LOADER_SRC, /UNIT_OUTLINE_COPY_EFFECT_URL\s*=\s*'shaders\/unit-outline-copy'/);
    assert.equal(patrolModule.TERRITORY_PATROL_OUTLINE_EFFECT_PATH, 'shaders/unit-outline-copy');
    assert.equal(existsSync('assets/resources/shaders/unit-outline-copy.effect'), true,
        '描边 shader 必须真的在 resources 里，否则加载失败只剩压暗');
});

test('★★ 描边副本的四条硬口径都落在视图里（少一条就「结算正常、画面全无」）', () => {
    assert.match(VIEW_SRC, /if \(!material\) return null/, '材质缺失必须整支不建');
    assert.match(VIEW_SRC, /copy\.setSiblingIndex\(0\)/, '副本必须先画');
    assert.match(VIEW_SRC, /skeleton\.customMaterial = material/, '必须挂 shader 材质');
    assert.match(VIEW_SRC, /skeleton\.premultipliedAlpha = true/, '预乘口径必须钉死');
    assert.match(VIEW_SRC, /copy\.setScale\(TERRITORY_PATROL_OUTLINE_SCALE/);
    assert.match(VIEW_SRC, /visual\.skeleton\.color = cleared \? PATROL_NORMAL : PATROL_DIM/,
        '写绝对色，不许靠「创建时染一次」');
    assert.match(VIEW_SRC, /if \(!outline \|\| !outline\.node\.active\) continue/,
        '隐藏的副本不参与锁相');
});

test('★★ 发布帧 → 页面 → 视图三处共用同一份「整片通过」集合', () => {
    assert.match(VIEW_STATE_SRC, /patrolPassedCells: state\.map && progress/,
        '判据要在发布帧算好并冻结，别让视图自己读实时进度');
    assert.match(PAGE_SRC, /patrolPassedCells: state\.patrolPassedCells/,
        '页面必须把它透传给 renderMap');
    assert.match(MAP_VIEW_SRC, /const patrolPassedCells = input\.patrolPassedCells \?\? EMPTY_CELL_SET/);
    assert.match(MAP_VIEW_SRC, /clearedCells: input\.patrolPassedCells \?\? EMPTY_CELL_SET/,
        '地块与野怪不许各查一份进度');
    assert.match(MAP_VIEW_SRC, /outlineMaterial: input\.art\.monsterOutlineMaterial \?\? null/);
});

test('★★ 章节加载器只在有巡逻怪时加载描边 shader，且失败可降级', () => {
    assert.match(LOADER_SRC, /TERRITORY_PATROL_OUTLINE_EFFECT_PATH, EffectAsset/);
    assert.match(LOADER_SRC, /material\.initialize\(\{ effectAsset: effect \}\)/);
    assert.match(LOADER_SRC, /if \(monsterIds\.size\)/);
    assert.match(LOADER_SRC, /catch \(error\)/, 'shader 缺失不许让整章加载失败');
    assert.match(LOADER_SRC, /monsterOutlineMaterial \}/, '材质必须挂进 art 交出去');
});
