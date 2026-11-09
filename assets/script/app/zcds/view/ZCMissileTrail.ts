/**
 * 弹道拖尾（锥形 + 渐隐）——**纯数据 + 纯几何**，不 import 任何 `cc`。
 *
 * ## 需求（2026-11-05，2026-11-06 方向修正）
 *
 * 原话「增加一个倒三角的拖尾，拖尾从子弹部分向外倒三角且逐渐变透明」；
 * 2026-11-06 用户看图后纠正：「拖尾的方向做反了，末端窄，和子弹相接触的部分是宽的，
 * 宽度和子弹半径相近，屏幕上的长度改成 80px」。
 *
 * ⇒ 现在的形状（**宽端贴弹体、往外收成尖**，像一颗锥形尾焰）：
 *
 *   ```
 *        弹体 ●●●●
 *            ●●●●●●●●           ← 接触端最宽（≈ 子弹半径）
 *             ╲      ╱
 *              ╲    ╱            ← 往外线性收窄
 *               ╲  ╱
 *                ╲╱              ← 末端收成尖、α 归零
 *   ```
 *
 * 同时越往外越透明，末端完全消失（渐隐曲线没变）。
 *
 * ## 坐标系
 *
 * 拖尾画在特效**宿主节点**的 `Graphics` 上，宿主节点已经被 `ZCCombatEffectView` 转成
 * 「本地 +X = 飞行方向」。所以：
 *   · 拖尾沿 **-X** 伸展（在弹体后面）；
 *   · 宽度沿 ±Y 对称张开；
 *   · 本文件里所有长度都是**本地 px**，屏上还要乘宿主节点缩放
 *     （`zcCombatEffectNodeScaleOf`，导弹登记的是 0.8）——需要按"屏上多少 px"提需求时，
 *     先除以 0.8 再写进来（80px 屏上 = 100 本地）。
 *
 * ## 为什么不用贴图
 *
 * 拖尾是「一段会一直跟着弹体实时重绘的渐变」，用 Sprite 反而要额外造一张图 + 一个
 * 与弹体同尺寸的节点；`Graphics` 十几段梯形就能画出平滑的渐隐，且颜色/长度改一个数就生效。
 *
 * ⚠️ 本文件必须保持无 `cc` 依赖（同 `ZCBeamEffect` / `ZCCombatEffectScale`），
 * 这样几何与渐隐曲线才能在没有引擎的环境里逐点断言。
 */

/** 一条拖尾的形状与颜色。 */
export interface IZCMissileTrailSpec {
    /**
     * 起点（**贴着弹体**的那一端）在宿主节点本地坐标里的 X。
     *
     * 取负值：弹体画布 81×77、锚点 0.5 ⇒ 尾缘在 -40.5，取 -26 是让拖尾起点**压进**
     * 弹体一点点，避免飞行中弹体与拖尾之间闪出一条缝。
     */
    readonly startX: number;
    /** 拖尾总长（本地 px，沿 -X）。换算屏上：× 宿主缩放（导弹 0.8）。 */
    readonly length: number;
    /** 贴弹体那端的半宽（本地 px）—— **宽端**，应 ≈ 弹体半径。 */
    readonly rootHalfWidth: number;
    /** 远离弹体那端的半宽（本地 px）—— **窄端**，通常收到 1~3 成尖。 */
    readonly tipHalfWidth: number;
    /** 沿长度切几段；段数越多渐隐越顺，代价是每段一次 `fill()`。 */
    readonly slices: number;
    /** 颜色（rgb，0~255）。透明度只由 `alpha` 与段位置决定。 */
    readonly color: readonly [number, number, number];
    /** 起点处的不透明度（0~1）；远离弹体那端恒为 0。 */
    readonly alpha: number;
}

/** 拖尾的一段梯形（近端 `x0` 靠弹体，远端 `x1` 在更后面）。 */
export interface IZCMissileTrailQuad {
    /** 近端 X（离弹体近，|x0| 小）。 */
    readonly x0: number;
    /** 远端 X（在 x0 后面，|x1| 更大）。 */
    readonly x1: number;
    /** 近端半宽。 */
    readonly halfWidth0: number;
    /** 远端半宽。 */
    readonly halfWidth1: number;
    /** 这一段的不透明度（0~1，已乘入整体 `alpha`）。 */
    readonly alpha: number;
}

