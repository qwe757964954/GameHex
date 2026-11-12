/**
 * 镭射光束类特效的**发射点 / 朝向 / 长度**（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * 背景（2026-10-31 需求）：
 *   镭射飞龙的普攻原本借的是 `风法师_绿风`（青色月牙），落地效果是一条通用短线。
 *   现在改用美术给的横躺光束序列帧 `units/projectiles/镭射飞龙_普攻`
 *   （2026-11-10 已从 19 帧旧版换成 16 帧 `loop4_00~15`），要求是
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
     * 画布内**实际线条**的起止位置（占画布宽度的比例）。
     *
     * 现在这套美术是 700×73 的画布、线条画在 x ∈ [72, 628]（两端各留 72 给发射口辉光
     * 和末端柔光溢出）。不做这个校正会有两处肉眼可见的错位：起点比发射口**晚 10%**
     * （长射程下 ≈ 40px，看起来"没从嘴里出来"）、终点比弹头**早 10%**（≈ 40px，
     * 看起来"没打到人"）。
     *
     * 🔴 2026-11-05：**19 帧的可见范围原来并不一致**（实测左端 3~118、右端 476~573，
     * 长度差 115px = 画布 18%）。所以上面这两个常数只在某一帧对得上：帧 01~07 的末端正好到 100%，
     * 而帧 08~18（占了 58% 的播放时间）末端只到 **85~90%** ⇒ 光柱末端周期性地"缩回去" 10~15%，
     * 用户反馈「终点距离目标图像很远」就是它。当时代在 `atlas/*.png` 里把每帧的可见段横向
     * **归一化到 [32, 556]**（画布尺寸/帧数/uuid 全不变），19 帧末端现在都落在弹头上。
     *
     * 🔴 2026-11-10 换新素材（`loop4_00~15`，16 帧，源图 1165×73）时这个坑**又出现了一次**：
     * 新图的可见段左端在 83~88 之间晃、右端从 704 一路漂到 **1097**（帧 10 起尾巴上还甩出
     * 一颗小光斑往前飞）。已在 `tools/build_laser_beam_fx.py` 的 `normalize_frame` 里重新归一化：
     * 每帧**主体**统一映射到 [72, 628]、那颗飞行光斑被画布右边界裁掉，画布随之变成 700×73。
     * ⚠️ 换素材或重导图集时，要么重新归一化，要么回来重算这两个数。
     */
    readonly contentStart: number;
    readonly contentEnd: number;
    /**
     * 光柱的**基准**宽度倍率（乘在预制体原始高度 73 上）。
     *
     * ⚠️ 不要按「整张画布的长厚比」定这个值。2026-11-02 实测：当年那张 53px 高的画布里，
     * **真正不透明的亮芯只有 5~9px**，均值透明度 ≈ 100/255；按画布比例取的 0.65 落到屏幕上
     * = 亮芯 **3px、四成透明**，在沙漠色地块上等于「子弹模型消失了」。
     *
     * 2026-11-10 新素材的亮度分布和旧图**不一样**（更细更亮的芯 + 更宽的柔光）：
     * 73px 高的画布里亮芯只有 **4.6px**、柔光带却有 **52px**（旧图是 6.6 / 29）。
     * 所以不能再按 53×1.26 那套抄，而是按「光柱的**发光总量**和旧素材对齐」反推：
     * 旧 = 2990(列 α 和) × 1.26 = 3767，新素材列 α 和 ≈ 4700 ⇒ 0.80（此时柔光带 41.6px、
     * 亮芯 3.7px）。在沙漠底色上做过同尺寸对比：0.70 偏细、0.95 偏粗、0.80 与旧素材观感最接近。
     */
    readonly widthScale: number;
    /** 美术缺失时的兜底线宽（视图 px），与 `widthScale` 同一套追加倍率。 */
    readonly coreWidth: number;
    /**
     * 末端**竖直**再抬多少（视图 px，世界竖直、不跟弹道旋转）。
     *
     * 2026-11-03 需求：「光柱尾端命中目标的判断不够准，应该再长一点，和目标角色的模型的中心坐标」。
     * 两件事叠在一起才看得出「没打到人」：
     *   ① 碰撞判定用的是**受击圈**，弹道被摘掉时钉在圈的**边缘**而不是圆心；
     *   ② 单位根节点是**脚点**，而模型中心在脚点上方几十像素。
     * 所以末端要沿竖直方向补这一截，让线头落在身体上而不是脚下。
     *
     * 只改终点、不改发射口 —— 长射程下角度几乎不动，短射程时会自然抬高成一个上挑角度，
     * 正好就是「瞄准身上」的观感。
     */
    readonly tailLift?: number;
    /**
     * 「超长射线」的固定长度（视图 px）：登记了它的技能**不看实际到达点**，一律拉这么长。
     *
     * 2026-11-03 需求：「镭射死光的起始位置应该是镭射飞龙的眼睛位置，终点位置才是屏幕位置
     * （或者是一个超长的单位距离 18 个格子长），但是尾端的方向需要朝向目标」。
     * 18 格 × 90px/格 = 1620 —— 比一屏还长，所以"打到屏幕外"天然成立。
     *
     * 方向仍由调用方给的瞄准点决定：视图这一支传**目标坐标**而不是弹头坐标，
     * 否则第一帧弹头还在发射口、方向算出来是"朝右"（`span = 0` 的退化分支）。
     */
    readonly overShootBySkill?: Readonly<Record<number, number>>;
    /**
     * 按技能 id 追加的宽度**倍率**（在 `widthScale` 之上再乘）。
     *
     * 为什么需要：普攻（30719）与「镭射死光」（30845，走 `empoweredSkillId`）**共用同一份美术**，
     * 但设计案要求死光是更粗的一根（表现列原话「循环加粗使用【镭射飞龙的普通攻击】」）。
     * 为了改个宽度复制一份 16 帧图集太亏，按技能号挂一个倍率就够了。
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
    //  镭射飞龙（68010）。⚠️ 单位根节点是**逻辑脚点**（`ZCUnitView` 口径：spine 骨架原点≈脚底），
    //  不是身体中心 —— 所以「龙眼」要抬到 +44 才算头部，原来的 +16 其实是从脚踝射出来的。
    //  抬到眼睛后，线自然从高处指向目标脚点，正好就是需求里「高处攻击低处」的倾斜感。
    //  数值不对就只改这两个数 —— 它们不参与任何结算。
    'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻': {
        muzzleForward: 8,
        muzzleLift: 44,
        //  实测自 `atlas/zheerniyasi_buff-xian_loop4_*.png`：16 帧归一化后主体都落在
        //  x ∈ [72, 628]（画布 700×73）。见 `normalize_frame`。
        contentStart: 72 / 700,
        contentEnd: 628 / 700,
        widthScale: 0.8,
        coreWidth: 10,
        //  末端补到**模型中心**（2026-11-03 用户截图：线头停在目标脚下，看着"没打到人"）。
        //  30 是「脚点 → 胸口」的视图距离；改这个数只影响线头高低，不参与任何结算。
        tailLift: 30,
        //  「镭射死光」= 同一根光束的加粗版（设计案 L1/L2/L3 的 1.0/1.3/1.6 先落到 1.3 这一档）。
        widthMultiplierBySkill: { 30845: 1.3 },
        //  「镭射死光」是一道贯穿全屏的超长射线：18 格 × 90px/格 = 1620（比一屏还长）。
        overShootBySkill: { 30845: 1620 },
    },
};

/** 光束最短长度（视图单位）：贴脸时 `to` 可能落在发射口后面，缩成 0 会整条消失。 */
export const ZC_BEAM_MIN_LENGTH = 6;

