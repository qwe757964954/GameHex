import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import { assetPath } from './helpers/asset-paths';
import { formatBigMapCityOpening } from '../assets/script/app/bigmap/view/BigMapPresentationText';

/**
 * 城池弹窗（蓝湖「城池弹窗3」）判据。
 *
 * 两条契约：
 * 1. **尺寸按设计稿 1:1** —— 面板 692×397、进攻按钮 277×108，节点尺寸一个像素都不许缩；
 * 2. **组件引用必须绑到组件上**（`__id__` 指向 cc.Label / cc.Sprite），绑成节点会让运行时
 *    读写 `this.xxx.string` 直接炸且零报错（见 MEMORY 380）。
 */

interface IPrefabRef { __id__: number }
interface IPrefabObject {
    readonly __type__: string;
    readonly _name: string;
    readonly _layer: number;
    readonly _lpos: { readonly x: number; readonly y: number };
    readonly _children: IPrefabRef[];
    readonly _components: IPrefabRef[];
    readonly _contentSize: { width: number; height: number };
    readonly [field: string]: unknown;
}

const POPUP_PATH = assetPath('ui/bigmap/BigMapCityPopup.prefab');

function loadPrefab(): { rows: IPrefabObject[]; component: Record<string, unknown> } {
    const rows = JSON.parse(readFileSync(POPUP_PATH, 'utf8')) as IPrefabObject[];
    const component = rows.find((row) => 'warScoreFillTransform' in row) as Record<string, unknown>;
    assert.ok(component, '弹窗预制体上必须挂 BigMapCityPopup');
    return { rows, component };
}

test('城池弹窗按设计稿 1:1：面板 692×397、进攻按钮 277×108，所有组件引用绑到组件而非节点', () => {
    const { rows, component } = loadPrefab();
    const byName = new Map<string, IPrefabObject>();
    for (const row of rows) if (row.__type__ === 'cc.Node') byName.set(row._name, row);
    const transformOf = (nodeName: string) => {
        const node = byName.get(nodeName);
        assert.ok(node, `缺少节点 ${nodeName}`);
        const ref = node._components.map((r) => rows[r.__id__])
            .find((c) => c.__type__ === 'cc.UITransform');
        assert.ok(ref, `${nodeName} 缺 UITransform`);
        // `_contentSize` 序列化时带 `__type__: cc.Size`，只比宽高。
        return { width: ref._contentSize.width, height: ref._contentSize.height };
    };
    // 设计稿原尺寸（蓝湖「城池弹窗3」，canvas 720×1610，xhdpi 1:1 逻辑像素）。
    assert.deepEqual(transformOf('Panel'), { width: 692, height: 397 });
    assert.deepEqual(transformOf('BtnFight'), { width: 277, height: 108 });
    assert.deepEqual(transformOf('PanelBg'), { width: 692, height: 397 });
    assert.deepEqual(transformOf('LeftBg'), { width: 389, height: 371 });
    assert.deepEqual(transformOf('LordPerson'), { width: 118, height: 173 });
    assert.deepEqual(transformOf('LordTitle'), { width: 172, height: 50 });
    assert.deepEqual(transformOf('WarTrack'), { width: 250, height: 21 });

    // ⚠️ `rootTransform / panelTransform / dimTransform` 已删 —— 适配改由 prefab 上的 cc.Widget 负责（见下一条用）。
    const single: Record<string, string> = {
        warScoreLabel: 'cc.Label', warScoreFillTransform: 'cc.UITransform', lordNameLabel: 'cc.Label',
        lordScoreLabel: 'cc.Label', lordPerson: 'cc.Sprite', fightButton: 'cc.Button',
        emptyLordLabel: 'cc.Label', lordScoreRoot: 'cc.Node',
        fullRankRoot: 'cc.Node',
        openingLabel: 'cc.Label',
        fightLabel: 'cc.Label', staminaLabel: 'cc.Label', staminaIcon: 'cc.Sprite', playerActionsButton: 'cc.Button',
    };
    for (const [field, type] of Object.entries(single)) {
        const ref = component[field] as IPrefabRef;
        assert.ok(ref && typeof ref.__id__ === 'number', `${field} 未绑定`);
        assert.equal(rows[ref.__id__].__type__, type, `${field} 绑到了错误的类型`);
    }
    const arrays: Record<string, [string, number]> = {
        buffRoots: ['cc.Node', 2], buffTitles: ['cc.Label', 2], buffDescs: ['cc.Label', 2],
        rankRoots: ['cc.Node', 3], rankNumbers: ['cc.Label', 3], rankNames: ['cc.Label', 3],
        rankScoreTags: ['cc.Label', 3], rankScoreValues: ['cc.Label', 3], rankAvatars: ['cc.Sprite', 3],
    };
    for (const [field, [type, count]] of Object.entries(arrays)) {
        const refs = component[field] as IPrefabRef[];
        assert.equal(refs.length, count, `${field} 槽位数不是 ${count}`);
        for (const ref of refs) assert.equal(rows[ref.__id__].__type__, type, `${field} 元素类型错`);
    }
});

