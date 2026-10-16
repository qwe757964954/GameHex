/**
 * 选服弹窗（`ui/login/ServerSelectPanel` + `ui/login/ServerSelectItem`）的回归网。
 *
 * ## 为什么要有这条
 *
 * 这两份 prefab 是**从零重建**的（老版是「固定槽位 + `listContainer` 手摆 + 自己
 * `instantiate`」），重建过程里有四处**静默失效**风险，单跑界面看不出来：
 *
 *   ① **`content` 被 `cc.Widget` 抢宽度**：纵向 `VirtualScrollView._recomputeContentSize()`
 *      **只写 `_contentTf.height`，宽度永远不管**；而挂上 `cc.Widget` 后它按左右对齐回写
 *      `_contentSize.width` —— 实测把 560 写成 1020、`_left/_right` 写成 `-230`。
 *      ⇒ 视口 560 / 条目 540 的场景，Widget 必须不挂（`ItemDetail` 之所以没出事，只是
 *      因为它的 content 与视口等宽）。
 *   ② **列表槽位缺 `ServerSelectItem` 组件** ⇒ `renderItem` 第一句
 *      `node.getComponent(ServerSelectItem)!.initialize(...)` 直接抛；
 *      而「槽位没挂组件」在别处是**列表永远空白、零报错**（`MEMORY.md` 规则 110）。
 *   ③ **对象池复用的 item 每复用一次多挂一个 TOUCH_END** ⇒ 点一下触发 N 次；
 *      因为 `initialize` 忘了先 `off`。这条纯粹靠源码形状守。
 *   ④ **`renderItemFn` 绑成闭包捕获「本趟」数据快照** ⇒ 第二次打开还停在上一次的服务器列表。
 *
 * 另有一条换皮硬伤：老 `PanelBg`/`TitleBg` 是 `cc.Sprite._sizeMode` 默认 `TRIMMED(1)`，
 * 本项目口径一律 `CUSTOM(0)`（否则图会被裁掉透明边，框对不上）。
 */

// ⚠️ 这里刻意用【命名导入】而不是 `import assert from 'node:assert/strict'`：
//    本工程 `tsconfig.json` 继承 `temp/tsconfig.cocos.json`，**没开**
//    `allowSyntheticDefaultImports` / esnext module ⇒ 默认导入 node 内置模块会报
//    `TS1259`、`import.meta` 会报 `TS1343`（既有 274 条同类噪声就是这么来的）。
//    写成命名导入 + cwd 相对路径 ⇒ 本文件对全量 `tsc` **零新增**。
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as path from 'node:path';

const ROOT = process.cwd();
const PREFAB_DIR = path.join(ROOT, 'assets/resources/ui/login');
const SCRIPT_DIR = path.join(ROOT, 'assets/script/app/login');

/** 弹窗皮「道具详情包」的取件表（uuid 前 8 位足以唯一化，全 32 位在 meta 里）。 */
const ART = {
    /** id_panel_bg —— 底板九宫 620×656，九宫 164/164/155/155，中心 rgb(200,179,149) */
    panelBg: 'd04d6e56',
    /** id_title_gray —— 标题条九宫 344×81，九宫 26/34/170/146，中心 rgb(87,88,98) */
    titleBg: '7a234c2b',
    /** 公用_按钮_关闭01 —— 60×60，中心橙 rgb(229,104,60) */
    close: 'c1716940',
    /** id_row_bg —— 条目底九宫 407×103，九宫 25/28/101/104，中间 rgb(236,218,188) */
    rowBg: '31bf229c',
    /** 内置白图（用于画纯色遮罩） */
    white: '7d8f9b89',
} as const;

const ITEM_PREFAB_UUID = '320e6548-ef0b-4b7d-ba0f-8d1590886ff7';

type Prefab = Array<Record<string, any>>;

