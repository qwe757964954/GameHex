/**
 * 六边形地块「抬起 → 收掉 / 翻面」的动作曲线（**纯函数，零 `cc`**）。
 *
 * 两条收场曲线，各自服务的场景不同：
 *  - `hexFlipFoldFx` / `hexFlipUnfoldFx`：抬起后**绕水平轴压扁**（领地地图的随机资源格翻开）；
 *  - `hexShrinkFx` / `hexShrinkBackFx`：**原地缩到最小**（对局的开发激活，2026-10-14 起；
 *    2026-10-15 起**不带任何位移** —— 见那边的说明）。
 *
 * ⚠️ **时长仍然是两边共用的**（`HEX_FLIP_SECONDS` / `HEX_FLIP_RISE_RATIO` / `HEX_FLIP_LIFT_PIXELS`
 * 与底部光那套强度曲线）：两处「抬手 → 收场 → 落回」的**节奏**由此保持一致，只是收场的
 * 形状不一样。各自的后续接线（对局接卡牌揭示 + 建筑生成 / 领地接奖励弹窗）留在各自视图里。
 *
 * 为什么单拆成模块：两条路径分属两个 app feature，按 AGENTS.md 的依赖方向
 * （feature 之间禁止互相 import）不能互相引用，只能落到 `core`；顺带也让它成为
 * 「不需要 cc 就能单测」的地块动作真源。
 */

/** 翻面段地块抬起的像素高度（格子整图 130×119 ⇒ 抬约 3/8 格）。 */
export const HEX_FLIP_LIFT_PIXELS = 48;

/**
 * 翻转轴心相对**整图中心**的上移量（像素）。
 * 默认 `0` = 绕整图中心翻；给成 12.5（= 顶面中心）观感会变成「从顶部翻出去」。
 */
export const HEX_FLIP_PIVOT_LIFT = 0;

/**
 * 翻面段内部「**先抬起、再原地翻面**」的分界比例。
 *
 * 两者必须串行：同步线性时轴心会跟着地块一起往上跑，视觉上读不出「绕固定的一条中心线翻」。
 */
export const HEX_FLIP_RISE_RATIO = 0.45;

/**
 * **翻面段时长（秒）**：「抬起 + 原地压扁」。
 *
 * 对局（开发激活）与领地地图（随机资源格翻开）共用这 0.384s —— 两处翻格的**节奏**才一致。
 * 对局的卡牌揭示要把起点推到这一刻（`ZCCardReveal.startedAt = now + 本值`）。
 */
export const HEX_FLIP_SECONDS = 0.384;

/**
 * **没有卡牌接棒**时，收场段之后把地块**复原**的时长（秒）。
 *
 * 对局的卡牌独占段、领地的奖励弹窗都不需要它 ⇒ 取 0.05s（3 帧@60fps，只看得见「回」
 * 这一下的方向，不再是一段动画）。设 `0` = 收场段结束那一帧就复位。
 * 两处的方向不同：领地是**合回去**（反向压扁），对局是**缩回来**（放大回原尺寸）。
 */
export const HEX_FLIP_FOLD_SECONDS = 0.05;

/**
 * 绕水平轴翻转的**透视强度**（真 3D 透视除法的近大远小系数；`0` = 纯压扁）。
 * 只在视图拿到 `shaders/hex-flip.effect` 时生效；拿不到就退回等比压扁。
 *
 * `0.42` 配合材质里的非对称系数 ⇒ 侧视那一瞬远端约收至 `0.43`、近端约放至 `1.23`。
 */
export const HEX_FLIP_PERSPECTIVE = 0.42;

