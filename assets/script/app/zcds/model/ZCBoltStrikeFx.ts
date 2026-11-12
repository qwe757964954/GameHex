/**
 * 落雷（`behaviorKey = 'bolt_strike'`，磁电菇 101603「五雷轰顶」）的表现路径常量。
 *
 * ## 为什么路径写在代码里，而不是配表
 *
 * 与 `ZCBlinkCastFx` / `ZCSelfAuraFx` 同一个理由：`bolt_strike` 是**行为技能**，全部参数压在
 * `pvpSkillPlan.skillParamJson` 上（`boltCount` / `boltSpacing` …），那张表只有数值槽、没有造型槽；
 * `pvpSkill` 按 `unitId` 挂的是**普攻行**（68016 是 30231），一行只服务一个「出手」，
 * 装不下这条主动的造型。于是没有任何配置列能承载它。
 *
 * ## ⚠️ 它必须被 `ZCVisualResourcePlan` 收进本局特效清单
 *
 * `ZCGameLoader` 只加载 `buildZCVisualResourcePlan()` 算出来的路径。硬编码路径如果
 * 不进那张清单，运行时就取不到预制 ⇒ 技能照常结算、屏幕上**一道雷都没有**，而且一条错都不报。
 * 那边按「本局有没有 `bolt_strike` 的技能计划」把这条路径加进去。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**，否则这些常量没法在没有引擎的环境里被用例直接断言。
 */

/**
 * 落雷预制体路径（`assets/bundles/battle/` 分包根下的相对路径）。
 *
 * 美术 2026-11-11 才把散帧（20 张 1019×607）补齐，由 `tools/build_magdi_strike_fx.py`
 * 生成三件套（`atlas/` + `anim/磁电菇_劈雷技能.anim` + 本 prefab）。**它原本没有 prefab**，
 * 在此之前这里挂的是同类的「雷法师_武将闪电」当占位。
 */
export const ZC_BOLT_EFFECT_PREFAB_PATH = 'units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能';

/**
 * 落雷那一段动画的总时长（秒）= 20 帧 ÷ `sample` 30。
 *
 * 🔴 `sample` 取 30 不是随便定的：设计案 101603 要求「**每道闪电的伤害判定在特效的第 5 帧**」。
 * 第 5 帧（下标 4）占 `4/30 ~ 5/30` = 0.1333~0.1667s，配表 `boltDelay = 0.15`
 * 正落在这一帧**中间** —— 于是配表一个数都不用改，判伤就是第 5 帧那一下。
 * 换成项目里最常见的 `sample 12`（投射物口径）时第 5 帧在 0.333s，判伤会早整整 0.2s，
 * 看起来像「雷还没落地血就掉了」。
 *
 * ⚠️ 表现事件的 `durationSeconds` 必须 ≥ 它，否则 `ZCGameModel` 的过期剔除会在
 * 动画播完之前把节点摘掉（第 16 帧之后那段「雷尾消散」就永远看不到）。
 * 用法见 `ZCAttackResolutionSystem.castBoltLine`。
 */
export const ZC_BOLT_EFFECT_SECONDS = 20 / 30;

/** 触发这条表现的行为键。 */
export const ZC_BOLT_STRIKE_BEHAVIOR_KEY = 'bolt_strike';

/**
 * 落雷命中后可以挂上的状态 id：**麻痹（软控）**。
 *
 * 为什么写在代码里：`skillParamJson` 只有数值槽，`skillParamJson.boltNumbChance` 能给「多大概率」，
 * 给不了「挂哪个状态」这个字符串。
 *
 * 🔴 用 `numb` 而**不是** `paralysis`：后者是 3 秒**硬控**（`ZCUnitSystem` 的受控闸门会让单位
 * 连移动都停），而磁电菇的口径是「只禁止攻击、移速 −50%」。两者不能混用。
 */
export const ZC_BOLT_NUMB_STATUS_ID = 'numb';

/**
 * 行为键 → 落雷特效路径；不是落雷就返回 `null`（不插任何事件）。
 *
 * 收成一个函数而不是让两处各自比较字符串：触发系统决定「播不播」、
 * 资源计划决定「加不加载」，这两件事必须是同一个判据。
 */
export function zcBoltStrikeEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BOLT_STRIKE_BEHAVIOR_KEY ? ZC_BOLT_EFFECT_PREFAB_PATH : null;
}
