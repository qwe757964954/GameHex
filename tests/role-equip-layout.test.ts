/**
 * 角色页「格子里那张图必须落在格子里」的几何守卫（纯读 prefab JSON，零 `cc`，规则 78）。
 *
 * ## 为什么要有这条
 *
 * 2026-09-28 山猫截图「背包排版 放到框中」：`Equip1..6/com_goods` 下后来补的
 * `QualityFrame` / `Icon` / `LevelLabel` 三个节点，是**按「父锚点 = 中心 (0.5,0.5)」的假设**
 * 写的（照抄 `RoleBagItem`，那里的根确实是 anchor(0.5,0.5)），
 * 但 `com_goods` 的实际锚点是 **(0,1)（左上角）** ⇒ 三个节点全部向左上偏出半盒。
 *
 * 这一类故障的特征是**完全静默**：不报错、不 warn、单测一条不红，
 * 只有端到端探针按「世界矩形是否完全包含」量才看得见（当时 6 格 × 3 项 = 18 条 FAIL）。
 *
 * 另一半根因是 `cc.Sprite._sizeMode` 默认 **TRIMMED(1)**：赋值 spriteFrame 时引擎会
 * `setContentSize(帧.原始尺寸)`，把 prefab 里声明的 100×100 改写成贴图的原始尺寸
 * （品质框 `cu_quality_05` 实测 122×125、装备图标 79×80 ~ 94×98 各不相同）
 * ⇒ 框捅出格子、图标大小参差不齐。**必须 `sizeMode = CUSTOM(0)`**。
 *
 * ## 本文件锁什么
 *
 * 1. `Equip1..6/com_goods` 的框/图标锚点口径与父节点一致（父 (0,1) ⇒ 子也 (0,1)）；
 * 2. 渲染盒（按锚点 + lpos + contentSize 算）完全落在 `com_goods` 的盒内；
 * 3. 框 / 图标的 `cc.Sprite.sizeMode === 0`（CUSTOM），否则运行时会被贴图尺寸顶开；
 * 4. 层级序：图标在等级文字之前（文字压在图标上，反了会被盖住）；
 * 5. `RoleBagItem/QualityFrame` 同样不能是 TRIMMED（背包列表共用同一套品质框）；
 * 6. 等级文字贴**右下**：`anchor(1,0)` + `lpos(95,-100)`，对齐老端
 *    `组件_公用_装备.text_level`（盒 `[41,95]×[66,100]` ⇒ **距框右 5 / 贴框底 0**）。
 *    ⚠️ 2026-09-28 山猫：「物品框的文字在右下角」—— 此前一轮曾把 `LevelLabel` 放到**左下**
 *    （`anchor(0,0)` + `lpos(18,-79)`），与老端反了个方向。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');

type Obj = Record<string, any>;

const load = (rel: string): Obj[] => JSON.parse(readFileSync(join(PROJECT, rel), 'utf8')) as Obj[];

/** 解 `{__id__: n}` 引用。 */
const res = (arr: Obj[], v: any): Obj | null =>
    v && typeof v === 'object' && '__id__' in v ? arr[v.__id__] ?? null : (v ?? null);

const compOf = (arr: Obj[], node: Obj, type: string): Obj | null =>
    (node._components ?? []).map((c: any) => res(arr, c)).find((c: Obj | null) => c?.__type__ === type) ?? null;

const ui = (arr: Obj[], node: Obj) => compOf(arr, node, 'cc.UITransform');
const sprite = (arr: Obj[], node: Obj) => compOf(arr, node, 'cc.Sprite');

/** 按名字找节点（在本文件作用域内唯一即可）。 */
function findNode(arr: Obj[], root: Obj, name: string): Obj | null {
    if (root._name === name) return root;
    for (const c of root._children ?? []) {
        const n = res(arr, c);
        if (!n) continue;
        const hit = findNode(arr, n, name);
        if (hit) return hit;
    }
    return null;
}

/**
 * 取「父局部坐标系」下的盒子：父锚点即原点，x 向右、y 向上。
 *
 * ⚠️ `self = true` 时不计 `_lpos`（量的是「这个节点自己的矩形」，用来当容器盒）；
 *    子节点必须计 `_lpos`，因为 `_lpos` 就是它相对父锚点的偏移。
 */
function box(arr: Obj[], node: Obj, self = false): { l: number; r: number; b: number; t: number } {
    const t = ui(arr, node)!;
    const w = t._contentSize.width as number;
    const h = t._contentSize.height as number;
    const ax = t._anchorPoint.x as number;
    const ay = t._anchorPoint.y as number;
    const x = self ? 0 : (node._lpos.x as number);
    const y = self ? 0 : (node._lpos.y as number);
    return { l: x - ax * w, r: x + (1 - ax) * w, b: y - ay * h, t: y + (1 - ay) * h };
}

const inside = (a: { l: number; r: number; b: number; t: number }, b: { l: number; r: number; b: number; t: number }) =>
    a.l >= b.l - 0.01 && a.r <= b.r + 0.01 && a.b >= b.b - 0.01 && a.t <= b.t + 0.01;

const ROLE = 'assets/resources/ui/Role/Role.prefab';
const BAG_ITEM = 'assets/resources/ui/Role/RoleBagItem.prefab';

const SLOTS = [1, 2, 3, 4, 5, 6];

/** 取出第 i 格的 `com_goods` 及其三个子节点。 */
function slotParts(arr: Obj[], root: Obj, i: number) {
    const slot = findNode(arr, root, `Equip${i}`)!;
    const goods = findNode(arr, slot, 'com_goods')!;
    return {
        slot,
        goods,
        frame: findNode(arr, goods, 'QualityFrame')!,
        icon: findNode(arr, goods, 'Icon')!,
        level: findNode(arr, goods, 'LevelLabel')!,
    };
}

