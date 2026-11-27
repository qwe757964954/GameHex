/**
 * 结算「胜负 UI 特效」的样式口径（零 `cc` 运行时依赖）。
 *
 * 需求（2026-11-25 用户）：「判定出胜负时，地块翻转的结算动画同步播放，胜利播放胜利 UI，
 * 失败播放失败 UI 特效，特效需要匹配屏幕宽度 720px，填充整个宽度，持续的时间和地块翻转
 * 结算动画时间一致」。
 *
 * 尺寸 / 时长 / 居中的换算在 `ZCUISpineBannerStyle`（与「开局对战」特效共用一份），
 * 这里只留**结算独有**的两件事：播哪一段、播多久。
 *
 * 「地块翻转的结算动画」= `ZCVictorySweep` 的三段式扫场（铺场 / 回正 / 脉冲），总时长由
 * `ZCGameViewUtil.victorySweepDuration(stepCount)` 给（随地图行数变）。**不复制**那段公式 ——
 * 由渲染世界 `victorySweepSeconds` 现取，改扫场参数时特效自动跟着变。
 */

/**
 * 特效中心相对屏幕中心的竖直偏移（逻辑 px，正数 = 上移）。
 *
 * 0 = 屏幕正中。胜负横幅是整屏通报，压在正中比贴顶更符合「结算演出」的观感；
 * 真要挪位置只改这一个数，别去改视图里的锚点计算。
 */
export const ZC_OUTCOME_EFFECT_CENTER_OFFSET_Y = 0;

/**
 * 胜利 / 失败的动画名。
 *
 * 来自 `胜利失败UI特效/ddz_sgfc_sl_ani` 骨架本身：`.skel` 里只有两段动画
 * `ddz_sgfc_sl_ani` / `ddz_sgfc_sb_ani`，与 atlas 的 `sl` / `sb` 两个 slot 对应
 * （`sl` = 胜利 shengli、`sb` = 失败 shibai）。**不是**按文件名猜的。
 */
export const ZC_OUTCOME_WIN_ANIMATION = 'ddz_sgfc_sl_ani';
export const ZC_OUTCOME_LOSE_ANIMATION = 'ddz_sgfc_sb_ani';

/** 结算画面状态 → 播哪一段；非胜负态（平局 / 还在打）返回空串 = 不播。 */
export function zcOutcomeAnimationOf(status: string | null | undefined): string {
    if (status === 'victory') return ZC_OUTCOME_WIN_ANIMATION;
    if (status === 'defeat') return ZC_OUTCOME_LOSE_ANIMATION;
    return '';
}

/**
 * 结算胜负特效的时长（秒）：就是地块翻转那段。
 *
 * 抽成函数只为让「时长必须来自扫场」这条在用例里能直接断言，不另存一份数字。
 * `sweepSeconds <= 0`（扫场没播 / 整盘无可染格子）返回 0 = 调用方不播。
 */
export function zcOutcomeEffectSeconds(sweepSeconds: number): number {
    return Number.isFinite(sweepSeconds) && sweepSeconds > 0 ? sweepSeconds : 0;
}
