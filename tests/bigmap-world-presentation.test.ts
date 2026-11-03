import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';

test('植物建筑按脚底落格，名条压在建筑下方且可准确点击', () => {
    assert.equal(typeof geometry.bigMapMarkerLayout, 'function');
    const marker = geometry.bigMapMarkerLayout(120, 160);
    // 脚底固定在格中心下方 16px：`iconY - height/2 === -16`。
    assert.equal(marker.iconY - marker.height / 2, -16);
    // 名条（蓝湖「大地图3」）压在建筑**下方**：顶边与建筑底边齐平 ⇒ `badgeY + badgeHeight/2 === -16`。
    assert.equal(marker.badgeY + geometry.BIGMAP_MARKER_BADGE_HEIGHT / 2, -16);
    assert.equal(marker.badgeHeight, geometry.BIGMAP_MARKER_BADGE_HEIGHT);
    assert.equal(marker.badgeWidth, geometry.BIGMAP_MARKER_BADGE_WIDTH);
    const plateCenter = marker.badgeY;
    const layout = geometry.buildBigMapWorldLayout(1, 1);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 0, ...marker }], 0, plateCenter), 0);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 0, ...marker }], 0, plateCenter - 60), -1);
});

test('名条宽度按贴图走：193 宽那张左右各少 4.5px 误点区', () => {
    const marker = geometry.bigMapMarkerLayout(120, 160, 193, 54);
    const layout = geometry.buildBigMapWorldLayout(3, 1);
    const point = layout.points.get(1)!;
    // 202 宽命中框的边缘 101px 处：193 宽时已经出框，202 宽时还在框内。
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 1, ...marker }], point.x + 95, point.y + marker.badgeY!), 1);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 1, ...marker }], point.x + 99, point.y + marker.badgeY!), -1);
});

test('主城头像气泡的完整高度参与点击判定，不沿用矮编号牌的范围', () => {
    const layout = geometry.buildBigMapWorldLayout(1, 1);
    const marker = { hexId: 0, width: 120, height: 160, iconY: 64, badgeY: 210, badgeHeight: 110 };
    assert.equal(geometry.pickBigMapMarker(layout, [marker], 0, 260), 0);
    assert.equal(geometry.pickBigMapMarker(layout, [marker], 0, 266), -1);
});

test('地块按格宽等比铺合（列距 0.75 格宽、行距半格高），邻列共边且点击落在台面内', () => {
    assert.equal(typeof geometry.buildBigMapWorldLayout, 'function');
    const layout = geometry.buildBigMapWorldLayout(3, 3);
    const center = layout.points.get(4)!;
    const right = layout.points.get(5)!;
    // 平顶六边形：相邻列横向错 3/4 格宽、纵向错半格高。
    assert.equal(right.x - center.x, geometry.BIGMAP_TILE_WIDTH * 0.75);
    assert.equal(Math.abs(right.y - center.y), geometry.BIGMAP_TILE_HEIGHT / 2);
    assert.equal(layout.width, 2.5 * geometry.BIGMAP_TILE_WIDTH);
    assert.equal(geometry.pickBigMapHex(layout, 3, 3, center.x + 65, center.y), 4);
});

test('六张沙地纹理由种子稳定选择，覆盖全部变体且不使用随机源', () => {
    assert.equal(typeof geometry.bigMapGroundIndex, 'function');
    const first = Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(20261017, id, 6));
    assert.deepEqual(Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(20261017, id, 6)), first);
    assert.equal(new Set(first).size, 6);
    assert.notDeepEqual(Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(123, id, 6)), first);
    assert.equal(geometry.bigMapGroundIndex(1, 1, 0), -1);
});

test('居中地图每个地块的台面中心都拾取到自身，包含左右边界和单列图', () => {
    assert.equal(typeof geometry.pickBigMapHex, 'function');
    for (const [rows, columns] of [[40, 40], [3, 5], [4, 1], [1, 4]]) {
        const layout = geometry.buildBigMapWorldLayout(rows, columns);
        for (const [id, point] of layout.points) {
            assert.equal(geometry.pickBigMapHex(layout, rows, columns, point.x, point.y), id);
        }
    }
});

test('地图外部与六边形四角留白不误选边缘地块', () => {
    assert.equal(typeof geometry.pickBigMapHex, 'function');
    const layout = geometry.buildBigMapWorldLayout(1, 1);
    // 四角留白按格尺寸取（`|x|/halfW + |y|/halfH > 1` 即落在六边形外）。
    const corner = [geometry.BIGMAP_TILE_WIDTH * 0.4, geometry.BIGMAP_TILE_HEIGHT * 0.72] as const;
    for (const [x, y] of [[1000, 0], [0, -1000], [corner[0], corner[1]], [-corner[0], corner[1]]]) {
        assert.equal(geometry.pickBigMapHex(layout, 1, 1, x, y), -1);
    }
});

test('视口裁剪只返回可见地块，大图不会为远处格子建节点', () => {
    assert.equal(typeof geometry.visibleBigMapHexes, 'function');
    const layout = geometry.buildBigMapWorldLayout(100, 100);
    const visible = geometry.visibleBigMapHexes(layout, 100, 100, { left: -360, right: 360, bottom: -400, top: 400 });
    assert.ok(visible.length > 0 && visible.length < 120);
    for (const id of visible) {
        const point = layout.points.get(id)!;
        assert.ok(Math.abs(point.x) < 360 + geometry.BIGMAP_TILE_WIDTH
            && Math.abs(point.y) < 400 + geometry.BIGMAP_TILE_HEIGHT);
    }
    assert.deepEqual(geometry.visibleBigMapHexes(layout, 100, 100, { left: 100000, right: 100720, bottom: 0, top: 800 }), []);
});

