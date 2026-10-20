import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { cardCounterMultiplier, type ZCCounterRule, type ZCDeckBonuses, type ZCDeckCard } from '../ZCCombatCatalog';
import type {
    ZCCombatEvent, ZCCombatFloatTextKind, ZCCombatTarget, ZCFloatText,
    ZCHexState, ZCProjectileState, ZCSnapshot, ZCUnitState
} from '../ZCGameTypes';
import type { ZCLegacyBuffApplication, ZCLegacySkillEvaluation } from '../ZCLegacySkillEffect';
import { ZCOwner } from '../ZCMapConfig';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import { ZCCombatSystem } from './ZCCombatSystem';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCAttackResolutionContext extends Pick<IZCModelServices, 'rules' | 'statusSystem' | 'geometry' | 'random' | 'effectiveDefinition' | 'unitPosition' | 'damageUnit'> {
    readonly counters: readonly ZCCounterRule[];
    readonly cards: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCDeckCard>>>;
    readonly skillRuntime: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>>;
    readonly statPatches: Readonly<Partial<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>>>;
    readonly deckBonuses: Readonly<Record<ZCOwner, ZCDeckBonuses>>;
    readonly unitById: ReadonlyMap<number, ZCUnitState>;
    currentTarget(unit: ZCUnitState): ZCCombatTarget | null;
    evaluateLegacySkill(source: ZCUnitState, keys: readonly string[], target: ZCCombatTarget, critical: boolean): ZCLegacySkillEvaluation;
    applyLegacySelfBuffs(source: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[]): readonly ZCLegacyBuffApplication[];
    tryExecuteUnit(target: ZCUnitState, chance: number | undefined, owner: ZCOwner, sourceId: number, precedingText?: ZCFloatText | null): void;
    applyHitStatus(target: ZCUnitState, statusId: string | undefined, sourceId?: number): void;
    applyLegacyBuffs(target: ZCUnitState, buffs: readonly ZCLegacyBuffApplication[], sourceId?: number): void;
    damageWall(source: Pick<ZCUnitState, 'owner' | 'freeX' | 'freeY'>, wall: ZCHexState, damage: number): void;
    damageBuilding(source: Pick<ZCUnitState, 'owner'>, building: ZCHexState, damage: number): void;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
}

function damageFloatTextKind(critical: boolean, counterMultiplier = 1): ZCCombatFloatTextKind {
    if (critical) return 'critical';
    if (counterMultiplier > 1) return 'restraint';
    if (counterMultiplier < 1) return 'resisted';
    return 'damage';
}

function distance(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.hypot(fromX - toX, fromY - toY);
}

/** Resolves attack launch and projectile impact against the same snapshot and per-match dependencies. */
export class ZCAttackResolutionSystem {
    private static cardById(context: IZCAttackResolutionContext, owner: ZCOwner, id: string): ZCDeckCard | undefined {
        return context.cards[owner].get(id);
    }

    private static unitStatPatchOf(unit: ZCUnitState, context: IZCAttackResolutionContext): ZCUnitStatPatch {
        return context.statPatches[unit.owner]?.get(unit.unitId) ?? {};
    }

    static criticalMultiplier(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const mods = context.statusSystem.statModsOf(String(unit.id));
        const patch = this.unitStatPatchOf(unit, context);
        const chance = Math.max(0, Math.min(1, ((mods.critPct ?? 0) + (patch.critRatePct ?? 0)) / 100));
        if (chance <= 0 || context.random() >= chance) return 1;
        return 1 + Math.max(0, ((mods.critDamagePct ?? 0) + (patch.critDamagePct ?? 0)) / 100);
    }

    private static targetOwner(state: ZCSnapshot, target: ZCCombatTarget, context: IZCAttackResolutionContext): ZCOwner {
        if (target.kind === 'unit') return context.unitById.get(target.id)?.owner ?? ZCOwner.Enemy;
        const owner = this.hex(state, target.id)?.owner;
        return owner && owner !== 'neutral' ? owner : ZCOwner.Enemy;
    }

