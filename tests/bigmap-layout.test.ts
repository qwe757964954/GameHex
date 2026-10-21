/**
 * 大地图**布局层**（`BigMapLayout`）回归测试。
 *
 * 这层存在的意义只有一个：把世界从「种子生成」切成「数据驱动」之后，
 * **种子路径不能被改坏**（49 条老测试护着），**两条路径必须产出同一种世界**。
 *
 * 关注点：
 * 1. 种子世界 → 导出布局 → 重建，逐格 deepEqual（含 1600 格地形）；
 * 2. 导出是幂等的，且手改地形能原样往返；
 * 3. 脏布局（重叠/越界/外键不存在）当场抛，不留给界面；
 * 4. 编辑器逻辑坐标 → 客户端渲染坐标是**非等比**缩放（M2 像素对拍的基准）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BIGMAP_EDITOR_TO_VIEW_SCALE,
    buildBigMapWorldFromLayout,
    exportBigMapLayout,
    isBigMapLayoutCompatible,
    parseBigMapLayout,
    resolveBigMapLayout,
    type IBigMapLayout,
} from '../assets/script/app/bigmap/model/BigMapLayout';
import { bigMapHexDistance, buildBigMapWorld, bigMapOccupantOf } from '../assets/script/app/bigmap/model/BigMapWorld';
import {
    buildHexGridLayout,
    hexGridLogicalPoint,
    hexGridNeighborIds,
} from '../assets/script/core/hex/HexGridLayout';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();

/** 世界 → 可直接断言的可比较形态（Map 不能直接 deepEqual）。 */
function flattenWorld(world: ReturnType<typeof buildBigMapWorld>) {
    return {
        worldId: world.worldId,
        rows: world.rows,
        cols: world.cols,
        seed: world.seed,
        centerHexId: world.centerHexId,
        tiles: world.tiles.map((tile) => [tile.id, tile.row, tile.column, tile.ring, tile.terrain]),
        ringCounts: world.ringCounts,
        cities: [...world.cities.values()].map((site) => [site.cityId, site.anchorHexId, site.hexIds, site.ring]),
        cityByHex: [...world.cityByHex.entries()],
        monsters: world.monsters.map((site) => [site.instanceId, site.monsterId, site.level, site.anchorHexId, site.hexIds]),
        monsterByHex: [...world.monsterByHex.entries()],
        bases: world.bases.map((base) => [base.baseId, base.name, base.isPlayer, base.hexId, base.ring, base.power]),
        playerBase: [world.playerBase.baseId, world.playerBase.hexId, world.playerBase.ring],
        baseByHex: [...world.baseByHex.keys()],
    };
}

test('种子世界 → 导出布局 → 重建：逐格完全一致', () => {
    const original = buildBigMapWorld(config);
    const layout = exportBigMapLayout(original);
    const rebuilt = buildBigMapWorldFromLayout(config, layout);

    assert.deepEqual(flattenWorld(rebuilt), flattenWorld(original));
    // 单独再钉一条：地形是 1600 格逐格比过的，不是只比了首尾。
    assert.equal(rebuilt.tiles.length, config.world.rows * config.world.cols);
    assert.deepEqual(rebuilt.tiles.map((tile) => tile.terrain), original.tiles.map((tile) => tile.terrain));
});

