/**
 * 自身光环（`behaviorKey = 'self_aura'`，大威天芦 102503「无尘禁土」）的持续表现。
 *
 * 需求沿革
 * ────────
 * · 2026-11-09：第一次落地，用【持续光环伤害效果】那根竖直光柱（循环 8~25 帧）；
 * · 2026-11-17：用户口径「大威天芦 的无尘禁土 使用【大威天芦_火焰光环】特效」⇒ 换成
 *   `units/projectiles/大威天芦_火焰光环/大威天芦_火焰光环`（地面椭圆环 + 火焰墙，30 帧循环）。
 *   三件套由 `tools/build_dawtianlu_flame_aura_fx.py` 生成，尺寸烘在 prefab 的 `_lscale` 里
 *   （环外径 = 判定直径 307.5 屏上 px），所以 `ZCCombatEffectScale` 不登记这条路径。
 *
 * 为什么路径写在代码里，而不是配表
 * ────────────────────────────────
 * 与 `ZCBlinkCastFx`（移形换影）同一个理由：`self_aura` 是行为技能，全部参数压在
 * `pvpSkillPlan.skillParamJson` 上（`auraCooldown` / `auraRadius` …），那张表只有数值槽、
 * 没有造型槽；而 `pvpSkill`（唯一带 `effectPrefabPath` 的）按 `unitId` 挂的是普攻行
 * （68025 是 30858），一行只服务一个「出手」，装不下第三条主动技能的造型。
 * 于是这张图没有任何配置列可以承载 —— 表现是这套行为的一部分，不是某张表的列。
 *
 * 它必须被 `ZCVisualResourcePlan` 收进本局特效清单
 * ──────────────────────────────────────────────
 * `ZCGameLoader` 只加载 `buildZCVisualResourcePlan()` 算出来的路径。硬编码路径如果
 * 不进那张清单，运行时 `effectVisualPrefabs.get()` 就是 `null` ⇒ 技能照常结算、
 * 屏幕上一次光都没有，而且一条错都不报（2026-11-03 追踪导弹就是这么消失的）。
 * 所以那边按「本局有没有 `self_aura` 的技能计划」把这条路径加进去。
 *
 * 本文件必须保持无 `cc` 依赖（同 `ZCCombatEffectPlacement` / `ZCCombatEffectScale`），
 * 否则这些常量就没法在没有引擎的环境里被用例直接断言。
*/

/**
 * 自身光环的**兜底**预制体路径（`assets/bundles/battle/` 分包根下的相对路径）。
 *
 * ⚠️ 2026-11-17 之后没有任何单位落在它上面了 —— 68025 / 68016 / 68026 三家都在
 * {@link SELF_AURA_FX_BY_UNIT} 里各有造型。留着是因为 `castSelfAura` 里
 * `zcSelfAuraEffectPath(...) ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH` 需要一条兜底，
 * 且 `effectPrefabPath` 是 `groundZones` 的必填字段（不能是 `null`）。
 * 真要新增一个没造型的 `self_aura` 技能，它会退回这根老光柱 —— 那不是 bug，是安全垫。
 */
export const ZC_SELF_AURA_EFFECT_PREFAB_PATH = 'units/projectiles/持续光环伤害效果/持续光环伤害效果';

/** 触发这条表现的行为键。*/
export const ZC_SELF_AURA_BEHAVIOR_KEY = 'self_aura';