    private static hex(state: ZCSnapshot, id: number): ZCHexState | null {
        return state.hexes[id] || null;
    }

    private static unitDamage(context: IZCAttackResolutionContext, unit: ZCUnitState,
        targetOwner: ZCOwner, targetCardId: string | null, skillDamageRate = 1): number {
        const definition = context.effectiveDefinition(unit);
        const bonuses = context.deckBonuses[unit.owner];
        const attackerCard = this.cardById(context, unit.owner, unit.cardId);
        const targetCard = targetCardId ? this.cardById(context, targetOwner, targetCardId) : undefined;
        const damage = ZCCombatSystem.unitDamage(unit, definition, bonuses,
            cardCounterMultiplier(attackerCard, targetCard, context.counters), context.rules, skillDamageRate);
        return Math.max(1, Math.round(damage * (unit.attackMultiplier ?? 1)));
    }

    private static extraHitCountOf(projectile: ZCProjectileState, context: IZCAttackResolutionContext): number {
        const source = context.unitById.get(projectile.sourceUnitId);
        if (!source) return 0;
        const extra = this.unitStatPatchOf(source, context).multiHitFlat ?? 0;
        return extra > 0 ? Math.min(20, Math.round(extra)) : 0;
    }

    static resolveRadialSkill(state: ZCSnapshot, source: ZCUnitState, event: ZCCombatEvent,
        damage: number, rawDirectionCount: number, onHitStatusId: string | undefined,
        legacyBuffs: readonly ZCLegacyBuffApplication[], floatTextKind: ZCCombatFloatTextKind,
        context: IZCAttackResolutionContext): void {
        const directionCount = Math.max(1, Math.round(rawDirectionCount));
        const origin = context.unitPosition(source);
        const corridor = 6 * context.rules.combatDistanceScale;
        state.combatEvents.push(event);
        for (const target of state.units) {
            if (target.owner === source.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            let hit = false;
            for (let index = 0; index < directionCount && !hit; index += 1) {
                const angle = source.facingRadians + Math.PI * 2 * index / directionCount;
                const ux = Math.cos(angle), uy = Math.sin(angle);
                const along = dx * ux + dy * uy;
                const perpendicular = Math.abs(dx * uy - dy * ux);
                hit = along >= 0 && perpendicular <= corridor
                    + context.effectiveDefinition(target).bodyRadius * context.rules.combatDistanceScale;
            }
            if (!hit) continue;
            context.damageUnit(target, damage, {
                owner: source.owner, kind: 'unit', unitId: source.id, floatTextKind,
            });
            context.applyHitStatus(target, onHitStatusId, source.id);
            context.applyLegacyBuffs(target, legacyBuffs, source.id);
        }
    }

    static ensureMoveSpeedStatus(context: IZCAttackResolutionContext, id: string,
        moveSpeedPct: number, durationSeconds: number): void {
        if (context.statusSystem.hasDef(id)) return;
        context.statusSystem.register({
            id, name: id, durationSeconds, refreshPolicy: 'refresh',
            statMods: { moveSpeedPct }, behavior: { kind: 'none' },
        });
    }

    static ensureBannerStatus(context: IZCAttackResolutionContext, rawRate: number): string {
        const rate = Math.max(0, Math.min(1, rawRate));
        const id = `__banner:${rate.toFixed(4)}__`;
        if (!context.statusSystem.hasDef(id)) {
            context.statusSystem.register({
                id, name: id, durationSeconds: 4, refreshPolicy: 'refresh',
                statMods: { critPct: rate * 100, critDamagePct: rate * 100 },
                behavior: { kind: 'none' },
            });
        }
        return id;
    }

    static applyShieldAura(state: ZCSnapshot, source: ZCUnitState, ratio: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        for (const ally of state.units) {
            if (ally.owner !== source.owner || ally.battleState === 'dead') continue;
            ally.shield = Math.max(ally.shield ?? 0, ally.maxHp * normalized);
        }
    }

    static applyMoveSpeedAura(state: ZCSnapshot, owner: ZCOwner, ratio: number,
        durationSeconds: number, context: IZCAttackResolutionContext): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        const id = `__haste:${normalized.toFixed(4)}__`;
        this.ensureMoveSpeedStatus(context, id, normalized * 100, durationSeconds);
        for (const ally of state.units) {
            if (ally.owner !== owner || ally.battleState === 'dead') continue;
            context.statusSystem.apply(String(ally.id), id, { at: state.elapsedSeconds, durationSeconds });
        }
        state.statusEffects = context.statusSystem.exportSnapshot();
    }

