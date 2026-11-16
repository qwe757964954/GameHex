/**
 * 「获得奖励」弹窗纯口径层（零 `cc`）。
 * 奖励归一化 / 排序 / 图标路径 / 展示数据已归位到 `common/RewardEntries`；
 * 本文件保留旧导出名，调用方与既有测试不需要改 import 路径。
 */
export {
    parseCmdGoodsList,
    rewardEntryOf,
    rewardIconPathOf,
    sortRewardEntries,
    toCmdGoods,
} from '../common/RewardEntries';
export type { ICmdGoodsLike, IShowRewardEntry as IRewardEntry } from '../common/RewardEntries';

// ============================================================
// 动画时间轴
// ============================================================

/** FGUI transition 单位是帧、帧率 60（官方默认值；老端打包态未导出该常量）。 */
export const FGUI_FPS = 60;

/** 帧 → 秒。 */
export function framesToSeconds(frames: number): number {
    return frames / FGUI_FPS;
}

/**
 * 奖励格错峰延迟：老端 addDelay(100×(index+1))，第 index 格（数据下标，从 0 起）延后播动画。
 */
export const SR_STAGGER_MS = 100;

/** 第 index 格播动画的延迟（秒）。 */
export function staggerSecondsOf(index: number): number {
    return (SR_STAGGER_MS * (Math.max(0, Math.floor(index)) + 1)) / 1000;
}

// ============================================================
// 奖励格 5 星点飞散轨迹（FGUI 列表_奖励列表Item.xml 的 t0）
// ============================================================

/**
 * 一个星点的三个关键帧（相对 item 中心，Cocos lpos 口径）。
 * 原稿星点 pivot=0.5、无 anchor，xy 是左上角；换算 = 左上角+size/2 得中心，
 * 再相对 item 中心 (50,50) 转换，y 轴反向。
 *
 * from 取原稿设计位 xy（不是 transition t0 里 time=0 的 XY，两者全不同）：
 * 静止位须与 prefab 烘的静态位一致才能对账；t=0 那组只存在一瞬、随后被 mid 覆盖。
 *
 * 时间轴（帧）：t=0 摆 from、scale 0 隐藏；t=5 起 5 帧 scale 0→1、同时 13 帧飞向 to；
 * t=10 起 8 帧 scale 1→0。
 */
export interface IStarTrack {
    /** 静止位（原稿设计位）。 */
    readonly from: readonly [number, number];
    /** 飞散起点（t=5 startValue）。 */
    readonly mid: readonly [number, number];
    /** 飞散终点（t=5 endValue）。 */
    readonly to: readonly [number, number];
}

/** 5 个星点，顺序须与 ShowRewardItem.stars 一致（n2~n6）。 */
export const SR_STAR_TRACKS: readonly IStarTrack[] = [
    { from: [27.5, 23.5], mid: [11.5, 8.5], to: [58.5, 41.5] },       // n2 37×37
    { from: [-30, -23], mid: [-25, -28], to: [-49, -40] },            // n3 46×46
    { from: [-13, 12], mid: [-13, 12], to: [-68, 25] },               // n4 28×28
    { from: [23, -26], mid: [6.5, -12.5], to: [35.5, -34.5] },        // n5 56×56
    { from: [-26.5, 32.5], mid: [-8, 15], to: [-27, 56] },            // n6 27×27
];

/** 星点个数（单测守卫与 prefab 里 Star1..N 数量一致）。 */
export const SR_STAR_COUNT = SR_STAR_TRACKS.length;
