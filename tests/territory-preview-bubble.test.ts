import { stationRenderWithProjection } from './helpers/territory-map-view-sandbox';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeColor, makeStationView } from './helpers/territory-station-fixtures';

/**
 * 2026-11-11 两条口径的行为 + 结构守卫：
 *
 *  ① 「预告关卡节点，展示气泡提示（红色未通过的状态）」—— 提前披露的关卡在
 *     **虚影承载格**上挂一颗红色编号气泡，其余兄弟格保持原样；
 *  ② 「触发异步据点也是直接进入战斗」—— asyncPvp 并入「花银币解锁那一次直开」，
 *     已解锁 / 已通关仍弹 BigMapPlayerLevelPanel，侦查功能不删。
 *
 * 分三层验：数据层（`stationRenderOf` 的输出）、视图层（`TerritoryStationView.render`
 * 真的把气泡节点显示出来、并按虚影锚点抬高）、源码层（判据与名单不漂移）。
 */

const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationPresentation.ts', 'utf8');
const STATION_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const MODEL_SRC = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
/** 详情弹窗分流已从页面迁到 `TerritoryDetailCoordinator`（页面只上报生命周期）。 */
const DETAIL_SRC = readFileSync('assets/script/app/territory/presentation/TerritoryDetailCoordinator.ts', 'utf8');

const BLUE_FRAME = { name: 'frame_03' };
const RED_FRAME = { name: 'frame_02' };
const CLEAR_FRAME = { name: 'pvp_clear_frame' };
const CLEAR_ICON = { name: 'pvp_clear_icon' };
const PVP_PORTRAIT = { name: 'pvp_portrait' };
/** 虚影建筑帧：`applyIconPlacement` / `previewAnchorScale` 要读的四个字段全给齐。 */
const GHOST_FRAME = {
    name: 'ghost_building',
    rect: { x: 0, y: 0, width: 128, height: 96 },
    originalSize: { width: 128, height: 128 },
    offset: { x: 0, y: 0 },
};

type Site = Record<string, unknown>;

function stageSite(overrides: Site = {}): Site {
    return {
        cellId: 213,
        type: 'boss',
        configId: '10005',
        buildingId: '69003',
        footprint: [213, 214, 215],
        unlock: { silverCost: 35, staminaCost: 1, requiredCells: [] },
        ...overrides,
    };
}

interface RenderOptions {
    previewCells?: number[];
    unlocked?: boolean;
    passed?: boolean;
    /** 不传 = 虚影帧取得到；传 null = `stationIconOf` 查不到帧（虚影画不出来）。 */
    ghost?: unknown;
    bindStage?: boolean;
    /** 红色底图没加载到的场景。 */
    noRedFrame?: boolean;
    noPortrait?: boolean;
    /** 2026-11-23 已通关 PVP 的问号徽标两张新图没加载到的场景。 */
    noClearFrames?: boolean;
}

/** 跑真 `stationRenderOf`（VM 夹具的桩表在 helpers/territory-map-view-sandbox 里收口）。 */
function stationRenderOf(site: Site, opts: RenderOptions = {}): Record<string, any> {
    const ghost = opts.ghost === undefined ? GHOST_FRAME : opts.ghost;
    const stage = { chapterId: 1, stage: 2, isBoss: false };
    const input = {
        stageByCell: opts.bindStage === false ? new Map() : new Map([[site.cellId, stage]]),
        art: {
            randomSilverIcon: {},
            chestIcon: null,
            buildFrames: new Map([[Number(site.buildingId), ghost]]),
            levelBubbleFrame: BLUE_FRAME,
            levelBubblePendingFrame: opts.noRedFrame ? undefined : RED_FRAME,
            pvpBubbleAvatarFrame: {},
            pvpBubbleLevelFrame: {},
            pvpClearBubbleFrame: opts.noClearFrames ? undefined : CLEAR_FRAME,
            pvpClearBubbleIcon: opts.noClearFrames ? undefined : CLEAR_ICON,
        },
        playerPortrait: opts.noPortrait ? null : PVP_PORTRAIT,
        playerLevel: 12,
        previewCells: opts.previewCells ?? [],
        siteOpenableCells: [site.cellId],
        pendingFixedResourceCells: [],
        map: { sites: [] },
        progress: {
            isCellUnlocked: () => opts.unlocked ?? false,
            isOwned: () => false,
            isAreaPassed: () => opts.passed ?? false,
        },
    };
    return stationRenderWithProjection()(site, input) as Record<string, any>;
}

// ============================================================
// 一、数据层：预告承载格才挂红色编号气泡
// ============================================================

