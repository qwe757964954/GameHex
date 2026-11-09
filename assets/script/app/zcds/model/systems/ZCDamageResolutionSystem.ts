import type { ZCDamageSource, ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { zcHexTopEdgeToward } from '../ZCHexTopGeometry';
import type { ZCOwner } from '../ZCMapConfig';
import { ZCCombatSystem } from './ZCCombatSystem';
import type { IZCModelServices } from './ZCModelServices';
import type { ZCUnitRegistry } from './ZCUnitRegistry';

const HATRED_SECONDS = 5;
const DEATH_SECONDS = 0.45;

export interface IZCDamageResolutionContext extends Pick<IZCModelServices, 'statusSystem'> {
    readonly units: ZCUnitRegistry;
    readonly damageDealt: Record<ZCOwner, number>;
    readonly damageTaken: Record<ZCOwner, number>;
    /**
     * 闪避判定用的随机源（2026-10-30「迅击」100903 的 `dodgePct`）。
     *
     * **只在目标的 `dodgePct > 0` 时才调用** —— 缺省单位一次都不抽，
     * 所以既有对局的随机序列（强化 / 暴击 / 掉落都共用一个序列）逐字不变。
     * 缺省 undefined ⇒ 视为没有闪避，整段不执行（单测里不传也能跑）。
     */
    readonly random?: () => number;
}

export interface IZCDamageResult {
    readonly applied: number;
    readonly killed: boolean;
}

/** Applies combat damage and state transitions; the caller emits presentation and rewards. */
export class ZCDamageResolutionSystem {
    static damageUnit(state: ZCSnapshot, target: ZCUnitState, damage: number,
        source: ZCDamageSource, context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (target.battleState === 'dead' || damage <= 0) return null;
        const takenMods = context.statusSystem.statModsOf(String(target.id));
        //  闪避（2026-10-30「迅击」100903）：只对**单位打单位**的伤害生效 —— 城墙 / 建筑不吃，
        //  持续伤害也不吃（那两类走的是别的入口，天然被排除）。
        //  短路写法是刻意的：`dodgePct` 缺省 0 时一次随机都不抽，既有对局的随机序列不受影响。
        const dodgeChance = Math.max(0, Math.min(1, takenMods.dodgePct ?? 0));
        if (dodgeChance > 0 && source.kind === 'unit' && context.random && context.random() < dodgeChance) {
            return { applied: 0, killed: false };
        }
        //  两个减免口径**相加**后再乘（与 `ZCStatusEffect` 里 pct 一律相加的约定一致）：
        //  · `damageTakenPct`      —— 对所有伤害生效（格挡 / 护体）；
        //  · `damageTakenRangedPct` —— 只对远程生效（藤盾），未标记 `ranged` 的伤害整份不计。
        //  `source.ranged` 缺省 undefined ⇒ 后一项恒为 0，存量伤害路径逐字不变。
        const rangedReduce = source.ranged ? (takenMods.damageTakenRangedPct ?? 0) : 0;
        let scaledDamage = damage * Math.max(0, 1 + ((takenMods.damageTakenPct ?? 0) + rangedReduce) / 100);
        const absorbed = Math.min(target.shield ?? 0, scaledDamage);
        if (absorbed > 0) {
            target.shield = Math.max(0, (target.shield ?? 0) - absorbed);
            scaledDamage -= absorbed;
        }
        const applied = ZCCombatSystem.applyDamage(target, scaledDamage);
        this.recordDamage(source.owner, target.owner, applied, context);
        const sender = source.kind === 'unit' && source.unitId != null
            ? context.units.byId.get(source.unitId) : undefined;
        if (sender) {
            const hatredUnit = target.hatredUnitId !== null
                ? context.units.byId.get(target.hatredUnitId) ?? null : null;
            const oldHatred = hatredUnit && hatredUnit.battleState !== 'dead' ? hatredUnit : null;
            if (target.hatredUnitId === sender.id || !oldHatred || state.elapsedSeconds > target.hatredUntil) {
                target.hatredUnitId = sender.id;
            }
            target.hatredUntil = state.elapsedSeconds + HATRED_SECONDS;
            //  受击反弹减益（格挡 III）：护体生效期间被打中，反过来压攻击者 3 秒攻速。
            //  未配 `retaliateSlowPct` 的单位恒为 0 ⇒ 存量受伤路径逐字不变。
            this.applyRetaliate(state, target, sender, context);
        }
        if (target.hp > 0) return { applied, killed: false };
        target.hp = 0;
        // Unit deaths are not frame operations: the protocol only accepts development, skill and chat.
        target.targetUnitId = null;
        target.targetWallHexId = null;
        target.targetBuildingHexId = null;
        target.targetHexId = null;
        target.progress = 0;
        target.deathRemoveAt = state.elapsedSeconds + DEATH_SECONDS;
        context.units.markDead(target);
        ZCCombatSystem.switchState(target, 'dead');
        return { applied, killed: true };
    }

    static damageWall(wall: ZCHexState, damage: number, attacker: Pick<ZCUnitState, 'owner' | 'freeX' | 'freeY'>,
        isExposed: boolean, center: { readonly x: number; readonly y: number },
        context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (wall.owner === 'neutral' || !isExposed || damage <= 0) return null;
        const wallHpBefore = wall.wallHp;
        wall.wallHp = Math.max(0, wallHpBefore - damage);
        const applied = wallHpBefore - wall.wallHp;
        this.recordDamage(attacker.owner, wall.owner, applied, context);
        if (wall.wallHp > 0) return { applied, killed: false };
        wall.wallBreachedEdge = this.wallEdgeToward(attacker, center);
        return { applied, killed: true };
    }

    static damageBuilding(state: ZCSnapshot, building: ZCHexState, damage: number,
        attacker: Pick<ZCUnitState, 'owner'>, context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (building.owner === 'neutral' || building.wallHp > 0) return null;
        const hpBefore = building.hp;
        building.hp -= damage;
        const applied = Math.min(damage, Math.max(0, hpBefore));
        this.recordDamage(attacker.owner, building.owner, applied, context);
        if (building.hp > 0) return { applied, killed: false };
        building.building = 'none';
        building.state = 'ruins';
        building.owner = attacker.owner;
        building.tier = 0;
        building.hp = 0;
        building.maxHp = 0;
        building.wallHp = 0;
        building.wallMaxHp = 0;
        building.wallBreachedEdge = null;
        building.cardId = null;
        building.developmentResolved = false;
        building.constructionRemainingSeconds = 0;
        building.constructionTotalSeconds = 0;
        building.captureOwner = null;
        building.captureSeconds = 0;
        delete state.spawnClocks[String(building.id)];
        delete state.spawnClocks[`mine:${building.id}`];
        delete state.spawnClocks[`barracks:${building.id}`];
        delete state.spawnClocks[`tower:${building.id}`];
        return { applied, killed: true };
    }

    /**
     * 受击反弹减益（2026-10-29，格挡 III「并使攻击者攻击速度降低10%」）。
     *
     * 时机钉在**受伤结算**而不是护体触发那一刻：原文是「使攻击者」降低攻速，
     * 只有真的有人打上来才知道攻击者是谁。减益本身复用状态系统
     * （`attackIntervalPct` 为负 = 间隔变长 = 攻速下降），不新增战斗逻辑。
     */
    private static applyRetaliate(state: ZCSnapshot, target: ZCUnitState, sender: ZCUnitState,
        context: IZCDamageResolutionContext): void {
        const pct = target.retaliateSlowPct ?? 0;
        if (pct <= 0 || state.elapsedSeconds > (target.retaliateUntil ?? 0)) return;
        const seconds = 3;
        const id = `__retaliate:${pct.toFixed(4)}__`;
        if (!context.statusSystem.hasDef(id)) {
            context.statusSystem.register({
                id, name: id, durationSeconds: seconds, refreshPolicy: 'refresh',
                statMods: { attackIntervalPct: -pct }, behavior: { kind: 'none' },
            });
        }
        context.statusSystem.apply(String(sender.id), id, { at: state.elapsedSeconds, durationSeconds: seconds });
    }

    private static recordDamage(attacker: ZCOwner | 'neutral', defender: ZCOwner, amount: number,
        context: IZCDamageResolutionContext): void {        if (amount <= 0) return;
        if (attacker !== 'neutral') context.damageDealt[attacker] += amount;
        context.damageTaken[defender] += amount;
    }

    /**
     * 破门边：必须和墙砖渲染共用顶面边口径。单位从两格外沿角点打墙时，站位可能落在
     * 标准正六边形法线（30°+60°·edge）与顶面实际外法线的分界夹角内，用标准公式会
     * 选到相邻的另一条边，导致缺口和单位错开一根（该断的砖没断）。
     */
    private static wallEdgeToward(unit: Pick<ZCUnitState, 'freeX' | 'freeY'>,
        center: { readonly x: number; readonly y: number }): number {
        return zcHexTopEdgeToward(unit.freeX, unit.freeY, center.x, center.y);
    }
}
