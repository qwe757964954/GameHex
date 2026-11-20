/**
 * 闪电链（chain_damage）的 facade：路径 / 行为键 / 逐跳时长 / 透明度曲线 / **分段几何**。
 *
 * 路径、行为键、调参已迁到目录（`ZCEffectCatalog`）与调参表（`ZCEffectTuning`）；
 * 本文件保留原导出名、纯函数，以及「一条链怎么铺成 n 段」这一处几何口径。
 *
 * ── 段间贴合（2026-11-19 第 23 批）──────────────────────────────────────────
 *
 * 用户原话「闪电链的预制应该贴合，不能留有缝隙」。缝隙的病根不在摆位，在**贴图本身**：
 * 素材底端（锚点侧）有一截是全透明的，`rect` 却把那一截算进了高度，节点原点钉的是
 * rect 边界而不是有像素的那一端 ⇒ 每段尾巴都空着一条透明缝，n 段就是 n 条缝。
 *
 * 修法是三件事一起做，少一件都会重新裂开：
 *   ① 节点沿长轴**后退** `ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH`（`offsetX/offsetY`），
 *      让「有像素的那一端」正好起在段起点；
 *   ② 沿长轴倍率按**可见长度**算（`ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH`）。用 rect 长度
 *      当分母会少盖 3%+，接缝照样漏 —— 这就是「乘 0.76875 屏上换算」最容易被忽略的一步；
 *   ③ 再吃掉 2 屏上 px 的重叠（`ZC_CHAIN_SEGMENT_OVERLAP_SCREEN_LENGTH`），让接缝两侧
 *      的弱像素叠住，而不是各让一半留出一条亮线。
 * 结果：内容末端 == 下一段起点，一段不多一段不少（`tests/zcds-chain-lightning.test.ts` 锁死）。
 *
 * 换美术必须同步改两个常量：`ZC_CHAIN_SEGMENT_SCREEN_LENGTH`（rect 高 × 预制 `_lscale.y`）
 * 与 `ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH`（锚点侧透明留白）。改漏了**不报错**，
 * 屏幕上也看不出红叉 —— 只是接缝又悄悄出现。
 */

import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from './ZCEffectCatalog';
import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

/** 闪电链的行为键。*/
export const ZC_CHAIN_BEHAVIOR_KEY = ZC_EFFECT_BEHAVIOR_KEYS.chainDamage;

/**
 * 每段电弧的 prefab（2026-11-19 第 23 批换成【闪电链水墨风】）。
 *
 * 换素材前这里与五雷轰顶（`bolt_strike`）共用 `磁电菇_劈雷技能` 那张落雷图 ——
 * 落雷是「一端亮团、一端细丝」的造型，首尾相接会变成亮团接细丝，看起来一坨一坨的。
 * 水墨风两端都是实心笔触，才是能拼的链条。
 */
export const ZC_CHAIN_EFFECT_PREFAB_PATH = ZC_EFFECT_PATHS.chainArc;

/** 单跳表现存活时长（秒）。*/
export const ZC_CHAIN_EFFECT_SECONDS = ZC_EFFECT_TUNING.chainSeconds;

/** 逐跳的表现间隔（秒）。*/
export const ZC_CHAIN_STEP_SECONDS = ZC_EFFECT_TUNING.chainStepSeconds;

/** 首跳之后的每一跳透明度递减量。*/
export const ZC_CHAIN_FADE_STEP = ZC_EFFECT_TUNING.chainFadeStep;

/** 透明度下限。*/
export const ZC_CHAIN_FADE_FLOOR = ZC_EFFECT_TUNING.chainFadeFloor;

/**
 * 屏上 px ÷ 世界 px = 2.5625。
 *
 * 屏上 = 逻辑 × 0.76875、世界 = 逻辑 × `combatDistanceScale` 0.3 ⇒ 0.76875 / 0.3。
 * 下面的常量都用「屏上」写（美术给的是屏上尺寸），落位时才换算成世界坐标。
 */
export const ZC_CHAIN_SCREEN_PER_WORLD = 2.5625;

/**
 * 一段的**rect 长度**（屏上 px）：`闪电链水墨风` 画布高 280 × 预制 `_lscale.y` 0.666666。
 *
 * 2026-11-19 第二轮：用户「整个特效的 size 放大成 2」⇒ 预制缩放 0.333333 → 0.666666，
 * 这里从 93.333 变 186.666，段数随之减半（同样距离用更少、更粗的段拼）。
 * 换素材第一件事就是重算这个数，`tests/zcds-chain-lightning.test.ts` 直接读 prefab 对账。
 */
export const ZC_CHAIN_SEGMENT_SCREEN_LENGTH = 186.666;

/**
 * 锚点侧**全透明**的留白（屏上 px）。
 *
 * 水墨风 `frame_01`：内容占 y 2..281、rect 2..282 ⇒ 底端只剩 1px 偷不着像素；
 * 旧落雷图是 11px（透明占满 12.4%），那才是缝隙的主因。
 */
