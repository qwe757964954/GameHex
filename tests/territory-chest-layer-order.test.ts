/**
 * 开箱表演的**层级口径**（2026-10-29 用户：「打开宝箱的特效应该在宝箱的上层，
 * 奖励资源的 icon 的下层显示，现在被宝箱遮挡了」）。
 *
 * 这三条不是"手感"，是需求本身 —— 而层级只活在 `ui/territory/TerritoryChest.prefab` 的
 * `_children` 数组里（运行时没人 `setSiblingIndex`，见 `TerritoryChestView.constructor`），
 * 所以在 **prefab 数据**上钉，而不是去 grep 源码：
 *
 *  1. `Chest` 必须排在 `Stars` / `Rays` / `Glow` **之前**（箱体在下、箱口特效在上）；
 *  2. `Fountain`（喷出来的奖励图标）必须是 `Stage` 的**最后一个**孩子（压在所有光效之上）；
 *  3. `Beam` / `Rainbow` 反过来必须留在 `Chest` **之后**（即被箱体挡住）——
 *     它们是贯通到屏幕顶的背景光，挪到箱子前面会把 84×67 的箱体糊成一片白。
 *
 * ⚠️ 为什么必须读 prefab 而不是读视图源码：视图只 `requireChild` 取引用，**一句顺序也不写**。
 *   顺序被改时源码一个字都不变、运行时也不报错，只有"光效又被箱子挡住"这一个症状。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface IPrefabRef { __id__: number }
interface IPrefabObject {
    readonly __type__: string;
    readonly _name?: string;
    readonly _children?: IPrefabRef[];
    readonly _components?: IPrefabRef[];
    readonly data?: IPrefabRef;
    readonly [field: string]: unknown;
}

const PREFAB_PATH = 'assets/resources/ui/territory/TerritoryChest.prefab';
const OBJECTS = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as IPrefabObject[];

/** 子节点名（按数组顺序 = 渲染顺序，越靠后越在上）。 */
function childNames(node: IPrefabObject): string[] {
    return (node._children ?? []).map((ref) => String(OBJECTS[ref.__id__]?._name));
}

/** 按名字取节点（找不到直接炸：这个测试的存在前提就是结构契约成立）。 */
function nodeByName(name: string): IPrefabObject {
    const node = OBJECTS.find((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.ok(node, `prefab 里找不到节点 ${name}（结构被改过？）`);
    return node;
}

/** 节点上挂的组件类型名列表。 */
function componentTypes(node: IPrefabObject): string[] {
    return (node._components ?? []).map((ref) => String(OBJECTS[ref.__id__]?.__type__));
}

const ROOT = OBJECTS[OBJECTS[0].data!.__id__];
const STAGE = (ROOT._children ?? [])
    .map((ref) => OBJECTS[ref.__id__])
    .find((node) => node._name === 'Stage');
assert.ok(STAGE, 'prefab 里找不到 Root/Stage');

test('Stage 的渲染顺序：光柱 / 彩虹 → 箱体 → 箱口特效 → 奖励图标', () => {
    // 整条链写成一条断言（而不是只测"相对序"）：多插一层光效、或谁把顺序挪错位，都必须在这里露头。
    assert.deepEqual(childNames(STAGE!), ['Beam', 'Rainbow', 'Chest', 'Stars', 'Rays', 'Glow', 'Fountain']);
});

test('箱口特效在箱体之上（不是"被宝箱遮挡"）', () => {
    const order = childNames(STAGE!);
    const chest = order.indexOf('Chest');
    assert.ok(chest >= 0, 'Stage 下缺 Chest');
    for (const name of ['Stars', 'Rays', 'Glow']) {
        const index = order.indexOf(name);
        assert.ok(index >= 0, `Stage 下缺 ${name}`);
        assert.ok(index > chest,
            `${name} 排在第 ${index} 位、Chest 在第 ${chest} 位 ⇒ ${name} 被箱体挡住了；`
            + '用户口径是「打开宝箱的特效应该在宝箱的上层」');
    }
});

test('奖励图标压在所有光效之上（Stage 最后一个孩子）', () => {
    const order = childNames(STAGE!);
    assert.equal(order[order.length - 1], 'Fountain',
        `Fountain 必须最后一个渲染（当前顺序 ${order.join(' → ')}）；`
        + '光效盖住奖励图标就是本末倒置 —— 玩家最先要读到的是"拿到了什么"');
});

test('光柱 / 彩虹刻意留在箱体之下（背景光，翻过来会把箱体糊白）', () => {
    // 这条是**反向**断言：上面两条要求"特效上移"，很容易顺手把这两层也一起翻上去。
    // 但光柱是从箱口一直铺到屏幕顶的实心填充（箱口那段宽 36px、alpha 到 235），
    // 画在箱子前面就是一条白带横穿箱体 —— 用户看到的是"箱子坏了"，不是"光很亮"。
    const order = childNames(STAGE!);
    const chest = order.indexOf('Chest');
    for (const name of ['Beam', 'Rainbow']) {
        const index = order.indexOf(name);
        assert.ok(index >= 0, `Stage 下缺 ${name}`);
        assert.ok(index < chest,
            `${name} 不该跑到 Chest 前面（当前 ${index} vs ${chest}）：它是背景光，"光从箱子后面射出来"才是对的`);
    }
});

test('Root 顺序：暗角 → 镜头层 → 飞出图标（飞向资源栏的图标不被宝箱 / 光效盖住）', () => {
    assert.deepEqual(childNames(ROOT), ['Backdrop', 'Stage', 'Fly']);
    const order = childNames(ROOT);
    assert.equal(order[order.length - 1], 'Fly', 'Fly 必须最后渲染');
});

test('结构契约：视图 requireChild / requireComponent 要的节点与组件都在', () => {
    // 视图里这些引用全是"找不到就抛出"（`requireChild` / `requireComponent`），
    // 少一个就是启动即崩 —— 在数据侧镜像一遍，让 CI 先炸。
    assert.deepEqual(componentTypes(nodeByName('Backdrop')), ['cc.UITransform', 'cc.Graphics']);
    for (const name of ['Stars', 'Rays', 'Glow']) {
        assert.ok(componentTypes(nodeByName(name)).includes('cc.Graphics'),
            `${name} 上缺 cc.Graphics（视图每帧 clear + 重画）`);
    }
    assert.ok(componentTypes(nodeByName('Beam')).includes('cc.Graphics'), 'Beam 上缺 cc.Graphics');
    assert.ok(componentTypes(nodeByName('Rainbow')).includes('cc.Graphics'), 'Rainbow 上缺 cc.Graphics');

    const chest = nodeByName('Chest');
    assert.ok(componentTypes(chest).includes('cc.UIOpacity'),
        'Chest 上缺 cc.UIOpacity（收尾淡出写在这个节点上）');
    assert.deepEqual(childNames(chest), ['ChestArt']);
    const chestArt = nodeByName('ChestArt');
    assert.ok(componentTypes(chestArt).includes('cc.Sprite'), 'ChestArt 上缺 cc.Sprite（一张图换帧）');
    assert.ok(componentTypes(chestArt).includes('cc.UITransform'), 'ChestArt 上缺 cc.UITransform');
});
