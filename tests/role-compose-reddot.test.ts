/**
 * 角色页「一键合成」按钮红点的守卫（`Role.prefab` 的 `BagBtnCompose/com_rd`）。
 *
 * 老端 `TabGem` 明确把 `按钮_一键合成.com_rd` 挂到 `RDGemCompose`（服务端 `GEM_COMPOSE`）；
 * 新端此前漏了这颗节点，表现为「有宝石可合成但按钮不亮」且不报错。
 * 这里把「按钮右上角必须有 RedDot 子树，且组件三根引用都指向自己的子节点」钉住。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assetPath } from './helpers/asset-paths';

const PREFAB = assetPath('ui/Role/Role.prefab');
const UI_2D = 33554432;
/** `RedDot.ts` 的压缩 uuid（与 `Role.prefab` 里既有 com_rd 的组件类型一致）。 */
const RED_DOT_SCRIPT = '5fa5aSCCTRI/Y8zkguS79+z';

type Obj = Record<string, any>;

const objects: Obj[] = JSON.parse(readFileSync(PREFAB, 'utf8'));
const res = (value: any): Obj | null =>
    value && typeof value === 'object' && '__id__' in value ? objects[value.__id__] ?? null : null;
const root = res(objects[0].data);
if (!root) throw new Error('Role.prefab 根节点缺失');

function findNode(from: Obj, name: string): Obj | null {
    if (from._name === name) return from;
    for (const ref of from._children ?? []) {
        const child = res(ref);
        const hit = child ? findNode(child, name) : null;
        if (hit) return hit;
    }
    return null;
}

function componentOf(node: Obj, type: string): Obj | null {
    for (const ref of node._components ?? []) {
        const comp = res(ref);
        if (comp?.__type__ === type) return comp;
    }
    return null;
}

const composeBtn = findNode(root, 'BagBtnCompose');
assert.ok(composeBtn, 'Role.prefab 缺少 BagBtnCompose（一键合成按钮）');
const composeButton = composeBtn!;

const redDot = (composeButton._children ?? [])
    .map((ref: any) => res(ref))
    .find((node: Obj | null) => node?._name === 'com_rd') ?? null;

test('一键合成按钮下挂着 com_rd 红点，并且排在最后（渲染在按钮底图之上）', () => {
    assert.ok(redDot, 'BagBtnCompose 缺少 com_rd —— 可合成时按钮不会有红点');
    const names = (composeButton._children ?? []).map((ref: any) => res(ref)?._name);
    assert.equal(names[names.length - 1], 'com_rd', `com_rd 应是最后一个子节点，实际 ${JSON.stringify(names)}`);
    assert.equal(names.filter((name: string) => name === 'com_rd').length, 1, 'com_rd 不应重复挂');
});

test('红点根 30×30、UI_2D，贴在按钮右上角（可轻微外挂，但不落进按钮中部）', () => {
    assert.ok(redDot, 'com_rd 缺失');
    const ui = componentOf(redDot!, 'cc.UITransform');
    assert.ok(ui, 'com_rd 缺 cc.UITransform');
    assert.deepEqual([ui!._contentSize.width, ui!._contentSize.height], [30, 30], '红点根尺寸应为 30×30');
    assert.deepEqual([ui!._anchorPoint.x, ui!._anchorPoint.y], [0, 1], '红点根锚点应为左上 (0,1)');
    assert.equal(redDot!._layer, UI_2D, '红点必须在 UI_2D 层');

    const button = componentOf(composeButton, 'cc.UITransform');
    assert.ok(button, 'BagBtnCompose 缺 cc.UITransform');
    const width = button!._contentSize.width as number;
    const x = redDot!._lpos.x as number;
    const y = redDot!._lpos.y as number;
    assert.ok(x >= width - 30 && x <= width + 12, `红点 x=${x} 不在按钮右上角（按钮宽 ${width}）`);
    assert.ok(y >= 0 && y <= 12, `红点 y=${y} 应贴按钮上沿，不能压到「一键合成」文字`);
});

test('RedDot 脚本的三根引用都指向自己的 icon / title / Spine 子节点', () => {
    assert.ok(redDot, 'com_rd 缺失');
    const script = componentOf(redDot!, RED_DOT_SCRIPT);
    assert.ok(script, `com_rd 缺 RedDot 脚本组件（${RED_DOT_SCRIPT}）`);

    const bindings: Array<[string, string, string]> = [
        ['icon', 'cc.Sprite', 'icon'],
        ['titleLabel', 'cc.Label', 'title'],
        ['spine', 'sp.Skeleton', 'Spine'],
    ];
    for (const [field, type, nodeName] of bindings) {
        const comp = res(script![field]);
        assert.ok(comp, `RedDot.${field} 未绑定`);
        assert.equal(comp!.__type__, type, `RedDot.${field} 应为 ${type}`);
        assert.equal(res(comp!.node)?._name, nodeName, `RedDot.${field} 指错了子节点`);
    }
});

test('红点子树所有节点都有 UITransform 且同层', () => {
    assert.ok(redDot, 'com_rd 缺失');
    const walk = (node: Obj): void => {
        assert.equal(node._layer, UI_2D, `${node._name} 不在 UI_2D 层`);
        assert.ok(componentOf(node, 'cc.UITransform'), `${node._name} 缺 cc.UITransform`);
        for (const ref of node._children ?? []) {
            const child = res(ref);
            if (child) walk(child);
        }
    };
    walk(redDot!);
});

test('prefab 的 PrefabInfo / CompPrefabInfo fileId 不重复（复制子树时最容易撞）', () => {
    const seen = new Map<string, number>();
    objects.forEach((obj, index) => {
        if (obj.__type__ !== 'cc.PrefabInfo' && obj.__type__ !== 'cc.CompPrefabInfo') return;
        const fileId = obj.fileId as string;
        assert.ok(fileId, `id=${index} 的 ${obj.__type__} 缺 fileId`);
        assert.ok(!seen.has(fileId), `fileId ${fileId} 在 id=${seen.get(fileId)} 与 id=${index} 重复`);
        seen.set(fileId, index);
    });
});
