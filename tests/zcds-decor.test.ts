import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    configureZCMap,
    ZC_HEX_CONFIG,
    ZC_MAP_ART,
    ZC_MAP_COLUMNS,
    ZC_MAP_ROWS,
    ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

// 夹具刻意用 `corset`：它是仓库里唯一带装饰的地图（`art.tiles` 里 52 个 `"行,列"` 键，
// 指向 3 张 128×128 的装饰图）。用真实数据验，比手编一份 tiles 更能挡住"格式对、坐标口径错"。
configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/corset.json', 'utf8')) as ZCMapLayout);

const TILE_FRAME = { width: 128, height: 128 };


/** 地图 JSON 里所有装饰键（`"行,列"`），只要按格键、不要分区键。art 名兼容字符串与多格对象。 */
function decorEntries(): Array<[string, string | { art: string }]> {
    const tiles = ZC_MAP_ART.tiles ?? {};
    return Object.entries(tiles).filter(([key]) => /^\d+,\d+$/.test(key)) as Array<[string, string | { art: string }]>;
}

test('装饰只认「行,列」键：分区贴图键不进清单，越界格与没出图的都丢弃', () => {
    const { load } = loadViews();
    const { buildDecorPlacements, decorFitScale, ZC_DECOR_KEY_PATTERN } = load('./ZCGameViewUtil');

    // 分区键是**地块贴图**（另一个用途），装饰绝不能把它们也画一遍。
    assert.equal(ZC_DECOR_KEY_PATTERN.test('1'), false);
    assert.equal(ZC_DECOR_KEY_PATTERN.test('neutral'), false);
    assert.equal(ZC_DECOR_KEY_PATTERN.test('void'), false);
    assert.equal(ZC_DECOR_KEY_PATTERN.test('8,5'), true);

    const real = decorEntries();
    assert.ok(real.length > 0, 'corset.json 里没有装饰键，夹具失效');

    const tiles: Record<string, string> = {
        '1': 'image/tiles/section1',
        neutral: 'image/tiles/neutral',
        void: 'image/tiles/void',
    };
    for (const [key, value] of real) tiles[key] = typeof value === 'string' ? value : value.art;
    // 越界（地图改过尺寸后的残留键）与"图还没加载出来"两种残渣都要被丢掉。
    tiles['99,99'] = 'image/decor/ironforge/frost';
    const [firstKey] = real[0];
    const missingArt = 'image/decor/never/loaded';
    tiles['7,3'] = missingArt;

    // 没出图的（measure 返 null）不进清单 —— 宁可不画，也不拿猜的尺寸贴。
    const measure = (art: string) => (art === missingArt ? null : { width: 128, height: 128 });
    // 显式标注：`load()` 出来的是 any，不标的话下面每个 lambda 参数都会 implicit any。
    const placements: Array<{ id: number; art: string; x: number; y: number; width: number; height: number }> =
        buildDecorPlacements(ZC_HEX_CONFIG, tiles, measure);

    assert.equal(placements.length, real.length, '分区键 / 越界键 / 未出图的都不该进清单');
    assert.ok(placements.every((item) => item.art.startsWith('image/decor/')));
    assert.ok(placements.every((item) => item.art !== 'image/tiles/section1' && item.art !== 'image/tiles/neutral'));

    // 128×128 的方图贴进立体地块的**顶面** 123×90：取较小系数（90/128），
    // 只缩不裁绝不拉伸 —— 与地图编辑器 `preserveAspectRatio="xMidYMid meet"` 同口径。
    assert.equal(decorFitScale(128, 128), 90 / 128);
    assert.equal(decorFitScale(0, 128), 0);
    assert.equal(decorFitScale(128, 0), 0);
    assert.ok(placements.every((item) => Math.abs(item.width - 90) < 1e-9));
    assert.ok(placements.every((item) => Math.abs(item.height - 90) < 1e-9));

    // 位置与地块同一套换算（`mapToViewX/Y`），差 1px 在棋盘上都看得出来。
    const { mapToViewX, mapToViewY } = load('./ZCGameViewUtil');
    for (const [key, art] of real) {
        const [row, column] = key.split(',').map(Number);
        const hex = ZC_HEX_CONFIG.find((item) => item.row === row && item.column === column)!;
        const placement = placements.find((item) => item.id === hex.id && item.art === art)!;
        assert.ok(placement, `${key} 应该有一条装饰`);
        assert.equal(placement.x, mapToViewX(hex.x), `${key} 的 x`);
        assert.equal(placement.y, mapToViewY(hex.y), `${key} 的 y`);
    }

    // 层内顺序 = 屏幕位置从高到低（与地块同一套画家算法），装饰互相压边时"更靠下"的压住上面。
    for (let index = 1; index < placements.length; index += 1) {
        const previous = placements[index - 1];
        const current = placements[index];
        assert.ok(
            previous.y > current.y || (previous.y === current.y && previous.x <= current.x),
            `第 ${index} 条装饰顺序不对：(${previous.y},${previous.x}) 应排在 (${current.y},${current.x}) 之前`,
        );
    }

    // 空输入不炸：没有 art / 没有 tiles 都返回空表。
    // ⚠️ 这里只能比长度，不能用 `deepEqual([])` —— 返回值来自 VM 沙箱，数组原型是**另一个
    // realm** 的，`deepStrictEqual` 会因为原型不同而判不相等（"same structure but are not
    // reference-equal"）。工程里凡是被测函数跑在 `loadViews()` 沙箱里，都别拿字面量容器去比。
    assert.equal(buildDecorPlacements(ZC_HEX_CONFIG, undefined, measure).length, 0);
    assert.equal(buildDecorPlacements(ZC_HEX_CONFIG, {}, measure).length, 0);
});

