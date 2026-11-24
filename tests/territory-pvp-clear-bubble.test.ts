import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadTerritoryMapViewClass, stationRenderWithProjection } from './helpers/territory-map-view-sandbox';
import {
    TERRITORY_PVP_CLEAR_BUBBLE_FRAME_PATH,
    TERRITORY_PVP_CLEAR_BUBBLE_HEIGHT,
    TERRITORY_PVP_CLEAR_BUBBLE_ICON_PATH,
    TERRITORY_PVP_CLEAR_BUBBLE_ICON_SIZE,
    TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y,
    TERRITORY_PVP_CLEAR_BUBBLE_WIDTH,
} from '../assets/script/app/territory/model/TerritoryLevelBubble';
import { BATTLE_BUNDLE, bundleForPath } from '../assets/script/core/asset/BundleCatalog';
import {
    FakeColor,
    FakeSprite,
    makeStationView,
} from './helpers/territory-station-fixtures';

/**
 * 2026-11-23 用户：「仅将**通关**状态/界面的视觉效果改成设计稿中**图1**所示效果」。
 *
 * 图1（蓝湖 `塔防主界面-1`）里，已通关异步据点的标记从「蓝色 94×45 `PVP` 胶囊」
 * 换成 **94×103 蓝底方图 + 74×74 灰盾问号**（切片原名 `frame_04` / `tx_01`）。
 * 未通关的头像气泡、普通关卡编号、宝箱水滴一律不动。
 *
 * 本文件守住四层：
 *  ① 稿面几何（94×103 / 图标 74 / 距顶 10 ⇒ 中心 +4.5）；
 *  ② 图真在 battle 包、meta 是 sprite-frame；
 *  ③ `stationRenderOf` 只改「已通关 asyncPvp」这一支，缺图回退旧胶囊；
 *  ④ 视图真的切 SIMPLE、藏文字 / 头像层，并在池化复用后恢复编号胶囊。
 */

const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationPresentation.ts', 'utf8');
const STATION_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const FRAME_PNG = 'assets/bundles/battle/image/spawn-region/pvp_clear_frame.png';
const ICON_PNG = 'assets/bundles/battle/image/spawn-region/pvp_clear_icon.png';

const BLUE_FRAME = { name: 'frame_03' };
const RED_FRAME = { name: 'frame_02' };
const CLEAR_FRAME = { name: 'pvp_clear_frame' };
const CLEAR_ICON = { name: 'pvp_clear_icon' };
const PVP_PORTRAIT = { name: 'pvp_portrait' };
const GHOST_FRAME = {
    name: 'ghost_building',
    rect: { x: 0, y: 0, width: 128, height: 96 },
    originalSize: { width: 128, height: 128 },
    offset: { x: 0, y: 0 },
};

