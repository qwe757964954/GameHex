import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    configureZCMap,
    ZC_MAP_ART,
    ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { assetPath } from './helpers/asset-paths';

configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/corset.json'), 'utf8')) as ZCMapLayout);

const TILE_FRAME = { width: 128, height: 128 };

test('装饰挂到 board 的 DecorLayer：静默跳过没图的那条、重复铺不叠层、清干净后不留装饰节点', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    // 棋盘图层（含层序）声明在 ZCGameBoard.prefab 里，运行时只按名取引用 ——
    // 桩只要能 `getChildByName('DecorLayer')` 取到层即可。
    const board = new FakeNode('ZCGameBoard');
    const layer = new FakeNode('DecorLayer');
    layer.setParent(board);
    // 装饰条目从 prefab 实例化（`sizeMode=CUSTOM` / 不裁边烘在 ZCGameDecor.prefab 里），
    // 桩只要能被 `instantiate` 调到 `make()` —— 夹具的 cc.instantiate 就是 `prefab.make()`。
    const decorPrefab = { make: () => new FakeNode('Decor') };
    const world = new ZCGameRenderWorld({ board, decorPrefab });

    const placements = [
        { id: 105, art: 'image/decor/sea/reef', x: 10, y: 20, width: 90, height: 90 },
        { id: 106, art: 'image/decor/missing/owl', x: 30, y: 40, width: 90, height: 90 },
    ];
    const frames = new Map([['image/decor/sea/reef', { originalSize: TILE_FRAME }]]);

    world.installDecor(placements, frames);
    // `frames` 里查不到的那条静默跳过 —— 不留一格空白 Sprite。
    assert.equal(layer.children.length, 1);
    const decor = layer.children[0];
    assert.equal(decor.name, 'Decor_105');
    assert.equal(decor.position.x, 10);
    assert.equal(decor.position.y, 20);
    // 尺寸 = 原图等比缩放进 90×90 框后的宽高（同编辑器 meet；正方形图+正方形框 ⇒ 90×90）。
    assert.equal(decor.size.width, 90);
    assert.equal(decor.size.height, 90);

    // 幂等：重开局 / 换地图再铺一次，不能叠出两份。
    world.installDecor(placements, frames);
    assert.equal(layer.children.length, 1);

    world.clearDecor();
    assert.equal(layer.children.length, 0, '清干净后装饰层不该留节点');
    // 层本体是 board 的常驻节点，归调用方所有 —— 清装饰不该把它拆掉。
    assert.equal(layer.isValid, true, 'DecorLayer 是 prefab 里的常驻层，不该被 clearDecor 拆掉');
    // 清完再清是空转，不抛。
    world.clearDecor();

    // 全空清单（地图没装饰）不该挂任何装饰。
    world.installDecor([], frames);
    assert.equal(layer.children.length, 0);

    // 销毁渲染世界时装饰要跟着摘掉 —— 装饰不是 ECS 实体，`destroy()` 的实体遍历收不到它们。
    world.installDecor(placements, frames);
    assert.equal(layer.children.length, 1);
    world.destroy();
    assert.equal(layer.children.length, 0, 'destroy() 必须把装饰一起摘掉');

    // 没传装饰 prefab（非对局路径直接构造 world，或 prefab 根本没加载出来）时不挂装饰 ——
    // 与 `wallPrefab` / `cardRevealPrefab` 缺失时「只少一层表现」同口径。
    const bare = new ZCGameRenderWorld({ board, decorPrefab: null });
    bare.installDecor(placements, frames);
    assert.equal(layer.children.length, 0, '缺 decorPrefab 时不该挂装饰');
});

test('自由装饰使用地图坐标和独立尺寸，可覆盖可通行格且保留变换', () => {
    const { load } = loadViews();
    const { buildDecorPlacements } = load('./ZCGameViewUtil');
    const freeDecor = [{
        id: 17,
        art: 'image/decor/rock/large',
        x: 345.5,
        y: -127.25,
        width: 320,
        height: 180,
        rotation: 12,
        flipX: true,
        flipY: false,
    }];
    const placements = buildDecorPlacements(
        freeDecor,
        () => ({ width: 640, height: 320 }),
    );

    assert.equal(placements.length, 1, '合法自由装饰必须进入渲染清单');
    assert.deepEqual(
        { ...placements[0] },
        {
            id: 'free-17', art: 'image/decor/rock/large', x: 345.5, y: -127.25,
            width: 320, height: 180, rotation: 12, flipX: true, flipY: false,
        },
        '坐标/包围尺寸/旋转/翻转均原样传到渲染清单，不按格面缩放',
    );
});

