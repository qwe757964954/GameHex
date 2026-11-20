import { JsonAsset, Prefab, SpriteFrame } from 'cc';
import type { Material } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { RefUtil } from '../../../framework/ref/RefUtil';
import { MAP_MARKER_BUBBLE_FRAME_PASSED_PATH, MAP_MARKER_BUBBLE_FRAME_PENDING_PATH } from '../../common/MapMarkerBadge';
import { TERRITORY_CHEST_BUBBLE_FRAME_PATH } from '../model/TerritoryChestBubble';
import { TERRITORY_PVP_BUBBLE_PORTRAIT_PATH } from '../model/TerritoryLevelBubble';
import {
    ART_ROOT,
    BUILDING_ART_ROOT,
    COMMON_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    spriteFramePath,
    spriteFramePathOf,
    TERRITORY_ART_ROOT,
    TERRITORY_BUILDING_ART_ROOT,
} from '../../ArtPaths';

/**
 * 领地页要用到的美术帧。取不到的项为 `null`，视图会退回矢量兜底（不阻断对局）。
 *
 * **建筑帧按站点类型分**（换新美术）—— 地图 JSON 的 `site.type` 决定用哪张：
 * `stage`→普通关卡 / `boss`→首领 / `asyncPvp`→敌方主城 / `fixedResource`→资源据点 / `bonus`→宝箱；
 * 起始格（`startCellId`，不在 `sites` 里）单独走 `start`。对应关系见 `TerritoryMapView`。
 */