    static applyBannerBuff(state: ZCSnapshot, owner: ZCOwner, rawCount: number,
        rawRate: number, context: IZCAttackResolutionContext): void {
        const id = this.ensureBannerStatus(context, rawRate);
        const candidates = state.units
            .filter((unit) => unit.owner === owner && unit.battleState !== 'dead')
            .sort((a, b) => a.id - b.id);
        const count = Math.min(candidates.length, Math.max(0, Math.round(rawCount)));
        for (let index = 0; index < count; index += 1) {
            const pick = Math.min(candidates.length - 1, Math.floor(context.random() * candidates.length));
            const target = candidates.splice(pick, 1)[0];
            context.statusSystem.apply(String(target.id), id, { at: state.elapsedSeconds, durationSeconds: 4 });
        }
        state.statusEffects = context.statusSystem.exportSnapshot();
    }

    static sendAttack(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): void {
        unit.attackHitDone = true;
        const target = context.currentTarget(unit);
        if (!target) return;
        const definition = context.effectiveDefinition(unit);
        const patch = this.unitStatPatchOf(unit, context);
        const profile = definition.attackProfile;
        const empowered = ZCCombatSystem.consumeEmpoweredAttack(unit, profile, state.elapsedSeconds);
        const skillRuntime = context.skillRuntime[unit.owner].get(`${unit.unitId}:${profile.skillId}`);
        let projectileCount = empowered
            ? Math.max(1, Math.round(skillRuntime?.parameters.projectileCount ?? 1))
            : 1;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        // 技能伤害倍率：强化那一击读**武将技行**（36xxx）的 `damageRate`，普通普攻读**普攻行**（301xx）的。
        // 两行各带自己的倍率（表里普攻行一律留空 = 1），所以这里按 `empowered` 二选一；
        // 技能行是 `empoweredSkillId` 指过去的独立 profile，`definition.empoweredProfile` 就是它。
        // 「本次生效 profile」：强化那一击的表现层（mode / 弹道速度 / 半径 / 碰撞半径）一律取
        // 武将技行（36xxx），不再沿用普攻行（301xx）。否则冰法师普攻是 projectile、武将技冰雕
        // 是 area，强化触发时会把冰雕当成投射物从法师位置飞到目标点 —— 冰雕应在目标点就地生成。
        const activeProfile = (empowered && definition.empoweredProfile) ? definition.empoweredProfile : profile;
        const onHitStatusId = skillRuntime?.statusId ?? activeProfile.onHitStatusId;
        const skillDamageRate = (empowered
            ? (skillRuntime?.parameters.impactDamageRate
                ?? skillRuntime?.parameters.damageRate
                ?? definition.empoweredProfile?.damageRate)
            : profile.damageRate) ?? 1;
        const legacy = context.evaluateLegacySkill(unit, activeProfile.legacyEffectKeys ?? [], target, criticalMultiplier > 1);
        // Old Client applies traction to the caster when the attack/bullet is created; it is an
        // aura, not an on-hit debuff on the struck target. Keep it out of projectile hit payloads.
        const legacyTargetBuffs = context.applyLegacySelfBuffs(unit, legacy.buffs);
        const legacyHitCount = legacy.hitCount ?? 0;
        if (legacyHitCount > 0) projectileCount = Math.max(projectileCount, Math.round(legacyHitCount));
        //  `pvpAttrMap.bulletNum`（2026-10-13）：正数 = 多打几发，负数 = 少几发，下限 1。
        //  用「增量」而非「绝对值」，才能与技能表原有的 projectileCount / hitCount 叠加。
        if (patch.bulletNumFlat) {
            projectileCount = Math.max(1, Math.round(projectileCount + patch.bulletNumFlat));
        }
        const counterMultiplier = cardCounterMultiplier(
            this.cardById(context, unit.owner, unit.cardId),
            target.cardId ? this.cardById(context, this.targetOwner(state, target, context), target.cardId) : undefined,
            context.counters,
        );
        const criticalHit = criticalMultiplier > 1;
        const floatTextKind = damageFloatTextKind(criticalHit, counterMultiplier);
        const damage = legacy.hasDamageFormula
            ? Math.round(legacy.damage * criticalMultiplier * counterMultiplier)
            : Math.round(this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId, skillDamageRate) * criticalMultiplier);
        const legacyAreaRadius = Math.max(0, legacy.range ?? 0) * context.rules.combatDistanceScale;
        const effectiveAreaRadius = legacyAreaRadius > 0
            ? legacyAreaRadius
            : (activeProfile.areaRadius || 0) * context.rules.combatDistanceScale;
        const from = context.unitPosition(unit);
        const travelSeconds = ZCCombatSystem.attackTravelSeconds(
            activeProfile.mode,
            distance(from.x, from.y, target.x, target.y),
            activeProfile.projectileSpeed,
        );
        const event: ZCCombatEvent = {
            id: state.nextCombatEventId++,
            type: activeProfile.mode,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId: empowered && profile.empoweredSkillId ? profile.empoweredSkillId : profile.skillId,
            skillName: empowered ? `${profile.name}·强化` : profile.name,
            effectKey: activeProfile.effectKey ?? profile.effectKey ?? null,
            projectileKey: activeProfile.projectileKey ?? profile.projectileKey ?? null,
            // 强化那一击改用**技能行**（36000 段）的特效；技能行没配路径时回落普攻特效。
            effectPrefabPath: (empowered && definition.empoweredProfile?.effectPrefabPath)
                || profile.effectPrefabPath || null,
            fromX: from.x,
            fromY: from.y,
            toX: target.x,
            toY: target.y,
            radius: effectiveAreaRadius,
            damage,
            empowered,
            startedAt: state.elapsedSeconds,
            durationSeconds: travelSeconds,
        };
        const parameters = skillRuntime?.parameters;
        if (empowered && parameters && parameters.shieldRatio > 0) {
            this.applyShieldAura(state, unit, parameters.shieldRatio);
        }
        if (empowered && parameters && parameters.moveSpeedBoost > 0) {
            this.applyMoveSpeedAura(state, unit.owner, parameters.moveSpeedBoost, 5, context);
        }
        if (empowered && parameters && parameters.bannerTargetCount > 0
            && parameters.bannerCritRate > 0) {
            this.applyBannerBuff(state, unit.owner, parameters.bannerTargetCount, parameters.bannerCritRate, context);
        }
        if (empowered && parameters && parameters.directionCount > 1) {
            this.resolveRadialSkill(state, unit, event, damage, parameters.directionCount,
                onHitStatusId, legacyTargetBuffs, floatTextKind, context);
            return;
        }
        if (activeProfile.mode === 'projectile') {
            const dx = target.x - from.x, dy = target.y - from.y;
            const length = Math.hypot(dx, dy);
            const speed = activeProfile.projectileSpeed || 500;
            const bonuses = context.deckBonuses[unit.owner];
            for (let index = 0; index < projectileCount; index += 1) {
                const projectileEvent = index === 0 ? event : { ...event, id: state.nextCombatEventId++ };
                //  多发扇形展开：只有 `bulletAngle > 0` 时才转方向，缺省仍是全部打同一条直线
                //  （老技能没有任何表数据，行为必须逐字不变）。
                const halfSpan = (patch.bulletAngleFlat ?? 0) > 0 && projectileCount > 1
                    ? ((patch.bulletAngleFlat ?? 0) * Math.PI / 180) / 2
                    : 0;
                const spread = projectileCount > 1 ? (index / (projectileCount - 1)) * 2 - 1 : 0;
                const heading = (length > 0 ? Math.atan2(dy, dx) : unit.facingRadians) + spread * halfSpan;
                const dirX = length > 0 || halfSpan > 0 ? Math.cos(heading) : Math.cos(unit.facingRadians);
                const dirY = length > 0 || halfSpan > 0 ? Math.sin(heading) : Math.sin(unit.facingRadians);
                state.projectiles.push({
                    ...projectileEvent, type: 'projectile', targetKind: target.kind, targetId: target.id,
                    sourceCardId: unit.cardId,
                    baseDamage: legacy.hasDamageFormula
                        ? legacy.damage * criticalMultiplier
                        : ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, skillDamageRate)
                            * (unit.attackMultiplier ?? 1) * criticalMultiplier,
                    x: from.x, y: from.y, previousX: from.x, previousY: from.y,
                    velocityX: dirX * speed,
                    velocityY: dirY * speed,
                    collisionRadius: (activeProfile.collisionRadius ?? 3) * context.rules.combatDistanceScale,
                    canHitAir: definition.canAttackAir,
                    // 投射物命中后在落点创建持续区域（火船/风龙：飞过去命中后才烧）
                    zoneDuration: activeProfile.durationSeconds ?? 0,
                    zoneWaves: Math.max(1, activeProfile.waves ?? 1),
                    zoneSlow: activeProfile.slowRatio ?? 0,
                    zoneDamage: empowered && skillRuntime?.parameters.explosionDamageRate != null
                        ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId, skillRuntime.parameters.explosionDamageRate) * criticalMultiplier
                        : undefined,
                    remainingPierces: empowered
                        ? Math.max(0, Math.floor(skillRuntime?.parameters.pierceCount ?? 0))
                        : 0,
                    hitUnitIds: [],
                    executeChance: Math.max(0, Math.min(1,
                        (empowered ? skillRuntime?.parameters.executeChance : undefined)
                        ?? legacy.executeChance ?? 0)),
                    criticalHit,
                    onHitStatusId,
                    legacyBuffs: [...legacyTargetBuffs],
                    splashRadius: legacyAreaRadius > 0 ? legacyAreaRadius : undefined,
                });
            }
            return;
        }
        const durationSeconds = activeProfile.durationSeconds ?? 0;
        const waves = Math.max(1, activeProfile.waves ?? 1);
        const slowRatio = empowered
            ? Math.max(0, Math.min(1, skillRuntime?.parameters.slowRatio ?? activeProfile.slowRatio ?? 0))
            : activeProfile.slowRatio ?? 0;
        const areaRadius = effectiveAreaRadius;

        // 持续区域（暴风雪）：命中后在目标点建 zone，分波结算；不再立即打主目标/溅射。
        if (durationSeconds > 0 && areaRadius > 0) {
            const waveInterval = durationSeconds / waves;
            const zoneCount = empowered ? Math.max(1, Math.round(skillRuntime?.parameters.zoneCount ?? 1)) : 1;
            const expireDamage = empowered && skillRuntime?.parameters.expireDamageRate != null
                ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId, skillRuntime.parameters.expireDamageRate) * criticalMultiplier
                : 0;
            for (let index = 0; index < zoneCount; index += 1) {
                const angle = zoneCount === 1 ? 0 : unit.facingRadians + Math.PI * 2 * index / zoneCount;
                const offset = zoneCount === 1 ? 0 : areaRadius * .45;
                state.groundZones.push({
                    x: target.x + Math.cos(angle) * offset,
                    y: target.y + Math.sin(angle) * offset,
                    radius: areaRadius,
                    owner: unit.owner,
                    sourceUnitId: unit.id,
                    skillId: event.skillId,
                    skillName: event.skillName,
                    effectPrefabPath: event.effectPrefabPath ?? null,
                    remainingSeconds: durationSeconds,
                    wavesLeft: waves,
                    nextWaveAt: state.elapsedSeconds,
                    waveInterval,
                    damage,
                    floatTextKind,
                    slowRatio,
                    expireDamage,
                    expireStatusId: expireDamage > 0 ? 'freeze' : undefined,
                    expireStatusDuration: Math.max(0, skillRuntime?.parameters.freezeDuration ?? 0),
                });
            }
            return;
        }

        state.combatEvents.push(event);
        if (target.kind === 'unit') {
            const targetUnit = context.unitById.get(target.id) ?? null;
            if (targetUnit) {
                const hitText = context.damageUnit(targetUnit, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                context.tryExecuteUnit(targetUnit,
                    (empowered ? skillRuntime?.parameters.executeChance : undefined) ?? legacy.executeChance,
                    unit.owner, unit.id, hitText);
                context.applyHitStatus(targetUnit, onHitStatusId, unit.id);
                context.applyLegacyBuffs(targetUnit, legacyTargetBuffs, unit.id);
            }
        } else if (target.kind === 'wall') {
            const targetWall = this.hex(state, target.id);
            if (targetWall) context.damageWall(unit, targetWall, damage);
        } else {
            const targetBuilding = this.hex(state, target.id);
            if (targetBuilding) context.damageBuilding(unit, targetBuilding, damage);
        }
        if ((activeProfile.mode === 'area' || legacyAreaRadius > 0) && areaRadius > 0) {
            const targetHexId = context.geometry.hexIdAt(target.x, target.y);
            const radiusHex = targetHexId === null ? 0 : Math.ceil(areaRadius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const splashCandidates = targetHexId === null ? [] : context.unitsInRadius(targetHexId, radiusHex);
            for (const splash of splashCandidates) {
                if ((target.kind === 'unit' && splash.id === target.id) || splash.owner === unit.owner || splash.battleState === 'dead') continue;
                const pos = context.unitPosition(splash);
                if (distance(target.x, target.y, pos.x, pos.y) <= areaRadius) {
                    const hitText = context.damageUnit(splash, damage, {
                        owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                    });
                    context.tryExecuteUnit(splash, empowered ? skillRuntime?.parameters.executeChance : undefined,
                        unit.owner, unit.id, hitText);
                    context.applyHitStatus(splash, activeProfile.onHitStatusId, unit.id);
                    context.applyLegacyBuffs(splash, legacyTargetBuffs, unit.id);
                }
            }
        }
    }

    static resolveProjectileHit(state: ZCSnapshot, projectile: ZCProjectileState, target: ZCCombatTarget,
        context: IZCAttackResolutionContext): void {
        const targetOwner = this.targetOwner(state, target, context);
        const multiplier = cardCounterMultiplier(this.cardById(context, projectile.owner, projectile.sourceCardId), target.cardId ? this.cardById(context, targetOwner, target.cardId) : undefined, context.counters);
        const damage = Math.round(projectile.baseDamage * multiplier);
        const floatTextKind = damageFloatTextKind(projectile.criticalHit === true, multiplier);
        const sender = { owner: projectile.owner, freeX: projectile.x, freeY: projectile.y };
        //  连击（`pvpAttrMap.attackCount`，2026-10-13）：一次出手多打几段**额外伤害**。
        //  只加伤害，不重复触发处决 / 状态挂载 / 顿帧 —— 那些按「一次出手」算，多打几段不该重复给。
        //  第一段仍走下面原有的完整链路（含暴击文本），额外段在它之后静默补上。
        const extraHits = this.extraHitCountOf(projectile, context);
        if (target.kind === 'unit') {
            const unit = context.unitById.get(target.id);
            if (unit) {
                const hitText = context.damageUnit(unit, damage, {
                    owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId, floatTextKind,
                });
                if (extraHits > 0) {
                    context.damageUnit(unit, damage * extraHits, {
                        owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId, floatTextKind: 'damage',
                    });
                }
                context.tryExecuteUnit(unit, projectile.executeChance, projectile.owner, projectile.sourceUnitId, hitText);
                context.applyHitStatus(unit, projectile.onHitStatusId, projectile.sourceUnitId);
                context.applyLegacyBuffs(unit, projectile.legacyBuffs ?? [], projectile.sourceUnitId);
            }
        } else {
            const hex = this.hex(state, target.id);
            if (hex) {
                if (target.kind === 'wall') context.damageWall(sender, hex, damage);
                else context.damageBuilding(sender, hex, damage);
            }
        }
        if ((projectile.splashRadius ?? 0) > 0) {
            const centerHexId = context.geometry.hexIdAt(projectile.x, projectile.y);
            const radius = projectile.splashRadius ?? 0;
            const radiusHex = centerHexId == null ? 0 : Math.ceil(radius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const candidates = centerHexId == null ? [] : context.unitsInRadius(centerHexId, radiusHex);
            for (const splash of candidates) {
                if ((target.kind === 'unit' && splash.id === target.id)
                    || splash.owner === projectile.owner || splash.battleState === 'dead') continue;
                const position = context.unitPosition(splash);
                if (distance(projectile.x, projectile.y, position.x, position.y) > radius) continue;
                const splashMultiplier = cardCounterMultiplier(
                    this.cardById(context, projectile.owner, projectile.sourceCardId),
                    this.cardById(context, splash.owner, splash.cardId),
                    context.counters,
                );
                const splashDamage = Math.round(projectile.baseDamage * splashMultiplier);
                const splashText = context.damageUnit(splash, splashDamage, {
                    owner: projectile.owner,
                    kind: 'unit',
                    unitId: projectile.sourceUnitId,
                    floatTextKind: damageFloatTextKind(projectile.criticalHit === true, splashMultiplier),
                });
                context.tryExecuteUnit(splash, projectile.executeChance, projectile.owner, projectile.sourceUnitId, splashText);
                context.applyHitStatus(splash, projectile.onHitStatusId, projectile.sourceUnitId);
                context.applyLegacyBuffs(splash, projectile.legacyBuffs ?? [], projectile.sourceUnitId);
            }
        }
        state.combatEvents.push({
            id: state.nextCombatEventId++, type: 'area', owner: projectile.owner,
            sourceUnitId: projectile.sourceUnitId, skillId: projectile.skillId, skillName: projectile.skillName,
            empowered: projectile.empowered,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            fromX: projectile.x, fromY: projectile.y, toX: projectile.x, toY: projectile.y,
            effectPrefabPath: null, effectKey: 'hit', projectileKey: null,
            radius: 4, damage, startedAt: state.elapsedSeconds, durationSeconds: .18,
        });
        // 投射物命中后在落点创建持续区域（火船/风龙：命中后才烧）
        if ((projectile.zoneDuration ?? 0) > 0 && projectile.radius > 0) {
            const waves = Math.max(1, projectile.zoneWaves ?? 1);
            state.groundZones.push({
                x: projectile.x,
                y: projectile.y,
                radius: projectile.radius,
                owner: projectile.owner,
                sourceUnitId: projectile.sourceUnitId,
                skillId: projectile.skillId,
                skillName: projectile.skillName,
                effectPrefabPath: 'units/projectiles/普攻爆炸/普攻爆炸',
                remainingSeconds: projectile.zoneDuration ?? 0,
                wavesLeft: waves,
                nextWaveAt: state.elapsedSeconds,
                waveInterval: (projectile.zoneDuration ?? 0) / waves,
                damage: projectile.zoneDamage ?? damage,
                floatTextKind,
                slowRatio: projectile.zoneSlow ?? 0,
            });
        }
    }
}

