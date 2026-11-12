import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import { cardCounterMultiplier, ZCCombatEventType, type ZCAttackProfile, type ZCCounterRule, type ZCDeckBonuses, type ZCDeckCard } from '../ZCCombatCatalog';
import { zcCombatEffectTravelSeconds } from '../ZCCombatEffectFlight';
import { ZC_SELF_AURA_EFFECT_PREFAB_PATH, ZC_SELF_AURA_BEHAVIOR_KEY, zcSelfAuraEffectPath } from '../ZCSelfAuraFx';
import { ZC_BOLT_EFFECT_PREFAB_PATH, ZC_BOLT_EFFECT_SECONDS, ZC_BOLT_NUMB_STATUS_ID } from '../ZCBoltStrikeFx';
import { missileLog } from '../../ZCMissileSkillDiagnostics';
import { skillCastLog, skillCastLogChanging, zcSkillCastWatched } from '../../ZCSkillCastDiagnostics';
import type {
    ZCCombatEvent, ZCCombatFloatTextKind, ZCCombatTarget, ZCFloatText,
    ZCHexState, ZCProjectileState, ZCSnapshot, ZCUnitState
} from '../ZCGameTypes';
import type { ZCLegacyBuffApplication, ZCLegacySkillEvaluation } from '../ZCLegacySkillEffect';
import { ZCOwner } from '../ZCMapConfig';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import type { ZCSkillRuntimeDefinition } from '../ZCSkillRuntime';
import { ZC_PROJECTILE_MISS_DISTANCE, ZCCombatSystem } from './ZCCombatSystem';
import type { IZCModelServices } from './ZCModelServices';
import { ZCTargetingSystem } from './ZCTargetingSystem';

/**
 * 打城墙 / 打建筑的「出手方」。
 *
 * 为什么不是整只 `ZCUnitState`：投射物离手后施法者可能已经被移除，
 * `resolveProjectileHit` 只能给出一个坐标壳（归属 + 出手点），而不是一个活着的实例。
 *
 * `id` 是**单位实例 id**（`ZCUnitState.id`，不是卡牌 unitId）—— 建筑 / 城墙的受击特效
 * 要靠它反查攻击方职业（`pvpCard.traits.attack`）。**允许缺省**：拿不到时那一下不播闪白，
 * 伤害与飘字照常。
 */
export interface IZCStructureDamageSource {
    readonly owner: ZCOwner;
    readonly freeX: number;
    readonly freeY: number;
    readonly id?: number;
}

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
    damageWall(source: IZCStructureDamageSource, wall: ZCHexState, damage: number): void;
    damageBuilding(source: IZCStructureDamageSource, building: ZCHexState, damage: number): void;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    /**
     * 给单位回血（2026-11-04 吸血用）。
     *
     * 走 `ZCStatusResolutionSystem.healUnit` 同一条实现：封顶 `maxHp`、死亡不生效、
     * 真回了才推一条 `heal` 飘字。**不要**在这里直接 `unit.hp += x`，
     * 否则同一件事会有两套上限/飘字口径。
     */
    healUnit(unit: ZCUnitState, amount: number): void;
    /**
     * 旧表口径的击退（`rawDistance` 单位是**格**，实现里乘 `combatDistanceScale`）。
     *
     * 与状态表里的 `legacy_knockback` handler 共用 `ZCGameModel.applyLegacyKnockback`，
     * 所以「技能表直接推一次击退」和「挂个击退 buff」落点完全一致（撞墙/不可走格子会被吞）。
     */
    applyKnockback(target: ZCUnitState, source: ZCUnitState, rawDistance: number): void;
    /**
     * 把一个弹道写进 `state.projectiles`（追踪导弹 101003 走这条：不立即结算，
     * 而是发一颗会沿弧线飞、撞到才停的弹体）。
     *
     * 为什么不直接在 `strikeTargets` 里 `state.projectiles.push`：弹道的完整字段
     * （`sourceCardId` / `baseDamage` / `effectPrefabPath` / 克制系数）都在攻击方上下文里，
     * 而且普通弹道那一条 `sendAttack` 已经有一套「从出手点到目标」的构造口径，
     * 这里让宿主（`ZCGameModel`）补一个回调，复用同一份 `state` 写入口径，避免两套 push 代码漂移。
     */
    pushProjectile(projectile: ZCProjectileState): void;
}

/**
 * `ZCAttackResolutionSystem.strikeTargets` 的入参（全部**世界坐标**口径，由调用方换算）。
 *
 * 单独抽成接口而不是一长串位置参数：这里有 6 个数值 + 1 个枚举倾向，
 * 位置参数在调用点读不出哪一个是半径、哪一个是倍率。
 */
export interface IZCStrikeOptions {
    /** 这一次最多打几个目标。 */
    readonly count: number;
    /** 挑选半径（世界坐标）。 */
    readonly radius: number;
    /** 每发相对面板的伤害倍率。 */
    readonly damageRate: number;
    /** `true` = 就近优先；`false` = 随机（消耗 `context.random`，回放可重演）。 */
    readonly nearest: boolean;
    /** 落点溅射半径（世界坐标）；0 / 缺省 = 不溅射。 */
    readonly splashRadius?: number;
    /** 溅射伤害 = 直击伤害 × 本系数；0 / 缺省 = 不溅射。 */
    readonly splashDamageRate?: number;
    /**
     * 挑人的原点（**世界坐标**）；缺省 = 施法者当前位置。
     *
     * 为什么需要：移形换影（103404）的分身要在**施法时的原位**爆炸，而这段时间里本体
     * 已经闪回去、甚至继续跑位了 —— 拿 `context.unitPosition(unit)` 当原点，分身会跟着
     * 本体漂走。只改原点、不改挑选/结算逻辑，是为了让「分身爆炸」和「随机多点」共用
     * 同一份伤害口径（暴击、克制、溅射、处决全都一致）。
     */
    readonly origin?: { readonly x: number; readonly y: number };
    /** 命中挂的状态 id；缺省不挂。 */
    readonly statusId?: string;
    /**
     * 「追踪导弹」模式：不发即结算，而是每挑一个目标发一颗**弧线导弹**。
     *
     *   · `missilePrefabPath` —— 飞行段的弹体特效（`镭射飞龙_导弹技能`）；
     *   · `impactPrefabPath`  —— 停下后播的爆炸（`镭射飞龙_导弹技能命中`）；
     *   · `arcOffset`         —— 出手点到目标点中段的横向偏移（世界坐标，造出"三条不同弧线"）。
     *
     * 命中判定、伤害、溅射仍走既有 `resolveProjectileHit` + `splashRadius` 那套，
     * 只是把「挑到人就立即扣血」换成「发一颗会飞过去的弹体」。
     */
    readonly missilePrefabPath?: string;
    readonly impactPrefabPath?: string;
    readonly arcOffset?: number;
    /**
     * 导弹自己的飞行速度（逻辑 px/秒）；缺省 = 复用 `profile.projectileSpeed`。
     *
     * 为什么单独给：镭射飞龙的普攻是一道光束，`projectileSpeed` 500 是**光束**的速度；
     * 导弹要的是「慢速滑翔、看得清弧线」，两者共用一个值就必然二选一。
     * 2026-11-05 需求：「慢速滑翔、强调弧线」⇒ 200（最远一发约 1.65s）。
     */
    readonly missileSpeed?: number;
    /**
     * 导弹一次施法的**恒定发数**（覆盖 `count`）；缺省 = 听 `count`。
     *
     * 来自 `ZCCombatEffectFlight` 的 `IZCMissileFxSpec.count`。钳在 `strikeTargets` 里而不是
     * 调用方，是因为「最后到底推了几颗弹体」只有这里说了算 —— 调用方改 `count` 还得
     * 记得同步改 `victims`，迟早会漂。**只对导弹分支生效**：戈壁狂箭那种「一次挑 N 个人
     * 立即结算」的多点打击不受影响。
     */
    readonly missileCount?: number;
}