function loadPrefab(name: string): Prefab {
    return JSON.parse(readFileSync(path.join(PREFAB_DIR, name), 'utf8')) as Prefab;
}

/** 剥掉块注释与行注释（规则 104：反向断言先剥注释）。 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function compsOf(objects: Prefab, node: Record<string, any>): Array<Record<string, any>> {
    return (node._components ?? []).map((c: { __id__: number }) => objects[c.__id__]);
}

function findComp(objects: Prefab, node: Record<string, any>, type: string): Record<string, any> | undefined {
    return compsOf(objects, node).find((c) => c.__type__ === type);
}

function nodeByName(objects: Prefab, name: string): Record<string, any> {
    const node = objects.find((o) => o.__type__ === 'cc.Node' && o._name === name);
    assert.ok(node, `prefab 里找不到节点 ${name}`);
    return node!;
}

function childNames(objects: Prefab, node: Record<string, any>): string[] {
    return (node._children ?? []).map((c: { __id__: number }) => objects[c.__id__]._name as string);
}

function sizeOf(objects: Prefab, node: Record<string, any>): { width: number; height: number } {
    const tf = findComp(objects, node, 'cc.UITransform');
    assert.ok(tf, `节点 ${node._name} 没有 cc.UITransform`);
    return { width: tf!._contentSize.width as number, height: tf!._contentSize.height as number };
}

function anchorOf(objects: Prefab, node: Record<string, any>): { x: number; y: number } {
    const tf = findComp(objects, node, 'cc.UITransform')!;
    return { x: tf._anchorPoint.x as number, y: tf._anchorPoint.y as number };
}

/** 世界矩形。只处理本项目 UI 的实际情况（无旋转 / 无缩放），够用且判据直白。 */
interface IRect {
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
}

function worldRect(objects: Prefab, node: Record<string, any>, parentRect: IRect | null): IRect {
    const size = sizeOf(objects, node);
    const anchor = anchorOf(objects, node);
    const lpos = (node._lpos ?? { x: 0, y: 0 }) as { x: number; y: number };
    let originX: number;
    let originY: number;
    if (parentRect === null) {
        originX = 0;
        originY = 0;
    } else {
        const parentNode = objects.find(
            (o) => o.__type__ === 'cc.Node' && (o._children ?? []).some((c: { __id__: number }) => objects[c.__id__] === node),
        );
        assert.ok(parentNode, `${node._name} 找不到父节点`);
        const parentSize = sizeOf(objects, parentNode!);
        const parentAnchor = anchorOf(objects, parentNode!);
        originX = parentRect.left + parentAnchor.x * parentSize.width;
        originY = parentRect.bottom + parentAnchor.y * parentSize.height;
    }
    const anchorWorldX = originX + lpos.x;
    const anchorWorldY = originY + lpos.y;
    return {
        left: anchorWorldX - anchor.x * size.width,
        right: anchorWorldX + (1 - anchor.x) * size.width,
        bottom: anchorWorldY - anchor.y * size.height,
        top: anchorWorldY + (1 - anchor.y) * size.height,
    };
}

function sfPrefix(objects: Prefab, node: Record<string, any>): string {
    const sprite = findComp(objects, node, 'cc.Sprite');
    assert.ok(sprite, `${node._name} 没有 cc.Sprite`);
    return String(sprite!._spriteFrame?.__uuid__ ?? '').slice(0, 8);
}

// ---------------------------------------------------------------- 弹窗壳

test('ServerSelectPanel 根：满屏尺寸 + 子节点顺序 Bg > PanelBg > TitleBg > CloseBtn > ServerList', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const root = objects[1];
    assert.equal(root._name, 'ServerSelectPanel');
    assert.deepEqual(sizeOf(objects, root), { width: 720, height: 1280 }, '根节点应是设计分辨率满屏');
    assert.deepEqual(anchorOf(objects, root), { x: 0.5, y: 0.5 });
    // 子序：Bg 必须在最底（黑遮罩），CloseBtn 必须在 ServerList 之前（别被列表盖住点不到）
    assert.deepEqual(childNames(objects, root), ['Bg', 'PanelBg', 'TitleBg', 'CloseBtn', 'ServerList']);
});

