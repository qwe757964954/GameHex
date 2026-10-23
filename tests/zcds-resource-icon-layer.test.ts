/**
 * 中立资源图标必须画在**格子线之上**（`ZCGameBoard.prefab` 的 `ResourceLayer`）。
 *
 * ## 为什么这是一条独立的判据，而不是「缩放」用例的附注
 * 地块整图 130×119、格距只有 92.25×90 ⇒ **相邻格整图互相重叠**，2.5D 那套「后画的整格
 * 盖住先画的」就靠这个顺序。资源图标节点 128×128，比地块顶面 123×90 还大还宽 ⇒ 只要它
 * 还挂在格节点里，伸进邻格的那一段就会被邻格整图沿**格边线**切掉（截图里那把剑中段
 * 被右侧紫色地块吃掉，就是这条）。所以判据钉的是「父子关系 + 坐标系」两件事：
 *
 *  1. 有资源图标 ⇒ 节点被抬到 `ResourceLayer`，坐标要按**棋盘层局部坐标**写
 *     （格节点位置 + BuildingLayer 偏移 + 图标偏移）—— 少补一次偏移，图标就飞到棋盘原点附近；
 *  2. 换回地块类型图标 ⇒ 收回到 `BuildingLayer`，坐标回到 BuildingLayer 局部口径；
 *  3. 没注入资源层（单测桩 / 旧 prefab）⇒ 维持原样，不许崩、也不许乱挂父节点。
 *
 * 另外把「地块类型图标落点下移到金币行上方」这件需求也钉在这里：改动前它停在 12.628，
 * 与底部金币图标之间空出小半格。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import { ZC_HEX_ACTIVATION_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

/** `ZCGameHex.prefab` 上 `BuildingLayer` 的 `_lpos.y`（它挂着 Widget，运行时也钉在这个值）。 */
const BUILDING_LAYER_Y = 15.101;
/** `ZCGameHex.prefab` 上 `BuildingLayer/PriceIcon` 的 `_lpos.y`（缩放 0.65）。 */
const PRICE_ICON_Y = -26.376;
/** `ZCHexView.DEFAULT_TILE_ICON_POS` 的新落点（同步在 prefab 的 BuildingLayer/BuildingIcon 上）。 */
const TILE_ICON_Y = 4;
/** 改动前的旧落点 —— 出现它就说明又退回「上半部图标 / 下半部价格」的两段式了。 */
const OLD_TILE_ICON_Y = 12.628;

/** 与其它 zcds 视图用例同款：补齐 prefab 上全部必填引用，缺一个就是空指针。 */
function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: new cc.Node(), enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    // groundGlow 在 renderTerrain 里被无条件 applyGroundGlowTint（读 color.r/g/b/a），
    // 桩里缺它会让用例在到达资源图标抬层断言前就空指针崩掉。
    view.groundGlow = { node: new cc.Node(), enabled: true, spriteFrame: null, color: new cc.Color(255, 255, 255, 255) };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = new cc.Node('BuildingLayer');
    view.iconLabel = { node: new cc.Node(), string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    // 建视图时渲染层已经 `setPosition` 落好格子位置（`ZCGameRenderWorld` 那段），这里照抄。
    view.buildingLayer.setPosition(0, BUILDING_LAYER_Y, 0);
    view.node.setPosition(300, 200, 0);
    return view;
}

/** 中立资源点格（金币）：走 `frameForResource` ⇒ 有图标 ⇒ 需要抬层。 */
function resourcePresentation(): any {
    return {
        state: {
            id: 1, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: null, developmentResolved: false,
            neutralResourceId: 'gold', cardId: null,
        },
        canDevelop: false,
        playerGold: 0,
        cooldown: null,
        now: 0,
    };
}

