/**
 * RolePage 的 prefab 绑定守卫（整页：功能行 + 页签 + 导航 + 装备格 + 立绘 / 气泡 / 面板）。
 *
 * ## 为什么要有这条
 *
 * 2026-11-27 把「运行时 `getChildByName` 现取 + 判空」全部换成 `@property` 绑定，并把职责下沉到
 * 各 item 组件（`RoleBagTabItem` / `RoleNavItem` / `RoleEquipSlot`）。风险随之从代码挪到 prefab：
 *
 *  - **漏绑** ⇒ `onLoad` 里裸写 `this.gemEntry.on(...)` 当场抛；
 *  - **绑错对象** ⇒ 一个错都不报：三个按钮的文案互相串、页签点了不亮、
 *    装备格的 `partId` 全变成 1（六格都去开部位 1）、红点闪在别的格子上；
 *  - **数组顺序错** ⇒ `equipSlots` 下标当部位号用，第 3 格渲染成第 5 件装备。
 *
 * 所以判据必须是「类型 + 完整节点路径 + id 字段」，只断言非 null 抓不到上面任何一条。
 *
 * ## 判据
 *
 * 脚本组件在 prefab 里存的是**压缩 cid**（由 `.ts.meta` 的 uuid 压成）⇒ 用 cid 定位组件；
 * 每个引用解 `{__id__}` 后取宿主节点，再从 `Role` 往上收成路径（`Role/Equip3/com_rd` 这种）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { assetPath } from './helpers/asset-paths';

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    _parent?: { __id__: number } | null;
    node?: { __id__: number } | null;
    [key: string]: unknown;
}

const ROOT = path.resolve(import.meta.dirname, '..');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `.ts.meta` 的 uuid → prefab 里脚本组件的 23 位压缩 cid（编辑器同一套压缩规则）。 */
function compressUuid(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    assert.equal(hex.length, 32, `不是合法 uuid: ${uuid}`);
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const a = parseInt(hex[i], 16);
        const b = parseInt(hex[i + 1], 16);
        const c = parseInt(hex[i + 2], 16);
        out += B64[(a << 2) | (b >> 2)] + B64[((b & 3) << 4) | c];
    }
    return out;
}

function scriptCid(relMeta: string): string {
    return compressUuid(metaUuid(relMeta));
}

function metaUuid(relMeta: string): string {
    return (JSON.parse(readFileSync(path.join(ROOT, relMeta), 'utf8')) as { uuid: string }).uuid;
}

const ROLE_PAGE_CID = scriptCid('assets/script/app/role/RolePage.ts.meta');
const TAB_GROUP_CID = scriptCid('assets/script/app/role/RoleBagTabGroup.ts.meta');
const TAB_ITEM_CID = scriptCid('assets/script/app/role/RoleBagTabItem.ts.meta');
const NAV_ITEM_CID = scriptCid('assets/script/app/role/RoleNavItem.ts.meta');
const EQUIP_SLOT_CID = scriptCid('assets/script/app/role/RoleEquipSlot.ts.meta');
const BAG_PANEL_CID = scriptCid('assets/script/app/role/RoleBagPanel.ts.meta');
const RED_DOT_CID = scriptCid('assets/script/app/common/RedDot.ts.meta');

const objects = JSON.parse(readFileSync(assetPath('ui/Role/Role.prefab'), 'utf8')) as IPrefabObject[];

function refId(value: unknown): number {
    assert.ok(value && typeof value === 'object' && '__id__' in value, '引用必须是 { __id__: N }');
    return (value as { __id__: number }).__id__;
}

/** 引用落到组件时取宿主节点；随后沿 `_parent` 拼到 `Role` 为止。嵌套实例根没有 `_name`（名字由实例提供）。 */
function describeTarget(id: number): { type: string; path: string } {
    const target = objects[id];
    assert.ok(target, `__id__ ${id} 在 prefab 里不存在`);
    const owner = target.__type__ === 'cc.Node' ? target : objects[refId(target.node)];
    assert.ok(owner, `组件 ${String(target.__type__)} 的 node 引用悬空`);
    const names: string[] = [];
    let cursor: IPrefabObject | null = owner;
    while (cursor && cursor.__type__ === 'cc.Node') {
        names.unshift(cursor._name || '<nested>');
        if (cursor._name === 'Role') break;
        cursor = cursor._parent ? objects[refId(cursor._parent)] : null;
    }
    return { type: String(target.__type__), path: names.join('/') };
}