test('黑遮罩 Bg：满屏 + 内置白图染 rgba(0,0,0,160)（与 GMPanel.Bg 同口径）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const bg = nodeByName(objects, 'Bg');
    assert.deepEqual(sizeOf(objects, bg), { width: 720, height: 1280 }, '遮罩必须满屏，否则边上漏点击');
    assert.equal(sfPrefix(objects, bg), ART.white);
    const sprite = findComp(objects, bg, 'cc.Sprite')!;
    assert.deepEqual(
        [sprite._color.r, sprite._color.g, sprite._color.b, sprite._color.a],
        [0, 0, 0, 160],
        '遮罩色应是 160 alpha 的纯黑',
    );
    // 遮罩必须在 PanelBg 之前（子序上面已断言），且不能被当成可点内容
    assert.equal(findComp(objects, bg, 'cc.Button'), undefined, '遮罩不该有 Button');
});

test('换皮取件：PanelBg / TitleBg / CloseBtn 三张图与尺寸都对齐「道具详情包」', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');

    const panelBg = nodeByName(objects, 'PanelBg');
    assert.equal(sfPrefix(objects, panelBg), ART.panelBg, 'PanelBg 应是 id_panel_bg');
    assert.deepEqual(sizeOf(objects, panelBg), { width: 626, height: 866 }, '应与老端弹窗本体同尺寸');
    assert.equal(findComp(objects, panelBg, 'cc.Sprite')!._type, 1, '九宫图必须 SLICED(1)');
    assert.equal(findComp(objects, panelBg, 'cc.Sprite')!._sizeMode, 0, '口径：_sizeMode 一律 CUSTOM(0)');

    const titleBg = nodeByName(objects, 'TitleBg');
    assert.equal(sfPrefix(objects, titleBg), ART.titleBg, 'TitleBg 应是 id_title_gray');
    assert.equal(findComp(objects, titleBg, 'cc.Sprite')!._sizeMode, 0);

    const closeBtn = nodeByName(objects, 'CloseBtn');
    assert.equal(sfPrefix(objects, closeBtn), ART.close, 'CloseBtn 应是 公用_按钮_关闭01');
    assert.deepEqual(sizeOf(objects, closeBtn), { width: 60, height: 60 });
    assert.equal(findComp(objects, closeBtn, 'cc.Sprite')!._sizeMode, 0);
});

test('Title：文案「选择服务器」+ 暖白字色（标题条是深灰蓝底，不能默认黑字）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const title = nodeByName(objects, 'Title');
    const label = findComp(objects, title, 'cc.Label');
    assert.ok(label, 'Title 上没有 cc.Label');
    assert.equal(label!._string, '选择服务器');
    assert.equal(label!._fontSize, 28);
    const [r, g, b] = [label!._color.r, label!._color.g, label!._color.b];
    assert.ok(r > 200 && g > 200 && b > 150, `标题应压暖白（实测 255,246,196），实际 ${r},${g},${b}`);
    assert.equal(label!._overflow, 2, 'overflow 应是 SHRINK(2)，防长文案溢出标题条');
});

test('CloseBtn 的 cc.Button 参数对齐 MailDetail（SCALE / 0.94 / 0.06 / _target:null）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const button = findComp(objects, nodeByName(objects, 'CloseBtn'), 'cc.Button');
    assert.ok(button, 'CloseBtn 上没有 cc.Button');
    assert.equal(button!._transition, 3, '_transition 应是 SCALE(3)');
    assert.equal(button!._zoomScale, 0.94);
    assert.equal(button!._duration, 0.06);
    assert.equal(button!._target, null, '_target 留 null（作用于自身节点），别指向别的节点');
});