/** PNG IHDR 宽高（node 里没有图片解码器，读头就够了）。 */
function pngSize(path: string): { width: number; height: number } {
    const bytes = readFileSync(path);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assetMeta(path: string): any {
    return JSON.parse(readFileSync(`${path}.meta`, 'utf8'));
}

function pvpSite() {
    return {
        cellId: 213,
        type: 'asyncPvp',
        configId: '20001',
        buildingId: '69002',
        footprint: [213, 214],
        unlock: { silverCost: 10, staminaCost: 5, requiredCells: [] },
    };
}

function stageSite() {
    return {
        cellId: 213,
        type: 'stage',
        configId: '10001',
        buildingId: '69003',
        footprint: [213, 214],
        unlock: { silverCost: 35, staminaCost: 1, requiredCells: [] },
    };
}

function stationRenderOf(site: Record<string, unknown>, opts: {
    unlocked?: boolean;
    passed?: boolean;
    noClearFrames?: boolean;
    /** 不传 = 该格绑了 campaign 行；传 true = 模拟「关卡表里查不到」。 */
    noStage?: boolean;
    pending?: boolean;
} = {}): Record<string, any> {
    const View = loadTerritoryMapViewClass();
    const view = new View();
    Object.assign(view, {
        stationIconOf: () => GHOST_FRAME,
        stateOf: () => 'available',
    });
    const stage = { chapterId: 1, stage: 2, isBoss: false };
    return stationRenderWithProjection(view)(site, {
        stageByCell: opts.noStage ? new Map() : new Map([[site.cellId, stage]]),
        art: {
            randomSilverIcon: {},
            chestIcon: null,
            levelBubbleFrame: BLUE_FRAME,
            levelBubblePendingFrame: RED_FRAME,
            pvpBubbleAvatarFrame: {},
            pvpBubbleLevelFrame: {},
            pvpClearBubbleFrame: opts.noClearFrames ? undefined : CLEAR_FRAME,
            pvpClearBubbleIcon: opts.noClearFrames ? undefined : CLEAR_ICON,
        },
        playerPortrait: PVP_PORTRAIT,
        playerLevel: 12,
        previewCells: [],
        siteOpenableCells: [site.cellId],
        pendingFixedResourceCells: opts.pending ? [site.cellId] : [],
        map: { sites: [] },
        progress: {
            isCellUnlocked: () => opts.unlocked ?? true,
            isOwned: () => opts.passed ?? false,
            isAreaPassed: () => opts.passed ?? false,
        },
    }) as Record<string, any>;
}

// ============================================================
// 一、稿面几何
// ============================================================

test('★图1 几何：94×103 方图，问号 74×74，中心比气泡中心高 4.5', () => {
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_WIDTH, 94);
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_HEIGHT, 103);
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_ICON_SIZE, 74);
    // 稿里 icon 距顶 10：103/2 - 10 - 74/2 = 4.5
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y, 4.5);
    assert.ok(TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y > 0,
        '底部有尖角，图标必须比几何中心抬高，否则会压到尾巴');
});

test('路径常量指向 battle 包的新图，且与现有 PVP 胶囊 / 宝箱水滴不同名', () => {
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_FRAME_PATH, 'image/spawn-region/pvp_clear_frame/spriteFrame');
    assert.equal(TERRITORY_PVP_CLEAR_BUBBLE_ICON_PATH, 'image/spawn-region/pvp_clear_icon/spriteFrame');
    assert.equal(bundleForPath(TERRITORY_PVP_CLEAR_BUBBLE_FRAME_PATH), BATTLE_BUNDLE);
    assert.equal(bundleForPath(TERRITORY_PVP_CLEAR_BUBBLE_ICON_PATH), BATTLE_BUNDLE);
    // 工程里 `frame_04` 已被宝箱水滴占用（77×87），不能把问号徽标也塞进同一路径。
    assert.notEqual(TERRITORY_PVP_CLEAR_BUBBLE_FRAME_PATH, 'image/spawn-region/frame_04/spriteFrame');
});

// ============================================================
// 二、磁盘真值
// ============================================================

test('★两张图尺寸 / meta 真值：sprite-frame、不打包进 auto-atlas', () => {
    assert.equal(existsSync(FRAME_PNG), true, '蓝底方图不能丢');
    assert.equal(existsSync(ICON_PNG), true, '灰盾问号不能丢');
    assert.deepEqual(pngSize(FRAME_PNG), { width: 94, height: 103 });
    assert.deepEqual(pngSize(ICON_PNG), { width: 74, height: 74 });
    for (const png of [FRAME_PNG, ICON_PNG]) {
        const meta = assetMeta(png);
        assert.equal(meta.userData?.type, 'sprite-frame', `${png} 必须是 sprite-frame`);
        assert.ok(meta.subMetas?.f9941, `${png} 必须有 @f9941 子资源`);
        assert.equal(meta.subMetas.f9941.userData.packable, false,
            `${png} 是单颗展示的大图，别塞进 auto-atlas 被裁边`);
    }
});

// ============================================================
// 三、数据层：只改「已通关 asyncPvp」
// ============================================================