/**
 * 弹体 prefab 路径 → 拖尾配置。未登记 = 没有拖尾（普通弹道原样）。
 *
 * 只登记需要拖尾的弹体：这是**观感**配置，不是通用能力 —— 每加一个都要单独调宽窄，
 * 默认给所有弹道都挂一条只会让画面糊。
 */
const MISSILE_TRAIL_BY_PREFAB_PATH: Readonly<Record<string, IZCMissileTrailSpec>> = {
    // 镭射飞龙「追踪导弹」的弹体（`镭射飞龙_导弹技能`，81×77、可见内容 79×75）。
    //
    // 2026-11-06 按用户口径定的数（**屏上 px**，括号里是除以宿主缩放 0.8 后的本地值）：
    //   · 长度 **80px**（本地 100）；起点压进弹体 26 本地 ⇒ 从弹体边缘往外露出的可见段约 69px；
    //   · 接触端半宽 16px（本地 20）⇒ 整宽 32px，与弹体半径（屏上 63/2 ≈ 31.5）相近；
    //   · 末端半宽 1.6px（本地 2）⇒ 收成尖，且那一段 α 已经接近 0。
    // 形状是「宽端贴弹体、往外收窄」的锥形（2026-11-05 那版做反了，窄端贴弹体）。
    'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能': {
        startX: -26,
        length: 100,
        rootHalfWidth: 20,
        tipHalfWidth: 2,
        slices: 12,
        //  纯白（2026-11-06 需求「拖尾改成 255 的纯白色」）；靠 alpha 递减做渐隐，
        //  不用带色调的颜色，避免叠在深色战场上偏橙、叠在亮建筑上偏灰。
        color: [255, 255, 255],
        alpha: 0.62,
    },
};

/** prefab 路径 → 拖尾配置；未登记 / 非法入参 = `null`。 */
export function zcMissileTrailOf(prefabPath: string | null | undefined): IZCMissileTrailSpec | null {
    if (!prefabPath) return null;
    return MISSILE_TRAIL_BY_PREFAB_PATH[prefabPath] ?? null;
}

/** 所有登记过拖尾的 prefab 路径（给资源清单 / 测试用）。 */
export function zcMissileTrailPaths(): readonly string[] {
    return Object.keys(MISSILE_TRAIL_BY_PREFAB_PATH);
}

/**
 * 把一条拖尾切成 `slices` 段梯形：宽度从 `rootHalfWidth` **线性收到** `tipHalfWidth`，
 * 透明度从 `alpha` **线性衰减到 0**。
 *
 * 为什么宽度取线性：锥形的两条边必须是直线，缓动（如 t^0.7）会把边画成外凸的弧形，
 * 看起来像"尾焰"但不像一个规整的三角形。渐隐的平滑程度靠段数解决，不靠曲线。
 *
 * 方向由两个半宽的大小决定：`root > tip` = 宽端贴弹体、往外收成尖（**当前口径**）；
 * 反过来就是往外张开。函数本身不假设哪一个更大。
 *
 * @param alphaScale 额外的整体透明度倍率（0~1）。给"快命中时整体淡一点"留的口子，
 *   非法值按 1 处理，**绝不允许**把拖尾算成负数或 NaN。
 */
export function zcMissileTrailQuads(
    spec: IZCMissileTrailSpec,
    alphaScale = 1,
): IZCMissileTrailQuad[] {
    const slices = Math.max(1, Math.round(spec.slices));
    const scale = Number.isFinite(alphaScale) ? Math.max(0, Math.min(1, alphaScale)) : 1;
    const quads: IZCMissileTrailQuad[] = [];
    for (let index = 0; index < slices; index += 1) {
        //  t 用**段中点**取值：这样第 0 段不会因为 t=0 而整段不透明、
        //  最后一段也不会因为 t=1 直接跳成 0，渐变看起来是连贯的。
        const t0 = index / slices;
        const t1 = (index + 1) / slices;
        quads.push({
            x0: spec.startX - spec.length * t0,
            x1: spec.startX - spec.length * t1,
            halfWidth0: spec.rootHalfWidth + (spec.tipHalfWidth - spec.rootHalfWidth) * t0,
            halfWidth1: spec.rootHalfWidth + (spec.tipHalfWidth - spec.rootHalfWidth) * t1,
            alpha: Math.max(0, spec.alpha * (1 - (t0 + t1) / 2) * scale),
        });
    }
    return quads;
}