/**
 * 按单位覆盖自身光环的造型（缺省全体走 {@link ZC_SELF_AURA_EFFECT_PREFAB_PATH}）。
 *
 * 为什么需要：`self_aura` 已经不只服务一家 —— 大威天芦「无尘禁土」（地面火焰环）、
 * 磁电菇「磁电冲击」（一道横向雷电束）、麻辣铁锅「喷射火焰」（身前火柱）共用一个车道、
 * 共用一个 `behaviorKey`。造型槽在配表里没有位置（见文件头），只能落成一张代码表；
 * 这是 `ZCCombatEffectFlight.MISSILE_FX_BY_UNIT` 早就用过的同一套写法
 * （那边按单位登记「弹体 / 爆炸」两条路径）。
 *
 * 表里出现的路径必须同时被 `ZCVisualResourcePlan` 收进本局清单，
 * 否则 `ZCGameLoader` 不加载 ⇒ 技能照常结算、屏幕上一道电都没有，且不报错。
 * 那边按「本局有没有这个单位的 `self_aura` 计划」顺带把对应路径加进去。
*/
const SELF_AURA_FX_BY_UNIT: Readonly<Record<string, string>> = {
    // 68025 大威天芦「无尘禁土」102503：`tools/build_dawtianlu_flame_aura_fx.py` 生成的三件套。
    // 2026-11-17 用户口径：「使用【大威天芦_火焰光环】特效，并按照统一的格式制作预制」。
    //
    // 造型 = 一圈地面椭圆环 + 环上竖起的火焰墙 + 环下溅出的火星（30 帧 / sample 12 / Loop 2.5s）。
    // 锚点取**椭圆环的几何中心** —— 3/4 视角下地面圆的投影是椭圆，其几何中心就是地面圆心的投影；
    // prefab 的根 `_lpos` 把这个点钉到宿主原点（= 区域圆心 = 施法者逻辑脚点）。
    //
    // 尺寸：环外径 = 判定直径 = `auraRadius 200 × 2 × 0.76875` = 307.5 屏上 px，
    // 缩放**烘在 prefab 的 `_lscale` 里**（0.926205），所以 `ZCCombatEffectScale` 不登记这条路径
    // （未登记 = 宿主倍率 1）。要改半径就重跑生成器，别去那张表里找。
    //
    // 🔴 `_lpos` 非零成立的前提：102503 **没有** `auraFaceTarget` ⇒ `castSelfAura` 不写
    // `angleDegrees` ⇒ 宿主不旋转 ⇒ `_lpos.y` 是纯竖直位移。若以后给它打开 `auraFaceTarget`，
    // 这个 y 会变成垂直于朝向的侧移，届时要改成把偏移烘进子节点或走 `auraVisualLiftPx`。
    '68025': 'units/projectiles/大威天芦_火焰光环/大威天芦_火焰光环',
    // 68016 磁电菇「磁电冲击」101604：`tools/build_magdi_strike_fx.py` 生成的三件套，
    // 取原 18 帧的第 9~14 帧做 0.5s 循环（设计案：「中间持续时间使用 9~14 帧循环」）。
    // 尺寸：判定 `auraRadius = 180`（L2 档）⇒ 冲击波烘焙到屏上 276.8px 长。
    '68016': 'units/projectiles/雷电冲击/雷电冲击',
    // 68026 麻辣铁锅「喷射火焰」102603：`tools/build_maladi_guo_fx.py` 生成的三件套。
    // 帧序 = 原 18 帧 + 「循环帧 11~17」× 3（设计案：「当需要延长时间时使用循环帧 11-17」）,
    // sample 12 ⇒ 39/12 = 3.25s，比光环的 3s 略长，动画会在区域到期那一拍被整体摘掉，
    // 不会停在最后一帧上僵住。
    // 摆位：prefab 的根 `_lpos` 往回带一个偏移，把火焰根部钉在角色头部，
    // 火焰主体铺到 `auraForward = 350` 的判定圆心上（换算见生成器文件头 §2）。
    '68026': 'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰',
};

/**
 * 行为键（+ 可选单位 id）→ 自身光环的特效路径；不是自身光环就返回 `null`（不插任何事件）。
 *
 * 收成一个函数而不是让两处各自比较字符串：触发系统决定「播不播」、
 * 资源计划决定「加不加载」，这两件事必须是同一个判据，否则又是一次
 * 「结算了但没图」或者「加载了但永远不播」。
 *
 * @param unitId 单位 id。缺省 ⇒ 走默认预制（大威天芦那条老口径，行为逐字不变）。
*/
export function zcSelfAuraEffectPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    if (behaviorKey !== ZC_SELF_AURA_BEHAVIOR_KEY) return null;
    const override = unitId ? SELF_AURA_FX_BY_UNIT[unitId] : undefined;
    return override ?? ZC_SELF_AURA_EFFECT_PREFAB_PATH;
}
