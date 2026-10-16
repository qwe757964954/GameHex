import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type PrefabObject = Record<string, unknown> & {
    __type__?: string;
    _name?: string;
    _parent?: { __id__: number } | null;
    _children?: Array<{ __id__: number }>;
};

const prefab = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameHUD.prefab', 'utf8')) as PrefabObject[];
const nodeNamed = (name: string, parentName?: string): PrefabObject => {
    const node = prefab.find((item) =>
        item.__type__ === 'cc.Node'
        && item._name === name
        && (parentName === undefined || prefab[item._parent?.__id__ ?? -1]?._name === parentName),
    );
    assert.ok(node, `ZCGameHUD.prefab 缺少 ${name} 节点`);
    return node;
};
const parentOf = (node: PrefabObject): PrefabObject | null => {
    const parentId = node._parent?.__id__;
    return parentId === undefined ? null : prefab[parentId] ?? null;
};

test('对局背景与格子共用 MapScrollView 的可移动 content', () => {
    const background = nodeNamed('Background');
    const content = nodeNamed('content', 'view');
    const view = nodeNamed('view');
    assert.equal(parentOf(content), view);
    assert.equal(parentOf(view)?._name, 'MapScrollView');
    assert.equal(parentOf(background), content);
    assert.equal(content._children?.[0]?.__id__, prefab.indexOf(background), '背景必须排在棋盘图层之前');
});