/** 这条技能该用多粗：`widthScale × （该技能号的追加倍率 ?? 1）`。 */
export function zcBeamWidthScaleOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return spec.widthScale * beamMultiplierOf(spec, skillId);
}

/** 美术没加载时那条兜底线该多粗（视图 px）。 */
export function zcBeamCoreWidthOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return spec.coreWidth * beamMultiplierOf(spec, skillId);
}

function beamMultiplierOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    return skillId === undefined ? 1 : (spec.widthMultiplierBySkill?.[skillId] ?? 1);
}

/** 这条技能是不是「超长射线」，是的话固定拉多长（视图 px）；0 = 不是。 */
export function zcBeamOvershootOf(spec: IZCBeamSpec, skillId: number | undefined): number {
    if (skillId === undefined) return 0;
    const reach = spec.overShootBySkill?.[skillId] ?? 0;
    return Number.isFinite(reach) && reach > 0 ? reach : 0;
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
    skillId?: number,
): IZCBeamFrame {
    //  末端抬到模型中心（尾端「再长一点」）；缺省 0 ⇒ 与改前逐字一致。
    const endX = to.x;
    const endY = to.y + (spec.tailLift ?? 0);
    const dx = endX - from.x;
    const dy = endY - from.y;
    const span = Math.hypot(dx, dy);
    // 两端重合（刚出手那一帧）时没有方向可言，按"朝右"退化成一条最短的线。
    const angle = span === 0 ? 0 : Math.atan2(dy, dx);
    //  贴脸时目标比"前伸量"还近：硬把发射口推到目标前面，光束会朝反方向射出去。
    //  所以前伸最多吃掉半程，剩下的至少还有半个身位留给光束。
    const forward = Math.min(spec.muzzleForward, span * 0.5);
    const x = from.x + Math.cos(angle) * forward;
    const y = from.y + Math.sin(angle) * forward + spec.muzzleLift;
    //  超长射线（镭射死光）：长度写死，不看实际到达点 —— 它要的是"一路射到屏幕外"，
    //  而不是"打到谁就停在谁身上"。方向仍来自 `to`（调用方传的是目标坐标）。
    const overshoot = zcBeamOvershootOf(spec, skillId);
    const length = overshoot > 0
        ? overshoot
        : Math.max(ZC_BEAM_MIN_LENGTH, Math.hypot(endX - x, endY - y));
    return {
        x,
        y,
        angleDegrees: angle * 180 / Math.PI,
        length,
    };
}

