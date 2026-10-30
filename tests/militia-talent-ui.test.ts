/**
 * 民兵「天赋」页 UI 的**结构性守卫**（读 prefab JSON，零 `cc`，规则 78）。
 *
 * 覆盖本轮补的三处老端缺口（口径见 `zarts/art/UIProject/trunk/UIProject/assets/民兵/`）：
 *  1. 顶部货币条 `ui/common/ResBar`（老端常驻层 `组件_资源栏` 的 `组件_资源信息` 部分）；
 *  2. 底部菜单层 `MenuBar`（老端 `组件_民兵_菜单层`：底板 + 返回 + 天赋/皮肤两页签）；
 *  3. `MilitiaTalentItem` 的三张图（效果框 `frame_Zhikuang04`、链条 `tf_bar01_bg`/`tf_bar_fg_3gong`）。
 *
 * 为什么钉在这里而不是靠截图：`spriteFrame` 没绑**不报错**、只留白；页签按钮缺图同理
 * （`cocos-mcp-build-prefab` §10.3 的教训）。逐条对磁盘是最便宜的回归。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildResBarSlots } from '../assets/script/app/main/MainResBarTypes';
import { assetPath } from './helpers/asset-paths';

type Obj = Record<string, any>;

const PREFAB = {
    page: assetPath('ui/Role/TabMilitiaTalent.prefab'),
    item: assetPath('ui/Role/MilitiaTalentItem.prefab'),
    resBar: assetPath('ui/common/ResBar.prefab'),
    tabButton: assetPath('ui/common/TabButton.prefab'),
} as const;

/** 美术真源：`.png.meta` 的 uuid（`spriteFrame` 子资源 = `<uuid>@f9941`）。 */
const ART = {
    frameZhikuang04: assetPath('image/common/cu_frame_zhikuang04.png.meta'),
    tfBar01Bg: assetPath('image/militia/ml_tf_bar01_bg.png.meta'),
    tfBarFg3gong: assetPath('image/militia/ml_tf_bar_fg_3gong.png.meta'),
    iconTianFu: assetPath('icons/main/zjm_icon01_TianFu.png.meta'),
    iconTianFu02: assetPath('icons/main/zjm_icon01_TianFu02.png.meta'),
    iconPiFu: assetPath('icons/main/zjm_icon01_PiFu.png.meta'),
    iconPiFu02: assetPath('icons/main/zjm_icon01_PiFu02.png.meta'),
    diban: assetPath('image/common/cu_diban_bg.png.meta'),
    btnFanHui: assetPath('image/common/cu_btn_fan_hui.png.meta'),
} as const;

/** 老端 FGUI 画布 720×1280，组件根锚点 (0.5,0.5) ⇒ 本工程根 lpos(0,0) = 画布中心。 */
const CANVAS_W = 720;
const CANVAS_H = 1280;
const UI_2D = 33554432;

function prefabOf(rel: string): Obj[] {
    return JSON.parse(readFileSync(rel, 'utf8')) as Obj[];
}

/** `.meta` 的 uuid（第一个 `"uuid"` 键）。 */
function metaUuid(rel: string): string {
    const m = readFileSync(rel, 'utf8').match(/"uuid":\s*"([^"]+)"/);
    return m ? m[1] : '';
}

function nodes(L: Obj[]): Obj[] {
    return L.filter((o) => o && o.__type__ === 'cc.Node');
}

/** 按 `_name` 找节点（**只找本文件里的普通节点**，嵌套实例根的名字不落 `_name`）。 */
function byName(L: Obj[], name: string): Obj {
    const hit = nodes(L).find((o) => o._name === name);
    assert.ok(hit, `prefab 里找不到节点 ${name}`);
    return hit;
}

function compOf(L: Obj[], node: Obj, type: string): Obj {
    const hit = (node._components ?? [])
        .map((c: Obj) => L[c.__id__])
        .find((c: Obj) => c && c.__type__ === type);
    assert.ok(hit, `节点 ${node._name} 上没有组件 ${type}`);
    return hit;
}

