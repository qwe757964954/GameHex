import { ZC_BATTLE_FX_PATHS, ZC_BATTLE_SHELL_PATHS } from '../model/ZCGameResourcePlan';
import { EffectAsset, JsonAsset, Material, Prefab, SpriteFrame } from 'cc';
import type { AssetLoadOptions } from '../../../core/asset/AssetService';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import { BATTLE_BUNDLE } from '../../../core/asset/BundleCatalog';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { findCatalogCard, getAllUnitDefinitions, setCardRarityMeta, ZC_ATTACK_TRAITS } from '../model/ZCCombatCatalog';
import type { ZCAttackTrait, ZCUnitId } from '../model/ZCCombatCatalog';
import { configureZCMap, getZCLocalPlayerCountOverride, isRandomMapCandidate } from '../model/ZCGameModel';
import type { ZCMapLayout } from '../model/ZCGameModel';
import { getPvpRuntimeRules, isZCRuntimeCompiled } from '../model/ZCGameRuntimeConfig';
import { getZCModifierCatalogs } from '../model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import { decorFramePath, GAMEUI_ART_ROOT, NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME, ARTIFACT_CLAIM_BURST_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT, HEX_GROUND_GLOW_ART_ROOT, MAP_RESOURCE_ART_ROOT, SPAWN_REGION_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { ZCDC_LOG_DIAGNOSTICS, ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { ZCGuideLoader } from './ZCGuideLoader';
import type { IZCGuidePreparedContent } from './ZCGuideLoader';
import type { IZCDeferredBattleArt, IZCGamePreparedResources } from './ZCGamePreparedResources';
import type { IZCSpawnRegionHintFrames } from '../view/ZCSpawnRegionHintOverlay';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import { buildZCClientCombatConfig } from './ZCClientCombatConfig';
import { ensureZCRuntimeCompiled } from './ZCRuntimePrecompiler';
import { buildZCVisualResourcePlan } from '../model/ZCVisualResourcePlan';
import { getZCNeutralResourceCatalog } from '../model/ZCNeutralResourceGroup';
import { CARD_ART_TABLES, parseCardArtConfig, type ICardArtConfig } from '../../card/CardArtConfig';

const BATTLE_ENTRY_PRIORITY = 100;
const BATTLE_DEFERRED_PRIORITY = 10;
const DEFERRED_ART_YIELD_MS = 16;
const COMMON_EFFECT_DIRECTORY = 'units/effects';

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
 * 只画不透明像素，排在角色后面。
 */
const UNIT_OUTLINE_COPY_EFFECT_URL = 'shaders/unit-outline-copy';
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

type IZCShellPrefabs = Pick<IZCGamePreparedResources,
    'hudPrefab' | 'boardPrefab' | 'hexPrefab' | 'unitPrefab' | 'effectPrefab' | 'wallPrefab' |
    'wallLayerPrefab' | 'floatTextPrefab' | 'cardRevealPrefab' | 'legendBannerPrefab' |
    'decorPrefab' | 'spawnSelectionPrefab' | 'bossPanelPrefab'>;

/**
 * 对局应用层加载器。
 *
 * 它完成配置注入、地图选择和显示资源准备，但不持有任何场景节点。流程取消时，
 * ProcedureManager 释放传入的 ResourceScope，加载器无需了解页面生命周期。
 */
export class ZCGameLoader {
    private selectedMap: ZCMapLayout | null = null;

    constructor(
        private readonly resources: Pick<IControllerResources, 'assets' | 'configs'>,
        private readonly mapDirectory: string,
        private readonly random: () => number = Math.random,
        private readonly playerCountOverride?: 2 | 3 | 4,
    ) {}

    /** 仅用于 battle 独占资源；共享目录与配表路径交给 AssetService 按归属路由。 */
    private readonly battleOptions = (scope?: ResourceScope, priority = BATTLE_ENTRY_PRIORITY): AssetLoadOptions => ({ scope, bundle: BATTLE_BUNDLE, priority });

