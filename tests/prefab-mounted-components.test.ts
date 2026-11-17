/**
 * 固定 prefab / scene 上的必备组件必须由资源预挂载，代码只 `getComponent` 取用。
 *
 * 本次把六处「`getComponent(...) ?? addComponent(...)`」改成直取，其中三处需要把组件
 * 补进资源；资源侧一旦漏挂，运行期就是 `null.opacity` / `null.renderItemFn` 这类
 * 一开页就崩的错误，而只读代码的断言看不出来。这里把「资源真的有」和「代码不再补」
 * 成对钉住，避免后来人只改一半。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';
import { readSource } from './helpers/source-text';

type Obj = Record<string, any>;

function loadObjects(rel: string): Obj[] {
    return JSON.parse(readFileSync(assetPath(rel), 'utf8')) as Obj[];
}

function nodeByName(objects: Obj[], name: string): Obj {
    const hits = objects.filter((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.equal(hits.length, 1, `prefab 里名为 ${name} 的节点应恰好一个，实际 ${hits.length}`);
    return hits[0];
}

function childrenOf(objects: Obj[], node: Obj): Obj[] {
    return ((node._children ?? []) as Array<{ __id__: number }>).map((ref) => objects[ref.__id__]);
}

function componentTypes(objects: Obj[], node: Obj): string[] {
    return ((node._components ?? []) as Array<{ __id__: number }>)
        .map((ref) => objects[ref.__id__]?.__type__ as string)
        .filter(Boolean);
}

function assertComponent(objects: Obj[], node: Obj, type: string, where: string): void {
    assert.ok(componentTypes(objects, node).includes(type), `${where} 缺 ${type}`);
}

test('LineupSlot 根节点预挂 UIOpacity，站台 render 不再补挂', () => {
    const objects = loadObjects('ui/card/LineupSlot.prefab');
    const root = objects[1];
    assert.equal(root?._name, 'LineupSlot', 'prefab 第 1 个对象不是 LineupSlot 根节点');
    assertComponent(objects, root, 'cc.UIOpacity', 'LineupSlot 根节点');

    const source = readSource('assets/script/app/card/CardLineupSlot.ts');
    assert.doesNotMatch(source, /addComponent\(UIOpacity\)/, '站台还在运行时补挂 UIOpacity');
});

test('七日 7 个天数球与 5 个宝箱按钮都预挂 UIOpacity，渲染只取不补', () => {
    const objects = loadObjects('ui/SevenDay/SevenDay.prefab');

    const dayBar = nodeByName(objects, 'DayBar');
    const days = childrenOf(objects, dayBar);
    assert.equal(days.length, 7, `DayBar 下应有 7 天，实际 ${days.length}`);
    for (const day of days) {
        assertComponent(objects, day, 'cc.UIOpacity', `天数球 ${day._name}`);
    }

    const boxBar = nodeByName(objects, 'BoxBar');
    const boxes = childrenOf(objects, boxBar);
    assert.equal(boxes.length, 5, `BoxBar 下应有 5 个宝箱，实际 ${boxes.length}`);
    for (const box of boxes) {
        const button = childrenOf(objects, box).find((child) => child._name === 'BoxBtn');
        assert.ok(button, `${box._name} 下没有 BoxBtn`);
        assertComponent(objects, button, 'cc.UIOpacity', `${box._name}/BoxBtn`);
    }

    for (const file of ['assets/script/app/sevenDay/SevenDayDayTab.ts', 'assets/script/app/sevenDay/SevenDayPointBox.ts']) {
        assert.doesNotMatch(readSource(file), /addComponent\(UIOpacity\)/, `${file} 还在运行时补挂 UIOpacity`);
    }
});

test('HeroFragmentBadge prefab 已带齐根 UITransform/UIOpacity 与图标、两条 Graphics', () => {
    const objects = loadObjects('ui/main/HeroFragmentBadge.prefab');
    const root = objects[1];
    assert.equal(root?._name, 'HeroFragmentBadge', 'prefab 第 1 个对象不是 HeroFragmentBadge 根节点');
    assertComponent(objects, root, 'cc.UITransform', 'HeroFragmentBadge 根节点');
    assertComponent(objects, root, 'cc.UIOpacity', 'HeroFragmentBadge 根节点');
    assertComponent(objects, nodeByName(objects, 'BadgeIcon'), 'cc.Sprite', 'BadgeIcon');
    assertComponent(objects, nodeByName(objects, 'BadgeBarBg'), 'cc.Graphics', 'BadgeBarBg');
    assertComponent(objects, nodeByName(objects, 'BadgeBarFill'), 'cc.Graphics', 'BadgeBarFill');
    assertComponent(objects, nodeByName(objects, 'LiftAnchor'), 'cc.UITransform', 'LiftAnchor');

    assert.doesNotMatch(readSource('assets/script/app/main/HeroFragmentBadge.ts'), /addComponent\(/,
        '徽标还在运行时补挂组件');
});

test('入口列表与引导根不再兜底补挂场景/ prefab 上已有的组件', () => {
    assert.doesNotMatch(readSource('assets/script/app/main/MainEntranceList.ts'), /addComponent\(VirtualScrollView\)/,
        '入口列表还在兜底补挂 VirtualScrollView');
    assert.doesNotMatch(readSource('assets/script/app/bootstrap/ProcedureBootstrap.ts'), /addComponent\(ProcedureManager\)/,
        '组合根还在兜底补挂 ProcedureManager');
});