/** 光束预制体的拉伸参数（作用在美术子节点上，不是宿主节点）。 */
export interface IZCBeamStretch {
    /** 子节点 `scale.x`：让**画布里的可见段**正好等于 `length`。 */
    readonly scaleX: number;
    /** 子节点 `position.x`：把画布左侧的留白推到锚点外面，让线条起点落在锚点上。 */
    readonly offsetX: number;
}

/**
 * 「发射口 → 弹头」这一段长度 → 预制体的 `scaleX` 与横向位移。
 *
 * 为什么不能直接 `length / canvasWidth`：画布里线条只占 `[contentStart, contentEnd]`，
 * 直接按画布宽拉伸会让可见段缩到 ~82%、并且整体晚起 5%（见 `IZCBeamSpec.contentStart`）。
 * 这里按**可见段**归一化，顺带把左侧留白挪到锚点之外，于是「节点原点 = 发射口、
 * 线条末端 = 弹头」两件事同时成立。
 */
export function zcBeamStretchOf(
    spec: IZCBeamSpec,
    canvasWidth: number,
    length: number,
): IZCBeamStretch {
    const contentWidth = Math.max(1, (spec.contentEnd - spec.contentStart) * canvasWidth);
    const scaleX = Math.max(ZC_BEAM_MIN_LENGTH, length) / contentWidth;
    return { scaleX, offsetX: -spec.contentStart * canvasWidth * scaleX };
}
