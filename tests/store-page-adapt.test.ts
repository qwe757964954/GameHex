/**
 * 「商城页屏幕适配」结构守卫（`assets/bundles/main-pages/ui/Store/Store.prefab`）。
 *
 * ## 守什么
 *
 * 商城页挂在 `MainRoot/Content` 下（`MainTabHost.page.setParent(this.content)`），
 * `Content` 自身是四边对齐的全屏容器；构建产物 `settings.screen.designResolution.policy = 4`
 * （FIXED_WIDTH：宽度锁 720、高度随屏幕比例变）⇒ 长屏手机上 `Content` 高会超过 1280。
 *
 * 因此**页面根与背景必须四边对齐**（否则整页按 1280 居中，上下各露一条），
 * **列表区必须上下双对齐**（否则列表可视区恒 738，底部空一截、卡片被 Mask 切在中间），
 * `ScrollView` 拉高后 **`view` 也必须跟着拉高**（`cc.ScrollView` 不会自动改 view 尺寸，
 * 只改 ScrollView 节点等于没改）。
 *
 * ## 不守什么
 *
 * 不校验 `720×1280` 下的绝对几何 —— 那部分在 `tests/store.test.ts` 的 C 段（FGUI 反解像素）。
 * 本文件只钉「这些节点有 Widget、对齐位与 inset 落在什么值上」，
 * 它保证的是：**1280 高时布局与改前逐像素一致，高于 1280 时按差值等比延伸**。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const objects: any[] = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/Store/Store.prefab', 'utf8'),
);
const node = (name: string) => objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === name);
const componentOf = (name: string, type: string) => {
    const target = node(name);
    assert.ok(target, `${name} 节点缺失`);
    return target._components
        .map((ref: any) => objects[ref.__id__])
        .find((item: any) => item.__type__ === type);
};
const widget = (name: string) => {
    const target = componentOf(name, 'cc.Widget');
    assert.ok(target, `${name} 缺少 cc.Widget：页面会退回写死尺寸，长屏上露底`);
    return target;
};

/** cc.Widget.AlignFlags：TOP 1 / MID 2 / BOT 4 / LEFT 8 / CENTER 16 / RIGHT 32。 */
const FLAGS = { TOP: 1, BOT: 4, LEFT: 8, CENTER: 16, RIGHT: 32 };

test('商城页根节点撑满 Content：四边对齐且 inset 全 0', () => {
    const root = widget('Store');
    assert.equal(root._alignFlags, FLAGS.TOP | FLAGS.BOT | FLAGS.LEFT | FLAGS.RIGHT);
    for (const key of ['_top', '_bottom', '_left', '_right']) assert.equal(root[key], 0, key);
    assert.equal(root._alignMode, 2, 'ON_WINDOW_RESIZE：旋转/分辨率变化后要重算');
});

test('背景与木框面板随屏幕高度延伸，顶部锚点与设计稿一致', () => {
    const bg = widget('Bg');
    assert.equal(bg._alignFlags, FLAGS.TOP | FLAGS.BOT | FLAGS.LEFT | FLAGS.RIGHT);
    for (const key of ['_top', '_bottom', '_left', '_right']) assert.equal(bg[key], 0, key);

    // ShopPanel：顶边 384=1280-256（FGUI @(0,384)），底部沿用设计稿的 -30 溢出，1280 下高度仍是 926。
    const panel = widget('ShopPanel');
    assert.equal(panel._alignFlags, FLAGS.TOP | FLAGS.BOT | FLAGS.LEFT | FLAGS.RIGHT);
    assert.equal(panel._top, 384);
    assert.equal(panel._bottom, -30);
    assert.equal(panel._left, 0);
    assert.equal(panel._right, 0);
});

test('立绘（Npc）只做顶部对齐 + 水平居中，不参与纵向拉伸', () => {
    const npc = widget('Npc');
    assert.equal(npc._alignFlags, FLAGS.TOP | FLAGS.CENTER);
    assert.equal(npc._top, 61);
    assert.equal(npc._horizontalCenter, 1);
});

test('列表区上下双对齐：撑到底部导航上方，高屏不再是固定 738', () => {
    const scroll = widget('ScrollView');
    assert.equal(scroll._alignFlags, FLAGS.TOP | FLAGS.BOT | FLAGS.CENTER);
    assert.equal(scroll._top, 385, '顶边 640-255：与资源条/标题条相对位置不变');
    assert.equal(scroll._bottom, 157, '底边避让 152 高的底部导航（MainRoot/BottomNav）');
    assert.equal(scroll._horizontalCenter, 1);

    // cc.ScrollView 不会自动 resize view；view 不跟就是「改了等于没改」。
    const view = widget('view');
    assert.equal(view._alignFlags, FLAGS.TOP | FLAGS.BOT | FLAGS.LEFT | FLAGS.RIGHT);
    for (const key of ['_top', '_bottom', '_left', '_right']) assert.equal(view[key], 0, key);
});

test('资源条（嵌套 prefab 实例）以实例 override 形式挂上顶部对齐', () => {
    const instance = objects.find((item: any) => item.__type__ === 'cc.PrefabInstance'
        && Array.isArray(item.mountedComponents) && item.mountedComponents.length > 0);
    assert.ok(instance, 'ResBar 实例上找不到挂载组件：顶部资源条会随页面居中而下漂');
    const mounted = instance.mountedComponents
        .map((ref: any) => objects[ref.__id__])
        .flatMap((info: any) => info.components.map((ref: any) => objects[ref.__id__]))
        .find((item: any) => item.__type__ === 'cc.Widget');
    assert.ok(mounted, 'ResBar 实例缺少 cc.Widget');
    assert.equal(mounted._alignFlags, FLAGS.TOP | FLAGS.CENTER);
    assert.equal(mounted._top, 78, '顶边 640-562：资源条贴顶，不随屏幕高度漂移');
    assert.equal(mounted._horizontalCenter, -131);
});

test('页面不再有「零 Widget 的顶层子节点」——除嵌套实例外全部登记对齐位', () => {
    const root = node('Store');
    for (const ref of root._children) {
        const child = objects[ref.__id__];
        const isNestedInstance = !child._name && !!child._prefab;
        if (isNestedInstance) continue;
        const hasWidget = child._components
            .map((item: any) => objects[item.__id__])
            .some((item: any) => item.__type__ === 'cc.Widget');
        assert.ok(hasWidget, `${child._name} 没有 cc.Widget：长屏上会脱离屏幕边缘`);
    }
});
