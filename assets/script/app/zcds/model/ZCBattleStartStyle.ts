/**
 * 对局开始「开局对战」特效的样式口径（零 `cc` 运行时依赖）。
 *
 * 需求（2026-11-25 用户）：「对局开始进入到地图时，镜头最高还没开始推镜头时，播放一次
 * 对局开始特效，对局开始特效要填充满 720 宽的屏幕横度」。
 *
 * 「镜头最高、还没开始推镜头」= `ZCGameHUDView.playMapIntro` 把镜头摆到全景之后、
 * `ZC_MAP_OVERVIEW_HOLD_SECONDS`(0.45s) 那一段停留期 —— 那条 tween 的 `delay` 就是唯一的
 * 可播窗口，推镜头一旦开始就不再补播（用户口径要的就是"最高点"那一拍）。
 *
 * 铺满 720 的换算在 `ZCUISpineBannerStyle`（与结算胜负特效共用一份）。
 */

/**
 * 开局特效的动画名。
 *
 * 来自 `开局对战UI特效/score_anim.skel` 本身：骨架里只有两段动画
 * `dzks_xinxi`（对战开始·入场，就是这一条）与 `dzks_xinxi_jingtai`（静态版，留给后续
 * 「常驻展示」用）。**不是**按文件名猜的 —— atlas 的图块也印证：`kaishi`/`kaishi_1`（开始）、
 * `blue_line`/`red_line`（红蓝阵营线）、`touxiang`（头像框）。
 */
export const ZC_BATTLE_START_ANIMATION = 'dzks_xinxi';

/** 静态版动画名（只用于用例核对骨架；正式流程不播这一条）。*/
export const ZC_BATTLE_START_STATIC_ANIMATION = 'dzks_xinxi_jingtai';

/**
 * 特效中心相对屏幕中心的竖直偏移（逻辑 px，正数 = 上移）。
 *
 * 0 = 屏幕正中。开局时棋盘正被完整展示，横幅压在正中不会挡住关键信息
 * （顶部四格与左侧玩家列表都在外边距里）；要挪位置只改这一个数。
 */
export const ZC_BATTLE_START_CENTER_OFFSET_Y = 0;

/**
 * 骨架到货太晚、clip 时长又读不出来的兜底存活时长（秒）。
 *
 * 正常路径按 `zcUiBannerClipSecondsOf` 定 `scheduleOnce`；这条只在读不到时长时生效
 * —— 宁可多留一会儿再收，也不能让节点永久挂在 HUD 上（下一局会看到上一局的横幅）。
 */
export const ZC_BATTLE_START_FALLBACK_SECONDS = 3;