/** 地块收场的每帧参数。 */
export interface IZCHexFlipFx {
    /** 整格不渲染（对局的「卡牌独占视线」段用；领地不用）。 */
    hidden: boolean;
    /**
     * 整格 Y 上移像素（0 = 布局原位）。
     *
     *  ⚠️ 只有**翻面**那两条曲线（`hexFlipFoldFx` / `hexFlipUnfoldFx`）会给出非零值 ——
     *  它们要靠抬起让压扁绕一条固定的中心线走。缩没那两条（`hexShrinkFx` / `hexShrinkBackFx`）
     *  自 2026-10-15 起恒 `0`：需求要的是「原地缩小」，中心点不许动（见 `hexShrinkFx` 的说明）。
     */
    tileLift: number;
    /** 绕水平轴的 2D 翻面比例：`1` = 正面朝上，`0` = 压扁成侧视。缩没段恒 `1`。 */
    tileFlip: number;
    /**
     * 整格等比缩放（`1` = 原尺寸，`HEX_SHRINK_MIN_SCALE` = 缩到最小）。
     *
     * 缩放写在**格根节点**上，所以格内的一切（地块底图、图标、价格 / 数字、血条、建筑）
     * 会一起缩 —— 这正是「地块收掉」要的观感，不需要逐个节点跟。领地的翻面不用它，恒 1。
     */
    tileScale: number;
    /** 建筑生成缩放（`0` = 这一格还没有建筑；`1` = 基准尺寸，生成动画在 0~1 之上弹）。 */
    buildingPopScale: number;
    /** 光圈半径；`0` = 不画光效。 */
    glowRadius: number;
    /** 光圈透明度 0~255。 */
    glowAlpha: number;
    /**
     * 脉冲段的**周期内相位** `[0,1)`（对局**脉冲段**专用，2026-10-15；领地不消费）。
     *
     * 视图拿它去给水波纹序列帧选帧：一个相位 = 一道完整波纹，段内有几个周期就是几道波。
     * `undefined` / 缺省 = 不在脉冲段 —— 其余几条曲线都不产出它，视图据此切换回常规做法。
     */
    pulsePhase?: number;
    /**
     * 脉冲段**波纹层的扩散倍率**（`1` = 波纹原尺寸 = 1 个格子大小，`HEX_PULSE_MAX_SCALE` = 最大扩散）。
     *
     * ⚠️ 写的是**波纹层节点**（`ZCHexView.applyPulseRipple`），**不是格根** —— 地块本体的收场归
     * 缩没段（`tileScale`）。两件事分开之后 `hexPulseFx` 的 `tileScale` 恒 `1`。
     * `undefined` / 缺省 = 不在脉冲段。
     */
    pulseScale?: number;
    /**
     * 脉冲段**外缘虚化强度** `[0,1]`（`0` = 不虚化，`1` = 外缘虚到全透）。
     *
     * 随扩散推进单调增 ⇒ 波纹越往外扩、外缘越淡、中心保持较实（冲击波观感）。
     * 消费方是脉冲专用着色器的径向遮罩（`shaders/hex-pulse.effect` 的 `pulseFade.x`）。
     */
    pulseFade?: number;
}

/**
 * 静止态（布局原位、正面朝上、原尺寸）。
 * ⚠️ **只读复用**，别改它的字段（模块级单例，改了会污染所有调用方）。
 */
export const HEX_FLIP_IDLE_FX: Readonly<IZCHexFlipFx> = {
    hidden: false, tileLift: 0, tileFlip: 1, tileScale: 1, buildingPopScale: 1, glowRadius: 0, glowAlpha: 0,
};

/** `progress` 一律 clamp 到 [0,1]：超时的激活事件与负进度都按边界处理。 */
export function clamp01(value: number): number {
    return value < 0 ? 0 : (value > 1 ? 1 : value);
}

function makeFoldFx(tileLift: number, tileFlip: number): IZCHexFlipFx {
    return {
        hidden: false, tileLift, tileFlip, tileScale: 1, buildingPopScale: 1, glowRadius: 0, glowAlpha: 0,
    };
}

function makeShrinkFx(tileLift: number, tileScale: number): IZCHexFlipFx {
    return {
        // 缩没段格子还该显示「开发前」的图标+价格数字，建筑要等卡牌淡出那段才换上来 ——
        // 所以这里 buildingPopScale 恒 0（= 还没建筑），不是 1。
        hidden: false, tileLift, tileFlip: 1, tileScale, buildingPopScale: 0, glowRadius: 0, glowAlpha: 0,
    };
}

/**
 * **翻面段**：`k ∈ [0,1]`（`0` = 布局原位正面朝上，`1` = 压扁成侧视、停在最高点）。
 *
 * `k < RISE_RATIO` 只往上送、形状不变；之后位置**停在最高点不动**，只压扁
 * ⇒ 轴心是一条**固定**的中心线（位置与形状分两段走，是这套观感的关键）。
 */
export function hexFlipFoldFx(k: number): IZCHexFlipFx {
    const t = clamp01(k);
    if (t < HEX_FLIP_RISE_RATIO) {
        return makeFoldFx(HEX_FLIP_LIFT_PIXELS * (t / HEX_FLIP_RISE_RATIO), 1);
    }
    return makeFoldFx(HEX_FLIP_LIFT_PIXELS, 1 - (t - HEX_FLIP_RISE_RATIO) / (1 - HEX_FLIP_RISE_RATIO));
}