/**
 * 2026-11-02 事故守卫：`prefab_lifecycle create` 把场景节点转成预制体时，
 * **位置 / contentSize / Label 样式全被重置**（只有 `_string` 留下），
 * 且所有节点 `_layer` 变成 `DEFAULT(1<<30)` —— UI 相机看不到，实例化后整块不显示。
 * 三条都要钉住，否则「改了代码但界面上什么都没有」又会复现。
 */
test('城池弹窗所有节点都在 UI_2D 层，且面板/按钮/城主区落点与设计稿一致', () => {
    const { rows } = loadPrefab();
    const nodes = rows.filter((row) => row.__type__ === 'cc.Node');
    assert.ok(nodes.length > 40, `节点数异常：${nodes.length}`);
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} 不在 UI_2D 层（UI 相机看不到）`);
    }
    const posOf = (name: string) => {
        const node = nodes.find((row) => row._name === name);
        assert.ok(node, `缺少节点 ${name}`);
        return node._lpos as unknown as { x: number; y: number };
    };
    // 设计稿 1610 高、工程 1280 ⇒ 只重排纵向：面板贴底（按钮底距底 20），横向居中。
    const panel=nodes.find(row=>row._name==='Panel')!;
    const widget=panel._components.map(r=>rows[r.__id__]).find(c=>c.__type__==='cc.Widget')!;
    assert.equal(posOf('Panel').x,0);
    assert.ok(Math.abs(posOf('Panel').y-(-640+Number(widget._bottom)+397/2))<0.001,'面板位置应与 Widget 底边距一致');
    assert.equal(posOf('BtnFight').x,0);
    assert.ok(Math.abs(posOf('BtnFight').y-(posOf('Panel').y-284.5))<0.001,'按钮随面板平移，保持原稿纵向间隔');
    assert.deepEqual({ x: posOf('LeftBg').x, y: posOf('LeftBg').y }, { x: -139.5, y: 0 });
    const rank0 = posOf('Rank0');
    assert.deepEqual({ x: rank0.x, y: rank0.y }, { x: 145, y: 140.5 });
    // 城主区挂 root（不是 Panel），漏算 `+281.5` 会连人带台子甩到画布外。
    const lord = posOf('LordTitle');
    assert.equal(lord.x,218);
    assert.ok(Math.abs(lord.y-(posOf('Panel').y+501.5))<0.001,'城主区与面板保持原稿间隔');
});

test('弹窗文字样式按设计稿写死在预制体里：字号/溢出/对齐/描边不是默认值', () => {
    const { rows, component } = loadPrefab();
    const labelOf = (name: string) => {
        const node = rows.find((row) => row.__type__ === 'cc.Node' && row._name === name) as IPrefabObject;
        assert.ok(node, `缺少节点 ${name}`);
        const ref = node._components.map((r) => rows[r.__id__]).find((c) => c.__type__ === 'cc.Label');
        assert.ok(ref, `${name} 缺 cc.Label`);
        return ref as unknown as Record<string, number | boolean>;
    };
    // 默认 40 号 / NONE 溢出 —— 一旦被重置，文字会糊成一团盖满整块面板。
    for (const name of ['BuffTitle', 'BuffDesc', 'RankNo', 'RankName', 'RankScoreTag', 'RankScoreValue', 'FullRank',
        'WarText', 'WarMin', 'FightLabel', 'StaminaLabel', 'LordName', 'LordScore']) {
        const label = labelOf(name);
        assert.notEqual(label._fontSize, 40, `${name} 字号被重置成默认值`);
        assert.equal(label._overflow, name === 'BuffDesc' ? 1 : 2, `${name} overflow 不对`);
    }
    assert.equal(labelOf('BuffTitle')._horizontalAlign, 0, '增益标题必须左对齐');
    // 增益块底是**米色**，标题/描述必须用深色字（白字在米底上等于看不见），且不描黑边。
    const titleColor = labelOf('BuffTitle')._color as unknown as { r: number; g: number; b: number };
    assert.ok(titleColor.r < 120 && titleColor.g < 120, `增益标题颜色过亮：${JSON.stringify(titleColor)}`);
    assert.equal(labelOf('BuffTitle')._enableOutline, false);
    const descColor = labelOf('BuffDesc')._color as unknown as { r: number; g: number; b: number };
    assert.ok(descColor.r < 140, `增益描述颜色过亮：${JSON.stringify(descColor)}`);
    // 深色底上的名字/按钮才用白字＋黑描边。
    assert.equal(labelOf('RankName')._enableOutline, true);
    assert.equal(labelOf('FightLabel')._fontSize, 36);
});

/**
 * 山猫 2026-11-02 口径：*「这个用 widget 做适配，用 PopupBase 做弹窗基类」*。
 *
 * 三条一起钉住，任意一条红了都说明这次改造被改回去了：
 * ① prefab 里每个要贴底/撑满的节点都挂 `cc.Widget`，且 inset 与设计稿落点自洽；
 * ② prefab 里**不能有 `Dim` 节点** —— 点空白关闭由 `PopupBase` 的 `__BlankClose` 层负责；
 * ③ 代码里**不许再出现 `setScale`** —— 适配是 prefab 的事，手写缩放会和 Widget 打架。
 */
test('适配全部走 prefab 的 cc.Widget，代码不再手写缩放，且 Dim 已由 PopupBase 接管', () => {
    const { rows } = loadPrefab();
    const nodes = rows.filter((row) => row.__type__ === 'cc.Node');
    assert.ok(!nodes.some((node) => node._name === 'Dim'),
        'Dim 已删：点空白关闭由 PopupBase 的 __BlankClose 层实现，别再加回来');
    const widgetOf = (name: string) => {
        const node = nodes.find((row) => row._name === name);
        assert.ok(node, `缺少节点 ${name}`);
        const ref = node._components.map((r) => rows[r.__id__]).find((c) => c.__type__ === 'cc.Widget');
        assert.ok(ref, `${name} 没有 cc.Widget —— 适配必须由 Widget 承担`);
        return ref as unknown as Record<string, number>;
    };
    // 根节点四边对齐（TOP1|MID2|BOT4|LEFT8|CENTER16|RIGHT32 → 45 = 四边）
    assert.equal(widgetOf('BigMapCityPopup')._alignFlags, 45, '根节点必须四边对齐，才能跟弹窗层同尺寸');
    assert.equal(widgetOf('BigMapCityPopup')._alignMode, 2, '根节点在窗口尺寸变化时适配');
    // 面板 / 按钮 / 城主区：贴底 + 水平居中（BOT4 + CENTER16 = 20）
    assert.ok(widgetOf('Panel')._bottom>=160 && widgetOf('Panel')._bottom+397<=1280,'面板保持在视口内并为底部按钮留位');
    const bottoms: Record<string, number> = {
        Panel: Number(widgetOf('Panel')._bottom), BtnFight: Number(widgetOf('Panel')._bottom)-140, LordTitle: 835, LordPerson: 651, LordBase: 591, LordName: 622, LordScoreBg: 585,
    };
    for (const [name, bottom] of Object.entries(bottoms)) {
        const widget = widgetOf(name);
        assert.equal(widget._alignFlags, 20, `${name} 应为「贴底 + 水平居中」`);
        const expected=name==='Panel'||name==='BtnFight'?bottom:bottom+Number(widgetOf('Panel')._bottom)-160;
        assert.ok(Math.abs(widget._bottom-expected)<0.001, `${name} 的贴底间距应随面板整体平移`);
        assert.equal(widget._alignMode, 1, `${name} 的 alignMode 必须是 ALWAYS(1)`);
    }
    // 代码侧：不许再手写缩放（那是改之前 layout() 干的事）
    const source = readFileSync('assets/script/app/bigmap/view/BigMapCityPopup.ts', 'utf8');
    assert.ok(!/\.setScale\s*\(/.test(source), 'BigMapCityPopup 里不该再出现 setScale —— 适配归 Widget');
    assert.ok(!/private layout\s*\(/.test(source), 'layout() 已删，尺寸适配不该回到代码里');
    assert.ok(/extends PopupBase/.test(source), '必须继承 PopupBase（栈式弹窗基类）');
    assert.ok(/static prefabPath = 'ui\/bigmap\/BigMapCityPopup'/.test(source), 'PopupBase 需要 prefabPath 才能 open');
    // 山猫 2026-11-02：战功条的 UITransform 走**拖拽**，不许 `getComponent` + 空判兜底
    // （拖错在编辑器里一眼能看见，代码里判空只会把它变成静默不动的进度条）。
    assert.ok(!/getComponent\(\s*UITransform\s*\)/.test(source), '战功条必须用拖拽的 UITransform，不要 getComponent');
    assert.ok(/warScoreFillTransform/.test(source), '字段应改名为 warScoreFillTransform（拖 UITransform）');
    // 山猫 2026-11-02：排行榜/增益的 Label 全部走拖拽绑定，不许再按节点名兜底 getComponent
    assert.ok(!/pickRankLabel/.test(source), '数组槽位已绑死，不要再写按名字兜底的兜底函数');
    assert.ok(!/getChildByName\(\s*'Rank/.test(source), '不许按节点名找 RankScoreTag / RankScoreValue');
});

/**
 * 山猫 2026-11-02 口径：*「字颜色 描边 大小 严格按照蓝湖」*。
 *
 * 下表每个数字都来自 `lanhu_inspect_design_region` 的 `raw_style.textInfo`（PS 源）：
 * `size` 取 `impliedFontSize`，颜色取 `textStyleRange[].color`，
 * 描边取 `layerEffects.frameFX`（`style: outsetFrame` / `size: 2`）。
 * 除了增益块（米色底，用深色字且**无**描边）和「当前城主」（深红描边），其余一律 2px 黑描边。
 */
test('文字颜色 / 描边 / 字号逐项对齐蓝湖量测值', () => {
    const { rows } = loadPrefab();
    const labelOf = (name: string) => {
        const node = rows.find((row) => row.__type__ === 'cc.Node' && row._name === name) as IPrefabObject;
        assert.ok(node, `缺少节点 ${name}`);
        const ref = node._components.map((r) => rows[r.__id__]).find((c) => c.__type__ === 'cc.Label');
        assert.ok(ref, `${name} 缺 cc.Label`);
        return ref as unknown as Record<string, any>;
    };
    const spec: Record<string, { font: number; color: [number, number, number]; outline: boolean }> = {
        RankNo: { font: 30, color: [255, 255, 255], outline: true },
        RankName: { font: 22, color: [255, 255, 255], outline: true },
        RankScoreTag: { font: 22, color: [248, 160, 50], outline: true },
        RankScoreValue: { font: 22, color: [248, 160, 50], outline: true },
        FullRank: { font: 18, color: [114, 184, 255], outline: true },
        WarText: { font: 26, color: [255, 255, 255], outline: true },
        WarMin: { font: 22, color: [255, 111, 114], outline: true },
        BuffTitle: { font: 22, color: [56, 44, 39], outline: false },
        BuffDesc: { font: 20, color: [56, 44, 39], outline: false },
        LordTitleText: { font: 24, color: [255, 255, 255], outline: true },
        LordName: { font: 24, color: [255, 255, 255], outline: true },
        LordScore: { font: 22, color: [248, 232, 50], outline: true },
        FightLabel: { font: 36, color: [255, 255, 255], outline: true },
        StaminaLabel: { font: 24, color: [255, 254, 250], outline: true },
    };
    for (const [name, want] of Object.entries(spec)) {
        const label = labelOf(name);
        assert.equal(label._fontSize, want.font, `${name} 字号不等于蓝湖 ${want.font}`);
        assert.deepEqual([label._color.r, label._color.g, label._color.b], want.color, `${name} 颜色不等于蓝湖`);
        assert.equal(label._enableOutline, want.outline, `${name} 描边开关不等于蓝湖`);
        if (want.outline) assert.equal(label._outlineWidth, 2, `${name} 描边宽度不等于蓝湖 2px`);
    }
    // 增益块容器按**内容实际大小**（标题 23 + 块 88 + 间隙 = 117 高、块宽 361），不是 100×100 的空壳。
    for (const name of ['Buff0', 'Buff1']) {
        const node = rows.find((row) => row.__type__ === 'cc.Node' && row._name === name) as IPrefabObject;
        assert.ok(node, `缺少节点 ${name}`);
        const size = rows[node._components.map((r) => r.__id__)
            .find((id) => rows[id].__type__ === 'cc.UITransform')!] as unknown as { _contentSize: { width: number; height: number } };
        assert.deepEqual({ w: size._contentSize.width, h: size._contentSize.height }, { w: 361, h: 117 },
            `${name} 容器应包住「标题 + 增益框」的实际范围`);
    }
    // 效果图里标题是粗体、描述明显更细 —— 描述不能跟着加粗。
    assert.equal(labelOf('BuffTitle')._isBold, true);
    assert.equal(labelOf('BuffDesc')._isBold, false);
    // 「当前城主」的描边是深红，不是黑 —— 单独钉一次。
    const lordFrame = labelOf('LordTitleText')._outlineColor as unknown as { r: number; g: number; b: number };
    assert.deepEqual([lordFrame.r, lordFrame.g, lordFrame.b], [48, 4, 1]);
    // 积分两段必须分开两个节点：设计稿「积分」左边缘 553、「数值」左边缘 607。
    const tag = rows.find((row) => row.__type__ === 'cc.Node' && row._name === 'RankScoreTag') as IPrefabObject;
    const value = rows.find((row) => row.__type__ === 'cc.Node' && row._name === 'RankScoreValue') as IPrefabObject;
    assert.ok(tag && value, '积分必须拆成 RankScoreTag + RankScoreValue 两个节点');
    assert.equal(tag._lpos.x, 68.5, '「积分」左边缘应落在设计稿 553');
    assert.equal(value._lpos.x, 140, '积分数值左边缘应落在设计稿 607');
    // 战功进度填充用 anchorX=0 从左往右长，改宽度才不会被拉扁。
    const fillNode = rows.find((row) => row.__type__ === 'cc.Node' && row._name === 'WarFill') as IPrefabObject;
    const fillTransform = rows[fillNode._components.map((r) => r.__id__)
        .find((id) => rows[id].__type__ === 'cc.UITransform')!] as unknown as { _anchorPoint: { x: number } };
    assert.equal(fillTransform._anchorPoint.x, 0);
});

function loadPopup(headArt: object = {}) {
    const exports: Record<string, new () => Record<string, unknown>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapCityPopup.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Color {
        static WHITE = Object.assign(new Color(255, 255, 255, 255), { clone: () => new Color(255, 255, 255, 255) });
        constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
    }
    class Component {}
    class Button { static EventType = { CLICK: 'click' }; }
    class Node { static EventType = { TOUCH_END: 'end' }; }
    // 城池弹窗现在继承 PopupBase（栈式弹窗基类），桩只需提供 node 与生命周期空壳。
    class PopupBase { node: Record<string, any> = null; }
    runInNewContext(code, {
        exports,
        require: (name: string) => {
            if (name.endsWith('/HeadArt')) return { HeadArt: headArt };
            if (name.endsWith('/EventMgr')) return { EventMgr };
            if (name.endsWith('/BigMapEvents')) return mvcEvents;
            if (name.endsWith('/framework/ui/PopupBase')) return { PopupBase };
            if (name.endsWith('/framework/ui/PopupDef')) return { PopupCloseReason: { Manual: 0, Force: 1 } };
            if (name === 'cc') return { _decorator: { ccclass: () => (v: unknown) => v, property: () => () => undefined },
                Color, Component, Button, Node, Label: class {}, Sprite: class {}, SpriteFrame: class {},
                UITransform: class {} };
            return {};
        },
    });
    return exports.BigMapCityPopup as new () => Record<string, any>;
}

function makePopup(headArt: object = {}) {
    const Popup = loadPopup(headArt);
    const popup = new Popup();
    const listeners = new Map<string, () => void>();
    const makeNode = (name: string) => {
        const transform = { width: 0, height: 0, setContentSize(w: number, h: number) { transform.width = w; transform.height = h; },
            setAnchorPoint() {}, get width2() { return transform.width; } };
        const target: Record<string, any> = {
            active: true, parent: { children: [1, 2] }, transform,
            setPosition() {}, setScale() {}, setSiblingIndex() {},
            getComponent: () => transform,
            on: (event: string, fn: () => void, scope: unknown) => listeners.set(`${name}:${event}`, fn.bind(scope)),
        };
        return target;
    };
    const label = (name: string) => ({ string: '', node: makeNode(name) });
    const sprite = (name: string) => ({ node: makeNode(name), spriteFrame: null, color: null });
    popup.node = makeNode('root');
    popup.buffRoots = [makeNode('buff0'), makeNode('buff1')];
    popup.buffTitles = [label('bt0'), label('bt1')];
    popup.buffDescs = [label('bd0'), label('bd1')];
    popup.rankRoots = [makeNode('r0'), makeNode('r1'), makeNode('r2')];
    popup.rankNumbers = [label('rn0'), label('rn1'), label('rn2')];
    popup.rankNames = [label('nm0'), label('nm1'), label('nm2')];
    popup.rankScoreTags = [label('st0'), label('st1'), label('st2')];
    popup.rankScoreValues = [label('sc0'), label('sc1'), label('sc2')];
    popup.rankAvatars = [sprite('av0'), sprite('av1'), sprite('av2')];
    popup.fullRankRoot = makeNode('fullRank');
    popup.openingLabel = label('opening');
    popup.warScoreLabel = label('war');
    // 战功条改成**直接拖 UITransform**（不再 getComponent），桩要给出真尺寸。
    const fillTransform = { width: 249, height: 21, setContentSize(w: number, h: number) { fillTransform.width = w; fillTransform.height = h; } };
    popup.warScoreFillTransform = fillTransform;
    popup.lordNameLabel = label('lord');
    popup.lordScoreLabel = label('lordScore');
    popup.lordPerson = sprite('person');
    popup.emptyLordLabel = label('emptyLord');
    popup.lordScoreRoot = makeNode('lordScoreRoot');
    popup.fightButton = { node: makeNode('fight'), interactable: true };
    popup.playerActionsButton = { node: makeNode('playerActions'), interactable: true };
    popup.fightLabel = label('fight');
    popup.staminaLabel = label('stamina');
    popup.staminaIcon = sprite('staminaIcon');
    return { popup, listeners };
}

test('排行头像同ID不重复加载，换城清空及关闭后迟到头像不能回填', async () => {
    const loads: ((frame: object) => void)[] = [];
    const { popup } = makePopup({ loadHeadFrame: () => new Promise((resolve) => loads.push(resolve)) });
    popup.isValid = true;
    const rows = [{ rank: 1, name: '榜首', score: '900', avatar: null, avatarId: '1001' }];
    popup.renderRanks(rows);
    popup.renderRanks(rows);
    assert.equal(loads.length, 1);
    const frame = {};
    loads[0](frame);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.rankAvatars[0].spriteFrame, frame);
    popup.renderRanks(rows);
    assert.equal(popup.rankAvatars[0].spriteFrame, frame, '重复渲染不抹掉已加载的头像');
    popup.renderRanks([{ ...rows[0], avatarId: '1002' }]);
    popup.renderRanks([]);
    loads[1]({});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.rankAvatars[0].spriteFrame, null);
    popup.renderRanks(rows);
    popup.onClose(0);
    loads[2]({});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.rankAvatars[0].spriteFrame, null);
});

test('城主形象按ID加载，换城和关闭后迟到结果不回填，积分使用缩写', async () => {
    const loads: ((frame: object) => void)[] = [];
    const { popup } = makePopup({ loadHeadFrame: () => new Promise((resolve) => loads.push(resolve)) });
    popup.isValid = true;
    const content = { buffs: [], ranks: [{ rank: 2, name: '玩家', score: '27634000', avatar: null }],
        warScore: 0, minOccupyScore: 4200, lordName: '城主', lordScore: '1512916', lordAvatarId: '1001',
        staminaCost: 20, fightCaption: '进攻', fightEnabled: true };
    popup.render(content);
    popup.render(content);
    assert.equal(loads.length, 1);
    assert.equal(popup.lordScoreLabel.string, '积分 1512K');
    assert.equal(popup.rankScoreValues[0].string, '27634K');
    const frame = {};
    loads[0](frame);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.lordPerson.spriteFrame, frame);
    assert.equal(popup.lordPerson.node.active, true);
    popup.render({ ...content, lordAvatarId: '1002' });
    popup.render({ ...content, lordName: '', lordAvatarId: '' });
    loads[1]({});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.lordPerson.spriteFrame, null);
    assert.equal(popup.lordPerson.node.active, false);
    popup.render(content);
    popup.onClose(0);
    loads[2]({});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(popup.lordPerson.spriteFrame, null);
});

test('讲台先于城主人物绘制，不能遮掉人物下沿', () => {
    const { rows } = loadPrefab();
    const root = rows.find((row) => row.__type__ === 'cc.Node' && row._name === 'BigMapCityPopup');
    const names = root._children.map((ref) => rows[ref.__id__]._name);
    assert.ok(names.indexOf('LordBase') < names.indexOf('LordPerson'));
});

test('排行榜头像槽固定72像素CUSTOM尺寸并以圆形裁切，换大图不撑开', () => {
    const { rows, component } = loadPrefab();
    for (const ref of component.rankAvatars as IPrefabRef[]) {
        const sprite = rows[ref.__id__];
        assert.equal(sprite._sizeMode, 0, '头像使用CUSTOM，不随SpriteFrame切换恢复RAW原图尺寸');
        assert.equal(sprite._isTrimmedMode, false);
        const node = rows[(sprite.node as IPrefabRef).__id__];
        const transform = node._components.map((entry) => rows[entry.__id__])
            .find((entry) => entry.__type__ === 'cc.UITransform');
        assert.equal(transform._contentSize.width, 72);
        assert.equal(transform._contentSize.height, 72);
        const parent = rows[(node._parent as IPrefabRef).__id__];
        const mask = parent._components.map((entry) => rows[entry.__id__]).find((entry) => entry.__type__ === 'cc.Mask');
        assert.equal(mask._type, 1, 'GRAPHICS_ELLIPSE 圆形裁切');
    }
});

test('驻守玩家按钮绑定真实Button且以意图进入玩家操作，离线城池隐藏入口', () => {
    const { rows, component } = loadPrefab();
    const button = rows[(component.playerActionsButton as IPrefabRef).__id__];
    assert.equal(button.__type__, 'cc.Button');
    assert.equal(button._transition, 0);
    assert.equal(button._target, null);
    const buttonNode = rows[(button.node as IPrefabRef).__id__];
    const widget = buttonNode._components.map((ref: IPrefabRef) => rows[ref.__id__])
        .find((row: { __type__: string }) => row.__type__ === 'cc.Widget');
    assert.ok(typeof widget._bottom === 'number' && widget._bottom >= 300,
        '驻守入口须位于弹窗面板内，不覆盖底部导航');
    const { popup, listeners } = makePopup();
    const calls: string[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => calls.push(event.intent.kind), popup);
    try {
        popup.onInit();
        const content = { buffs: [], ranks: [], warScore: 0, minOccupyScore: 0,
            lordName: '', lordScore: '', staminaCost: 0, fightCaption: '', fightEnabled: false, hasPlayerActions: true };
        popup.render(content);
        assert.equal(popup.playerActionsButton.node.active, true);
        listeners.get('playerActions:click')?.();
        assert.deepEqual(calls, ['campRoles']);
        popup.render({ ...content, hasPlayerActions: false });
        assert.equal(popup.playerActionsButton.node.active, false);
    } finally { EventMgr.instance.offTarget(popup); }
});

test('弹窗复用同一实例时全量覆盖：空槽位隐藏、战功条按比例改宽、进攻按钮只在可打时派发意图', () => {
    const { popup, listeners } = makePopup();
    const calls: string[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        calls.push(event.intent.kind);
    }, popup);
    popup.onInit();
    popup.render({
        title: '前哨营地',
        buffs: [{ title: '增益效果', desc: '资源产出 +10%' }],
        ranks: [{ rank: 1, name: '', score: '120', avatar: null }],
        warScore: 125, minOccupyScore: 250,
        lordName: '甲玩家', lordScore: '900', staminaCost: 20,
        fightCaption: '进攻', fightEnabled: true,
    });
    assert.equal(popup.node.active, true);
    assert.equal(popup.buffRoots[0].active, true);
    assert.equal(popup.buffRoots[1].active, false, '只有一条增益时第二条必须隐藏');
    assert.equal(popup.buffDescs[0].string, '资源产出 +10%');
    assert.equal(popup.rankRoots[0].active, true);
    assert.equal(popup.rankRoots[1].active, false);
    assert.equal(popup.fullRankRoot.active, true);
    assert.equal(popup.rankNumbers[0].string, '1');
    // 「积分」和数值是两个节点（设计稿 x=553 / x=607 两段）。
    assert.equal(popup.rankScoreTags[0].string, '积分');
    assert.equal(popup.rankScoreValues[0].string, '120');
    assert.equal(popup.warScoreLabel.string, '125/250');
    // 125/250 = 50% ⇒ 槽宽 250 → 填充 125（改宽度而不是 scale，圆角才不会被拉扁）。
    assert.equal(popup.warScoreFillTransform.width, 125);
    assert.equal(popup.lordNameLabel.string, '甲玩家');
    assert.equal(popup.fightLabel.string, '进攻');
    listeners.get('fight:click')?.();
    assert.deepEqual(calls, ['primary']);

    // 第二次换一座城：所有槽位必须被**全量覆盖**，不能留着上一座城的文案。
    popup.render({
        title: '边境要塞', buffs: [], ranks: [], warScore: 0, minOccupyScore: 0,
        lordName: '', lordScore: '', staminaCost: 0, fightCaption: '不可进攻', fightEnabled: false,
    });
    assert.equal(popup.buffRoots[0].active, false);
    assert.equal(popup.buffDescs[0].string, '');
    assert.equal(popup.rankRoots[0].active, false);
    assert.equal(popup.fullRankRoot.active, false);
    assert.equal(popup.rankNames[0].string, '');
    assert.equal(popup.rankScoreValues[0].string, '');
    assert.equal(popup.warScoreLabel.string, '0/0');
    assert.equal(popup.warScoreFillTransform.width, 0);
    assert.equal(popup.lordNameLabel.string, '');
    assert.equal(popup.lordPerson.node.active, false);
    assert.equal(popup.emptyLordLabel.node.active, true);
    assert.equal(popup.lordNameLabel.node.active, false);
    assert.equal(popup.lordScoreRoot.active, false);
    assert.equal(popup.fightButton.node.active, false);
    assert.equal(popup.staminaLabel.node.active, false);
    assert.equal(popup.staminaIcon.node.active, false);
    // 禁用按钮由 cc.Button 拦截，测试不绕过组件直接执行 handler。
    assert.equal(popup.fightButton.interactable, false);
    assert.deepEqual(calls, ['primary']);

    // 点空白关闭由 PopupBase 的 `__BlankClose` 层实现（prefab 里已没有 Dim），
    // 因此这里只验「关闭时补发 clear」这条约定。
    popup.onClose(0);
    assert.deepEqual(calls, ['primary', 'clear']);
    EventMgr.instance.offTarget(popup);
});

test('无人占据时隐藏可用的进攻按钮，切回有城主时恢复展示', () => {
    const { popup } = makePopup();
    const content = {
        buffs: [], ranks: [], warScore: 0, minOccupyScore: 28000,
        lordName: '', lordScore: '900', staminaCost: 20,
        fightCaption: '进攻', fightEnabled: true,
    };
    popup.render(content);
    assert.equal(popup.fightButton.node.active, false);
    assert.equal(popup.emptyLordLabel.node.active, true);
    assert.equal(popup.lordPerson.node.active, false);
    assert.equal(popup.lordScoreRoot.active, false);
    assert.equal(popup.lordScoreLabel.string, '');
    popup.render({ ...content, lordName: '城主' });
    assert.equal(popup.fightButton.node.active, true);
    assert.equal(popup.emptyLordLabel.node.active, false);
    assert.equal(popup.lordNameLabel.node.active, true);
    assert.equal(popup.lordNameLabel.string, '城主');
    assert.equal(popup.lordScoreRoot.active, true);
    assert.equal(popup.lordScoreLabel.string, '积分 900');
});

test('无人占据文案居中叠在右侧人形上，积分区绑定到完整背景节点', () => {
    const { rows, component } = loadPrefab();
    const label = rows[(component.emptyLordLabel as IPrefabRef).__id__];
    const node = rows[(label.node as IPrefabRef).__id__];
    const person = rows.find((row) => row._name === 'LordPerson');
    assert.equal(label._string, '无人占据');
    assert.equal(node._lpos.x, person?._lpos.x);
    assert.equal(node._lpos.y, person?._lpos.y);
    assert.equal(rows[(component.lordScoreRoot as IPrefabRef).__id__]._name, 'LordScoreBg');
});

test('未开放显示配置开放日，空榜隐藏完整榜单，切城后清空旧文案并恢复榜单入口', () => {
    const { popup } = makePopup();
    const content = {
        buffs: [], ranks: [], warScore: 0, minOccupyScore: 28000,
        lordName: '', lordScore: '', staminaCost: 20,
        fightCaption: '进攻', fightEnabled: false,
        openingText: formatBigMapCityOpening(6),
    };
    popup.render(content);
    assert.equal(popup.openingLabel.node.active, true);
    assert.equal(popup.openingLabel.string, '未开放\n开服第6天开放');
    assert.equal(popup.fullRankRoot.active, false);
    popup.render({ ...content, openingText: '', ranks: [{ rank: 1, name: '榜首', score: '10', avatar: null }] });
    assert.equal(popup.openingLabel.node.active, false);
    assert.equal(popup.openingLabel.string, '');
    assert.equal(popup.fullRankRoot.active, true);
    assert.equal(formatBigMapCityOpening(0), '未开放', '没有开放日时不编造倒计时');
});
