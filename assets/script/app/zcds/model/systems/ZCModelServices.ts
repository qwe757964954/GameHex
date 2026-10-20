import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCDamageSource, ZCFloatText, ZCHexState, ZCUnitState } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCMapGeometry } from '../ZCMapGeometry';
import type { ZCStatusSystem } from '../ZCStatusEffect';

/**
 * 模型对外暴露的能力表：由组合根（`ZCGameModel`）装配一次，各系统 context 用
 * `Pick<IZCModelServices, ...>` 取自己需要的子集。
 *
 * 这里**只放签名唯一的能力**。同一能力若有多种形态，一律不进这里，由各 context 自行声明：
 *
 * - `units`：Target/Projectile 要 `readonly ZCUnitState[]`（tick 内直接遍历，换成 Map 视图会
 *   让每次遍历都得 `[...map.values()]` 分配临时数组）；UnitTargeting 要 `ReadonlyMap`；
 *   DamageResolution 要 `ZCUnitRegistry`。三种视图服务三种遍历方式，物理上不能合并。
 * - `unitById`：三处直接给 `ReadonlyMap`，两处是函数且空值语义不同（`| null` / `| undefined`）。
 * - `rules` / `statusSystem`：`IZCLegacyCombatContext` 用**函数**形式，因为它是类字段初始化器，
 *   执行早于 constructor 体，那时 readonly 字段还没赋值，属性形式会拿到 undefined。
 *
 * 签名一律取**最宽**形态：调用方用不到的字段/返回值不会报错，反之（给窄的）会编译失败。
 * 把宽签名收窄成窄签名，靠各系统内部只取它真正需要的字段来体现意图。
 */
export interface IZCModelServices {
    readonly rules: Readonly<ZCRuntimeRules>;
    readonly statusSystem: ZCStatusSystem;
    readonly geometry: ZCMapGeometry;

    random(): number;
    /** 可选 `result` 出参用于避免每帧分配临时对象（Targeting 走这条）。 */
    unitPosition(unit: ZCUnitState, result?: { x: number; y: number }): { x: number; y: number };
    /** 生效定义（含星级 / 静态修正）。基础定义见各 context 自行声明的 `baseDefinition`。 */
    effectiveDefinition(unit: ZCUnitState): ZCUnitDefinition;
    damageUnit(unit: ZCUnitState, damage: number, source: ZCDamageSource): ZCFloatText | null;
    hex(id: number): ZCHexState | null;
    hasExposedWall(hex: ZCHexState): boolean;
    unitCount(owner: ZCOwner): number;
    spawnUnit(owner: ZCOwner, card: ZCDeckCard, tier: number, hexId: number): void;
    bonuses(owner: ZCOwner): ZCDeckBonuses;
}