/**
 * **合回段**：`k ∈ [0,1]`（`0` = 压扁停在最高点，`1` = 落回原位、正面朝上）。
 *
 * 就是翻面段的反向播：翻回一半时也落回一半，读起来是「合回去」而不是「原地展开」。
 */
export function hexFlipUnfoldFx(k: number): IZCHexFlipFx {
    const t = clamp01(k);
    return makeFoldFx(HEX_FLIP_LIFT_PIXELS * (1 - t), t);
}

// ── 收场第二条路：「原地缩到最小」（2026-10-14 对局的开发激活改用它） ──────────────

/** 地块缩没的终值缩放：`0.1` = 缩到 1/10，视觉上读作「收掉了」。 */
export const HEX_SHRINK_MIN_SCALE = 0.1;

/**
 * 缩没的缩放曲线：easeInCubic（**前半几乎不动、末段迅速收没**）。
 *
 * 为什么不用线性 / easeOut：这条曲线的末段最快，正好把视线交给紧接弹出的卡牌 ——
 * 地块「缩着缩着突然收干净、卡牌立刻顶上」，比匀速缩小更利落。
 */
function shrinkScaleAt(k: number): number {
    const t = clamp01(k);
    return 1 - (1 - HEX_SHRINK_MIN_SCALE) * t * t * t;
}

/**
 * **缩没段**：`k ∈ [0,1]`（`0` = 原尺寸；`1` = 缩到 `HEX_SHRINK_MIN_SCALE`）。
 *
 * 🔴 **全程零位移**（`tileLift` 恒 `0`，2026-10-15 起）。之前是「先抬起 `HEX_FLIP_RISE_RATIO`
 * 一段、停在最高点再缩」：格心在整段动画里一直在往上跑，缩没读起来是「飞走并变小」，
 * 而不是「原地收掉」；且格子被抬出布局坐标后，格内图标 / 价格数字的中心也跟着偏。
 * 现在中心点坐标恒定，缩放绕它走 ⇒ 视觉上就是**原地缩**。
 *
 * 两段式一并取消：抬起没了，前 `HEX_FLIP_RISE_RATIO`（≈0.17s）就只剩一段「什么都不发生」
 * 的空窗，读起来像卡顿。缩放直接覆盖整段 `k` —— `shrinkScaleAt` 的 easeInCubic
 * （前半几乎不动、末段迅速收没）正好接住「点击 → 略顿一下 → 收干净」的手感。
 *
 * 缩放写在格根上 ⇒ 图标、价格 / 数字、血条、建筑一起缩（需求原文：「连带着图标和数字UI一起缩小」）。
 *
 * ⚠️ 连带影响：`tileLift` 是底部开口光的驱动量（见 `hexFlipGroundGlowStrength`），
 * 恒 `0` ⇒ **对局的收场不再点亮底光**。那道光原本画的是「地块抬起后露出的原格开口」，
 * 不抬就没有开口，所以这是自洽的结果；要保留的话得另找一个驱动量，别把 `tileLift` 填回非零。
 */
export function hexShrinkFx(k: number): IZCHexFlipFx {
    return makeShrinkFx(0, shrinkScaleAt(k));
}

/**
 * **缩回段**：`k ∈ [0,1]`（`0` = 缩到最小，`1` = 原尺寸）。
 *
 * 就是缩没段的反向播，**同样零位移**（理由见 `hexShrinkFx`）：从哪里缩掉的就从那里长回来，
 * 中心点全程不动。
 *
 * 只有「点了地块但没抽到卡」时走这条（没有卡牌接棒，缩到最小后不能停在那儿：
 * 停在最小态等于格子凭空消失、露出棋盘底色）。
 */
export function hexShrinkBackFx(k: number): IZCHexFlipFx {
    return makeShrinkFx(0, shrinkScaleAt(1 - clamp01(k)));
}

// ── 收场第三条路：原地「脉冲呼吸」（2026-10-15 对局的开发激活改用它） ──────────────

/**
 * **单次脉冲的周期（秒）** = 一道水波纹从起波到收完的时间。
 *
 * 2026-10-15 山猫口径：换用美术的「翻格子」30 帧序列帧（`image/effects/hex_pulse`）
 * 之后，**一个周期正好播完一整轮 30 帧** ⇒ 周期长度直接决定波纹速度：
 * `0.7s / 30 帧 ≈ 43fps`，比美术原稿的播放节奏略快一点（"稍微加快一些"）。
 * 想更慢 / 更快只改这里，视图不用动（帧号由 `pulsePhase` 反推）。
 */
