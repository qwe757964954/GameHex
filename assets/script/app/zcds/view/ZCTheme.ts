/** ZCGame 手绘 UI 风格主题：配色 / 面板 / 字体常量，集中管理便于换肤。 */

import { Color } from 'cc';
import type { ZCFaction } from '../model/ZCMapConfig';

/** 配色（语义用途）。 */
export const ZC_CLIENT_COLORS = {
    ink: new Color(18, 28, 40, 255),
    ice: new Color(218, 235, 244, 255),
    // 领地填充在 ZCHexView 中统一使用 60% 透明度；同色外轮廓保持 100%。
    player: new Color(126, 130, 255, 255),       // #7e82ff
    playerEdge: new Color(126, 130, 255, 255),
    enemy: new Color(251, 73, 105, 255),         // #fb4969
    enemyEdge: new Color(251, 73, 105, 255),
    enemy2: new Color(251, 204, 73, 255),        // #fbcc49（3号）
    enemy2Edge: new Color(251, 204, 73, 255),
    enemy3: new Color(189, 73, 251, 255),        // #bd49fb（4号）
    enemy3Edge: new Color(189, 73, 251, 255),
    neutral: new Color(196, 218, 229, 255),
    ruins: new Color(94, 101, 108, 255),
    paper: new Color(248, 244, 226, 255),
    gold: new Color(255, 198, 45, 255),
    white: new Color(255, 255, 255, 255),
    muted: new Color(173, 192, 202, 255),
} as const;

/** 多人席位填充色（含 neutral 中立色）；穷举阵营，新增席位时编译报错。 */
const FACTION_COLOR_BY_FACTION: Readonly<Record<ZCFaction, Color>> = {
    player: ZC_CLIENT_COLORS.player,
    enemy: ZC_CLIENT_COLORS.enemy,
    enemy2: ZC_CLIENT_COLORS.enemy2,
    enemy3: ZC_CLIENT_COLORS.enemy3,
    neutral: ZC_CLIENT_COLORS.neutral,
};

/** 多人席位色；neutral 走中立色。 */
export function zcFactionColor(owner: ZCFaction): Color {
    return FACTION_COLOR_BY_FACTION[owner];
}

/** 「离灰度」倍数：越大越饱和。1 = 原样。 */
export const ZC_DEEP_SATURATION = 1.45;
/**
 * 饱和度拉高之后再整体压暗的比例，制造「更深」的观感。
 *
 * 🔴 2026-10-16 反馈「**铺场动画的颜色要偏亮**」：`0.78 → 0.90`。
 * 压暗是 row8 要的「更深」，但 0.78 在整盘大色块上读起来偏闷；0.9 让每个阵营统一亮约 15%
 * （实测：我方 `#5c61c7 → #6a70e6`、敌方 `#c72549 → #e62b54`、3 号 `#c79f0b → #e6b80d`、
 * 4 号 `#a926c7 → #c32be6`、中立 `#93acb8 → #aac6d5`）。
 *
 * ⚠️ **上界不是 1**：回正段是「深色 → 阵营当前色」，取到 1 就等于两端同色，
 * 回正这一段（以及它的方向）就看不见了。0.9 留了约 10% 的明度差，回正仍然读得出来。
 * 想再亮就往 0.95 试，别越过 1。
 */
export const ZC_DEEP_DARKEN = 0.9;

/**
 * 同色相的**深饱和版**阵营色 —— 结算扫场铺底色用（需求 2026-10-15 row8 原文：
 * 「用和阵营颜色一致，但**饱和度更深**的颜色填充格子」）。
 *
 * 纯 RGB 的「离灰更远 + 整体压暗」两步，**不碰 HSV**：
 *  - 先用 `lum = 0.299r + 0.587g + 0.114b` 取亮度，把每个通道**推离**亮度 ⇒ 饱和度↑；
 *  - 再整体乘 `ZC_DEEP_DARKEN` ⇒ 明度↓（"更深"）。
 *
 * 为什么不用 `Color.toHSV()`：这条曲线要在**没有引擎、没有 `cc`** 的纯函数用例里被逐点断言
 * （`tests/helpers` 的 `Color` 桩没有 HSV 接口），而且引擎那套 `h∈[0,360]` 的往返换算在
 * 灰度像素上会丢色相。两步整数算式没有这些边角。
 *
 * 实测（`ZC_CLIENT_COLORS`，可直接对着 `sweepFill` 的 `mix = 0` 验，按当前 `ZC_DEEP_DARKEN = 0.9`）：
 * 我方 #7e82ff → #6a70e6（更浓的靛蓝）、敌方 #fb4969 → #e62b54（更实的砖红）、
 * 3 号 #fbcc49 → #e6b80d（更沉的金黄）、4 号 #bd49fb → #c32be6（更深的紫）、
 * 中立 #c4dae5 → #aac6d5（更实的石板灰）。
 */
export function zcDeepFactionColor(owner: ZCFaction, alpha = 255): Color {
    const base = zcFactionColor(owner);
    const lum = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b;
    const deepen = (channel: number): number => {
        // ⚠️ 顺序不能反：**先夹再压暗**。拉饱和会把已到顶的通道推过 255（#7e82ff 的蓝 = 305），
        // 先夹掉才是「同色相更饱和」，先压暗则会把那段溢出流成一个**偏色**的中间值
        //（238 而不是 199），观感上会往蓝紫跑。
        const saturated = Math.max(0, Math.min(255, lum + (channel - lum) * ZC_DEEP_SATURATION));
        return Math.max(0, Math.min(255, Math.round(saturated * ZC_DEEP_DARKEN)));
    };
    return new Color(deepen(base.r), deepen(base.g), deepen(base.b), alpha);
}

/**
 * 把任意颜色往**白**里偏 `amount`（`0` = 原样、`1` = 纯白）—— 结算扫场铺场时的闪烁用
 * （需求 2026-10-16：「颜色在同色系偏白色的范围内快速变化」）。
 *
 * 逐通道线性插值到 255，**纯 RGB、不碰 HSV**（理由同 `zcDeepFactionColor`：要在没有引擎的
 * 纯函数用例里逐点断言，而且 HSV 往返在灰度像素上会丢色相）。
 *
 * 往白里偏**天然保持色相**（每个通道都朝同一个终点走，通道间的大小关系与比例不变），
 * 所以偏出来的一定是「同色系偏白」而不是「另一个颜色」—— 这正是需求要的观感。
 *
 * `alpha` 原样带过：闪烁只改颜色不改透明度（透明度是「这一格是领地还是中立」的语义，
 * 不该跟着闪）。
 */
export function zcTowardWhite(color: Color, amount: number): Color {
    if (!(amount > 0)) return new Color(color.r, color.g, color.b, color.a);
    const k = Math.min(1, amount);
    const mix = (channel: number): number => Math.round(channel + (255 - channel) * k);
    return new Color(mix(color.r), mix(color.g), mix(color.b), color.a);
}