export interface ITerritoryBattleArt {
    readonly monsterPrefabs?: ReadonlyMap<number, Prefab>;
    /**
     * 巡逻野怪的体型系数（`monsterCard.prefabSize`，键 = `monsterCard.id`）。
     *
     * 与战斗内 `ZCUnitView` 同一列、同一口径：**先按骨架高度做技术归一，再乘这个系数**。
     * 缺这一项（老数据 / 表列留空）⇒ 按 1 处理，画出来就是「归一后」的大小。
     */
    readonly monsterPrefabSizes?: ReadonlyMap<number, number>;
    /**
     * 巡逻宝箱怪红色描边副本的材质（`shaders/unit-outline-copy`），由章节加载器建好挂进来。
     * `null` = shader 缺失 ⇒ 视图只压暗、不描边；不在这里 `new Material()` 是为了让
     * `loadTerritoryBattleArt` 保持「只碰美术帧」的单一职责。
     */
    readonly monsterOutlineMaterial?: Material | null;
    readonly background: SpriteFrame | null;
    /**
     * 关卡气泡底图（**已通关**）：蓝 `image/spawn-region/frame_03`。
     *
     * 气泡按「通没通过」二选一 —— 已通关蓝 / **未通关红**（{@link levelBubblePendingFrame}）。
     * 初始点位「章节」也走这一张：它不是「待挑战的关卡」，不该跟着未通关一起变红。
     */
    readonly levelBubbleFrame?: SpriteFrame | null;
    /**
     * **未通关**关卡的气泡底图：红 `image/spawn-region/frame_02`。
     *
     * 取不到时视图回退到 {@link levelBubbleFrame}（宁可蓝一下，也不能没气泡 ——
     * 编号是这一格唯一的关卡标识）。
     */
    readonly levelBubblePendingFrame?: SpriteFrame | null;
    readonly pvpBubblePortrait?: SpriteFrame | null;
    /**
     * **宝箱提示气泡**专用的底图：`image/spawn-region/frame_04`（77×87 竖向水滴，尖朝下）。
     *
     * 需求 「宝箱的气泡框使用新的美术资源 `frame_04`，图标内 icon 和数字的排版参考美术图」。
     * 与关卡编号气泡的 94×45 胶囊**不是同一套**（尺寸、形状、内容行数都不同，见
     * `model/TerritoryChestBubble`）。取不到时视图回退到 {@link levelBubbleFrame} ——
     * 宁可样子旧一点，也不能让宝箱没有提示。
     */
    readonly chestBubbleFrame?: SpriteFrame | null;
    /**
     * **未通关**格的地皮（未解锁 / 已解锁未通关 / 中立格都用它）：`img_land_02` 泥土块。
     *
     * 换口径：地皮由**两张成品美术图**按状态二选一，不再用一张灰度图 + 三色染色。
     */
    readonly tileLocked: SpriteFrame | null;
    /** **已通关**格的地皮：`img_land_01` 草地块。 */
    readonly tileCleared: SpriteFrame | null;
    /**
     * **被锁住**那一格的地皮：`img_land_01_gray` 灰版（「未解锁的地块整个
     * 地块图片都置灰，等切换成可激活时再重新加载颜色」）。
     *
     * 这张是**旧的 130×119**（新地皮 126×117）。锁着的格不画格面框，所以尺寸差只表现为
     * 与邻居 2px 交叠；**不要**为了对齐去拉伸它（`applyTileFrame` 按帧原样给尺寸）。
     */
    readonly tileGrey: SpriteFrame | null;
    /**
     * 未解锁格的锁标：`image/territory/icon_lock`（31×43，蓝湖 `大地图(1)` 同名切片）。
     *
     * 蓝湖新版大地图：未解锁的格子地皮正中压一枚白锁。
     * **只叠在「本来就会露出来」的格上** —— 不给它额外的揭示范围，空格继续留在云里
     * 「不该多露空格」。
     *
     * 尺寸按帧原样显示（`sizeMode = RAW`），设计稿 720 宽下锁就是 31×43，别在代码里写死宽高。
     */
    readonly lockIcon: SpriteFrame | null;
    /**
     * 「已解锁但还没通关」的**格面高亮框**，按站点类型四选一，叠在地皮之上。
     *
     * 通关后**必须摘掉**（`TerritoryMapView.paintHexes` 里 `passed ⇒ frame = null`）——
     * 框的语义就是「这里有东西可打」，打完了再留着会读成「还能再打一次」。
     */
    readonly frameBoss: SpriteFrame | null;
    /**
     * 普通关卡（`stage`）的框。
     *
     * **与首领同图（红）**：原来的 `frame_03` 紫框已被用户否掉。
     */
    readonly frameStage: SpriteFrame | null;
    readonly frameAsyncPvp: SpriteFrame | null;
    /** 宝箱格（`fixedResource`）的框。 美术文件名是 `fram_02`（**少一个 e**），别"顺手改对"。 */
    readonly frameChest: SpriteFrame | null;
    /** 起始格：我方基地。 */
    readonly start: SpriteFrame | null;
    /** `stage` 普通关卡。 */
    readonly stage: SpriteFrame | null;
    /** `boss` 首领据点。 */
    readonly boss: SpriteFrame | null;
    /** `asyncPvp` 异步据点（敌方主城外观）。 */
    readonly asyncPvp: SpriteFrame | null;
    /** `fixedResource` 资源据点。 */
    readonly fixedResource: SpriteFrame | null;
    /** 解锁后的随机资源建筑。 */
    readonly randomResource: SpriteFrame | null;
    /** 随机资源候选格的开启条件银币图标。 */
    readonly randomSilverIcon: SpriteFrame | null;
    /**
     * 固定宝箱格「**可激活**」时压在价格行上方的那颗宝箱图标：`image/territory/icon_baoxiang`（58×45）。
     *
     * 需求 （附美术效果图）：`fixedResource` 格可激活时，价格行照旧显示
     * `银币 icon + 数字`，**上面再加一颗宝箱 icon**（排版见 `model/TerritoryConditionBadge`）；
     * 未解锁（前置没满足 / 还没开）仍然**只画锁**，不画这颗。
     *
     * 与 {@link frameChest}（宝箱**格面框** `fram_02`）不是一回事：这张是格心的指示图标。
     * 取不到 ⇒ 退回旧版（只有价格行一行），不阻断对局。
     */
    readonly chestIcon: SpriteFrame | null;
    /**
     * 固定宝箱提示气泡里的**体力图标**（`roleProperty` 的 `图标_体力`，与领奖飘字同一张）。
     *
     * 需求 「领地里固定奖励宝箱加气泡提示，气泡内是**体力 icon + 需要消耗的数量值**」。
     * 与 {@link randomSilverIcon} 同一套取图口径（`RESOURCE_ICON_ART_ROOT` 下的中文图名）。
     */
    readonly staminaIcon: SpriteFrame | null;
    /** `bonus` 奖励据点。 */
    readonly bonus: SpriteFrame | null;
    readonly header: SpriteFrame | null;
    readonly navButton: SpriteFrame | null;
    readonly actionButton: SpriteFrame | null;
    /**
     * 建筑表按 `buildId` 查到的帧（**键是数字** `buildId`）。
     *
     * 与 `TerritoryMapView.stationIconOf` 的查表口径一致：站点配了 `buildingId` 就走这里，
     * 没配 / 查不到才回退到按 `site.type` 取图。
     */
    readonly buildFrames: ReadonlyMap<number, SpriteFrame | null>;
    /**
     * `buildId → buildSize`，缺省 1。
     *
     * 与 buildFrames 分开存放，避免把帧字段改成对象影响现有回退逻辑；
     * 倍率仅供下游乘入缩放。
     */
    readonly buildScales: ReadonlyMap<number, number>;
}

