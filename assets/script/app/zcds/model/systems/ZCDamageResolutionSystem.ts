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
    /** 闪避随机源；仅目标 `dodgePct > 0` 时调用，缺省视为无闪避。*/
    readonly random?: () => number;
}

export interface IZCDamageResult {
    readonly applied: number;
    readonly killed: boolean;
}

/** 伤害与死亡状态的纯结算；表现与奖励由调用方负责。*/
export class ZCDamageResolutionSystem {
    static damageUnit(state: ZCSnapshot, target: ZCUnitState, damage: number,
        source: ZCDamageSource, context: IZCDamageResolutionContext): IZCDamageResult | null {
        if (target.battleState === 'dead' || damage <= 0) return null;
        const takenMods = context.statusSystem.statModsOf(String(target.id));
        // 闪避只对单位打单位的伤害生效；dodgePct 缺省 0 时不抽随机，既有随机序列不变。
        const dodgeChance = Math.max(0, Math.min(1, takenMods.dodgePct ?? 0));
        if (dodgeChance > 0 && source.kind === 'unit' && context.random && context.random() < dodgeChance) {
            return { applied: 0, killed: false };
        }
        // 两个减免口径相加后统一乘：damageTakenPct 全伤害，damageTakenRangedPct 仅远程。
        const rangedReduce = source.ranged ? (takenMods.damageTakenRangedPct ?? 0) : 0;
        let scaledDamage = damage * Math.max(0, 1 + ((takenMods.damageTakenPct ?? 0) + rangedReduce) / 100);
        const absorbed = Math.min(target.shield ?? 0, scaledDamage);
        if (absorbed > 0) {
            target.shield = Math.max(0, (target.shield ?? 0) - absorbed);
            scaledDamage -= absorbed;
        }
        const applied = ZCCombatSystem.applyDamage(target, scaledDamage);
        this.recordDamage(source.owner, target.owner, applied, context);
        const sender = source.kind === 'unit' && source.unitId !== undefined && source.unitId !== null
            ? context.units.byId.get(source.unitId) : undefined;
        if (sender) {
            const hatredUnit = target.hatredUnitId !== null
                ? context.units.byId.get(target.hatredUnitId) ?? null : null;
            const oldHatred = hatredUnit && hatredUnit.battleState !== 'dead' ? hatredUnit : null;
            if (target.hatredUnitId === sender.id || !oldHatred || state.elapsedSeconds > target.hatredUntil) {
                target.hatredUnitId = sender.id;
            }
            target.hatredUntil = state.elapsedSeconds + HATRED_SECONDS;
            // 受击反弹：护体期间被打中，压攻击者 3 秒攻速。
            this.applyRetaliate(state, target, sender, context);
            // 受伤反弹：尖刺风暴期间将实际受到的伤害按比例反弹给攻击者。
            this.applyReflect(state, target, sender, applied, context);
        }
        if (target.hp > 0) return { applied, killed: false };
        this.transferDeath(state, target, context);
        // 击杀归因：仅统计打出最后一击的攻击者，自伤或非单位攻击不计入。
        if (sender && sender !== target) sender.killCount = (sender.killCount ?? 0) + 1;
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
     * 受伤反弹：读受击方身上的 reflectRate，按实际掉血比例直接伤害攻击者（不递归、不重走减免）。
     */
    private static applyReflect(state: ZCSnapshot, target: ZCUnitState, sender: ZCUnitState,
        applied: number, context: IZCDamageResolutionContext): void {
        const pct = Math.max(0, context.statusSystem.statModsOf(String(target.id)).reflectRate ?? 0);
        if (!(pct > 0) || !(applied > 0)) return;
        if (sender.battleState === 'dead' || sender.hp <= 0) return;
        const reflected = Math.max(1, Math.round(applied * pct / 100));
        const dealt = ZCCombatSystem.applyDamage(sender, reflected);
        this.recordDamage(target.owner, sender.owner, dealt, context);
        if (!(sender.hp > 0)) this.transferDeath(state, sender, context);
    }

    /** 单位阵亡的统一收尾逻辑（目标解绑、死亡状态切换与清理计时）。*/
    private static transferDeath(state: ZCSnapshot, target: ZCUnitState,
        context: IZCDamageResolutionContext): void {
        target.hp = 0;
        // 单位死亡不是帧操作：协议只接受开发、技能与聊天。
        target.targetUnitId = null;
        target.targetWallHexId = null;
        target.targetBuildingHexId = null;
        target.targetHexId = null;
        target.progress = 0;
        target.deathRemoveAt = state.elapsedSeconds + DEATH_SECONDS;
        context.units.markDead(target);
        ZCCombatSystem.switchState(target, 'dead');
    }

    /**
     * 受击时给攻击者挂攻速减益（attackIntervalPct 为负即变慢）。
     * 放在受伤结算而非护体触发，是因为只有真的挨打才知道攻击者是谁。
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
        context: IZCDamageResolutionContext): void {
        if (amount <= 0) return;
        if (attacker !== 'neutral') context.damageDealt[attacker] += amount;
        context.damageTaken[defender] += amount;
    }

    /** 破门边与墙砖渲染共用顶面边口径，否则缺口会和单位错开一根。*/
    private static wallEdgeToward(unit: Pick<ZCUnitState, 'freeX' | 'freeY'>,
        center: { readonly x: number; readonly y: number }): number {
        return zcHexTopEdgeToward(unit.freeX, unit.freeY, center.x, center.y);
    }
}
