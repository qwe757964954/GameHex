import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { assetPath } from './helpers/asset-paths';

const PREFAB_PATH = assetPath('ui/game/ZCGameLegendBanner.prefab');
// ⚠️ 横幅美术从 `image/gameui/legend` 搬到了 `image/legend`（gameui 目录清理时随批迁出），
// 这条守卫当时没跟改 ⇒ 一直报 ENOENT 红着（与「图丢了」完全不是一回事，别再被它带偏）。
const ART_ROOT = assetPath('image/legend');

/** 四个玩家各一套（底板 + 头像环）。映射依据 = 色相对齐 `ZC_CLIENT_COLORS`，写在视图 `bannerFor`。 */
const OWNER_ART = [
    { owner: 'player', suffix: 'Player', banner: 'legend_banner_02', ring: 'legend_ring_02' },
    { owner: 'enemy', suffix: 'Enemy', banner: 'legend_banner_01', ring: 'legend_ring_01' },
    { owner: 'enemy2', suffix: 'Enemy2', banner: 'legend_banner_04', ring: 'legend_ring_04' },
    { owner: 'enemy3', suffix: 'Enemy3', banner: 'legend_banner_03', ring: 'legend_ring_03' },
] as const;

/**
 * 设计稿「出场横幅」（蓝湖 720×1665，四组同构）量到的单组几何。
 * 局部坐标口径：根 anchor (0.5, 0.5)、y 向上 ⇒ `x + w/2 - 360` / `208.5 - (y距组顶 + h/2)`。
 */
const LAYOUT: Record<string, { pos: [number, number]; size: [number, number] }> = {
    Banner: { pos: [0, 0], size: [720, 417] },
    // ⚠️ `Role.y = -21.798` 是**美术最后一次微调后**的 prefab 真值（早前是 -28.24、再早 -164.5）。
    // 立绘 256 高 + 中心锚点，站在 417 高的底板上时中心该在 `y ≈ -417/2 + 256/2 ≈ -80` 附近
    // （美术按底板实际留白定的值）；`-164.5` 会让立绘掉出画布外。
    // 判据口径：**此处跟随 prefab**，不是反过来要求美术改回旧值。
    Role: { pos: [-192, -21.798], size: [256, 256] },
    Title: { pos: [191.5, 28.5], size: [253, 90] },
    Portrait: { pos: [321, 141.5], size: [76, 76] },
    Head: { pos: [0, 0], size: [66, 66] },
    Name: { pos: [187.5, -71.5], size: [260, 46] },
};

const CIRCLE_AVATAR_CID = '01878nXjfNErJIegipglTTn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const loadPrefab = (): Raw[] => JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Raw[];

