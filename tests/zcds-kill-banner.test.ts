import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { assetPath } from './helpers/asset-paths';
import { readSource } from './helpers/source-text';

const PREFAB_PATH = assetPath('ui/game/ZCGameKillBanner.prefab');
const SCRIPT_META = 'assets/script/app/zcds/view/ZCGameKillBannerView.ts.meta';
const CIRCLE_AVATAR_CID = '01878nXjfNErJIegipglTTn';
const LAYER = 33554432;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Cocos uuid → 23 位压缩 cid（与 `tests/prefab-root-script.test.ts` 同一算法）。*/
function compressUuid(uuid: string): string {
    const s = String(uuid).replace(/-/g, '');
    assert.equal(s.length, 32, `不是合法 uuid: ${uuid}`);
    let out = s.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const a = parseInt(s[i], 16);
        const b = parseInt(s[i + 1], 16);
        const c = parseInt(s[i + 2], 16);
        out += B64[(a << 2) | (b >> 2)] + B64[((b & 3) << 4) | c];
    }
    return out;
}

const KILL_BANNER_CID = compressUuid(JSON.parse(readFileSync(SCRIPT_META, 'utf8')).uuid as string);
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

/** 头像盘 / 底板按席位映射；suffix 对得上视图 @property 字段名。*/
const OWNER_ART = [
    { owner: 'player', suffix: 'Player' },
    { owner: 'enemy', suffix: 'Enemy' },
    { owner: 'enemy2', suffix: 'Enemy2' },
    { owner: 'enemy3', suffix: 'Enemy3' },
] as const;

