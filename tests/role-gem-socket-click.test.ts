/**
 * 宝石详情槽位「点得动」的结构守卫（纯读 prefab JSON，零 `cc`）。
 *
 * 需求：点已镶嵌的宝石要能卸下。`RoleGemSocketTile` 在 `onLoad` 里对
 * `socketButton.node` 绑 `Button.EventType.CLICK`，而 Cocos 的按钮点击由节点上的
 * `cc.Button` 派发 —— prefab 漏挂 Button 或漏绑 `socketButton` 时不会报错，
 * 只是点了完全没反应（静默失效，单测也全绿）。
 *
 * 这里钉住 5 个 SocketTile 的 Button 形状与绑定：
 * - 过渡 NONE(0) + `target = null`（见 AGENTS「交互节点在 prefab 挂 cc.Button（NONE、target=null）」）；
 * - 初始可交互（空槽由 `RoleGemSocketTile.render` 在运行时置灰）；
 * - 脚本的 `socketButton` 指向的就是本节点上的那颗 Button。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assetPath } from './helpers/asset-paths';

type Obj = Record<string, any>;

const PREFAB = assetPath('ui/Role/RoleGemInfoPopup.prefab');
const SOCKET_TILE_RE = /^SocketTile\d$/;

const load = (): Obj[] => JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];

/** 解 `{__id__: n}` 引用。 */
const res = (arr: Obj[], value: any): Obj | null =>
    value && typeof value === 'object' && '__id__' in value ? arr[value.__id__] ?? null : (value ?? null);

function collectSocketTiles(arr: Obj[], root: Obj, into: Obj[] = []): Obj[] {
    if (SOCKET_TILE_RE.test(root._name ?? '')) into.push(root);
    for (const child of root._children ?? []) {
        const node = res(arr, child);
        if (node) collectSocketTiles(arr, node, into);
    }
    return into;
}

const componentOf = (arr: Obj[], node: Obj, type: string): Obj | null =>
    (node._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component?.__type__ === type) ?? null;

/** 槽位脚本组件：带 `socketButton` 字段的那一颗（类型串是脚本 UUID，不能按类名找）。 */
const tileScriptOf = (arr: Obj[], node: Obj): Obj | null =>
    (node._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component && 'socketButton' in component) ?? null;

const __idOf = (value: any): number => value?.__id__ ?? -1;

test('★ 宝石详情 5 个槽位都挂了可点击的 cc.Button（NONE 过渡 / target=null / 已绑定 socketButton）', () => {
    const arr = load();
    const root = res(arr, arr[0].data);
    assert.ok(root, 'RoleGemInfoPopup.prefab 根节点缺失');

    const tiles = collectSocketTiles(arr, root!);
    assert.equal(tiles.length, 5, `槽位节点数量应为 5，实际 ${tiles.length}`);

    for (const tile of tiles) {
        const tileId = arr.indexOf(tile);
        const button = componentOf(arr, tile, 'cc.Button');
        assert.ok(button, `${tile._name} 缺 cc.Button —— 点击卸下会静默失效`);
        assert.equal(button!._transition, 0, `${tile._name} 的 Button 过渡应为 NONE(0)`);
        assert.equal(button!._target, null, `${tile._name} 的 Button target 应为 null`);
        assert.equal(button!._interactable, true, `${tile._name} 的 Button 初始应可交互`);
        assert.equal(__idOf(button!.node), tileId, `${tile._name} 的 Button 应挂在槽位节点自身`);

        const script = tileScriptOf(arr, tile);
        assert.ok(script, `${tile._name} 缺 RoleGemSocketTile 脚本组件`);
        assert.equal(__idOf(script!.socketButton), arr.indexOf(button!),
            `${tile._name} 的 socketButton 未指向本节点的 Button`);
    }
});
