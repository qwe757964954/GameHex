/**
 * 仙桃行者 68009「重击」的 facade：路径、时长与纯表现事件的唯一出处。
 *
 * 谁在用这份美术：
 *  1. 大地之力 100904（`skill_params` 车道，每 5 次普攻的强化那一击）—— 第一个命中的目标
 *     受到 `quakeFirstRate` 倍伤害，并在**它的坐标**播这条特效，落点圆内其它敌人同额结算；
 *  2. 重骑兵武将技 36241 —— 只换图（`pvpSkill.effectPrefabPath`），落在目标坐标。
 *
 * 本文件不依赖 `cc`：模型侧推事件，视图侧按 `ZCEffectCatalog` 的 `anchor: 'target'` 摆位。
 */

import type { ZCSnapshot } from './ZCGameTypes';
import type { ZCOwner } from './ZCMapConfig';
import { ZCCombatEventType } from './ZCCombatCatalog';
import { ZC_EFFECT_PATHS } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 重击落地柱：`仙桃行者_重击技能`（29 帧一次性演出，由 `tools/build_xiantao_quake_fx.py` 生成）。*/
export const ZC_QUAKE_STRIKE_PREFAB_PATH = ZC_EFFECT_PATHS.quakeStrike;

/** 播放时长（秒）= 29 帧 ÷ 24fps，必须与 clip 时长一致，短了会把动画截断。*/
export const ZC_QUAKE_STRIKE_SECONDS = ZC_EFFECT_TUNING.quakeStrikeSeconds;

/**
 * 「武将技行的美术破例生效」名单（2026-11-19 定案 A 的唯一例外口）。
 *
 * 定案 A 让强化那一击一律借**普攻行**的 prefab（同一张卡不该每 5 秒换个造型）。
 * 但用户 2026-11-23 对重骑兵这条另有明确口径：
 * 「所有使用了【重骑兵_武将技能的】统一更换为【仙桃行者_重击技能】特效，
 *  并且该特效的释放一定是在目标的坐标位置播放」。
 *
 * 🔴 名单制，不是「有配就用」：`pvpSkill` 全表 36xxx 行都自带美术，放开就是全表回退到定案 A 之前。
 * key = 强化那一击的 `pvpSkill.skillId`（即 `attackProfile.empoweredSkillId`）；value 有两种：
 *  · 路径 ⇒ 强化那一击播它（落在目标坐标靠 `ZCEffectCatalog` 的 `anchor: 'target'`）；
 *  · `null` ⇒ 强化那一击**不带任何贴图**（形态已经换了、表现由别的通道负责）。
 *
 * 落在目标坐标靠 `ZCEffectCatalog` 那条 `anchor: 'target'` 登记，不在这里另做坐标算术。
 */
export type ZCEmpoweredFxOverride = string | null;

export const ZC_EMPOWERED_FX_OVERRIDES: Readonly<Record<number, ZCEmpoweredFxOverride>> = {
    // 重骑兵武将技 36241（重骑兵 68015 / 运动霸 68027 共用 `30241 重骑兵普攻` 的强化那一击）。
    36241: ZC_QUAKE_STRIKE_PREFAB_PATH,
    // 大地之力 30844（仙桃行者 68009）：强化那一击换成了弹道形态，表现交给「首目标落点重击柱」
    // （`pushQuakeStrikeVisualEvent`）。而这一批又给普攻行 30718 补了长枪兵那张刀光，
    // 若照定案 A 继承，就会变成「一把刀光拖着飞过去再砸一根柱子」——两套挥击叠在一起。
    // 🔴 刀光比枪阵轻得多，但口径不变：形态换了就不继承普攻贴图，说它小不是一个理由。
    30844: null,
};

/**
 * 查名单。返回 `undefined` = **没登记**（调用方回落普攻行，定案 A 口径不变）；
 * 返回 `null` = 登记为「强化那一击不播贴图」。两者必须区分，别用 `??` 糊过去。
 */
export function zcEmpoweredFxOverrideOf(skillId: number | null | undefined): ZCEmpoweredFxOverride | undefined {
    if (skillId == null) return undefined;
    return ZC_EMPOWERED_FX_OVERRIDES[skillId];
}

/**
 * 推一条「重击落地」的**纯表现**事件。
 *
 * 🔴 `from == to == 落点`：这条特效**必须**钉在受击目标脚下，不是在出手点。
 * 走「同点事件」而不是靠 `anchor: 'target'` 有两个理由：
 *  · 落点就是受击点，`from/to` 填同一份坐标，视图侧取哪个都对（不依赖事件类型）；
 *  · 事件不进快照、不参与结算，`radius` / `damage` 一律 0 ⇒ 不会二次扣血。
 *
 * 🔴 时长固定 `ZC_QUAKE_STRIKE_SECONDS`，不要拿技能冷却 / 增益秒数当它：
 * 那是「砸下来」的一次性演出，长度只由帧数决定（同 §35 刀盾兵护盾的口径）。
 */
export function pushQuakeStrikeVisualEvent(
    state: ZCSnapshot,
    x: number,
    y: number,
    now: number,
    options: { readonly owner: ZCOwner; readonly sourceUnitId: number; readonly skillId?: number; readonly skillName?: string },
): void {
    state.combatEvents.push({
        id: state.nextCombatEventId++,
        type: ZCCombatEventType.Melee,
        owner: options.owner,
        sourceUnitId: options.sourceUnitId,
        targetUnitId: null,
        skillId: options.skillId ?? 0,
        skillName: options.skillName ?? '',
        effectKey: null,
        projectileKey: null,
        effectPrefabPath: ZC_QUAKE_STRIKE_PREFAB_PATH,
        fromX: x,
        fromY: y,
        toX: x,
        toY: y,
        radius: 0,
        damage: 0,
        empowered: false,
        startedAt: now,
        durationSeconds: ZC_QUAKE_STRIKE_SECONDS,
    });
}
