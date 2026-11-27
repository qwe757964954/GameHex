/**
 * 宝石背包「推荐箭头 / 同类属性灰罩」的口径与结构守卫（零 `cc`）。
 *
 * 老端 `TabGem.render` 的两条表现：
 * - `com_rd_up`：`ModelGem.CheckIsBattleWear` 判定的「比当前装备页同部位宝石更好」；
 * - `mask`：当前装备页同部位已有「同属性类型 + 同品质」宝石时，多出来的同类宝石置灰。
 *
 * 纯函数钉口径；prefab 守卫钉 `RoleBagItem` 的 Mask 节点与脚本绑定，
 * 避免节点漏挂时静默不显示（和槽位 Button 漏挂是同一类故障）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assetPath } from './helpers/asset-paths';
import { gemFactsByOrder, gemSameAttrWorn, gemUpMark, type IGemAttrFact } from '../assets/script/app/role/RoleTable';

const attr = (type: number, quality: number, skillId = 0): IGemAttrFact => ({ type, quality, skillId });

test('推荐箭头：数量为 0 / 本页已镶嵌 / 无属性时不推荐', () => {
    const current = attr(1, 4);
    assert.equal(gemUpMark(current, [attr(1, 3)], true, 1), false);
    assert.equal(gemUpMark(current, [attr(1, 3)], false, 0), false);
    assert.equal(gemUpMark(null, [attr(1, 3)], false, 1), false);
});

test('推荐箭头：当前页该部位没有装备，或孔位为空时推荐', () => {
    assert.equal(gemUpMark(attr(1, 4), null, false, 1), true);
    assert.equal(gemUpMark(attr(1, 4), [null, attr(1, 5)], false, 1), true);
});

test('孔位事实按 order 补齐：服务器只发已镶嵌的 4 条时，缺的第 5 孔是 null', () => {
    const facts = gemFactsByOrder([
        { order: 1, fact: attr(1, 4) },
        { order: 2, fact: attr(2, 4) },
        { order: 3, fact: attr(3, 4) },
        { order: 4, fact: null },
        { order: 5, fact: attr(5, 4) },
    ]);
    assert.equal(facts.length, 5);
    assert.equal(facts[3], null);
    assert.equal(gemUpMark(attr(6, 4), facts, false, 1), true, '还有空孔时应推荐');

    const sparse = gemFactsByOrder([{ order: 1, fact: attr(1, 5) }, { order: 2, fact: attr(2, 5) }]);
    assert.deepEqual(sparse.slice(2), [null, null, null], '缺失的 order 3..5 必须补 null');
});

test('推荐箭头：同属性优先比品质；没有同属性时，品质更高也推荐', () => {
    assert.equal(gemUpMark(attr(1, 4), [attr(2, 1), attr(1, 3)], false, 1), true);
    assert.equal(gemUpMark(attr(1, 4), [attr(2, 1), attr(1, 5)], false, 1), false, '同属性不升反降时，不能被其它低品质宝石带亮');
    assert.equal(gemUpMark(attr(1, 4), [attr(2, 1)], false, 1), true, '换属性但品质更高，兜底推荐');
    assert.equal(gemUpMark(attr(1, 4), [attr(2, 5)], false, 1), false, '不同属性且品质不高于当前，不推荐');
});

test('推荐箭头：技能类宝石要求技能组相同，再比品质', () => {
    assert.equal(gemUpMark(attr(1000, 5, 11), [attr(1000, 3, 11)], false, 1), true);
    assert.equal(gemUpMark(attr(1000, 5, 11), [attr(1000, 3, 12)], false, 1), false);
    assert.equal(gemUpMark(attr(1000, 5, 11), [attr(1000, 6, 11)], false, 1), false);
});

test('同类属性灰罩：只认同属性类型 + 同品质；空孔 / 无属性忽略', () => {
    assert.equal(gemSameAttrWorn(attr(1, 4), [attr(2, 4), attr(1, 4)]), true);
    assert.equal(gemSameAttrWorn(attr(1, 4), [attr(1, 5)]), false);
    assert.equal(gemSameAttrWorn(attr(1, 4), [attr(2, 4)]), false);
    assert.equal(gemSameAttrWorn(attr(1, 4), [null, attr(1, 5)]), false);
    assert.equal(gemSameAttrWorn(attr(1, 4), null), false);
    assert.equal(gemSameAttrWorn(null, [attr(1, 4)]), false);
});

type Obj = Record<string, any>;

const PREFAB = assetPath('ui/Role/RoleBagItem.prefab');
const MASK_META = assetPath('image/common/cu_frame_white_zhijiao.png.meta');
const load = (): Obj[] => JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const res = (arr: Obj[], value: any): Obj | null =>
    value && typeof value === 'object' && '__id__' in value ? arr[value.__id__] ?? null : (value ?? null);

function findByName(arr: Obj[], root: Obj, name: string): Obj | null {
    if (root._name === name) return root;
    for (const child of root._children ?? []) {
        const node = res(arr, child);
        const hit = node ? findByName(arr, node, name) : null;
        if (hit) return hit;
    }
    return null;
}

test('★ RoleBagItem 的 Mask 节点挂在 ItemFrame 下、用九宫白框图、黑色 50% 且脚本已绑定', () => {
    const arr = load();
    const root = res(arr, arr[0].data);
    assert.ok(root, 'RoleBagItem.prefab 根节点缺失');

    const itemFrame = findByName(arr, root!, 'ItemFrame');
    const mask = findByName(arr, root!, 'Mask');
    assert.ok(itemFrame, 'ItemFrame 缺失');
    assert.ok(mask, 'Mask 节点缺失 —— 同类属性灰罩会静默不显示');
    assert.equal(arr.indexOf(res(arr, mask!._parent)!), arr.indexOf(itemFrame!), 'Mask 应挂在 ItemFrame 下（覆盖图标、位于徽标下层）');

    const sprite = (mask!._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component?.__type__ === 'cc.Sprite');
    assert.ok(sprite, 'Mask 缺 cc.Sprite');
    assert.equal(sprite!._type, 1, 'Mask 应使用 SLICED(1) 九宫拉伸');
    assert.equal(sprite!._color.r, 0);
    assert.equal(sprite!._color.g, 0);
    assert.equal(sprite!._color.b, 0);
    assert.equal(sprite!._color.a, 128, 'Mask 应为黑色 50%');

    const maskUuid = JSON.parse(readFileSync(MASK_META, 'utf8')).subMetas.f9941.uuid as string;
    assert.equal(sprite!._spriteFrame.__uuid__, maskUuid, 'Mask 应使用 frame_white_zhijiao 的 SpriteFrame');

    const script = (root!._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component && 'mask' in component);
    assert.ok(script, 'RoleBagItem 脚本组件缺 mask 字段');
    assert.equal(script!.mask.__id__, arr.indexOf(mask!), '脚本 mask 未指向 Mask 节点');
});