test('导出是幂等的：再导出一次，序列化结果逐字节相同', () => {
    const world = buildBigMapWorld(config);
    const first = exportBigMapLayout(world);
    const second = exportBigMapLayout(buildBigMapWorldFromLayout(config, first));
    assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test('手改地形只影响目标格，且能原样往返', () => {
    const base = buildBigMapWorld(config);
    const layout = exportBigMapLayout(base);
    // 挑一个原本不是水的空格改成水，避免「改了个本来就是水的格」的假绿。
    const pick = base.tiles.find((tile) => tile.terrain !== 'water' && !base.cityByHex.has(tile.id)
        && !base.monsterByHex.has(tile.id) && !base.baseByHex.has(tile.id))!;

    const patched: IBigMapLayout = {
        ...layout,
        terrainOverrides: [{ hexId: pick.id, terrain: 'water' }],
    };
    const world = buildBigMapWorldFromLayout(config, parseBigMapLayout(patched));
    assert.equal(world.tileById.get(pick.id)!.terrain, 'water');

    // 除了目标格，其它格的地形一格都不能变。
    for (const tile of base.tiles) {
        if (tile.id === pick.id) continue;
        assert.equal(world.tileById.get(tile.id)!.terrain, tile.terrain, `格 ${tile.id} 的地形被误改`);
    }

    // 带 override 往返回同一张图（overrides 必须由调用方透传，见 IBigMapExportOptions）。
    const again = exportBigMapLayout(world, { terrainOverrides: patched.terrainOverrides });
    assert.deepEqual(again.terrainOverrides, [{ hexId: pick.id, terrain: 'water' }]);
    assert.deepEqual(flattenWorld(buildBigMapWorldFromLayout(config, again)), flattenWorld(world));
});

test('布局里的占位物仍可被拾取，且三类不互压', () => {
    const world = buildBigMapWorldFromLayout(config, exportBigMapLayout(buildBigMapWorld(config)));
    const seen = new Map<number, string>();
    const claim = (hexId: number, tag: string): void => {
        assert.equal(seen.has(hexId), false, `${tag} 与 ${seen.get(hexId)} 压在同一格 ${hexId}`);
        seen.set(hexId, tag);
    };
    for (const site of world.cities.values()) site.hexIds.forEach((hexId) => claim(hexId, `城池${site.cityId}`));
    for (const site of world.monsters) site.hexIds.forEach((hexId) => claim(hexId, `野怪${site.instanceId}`));
    for (const base of world.bases) claim(base.hexId, `基地${base.baseId}`);

    for (const [hexId, tag] of seen) {
        const occupant = bigMapOccupantOf(world, hexId);
        assert.notEqual(occupant.kind, 'empty', `${tag} 占的格 ${hexId} 拾取为空`);
    }
});

test('重建出来的世界仍满足六边拓扑：相邻格距离恒为 1', () => {
    const world = buildBigMapWorldFromLayout(config, exportBigMapLayout(buildBigMapWorld(config)));
    const { rows, cols } = config.world;
    for (const hexId of [0, 1, 19, 20, 400, 799, 1234, 1599]) {
        assert.equal(bigMapHexDistance(rows, cols, hexId, hexId), 0);
        for (const neighbor of hexGridNeighborIds(hexId, rows, cols)) {
            assert.equal(bigMapHexDistance(rows, cols, hexId, neighbor), 1, `格 ${hexId} → ${neighbor} 距离不为 1`);
        }
    }
    assert.equal(world.tileById.get(world.centerHexId)!.ring, 0);
});

test('尺寸对不上的布局不硬套，走兼容性判断拦下来', () => {
    const layout = exportBigMapLayout(buildBigMapWorld(config));
    assert.equal(isBigMapLayoutCompatible(layout, config), true);

    const bigger = parseBigMapLayout({ ...layout, rows: 50, columns: 50 });
    assert.equal(isBigMapLayoutCompatible(bigger, config), false);
    assert.throws(() => buildBigMapWorldFromLayout(config, bigger), /尺寸不一致/);
});

test('脏布局当场抛：越界 / 重复 / 重叠 / 外键不存在', () => {
    const layout = exportBigMapLayout(buildBigMapWorld(config));
    const total = layout.rows * layout.columns;
    const firstCity = layout.cities[0];

    // 锚点越界
    assert.throws(
        () => parseBigMapLayout({ ...layout, cities: [{ ...firstCity, anchorHexId: total }] }),
        /越界/,
    );
    // 锚点不在自己的 hexIds 里
    assert.throws(
        () => parseBigMapLayout({ ...layout, cities: [{ ...firstCity, hexIds: [0, 1] }] }),
        /锚点/,
    );
    // 两座城压同一格
    assert.throws(
        () => parseBigMapLayout({
            ...layout,
            cities: [firstCity, { ...layout.cities[1], hexIds: [...firstCity.hexIds], anchorHexId: firstCity.anchorHexId }],
        }),
        /重复|同时占用/,
    );
    // kind 不对
    assert.throws(() => parseBigMapLayout({ ...layout, kind: 'territoryChapter' }), /kind 必须是/);
    // rows 不是整数
    assert.throws(() => parseBigMapLayout({ ...layout, rows: 40.5 }), /整数/);
    // 地形取值非法
    assert.throws(
        () => parseBigMapLayout({ ...layout, terrainOverrides: [{ hexId: 0, terrain: 'lava' }] }),
        /不是合法地形/,
    );

    // 外键不存在：绕过 parse 直接塞给 build（模拟配置表删了城但布局没跟上）。
    const orphan: IBigMapLayout = {
        ...parseBigMapLayout(layout),
        cities: [
            ...layout.cities,
            { cityId: 99999, anchorHexId: 0, hexIds: [0], ring: 0, rangeHex: [], adjacentCityIds: [], label: '99999' },
        ],
    };
    assert.throws(() => buildBigMapWorldFromLayout(config, orphan), /不在 bigmapCity 中/);
});

test('底稿透传：势力范围 / 相邻 / 编号 / 障碍 / 出生区块 / 据点不会被一次导出抹掉', () => {
    const world = buildBigMapWorld(config);
    const base = exportBigMapLayout(world);
    // 挑 3 个完全空着的格来放障碍 / 出生区块 / 据点，避免撞上占位互斥。
    const free: number[] = [];
    for (const tile of world.tiles) {
        if (world.cityByHex.has(tile.id) || world.monsterByHex.has(tile.id) || world.baseByHex.has(tile.id)) continue;
        free.push(tile.id);
        if (free.length >= 3) break;
    }

    const annotated = parseBigMapLayout({
        ...base,
        cities: base.cities.map((city, index) => (index === 0
            ? {
                ...city,
                rangeHex: [city.anchorHexId, free[0]],
                adjacentCityIds: [base.cities[1].cityId],
                label: '1-16',
            }
            : city)),
        blocked: [free[0]],
        spawnZones: [{ zoneId: 1, cityId: base.cities[0].cityId, cells: [free[1]], capacity: 10 }],
        points: [{ pointId: 1, pointType: 2, hexIds: [free[2]], openCron: 'TUE,THU 20:00' }],
    });

    // 从标注过的布局建世界 → 再导出（必须把底稿传进来）→ 标注一项都不能少。
    const rebuilt = buildBigMapWorldFromLayout(config, annotated);
    const again = exportBigMapLayout(rebuilt, { base: annotated });
    assert.deepEqual(again.cities[0].rangeHex, annotated.cities[0].rangeHex);
    assert.deepEqual(again.cities[0].adjacentCityIds, annotated.cities[0].adjacentCityIds);
    assert.equal(again.cities[0].label, '1-16');
    assert.deepEqual(again.blocked, annotated.blocked);
    assert.deepEqual(again.spawnZones, annotated.spawnZones);
    assert.deepEqual(again.points, annotated.points);

    // 不传底稿就是「没标注过」—— 这是有意的有损，别指望 world 记得住。
    const bare = exportBigMapLayout(rebuilt);
    assert.deepEqual(bare.cities[0].rangeHex, []);
    assert.deepEqual(bare.blocked, []);
});

test('障碍与城池压同一格必须拒载', () => {
    const layout = exportBigMapLayout(buildBigMapWorld(config));
    assert.throws(
        () => parseBigMapLayout({ ...layout, blocked: [layout.cities[0].anchorHexId] }),
        /同时占用/,
    );
    // 出生区块的 cells 不能为空。
    assert.throws(
        () => parseBigMapLayout({ ...layout, spawnZones: [{ zoneId: 1, cityId: 0, cells: [], capacity: 1 }] }),
        /不能为空/,
    );
});

test('编辑器逻辑坐标 → 客户端渲染坐标是分轴缩放（非等比）', () => {
    const { rows, cols } = config.world;
    const view = buildHexGridLayout(rows, cols).points;

    // 两个轴必须真的不同 —— 若哪天有人「统一」成一个比例，这里立刻红。
    assert.notEqual(BIGMAP_EDITOR_TO_VIEW_SCALE.x, BIGMAP_EDITOR_TO_VIEW_SCALE.y);
    assert.ok(BIGMAP_EDITOR_TO_VIEW_SCALE.x > BIGMAP_EDITOR_TO_VIEW_SCALE.y);

    // 任取两点，位移之比必须逐轴等于缩放常量（center 偏移在差值里消掉）。
    const pairs = [[0, 1], [0, 39], [0, 800], [21, 459], [399, 1200], [7, 1599]];
    for (const [a, b] of pairs) {
        const rowA = Math.floor(a / cols);
        const colA = a % cols;
        const rowB = Math.floor(b / cols);
        const colB = b % cols;
        const logicalA = hexGridLogicalPoint(rowA, colA, rows, cols);
        const logicalB = hexGridLogicalPoint(rowB, colB, rows, cols);
        const viewA = view.get(a)!;
        const viewB = view.get(b)!;

        if (logicalA.x !== logicalB.x) {
            assert.ok(Math.abs((viewA.x - viewB.x) / (logicalA.x - logicalB.x) - BIGMAP_EDITOR_TO_VIEW_SCALE.x) < 1e-9,
                `格 ${a}↔${b} 的 x 缩放不等于 ${BIGMAP_EDITOR_TO_VIEW_SCALE.x}`);
        }
        if (logicalA.y !== logicalB.y) {
            assert.ok(Math.abs((viewA.y - viewB.y) / (logicalA.y - logicalB.y) - BIGMAP_EDITOR_TO_VIEW_SCALE.y) < 1e-9,
                `格 ${a}↔${b} 的 y 缩放不等于 ${BIGMAP_EDITOR_TO_VIEW_SCALE.y}`);
        }
    }
});

test('运行时降级判据：没有布局 / 布局坏了 / 尺寸不符，一律返回 null 而不是抛', () => {
    const layout = exportBigMapLayout(buildBigMapWorld(config));

    // 1) 没有文件
    assert.deepEqual(resolveBigMapLayout(null, config), { layout: null, reason: '没有布局文件' });
    assert.deepEqual(resolveBigMapLayout(undefined, config), { layout: null, reason: '没有布局文件' });

    // 2) 结构非法（kind 错）：parse 会抛，这里必须被吞成 reason
    const broken = resolveBigMapLayout({ ...layout, kind: 'territoryChapter' }, config);
    assert.equal(broken.layout, null);
    assert.match(broken.reason, /不合法/);

    // 3) 尺寸不符（配置表改了但图没跟上）
    const resized = resolveBigMapLayout({ ...layout, rows: 50, columns: 50 }, config);
    assert.equal(resized.layout, null);
    assert.match(resized.reason, /不一致/);

    // 4) 正常布局原样返回，reason 为空
    const ok = resolveBigMapLayout(JSON.parse(JSON.stringify(layout)), config);
    assert.ok(ok.layout);
    assert.equal(ok.reason, '');
});

test('布局优先：世界里的城池坐标真的来自布局，不是种子算出的一套', () => {
    const seeded = buildBigMapWorld(config);
    const layout = exportBigMapLayout(seeded);
    // 把第一座城整体挪到另一个环上（占格块跟着平移，保证仍然连通、不重叠）。
    const target = layout.cities[0];
    const shift = 40; // 一整行
    const moved: IBigMapLayout = {
        ...layout,
        cities: layout.cities.map((city, index) => (index === 0
            ? { ...city, anchorHexId: city.anchorHexId + shift, hexIds: city.hexIds.map((id) => id + shift), ring: city.ring + 1 }
            : city)),
    };
    const fromLayout = buildBigMapWorldFromLayout(config, parseBigMapLayout(moved));
    const site = fromLayout.cities.get(target.cityId)!;
    assert.equal(site.anchorHexId, target.anchorHexId + shift);
    assert.notEqual(site.anchorHexId, seeded.cities.get(target.cityId)!.anchorHexId);

    // 其余城池一动没动 —— 说明是「按布局落位」而不是「重新排了一遍」。
    for (const city of layout.cities.slice(1)) {
        assert.equal(fromLayout.cities.get(city.cityId)!.anchorHexId, city.anchorHexId);
    }
});
