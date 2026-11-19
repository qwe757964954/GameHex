/**
 * 冲锋车道（charge_shield / legacy_dash）的 facade。
 *
 * 两条路径、行为键、时长与三个状态 id 前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_STATUS_PREFIX, ZC_EFFECT_TUNING } from './ZCEffectTuning';

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