/** 我方可开发地块类型格：走 `frameForTileType` ⇒ 图标必须留在格节点里。 */
function tileTypePresentation(): any {
    return {
        state: {
            id: 3, owner: 'player', state: 'developable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: ZCPvpTileType.AllRandom, developmentResolved: false,
            neutralResourceId: null, cardId: null,
        },
        canDevelop: true,
        playerGold: 999,
        cooldown: null,
        now: 0,
    };
}

const near = (actual: number, expected: number, eps = 1e-6): boolean => Math.abs(actual - expected) <= eps;

test('资源图标抬到 ResourceLayer，坐标换算成棋盘层局部坐标（格心 + BuildingLayer 偏移）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);

    const icon = view.iconSprite.node;
    view.render(resourcePresentation());

    assert.equal(view.iconSprite.spriteFrame, view.goldResourceFrame, '判据前提：这格确实画了资源图标');
    assert.equal(icon.parent, layer, '资源图标必须被抬到 ResourceLayer（否则会被邻格整图沿格边线切掉）');
    // 抬层后局部坐标 = 格节点位置 + BuildingLayer 偏移 + 图标在 BuildingLayer 里的偏移。
    // `RESOURCE_ICON_POS` 是 (0, -2.342)，所以 y = 200 + 15.101 - 2.342。
    assert.ok(near(icon.position.x, 300), `x 要补上格心，实际 ${icon.position.x}`);
    assert.ok(near(icon.position.y, 200 + BUILDING_LAYER_Y - 2.342),
        `y 要补上格心与 BuildingLayer 偏移，实际 ${icon.position.y}`);
    assert.equal(icon.position.z, 0);
});

test('换回地块类型图标时收回 BuildingLayer，坐标回到 BuildingLayer 局部口径', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);

    const icon = view.iconSprite.node;
    view.render(resourcePresentation());
    assert.equal(icon.parent, layer);

    view.render(tileTypePresentation());

    assert.ok(icon.parent !== layer, '不再是资源图标 ⇒ 必须离开 ResourceLayer');
    assert.equal(icon.parent, view.buildingLayer, '地块类型图标要回到格节点里（它本来就在格面内，不该压住邻格）');
    assert.ok(near(icon.position.x, -4.801), `回到局部口径后 x，实际 ${icon.position.x}`);
    assert.ok(near(icon.position.y, TILE_ICON_Y), `回到局部口径后 y，实际 ${icon.position.y}`);
    // 反向判据：停在棋盘层坐标（300 / 212.759）就说明只改了父节点没改坐标系。
    assert.ok(!near(icon.position.x, 300), '不能把棋盘层坐标留在原地');
});

test('没注入 ResourceLayer 时维持原样：不抬层、坐标仍是 BuildingLayer 局部值', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 刻意不调 `setResourceIconLayer` —— 模拟旧棋盘 prefab / 单测桩。

    const icon = view.iconSprite.node;
    const parentBefore = icon.parent;

    view.render(resourcePresentation());

    assert.equal(view.iconSprite.spriteFrame, view.goldResourceFrame, '判据前提：资源图标照常显示');
    assert.equal(icon.parent, parentBefore, '缺层时不许乱挂父节点（宁可不抬）');
    // 坐标仍按 BuildingLayer 局部写：`RESOURCE_ICON_POS` 原值。
    assert.ok(near(icon.position.x, 0) && near(icon.position.y, -2.342),
        `缺层时应保持局部坐标，实际 (${icon.position.x}, ${icon.position.y})`);
});

test('对象池复用：initialize 把抬上去的资源图标无条件收回 BuildingLayer', () => {
    const { load, cc, bar } = loadViews();
    // `initialize` 走的是渲染层建视图那条路径 —— 这里只验「回收后图标不留在棋盘层」。
    const view = stubHexView(load, cc, bar);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);
    view.render(resourcePresentation());
    assert.equal(view.iconSprite.node.parent, layer, '判据前提：这一轮确实抬过层');

    // 复用回池子的格子：渲染层会重新 `initialize`（此时 `resourceIconLayer` 还没注入，
    // 所以不能指望 `setResourceIconRaised(false)` 收回来 —— 它必须自己无条件收）。
    view.initialize(() => {});

    assert.equal(view.iconSprite.node.parent, view.buildingLayer,
        '上一局抬上去的图标不能跟着复用回来的格子继续飘在棋盘层');
});