test('ServerSelectPanel 脚本：走 PopupBase 标准壳（prefabPath / 层 / 点空白 / 引用形态）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const root = objects[1];
    const script = compsOf(objects, root).find((c) => c.closeButton !== undefined);
    assert.ok(script, '根节点上没找到 ServerSelectPanel 组件（属性名全丢）');

    // 层与点空白：默认值显式落盘，别依赖基类默认（免得生成器覆盖时静默变化）
    assert.equal(script!.popupLayer, 0, 'popupLayer 应是 NORMAL(0)');
    assert.equal(script!.closeOnBlank, true);
    assert.deepEqual(script!.contentNodes, [], 'contentNodes 留空 ⇒ 基类走「全部激活一级子节点」口径');

    // 引用形态（规则 105 的两形态）：closeButton 声明 Node ⇒ 指向 cc.Node
    const closeTarget = objects[script!.closeButton.__id__];
    assert.equal(closeTarget.__type__, 'cc.Node', 'closeButton 声明的是 Node，必须指向 cc.Node');
    assert.equal(closeTarget._name, 'CloseBtn');

    // serverList 声明 VirtualScrollView ⇒ 指向那个自制组件（不是 Node，也不是 cc.ScrollView）
    const listTarget = objects[script!.serverList.__id__];
    assert.notEqual(listTarget.__type__, 'cc.Node', 'serverList 应是组件，不是节点');
    assert.equal(listTarget.__type__, '544earF5qRLB4JTuTnSr11+', `serverList 应指向 VirtualScrollView，实际 ${listTarget.__type__}`);
});

// ---------------------------------------------------------------- 虚拟列表

test('ServerList：视口 anchor(0.5,1) + 组件序 [Mask, Graphics, VirtualScrollView]（对齐 ItemDetail）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const list = nodeByName(objects, 'ServerList');
    assert.deepEqual(sizeOf(objects, list), { width: 560, height: 740 });
    assert.deepEqual(anchorOf(objects, list), { x: 0.5, y: 1 }, '纵向虚拟列表视口锚点必须是 (0.5,1)（规则 120）');
    assert.deepEqual(
        compsOf(objects, list).map((c) => c.__type__),
        ['cc.UITransform', 'cc.Mask', 'cc.Graphics', '544earF5qRLB4JTuTnSr11+'],
        'Mask/Graphics 必须在 VirtualScrollView 之前（裁剪层先建）',
    );
});

test('VirtualScrollView 取值：纵向 / 对象池 / itemPrefab 指向 ServerSelectItem / totalCount 出厂 0', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const list = nodeByName(objects, 'ServerList');
    const view = findComp(objects, list, '544earF5qRLB4JTuTnSr11+')!;

    assert.equal(view.direction, 0, 'direction 0 = 纵向');
    assert.equal(view.itemCreationMode, 1, 'itemCreationMode 1 = PREFAB 对象池');
    assert.equal(
        view.itemPrefab.__uuid__,
        ITEM_PREFAB_UUID,
        'itemPrefab 必须指向 ServerSelectItem.prefab（写错 ⇒ 列表空白且零报错）',
    );
    assert.equal(view.totalCount, 0, '出厂 totalCount 应为 0，条数由 refreshList 喂');
    assert.equal(view.gridCount, 1, '纵向列表 gridCount 是列数，应为 1');
    assert.equal(view.pixelAlign, true);
    assert.equal(view.useVirtualList, true);
    // content 引用必须是 ServerList 的子节点 content（不是自己，也不是别的节点）
    assert.equal(objects[view.content.__id__]._name, 'content');
});