/**
 * 领地建筑表的一行。
 *
 * 外观由地图 JSON 的 buildingId 决定，buildType 只用于策划分类，不参与选图。
 */
export interface ITerritoryBuildRow {
    readonly buildId: number;
    readonly buildType: number;
    /** `resources` 相对路径（无扩展名、无 `/spriteFrame`），如 `image/territory/buildings/territory_boss_v1`。 */
    readonly buildresource: string;
    /**
     * 模型大小倍率（表的「模型大小」列，缺省 1）。
     *
     * 由 `TerritoryStationView.applyIconPlacement` 乘在「可见宽度归一」系数之上 ——
     * 归一负责所有建筑等宽，这个值负责「这张图本身要更大 / 更小」。≤0 与非数字一律当 1
     * （0 倍 = 建筑凭空消失，且不报错，所以必须在这里夹掉）。
     */
    readonly buildSize: number;
}

/** 建筑表名（`remoteRef` bundle 里的表名，等于文件名 `build.json` 的 `build`）。 */
const BUILD_TABLE_NAME = 'build';

/** 建筑表加载失败/为空时返回空表；调用方按「查不到就回退」处理，不阻断整页。 */
export type TerritoryBuildTable = ReadonlyMap<number, ITerritoryBuildRow>;

/**
 * 读取 remoteRef 中的 build.json。
 *
 * remoteRef 是独立 bundle，必须走 RefUtil，不能用 AssetService。
 * 一次取整表，返回行对象数组；加载失败返回空表并记录错误，视图回退到按 site.type 取图。
 */
export async function loadTerritoryBuildTable(): Promise<TerritoryBuildTable> {
    try {
        const rows = (await RefUtil.instance.getRefAllAsync(BUILD_TABLE_NAME)) ?? [];
        return parseTerritoryBuildTable(rows);
    } catch (error) {
        console.error(`[TerritoryPage] 建筑表加载失败：${BUILD_TABLE_NAME}`, error);
        return new Map();
    }
}

/**
 * 把 build 表归一成 buildId 到行的映射。
 *
 * 支持 RefUtil 返回的行对象数组，也兼容转表器原始的 `{c:1,k,v}` 列存结构。
 */
