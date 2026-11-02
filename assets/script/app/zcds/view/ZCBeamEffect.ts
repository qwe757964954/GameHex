/**
 * 镭射光束类特效的**发射点 / 朝向 / 长度**（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * 背景（2026-10-31 需求）：
 *   镭射飞龙的普攻原本借的是 `风法师_绿风`（青色月牙），落地效果是一条通用短线。
 *   现在改用美术给的 19 帧横躺光束 `units/projectiles/镭射飞龙_普攻`，要求是
 *   **从龙眼发射、线的另一端指向受击目标**，这条线要多长就有多长
 *   （技能的「贯穿全场」靠拉伸同一份预制体实现，不再另做长条资源）。
 *
 * 为什么单独一个模块：这里只回答"画在哪、朝哪、多长"，不碰任何结算；
 * 混进 `ZCCombatEffectView` 就没法在没有 `cc` 的环境里逐点断言了
 * （同 `ZCCombatEffectPlacement` 的口径）。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**。
 */

/** 一段光束：发射口相对单位中心怎么挪、亮度怎么加粗。 */
export interface IZCBeamSpec {
    /** 发射口沿弹道方向**前伸**多少（视图单位，跟着朝向转）。 */
    readonly muzzleForward: number;
    /** 发射口在**竖直方向**抬多少（视图单位，世界竖直、不跟弹道旋转）。 */
    readonly muzzleLift: number;
    /**
     * 光柱的**基准**宽度倍率（乘在预制体原始高度上）。
     *
     * 定 0.65 的来历：原画是 1130x93 的一条横躺光束，长厚比 12.2:1；预制体画布 640x53。
     * 让它落在「550 射程」那一档（视图长度 165×2.5625 ≈ 423）时还保持原画比例，就要求
     * 厚度 ≈ 423 / 12.2 ≈ 35，而 35 / 53 ≈ 0.65。**只缩竖轴、不缩横轴** ——
     * 横轴永远等于「长度 / 画布宽」，所以光柱不管是 1 格还是半个战场，粗细都是这一档。
     */
    readonly widthScale: number;
    /**
     * 按技能 id 追加的宽度**倍率**（在 `widthScale` 之上再乘）。
     *
     * 为什么需要：普攻（30719）与「镭射死光」（30845，走 `empoweredSkillId`）**共用同一份美术**，
     * 但设计案要求死光是更粗的一根（表现列原话「循环加粗使用【镭射飞龙的普通攻击】」）。
     * 为了改个宽度复制一份 19 帧图集太亏，按技能号挂一个倍率就够了。
     */
    readonly widthMultiplierBySkill?: Readonly<Record<number, number>>;
}

/**
 * 按**特效 prefab 路径**登记光束；没登记的一律走原来的「移动小图」弹道口径。
 *
 * 用路径而不是技能 id：普攻（30719）与强化那一击「镭射死光」（30845）共用同一份美术，
 * 配一次两条都对；将来换成更长的光束也只改这一处。
 */
const BEAM_BY_PREFAB_PATH: Readonly<Record<string, IZCBeamSpec>> = {
    //  镭射飞龙（68010）。龙眼在骨架胸口以上、略偏前：前伸 34、上抬 16（视图单位，
    //  1 个格距 ≈ 90）。数值不对就只改这两个数 —— 它们不参与任何结算。
    'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻': {
        muzzleForward: 34,
        muzzleLift: 16,
        widthScale: 0.65,
        //  「镭射死光」= 同一根光束的加粗版（设计案 L1/L2/L3 的 1.0/1.3/1.6 先落到 1.3 这一档）。
        widthMultiplierBySkill: { 30845: 1.3 },
    },
};

/** 光束最短长度（视图单位）：贴脸时 `to` 可能落在发射口后面，缩成 0 会整条消失。 */
export const ZC_BEAM_MIN_LENGTH = 6;

/** 这条技能该用多粗：`widthScale × （该技能号的追加倍率 ?? 1）`。 */
export function zcBeamWidthScaleOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    const multiplier = skillId === undefined ? 1 : (spec.widthMultiplierBySkill?.[skillId] ?? 1);
    return spec.widthScale * multiplier;
}

/** 特效路径 → 光束配置。未登记 = `null`（走通用弹道）。 */
export function zcBeamSpecOf(effectPrefabPath: string | null | undefined): IZCBeamSpec | null {
    if (!effectPrefabPath) return null;
    return BEAM_BY_PREFAB_PATH[effectPrefabPath] ?? null;
}

/** 光束在**视图坐标**下的一帧：原点、角度、长度。 */
export interface IZCBeamFrame {
    /** 发射口（= 特效节点的摆放位置）。 */
    readonly x: number;
    readonly y: number;
    /** 顺时针为正的旋转角（度），与 `Node.setRotationFromEuler` 同一口径。 */
    readonly angleDegrees: number;
    /** 从发射口到弹头端的长度（视图单位），乘 `1 / 画布宽度` 就是节点 `scaleX`。 */
    readonly length: number;
}

/**
 * 端点（弹头当前位置）→ 一帧光束。
 *
 * 传入的 `from` / `to` 必须**已经是视图坐标**（`mapToViewX/Y` 之后）：
 * 地图的逻辑 x/y 与视图不是等比的（列 36→92.25、行 42→90），
 * 在地图坐标里算角度会把斜向的光束掰歪。
 *
 * 长度只算到弹头，不是一口气算到目标点 —— 这样"光柱扫出去"和"伤害到达"是同一时刻，
 * 不会出现光柱已经顶到人、伤害还在飞的表现。
 */
export function zcBeamFrame(
    from: Readonly<{ x: number; y: number }>,
    to: Readonly<{ x: number; y: number }>,
    spec: IZCBeamSpec,
): IZCBeamFrame {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    // 两端重合（刚出手那一帧）时没有方向可言，按"朝右"退化成一条最短的线。
    const angle = span === 0 ? 0 : Math.atan2(dy, dx);
    //  贴脸时目标比"前伸量"还近：硬把发射口推到目标前面，光束会朝反方向射出去。
    //  所以前伸最多吃掉半程，剩下的至少还有半个身位留给光束。
    const forward = Math.min(spec.muzzleForward, span * 0.5);
    const x = from.x + Math.cos(angle) * forward;
    const y = from.y + Math.sin(angle) * forward + spec.muzzleLift;
    return {
        x,
        y,
        angleDegrees: angle * 180 / Math.PI,
        length: Math.max(ZC_BEAM_MIN_LENGTH, Math.hypot(to.x - x, to.y - y)),
    };
}