/** 节点上的 `cc.Sprite` 贴图 uuid（去掉 `@f9941` 子资源后缀）。 */
function spriteUuid(L: Obj[], node: Obj): string {
    const sprite = compOf(L, node, 'cc.Sprite');
    const ref = sprite._spriteFrame;
    return ref ? String(ref.__uuid__ ?? '').replace(/@f9941$/, '') : '';
}

/** 该 prefab 里某源 prefab 的全部实例根节点。 */
function instancesOf(L: Obj[], srcUuid: string): Obj[] {
    return nodes(L).filter((n) => {
        const info = n._prefab ? L[n._prefab.__id__] : null;
        return !!info && info.asset?.__uuid__ === srcUuid;
    });
}

/** 实例根的名字（存在 `cc.PrefabInstance.propertyOverrides` 的 `_name` 覆盖里）。 */
function instanceName(L: Obj[], inst: Obj): string {
    const pi = inst._prefab ? L[inst._prefab.__id__] : null;
    const instObj = pi?.instance ? L[pi.instance.__id__] : null;
    for (const p of instObj?.propertyOverrides ?? []) {
        const ov = L[p.__id__];
        if (ov.propertyPath?.[0] === '_name') return ov.value;
    }
    return inst._name ?? '';
}

/** 实例根上某个组件属性的覆盖值（如 TabButton 的 `offIcon`）。 */
function instanceOverride(L: Obj[], inst: Obj, prop: string): string {
    const pi = inst._prefab ? L[inst._prefab.__id__] : null;
    const instObj = pi?.instance ? L[pi.instance.__id__] : null;
    for (const p of instObj?.propertyOverrides ?? []) {
        const ov = L[p.__id__];
        if (ov.propertyPath?.[0] === prop) return String(ov.value?.__uuid__ ?? '').replace(/@f9941$/, '');
    }
    return '';
}

/** 实例根上的全部属性覆盖对象（`CCPropertyOverrideInfo`）。 */
function instanceOverrides(L: Obj[], inst: Obj): Obj[] {
    const pi = inst._prefab ? L[inst._prefab.__id__] : null;
    const instObj = pi?.instance ? L[pi.instance.__id__] : null;
    return (instObj?.propertyOverrides ?? []).map((p: Obj) => L[p.__id__]);
}

/** 实例的本地坐标（覆盖里读，读不到就是 0）。 */
function instancePos(L: Obj[], inst: Obj): { x: number; y: number } {
    const pi = inst._prefab ? L[inst._prefab.__id__] : null;
    const instObj = pi?.instance ? L[pi.instance.__id__] : null;
    for (const p of instObj?.propertyOverrides ?? []) {
        const ov = L[p.__id__];
        if (ov.propertyPath?.[0] === '_lpos') return { x: ov.value.x, y: ov.value.y };
    }
    return { x: 0, y: 0 };
}

/** 子节点在本文件里的名字 / 实例名列表（顺序 = 渲染顺序）。 */
function childNames(L: Obj[], node: Obj): string[] {
    return (node._children ?? []).map((c: Obj) => {
        const n = L[c.__id__];
        return n._name ?? instanceName(L, n);
    });
}

/** 根 `cc.PrefabInfo.targetOverrides`（跨 prefab 引用的真身，字段本体必然是 null）。 */
function overrides(L: Obj[]): Obj[] {
    const root = L.find((o) => o && o.__type__ === 'cc.Node' && o._parent === null);
    const info = root ? L[root._prefab.__id__] : null;
    return (info?.targetOverrides ?? []).map((r: Obj) => L[r.__id__]);
}

/** 节点 = 中心 + 尺寸 → FGUI 原稿的中心坐标（y 向下）。 */
function toFguiCenter(lpos: Obj, size: Obj): { x: number; y: number } {
    return { x: CANVAS_W / 2 + lpos.x, y: CANVAS_H / 2 - lpos.y };
}

// ============================================================
// 1. 货币条 ResBar
// ============================================================