export const HEX_PULSE_CYCLE_SECONDS = 0.7;
/**
 * 脉冲段**波纹层的最大扩散倍率**（2026-10-15 row16 用户口径：「脉冲效果从缩小改成向外扩散消失，
 * 最大扩散 1.25 个单位格子大小，扩散的部分虚化」）。
 *
 * 口径：波纹本体原尺寸 = **1 个格子大小**，峰值 `1.25` ⇒ 波纹向外扩到 1.25 格。
 * 🔴 这块缩放只写**波纹层节点**（`GroundGlow`），**不写格根**：地块本体的收场由**缩没段**负责，
 * 需求明确「其他阶段的动画保持不变」。早先那版写的是格根 `tileScale` 缩到 0.92 的「原地呼吸」，
 * 已被本口径取代（`HEX_PULSE_MIN_SCALE` 随之删除）。
 */
export const HEX_PULSE_MAX_SCALE = 1.25;

/**
 * **脉冲段**：`seconds` = 段内已过秒数（不 clamp 到 [0,1]，按周期取相位循环）。
 *
 * 2026-10-15 row16 用户口径（v5：由「缩小」改成「向外扩散消失」） —— 一个周期内：
 *  · **水波纹序列帧**：由 `pulsePhase` 驱动，一轮 30 帧美术帧从中心扩散到边缘；
 *  · **向外扩散**：`pulseScale` 由 `1` 单调涨到 `HEX_PULSE_MAX_SCALE`（1.25 格）——
 *    写在**波纹层节点**上（视图会先把格根的缩放抵消掉，见 `ZCHexView.applyPulseRipple`）；
 *  · **外缘虚化**：`pulseFade` 由 `0` 单调涨到 `1`，喂给脉冲专用着色器的径向遮罩。
 *
 * 🔴 **不再写 `tileScale`**（恒 `1`）：脉冲**不再缩整格**。视图侧的合成函数 `hexPulseShrinkFx`
 * 因此只是「照抄脉冲那份、把格根缩放换成缩没的」；点击动画段整格的收小**全部由缩没段负责**，
 * 需求「其他阶段的动画保持不变」就落在这里。
 *
 * 🔴 **不再产出 `glowRadius` / `glowAlpha`**（原先那个居中圆环 2026-10-15 由序列帧取代，
 * 山猫：「中间有个圆圆的圈圈影响视觉」）。这两个字段仍留在 `IZCHexFlipFx` 里是因为
 * 领地侧共用同一份结构、以及折叠 / 缩没两条曲线还在产出它们。
 *
 * ⚠️ 与缩没段的区别：**不抬起**（`tileLift = 0`，底部序列帧光因此自然熄灭）、
 * 不缩格、建筑仍隐藏（`buildingPopScale = 0`，格子按开发前外观渲染）。
 * 段末不在此收口 —— `hexActivationFx` 按秒切段：脉冲播完接**缩没段**
 * （`hexShrinkFx`，对局 2026-10-15 起两段都要），再往后才是卡牌段 / 常规定格。
 */
export function hexPulseFx(seconds: number): IZCHexFlipFx {
    const phase = (((seconds % HEX_PULSE_CYCLE_SECONDS) + HEX_PULSE_CYCLE_SECONDS)
        % HEX_PULSE_CYCLE_SECONDS) / HEX_PULSE_CYCLE_SECONDS;
    return {
        hidden: false,
        tileLift: 0,
        tileFlip: 1,
        // 🔴 恒 1：脉冲不缩整格（row16）。缩没段照旧把格根收到 `HEX_SHRINK_MIN_SCALE`。
        tileScale: 1,
        buildingPopScale: 0,
        glowRadius: 0,
        glowAlpha: 0,
        pulsePhase: phase,
        // 扩散与虚化都随相位线性推进：起手「原尺寸 + 不虚化」，段末「1.25 格 + 外缘全虚」。
        pulseScale: 1 + (HEX_PULSE_MAX_SCALE - 1) * phase,
        pulseFade: phase,
    };
}

/**
 * **塌陷轴**：`0` = 完好，`1` = 收到底（压扁到侧视 / 缩到最小）。
 *
 * 底部光的帧序与亮灭只用这一根轴（`hexFlipGroundGlowStrength` / `hexFlipFoldProgress` 吃的
 * 都是「等价 flip = `1 - 塌陷轴`」）⇒ 翻面与缩没两种收场共用同一份底部光逻辑，
 * 不必为缩没再写一套「什么时候该灭、该播第几帧」。
 */
export function hexCollapseProgress(tileFlip: number, tileScale: number): number {
    if (tileScale < 1) return clamp01((1 - tileScale) / (1 - HEX_SHRINK_MIN_SCALE));
    return clamp01(1 - tileFlip);
}