test('★预告关卡承载格：红色编号气泡 + 虚影锚点帧，且披露不改变「未解锁」状态', () => {
    const out = stationRenderOf(stageSite(), { previewCells: [213, 214, 215] });
    assert.equal(out.levelBubble, '1-2', '文案复用 TerritoryLevelBubble：章节-关卡');
    assert.equal(out.levelBubbleFrame, RED_FRAME, '预告节点一律「未通过」红 frame_02');
    assert.equal(out.previewBubble, true);
    assert.equal(out.levelBubbleAnchorFrame, GHOST_FRAME, '锚点帧 = 虚影那张建筑图');
    // 🔴 披露 ≠ 能开：站点画法仍是未解锁（锁 / 价格），一点没放宽。
    assert.equal(out.icon, null);
    assert.equal(out.isCondition, true);
    assert.equal(out.caption, '35');
});

test('★预告气泡只在虚影承载格：非预告 / 兄弟格 / 资源点 / 没绑关卡都不挂', () => {
    const preview = [213, 214, 215];
    const cases: Array<[string, Site, RenderOptions]> = [
        ['不在 previewCells', stageSite(), { previewCells: [999] }],
        ['footprint 兄弟格没配 buildingId', stageSite({ cellId: 214, buildingId: '' }), { previewCells: preview }],
        ['fixedResource 宝箱格', stageSite({ type: 'fixedResource' }), { previewCells: preview }],
        ['stage 没绑 campaign 行', stageSite(), { previewCells: preview, bindStage: false }],
        ['建筑帧查不到 ⇒ 虚影都画不出来', stageSite(), { previewCells: preview, ghost: null }],
    ];
    for (const [label, site, opts] of cases) {
        const out = stationRenderOf(site, opts);
        assert.equal(out.levelBubble, undefined, `${label}：不该有气泡文案`);
        assert.equal(out.levelBubbleFrame, undefined, `${label}：不该有气泡底图`);
        assert.equal(out.previewBubble, false, `${label}：不该放宽 visible 门槛`);
        assert.equal(out.levelBubbleAnchorFrame, null, `${label}：不该传锚点帧`);
    }
    // 既有守卫的口径：不传 previewCells 时，未解锁条件格仍然没有气泡。
    assert.equal(stationRenderOf(stageSite()).levelBubble, undefined);
});

test('预告的异步据点写 PVP，没绑关卡也写（文案真源不看 stage）', () => {
    const out = stationRenderOf(stageSite({ type: 'asyncPvp' }), {
        previewCells: [213], bindStage: false,
    });
    assert.equal(out.levelBubble, 'PVP');
    assert.equal(out.levelBubbleFrame, RED_FRAME);
    assert.equal(out.levelBubblePortrait, PVP_PORTRAIT);
    assert.ok(out.levelBubbleAvatarFrame, '黄底头像框要跟着头像一起交给视图');
    assert.ok(out.levelBubbleLevelFrame, '等级角标要跟着头像一起交给视图');
    assert.equal(out.levelBubbleLevel, 12);
});

test('PVP 未通关显示头像，区域通关后换成图1问号徽标，其他关卡不变', () => {
    const site = stageSite({ type: 'asyncPvp' });
    const pending = stationRenderOf(site, { unlocked: true });
    assert.equal(pending.levelBubblePortrait, PVP_PORTRAIT);
    assert.equal(pending.levelBubbleFrame, RED_FRAME);
    const passed = stationRenderOf(site, { unlocked: true, passed: true });
    assert.equal(passed.levelBubblePortrait, null, '已通关不再显示头像');
    assert.equal(passed.levelBubbleFrame, CLEAR_FRAME, '已通关换成 94×103 蓝底方图');
    assert.equal(passed.levelBubbleIcon, CLEAR_ICON, '问号徽标图交给视图');
    assert.equal(passed.levelBubblePvpBadge, true, '视图按问号徽标排版');
    assert.equal(passed.levelBubble, undefined, '徽标没有文字，不再写 PVP');
    assert.equal(stationRenderOf(stageSite(), { unlocked: true }).levelBubblePortrait, null);
    assert.equal(stationRenderOf(site, { unlocked: true, noPortrait: true }).levelBubblePortrait, null);
    assert.equal(stationRenderOf(site, { unlocked: true, noRedFrame: true }).levelBubblePortrait, null);
    assert.equal(stationRenderOf(site, { unlocked: true, bindStage: false }).levelBubblePortrait, PVP_PORTRAIT);
});

