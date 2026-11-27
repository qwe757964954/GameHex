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
    ZCSkillAnnounce,
    ZCSnapshot,
} from './ZCGameTypes';
import type { ZCOwner } from './ZCMapConfig';
import type { ZCMatchMap } from './ZCMatchConfig';

/** 某格本帧的派生表现数据；视图不用再逐格向模型问规则。*/
export interface ZCGameRenderHex {
    readonly state: DeepReadonly<ZCHexState>;
    readonly canDevelop: boolean;
    readonly cooldown: DeepReadonly<ZCBuildingCooldownState> | null;
    readonly activation: DeepReadonly<ZCHexActivation> | null;
    readonly connectedDevelopedHexIds: readonly number[];
}

/** 一次逻辑更新对应的只读投影，引用当前快照，不复制整盘可变状态。*/
export interface ZCGameRenderFrame {
    readonly snapshot: DeepReadonly<ZCSnapshot>;
    readonly mapConfig: ZCMatchMap;
    readonly terrainRevision: number;
    readonly simulationStepSeconds: number;
    readonly interpolationAlpha: number;
    readonly owners: readonly ZCOwner[];
    /**
     * 本局胜方；未定或平局为 null。
     * 胜利扫场按它的本色铺地 —— status 只有 victory / defeat，4 人局里我方出局可能是任意对手赢，
     * 拿 status 反推会一律铺成 2 号色。
    */
    readonly winner: ZCOwner | null;
    readonly hexesById: ReadonlyMap<number, ZCGameRenderHex>;
    readonly unitDefinitionsById: ReadonlyMap<string, ZCUnitDefinition>;
    readonly floatTexts: readonly DeepReadonly<ZCFloatText>[];
    readonly hitFxs: readonly DeepReadonly<ZCHitFx>[];
    readonly cardReveals: readonly DeepReadonly<ZCCardReveal>[];
    readonly hexActivations: readonly DeepReadonly<ZCHexActivation>[];
    readonly neutralRewards: readonly DeepReadonly<ZCNeutralReward>[];
    /** 传说卡首次放大招的通报（卡面形象 + 技能名）；走动态层，不进一次性通知。*/
    readonly skillAnnounces: readonly DeepReadonly<ZCSkillAnnounce>[];
}

/** 一次性通知，对局编排层取走后交给动态渲染，不留在帧投影里。*/
export interface ZCBattlePresentationEvents {
    readonly buildingShakes: readonly DeepReadonly<ZCBuildingShake>[];
    /** 建筑刚被打掉：地块已变废墟，快照里看不出“刚拆”，渲染层靠这条播白烟。*/
    readonly buildingDestructions: readonly DeepReadonly<ZCBuildingDestruction>[];
}