test('★ 装备栏 6 格的框/图标/等级文字都在 com_goods 盒内（父锚点是 (0,1)，子节点必须同口径）', () => {
    const arr = load(ROLE);
    const root = res(arr, arr[0].data)!;
    for (const i of SLOTS) {
        const { goods, frame, icon, level } = slotParts(arr, root, i);
        const g = box(arr, goods, true);   // 容器自身的盒：不计 _lpos
        assert.deepEqual(
            [ui(arr, goods)!._anchorPoint.x, ui(arr, goods)!._anchorPoint.y],
            [0, 1],
            `Equip${i}/com_goods 锚点应为 (0,1)`,
        );
        for (const [label, node] of [['品质框', frame], ['图标', icon], ['等级文字', level]] as const) {
            const b = box(arr, node);
            assert.ok(inside(b, g), `Equip${i} ${label} 溢出格子：${JSON.stringify(b)} 不在 ${JSON.stringify(g)} 内`);
        }
    }
});

test('★ 框/图标锚点与父同口径 (0,1) + lpos (0,0)：写成 (0.5,0.5) 会整体偏出半盒', () => {
    const arr = load(ROLE);
    const root = res(arr, arr[0].data)!;
    for (const i of SLOTS) {
        const { frame, icon } = slotParts(arr, root, i);
        for (const [label, node] of [['品质框', frame], ['图标', icon]] as const) {
            const t = ui(arr, node)!;
            assert.deepEqual([t._anchorPoint.x, t._anchorPoint.y], [0, 1], `Equip${i} ${label} 锚点`);
            assert.deepEqual([node._lpos.x, node._lpos.y], [0, 0], `Equip${i} ${label} lpos`);
            assert.deepEqual([t._contentSize.width, t._contentSize.height], [100, 100], `Equip${i} ${label} 尺寸`);
        }
    }
});

test('★ 框/图标的 Sprite.sizeMode 必须是 CUSTOM(0) —— TRIMMED 会被贴图原尺寸顶开格子', () => {
    const arr = load(ROLE);
    const root = res(arr, arr[0].data)!;
    for (const i of SLOTS) {
        const { frame, icon } = slotParts(arr, root, i);
        for (const [label, node] of [['品质框', frame], ['图标', icon]] as const) {
            const sp = sprite(arr, node);
            assert.ok(sp, `Equip${i} ${label} 应有 cc.Sprite`);
            assert.equal(sp!._sizeMode, 0, `Equip${i} ${label} 的 sizeMode 必须为 CUSTOM(0)`);
        }
    }
});

test('★ 等级文字贴右下 —— 对齐老端 组件_公用_装备.text_level（盒 [41,95]×[66,100] ⇒ 距右 5 / 贴底 0）', () => {
    const arr = load(ROLE);
    const root = res(arr, arr[0].data)!;
    for (const i of SLOTS) {
        const { goods, level } = slotParts(arr, root, i);
        const t = ui(arr, level)!;
        // 老端 FGUI（`zarts/.../共用组件/组件/物品框/组件_公用_装备.xml`）：
        //   <text name="text_level" xy="41,66" size="54,34">
        //     <relation target="" sidePair="right-right,bottom-bottom"/>
        // 盒 = [41,95]×[66,100]（100×100 的 com_goods 里）⇒ 右边缘距框右 5、底边贴框底。
        // 2026-09-28 山猫指出「物品框的文字在右下角」，此前一度被放在左下角。
        assert.deepEqual([t._anchorPoint.x, t._anchorPoint.y], [1, 0], `Equip${i} 等级文字锚点应为右下 (1,0)`);
        assert.deepEqual([level._lpos.x, level._lpos.y], [95, -100], `Equip${i} 等级文字 lpos`);

        // 用「渲染盒」再钉一遍 —— anchor 在右下 ⇒ `cc.Label.overflow=NONE` 按文本回写
        // contentSize 时，右/底两条边不受影响（这正是选 (1,0) 而不是 (0.5,0.5) 的原因）。
        const b = box(arr, level);
        const g = box(arr, goods, true);
        assert.ok(Math.abs(b.r - (g.r - 5)) <= 0.01, `Equip${i} 等级文字右边缘应距框右 5，实际 ${(g.r - b.r).toFixed(2)}`);
        assert.ok(Math.abs(b.b - g.b) <= 0.01, `Equip${i} 等级文字底边应贴框底，实际差 ${(b.b - g.b).toFixed(2)}`);
    }
});

test('层级序：图标在等级文字之前（文字压在图标上，反了会被盖住）', () => {
    const arr = load(ROLE);
    const root = res(arr, arr[0].data)!;
    for (const i of SLOTS) {
        const { goods } = slotParts(arr, root, i);
        const names = (goods._children ?? []).map((c: any) => res(arr, c)?._name);
        assert.ok(
            names.indexOf('Icon') < names.indexOf('LevelLabel'),
            `Equip${i} 的 com_goods 子节点顺序应为 …Icon…LevelLabel，实际 ${JSON.stringify(names)}`,
        );
    }
});

test('背包列表项 RoleBagItem/QualityFrame 也必须是 CUSTOM（全项目不得再有 TRIMMED 的框/图标）', () => {
    const arr = load(BAG_ITEM);
    const root = res(arr, arr[0].data)!;
    const frame = findNode(arr, root, 'QualityFrame')!;
    assert.equal(sprite(arr, frame)!._sizeMode, 0);
    const icon = findNode(arr, root, 'Icon')!;
    assert.equal(sprite(arr, icon)!._sizeMode, 0);
});
