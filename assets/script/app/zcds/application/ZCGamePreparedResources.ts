import type { EffectAsset, Material, Prefab, SpriteFrame } from 'cc';
import type { ICardArtConfig } from '../../card/CardArtConfig';
import type { ZCAttackTrait, ZCUnitId } from '../model/ZCCombatCatalog';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { IZCSpawnRegionHintFrames } from '../view/ZCSpawnRegionHintOverlay';
import type { IZCGuidePreparedContent } from './ZCGuideLoader';

/** 首帧后逐项发布的表现资源快照；资源仍归当前战斗作用域。 */
export interface IZCDeferredBattleArt {
    readonly effectVisualPrefabs: ReadonlyMap<string, Prefab>;
    readonly spawnFxPrefab: Prefab | null;
    readonly deathFxPrefab: Prefab | null;
    readonly buildingDestroyFxPrefab: Prefab | null;
    readonly hitFxPrefabs: ReadonlyMap<ZCAttackTrait, Prefab>;
    readonly decorFrames: ReadonlyMap<string, SpriteFrame>;
    readonly hexGroundGlowFrames?: readonly SpriteFrame[];
    readonly hexPulseFrames?: readonly SpriteFrame[];
    readonly artifactClaimBurstFrames?: readonly SpriteFrame[];
}

/** 进入对局前准备好的首帧资源，统一随战斗 ResourceScope 释放。 */
export interface IZCGamePreparedResources {
    readonly cardArtConfig: ICardArtConfig;
    baseMatchConfig: ZCMatchConfig;
    hudPrefab: Prefab;
    /** 图层及层序由 prefab 声明。 */
    boardPrefab: Prefab;
    hexPrefab: Prefab;
    unitPrefab: Prefab;
    effectPrefab: Prefab;
    wallPrefab: Prefab;
    wallLayerPrefab: Prefab;
    floatTextPrefab: Prefab;
    cardRevealPrefab: Prefab;
    legendBannerPrefab: Prefab;
    decorPrefab: Prefab;
    /** 后补完成前为 null；特效尺寸与动画由 prefab 声明。 */
    spawnFxPrefab: Prefab | null;
    deathFxPrefab: Prefab | null;
    buildingDestroyFxPrefab: Prefab | null;
    /** 按攻击方职业索引；后补完成前为空，不猜默认职业。 */
    hitFxPrefabs: ReadonlyMap<ZCAttackTrait, Prefab>;
    /** 仅自选出生点地图加载。 */
    spawnSelectionPrefab: Prefab | null;
    /** 仅守城局加载。 */
    bossPanelPrefab: Prefab | null;
    unitVisualPrefabs: ReadonlyMap<ZCUnitId, Prefab>;
    effectVisualPrefabs: ReadonlyMap<string, Prefab>;
    /** 未配置神器时为 null。 */
    artifactIconFrame: SpriteFrame | null;
    /** 自选出生点阶段隐藏中立资源种类；其他地图为 null。 */
    unknownResourceFrame: SpriteFrame | null;
    neutralResourceFrames: ReadonlyMap<string, SpriteFrame>;
    goldCoinFrame: SpriteFrame | null;
    /** 仅自选出生点地图加载。 */
    spawnRegionFrames: IZCSpawnRegionHintFrames | null;
    buildingFrames: ReadonlyMap<string, SpriteFrame>;
    wallFrames: ReadonlyMap<string, SpriteFrame>;
    wallMaterial: Material | null;
    unitOutlineCopyEffect: EffectAsset | null;
    /** 序列帧已排序，后补完成前为空。 */
    hexGroundGlowFrames: readonly SpriteFrame[];
    hexPulseFrames: readonly SpriteFrame[];
    artifactClaimBurstFrames: readonly SpriteFrame[];
    decorFrames: ReadonlyMap<string, SpriteFrame>;
    /** 首次打开指南时加载，同局共享请求；失败后可重试。 */
    loadGuide: () => Promise<IZCGuidePreparedContent>;
    /** 仅有作用域的战斗启用，调用方须等首帧绘制后启动；重复调用合并。 */
    loadDeferredArt?: (onUpdate: (art: IZCDeferredBattleArt) => void) => Promise<void>;
}
