import type { ZCFloatText, ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCStatusApplyOptions, ZCStatusSystemSnapshot } from '../ZCStatusEffect';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCGroundZoneContext extends Pick<IZCModelServices, 'unitPosition' | 'damageUnit'> {
    readonly hexStep: number;
    hexIdAt(x: number, y: number): number | null;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    ensureSlowStatus(id: string, speedPct: number, durationSeconds: number): void;
    applyStatus(unit: ZCUnitState, id: string, options: ZCStatusApplyOptions): void;
    exportStatusEffects(): ZCStatusSystemSnapshot | undefined;
    /**
     * 区域伤害的吸血（2026-11-04 椰蛋战士「生命汲取」100503）。
     *
     * 区域结算这一步拿不到 `IZCAttackResolutionContext`（没有 skillRuntime / statPatches /
     * effectiveDefinition），所以只把「谁打的 + 这一跳实际掉多少」丢回去，让模型找回源单位、
     * 转给 `ZCAttackResolutionSystem.applyLifesteal` —— 比例取法与普攻完全同源，
     * 不在这里另算一套。
     *
     * `hitText` 是 `damageUnit` 的返回值（`value` = `result.applied`），
     * 护盾全吃 / 溢出 / 已死都会是 0 或 null，此时不回血。
     * **源单位已经阵亡时模型侧直接跳过**：区域还在天上飞、人已经没了，不该继续吸。
     *
     * 声明成可选是为了「只跑区域结算」的轻量上下文（单测、工具）不必凭空凑一个攻击上下文；
     * 正式对局里 `ZCGameModel.buildGroundZoneContext` 一定会给，缺了只是不吸血、不会报错。
     */
    lifestealFromHit?(sourceUnitId: number, hitText: ZCFloatText | null): void;
    /**
     * 按 `unit.id` 取单位（2026-11-07 鹿神守护的两段式移动：接近阶段要追着目标走）。
     *
     * 声明成可选：只跑区域结算的轻量上下文（单测 / 工具）不必凑一个单位索引。
     * 缺了的表现是「追不到目标 ⇒ 就地转冲刺」，不会抛，也不会把区域卡在接近段。
     */
    unitById?(id: number): ZCUnitState | undefined;
}

/**
 * 接近阶段播的骨架动画名（2026-11-07 鹿神守护 103405）。
 *
 * `魔术师召唤鹿` 这份骨架里只有三段动画：`idle` / `move` / `attack`（Spine 3.8 二进制里
 * 三个长度前缀串直接可读）。两段式移动正好一一对应：站着待机 → 走过去 → 冲刺撞过去。
 * 名字写在这里而不是配表：`skillParamJson` 只有数值槽，装不下字符串。
 */
const ZONE_APPROACH_ANIMATION = 'move';
/** 冲刺段播的骨架动画名（同上）。 */
const ZONE_SPRINT_ANIMATION = 'attack';

type IZCGroundZoneStepState = Pick<ZCSnapshot,
    'elapsedSeconds' | 'groundZones' | 'combatEvents' | 'nextCombatEventId' | 'statusEffects'>;