test('激活「整格隐藏」段：抬到棋盘层的资源图标要跟着关，激活结束后回显', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);
    view.render(resourcePresentation());
    const icon = view.iconSprite.node;
    assert.equal(icon.parent, layer, '判据前提：图标已抬层');

    // 卡牌轴 [0, 0.6) 是「整格隐藏」段。激活进度 p 的换算见 `hexActivationFx`：
    // 卡牌进度 = (p - FLIP_END) / (1 - FLIP_END)，取 p = 0.4 落在隐藏段中段。
    const activation = { startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };
    view.renderActivation(activation, 0.4 * ZC_HEX_ACTIVATION_SECONDS);
    assert.equal(icon.active, false, '整格隐藏时，抬层的资源图标不能还飘着（它已不在格节点下）');

    // 激活过期 ⇒ 复位分支，图标要回显。
    view.renderActivation(activation, ZC_HEX_ACTIVATION_SECONDS + 1);
    assert.equal(icon.active, true, '激活结束后抬层的资源图标要回显');
});

test('地块类型图标落点下移：压在底部金币行上方，不再停在上半部的 12.628', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);

    view.render(tileTypePresentation());

    const icon = view.iconSprite.node;
    assert.ok(near(icon.position.y, TILE_ICON_Y), `地块类型图标落点应为 ${TILE_ICON_Y}，实际 ${icon.position.y}`);
    assert.ok(!near(icon.position.y, OLD_TILE_ICON_Y), '不能停在旧落点 12.628');
    assert.ok(icon.position.y < OLD_TILE_ICON_Y, '需求是**往下**挪');
    // 下界：`y = 1.4` 时图标字形刚好切到金币图标（见 ZCHexView 的常量注释），不能越过。
    assert.ok(icon.position.y > 1.4, `不能压到金币图标上，实际 ${icon.position.y}`);
    // 语义判据：图标中心与金币图标中心的间距要比改动前明显收窄。
    const gap = (BUILDING_LAYER_Y + icon.position.y) - (BUILDING_LAYER_Y + PRICE_ICON_Y);
    const oldGap = (BUILDING_LAYER_Y + OLD_TILE_ICON_Y) - (BUILDING_LAYER_Y + PRICE_ICON_Y);
    assert.ok(gap < oldGap, `间距要收窄：新 ${gap} vs 旧 ${oldGap}`);
    assert.ok(near(gap, TILE_ICON_Y - PRICE_ICON_Y), `间距应等于落点差，实际 ${gap}`);
});

/** 中立神器充能点（`artifact_charge`）presentation：图标位走 Spine 而非静态 PNG。 */
function artifactPresentation(): any {
    return {
        state: {
            id: 7, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: null, developmentResolved: false,
            neutralResourceId: 'artifact_charge', cardId: null,
        },
        canDevelop: false,
        playerGold: 0,
        cooldown: null,
        now: 0,
    };
}

/**
 * 给桩视图挂上神器点 Spine 容器（模拟 prefab 已绑的 `ArtifactSpineRoot` + 两个子 `sp.Skeleton`）。
 * 返回容器 / 两个子节点与 `setAnimation` 调用记录，便于断言抬层与播放。
 */
