import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCDamageSource, ZCFloatText, ZCHexState, ZCUnitState } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCMapGeometry } from '../ZCMapGeometry';
import type { ZCStatusSystem } from '../ZCStatusEffect';

/**
 * 模型能力表：组合根装配一次，各系统用 `Pick` 取所需子集。
 * 只放签名唯一的能力；同一能力有多种视图时（如 `units` 的数组 / Map / Registry）由各 context 自行声明。
*/
export interface IZCModelServices {
    readonly rules: Readonly<ZCRuntimeRules>;
    readonly statusSystem: ZCStatusSystem;
    readonly geometry: ZCMapGeometry;

    random(): number;
    /** 可选 `result` 出参用于避免每帧分配临时对象（Targeting 走这条）。*/
    unitPosition(unit: ZCUnitState, result?: { x: number; y: number }): { x: number; y: number };
    /** 生效定义（含星级 / 静态修正）。基础定义见各 context 自行声明的 `baseDefinition`。*/
    effectiveDefinition(unit: ZCUnitState): ZCUnitDefinition;
    damageUnit(unit: ZCUnitState, damage: number, source: ZCDamageSource): ZCFloatText | null;
    hex(id: number): ZCHexState | null;
    hasExposedWall(hex: ZCHexState): boolean;
    unitCount(owner: ZCOwner): number;
    spawnUnit(owner: ZCOwner, card: ZCDeckCard, tier: number, hexId: number): void;
    bonuses(owner: ZCOwner): ZCDeckBonuses;
}
