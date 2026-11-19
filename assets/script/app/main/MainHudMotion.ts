/** 主城 HUD 的纯时间轴函数，供视图按绝对时间取值。 */

/**
 * 宝箱栏开合滑动的横向位置。
 * `fromX → toX` 走 `out-cubic`，`startedAt` 是起播时刻（秒）。
 */
export function resolveChestPanelX(
    fromX: number,
    toX: number,
    startedAt: number,
    now: number,
    duration: number,
): number {
    if (!(duration > 0)) return toX;
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const eased = 1 - (1 - progress) ** 3;
    return fromX + (toX - fromX) * eased;
}

/**
 * 主城「回到章节地图」时各模块的入场节奏（2026-11-18 需求 ③）。
 *
 * 判据只有一条：`name` 必须是 `ArenaRoot.prefab` 上的**直接子节点名**
 * （`tests/main-hud-intro.test.ts` 会拿 prefab 对一遍，改名会红）。
 *
 * 顺序 = 玩家看屏幕的顺序：地图本体先淡进来，然后两侧入口、上下 HUD，
 * 最后才是「生成」型的入口（排行角标、快速寻敌）。`delay` 一律递增，
 * 相邻只差 40~60ms —— 差得再多就变成「一件一件出现」，像卡了。
 *
 * `offsetY` 正值 = 从上方落下（顶部 HUD），负值 = 从下方浮起（底栏 / 地图）。
 * `scaleFrom = 1` 表示纯淡入，不缩。
 */
export interface IMainHudIntroPlanItem {
    /** `ArenaRoot` 下的直接子节点名。 */
    readonly name: string;
    /** 起播延迟（秒）。 */
    readonly delay: number;
    /** 本模块自己的时长（秒）。 */
    readonly seconds: number;
    /** 起始纵向偏移（逻辑 px，正值向上）。 */
    readonly offsetY: number;
    /** 起始缩放倍数（1 = 不缩放）。 */
    readonly scaleFrom: number;
}

export const MAIN_HUD_INTRO_PLAN: readonly IMainHudIntroPlanItem[] = [
    // 地图本体：整页淡进来，轻微上浮。缩放保持 1 —— 地图自带相机推拉，
    // 再叠一层页面级缩放会和 `restoreChestCamera` 的镜头补偿打架。
    { name: 'MapRoot', delay: 0, seconds: 0.40, offsetY: -14, scaleFrom: 1 },
    // 左右两列活动入口：比地图晚一拍，从下方浮起。
    { name: 'EntranceLayer', delay: 0.06, seconds: 0.32, offsetY: -18, scaleFrom: 1 },
    // 顶栏：从上方落下（与底栏方向相反，两条 HUD 一起「夹住」屏幕）。
    { name: 'TopHud', delay: 0.10, seconds: 0.32, offsetY: 40, scaleFrom: 1 },
    // 底栏：从下方升起。
    { name: 'BottomHud', delay: 0.14, seconds: 0.32, offsetY: -40, scaleFrom: 1 },
    // 排行角标：小件，直接「弹」出来比位移更清楚。
    { name: 'OSRankEntry', delay: 0.18, seconds: 0.30, offsetY: 0, scaleFrom: 0.72 },
    // 快速寻敌：同上。
    { name: 'BeginGame', delay: 0.22, seconds: 0.30, offsetY: 0, scaleFrom: 0.80 },
    // 宝箱栏：默认是收起的（`active=false`），播放时会被跳过；留着是为了
    // 「展开状态下回到地图」也能跟着进场。
    { name: 'ChestBar', delay: 0.26, seconds: 0.30, offsetY: -24, scaleFrom: 1 },
];

/**
 * 单个模块的入场进度（0~1）。
 * `elapsed` 是**整段动画**已过去的秒数；进度按「减去自己的 delay 再除以自己的时长」算，
 * 所以各模块同帧推进、不同时刻收尾。
 */
export function mainHudIntroProgress(delay: number, seconds: number, elapsed: number): number {
    if (!(seconds > 0)) return 1;
    const local = (elapsed - Math.max(0, delay)) / seconds;
    if (!Number.isFinite(local)) return 1;
    if (local <= 0) return 0;
    if (local >= 1) return 1;
    return local;
}

/** 整段动画的总时长（秒）：最后收尾的那个模块决定。 */
export function mainHudIntroTotalSeconds(plan: readonly IMainHudIntroPlanItem[] = MAIN_HUD_INTRO_PLAN): number {
    let total = 0;
    for (const item of plan) {
        total = Math.max(total, Math.max(0, item.delay) + Math.max(0, item.seconds));
    }
    return total;
}
