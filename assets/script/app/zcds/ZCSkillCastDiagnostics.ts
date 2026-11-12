/**
 * 技能释放链路专项诊断（2026-11-10）。
 *
 * ## 为什么单开一条通道
 *
 * 「技能没放出来」在项目里有 5 个可能的断点，而每一处断掉的表现**完全一样**：
 * 战场上看不到东西、控制台一个字都不报。
 *
 *   ① **构筑**：`pvpSkillPlan` 的行有没有按 `unlockHeroLevel` 进本局
 *      （等级不够 / 整卡被 `compileOwnerLoadouts` 跳过 ⇒ 参数压根不存在）；
 *   ② **运行时**：`skillRuntime` 里有没有 `${unitId}:${普攻 skillId}` 这条运行时、
 *      `skillParamJson` 的键（`auraCooldown` 一类）有没有真的并进去；
 *   ③ **触发**：`ZCSkillTriggerSystem` 有没有把 `readyAt` 挂上、有没有到点；
 *   ④ **施法**：`castXxx` 有没有因为参数不全返回 `false`（返回 false 时**不消费 CD**，
 *      于是每帧重试、日志看起来像"一直在尝试"）；
 *   ⑤ **表现**：特效 prefab 在不在本局加载清单里（不在 ⇒ 照常扣血、屏幕不亮）。
 *
 * 本文件只做 ③④ 的运行时点位 + ①② 的构筑快照；⑤ 由
 * `buildZCVisualResourcePlan` 的清单在构筑日志里一起打出来。
 *
 * ## 只打"关注名单"里的卡
 *
 * 全量打会把控制台刷成墙（21 张卡 × 每张 3 条链）。{@link ZC_SKILL_CAST_WATCH_UNITS}
 * 里没列的卡一行都不打 —— 排查完把关注的 id 删掉即可，或把
 * `ZCDCLogSwitch.ZCDC_LOG_SKILL_CAST` 改回 `false`。
 *
 * ⚠️ 开关必须放在 `ZCDCLogSwitch`（`tests/zcds-log-switch.test.ts` 的护栏要求
 * 每一条 `console.*` 都挂在统一开关作用域内），不要在本文件自建布尔量。
 */
import { ZCDC_LOG_SKILL_CAST } from './ZCDCLogSwitch';

/**
 * 需要逐段打链路的单位 id。
 *
 * 68025 大威天芦：2026-11-10 用户反馈「没有释放技能效果」，实际是**构筑期**就整卡被跳过
 * （没有 `generalStar` 行 + 客户端构筑只在有星级行时传 `heroLevel`）。
 */
export const ZC_SKILL_CAST_WATCH_UNITS: readonly string[] = ['68025'];

/** 这张卡要不要打诊断（同时受开关与关注名单约束）。 */
export function zcSkillCastWatched(unitId: string | number | null | undefined): boolean {
    if (!ZCDC_LOG_SKILL_CAST) return false;
    if (unitId == null) return false;
    return ZC_SKILL_CAST_WATCH_UNITS.includes(String(unitId));
}

const ONCE_KEYS = new Set<string>();
const LAST_VALUES = new Map<string, string>();

function emit(scope: string, message: string, detail?: unknown): void {
    //  护栏形态二：方法首行 `if (!ZCDC_LOG_SKILL_CAST) return;` ⇒ 后面整段都算在开关作用域内。
    if (!ZCDC_LOG_SKILL_CAST) return;
    if (detail === undefined) console.info(`[技能诊断][${scope}] ${message}`);
    else console.info(`[技能诊断][${scope}] ${message}`, detail);
}

/** 每次都打。只用在「一局只发生几次」的地方（构筑快照、一次施法）。 */
export function skillCastLog(scope: string, message: string, detail?: unknown): void {
    emit(scope, message, detail);
}

/** 同一个 `key` 全局只打一次。用于「每帧都会被问一遍」的快照。 */
export function skillCastLogOnce(key: string, scope: string, message: string, detail?: unknown): void {
    if (!ZCDC_LOG_SKILL_CAST || ONCE_KEYS.has(key)) return;
    ONCE_KEYS.add(key);
    emit(scope, message, detail);
}

/**
 * 值**变化时**才打。
 *
 * `applySelfAura` 在「参数不全」时每帧都会被叫一遍（返回 false 不消费 CD），
 * 直接打就是每帧一行。这里按结果串去重：失败只留第一条，转成功时再补一条。
 */
export function skillCastLogChanging(key: string, scope: string, message: string): void {
    if (!ZCDC_LOG_SKILL_CAST) return;
    if (LAST_VALUES.get(key) === message) return;
    LAST_VALUES.set(key, message);
    emit(scope, message);
}