test('点击高于地块的建筑标签时优先选建筑，重叠时选最后绘制的建筑', () => {
    assert.equal(typeof geometry.pickBigMapMarker, 'function');
    const layout = geometry.buildBigMapWorldLayout(3, 3);
    const point = layout.points.get(4)!;
    const x = point.x;
    // 抬到格子之外（> 半格高）才算「点的是建筑不是地块」。
    const y = point.y + geometry.BIGMAP_TILE_HEIGHT * 0.8;
    const iconHeight = geometry.BIGMAP_TILE_HEIGHT * 2;
    assert.notEqual(geometry.pickBigMapHex(layout, 3, 3, x, y), 4);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 4, width: 100, height: iconHeight }], x, y), 4);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 4, width: 100, height: iconHeight }],
        x, y + geometry.BIGMAP_TILE_HEIGHT * 3), -1);
    assert.equal(geometry.pickBigMapMarker(layout, [
        { hexId: 4, width: 100, height: iconHeight }, { hexId: 7, width: 100, height: geometry.BIGMAP_TILE_HEIGHT * 5 },
    ], x, point.y), 7);
});

/**
 * 山猫 2026-11-02：*「按设计稿放大到 235 / 148 / 121」*。
 *
 * 蓝湖「大地图3」原稿实测：城池（马戏团）235×232、基地/据点（树桩）148×160、野怪（骨门）121×129。
 * 这三个数**大于格子**（147×96）是设计意图（城池要盖住上方一格），不是笔误 —— 别按「一格里塞不下」又缩回去。
 */
test('建筑图标宽度按蓝湖「大地图3」原稿：城池 235 / 基地 148 / 野怪 121', () => {
    assert.equal(geometry.BIGMAP_MARKER_CITY_WIDTH, 235);
    assert.equal(geometry.BIGMAP_MARKER_BASE_WIDTH, 148);
    assert.equal(geometry.BIGMAP_MARKER_MONSTER_WIDTH, 121);
    // 图标底部固定（脚底抬 16），所以放大只会**向上长**，名条位置不受影响。
    const tall = geometry.bigMapMarkerLayout(geometry.BIGMAP_MARKER_CITY_WIDTH, 232);
    const small = geometry.bigMapMarkerLayout(120, 160);
    assert.equal(tall.iconY - tall.height / 2, -16);
    assert.equal(small.iconY - small.height / 2, -16);
    assert.equal(tall.badgeY, small.badgeY, '名条位置只吃 FOOT_LIFT 和自身高度，不该随图标变大而移动');
});

/**
 * 2026-11-02 事故：山猫截图「没看到那些边框」—— 名条底板整条消失，只剩文字。
 *
 * 根因是 `render` 里**无条件** `this.badge.spriteFrame = plate;`：`plate` 为 null 时
 * 会把 prefab 里 `Badge` 预置的底图一起清掉（同时 `badgeBackground` 又在 `!plate` 时画到别处），
 * 界面上就是「光秃秃的名字」。⇒ 必须只在有图时才覆盖。
 */
test('名条底板取不到时不许清空预置底图，也不能让手画兜底和贴图同时出现', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldMarker.ts', 'utf8');
    // 旧写法 `enabled = !plate` 会在「没贴图但有预置图」时又画一层手画底板，两层叠在一起。
    assert.ok(!/this\.badgeBackground\.enabled = !plate;/.test(source), '手画兜底不能只看 plate');
    assert.ok(/if \(plate\) \{\s*this\.badge\.spriteFrame = plate;/.test(source), '底板必须条件赋值');
    assert.ok(/this\.badgeBackground\.enabled = !plate && !this\.badge\.spriteFrame;/.test(source),
        '手画兜底要同时看「没贴图」和「没预置图」，否则会和贴图叠在一起');
    assert.ok(/plate\.rect\.width \|\| plate\.originalSize\.width/.test(source),
        'rect 为 0（图集未就绪）时要退回 originalSize，否则名条被设成 0 尺寸');
});

/**
 * 2026-11-02 事故定案：名条底板「看得见但画不出来」，是因为 `Badge` 节点的 **`cc.Sprite._enabled = false`**。
 *
 * 探针打出来的是 `plate=true rect=202x56 active=true frame=true nodeSize=202x56 layer=33554432 enabled=false` ——
 * 除了 `enabled` 全对。而 `BadgeBackground`（手画兜底）又因为「有贴图」被关掉 ⇒ 两个都没画，界面上只剩文字。
 * 这条把「渲染组件必须是启用的」钉在 prefab 里，光看节点 `_active` 是查不出来的。
 */
test('标记模板里名条/图标/小旗的渲染组件必须是启用的（disabled 会静默不画）', () => {
    const prefabPath = 'assets/bundles/bigmap/ui/bigmap/BigMapWorldTemplates.prefab';
    const prefab = JSON.parse(readFileSync(prefabPath, 'utf8')) as Array<Record<string, any>>;
    const nodeNameOf = (component: Record<string, any>) => {
        const node = component.node as { __id__?: number } | undefined;
        return node?.__id__ === undefined ? '?' : (prefab[node.__id__]?._name as string ?? '?');
    };
    const spriteEnabled = new Map<string, boolean>();
    for (const row of prefab) {
        if (row?.__type__ === 'cc.Sprite' && row.node) spriteEnabled.set(nodeNameOf(row), row._enabled);
    }
    for (const name of ['Badge', 'Icon', 'Flag']) {
        assert.equal(spriteEnabled.get(name), true, `${name} 的 cc.Sprite 被禁用了 —— 名条/图标会静默不画`);
    }
});
