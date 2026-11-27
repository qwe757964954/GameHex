/**
 * 装备背包「推荐箭头」的口径与结构守卫（零 `cc`）。
 *
 * 老端 `TabRoleEquip.render`：
 *   `item.tm("com_rd_up").visible = voEquipItem.GetRatiyRd() == 1`
 *   —— 已穿戴的不显示；同部位穿戴装备的攻击力（`equipLevel.attack + equipRank.attack`）
 *   低于本装备才显示。
 *
 * 纯函数钉判定口径；prefab 守卫钉 `RoleBagItem` 的 UpMark 节点与脚本绑定，
 * 避免节点漏挂 / 贴图换错时静默不显示。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assetPath } from './helpers/asset-paths';
import {
    equipLevelAttackOf,
    equipPartIdOf,
    equipRankAttackOf,
    equipUpMark,
} from '../assets/script/app/role/RoleTable';

const attack = (uniqueId: number, value: number) => ({ uniqueId, attack: value });

test('推荐箭头：空部位推荐；同 id 不推荐；攻击力更高才推荐', () => {
    assert.equal(equipUpMark(attack(100, 50), null), true, '空部位换上一定不亏');
    assert.equal(equipUpMark(attack(100, 1), attack(100, 999)), false, '就是身上这件，绝不推荐');
    assert.equal(equipUpMark(attack(200, 51), attack(100, 50)), true);
    assert.equal(equipUpMark(attack(200, 50), attack(100, 50)), false, '相等不推荐（老端用 <）');
    assert.equal(equipUpMark(attack(200, 10), attack(100, 50)), false);
});

test('部位号：CmdEquipItem.baseId 优先，越界 / 缺失退 equip.equipType，都无效 = 0', () => {
    assert.equal(equipPartIdOf({ baseId: 5 }, 1), 5);
    assert.equal(equipPartIdOf({ baseId: 0 }, 3), 3);
    assert.equal(equipPartIdOf({ baseId: 7 }, 2), 2);
    assert.equal(equipPartIdOf({}, 4), 4);
    assert.equal(equipPartIdOf({ baseId: 9 }, 0), 0);
    assert.equal(equipPartIdOf(null, 9), 0);
});

test('equipRank 攻击：按 [rank, qualityLevel] 取；缺行退 qualityLevel-1；查不到 = 0', () => {
    const rows = [
        { rank: 6, qualityLevel: 4, attack: 100 },
        { rank: 6, qualityLevel: 3, attack: 80 },
        { rank: 1, qualityLevel: 4, attack: 9 },
    ];
    assert.equal(equipRankAttackOf(rows, 6, 4), 100);
    assert.equal(equipRankAttackOf(rows, 6, 3), 80);
    assert.equal(equipRankAttackOf(rows, 6, 2), 0, '降档只退一级：qualityLevel 2 没有行');
    assert.equal(equipRankAttackOf([{ rank: 6, qualityLevel: 3, attack: 80 }], 6, 4), 80,
        '当前档缺失时退 qualityLevel-1');
    assert.equal(equipRankAttackOf(rows, 2, 4), 0, 'rank 不匹配不得串行');
    assert.equal(equipRankAttackOf([null, { rank: 6 }, { rank: 6, qualityLevel: 0, attack: 1 }], 6, 4), 0,
        '脏行跳过，不崩');
});

test('equipLevel 攻击：按强化等级取；缺行 / 0 级 = 0', () => {
    const rows = [
        { equipLevel: 1, attack: 10 },
        { equipLevel: 12, attack: 34 },
    ];
    assert.equal(equipLevelAttackOf(rows, 12), 34);
    assert.equal(equipLevelAttackOf(rows, 2), 0);
    assert.equal(equipLevelAttackOf(rows, 0), 0);
    assert.equal(equipLevelAttackOf([null, { equipLevel: 12 }], 12), 0, '缺 attack 按 0 处理');
});

type Obj = Record<string, any>;

const PREFAB = assetPath('ui/Role/RoleBagItem.prefab');
const ARROW_META = assetPath('image/common/cu_img_jian_tou_02.png.meta');
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

test('★ RoleBagItem 的 UpMark 用绿色推荐箭头、默认隐藏且脚本已绑定', () => {
    const arr = load();
    const root = res(arr, arr[0].data);
    assert.ok(root, 'RoleBagItem.prefab 根节点缺失');

    const upMark = findByName(arr, root!, 'UpMark');
    assert.ok(upMark, 'UpMark 节点缺失 —— 推荐箭头会静默不显示');
    assert.equal(upMark!._active, false, 'UpMark 必须默认隐藏，由 RoleBagItem.render 无条件写');

    const sprite = (upMark!._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component?.__type__ === 'cc.Sprite');
    assert.ok(sprite, 'UpMark 缺 cc.Sprite');
    const arrowUuid = JSON.parse(readFileSync(ARROW_META, 'utf8')).subMetas.f9941.uuid as string;
    assert.equal(sprite!._spriteFrame.__uuid__, arrowUuid, 'UpMark 应使用 cu_img_jian_tou_02 的 SpriteFrame');

    const script = (root!._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component && 'upMark' in component);
    assert.ok(script, 'RoleBagItem 脚本组件缺 upMark 字段');
    assert.equal(script!.upMark.__id__, arr.indexOf(upMark!), '脚本 upMark 未指向 UpMark 节点');
});