test('★已通关 asyncPvp：换成问号徽标，无文字 / 无头像', () => {
    const out = stationRenderOf(pvpSite(), { passed: true });
    assert.equal(out.levelBubble, undefined, '徽标不写 PVP');
    assert.equal(out.levelBubbleFrame, CLEAR_FRAME);
    assert.equal(out.levelBubbleIcon, CLEAR_ICON);
    assert.equal(out.levelBubblePvpBadge, true);
    assert.equal(out.levelBubblePortrait, null);
    assert.equal(out.levelBubbleAvatarFrame, null);
});

test('未通关 asyncPvp / 普通关卡 / 宝箱不受影响', () => {
    const pending = stationRenderOf(pvpSite(), { passed: false });
    assert.equal(pending.levelBubblePvpBadge, undefined);
    assert.equal(pending.levelBubble, 'PVP');
    assert.equal(pending.levelBubbleFrame, RED_FRAME);
    assert.equal(pending.levelBubblePortrait, PVP_PORTRAIT);
    assert.ok(pending.levelBubbleAvatarFrame, '未通关头像框仍在');

    const stagePending = stationRenderOf(stageSite(), { passed: false });
    assert.equal(stagePending.levelBubblePvpBadge, undefined);
    assert.equal(stagePending.levelBubble, '1-2');
    assert.equal(stagePending.levelBubbleFrame, RED_FRAME);

    const stagePassed = stationRenderOf(stageSite(), { passed: true });
    assert.equal(stagePassed.levelBubblePvpBadge, undefined, '普通关卡通关仍是蓝色编号胶囊');
    assert.equal(stagePassed.levelBubble, '1-2');
    assert.equal(stagePassed.levelBubbleFrame, BLUE_FRAME);
});

test('已通关 asyncPvp 缺任一新图 ⇒ 回退蓝 PVP 胶囊', () => {
    const out = stationRenderOf(pvpSite(), { passed: true, noClearFrames: true });
    assert.equal(out.levelBubblePvpBadge, undefined);
    assert.equal(out.levelBubble, 'PVP');
    assert.equal(out.levelBubbleFrame, BLUE_FRAME);
});

test('★缺关卡行的 asyncPvp 不再锁死：与其它战斗站点同口径（可点 + 已通关徽标）', () => {
    // 旧特例 `if (isAsyncPvp && !stage)` 的 interactive 写成 `!isUnlocked && !isOwned`；
    // 能走到战斗分支的站点必定 `opened = unlocked || owned` ⇒ 恒 false，玩家连解锁都点不动，
    // 且绕开了区域通关口径与问号徽标。2026-11-23 统一到主战斗分支。
    const unlocked = stationRenderOf(pvpSite(), { noStage: true });
    assert.equal(unlocked.interactive, true, '缺 stage 也要能点（解锁 / 打开详情）');
    assert.equal(unlocked.levelBubble, 'PVP', '仍显示 PVP 胶囊');
    assert.equal(unlocked.levelBubbleFrame, RED_FRAME);

    const passed = stationRenderOf(pvpSite(), { noStage: true, passed: true });
    assert.equal(passed.levelBubblePvpBadge, true, '已通关同样切问号徽标，不因缺 stage 分叉');
    assert.equal(passed.levelBubbleFrame, CLEAR_FRAME);
    assert.equal(passed.interactive, true, '已通关仍可点开信息弹窗');

    const inFlight = stationRenderOf(pvpSite(), { noStage: true, pending: true });
    assert.equal(inFlight.interactive, false, '请求在途仍要防连点');
});

test('源码守卫：新分支必须同时看 asyncPvp + claimed + 两张新图', () => {
    const at = MAP_VIEW_SRC.indexOf('const pvpClearBadge');
    assert.ok(at > 0, '要有独立的徽标判据');
    const block = MAP_VIEW_SRC.slice(at, MAP_VIEW_SRC.indexOf('return {', at));
    assert.match(block, /isAsyncPvp && claimed/);
    assert.match(block, /pvpClearBubbleFrame/);
    assert.match(block, /pvpClearBubbleIcon/);
    // 普通关卡那条不许被改：仍按 claimed 取蓝 / 红胶囊。
    assert.match(MAP_VIEW_SRC, /: claimed[\s\S]{0,80}\? input\.art\.levelBubbleFrame/,
        '普通关卡的已通关底色保持 frame_03');
});