test('ResBar.prefab：三格几何、layer 与 @property 绑定逐条对上老端 127/273/420', () => {
    const L = prefabOf(PREFAB.resBar);
    const root = L.find((o) => o && o.__type__ === 'cc.Node' && o._parent === null)!;

    // 整条 552×106（老端 `组件_资源栏` 的 `mid` group）
    const rt = compOf(L, root, 'cc.UITransform');
    assert.deepEqual(rt._contentSize, { __type__: 'cc.Size', width: 552, height: 106 });

    // 三格 left = 127 / 273 / 420（相对整条左边 ⇒ 中心 = left + 66）
    const expect = [
        { name: 'Res0', left: 127 },
        { name: 'Res1', left: 273 },
        { name: 'Res2', left: 420 },
    ];
    for (const e of expect) {
        const cell = byName(L, e.name);
        const t = compOf(L, cell, 'cc.UITransform');
        assert.deepEqual(t._contentSize, { __type__: 'cc.Size', width: 132, height: 40 }, `${e.name} 尺寸`);
        assert.equal(t._anchorPoint.x, 0.5);
        assert.equal(t._anchorPoint.y, 0.5);
        // 中心相对整条中心 = left + 66 - 276
        assert.equal(cell._lpos.x, e.left + 66 - 276, `${e.name} 水平位置`);
        assert.equal(cell._lpos.y, 25, `${e.name} 垂直位置`);
        // 每格内部：底图 / 图标 / 数值 / 加号
        assert.deepEqual(childNames(L, cell), ['Bg', 'Icon', 'Value', 'Plus']);
        const icon = byName(L, 'Icon') === undefined ? undefined : undefined;
        const slot = compOf(L, cell, '429383dc/9E+YZ980tIjNI1');
        assert.ok(L[slot.icon.__id__].__type__ === 'cc.Sprite', `${e.name}.icon 必须是 cc.Sprite 组件`);
        assert.ok(L[slot.valueLabel.__id__].__type__ === 'cc.Label', `${e.name}.valueLabel 必须是 cc.Label 组件`);
        assert.equal(L[slot.plus.__id__]._name, 'Plus', `${e.name}.plus 指向 Plus 节点`);
        assert.equal(icon, undefined); // 占位：保持上面的断言分组清晰
    }

    // layer：UI prefab 必须全 UI_2D（铁律 5）
    assert.equal(nodes(L).filter((n) => n._layer !== UI_2D).length, 0);

    // 默认口径：天赋页 `open.json refId=18` 的 resShowType=[10,7] ⇒ coin,gold
    const script = L.find((o) => o && typeof o.__type__ === 'string' && o.resKeys !== undefined)!;
    assert.equal(script.resKeys, 'coin,gold');
    assert.equal(L[script.slot0.__id__].__type__, '429383dc/9E+YZ980tIjNI1');
    assert.equal(L[script.slot1.__id__].__type__, '429383dc/9E+YZ980tIjNI1');
    assert.equal(L[script.slot2.__id__].__type__, '429383dc/9E+YZ980tIjNI1');
});

test('ResBar.prefab：每格底图与加号真的绑了图（zjm_huobi_bg / 公用_按钮_加号）', () => {
    const L = prefabOf(PREFAB.resBar);
    for (const name of ['Res0', 'Res1', 'Res2']) {
        const cell = byName(L, name);
        const kids = (cell._children ?? []).map((c: Obj) => L[c.__id__]);
        const bg = kids.find((k: Obj) => k._name === 'Bg')!;
        const plus = kids.find((k: Obj) => k._name === 'Plus')!;
        assert.notEqual(spriteUuid(L, bg), '', `${name}/Bg 没绑底图`);
        assert.notEqual(spriteUuid(L, plus), '', `${name}/Plus 没绑加号`);
        // Sprite 一律 CUSTOM + 关 trim：否则贴图会改写节点尺寸（技能 §1）
        for (const n of [bg, plus]) {
            const s = compOf(L, n, 'cc.Sprite');
            assert.equal(s._sizeMode, 0, `${name}/${n._name} sizeMode 必须 CUSTOM`);
            assert.equal(s._isTrimmedMode, false, `${name}/${n._name} 必须关 trim`);
        }
    }
});

// ============================================================
// 2. 底部菜单层（老端 组件_民兵_菜单层）
// ============================================================

