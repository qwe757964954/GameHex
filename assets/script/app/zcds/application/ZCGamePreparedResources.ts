import type { EffectAsset, Material, Prefab, SpriteFrame } from 'cc';
import type { ICardArtConfig } from '../../card/CardArtConfig';
import type { ZCAttackTrait, ZCUnitId } from '../model/ZCCombatCatalog';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { IZCSpawnRegionHintFrames } from '../view/ZCSpawnRegionHintOverlay';
import type { IZCMonsterFocusFrames } from '../view/ZCHexView';
import type { IZCGuidePreparedContent } from './ZCGuideLoader';

/** 首帧之后分项发布的表现资源，仍归当前战斗作用域。*/
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

/** 进对局前准备好的首帧资源，随战斗 ResourceScope 一起释放。*/
export interface IZCGamePreparedResources {
    readonly cardArtConfig: ICardArtConfig;
    baseMatchConfig: ZCMatchConfig;
    hudPrefab: Prefab;
    /** 图层和层序由 prefab 声明。*/
    boardPrefab: Prefab;
    hexPrefab: Prefab;
    unitPrefab: Prefab;
    effectPrefab: Prefab;
    wallPrefab: Prefab;
    wallLayerPrefab: Prefab;
    floatTextPrefab: Prefab;
    cardRevealPrefab: Prefab;
    legendBannerPrefab: Prefab;
    /** 野怪击杀横栏；缺省时退回传说卡横幅的 `monsterClaim` 大字。*/
    killBannerPrefab: Prefab | null;
    decorPrefab: Prefab;
    /** 后补完成前为 null；尺寸和动画看 prefab。*/
    spawnFxPrefab: Prefab | null;
    deathFxPrefab: Prefab | null;
    buildingDestroyFxPrefab: Prefab | null;
    /** 按攻击方职业索引；后补完成前是空的，不猜默认职业。*/
    hitFxPrefabs: ReadonlyMap<ZCAttackTrait, Prefab>;
    /** 只有自选出生点地图会加载。*/
    spawnSelectionPrefab: Prefab | null;
    /** 只有守城局加载。*/
    bossPanelPrefab: Prefab | null;
    unitVisualPrefabs: ReadonlyMap<ZCUnitId, Prefab>;
    effectVisualPrefabs: ReadonlyMap<string, Prefab>;
    /** 没配神器时 null。*/
    artifactIconFrame: SpriteFrame | null;
    /** 自选出生点阶段把中立资源种类藏起来；其他地图为 null。*/
    unknownResourceFrame: SpriteFrame | null;
    neutralResourceFrames: ReadonlyMap<string, SpriteFrame>;
    /** 野怪集火按钮的三态底图（`image/spawn-region/frame_01/02/03`）。*/
    monsterFocusFrames: IZCMonsterFocusFrames;
    goldCoinFrame: SpriteFrame | null;
    /** 只有自选出生点地图会加载。*/
    spawnRegionFrames: IZCSpawnRegionHintFrames | null;
    /** 区域气泡预制体；只有自选出生点地图会加载。*/
    spawnRegionHintPrefab: Prefab | null;
    buildingFrames: ReadonlyMap<string, SpriteFrame>;
    wallFrames: ReadonlyMap<string, SpriteFrame>;
    wallMaterial: Material | null;
    unitOutlineCopyEffect: EffectAsset | null;
    /** 序列帧已排好序，后补完成前为空。*/
    hexGroundGlowFrames: readonly SpriteFrame[];
    hexPulseFrames: readonly SpriteFrame[];
    artifactClaimBurstFrames: readonly SpriteFrame[];
    decorFrames: ReadonlyMap<string, SpriteFrame>;
    /** 首次打开指南才加载，同局共用一个请求，失败可重试。*/
    loadGuide: () => Promise<IZCGuidePreparedContent>;
    /** 只有带作用域的战斗开；要等首帧画完再调，重复调用合并。*/
    loadDeferredArt?: (onUpdate: (art: IZCDeferredBattleArt) => void) => Promise<void>;
}