test('已通关 PVP 缺新图时回退蓝 PVP 胶囊（不让气泡消失）', () => {
    const out = stationRenderOf(stageSite({ type: 'asyncPvp' }), {
        unlocked: true, passed: true, noClearFrames: true,
    });
    assert.equal(out.levelBubblePvpBadge, undefined, '缺图不切徽标');
    assert.equal(out.levelBubbleFrame, BLUE_FRAME, '回退已通关蓝图');
    assert.equal(out.levelBubble, 'PVP', '回退文字胶囊');
});

test('已解锁 / 已通关走正常分支：不走预告标记，底图仍按 isAreaPassed 分色', () => {
    const preview = [213];
    const pending = stationRenderOf(stageSite(), { previewCells: preview, unlocked: true });
    assert.equal(pending.previewBubble, undefined, '已解锁不进未解锁分支');
    assert.equal(pending.levelBubbleFrame, RED_FRAME, '已解锁但没通关 ⇒ 红');
    assert.equal(pending.icon === null, false, '已解锁画实心建筑');

    const passed = stationRenderOf(stageSite(), { previewCells: preview, unlocked: true, passed: true });
    assert.equal(passed.levelBubbleFrame, BLUE_FRAME, '已通关 ⇒ 蓝 frame_03');
});

test('预告气泡红图缺失时回退蓝图，不能让这一格连编号都没有', () => {
    const out = stationRenderOf(stageSite(), { previewCells: [213], noRedFrame: true });
    assert.equal(out.levelBubble, '1-2');
    assert.equal(out.levelBubbleFrame, BLUE_FRAME);
});

// ============================================================
// 二、视图层：under lock 的气泡真的显示，并抬到虚影之上
// ============================================================

function previewContent(extra: Record<string, unknown> = {}) {
    return {
        site: { kind: 'stage', cellId: 213 },
        icon: null,
        caption: '35',
        isCondition: true,
        conditionIcon: {},
        tint: new FakeColor(),
        badge: '',
        interactive: true,
        iconScale: 1,
        levelBubble: '1-2',
        levelBubbleFrame: RED_FRAME,
        ...extra,
    };
}

test('★未解锁条件格（icon=null + isCondition=true）带 previewBubble 时气泡真的可见', () => {
    const { view, badgeLabel } = makeStationView();
    view.render(previewContent({ previewBubble: true, levelBubbleAnchorFrame: GHOST_FRAME }));
    const bubble = badgeLabel.node.parent;
    assert.ok(bubble, '气泡节点要被惰性创建');
    assert.equal(bubble.name, 'LevelBubble');
    assert.equal(bubble.active, true, '预告气泡必须显示');
    assert.equal(badgeLabel.node.active, true);
    assert.equal(badgeLabel.string, '1-2');
});

test('没有 previewBubble 时，同样的未解锁内容不显示气泡（旧守卫不破）', () => {
    const { view, badgeLabel } = makeStationView();
    view.render(previewContent({ levelBubbleAnchorFrame: GHOST_FRAME }));
    assert.equal(badgeLabel.node.active, false);
    assert.equal(badgeLabel.node.parent?.name, 'LevelBubble', '文字挂在气泡子树里');
    assert.equal(view.levelBubbleNode.parent?.name, 'StationBadgeLayer');
    assert.equal(view.levelBubbleNode.active, false);
});

test('★锚点帧把预告气泡抬到虚影建筑顶上，而不是压回格心', () => {
    const { view, badgeLabel } = makeStationView();
    view.render(previewContent({ previewBubble: true, levelBubbleAnchorFrame: GHOST_FRAME }));
    const withAnchor = badgeLabel.node.parent!.position.y;
    view.render(previewContent({ previewBubble: true, levelBubbleAnchorFrame: null }));
    const withoutAnchor = badgeLabel.node.parent!.position.y;
    // 可见高 = 96 × 128/128 × (84/128) = 63；气泡按 height/2 ≈ 31.5px 抬起。
    assert.ok(withAnchor > withoutAnchor + 20,
        `锚点帧没生效：${withAnchor} 应明显高于 ${withoutAnchor}`);
    assert.equal(badgeLabel.node.parent!.active, true, '锚点帧清空后气泡仍在（只是位置回落）');
});

test('预告气泡仍受 hidden / isLoading / hintBubbleSuppressed 约束（只放宽那两条门槛）', () => {
    for (const extra of [{ hidden: true }, { isLoading: true }]) {
        const { view, badgeLabel } = makeStationView();
        view.render(previewContent({ previewBubble: true, levelBubbleAnchorFrame: GHOST_FRAME, ...extra }));
        assert.equal(badgeLabel.node.active, false, `previewBubble 不能豁免 ${Object.keys(extra)[0]}`);
    }
    const { view, badgeLabel } = makeStationView();
    view.setHintBubbleSuppressed(true);
    view.render(previewContent({ previewBubble: true }));
    assert.equal(badgeLabel.node.active, false, '宝箱跳动的抑制开关仍然有效');
});