test('corset 的装饰全部落在虚空格上，且上下镜像两侧成对', () => {
    const entries = decorEntries();
    assert.ok(entries.length > 0, 'corset.json 里没有装饰键，夹具失效');

    const keys = new Set(entries.map(([key]) => key));
    for (const [key] of entries) {
        const [row, column] = key.split(',').map(Number);
        assert.ok(row >= 0 && row < ZC_MAP_ROWS && column >= 0 && column < ZC_MAP_COLUMNS, `${key} 越界`);
        const hex = ZC_HEX_CONFIG[row * ZC_MAP_COLUMNS + column];
        // 装饰的硬约束就是"只能摆在虚空格上"；落盘数据必须自洽，否则客户端会
        // 把礁石画到陆地上（客户端是"照画"的，不做二次校验）。
        assert.equal(hex.playable, false, `${key} 不是虚空格，装饰不该出现在这里`);
        // 装饰跟随上下镜像（与我方分区色同一套口径）：只写存储侧，对侧由镜像生成，
        // 所以成对出现 —— 少一半的话游戏里会变成"只有一侧有装饰"。
        const mirrorKey = `${ZC_MAP_ROWS - 1 - row},${column}`;
        assert.ok(keys.has(mirrorKey), `${key} 缺少镜像伙伴 ${mirrorKey}`);
    }
    assert.equal(entries.length % 2, 0, '装饰总数应该是偶数（成对）');
});

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
    // 尺寸由 UITransform 定死成 fit 后的宽高（不是原图 128）。
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

