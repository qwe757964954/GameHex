import type { ZCDefenceWaveProgress } from './ZCGameModel';

/**
 * 塔防（守城）「BOSS 波来袭」预警 UI 特效的表现口径（零 `cc` 运行时依赖）。
 *
 * 需求（2026-11-26 用户）：「塔防模式，触发 boss 波次的时候播放预警 UI 特效，
 * 给特效制作格式一致的预制，特效的宽度要匹配 720px」。
 *
 * 两种「宽度」都由 prefab 声明，不在代码里写：
 * - **画布尺寸**：`BOSS来袭UI特效.prefab` 的 `UITransform` = 496×496（= 导出 PNG 画布）；
 * - **铺满 720**：节点 `_lscale` = 720 ÷ 496 = 1.4516129032258065。
 *   这与 `开局对战UI特效`（560 ⇒ 1.2857…）/ `胜利失败UI特效`（744 ⇒ 0.9677…）同一套口径，
 *   换算见 `ZCUISpineBannerStyle.zcUiBannerScale` —— 换图时按那一条重算 `_lscale` 即可，
 *   运行时不改缩放（`createZCUISpineBannerNode` 只管起播与销毁）。
 *
 * 🔴 按**画布**折算而不是按 atlas 里最宽那块（427）：导出画布本身是「动画各帧的最大包围盒」，
 * 横幅骨会横向撑开、画布跟着撑到最大值，所以按画布算 = 动画最宽那一刻刚好 720。
 * 静态帧看起来只有 `427 × 1.4516 ≈ 620` 宽是正常的；若美术要「可见就贴满 720」，
 * 把 prefab 的 `_lscale` 换成 `720 ÷ 427 ≈ 1.68616` —— 仍然只动 prefab 一个数，代码不用改。
 */

/**
 * 预警特效的动画名。
 *
 * 来自 `BOSS来袭UI特效/ddz_jinggao_ani.skel` 本身：骨架里只有这一段
 * `ddz_jinggao_ani`（atlas 图块 `ddz_jinggao_di_ani` / `_tb_ani` / `_x_ani` / `_zi_ani`
 * / `_zi01_ani` / `_t1_ani` 印证是「底条 + 顶部 BOSS 字样 + 横线」的横幅）。
 * **不是按文件名猜的** —— 与 `ZCBattleStartStyle` 同一条核对方式。
 */
export const ZC_BOSS_WARNING_ANIMATION = 'ddz_jinggao_ani';

/**
 * 特效中心相对屏幕中心的竖直偏移（逻辑 px，正数 = 上移）。
 *
 * 0 = 屏幕正中。这条横幅是「警告」，压正中比贴顶更有存在感；而且 BOSS 波的首领血条
 * 在左上角（`ZCHudBossPanel`），正中不挡它。要挪位置只改这一个数。
 */
export const ZC_BOSS_WARNING_CENTER_OFFSET_Y = 0;

/**
 * 骨架到货太晚 / clip 时长读不出来时的兜底存活时长（秒）。
 *
 * 与 `ZC_BATTLE_START_FALLBACK_SECONDS` 同口径：宁可多留一会儿再收，
 * 也不能让节点永久挂在 HUD 上（下一波会叠出第二条）。
 */
export const ZC_BOSS_WARNING_FALLBACK_SECONDS = 3;

/**
 * 这一帧该不该放预警。
 *
 * 三条一起判：
 * 1. 守城局的波次进度存在（非塔防局 `defenceWaveProgress` 为 null）；
 * 2. 当前波是 BOSS 波（`currentWaveIsBoss` —— 与首领血条、胜负判定同一份口径）；
 * 3. 这一波**没播过**（`playedWaveId` 记的是上一次播的 `currentWaveId`）。
 *
 * 🔴 必须按 waveId 去重，不能按"当前帧是不是 BOSS 波"：`render` 每帧都跑，
 * 后者会让预警每帧重开、屏幕上永远叠着一条。也不能按布尔"已播过"：
 * 多段 BOSS（配置里两波都标 `isBoss`）时第二波就静默没预警了。
 */
export function zcShouldPlayBossWarning(
    progress: Pick<ZCDefenceWaveProgress, 'currentWaveId' | 'currentWaveIsBoss'> | null | undefined,
    playedWaveId: number | null,
): boolean {
    if (!progress || progress.currentWaveIsBoss !== true) return false;
    const waveId = progress.currentWaveId;
    if (typeof waveId !== 'number' || !Number.isFinite(waveId)) return false;
    return waveId !== playedWaveId;
}
