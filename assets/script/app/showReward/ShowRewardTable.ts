import { toCount } from '../net/RequestGuard';
import { resolveRewardIconRef } from '../activity/LayerActivityArt';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';

/**
 * 「获得奖励」弹窗纯口径层（零 `cc`）：网格几何、排序、图标解析、帧换算，
 * 便于 Node 单测直接 import 做回归。
 */

// ============================================================
// 数据形状
// ============================================================

/**
 * 一条奖励（proto CmdGoods 口径）。刻意不引用 Cmd.d.ts：服务端 number 是 uint64
 * （解出来是 Long），直接当 number 会得到 [object Object]；用结构类型 + toCmdGoods 归一化。
 */
export interface ICmdGoodsLike {
    readonly resId: number;
    readonly number: number;
}

/** 收敛后的奖励展示数据。 */
export interface IRewardEntry {
    readonly resId: number;
    /** 数量（`0` 不显示数量）。 */
    readonly number: number;
    /** item.quality；两表都查不到为 `1`（降级最低档品质框，不抛错）。 */
    readonly quality: number;
    /** 图标相对 assets/resources/ 的路径；解析不出为 `''`（只画品质框）。 */
    readonly iconPath: string;
}

/** 原始一行 → ICmdGoodsLike；resId<=0 / 形状不对返回 null（丢弃，不抛错）。 */
export function toCmdGoods(raw: unknown): ICmdGoodsLike | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = toCount(row.resId);
    if (resId <= 0) return null;
    return { resId, number: toCount(row.number) };
}

/** 一串原始奖励 → 归一化列表（丢掉落不出来的）。 */
export function parseCmdGoodsList(raw: unknown): ICmdGoodsLike[] {
    const out: ICmdGoodsLike[] = [];
    if (!Array.isArray(raw)) return out;
    for (const one of raw) {
        const goods = toCmdGoods(one);
        if (goods) out.push(goods);
    }
    return out;
}

// ============================================================
// 网格几何（出处：FGUI 组件_获得奖励.xml 的 list size=468,330、flow_hz、
// lineGap=12、colGap=20；奖励格本体 100×100）
// ⚠️ 这组数字三处必须一致：本文件 / ShowRewardGrid.ts / tmp/gen_showreward.mjs
//    （生成器读不到 ts），单测 showreward.test.ts C 段守卫。
// ============================================================

/** 视口宽。 */
export const SR_VIEW_W = 468;
/** 视口高。 */
export const SR_VIEW_H = 330;
/** 一格边长。 */
export const SR_ITEM_SIZE = 100;
/** 列间距。 */
export const SR_COL_GAP = 20;
/** 行间距。 */
export const SR_ROW_GAP = 12;
/** 列步进。 */
export const SR_STEP_X = SR_ITEM_SIZE + SR_COL_GAP;
/** 行步进。 */
export const SR_STEP_Y = SR_ITEM_SIZE + SR_ROW_GAP;

/** flow_hz 一行放几个 = ⌊(视口宽+gap)/(格宽+gap)⌋（除以 step，整除时才不会少算）。 */
export function columnsOf(viewW: number, itemSize = SR_ITEM_SIZE, gap = SR_COL_GAP): number {
    if (!(itemSize > 0)) return 1;
    return Math.max(1, Math.floor((viewW + gap) / (itemSize + gap)));
}

/** 视口内能完整显示几行（口径同 columnsOf）。 */
export function rowsOf(viewH: number, itemSize = SR_ITEM_SIZE, gap = SR_ROW_GAP): number {
    if (!(itemSize > 0)) return 1;
    return Math.max(1, Math.floor((viewH + gap) / (itemSize + gap)));
}

/** 视口列数 = 4（4×100+3×20=460，放不下第 5 个）。 */
export const SR_COLUMNS = columnsOf(SR_VIEW_W);
/** 视口行数 = 3（3×100+2×12=324，放不下第 4 行）。 */
export const SR_ROWS = rowsOf(SR_VIEW_H);
/** 可见格数 = 预摆槽位数（Grid 槽位恒定这么多个）。 */
export const SR_SLOT_COUNT = SR_COLUMNS * SR_ROWS;