test('天赋页：MenuBar 四件套的几何反解回 FGUI 原值（底板 / 返回 / 天赋 / 皮肤）', () => {
    const L = prefabOf(PREFAB.page);
    const root = L.find((o) => o && o.__type__ === 'cc.Node' && o._parent === null)!;
    const bar = byName(L, 'MenuBar');

    // 菜单层是**最后**一个子节点 ⇒ 画在最上面（老端它是独立层，压在天赋页之上）
    assert.equal(childNames(L, root)[childNames(L, root).length - 1], 'MenuBar');

    const plate = byName(L, 'Plate') && childNames(L, bar).includes('Plate') ? childOf(L, bar, 'Plate') : null;
    assert.ok(plate, 'MenuBar 下必须有 Plate');
    const plateT = compOf(L, plate, 'cc.UITransform');
    assert.deepEqual(plateT._contentSize, { __type__: 'cc.Size', width: 720, height: 120 });
    // 老端 n35 diban_BG 左上角 (-1,1161) ⇒ 中心 (359,1221)
    assert.deepEqual(toFguiCenter(plate._lpos, plateT._contentSize), { x: 359, y: 1221 });

    const back = childOf(L, bar, 'BtnBack')!;
    const backT = compOf(L, back, 'cc.UITransform');
    assert.deepEqual(backT._contentSize, { __type__: 'cc.Size', width: 138, height: 123 });
    // 老端 按钮_返回 左上角 (-2,1149) ⇒ 中心 (67,1210.5)
    assert.deepEqual(toFguiCenter(back._lpos, backT._contentSize), { x: 67, y: 1210.5 });
    assert.equal(spriteUuid(L, back), metaUuid(ART.btnFanHui), '返回按钮底图 = btn_FanHui');
    assert.ok(compOf(L, back, 'cc.Button'), '返回按钮必须有 cc.Button');

    // 两块页签：老端 按钮_首页_菜单 组件盒 120×111，左上角 (479,1161)/(599,1161)
    // ⇒ 盒中心 x = 539 / 659；本端共用件按底图自身 122×96、底边距盒底 2.6
    const tabUuid = metaUuid(PREFAB.tabButton + '.meta');
    const tabs = instancesOf(L, tabUuid);
    assert.equal(tabs.length, 2, '菜单层必须正好两个页签');
    const byTabName = new Map(tabs.map((t) => [instanceName(L, t), t]));
    const talent = byTabName.get('TabTalent')!;
    const skin = byTabName.get('TabSkin')!;
    assert.ok(talent && skin, '两个页签实例必须叫 TabTalent / TabSkin');

    assert.equal(instancePos(L, talent).x, 539 - 360);
    assert.equal(instancePos(L, skin).x, 659 - 360);
    // 底边（Cocos y = lpos.y - 高/2）→ FGUI y（向下）
    const tabBottomFgui = CANVAS_H / 2 - (instancePos(L, talent).y - 48);
    assert.ok(Math.abs(tabBottomFgui - (1272 - 2.6)) < 0.6, `页签底边应贴盒底（实得 ${tabBottomFgui}）`);
    assert.equal(instancePos(L, talent).y, instancePos(L, skin).y, '两页签等高');

    // 图标：类型 23=天赋 / 24=皮肤（老端 gearIcon 的两态）
    assert.equal(instanceOverride(L, talent, 'offIcon'), metaUuid(ART.iconTianFu));
    assert.equal(instanceOverride(L, talent, 'onIcon'), metaUuid(ART.iconTianFu02));
    assert.equal(instanceOverride(L, skin, 'offIcon'), metaUuid(ART.iconPiFu));
    assert.equal(instanceOverride(L, skin, 'onIcon'), metaUuid(ART.iconPiFu02));

    // 页签内的文字节点要关掉（老端这两个图标自带文字）。
    // ⚠️ 它属于 `TabButton.prefab` 内部 ⇒ **不落盘**成本文件的节点，只能查实例的 propertyOverrides
    //   （`targetInfo.localID` = NameLabel 在 TabButton.prefab 里的 fileId）。
    const tb = prefabOf(PREFAB.tabButton);
    const labelNode = tb.find((o) => o && o.__type__ === 'cc.Node' && o._name === 'NameLabel')!;
    const labelId = tb[labelNode._prefab.__id__].fileId as string;
    for (const t of [talent, skin]) {
        const off = instanceOverrides(L, t).find((o: Obj) => o.propertyPath?.[0] === '_active');
        assert.ok(off, `${instanceName(L, t)} 必须有 _active 覆盖`);
        assert.equal(off.value, false, 'NameLabel 必须隐藏');
        assert.deepEqual(L[off.targetInfo.__id__].localID, [labelId], '_active 覆盖必须作用在 NameLabel 上');
    }
});