export function parseTerritoryBuildTable(raw: unknown): TerritoryBuildTable {
    const table = new Map<number, ITerritoryBuildRow>();
    let rows: unknown[] = [];
    if (Array.isArray(raw)) {
        rows = raw;
    } else if (raw !== null && typeof raw === 'object' && (raw as { c?: unknown }).c === 1
        && Array.isArray((raw as { k?: unknown }).k) && Array.isArray((raw as { v?: unknown }).v)) {
        const rawTable = raw as { k: string[]; v: unknown[][] };
        const keys = rawTable.k;
        const valuesList = rawTable.v;
        for (let i = 0; i < valuesList.length; i++) {
            const values = valuesList[i];
            const obj: Record<string, unknown> = {};
            for (let j = 0; j < keys.length; j++) {
                obj[keys[j]] = values[j];
            }
            rows.push(obj);
        }
    }
    for (const item of rows) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as Partial<ITerritoryBuildRow>;
        // `buildId` 在表里是**数字**，而地图 JSON 的 `buildingId` 是**字符串** ——
        // 查表时统一按 Number 归一，否则 `'69003'` 永远查不到 `69003`。
        const buildId = Number(row.buildId);
        if (!Number.isFinite(buildId) || typeof row.buildresource !== 'string' || !row.buildresource) continue;
        const rawSize = Number(row.buildSize);
        table.set(buildId, {
            buildId,
            buildType: Number(row.buildType) || 0,
            buildresource: row.buildresource,
            // ≤0 / NaN 夹到 1：倍率 0 会让建筑凭空消失且零报错。
            buildSize: Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 1,
        });
    }
    return table;
}

/** 章节地图 JSON 的资源路径（`resources` 相对路径，不带扩展名）。 */
export function territoryMapPath(chapterId: number): string {
    return `config/territory-maps/chapter_${String(chapterId).padStart(2, '0')}`;
}

/**
 * 地图 JSON 未提供 `background` 时的默认背景图（`image/zdbg1.jpg`，换图）。
 *
 * zdbg1 在 `image/` **根目录**、不在 `image/territory/` ⇒ 用 `spriteFramePath(ART_ROOT, …)`，
 * 别按 `TERRITORY_ART_ROOT` 拼（那是 `image/territory`，会报
 * `Bundle resources doesn't contain image/territory/zdbg1`，**不是 404**，极易误判成「美术没交图」）。
 */
const DEFAULT_TERRITORY_BG_NAME = 'zdbg1';

/**
 * 领地模块的资源入口 —— 地图 JSON 与战斗美术**都从这里走 `AssetService`**。
 *
 * 旧实现是 `TerritoryPage` 里两个 `new Promise` 直调 `resources.load`：页面既是流程编排，
 * 又当资源加载器，且绕过了工程的资源作用域（`ResourceScope`）与统一入口
 * （`AGENTS.md`「正式流程的资源必须经 `AssetService` 进入」）。
 *
 * 每一帧单独 `try/catch`：领地美术缺一张就整页打不开是不可接受的，
 * 取不到时返回 `null`，由视图回退到矢量底（与旧实现同样的降级策略）。
 */
export async function loadTerritoryMapJson(assets: AssetService, chapterId: number): Promise<unknown> {
    const path = territoryMapPath(chapterId);
    try {
        const asset = await assets.load(path, JsonAsset);
        return asset.json;
    } catch (error) {
        console.error(`[TerritoryPage] 地图资源加载失败：${path}`, error);
        return null;
    }
}