export const ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH = 1;

/** 真正有像素的长度（屏上 px）。*/
export const ZC_CHAIN_SEGMENT_VISIBLE_SCREEN_LENGTH
    = ZC_CHAIN_SEGMENT_SCREEN_LENGTH - ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH;

/**
 * 相邻两段故意叠掉的长度（屏上 px）。
 *
 * 贴图两端的笔触边缘是弱像素（半透明），首尾刚好相切时接缝处会透出一条比周围亮的线；
 * 重叠 2px 让两侧的弱像素互相盖住。
 */
export const ZC_CHAIN_SEGMENT_OVERLAP_SCREEN_LENGTH = 2;

/** 一段的长度（世界 px），段数按它算。*/
export const ZC_CHAIN_SEGMENT_WORLD_LENGTH
    = ZC_CHAIN_SEGMENT_SCREEN_LENGTH / ZC_CHAIN_SCREEN_PER_WORLD;

/** 锚点侧透明留白（世界 px）：节点要沿长轴后退这么多。*/
export const ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH
    = ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH / ZC_CHAIN_SCREEN_PER_WORLD;

/**
 * 一段实际能盖住的长度（世界 px）= 可见长度 − 重叠。
 *
 * 这是 `stretch` 的**分母**。分母取 rect 长度 ⇒ 每段少盖 12%，接缝照漏（旧版的病）。
 */
export const ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH
    = (ZC_CHAIN_SEGMENT_VISIBLE_SCREEN_LENGTH - ZC_CHAIN_SEGMENT_OVERLAP_SCREEN_LENGTH)
        / ZC_CHAIN_SCREEN_PER_WORLD;

/**
 * 节点 z 轴要补的角度：美术把闪电**竖着**画（长轴 = 本地 +y），
 * 而 `angleDegrees` 的口径是「长轴指向 +x」，所以链路方向还要再 −90°。
 */
export const ZC_CHAIN_SEGMENT_ANGLE_OFFSET_DEGREES = -90;

/** 一条链的几何：段数、每段位移、锚点后退量、长轴倍率、节点角度。*/
export interface ZCChainArcPieceLayout {
    /** 段数（至少 1；跟随车道会把它冻结下来，之后只拉伸不重算）。*/
    readonly count: number;
    /** 一段的位移向量（世界 px）。*/
    readonly stepX: number;
    readonly stepY: number;
    /** 节点锚点相对段起点的偏移：沿长轴**后退**贴图的透明留白。*/
    readonly offsetX: number;
    readonly offsetY: number;
    /** 沿长轴（本地 +y）的倍率；只压长轴，不许把闪电拉粗。*/
    readonly stretch: number;
    /** 节点角度（`angleDegrees` 口径，已含 −90°）。*/
    readonly angleDegrees: number;
}

/**
 * 算一条「从 `from` 指向 `to`」的链要怎么分段。
 *
 * `pieceCount` 只在**跟随**时传：段数是建链那一刻定下的，敌人跑远之后只拉长这一段，
 * 不能让段数变多（多出来的段没人创建 ⇒ 缺口）。
 *
 * @param fallbackRadians 两点重合时的方向兜底（跟随车道传上一帧的朝向，免得甩成 0°）
 */
export function zcChainArcPieceLayout(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    fallbackRadians = 0,
    pieceCount?: number,
): ZCChainArcPieceLayout {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const span = Math.hypot(dx, dy);
    //  两点重合：没有方向可言，退回调用方给的兜底角，长度按 0 处理（stretch 兜 1）。
    const dirX = span > 1e-6 ? dx / span : Math.cos(fallbackRadians);
    const dirY = span > 1e-6 ? dy / span : Math.sin(fallbackRadians);
    const count = Math.max(
        1,
        Math.round(pieceCount ?? Math.ceil(span / ZC_CHAIN_SEGMENT_WORLD_LENGTH - 1e-6)),
    );
    const step = span / count;
    return {
        count,
        stepX: dirX * step,
        stepY: dirY * step,
        offsetX: -dirX * ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH,
        offsetY: -dirY * ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH,
        stretch: step > 1e-6 ? step / ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH : 1,
        angleDegrees: Math.atan2(dirY, dirX) * 180 / Math.PI + ZC_CHAIN_SEGMENT_ANGLE_OFFSET_DEGREES,
    };
}

/** 第 `index` 跳（0 起）的透明度。*/
export function zcChainEffectAlpha(index: number): number {
    if (!(index > 0)) return 1;
    return Math.max(ZC_CHAIN_FADE_FLOOR, 1 - ZC_CHAIN_FADE_STEP * index);
}

/** 行为键 → 闪电链的表现路径；不是闪电链返回空数组。*/
export function zcChainLightningEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    return behaviorKey === ZC_CHAIN_BEHAVIOR_KEY ? zcEffectPathsForBehavior(behaviorKey) : [];
}