function damageFloatTextKind(critical: boolean, counterMultiplier = 1): ZCCombatFloatTextKind {    if (critical) return 'critical';
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
        //  unit 域「伤害倍率」（`pvpSkillPlan.statId = damageRate`，2026-10-30 玉林好汉「铁质飞镖」）：
        //  与攻击力加成不同，它只在最终结算处相乘一次、不抬高面板。缺省 0 ⇒ 乘 1。
        const rawMultiplier = 1 + (this.unitStatPatchOf(unit, context).damageRatePct ?? 0) / 100;
        //  status 域的同一层（2026-10-30 僵尸「嗜血」100703）：限时增益只能落在状态上，
        //  而 unit 域补丁是常驻的 —— 两者口径相同、各自缺省 0 ⇒ 存量伤害逐字不变。
        const statusMultiplier = 1 + (context.statusSystem.statModsOf(String(unit.id)).damageRatePct ?? 0) / 100;
        const damage = ZCCombatSystem.unitDamage(unit, definition, bonuses,
            cardCounterMultiplier(attackerCard, targetCard, context.counters), context.rules,
            skillDamageRate * Math.max(0, rawMultiplier) * Math.max(0, statusMultiplier));
        return Math.max(1, Math.round(damage * (unit.attackMultiplier ?? 1)));
    }

    /**
     * 吸血（2026-11-04 椰蛋战士「生命汲取」100503）。
     *
     * 只在**真正扣到血**时回：`damageUnit` 返回的飘字 `value` 就是 `result.applied`
     * （护盾吸收、溢出、无敌、已死都已经在这之前扣完），拿面板伤害反算会出现
     * 「这一下被盾全吃掉、血量反而涨回来」。
     *
     * 缺省 0 ⇒ 整段不执行，既有单位行为逐字不变。
     *
     * 派发点共 5 处：近战直击 / 近战范围溅射 / 弹道命中 / 弹道溅射 / **持续区域的每一波**。
     * 最后那处（2026-11-04 补）由 `ZCGroundZoneSystem` 通过 `IZCGroundZoneContext.lifestealFromHit`
     * 回调进来 —— 区域结算拿不到攻击上下文，所以只能用「源单位 id + 这一跳的飘字」两个入参，
     * 比例仍由本函数内部的 `lifestealRatioOf` 统一取，不另写一套口径。
     * 区域里一次打中 N 个人就是 N 次独立回血（各按各自的实际掉血 × 比例），
     * 不是「按一波总额回一次」。
     */
    static applyLifesteal(source: ZCUnitState, hitText: ZCFloatText | null,
        context: IZCAttackResolutionContext): void {
        const ratio = this.lifestealRatioOf(source, context);
        if (!(ratio > 0)) return;
        const dealt = hitText?.value ?? 0;
        if (!(dealt > 0)) return;
        context.healUnit(source, dealt * ratio);
    }

    /**
     * 吸血比例的取值顺序：**技能参数优先，unit 域属性兜底**。
     *
     * 为什么表里走的是 `skillParamJson.lifestealRate` 而不是 `pvpSkillPlan.statId`：
     * `ZCStatSchema` 硬校验「同一 unit + 技能链 + 等级只能有一行」，而 100503 生命汲取
     * 同时要「攻击范围 +30%（unit 域）」和「吸血 2%」两个数值 —— 一行只有**一个** statId 落点。
     * 所以攻击范围占 statId、吸血走参数，两条都是同一档、同一行，不破坏那条唯一性约束。
     * `ZCUnitStatPatch.lifestealRate`（unit 域）仍然可用，留给「整卡常驻吸血」这类需求。
     */
    private static lifestealRatioOf(unit: ZCUnitState, context: IZCAttackResolutionContext): number {
        const skillId = context.effectiveDefinition(unit).attackProfile.skillId;
        const params = context.skillRuntime[unit.owner].get(`${unit.unitId}:${skillId}`)?.parameters;
        const fromParams = params?.lifestealRate ?? this.unitStatPatchOf(unit, context).lifestealRate ?? 0;
        //  状态域的同名比例（2026-10-30 僵尸「嗜血」100703）：吸血是限时的，只能挂在状态上。
        //  与上面那层**相加**而不是择一 —— 常驻吸血 + 开嗜血时临时加吸血，两个来源都该吃。
        //  缺省 0 ⇒ 存量单位比例不变。
        const fromStatus = context.statusSystem.statModsOf(String(unit.id)).lifestealRate ?? 0;
        return Math.max(0, Math.min(1, fromParams + fromStatus));
    }

    private static extraHitCountOf(projectile: ZCProjectileState, context: IZCAttackResolutionContext): number {
        const source = context.unitById.get(projectile.sourceUnitId);
        if (!source) return 0;
        const extra = this.unitStatPatchOf(source, context).multiHitFlat ?? 0;
        return extra > 0 ? Math.min(20, Math.round(extra)) : 0;
    }

    /**
     * 命中附加表现（`pvpSkill.impactEffectPrefabPath`，2026-10-31 运动霸 203301 的「气浪」）。
     *
     * 补一条 `area` 事件落在**受击点**：`area` 在 `zcCombatEffectLayerOf` 里归地面层，
     * 所以冲击环压在角色脚下而不是糊在脸上，这正是气浪该有的层次。
     * `damage: 0` 是安全的 —— `ZCCombatEffectView` 从不读 `event.damage`，
     * 伤害已经在主事件那条路上结算过了，这条纯粹是画面。
     * 没配路径 ⇒ 整段不执行，存量技能逐字不变。
     */
    private static pushImpactEffect(state: ZCSnapshot, event: ZCCombatEvent, profile: ZCAttackProfile): void {
        const effectPrefabPath = profile.impactEffectPrefabPath;
        if (!effectPrefabPath) return;
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: event.owner,
            sourceUnitId: event.sourceUnitId,
            targetUnitId: event.targetUnitId,
            skillId: event.skillId,
            skillName: event.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath,
            fromX: event.toX,
            fromY: event.toY,
            toX: event.toX,
            toY: event.toY,
            radius: 1,
            damage: 0,
            empowered: false,
            startedAt: event.startedAt,
            // 与近战主特效的 0.3s 对齐：多出来的那一点是给冲击环留的余波，不要长到盖住下一次普攻。
            durationSeconds: 0.35,
        });
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
            //  扇形方向技按「远程」结算（藤盾这类只减远程的护体要能吃到）。
            context.damageUnit(target, damage, {
                owner: source.owner, kind: 'unit', unitId: source.id, floatTextKind, ranged: true,
            });
            context.applyHitStatus(target, onHitStatusId, source.id);
            context.applyLegacyBuffs(target, legacyBuffs, source.id);
        }
    }

    /**
     * 副轨主动（2026-11-04 椰蛋战士「横扫」100502）：朝当前目标清一次**扇形**。
     *
     * 为什么不是复用 `sendAttack`：那条路会推进 `completedAttackCount` / `empoweredReadyAt`
     * （也就是普攻节拍与强化 CD），副轨的 CD 与它们无关，混在一起会让「每 8 秒横扫」
     * 顺带把「每 5 次普攻的暴风」提前或推后。这里只做伤害 + 击退 + 一条表现事件。
     *
     * 返回 `false` ⇒ 这一帧**没有真的出手**（没配副轨 / 没有目标），调用方不要消费 CD。
     *
     * 参数（全部来自技能计划行的 `skillParamJson`，因此可逐档不同）：
     *   `secondaryCooldown`   冷却秒；≤0 表示这张卡没有副轨
     *   `secondaryDamageRate` 本次伤害倍率（相对面板）
     *   `secondaryFanDeg`     扇形角度（度），缺省 120
     *   `secondaryRadiusScale` 半径 = 当前攻击距离 × 本系数，缺省 1.4
     *   `secondaryKnockback`  击退格数（0 = 不击退）
     */
    static castFanSkill(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = context.skillRuntime[unit.owner]
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        if (!(Math.max(0, parameters?.secondaryCooldown ?? 0) > 0)) return false;
        const activeProfile = definition.secondaryProfile;
        if (!activeProfile) return false;
        const target = context.currentTarget(unit);
        if (!target) return false;
        const origin = context.unitPosition(unit);
        const heading = Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y) > 1e-9
            ? Math.atan2(target.y - origin.y, target.x - origin.x)
            : unit.facingRadians;
        //  半径以**当前**攻击距离为基准：100503 的 attackRange +30% 会一起吃到，
        //  这样「升了生命汲取顺手把横扫范围拉大」是自然结果，不需要再配一遍。
        //  ⚠️ `attackReach` 内部自己乘 `combatDistanceScale`，三个入参都是**表值**口径
        //  （bodyRadius 也是），这里不要再预乘一次，否则身体半径会被缩两次。
        const reach = ZCTargetingSystem.attackReach(
            definition, definition.bodyRadius, context.rules.combatDistanceScale);
        const radius = Math.max(1, reach * Math.max(0.1, parameters?.secondaryRadiusScale ?? 1.4));
        const halfAngle = Math.max(0, Math.min(180, parameters?.secondaryFanDeg ?? 120)) * Math.PI / 360;
        const skillDamageRate = Math.max(0, parameters?.secondaryDamageRate ?? 1);
        const knockbackCells = Math.max(0, parameters?.secondaryKnockback ?? 0);
        //  副轨命中挂状态（2026-10-30 僵尸「声波扫射」103203：II/III 级让命中目标减速）。
        //  必须显式开 `secondaryAppliesHitStatus = 1` 才挂：`skillParamJson` 里的 `statusId`
        //  是**整卡共用**的一个槽（`mergeSkillPlanIntoRuntime` 按 `unitId:pvpSkillId` 合并），
        //  不加闸门的话「同一张卡另一条技能的眩晕/易伤」会被副轨顺手一起打出去。
        //  缺省 0 ⇒ 既有副轨（椰蛋战士「横扫」）行为逐字不变。
        const appliesHitStatus = (parameters?.secondaryAppliesHitStatus ?? 0) > 0;
        const onHitStatusId = appliesHitStatus
            ? (context.skillRuntime[unit.owner].get(`${unit.unitId}:${profile.skillId}`)?.statusId
                ?? activeProfile.onHitStatusId)
            : activeProfile.onHitStatusId;
        const targetOwner = this.targetOwner(state, target, context);
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(this.unitDamage(context, unit, targetOwner, target.cardId, skillDamageRate)
            * criticalMultiplier);
        const counterMultiplier = cardCounterMultiplier(
            this.cardById(context, unit.owner, unit.cardId),
            target.cardId ? this.cardById(context, this.targetOwner(state, target, context), target.cardId) : undefined,
            context.counters,
        );
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: ZCCombatEventType.Area,
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId: activeProfile.skillId,
            skillName: activeProfile.name,
            effectKey: activeProfile.effectKey ?? null,
            projectileKey: null,
            effectPrefabPath: activeProfile.effectPrefabPath ?? null,
            fromX: origin.x,
            fromY: origin.y,
            toX: origin.x,
            toY: origin.y,
            radius,
            damage,
            //  扇形是「技能出手」，不是普攻；`empowered` 只影响表现层的强化标识，这里给 false
            //  是为了不与「每 N 次普攻的强化」混淆（同一个单位两条链各自有表现）。
            empowered: false,
            startedAt: state.elapsedSeconds,
            durationSeconds: 0.3,
        });
        const hitTargets = state.units.filter((candidate) => {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) return false;
            const pos = context.unitPosition(candidate);
            const dx = pos.x - origin.x, dy = pos.y - origin.y;
            const dist = Math.hypot(dx, dy);
            if (dist > radius) return false;
            //  贴脸（距离≈0）时方向没有意义，直接算命中，否则近战会「站在身上打不到」。
            if (dist <= 1e-6) return true;
            const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - heading),
                Math.cos(Math.atan2(dy, dx) - heading)));
            return delta <= halfAngle;
        });
        for (const victim of hitTargets) {
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
            });
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (onHitStatusId) context.applyHitStatus(victim, onHitStatusId, unit.id);
            if (knockbackCells > 0 && victim.hp > 0) {
                //  格 → 逻辑坐标：`HEX_GRID_LOGICAL_ROW_STEP` 是「一格行距」，
                //  再乘 `combatDistanceScale` 由 `applyLegacyKnockback` 自己完成。
                context.applyKnockback(victim, unit, knockbackCells * HEX_GRID_LOGICAL_ROW_STEP);
            }
        }
        return true;
    }

    /**
     * 自身光环：在施法者脚下开一片**跟着本体走**的周期伤害区域（2026-11-09 大威天芦
     * 「无尘禁土」102503）。
     *
     * 为什么建区域而不是「每秒扫一遍半径」：区域系统已经有一整套「波次 / 间隔 / 到期 /
     * 吸血 / 飘字 / 长寿命表现」的实现（`ZCGroundZoneSystem`），自己再写一套只会让
     * 「光环」和「灼热地带」这两件本质相同的事出现两套口径。这里只多补一个
     * `followUnitId`：每帧把圆心拍回本体，就是设计案要的「跟随本体移动」。
     *
     * 参数（`skillParamJson`，**表值口径**，半径与攻击距离同一套 px）：
     *   `auraCooldown`    冷却秒数（只给触发系统用，本函数不读）
     *   `auraSeconds`     持续秒数（4 / 6 / 8）
     *   `auraInterval`    每波间隔秒（缺省 1 ⇒ 「每秒对周围敌人造成 N% 伤害」）
     *   `auraRadius`      半径（表值 px；`areaRadius=60` 这一档与既有区域同量级）
     *   `auraDamageRate`  每波相对**面板伤害**的倍率（0.30 / 0.40 / 0.55）
     *   `auraSelfDamagePct` III 级「期间自身伤害提高 20%」由触发系统挂状态，本函数不读
     *
     * 返回 `true` = 真的开出来了（调用方才消费 CD）。参数缺失 ⇒ `false`，
     * 与副轨 / 多点打击同一条口径：跑位途中不把这次机会转掉。
     */
    static castSelfAura(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = context.skillRuntime[unit.owner]
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const radius = Math.max(0, parameters?.auraRadius ?? 0) * context.rules.combatDistanceScale;
        const seconds = Math.max(0, parameters?.auraSeconds ?? 0);
        const interval = Math.max(0.05, parameters?.auraInterval ?? 1);
        const damageRate = Math.max(0, parameters?.auraDamageRate ?? 0);
        if (!(radius > 0) || !(seconds > 0) || !(damageRate > 0)) {
            //  诊断④-a：三个必需参数里哪个是 0。这条一打出来就说明「走得到施法函数、但表没配上」。
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`selfaura-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 自身光环（${profile.name}）参数不全：`
                    + `radius=${radius}（表值 ${parameters?.auraRadius ?? 'undefined'}）`
                    + ` seconds=${seconds} damageRate=${damageRate} ⇒ 不开区域、不消费 CD`);
            }
            return false;
        }

        //  暴击 / 克制按**开光环那一刻**的当前目标算一次，之后每一波都吃同一个数 ——
        //  与 `castFanSkill` / `attackProfile.damageRate` 的区域伤害同源（区域只存
        //  `damage` 一个标量，逐波重算暴击会让「同一片光环」一会儿暴一会儿不暴）。
        const target = context.currentTarget(unit);
        const targetOwner = target ? this.targetOwner(state, target, context) : unit.owner;
        const targetCardId = target?.cardId ?? null;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const damage = Math.round(
            this.unitDamage(context, unit, targetOwner, targetCardId, damageRate) * criticalMultiplier);
        const counterMultiplier = target
            ? cardCounterMultiplier(
                this.cardById(context, unit.owner, unit.cardId),
                target.cardId ? this.cardById(context, this.targetOwner(state, target, context), target.cardId) : undefined,
                context.counters)
            : 1;
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        //  波数向下取整再加一：`auraSeconds = 4` / `interval = 1` ⇒ 4 波（立刻一波 + 3 波），
        //  最后一波正好落在到期那一拍；留 `1e-6` 吸收 6 / 1 = 6.000000000000001 这类浮点误差。
        const waves = Math.max(1, Math.round(seconds / interval + 1e-6));
        const origin = context.unitPosition(unit);
        //  「身前 N px」出生点（2026-11-11 磁电菇「磁电冲击」101604「在身前 1px 的位置」）：
        //  沿本体**美术朝向**前移，与区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
        //  缺省 0 ⇒ 就是本体脚下，无尘禁土（102503）行为逐字不变。
        const forward = Math.max(0, parameters?.auraForward ?? 0) * context.rules.combatDistanceScale;
        //  「终点朝向目标方向」（2026-11-11 磁电冲击 101604 第二轮）：
        //  开了 `auraFaceTarget` 就用「本体 → 当前目标」的方位角，**出生点偏移也用同一个角** ——
        //  两者必须同源，否则区域会沿本体朝向飘出去、矩形却朝目标，中心对不上。
        //  没有目标 / 上下文不给位置 ⇒ 回落到本体美术朝向（与改前逐字一致）。
        const faceTarget = (parameters?.auraFaceTarget ?? 0) > 0;
        //  `ZCCombatTarget` 自带 `x / y`（与 `unitPosition` 同一套世界坐标），不用再查单位表。
        const targetPos = faceTarget && target ? { x: target.x, y: target.y } : null;
        const aimRadians = targetPos && (targetPos.x !== origin.x || targetPos.y !== origin.y)
            ? Math.atan2(targetPos.y - origin.y, targetPos.x - origin.x)
            : unit.facingRadians;
        const spawnX = forward > 0 ? origin.x + Math.cos(aimRadians) * forward : origin.x;
        const spawnY = forward > 0 ? origin.y + Math.sin(aimRadians) * forward : origin.y;
        //  区域朝向（度）：只有真的「朝目标」才写，否则保持缺省 0° ⇒ 既有区域一个字节都不变。
        const angleDegrees = targetPos ? aimRadians * 180 / Math.PI : undefined;
        //  表现的竖直抬升（屏上 px）：「起始位置要在角色的中心点」，单位根节点是逻辑脚点，
        //  不抬的话光束有一半埋在地面线以下。缺省 0 ⇒ 既有区域一律不抬。
        const visualLiftPx = Math.max(0, parameters?.auraVisualLiftPx ?? 0);
        //  是否跟随本体（缺省 1 = 跟随，与无尘禁土一致）。冲击波是**站桩**的，配 0。
        //  2026-11-12 磁电冲击改成「跟随角色一起移动、固定在角色身前」⇒ 配 1。
        const follow = (parameters?.auraFollow ?? 1) > 0;
        //  跟随落点保持的身前距离：直接复用 `auraForward` —— 「出生时在身前 N px」与
        //  「之后一直悬在身前 N px」本来就是同一个数，没必要再开一个口径让两者能配歪。
        //  `auraForward` 缺省 0 ⇒ 圆心跳回本体，与无尘禁土逐字一致。
        const followForward = follow && forward > 0 ? forward : 0;
        //  每波目标上限（磁电冲击「最多对范围内 5 个敌人」）。缺省 0 ⇒ 不限。
        const waveMaxTargets = Math.max(0, Math.round(parameters?.auraWaveMaxTargets ?? 0));
        //  施法者在此期间「跳起来」的高度（屏上 px，只抬美术根节点，不动坐标）。
        //  麻辣铁锅「喷射火焰」102603：「播放攻击动画时，角色上移 30px…角色在空中循环播放攻击动作」。
        //  挂在区域上 ⇒ 与光环同生共死，不需要另设到期清理。缺省 0 ⇒ 任何既有光环都不抬。
        const casterLiftPx = Math.max(0, parameters?.casterLiftPx ?? 0);
        //  矩形判定（2026-11-11 磁电冲击 101604 「把判定改成长方形，尽可能贴合特效范围」）：
        //  `auraRectHalfHeight > 0` 才启用；半长缺省跟随半径（长度仍由 auraRadius 三档驱动）。
        //  两者都是**表值逻辑 px**，与 `auraRadius` 同一套口径 ⇒ 一起乘 `combatDistanceScale`。
        const rectHalfHeight = Math.max(0, parameters?.auraRectHalfHeight ?? 0)
            * context.rules.combatDistanceScale;
        const rectHalfLength = rectHalfHeight > 0
            ? Math.max(0, parameters?.auraRectHalfLength ?? 0) * context.rules.combatDistanceScale || radius
            : 0;
        state.groundZones.push({
            x: spawnX,
            y: spawnY,
            radius,
            owner: unit.owner,
            sourceUnitId: unit.id,
            //  `skillName` 只能取普攻行的名字：`skillParamJson` 只有数值槽，装不下字符串
            //  （同 `ZCGroundZoneSystem` 里 `ZONE_APPROACH_ANIMATION` 那条注释的理由）。
            //  它只服务事件日志/调试，不参与任何结算。
            skillId: profile.skillId,
            skillName: profile.name,
            effectPrefabPath: zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, unit.unitId)
                ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH,
            //  必须给**上限**而不是 `Number.POSITIVE_INFINITY`：`remainingSeconds` 会进快照，
            //  非有限值过不了 `ZCSnapshotCodec` 的数值校验。
            remainingSeconds: seconds,
            wavesLeft: waves,
            nextWaveAt: state.elapsedSeconds,
            waveInterval: interval,
            damage,
            floatTextKind,
            slowRatio: 0,
            //  整段持有一条长效表现事件：光环是一根**持续燃着**的光柱，不是每波闪一次。
            //  同时让 `syncHoldVisual` 每帧把事件挪到区域当前位置 ⇒ 视觉跟着本体走。
            holdVisual: true,
            growSeconds: 0.2,
            followUnitId: follow ? unit.id : undefined,
            followForward: followForward > 0 ? followForward : undefined,
            waveMaxTargets: waveMaxTargets > 0 ? waveMaxTargets : undefined,
            casterLiftPx: casterLiftPx > 0 ? casterLiftPx : undefined,
            rectHalfLength: rectHalfLength > 0 ? rectHalfLength : undefined,
            rectHalfHeight: rectHalfHeight > 0 ? rectHalfHeight : undefined,
            angleDegrees,
            visualLiftPx: visualLiftPx > 0 ? visualLiftPx : undefined,
        });
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 在 (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)})`
                + ` 开出【${profile.name}】：半径 ${radius.toFixed(1)} 世界px（表值 ${parameters?.auraRadius}）`
                + (rectHalfHeight > 0
                    ? `，矩形判定 ${(rectHalfLength * 2).toFixed(1)}×${(rectHalfHeight * 2).toFixed(1)} 世界px`
                    : '')
                + `，${seconds}s × 每 ${interval}s = ${waves} 波，单跳 ${damage}，`
                + (follow
                    ? (followForward > 0 ? `跟随本体 #${unit.id}、身前 ${followForward.toFixed(1)} 世界px` : `跟随本体 #${unit.id}`)
                    : '站桩（不跟随本体）'));
        }
        return true;
    }

    /**
     * 落雷连线（2026-11-11 磁电菇「五雷轰顶」101603）。
     *
     * 需求原文：「在目标的坐标直接释放 1 道雷电，并以该目标所在的坐标**背朝向**，额外释放 2/3/4 道闪电
     * （每道闪电间隔 30px），闪电出现间隔 0.1s，每道闪电的伤害判定在特效的第 5 帧，每个级别的伤害分别是
     * 160%/200%/250%，并且有 30% 的概率造成敌人进入【麻痹状态】」。
     *
     * 实现方式刻意**不新增系统**：每道雷 = 一个「一波」地面区域。
     * - 视觉：落点自己推一条 `area` 事件（在**出现**那一刻播，所以能看出 0.1s 的逐道闪烁）；
     * - 结算：区域的首波延迟到 `boltDelay`（≈特效第 5 帧）才触发，由 `ZCGroundZoneSystem` 照常
     *   结伤 + 吸血 + 飘字 + 命中挂状态，`wavesLeft = 1` 打完即散；
     * - 之所以不直接在这里 `damageUnit`：那样就没有「第 5 帧判伤」这回事了，而且会绕开
     *   区域系统已有的护盾/减伤/死亡结算与表现事件。
     *
     * 参数（`skillParamJson`，**距离全部是表值 px**，内部乘 `combatDistanceScale`）：
     *   `boltCount`        总道数（3/4/5，含主雷）
     *   `boltSpacing`      相邻落点间距（30）
     *   `boltInterval`     逐道出现的间隔秒（0.1）
     *   `boltDelay`        出现 → 判伤的延迟秒（0.15，≈第 5 帧 @30fps）
     *   `boltDamageRate`   每道雷相对面板的倍率（1.6/2.0/2.5）
     *   `boltRadius`       每道雷的判定半径（表值 px）
     *   `boltNumbChance`   每个被打到的敌人进入麻痹的概率（0.3）
     *   `boltNumbSeconds`  麻痹持续秒数
     *
     * 返回 `true` = 真的放出去了（调用方才消费 CD）；没有目标 / 参数不全 ⇒ `false`。
     */
    static castBoltLine(state: ZCSnapshot, unit: ZCUnitState,
        context: IZCAttackResolutionContext): boolean {
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const parameters = context.skillRuntime[unit.owner]
            .get(`${unit.unitId}:${profile.skillId}`)?.parameters;
        const count = Math.max(0, Math.round(parameters?.boltCount ?? 0));
        const damageRate = Math.max(0, parameters?.boltDamageRate ?? 0);
        const radiusTable = Math.max(0, parameters?.boltRadius ?? 0);
        if (!(count >= 1) || !(damageRate > 0) || !(radiusTable > 0)) {
            if (zcSkillCastWatched(unit.unitId)) {
                skillCastLogChanging(`bolt-params:${unit.id}`, '施法',
                    `${unit.unitId}#${unit.id} 五雷轰顶参数不全：count=${count} damageRate=${damageRate}`
                    + ` radius=${radiusTable} ⇒ 不放雷、不消费 CD`);
            }
            return false;
        }
        const target = context.currentTarget(unit);
        if (!target) return false;
        const scale = context.rules.combatDistanceScale;
        const radius = radiusTable * scale;
        const spacing = Math.max(0, parameters?.boltSpacing ?? 0) * scale;
        const interval = Math.max(0.02, parameters?.boltInterval ?? 0.1);
        const delay = Math.max(0, parameters?.boltDelay ?? 0.15);
        const numbChance = Math.max(0, Math.min(1, parameters?.boltNumbChance ?? 0));
        const numbSeconds = Math.max(0, parameters?.boltNumbSeconds ?? 0);
        const origin = context.unitPosition(unit);
        //  「背朝向」= 从施法者指向目标的方向继续往后排。目标与本体几乎重合时方向没有意义，
        //  退回美术朝向（与 `castFanSkill` 的 `heading` 同一条兜底）。
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const length = Math.hypot(dx, dy);
        const dirX = length > 1e-6 ? dx / length : Math.cos(unit.facingRadians);
        const dirY = length > 1e-6 ? dy / length : Math.sin(unit.facingRadians);
        //  暴击 / 克制按**出手那一刻**的目标算一次，之后每道雷共用 —— 与光环 / 扇形同口径
        //  （同一轮技能里一会儿暴一会儿不暴只会让飘字抖）。
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const counterMultiplier = cardCounterMultiplier(
            this.cardById(context, unit.owner, unit.cardId),
            target.cardId ? this.cardById(context, this.targetOwner(state, target, context), target.cardId) : undefined,
            context.counters,
        );
        const damage = Math.round(this.unitDamage(context, unit,
            this.targetOwner(state, target, context), target.cardId, damageRate) * criticalMultiplier);
        const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
        for (let index = 0; index < count; index += 1) {
            const x = target.x + dirX * spacing * index;
            const y = target.y + dirY * spacing * index;
            const waveAt = state.elapsedSeconds + index * interval + delay;
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: target.kind === 'unit' ? target.id : null,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: ZC_BOLT_EFFECT_PREFAB_PATH,
                fromX: x,
                fromY: y,
                toX: x,
                toY: y,
                radius,
                damage,
                //  与 `castFanSkill` 同一条口径：这是「技能出手」而不是普攻强化，
                //  `empowered` 只影响表现层的强化标识。
                empowered: false,
                startedAt: state.elapsedSeconds + index * interval,
                //  必须**活够整段动画**：`ZCGameModel` 按 `startedAt + durationSeconds` 剔除事件，
                //  短一截就会在「雷尾消散」那几帧之前把节点摘掉。动画总长见 `ZC_BOLT_EFFECT_SECONDS`
                //  （20 帧 @ sample 30 = 0.667s），再加上出现 → 判伤的前摇。
                durationSeconds: delay + ZC_BOLT_EFFECT_SECONDS,
            });
            state.groundZones.push({
                x, y, radius,
                owner: unit.owner,
                sourceUnitId: unit.id,
                skillId: profile.skillId,
                skillName: profile.name,
                //  视觉已经由上面那条事件负责 ⇒ 区域**不再**逐波推自己的 event。
                effectPrefabPath: null,
                //  必须活到这一道雷结算完：首波在 `waveAt`，之后留 0.3s 收尾。
                remainingSeconds: index * interval + delay + 0.3,
                wavesLeft: 1,
                nextWaveAt: waveAt,
                waveInterval: interval,
                damage,
                floatTextKind,
                slowRatio: 0,
                //  麻痹：每个被打到的敌人各自掷 30%（在区域的波次结算里判）。
                hitStatusId: numbChance > 0 ? ZC_BOLT_NUMB_STATUS_ID : undefined,
                hitStatusChance: numbChance > 0 ? numbChance : undefined,
                hitStatusSeconds: numbSeconds > 0 ? numbSeconds : undefined,
            });
        }
        if (zcSkillCastWatched(unit.unitId)) {
            skillCastLog('施法', `${unit.unitId}#${unit.id} 放【五雷轰顶】：${count} 道，`
                + `间距 ${spacing.toFixed(1)}（表值 ${parameters?.boltSpacing}）`
                + `，逐道 ${interval}s、延迟 ${delay}s 判伤，单道 ${damage}`
                + `，麻痹 ${(numbChance * 100).toFixed(0)}% / ${numbSeconds}s`);
        }
        return true;
    }

    /**
     * 多点打击（2026-10-30「戈壁狂箭」100804、「追踪导弹」101003）。
     *
     * 为什么单开一条而不是走副轨扇形：这两条要的是「在半径里挑 N 个人各打一发」，
     * 扇形是按**朝向 + 夹角**筛人，落在身后/侧面的目标打不到；而追加第三个出手槽
     * 又会把「一条普攻行只有一强化 + 一副轨」的结构假设打散。所以它由
     * `ZCSkillTriggerSystem.applyRandomStrike` 按自己的 CD 调进来，只负责「挑人 + 结算」。
     *
     * 参数（由调用方从 `skillParamJson` 换算好，这里**全部是世界坐标口径**）：
     *   `count`      这一次最多打几个（目标不足时按实际数量）
     *   `radius`     挑选半径
     *   `damageRate` 每发相对面板的倍率
     *   `nearest`    true = 就近优先（追踪导弹）；false = 随机（戈壁狂箭的「随机选取」）
     *   `splashRadius` / `splashDamageRate` 落点溅射（0 = 不溅射）
     *   `statusId`   命中挂的状态（缺省不挂）
     *
     * 返回实际打中的个数；0 ⇒ 这一帧没有合法目标，调用方**不要**消费 CD。
     */
    static strikeTargets(state: ZCSnapshot, unit: ZCUnitState, options: IZCStrikeOptions,
        context: IZCAttackResolutionContext): number {
        const count = Math.max(1, Math.round(options.count));
        const radius = Math.max(1, options.radius);
        const origin = options.origin ?? context.unitPosition(unit);
        const candidates: { unit: ZCUnitState; distance: number }[] = [];
        for (const candidate of state.units) {
            if (candidate.owner === unit.owner || candidate.battleState === 'dead' || candidate.hp <= 0) continue;
            const pos = context.unitPosition(candidate);
            const distance = Math.hypot(pos.x - origin.x, pos.y - origin.y);
            if (distance > radius) continue;
            candidates.push({ unit: candidate, distance });
        }
        if (!candidates.length) return 0;
        if (options.nearest) candidates.sort((a, b) => a.distance - b.distance);
        else {
            //  Fisher-Yates：只洗前 `count` 个就够，用 `context.random` 保证回放可重演。
            for (let index = 0; index < Math.min(count, candidates.length); index += 1) {
                const pick = index + Math.floor(context.random() * (candidates.length - index));
                const swap = candidates[index];
                candidates[index] = candidates[Math.min(pick, candidates.length - 1)];
                candidates[Math.min(pick, candidates.length - 1)] = swap;
            }
        }
        const victims = candidates.slice(0, count);
        const profile = context.effectiveDefinition(unit).attackProfile;
        const splashRadius = Math.max(0, options.splashRadius ?? 0);
        const splashRate = Math.max(0, options.splashDamageRate ?? 0);
        const criticalMultiplier = this.criticalMultiplier(unit, context);

        //  ── 追踪导弹：挑到人就发「会飞过去的弹体」，不在这里立即扣血 ──
        //  需求 2026-11-03：「触发技能发射出 3 个技能特效，每个特效瞄准一个目标，
        //  特效呈弧线飞向目标（3 条不同的弧线），中途触碰到任意目标都会造成 1 次伤害并停止飞行，
        //  到达目标的坐标也会停止飞行，停止飞行后播放爆炸特效」。
        //  弹体直线飞向各自目标（碰撞扫掠天然覆盖"中途碰到谁"），弧线只作用在视觉上
        //  （`arcOffset` 由视图层施加），这样「直线扫掠碰撞」这条既有硬逻辑一行都不用改。
        if (options.missilePrefabPath) {
            let fired = 0;
            //  导弹优先用自己的速度；没登记才退回普攻弹速。
            const speed = options.missileSpeed ?? (profile.projectileSpeed || 500);
            //  ── 恒定发数（2026-11-05「不符合技能设计恒定是 3 个」）──
            //  配表 101003 三档 `strikeCount` 是 3/4/5，但技能口径是「每次恒定 3 颗」。
            //  钳在**这里**：这是唯一知道"最后推了几颗弹体"的地方，调用方只报一个上限。
            //  ⇒ 目标不足时仍然按实际数量发（不会对同一个目标补发凑数），多出来的绝不多发。
            const volley = options.missileCount == null
                ? victims
                : candidates.slice(0, Math.max(1, Math.round(options.missileCount)));
            for (let index = 0; index < volley.length; index += 1) {
                const { unit: victim } = volley[index];
                const point = context.unitPosition(victim);
                const from = context.unitPosition(unit);
                const dx = point.x - from.x;
                const dy = point.y - from.y;
                const length = Math.hypot(dx, dy);
                //  三条不同的弧线：偏移量随下标错开（0 / ±arcOffset），方向也交替正负。
                const arc = options.arcOffset ?? 0;
                const sign = index % 2 === 0 ? 1 : -1;
                const arcOffset = arc > 0 ? arc * sign * (0.5 + 0.5 * (index % 2)) : 0;
                const heading = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
                context.pushProjectile({
                    id: state.nextCombatEventId++,
                    type: 'projectile',
                    owner: unit.owner,
                    sourceUnitId: unit.id,
                    targetUnitId: victim.id,
                    skillId: profile.skillId,
                    skillName: profile.name,
                    effectKey: null,
                    projectileKey: null,
                    effectPrefabPath: options.missilePrefabPath,
                    fromX: from.x,
                    fromY: from.y,
                    toX: point.x,
                    toY: point.y,
                    radius: 0,
                    damage: 0,
                    empowered: false,
                    startedAt: state.elapsedSeconds,
                    //  打空续飞（2026-11-09）：寿命取「目标距离 + `ZC_PROJECTILE_MISS_DISTANCE`」，
                    //  没命中就沿这条方向飞完再消失，不再在目标的落点上凭空截断。
                    durationSeconds: ZCCombatSystem.attackTravelSeconds(
                        ZCCombatEventType.Projectile, length, speed, ZC_PROJECTILE_MISS_DISTANCE),
                    targetKind: 'unit',
                    targetId: victim.id,
                    sourceCardId: unit.cardId,
                    baseDamage: this.unitDamage(context, unit, victim.owner, victim.cardId, options.damageRate),
                    x: from.x,
                    y: from.y,
                    previousX: from.x,
                    previousY: from.y,
                    velocityX: Math.cos(heading) * speed,
                    velocityY: Math.sin(heading) * speed,
                    collisionRadius: (profile.collisionRadius ?? 3) * context.rules.combatDistanceScale,
                    canHitAir: context.effectiveDefinition(unit).canAttackAir,
                    remainingPierces: 0,
                    hitUnitIds: [],
                    splashRadius: splashRadius > 0 ? splashRadius : undefined,
                    splashDamageRate: splashRate > 0 ? splashRate : undefined,
                    impactEffectPrefabPath: options.impactPrefabPath ?? null,
                    arcOffset,
                });
                fired += 1;
            }
            //  诊断③：弹体真的推进 `state.projectiles` 了吗（视图侧只认这个队列）。
            missileLog('模型', `导弹分支已推进 ${fired} 个弹体`
                + `（候选 ${candidates.length} / 本次上限 ${volley.length}，`
                + `配表 count=${count}，恒定发数=${options.missileCount ?? '未登记'}，`
                + `弧线偏移基准 ${(options.arcOffset ?? 0).toFixed(1)}，速度 ${speed}）`);
            return fired;
        }

        let hits = 0;
        for (const { unit: victim } of victims) {
            const targetOwner = victim.owner;
            const damage = Math.round(this.unitDamage(context, unit, targetOwner, victim.cardId, options.damageRate)
                * criticalMultiplier);
            const counterMultiplier = cardCounterMultiplier(
                this.cardById(context, unit.owner, unit.cardId),
                victim.cardId ? this.cardById(context, targetOwner, victim.cardId) : undefined,
                context.counters,
            );
            const floatTextKind = damageFloatTextKind(criticalMultiplier > 1, counterMultiplier);
            const point = context.unitPosition(victim);
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: ZCCombatEventType.Area,
                owner: unit.owner,
                sourceUnitId: unit.id,
                targetUnitId: victim.id,
                skillId: profile.skillId,
                skillName: profile.name,
                effectKey: profile.effectKey ?? null,
                projectileKey: null,
                //  表现沿用本卡普攻的特效预制（专属特效尚未制作）；坐标落在被打的那个目标身上，
                //  所以「落点」是对的，只是图不是专属的。
                effectPrefabPath: profile.effectPrefabPath ?? null,
                fromX: point.x,
                fromY: point.y,
                toX: point.x,
                toY: point.y,
                radius: Math.max(1, splashRadius),
                damage,
                empowered: false,
                startedAt: state.elapsedSeconds,
                durationSeconds: 0.3,
            });
            const hitText = context.damageUnit(victim, damage, {
                owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
            });
            if (!hitText) continue;
            hits += 1;
            this.applyLifesteal(unit, hitText, context);
            context.tryExecuteUnit(victim, undefined, unit.owner, unit.id, hitText);
            if (options.statusId) context.applyHitStatus(victim, options.statusId, unit.id);
            if (!(splashRadius > 0) || !(splashRate > 0)) continue;
            const splashDamage = Math.max(1, Math.round(damage * splashRate));
            for (const bystander of state.units) {
                if (bystander === victim || bystander.owner === unit.owner) continue;
                if (bystander.battleState === 'dead' || bystander.hp <= 0) continue;
                const pos = context.unitPosition(bystander);
                if (Math.hypot(pos.x - point.x, pos.y - point.y) > splashRadius) continue;
                context.damageUnit(bystander, splashDamage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
                });
            }
        }
        return hits;
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

    /**
     * 只给施法者自己套盾，并登记到期时刻（2026-10-29，亡者护盾）。
     *
     * 与 `applyShieldAura` 分开：那个是「全队光环盾」，这个是单体且**会过期**。
     * `seconds <= 0` ⇒ 不写 `shieldExpireAt`，等价于永不过期（与旧护盾语义一致）。
     */
    static applySelfShield(state: ZCSnapshot, source: ZCUnitState, ratio: number, seconds: number): void {
        const normalized = Math.max(0, Math.min(5, ratio));
        if (normalized <= 0) return;
        source.shield = Math.max(source.shield ?? 0, source.maxHp * normalized);
        if (seconds > 0) source.shieldExpireAt = state.elapsedSeconds + seconds;
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

    /**
     * 命中挂状态是否落在本次节拍上（2026-10-30，火焰树妖「点燃」）。
     *
     * `pvpSkillPlan.skillParamJson.statusEveryNAttacks = N` ⇒ 每 N 次普攻命中、「第 N 次」才挂状态。
     * 计数用 `unit.completedAttackCount` —— 它由 `ZCCombatSystem.consumeEmpoweredAttack` 在每次出手时
     * **先自增再判定**，所以第 N 次出手时该值恰为 N，`count % N === 0` 即命中。
     *
     * 缺省 0 / 负数 / 非有限值一律返回 true（每次都挂），保证既有表数据零影响。
     */
    private static hitStatusOnBeat(
        runtime: ZCSkillRuntimeDefinition | undefined,
        unit: ZCUnitState,
    ): boolean {
        const every = runtime?.parameters.statusEveryNAttacks ?? 0;
        if (!(every > 0)) return true;
        const count = unit.completedAttackCount ?? 0;
        return count > 0 && count % every === 0;
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
        //  「这一击固定发几颗」的显式声明（`skillParamJson.projectileCount`，只服务强化那一击）。
        //  与 `bulletNum`（普攻被动「多打 N 发」）是两种语义，必须分开记：
        //  麻辣铁锅 102601 给 `bulletNum +2`、102604 要求「凤凰降临固定 4 颗」，
        //  两者叠在一起会变成 6 颗。所以**声明了固定颗数时不再叠加 `bulletNum`**。
        //  ⚠️ 现有计划行一条都没用过这个键（全表 grep 无命中）⇒ 存量单位行为逐字不变。
        const declaredProjectileCount = empowered
            ? Math.max(0, Math.round(skillRuntime?.parameters.projectileCount ?? 0))
            : 0;
        let projectileCount = declaredProjectileCount > 0 ? declaredProjectileCount : 1;
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        //  unit 域伤害倍率（`pvpSkillPlan.statId = damageRate`）：弹道走 `unitDamageBase`、
        //  近战/区域走本类的 `unitDamage`，两处各自乘以同一个系数，口径一致。缺省 0 ⇒ 1。
        const damageRateMultiplier = Math.max(0, 1 + (patch.damageRatePct ?? 0) / 100);
        // 技能伤害倍率：强化那一击读**武将技行**（36xxx）的 `damageRate`，普通普攻读**普攻行**（301xx）的。
        // 两行各带自己的倍率（表里普攻行一律留空 = 1），所以这里按 `empowered` 二选一；
        // 技能行是 `empoweredSkillId` 指过去的独立 profile，`definition.empoweredProfile` 就是它。
        // 「本次生效 profile」：强化那一击的表现层（mode / 弹道速度 / 半径 / 碰撞半径）一律取
        // 武将技行（36xxx），不再沿用普攻行（301xx）。否则冰法师普攻是 projectile、武将技冰雕
        // 是 area，强化触发时会把冰雕当成投射物从法师位置飞到目标点 —— 冰雕应在目标点就地生成。
        const activeProfile = (empowered && definition.empoweredProfile) ? definition.empoweredProfile : profile;
        //  命中挂状态的**节拍闸门**（2026-10-30 火焰树妖「点燃」：每 3 次普攻的第 3 次才附带）。
        //  闸门盖住的是「本次出手挂不挂状态」整件事，所以 `skillRuntime.statusId`（计划行声明）
        //  与 `activeProfile.onHitStatusId`（普攻行自带）**同进同出** —— 老表两者互斥使用，
        //  不存在「一个被节拍管、另一个不管」的组合。
        //  没配 `statusEveryNAttacks`（缺省 0）时恒为 true，所有既有表数据行为与改动前逐字一致。
        const onHitStatusId = this.hitStatusOnBeat(skillRuntime, unit)
            ? (skillRuntime?.statusId ?? activeProfile.onHitStatusId)
            : undefined;
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
        //  「显式固定颗数」的那一击不叠（见上面 `declaredProjectileCount` 的注释）。
        if (patch.bulletNumFlat && declaredProjectileCount <= 0) {
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
        //  事件寿命（**纯表现**）：登记了飞行段的近战特效按「距离 / 速度」算，
        //  否则沿用固定 0.32s。伤害不在这里结算 —— 见下面 `state.combatEvents.push(event)`
        //  之后紧接着的 `context.damageUnit(...)`，所以改它不影响任何数值。
        //  需求 2026-11-02「猎头者的攻击特效需要匹配射程」（`ZCCombatEffectFlight`）。
        const travelSeconds = zcCombatEffectTravelSeconds(
            activeProfile.mode,
            distance(from.x, from.y, target.x, target.y),
            activeProfile.projectileSpeed,
            activeProfile.effectPrefabPath,
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
        //  镭射死光（30845）：表现终点沿目标方向 18 格（756 逻辑单位），
        //  弹道寿命也按 18 格 / 速度 算，确保射线穿透所有敌人并飞到屏幕外。
        const LASER_DEATH_RANGE = 18 * 42;
        if (profile.skillId === 30845) {
            const dx = target.x - from.x;
            const dy = target.y - from.y;
            const len = Math.hypot(dx, dy);
            const nx = len > 0 ? dx / len : Math.cos(unit.facingRadians);
            const ny = len > 0 ? dy / len : Math.sin(unit.facingRadians);
            event.toX = from.x + nx * LASER_DEATH_RANGE;
            event.toY = from.y + ny * LASER_DEATH_RANGE;
            event.durationSeconds = LASER_DEATH_RANGE / (activeProfile.projectileSpeed || 500);
        }
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
        //  单体护盾（亡者护盾）：只罩自己、且带到期时刻。与上面的 `shieldRatio`（全队光环盾）
        //  是两个互不影响的参数，缺省 0 ⇒ 整段不执行。
        if (empowered && parameters && parameters.selfShieldRatio > 0) {
            this.applySelfShield(state, unit, parameters.selfShieldRatio, parameters.shieldSeconds ?? 0);
        }
        //  连发（豌豆机关枪）：empowered 这一击只打第一颗，余下的按固定间隔排进单位状态，
        //  由 `ZCSkillTriggerSystem` 每步推进。`burstCount` 缺省 1 ⇒ 整段不执行，
        //  原有的「一发 / 多发齐射」路径逐字不变。
        const burstCount = empowered ? Math.max(1, Math.round(parameters?.burstCount ?? 1)) : 1;
        if (burstCount > 1 && activeProfile.mode === ZCCombatEventType.Projectile) {
            const burstSeconds = Math.max(0.05, parameters?.burstSeconds ?? 1.2);
            unit.burstShotsLeft = burstCount - 1;
            unit.burstInterval = Math.max(0.01, burstSeconds / Math.max(1, burstCount - 1));
            unit.burstNextAt = state.elapsedSeconds + unit.burstInterval;
            unit.burstDamageRate = parameters?.damageRate ?? activeProfile.damageRate ?? 1;
            projectileCount = 1;
        }
        if (activeProfile.mode === 'projectile') {
            const dx = target.x - from.x, dy = target.y - from.y;
            const length = Math.hypot(dx, dy);
            const speed = activeProfile.projectileSpeed || 500;
            //  固定弹道寿命（2026-11-09 大威芦「天降神拳」102504：子弹 100px/s、**持续 4 秒**）。
            //  `event.durationSeconds` 对 projectile 恒为「距离 / 速度」——射程跟着目标远近变，
            //  表达不了「不管打多远都飞 4 秒」。这里让 `skillParamJson.projectileLifeSeconds`
            //  直接接管寿命：位移 = 速度 × 寿命，与目标站位无关。
            //  缺省/0 ⇒ 沿用 `travelSeconds`，既有弹道（含镭射死光自己那条 18 格硬编码）逐字不变。
            //  ⚠️ 必须 `empowered` 才读：技能计划行是按 `unitId:pvpSkillId` 合并的，102504 的
            //  `skillParamJson` 和本卡普攻共用同一份 runtime —— 不设闸门的话，普攻那一发也会
            //  被改成 4 秒寿命（与 `pierceCount` 同一个理由，两者都只服务「强化那一击」）。
            const lifeSeconds = empowered
                ? Math.max(0, parameters?.projectileLifeSeconds ?? 0)
                : 0;
            //  打空续飞（2026-11-09）：`event.durationSeconds` 是「到目标的飞行时长」，
            //  再加一段「飞过目标也不消失」的余程 —— 命中即消耗，所以这段只在没打中时走。
            //  `projectileLifeSeconds`（固定寿命的技能）仍然优先，不受这条影响。
            const projectileSeconds = lifeSeconds > 0
                ? lifeSeconds
                : event.durationSeconds + ZC_PROJECTILE_MISS_DISTANCE / speed;
            const bonuses = context.deckBonuses[unit.owner];
            //  命中后爆炸（2026-11-11 麻辣铁锅「凤凰降临」102604）。
            //
            //  与 `splashRadius` / `splashDamageRate` 是两件事，不能复用那一对：
            //    · 溅射**不打主目标**，而且只在 `!empowered` 时读（见下面 push 里的三元）；
            //    · 爆炸要**把包括主目标在内的所有人**各打一次，并且强度只在强化那一击出现。
            //  所以另开一组 `impactBurst*` 键，缺省全 0 ⇒ 整段不执行，任何存量弹道逐字不变。
            //
            //  伤害基数按 `unitDamageBase` 算（**不含克制**）：克制系数是逐个受击者算的，
            //  存进弹道里的必须是一个中性值，否则带主目标的克制关系去炸别人就会算错。
            //  与 `baseDamage` / `splashDamage` 同一条口径。
            const burstRadius = (empowered ? Math.max(0, parameters?.impactBurstRadius ?? 0) : 0)
                * context.rules.combatDistanceScale;
            const burstRate = empowered ? Math.max(0, parameters?.impactBurstDamageRate ?? 0) : 0;
            const burstBase = burstRadius > 0 && burstRate > 0
                ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstRate)
                    * (unit.attackMultiplier ?? 1) * criticalMultiplier
                : 0;
            const burstSecondRate = empowered ? Math.max(0, parameters?.impactBurstSecondRate ?? 0) : 0;
            const burstSecondBase = burstRadius > 0 && burstSecondRate > 0
                ? ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules, burstSecondRate)
                    * (unit.attackMultiplier ?? 1) * criticalMultiplier
                : 0;
            //  第二段的时间锚点：设计案「爆炸开始后第 26 帧」@30fps ⇒ 25/30 = 0.8333s。
            //  第 N 帧（1 起数）= 下标 N-1，与 `ZCBoltStrikeFx` 的「第 5 帧 ⇒ 4/30」同一条换算。
            const burstSecondDelay = Math.max(0, parameters?.impactBurstSecondDelay ?? 0);
            const burstEffectSeconds = Math.max(0, parameters?.impactBurstEffectSeconds ?? 0);
            const burstImpactPrefab = empowered ? (activeProfile.impactEffectPrefabPath ?? null) : null;
            for (let index = 0; index < projectileCount; index += 1) {
                const projectileEvent = index === 0 ? event : { ...event, id: state.nextCombatEventId++ };
                //  多发扇形展开：只有 `bulletAngle > 0` 时才转方向，缺省仍是全部打同一条直线
                //  （老技能没有任何表数据，行为必须逐字不变）。
                //  `projectileSpreadDeg`（2026-11-11 麻辣铁锅「凤凰降临」102604）是**强化那一击专用**的
                //  张角覆盖：`bulletAngle` 是 unit 域的修改器（`patch.bulletAngleFlat`），同一张卡的
                //  普攻与强化击共用一份，而 102601 要求普攻 20°、102604 要求 4 颗 90° —— 一个槽装不下。
                //  取「强化 + 配了就用它、否则退回 patch」：既有技能一条都没有这个键，行为逐字不变。
                const spreadTable = (empowered ? Math.max(0, parameters?.projectileSpreadDeg ?? 0) : 0)
                    || (patch.bulletAngleFlat ?? 0);
                //  两种张角语义（2026-11-11 第三轮，麻辣铁锅「凤凰降临」）：
                //    · < 360 ⇒ **扇形**：整组子弹摊在 `spreadTable` 这段张角里，第 0 颗偏 -一半、
                //      最后一颗偏 +一半（20° 三连发的既有口径，别动）；
                //    · ≥ 360 ⇒ **全向均分**：等于「向四周各打一发」，相邻两颗差 `360/count`，
                //      第 0 颗仍对准目标。用户口径「4 颗子弹的 4 个方向」= 图例里那四个箭头（十字）。
                //  扇形那套算不出十字：count=4 时 spread 是 -1/-⅓/+⅓/+1，张角 360 会让
                //  首尾两颗都朝背后（-180 与 +180 同向）⇒ 实际只有 3 个方向。必须单独一条分支。
                const fullCircle = spreadTable >= 359.999 && projectileCount > 1;
                const halfSpan = spreadTable > 0 && projectileCount > 1 && !fullCircle
                    ? (spreadTable * Math.PI / 180) / 2
                    : 0;
                const spread = projectileCount > 1 ? (index / (projectileCount - 1)) * 2 - 1 : 0;
                const aim = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
                const heading = fullCircle
                    ? aim + index * (Math.PI * 2 / projectileCount)
                    : aim + spread * halfSpan;
                const dirX = length > 0 || halfSpan > 0 || fullCircle ? Math.cos(heading) : Math.cos(unit.facingRadians);
                const dirY = length > 0 || halfSpan > 0 || fullCircle ? Math.sin(heading) : Math.sin(unit.facingRadians);
                //  🔴 每颗弹道**自己的终点**（2026-11-11 第五轮用户口径：「1 号朝向对，2 号顺时针 90、
                //  3 号 180、4 号 270」）。事件里的 `to` 是所有弹**共用**的目标点，而视图
                //  （`ZCCombatEffectView` 的 projectile 分支）是拿 `to - from` 算转角的 ⇒ 四颗弹体
                //  全部朝同一个方向 —— 飞出去的四颗里只有「正好落在瞄准线上」的那颗看着对，
                //  其余三颗是「侧着飞」。所以这里按各弹自己的 `heading` 把 `to` 沿该方向摊开，
                //  **长度保持 `length` 不变** ⇒ `aimFlightSeconds`（弧线进度）与打空续飞都不受影响。
                //  只在真的散开时改（`halfSpan > 0 || fullCircle`），单发弹道逐字不动。
                const fanned = length > 0 && (halfSpan > 0 || fullCircle);
                const bulletToX = fanned ? from.x + dirX * length : projectileEvent.toX;
                const bulletToY = fanned ? from.y + dirY * length : projectileEvent.toY;
                state.projectiles.push({
                    ...projectileEvent, type: 'projectile', targetKind: target.kind, targetId: target.id,
                    sourceCardId: unit.cardId,
                    toX: bulletToX,
                    toY: bulletToY,
                    baseDamage: legacy.hasDamageFormula
                        ? legacy.damage * criticalMultiplier
                        : ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules,
                            skillDamageRate * damageRateMultiplier)
                            * (unit.attackMultiplier ?? 1) * criticalMultiplier,
                    x: from.x, y: from.y, previousX: from.x, previousY: from.y,
                    velocityX: dirX * speed,
                    velocityY: dirY * speed,
                    //  寿命：`projectileLifeSeconds` 有值时固定、否则沿用 travelSeconds（见上）。
                    durationSeconds: projectileSeconds,
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
                        //  普攻穿透（2026-10-30「穿甲苔刺」100701/100801/103501）：`pierceCount` 原本只服务
                        //  「强化那一击」，被动要求的是「每一次普攻都穿透」。用独立键 `normalPierceCount`
                        //  而不是放宽 `pierceCount`，是为了不动任何既有强化击的口径。
                        : Math.max(0, Math.floor(skillRuntime?.parameters.normalPierceCount ?? 0)),
                    //  每次穿透后的伤害衰减（玉林好汉「精英猎手」：每穿一人 -20%）；
                    //  缺省 0 = 不衰减，既有穿透弹道（火船等）行为逐字不变。
                    pierceFalloff: empowered
                        ? Math.max(0, Math.min(1, skillRuntime?.parameters.pierceFalloff ?? 0))
                        : Math.max(0, Math.min(1, skillRuntime?.parameters.normalPierceFalloff ?? 0)),
                    hitUnitIds: [],
                    executeChance: Math.max(0, Math.min(1,
                        (empowered ? skillRuntime?.parameters.executeChance : undefined)
                        ?? legacy.executeChance ?? 0)),
                    criticalHit,
                    onHitStatusId,
                    legacyBuffs: [...legacyTargetBuffs],
                    //  溅射（2026-10-30「爆囊扩散」100802/100902/103202）：旧 skillEffect 的伤害范围走
                    //  `legacyAreaRadius`（全额溅射）；新被动走参数 `splashRadius`（屏上 px，与攻击距离
                    //  同一套数，乘 `combatDistanceScale`）+ `splashDamageRate`（相对面板的倍率）。
                    //  缺省都没有 ⇒ 整段不执行，存量弹道行为逐字不变。
                    splashRadius: legacyAreaRadius > 0
                        ? legacyAreaRadius
                        : (empowered ? 0 : (skillRuntime?.parameters.splashRadius ?? 0) * context.rules.combatDistanceScale) || undefined,
                    splashDamageRate: legacyAreaRadius > 0
                        ? undefined
                        : (empowered ? undefined : skillRuntime?.parameters.splashDamageRate),
                    //  命中爆炸（见上面 `burstRadius` 那一段）。四项任一为 0 就不写，
                    //  保持「没有这个键」= 存量弹道逐字不变。
                    impactEffectPrefabPath: burstImpactPrefab,
                    burstRadius: burstRadius > 0 ? burstRadius : undefined,
                    burstDamage: burstBase > 0 ? burstBase : undefined,
                    burstSecondDamage: burstSecondBase > 0 ? burstSecondBase : undefined,
                    burstSecondDelay: burstSecondBase > 0 ? burstSecondDelay : undefined,
                    burstEffectSeconds: burstEffectSeconds > 0 ? burstEffectSeconds : undefined,
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
            //  区域技能同样是「一次出手」：命中状态照挂。
            //  不补这一句的话，第 N 次普攻既触发区域、又该附带点燃时，点燃会被这条提前 return 吞掉
            //  （2026-10-30 火焰树妖：每 6 次普攻放灼热地带、每 3 次命中挂点燃，第 6 次两者重合）。
            if (onHitStatusId && target.kind === 'unit') {
                const zoneTarget = context.unitById.get(target.id);
                if (zoneTarget) context.applyHitStatus(zoneTarget, onHitStatusId, unit.id);
            }
            const zoneCount = empowered ? Math.max(1, Math.round(skillRuntime?.parameters.zoneCount ?? 1)) : 1;
            const expireDamage = empowered && skillRuntime?.parameters.expireDamageRate != null
                ? this.unitDamage(context, unit, this.targetOwner(state, target, context), target.cardId, skillRuntime.parameters.expireDamageRate) * criticalMultiplier
                : 0;
            //  会移动的区域（2026-11-04 椰蛋战士「暴风」）：给了 `zoneMoveSpeed` 才走这条口径 ——
            //  从**施法者**出发、朝目标方向扇形抛出、路径上每个敌人只吃一次、命中名额满了提前散。
            //  缺省 0 ⇒ 走下面原地的老分支，暴风雪 / 灼热地带 / 火船行为逐字不变。
            const moveSpeed = empowered ? Math.max(0, skillRuntime?.parameters.zoneMoveSpeed ?? 0) : 0;
            const moving = moveSpeed > 0;
            const mParams = skillRuntime?.parameters;
            const movingDuration = moving ? Math.max(0, mParams?.zoneDuration ?? durationSeconds) : durationSeconds;
            //  移动区域每 0.15s 探一次路（走过敌人就结算），而不是沿用「持续秒数 / 波数」。
            const movingInterval = Math.max(0.05, mParams?.zoneWaveInterval ?? 0.15);
            const movingWaves = Math.max(1, Math.ceil(movingDuration / movingInterval));
            const maxHits = moving ? Math.max(0, Math.round(mParams?.zoneMaxHits ?? 0)) : 0;
            const spawnSpread = Math.max(0, mParams?.zoneSpreadDeg ?? 0) * Math.PI / 180;
            //  移动区域的扇形**中轴**（2026-11-07 椰蛋战士「暴风」需求 3）：
            //  「以椰蛋战士的攻击朝向为法线，3 个飓风夹角为 50°」。
            //  所以基准取 `unit.facingRadians`（美术朝向，`ZCUnitTargeting.face()` 在每次 `startAttack`
            //  时对齐到当前目标），**不是** `atan2(目标 - 自身)`：两者只在"目标在正对角"时相同，
            //  而朝向是玩家眼睛看到的角色正面 —— 三条风要围着它对称张开才不歪。
            //  `zoneSpreadDeg` 是**总夹角**（下面 `fanOffset` 取 ±spread/2），不是"相邻两条的夹角"。
            const axis = moving ? unit.facingRadians : Math.atan2(target.y - from.y, target.x - from.x);
            //  自体中心区域（2026-10-30「斗气爆发」100604 / 「迪斯科旋风」103104 / 「死亡摇滚」103204）：
            //  这类技能的判定是「自身周围」，而区域默认落在**目标点**。给 `zoneSelfCentered = 1`
            //  就改成落在施法者脚下，半径与波次仍按 areaRadius / durationSeconds / waves 走。
            //  缺省 0 ⇒ 仍在目标点，暴风雪 / 灼热地带逐字不变。
            const selfCentered = !moving && (mParams?.zoneSelfCentered ?? 0) > 0;
            //  出生点前移（2026-11-07 鹿神守护需求 1）：「生成位置在魔术师前进方向 15px 处」
            //  （2026-11-12 由 30 改成 15，与「子弹从枪口出来」的观感对齐）。
            //  与攻击距离 / 区域半径同一套表值口径 ⇒ 乘 `combatDistanceScale`。
            const spawnForward = moving
                ? Math.max(0, mParams?.zoneSpawnForward ?? 0) * context.rules.combatDistanceScale
                : 0;
            //  追踪式移动（2026-11-07 鹿神守护需求 2，2026-11-12 改成「会追踪的子弹」）：
            //  给了 `zoneApproachSpeed` 才走「慢档走过去、贴近后提速」，缺省 0 ⇒ 一出生就按
            //  `zoneMoveSpeed` 飞（暴风 / 既有移动区域逐字不变）。
            const approachSpeed = moving
                ? Math.max(0, mParams?.zoneApproachSpeed ?? 0) * context.rules.combatDistanceScale
                : 0;
            const sprintRange = Math.max(0, mParams?.zoneSprintRange ?? 0) * context.rules.combatDistanceScale;
            for (let index = 0; index < zoneCount; index += 1) {
                //  扇形夹角：移动区域的三条围绕 `axis`（攻击朝向）对称张开；
                //  原地多道（迪斯科旋风一类）仍然绕着施法者均分一圈。
                const fanOffset = zoneCount === 1 ? 0 : ((index / (zoneCount - 1)) * 2 - 1) * spawnSpread / 2;
                const angle = moving ? axis + fanOffset
                    : (zoneCount === 1 ? 0 : unit.facingRadians + Math.PI * 2 * index / zoneCount);
                const offset = zoneCount === 1 || moving || selfCentered ? 0 : areaRadius * .45;
                state.groundZones.push({
                    //  移动区域的出生点 = 施法者坐标沿中轴前移 `zoneSpawnForward`
                    //  （「小鹿在魔术师前进方向 30px」）。`zoneSpawnForward` 缺省 0 ⇒ 就是施法者本身。
                    x: moving
                        ? from.x + Math.cos(angle) * spawnForward
                        : (selfCentered ? from.x : target.x + Math.cos(angle) * offset),
                    y: moving
                        ? from.y + Math.sin(angle) * spawnForward
                        : (selfCentered ? from.y : target.y + Math.sin(angle) * offset),
                    radius: areaRadius,
                    owner: unit.owner,
                    sourceUnitId: unit.id,
                    skillId: event.skillId,
                    skillName: event.skillName,
                    effectPrefabPath: event.effectPrefabPath ?? null,
                    remainingSeconds: movingDuration,
                    wavesLeft: moving ? movingWaves : waves,
                    nextWaveAt: state.elapsedSeconds,
                    waveInterval: moving ? movingInterval : waveInterval,
                    damage,
                    floatTextKind,
                    slowRatio,
                    expireDamage,
                    expireStatusId: expireDamage > 0 ? 'freeze' : undefined,
                    expireStatusDuration: Math.max(0, skillRuntime?.parameters.freezeDuration ?? 0),
                    //  表里的 `zoneMoveSpeed` 是「屏上 px/秒」口径，与 attackRange 同一套数，
                    //  和区域半径一样乘 `combatDistanceScale` 换成世界坐标。
                    moveVelocityX: moving ? Math.cos(angle) * moveSpeed * context.rules.combatDistanceScale : undefined,
                    moveVelocityY: moving ? Math.sin(angle) * moveSpeed * context.rules.combatDistanceScale : undefined,
                    hitUnitIds: maxHits > 0 ? [] : undefined,
                    maxHits: maxHits > 0 ? maxHits : undefined,
                    //  逐目标递减（2026-11-06 引入，移动区域的通用能力）：第 k 个被命中的敌人吃
                    //  `damage × (1 - zoneDamageFalloff)^k`，设计口径「每多一个目标减少 50%」就是 0.5。
                    //  缺省 0 ⇒ 不递减，既有移动区域（暴风）行为逐字不变。
                    //  ⚠️ 2026-11-12 起 103405 不再配它：小鹿改成「撞到第一个目标就消失」
                    //  （`zoneMaxHits = 1`），根本没有「第二个目标」可递减。槽位保留给后续技能用。
                    damageFalloff: moving
                        ? Math.max(0, Math.min(1, mParams?.zoneDamageFalloff ?? 0)) || undefined
                        : undefined,
                    //  整段持有视觉（2026-11-07 鹿神守护小鹿冲刺）：给了 `zoneHoldVisual = 1` 才开 ——
                    //  开了以后区域只在创建时推**一条**跟着自己走的长效表现事件，
                    //  不再按波次在每波位置频闪（见 `ZCGroundZoneSystem.syncHoldVisual`）。
                    //  缺省 0 ⇒ 暴风仍是原来的「一串残影」，行为逐字不变。
                    holdVisual: moving && (mParams?.zoneHoldVisual ?? 0) > 0 ? true : undefined,
                    //  入场「由小变大」（2026-11-07 暴风需求 2）：只对整段持有视觉生效 ——
                    //  逐波残影每条只活 0.15s，长不出来。
                    growSeconds: moving
                        ? Math.max(0, mParams?.zoneGrowSeconds ?? 0) || undefined
                        : undefined,
                    //  追踪式移动（2026-11-12 鹿神守护改成「会追踪的子弹」）：慢档走近、贴近后提速。
                    //  `approachSpeed` 是世界 px/秒（表值 × combatDistanceScale），
                    //  `sprintSpeed` 同样 —— 由 `ZCGroundZoneSystem.advanceChase` 每帧写进 `moveVelocity`
                    //  （它会持续转向目标、目标阵亡还会改追最近敌人，所以速度不能锁死在出生朝向）。
                    approachSpeed: approachSpeed > 0 ? approachSpeed : undefined,
                    //  追的目标就是这一击的攻击目标；目标是城墙 / 建筑（没有单位 id）时不给，
                    //  区域会在第一帧自己找最近的敌人再提速。
                    approachTargetId: approachSpeed > 0 && target.kind === 'unit' ? target.id : undefined,
                    sprintRange: approachSpeed > 0 ? sprintRange : undefined,
                    sprintSpeed: approachSpeed > 0 ? moveSpeed * context.rules.combatDistanceScale : undefined,
                    sprinting: approachSpeed > 0 ? false : undefined,
                });
            }
            return;
        }

        state.combatEvents.push(event);
        //  命中附加表现（2026-10-31 运动霸「拳击冲撞」203301 的「气浪」）。
        //  只补一条**表现事件**、不结算任何伤害，所以它与下面那段真正的伤害结算互不干扰。
        //  放在这里而不是结算之后：同一帧起播，「命中」和「气浪」才是同一拍。
        this.pushImpactEffect(state, event, activeProfile);
        if (target.kind === 'unit') {
            const targetUnit = context.unitById.get(target.id) ?? null;
            if (targetUnit) {
                const hitText = context.damageUnit(targetUnit, damage, {
                    owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind,
                });
                this.applyLifesteal(unit, hitText, context);
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
                        owner: unit.owner, kind: 'unit', unitId: unit.id, floatTextKind, ranged: true,
                    });
                    this.applyLifesteal(unit, hitText, context);
                    context.tryExecuteUnit(splash, empowered ? skillRuntime?.parameters.executeChance : undefined,
                        unit.owner, unit.id, hitText);
                    context.applyHitStatus(splash, activeProfile.onHitStatusId, unit.id);
                    context.applyLegacyBuffs(splash, legacyTargetBuffs, unit.id);
                }
            }
        }
    }

    /**
     * 连发的一发（2026-10-29，豌豆机关枪）。
     *
     * 刻意**不复用** `sendAttack`：那条路会推进 `completedAttackCount` / `empoweredReadyAt`、
     * 置 `attackHitDone`、还要重算强化与战技判定 —— 拿它发连发弹会把普攻节拍和 CD 一起打乱。
     * 这里只做「按当前目标丢一颗普通弹道」，其余（命中结算 / 克制 / 暴击 / 命中状态）全部
     * 走既有 `resolveProjectileHit`，所以连发弹与普通弹在命中口径上完全一致。
     */
    static sendBurstShot(state: ZCSnapshot, unit: ZCUnitState, context: IZCAttackResolutionContext): void {
        const target = context.currentTarget(unit);
        if (!target) return;
        const definition = context.effectiveDefinition(unit);
        const profile = definition.attackProfile;
        const skillRuntime = context.skillRuntime[unit.owner].get(`${unit.unitId}:${profile.skillId}`);
        const damageRate = Math.max(0, unit.burstDamageRate ?? 1);
        const criticalMultiplier = this.criticalMultiplier(unit, context);
        const bonuses = context.deckBonuses[unit.owner];
        const from = context.unitPosition(unit);
        const dx = target.x - from.x;
        const dy = target.y - from.y;
        const length = Math.hypot(dx, dy);
        const heading = length > 0 ? Math.atan2(dy, dx) : unit.facingRadians;
        const speed = profile.projectileSpeed || 500;
        const skillId = profile.skillId;
        //  与普通弹道同一口径：`baseDamage` 在出手时定死（含技能倍率与暴击），命中时再乘克制系数。
        //  这份「连发弹」同样要吃到 unit 域伤害倍率（否则同一张卡的两颗子弹伤害不一致）。
        const damageRateMultiplier = Math.max(0, 1 + (this.unitStatPatchOf(unit, context).damageRatePct ?? 0) / 100);
        const baseDamage = ZCCombatSystem.unitDamageBase(unit, definition, bonuses, context.rules,
            damageRate * damageRateMultiplier)
            * (unit.attackMultiplier ?? 1) * criticalMultiplier;
        state.projectiles.push({
            id: state.nextCombatEventId++,
            type: 'projectile',
            owner: unit.owner,
            sourceUnitId: unit.id,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            skillId,
            skillName: profile.name,
            effectKey: profile.effectKey ?? null,
            projectileKey: profile.projectileKey ?? null,
            effectPrefabPath: profile.effectPrefabPath ?? null,
            fromX: from.x,
            fromY: from.y,
            toX: target.x,
            toY: target.y,
            radius: 0,
            damage: Math.round(baseDamage),
            empowered: true,
            startedAt: state.elapsedSeconds,
            durationSeconds: ZCCombatSystem.attackTravelSeconds(
                ZCCombatEventType.Projectile, distance(from.x, from.y, target.x, target.y), speed,
                ZC_PROJECTILE_MISS_DISTANCE),
            targetKind: target.kind,
            targetId: target.id,
            sourceCardId: unit.cardId,
            baseDamage,
            x: from.x, y: from.y, previousX: from.x, previousY: from.y,
            velocityX: Math.cos(heading) * speed,
            velocityY: Math.sin(heading) * speed,
            collisionRadius: (profile.collisionRadius ?? 3) * context.rules.combatDistanceScale,
            canHitAir: definition.canAttackAir,
            zoneDuration: 0,
            zoneWaves: 1,
            zoneSlow: 0,
            remainingPierces: 0,
            hitUnitIds: [],
            executeChance: 0,
            criticalHit: criticalMultiplier > 1,
            onHitStatusId: skillRuntime?.statusId ?? profile.onHitStatusId,
            legacyBuffs: [],
        });
    }

    static resolveProjectileHit(state: ZCSnapshot, projectile: ZCProjectileState, target: ZCCombatTarget,
        context: IZCAttackResolutionContext): void {        const targetOwner = this.targetOwner(state, target, context);
        const multiplier = cardCounterMultiplier(this.cardById(context, projectile.owner, projectile.sourceCardId), target.cardId ? this.cardById(context, targetOwner, target.cardId) : undefined, context.counters);
        const damage = Math.round(projectile.baseDamage * multiplier);
        const floatTextKind = damageFloatTextKind(projectile.criticalHit === true, multiplier);
        //  打墙 / 打建筑只要「归属 + 落点」，受击特效还要**实例 id** 反查攻击方职业
        //  （2026-11-06：结构物受击也要播攻击方职业的闪白）。
        const sender: IZCStructureDamageSource = {
            id: projectile.sourceUnitId, owner: projectile.owner, freeX: projectile.x, freeY: projectile.y,
        };
        //  吸血要回给**真人**（`sender` 只是个用于打墙/打建筑的坐标壳），
        //  投射物离手后施法者可能已经死了 —— 查不到就不回。
        const shooter = context.unitById.get(projectile.sourceUnitId);
        //  连击（`pvpAttrMap.attackCount`，2026-10-13）：一次出手多打几段**额外伤害**。
        //  只加伤害，不重复触发处决 / 状态挂载 / 顿帧 —— 那些按「一次出手」算，多打几段不该重复给。
        //  第一段仍走下面原有的完整链路（含暴击文本），额外段在它之后静默补上。
        const extraHits = this.extraHitCountOf(projectile, context);
        if (target.kind === 'unit') {
            const unit = context.unitById.get(target.id);
            if (unit) {
                const hitText = context.damageUnit(unit, damage, {
                    owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId, floatTextKind, ranged: true,
                });
                if (shooter) this.applyLifesteal(shooter, hitText, context);
                if (extraHits > 0) {
                    context.damageUnit(unit, damage * extraHits, {
                        owner: projectile.owner, kind: 'unit', unitId: projectile.sourceUnitId,
                        floatTextKind: 'damage', ranged: true,
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
                const splashDamage = Math.round(projectile.baseDamage * splashMultiplier
                    * (projectile.splashDamageRate ?? 1));
                const splashText = context.damageUnit(splash, splashDamage, {
                    owner: projectile.owner,
                    kind: 'unit',
                    unitId: projectile.sourceUnitId,
                    floatTextKind: damageFloatTextKind(projectile.criticalHit === true, splashMultiplier),
                    ranged: true,
                });
                if (shooter) this.applyLifesteal(shooter, splashText, context);
                context.tryExecuteUnit(splash, projectile.executeChance, projectile.owner, projectile.sourceUnitId, splashText);
                context.applyHitStatus(splash, projectile.onHitStatusId, projectile.sourceUnitId);
                context.applyLegacyBuffs(splash, projectile.legacyBuffs ?? [], projectile.sourceUnitId);
            }
        }
        //  命中爆炸（2026-11-11 麻辣铁锅「凤凰降临」102604）。设计案原文：
        //  「子弹命中目标产生 220%/280%/300% 的伤害，命中目标爆炸，爆炸产生瞬间伤害
        //   150%/200%/250%，爆炸开始后第 26 帧造成 1 次伤害 150%/180%/200%，
        //   爆炸伤害和第 2 段伤害都是范围伤害」。
        //
        //  三段的分工：直击在上面 `damageUnit` 已经结算完；这里补第一段爆炸（立刻）+ 第二段（延迟）。
        //  两段都**以命中点为圆心**、都把包括主目标在内的所有敌人各打一次 —— 所以不用
        //  `splashRadius` 那条路（它按设计就是「不打主目标」的）。
        //
        //  第二段借 `groundZones` 而不是自己排一个定时器：区域系统本来就有
        //  「首波延迟到 `nextWaveAt`」的能力（五雷轰顶的「第 5 帧判伤」就是这么做的），
        //  再写一套延迟伤害只会让「延迟结算」出现两份口径。`effectPrefabPath: null`
        //  表示这块区域不推表现事件 —— 爆炸特效已经由上面那条 `area` 事件播了。
        const burstRadius = projectile.burstRadius ?? 0;
        if (burstRadius > 0 && (projectile.burstDamage ?? 0) > 0) {
            const burstHexId = context.geometry.hexIdAt(projectile.x, projectile.y);
            const burstHexRadius = burstHexId == null
                ? 0 : Math.ceil(burstRadius / HEX_GRID_LOGICAL_ROW_STEP) + 1;
            const burstCandidates = burstHexId == null ? [] : context.unitsInRadius(burstHexId, burstHexRadius);
            const burstAttacker = this.cardById(context, projectile.owner, projectile.sourceCardId);
            for (const victim of burstCandidates) {
                if (victim.owner === projectile.owner || victim.battleState === 'dead') continue;
                const position = context.unitPosition(victim);
                if (distance(projectile.x, projectile.y, position.x, position.y) > burstRadius) continue;
                const burstMultiplier = cardCounterMultiplier(
                    burstAttacker, this.cardById(context, victim.owner, victim.cardId), context.counters);
                const burstText = context.damageUnit(victim,
                    Math.round((projectile.burstDamage ?? 0) * burstMultiplier), {
                        owner: projectile.owner,
                        kind: 'unit',
                        unitId: projectile.sourceUnitId,
                        floatTextKind: damageFloatTextKind(projectile.criticalHit === true, burstMultiplier),
                        ranged: true,
                    });
                if (shooter) this.applyLifesteal(shooter, burstText, context);
                context.tryExecuteUnit(victim, projectile.executeChance, projectile.owner,
                    projectile.sourceUnitId, burstText);
            }
            const secondDamage = projectile.burstSecondDamage ?? 0;
            if (secondDamage > 0) {
                const delay = Math.max(0, projectile.burstSecondDelay ?? 0);
                state.groundZones.push({
                    x: projectile.x,
                    y: projectile.y,
                    radius: burstRadius,
                    owner: projectile.owner,
                    sourceUnitId: projectile.sourceUnitId,
                    skillId: projectile.skillId,
                    skillName: projectile.skillName,
                    effectPrefabPath: null,
                    //  活到那一波打完：延迟 + 0.3s 收尾（与五雷轰顶逐字同口径）。
                    remainingSeconds: delay + 0.3,
                    wavesLeft: 1,
                    nextWaveAt: state.elapsedSeconds + delay,
                    waveInterval: Math.max(0.05, delay),
                    //  第二段的克制系数按**受击者**算，所以基数存的是不含克制的那一份；
                    //  这里没有具体受击者，落回施法者自己的克制（中性 = 1），逐人克制在区域的
                    //  波次结算里按 `ZCGroundZoneSystem` 的既有口径处理。
                    damage: Math.round(secondDamage),
                    floatTextKind,
                    slowRatio: 0,
                });
            }
        }
        state.combatEvents.push({
            id: state.nextCombatEventId++, type: 'area', owner: projectile.owner,
            sourceUnitId: projectile.sourceUnitId, skillId: projectile.skillId, skillName: projectile.skillName,
            empowered: projectile.empowered,
            targetUnitId: target.kind === 'unit' ? target.id : null,
            fromX: projectile.x, fromY: projectile.y, toX: projectile.x, toY: projectile.y,
            //  追踪导弹：命中后播爆炸（`镭射飞龙_导弹技能命中`）而不是通用受击；
            //  普通弹道仍是 `effectKey: 'hit'` + null（走通用命中表现）。
            effectPrefabPath: projectile.impactEffectPrefabPath ?? null,
            effectKey: projectile.impactEffectPrefabPath ? null : 'hit',
            projectileKey: null,
            //  命中表现的时长：配了爆炸（`burstEffectSeconds`）就活够整段序列帧动画
            //  （爆炸龙卷 32 帧 @30fps = 1.0667s），否则沿用 0.5 / 0.18 的老口径。
            //  短一截会被 `ZCGameModel` 按 `startedAt + durationSeconds` 提前摘掉 —— 同 §14.5。
            radius: 4, damage, startedAt: state.elapsedSeconds,
            durationSeconds: projectile.impactEffectPrefabPath
                ? (projectile.burstEffectSeconds ?? 0.5) : .18,
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