export async function loadTerritoryBattleArt(
    assets: AssetService,
    backgroundPath: string,
): Promise<ITerritoryBattleArt> {
    const [background, tileLocked, tileCleared, tileGrey, lockIcon, frameBoss, frameStage, frameAsyncPvp, frameChest, start, stage, boss, asyncPvp, fixedResource, randomResource, randomSilverIcon, chestIcon, bonus, header, navButton, actionButton, buildAssets, levelBubbleFrame, levelBubblePendingFrame, chestBubbleFrame, staminaIcon, pvpBubblePortrait] = await Promise.all([
        // 地图 JSON 有 background 就按它走（spriteFramePathOf 对已带后缀的路径幂等），否则用默认背景。
        // 默认图 zdbg1 在 `image/` **根目录**（不在 `image/territory/`）⇒ 走 `spriteFramePath(ART_ROOT, …)`；
        // 用 `spriteFramePathOf(TERRITORY_ART_ROOT/…)` 拼会在 bundle 索引里查不到
        // （报 `Bundle resources doesn't contain …`，**不是 404**，极易误判成「美术没交图」）。
        backgroundPath
            ? loadFrame(assets, spriteFramePathOf(backgroundPath))
            : loadFrame(assets, spriteFramePath(ART_ROOT, DEFAULT_TERRITORY_BG_NAME)),
        // 地皮换成**两张成品美术图**（原先是单张 `img_land_01_gray` + 三色 tint）：
        // · 未通关 ⇒ `img_land_02`（泥土块）；· 已通关 ⇒ `img_land_01`（草地块）。
        // 两张都是 **126×117** 的 2.5D 立体图（灰图是 130×119，几何口径见
        // `HexGridLayout` 注释）；台面（可见六边形）占画布上半，下方是侧壁。
        // 不再染色（旧 `TERRITORY_COLORS.mapOwned/mapTarget/mapNeutral` 已删）——
        // 绿草地上再乘金色 tint 会发脏，状态全部交给「哪张地皮 + 哪个框」表达。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'img_land_02')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'img_land_01')),
        // 「锁住的格」地皮：灰版 `img_land_01_gray`。
        // 这张图本来就在包里（旧口径的单张地皮），只是 没再被引用 ⇒ 直接复用，
        // 不新增美术。 它是 **130×119**（新地皮 126×117），锁着的格不画格面框 ⇒ 只多 2px 交叠。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'img_land_01_gray')),
        // 前沿空锁格的锁标（蓝湖 `大地图(1)` 的 `icon_lock`，31×43 一像素不缩）。
        // 放在 `image/territory/` 根目录 ⇒ 与地块同进 `auto-atlas.pac`，同帧的锁和地皮能合批。
        loadFrame(assets, spriteFramePath(TERRITORY_ART_ROOT, 'icon_lock')),
        // 格面高亮框：124×92 的六边形描边图（正好盖住 123×90 的格面），只在「已解锁未通关」时出现。
        // 美术这批命名不统一，**逐字对照**别改：
        // `frame_01`=首领(红) / `frame_03`=普通关卡(紫) / `frame_04`=异步关卡(金) / **`fram_02`=宝箱(蓝，少一个 e)**。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_01')),
        // **普通关卡也用首领那张红框**（原 `frame_03` 紫）。
        // 槽位仍是 `frameStage`（`TERRITORY_SITE_FRAME` 不动），只是换了图 ——
        // `frame_03` 从此不再被引用，美术目录里那张图留着不动。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_01')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_04')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'fram_02')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_home_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_outpost_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_boss_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_async_pvp_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_fixed_resource_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_random_resource_v1')),
        loadFrame(assets, spriteFramePath(RESOURCE_ICON_ART_ROOT, '图标_铜币')),
        // 固定宝箱格「可激活」时那颗宝箱图标。
        // 在 `image/territory/` 根目录 ⇒ 与锁标 / 地皮同进 `auto-atlas.pac`，同帧能合批。
        loadFrame(assets, spriteFramePath(TERRITORY_ART_ROOT, 'icon_baoxiang')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_bonus_v1')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_title_brown')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_ty_btn09')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_ty_btn13')),
        loadBuildAssets(assets),
        // 气泡底图：已通关蓝 `frame_03` / **未通关红 `frame_02`**。
        // 两张都是 `spawn-region` 下 94×45 带小尾巴的同款异色图，槽位二选一由
        // `stationRenderOf` 的 `claimed` 决定；顺序必须与上面的解构对齐。
        loadFrame(assets, MAP_MARKER_BUBBLE_FRAME_PASSED_PATH),
        loadFrame(assets, MAP_MARKER_BUBBLE_FRAME_PENDING_PATH),
        // 宝箱提示气泡的**新底图** `frame_04`（77×87 竖向水滴，指定）。
        // 与上面两张 94×45 的胶囊同目录，但不是同一套：宝箱气泡内是「icon 在上、数字在下」两行，
        // 排版常量全在 `model/TerritoryChestBubble`，别再往 `MapMarkerBadge` 里塞。
        loadFrame(assets, TERRITORY_CHEST_BUBBLE_FRAME_PATH),
        // 固定宝箱提示气泡里的体力图标。与「宝箱开出的体力飞进资源栏」
        // 用的是同一张 `图标_体力`，别在领地目录里另存一份。
        loadFrame(assets, spriteFramePath(RESOURCE_ICON_ART_ROOT, '图标_体力')),
        loadFrame(assets, TERRITORY_PVP_BUBBLE_PORTRAIT_PATH),
    ]);
    return { background, levelBubbleFrame, levelBubblePendingFrame, chestBubbleFrame, staminaIcon, tileLocked, tileCleared, tileGrey, lockIcon, frameBoss, frameStage, frameAsyncPvp, frameChest, start, stage, boss, asyncPvp, fixedResource, randomResource, randomSilverIcon, chestIcon, bonus, header, navButton, actionButton, buildFrames: buildAssets.frames, buildScales: buildAssets.scales, pvpBubblePortrait };
}