test('运行时摆放清单只接受 freeDecor', () => {
    const { load } = loadViews();
    const { buildDecorPlacements } = load('./ZCGameViewUtil');
    const placements = buildDecorPlacements(
        [{ id: 9, art: 'image/decor/free-rock', x: 25, y: 35, width: 240, height: 120 }],
        () => ({ width: 128, height: 128 }),
    );

    assert.equal(placements.length, 1);
    assert.equal(placements[0].id, 'free-9');
    assert.equal(placements[0].art, 'image/decor/free-rock');
});

test('地图配置边界保留合法 freeDecor 并丢弃编辑器锁定状态', () => {
    const layout = JSON.parse(readFileSync(assetPath('config/maps/corset.json'), 'utf8')) as ZCMapLayout;
    layout.art = {
        ...(layout.art ?? {}),
        freeDecor: [{
            id: 12, art: 'image/decor/rock/large', x: 16, y: -24,
            width: 300, height: 120, rotation: 18, flipX: true, flipY: false, locked: true,
        }],
    };

    configureZCMap(layout);
    assert.equal(ZC_MAP_ART.freeDecor?.length, 1);
    assert.deepEqual({ ...ZC_MAP_ART.freeDecor![0] }, {
        id: 12, art: 'image/decor/rock/large', x: 16, y: -24,
        width: 300, height: 120, rotation: 18, flipX: true, flipY: false,
    });
});

test('地图配置边界拒绝非法 freeDecor 标识和翻转值', () => {
    const source = JSON.parse(readFileSync(assetPath('config/maps/corset.json'), 'utf8')) as ZCMapLayout;
    const decorate = (entry: Record<string, unknown>): ZCMapLayout => ({
        ...source,
        art: { ...(source.art ?? {}), freeDecor: [{
            art: 'image/decor/rock/large', x: 0, y: 0, width: 100, height: 50, ...entry,
        }] as never },
    });

    assert.throws(() => configureZCMap(decorate({ id: Number.NaN })), /id 无效/);
    assert.throws(() => configureZCMap(decorate({ flipX: 'yes' })), /翻转值无效/);
});

test('自由装饰渲染保留旋转和翻转变换', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const board = new FakeNode('ZCGameBoard');
    const layer = new FakeNode('DecorLayer');
    layer.setParent(board);
    const decorPrefab = { make: () => new FakeNode('Decor') };
    const world = new ZCGameRenderWorld({ board, decorPrefab });
    world.installDecor([{
        id: 'free-17', art: 'image/decor/rock/large', x: 8, y: 9, width: 300, height: 120,
        rotation: 32, flipX: true, flipY: false,
    }], new Map([['image/decor/rock/large', { originalSize: { width: 512, height: 256 } }]]));

    const node = layer.children[0];
    assert.equal(node.rotation.z, 32);
    assert.equal(node.scale.x, -1);
    assert.equal(node.scale.y, 1);
    // 512×256 原图等比缩放进 300×120 框（同编辑器 meet）：fit = min(300/512, 120/256) = 0.46875
    // ⇒ 240×120。直接拉伸会让游戏里变形、编辑器预览却正常，所以两侧必须同口径。
    assert.equal(node.size.width, 240);
    assert.equal(node.size.height, 120);
    world.destroy();
});

test('自由装饰忽略非法坐标、尺寸和资源名', () => {
    const { load } = loadViews();
    const { buildDecorPlacements } = load('./ZCGameViewUtil');
    const placements = buildDecorPlacements([
        { id: 1, art: 'image/decor/rock/valid', x: 0, y: 0, width: 120, height: 80 },
        { id: 2, art: 'image/decor/rock/nan', x: Number.NaN, y: 0, width: 120, height: 80 },
        { id: 3, art: 'image/decor/rock/zero', x: 0, y: 0, width: 0, height: 80 },
        { id: 4, art: '', x: 0, y: 0, width: 120, height: 80 },
    ], () => ({ width: 64, height: 64 }));
    assert.equal(placements.length, 1);
    assert.equal(placements[0].id, 'free-1');
});

test('对局只从 freeDecor 预加载装饰资源帧', () => {
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    assert.match(loader, /this\.selectedMap\?\.art\?\.freeDecor/);
    assert.match(loader, /names\.add\(item\.art\.trim\(\)\)/);
});