test('buildDecorPlacements 多格解析：单格对象 = anchor 中心；多格 span = 包围盒；offset 累加到中心；缺 cell 整片丢', () => {
    const { load } = loadViews();
    const { buildDecorPlacements, mapToViewX, mapToViewY } = load('./ZCGameViewUtil');

    // 找一个虚空格当 anchor，验三种格式：(a) 单格对象（带 offset），(b) 多格 span，
    // (c) 缺 cell（span 里有 cell 不在地图里）。anchor 都必须落在虚空上，否则整片丢。
    const entries = decorEntries();
    assert.ok(entries.length > 0, 'corset.json 里没有装饰键，夹具失效');

    // (a) 单格对象 = anchor 中心 + offset（与字符串格式的几何结果应该一致 —— 走的是
    //     `isSingle === true` 分支）。挑一个**右侧**没相邻装饰的 key，否则 (a)/(b) 会落到
    //     同一格上覆盖彼此。
    const singleKey = entries.find(([key]) => {
        const [r, c] = key.split(',').map(Number);
        return !entries.some(([nk]) => nk === `${r},${c + 1}`);
    })![0];
    const [singleRow, singleCol] = singleKey.split(',').map(Number);
    const singleHex = ZC_HEX_CONFIG.find((item) => item.row === singleRow && item.column === singleCol)!;
    const singleExpectedX = mapToViewX(singleHex.x);
    const singleExpectedY = mapToViewY(singleHex.y);

    // (b) 多格装饰：找一个 anchor + 右侧一格都虚空的格对。
    const multi = entries.find(([key]) => {
        const [r, c] = key.split(',').map(Number);
        const neighborKey = `${r},${c + 1}`;
        return key !== singleKey && entries.some(([nk]) => nk === neighborKey);
    });
    assert.ok(multi, 'corset.json 里没有「anchor + 右侧相邻」的两个虚空格对，多格夹具失效');
    const [multiKey] = multi!;
    const [multiRow, multiCol] = multiKey.split(',').map(Number);
    const anchorHex = ZC_HEX_CONFIG.find((item) => item.row === multiRow && item.column === multiCol)!;
    const neighborHex = ZC_HEX_CONFIG.find((item) => item.row === multiRow && item.column === multiCol + 1)!;
    const multiCenterX = (mapToViewX(anchorHex.x) + mapToViewX(neighborHex.x)) / 2;
    const multiCenterY = (mapToViewY(anchorHex.y) + mapToViewY(neighborHex.y)) / 2;
    // 1×2 的盒子宽 = 1 列距 + 顶面宽 = ZC_HEX_COLUMN_SPACING + 顶面宽；高就是顶面高。
    // 这里只断言中心点 + offset 累加，具体尺寸由地图常量决定 —— 留给 decorFitScale 用例盯。

    // (c) 缺 cell：span 里有一个偏移 (-999, 0)，对应格绝对不在地图内。
    const outOfBoundsKey = '99,99';
    assert.equal(
        ZC_HEX_CONFIG.find((item) => item.row === 99 && item.column === 99),
        undefined,
        '99,99 本来就不该在地图里',
    );

    const tiles: Record<string, any> = {
        // (a) 单格对象，带像素偏移 [3, -2]。
        [singleKey]: { art: 'image/decor/sea/reef', offset: [3, -2] },
        // (b) 多格 span = 横向 1×2，带像素偏移 [0, 0]，包围盒中心 = 两个 anchor 的中心。
        [multiKey]: { art: 'image/decor/sea/reef', span: [[0, 0], [0, 1]], offset: [0, 0] },
        // (c) span 里含 (-999, 0) ⇒ 整片跳过。
        [outOfBoundsKey]: { art: 'image/decor/sea/reef', span: [[0, 0], [-999, 0]] },
    };
    const placements = buildDecorPlacements(ZC_HEX_CONFIG, tiles, () => TILE_FRAME);

    // (c) 缺 cell 那条不该进来。
    assert.equal(
        placements.find((p: any) => p.id === undefined && p.art === 'image/decor/sea/reef'),
        undefined,
        '缺 cell 的整片跳过，不该进 placements',
    );

    // (a) 单格对象 = anchor 中心 + offset。
    const singlePlacement = placements.find((p: any) => p.id === singleHex.id);
    assert.ok(singlePlacement, `${singleKey} 应该有一条单格装饰`);
    assert.equal(singlePlacement.x, singleExpectedX + 3, '单格对象中心 = anchor.x + offset.x');
    assert.equal(singlePlacement.y, singleExpectedY - 2, '单格对象中心 = anchor.y + offset.y（注意 y 翻符号）');

    // (b) 多格 span 中心 = 两个 anchor 中心点的平均。
    const multiPlacement = placements.find((p: any) => p.id === anchorHex.id);
    assert.ok(multiPlacement, `${multiKey} 应该有一条多格装饰`);
    assert.ok(
        Math.abs(multiPlacement.x - multiCenterX) < 1e-9,
        `多格中心 x = (${multiCenterX})，实测 ${multiPlacement.x}`,
    );
    assert.ok(
        Math.abs(multiPlacement.y - multiCenterY) < 1e-9,
        `多格中心 y = (${multiCenterY})，实测 ${multiPlacement.y}`,
    );

    // 反向断言：保证单格分支走的是「anchor 中心」（不是包围盒）—— 否则上面的
    // `singleExpectedX` 就不是真值。多格分支也确认不会因为 `span.length === 1` 而短路。
    assert.equal(singlePlacement.x, singleExpectedX + 3);
    assert.notEqual(multiPlacement.x, singlePlacement.x, '多格和单格的 x 中心应当不同（多格是两格平均）');
});