test('天赋页：PageClose 已删、MenuBar 接管退出（返回按钮 + 皮肤页签有提示）', () => {
    const L = prefabOf(PREFAB.page);
    const root = L.find((o) => o && o.__type__ === 'cc.Node' && o._parent === null)!;
    assert.ok(!childNames(L, root).includes('PageClose'), '临时右上角关闭必须删掉（规则 113 由菜单层接管）');

    const page = L.find((o) => o && typeof o.__type__ === 'string' && o.backButton !== undefined)!;
    assert.equal(L[page.backButton.__id__]._name, 'BtnBack');
    assert.ok(!('closeButton' in page), 'closeButton 属性必须随 PageClose 一起从脚本里移除');

    // 跨 prefab 引用：字段本体是 null，真身在根 targetOverrides
    const ov = overrides(L);
    for (const prop of ['tabTalent', 'tabSkin']) {
        const hit = ov.filter((o: Obj) => o.propertyPath?.[0] === prop);
        assert.equal(hit.length, 1, `${prop} 必须有且只有一条 targetOverride`);
        assert.equal(L[hit[0].source.__id__], page, `${prop} 的 source 必须是页面脚本`);
    }

    // 红点：两个页签的 TabButton.redDot 都要绑到各自的 RedDot 实例（跨两层嵌套）
    const redDotOv = ov.filter((o: Obj) => o.propertyPath?.[0] === 'redDot');
    assert.equal(redDotOv.length, 2, '两个页签各一条 redDot 覆盖');
    const ids = new Set(redDotOv.map((o: Obj) => L[o.target.__id__].__id__ ?? o.target.__id__));
    assert.equal(ids.size, 2, '两条 redDot 必须指向不同的页签实例');
});

test('天赋页：顶部货币条是 ResBar 实例，位置照抄老端资源栏整条', () => {
    const L = prefabOf(PREFAB.page);
    const resBarUuid = metaUuid(PREFAB.resBar + '.meta');
    const inst = instancesOf(L, resBarUuid);
    assert.equal(inst.length, 1, '天赋页必须挂一份 ResBar');
    assert.equal(instanceName(L, inst[0]), 'ResBar');
    // 与竞技页 HUD 那一份（`ArenaRoot/ResBarLayer/ResBar` 实例）同坐标（整条贴画布左上，left=0）
    assert.deepEqual(instancePos(L, inst[0]), { x: -84, y: 587 });
});

// ============================================================
// 3. 天赋项的三张图（效果框 + 链条底/前景）
// ============================================================

test('天赋项：效果框 frame_Zhikuang04 与链条 tf_bar01_bg / tf_bar_fg_3gong 都真的绑了图', () => {
    const L = prefabOf(PREFAB.item);

    const plate = byName(L, 'Plate');
    assert.equal(spriteUuid(L, plate), metaUuid(ART.frameZhikuang04), 'Plate = frame_Zhikuang04');

    const barBg = byName(L, 'BarBg');
    assert.equal(spriteUuid(L, barBg), metaUuid(ART.tfBar01Bg), 'BarBg = tf_bar01_bg');
    // FGUI `scale="tile"` ⇒ 必须 TILED，否则 38×95 的图会被拉成一整条
    assert.equal(compOf(L, barBg, 'cc.Sprite')._type, 2, 'BarBg 必须 TILED');

    const barFg = byName(L, 'BarFg');
    assert.equal(spriteUuid(L, barFg), metaUuid(ART.tfBarFg3gong), 'BarFg = tf_bar_fg_3gong');

    for (const n of [plate, barBg, barFg]) {
        const s = compOf(L, n, 'cc.Sprite');
        assert.equal(s._sizeMode, 0, `${n._name} sizeMode 必须 CUSTOM`);
        assert.equal(s._isTrimmedMode, false, `${n._name} 必须关 trim`);
    }

    // 链条前景按状态显隐：脚本必须持有它
    const item = L.find((o) => o && typeof o.__type__ === 'string' && o.barForeground !== undefined)!;
    assert.equal(L[item.barForeground.__id__]._name, 'BarFg');
});