function nodeIndexByName(objects: Raw[], name: string): number {
    const index = objects.findIndex((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.ok(index >= 0, `prefab 里找不到节点 ${name}`);
    return index;
}

function componentOf(objects: Raw[], nodeIndex: number, type: string): Raw {
    const refs: Array<{ __id__: number }> = objects[nodeIndex]._components ?? [];
    const found = refs.map((ref) => objects[ref.__id__]).find((item) => item.__type__ === type);
    assert.ok(found, `${objects[nodeIndex]._name} 上没有 ${type}`);
    return found as Raw;
}

/** 图的 spriteFrame 子资源 uuid（`.meta` 里已含 `@f9941`，别再加一次）。 */
function artUuid(name: string): string {
    const meta = JSON.parse(readFileSync(`${ART_ROOT}/${name}.png.meta`, 'utf8')) as {
        subMetas: Record<string, { uuid: string }>;
    };
    return meta.subMetas.f9941.uuid;
}

test('ZCGameLegendBanner 结构：7 节点、渲染序 Banner→Role→Title→Portrait→Name、几何等于设计稿', () => {
    const objects = loadPrefab();
    assert.equal(objects[0].__type__, 'cc.Prefab');
    const nodes = objects.map((item, index) => (item.__type__ === 'cc.Node' ? index : -1))
        .filter((index) => index >= 0);
    assert.equal(nodes.length, 7);
    assert.equal(objects[0].data.__id__, nodes[0], 'cc.Prefab.data 必须指向真根节点');

    const root = nodes[0];
    assert.equal(objects[root]._name, 'ZCGameLegendBanner');
    // 子节点顺序 = 渲染顺序：底板最下、立绘压在它上面（设计稿里角色完整可见）。
    assert.deepEqual(
        (objects[root]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['Banner', 'Role', 'Title', 'Portrait', 'Name'],
    );
    // 头像是头像环的子节点（同心：环 76 / 头像 66）。
    const portrait = nodeIndexByName(objects, 'Portrait');
    assert.deepEqual(
        (objects[portrait]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['Head'],
    );

    for (const [name, expected] of Object.entries(LAYOUT)) {
        const index = nodeIndexByName(objects, name);
        const transform = componentOf(objects, index, 'cc.UITransform');
        assert.equal(transform._contentSize.width, expected.size[0], `${name} 宽`);
        assert.equal(transform._contentSize.height, expected.size[1], `${name} 高`);
        assert.equal(objects[index]._lpos.x, expected.pos[0], `${name} x（设计稿量测值）`);
        assert.equal(objects[index]._lpos.y, expected.pos[1], `${name} y（设计稿量测值）`);
    }

    // 立绘是 256×256 的方形原图 ⇒ RAW 交给美术定尺寸 + 位置。
    // 用固定 258×333 会把它纵向拉伸 30%，这是这一版最容易踩的坑。
    //
    // ⚠️ **不要断言锚点在底边**：r461 起 prefab 把 `Role` 锚点改成中心 (0.5,0.5) + y=-28.24，
    // 与早期"底边锚点 + y=-164.5"是同一画面的两种表述。锚点是**美术的摆位口味**，
    // 不是代码契约 —— 代码只负责尺寸等比，钉死锚点会让每次美术微调立绘位置都红一遍。
    // 真正的不变量是下一行的 `sizeMode = RAW`（尺寸原样交给美术定）。
    const roleIndex = nodeIndexByName(objects, 'Role');
    assert.equal(componentOf(objects, roleIndex, 'cc.Sprite')._sizeMode, 2, 'Role 必须是 RAW');

    // 头像要圆裁：`icons/head` 的图是方形（204×204），靠工程既有的 CircleAvatar shader。
    const headComponents = (objects[nodeIndexByName(objects, 'Head')]._components ?? [])
        .map((ref: { __id__: number }) => objects[ref.__id__].__type__);
    assert.ok(headComponents.includes(CIRCLE_AVATAR_CID), 'Head 上必须挂 CircleAvatar');

    // CUSTOM 尺寸的 Sprite 一律关 trim：开着的话引擎会在赋值时把 contentSize 覆写成图的
    // trim 包围盒，设计稿尺寸就白写了。
    for (const item of objects) {
        if (item.__type__ !== 'cc.Sprite' || item._sizeMode !== 0) continue;
        assert.equal(item._isTrimmedMode, false, 'CUSTOM 尺寸的 Sprite 必须 _isTrimmedMode=false');
    }

    for (const index of nodes) assert.equal(objects[index]._layer, 33554432, 'layer 必须是 UI_2D');
    const fileIds = objects.filter((item) => typeof item.fileId === 'string').map((item) => item.fileId as string);
    assert.ok(fileIds.length > 0);
    for (const id of fileIds) assert.equal(id.length, 22);
    assert.equal(new Set(fileIds).size, fileIds.length, 'fileId 有重复');
});

test('ZCGameLegendBanner 绑定：六个组件引用指对节点，四套玩家配色的帧都指向磁盘上真存在的图', () => {
    const objects = loadPrefab();
    const script = objects.find((item) => item.__type__ === 'c06d7h5rVFDWoG+wKbzkWyi') as Raw;
    assert.ok(script, 'prefab 里没有 ZCGameLegendBannerView 组件');

    const expectRef = (prop: string, nodeName: string, type: string): void => {
        const ref = script[prop];
        assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 没绑`);
        assert.equal(objects[ref.__id__].__type__, type, `${prop} 应是 ${type}`);
        const owner = objects[objects[ref.__id__].node.__id__];
        assert.equal(owner._name, nodeName, `${prop} 指向了 ${owner._name}`);
    };
    expectRef('bannerOpacity', 'ZCGameLegendBanner', 'cc.UIOpacity');
    expectRef('bannerSprite', 'Banner', 'cc.Sprite');
    expectRef('roleSprite', 'Role', 'cc.Sprite');
    expectRef('titleSprite', 'Title', 'cc.Sprite');
    expectRef('ringSprite', 'Portrait', 'cc.Sprite');
    expectRef('headSprite', 'Head', 'cc.Sprite');
    expectRef('nameLabel', 'Name', 'cc.Label');

    // 八个帧字段逐个与 `.meta` 对账 —— 抄错图不报错，只表现为「颜色不对」。
    const seen: string[] = [];
    for (const { suffix, banner, ring } of OWNER_ART) {
        for (const [prop, name] of [[`banner${suffix}`, banner], [`ring${suffix}`, ring]] as const) {
            const uuid = script[prop].__uuid__ as string;
            assert.equal(uuid, artUuid(name), `${prop} 应指向 ${name}`);
            assert.equal(uuid.split('@').length - 1, 1, `${prop} 的 uuid 只能有一个 @ 子资源后缀`);
            seen.push(uuid);
        }
    }
    assert.equal(new Set(seen).size, 8, '四张底板 / 四个环里有重复的图');
    // 标题图固定绑在 Title 节点的 Sprite 上（不是脚本字段）：与哪张卡无关，也不用换。
    const titleSprite = componentOf(objects, nodeIndexByName(objects, 'Title'), 'cc.Sprite');
    assert.equal(titleSprite._spriteFrame.__uuid__, artUuid('legend_title'));
});

test('视图按owner 选四色底板与头像环，立绘**保持 256 原生尺寸不缩放**，进度曲线驱动滑入与淡出', () => {
    const { load, FakeNode, cc } = loadViews();
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const view = buildView(new ZCGameLegendBannerView(), FakeNode);
    // Role 节点 sizeMode=RAW：UITransform.height 同步为 spriteFrame.originalSize.height（256）。
    view.roleSprite.node.components.set(cc.UITransform, { height: 256 });
    const unitArt = { height: 256, name: 'unit-idle' };
    const portrait = { height: 204, name: 'head' };
    view.setArtResolver(() => unitArt);
    view.setPortraitResolver(() => portrait);

    const reveal = {
        id: 1, cardId: '68009', owner: 'enemy2', building: 'barracks', tier: 4,
        cardName: '吐豌豆骑手', unitId: 'peashooter', luckText: '', hexId: 7,
        x: 0, y: 0, startedAt: 10, durationSeconds: 2.2,
    };
    view.render(reveal, 10);
    assert.equal(view.bannerSprite.spriteFrame, view.bannerEnemy2, '三号玩家（黄）用 banner_04');
    assert.equal(view.ringSprite.spriteFrame, view.ringEnemy2);
    assert.equal(view.headSprite.spriteFrame, portrait);
    assert.equal(view.nameLabel.string, '吐豌豆骑手');
    // 立绘**不缩放**（2026-10-10 山猫口径「不用放大了，就用 256×256 不考虑拉伸」）：
    // 曾经按「横幅高 × 333/417」等比缩放（2 人局会放到 511 高），已删除。
    assert.equal(view.roleSprite.node.scale.x, 1, '立绘 x 不该被缩放');
    assert.equal(view.roleSprite.node.scale.y, 1, '立绘 y 不该被缩放');

    // 换一方：底板与环跟着换，文案独立。
    const other = { ...reveal, id: 2, owner: 'player', cardName: '精灵弓箭手' };
    view.render(other, 10);
    assert.equal(view.bannerSprite.spriteFrame, view.bannerPlayer, '我方（蓝）用 banner_02');
    assert.equal(view.ringSprite.spriteFrame, view.ringPlayer);
    assert.equal(view.nameLabel.string, '精灵弓箭手');

    // ── 弹出动画：保持原样的横向滑入 ──
    // 起始 x 在屏幕外（我方从左外），落位终点 x = 0（横幅满宽不分列），终点 y 是竖向格心。
    assert.ok(view.node.position.x < -700, `我方起始应在屏幕左外，实际 ${view.node.position.x}`);
    assert.equal(view.bannerOpacity.opacity, 0);
    view.render(other, 10 + 2.2 * 0.18);
    assert.equal(view.node.position.x, 0, '入场完成后横幅居中（满宽 720，不分列）');
    assert.equal(view.node.position.y, -1280 / 4, '2 人局我方落在最下一格中心（下半屏，与棋盘方位一致）');
    assert.equal(view.bannerOpacity.opacity, 255, '入场完成时应完全不透明');

    // 尾段淡出；到期归零（渲染层就在那个点上回收）。
    view.render(other, 10 + 2.2 * 0.9);
    assert.ok(view.bannerOpacity.opacity < 255 && view.bannerOpacity.opacity > 0);
    view.render(other, 10 + 2.2);
    assert.equal(view.bannerOpacity.opacity, 0);
});

test('立绘/头像解析器晚于横幅弹出注入时，已经弹出的那一条会立刻补上', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const view = buildView(new ZCGameLegendBannerView(), FakeNode);

    const reveal = {
        id: 3, cardId: '68001', owner: 'player', building: 'barracks', tier: 4,
        cardName: '精灵弓箭手', unitId: 'archer', luckText: '', hexId: 1,
        x: 0, y: 0, startedAt: 0, durationSeconds: 2.2,
    };
    // 头像 / 立绘都还没回来：只有色环，两个 Sprite 关掉（不是留一个空帧）。
    view.render(reveal, 0);
    assert.equal(view.roleSprite.spriteFrame, null);
    assert.equal(view.roleSprite.enabled, false);
    assert.equal(view.headSprite.enabled, false);

    // 头像随后到达 —— 必须重绘，否则这一条横幅会一直空着头像。
    const frame = { name: 'head', height: 204 };
    view.setPortraitResolver(() => frame);
    view.render(reveal, 0.1);
    assert.equal(view.headSprite.spriteFrame, frame);
    assert.equal(view.headSprite.enabled, true);
});

test('渲染层只给金卡（tier 4）弹横幅，且挂全屏层而不是可滚动的 mapLayer', () => {
    const { load, FakeNode, procedureGame } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const overlay = new FakeNode('ZCGameHUD');
    const mapLayer = new FakeNode('mapLayer');

    const views: Raw[] = [];
    const makeBannerNode = (): Raw => {
        const node = new FakeNode('LegendBanner');
        const view: Raw = {
            isValid: true,
            artResolver: null,
            portraitResolver: null,
            layout: null,
            rendered: [] as number[],
            setArtResolver(fn: unknown) { this.artResolver = fn; },
            setPortraitResolver(fn: unknown) { this.portraitResolver = fn; },
            setLayout(value: unknown) { this.layout = value; },
            render(reveal: { id: number }) { (this.rendered as number[]).push(reveal.id); },
        };
        views.push(view);
        // `getComponent(ZCGameLegendBannerView)` 用真类当 key ⇒ 这里也得用真类塞。
        (node as Raw).components.set(ZCGameLegendBannerView, view);
        return node;
    };
    const world = new ZCGameRenderWorld({
        overlayLayer: overlay,
        board: new FakeNode('board'),
        legendBannerPrefab: { make: makeBannerNode },
    });

    const reveal = (id: number, tier: number): Raw => ({
        id, cardId: '6800', owner: 'player', building: 'barracks', tier,
        cardName: '卡', unitId: null, luckText: '', hexId: id, x: 0, y: 0,
        startedAt: 0, durationSeconds: 2.2,
    });
    const model = (reveals: Raw[]): Raw => ({
        cardReveals: reveals,
        snapshot: { elapsedSeconds: 0, status: 'playing', pendingSeconds: 0 },
    });

    world.renderLegendBanners(model([reveal(1, 4), reveal(2, 3), reveal(3, 4)]));
    assert.equal(overlay.children.length, 2, '只有 tier 4 的两张弹横幅');
    assert.deepEqual(overlay.children.map((child: Raw) => child.name), ['LegendBanner_1', 'LegendBanner_3']);
    assert.equal(mapLayer.children.length, 0, '横幅不能挂进 ScrollView 的 content');
    assert.equal(views.length, 2);

    // 幂等：同一个模型再刷一遍不新建节点。
    world.renderLegendBanners(model([reveal(1, 4), reveal(2, 3), reveal(3, 4)]));
    assert.equal(overlay.children.length, 2);
    assert.equal(views[0].rendered.length, 2, '每帧都要 render（靠进度自己算）');

    // 过期回收：模型里没了就收起。⚠️ 对象池只把节点置 `active = false`、节点仍留在层里复用，
    // 所以判据是 active 数而不是 children 数（ZCNodePool 的既有语义）。
    world.renderLegendBanners(model([reveal(2, 3)]));
    assert.equal(overlay.children.filter((child: Raw) => child.active).length, 0);

    // 头像解析器晚注入：已经弹过的横幅也要吃到（渲染层负责转发）。
    // ⚠️ 注入渠道已变：早前是 `world.setLegendPortraitResolver(...)` 由渲染层存起来再转发，
    //    现在渲染层每帧直接 `ProcedureGame.current?.resolveLegendPortrait(owner)` 现取（ZCGameRenderWorld:1306），
    //    "晚注入也生效"是靠**闭包每帧现取**实现的，不是靠 setter 补刷。
    const portrait = { name: 'head' };
    // 桩要给全三个方法：渲染层同一条链上还会问 `resolveCardArt`（左边卡面）和
    // `resolveBuildingFrame`（金矿/主城回退），少一个就 `is not a function`。
    procedureGame.current = {
        resolveLegendPortrait: () => portrait,
        resolveCardArt: () => null,
        resolveBuildingFrame: () => null,
    };
    world.renderLegendBanners(model([reveal(9, 4)]));
    const bound = views.filter((view) => view.portraitResolver !== null);
    assert.ok(bound.length > 0, '横幅视图没拿到头像解析器');
    assert.equal(bound[bound.length - 1].portraitResolver('player'), portrait);
    assert.equal(
        bound[bound.length - 1].artResolver(reveal(9, 4)),
        null,
        '立绘走渲染层的单位 / 建筑链，桩里解析不到时返回 null（视图据此关掉那张 Sprite）',
    );
});

test('竖排按人数均分屏高：我方恒定最下（与棋盘方位一致）、敌方从最上往下；弹出动画仍是横向滑入', () => {
    const { load, FakeNode, cc } = loadViews();
    const { ZCGameLegendBannerView, slotOf, layoutYOf, bannerHeightOf } = load('./ZCGameLegendBannerView');
    const view = buildView(new ZCGameLegendBannerView(), FakeNode);
    view.roleSprite.node.components.set(cc.UITransform, { height: 256 });

    const reveal = (owner: string): Raw => ({
        id: 1, cardId: '68001', owner, building: 'barracks', tier: 4,
        cardName: '精灵弓箭手', unitId: null, luckText: '', hexId: 1,
        x: 0, y: 0, startedAt: 0, durationSeconds: 2.2,
    });
    // 入场结束那一帧（0.18 进度）的落位。
    const landed = (owner: string, playerCount: number, viewWidth: number, viewHeight: number): Raw => {
        view.setLayout({ playerCount, viewWidth, viewHeight });
        view.render(reveal(owner), 2.2 * 0.18);
        return view.node.position;
    };
    const VH = 1280;

    // ── 高度：严格均分屏高 ──────────────────────────────────────────────
    assert.equal(bannerHeightOf(VH, 2), 640, '2 人：每格 640（相对设计 417 是 1.53x 放大）');
    assert.equal(bannerHeightOf(VH, 3), 1280 / 3, '3 人：每格 ≈427（几乎等于设计高 417）');
    assert.equal(bannerHeightOf(VH, 4), 320, '4 人：每格 320（4×417=1668 超出屏高，必须缩）');

    // ── 落位：竖向格心，我方恒定最下、敌方从最上往下 ──────────────────────
    // 新公式 `y = -H/2 + H*(slot+0.5)/N`：slot 0（我方）在**最下**，slot 越大越靠上。
    assert.equal(landed('player', 2, 720, VH).y, -VH / 4, '2 人：我方（slot 0）在最下格');
    assert.equal(landed('enemy', 2, 720, VH).y, VH / 4, '2 人：敌方在最上格');
    assert.equal(landed('player', 4, 720, VH).y, -VH / 2 + (VH * 0.5) / 4, '4 人：我方仍贴屏幕下沿');
    assert.equal(landed('enemy', 4, 720, VH).y, -VH / 2 + (VH * 3.5) / 4, '4 人：enemy（slot 3）贴屏幕上沿');
    assert.equal(landed('enemy2', 4, 720, VH).y, -VH / 2 + (VH * 2.5) / 4, '4 人：enemy2（slot 2）次上');
    assert.equal(landed('enemy3', 4, 720, VH).y, -VH / 2 + (VH * 1.5) / 4, '4 人：enemy3（slot 1）居中下');

    // ★★ 与棋盘方位一致：玩家领地本来就在**下方**（`ZCSection` 1 = 下左，主城在左下），
    // 所以我方横幅必须在**屏幕下沿**，不能放最上 —— 那会让"我的横幅"飘到敌方地界那头去。
    for (const n of [2, 3, 4]) {
        assert.ok(
            layoutYOf('player', n, VH) < 0,
            n + ' 人：我方（player）应在屏幕下半区（y<0），实际 ' + layoutYOf('player', n, VH),
        );
        assert.ok(
            layoutYOf('enemy', n, VH) > 0,
            n + ' 人：敌方首席（enemy）应在屏幕上半区（y>0），实际 ' + layoutYOf('enemy', n, VH),
        );
        // 人数变化时我方那一格必须**始终贴下沿**，不能随人数漂到中间。
        assert.ok(
            Math.abs(layoutYOf('player', n, VH) + VH / 2 - bannerHeightOf(VH, n) / 2) < 1e-6,
            n + ' 人：我方应始终贴屏幕下沿',
        );
    }

    // ★ 核心不变量：N 条横幅**恰好铺满**竖屏，互不重叠、也不留空白。
    // 参与的 owner 按人数取前 N 个 —— `ZC_OWNER_ORDER` 是 ['player','enemy','enemy2','enemy3']，
    // 别用 `slotOf(o) < n` 过滤：它是 0 基格号，4 个 owner 全都 < 4（等于没过滤）。
    const ALL_OWNERS = ['player', 'enemy', 'enemy2', 'enemy3'] as const;
    /** 敌方席位序（`ZC_OWNER_ORDER` 去掉我方那一位）。 */
    const ENEMY_ORDER = ['enemy', 'enemy2', 'enemy3'] as const;
    for (const n of [2, 3, 4]) {
        const height = bannerHeightOf(VH, n);
        assert.ok(Math.abs(height * n - VH) < 1e-6, n + ' 人：' + height + '×' + n + ' 应等于屏高 ' + VH);
        const centres = ALL_OWNERS.slice(0, n).map((owner) => layoutYOf(owner, n, VH));
        assert.equal(new Set(centres.map((v) => v.toFixed(3))).size, n, n + ' 人：落位不能重合');
        // 相邻两格间距恰好等于格高 ⇒ 首尾两条的外缘贴着屏幕上下沿。
        const sorted = [...centres].sort((a, b) => b - a);
        assert.ok(Math.abs((sorted[0] - sorted[1]) - height) < 1e-6, n + ' 人：相邻间距应等于格高');
        assert.ok(Math.abs((sorted[0] + sorted[n - 1]) / 2) < 1e-6, n + ' 人：整组应关于屏幕中线对称');
        assert.ok(Math.abs(sorted[0] + height / 2 - VH / 2) < 1e-6, n + ' 人：最上一条应贴屏幕上沿');
        assert.ok(Math.abs(sorted[n - 1] - height / 2 + VH / 2) < 1e-6, n + ' 人：最下一条应贴屏幕下沿');
        // ★ 从上往下读 = **敌方按席位序（enemy → enemy2 → enemy3）**，我方 `player` 在**最后（最下）**。
        // 依据 `slotOf`：席位 index=i 的敌方拿 slot = total-i，即 index 越小 slot 越大 = 越靠上。
        // 这条同时钉住「敌方内部次序」和「我方在最后（最下）」两件事。
        // `slice(0, n-1)` 去掉末位（末位恒为 player），与「敌方数 = N-1」对齐。
        const fromTop = [...ALL_OWNERS.slice(0, n)].sort(
            (a, b) => layoutYOf(b, n, VH) - layoutYOf(a, n, VH),
        );
        assert.deepEqual(
            fromTop,
            [...ENEMY_ORDER.slice(0, n - 1), 'player'],
            n + ' 人：从上到下应是敌方按席位序、我方 player 在最下',
        );
    }

    // ── 横向：满宽 720，不分列，恒居中 ──────────────────────────────────
    for (const n of [2, 3, 4]) {
        assert.equal(landed('enemy2', n, 720, VH).x, 0, n + ' 人：横幅满宽，横向恒居中');
        // 宽屏也一样：720 宽的横幅在 2880 屏上仍只有 720，按格分列没有意义。
        assert.equal(landed('enemy2', n, 2880, VH).x, 0, n + ' 人：宽屏也不分列（横幅只有 720 宽）');
    }

    // 纯函数：席位 → 格号（0 = 我方那端；slot 越大越靠上，敌方 = `total - index`）。
    assert.equal(slotOf('player', 4), 0);
    assert.equal(slotOf('enemy', 4), 3);
    assert.equal(slotOf('enemy2', 4), 2);
    assert.equal(slotOf('enemy3', 4), 1);
    assert.equal(slotOf('player', 2), 0, '我方在人数变化时恒定 0 格（贴屏幕下沿）');

    // ── 弹出动画：横向滑入（不因为落位改竖排就换成上下滑）；**一律从左往右** ──
    // 🔴 2026-10-15 row11 改口径：原文「预制体从屏幕外生成，**从左往右**快速扇入屏幕」。
    // 旧口径是「我方从左、敌方从右」，现在四个席位方向一致。
    view.setLayout({ playerCount: 2, viewWidth: 720, viewHeight: VH });
    for (const owner of ['player', 'enemy', 'enemy2', 'enemy3']) {
        view.render(reveal(owner), 0);
        assert.ok(view.node.position.x < -700, `${owner} 必须从**左**屏缘外进场（从左往右）`);
    }
    // 滑入过程中 y 已经是最终格心（只有 x 在动）—— 竖向不参与动画。
    view.render(reveal('player'), 2.2 * 0.09);
    assert.equal(view.node.position.y, -VH / 4, '滑入过程中 y 就是最终格心（我方在下方，负值）');

    // 层高拿不到（0 / 负数 / NaN）⇒ 回退设计稿 1280 再均分。
    assert.equal(bannerHeightOf(0, 2), 640, '层高 0 时回退 1280 再均分');
    assert.equal(bannerHeightOf(-100, 2), 640, '层高负数同样回退');
    assert.equal(bannerHeightOf(Number.NaN, 4), 320, '层高 NaN 回退 1280，4 人每格 320');
    // 层高小到除出来不足 1px ⇒ 退回设计稿单条高（横幅整体可见，不是 0 高不可见）。
    assert.equal(bannerHeightOf(2, 4), 417, '层高过小 ⇒ 退回设计稿单条高 417');
    // 人数异常一律夹回 2（超编夹到席位上限 4；NaN 兜底成 2）。
    assert.equal(bannerHeightOf(VH, 0), 640, '人数 0 夹回 2');
    assert.equal(bannerHeightOf(VH, 99), 320, '超编夹到席位上限 4');
    assert.equal(bannerHeightOf(VH, Number.NaN), 640, '人数 NaN 兜底成 2');
    assert.equal(bannerHeightOf(VH, 1), 640, '人数 1 夹回 2');
});

test('横幅高度真的写进了节点 UITransform，且立绘跟着同一个比例缩放', () => {
    const { load, FakeNode, cc } = loadViews();
    const { ZCGameLegendBannerView, bannerHeightOf } = load('./ZCGameLegendBannerView');
    const view = buildView(new ZCGameLegendBannerView(), FakeNode);
    // 立绘的原生尺寸（sizeMode=RAW ⇒ UITransform.height 同步为 spriteFrame.originalSize）。
    view.roleSprite.node.components.set(cc.UITransform, { height: 256 });
    const reveal = (owner: string): Raw => ({
        id: 1, cardId: '68001', owner, building: 'barracks', tier: 4,
        cardName: '精灵弓箭手', unitId: null, luckText: '', hexId: 1,
        x: 0, y: 0, startedAt: 0, durationSeconds: 2.2,
    });
    const VH = 1280;
    // 每个人数下立绘**应有**的高度 —— 口径是「恒为256 原生」，收集起来只为最后那条不变性断言。
    const targets: number[] = [];

    // ⚠️ 计数用的 UITransform 桩必须在**第一次 render 之前**注册好。
    // 桩的 `getComponent(type)` 对未注册类型每次返回**新对象**（见 `helpers/zcds-view-fixtures`），
    // 想观测 `setContentSize` 次数就只能注册一个稳定实例；而 `appliedHeight` 一旦被首次
    // render 缓存住，后面再注册就看不到后续调用了。
    let writes = 0;
    view.node.components.set(cc.UITransform, {
        get height() { return view.node.size.height; },
        setContentSize(width: number, height: number) {
            writes += 1;
            view.node.size = { width, height };
        },
    });

    // ⚠️ 只改落位 y、不改底板高度 ⇒ 4 人局总高 4×417=1668 超出屏高 1280，最下面那条被挤出屏幕。
    // 这条断言就是钉住「高度真的落到 UITransform 上」，不是只改了落位。
    for (const n of [2, 3, 4]) {
        view.setLayout({ playerCount: n, viewWidth: 720, viewHeight: VH });
        view.render(reveal('player'), 2.2);
        const expected = bannerHeightOf(VH, n);
        assert.ok(
            Math.abs(view.node.size.height - expected) < 1e-6,
            n + ' 人：节点高度应被设成 ' + expected + '，实际 ' + view.node.size.height,
        );
        // 宽度 = 注入的屏幕宽（这里 720），不再固定设计稿宽 —— 见 `applyLayout`。
        assert.equal(view.node.size.width, 720, n + ' 人：宽度 = 屏幕宽 720');
        // 🔴 底板必须同步铺满并且回到中心：只改根不改底板 ⇒ 图片仍是 720 宽、右边留缝
        //（这正是 2026-10-19 反馈的画面）。
        assert.equal(view.bannerSprite.node.size.width, 720, n + ' 人：底板宽度要跟根节点一致');
        assert.equal(view.bannerSprite.node.position.x, 0, n + ' 人：底板必须横向居中（不许残留左移偏移）');
        // 🔴 底板高度**恒为 prefab 的 417**：格子高（640 / 426 / 320）只决定落位中心，
        // 不许把底板也拉伸 —— 拉过之后底边会掉到屏幕中间（2026-10-19 的反馈）。
        assert.equal(view.bannerSprite.node.size.height, 417,
            n + ' 人：底板高度必须保持 prefab 的 417，实际 ' + view.bannerSprite.node.size.height);
        // 立绘**恒为 256 原生**，不随横幅高度变（2026-10-10 口径「不用放大了，就用 256×256」）。
        //
        // 曾经的旧口径是「立绘 = 横幅高 × 333/417 等比缩放」（2 人局放到 511 高），已删。
        // 这里反过来钉：底板在 640→426→320 变，立绘的scale 必须一直是 1。
        assert.equal(view.roleSprite.node.scale.y, 1,
            n + ' 人：立绘不该被缩放（scale 恒为 1），实际 ' + view.roleSprite.node.scale.y);
        assert.equal(view.roleSprite.node.scale.x, 1, n + ' 人：立绘不该被横向缩放');
        targets.push(256);
    }
    // 立绘高度**不随人数变** —— 旧口径下这里应是递减序列（2人>3人>4人）。
    assert.ok(
        targets[0] === targets[1] && targets[1] === targets[2],
        '立绘高度应恒定（不跟横幅高度走），实际 ' + targets.join(' / '),
    );

    // 高度没变的那几帧**不重写尺寸**（setContentSize 会置脏标记，而 render 是每帧调的）。
    //
    // ⚠️ 必须照渲染层的真实调用形态来测：**每帧先 setLayout 再 render**
    // （`renderLegendBanners` 在循环里对每条横幅都重算落位上下文）。
    // 早期版本在 `setLayout` 里顺手作废 `appliedHeight`，于是每帧都被判成"高度变了"，
    // 每帧 `setContentSize` —— 单测里因为只在 render 前调一次 setLayout
    // 完全测不出来，是靠这条用例逮到的。
    // ⚠️ 桩的 `getComponent(type)` 对**未注册**的类型每次都返回**一个新对象**（见
    // `helpers/zcds-view-fixtures`），所以想观测 `setContentSize` 的调用次数，必须先把
    // 一个**稳定的** UITransform 桩注册进 `components` map —— 否则计数永远拿到别的实例。
    // 早先用 `{...record}` 包一层想拦截，浅拷贝又丢了原型方法（读不到 `height`），
    // 表现为「立绘 scale 恒为 1」这种与被测行为无关的红。最后用**同一个实例**
    // 计数，最省事也最贴近真实。
    //
    // 高度没变的那些帧**不该重写尺寸**（setContentSize 会置引擎脏标记，而 render 是每帧调的）。
    //
    // ⚠️ 必须照渲染层的真实调用形态来测：**每帧先 setLayout 再 render**
    // （`renderLegendBanners` 在循环里对每条横幅都重算落位上下文）。
    // 早期版本在 `setLayout` 里顺手作废 `appliedHeight`，于是每帧都被判成"高度变了"，
    // 每帧 `setContentSize` —— 单测里因为只在 render 前调一次 setLayout
    // 完全测不出来，是靠这条用例逮到的。
    const afterFirst = writes;
    for (let i = 0; i < 5; i += 1) {
        view.setLayout({ playerCount: 4, viewWidth: 720, viewHeight: VH });
        view.render(reveal('player'), 2.2 + i * 0.016);
    }
    assert.equal(writes, afterFirst, '高度没变的 5 帧不该再 setContentSize（setLayout 每帧都调也不该）');
    assert.equal(view.node.size.height, 320);

    // 反过来：人数变了（高度也变）必须**重写**一次，否则底图尺寸与落位对不上。
    view.setLayout({ playerCount: 2, viewWidth: 720, viewHeight: VH });
    view.render(reveal('player'), 2.4);
    assert.ok(
        Math.abs(view.node.size.height - 640) < 1e-6,
        '人数从 4 改回 2 后高度应重设为 640，实际 ' + view.node.size.height,
    );

    // 层高变了（长屏 / 横屏）同样要跟着重设。
    view.setLayout({ playerCount: 2, viewWidth: 720, viewHeight: 1600 });
    view.render(reveal('player'), 2.5);
    assert.ok(
        Math.abs(view.node.size.height - 800) < 1e-6,
        '层高 1600、2 人 ⇒ 每格 800，实际 ' + view.node.size.height,
    );

    // 🔴 宽度不再是常量 720：跟着注入的屏幕宽走（用户 2026-10-19「应该对齐屏幕的宽度」）。
    // 这条是整个改动的主判据 —— 只改根不改底板时，`bannerSprite.node` 会留在 720 宽，右边留缝。
    view.setLayout({ playerCount: 2, viewWidth: 960, viewHeight: VH });
    view.render(reveal('player'), 2.6);
    assert.equal(view.node.size.width, 960, '宽屏：根节点宽度 = 注入的屏幕宽 960');
    assert.equal(view.bannerSprite.node.size.width, 960, '宽屏：底板必须同步铺满，否则右边留缝');
    assert.equal(view.bannerSprite.node.size.height, 417, '宽屏：底板高度仍保持 417（只改宽）');
    assert.equal(view.bannerSprite.node.position.x, 0, '宽屏：底板仍居中');
    // 滑入起点也必须用同一个宽度：`startedAt=0` 时看第一帧 ⇒ x = -(屏宽/2) - 底板半宽 = -960。
    view.render(reveal('player'), 0);
    assert.ok(Math.abs(view.node.position.x + 960) < 1e-6,
        '滑入起点要按实际宽度算（-960），实际 ' + view.node.position.x);
});

test('渲染层把本局人数与全屏层宽高注入横幅，落位按人数重排', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const overlay = new FakeNode('ZCGameHUD');
    // 全屏层宽高（层高是竖排均分的唯一真源；层宽用于滑入动画起止位置）。
    (overlay as Raw).getComponent = () => ({ width: 720, height: 1280 });

    const views: Raw[] = [];
    const world = new ZCGameRenderWorld({
        overlayLayer: overlay,
        board: new FakeNode('board'),
        legendBannerPrefab: { make: (): Raw => {
            const node = new FakeNode('LegendBanner');
            const view: Raw = {
                isValid: true, layout: null,
                setArtResolver() {}, setPortraitResolver() {},
                setLayout(value: unknown) { this.layout = value; },
                render() {},
            };
            views.push(view);
            (node as Raw).components.set(ZCGameLegendBannerView, view);
            return node;
        } },
    });
    const reveal = { id: 1, cardId: '6800', owner: 'player', building: 'barracks', tier: 4, cardName: '卡', unitId: null, luckText: '', hexId: 1, x: 0, y: 0, startedAt: 0, durationSeconds: 2.2 };
    const model = (owners: string[]): Raw => ({
        owners,
        cardReveals: [reveal],
        snapshot: { elapsedSeconds: 0, status: 'playing', pendingSeconds: 0 },
    });

    // ⚠️ 逐字段断言而不是 deepStrictEqual：桩对象来自 `runInNewContext` 的另一个 realm，
    // 跨 realm 的对象原型不同，deepStrictEqual 会报「same structure but not reference-equal」。
    world.renderLegendBanners(model(['player', 'enemy']));
    assert.equal(views[0].layout.playerCount, 2);
    assert.equal(views[0].layout.viewWidth, 720);
    assert.equal(views[0].layout.viewHeight, 1280);

    // 人数变了（3 人局）：已弹出的那条也要按新人数重排 ⇒ 落位上下文每帧重算，不是只在建节点时给一次。
    world.renderLegendBanners(model(['player', 'enemy', 'enemy2']));
    assert.equal(views[0].layout.playerCount, 3);
    assert.equal(views.length, 1, '同一 id 不该新建节点');

    // 模型没有 owners 字段（老快照 / 桩）⇒ 兜底 2 人，不抛错。
    world.renderLegendBanners({ cardReveals: [reveal], snapshot: { elapsedSeconds: 0, status: 'playing', pendingSeconds: 0 } });
    assert.equal(views[0].layout.playerCount, 2);
});

/** 把视图的 14 个引用按prefab 的形态塞好，供行为用例使用。 */
function buildView(view: Raw, FakeNode: new (name?: string) => Raw): Raw {
    const sprite = (): Raw => ({ enabled: true, spriteFrame: null, node: new FakeNode('s') });
    view.bannerOpacity = { opacity: 255 };
    view.bannerSprite = sprite();
    // 底板在 prefab 里是 720×417（`_sizeMode = CUSTOM` ⇒ 尺寸就是设计稿尺寸）。
    // 视图只按屏幕**改宽**，高度必须留在 417 —— 这里先把桩设成 prefab 真值，
    // 否则 `applyLayout` 会按桩的默认 24×4 去"保持"。
    view.bannerSprite.node.size = { width: 720, height: 417 };
    view.roleSprite = sprite();
    view.titleSprite = sprite();
    view.ringSprite = sprite();
    view.headSprite = sprite();
    view.nameLabel = { string: '', enabled: true };
    const bannerFrames: Raw = {};
    const ringFrames: Raw = {};
    for (const { suffix, banner, ring } of OWNER_ART) {
        bannerFrames[suffix] = { name: banner, height: 417 };
        ringFrames[suffix] = { name: ring, height: 76 };
        view[`banner${suffix}`] = bannerFrames[suffix];
        view[`ring${suffix}`] = ringFrames[suffix];
    }
    return view;
}

test('★横幅左边那格优先取「卡牌阵容」那条静态卡面图（cardId → headIcon），取不到才回退兵种/建筑', () => {
    const { load, FakeNode, procedureGame } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const overlay = new FakeNode('ZCGameHUD');

    const views: Raw[] = [];
    const makeBannerNode = (): Raw => {
        const node = new FakeNode('LegendBanner');
        const view: Raw = {
            isValid: true,
            artResolver: null,
            setArtResolver(fn: unknown) { this.artResolver = fn; },
            setPortraitResolver() { /* 本用例不关心 */ },
            setLayout() { /* 同上 */ },
            render() { /* 同上 */ },
        };
        views.push(view);
        (node as Raw).components.set(ZCGameLegendBannerView, view);
        return node;
    };
    const world = new ZCGameRenderWorld({
        overlayLayer: overlay,
        board: new FakeNode('board'),
        legendBannerPrefab: { make: makeBannerNode },
    });

    const reveal = (id: number, cardId: string): Raw => ({
        id, cardId, owner: 'player', building: 'barracks', tier: 4,
        cardName: '卡', unitId: null, luckText: '', hexId: id, x: 0, y: 0,
        startedAt: 0, durationSeconds: 2.2,
    });
    const model = (reveals: Raw[]): Raw => ({
        cardReveals: reveals,
        snapshot: { elapsedSeconds: 0, status: 'playing', pendingSeconds: 0 },
    });

    world.renderLegendBanners(model([reveal(1, '68001')]));
    const view = views[0];
    assert.ok(view, '横幅没建出来');
    // 注入之前：兵种 / 建筑链（桩里都取不到 ⇒ null，视图据此关掉那张 Sprite）。
    assert.equal(view.artResolver(reveal(1, '68001')), null, '没注入卡面图时应回退老链');

    // 注入之后：**已经弹出来的**横幅也要立刻吃到（渲染层负责转发），且优先于兵种图。
    const cardArt = { name: 'cardHead', height: 84 };
    // ⚠️ 渠道已变：早前 ，现在渲染层  直接
    //     现取（ZCGameRenderWorld 的 resolveLegendArt ①）。
    procedureGame.current = {
        resolveCardArt: (cardId: string) => (cardId === '68001' ? cardArt : null),
        // 同一条链的另外两个出口（头像 / 建筑回退）本用例不关心，但必须存在，否则调用即崩。
        resolveLegendPortrait: () => null,
        resolveBuildingFrame: () => null,
    };
    assert.equal(view.artResolver(reveal(1, '68001')), cardArt,
        '★横幅左边的卡面必须用「卡牌阵容」那张静态图（cardId → headIcon）');
    // 没配头像的卡（金矿 / 主城这类）解析为 null ⇒ 自然落回兵种 / 建筑链。
    assert.equal(view.artResolver(reveal(2, '69001')), null, '卡组里没有的卡应回退老链');
});

test('ZCGame 预扫本局卡组的 headIcon 并注入（与卡牌阵容同一条静态图链）', () => {
    const source = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    assert.match(source, /this\.loadLegendCardArt\(\);/, '★预扫入口必须真被调用（只定义不调 = 横幅永远走老链）');
    assert.match(source, /card\.headIcon/, '键要从卡表 `headIcon` 取（不是资源名）');
    assert.match(source, /loadHeadIconFrame\(/, '★必须走 `loadHeadIconFrame`（包名决定目录 cardHead / head），与阵容页同链');
    assert.match(source, /resolveCardArt\(cardId: string\): SpriteFrame \| null/, '★卡面必须经 resolveCardArt 按 id 现取（视图从 ProcedureGame.current 拉，不再由渲染层注入闭包）');
    assert.match(source, /this\.legendCardArtFrames\.get\(cardId\)/, 'resolveCardArt 必须从预扫表取帧（表空 ⇒ 横幅退回兵种图）');
});

/**
 * 需求 2026-10-15 row11：横幅**扇入完成之后**才播 role 节点的生成动画。
 *
 * 原文：「预制体从屏幕外生成，从左往右快速扇入屏幕，**当生成动画完成时**，再展示 role 节点
 * 生成动画（role 初始透明度为 0 或不加载显示），role 节点初始位置 Y 轴为 80，**0.7s 内降至 0**，
 *（X 轴根据父节点移动）」。
 *
 * 两个最容易写错的点，用例里各钉一条：
 *  - 「Y 轴 80 → 0」是**相对静止位**的偏移（prefab 的 Role.y = -28.24），写成绝对值会把立绘永久上移；
 *  - 扇入没播完时 role 必须**完全不可见**（透明度 0），否则会出现「立绘先横着飞进来」。
 */
test('★row11 role 生成动画：扇入播完才开始，0.7s 内从静止位上方 80px 落位并淡入', () => {
    const { load, FakeNode } = loadViews();
    const {
        ZCGameLegendBannerView, legendRoleProgress, legendRoleEase,
        LEGEND_ROLE_DROP_Y, LEGEND_ROLE_GENERATE_SECONDS,
    } = load('./ZCGameLegendBannerView');
    const view = buildView(new ZCGameLegendBannerView(), FakeNode);
    // prefab 里 Role 的静止位（设计稿量测值）。
    const REST_Y = -28.24;
    const REST_X = -192;
    view.roleSprite.node.setPosition(REST_X, REST_Y, 0);

    const DURATION = 2.2;
    const reveal = (): Raw => ({
        id: 1, cardId: '68001', owner: 'player', building: 'barracks', tier: 4,
        cardName: '精灵弓箭手', unitId: null, luckText: '', hexId: 1,
        x: 0, y: 0, startedAt: 0, durationSeconds: DURATION,
    });
    const SLIDE_SECONDS = DURATION * 0.18;
    const roleY = (): number => view.roleSprite.node.position.y;
    const roleAlpha = (): number => view.roleSprite.color.a;

    // ── 纯函数：0.7s 是**秒**，不随 reveal 时长缩放 ──────────────────────
    assert.equal(LEGEND_ROLE_DROP_Y, 80, '需求写的是「初始位置 Y 轴为 80」');
    assert.equal(LEGEND_ROLE_GENERATE_SECONDS, 0.7, '需求写的是「0.7s 内降至 0」');
    assert.equal(legendRoleProgress(SLIDE_SECONDS - 0.001, SLIDE_SECONDS), 0, '扇入没播完 ⇒ 进度 0');
    assert.equal(legendRoleProgress(SLIDE_SECONDS, SLIDE_SECONDS), 0);
    assert.equal(legendRoleProgress(SLIDE_SECONDS + 0.35, SLIDE_SECONDS), 0.5, '0.7s 的一半 ⇒ 进度 0.5');
    assert.equal(legendRoleProgress(SLIDE_SECONDS + LEGEND_ROLE_GENERATE_SECONDS, SLIDE_SECONDS), 1);
    assert.equal(legendRoleProgress(SLIDE_SECONDS + 5, SLIDE_SECONDS), 1, '播完恒 1，不回弹');
    assert.equal(legendRoleProgress(Number.NaN, SLIDE_SECONDS), 0);
    assert.equal(legendRoleEase(0), 0);
    assert.equal(legendRoleEase(1), 1);

    // ── 扇入段：role 全程不可见（透明度 0）、悬在静止位上方 80px ─────────
    for (const t of [0, SLIDE_SECONDS * 0.5, SLIDE_SECONDS - 1e-6]) {
        view.render(reveal(), t);
        assert.equal(roleAlpha(), 0, `扇入没完成（t=${t}）时 role 必须完全不可见`);
        assert.ok(Math.abs(roleY() - (REST_Y + LEGEND_ROLE_DROP_Y)) < 1e-6,
            `扇入段 role 应悬在静止位上方 80px，实际 ${roleY()}`);
    }

    // ── 生成段：0.7s 内落到静止位 + 淡入；X 全程不动 ────────────────────
    view.render(reveal(), SLIDE_SECONDS + LEGEND_ROLE_GENERATE_SECONDS * 0.5);
    // 缓动是 easeOutCubic（出手快、落位稳）⇒ 半程走完 87.5%，透明度与 y 用同一个缓动值。
    const halfEase = legendRoleEase(0.5);
    assert.equal(roleAlpha(), Math.round(255 * halfEase), '透明度 = 缓动值');
    const halfY = roleY();
    assert.ok(halfY < REST_Y + LEGEND_ROLE_DROP_Y && halfY > REST_Y,
        `半程应落在「上方 80px」与静止位之间，实际 ${halfY}`);

    view.render(reveal(), SLIDE_SECONDS + LEGEND_ROLE_GENERATE_SECONDS);
    assert.equal(roleAlpha(), 255, '0.7s 走完必须完全不透明');
    assert.ok(Math.abs(roleY() - REST_Y) < 1e-6,
        `0.7s 走完必须**正好落在 prefab 的静止位**（不是绝对 0），实际 ${roleY()}`);
    assert.equal(view.roleSprite.node.position.x, REST_X, 'X 轴不参与动画（跟着父节点走）');

    // 全程 X 都不动。
    view.render(reveal(), 0);
    assert.equal(view.roleSprite.node.position.x, REST_X, '扇入段 X 也不该被改写');

    // 下落过程单调（不会先升后降）。
    let previous = REST_Y + LEGEND_ROLE_DROP_Y + 1;
    for (let t = SLIDE_SECONDS; t <= SLIDE_SECONDS + LEGEND_ROLE_GENERATE_SECONDS; t += 0.05) {
        view.render(reveal(), t);
        const y = roleY();
        assert.ok(y <= previous + 1e-6, `生成段 y 必须单调下降：t=${t} ${previous} → ${y}`);
        previous = y;
    }
    // 末尾那一拍只是步长的最后一格（0.05 的步进在二进制里不精确，未必正落在 0.7s 上），
    // 所以这里只要求「已经贴到静止位」（< 0.5px），**精确落位**由上面那条 0.7s 的断言负责。
    assert.ok(previous - REST_Y < 0.5 && previous >= REST_Y - 1e-6,
        `收尾必须贴到静止位，实际 ${previous}`);
});