// ============================================================
// 三、源码层：判据与名单不漂移
// ============================================================

test('★预告判据四条同处一源，且与 syncGhosts 的「只画有 buildingId 那格」同源', () => {
    const at = MAP_VIEW_SRC.indexOf('const bubbleText = territoryLevelBubbleText(site, stage)');
    assert.ok(at > 0, '要能定位预告判据（从文案缓存那一行起）');
    const block = MAP_VIEW_SRC.slice(at, MAP_VIEW_SRC.indexOf('return {', at));
    assert.match(block, /Boolean\(input\.previewCells\?\.includes\(site\.cellId\)\)/,
        '在 previewCells 里（可选链短路，不再给每个未解锁站点分配空数组）');
    assert.match(block, /station\.battle/, '战斗类型来自发布帧的共享投影');
    assert.match(block, /!!site\.buildingId/, '只有虚影承载格才挂气泡');
    assert.match(block, /const bubbleText = territoryLevelBubbleText\(site, stage\)/,
        '文案只算一次（同一帧还要给 levelBubble 复用）');
    assert.match(block, /bubbleText !== undefined/, '要有文案才挂');
    assert.match(block, /stationIconOf\(site, stage, input\.art\)/, '锚点帧与虚影同源');
    assert.match(block, /previewAnchor !== null/, '虚影画不出来就不挂气泡');
    assert.match(MAP_VIEW_SRC, /levelBubbleFrame: previewBubble\s*\? input\.art\.levelBubblePendingFrame/,
        '预告气泡必须取红色未通关底图');
    // 🔴 披露不放宽玩法判据：模型侧仍是「无条件并入揭示集合」，不看解锁/扣费。
    const reveal = readFileSync('assets/script/app/territory/model/TerritoryCellReveal.ts', 'utf8');
    assert.match(reveal, /for \(const cellId of previewCells\) revealed\.add\(cellId\)/);
});

test('★视图只为 previewBubble 放宽两条门槛，不另起一套渲染路径', () => {
    const at = STATION_VIEW_SRC.indexOf('private renderLevelBubble(');
    const block = STATION_VIEW_SRC.slice(at, STATION_VIEW_SRC.indexOf('private ', at + 40));
    assert.match(block, /const preview = content\.previewBubble === true/);
    assert.match(block, /\(preview \|\| \(content\.icon !== null && !content\.isCondition\)\)/,
        '只允许预告这一支绕过「实心建筑 + 非条件格」');
    assert.match(block, /!content\.hidden && !content\.isLoading && !this\.hintBubbleSuppressed/,
        '其余三道门槛必须原样保留');
    assert.match(STATION_VIEW_SRC, /previewAnchorScale\(\) : this\.iconBaseScale/,
        '锚点缩放必须换一套，不能继续用站点 icon 的基准缩放');
    assert.match(STATION_VIEW_SRC, /this\.levelBubbleAnchorFrame = null/, 'dispose 要复位池化字段');
});

test('★异步据点并入「解锁即直开」，已解锁 / 已通关仍弹侦查面板', () => {
    assert.match(MODEL_SRC, /if \(this\.levelAutoStart && lockedStage && this\.isAutoStartSite\(site\)\)/);
    const at = MODEL_SRC.indexOf('private isAutoStartSite(');
    assert.ok(at > 0, '直开名单要有独立真源');
    const method = MODEL_SRC.slice(at, MODEL_SRC.indexOf('\n    }', at));
    assert.match(method, /return this\.isBattleSite\(site\)/,
        '直开名单 = 全部战斗站点（stage / boss / asyncPvp）');
    assert.doesNotMatch(MODEL_SRC, /isLevelSite\(/, '旧「只给主线关卡」的判据必须彻底退役');
    // 已解锁 / 已通关仍走 detailSite ⇒ 页面照旧弹 BigMapPlayerLevelPanel。
    assert.match(MODEL_SRC, /this\.detailSite = site;/);
    assert.match(DETAIL_SRC, /if \(detail\.playerStage\)/);
    assert.match(DETAIL_SRC, /BigMapPlayerLevelPanel/, '侦查面板不许被顺手删掉');
    // 绑不到 campaign 行仍退回「只解锁」，不发空请求。
    assert.match(MODEL_SRC, /void this\.handleUnlockOnly\(site, TERRITORY_TEXTS\.stageUnlocked\)/);
});
