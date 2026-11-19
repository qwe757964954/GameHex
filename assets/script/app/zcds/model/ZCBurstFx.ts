/**
 * 菌毯爆发 / 菌核爆裂（burst_aura / burst_knockback）的 facade。
 *
 * 爆点路径、行为键、屏上缩放基准与状态前缀已迁到目录/调参表；
 * 本文件只保留原导出名与纯函数。
 */

import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectPathsForBehavior,
} from './ZCEffectCatalog';
import { ZC_EFFECT_SCALE, ZC_EFFECT_STATUS_PREFIX } from './ZCEffectTuning';

/** 爆点特效：普攻爆炸（31 帧）。*/
export const ZC_BURST_IMPACT_PREFAB_PATH = ZC_EFFECT_PATHS.burstImpact;

/** 爆发 + 自护盾（菌毯爆发）。*/
export const ZC_BURST_AURA_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.burstAura;

/** 爆发 + 击退（菌核爆裂）。*/
export const ZC_BURST_KNOCKBACK_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.burstKnockback;

const BURST_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_BURST_AURA_BEHAVIOR_KEY, ZC_BURST_KNOCKBACK_BEHAVIOR_KEY,
]);

/** 这个行为键走不走「以自身为圆心爆一次」这条车道。*/
export function zcIsBurstBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && BURST_BEHAVIOR_KEYS.has(behaviorKey);
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcBurstEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return zcIsBurstBehavior(behaviorKey) ? zcEffectPathsForBehavior(behaviorKey) : [];
}

/** 「护盾存在期间受到伤害降低」的状态 id：`__burstguard:<百分点>:<秒>__`。*/
export function burstGuardStatusId(reducePct: number, seconds: number): string {
    return `${ZC_EFFECT_STATUS_PREFIX.burstGuard}:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

/** `普攻爆炸` prefab 的屏上宽度（px）。*/
export const ZC_BURST_IMPACT_PREFAB_SCREEN_WIDTH = ZC_EFFECT_SCALE.burstPrefabScreenWidth;

/** 屏上 px = 逻辑 px × 0.76875。*/
export const ZC_BURST_SCREEN_PER_LOGIC = ZC_EFFECT_SCALE.screenPxPerLogic;

/**
 * 爆发特效的整体尺寸倍率：让爆炸的屏上直径等于判定直径。
 *
 * `logicRadius` 传表值（`burstRadius`），不是乘过 `combatDistanceScale` 的世界值；
 * 非法值退回 1。
 */
export function zcBurstEffectScale(logicRadius: number): number {
    if (!Number.isFinite(logicRadius) || logicRadius <= 0) return 1;
    const screenDiameter = logicRadius * 2 * ZC_BURST_SCREEN_PER_LOGIC;
    const scale = screenDiameter / ZC_BURST_IMPACT_PREFAB_SCREEN_WIDTH;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
