/**
 * 破阵术（投枪）的弹体美术 facade。
 *
 * 为什么单独一份文件（2026-11-26 第 57 批）：
 *   · 投枪不是一条 `pvpSkill` 行 —— 它是「每 N 次普攻把这一击换成弹道」，
 *     表现路径在 `ZCAttackResolutionSystem.lanceProfileOf` 里**现造**，
 *     表里唯一的入口是 `skillParamJson`（值域 `number`，塞不进字符串）；
 *   · 但 `ZCVisualResourcePlan` 必须能按阵容收到它（漏收 = 投枪飞出去是一根
 *     **隐形的枪**：伤害照常结算、画面上什么都没有、且不报错）。
 *   资源计划不该 import 攻击系统（分层），所以路径表放在这里，
 *   与 `ZCTrapFx` / `ZCSelfAuraFx` / `ZCBoltStrikeFx` 同一套做法。
 */

import { ZC_EFFECT_PATHS } from './ZCEffectCatalog';

/** 没有专属投枪美术时的占位弹体（三张卡都换过之后，剩下的卡仍用它）。*/
export const ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.lanceArrow;

/**
 * 破阵术弹体：**按单位**覆盖，缺省仍是那把通用箭矢。
 *
 * 用户口径（2026-11-26 第 57 批）：大嘴花 / 仙桃行者 / 诅咒菇 三张卡的破阵术
 * 「从投枪弹体（长条 + 拖尾）改成【xxx_子弹】」，与各自普攻子弹统一成
 * 「一张主体图 + 白色三角形拖尾」。
 *
 * 换皮只改这张表。漏登记不会报错，只会静默用回通用箭矢 ——
 * 所以 `tests/zcds-card-bullet-batch57.test.ts` 钉了三条路径。
 */
export const ZC_LANCE_EFFECT_PREFAB_BY_UNIT: Readonly<Record<string, string>> = {
    //  吞噬大嘴花 68007 破阵术 100701：蛇形藤（X 轴抖动登记在 spec 的 `wobble`）
    '68007': ZC_EFFECT_PATHS.cardBulletMouth,
    //  仙桃行者 68009 破阵术 100901：红金箭
    '68009': ZC_EFFECT_PATHS.cardBulletPeach,
    //  诅咒菇 68018 破阵术 101802：弯刀（全套里唯一一条紫色拖尾）
    '68018': ZC_EFFECT_PATHS.cardBulletCurse,
};

/** 这张卡的破阵术弹体路径；没登记就沿用通用箭矢。*/
export function zcLanceEffectPrefabPath(unitId: string | null | undefined): string {
    if (!unitId) return ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH;
    return ZC_LANCE_EFFECT_PREFAB_BY_UNIT[unitId] ?? ZC_LANCE_DEFAULT_EFFECT_PREFAB_PATH;
}

/**
 * 这张卡要不要额外加载一条投枪弹体；`[]` = 用缺省的通用箭矢（它本来就在清单里）。
 *
 * 只收「有覆盖」的那些：把缺省路径也塞进来会让每局都多收一次同一串路径
 * （`ZCVisualResourcePlan` 会去重，但测试里数条数会被多出来的一条骗到）。
 */
export function zcLanceEffectPrefabPathsForUnit(unitId: string | null | undefined): readonly string[] {
    if (!unitId) return [];
    const path = ZC_LANCE_EFFECT_PREFAB_BY_UNIT[unitId];
    return path ? [path] : [];
}