/** 沿父链找最近的嵌套实例根，返回它挂的 prefab uuid（`_name` 为空的那层就是实例根）。 */
function nestedInstanceUuid(id: number): string | null {
    let cursor: IPrefabObject | null = objects[id];
    if (cursor && cursor.__type__ !== 'cc.Node') cursor = objects[refId(cursor.node)];
    while (cursor) {
        if (!cursor._name) {
            const info = cursor._prefab ? objects[refId(cursor._prefab)] : null;
            const asset = info?.asset as { __uuid__?: string } | undefined;
            return asset?.__uuid__ ?? null;
        }
        cursor = cursor._parent ? objects[refId(cursor._parent)] : null;
    }
    return null;
}

function findComponent(cid: string, where: string): IPrefabObject {
    const found = objects.find((object) => object.__type__ === cid);
    assert.ok(found, `${where}：Role.prefab 里找不到 cid ${cid}`);
    return found as IPrefabObject;
}

function assertBound(owner: IPrefabObject, field: string, expectType: string, expectPath: string): void {
    const raw = owner[field];
    assert.ok(raw, `${String(owner.__type__)}.${field} 没绑：prefab 里是 null / 缺失，运行期会当场抛`);
    const got = describeTarget(refId(raw));
    assert.equal(got.type, expectType, `${field} 绑到了 ${got.type}，期望 ${expectType}`);
    assert.equal(got.path, expectPath, `${field} 指向 '${got.path}'，期望 '${expectPath}'`);
}

interface IBinding {
    field: string;
    type: string;
    path: string;
}

test('RolePage 的功能行 / 面板 / 立绘 / 气泡都在 prefab 上绑好（漏绑或绑错都不报错）', () => {
    const page = findComponent(ROLE_PAGE_CID, 'RolePage');
    const bindings: readonly IBinding[] = [
        { field: 'gemEntry', type: 'cc.Node', path: 'Role/BagBtnGem' },
        { field: 'gemEntryTitle', type: 'cc.Label', path: 'Role/BagBtnGem/title' },
        { field: 'composeBtn', type: 'cc.Node', path: 'Role/BagBtnCompose' },
        { field: 'composeTitle', type: 'cc.Label', path: 'Role/BagBtnCompose/title' },
        { field: 'filterBtn', type: 'cc.Node', path: 'Role/BagBtnAll' },
        { field: 'filterTitle', type: 'cc.Label', path: 'Role/BagBtnAll/title' },
        { field: 'composeBtnRedDot', type: RED_DOT_CID, path: 'Role/BagBtnCompose/com_rd' },
        { field: 'forgeBtn', type: 'cc.Node', path: 'Role/ForgeBtn' },
        { field: 'forgeBtnRedDot', type: RED_DOT_CID, path: 'Role/ForgeBtn/com_rd' },
        { field: 'bagPanelComp', type: BAG_PANEL_CID, path: 'Role/BagPanel' },
        { field: 'powerLabel', type: 'cc.Label', path: 'Role/PowerValue' },
        { field: 'heroSkeleton', type: 'sp.Skeleton', path: 'Role/HeroIcon/<nested>/spine' },
        { field: 'qipao', type: 'cc.Node', path: 'Role/Qipao' },
    ];
    for (const binding of bindings) assertBound(page, binding.field, binding.type, binding.path);
});

test('heroSkeleton 绑的是「主角铁拳」实例里的 spine（换美术后别悄悄指到别的骨架）', () => {
    const page = findComponent(ROLE_PAGE_CID, 'RolePage');
    assert.equal(
        nestedInstanceUuid(refId(page.heroSkeleton)),
        metaUuid('assets/resources/skel/主角铁拳/主角铁拳.prefab.meta'),
        'heroSkeleton 所在的嵌套实例不是 主角铁拳',
    );
});