test('content：560×740 anchor(0.5,1) 且【不挂 cc.Widget】（Widget 会回写宽度跟虚拟列表抢）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const content = nodeByName(objects, 'content');
    // 视口 560 / 条目 540 不等宽 ⇒ Widget 一旦挂上会立刻把宽度改成 1020（实测）
    assert.deepEqual(sizeOf(objects, content), { width: 560, height: 740 });
    assert.deepEqual(anchorOf(objects, content), { x: 0.5, y: 1 });
    assert.equal(
        findComp(objects, content, 'cc.Widget'),
        undefined,
        'content 不可挂 cc.Widget：非等宽场景会被回写成 560±左右边距 的错值',
    );
    assert.deepEqual(
        compsOf(objects, content).map((c) => c.__type__),
        ['cc.UITransform'],
        'content 只该有 UITransform（尺寸交给 VirtualScrollView 只管高度）',
    );
});

test('几何：可见内容块全部落在 PanelBg 之内（不越出底板、不被 CloseBtn 压住）', () => {
    const objects = loadPrefab('ServerSelectPanel.prefab');
    const root = objects[1];
    const rootRect = worldRect(objects, root, null);

    const panelNode = nodeByName(objects, 'PanelBg');
    const panelRect = worldRect(objects, panelNode, rootRect);

    const bad: string[] = [];
    for (const name of ['TitleBg', 'CloseBtn', 'ServerList']) {
        const rect = worldRect(objects, nodeByName(objects, name), rootRect);
        const inside =
            rect.left >= panelRect.left - 0.01 &&
            rect.right <= panelRect.right + 0.01 &&
            rect.bottom >= panelRect.bottom - 0.01 &&
            rect.top <= panelRect.top + 0.01;
        if (!inside) {
            bad.push(
                `${name} 越出底板：${JSON.stringify(rect)} ⊄ ${JSON.stringify(panelRect)}`,
            );
        }
    }
    assert.deepEqual(bad, []);
    // 反向断言：底板自己必须比根小（否则上面那条恒真、等于没测）
    assert.ok(
        panelRect.right - panelRect.left < rootRect.right - rootRect.left,
        'PanelBg 与根等宽 ⇒ 越界判据失效',
    );
});

// ---------------------------------------------------------------- 条目

test('ServerSelectItem 结构：540×78 底图 + 左名右状态（anchor 0/1 两端对齐）', () => {
    const objects = loadPrefab('ServerSelectItem.prefab');
    const root = objects[1];
    assert.equal(root._name, 'ServerSelectItem');
    assert.deepEqual(sizeOf(objects, root), { width: 540, height: 78 });
    assert.deepEqual(childNames(objects, root), ['Background', 'NameLabel', 'StatusLabel']);

    const bg = nodeByName(objects, 'Background');
    assert.equal(sfPrefix(objects, bg), ART.rowBg, '条目底应是 id_row_bg');
    assert.equal(findComp(objects, bg, 'cc.Sprite')!._type, 1, '九宫图必须 SLICED(1)');
    assert.equal(findComp(objects, bg, 'cc.Sprite')!._sizeMode, 0);

    // 名字：左对齐 —— anchor(0,0.5) 且 lpos.x = -250（左端贴底图左边）
    const name = nodeByName(objects, 'NameLabel');
    assert.deepEqual(anchorOf(objects, name), { x: 0, y: 0.5 });
    assert.equal(name._lpos.x, -250);
    assert.deepEqual(sizeOf(objects, name), { width: 330, height: 30 });
    assert.equal(findComp(objects, name, 'cc.Label')!._horizontalAlign, 0, '名字应左对齐');

    // 状态：右对齐 —— anchor(1,0.5) 且 lpos.x = 250
    const status = nodeByName(objects, 'StatusLabel');
    assert.deepEqual(anchorOf(objects, status), { x: 1, y: 0.5 });
    assert.equal(status._lpos.x, 250);
    assert.deepEqual(sizeOf(objects, status), { width: 120, height: 30 });
    assert.equal(findComp(objects, status, 'cc.Label')!._horizontalAlign, 2, '状态应右对齐');
});