/** 持续区域只处理已创建的 zone；模型保留技能出手与创建 zone 的编排。 */
export class ZCGroundZoneSystem {
    static tick(state: IZCGroundZoneStepState, dt: number, context: IZCGroundZoneContext): void {
        if (!state.groundZones.length) return;
        const now = state.elapsedSeconds;
        const keep: ZCGroundZoneState[] = [];
        for (const zone of state.groundZones) {
            //  ① 接近阶段（2026-11-07 鹿神守护：先走 70px/s、进入 200px 才冲）。
            //  这一帧还在接近就**不扣**冲刺时长、**不结算**任何一波 —— 小鹿走过去的那几秒
            //  是「赶路」不是「技能在读秒」，否则走 4 秒 > 冲刺 2 秒，人还没到区域就没了。
            const approaching = this.advanceApproach(zone, dt, now, context);
            if (!approaching) {
                zone.remainingSeconds -= dt;
                //  移动区域（暴风 / 冲刺段）：先推进位置再结算这一波，否则伤害会永远落在上一帧的格子上。
                if (zone.moveVelocityX || zone.moveVelocityY) {
                    zone.x += (zone.moveVelocityX ?? 0) * dt;
                    zone.y += (zone.moveVelocityY ?? 0) * dt;
                }
            }
            //  整段持有视觉：位置推完就把那条长效事件搬到新位置（必须在结算之前，
            //  这样「这一波伤害」和「画面上的小鹿」在同一拍、同一个坐标）。
            this.syncHoldVisual(state, zone);
            while (!approaching && zone.wavesLeft > 0 && now >= zone.nextWaveAt) {
                this.resolveWave(state, zone, context);
                zone.wavesLeft -= 1;
                zone.nextWaveAt += zone.waveInterval;
                //  命中名额打满 ⇒ 立刻散（「接触到足够数量的敌人会提前消失」）。
                if ((zone.maxHits ?? 0) > 0 && (zone.hitUnitIds?.length ?? 0) >= (zone.maxHits ?? 0)) {
                    zone.remainingSeconds = 0;
                    break;
                }
            }
            if (zone.remainingSeconds > 0.0001) keep.push(zone);
            else {
                //  区域这一拍就没了（自然到点 / 打满名额提前散）⇒ 表现事件同步摘掉，
                //  「冲刺结束后所有特效一起消失」不靠下一帧的事件裁剪兜底。
                this.dropHoldVisual(state, zone);
                if ((zone.expireDamage ?? 0) > 0) this.resolveExpiry(state, zone, context);
            }
        }
        state.groundZones = keep;
    }

