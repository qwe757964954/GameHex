/**
 * 对局内排行榜的**接线护栏**（`ZCGame` / `ProcedureGame` / 两个 prefab）。
 *
 * ⚠️ 本文件**不能** import `ZCGame` / `TerritoryPage` 那些 cc 依赖模块（Node 里 import 就炸），
 * 所以按工程既有做法读源码文本断言。同族见 `territory-cell-protocol.test.ts`。
 *
 * 为什么需要它：这三个"漏接"都是**零报错**的 ——
 * 方法定义了没人调 / 传了没人接 / prefab 建了没绑引用，在运行时表现完全一样：
 * **点了没反应**。静态断言是唯一能在 Node 里钉住它们的手段。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const GAME_SRC = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const PROC_SRC = readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8');
const HUD_SRC = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');

test('★★RankBtn 必须真的调 openRankBoard（漏传 actions.openRank = 点了没反应）', () => {
    // 实测踩过：`ZCHudActions.openRank` 与 `bind(this.rankButton, …)` 早就存在，
    // 但 `hudView.initialize({...})` 里**没给 openRank** ⇒ 按钮零反应、无报错。
    assert.ok(
        /openRank:\s*\(\)\s*=>\s*this\.openRankBoard\(\)/.test(GAME_SRC),
        '★ZCGame 传给 hudView.initialize 的 actions 里必须有 openRank ⇒ 否则 RankBtn 点了没反应',
    );
    assert.ok(
        /private openRankBoard\(\)/.test(GAME_SRC),
        'openRankBoard 方法不该被删 —— 它是排行榜的入口',
    );
    // HUD 侧：接口 + 绑定也都要在（三处任缺其一都静默失效）。
    assert.ok(/openRank\?:/  .test(HUD_SRC), 'ZCHudActions 要声明 openRank');
    // 绑定写法是具名方法 + target（规范 §7.5 配套第 3 条）：不内联箭头、不抽 `const bind` 辅助。
    assert.ok(
        /rankButton\.node\.on\(Button\.EventType\.CLICK,\s*this\.onRankClick,\s*this\)/.test(HUD_SRC),
        '★rankButton 必须绑到 onRankClick —— 声明了不绑等于没这按钮',
    );
    assert.ok(
        /private onRankClick\(\): void \{\s*this\.actions\?\.openRank\?\.\(\);/.test(HUD_SRC),
        '★onRankClick 必须调 actions.openRank —— 只绑不调等于按钮永远点不动',
    );
});

test('★★席位档案必须随单局 entry 交接（缺失 = 排行榜全是兜底名「我方/敌方」）', () => {
    assert.ok(
        /seatProfiles\s*=\s*Array\.from\(buildSeatProfiles\(battle\.units/.test(PROC_SRC),
        '★ProcedureGame 必须用 buildSeatProfiles 组装 entry —— 否则 seatProfiles 是空表，'
        + '3~4 人局在排行榜里全是兜底名',
    );
    assert.ok(
        /buildSeatProfiles\(battle\.units/.test(PROC_SRC),
        'entry.seatProfiles 必须来自 buildSeatProfiles(battle.units, …) —— '
        + '别手搓 Map，那会重犯「只取 sorted[0]/[1] 丢掉 enemy2/enemy3」的错',
    );
    // 消费侧：单局 entry 作为 initialize 参数进入组件，并复制席位表供排行榜读取。
    assert.ok(
        /this\.seatProfiles\s*=\s*new Map\(entry\.seatProfiles\)/.test(GAME_SRC),
        'ZCGame.initialize 必须从 entry 接收完整席位表',
    );
    assert.ok(/initialize\(entry: IZCGameEntry\)/.test(GAME_SRC), '对局组件必须提供显式的实例初始化入口');
});

test('★★排行榜数据源在 model 上有出口（territoryCount 私有着拿不到）', () => {
    // 2~4 席要逐个取数，`playerTerritoryCount` / `enemyTerritoryCount` 都不够
    //（后者在 3~4 人局是**合并**值）。
    assert.ok(
        /territoryCountOf\(owner:\s*ZCOwner\):\s*number/.test(
            readFileSync('assets/script/app/zcds/model/ZCGameModel.ts', 'utf8'),
        ),
        'ZCGameModel 要暴露 territoryCountOf(owner) —— 排行榜按席位取数用',
    );
    assert.ok(
        /territoryCountOf\(owner\)/.test(GAME_SRC),
        'openRankBoard 必须走 territoryCountOf(owner) 逐席取数，不能用合并值',
    );
});

test('★★两个 prefab 都在，且行 prefab 的 VSV itemPrefab 指向它', () => {
    const row = 'assets/resources/ui/game/ZCGameRankRow.prefab';
    const board = 'assets/resources/ui/game/ZCGameRankBoard.prefab';
    assert.ok(existsSync(row), '缺 ZCGameRankRow.prefab（虚拟列表的 itemPrefab 指向它）');
    assert.ok(existsSync(board), '缺 ZCGameRankBoard.prefab（弹窗本体）');

    const rowMeta = JSON.parse(readFileSync(`${row}.meta`, 'utf8')) as { uuid: string };
    const boardSrc = readFileSync(board, 'utf8');
    // itemPrefab 的 uuid 必须是行 prefab —— 绑错成别的 prefab 时列表会一片空白（零报错）。
    assert.ok(
        boardSrc.includes(rowMeta.uuid),
        `★Board.prefab 的 VirtualScrollView.itemPrefab 必须指向 ZCGameRankRow.prefab（uuid=${rowMeta.uuid}）`,
    );
    // ⚠️ 反向断言：设计稿**没有关闭按钮**，`closeBtn` 留空是对的；别为了"看起来完整"
    // 去绑一个不存在的节点。
    const boardTs = readFileSync('assets/script/app/zcds/view/ZCGameRankBoard.ts', 'utf8');
    assert.ok(
        /closeBtn\?:\s*this\.closeBtn\?\.on/.test(boardTs) || /this\.closeBtn\?\.on/.test(boardTs),
        'closeBtn 在 onInit 里要用可选链 —— 设计稿无关闭按钮时它是 null',
    );
});

test('★★closeBtn 的**声明**必须是 `Node | null`（`null!` 与可选链自相矛盾）', () => {
    // 规范 §7.5 配套第 3 条 + AGENTS.md 第 37 行：**必填**引用用 `null!`，
    // **真实可选**引用写 `T | null` 并在边界判一次。
    //
    // 本条钉的是「声明」而不是「用法」：原来 closeBtn 声明成 `Node = null!`（宣称必填），
    // 却在 onInit 里用 `?.` 判空 —— 两个声明互相打架，等于把「设计稿没有这个按钮」
    // 当成了资源错误。真按 `null!` 的语义去掉判空，就会在 onInit 当场崩
    // （prefab 里根本没有 CloseBtn 节点，实测该节点不存在）。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const sc = raw.find(
        (o): o is { __type__?: string; closeBtn?: unknown; list?: unknown } =>
            !!o && typeof o === 'object'
            && (o as { __type__?: string }).__type__ === 'f26e3u/dK9Ayp+tzx6MCUwH',
    );
    assert.ok(sc, '找不到 ZCGameRankBoard 脚本组件');
    // 前提自证：prefab 里确实没绑 closeBtn，且 prefab 里真的没有 CloseBtn 节点。
    // 哪天设计稿补了关闭按钮并绑上，下面两条就该反过来要求 `null!`。
    assert.equal(
        sc!.closeBtn, null,
        '★closeBtn 在 prefab 里应留空（设计稿无关闭按钮）；若已绑定，请把声明改成 `null!` 并去掉 `?.`',
    );
    assert.ok(
        !raw.some((o): boolean => !!o && typeof o === 'object'
            && (o as { __type__?: string }).__type__ === 'cc.Node'
            && (o as { _name?: string })._name === 'CloseBtn'),
        '★prefab 里不该有 CloseBtn 节点（设计稿没有）—— 有的话说明资源与「留空」口径打架了',
    );

    const boardTs = readFileSync('assets/script/app/zcds/view/ZCGameRankBoard.ts', 'utf8');
    assert.match(
        boardTs, /closeBtn:\s*Node\s*\|\s*null\s*=/,
        '★closeBtn 是真实可选引用，声明必须写 `Node | null = null`（不能用 `null!`）',
    );

    // 反过来：`list` 是**必填**且确实绑了（prefab → `List` 节点），
    // 所以它该是 `null!` 且**不该有判空** —— 两处引用两种写法，别写混。
    assert.ok(sc!.list, '★list 应在 prefab 上绑定（它是必填引用）');
    assert.match(boardTs, /list:\s*VirtualScrollView\s*=\s*null!/,
        '★list 是必填引用，声明必须是 `VirtualScrollView = null!`');
    assert.doesNotMatch(
        boardTs, /if\s*\(\s*this\.list\s*\)/,
        '★别对必填的 list 判空（无意义的重复判空，规范 §7.5 第 3 条）',
    );
    assert.doesNotMatch(
        boardTs, /!\s*list\s*\|\|/,
        '★`!list ||` 里对 list 的判空同样是重复判空（跨 await 只判 `list.node.isValid` 即可）',
    );
});

test('★★美术路径必须走 ArtPaths 拼 /spriteFrame（裸路径报的是「不是 404」的错误）', () => {
    const boardTs = readFileSync('assets/script/app/zcds/view/ZCGameRankBoard.ts', 'utf8');
    const artPaths = readFileSync('assets/script/app/ArtPaths.ts', 'utf8');
    assert.ok(
        /export const GAME_RANK_ART_ROOT = `\$\{ART_ROOT\}\/GameRank`/.test(artPaths),
        'ArtPaths 要导出 GAME_RANK_ART_ROOT（规则 137：image/** 是唯一入口）',
    );
    assert.ok(
        /spriteFramePath\(GAME_RANK_ART_ROOT,\s*name\)/.test(boardTs),
        '★加载切图必须用 spriteFramePath 拼 /spriteFrame —— 裸路径 load 报的 '
        + '`Bundle resources doesn\'t contain ...` 不是 404，极易误判成「美术没交图」（规则 142）',
    );
    assert.ok(
        /frame\.addRef\(\)/.test(boardTs),
        '★SpriteFrame 必须 addRef —— 引用计数为 0 会被 ReleaseManager 回收，'
        + '仍挂在 Sprite 上渲染的行会炸（规则 81）',
    );
});

test('★★11 张切图都在磁盘上（缺图是静默的：只 warn + 留白）', () => {
    const names = [
        'bg_01', 'title', 'phb_list_01', 'phb_list_02',
        'icon_01', 'icon_02', 'icon_03', 'common_txk', 'icon_tile',
        'di_01', 'di_02',
    ];
    const missing = names.filter(
        (n) => !existsSync(`assets/resources/image/GameRank/${n}.png`),
    );
    assert.deepEqual(missing, [], `★缺切图：${missing.join(',')}（缺图只 warn，画面留白）`);
});

test('★★★prefab 里 Label 的占位文字必须清空（引擎默认 "label" 会漏出来）', () => {
    // 实测踩过：MCP 建 Label 时 `string` 默认是 `"label"`。运行时 `render` 只在
    // `onOpen` 之后才写值，而虚拟列表**在 render 之前**就会实例化出行节点 ⇒
    // 首帧那一瞬每个行都写着 "label"，与真实名字重影（截图里"指挥官:19713"画了两遍）。
    //
    // 判据：prefab 里**不允许**残留任何非空 Label.string。
    // ⚠️ 用 JSON 解析而不是 grep —— `"_string": ""` 与缺字段要分清。
    for (const p of ['assets/resources/ui/game/ZCGameRankRow.prefab']) {
        const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown[];
        const placeholders = raw
            .filter((o): o is { __type__: string; _string: string } =>
                !!o && typeof o === 'object' && o.__type__ === 'cc.Label')
            .map((o) => o._string)
            .filter((s) => s !== '');
        assert.deepEqual(
            placeholders, [],
            `★${p} 里有非空 Label 占位文字（${placeholders.join('/')}）—— `
            + '虚拟列表在 render 之前实例化行，首帧会漏出占位文字并与真实值重影',
        );
    }
});

test('★★★全部节点坐标必须是 Panel 局部系，且与蓝湖设计稿逐项相符', () => {
    // 实测踩过：列头/列表是 `Panel` 的子节点，却按画布**绝对**坐标摆（py=300）⇒
    // 整体浮到框外、行区留大片空白。Panel 中心才是原点。
    //
    // 换算口径（设计稿 720×1610，根中心 (360,805)，Panel 中心 y=781.5）：
    //   local_x = (designX + w/2) - 360 ；local_y = 781.5 - (designY + h/2)
    // 下面每个数字都来自蓝湖节点的 bounds，**不是推算**。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const nodes = raw.filter(
        (o): o is { __type__: string; _name: string; _lpos: { x: number; y: number } } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Node',
    );
    const at = (name: string) => {
        const p = nodes.find((n) => n._name === name)?._lpos;
        // ⚠️ 只比 x/y：Cocos 把 Vec3 序列化成带 `__type__: 'cc.Vec3'` 的对象，
        // `deepEqual` 整个对象会因多出那个键而假红（值其实是对的）。
        return p ? { x: p.x, y: p.y } : null;
    };
    // 设计稿：组6 = x46 y492 628×579 ⇒ Panel 中心 (360, 781.5) ⇒ 相对根 +23.5
    assert.deepEqual(at('Panel'), { x: 0, y: 23.5 }, 'Panel 局部应为 (0,23.5)（设计稿组6 y492 h579）');
    // 底板节点 N150 = x27 y332 666×801 ⇒ 中心 (360,732.5) ⇒ 局部 (0, +49)
    // ⚠️ 必须**限定在 Panel 下**找：根下那颗 `Bg` 是**全屏半透明遮罩**，与底板同名。
    //    代码里走 `getChildByPath('Panel/Bg')` 路径明确、不会歧义；
    //    但这里的扁平 `find(name==='Bg')` 会抓到遮罩（pos 0,0）⇒ 断言假红（实测踩过）。
    const panelOf = (name: string) => {
        const panel = nodes.find((n) => n._name === 'Panel') as unknown as
            { _children?: { __id__: number }[] } | undefined;
        const child = (panel?._children ?? [])
            .map((c) => raw[c.__id__] as { _name?: string; _lpos?: { x: number; y: number } } | undefined)
            .find((n) => n?._name === name);
        return child?._lpos ? { x: child._lpos.x, y: child._lpos.y } : null;
    };
    assert.deepEqual(panelOf('Bg'), { x: 0, y: 49 }, 'Bg 应为 (0,49)（设计稿底板 666×801 中心 y=732.5）');
    // title = x287 y390 150×53 ⇒ 局部 (2, 365)
    assert.deepEqual(at('Title'), { x: 2, y: 365 }, 'Title 应为 (2,365)（设计稿 y390 h53）');
    // 列头 = y492/493 ⇒ 局部 +277.5/+276.5，取整 277
    assert.deepEqual(at('HeaderBar'), { x: 0, y: 277 }, 'HeaderBar 应为 (0,277)（设计稿列头 y=493）');
    // 列表 = 行1顶 y529 .. 行4底 y1071 ⇒ 高 542、顶边局部 +252.5（anchor y=1 ⇒ pos 即顶边）
    assert.deepEqual(at('List'), { x: 0, y: 252.5 }, 'List 顶边应为 +252.5（设计稿首行顶 y=529）');
    // 纵向虚拟列表的 content 必须**顶对齐**（anchor y=1），否则行从底部往上长。
    const content = raw.find(
        (o): o is { __type__: string; _anchorPoint: { y: number } } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.UITransform'
            && o._anchorPoint?.y === 1,
    );
    assert.ok(content, '★content 的 anchorPoint.y 必须是 1（纵向列表顶对齐，否则行从底部长）');
});

test('★★★Panel 不该有 Mask/Graphics；Mask 只能挂在 List 上（滚动裁剪）', () => {
    // ⚠️ 实测踩过：给 Panel 加 cc.Mask 想"裁掉溢出的底板"，结果把**整个面板内容裁穿**
    // （截图里那圈紫色条纹）。`bg_01` 的木质外框**本来就比内容区大**（666×801 vs 628×579），
    // 那是设计的一部分，不该裁。
    // 真正需要 Mask 的只有 `List`（虚拟列表滚动裁剪）。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const nodes = raw.filter(
        (o): o is { __type__: string; _name: string; _components: { __id__: number }[] } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Node',
    );
    const compTypesOf = (name: string): string[] => {
        const n = nodes.find((x) => x._name === name);
        if (!n) return [];
        return n._components
            .map((c) => (raw[c.__id__] as { __type__?: string } | undefined)?.__type__ ?? '')
            .filter(Boolean);
    };
    assert.ok(nodes.some((n) => n._name === 'Panel'), '找不到 Panel 节点');
    assert.ok(
        !compTypesOf('Panel').includes('cc.Mask'),
        '★Panel 上不该有 cc.Mask —— 它会把整个面板内容裁穿（木质外框超出内容区是设计的一部分）',
    );
    assert.ok(
        !compTypesOf('Panel').includes('cc.Graphics'),
        '★Panel 上不该有 cc.Graphics —— 它是 cc.Mask 的附带依赖，Mask 没了它也该走',
    );
    assert.ok(
        compTypesOf('List').includes('cc.Mask'),
        '★List 必须保留 cc.Mask —— 虚拟列表靠它做滚动裁剪，去掉会看到滚动内容溢出',
    );
});

test('★★★行 prefab 的文字样式必须与设计稿一致（逐节点钉住，不按集合比）', () => {
    // 设计稿给的文字样式（lanhu `textInfo`，用 `inspect_design_region` 取的实测值）：
    //   玩家名   : rgb(58,53,81) 深藏青  24.5px   **左对齐**
    //   比赛中…  : rgb(58,53,81) 深藏青  32px
    //   地块数   : 白色 24px + **黑描边**（压在 di_01 米色底上）
    //   名次数字 : 白色 40px
    //
    // ⚠️ 别用「全部 Label 的字号/颜色排个序再比对」——那样即使把某两个节点的样式
    //   互换也能通过（本次就是 `CountText` 错拿了「比赛中」的深藏青 32px 而没被发现）。
    //   必须**按节点名逐个断言**。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankRow.prefab', 'utf8'),
    ) as unknown[];
    const nameOf = (o: { node?: { __id__: number } }) =>
        o.node ? (raw[o.node.__id__] as { _name?: string } | undefined)?._name : undefined;
    type TLabel = {
        __type__: string; _fontSize: number; _horizontalAlign: number;
        _enableWrapText: boolean; _color: { r: number; g: number; b: number };
        _enableOutline: boolean; _outlineWidth: number;
        _outlineColor: { r: number; g: number; b: number };
        node?: { __id__: number };
    };
    const label = (name: string): TLabel | undefined =>
        (raw.filter(
            (o): o is TLabel => !!o && typeof o === 'object' && o.__type__ === 'cc.Label',
        )).find((l) => nameOf(l) === name);
    const rgb = (l: TLabel) => `${l._color.r},${l._color.g},${l._color.b}`;

    const name = label('NameText');
    assert.ok(name, '★找不到 NameText');
    assert.equal(name!._fontSize, 24.5, '★玩家名字号应为 24.5（设计稿 size=24.516）');
    assert.equal(rgb(name!), '58,53,81', '★玩家名必须是 rgb(58,53,81) 深藏青（Label 默认白，不显式设就全白）');
    assert.equal(name!._horizontalAlign, 0, '★玩家名必须**左对齐**（设计稿 justification=left）');

    const playing = label('PlayingText');
    assert.ok(playing, '★找不到 PlayingText（「比赛中…」必须是独立节点，不能和地块数共用一个 Label）');
    assert.equal(playing!._fontSize, 32, '★「比赛中…」字号应为 32');
    assert.equal(rgb(playing!), '58,53,81', '★「比赛中…」必须是 rgb(58,53,81) 深藏青');

    const count = label('CountText');
    assert.ok(count, '★找不到 CountText');
    assert.equal(count!._fontSize, 24, '★地块数字号应为 24（压在 di_01 底板上）');
    assert.equal(rgb(count!), '255,255,255', '★地块数必须是**白色** + 黑描边（不是深藏青 —— 早先错拿了「比赛中」的样式）');
    // 描边：地块数压在米色底板上，没描边会看不清。
    // ⚠️ 描边**只走 Label 内建**（`_enableOutline` / `_outlineWidth` / `_outlineColor`）：
    //    3.8.2 起 `cc.LabelOutline` 只剩纯转发空壳（`color`→`label.outlineColor`、`onEnable`→`enableOutline=true`），
    //    写它属性既不落盘也不生效，留在 prefab 里还会让编辑器每次 dump 节点都去读那些废弃 getter、
    //    刷 `'LabelOutline.color/width' is deprecated`（2026-10-10 用户就是拿这几条来问的）。
    //    同口径见 `tests/league.test.ts:570` / `league-hall.test.ts:491` / `league-hall-sub.test.ts:541`。
    assert.equal(
        raw.filter((o) => !!o && typeof o === 'object'
            && (o as { __type__?: string }).__type__ === 'cc.LabelOutline').length,
        0, '★不许有 cc.LabelOutline（已废弃空壳）—— 描边走 Label 内建',
    );
    assert.equal(count!._enableOutline, true, '★地块数必须开内建描边（`enableOutline`）');
    assert.equal(count!._outlineWidth, 2, '★描边宽 2');
    assert.equal(
        `${count!._outlineColor.r},${count!._outlineColor.g},${count!._outlineColor.b}`,
        '0,0,0', '★描边必须是黑色',
    );
});

test('★★★行内四个 Label 一律禁止换行（enableWrapText=false）', () => {
    // 排行榜一行只放得下一个名字；折行会顶出 128 高的行框、盖住下一行。
    // ⚠️ MCP 的 `boolean` 参数必须传真布尔 —— 传字符串 `"false"` 会被当成 true
    //   （回执照样 success），本项就是踩过这个之后补的护栏。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankRow.prefab', 'utf8'),
    ) as unknown[];
    const labels = raw.filter(
        (o): o is { __type__: string; _enableWrapText: boolean; node?: { __id__: number }; _fontSize: number } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Label',
    );
    const wrapOn = labels.filter((l) => l._enableWrapText === true).map((l) => {
        const n = l.node ? (raw[l.node.__id__] as { _name?: string } | undefined) : undefined;
        return `${n?._name ?? '?'}(${l._fontSize}px)`;
    });
    assert.deepEqual(wrapOn, [], `★这些 Label 还开着换行：${wrapOn.join(', ')}`);
});

test('★★★Row 代码必须真的切 CountText / PlayingText（漏了 = 某个状态永远空白）', () => {
    // prefab 拆成两个 Label 只是"有能力"，还要代码在 render 里按 `isPlaying` 切 `enabled`
    // 才真的生效。漏一个的后果：数字行永远空白，或「比赛中…」永远不出现（零报错）。
    // 用 `enabled` 而不是 `node.active`：与同文件里 badgeIcon/rankText 的写法一致，
    // 也让虚拟列表回收复用时不残留上一态的显隐（规则 106）。
    const src = readFileSync('assets/script/app/zcds/view/ZCGameRankRow.ts', 'utf8');
    assert.match(src, /this\.countText\.enabled\s*=/, '★render 里必须切 countText.enabled');
    assert.match(src, /this\.playingText\.enabled\s*=/, '★render 里必须切 playingText.enabled');
    // 两者必须互斥（同一个 playing 变量取反），否则会同时显示、叠字。
    assert.match(
        src, /this\.countText\.enabled\s*=\s*!playing/,
        '★countText 与 playingText 必须互斥（countText.enabled = !playing）',
    );
    assert.match(
        src, /this\.playingText\.enabled\s*=\s*playing/,
        '★playingText.enabled = playing',
    );
});

test('★★★弹窗根必须撑满屏幕（720×1280 + cc.Widget），否则遮罩铺不满、点空白关不掉', () => {
    // 设计分辨率是 720×1280（settings/v2/packages/project.json）。
    // 根节点若只有内容那么大（曾经是 720×700），会出现两个后果：
    //   ① 半透明遮罩没有容器可铺满 ⇒ 对局画面透出来（与设计稿不符）；
    //   ② 点的「空白」范围跟着缩水。
    // 工程惯例见 ui/gm/GMPanel.prefab、ui/login/ServerSelectPanel.prefab：
    // 根 720×1280 + cc.Widget alignFlags=45（四边对齐）。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const root = raw.find(
        (o): o is { __type__: string; _name: string; _components: { __id__: number }[] } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Node',
    );
    assert.ok(root, '找不到根节点');
    const comps = root!._components.map((c) => raw[c.__id__] as { __type__?: string; _alignFlags?: number; _contentSize?: { width: number; height: number } });
    const ui = comps.find((c) => c?.__type__ === 'cc.UITransform');
    assert.deepEqual(
        { w: ui?._contentSize?.width, h: ui?._contentSize?.height },
        { w: 720, h: 1280 },
        '★根节点必须是 720×1280（设计分辨率），否则遮罩无法铺满、空白命中范围不对',
    );
    const widget = comps.find((c) => c?.__type__ === 'cc.Widget');
    assert.ok(widget, '★根节点必须挂 cc.Widget（撑满屏幕）');
    assert.equal(widget!._alignFlags, 45, '★根 Widget 必须是四边对齐（TOP|MID|BOT|LEFT|CENTER|RIGHT = 45）');
});

test('★★★根下必须有全屏半透明遮罩 Bg（rgb(0,0,0) a=160），且排在 Panel 之前', () => {
    // 设计稿里弹窗外的棋盘是**压暗**的（半透明黑遮罩）；工程惯例见 GMPanel/ServerSelectPanel：
    // 根下第一颗 Bg = 720×1280 + cc.Sprite（纯色）+ cc.Widget，color rgba(0,0,0,160)。
    // ⚠️ 它必须排在 Panel **之前**（子序 = 渲染序），否则会盖住面板。
    // ⚠️ 它同时会被 `PopupBase.isBlankBackdrop` 判为「全屏装饰底图」而排除出内容区
    //    ⇒ 点它 = 点空白 ⇒ 正常关闭（这正是我们要的）。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const root = raw.find(
        (o): o is { __type__: string; _name: string; _children: { __id__: number }[] } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Node',
    )!;
    const nameOf = (id: number) => (raw[id] as { _name?: string } | undefined)?._name;
    const order = (root._children || []).map((c) => nameOf(c.__id__));
    assert.equal(order[0], 'Bg', `★子序[0] 必须是遮罩 Bg（子序 = 渲染序），实际 ${order.join(' → ')}`);
    assert.ok(
        order.indexOf('Bg') < order.indexOf('Panel'),
        '★遮罩 Bg 必须排在 Panel 之前，否则会盖住面板',
    );

    const bgIdx = root._children.find((c) => nameOf(c.__id__) === 'Bg')!.__id__;
    const bg = raw[bgIdx] as { _components: { __id__: number }[] };
    const comps = bg._components.map((c) => raw[c.__id__] as {
        __type__?: string; _color?: { r: number; g: number; b: number; a: number };
        _contentSize?: { width: number; height: number };
    });
    const sprite = comps.find((c) => c?.__type__ === 'cc.Sprite');
    assert.ok(sprite, '★遮罩 Bg 必须有 cc.Sprite（没 Sprite 就是全透明的，铺了也看不见）');
    assert.deepEqual(
        {
            r: sprite!._color?.r, g: sprite!._color?.g,
            b: sprite!._color?.b, a: sprite!._color?.a,
        },
        { r: 0, g: 0, b: 0, a: 160 },
        '★遮罩必须是 rgb(0,0,0) alpha=160（工程惯例，GMPanel/ServerSelectPanel 同值）',
    );
    const ui = comps.find((c) => c?.__type__ === 'cc.UITransform');
    assert.deepEqual(
        { w: ui?._contentSize?.width, h: ui?._contentSize?.height },
        { w: 720, h: 1280 },
        '★遮罩必须铺满 720×1280',
    );
    assert.ok(comps.some((c) => c?.__type__ === 'cc.Widget'), '★遮罩 Bg 需要 cc.Widget 随屏幕撑开');
});

test('★★★底部的「点击空白处以关闭」提示（白 24px a=204 + 底部 Widget）', () => {
    // 设计稿 node 140「点击空白处以关闭」：画布 y=1476 h=24，白色 24px，
    // blendOptions.opacity=80% ⇒ alpha = 0.8×255 ≈ 204。
    // 位置用**底部 Widget**（bottom=110）而不是写死 y：设计稿 1610 高、机型 1280 高，
    // 写死坐标会在短屏上跑出屏幕外，而「底部提示」的语义就是贴底。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const node = raw.find(
        (o): o is { __type__: string; _name: string; _components: { __id__: number }[] } =>
            !!o && typeof o === 'object' && o.__type__ === 'cc.Node' && o._name === 'CloseTips',
    );
    assert.ok(node, '★找不到「点击空白处以关闭」提示节点 CloseTips');
    const comps = node!._components.map((c) => raw[c.__id__] as {
        __type__?: string; _fontSize?: number; _string?: string;
        _color?: { r: number; g: number; b: number; a: number };
        _bottom?: number; _alignFlags?: number;
    });
    const label = comps.find((c) => c?.__type__ === 'cc.Label');
    assert.ok(label, 'CloseTips 必须有 cc.Label');
    assert.equal(label!._string, '点击空白处以关闭', '★提示文案必须是设计稿原文「点击空白处以关闭」');
    assert.equal(label!._fontSize, 24, '★提示字号 24（设计稿 size=24）');
    assert.deepEqual(
        { r: label!._color?.r, g: label!._color?.g, b: label!._color?.b, a: label!._color?.a },
        { r: 255, g: 255, b: 255, a: 204 },
        '★提示必须是白色 alpha=204（设计稿 80% 不透明度）',
    );
    const widget = comps.find((c) => c?.__type__ === 'cc.Widget');
    assert.ok(widget, '★CloseTips 必须挂 cc.Widget（贴底）');
    assert.ok((widget!._alignFlags! & 4) !== 0, '★Widget 必须启用「底边对齐」位（BOT=4）');
    assert.equal(widget!._bottom, 110, '★距底 110（设计稿 1610-1500）');
});

test('★★★closeOnBlank 必须为 true（点空白关闭已启用）', () => {
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const sc = raw.find(
        (o): o is { __type__: string; closeOnBlank?: boolean; popupLayer?: number } =>
            !!o && typeof o === 'object' && o.__type__ === 'f26e3u/dK9Ayp+tzx6MCUwH',
    );
    assert.ok(sc, '找不到 ZCGameRankBoard 脚本组件');
    assert.equal(sc!.closeOnBlank, true, '★closeOnBlank 必须 true，否则点空白不关闭');
    assert.equal(sc!.popupLayer, 0, '★popupLayer 应为 0（NORMAL）');
});

test('★★★contentNodes 必须是数组形态（MCP 往数组属性传单值会写成对象、属性损坏）', () => {
    // 实测踩过：用 component_set_component_property 往 `contentNodes`（声明 `Node[]`）
    // 传单个节点 uuid，MCP 回执 `success`，但落盘成了 `{"__id__": 10}`（**单对象**），
    // 之后该属性在 MCP 的属性列表里**整个消失**（引擎按单 Node 反序列化）。
    // 正确形态只有两种：
    //   · `[]`（或字段省略走 TS 默认）→ 自动取激活的直接子节点，排掉全屏底图 / 空白接收层；
    //   · `[{__id__:N}, ...]` → 只认列出的节点。
    // 工程惯例见 ui/gm/GMPanel.prefab（`[]`）。当前本弹窗也用 `[]`：
    // 根下 `Bg`（全屏遮罩）会被 `isBlankBackdrop` 自动排除，`Panel` 才是内容。
    // ⚠️ 想精确限定内容区（例如让「点击空白处以关闭」提示也算空白）**不能**靠 MCP——
    //    它的 node 类型只收单值；要么手改 prefab JSON，要么在代码里 `onInit` 赋值。
    const raw = JSON.parse(
        readFileSync('assets/resources/ui/game/ZCGameRankBoard.prefab', 'utf8'),
    ) as unknown[];
    const sc = raw.find(
        (o): o is { __type__: string; contentNodes?: unknown } =>
            !!o && typeof o === 'object' && o.__type__ === 'f26e3u/dK9Ayp+tzx6MCUwH',
    );
    assert.ok(sc, '找不到 ZCGameRankBoard 脚本组件');
    const cn = sc!.contentNodes;
    assert.ok(
        cn === undefined || Array.isArray(cn),
        `★contentNodes 必须是数组（或省略用默认 []），实际是 ${typeof cn}：${JSON.stringify(cn)}`
        + ' —— 单对象形态说明被 MCP 的 node 类型写坏了',
    );
    if (Array.isArray(cn)) {
        for (const ref of cn as { __id__: number }[]) {
            const target = raw[ref.__id__] as { __type__?: string; _name?: string } | undefined;
            assert.equal(target?.__type__, 'cc.Node', '★contentNodes 的每个元素都必须指向节点');
        }
    }
});