    async prepare(scope?: ResourceScope, battle?: ZCBattleStart | null, waveCardIds: readonly number[] = []): Promise<IZCGamePreparedResources> {
        const startedAt = Date.now();
        // 文件读取不依赖战斗表；地图筛选与 configure 仍在本局配置应用后执行。
        const mapFiles = this.resources.assets.loadDir(this.mapDirectory, JsonAsset, { scope, priority: BATTLE_ENTRY_PRIORITY });
        // 配置较慢或先失败时，提前失败的地图请求也必须立即有人处理拒绝。
        void mapFiles.catch(() => {});
        await this.loadPvpRuntimeConfig(scope);
        const configReadyAt = Date.now();
        if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] 战斗配置准备 ${configReadyAt - startedAt}ms`);
        const count = battle?.units.length;
        const battlePlayerCount = count === 2 || count === 3 || count === 4 ? count : undefined;
        const mapReady = await this.loadRandomMap(scope, battlePlayerCount, mapFiles, battle?.mapInfo);
        if (!mapReady) throw new Error(`地图目录中没有可用配置：${this.mapDirectory}`);
        const mapReadyAt = Date.now();
        if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] 地图准备 ${mapReadyAt - configReadyAt}ms`);
        const baseMatchConfig = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
        const { heroIds, modifiers } = this.buildVisualInputs(battle, waveCardIds, baseMatchConfig);
        // 后补机制只依赖 scope 做资源归属与取消检查，不依赖 battle；
        // PVE 本地局（battle=null）同样首帧快进，特效、序列帧与装饰在首帧后补齐。
        const progressive = !!scope;
        // 在任何后补 await 之前捕获地图声明，避免下一局重配污染本局。
        const decorNames = Array.from(new Set((this.selectedMap?.art?.freeDecor ?? [])
            .flatMap(item => typeof item?.art === 'string' && item.art.trim() ? [item.art.trim()] : [])));
        const selectSpawn = baseMatchConfig.map.cityMode === 'select';
        const [shellPrefabs, effects, visualPrefabs, terrain, icons, sceneEffects, cardArtConfig] = await Promise.all([
            this.traceArt('公共外壳', this.loadShellPrefabs(scope, selectSpawn, !battle || waveCardIds.length > 0)),
            this.traceArt('公共特效', this.loadInitialEffects(scope, progressive)),
            this.loadVisualPrefabs(scope, heroIds, modifiers, progressive),
            this.traceArt('地形美术', this.loadTerrainArt(scope)),
            this.traceArt('地图图标', this.loadMapIcons(scope, selectSpawn)),
            this.traceArt('场景表现', this.loadInitialSceneEffects(scope, progressive)),
            this.loadCardArtConfig(scope),
        ]);
        this.checkActive(scope);
        if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] ${progressive ? '首帧美术准备' : '战斗美术准备'} ${Date.now() - mapReadyAt}ms`);
        return {
            cardArtConfig,
            baseMatchConfig,
            hudPrefab: shellPrefabs.hudPrefab,
            boardPrefab: shellPrefabs.boardPrefab,
            hexPrefab: shellPrefabs.hexPrefab,
            unitPrefab: shellPrefabs.unitPrefab,
            effectPrefab: shellPrefabs.effectPrefab,
            wallPrefab: shellPrefabs.wallPrefab,
            wallLayerPrefab: shellPrefabs.wallLayerPrefab,
            floatTextPrefab: shellPrefabs.floatTextPrefab,
            cardRevealPrefab: shellPrefabs.cardRevealPrefab,
            legendBannerPrefab: shellPrefabs.legendBannerPrefab,
            decorPrefab: shellPrefabs.decorPrefab,
            spawnSelectionPrefab: shellPrefabs.spawnSelectionPrefab,
            bossPanelPrefab: shellPrefabs.bossPanelPrefab,
            spawnFxPrefab: effects.spawnFxPrefab,
            deathFxPrefab: effects.deathFxPrefab,
            buildingDestroyFxPrefab: effects.buildingDestroyFxPrefab,
            hitFxPrefabs: effects.hitFxPrefabs,
            buildingFrames: terrain.buildingFrames,
            wallFrames: terrain.wallFrames,
            wallMaterial: terrain.wallMaterial,
            unitOutlineCopyEffect: terrain.unitOutlineCopyEffect,
            artifactIconFrame: icons.artifactIconFrame,
            unknownResourceFrame: icons.unknownResourceFrame,
            goldCoinFrame: icons.goldCoinFrame,
            spawnRegionFrames: icons.spawnRegionFrames,
            neutralResourceFrames: icons.neutralResourceFrames,
            hexGroundGlowFrames: sceneEffects.hexGroundGlowFrames,
            hexPulseFrames: sceneEffects.hexPulseFrames,
            artifactClaimBurstFrames: sceneEffects.artifactClaimBurstFrames,
            decorFrames: sceneEffects.decorFrames,
            unitVisualPrefabs: visualPrefabs.units,
            effectVisualPrefabs: visualPrefabs.effects,
            loadGuide: this.createGuideTask(scope),
            loadDeferredArt: progressive ? this.createDeferredArt(scope, visualPrefabs.effectPaths, decorNames) : undefined,
        };
    }

    private buildVisualInputs(battle: ZCBattleStart | null | undefined, waveCardIds: readonly number[], baseMatchConfig: ZCMatchConfig) {
        // 波次、中立奖励与兵团可从完整目录产兵，不受后端参战卡池限制。
        const neutralUnitCardIds = Array.from(getZCNeutralResourceCatalog().items.values())
            .flatMap((item) => item.feature?.resId ? [item.feature.resId]
                : item.cardId && item.unitCount > 0 ? [item.cardId] : []);
        const additionalCardIds = battle ? waveCardIds.map(String).concat(neutralUnitCardIds) : [];
        const additionalUnitIds = additionalCardIds.flatMap((cardId) => {
            const unitId = findCatalogCard(cardId)?.unitId;
            return unitId === undefined ? [] : [Number(unitId)];
        });
        const heroIds = battle ? battle.units
            .flatMap((unit) => unit.heroes?.map((hero) => hero.heroId) ?? unit.heroIds)
            .concat(additionalUnitIds) : undefined;
        const modifiers = battle ? buildZCClientCombatConfig(baseMatchConfig, battle, undefined, { allowUnresolvedSelect: true }).config.modifiers : undefined;

        return { heroIds, modifiers };
    }

    private async loadInitialEffects(scope: ResourceScope | undefined, progressive: boolean) {
        if (progressive) return {
            spawnFxPrefab: null, deathFxPrefab: null, buildingDestroyFxPrefab: null,
            hitFxPrefabs: new Map<ZCAttackTrait, Prefab>(),
        };
        return this.loadCommonEffects(scope);
    }

    private async loadTerrainArt(scope?: ResourceScope) {
        const [buildingFrames, wallFrames, wallMaterial, unitOutlineCopyEffect] = await Promise.all([
            this.loadBuildingFrames(scope),
            this.loadWallFrames(scope),
            this.loadWallMaterial(scope),
            this.loadUnitOutlineCopyEffect(scope),
        ]);
        return { buildingFrames, wallFrames, wallMaterial, unitOutlineCopyEffect };
    }

    private async loadMapIcons(scope: ResourceScope | undefined, selectSpawn: boolean) {
        const [artifactIconFrame, unknownResourceFrame, goldCoinFrame, spawnRegionFrames, neutralResourceFrames] = await Promise.all([
            this.loadArtifactIconFrame(scope),
            selectSpawn ? this.loadUnknownResourceFrame(scope) : null,
            this.loadGoldCoinFrame(scope),
            selectSpawn ? this.loadSpawnRegionFrames(scope) : null,
            this.loadNeutralResourceFrames(scope),
        ]);
        return { artifactIconFrame, unknownResourceFrame, goldCoinFrame, spawnRegionFrames, neutralResourceFrames };
    }

    private async loadInitialSceneEffects(scope: ResourceScope | undefined, progressive: boolean) {
        if (progressive) return {
            hexGroundGlowFrames: [] as SpriteFrame[], hexPulseFrames: [] as SpriteFrame[],
            artifactClaimBurstFrames: [] as SpriteFrame[], decorFrames: new Map<string, SpriteFrame>(),
        };
        const [hexGroundGlowFrames, hexPulseFrames, artifactClaimBurstFrames, decorFrames] = await Promise.all([
            this.loadHexGroundGlowFrames(scope),
            this.loadHexPulseFrames(scope),
            this.loadArtifactClaimBurstFrames(scope),
            this.loadDecorFrames(scope),
        ]);
        return { hexGroundGlowFrames, hexPulseFrames, artifactClaimBurstFrames, decorFrames };
    }

    private async loadCardArtConfig(scope?: ResourceScope): Promise<ICardArtConfig> {
        const [rarity, cardClass, camp, icons] = await Promise.all([
            this.resources.configs.getTable(CARD_ART_TABLES.rarity),
            this.resources.configs.getTable(CARD_ART_TABLES.cardClass),
            this.resources.configs.getTable(CARD_ART_TABLES.camp),
            this.resources.configs.getTable('icon'),
        ]);
        this.checkActive(scope);
        const art = parseCardArtConfig({ rarity: rarity ?? [], cardClass: cardClass ?? [], camp: camp ?? [] }, icons);
        setCardRarityMeta(art.lineup.rarities);
        return art;
    }

    private createGuideTask(scope?: ResourceScope): IZCGamePreparedResources['loadGuide'] {
        let guideTask: Promise<IZCGuidePreparedContent> | null = null;
        return () => {
            this.checkActive(scope);
            if (guideTask) return guideTask;
            const task = new ZCGuideLoader(this.resources).prepare(scope);
            guideTask = task;
            void task.catch(() => { if (guideTask === task) guideTask = null; });
            return task;
        };
    }

    private async loadShellPrefabs(scope: ResourceScope | undefined, selectSpawn: boolean, hasBossPanel: boolean): Promise<IZCShellPrefabs> {
        const paths = {
            hudPrefab: ZC_BATTLE_SHELL_PATHS.hud, boardPrefab: ZC_BATTLE_SHELL_PATHS.board, hexPrefab: ZC_BATTLE_SHELL_PATHS.hex, unitPrefab: ZC_BATTLE_SHELL_PATHS.unit,
            effectPrefab: ZC_BATTLE_SHELL_PATHS.effect, wallPrefab: ZC_BATTLE_SHELL_PATHS.wall, wallLayerPrefab: ZC_BATTLE_SHELL_PATHS.wallLayer,
            floatTextPrefab: ZC_BATTLE_SHELL_PATHS.floatText, cardRevealPrefab: ZC_BATTLE_SHELL_PATHS.cardReveal,
            legendBannerPrefab: ZC_BATTLE_SHELL_PATHS.legendBanner, decorPrefab: ZC_BATTLE_SHELL_PATHS.decor,
            spawnSelectionPrefab: selectSpawn ? ZC_BATTLE_SHELL_PATHS.spawnSelection : null,
            bossPanelPrefab: hasBossPanel ? ZC_BATTLE_SHELL_PATHS.bossPanel : null,
        };
        const entries = Object.entries(paths).filter(([, path]) => path !== null);
        const requests = entries.map(([, path]) => ({ path, type: Prefab,
            options: { bundle: BATTLE_BUNDLE, priority: BATTLE_ENTRY_PRIORITY } }));
        const assets = this.resources.assets;
        // 正式入口复用资源管理器批次；可选槽位只在模式需要时加载。
        const values = scope && assets.loadBatch
            ? await assets.loadBatch(requests, { scope }).result
            : await Promise.all(requests.map(request => assets.load(request.path, request.type, { bundle: request.options.bundle, priority: request.options.priority, scope })));
        if (values === false) throw new Error('战斗资源批量加载已取消');
        // 批次按请求顺序返回；在此恢复名称，调用方不依赖数组位置。
        return Object.assign(
            { spawnSelectionPrefab: null, bossPanelPrefab: null },
            Object.fromEntries(entries.map(([key], index) => [key, values[index]])),
        ) as IZCShellPrefabs;
    }

    private createDeferredArt(scope: ResourceScope | undefined, effectPaths: readonly string[], decorNames: readonly string[]): NonNullable<IZCGamePreparedResources['loadDeferredArt']> {
        let task: Promise<void> | null = null;
        return onUpdate => {
            if (task) return task;
            task = (async () => {
                const startedAt = Date.now();
                let art: IZCDeferredBattleArt = {
                    effectVisualPrefabs: new Map(), hitFxPrefabs: new Map(), decorFrames: new Map(),
                    spawnFxPrefab: null, deathFxPrefab: null, buildingDestroyFxPrefab: null,
                };
                const jobs: Array<() => Promise<Partial<IZCDeferredBattleArt>>> = [
                    // 点击地块马上会用到的5帧脉冲先补齐，其余辅助序列帧排在战斗特效后。
                    async () => ({ hexPulseFrames: await this.loadSortedSpriteFrames(HEX_FLIP_PULSE_ART_ROOT, scope, BATTLE_DEFERRED_PRIORITY) }),
                    () => this.loadCommonEffects(scope, BATTLE_DEFERRED_PRIORITY),
                ];
                for (const path of effectPaths) {
                    jobs.push(async () => {
                        const prefab = await this.resources.assets.load(path, Prefab, { scope, priority: BATTLE_DEFERRED_PRIORITY });
                        const effectVisualPrefabs = new Map(art.effectVisualPrefabs);
                        effectVisualPrefabs.set(path, prefab);
                        return { effectVisualPrefabs };
                    });
                }
                jobs.push(
                    async () => ({ hexGroundGlowFrames: await this.loadSortedSpriteFrames(HEX_GROUND_GLOW_ART_ROOT, scope, BATTLE_DEFERRED_PRIORITY) }),
                    async () => ({ artifactClaimBurstFrames: await this.loadSortedSpriteFrames(ARTIFACT_CLAIM_BURST_ART_ROOT, scope, BATTLE_DEFERRED_PRIORITY) }),
                );
                for (const name of decorNames) {
                    jobs.push(async () => {
                        const frame = await this.resources.assets.load(decorFramePath(name), SpriteFrame, { scope, cache: false, priority: BATTLE_DEFERRED_PRIORITY });
                        const decorFrames = new Map(art.decorFrames);
                        decorFrames.set(name, frame);
                        return { decorFrames };
                    });
                }
                for (const job of jobs) {
                    // 每批之间给交互、退出与渲染留出机会。
                    await new Promise<void>(resolve => setTimeout(resolve, DEFERRED_ART_YIELD_MS));
                    this.checkActive(scope);
                    const patch = await job();
                    this.checkActive(scope);
                    art = Object.assign({}, art, patch);
                    onUpdate(art);
                }
                if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] 完整特效准备 ${Date.now() - startedAt}ms（首帧后）`);
            })();
            return task;
        };
    }

    private async traceArt<T>(label: string, task: Promise<T>): Promise<T> {
        const startedAt = Date.now();
        try { return await task; }
        finally { if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] ${label}等待 ${Math.max(0, Date.now() - startedAt)}ms`); }
    }

    /** 加载候选地图并跳过损坏项；全部无效时返回 false。 */
    async loadRandomMap(scope?: ResourceScope, battlePlayerCount?: 2 | 3 | 4, mapFiles?: Promise<JsonAsset[]>, mapInfo?: Readonly<CmdPvpMapInfo>): Promise<boolean> {
        let maps: JsonAsset[];
        try {
            maps = await (mapFiles ?? this.resources.assets.loadDir(this.mapDirectory, JsonAsset, { scope, priority: BATTLE_ENTRY_PRIORITY }));
        } catch (error) {
            if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录加载失败：${this.mapDirectory}`, error);
            return false;
        }
        this.checkActive(scope);
        if (mapInfo) {
            const matches = maps.filter(asset => {
                const layout = asset.json as ZCMapLayout | null;
                return layout?.id === mapInfo.id && (layout.version ?? 1) === mapInfo.version;
            });
            if (matches.length !== 1) throw new Error(`后端地图不存在或不唯一：${mapInfo.id} v${mapInfo.version}`);
            const layout = matches[0].json as ZCMapLayout;
            if (!isRandomMapCandidate(layout, battlePlayerCount)) throw new Error(`后端地图人数或模式不匹配：${mapInfo.id}`);
            configureZCMap(layout);
            this.selectedMap = layout;
            return true;
        }
        if (!maps.length) {
            if (ZCDC_LOG_WARNINGS) console.error(`[ZCGameLoader] 地图目录为空：${this.mapDirectory}`);
            return false;
        }

        // 2 / 3 / 4 人固定主城、自选主城图都进入随机池；多人图由本机玩家 + 本地 AI 席位运行。
        // 判据在 `isRandomMapCandidate` 一处，别在这里另写一份人数判断。
        const requestedPlayerCount = battlePlayerCount ?? this.playerCountOverride ?? getZCLocalPlayerCountOverride();
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

    private async loadVisualPrefabs(scope?: ResourceScope, heroIds?: readonly number[], modifiers?: ZCMatchConfig['modifiers'], deferEffects = false): Promise<{
        units: ReadonlyMap<ZCUnitId, Prefab>;
        effects: ReadonlyMap<string, Prefab>;
        effectPaths: readonly string[];
    }> {
        const plan = buildZCVisualResourcePlan(getAllUnitDefinitions(), getZCModifierCatalogs().adapters, heroIds, modifiers);
        const units = new Map<ZCUnitId, Prefab>();
        const effects = new Map<string, Prefab>();
        const load = async (path: string, assign: (prefab: Prefab) => void): Promise<void> => {
            const prefab = await this.resources.assets.load(path, Prefab, { scope, priority: BATTLE_ENTRY_PRIORITY });
            assign(prefab);
        };
        const unitTasks = plan.units.map(definition => load(definition.prefabPath, prefab => units.set(definition.unitId, prefab)));
        const effectTasks = deferEffects ? [] : plan.effectPaths.map(path => load(path, prefab => effects.set(path, prefab)));
        await Promise.all([
            this.traceArt(`单位模型(${unitTasks.length})`, Promise.all(unitTasks)),
            this.traceArt(`弹道特效(${effectTasks.length})`, Promise.all(effectTasks)),
        ]);
        return { units, effects, effectPaths: plan.effectPaths };
    }

    /** 中立资源图标由本局 scope 持有。 */
    private async loadNeutralResourceFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const frames = await this.resources.assets.loadDir(MAP_RESOURCE_ART_ROOT, SpriteFrame, this.battleOptions(scope));
        return new Map(frames.map(frame => [frame.name, frame]));
    }

    /** 按图片名索引建筑外观帧。 */
    private async loadBuildingFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const frames = await this.resources.assets.loadDir(BUILDING_DIRECTORY, SpriteFrame, { scope, priority: BATTLE_ENTRY_PRIORITY });
        return new Map(frames.filter(frame => !!frame?.name).map(frame => [frame.name, frame]));
    }

    /** 自选主城阶段用问号遮蔽中立资源。 */
    private async loadUnknownResourceFrame(scope?: ResourceScope): Promise<SpriteFrame> {
        const path = spriteFramePath(GAMEUI_ART_ROOT, NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME);
        return this.resources.assets.load(path, SpriteFrame, this.battleOptions(scope));
    }

    /** 加载本局神器图标，未配置神器时返回 null。 */
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
        return this.resources.assets.load(path, SpriteFrame, { scope, priority: BATTLE_ENTRY_PRIORITY });
    }

    /** 金币飞行使用单枚 coin_icon，与格子资源金币图标一致。 */
    private async loadGoldCoinFrame(scope?: ResourceScope): Promise<SpriteFrame> {
        const path = spriteFramePath(MAP_RESOURCE_ART_ROOT, 'coin_icon');
        return this.resources.assets.load(path, SpriteFrame, this.battleOptions(scope));
    }

    /** 前区红色气泡，中后区绿色气泡。 */
    private async loadSpawnRegionFrames(scope?: ResourceScope): Promise<IZCSpawnRegionHintFrames> {
        const frames = await this.loadSortedSpriteFrames(SPAWN_REGION_ART_ROOT, scope);
        const green = frames.find(frame => frame.name === 'frame_01');
        const red = frames.find(frame => frame.name === 'frame_02');
        if (!green || !red) throw new Error(`出生区域气泡目录缺少 frame_01 / frame_02：${SPAWN_REGION_ART_ROOT}`);
        return { front: red, mid: green, back: green };
    }

    /** 只取 Prefab 类型，动画与裸帧由 prefab 依赖加载；中毒不登记为职业受击。 */
    private async loadCommonEffects(scope?: ResourceScope, priority = BATTLE_ENTRY_PRIORITY) {
        const prefabs = await this.resources.assets.loadDir(COMMON_EFFECT_DIRECTORY, Prefab, this.battleOptions(scope, priority));
        const byName = new Map(prefabs.map(prefab => [prefab.name, prefab]));
        const getPrefab = (path: string): Prefab => {
            const prefab = byName.get(path.substring(path.lastIndexOf('/') + 1));
            if (!prefab) throw new Error(`公共特效目录缺少 prefab：${path}`);
            return prefab;
        };
        return {
            spawnFxPrefab: getPrefab(ZC_BATTLE_FX_PATHS.spawn),
            deathFxPrefab: getPrefab(ZC_BATTLE_FX_PATHS.death),
            buildingDestroyFxPrefab: getPrefab(ZC_BATTLE_FX_PATHS.buildingDestroy),
            hitFxPrefabs: new Map(ZC_ATTACK_TRAITS.map(trait => [trait,
                getPrefab(`${ZC_BATTLE_FX_PATHS.hitDirectory}/${trait}受击/${trait}受击`)])),
        };
    }

    /** 按方向加载城墙砖帧。 */
    private async loadWallFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const frames = await this.resources.assets.loadDir(WALL_TILE_DIRECTORY, SpriteFrame, { scope, priority: BATTLE_ENTRY_PRIORITY });
        return new Map(frames.filter(frame => !!frame?.name).map(frame => [frame.name, frame]));
    }

    /** 按墙砖透视端帽范围融合接缝，保持原 alpha。 */
    private async loadWallMaterial(scope?: ResourceScope): Promise<Material> {
        const effect = await this.resources.assets.load(WALL_TILE_EFFECT_URL, EffectAsset, { scope, priority: BATTLE_ENTRY_PRIORITY });
        this.checkActive(scope);
        const material = new Material();
        material.initialize({ effectAsset: effect });
        return material;
    }

    /** 兵种整体外轮廓（放大副本）。 */
    private async loadUnitOutlineCopyEffect(scope?: ResourceScope): Promise<EffectAsset> {
        return this.resources.assets.load(UNIT_OUTLINE_COPY_EFFECT_URL, EffectAsset, { scope, priority: BATTLE_ENTRY_PRIORITY });
    }

    /** 序列帧按文件名排序。 */
    private async loadSortedSpriteFrames(
        directory: string,
        scope?: ResourceScope,
        priority = BATTLE_ENTRY_PRIORITY,
    ): Promise<SpriteFrame[]> {
        const frames = await this.resources.assets.loadDir(directory, SpriteFrame, this.battleOptions(scope, priority));
        return frames.filter(frame => !!frame?.name).sort((a, b) => a.name.localeCompare(b.name));
    }

    /** 加载地块抬起后的底部发光序列帧。 */
    private loadHexGroundGlowFrames(scope?: ResourceScope): Promise<SpriteFrame[]> {
        return this.loadSortedSpriteFrames(HEX_GROUND_GLOW_ART_ROOT, scope);
    }

    /** 加载翻格脉冲呼吸序列帧。 */
    private loadHexPulseFrames(scope?: ResourceScope): Promise<SpriteFrame[]> {
        return this.loadSortedSpriteFrames(HEX_FLIP_PULSE_ART_ROOT, scope);
    }

    /** 加载「神器充能」领取时的格心爆炸序列帧。 */
    private loadArtifactClaimBurstFrames(scope?: ResourceScope): Promise<SpriteFrame[]> {
        return this.loadSortedSpriteFrames(ARTIFACT_CLAIM_BURST_ART_ROOT, scope);
    }

    /** 仅加载本局地图声明的装饰，资源生命周期交给当前流程。 */
    private async loadDecorFrames(scope?: ResourceScope): Promise<ReadonlyMap<string, SpriteFrame>> {
        const names = new Set<string>();
        for (const item of this.selectedMap?.art?.freeDecor ?? []) {
            if (typeof item?.art === 'string' && item.art.trim()) names.add(item.art.trim());
        }
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(Array.from(names).map(async (name) => {
            // 随机地图的小装饰只随本局持有，不占用会话复用缓存。
            const frame = await this.resources.assets.load(decorFramePath(name), SpriteFrame, { scope, cache: false });
            frames.set(name, frame);
        }));
        return frames;
    }

    /** 资源加载的取消由 AssetService 处理；这里只守住配置写入、资源创建与结果发布。 */
    private checkActive(scope?: ResourceScope): void {
        if (scope?.disposed) throw new Error('对局预加载已取消');
    }

    private async loadPvpRuntimeConfig(scope?: ResourceScope): Promise<void> {
        // 登录会话空闲期已预编译：运行时目录已安装，进对局直接复用，零同步 CPU。
        if (isZCRuntimeCompiled()) return;
        await this.resources.configs.initialize();
        this.checkActive(scope);
        await ensureZCRuntimeCompiled(this.resources.configs);
        this.checkActive(scope);
    }
}
