/**
 * 冲锋车道（charge_shield / legacy_dash）的 facade。
 *
 * 两条路径、行为键、时长与三个状态 id 前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import type { ZCSnapshot, ZCUnitState } from './ZCGameTypes';
import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_STATUS_PREFIX, ZC_EFFECT_TUNING } from './ZCEffectTuning';
import { ZCCombatEventType } from './ZCCombatCatalog';

/** 菌盾冲锋的行为键。*/
export const ZC_CHARGE_SHIELD_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.chargeShield;

/** 冲锋 / 尖刺冲锋的行为键。*/
export const ZC_LEGACY_DASH_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.legacyDash;

/** 冲锋位移的表现：轻骑兵_冲锋（静态单帧）。*/
export const ZC_DASH_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.chargeDash;

/** 冲锋残影时长（秒）。*/
export const ZC_DASH_EFFECT_SECONDS = ZC_EFFECT_TUNING.dashSeconds;

/** 落地自保的表现：刀盾兵_护盾。*/
export const ZC_DASH_GUARD_PREFAB_PATH = ZC_EFFECT_PATHS.dashGuard;

/** 护盾表现播放时长（秒）= 17 帧 ÷ 12fps。*/
export const ZC_DASH_GUARD_SECONDS = ZC_EFFECT_TUNING.dashGuardSeconds;

/**
 * 推一条「刀盾兵_护盾」的纯表现事件（2026-11-21 第 37 / 38 批）。
 *
 * 两个调用点共用同一份字段口径，避免「一批的盾看得见、另一批看不见」：
 *  · 第 37 批 巨力坚果 68002「亡者护盾」—— 上盾那一刻给自己挂一圈；
 *  · 第 38 批 波利奥 68006「吃口菠萝」—— 给 `selfCastAllyRadius` 内每个己方单位
 *    （含施法者自己）各挂一圈。
 *
 * 🔴 **必须按帧数走完**：这份 prefab 是 17 帧 @12fps 的序列帧（`ZC_DASH_GUARD_SECONDS`
 * = 17 ÷ 12 ≈ 1.417s），拍一个更短的时长会把动画截断在半路（§29.7 同一条口径）。
 * 所以**不**拿技能的持续秒数 / `shieldSeconds` 当事件时长 —— 那会把一层 loop 动画
 * 钉在原地播十几秒，而本体早就走开了。
 *
 * 🔴 **纯表现**：`radius` / `damage` 都是 0，谁都不结算；护盾数值由
 * `ZCAttackResolutionSystem.applySelfShield` 单独写。
 *
 * 🔴 **不跟随单位**：`from == to`，事件钉在推它的那一刻的坐标上 —— `x` / `y` 由调用方
 * 按世界坐标给（模型侧一律取 `freeX` / `freeY`，缺省别用格子坐标，会偏半格）。
 *
 * 资源必须进本局清单：路径按 `self_cast` / `skill_params` 两条行为组、按单位覆盖登记在
 * `ZCEffectCatalog`（`unitPrefabPaths`）里，漏收就是「预热有、实战没有」。
 */
export function pushDashGuardVisualEvent(
    state: ZCSnapshot, unit: ZCUnitState, x: number, y: number, now: number,
    skillId = 0, skillName = '',
): void {
    state.combatEvents.push({
        id: state.nextCombatEventId++,
        type: ZCCombatEventType.Melee,
        owner: unit.owner,
        sourceUnitId: unit.id,
        targetUnitId: null,
        skillId,
        skillName,
        effectKey: null,
        projectileKey: null,
        effectPrefabPath: ZC_DASH_GUARD_PREFAB_PATH,
        fromX: x,
        fromY: y,
        toX: x,
        toY: y,
        radius: 0,
        damage: 0,
        empowered: false,
        startedAt: now,
        durationSeconds: ZC_DASH_GUARD_SECONDS,
    });
}

/** 这条行为键走不走「冲锋」车道。*/
export function zcIsChargeBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey === ZC_CHARGE_SHIELD_BEHAVIOR_KEY
        || behaviorKey === ZC_LEGACY_DASH_BEHAVIOR_KEY;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcChargeEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsChargeBehavior(behaviorKey) ? zcEffectPathsForBehavior(behaviorKey) : [];
}

/** 冲锋后「自身受到伤害降低 N%」的状态 id。*/
export function dashGuardStatusId(reducePct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.dashGuard}:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

/** 冲锋命中后「目标受到的伤害提高 N%」的状态 id。*/
export function dashVulnerableStatusId(pct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.dashVulnerable}:${pct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
