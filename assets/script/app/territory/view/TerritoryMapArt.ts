import type { Material, Prefab, SpriteFrame } from 'cc';

export interface ITerritoryMapArt {
    readonly monsterPrefabs?: ReadonlyMap<number, Prefab>;
    /** 巡逻野怪的体型系数（`monsterCard.prefabSize`，键 = `monsterCard.id`）；缺省按 1。 */
    readonly monsterPrefabSizes?: ReadonlyMap<number, number>;
    /**
     * 巡逻宝箱怪「红色描边」副本用的材质（`shaders/unit-outline-copy`）。
     *
     * 与战斗内 `ZCUnitView` 的整体外轮廓同一份 shader / 同一份材质构建方式；
     * `null` = shader 没加载到 ⇒ 只压暗、不描边（宁可少一圈边，也不能出现放大的红色怪）。
     */
    readonly monsterOutlineMaterial?: Material | null;
    /** 地图底图（`MapLayer/MapBackground` 的帧；null = 保持 prefab 默认）。 */
    readonly background: SpriteFrame | null;
    /**
     * **未通关**格的地皮：`img_land_02` 泥土块。
     *
     * 换口径：地皮按「通关 / 未通关」二选一，**不再三色染色**。
     * 未解锁、已解锁未通关、中立格**共用这一张** —— 「这一格有东西可打」由叠在上面的
     * `frameBoss/frameStage/frameAsyncPvp/frameChest` 表达，不靠地皮区分。
     */
    readonly tileLocked: SpriteFrame | null;
    /** **已通关**格的地皮：`img_land_01` 草地块。 */
    readonly tileCleared: SpriteFrame | null;
    /**
     * **被锁住**（前置没满足 / 随机格四周没开）那一格的地皮：`img_land_01_gray` 灰版。
     *
     * 需求 「未解锁的地块整个地块图片都置灰，等切换成可激活（银币 icon + 数字）
     * 时再重新加载颜色」。**只换图不染色** —— 与 「成品图自带明暗，再乘色会发脏」
     * 同一条理由（乘灰只会把泥土压得更黑，读不出"灰"）。
     *
     * 取不到 ⇒ 退回 {@link tileLocked}（宁可这一格不置灰，也不能没地皮）。
     * 这张灰图是**旧的 130×119**（新地皮是 126×117），比邻居每边多 2px。锁着的格
     * **不画格面框**（框只给「已解锁未通关」），所以 126→130 那套"框缩在格子中间"的问题
     * 在这里不成立；真要修的是美术补一张 126×117 的灰版。
     */
    readonly tileGrey?: SpriteFrame | null;
    /**
     * 未解锁格的锁标（`image/territory/icon_lock`，31×43 原样显示）。
     *
     * 画在「露出来 + 还没开」的格上（见 {@link TerritoryMapView} 的 `isHexLockCell`），
     * 不区分这一格有没有建筑/价格 —— 锁只说明「没开」。
     * 取不到就整支不显示 —— 不要退回别的图标（别的锁图尺寸/配色都对不上泥土台面）。
     */
    readonly lockIcon: SpriteFrame | null;
    /**
     * 「已解锁但还没通关」的**格面高亮框**，按站点类型四选一；通关后一律摘掉。
     *
     * 四张框都是 124×92 的六边形描边图，**贴地皮、不贴建筑** —— 它作为格子节点的子节点
     * （`Frame`）渲染，所以天然在建筑图标之下、地皮之上。
     */
    readonly frameBoss: SpriteFrame | null;
    /**
     * 普通关卡（`stage`）的框。
     *
     * **与首领同图（红）**：原来的 `frame_03` 紫框已被用户否掉。
     * 映射表里 `stage` 仍然指向这个槽位，换图只发生在 `TerritoryPageAssets` 的加载路径上。
     */
    readonly frameStage: SpriteFrame | null;
    /** 异步关卡（`asyncPvp`）的框。 */
    readonly frameAsyncPvp: SpriteFrame | null;
    /** 宝箱（`fixedResource`）的框。 */
    readonly frameChest: SpriteFrame | null;
    readonly start: SpriteFrame | null;
    readonly stage: SpriteFrame | null;
    readonly boss: SpriteFrame | null;
    /**
     * **已无渲染消费者**。
     *
     * `asyncPvp` 并入「只有配了 `buildingId` 才画建筑」的口径后，这张固定图不再被任何分支取用
     * （`TERRITORY_SITE_ART` 里那条映射已不可达）。暂不删：它同时是 `build.json` 里 `69002`
     * 的贴图来源，删字段要连 `loadTerritoryBattleArt` 的 `Promise.all` 一起改（两处一起改，
     * 否则漏一处只会在运行期报 `Bundle resources doesn't contain`）。
     */
    readonly asyncPvp: SpriteFrame | null;
    readonly fixedResource: SpriteFrame | null;
    /**
     * **已不是随机格的外观来源**。
     *
     * 随机格改成**逐格**取建筑（`randomSites.buildingIds[cellId]` → `buildFrames`），
     * 没配 id 的开启格只显示绿色地块、不给建筑图 ⇒ 这张固定图**没有渲染消费者了**。
     *
     * 暂不删：`territory_random_resource_v1` 同时是 `build.json` 里 `69006` 的贴图来源，
     * 删字段会连带要从 `loadTerritoryBattleArt` 的 `Promise.all` 里摘掉那一项。
     * 真要清理时**两处一起改**，否则会漏。
     */
    readonly randomResource: SpriteFrame | null;
    readonly randomSilverIcon: SpriteFrame | null;
    /**
     * 固定宝箱格「**可激活**」时压在价格行上方的那颗宝箱图标：
     * `image/territory/icon_baoxiang`（58×45）。
     *
     * 需求 （附美术效果图）：`fixedResource` 格可激活时，价格行照旧是
     * `银币 icon + 数字`，**上面再加一颗宝箱 icon**（两行整块居中，排版见
     * `model/TerritoryConditionBadge`）。银币不足只染数字那条规则不变。
     *
     * **未解锁（前置没满足 / 还没开）的宝箱格不传** —— 「仍然只显示锁 icon」。
     * 取不到这张图 ⇒ 退回旧版只有价格行，不阻断对局。
     */
    readonly chestIcon?: SpriteFrame | null;
    /**
     * 固定宝箱提示气泡里的**体力图标**。
     *
     * 与随机格的银币图标同一套取图口径（`roleProperty` 的 `图标_体力`）；取不到就退化成
     * **纯数字气泡**（见 `TerritoryStationView.renderLevelBubble` 的降级分支），不会没气泡。
     */
    readonly staminaIcon?: SpriteFrame | null;
    readonly bonus: SpriteFrame | null;
    /**
     * 关卡编号气泡底图（**已通关**，蓝 `image/spawn-region/frame_03`）。
     *
     * 气泡按「通没通过」二选一 —— 已通关蓝 / 未通关红，判据是 `progress.isAreaPassed`。
     * 初始点位「章节」也用这一张，跟「已通关」同色。
     */
    readonly levelBubbleFrame?: SpriteFrame | null;
    /**
     * 关卡编号气泡的**未通关**槽位（红 `image/spawn-region/frame_02`）。
     *
     * 取不到时回退 {@link levelBubbleFrame}：宁可蓝一下，也不能没气泡 ——
     * 编号是这一格唯一的关卡标识（`stationRenderOf` 里做兜底）。
     */
    readonly levelBubblePendingFrame?: SpriteFrame | null;
    /**
     * 未通关 PVP 头像气泡的两层底：黄底头像框 / 等级角标。
     *
     * 与左上角玩家卡同源（`hud_avatar_frame` / `hud_level_bg`）；头像本身是**玩家动态数据**
     * （`input.playerPortrait`），不进这里 —— 美术帧只放页面加载一次的资源。
     */
    readonly pvpBubbleAvatarFrame?: SpriteFrame | null;
    readonly pvpBubbleLevelFrame?: SpriteFrame | null;
    /**
     * **已通关 PVP** 的问号徽标气泡（2026-11-23 蓝湖`塔防主界面-1` 图1）：
     * 94×103 蓝底方图 + 74×74 灰盾问号。两张都在才切；缺一张回退旧「PVP」文字胶囊。
     */
    readonly pvpClearBubbleFrame?: SpriteFrame | null;
    readonly pvpClearBubbleIcon?: SpriteFrame | null;
    /**
     * **宝箱提示气泡**的底图（新美术 `image/spawn-region/frame_04`，77×87 竖向水滴）。
     *
     * 需求 宝箱气泡改用它，且内部排版是「icon 在上、数字在下」两行 ——
     * 与关卡编号那颗 94×45 胶囊完全不同（见 `model/TerritoryChestBubble`）。
     * 取不到时回落 {@link levelBubbleFrame}：宁可样子旧一点，也不能让宝箱没有提示。
     */
    readonly chestBubbleFrame?: SpriteFrame | null;
    /**
     * **建筑表按 `buildId` 查到的帧**（`buildId` → 帧）。
     *
     * 这一路优先于上面那组「按站点类型固定取图」的字段：外观由**地图 JSON 配的 `buildingId`**
     * 决定（口径「地图编辑配置哪个 id 就用哪个 id」）。
     * 查不到 / 没配 id 才回退到 `TERRITORY_SITE_ART` 那套。
     */
    readonly buildFrames?: ReadonlyMap<number, SpriteFrame | null>;
    /**
     * `buildId → buildSize`（表的「模型大小」，缺省 1）。
     *
     * 与 {@link buildFrames} 分开查：帧负责「画哪张图」，倍率负责「这张图多大」。
     * 查不到 / 缺省一律按 1 —— 与引入该字段之前的表现完全一致。
     */
    readonly buildScales?: ReadonlyMap<number, number>;
    /**
     * 巡逻宝箱**锚点格**的模型图（闭合）：`monsterBoxLv`(1~4) →
     * `territory_monsterBox_L{lv}`（212×212，与其它建筑同规格）。
     *
     * 只有锚点格（带 `patrolId` 的那格）画；兄弟格仍然不画 —— 与关卡 / 异步据点
     * 「一片区域只在一格长建筑」同一条口径。
     * 缺省 / 空表 ⇒ 不画宝箱（老夹具与「图还没加载」等价，不阻断对局）。
     */
    readonly patrolChestFrames?: ReadonlyMap<number, SpriteFrame | null>;
    /** 同一角色的**开盖**版：本片挑战通过后换这张（`territory_monsterBoxOpen_L{lv}`）。 */
    readonly patrolChestOpenFrames?: ReadonlyMap<number, SpriteFrame | null>;
    /**
     * 巡逻宝箱模型图的**体量倍率**（乘在「可见宽归一」之上，缺省 1）。
     *
     * 由 `TerritoryPageAssets` 从 `TERRITORY_MONSTER_BOX_ART_SCALE` 透传 —— 视图不 import 那份常量，
     * 是为了不让 `TerritoryMapView` 再多一个依赖（每个 VM 桩表都得跟着补，纯属噪音）。
     */
    readonly patrolChestIconScale?: number;
}