/**
 * 按 `build.json` 逐行加载建筑帧，返回 `buildId → 帧`。
 *
 * `buildresource` 已是**完整 resources 相对路径**（`image/territory/buildings/xxx`），
 * 所以用 `spriteFramePathOf` 幂等补 `/spriteFrame`，**不要**再拿 `TERRITORY_BUILDING_ART_ROOT` 拼 ——
 * 拼出来会是 `image/territory/buildings/image/territory/buildings/xxx`，报
 * `Bundle resources doesn't contain …`（不是 404，极易误判成「美术没交图」）。
 *
 * 单行失败只让**那一格**退回按type 取图，不影响其它建筑（逐行 `loadFrame` 自己吞异常）。
 */
async function loadBuildAssets(assets: AssetService): Promise<{
    frames: ReadonlyMap<number, SpriteFrame | null>;
    scales: ReadonlyMap<number, number>;
}> {
    const table = await loadTerritoryBuildTable();
    const frames = new Map<number, SpriteFrame | null>();
    const scales = new Map<number, number>();
    const loadPromises: Promise<void>[] = [];
    for (const row of table.values()) {
        scales.set(row.buildId, row.buildSize);
        loadPromises.push(
            loadFrame(assets, spriteFramePathOf(row.buildresource)).then((frame) => {
                frames.set(row.buildId, frame);
            }),
        );
    }
    await Promise.all(loadPromises);
    return { frames, scales };
}

async function loadFrame(assets: AssetService, path: string): Promise<SpriteFrame | null> {
    // （§3.42）：**bundle 索引预检绝不许短路判空**。
    // 旧实现是 `if (!(await assets.has(...))) return null;`，把 `getInfoWithPath` 的
    // 「config.json 的 paths 里查不到」当成「这张图不存在」。但 `image/spawn-region/`
    // 下 `frame_02`（未通关红气泡）是 `packable:false` 的散图、`frame_03`（已通关蓝）
    // 是进 auto-atlas 的图集帧，索引登记方式并不一致；实机一旦对红图查不到索引，
    // `levelBubblePendingFrame` 就被静默置 null，`stationRenderOf` 两条「未通关」分支
    // 一起回退 `levelBubbleFrame` ⇒ 预告气泡全变蓝（反馈），零报错。
    // 而所有测试夹具都把 `has` 写成恒 true（`territory-random-resource-render` 等），
    // 所以旧用例全绿也盖不住这条实机分支。
    // ⇒ 加不加载只由 `load` 自己判；`has` 降级为「失败时把日志说清楚」，正常路径还少一次查询。
    // 真缺图仍由 catch 返回 null（旧降级策略一字未改），只是不再「明明有图却判空」。
    try {
        return await assets.load(path, SpriteFrame);
    } catch (error) {
        let indexed = true;
        try {
            indexed = await assets.has(path, SpriteFrame);
        } catch {
            indexed = false;
        }
        console.warn(`[TerritoryPage] 战斗美术加载失败，使用矢量兜底：${path}`
            + `${indexed ? '' : '（bundle 索引也未登记此路径）'}`, error);
        return null;
    }
}