test('天赋项：链条前景只在本格解锁后点亮（老端 gearDisplay 状态=1,2）', () => {
    const src = readFileSync('assets/script/app/role/MilitiaTalentItem.ts', 'utf8');
    assert.match(src, /barForeground\.active\s*=\s*cell\.state\s*!==\s*'locked'/,
        'render 里必须无条件按 state 写 barForeground.active（规则 82：比新旧会被默认值短路）');
});

test('天赋页：皮肤页签点击必须给「没移植」提示，不留死按钮', () => {
    const src = readFileSync('assets/script/app/role/MilitiaTalentPage.ts', 'utf8');
    assert.match(src, /tabSkin\.bindSelect\(/, '皮肤页签必须接点击回调');
    assert.match(src, /ROLE_TEXTS\.tabSkinMissing/, '提示文案必须走 RoleTexts 唯一出口');
});

// ── 货币条口径：格数 / 图标 / 加号是静态配置，不许被「没数据」带偏 ──────────

test('buildResBarSlots：格数、图标、加号只由 keys 决定，与 CmdRole 是否在位无关', () => {
    // 民兵天赋 resShowType=[10,7] ⇒ coin,gold 两格；老端货币格**没有**加号（只有体力格有）。
    const slots = buildResBarSlots(['coin', 'gold']);
    assert.equal(slots.length, 2);
    assert.deepEqual(slots.map((s) => s.iconArt), ['图标_幻灵玉', '图标_铜币']);
    assert.deepEqual(slots.map((s) => s.showPlus), [false, false]);
    // 数据没到位时数值是 0，不是空串（留一片空白更难看出是"没数据"还是"渲染坏了"）
    assert.deepEqual(slots.map((s) => s.valueText), ['0', '0']);
    // 体力格仍然带加号
    assert.equal(buildResBarSlots(['end'])[0].showPlus, true);
});

test('ResBar：拿不到 CmdRole 时也必须按 resKeys 摆骨架（不能退回 prefab 的三格全亮 + 加号全在）', () => {
    // 2026-09-29：预览页没登录 ⇒ CmdRole 0 行 ⇒ buildResBarView 返回 null。
    // 原实现此时直接 return、整条不渲染 ⇒ 天赋页顶部凭空多一格带加号的空货币格，
    // 而且一句错都不报（端到端探针才逮到）。
    const src = readFileSync('assets/script/app/common/ResBar.ts', 'utf8');
    assert.match(src, /view\?\.slots\s*\?\?\s*buildResBarSlots\(keys[,)]/,
        '无数据时必须用 buildResBarSlots(keys[, iconOf]) 兜底，而不是整条跳过渲染');
    assert.doesNotMatch(src, /if\s*\(!view\)\s*\{\s*console\.warn[^}]*return;/s,
        '不许回到「无数据就 return」——那样格数/加号会退回 prefab 默认值');
});

test('ResBar：三格以上的槽位必须整格隐藏（resKeys 不足 3 个时）', () => {
    const src = readFileSync('assets/script/app/common/ResBar.ts', 'utf8');
    assert.match(src, /slot\.render\(slots\[i\]\s*\?\?\s*null\)/,
        '多出来的槽位要传 null ⇒ MainResBarSlot.render 会整格隐藏');
});

// ============================================================
// helper
// ============================================================

/** 取子节点（本文件里的普通节点，按 `_name`）。 */
function childOf(L: Obj[], parent: Obj, name: string): Obj | null {
    const hit = (parent._children ?? [])
        .map((c: Obj) => L[c.__id__])
        .find((n: Obj) => n._name === name);
    return hit ?? null;
}

/** 节点名（普通节点读 `_name`，实例根读 override）。 */
function isName(L: Obj[], node: Obj, name: string): boolean {
    return node._name === name || instanceName(L, node) === name;
}