test('ZCGameKillBanner 结构：7 节点、底板与文字同处 Slant、头像独立不随底板抬头', () => {
    const objects = loadPrefab();
    const { load } = loadViews();
    const { KILL_BANNER_SLANT_DEGREES } = load('./ZCGameKillBannerView');
    assert.equal(objects[0].__type__, 'cc.Prefab');
    const nodes = objects.map((item, index) => (item.__type__ === 'cc.Node' ? index : -1))
        .filter((index) => index >= 0);
    assert.equal(nodes.length, 7);
    assert.equal(objects[0].data.__id__, nodes[0], 'cc.Prefab.data 必须指向真根节点');

    const root = nodes[0];
    assert.equal(objects[root]._name, 'ZCGameKillBanner');
    // 渲染顺序：Slant（底板 + 文字）在下，Portrait（头像盘）压在上面 —— 头像高出横栏上下沿。
    assert.deepEqual(
        (objects[root]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['Slant', 'Portrait'],
    );
    const slant = nodeIndexByName(objects, 'Slant');
    assert.deepEqual(
        (objects[slant]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['Plate', 'Name'],
    );
    const portrait = nodeIndexByName(objects, 'Portrait');
    assert.deepEqual(
        (objects[portrait]._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name),
        ['Disc', 'Head'],
    );

    const LAYOUT: Record<string, { pos: [number, number]; size: [number, number] }> = {
        ZCGameKillBanner: { pos: [0, 0], size: [720, 70] },
        Slant: { pos: [0, 0], size: [720, 70] },
        Plate: { pos: [0, 0], size: [720, 70] },
        // 文字区左起 218、右留 20 ⇒ 478 宽、中心 x = (−360+218 + 360−20)/2 = 97。
        Name: { pos: [99, 0], size: [482, 44] },
        // 盘心距屏幕左缘 160 ⇒ 局部 x = −360 + 160 = −200。
        Portrait: { pos: [-200, 0], size: [88, 88] },
        Disc: { pos: [0, 0], size: [88, 88] },
        Head: { pos: [0, 0], size: [74, 74] },
    };
    for (const [name, expected] of Object.entries(LAYOUT)) {
        const index = nodeIndexByName(objects, name);
        const transform = componentOf(objects, index, 'cc.UITransform');
        assert.equal(transform._contentSize.width, expected.size[0], `${name} 宽`);
        assert.equal(transform._contentSize.height, expected.size[1], `${name} 高`);
        assert.equal(objects[index]._lpos.x, expected.pos[0], `${name} x`);
        assert.equal(objects[index]._lpos.y, expected.pos[1], `${name} y`);
        assert.equal(objects[index]._layer, LAYER, `${name} layer 必须与 UI 2D 层一致`);
    }

    // 横栏整体向右上抬 2.1°；头像容器不跟着转（截图里头像是直立的）。
    assert.equal(objects[slant]._euler.z, KILL_BANNER_SLANT_DEGREES, 'Slant 抬头角');
    assert.ok(Math.abs(objects[slant]._lrot.z - Math.sin((2.1 * Math.PI) / 360)) < 1e-5, 'Slant 四元数 z');
    assert.equal(objects[portrait]._euler.z, 0, 'Portrait 不能继承抬头角');

    // 根节点组件：UIOpacity + 视图脚本；缺脚本会被运行时补成引用全 null 的空壳。
    const rootTypes = (objects[root]._components ?? [])
        .map((ref: { __id__: number }) => objects[ref.__id__]?.__type__ as string);
    assert.ok(rootTypes.includes('cc.UIOpacity'), '根节点缺 UIOpacity');
    assert.ok(rootTypes.includes(KILL_BANNER_CID), `根节点缺视图脚本 ${KILL_BANNER_CID}`);
    assert.ok(!rootTypes.includes('cc.MissingScript'), '根节点出现 cc.MissingScript');

    const view = componentOf(objects, root, KILL_BANNER_CID);
    const expectRef = (field: string, type: string): void => {
        const target = objects[view[field]?.__id__ as number];
        assert.equal(target?.__type__, type, `${field} 应指向 ${type}`);
    };
    expectRef('bannerOpacity', 'cc.UIOpacity');
    expectRef('slantNode', 'cc.Node');
    expectRef('plateSprite', 'cc.Sprite');
    expectRef('nameLabel', 'cc.Label');
    expectRef('portraitNode', 'cc.Node');
    expectRef('discSprite', 'cc.Sprite');
    expectRef('headSprite', 'cc.Sprite');
    const frameUuid = (field: string): string => {
        const uuid = (view[field]?.__uuid__ ?? '') as string;
        assert.match(uuid, /@f9941$/, `${field} 必须是 spriteFrame 子资源`);
        return uuid;
    };
    assert.equal(frameUuid('platePlayer'), 'd90770d4-6171-4365-8ac9-c82b9f3d4401@f9941', '我方 = kill_banner_02（蓝）');
    assert.equal(frameUuid('plateEnemy'), 'da9af101-bf43-42b2-9dde-19e0e823527c@f9941', '2 号 = kill_banner_01（红）');
    assert.equal(frameUuid('plateEnemy2'), 'd572796a-7768-4c81-930c-60f3017d91ad@f9941', '3 号 = kill_banner_04（黄）');
    assert.equal(frameUuid('plateEnemy3'), 'bb882519-9edf-4e1c-9068-b4af8753084e@f9941', '4 号 = kill_banner_03（紫）');
    assert.equal(frameUuid('discPlayer'), '5bdecc50-0c1b-4e44-b9b2-6ca5935a67fe@f9941', '我方盘 = zd_txk_01');
    assert.equal(frameUuid('discEnemy'), '972fe43f-1edf-460a-9b2e-9fb5019e1147@f9941');
    assert.equal(frameUuid('discEnemy2'), 'b19e4645-1f8b-4854-9a69-f766092fef6f@f9941');
    assert.equal(frameUuid('discEnemy3'), '3bc19b79-8270-48e8-a088-116d94979810@f9941');

    // 底板：CUSTOM + 不裁边（meta trimType=auto，trim 后 696 宽，CUSTOM 720 才满铺）。
    const plate = componentOf(objects, nodeIndexByName(objects, 'Plate'), 'cc.Sprite');
    assert.equal(plate._sizeMode, 0, 'Plate 必须 CUSTOM');
    assert.equal(plate._isTrimmedMode, false, 'Plate 不能裁边，否则左右各少 12px');
    assert.equal(plate._spriteFrame.__uuid__, 'd90770d4-6171-4365-8ac9-c82b9f3d4401@f9941');
    const disc = componentOf(objects, nodeIndexByName(objects, 'Disc'), 'cc.Sprite');
    assert.equal(disc._sizeMode, 0);
    assert.equal(disc._isTrimmedMode, false);
    const head = nodeIndexByName(objects, 'Head');
    const headSprite = componentOf(objects, head, 'cc.Sprite');
    assert.equal(headSprite._sizeMode, 0, 'Head 尺寸由视图按席位改（74 / 66）');
    const avatar = componentOf(objects, head, CIRCLE_AVATAR_CID);
    assert.deepEqual(
        { radius: avatar.radius, feather: avatar.feather, cover: avatar.cover },
        { radius: 0.5, feather: 0.4, cover: true },
        '头像裁圆参数必须与 HUD 玩家行一致',
    );

    // 文字：白字 + 深藏青描边、36 号加粗、SHRINK 不换行。
    const label = componentOf(objects, nodeIndexByName(objects, 'Name'), 'cc.Label');
    assert.equal(label._fontSize, 36);
    assert.equal(label._lineHeight, 44);
    assert.equal(label._isBold, true);
    assert.equal(label._overflow, 2, 'SHRINK：名字过长时缩字号，不换行');
    assert.equal(label._enableWrapText, false);
    assert.equal(label._horizontalAlign, 0, '左对齐');
    assert.ok(label._string.length > 0, 'Name 必须带占位文案，否则 prefab 在编辑器里只剩空节点');
    assert.deepEqual([label._color.r, label._color.g, label._color.b, label._color.a], [255, 255, 255, 255]);
    assert.equal(label._enableOutline, true);
    assert.equal(label._outlineWidth, 3);
    assert.deepEqual(
        [label._outlineColor.r, label._outlineColor.g, label._outlineColor.b],
        [7, 22, 60],
        '描边色 #07163C',
    );

    // 引用自检：所有 __id__ 在范围内、fileId 唯一且 22 位、父子链互相认得。
    for (const [index, item] of objects.entries()) {
        JSON.stringify(item, (key, value) => {
            if (key === '__id__' && (typeof value !== 'number' || value < 0 || value >= objects.length)) {
                throw new Error(`obj#${index} 的 __id__ 越界: ${value}`);
            }
            return value;
        });
    }
    const fileIds = new Set<string>();
    for (const item of objects) {
        const fileId = (item as { fileId?: string }).fileId;
        if (!fileId) continue;
        assert.equal(fileId.length, 22, `fileId 长度异常: ${fileId}`);
        assert.ok(!fileIds.has(fileId), `fileId 重复: ${fileId}`);
        fileIds.add(fileId);
    }
    assert.equal(fileIds.size, 21, '7 个节点 + 14 个组件各一个 fileId');
    for (const index of nodes) {
        const node = objects[index];
        const parent = node._parent?.__id__ as number | undefined;
        if (parent === undefined) continue;
        assert.ok(
            objects[parent]._children.some((ref: { __id__: number }) => ref.__id__ === index),
            `${node._name} 的父节点不认识它`,
        );
    }
});

/** 按 prefab 形态塞好 14 个引用，供行为用例使用。*/
function buildView(view: Raw, FakeNode: new (name?: string) => Raw): Raw {
    const sprite = (): Raw => ({ enabled: true, spriteFrame: null, node: new FakeNode('s') });
    view.node = new FakeNode('ZCGameKillBanner');
    view.node.size = { width: 720, height: 70 };
    view.bannerOpacity = { opacity: 255 };
    view.slantNode = new FakeNode('Slant');
    view.slantNode.size = { width: 720, height: 70 };
    view.plateSprite = sprite();
    view.plateSprite.node.size = { width: 720, height: 70 };
    view.nameLabel = { string: '', node: new FakeNode('Name') };
    view.nameLabel.node.size = { width: 478, height: 44 };
    view.portraitNode = new FakeNode('Portrait');
    view.portraitNode.size = { width: 88, height: 88 };
    view.discSprite = sprite();
    view.headSprite = sprite();
    for (const { suffix } of OWNER_ART) {
        view[`plate${suffix}`] = { name: `plate${suffix}` };
        view[`disc${suffix}`] = { name: `disc${suffix}` };
    }
    return view;
}

test('击杀横栏：落位 / 换色 / 文案 / 滑入淡出 / 可重复触发', () => {
    const { load, FakeNode } = loadViews();
    const view = buildView(new (load('./ZCGameKillBannerView').ZCGameKillBannerView)(), FakeNode);
    view.setLayout({ viewWidth: 720, viewHeight: 1280 });
    view.setOwnerNames(new Map([['enemy', { name: '茶味孤笛' }]]));
    view.setPortraitResolver((owner: string) => (owner === 'enemy' ? { name: 'headEnemy' } : null));
    const reveal = {
        id: 7, cardId: '68007', owner: 'enemy', building: 'barracks', tier: 4,
        cardName: '吞噬大嘴花', unitId: null, luckText: '', hexId: 1, x: 0, y: 0,
        startedAt: 0, durationSeconds: 1.156, monsterClaim: true,
    };

    view.render(reveal, 0);
    // 文案 = 席位名 + 击杀了 + 野怪名。
    assert.equal(view.nameLabel.string, '茶味孤笛 击杀了 吞噬大嘴花');
    // 底板按色相对齐，头像盘按 HUD 席位（2 号 = zd_txk_02）。
    assert.equal(view.plateSprite.spriteFrame.name, 'plateEnemy');
    assert.equal(view.discSprite.spriteFrame.name, 'discEnemy');
    assert.equal(view.headSprite.spriteFrame.name, 'headEnemy');
    assert.equal(view.headSprite.enabled, true);
    // 2 号盘的尺寸档：盘 77 / 头像 66（容器保持 88，盘在容器里居中）。
    assert.equal(view.discSprite.node.getComponent().contentSize.width, 77);
    assert.equal(view.discSprite.node.getComponent().contentSize.height, 77);
    // 落位：满宽、顶边距层顶 560 ⇒ 中心 y = 640 − 560 − 35 = 45；起点在屏外一整条。
    assert.equal(view.node.position.x, -720, 'progress 0 必须在屏幕外');
    assert.equal(view.node.position.y, 45);
    assert.equal(view.bannerOpacity.opacity, 0, 'progress 0 不能先闪一帧');
    assert.ok(Math.abs(view.portraitNode.scale.x - 0.55) < 1e-6, '头像从 0.55 弹入');
    // 文字区：左起 218、右留 20 ⇒ 478 宽。
    assert.equal(view.nameLabel.node.getComponent().contentSize.width, 482);
    assert.equal(view.nameLabel.node.position.x, 99);

    // 滑入段结束（0.18 × 1.156 = 0.208s）：落位、全不透明。
    view.render(reveal, 0.208);
    assert.ok(Math.abs(view.node.position.x) < 1e-4, '滑入结束应正好落位');
    assert.equal(view.bannerOpacity.opacity, 255);
    // 头像在 0.22s 内站定（0.11s 处于 easeOutBack 过冲段）。
    view.render(reveal, 0.22);
    assert.equal(view.portraitNode.scale.x, 1);

    // 尾段淡出，走完进度 0 透明（节点由渲染层隐藏）。
    view.render(reveal, 1);
    assert.ok(view.bannerOpacity.opacity > 0 && view.bannerOpacity.opacity < 255, '尾段应在淡出中');
    view.render(reveal, 1.156);
    assert.equal(view.bannerOpacity.opacity, 0);

    // 重复触发：新 id / 新席位 ⇒ 底板、头像、文案全换，并从屏外重新滑入。
    const second = {
        ...reveal, id: 8, owner: 'player', cardName: '石甲虫', startedAt: 2,
    };
    view.render(second, 2);
    assert.equal(view.plateSprite.spriteFrame.name, 'platePlayer');
    assert.equal(view.discSprite.spriteFrame.name, 'discPlayer');
    assert.equal(view.headSprite.enabled, false, '我方头像还没到 ⇒ 只留圆盘');
    assert.equal(view.nameLabel.string, 'player 击杀了 石甲虫', '没有席位名时退回 owner');
    assert.equal(view.node.position.x, -720, '第二次触发也要重新滑入');
    assert.equal(view.discSprite.node.getComponent().contentSize.width, 88, '我方盘 88 / 头像 74');
    // 头像晚到：作废内容键后同一帧补上。
    view.setPortraitResolver((owner: string) => (owner === 'player' ? { name: 'headPlayer' } : null));
    view.render(second, 2.5);
    assert.equal(view.headSprite.spriteFrame.name, 'headPlayer');
    assert.equal(view.headSprite.enabled, true);

    // 层宽变化：横栏跟着满宽，头像盘心距左缘恒定 160，文字区宽度跟着变。
    view.setLayout({ viewWidth: 1000, viewHeight: 1280 });
    view.render(second, 2.6);
    assert.equal(view.node.getComponent().contentSize.width, 1000);
    assert.equal(view.portraitNode.position.x, -1000 / 2 + 160);
    assert.equal(view.nameLabel.node.getComponent().contentSize.width, 1000 - 218 - 20);
    assert.equal(view.nameLabel.node.position.x, 99);
});

test('渲染世界：只取最新一条 monsterClaim，结束隐藏，prefab 缺失退回旧传说卡横幅', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { ZCGameKillBannerView } = load('./ZCGameKillBannerView');
    const { ZCGameLegendBannerView } = load('./ZCGameLegendBannerView');
    const overlay = new FakeNode('ZCGameHUD');
    overlay.size = { width: 720, height: 1280 };
    // 全屏层宽高（与 legend 用例同一桩法：世界读的是 UITransform 的 width / height）。
    (overlay as Raw).getComponent = () => ({ width: 720, height: 1280 });

    const killViews: Raw[] = [];
    const killNodes: Raw[] = [];
    const killPrefab = {
        make: (): Raw => {
            const node = new FakeNode('KillBanner');
            const view: Raw = {
                isValid: true,
                setOwnerNames(names: unknown) { this.ownerNames = names; },
                setPortraitResolver(fn: unknown) { this.portrait = fn; },
                setLayout(placement: unknown) { this.layout = placement; },
                refreshPortrait() { this.refreshes = (this.refreshes ?? 0) + 1; },
                render(reveal: unknown, now: number) { this.reveal = reveal; this.now = now; },
            };
            killViews.push(view);
            killNodes.push(node);
            (node as Raw).components.set(ZCGameKillBannerView, view);
            return node;
        },
    };
    const legendViews: Raw[] = [];
    const legendPrefab = {
        make: (): Raw => {
            const node = new FakeNode('LegendBanner');
            const view: Raw = {
                isValid: true,
                setArtResolver() {},
                setOwnerNames() {},
                setPortraitResolver() {},
                setLayout() {},
                render() {},
            };
            legendViews.push(view);
            (node as Raw).components.set(ZCGameLegendBannerView, view);
            return node;
        },
    };
    const killReveal = (id: number): Raw => ({
        id, cardId: '68007', owner: 'enemy', building: 'barracks', tier: 4,
        cardName: '吞噬大嘴花', unitId: null, luckText: '', hexId: id, x: 0, y: 0,
        startedAt: 0, durationSeconds: 1.156, monsterClaim: true,
    });
    const normalReveal = (id: number): Raw => ({
        ...killReveal(id), cardId: '68001', cardName: '金卡', monsterClaim: false,
    });
    const model = (reveals: Raw[]): Raw => ({
        cardReveals: reveals,
        snapshot: { elapsedSeconds: 0, status: 'playing', pendingSeconds: 0 },
    });

    const world = new ZCGameRenderWorld({ overlayLayer: overlay, killBannerPrefab: killPrefab, legendBannerPrefab: legendPrefab });
    // 没有击杀帧：不建节点。
    world.renderKillBanners(model([]));
    assert.equal(killViews.length, 0);
    assert.equal(overlay.children.length, 0);

    world.renderKillBanners(model([normalReveal(1)]));
    assert.equal(killViews.length, 0, '普通卡不弹击杀横栏');

    world.renderKillBanners(model([killReveal(2), killReveal(5), normalReveal(6)]));
    assert.equal(killViews.length, 1);
    assert.equal(overlay.children.length, 1);
    assert.equal(overlay.children[0].name, 'KillBanner');
    assert.equal(overlay.children[0].getSiblingIndex(), 0, '挂全屏层末位');
    assert.equal(killViews[0].reveal.id, 5, '同时多条取 id 最大的');
    assert.equal(killViews[0].now, 0);
    assert.deepEqual(
        [killViews[0].layout.viewWidth, killViews[0].layout.viewHeight],
        [720, 1280],
        '落位上下文取全屏层 UITransform',
    );
    assert.equal(overlay.children[0].active, true);

    // 同一帧重复渲染：不重实例化。
    world.renderKillBanners(model([killReveal(5)]));
    assert.equal(killViews.length, 1);
    assert.equal(killViews[0].reveal.id, 5);

    // 队列走完：节点留着但隐藏（重复击杀时省一次实例化）。
    world.renderKillBanners(model([]));
    assert.equal(overlay.children[0].active, false);
    assert.equal(killViews.length, 1);

    // 下一次击杀：同一条节点重新激活并重新滑入。
    world.renderKillBanners(model([killReveal(9)]));
    assert.equal(overlay.children[0].active, true);
    assert.equal(killViews[0].reveal.id, 9);

    // 头像晚到：refreshLegendCardArt 转发给横栏视图（视图据此作废内容键）。
    world.refreshLegendCardArt();
    assert.equal(killViews[0].refreshes, 1);

    // 有 kill prefab 时，野怪那条不再走传说卡横幅；普通金卡照旧。
    world.renderLegendBanners(model([killReveal(10)]));
    assert.equal(legendViews.length, 0, 'monsterClaim 已由击杀横栏接管');
    world.renderLegendBanners(model([normalReveal(12)]));
    assert.equal(legendViews.length, 1, '普通金卡仍走传说卡横幅');

    // 缺 kill prefab：monsterClaim 退回 legend 的旧大字横幅（不静默丢失表现）。
    const overlay2 = new FakeNode('ZCGameHUD');
    overlay2.size = { width: 720, height: 1280 };
    const fallbackWorld = new ZCGameRenderWorld({ overlayLayer: overlay2, legendBannerPrefab: legendPrefab });
    const before = legendViews.length;
    fallbackWorld.renderLegendBanners(model([killReveal(13)]));
    assert.equal(legendViews.length, before + 1, '没有击杀横栏 prefab 时必须回退旧横幅');

    // destroy：单例节点显式销毁，不泄漏到下一局。
    world.destroy();
    assert.equal(overlay.children.length, 0, 'destroy 后全屏层不能残留 KillBanner');
    assert.equal(killNodes[0].isValid, false);
});

test('接线：资源计划 / 加载器 / ZCGame / 渲染世界都把 killBannerPrefab 串起来', () => {
    const plan = readSource('assets/script/app/zcds/model/ZCGameResourcePlan.ts');
    assert.match(plan, /killBanner:\s*'ui\/game\/ZCGameKillBanner'/);
    assert.match(plan, /ZC_BATTLE_SHELL_PATHS\.killBanner/, '公共外壳必须带上它（首屏批次 / 预热同一份清单）');

    const loader = readSource('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /'killBannerPrefab'/);
    assert.match(loader, /killBannerPrefab:\s*ZC_BATTLE_SHELL_PATHS\.killBanner/);
    assert.match(loader, /killBannerPrefab:\s*shellPrefabs\.killBannerPrefab/);

    const prepared = readSource('assets/script/app/zcds/application/ZCGamePreparedResources.ts');
    assert.match(prepared, /killBannerPrefab:\s*Prefab \| null/);

    const game = readSource('assets/script/app/zcds/ZCGame.ts');
    assert.match(game, /killBannerPrefab:\s*prepared\.killBannerPrefab/);
    // 头像要覆盖 3/4 人局的全部席位，不再固定只加载 player/enemy 两席。
    assert.match(game, /this\.seatProfiles\.get\(owner\)\?\.headKey/);
    assert.match(game, /ZC_OWNER_ORDER[\s\S]{0,120}headKey/);

    const world = readSource('assets/script/app/zcds/view/ZCGameRenderWorld.ts');
    assert.match(world, /this\.renderKillBanners\(frame\)/);
    assert.match(world, /killBannerNode\?\.isValid\) this\.killBannerNode\.destroy\(\)/);
});