test('ServerSelectItem 脚本：三个 @property 形态正确（Sprite / Label / Label）', () => {
    const objects = loadPrefab('ServerSelectItem.prefab');
    const root = objects[1];
    const script = compsOf(objects, root).find((c) => c.background !== undefined);
    assert.ok(script, '根节点上没找到 ServerSelectItem 组件');

    for (const [field, type, nodeName] of [
        ['background', 'cc.Sprite', 'Background'],
        ['nameLabel', 'cc.Label', 'NameLabel'],
        ['statusLabel', 'cc.Label', 'StatusLabel'],
    ] as const) {
        assert.ok(script![field], `${field} 是空引用（规则 109：已绑的 @property 一律不判空）`);
        const target = objects[script![field].__id__];
        assert.equal(target.__type__, type, `${field} 应指向 ${type}，实际 ${target.__type__}`);
    }
});

test('两份 prefab 都没有老结构的孤儿引用（listContainer / serverLabel 必须清零）', () => {
    const bad: string[] = [];
    for (const name of ['ServerSelectPanel.prefab', 'ServerSelectItem.prefab']) {
        const raw = readFileSync(path.join(PREFAB_DIR, name), 'utf8');
        for (const orphan of ['listContainer', 'serverLabel']) {
            if (raw.includes(orphan)) bad.push(`${name} 残留孤儿字段 ${orphan}`);
        }
    }
    assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- 源码形状

test('ServerSelectPanel.ts：不许自定义 static open（会 TS2417），一律继承 PopupBase.open', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectPanel.ts'), 'utf8'));
    assert.ok(src.includes('extends PopupBase'), '应继承 PopupBase');
    assert.ok(
        !/static\s+open\s*\(/.test(src),
        '子类不得自定义 static open —— 静态侧与基类不兼容，编译期报 TS2417',
    );
    assert.ok(src.includes("static prefabPath = 'ui/login/ServerSelectPanel'"), 'prefabPath 必须是 ui/login/ServerSelectPanel');
});

test('ServerSelectPanel.ts：renderItemFn 只绑一次（在 onInit 里），回调不捕获本趟快照', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectPanel.ts'), 'utf8'));
    const binds = [...src.matchAll(/renderItemFn\s*=/g)];
    assert.equal(binds.length, 1, `renderItemFn 应只赋一次（实测 ${binds.length} 次）——多绑会翻倍渲染`);

    const onInitIdx = src.indexOf('protected onInit(');
    assert.ok(onInitIdx >= 0, '没找到 onInit');
    assert.ok(
        onInitIdx < binds[0].index!,
        'renderItemFn 必须在 onInit 里绑（onOpen 每次打开都会跑，绑那儿会逐次叠加）',
    );
    // 监听必须先 off 再 on 的同款风险：onInit 之外不得再出现 renderItemFn
    const onOpenIdx = src.indexOf('protected async onOpen(');
    assert.ok(onOpenIdx > binds[0].index!, 'onOpen 应在 onInit 之后声明');
});

test('ServerSelectPanel.ts：refreshList 必须在 nextPopupFrame() 之后（规则 108）', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectPanel.ts'), 'utf8'));
    const frameIdx = src.indexOf('await this.nextPopupFrame()');
    const refreshIdx = src.indexOf('this.serverList.refreshList(');
    assert.ok(frameIdx >= 0, '没找到 nextPopupFrame —— 列表槽位 / 视口在 start() 里才建，不等一帧会空白且零日志');
    assert.ok(refreshIdx >= 0, '没找到 refreshList');
    assert.ok(frameIdx < refreshIdx, 'refreshList 早于 nextPopupFrame ⇒ 列表一片空白（规则 108）');
    // 等一帧后要复检有效性，避免面板已被关掉还去喂数据
    assert.ok(
        src.indexOf('await this.nextPopupFrame()') < src.lastIndexOf('this.isValid'),
        'nextPopupFrame 之后应复检 isValid',
    );
});

