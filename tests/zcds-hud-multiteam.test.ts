import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * 对局 HUD「多队伍」改造的**顶栏**结构断言（阶段 1）。
 *
 * 设计稿：`8e042e77`（多队伍），换算口径 `absY = 640 − (canvasY + h/2)`。
 * 这里只钉 prefab 的**结构事实**，不依赖 `cc`（规则 78），所以能在 Node 里直接跑。
 */
const PREFAB = 'assets/resources/ui/game/ZCGameHUD.prefab';
const SCORE_CID = '6f04eAAck1Pvp3rCM/ChxSd';   // ZCGameHudScoreSlot
const VIEW_CID = '64e67gBXL1Amov0itNRcpvE';    // ZCGameHUDView

type TObj = Record<string, any>;
const raw = JSON.parse(readFileSync(PREFAB, 'utf8')) as TObj[];
const nodes = raw.filter((o) => o && o.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((n) => n._name === name);
const uiOf = (n: TObj) => n._components
    .map((c: TObj) => raw[c.__id__]).find((c: TObj) => c && c.__type__ === 'cc.UITransform');
const compsOf = (n: TObj) => n._components.map((c: TObj) => raw[c.__id__]).filter(Boolean);
const nameOfId = (id: number) => (raw[id] as TObj | undefined)?._name;

test('TopInfoPanel keeps time and a centered ScoreLayout', () => {
    const top = nodeNamed('TopInfoPanel');
    assert.ok(top);
    assert.equal(top!._lpos.y, 531.5);
    assert.deepEqual(top!._children.map((ref: TObj) => nameOfId(ref.__id__)), ['time', 'ScoreLayout']);
    const layout = nodeNamed('ScoreLayout');
    assert.ok(layout);
    assert.deepEqual(layout!._children.map((ref: TObj) => nameOfId(ref.__id__)),
        ['Score1', 'Score2', 'Score3', 'Score4']);
});

test('★★★旧的三个两方版实例必须已删除（LeftPlayer / RightPlayer / GameVS）', () => {
    // 留着会让"两方"和"多席位"两套同时渲染 —— 而且它们的节点尺寸是随手给的，
    // 会以奇怪的位置出现在新顶栏上。
    for (const name of ['LeftPlayer', 'RightPlayer', 'GameVS']) {
        assert.equal(
            nodes.some((n) => n._name === name), false,
            `★旧的 ${name} 还在 prefab 里（多队伍改造应删除）`,
        );
    }
});

test('all scores default to 94 by 66 and use a centered layout', () => {
    const layout = nodeNamed('ScoreLayout');
    assert.ok(layout);
    const widget = compsOf(layout!).find((component: TObj) => component.__type__ === 'cc.Widget');
    assert.ok(widget && (widget._alignFlags & 16));
    for (const name of ['Score1', 'Score2', 'Score3', 'Score4']) {
        const size = uiOf(nodeNamed(name)!);
        assert.deepEqual([size._contentSize.width, size._contentSize.height], [94, 66]);
    }
});

test('score sprite sits on Score and child renderers remain bound', () => {
    for (const name of ['Score1', 'Score2', 'Score3', 'Score4']) {
        const node = nodeNamed(name)!;
        const slot = compsOf(node).find((component: TObj) => component.__type__ === SCORE_CID);
        assert.ok(slot);
        for (const [field, expected] of [['background', name], ['value', 'Value'], ['cross', 'Cross']]) {
            const component = raw[slot[field].__id__] as TObj;
            assert.equal(nameOfId(component.node.__id__), expected);
        }
        //  每个 Score 节点自己必须带 UITransform：render 里直接从 node 上取。
        //  (原先是引用一个必填的 `ownRect` @property，2026-10-13 删掉——
        //   它在 prefab 里从未绑定，取值即 null，render 直接崩在 `ownRect.width`。)
        assert.ok(compsOf(node).some((component: TObj) => component.__type__ === 'cc.UITransform'),
            `${name} 必须自带 UITransform`);
    }
});

test('★★★红 X 默认必须是关的（否则每格天生带个 X）', () => {
    for (const name of ['Score1', 'Score2', 'Score3', 'Score4']) {
        const slot = compsOf(nodeNamed(name)!).find((c) => c.__type__ === SCORE_CID) as TObj;
        const cross = raw[(slot.cross as TObj).__id__] as TObj;
        assert.equal(cross._enabled, false, `★${name} 的红 X 默认应关闭（等 render 按地块数=0 打开）`);
    }
});

test('HUD feeds scores by seat and refreshes the layout', () => {
    const src = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    assert.ok(src.includes('counts.push(owner ? model.territoryCountOf(owner) : 0)'));
    assert.ok(src.includes('slot.render({ value: count, finished: count <= 0, leading: i === leadIndex })'));
    assert.ok(src.includes('if (layoutDirty) this.scoreLayout.updateLayout()'));
});

test('★★★ScoreSlot 组件里数字与红 X 必须互斥（漏一个就叠字）', () => {
    const src = readFileSync('assets/script/app/zcds/view/ZCGameHudScoreSlot.ts', 'utf8');
    assert.match(src, /this\.value\.enabled\s*=\s*!data\.finished/, '★value.enabled 必须取反');
    assert.match(src, /this\.cross\.enabled\s*=\s*data\.finished/, '★cross.enabled 必须同步');
});

test('unique leader receives the larger size', () => {
    const src = readFileSync('assets/script/app/zcds/view/ZCGameHudScoreSlot.ts', 'utf8');
    for (const size of ['SCORE_LEAD_WIDTH = 110', 'SCORE_LEAD_HEIGHT = 77',
        'SCORE_NORMAL_WIDTH = 94', 'SCORE_NORMAL_HEIGHT = 66']) assert.ok(src.includes(size));
    assert.ok(!src.includes('shiftX'));
});

test('each Score has one renderer and separate Value and Cross children', () => {
    const renderable = ['cc.Sprite', 'cc.Label', 'cc.Graphics', 'cc.RichText'];
    for (const name of ['Score1', 'Score2', 'Score3', 'Score4']) {
        const node = nodeNamed(name)!;
        assert.deepEqual(compsOf(node).filter((component: TObj) => renderable.includes(component.__type__))
            .map((component: TObj) => component.__type__), ['cc.Sprite']);
        assert.deepEqual(node._children.map((ref: TObj) => nameOfId(ref.__id__)), ['Value', 'Cross']);
    }
});

const ROW_PREFAB = 'assets/resources/ui/game/ZCGameHudPlayerRow.prefab';

test('★★★左侧 PlayerList 必须是纵向虚拟列表（Mask + VSV + content），几何按设计稿', () => {
    // 设计稿左侧组 x8 y159 308×350。换成虚拟列表后锚点改(0.5,1)：顶边保持不变
    // （旧中心 y=306 ⇒顶边 481），否则整列会往下掉半屏。
    //
    // ⚠️ 高度 350 → **360**（2026-10-10 用户要求「PlayerList 不滑动」）：
    //   行高 88 × 4 人 = 352 > 350 ⇒ VSV 的可滚范围 `max(0, 内容−视口)` = 2 ⇒ 能滑 2px。
    //   视口放到 360 就装得下 4 行，引擎自己把可滚范围锁成 0。
    //   只改**高度**：`anchor y=1` + `top=159` ⇒ 顶边固定、只向下延伸，不动 `_lpos`。
    const list = nodeNamed('PlayerList');
    assert.ok(list, '★找不到 PlayerList');
    const lui = uiOf(list!);
    assert.deepEqual(
        {
            w: lui._contentSize.width, h: lui._contentSize.height,
            ax: lui._anchorPoint.x, ay: lui._anchorPoint.y,
            x: list!._lpos.x, y: list!._lpos.y,
        },
        { w: 308, h: 360, ax: 0.5, ay: 1, x: -198, y: 481 },
        '★PlayerList 应为 308×360、anchor(0.5,1)、pos(-198,481)（宽度与位置仍按设计稿，高度为装下 4 行上调）',
    );
    const comps = compsOf(list!);
    assert.ok(comps.some((c) => c.__type__ === 'cc.Mask'), '★虚拟列表要有 Mask 做裁切');
    const vsv = comps.find((c) => c.useVirtualList !== undefined);
    assert.ok(vsv, '★PlayerList 必须挂 VirtualScrollView');
    assert.equal(vsv!.useVirtualList, true, '★必须是虚拟列表模式');
    assert.equal(vsv!.direction, 0, '★ScrollDirection.VERTICAL = 0（写反会横排）');
    assert.equal(vsv!.gridCount, 1, '★单列（>1 会把行横排）');
    assert.equal(vsv!.spacing, 0, '★行间距 0：条目本身 88 高就是行距（设计稿行距由条目高决定）');
    // ★ 2026-10-09：**不管几个玩家都要从上往下**。
    //   `autoCenter = true` 时，只要「内容高 < 视口高」（2~3 人局必然如此）引擎就会
    //   把整列往下推 `(视口高 − 内容高) / 2` —— 表现就是"两个玩家居中"。必须是 false。
    assert.equal(vsv!.autoCenter, false,
        '★autoCenter 必须 false（true ⇒ 2 人局内容矮于视口时整列垂直居中，不是从上往下）');
    const content = raw[((list!._children as TObj[])[0]).__id__] as TObj;
    const cui = uiOf(content);
    assert.deepEqual(
        { ax: cui._anchorPoint.x, ay: cui._anchorPoint.y, x: content._lpos.x, y: content._lpos.y },
        { ax: 0.5, ay: 1, x: 0, y: 0 },
        '★content 必须与视窗同锚点 (0.5,1)、lpos(0,0)：引擎直接拿 content.y 当滚动偏移、不补偿锚点差',
    );
    const rowUuid = (JSON.parse(readFileSync(ROW_PREFAB + '.meta', 'utf8')) as TObj).uuid;
    assert.equal(
        vsv!.itemPrefab && vsv!.itemPrefab.__uuid__, rowUuid,
        '★itemPrefab 必须指向 ZCGameHudPlayerRow.prefab',
    );
    assert.deepEqual(
        (list!._children as TObj[]).map((c) => nameOfId(c.__id__)), ['content'],
        '★PlayerList 下应只有 content（行由列表实例化）',
    );
    for (let i = 1; i <= 4; i++) {
        assert.equal(nodeNamed(`Row${i}`), undefined, `★静态 Row${i} 必须已删除（改虚拟列表后不再需要）`);
    }
});

test('★★左侧玩家列表不可滑动：视口必须装得下 4 行', () => {
    // 2026-10-10 用户要求「PlayerList 不滑动」。
    //
    // 根因：`VirtualScrollView` 的可滚范围 = `max(0, 内容高 − 视口高)`
    //（`VScrollView.start()` / `updateContentSize()` 里都是这个式子）。
    // 行高 88、视口 350 ⇒ 4 人局内容 352 > 350 ⇒ `_boundsMax = 2`
    // ⇒ 能「滑 2px」—— 表现是列表能微微挪动、按住时整列会抖一下。
    //
    // ⚠️ 本式子只保证「内容 ≤ 视口」时**完全锁死**，所以解法是把视口调到 ≥ 4 行。
    // 不去动 `_boundsMax` / `disableBounce`：那是引擎通用逻辑，改它会牵连所有用 VSV 的页面
    // （卡池 / 阵容 / 详情…）。改动应局限在本列表的视口尺寸。
    const list = nodeNamed('PlayerList')!;
    const viewportHeight = uiOf(list)._contentSize.height;
    const row = JSON.parse(readFileSync(ROW_PREFAB, 'utf8')) as TObj[];
    const rowRoot = row.find((o) => o && o.__type__ === 'cc.Node')!;
    // ⚠️ `uiOf` 闭包捕获的是 HUD 的 `raw`，**不能**拿它去读另一个 prefab（会取到undefined）。
    const rowHeight = (rowRoot._components as TObj[])
        .map((c: TObj) => row[c.__id__])
        .find((c: TObj) => c && c.__type__ === 'cc.UITransform')!._contentSize.height;
    const MAX_SEATS = 4;
    assert.ok(
        viewportHeight >= rowHeight * MAX_SEATS,
        `★视口高 ${viewportHeight} 必须 ≥ 4 行合计 ${rowHeight * MAX_SEATS}，`
        + '否则 4 人局仍能滑「内容高 − 视口高」那么多',
    );
    // 反向断言：装得下时引擎自己就把可滚范围锁成 0，滚动/惯性都无从产生。
    // 这行也钉住「别用把视口改小来规避」。
    assert.ok(viewportHeight >= rowHeight * 2,
        '★视口至少要装下 2 人局，否则少数派也被迫滚动');
});

test('★★★PlayerList 必须关掉触摸接管（否则挡住下方翻地块）', () => {
    // 2026-10-12 用户报「PlayerList 挡住下方翻地块」。**与「能不能滑」正交**，别混：
    //
    // · 滑不滑 = `bounds`，由上一条用例（视口 360 ≥ 4 行 352）解决；
    // · 挡不挡 = 有没有节点注册 `TOUCH_*` 进引擎命中链。**锁死 bounds 完全不影响命中测试**。
    //
    // 根因链：`PlayerList` 在 `ZCGameHUD` 子节点里排在 `MapScrollView` **之后**
    // ⇒ 命中测试逆序优先测它；`VScrollView._bindTouch()` 给容器注册 4 个 `TOUCH_*`、
    // `VScrollViewItem.onLoad()` 又给每个行根注册 4 个 ⇒ 事件被吞。
    // 而地图拖动绑在**兄弟**节点 `mapViewport` 上（`capture=true` 也只沿祖先链走）⇒ 收不到。
    // 实测（`tmp/_hud_playerlist_block_probe.mjs`）：列表区拖动 mapLayer 位移恒为 (0,0)。
    //
    // 解法 = `VirtualScrollView.interactive = false`：容器与行一个 `TOUCH_*` 都不绑，触摸穿透。
    const list = nodeNamed('PlayerList')!;
    const vsv = compsOf(list).find((c) => c.useVirtualList !== undefined)!;
    assert.equal(vsv!.interactive, false,
        '★PlayerList 必须 interactive=false（它不滚、也没有点击回调，留着只会吞掉棋盘拖动）');
});

test('★★★VScrollView 的 interactive 开关必须真能关掉全部 TOUCH_*（源码形状断言）', () => {
    // 只断言 prefab 上的字段不够：`interactive` 写对了、但代码里三处 early return 漏一处，
    // 运行时照样会绑上。`_updateItemClickHandler` 那处尤其容易漏 ——
    // 它是**运行时 addComponent(VScrollViewItem)**，而 `VScrollViewItem.onLoad()`
    // 又会给行根绑 4 个 ⇒ 只关容器那层的话，**行区域照样吞触摸**（治了容器没治行）。
    const src = readFileSync('assets/script/vscrollview/VScrollView.ts', 'utf8');
    assert.match(src, /public interactive: boolean = true;/,
        '★interactive 必须是 @property 且默认 true（默认接管，别牵连所有现有页面）');
    // 三处：容器绑定 / 全局触摸 / 行点击组件
    const guards = src.match(/if \(!this\.interactive\) return;/g) ?? [];
    assert.ok(guards.length >= 3,
        `★必须有三处 \`if (!this.interactive) return;\`（_bindTouch / _bindGlobalTouch / _updateItemClickHandler），`
        + `实际只有 ${guards.length} 处 —— 漏了 _updateItemClickHandler 则行区域仍吞触摸`);
});

test('★★★条目预制体：13 个引用全绑、Info 是横排 Layout、样式与设计稿一致', () => {
    // 条目预制体是虚拟列表的 itemPrefab。结构 / 样式 / 引用错一个都是静默的
    // （空行、没名字、没颜色），所以这里逐项钉住。
    const item = JSON.parse(readFileSync(ROW_PREFAB, 'utf8')) as TObj[];
    const itemNode = (n: string) => item.find((o) => o && o.__type__ === 'cc.Node' && o._name === n) as TObj | undefined;
    const itemName = (id: number) => (item[id] as TObj | undefined)?._name;
    const itemComps = (n: TObj) => (n._components ?? []).map((c: TObj) => item[c.__id__]).filter(Boolean) as TObj[];
    const itemUi = (n: string) => itemComps(itemNode(n)!).find((c) => c.__type__ === 'cc.UITransform')!;

    assert.deepEqual(
        [itemUi('ZCGameHudPlayerRow')._contentSize.width, itemUi('ZCGameHudPlayerRow')._contentSize.height],
        [308, 88], '★条目尺寸必须 308×88（虚拟列表的条目高从这里取）',
    );
    // 我方那一档：圆盘 88 + 头像 74（其余席位由条目脚本按 owner 换成 77 / 66）
    assert.deepEqual([itemUi('HeadFrame')._contentSize.width, itemUi('HeadFrame')._contentSize.height], [88, 88]);
    assert.deepEqual([itemUi('HeadIcon')._contentSize.width, itemUi('HeadIcon')._contentSize.height], [74, 74]);
    assert.deepEqual([itemUi('NameText')._contentSize.width, itemUi('NameText')._contentSize.height], [159, 22]);

    // 兵力 + buff 收在 Info 的横排 Layout 下。
    // ⚠️ 2026-10-09 按**蓝湖设计稿实测**重定：工程此前把整组摆在行中心下方 46px（**挂到行框外面**，
    //    视觉上贴着下一行），实测设计稿是「名字在上半、兵力行在下半、整组在圆盘竖向范围之内」。
    //    下面每个数都是从设计稿裁切图量的（画布坐标 = 裁切图 y + 140）：
    //      圆盘 y22..109(88) 中心 65.5；名字 ink y39..60；盾牌 ink x104..152 y~58..108；
    //      数字 ink x140..222 y80..100；buff1 绿 x233..262；buff2 描边 x274..315(42×42)
    //    ⇒ 行局部（原点=行中心）：盾牌 (-38.5,-16) / 数字 (+26.5,-23) / buff (+85.5,-20.5,+127.5,-21.5)
    const info = itemNode('Info')!;
    const layout = itemComps(info).find((c) => c.__type__ === 'cc.Layout');
    assert.ok(layout, '★Info 必须挂 cc.Layout');
    assert.equal(layout!._layoutType, 1, '★Layout 必须横向（HORIZONTAL=1）');
    assert.equal(layout!._spacingX, 0, '★间距 0：设计稿里盾牌/数字/buff 是紧挨着的（48+83+42+42=215 ≈ 整组 214）');
    assert.equal(layout!._resizeMode, 0, '★resizeMode=NONE：容器尺寸由设计稿定，别让引擎改子节点尺寸');
    const infoUi = itemUi('Info');
    assert.deepEqual(
        { x: info._lpos.x, y: info._lpos.y, ax: infoUi._anchorPoint.x },
        { x: -62, y: -20, ax: 0 },
        '★Info 的位置 (-62,-20) 是从设计稿量的：x=-62 让盾牌落在 -60、整组右缘 152 收在行内 154 内；' +
        'y=-20 把整组从"行框外"挪回"圆盘竖向范围内"（原来 -23 会让子节点落到行中心下方 46）',
    );
    assert.deepEqual(
        (info._children as TObj[]).map((c) => itemName(c.__id__)),
        ['UnitIcon', 'UnitText', 'Buff1', 'Buff2'],
        '★Info 子序 = 兵力图标 → 兵力文字 → buff1 → buff2（子序即 Layout 的排列顺序）',
    );
    // 四个子元素都必须在 Info 的**横轴中线**上（Layout 横排的 cross 轴不参与排布，
    // 子节点保留自己的 lpos.y ⇒ 每个都要显式写 0，否则会各自偏一段）
    for (const n of ['UnitIcon', 'UnitText', 'Buff1', 'Buff2']) {
        assert.equal(itemNode(n)!._lpos.y, 0, `★Info/${n} 的 lpos.y 必须 0（横排 Layout 不动 cross 轴）`);
    }
    // 兵力图标跟贴图走：`zd_icon_shibing` 是 32×34 的图，Sprite 是 `sizeMode=TRIMMED`
    // ⇒ 节点尺寸就是该图的裁剪矩形（引擎在赋帧时回写 contentSize，写多大都会被覆盖成 32×34）。
    assert.deepEqual([itemUi('UnitIcon')._contentSize.width, itemUi('UnitIcon')._contentSize.height], [32, 34],
        '★兵力图标 32×34（= zd_icon_shibing 原生尺寸；Sprite 为 TRIMMED，节点尺寸由贴图决定）');
    assert.deepEqual([itemUi('Buff1')._contentSize.width, itemUi('Buff1')._contentSize.height], [42, 42],
        '★buff 42×42（与 buff_01/buff_02 原生尺寸、以及设计稿量到的 42 一致）');
    const unitLabel = itemComps(itemNode('UnitText')!).find((c) => c.__type__ === 'cc.Label')!;
    assert.equal(unitLabel._fontSize, 24.5, '★兵力字号 24.5（设计稿数字 ink 高 20 ≈ 与名字同档）');
    assert.equal(unitLabel._enableOutline, true, '★兵力文字必须有描边（设计稿是白字+黑描边，否则压在浅色地块上看不清）');
    assert.equal(unitLabel._outlineWidth, 4, '★描边宽 4');
    assert.equal(unitLabel._overflow, 2, '★SHRINK：固定宽度内缩字号不折行');
    // ⚠️ 这四个 x 是**序列化残留**，运行时横向 Layout 会按 `spacingX=0` 重算 ⇒ 只钉「在一个横排里依次递增」，
    //    不把具体数值当契约（2026-10-10 按现状更新）。
    const childXs = (['UnitIcon', 'UnitText', 'Buff1', 'Buff2'] as const).map((n) => itemNode(n)!._lpos.x);
    for (let i = 1; i < childXs.length; i++) {
        assert.ok(childXs[i] > childXs[i - 1], `★Info 子节点必须按 x 递增排（实际 ${childXs.join(',')}）`);
    }

    // 13 个引用：9 个组件引用 + 4 张圆盘帧
    const sc = item.find((o) => o && typeof o.__type__ === 'string' && (o as TObj).__type__.length === 23) as TObj;
    assert.ok(sc, '★条目预制体里找不到行脚本');
    for (const key of ['headFrame', 'discRect', 'headIcon', 'headRect', 'nameText', 'unitIcon', 'unitText', 'buffA', 'buffB']) {
        assert.ok(sc[key] && sc[key].__id__ != null, `★${key} 未绑定`);
    }
    for (const key of ['disc01', 'disc02', 'disc03', 'disc04']) {
        assert.ok(sc[key] && typeof sc[key].__uuid__ === 'string', `★${key} 未绑定（缺了会换成空圆盘）`);
    }

    // 名字样式：字号 / 左对齐 / 不换行；**占位文字必须空**
    // （虚拟列表在 `render` 之前就实例化条目，占位会漏出首帧）
    const nameLabel = itemComps(itemNode('NameText')!).find((c) => c.__type__ === 'cc.Label')!;
    assert.equal(nameLabel._fontSize, 24.5, '★名字字号 24.5');
    assert.equal(nameLabel._horizontalAlign, 0, '★名字左对齐');
    assert.equal(nameLabel._enableWrapText, false, '★名字不换行');
    assert.equal(nameLabel._string, '', '★名字占位必须空');
    assert.equal(nameLabel._overflow, 2, '★SHRINK：超长名字缩字号，不折行也不丢字');

    // 卫生：layer 全 UI_2D（DEFAULT 层的子节点不渲染）+ 一个节点只能有一个渲染组件
    const REND = ['cc.Sprite', 'cc.Label', 'cc.Graphics'];
    for (const n of item.filter((o) => o && o.__type__ === 'cc.Node') as TObj[]) {
        assert.equal(n._layer, 33554432, `★${n._name} 的 layer 必须 UI_2D`);
        const rend = itemComps(n).filter((c) => REND.includes(c.__type__));
        assert.ok(rend.length <= 1, `★${n._name} 挂了 ${rend.length} 个渲染组件`);
    }
});

test('★★★所有 Sprite 的 _spriteFrame 必须是 null 或合法 uuid 引用（空对象 {} 会炸渲染）', () => {
    // 实测踩过：生成脚本写出 `"_spriteFrame": {}` —— 既不是 null 也不是 SpriteFrame。
    // 引擎 `_calculateUV` 读 `uv[0]` 报 `Cannot read properties of undefined (reading '0')`，
    // 切帧时 `_applySpriteFrame` 又报 `this._spriteFrame.off is not a function`。
    // 画面表现极具误导性（像"美术没加载"），零脚本异常 ⇒ 必须用断言钉住。
    const bad: string[] = [];
    raw.forEach((o, i) => {
        if (!o || (o as TObj).__type__ !== 'cc.Sprite') return;
        const sf = (o as TObj)._spriteFrame as TObj | null | undefined;
        if (sf === null) return;
        if (sf && typeof sf === 'object' && typeof (sf as TObj).__uuid__ === 'string') return;
        const holder = nameOfId(((o as TObj).node as TObj).__id__);
        bad.push(`#${i} ${holder} -> ${JSON.stringify(sf)}`);
    });
    assert.deepEqual(bad, [], `★非法的 spriteFrame（只允许 null 或带 __uuid__ 的对象）：${bad.join(' / ')}`);
});

test('★★★leftPanel 必须挪到右上（Widget TOP|RIGHT + 摘掉 Layout）', () => {
    // 设计稿 zd_di_02 x632 y163 72×226 ⇒ 局部 (+308,+364)；Widget 自己算位置：
    //   y = 640 − top − h/2 ⇒ top = 163 ；x = 360 − right − w/2 ⇒ right = 16
    const lp = nodeNamed('leftPanel');
    assert.ok(lp, '找不到 leftPanel');
    const ui = uiOf(lp!);
    // 2026-10-09：`RunAwayBtn` 从顶栏挪进本面板 ⇒ 3 按钮 → 4 按钮，
    // 面板由 zd_di_02 的 226 向下延伸 72（四个按钮沿 y 等距 72）。
    assert.deepEqual(
        { w: ui._contentSize.width, h: ui._contentSize.height },
        { w: 72, h: 298 }, '★leftPanel 应为 72×298（226 + 一个按钮的间隔 72）',
    );
    const w = compsOf(lp!).find((c) => c.__type__ === 'cc.Widget');
    assert.ok(w, 'leftPanel 缺 cc.Widget');
    assert.equal((w as TObj)._alignFlags, 33, '★Widget 应为 TOP|RIGHT（1|32=33）');
    assert.equal((w as TObj)._top, 163, '★Widget.top 应为 163（面板顶边贴设计稿 y163）');
    assert.equal((w as TObj)._right, 16, '★Widget.right 应为 16');
    // Layout 会按自己的 cellSize/spacing 重排按钮，和「沿 y 等距 72」这套手摆几何冲突 ⇒ 必须摘掉
    assert.equal(
        compsOf(lp!).some((c) => c.__type__ === 'cc.Layout'), false,
        '★leftPanel 必须摘掉 cc.Layout（否则它会把按钮重排回旧位置）',
    );
    // 四个按钮沿 y 等距 72、尺寸**各自跟贴图走**（四个 Sprite 都是 `sizeMode=TRIMMED`，
    // 节点尺寸 = 该图自己的裁剪矩形：排行 40×43 / 指南 45×46 / 伤害 40×47 / 逃跑 36×37），
    // 所以这里钉的是「每张图的实际落值」，不是统一的 50×50。
    const BTN = [
        { name: 'RankBtn', x: 1, y: 108, w: 40, h: 43 },
        { name: 'ZhiNanBtn', x: 2, y: 36, w: 45, h: 46 },
        { name: 'HurtBtn', x: 0, y: -36, w: 40, h: 47 },
        { name: 'RunAwayBtn', x: 0, y: -108, w: 36, h: 37 },
    ];
    for (const b of BTN) {
        const n = nodeNamed(b.name)!;
        const bui = uiOf(n);
        assert.deepEqual(
            { w: bui._contentSize.width, h: bui._contentSize.height, x: n._lpos.x, y: n._lpos.y },
            { w: b.w, h: b.h, x: b.x, y: b.y },
            `★${b.name} 应为 ${b.w}×${b.h} @ (${b.x},${b.y})`,
        );
    }
});

test('★★★RunAwayBtn 必须还在（挪进右侧按钮面板），不能丢', () => {
    // 设计稿的三按钮里没有「逃跑」，但对局里必须有退出入口 ——
    // 2026-10-09 用户要求把它**挪进右侧面板**（leftPanel）与排行/指南/伤害统计并排，
    // 而不是删掉；面板因此从 226 加高到 298。
    const ra = nodeNamed('RunAwayBtn');
    assert.ok(ra, '★RunAwayBtn 不见了（设计稿没画它，但不该删）');
    const parent = raw[(ra!._parent as TObj).__id__] as TObj;
    assert.equal(parent._name, 'leftPanel', '★RunAwayBtn 应挪到 leftPanel 下（右侧按钮面板）');
    assert.ok(
        compsOf(ra!).some((c) => c.__type__ === 'cc.Button'),
        '★RunAwayBtn 必须还挂着 cc.Button',
    );
});

test('★★★视图脚本必须真的驱动玩家列表（虚拟列表；漏了 = 左侧永远空白）', () => {
    const src = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    assert.match(src, /playerList: VirtualScrollView/, '★playerList 必须是 VirtualScrollView');
    assert.match(src, /renderItemFn = this\.fillPlayerRow/, '★必须绑 renderItemFn（条目填充入口）');
    assert.match(src, /setTotalCount\(/, '★必须 setTotalCount（条数由席位决定）');
    assert.match(src, /getItemByIndex\(/, '★必须按条目取节点来填（否则只造节点不填内容）');
    assert.match(src, /getComponent\(ZCGameHudPlayerRow\)/, '★条目上按索引拿行组件');
    assert.doesNotMatch(src, /playerRow\d/, '★四个静态行引用应已移除（改虚拟列表后不再需要）');
    assert.match(src, /setSeatProfiles\(/, '★必须有 setSeatProfiles（席位档案入口）');
    assert.match(src, /loadHeadFrame\(/, '★头像必须走 loadHeadFrame（不能拿角色 id 直接找图）');
    assert.match(src, /paintPlayerRows\(/, '★render 里必须调 paintPlayerRows');
    // 2026-10-09 用户要求「所有玩家兵力数量都要显示」⇒ 取消「只有第 1 行」的限制，
    // 四行都填 `活口/上限`（设计稿只画了第 1 行的 `14/100`，这是超出设计稿的明确要求）。
    assert.doesNotMatch(src, /if \(index !== 0\) return null;/, '★兵力不再只限第 1 行（四行都要显示）');
    assert.match(src, /this\.paintPlayerRows\(model\.owners, \(owner\) =>/,
        '★兵力取值函数要对每个席位都给值（不能再按 index 过滤）');
    assert.match(src, /return `\$\{alive\}\/\$\{model\.unitCap\}`;/, '★四行都要填 `活口/上限`');
    // ★ 选点阶段（自选主城）`ZCGame.update` 提前 return、`model` 都没建 ⇒ `render` 不会跑，
    //   列表只能靠 `setSeatProfiles` 当场刷出来，否则左侧只有「圆盘 + 空名字」。
    //   ⚠️ 正则必须**钉住紧跟 owners 的那一次调用** —— 异步头像到货那里也有一句
    //   `paintPlayerRows(owners)`，松散的 `[\s\S]*?` 会被它蒙过去（自证时踩过）。
    // ⚠️ owners 的取值写法**不可钉死**：release 构建会把 `[...map.keys()]` 降级成
    //   `[].concat(map)`（concat 不展开迭代器）⇒ owners 变成 [Map]，左侧席位行静默空白。
    //   所以源码必须写 `Array.from(...)`。这里只钉「取完 owners 立刻刷列表」这个行为。
    assert.match(src, /const owners = Array\.from\(profiles\.keys\(\)\);\s*this\.paintPlayerRows\(owners\);/,
        '★setSeatProfiles 必须当场刷列表（选点阶段不能只存不画）');
    assert.doesNotMatch(src, /\[\.\.\.profiles\.keys\(\)\]/,
        '★profiles 是 Map，展开会被构建降级成 concat（席位行静默空白），必须用 Array.from');
    // 旧的两方入口必须已移除
    assert.doesNotMatch(src, /setPlayers\(/, '★旧的 setPlayers 应已移除');
    assert.doesNotMatch(src, /ZCHudPlayerProfile/, '★旧的 ZCHudPlayerProfile 应已移除');
});

test('★★★SPRITE 过渡的按钮，四个过渡态贴图必须与同节点 Sprite 的图一致', () => {
    // 实测踩过（2026-10-09）：给左侧三按钮换图标时只改了 Sprite 的 `_spriteFrame`、
    // 没改 `cc.Button` 的 `_normalSprite` 等四个过渡态。而这些按钮是
    // **`transition = SPRITE(2)` 且 `_target` = 自身** ⇒ 引擎在 `__preload` 会把 Sprite 的图
    // **覆写回旧图**：新图标永远不显示、**零报错**，看起来像"换了图没生效"。
    // 连带后果：旧图被"假引用"着，资源审计会把它们误判成"仍在使用"。
    const artName = new Map<string, string>();
    for (const f of readdirSync('assets/resources/image/gameui')) {
        if (!f.endsWith('.png.meta')) continue;
        const meta = JSON.parse(readFileSync(`assets/resources/image/gameui/${f}`, 'utf8')) as TObj;
        artName.set(meta.uuid, f.replace('.png.meta', ''));
    }
    const nameOf = (ref: TObj | null | undefined) => {
        if (!ref || !ref.__uuid__) return 'null';
        return artName.get(String(ref.__uuid__).replace('@f9941', '')) ?? String(ref.__uuid__).slice(0, 8);
    };
    const bad: string[] = [];
    for (const o of raw) {
        if (!o || o.__type__ !== 'cc.Button') continue;
        const host = raw[o.node.__id__] as TObj;
        if (o._transition !== 2) continue;                       // 只有 SPRITE 过渡才覆写贴图
        const sprite = compsOf(host).find((c) => c.__type__ === 'cc.Sprite');
        assert.ok(sprite, `★${host._name} 是 SPRITE 过渡但没有 cc.Sprite，覆写目标不存在`);
        const shown = nameOf(sprite._spriteFrame as TObj);
        for (const key of ['_normalSprite', '_hoverSprite', '_pressedSprite', '_disabledSprite']) {
            const state = nameOf(o[key] as TObj);
            if (state !== shown) bad.push(`${host._name}.${key}=${state}（Sprite 显示 ${shown}）`);
        }
    }
    assert.deepEqual(bad, [], `★这些按钮运行时会被覆写成别的图：${bad.join(' / ')}`);
});

test('★★★根 PrefabInfo 上不许留悬空的 targetOverrides（删嵌套实例时必须一起清）', () => {
    // 实测踩过（2026-10-09）：删掉 HUD 里三个两方实例后，根上的
    // `targetOverrides` 还留着 3 条 —— `propertyPath` 指向的字段在组件上已不存在、`target` 为 null。
    // 它们**不报错也不影响运行**，但会让「还有没有嵌套实例」这件事彻底看不出来。
    const rootInfo = raw[raw[1]._prefab.__id__] as TObj;
    const list = (rootInfo.targetOverrides ?? []) as TObj[];
    assert.equal(
        list.length, 0,
        `★根 PrefabInfo 残留 ${list.length} 条 targetOverrides（应随实例一起清空）`,
    );
});

test('renderItemFn 绑了 this：普通方法赋值时必须 .bind，箭头函数天然安全', () => {
    //  2026-10-13：`VScrollView` 三处都是 `this.renderItemFn(node, i)` 的**方法调用**语法，
    //  函数体内的 `this` 因此被绑成 VScrollView。HUDView 的 `fillPlayerRow` 是普通方法，
    //  直接赋过去 ⇒ `this.rowOwners` 读到 undefined，虚拟列表建槽时崩在 `rowOwners[index]`。
    //  其余页面（GMPanel / ZCGameRankBoard / OSRank* / LineupBoardPage）都是
    //  `private readonly _renderRow = (...) => {}` **箭头函数**，`this` 取定义作用域，不需要 bind。
    const source = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    assert.ok(
        source.includes('this.playerList.renderItemFn = this.fillPlayerRow.bind(this)'),
        'fillPlayerRow 是普通方法，赋给 renderItemFn 必须 .bind(this)',
    );
    //  防回归：若有人把 fillPlayerRow 改成箭头函数，bind 就多余且会掩盖问题。
    assert.ok(
        /private\s+fillPlayerRow\s*\(/.test(source),
        'fillPlayerRow 应保持普通方法（箭头函数会让人误以为不需要 bind）',
    );
});