/** 数组字段：逐项断言「id 字段 + 组件类型 + 宿主路径」，顺序错（下标当部位号）也逃不掉。 */
function assertItemArray(
    owner: IPrefabObject,
    ownerLabel: string,
    field: string,
    idKey: string,
    cid: string,
    expected: ReadonlyArray<readonly [number, string]>,
): void {
    const list = owner[field] as Array<{ __id__: number }> | undefined;
    assert.ok(Array.isArray(list), `${ownerLabel}.${field} 必须是数组（prefab 里没绑或绑成了单值）`);
    assert.equal(list.length, expected.length, `${ownerLabel}.${field} 长度 ${list.length}，期望 ${expected.length}`);

    expected.forEach(([id, expectPath], index) => {
        const item = objects[refId(list[index])];
        assert.equal(item.__type__, cid, `${field}[${index}] 不是 ${cid}`);
        assert.equal(Number(item[idKey]), id, `${field}[${index}].${idKey} = ${String(item[idKey])}，期望 ${id}`);
        const got = describeTarget(refId(list[index]));
        assert.equal(got.path, expectPath, `${field}[${index}] 指向 '${got.path}'，期望 '${expectPath}'`);
    });
}

test('背包页签组挂在 Role 根上，三个 RoleBagTabItem 由组持有（page 不再持有页签数组）', () => {
    const group = findComponent(TAB_GROUP_CID, 'RoleBagTabGroup');
    const got = describeTarget(refId(group.node));
    assert.equal(got.path, 'Role', 'RoleBagTabGroup 必须挂在 Role 根节点上');

    const page = findComponent(ROLE_PAGE_CID, 'RolePage');
    assertBound(page, 'tabGroup', TAB_GROUP_CID, 'Role');
    assertItemArray(group, 'RoleBagTabGroup', 'items', 'tabId', TAB_ITEM_CID, [
        [1, 'Role/BagTabGem'],
        [2, 'Role/BagTabEquip'],
        [3, 'Role/BagTabItem'],
    ]);
});

test('navItems：navId 1-7 与七格导航一一对应（改名/换序都不会静默错位）', () => {
    assertItemArray(findComponent(ROLE_PAGE_CID, 'RolePage'), 'RolePage', 'navItems', 'navId', NAV_ITEM_CID, [
        [1, 'Role/NavHero'],
        [2, 'Role/NavMilitia'],
        [3, 'Role/NavGongMing'],
        [4, 'Role/NavGuards'],
        [5, 'Role/NavPreview'],
        [6, 'Role/NavArtifact'],
        [7, 'Role/NavLeaderSkill'],
    ]);
});

test('equipSlots：partId 1-6 与 Equip1-6 顺序一致（下标直接当部位号用）', () => {
    assertItemArray(findComponent(ROLE_PAGE_CID, 'RolePage'), 'RolePage', 'equipSlots', 'partId', EQUIP_SLOT_CID, [
        [1, 'Role/Equip1'],
        [2, 'Role/Equip2'],
        [3, 'Role/Equip3'],
        [4, 'Role/Equip4'],
        [5, 'Role/Equip5'],
        [6, 'Role/Equip6'],
    ]);
});

test('RoleBagTabItem 的 hl / title / com_rd 各自绑在自己那格下（同名 title 极易串门）', () => {
    const group = findComponent(TAB_GROUP_CID, 'RoleBagTabGroup');
    const tabs = group.items as Array<{ __id__: number }>;
    const nodes = ['BagTabGem', 'BagTabEquip', 'BagTabItem'];
    tabs.forEach((entry, index) => {
        const tab = objects[refId(entry)];
        const base = `Role/${nodes[index]}`;
        assertBound(tab, 'hl', 'cc.Node', `${base}/hl`);
        assertBound(tab, 'title', 'cc.Label', `${base}/title`);
        assertBound(tab, 'redDot', RED_DOT_CID, `${base}/com_rd`);
    });
});

test('RoleEquipSlot 的 redDot / goodsButton 绑在本格下（否则红点闪到别格）', () => {
    const page = findComponent(ROLE_PAGE_CID, 'RolePage');
    const slots = page.equipSlots as Array<{ __id__: number }>;
    slots.forEach((entry, index) => {
        const slot = objects[refId(entry)];
        const base = `Role/Equip${index + 1}`;
        assertBound(slot, 'redDot', RED_DOT_CID, `${base}/com_rd`);
        assertBound(slot, 'goodsButton', 'cc.Button', `${base}/com_goods`);
    });
});