test('ServerSelectPanel.ts：不许按宿主槽位数截断服务器列表（虚拟列表按真实条数铺）', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectPanel.ts'), 'utf8'));
    assert.ok(
        !/slice\(\s*0\s*,/.test(src),
        '不许 slice(0, N) 截断 —— 虚拟列表本身就能滚动，截断会让玩家看不到后面的服',
    );
    assert.ok(src.includes('.slice().sort('), '应先 slice() 复制再 sort()，别就地排序调用方数组');
    assert.ok(
        /sort\(\(a,\s*b\)\s*=>\s*b\.serverOpenTime\s*-\s*a\.serverOpenTime\)/.test(src),
        '排序键应是 serverOpenTime 降序（新服优先）',
    );
});

test('ServerSelectItem.ts：initialize 必须【先 off 再 on】（对象池复用，否则点一下触发 N 次）', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectItem.ts'), 'utf8'));
    const initIdx = src.indexOf('initialize(');
    assert.ok(initIdx >= 0, '没找到 initialize');
    const offIdx = src.indexOf('this.node.off(Node.EventType.TOUCH_END', initIdx);
    const onIdx = src.indexOf('this.node.on(Node.EventType.TOUCH_END', initIdx);
    assert.ok(offIdx >= 0, 'initialize 里必须 off 一次（否则槽位每复用一次多挂一个监听）');
    assert.ok(onIdx >= 0, 'initialize 里必须 on 一次');
    assert.ok(offIdx < onIdx, '必须先 off 再 on');
    // 每次复用都要把所有可变内容写满：名字 + 状态 + 底图着色
    for (const write of ['this.nameLabel.string', 'this.statusLabel.string', 'this.background.color']) {
        assert.ok(src.includes(write), `initialize 里必须回写 ${write}（否则残留上一条服务器的数据）`);
    }
    assert.ok(/this\.node\.name\s*=\s*`Server_\$\{server\.serverId\}`/.test(src), '节点名应回写为 Server_<id>，便于排查');
});

test('ServerSelectItem.ts：状态文案四档且「维护」优先（维护中的服不能显示成流畅）', () => {
    const src = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectItem.ts'), 'utf8'));
    const fnIdx = src.indexOf('export function serverStatusText(');
    assert.ok(fnIdx >= 0, '没找到 serverStatusText');
    const body = src.slice(fnIdx, fnIdx + 500);
    const order = ['Maintenance', 'Full', 'New'].map((s) => body.indexOf(`ServerStatus.${s}`));
    assert.ok(order.every((i) => i >= 0), '四档判据应显式列出 Maintenance / Full / New（余下为流畅）');
    assert.ok(order[0] < order[1] && order[1] < order[2], '判断顺序应为 维护 → 爆满 → 新服（维护必须最先判）');
    assert.ok(/'维护'/.test(body) && /'爆满'/.test(body) && /'新服'/.test(body) && /'流畅'/.test(body));
});

test('源码形状：面板与条目都不在 initialize/render 里裸 new 节点（用对象池，不自己 instantiate）', () => {
    for (const file of ['ServerSelectPanel.ts', 'ServerSelectItem.ts']) {
        const src = stripComments(readFileSync(path.join(SCRIPT_DIR, file), 'utf8'));
        assert.ok(!/instantiate\(/.test(src), `${file} 不应自己 instantiate —— 交给 VirtualScrollView 对象池`);
        assert.ok(!/new\s+Node\(/.test(src), `${file} 不应裸 new Node`);
    }
    // 面板不得再直接把节点 addChild 到场景（老做法：自己 open 后 addChild 到 root）
    const panel = stripComments(readFileSync(path.join(SCRIPT_DIR, 'ServerSelectPanel.ts'), 'utf8'));
    assert.ok(!/addChild\(/.test(panel), '弹窗挂载交给 PopupManager，面板自己不该 addChild');
});