/**
 * 槽位 index 在视口内的中心坐标（原点 = 视口左上）。
 * flow_hz + align=center + vAlign=middle 语义：每行各自水平居中、整块垂直居中；
 * total = 参与排布的总格数（末行不满也居中）。
 */
export function slotLocalCenterOf(
    index: number,
    total: number = SR_SLOT_COUNT,
): { x: number; y: number } {
    const count = Math.max(1, Math.floor(total));
    const rows = Math.max(1, Math.ceil(count / SR_COLUMNS));
    const row = Math.floor(index / SR_COLUMNS);
    const col = index % SR_COLUMNS;
    const inRow = Math.min(count - row * SR_COLUMNS, SR_COLUMNS);
    const blockW = inRow * SR_ITEM_SIZE + Math.max(0, inRow - 1) * SR_COL_GAP;
    const blockH = rows * SR_ITEM_SIZE + Math.max(0, rows - 1) * SR_ROW_GAP;
    return {
        x: (SR_VIEW_W - blockW) / 2 + col * SR_STEP_X + SR_ITEM_SIZE / 2,
        y: (SR_VIEW_H - blockH) / 2 + row * SR_STEP_Y + SR_ITEM_SIZE / 2,
    };
}

/** 内容总高（末行不留 lineGap），与 Grid.contentHeight 同公式。 */
export function contentHeightOf(total: number, itemSize = SR_ITEM_SIZE, gap = SR_ROW_GAP): number {
    const rows = Math.max(1, Math.ceil(Math.max(0, Math.floor(total)) / SR_COLUMNS));
    return rows * (itemSize + gap) - gap;
}

/**
 * 按行虚拟化核心公式：槽位位置固定，
 * dataIndex = (topRow + ⌊slot/列数⌋)×列数 + slot%列数（HeadGridList 曾因移动 Content 写错）。
 * 放本文件（零 cc）以便单测穷举。
 */
export function windowSlotOf(slot: number, topRow: number): number {
    const row = topRow + Math.floor(slot / SR_COLUMNS);
    return row * SR_COLUMNS + (slot % SR_COLUMNS);
}

/** 最大顶行下标（内容不够高为 0 ⇒ 不可滚）。 */
export function maxTopRowOf(total: number, viewH: number = SR_VIEW_H): number {
    const content = contentHeightOf(total);
    return Math.max(0, Math.ceil((content - viewH) / SR_STEP_Y));
}

// ============================================================
// 排序 / 图标解析
// ============================================================

/**
 * 奖励排序（老端口径）：品质降序，同品质按 resId 升序。
 * 同品质比 resId、不比数量（同物不同数量不该改顺序）；品质解析不出退化为 1、排最后。
 */
export function sortRewardEntries(entries: readonly IRewardEntry[]): IRewardEntry[] {
    return [...entries].sort((a, b) => (b.quality - a.quality) || (a.resId - b.resId));
}

/**
 * 图标路径（相对 assets/resources/），解析不出返回 ''。
 * 必须走 resolveRewardIconRef 两支分流：item 表 icon 存 resources 路径（直通）；
 * roleProperty 表 icon 存 FGUI 组件名（落 icons/resource/<name>）。
 * 只走 item 一支 ⇒ 货币格只剩品质框、无图标（静默降级）。
 */
export function rewardIconPathOf(info: IActivityGoodsInfo | null): string {
    const ref = resolveRewardIconRef(info);
    return ref ? `${ref.root}/${ref.name}` : '';
}

/**
 * 一条奖励 → 展示数据；两表都查不到返回「品质 1 + 无图标」安全降级（老端 GetQuality 兜底也是 1）。
 * item 表优先（与 LayerActivityTable / BattleTokenRepository 同口径）。
 */
export function rewardEntryOf(
    goods: ICmdGoodsLike,
    items: ReadonlyMap<number, IActivityGoodsInfo>,
    resources: ReadonlyMap<number, IActivityGoodsInfo>,
): IRewardEntry {
    const info = items.get(goods.resId) ?? resources.get(goods.resId) ?? null;
    return {
        resId: goods.resId,
        number: goods.number,
        quality: info ? info.quality : 1,
        iconPath: rewardIconPathOf(info),
    };
}

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
