import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type {
    DeepReadonly,
    ZCBuildingCooldownState,
    ZCBuildingDestruction,
    ZCBuildingShake,
    ZCCardReveal,
    ZCFloatText,
    ZCHexActivation,
    ZCHexState,
    ZCHitFx,
    ZCNeutralReward,
    ZCSnapshot,
} from './ZCGameTypes';
import type { ZCOwner } from './ZCMapConfig';
import type { ZCMatchMap } from './ZCMatchConfig';

/** 地块在本帧的规则派生表现数据；视图不再向模型逐格发起规则查询。 */
export interface ZCGameRenderHex {
    readonly state: DeepReadonly<ZCHexState>;
    readonly canDevelop: boolean;
    readonly cooldown: DeepReadonly<ZCBuildingCooldownState> | null;
    readonly activation: DeepReadonly<ZCHexActivation> | null;
    readonly connectedDevelopedHexIds: readonly number[];
}

/** 一次逻辑更新对应的只读渲染投影，引用快照而不复制整盘可变状态。 */
export interface ZCGameRenderFrame {
    readonly snapshot: DeepReadonly<ZCSnapshot>;
    readonly mapConfig: ZCMatchMap;
    readonly terrainRevision: number;
    readonly simulationStepSeconds: number;
    readonly interpolationAlpha: number;
    readonly owners: readonly ZCOwner[];
    readonly hexesById: ReadonlyMap<number, ZCGameRenderHex>;
    readonly unitDefinitionsById: ReadonlyMap<string, ZCUnitDefinition>;
    readonly floatTexts: readonly DeepReadonly<ZCFloatText>[];
    readonly hitFxs: readonly DeepReadonly<ZCHitFx>[];
    readonly cardReveals: readonly DeepReadonly<ZCCardReveal>[];
    readonly hexActivations: readonly DeepReadonly<ZCHexActivation>[];
    readonly neutralRewards: readonly DeepReadonly<ZCNeutralReward>[];
}

/** 一次性模型通知，必须由对局编排层显式取走并交给动态渲染。 */
export interface ZCBattlePresentationEvents {
    readonly buildingShakes: readonly DeepReadonly<ZCBuildingShake>[];
    /** 建筑被打掉（地块已转废墟，快照里再也看不出「刚被拆」）—— 渲染层播白烟雾爆炸。 */
    readonly buildingDestructions: readonly DeepReadonly<ZCBuildingDestruction>[];
}
