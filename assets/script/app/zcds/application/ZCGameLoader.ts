import { EffectAsset, JsonAsset, Material, Prefab, SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { ConfigService } from '../../../core/config/ConfigService';
import { getAllUnitDefinitions } from '../model/ZCCombatCatalog';
import type { ZCAttackTrait, ZCUnitId } from '../model/ZCCombatCatalog';
import { configureZCMap, getZCLocalPlayerCountOverride, isRandomMapCandidate } from '../model/ZCGameModel';
import type { ZCMapLayout } from '../model/ZCGameModel';
import { getPvpRuntimeRules, loadPvpTables } from '../model/ZCGameRuntimeConfig';
import type { ZCPvpTables } from '../model/ZCGameRuntimeConfig';
import { getZCModifierCatalogs } from '../model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import { decorFramePath, HEX_FLIP_PULSE_ART_ROOT, HEX_GROUND_GLOW_ART_ROOT, MAP_RESOURCE_ART_ROOT, SPAWN_REGION_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { ZCGuideLoader } from './ZCGuideLoader';
import type { ZCGuidePreparedContent } from './ZCGuideLoader';
import type { IZCSpawnRegionHintFrames } from '../view/ZCSpawnRegionHintOverlay';

const HUD_URL = 'ui/game/ZCGameHUD';
/** 棋盘图层容器。`MapWater / HexLayer / DecorLayer / BuildingOverlay / CooldownOverlay`
 *  的层序就写在这个 prefab 的子节点顺序里，对局里不再用 `new Node` 现拼。 */
const BOARD_URL = 'ui/game/ZCGameBoard';
const HEX_URL = 'ui/game/ZCGameHex';
const UNIT_URL = 'ui/game/ZCGameUnit';
const EFFECT_URL = 'ui/game/ZCGameEffect';
const WALL_URL = 'ui/game/ZCGameWall';
const WALL_LAYER_URL = 'ui/game/ZCGameWallLayer';
const FLOAT_TEXT_URL = 'ui/game/ZCGameFloatText';
const CARD_REVEAL_URL = 'ui/game/ZCGameCardReveal';
/** 传说卡出场横幅（抽到金卡时弹出的整条 720×417 横幅，底板按玩家分四色）。 */
const LEGEND_BANNER_URL = 'ui/game/ZCGameLegendBanner';
/** 场景装饰条目。Sprite 的关键配置（CUSTOM 尺寸 + 不裁边）烘在 prefab 里。 */
const DECOR_URL = 'ui/game/ZCGameDecor';
/**
 * 单位出生特效：**老客户端那套**（`塔防/动效/sc/sc`，2026-10-14 换）。
 *
 *  帧 = 老端 `sc.plist` 拆出的 25 帧 `sc_idle_*`（原始像素 208×376，`_lscale=0.4`
 *  ⇒ 屏上 83.2×150.4）；`anim` 取**前 16 帧 @ sample 8 = 2.0s**，与老端
 *  `playEffectAnimByXY(..., "兵种生成", TopEffect, 2)` 的 2 秒存活逐帧等价。
 *  prefab 自带 `cc.Animation`（`playOnLoad` + ClampToForever）。
 *
 *  美术在 `assets/resources/units/effects/出生特效/`，沿用既有特效的三段式
 *  （`anim/*.anim` + `atlas/<名>.pac` + `<名>.prefab`），所以播放方式与
 *  `ZCCombatEffectView` 完全一致 —— `play(defaultClip.name)` 即可。
 */
const SPAWN_FX_URL = 'units/effects/出生特效/出生特效';
/**
 * 单位**阵亡特效**（`units/effects/死亡特效`）。
 *
 * 13 帧 @12fps（原始像素 535×1092，`_lscale=0.2056` ⇒ 屏上 110×225），沿用与出生特效
 * 同一套三段式（`anim/*.anim` + `atlas/<名>.pac` + `<名>.prefab`）⇒ 播放方式一致，
 * `play(defaultClip.name)` 即可。缺失时为 `null` —— 单位照常阵亡（染灰 + alpha 190），只是少一层表现。
 */
const DEATH_FX_URL = 'units/effects/死亡特效/死亡特效';
/**
 * 建筑**被拆掉**的白烟雾爆炸（`units/effects/建筑死亡特效`）。
 *
 * 4 帧 @12fps（原始像素 195×195，`_lscale=110/195` ⇒ 屏上 110px，与受击 / 出生同基准），
 * 同一套三段式（`anim/*.anim` + `atlas/<名>.pac` + `<名>.prefab`）。
 * 缺失时为 `null` —— 建筑照常变废墟，只是少这团烟。
 */
const BUILDING_DESTROY_FX_URL = 'units/effects/建筑死亡特效/建筑死亡特效';
/**
 * 受击特效的**目录**，按攻击方职业取子目录。
 *
 * 美术给了 5 组，但只有 4 组能当"职业受击"用：`射手/战士/法师/坦克` 与 `ZCAttackTrait`
 * （=卡表 `traits.attack`）一一对应；**「中毒受击」不是职业、是状态**，故意不登记在这里
 * —— 硬塞进来会让"中毒"看起来像第五个职业。
 *
 * 子目录名 = `<职业>受击`，prefab 名与目录同名（与既有 `units/effects/出生特效` 同口径）。
 */
const HIT_FX_DIRECTORY = 'units/effects/受击特效';
/**
 * 要加载哪几个职业的受击特效 —— **加载侧的唯一真源**。
 *
 * 为什么不写死成"遍历目录"：美术目录里还有「中毒受击」（状态，不是职业），遍历会把它
 * 也捞进来，将来`ZCAttackTrait` 加第五个职业时又得回头改这里。显式点名 4 个，
 * 加职业时**只改这一处**，渲染层照 `ZCAttackTrait` 的类型自动跟上。
 *
 *  目录名/ prefab 名约定 = `<职业>受击`（与美术源目录 `0通用-受击/<职业>受击` 同名）。
 */
const HIT_FX_TRAITS: readonly ZCAttackTrait[] = ['射手', '战士', '法师', '坦克'];
/** 自选主城阶段的常驻 HUD（顶部信息带 + 底部按钮组 + 吐司）。 */
const SPAWN_SELECTION_URL = 'ui/game/ZCSpawnSelection';
// 波次怪守城（塔防）左上角的首领条（蓝湖「BOSS」稿）。
const BOSS_PANEL_URL = 'ui/game/ZCBossPanel';
/** 建筑外观帧目录（buildIcon 指向的图片都在此目录）。 */
const BUILDING_DIRECTORY = 'image/buildings';

/** 城墙砖帧目录（按方向：up/down/rightUp/rightDown）。 */
const WALL_TILE_DIRECTORY = 'image/buildings/walls';
/** 城墙砖接缝 shader（按各透视砖端帽范围取内部颜色覆盖交叉描边，保持原 alpha）。 */
const WALL_TILE_EFFECT_URL = 'shaders/wall-tile';
/**
 * 兵种**整体外轮廓**的放大副本 shader（`shaders/unit-outline-copy.effect`）。
 *
 * 口径 = 顺着整只角色外形（所有散件拼出来的边缘）的描边：同一份美术 prefab 放大 8%、
 * 只画不透明像素，排在角色后面。失败时只关闭该表现，不影响对局。
 */
const UNIT_OUTLINE_COPY_EFFECT_URL = 'shaders/unit-outline-copy';
/**
 * 地块抬起后**原位开口**的底部发光序列帧目录（8 帧，文件名 `hex_ground_glow_01..08`）。
 *
 * 2026-10-14 由 `shaders/hex-ground-glow.effect`（shader 实时投影三个侧面）换成美术给的成品序列帧：
 * 图自带「淡入 → 峰值 → 淡出」的 alpha 曲线，视图只按翻面段进度切帧 + 乘阵营色。
 */
const HEX_GROUND_GLOW_DIRECTORY = HEX_GROUND_GLOW_ART_ROOT;
/**
 * 翻格**脉冲序列帧**目录（5 帧，文件名 `hex_pulse_0..4`，320×320 透明底）。
 *
 * 2026-10-19 换美术：放大与不透明度**烘焙在图里**（1.00→1.78 倍、70%→15%），
 * 视图只按 10fps 换帧、不再叠 scale / opacity，也**不再需要**旧那套 `hex-pulse.effect`
 * 的径向虚化（虚化已经画在图上了）。仍然**按卡牌品阶染色**（1 绿 / 2 蓝 / 3 紫 / 4 金，
 * 没抽到卡也走绿）。只有对局在用。
 */
const HEX_FLIP_PULSE_DIRECTORY = HEX_FLIP_PULSE_ART_ROOT;
/**
 * 神器图标目录（`pvpArtifact[].icon`，如「霜封冰刃」）。
 *
 *  中立资源点里「神器充能」那格的图标要显示**玩家本局携带的那件神器**，而不是写死一张图；
 *  图名来自表，目录在这里拼 —— 与 `pvpCard.icon` / `unitPrefabPath` 同一口径（规则 137）。
 */
const ARTIFACT_DIRECTORY = 'image/artifact';

/**
 * 自选主城（cityMode=select）图在随机抽图中的权重倍数。
 *
 * fixed 图权重恒为 1；倍数越大，开局进入「自选出生点」阶段的概率越高。
 * 池里有 N 张 fixed + M 张 select 时，select 图命中概率 = K·M / (N + K·M)。
 * 当前池：11 fixed + 1 select，K=11 ⇒ select 图命中 = 11/(11+11) = 50%。
 * 后续增删 fixed 图时比例会漂移；想保持 50% 就把 K 改成 fixed 图数量。
 */
const ZC_SPAWN_SELECTION_WEIGHT = 11;

/** 进入对局前准备好的完整首屏资源。 */
export interface ZCGamePreparedResources {
    /** 配置表与本次随机地图合成后冻结的基础战斗配置。 */
    baseMatchConfig: ZCMatchConfig;
    hudPrefab: Prefab;
    /**
     * 棋盘图层容器（`ui/game/ZCGameBoard`）。
     *
     * 水面 / 地块 / 装饰 / 建筑 / 状态条这五层连同它们的层序都在 prefab 里声明，
     * 运行时只按名取引用 —— 以前这五层是 `new Node` 现建的，层序靠 `setSiblingIndex` 现算。
     */
    boardPrefab: Prefab;
    hexPrefab: Prefab;
    unitPrefab: Prefab;
    effectPrefab: Prefab;
    wallPrefab: Prefab;
    wallLayerPrefab: Prefab;
    floatTextPrefab: Prefab;
    /** 抽卡小卡牌（格子上方弹出的品级卡）。 */
    cardRevealPrefab: Prefab;
    /**
     * 传说卡出场横幅（`ui/game/ZCGameLegendBanner`）。
     *
     *  只在抽到金卡（tier 4）时弹出，所以和小卡牌是**两条独立的池**：同一张金卡既弹格子上的
     * 小卡牌、也弹屏幕正中的横幅（策划口径）。几何全在 prefab 里。
     */
    legendBannerPrefab: Prefab;
    /**
     * 场景装饰条目（`image/decor` 那些装饰图的载体）。
     *
     * 把「`sizeMode = CUSTOM` + `trim = false`」这两个配置烘进 prefab —— 它们不是随手设的：
     * CUSTOM 才不让 TRIMMED 按 SpriteFrame 重算尺寸、把 fit 缩放吃掉；不裁边才与地图编辑器
     * 画 `<image>` 的口径一致。以前写在 `installDecor` 里，改配置得动代码。
     */
    decorPrefab: Prefab;
    /**
     * 单位出生特效（`units/effects/出生特效`）。prefab 自带 `cc.Animation` + `playOnLoad`，
     * 渲染层 `ZCGameRenderWorld.playSpawnFx()` 只需 `play(defaultClip.name)` 就能播。
     *
     *  缺失时为 `null` —— 单位照样正常出现，只是少一层出生表现，不影响对局。
     */
    spawnFxPrefab: Prefab | null;
    /**
     * 单位**阵亡特效**（`units/effects/死亡特效`，13 帧 @12fps）。
     *
     *  同样是三段式 + `cc.Animation`（`playOnLoad`），渲染层 `playDeathFx()` 只需
     *  `play(defaultClip.name)`。缺失时为 `null` —— 阵亡表现退回到"只有染灰 + alpha 190"。
     *
     *  ⚠️ **显示尺寸烘在 prefab 根的 `_lscale`**（535×1092 @ 0.16448 ⇒ 屏上 88×179.6）：
     *  它比受击/出生特效的 110px 基准**故意小 20%**（2026-10-16 反馈「整体缩小成 0.8」），
     *  因为它是脚下一团爆开、等宽会跟单位本体抢视觉重心。改大小动 prefab，别在代码里 `setScale`。
     */
    deathFxPrefab: Prefab | null;
    /**
     * 建筑**被拆掉**时的白烟雾爆炸（`units/effects/建筑死亡特效`，4 帧 @12fps）。
     *
     *  建筑一被打掉地块就转 `ruins`，快照里看不出「刚被拆」⇒ 模型发一次性通知
     *  （`buildingDestructions`），渲染层按 hexId 取格心播这一下。缺失时为 `null`。
     */
    buildingDestroyFxPrefab: Prefab | null;
    /**
     * 受击特效，按**攻击方职业**索引（`units/effects/受击特效/<职业>受击`）。
     *
     *   键是 `ZCAttackTrait`（卡表 `traits.attack` 的四个职业），**不是**美术的目录全集 ——
     *  「中毒受击」不在其中（那是状态不是职业）。某个职业缺资源就**没有这个键**，
     *  渲染层 `get(trait)` 拿到 `undefined` 就跳过这一下，**不猜默认职业**。
     */
    hitFxPrefabs: ReadonlyMap<ZCAttackTrait, Prefab>;
    /**
     * 自选主城 HUD（`ui/game/ZCSpawnSelection`）。
     *
     * 节点树 / 尺寸 / Widget 对齐都在 prefab 里声明；以前 `ZCSpawnSelectionView.initialize()`
     * 一进来就 `removeAllChildren()` 再用 `new Node` + `addComponent` 现搭 12 个节点。
     */
    spawnSelectionPrefab: Prefab;
    /** 守城（塔防）局左上角的首领条（`ui/game/ZCBossPanel`）；普通对局加载了但不实例化。 */
    bossPanelPrefab: Prefab;
    unitVisualPrefabs: ReadonlyMap<ZCUnitId, Prefab>;
    effectVisualPrefabs: ReadonlyMap<string, Prefab>;
    /**
     * 本局携带神器的图标帧（`image/artifact/<pvpArtifact[].icon>`）。
     *
     *  中立资源点「神器充能」格的图标用这一张，所以换神器后格子上显示的图会自动跟着变。
     *  拿不到时为 `null` —— 视图回退到文字兜底（`NEUTRAL_RESOURCE_LABELS`），不崩不空。
     */
    artifactIconFrame: SpriteFrame | null;
    /**
     * 中立资源「金币」图标帧（`image/map-resource/gold`）—— 金币飞行特效的贴图。
     *
     * 与格子内金币图标**同一张**（换图两边一起变）。拿不到时为 `null` —— 金币仍照常飞
     * （透明图），不崩不空。
     */
    goldCoinFrame: SpriteFrame | null;
    /**
     * 自选主城区域气泡底图（`image/spawn-region/frame_01` 绿 / `frame_02` 红，九宫格）。
     *
     * 拿不到时为 `null` —— 气泡回退 Graphics 色块（旧样式），不阻断选点。
     */
    spawnRegionFrames: IZCSpawnRegionHintFrames | null;
    /** image/buildings 下的建筑外观帧（按图片名索引）。 */
    buildingFrames: ReadonlyMap<string, SpriteFrame>;
    /** image/walls 下的城墙砖帧（up/down/rightUp/rightDown）。 */
    wallFrames: ReadonlyMap<string, SpriteFrame>;
    /**
     * 城墙砖接缝材质（`shaders/wall-tile.effect` 实例，按墙砖分别融合左右端帽）。
     * 接缝只替换深色端帽颜色并保留原 alpha，避免重叠处黑线或透明断口；
     * 加载失败时为 `null` —— 视图回退默认材质，不影响对局。
     */
    wallMaterial: Material | null;
    /** 非己方 Spine 的**整体外轮廓**（放大副本）shader；缺失时只关闭该表现。 */
    unitOutlineCopyEffect: EffectAsset | null;
    /** 地块抬起后的**底部发光序列帧**（已按帧序排好；空数组 ⇒ 不画光）。 */
    hexGroundGlowFrames: readonly SpriteFrame[];
    /** 翻格**脉冲序列帧（5 帧）**（已按帧序排好；空数组 ⇒ 脉冲段退化为只剩缩没，不报错）。 */
    hexPulseFrames: readonly SpriteFrame[];
    /** 本局地图使用的静态装饰帧，随流程 ResourceScope 释放。 */
    decorFrames: ReadonlyMap<string, SpriteFrame>;
    /** 指南弹窗的配置与图标；Popup 打开时不再发起 I/O。 */
    guide: ZCGuidePreparedContent;
}

/**
 * 对局应用层加载器。
 *
 * 它完成配置注入、地图选择和显示资源准备，但不持有任何场景节点。流程取消时，
 * ProcedureManager 释放传入的 ResourceScope，加载器无需了解页面生命周期。
 */
export class ZCGameLoader {
    private selectedMap: ZCMapLayout | null = null;

    constructor(
        private readonly assets: AssetService,
        private readonly configs: ConfigService,
        private readonly mapDirectory: string,
        private readonly random: () => number = Math.random,
        private readonly playerCountOverride?: 2 | 3 | 4,
    ) {}

    async prepare(scope?: ResourceScope): Promise<ZCGamePreparedResources> {
        await this.loadPvpRuntimeConfig(scope);
        const mapReady = await this.loadRandomMap(scope);
        this.checkActive(scope);
        if (!mapReady) throw new Error(`地图目录中没有可用配置：${this.mapDirectory}`);
        const baseMatchConfig = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });

        const [
            hudPrefab,
            boardPrefab,
            hexPrefab,
            unitPrefab,
            effectPrefab,
            wallPrefab,
            wallLayerPrefab,
            floatTextPrefab,
            cardRevealPrefab,
            legendBannerPrefab,
            decorPrefab,
            spawnSelectionPrefab,
            bossPanelPrefab,
            spawnFxPrefab,
            deathFxPrefab,
            buildingDestroyFxPrefab,
            hitFxPrefabs,
            visualPrefabs,
            buildingFrames,
            wallFrames,
            wallMaterial,
            unitOutlineCopyEffect,
            hexGroundGlowFrames,
            hexPulseFrames,
            decorFrames,
            artifactIconFrame,
            goldCoinFrame,
            spawnRegionFrames,
            guide,
        ] = await Promise.all([
            this.assets.load(HUD_URL, Prefab, { scope }),
            this.assets.load(BOARD_URL, Prefab, { scope }),
            this.assets.load(HEX_URL, Prefab, { scope }),
            this.assets.load(UNIT_URL, Prefab, { scope }),
            this.assets.load(EFFECT_URL, Prefab, { scope }),
            this.assets.load(WALL_URL, Prefab, { scope }),
            this.assets.load(WALL_LAYER_URL, Prefab, { scope }),
            this.assets.load(FLOAT_TEXT_URL, Prefab, { scope }),
            this.assets.load(CARD_REVEAL_URL, Prefab, { scope }),
            this.assets.load(LEGEND_BANNER_URL, Prefab, { scope }),
            this.assets.load(DECOR_URL, Prefab, { scope }),
            this.assets.load(SPAWN_SELECTION_URL, Prefab, { scope }),
            this.assets.load(BOSS_PANEL_URL, Prefab, { scope }),
            this.loadSpawnFxPrefab(scope),
            this.loadDeathFxPrefab(scope),
            this.loadBuildingDestroyFxPrefab(scope),
            this.loadHitFxPrefabs(scope),
            this.loadVisualPrefabs(scope),
            this.loadBuildingFrames(scope),
            this.loadWallFrames(scope),
            this.loadWallMaterial(scope),
            this.loadUnitOutlineCopyEffect(scope),
            this.loadHexGroundGlowFrames(scope),
            this.loadHexPulseFrames(scope),
            this.loadDecorFrames(scope),
            this.loadArtifactIconFrame(scope),
            this.loadGoldCoinFrame(scope),
            this.loadSpawnRegionFrames(scope),
            new ZCGuideLoader(this.assets, this.configs).prepare(scope),
        ]);
        this.checkActive(scope);

        return {
            baseMatchConfig,
            artifactIconFrame,
            goldCoinFrame,
            spawnRegionFrames,
            hudPrefab,
            boardPrefab,
            hexPrefab,
            unitPrefab,
            effectPrefab,
            wallPrefab,
            wallLayerPrefab,
            floatTextPrefab,
            cardRevealPrefab,
            legendBannerPrefab,
            decorPrefab,
            spawnSelectionPrefab,
            bossPanelPrefab,
            spawnFxPrefab,
            deathFxPrefab,
            buildingDestroyFxPrefab,
            hitFxPrefabs,
            unitVisualPrefabs: visualPrefabs.units,
            effectVisualPrefabs: visualPrefabs.effects,
            buildingFrames,
            wallFrames,
            wallMaterial,
            unitOutlineCopyEffect,
            hexGroundGlowFrames,
            hexPulseFrames,
            decorFrames,
            guide,
        };
    }

    /** 加载候选地图并跳过损坏项；全部无效时返回 false。 */
    async loadRandomMap(scope?: ResourceScope): Promise<boolean> {
        let maps: JsonAsset[];
        try {
            maps = await this.assets.loadDir(this.mapDirectory, JsonAsset, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录加载失败：${this.mapDirectory}`, error);
            return false;
        }
        this.checkActive(scope);
        if (!maps.length) {
            if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录为空：${this.mapDirectory}`);
            return false;
        }

        // 2 / 3 / 4 人固定主城、自选主城图都进入随机池；多人图由本机玩家 + 本地 AI 席位运行。
        // 判据在 `isRandomMapCandidate` 一处，别在这里另写一份人数判断。
        const requestedPlayerCount = this.playerCountOverride ?? getZCLocalPlayerCountOverride();
        const candidates = maps.filter((asset) => isRandomMapCandidate(
            asset.json as ZCMapLayout | null,
            requestedPlayerCount,
        ));
        if (!candidates.length) {
            if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录里没有可随机的固定主城图：${this.mapDirectory}`);
            return false;
        }
        while (candidates.length) {
            // 加权抽样：select 图按倍数放大权重，fixed 图权重 1。
            // 上一张 configure 失败被 splice 后，剩余候选重算权重——失败的是哪类图不影响剩余加权。
            const weights = candidates.map((asset) =>
                (asset.json as ZCMapLayout | null)?.cityMode === 'select'
                    ? ZC_SPAWN_SELECTION_WEIGHT
                    : 1);
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
            let cursor = this.random() * totalWeight;
            let index = 0;
            for (; index < candidates.length - 1; index += 1) {
                cursor -= weights[index];
                if (cursor < 0) break;
            }
            const [asset] = candidates.splice(index, 1);
            const layout = asset.json as ZCMapLayout;
            try {
                configureZCMap(layout);
                this.selectedMap = layout;
                return true;
            } catch (cause) {
                if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 跳过无效地图：${asset.name}`, cause);
            }
        }
        if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录中没有可用配置：${this.mapDirectory}`);
        return false;
    }

    private async loadVisualPrefabs(scope?: ResourceScope): Promise<{
        units: ReadonlyMap<ZCUnitId, Prefab>;
        effects: ReadonlyMap<string, Prefab>;
    }> {
        const definitions = getAllUnitDefinitions();
        const units = new Map<ZCUnitId, Prefab>();
        const effects = new Map<string, Prefab>();
        const load = async (path: string, assign: (prefab: Prefab) => void): Promise<void> => {
            try {
                assign(await this.assets.load(path, Prefab, { scope }));
            } catch (error) {
                // 单个表现资源缺失不阻断整局，渲染层会回退到通用单位/特效壳。
                if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 配置的 Prefab 加载失败：${path}`, error);
            }
        };

        const tasks = definitions.map((definition) => (
            load(definition.prefabPath, (prefab) => units.set(definition.unitId, prefab))
        ));
        //  必须**同时**收普攻行与技能行（`empoweredProfile`）的路径 ——
        // 漏掉后者时强化那一击的 prefab 不在 `effectVisualPrefabs` 里，
        // 而 `ZCGameRenderWorld` 只按 `event.effectPrefabPath` 查这张表，
        // 查不到就退回通用特效壳：不报错、只是"技能特效永远不出现"。
        const effectPaths = definitions
            .flatMap((definition) => [
                definition.attackProfile.effectPrefabPath,
                definition.empoweredProfile?.effectPrefabPath,
            ])
            .filter(Boolean) as string[];
        for (const override of getZCModifierCatalogs().adapters.textOverrides.values()) {
            if (override.enabled && override.statId === 'model') effectPaths.push(override.value);
        }
        for (const path of new Set(effectPaths)) {
            tasks.push(load(path, (prefab) => effects.set(path, prefab)));
        }
        await Promise.all(tasks);
        return { units, effects };
    }

    /**
     * 加载 image/buildings 目录下全部建筑外观帧（SpriteFrame.name = 图片名，按它索引）。
     * 失败不阻断整局：视图会回退到 prefab 里 @property 绑定的类型通用图。
     */
    private async loadBuildingFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const frames = new Map<string, SpriteFrame>();
        try {
            const assets = await this.assets.loadDir(BUILDING_DIRECTORY, SpriteFrame, { scope });
            for (const frame of assets) {
                if (frame?.name) frames.set(frame.name, frame);
            }
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 建筑外观目录加载失败：${BUILDING_DIRECTORY}`, error);
        }
        return frames;
    }

    /**
     * 加载**本局携带的那件神器**的图标（`image/artifact/<pvpArtifact[].icon>`）。
     *
     *  失败不阻断整局：返回 `null`，视图回退到文字兜底（与「三张资源点图」的
     *  「取不到就文字」是同一套降级思路）。
     */
    private async loadArtifactIconFrame(scope?: ResourceScope): Promise<SpriteFrame | null> {
        // 图名真源= `pvpArtifact` 第一行的 `icon` 列（已拍进 rules.artifactIcon）。
        const iconName = getPvpRuntimeRules().artifactIcon;
        if (!iconName) {
            if (ZCDC_LOG_WARNINGS) console.warn('[ZCGameLoader] pvpArtifact[].icon 为空，神器充能格将退回文字兜底');
            return null;
        }
        //  必须走 `spriteFramePath` 补 `/spriteFrame` 后缀 —— Cocos 把每张 png 导成
        // SpriteFrame **子资源**，裸路径（`image/artifact/霜封冰刃`）在bundle 里查不到，
        // 报错形态是 `Bundle resources doesn't contain ...`（不是 404，容易误判成「美术没交图」）。
        const path = spriteFramePath(ARTIFACT_DIRECTORY, iconName);
        try {
            return await this.assets.load(path, SpriteFrame, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 神器图标加载失败：${path}`, error);
            return null;
        }
    }

    /**
     * 金币飞行特效的贴图：`image/map-resource/coin_icon`（**单枚金币 icon**，与 HUD 金币栏 /
     * 格子金币资源图标同款视觉）。
     *
     * ⚠️ **别用 `image/map-resource/gold`** —— 那是一张「金币堆 + 钱袋」的装饰插画，
     * 一颗颗飞过去像在飞装饰。2026-10-20 已切到 `coin_icon`。
     *
     * 失败不阻断整局：返回 `null`，金币飞行仍照常播（透明图 + 上飘数字照旧）。
     */
    private async loadGoldCoinFrame(scope?: ResourceScope): Promise<SpriteFrame | null> {
        try {
            return await this.assets.load(spriteFramePath(MAP_RESOURCE_ART_ROOT, 'coin_icon'), SpriteFrame, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn('[ZCGameLoader] 金币图标加载失败（金币飞行特效将透明），', error);
            return null;
        }
    }

    /**
     * 自选主城区域气泡底图：`image/spawn-region/frame_01`（绿 = 中/后区）、`frame_02`（红 = 前区）。
     *
     * 缺任何一张只掉对应纵深的气泡（回退 Graphics 色块）；两张全缺返回 `null`。
     * 失败不阻断选点流程。
     */
    private async loadSpawnRegionFrames(scope?: ResourceScope): Promise<IZCSpawnRegionHintFrames | null> {
        const [frame01, frame02] = await Promise.all([
            this.loadSpawnRegionFrame('frame_01', scope),
            this.loadSpawnRegionFrame('frame_02', scope),
        ]);
        if (!frame01 && !frame02) return null;
        return { front: frame02, mid: frame01, back: frame01 };
    }

    private async loadSpawnRegionFrame(name: 'frame_01' | 'frame_02', scope?: ResourceScope): Promise<SpriteFrame | null> {
        try {
            return await this.assets.load(spriteFramePath(SPAWN_REGION_ART_ROOT, name), SpriteFrame, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 区域气泡切图加载失败：${name}`, error);
            return null;
        }
    }

    /**
     * 加载单位出生特效 prefab。失败不阻断整局：单位照样正常出现，只是少一层出生表现。
     *
     *  与神��图标同理走容错 —— 出生特效是纯表现件，不该因为它没交/ 路径写错就让整局开不起来。
     */
    private async loadSpawnFxPrefab(scope?: ResourceScope): Promise<Prefab | null> {
        try {
            return await this.assets.load(SPAWN_FX_URL, Prefab, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 出生特效加载失败：${SPAWN_FX_URL}`, error);
            return null;
        }
    }

    /**
     * 加载单位阵亡特效 prefab。失败不阻断整局 —— 与出生特效同一套容错理由。
     */
    private async loadDeathFxPrefab(scope?: ResourceScope): Promise<Prefab | null> {
        try {
            return await this.assets.load(DEATH_FX_URL, Prefab, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 阵亡特效加载失败：${DEATH_FX_URL}`, error);
            return null;
        }
    }

    /**
     * 加载建筑摧毁特效 prefab。失败不阻断整局 —— 与出生 / 阵亡特效同一套容错理由：
     * 纯表现件缺失时建筑照常变废墟，只是少一层交代。
     */
    private async loadBuildingDestroyFxPrefab(scope?: ResourceScope): Promise<Prefab | null> {
        try {
            return await this.assets.load(BUILDING_DESTROY_FX_URL, Prefab, { scope });
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) {
                console.warn(`[ZCGameLoader] 建筑死亡特效加载失败：${BUILDING_DESTROY_FX_URL}`, error);
            }
            return null;
        }
    }

    /**
     * 加载四个职业的受击特效 prefab。
     *
     *  **逐个 `load`、不 `loadDir`**：`loadDir` 会把 `受击特效/` 下**全部**资源捞回来，
     * 包括美术那组「中毒受击」（不是职业）和每个目录里的 `.pac` / `.anim` / 裸帧 ——
     * 白白进内存、还得再筛一遍。这里按 `HIT_FX_TRAITS` 精确点名要哪四个。
     *
     * 单个失败只 `warn` 并跳过那一个键（Map 里就没这个职业了），
     * **不 throw** —— 美术少交一组不该让整局开不起来。
     */
    private async loadHitFxPrefabs(
        scope?: ResourceScope,
    ): Promise<ReadonlyMap<ZCAttackTrait, Prefab>> {
        const prefabs = new Map<ZCAttackTrait, Prefab>();
        await Promise.all(HIT_FX_TRAITS.map(async (trait) => {
            const url = `${HIT_FX_DIRECTORY}/${trait}受击/${trait}受击`;
            try {
                const prefab = await this.assets.load(url, Prefab, { scope });
                if (prefab) prefabs.set(trait, prefab);
            } catch (error) {
                if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 受击特效加载失败：${url}`, error);
            }
        }));
        return prefabs;
    }

    /**
     * 加载 image/walls 下的城墙砖帧（SpriteFrame.name = up/down/rightUp/rightDown）。
     * 失败不阻断整局：渲染层回退到 wall prefab 里原绑定的可拉伸通用墙砖。
     */
    private async loadWallFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const frames = new Map<string, SpriteFrame>();
        try {
            const assets = await this.assets.loadDir(WALL_TILE_DIRECTORY, SpriteFrame, { scope });
            for (const frame of assets) {
                if (frame?.name) frames.set(frame.name, frame);
            }
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 城墙砖目录加载失败：${WALL_TILE_DIRECTORY}`, error);
        }
        return frames;
    }

    /**
     * 加载城墙砖接缝材质（`shaders/wall-tile.effect`）。失败不阻断对局：返回 null，
     * 渲染层回退默认材质（砖自带描边，仅重叠接缝处不再融合）。
     */
    private async loadWallMaterial(scope?: ResourceScope): Promise<Material | null> {
        try {
            const effect = await this.assets.load(WALL_TILE_EFFECT_URL, EffectAsset, { scope });
            if (!effect) return null;
            const material = new Material();
            material.initialize({ effectAsset: effect });
            return material;
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 城墙砖接缝材质加载失败：${WALL_TILE_EFFECT_URL}`, error);
            return null;
        }
    }

    /** 兵种整体外轮廓（放大副本）；失败返回 null ⇒ 只关闭该表现，不影响对局。 */
    private async loadUnitOutlineCopyEffect(scope?: ResourceScope): Promise<EffectAsset | null> {
        try {
            return await this.assets.load(UNIT_OUTLINE_COPY_EFFECT_URL, EffectAsset, { scope }) ?? null;
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 单位整体轮廓材质加载失败：${UNIT_OUTLINE_COPY_EFFECT_URL}`, error);
            return null;
        }
    }

    /** 序列帧按文件名排序；单目录加载失败时不影响对局表现。 */
    private async loadSortedSpriteFrames(
        directory: string,
        label: string,
        scope?: ResourceScope,
    ): Promise<SpriteFrame[]> {
        try {
            const assets = await this.assets.loadDir(directory, SpriteFrame, { scope });
            return assets
                .filter((frame) => !!frame?.name)
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] ${label}序列帧加载失败：${directory}`, error);
            return [];
        }
    }

    /** 加载地块抬起后的底部发光序列帧。 */
    private loadHexGroundGlowFrames(scope?: ResourceScope): Promise<SpriteFrame[]> {
        return this.loadSortedSpriteFrames(HEX_GROUND_GLOW_DIRECTORY, '底部发光', scope);
    }

    /** 加载翻格脉冲呼吸序列帧。 */
    private loadHexPulseFrames(scope?: ResourceScope): Promise<SpriteFrame[]> {
        return this.loadSortedSpriteFrames(HEX_FLIP_PULSE_DIRECTORY, '翻格脉冲', scope);
    }

    /** 仅加载本局地图声明的装饰，资源生命周期交给当前流程。 */
    private async loadDecorFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const names = new Set<string>();
        for (const item of this.selectedMap?.art?.freeDecor ?? []) {
            if (typeof item?.art === 'string' && item.art.trim()) names.add(item.art.trim());
        }
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(Array.from(names).map(async (name) => {
            try {
                frames.set(name, await this.assets.load(decorFramePath(name), SpriteFrame, { scope }));
            } catch (error) {
                // 装饰缺失不阻断对局；对应格子保持空白并留下可定位日志。
                if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGameLoader] 地图装饰加载失败：${name}`, error);
            }
        }));
        return frames;
    }

    private checkActive(scope?: ResourceScope): void {
        if (scope?.disposed) throw new Error('对局预加载已取消');
    }

    private async loadPvpRuntimeConfig(scope?: ResourceScope): Promise<void> {
        await this.configs.initialize();
        this.checkActive(scope);
        const names = [
            'pvpGlobal',
            'pvpArtifact',
            'pvpCard',
            'pvpSkill',
            'pvpCounter',
            'pvpBond',
            'pvpTile',
            'pvpPity',
            'pvpTileGen',
            'pvpTileGenParams',
            'pvpBaseTeamWeight',
            'skillAttrModifier',
            'generalStar',
            'pvpAttrMap',
            'pvpModifierOverride',
            'pvpUnitGrowth',
            'pvpSkillBinding',
            'pvpStatus',
            'pvpSkillPlan',
            'skillAttr',
            'skillView',
            'skillEffect',
            'skillBuff',
        ] as const;
        const values = await Promise.all(names.map((name) => this.configs.getTable(name)));
        this.checkActive(scope);
        // names 与 ZCPvpTables 的可选字段一一对应（见上方 as const 列表），这里直接按
        // Partial<ZCPvpTables> 拼装，不再做 unknown → ZCPvpTables 的双重断言。
        const tables: Partial<ZCPvpTables> = {};
        names.forEach((name, index) => {
            (tables as Record<string, unknown>)[name] = values[index] ?? [];
        });
        loadPvpTables(tables);
    }
}
