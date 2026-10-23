import { JsonAsset, SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { RefUtil } from '../../../framework/ref/RefUtil';
import {
    ART_ROOT,
    BUILDING_ART_ROOT,
    COMMON_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    spriteFramePath,
    spriteFramePathOf,
    TERRITORY_BUILDING_ART_ROOT,
} from '../../ArtPaths';

/**
 * 领地页要用到的美术帧。取不到的项为 `null`，视图会退回矢量兜底（不阻断对局）。
 *
 *  **建筑帧按站点类型分**（2026-10-09 换新美术）—— 地图 JSON 的 `site.type` 决定用哪张：
 *  `stage`→普通关卡 / `boss`→首领 / `asyncPvp`→敌方主城 / `fixedResource`→资源据点 / `bonus`→宝箱；
 *  起始格（`startCellId`，不在 `sites` 里）单独走 `start`。对应关系见 `TerritoryMapView`。
 */
export interface ITerritoryBattleArt {
    readonly background: SpriteFrame | null;
    /**
     * **未通关**格的地皮（未解锁 / 已解锁未通关 / 中立格都用它）：`img_land_02` 泥土块。
     *
     *  🔴 2026-10-16 换口径：地皮由**两张成品美术图**按状态二选一，不再用一张灰度图 + 三色染色。
     */
    readonly tileLocked: SpriteFrame | null;
    /** **已通关**格的地皮：`img_land_01` 草地块。 */
    readonly tileCleared: SpriteFrame | null;
    /**
     * 「已解锁但还没通关」的**格面高亮框**，按站点类型四选一，叠在地皮之上。
     *
     *  ⚠️ 通关后**必须摘掉**（`TerritoryMapView.paintHexes` 里 `passed ⇒ frame = null`）——
     *  框的语义就是「这里有东西可打」，打完了再留着会读成「还能再打一次」。
     */
    readonly frameBoss: SpriteFrame | null;
    readonly frameStage: SpriteFrame | null;
    readonly frameAsyncPvp: SpriteFrame | null;
    /** 宝箱格（`fixedResource`）的框。⚠️ 美术文件名是 `fram_02`（**少一个 e**），别"顺手改对"。 */
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
    /** `bonus` 奖励据点。 */
    readonly bonus: SpriteFrame | null;
    readonly header: SpriteFrame | null;
    readonly navButton: SpriteFrame | null;
    readonly actionButton: SpriteFrame | null;
    /**
     * 建筑表按 `buildId` 查到的帧（**键是数字** `buildId`）。
     *
     *  与 `TerritoryMapView.stationIconOf` 的查表口径一致：站点配了 `buildingId` 就走这里，
     *  没配 / 查不到才回退到按 `site.type` 取图。
     */
    readonly buildFrames: ReadonlyMap<number, SpriteFrame | null>;
    /**
     * `buildId → buildSize`（表里的「模型大小」，缺省 1）。
     *
     *  与 `buildFrames` **分开**而不是塞进同一个 value：`buildFrames` 的契约是
     *  「`stationIconOf` 直接返回一张帧」，改成对象会牵连类型回退与所有夹具；
     *  而倍率只在下游乘进缩放，独立查一次最省。查不到 = 1（旧行为）。
     */
    readonly buildScales: ReadonlyMap<number, number>;
}

/**
 * 领地建筑表的一行（`remoteRef/build.json`）。
 *
 *  `buildType` 语义（策划口径）：1=基地 2=异步据点 3=boss关 4=普通关 5=固定宝箱 6=随机据点。
 *  ⚠️ **`buildType` 不参与选图** —— 外观由**地图 JSON 里配的 `buildingId`** 决定（见
 *  `TerritoryMapView.stationIconOf`），这张表只当「buildId → 贴图路径」的查询表用。
 *  原因是同一个 `buildType` 下可以有多个建筑（`69006`随机资源与 `69007`奖励据点**都是 6**），
 *  按类型反推会张冠李戴。
 */
export interface ITerritoryBuildRow {
    readonly buildId: number;
    readonly buildType: number;
    /** `resources` 相对路径（无扩展名、无 `/spriteFrame`），如 `image/territory/buildings/territory_boss_v1`。 */
    readonly buildresource: string;
    /**
     * 模型大小倍率（表的「模型大小」列，缺省 1）。
     *
     *  由 `TerritoryStationView.applyIconPlacement` 乘在「可见宽度归一」系数之上 ——
     *  归一负责所有建筑等宽，这个值负责「这张图本身要更大 / 更小」。≤0 与非数字一律当 1
     *  （0 倍 = 建筑凭空消失，且不报错，所以必须在这里夹掉）。
     */
    readonly buildSize: number;
}

/** 建筑表名（`remoteRef` bundle 里的表名，等于文件名 `build.json` 的 `build`）。 */
const BUILD_TABLE_NAME = 'build';

/** 建筑表加载失败/为空时返回空表；调用方按「查不到就回退」处理，不阻断整页。 */
export type TerritoryBuildTable = ReadonlyMap<number, ITerritoryBuildRow>;

/**
 * 读 `remoteRef` 里的 `build.json`。
 *
 *  ## ⚠️ 必须走 `RefUtil`，**不能**用 `AssetService`
 *
 *  `remoteRef` 是**独立 bundle**，`AssetService` 走的是 `resources` bundle
 * ⇒ `assets.load('build', JsonAsset)` 报
 * `Bundle resources doesn't contain build`（**不是 404**，极易误判成「表没转」）。
 * 正确读法与 `BattleTokenRepository.readRows` / `CelebrationRepository` 同一套：
 * `RefUtil.instance.getRefAllAsync(tableName)`。
 *
 *  ## 为什么用 `getRefAllAsync` 而不是 `getRefAsync`
 *
 *  这张表**没有主键查询的需求**（按 `buildId` 查只是遍历时的 Map 索引）⇒ 一次取整表最省。
 *  它返回的**已经是行对象数组**（列式已还原）⇒ 下面 `parseTerritoryBuildTable` 的
 *  `{k, v}` 稠密列存分支是**双保险**（RefUtil 换了实现或别的加载路径喂原始 json 时仍认）。
 *
 *  与 `loadTerritoryMapJson` 同一套降级口径：取不到就返回空表 + `console.error`，
 *  视图回退到按 `site.type` 取图（旧行为），领地页照常打得开。
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
 * 把 build 表归一成 `buildId → 行`。
 *
 *  ## 两种输入形态
 *
 *  1. **行对象数组** —— `RefUtil.getRefAllAsync` 的返回（它已把列式还原成行，字段名 = 表头原名）。
 *    这是**主路径**。
 *  2. **列存对象 `{c:1, k:[表头], v:[行]}`** —— 转表器的原始产物形态（`build.json` 就是这个）。
 *    `RefUtil.compressKeyRefDataFix` 的还原判据是 **`c === 1`**（不是「有没有 `v`」），
 *    这里用同一判据，避免把别的 `{k,v}` 结构误当数据。
 *
 *  保留第2 种是**双保险**：换加载路径（直接喂原始 json）时仍能认，不会整表读空。
 */
export function parseTerritoryBuildTable(raw: unknown): TerritoryBuildTable {
    const table = new Map<number, ITerritoryBuildRow>();
    const rows: unknown[] = Array.isArray(raw)
        ? raw
        : raw !== null && typeof raw === 'object' && (raw as { c?: unknown }).c === 1
            && Array.isArray((raw as { k?: unknown }).k) && Array.isArray((raw as { v?: unknown }).v)
            ? ((raw as { k: string[]; v: unknown[][] }).v).map((values) => {
                const keys = (raw as { k: string[] }).k;
                return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
            })
            : [];
    for (const item of rows) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as Partial<ITerritoryBuildRow>;
        // ⚠️ `buildId` 在表里是**数字**，而地图 JSON 的 `buildingId` 是**字符串** ——
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
 * 地图 JSON 未提供 `background` 时的默认背景图（`image/zdbg1.jpg`，2026-10-10 换图）。
 *
 * ⚠️ zdbg1 在 `image/` **根目录**、不在 `image/territory/` ⇒ 用 `spriteFramePath(ART_ROOT, …)`，
 * 别按 `TERRITORY_ART_ROOT` 拼（那是 `image/territory`，会报
 * `Bundle resources doesn't contain image/territory/zdbg1`，**不是 404**，极易误判成「美术没交图」）。
 */
const DEFAULT_TERRITORY_BG_NAME = 'zdbg1';

/**
 * 领地模块的资源入口 —— 地图 JSON 与战斗美术**都从这里走 `AssetService`**。
 *
 *  旧实现是 `TerritoryPage` 里两个 `new Promise` 直调 `resources.load`：页面既是流程编排，
 *  又当资源加载器，且绕过了工程的资源作用域（`ResourceScope`）与统一入口
 *  （`AGENTS.md`「正式流程的资源必须经 `AssetService` 进入」）。
 *
 *  ⚠️ 每一帧单独 `try/catch`：领地美术缺一张就整页打不开是不可接受的，
 *  取不到时返回 `null`，由视图回退到矢量底（与旧实现同样的降级策略）。
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
    const [background, tileLocked, tileCleared, frameBoss, frameStage, frameAsyncPvp, frameChest, start, stage, boss, asyncPvp, fixedResource, randomResource, randomSilverIcon, bonus, header, navButton, actionButton, buildAssets] = await Promise.all([
        // 地图 JSON 有 background 就按它走（spriteFramePathOf 对已带后缀的路径幂等），否则用默认背景。
        // ⚠️ 默认图 zdbg1 在 `image/` **根目录**（不在 `image/territory/`）⇒ 走 `spriteFramePath(ART_ROOT, …)`；
        //    用 `spriteFramePathOf(TERRITORY_ART_ROOT/…)` 拼会在 bundle 索引里查不到
        //    （报 `Bundle resources doesn't contain …`，**不是 404**，极易误判成「美术没交图」）。
        backgroundPath
            ? loadFrame(assets, spriteFramePathOf(backgroundPath))
            : loadFrame(assets, spriteFramePath(ART_ROOT, DEFAULT_TERRITORY_BG_NAME)),
        // 🔴 2026-10-16 地皮换成**两张成品美术图**（原先是单张 `img_land_01_gray` + 三色 tint）：
        //    · 未通关 ⇒ `img_land_02`（泥土块）；· 已通关 ⇒ `img_land_01`（草地块）。
        //    两张都是 **126×117** 的 2.5D 立体图（灰图是 130×119，几何口径见
        //    `HexGridLayout` 注释）；台面（可见六边形）占画布上半，下方是侧壁。
        //    ⚠️ 不再染色（旧 `TERRITORY_COLORS.mapOwned/mapTarget/mapNeutral` 已删）——
        //    绿草地上再乘金色 tint 会发脏，状态全部交给「哪张地皮 + 哪个框」表达。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'img_land_02')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'img_land_01')),
        // 格面高亮框：124×92 的六边形描边图（正好盖住 123×90 的格面），只在「已解锁未通关」时出现。
        // ⚠️ 美术这批命名不统一，**逐字对照**别改：
        //    `frame_01`=首领(红) / `frame_03`=普通关卡(紫) / `frame_04`=异步关卡(金) / **`fram_02`=宝箱(蓝，少一个 e)**。
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_01')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_03')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'frame_04')),
        loadFrame(assets, spriteFramePath(BUILDING_ART_ROOT, 'fram_02')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_home_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_outpost_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_boss_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_async_pvp_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_fixed_resource_v1')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_random_resource_v1')),
        loadFrame(assets, spriteFramePath(RESOURCE_ICON_ART_ROOT, '图标_铜币')),
        loadFrame(assets, spriteFramePath(TERRITORY_BUILDING_ART_ROOT, 'territory_bonus_v1')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_title_brown')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_ty_btn09')),
        loadFrame(assets, spriteFramePath(COMMON_ART_ROOT, 'cu_ty_btn13')),
        loadBuildAssets(assets),
    ]);
    return { background, tileLocked, tileCleared, frameBoss, frameStage, frameAsyncPvp, frameChest, start, stage, boss, asyncPvp, fixedResource, randomResource, randomSilverIcon, bonus, header, navButton, actionButton, buildFrames: buildAssets.frames, buildScales: buildAssets.scales };
}

/**
 * 按 `build.json` 逐行加载建筑帧，返回 `buildId → 帧`。
 *
 *  `buildresource` 已是**完整 resources 相对路径**（`image/territory/buildings/xxx`），
 *  所以用 `spriteFramePathOf` 幂等补 `/spriteFrame`，**不要**再拿 `TERRITORY_BUILDING_ART_ROOT` 拼 ——
 *  拼出来会是 `image/territory/buildings/image/territory/buildings/xxx`，报
 *  `Bundle resources doesn't contain …`（不是 404，极易误判成「美术没交图」）。
 *
 *  单行失败只让**那一格**退回按type 取图，不影响其它建筑（逐行 `loadFrame` 自己吞异常）。
 */
async function loadBuildAssets(assets: AssetService): Promise<{
    frames: ReadonlyMap<number, SpriteFrame | null>;
    scales: ReadonlyMap<number, number>;
}> {
    const table = await loadTerritoryBuildTable();
    const frames = new Map<number, SpriteFrame | null>();
    const scales = new Map<number, number>();
    await Promise.all(Array.from(table.values()).map(async (row) => {
        // 倍率与帧同源同表，一起收；帧失败也保留倍率（那格本来就不画建筑，倍率无害）。
        scales.set(row.buildId, row.buildSize);
        frames.set(row.buildId, await loadFrame(assets, spriteFramePathOf(row.buildresource)));
    }));
    return { frames, scales };
}

async function loadFrame(assets: AssetService, path: string): Promise<SpriteFrame | null> {
    // 预检 bundle 索引：资源未进构建/路径不符时直接判空兜底，避免把
    // `Bundle resources doesn't contain` 误当「美术没交图」（见 ArtPaths.spriteFramePathOf 注释）。
    if (!(await assets.has(path, SpriteFrame))) {
        console.warn(`[TerritoryPage] 美术未在 bundle 索引中，使用矢量兜底：${path}（请确认资源已导入并重新构建）`);
        return null;
    }
    try {
        return await assets.load(path, SpriteFrame);
    } catch (error) {
        console.warn(`[TerritoryPage] 战斗美术加载失败，使用矢量兜底：${path}`, error);
        return null;
    }
}