/**
 * **反推收场进度**：由每帧拿到的 `tileLift / tileFlip` 还原出 `k ∈ [0,1]`
 * （`hexFlipFoldFx` 的逆）。
 *
 * 用在「底光序列帧」这类**没有自己时间轴**的播放上：`applyActivationFx` 是幂等的每帧调用，
 * 视图不能在里面存播放进度，只能从当前表现参数反推 —— 分段与 `hexFlipFoldFx` 一一对应：
 * 抬升段按 `tileLift` 走，压扁段按 `tileFlip` 走。
 *
 * ⚠️ 缩没段（对局）**没有 flip 变化**，调用方要把 `hexCollapseProgress` 换出来的
 * 「等价 flip」传进来（见那边的说明），否则帧序会停在抬升结束那一张不动。
 */
export function hexFlipFoldProgress(tileLift: number, tileFlip: number): number {
    if (tileFlip >= 1) return HEX_FLIP_RISE_RATIO * clamp01(tileLift / HEX_FLIP_LIFT_PIXELS);
    return HEX_FLIP_RISE_RATIO + (1 - HEX_FLIP_RISE_RATIO) * (1 - clamp01(tileFlip));
}

// ── 开口补光 / 地面光斑（对局与领地共用的观感参数） ───────────────────────────

/**
 * 正面开口边的轻微补光强度（侧面主体由地面光斑的贴边光绘制）。
 *
 * 写进 `hex-flip.effect` 的 `glowStrength`：**只剩领地翻格在消费** —— 对局自 2026-10-14
 * 改成「抬起后缩没」后不再压扁，也就不再挂那份透视材质（见 `hexFlipBodyGlow`）。
 */
export const HEX_FLIP_BODY_GLOW = 0.3;

/** 开口光峰值强度；改用序列帧后只剩「是否 > 0（总开关）」这一个作用，不再写任何 uniform。`0` = 关掉。 */
export const HEX_FLIP_GROUND_GLOW = 0.9;

/** 开口光带的横向宽度倍率 —— **shader 版旋钮**；序列帧版宽度由美术图定，此常量目前无人消费（保留给回退 shader 用）。 */
export const HEX_FLIP_GROUND_GLOW_RADIUS = 1.15;

/** 翻到侧视前，光带在最后这一段角度内平滑退场。 */
export const HEX_FLIP_GROUND_GLOW_FADE_COS = 0.35;

/** GroundGlow 的落位基准 y（格心坐标系，局部 y 向上）：灭掉 / 复位回这里，点亮时在此基础上减去抬升量。 */
export const HEX_FLIP_GLOW_MASK_OFFSET_Y = 24;

/** 立体侧面要盖住后面的底色，最终透明度仍由 Shader 按面分别控制。 */
export const HEX_FLIP_GROUND_GLOW_ALPHA = 235;

/**
 * 正面开口补光强度：随抬升量线性亮起（`tileLift = 0` 时不补光）。
 * 写进 `hex-flip.effect` 的 `glowStrength`；**目前只剩领地翻格在消费**（对局不再压扁）。
 */
export function hexFlipBodyGlow(tileLift: number): number {
    return HEX_FLIP_BODY_GLOW * clamp01(tileLift / HEX_FLIP_LIFT_PIXELS);
}

/**
 * 地面光斑（三面侧体 + 贴边光）强度：随抬升量亮起，并在**收到底之前**平滑退场。
 *
 * 退场用 smoothstep：塌陷轴（`1 - collapseFlip`）涨到 `1 - FADE_COS` 以上时归零 ——
 * 那一刻地块已经压扁成一条线 / 缩到最小，再留着光带会读成「一块悬空的亮片」。
 *
 * `collapseFlip` = **等价 flip**（`1 - hexCollapseProgress(...)`）：压扁收场直接传 `tileFlip`，
 * 缩没收场传由缩放换出来的那个值 —— 两种收场因此共用同一条亮灭曲线。
 *
 * ⚠️ 两个视图都必须走这个函数（别各自手写一遍），否则一处改了另一处不会跟。
 */
export function hexFlipGroundGlowStrength(tileLift: number, collapseFlip: number): number {
    const fade = clamp01(collapseFlip / HEX_FLIP_GROUND_GLOW_FADE_COS);
    const smooth = fade * fade * (3 - 2 * fade);
    return HEX_FLIP_GROUND_GLOW * clamp01(tileLift / HEX_FLIP_LIFT_PIXELS) * smooth;
}
