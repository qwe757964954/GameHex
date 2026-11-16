import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 选点整盘渲染的闸门守卫（2026-11-16）。
 *
 * `renderSpawnSelection` 原来被 `ZCGame.update` 每帧驱动：全图重填归属表、重建边界 mask、
 * 逐格 `invalidReason`（含 BFS），10 秒选点窗口里 60fps 白算。现在按
 * 「同一份 selection + 同一 `revision` + 相同提示开关 + 相同地图缩放」跳过。
 *
 * 判据是**行为**：连续两帧同状态不得再碰任何一格；`revision` / 提示开关 / 缩放 /
 * selection 实例（新一局）任一变化都必须重绘。
 */

function fakeSelection(revision: number) {
    const hexes = [
        { id: 0, playable: true, x: 0, y: 0, neighbors: [1, 2] },
        { id: 1, playable: true, x: 1, y: 0, neighbors: [0, 2] },
        { id: 2, playable: true, x: 0.5, y: 1, neighbors: [0, 1] },
    ];
    return {
        revision,
        map: { hexes },
        snapshot: {
            selections: {
                player: { selectedHexId: 0, confirmedHexId: null, invalidReason: null },
                enemy: { selectedHexId: null, confirmedHexId: null, invalidReason: null },
            },
        },
        regionOwnerOf: (id: number) => (id === 1 ? 'player' : 'neutral'),
        isResourcePoint: () => false,
        resourceItemIdAt: () => '',
        invalidReason: () => null,
        isPlacing: () => true,
        baseNeighborIds: () => [1, 2],
    };
}

function makeWorld() {
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const mapLayer = new FakeNode('MapLayer');
    mapLayer.scale.x = 1;
    const world = new ZCGameRenderWorld({ mapLayer } as any);
    const rendered: number[] = [];
    // 只替换「逐格渲染」与「提示气泡」两个出口，其余走真实实现（含 boundary mask 计算）。
    (world as any).hexEntityBySource = new Map([[0, 10], [1, 11], [2, 12]]);
    (world as any).hexViews = new Map([
        [10, { renderSpawnSelection: () => { rendered.push(10); } }],
        [11, { renderSpawnSelection: () => { rendered.push(11); } }],
        [12, { renderSpawnSelection: () => { rendered.push(12); } }],
    ]);
    (world as any).spawnRegionHintOverlay = { render() {}, clear() {} };
    return { world, mapLayer, rendered };
}

test('同一 selection / 版本 / 提示开关 / 缩放：连续帧跳过整盘重算', () => {
    const { world, rendered } = makeWorld();
    const selection = fakeSelection(0);

    world.renderSpawnSelection(selection as any, true);
    assert.deepEqual(rendered, [10, 11, 12], '首帧必须整盘渲染');
    rendered.length = 0;

    world.renderSpawnSelection(selection as any, true);
    world.renderSpawnSelection(selection as any, true);
    assert.deepEqual(rendered, [], '状态没变时不得再逐格渲染');
});

test('版本号 / 提示开关 / 缩放 / selection 实例任一变化都必须重绘', () => {
    const { world, mapLayer, rendered } = makeWorld();
    const selection = fakeSelection(0);
    world.renderSpawnSelection(selection as any, true);
    rendered.length = 0;

    selection.revision = 1;
    world.renderSpawnSelection(selection as any, true);
    assert.deepEqual(rendered, [10, 11, 12], 'revision 变化（落点/确认/AI 确认）必须重绘');

    rendered.length = 0;
    world.renderSpawnSelection(selection as any, false);
    assert.deepEqual(rendered, [10, 11, 12], '提示开关变化必须重绘');

    rendered.length = 0;
    mapLayer.scale.x = 0.8;
    world.renderSpawnSelection(selection as any, false);
    assert.deepEqual(rendered, [10, 11, 12], '地图缩放变化必须重绘');

    rendered.length = 0;
    world.renderSpawnSelection(fakeSelection(1) as any, false);
    assert.deepEqual(rendered, [10, 11, 12], '换一局（新的 selection 实例）必须重绘，不能被上一局的键挡掉');
});