// ============================================================
// 四、视图层：切图 + 排版 + 池化复用恢复
// ============================================================

function contentOf(extra: Record<string, unknown> = {}) {
    return {
        site: {},
        icon: GHOST_FRAME,
        caption: '',
        badge: '',
        tint: FakeColor.WHITE,
        interactive: true,
        levelBubbleFrame: CLEAR_FRAME,
        levelBubbleIcon: CLEAR_ICON,
        levelBubblePvpBadge: true,
        ...extra,
    };
}

test('★徽标渲染：SIMPLE 94×103、图标 74 落在 +4.5、文字与头像层全收', () => {
    const { view, badgeLabel } = makeStationView();
    view.render(contentOf());
    assert.equal(view.levelBubbleNode.active, true);
    assert.equal(view.levelBubbleTransform.contentSize.width, TERRITORY_PVP_CLEAR_BUBBLE_WIDTH);
    assert.equal(view.levelBubbleTransform.contentSize.height, TERRITORY_PVP_CLEAR_BUBBLE_HEIGHT);
    assert.equal(view.levelBubbleSprite.type, FakeSprite.Type.SIMPLE, '成品方图不能九宫格拉伸');
    assert.equal(view.levelBubbleSprite.spriteFrame, CLEAR_FRAME);
    assert.equal(view.levelBubbleIconSprite.node.active, true);
    assert.equal(view.levelBubbleIconSprite.spriteFrame, CLEAR_ICON);
    assert.equal(view.levelBubbleIconTransform.contentSize.width, TERRITORY_PVP_CLEAR_BUBBLE_ICON_SIZE);
    assert.equal(view.levelBubbleIconSprite.node.position.y, TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y);
    assert.equal(badgeLabel.node.active, false, '徽标没有文字');
    assert.equal(badgeLabel.string, '');
    assert.equal(view.levelBubbleAvatarFrameSprite.node.active, false, '不能残留未通关头像框');
    assert.equal(view.levelBubbleLevelBadgeSprite.node.active, false);
    assert.equal(view.levelBubbleLevelLabel.node.active, false);
});

test('同一视图复用到普通关卡：恢复 94×45 胶囊与编号文字', () => {
    const { view, badgeLabel } = makeStationView();
    view.render(contentOf());
    view.render({
        site: {},
        icon: GHOST_FRAME,
        caption: '',
        badge: '',
        tint: FakeColor.WHITE,
        interactive: true,
        levelBubble: '1-2',
        levelBubbleFrame: BLUE_FRAME,
    });
    assert.equal(view.levelBubbleTransform.contentSize.height, 45);
    assert.equal(view.levelBubbleSprite.type, FakeSprite.Type.SLICED);
    assert.equal(view.levelBubbleSprite.spriteFrame, BLUE_FRAME);
    assert.equal(view.levelBubbleIconSprite.node.active, false, '图标必须收起');
    assert.equal(badgeLabel.node.active, true);
    assert.equal(badgeLabel.string, '1-2');
});

test('源码守卫：pvpBadge 与头像互斥，且必须藏掉文字层', () => {
    const at = STATION_VIEW_SRC.indexOf('const pvpBadge');
    assert.ok(at > 0);
    const block = STATION_VIEW_SRC.slice(at, STATION_VIEW_SRC.indexOf('const iconFrame', at));
    assert.match(block, /content\.levelBubblePvpBadge === true/);
    assert.match(block, /levelBubblePortrait == null/, '头像优先：未通关不会被误判成徽标');
    assert.match(STATION_VIEW_SRC, /badgeLabel\.node\.active = visible && !portrait && !pvpBadge/);
    assert.match(STATION_VIEW_SRC, /chest \|\| pvpBadge \? Sprite\.Type\.SIMPLE/);
});