    /**
     * 「接近阶段」推进（2026-11-07 魔术师「鹿神守护」103405 需求 1/2）。
     *
     * 需求原话：「小鹿生成后先以 70px 速度移动，并播放对应的移动动画，接近攻击目标 200px 再播放冲刺」。
     *
     * 返回 `true` = **还在赶路**（本帧不扣冲刺时长、不结算波次、不按 `moveVelocity` 走）。
     *
     * 三条口径：
     * · **每帧重算方向**：目标是活的、会跑，锁死出生时的方向就会出现「小鹿沿着直线跑到空地上」；
     * · **不用 `moveVelocityX/Y` 存接近速度**：那两个字段是「冲刺段的速度」，混用会让
     *   「还没到就开始冲刺」和「冲到一半又变回 70」两种状态互相打架；
     * · **目标没了就就地冲**：追空气会让小鹿一直走到天荒地老，而这套区域没有「超时」概念。
     */
    private static advanceApproach(
        zone: ZCGroundZoneState,
        dt: number,
        now: number,
        context: IZCGroundZoneContext,
    ): boolean {
        const speed = Math.max(0, zone.approachSpeed ?? 0);
        if (!(speed > 0) || zone.sprinting) return false;
        //  接近段的表现：先走（`move`）。放在这里而不是创建时设，是因为「阶段」由本系统管，
        //  创建方只需要给 `approachSpeed`。
        zone.visualAnimation = ZONE_APPROACH_ANIMATION;
        const target = zone.approachTargetId === undefined
            ? undefined : context.unitById?.(zone.approachTargetId);
        const alive = !!target && target.hp > 0 && target.battleState !== 'dead';
        if (!alive) {
            //  目标半路倒下（或上下文没给 `unitById`）：就地转冲刺，朝当前面朝方向撞出去。
            this.startSprint(zone, now, zone.moveVelocityX ?? 1, zone.moveVelocityY ?? 0);
            return false;
        }
        const goal = context.unitPosition(target);
        const dx = goal.x - zone.x;
        const dy = goal.y - zone.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= Math.max(0, zone.sprintRange ?? 0)) {
            //  进入 200px ⇒ 切冲刺：速度换 `sprintSpeed`、方向锁成「此刻指向目标」。
            this.startSprint(zone, now, dx, dy);
            return false;
        }
        //  别越过目标：这一步最多走到目标身上为止（贴脸时 `distance` 可能小于一步）。
        const step = Math.min(speed * dt, distance);
        if (distance > 1e-9) {
            zone.x += dx / distance * step;
            zone.y += dy / distance * step;
        }
        return true;
    }

    /**
     * 切入冲刺段：速度换成 `sprintSpeed`、方向按入参（退化时朝右）、第一波立刻结算。
     *
     * `nextWaveAt` 必须**重置成 now**：接近段一个波次都没结算，它可能停在出生那一刻，
     * 重置之前那个 `while (now >= nextWaveAt)` 会在切换的这一帧把攒下的波次一口气全打出来。
     */
    private static startSprint(zone: ZCGroundZoneState, now: number, dirX: number, dirY: number): void {
        zone.sprinting = true;
        const speed = Math.max(0, zone.sprintSpeed ?? 0);
        const length = Math.hypot(dirX, dirY);
        const nx = length > 1e-9 ? dirX / length : 1;
        const ny = length > 1e-9 ? dirY / length : 0;
        zone.moveVelocityX = nx * speed;
        zone.moveVelocityY = ny * speed;
        zone.nextWaveAt = now;
        zone.visualAnimation = ZONE_SPRINT_ANIMATION;
    }

    /**
     * 把「整段持有」的表现事件搬到区域当前位置（2026-11-07 鹿神守护）。
     *
     * 事件在区域的第一拍建出来，`durationSeconds` 直接取区域**当时的剩余寿命** ——
     * 两边之后按同一个 dt 往回收，所以到点必然同拍消失，不需要在 tick 里再对时。
     * 早期退化（事件被外部裁掉 / 快照还原后 id 失效）直接重建一条，不抛。
     */
    private static syncHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        if (!zone.holdVisual || !zone.effectPrefabPath) return;
        if (!(zone.remainingSeconds > 0.0001)) return;
        if (zone.visualEventId !== undefined) {
            const live = state.combatEvents.find((event) => event.id === zone.visualEventId);
            if (live) {
                live.fromX = zone.x; live.toX = zone.x;
                live.fromY = zone.y; live.toY = zone.y;
                //  接近段可能走好几秒，而事件出生时的时长只有「冲刺 durationSeconds」——
                //  不续的话小鹿会在半路（2 秒后）凭空消失。每帧续成「已活时间 + 区域剩余」，
                //  两边就永远同拍到期（区域散掉时 `dropHoldVisual` 还会兜一次底）。
                live.durationSeconds = Math.max(
                    live.durationSeconds,
                    state.elapsedSeconds - live.startedAt + Math.max(0, zone.remainingSeconds),
                );
                //  阶段动画：只在名字变化时改字段，视图据此决定要不要真的 `setAnimation`。
                if (zone.visualAnimation) live.spineAnimation = zone.visualAnimation;
                return;
            }
            zone.visualEventId = undefined;
        }
        const id = state.nextCombatEventId++;
        state.combatEvents.push({
            id,
            type: 'area',
            owner: zone.owner,
            sourceUnitId: zone.sourceUnitId,
            targetUnitId: null,
            skillId: zone.skillId,
            skillName: zone.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: zone.effectPrefabPath,
            fromX: zone.x,
            fromY: zone.y,
            toX: zone.x,
            toY: zone.y,
            radius: zone.radius,
            //  纯表现事件：伤害由 `resolveWave` 各自结算，这里给 0 免得任何按 `damage` 取值的
            //  下游误以为「区域每帧都在打人」。
            damage: 0,
            empowered: true,
            startedAt: state.elapsedSeconds,
            durationSeconds: zone.remainingSeconds,
            //  入场「由小变大」：视图从 0 缓出到 1 再乘 prefab 烘焙缩放，
            //  所以「最终大小」仍然由 prefab 说了算，这里只补一段入场。
            growSeconds: zone.growSeconds,
            //  阶段动画（接近 `move` / 冲刺 `attack`）：视图只在名字变化时 setAnimation。
            spineAnimation: zone.visualAnimation,
        });
        zone.visualEventId = id;
    }

    /** 摘掉「整段持有」的表现事件（区域消散时调一次）。 */
    private static dropHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        const id = zone.visualEventId;
        if (id === undefined) return;
        const index = state.combatEvents.findIndex((event) => event.id === id);
        if (index >= 0) state.combatEvents.splice(index, 1);
        zone.visualEventId = undefined;
    }

    /** 本波第 `hitIndex` 个目标的伤害：`damage × (1 - falloff)^hitIndex`（取整，与直伤同口径）。 */
    private static waveDamage(zone: ZCGroundZoneState, falloff: number, hitIndex: number): number {
        if (!(falloff > 0) || hitIndex <= 0) return zone.damage;
        return Math.max(1, Math.round(zone.damage * Math.pow(1 - falloff, hitIndex)));
    }

    private static resolveWave(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        //  「整段持有视觉」的区域已经有一条跟着自己走的长效事件，这里**不再**逐波推视觉 ——
        //  否则同一只小鹿身后会再叠出一串 0.15s 的残影（2026-11-07 鹿神守护）。
        //  伤害结算照旧走下面整段，一条都不少。
        if (!zone.holdVisual) {
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: 'area',
                owner: zone.owner,
                sourceUnitId: zone.sourceUnitId,
                targetUnitId: null,
                skillId: zone.skillId,
                skillName: zone.skillName,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: zone.effectPrefabPath ?? null,
                fromX: zone.x,
                fromY: zone.y,
                toX: zone.x,
                toY: zone.y,
                radius: zone.radius,
                damage: zone.damage,
                empowered: true,
                startedAt: state.elapsedSeconds,
                durationSeconds: zone.waveInterval,
            });
        }
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        //  命中名额（移动区域）：同一个敌人只算一次，满额就这一波直接收工。
        const maxHits = Math.max(0, zone.maxHits ?? 0);
        const hitUnitIds = zone.hitUnitIds;
        if (maxHits > 0 && (hitUnitIds?.length ?? 0) >= maxHits) return;
        const radiusHex = Math.ceil(zone.radius / context.hexStep) + 1;
        //  逐目标递减（2026-11-06「鹿神守护」103405）：第 k 个被命中的目标吃
        //  `damage × (1 - damageFalloff)^k`，k 从 0 起。缺省 0 ⇒ 恒等于原伤害。
        //  递减**只按本波内的命中顺序**算，不跨波累计 —— 移动区域的 `hitUnitIds` 保证
        //  同一个敌人只会出现在一波里，跨波累计没有意义。
        const falloff = Math.max(0, Math.min(1, zone.damageFalloff ?? 0));
        let hitIndex = 0;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(zone.x - pos.x, zone.y - pos.y) > zone.radius) continue;
            if (maxHits > 0 && hitUnitIds) {
                if (hitUnitIds.includes(target.id)) continue;
                if (hitUnitIds.length >= maxHits) break;
                hitUnitIds.push(target.id);
            }
            const hitText = context.damageUnit(target, this.waveDamage(zone, falloff, hitIndex), {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            hitIndex += 1;
            //  每一跳各自回血：命中 N 人就回 N 次，各按「自身实际掉血 × 比例」。
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
            if (zone.slowRatio > 0) {
                const id = `__slow:${zone.slowRatio}__`;
                context.ensureSlowStatus(id, -zone.slowRatio * 100, 1);
                context.applyStatus(target, id, { at: state.elapsedSeconds, durationSeconds: 1 });
            }
        }
        if (zone.slowRatio > 0) state.statusEffects = context.exportStatusEffects();
    }

    private static resolveExpiry(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        const radiusHex = Math.ceil(zone.radius / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(zone.x - pos.x, zone.y - pos.y) > zone.radius) continue;
            const hitText = context.damageUnit(target, zone.expireDamage ?? 0, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
            if (target.hp <= 0 || !zone.expireStatusId || !(zone.expireStatusDuration && zone.expireStatusDuration > 0)) continue;
            context.applyStatus(target, zone.expireStatusId, {
                at: state.elapsedSeconds,
                sourceUnitId: String(zone.sourceUnitId),
                durationSeconds: zone.expireStatusDuration,
            });
        }
        state.statusEffects = context.exportStatusEffects();
    }
}