function attachArtifactSpine(view: any, cc: any) {
    const root = new cc.Node('ArtifactSpineRoot');
    const hexNode = new cc.Node('ArtifactHexSpine');
    const questionNode = new cc.Node('ArtifactQuestionSpine');
    root.addChild(hexNode);
    root.addChild(questionNode);
    root.active = false;
    const played: Array<{ who: string; name: string; track: number; loop: boolean }> = [];
    const makeSkeleton = (who: string, node: any) => ({
        node,
        // 模拟编辑器外的初始态：序列化默认动画名还没同步进来，由视图在 show 时主动 setAnimation 兜底。
        animation: '',
        setAnimation: (track: number, name: string, loop: boolean) => { played.push({ who, name, track, loop }); },
    });
    view.artifactSpineRoot = root;
    view.artifactHexSpine = makeSkeleton('hex', hexNode);
    view.artifactQuestionSpine = makeSkeleton('question', questionNode);
    view.buildingLayer.addChild(root);
    return { root, hexNode, questionNode, played };
}

test('神器点：Spine 容器与资源图标同口径抬到 ResourceLayer，坐标补偿到格心，并播放两段循环动画', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const spine = attachArtifactSpine(view, cc);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);

    view.render(artifactPresentation());

    assert.equal(view.iconSprite.spriteFrame, null, '神器点走 Spine ⇒ 静态神器图标不显示');
    assert.equal(spine.root.parent, layer,
        'Spine 容器必须抬到 ResourceLayer（浮动问号 / 光晕超出格子顶面，留在格节点会被邻格整图切掉）');
    assert.equal(spine.root.active, true, '神器点 Spine 容器要显示');
    // 容器落点恒为 RESOURCE_ICON_POS (0,-2.342)，抬层后补「格心 + BuildingLayer 偏移」。
    assert.ok(near(spine.root.position.x, 300), `容器 x 要补格心，实际 ${spine.root.position.x}`);
    assert.ok(near(spine.root.position.y, 200 + BUILDING_LAYER_Y - 2.342),
        `容器 y 要补格心与 BuildingLayer 偏移，实际 ${spine.root.position.y}`);
    // 六边形底播 animation、问号播 ui_indicatorNPC，均循环。
    assert.deepEqual(spine.played.map((p) => [p.who, p.name, p.track, p.loop]),
        [['hex', 'animation', 0, true], ['question', 'ui_indicatorNPC', 0, true]]);
});

test('神器点切回地块类型格：Spine 容器收回 BuildingLayer 并隐藏', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const spine = attachArtifactSpine(view, cc);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);
    view.render(artifactPresentation());
    assert.equal(spine.root.parent, layer, '判据前提：神器点这一轮已抬层');

    view.render(tileTypePresentation());

    assert.equal(spine.root.parent, view.buildingLayer, '不再是神器点 ⇒ 容器收回 BuildingLayer');
    assert.equal(spine.root.active, false, '容器必须隐藏，对象池复用时不残留上一局的问号');
});

test('对象池复用：initialize 把抬上去的 Spine 容器无条件收回 BuildingLayer 并隐藏', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const spine = attachArtifactSpine(view, cc);
    const layer = new cc.Node('ResourceLayer');
    view.setResourceIconLayer(layer);
    view.render(artifactPresentation());
    assert.equal(spine.root.parent, layer, '判据前提：神器点这一轮已抬层');

    // initialize 时 resourceIconLayer 尚未注入，不能指望 setResourceIconRaised(false) 收。
    view.initialize(() => {});

    assert.equal(spine.root.parent, view.buildingLayer,
        '上一局抬上去的 Spine 容器不能跟着复用回来的格子继续飘在 ResourceLayer');
    assert.equal(spine.root.active, false);
});

test('prefab 未绑 Spine（artifactHexSpine 为 null）：神器点回退静态图标/文字兜底，不抛错', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 刻意不挂任何 artifactSpine* —— 模拟旧 prefab / 未绑定引用。
    assert.equal(view.artifactSpineRoot, null);
    assert.equal(view.artifactHexSpine, null);

    assert.doesNotThrow(() => view.render(artifactPresentation()));
    // 不抬层（没 Spine 且无静态神器帧 ⇒ resourceFrame 为 null），容器引用仍为空。
    assert.equal(view.artifactSpineRoot, null);
});
