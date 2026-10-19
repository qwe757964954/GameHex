/**
 * 六边形地块「抬起 → 收掉 / 碎裂」的动作曲线（**纯函数，零 `cc`**）。
 *
 * ## 领地随机资源格翻开：**只剩「原地快碎裂」**（2026-10-16 用户口径）
 *
 * 需求原文：「地块反转动画优化，两种方案都做，点击后随机播放，让我根据播放的结果判断
 * 只保留哪一种方案」⇒ 用户看完两套后拍板「**只保留地块破碎效果的方案**」。两套曾是：
 *  - **方案2**（**保留**）：`hexShatterFx` —— **原地快碎裂** → 新地块**从格心放大填充**；
 *  - **方案1**（**已整条删除**）：抬起后绕水平轴垂直翻转 360°。随它一起删掉的还有它独占的
 *    `hexTurnFx` / `HEX_TURN_SECONDS` / `HEX_TURN_FACE_SWAP` / `HEX_TURN_EDGE_FADE_COS`、
 *    随机点将 `pickHexFlipVariant`（及 `ZCHexFlipVariant`）、顶点层透视除法要用的
 *    `HEX_FLIP_PERSPECTIVE`、正面开口补光要用的 `hexFlipBodyGlow`，以及
 *    `IZCHexFlipFx.tileSin`（只有整圈翻转需要**有符号**的 sin）。
 *    `shaders/hex-flip.effect` 里对应删掉的四段（顶点 3D 旋转 + 透视除法 / 体积明暗 /
 *    侧视淡出 / 补光）都是**逐像素等价**的：`hexShatterFx` 全程 `tileFlip(cos) = 1`
 *    且 `tileLift = 0` ⇒ 旋转角 0（`q ≡ 1`）、`abs(sin) = 0`（`mix(1, shade, 0) ≡ 1`）、
 *    `glowStrength ≡ 0`、`smoothstep(0, t, |cos|) ≡ 1`。
 *
 * ⚠️ 别把方案1 的「半套」捡回来（曲线在了但着色器的 3D 段没了 ⇒ 会退化成纯压扁）。
 *    要回看旧实现走版本历史（SVN）。
 *
 * ## 对局的收场是另一条路
 *
 *  `hexShrinkFx` / `hexShrinkBackFx`（原地缩到最小，2026-10-15 起**零位移**）、
 *  `hexPulseFx`（原地脉冲呼吸）—— 见各自的说明。
 *
 * ## 仍然**共用**的东西
 *
 *  `HEX_FLIP_LIFT_PIXELS` / `HEX_FLIP_PIVOT_LIFT`、以及底部开口光那套强度与帧序推导
 *  （`hexFlipGroundGlowStrength` / `hexFlipFoldProgress`）—— 两个视图的**写口**共用一份，
 *  改一处两处一起变（⚠️ 但两条曲线现在都恒 `tileLift = 0` ⇒ 这道光两侧都不再点亮，
 *  见 `hexShrinkFx` 的连带影响说明；消费方保留，别当成「有东西会抬起」）。
 *
 *  ⚠️ 但 **`HEX_FLIP_SECONDS` 不是两边共用的时长**：领地按 `HEX_SHATTER_SECONDS` 计时，
 *  对局侧原样保留 0.384s（`ZCBattlePresentationQueue` 的 `ZC_HEX_FLIP_SECONDS`）。改它只影响对局。
 *
 * 为什么单拆成模块：两条路径分属两个 app feature，按 AGENTS.md 的依赖方向
 * （feature 之间禁止互相 import）不能互相引用，只能落到 `core`；顺带也让它成为
 * 「不需要 cc 就能单测」的地块动作真源。
 */

/**
 * 抬起段的像素高度（格子整图 130×119 ⇒ 抬约 3/8 格）。
 *
 * ⚠️ 现在**没有任何曲线产出非零抬升**（方案1 的上抛弧删除后，剩下的碎裂 / 缩没 / 脉冲都是
 * 「原地」）。它只剩「把 `tileLift` 归一化」这一个作用 —— 被 `hexFlipFoldProgress` /
 * `hexFlipGroundGlowStrength` 的强度式子引用，**别删**（那两条式子在两个视图的写口上共用；
 * 删了这个分母会让式子含义变形）。
 */
export const HEX_FLIP_LIFT_PIXELS = 48;

/**
 * 翻转轴心相对**整图中心**的上移量（像素）。
 * 默认 `0` = 绕整图中心翻；给成 12.5（= 顶面中心）观感会变成「从顶部翻出去」。
 *
 * ⚠️ 消费方是 `ZCHexView.applyTileOffset` 的轴心补偿项 `HEX_FLIP_PIVOT_LIFT × (1 - flip)`；
 * 而现在**没有任何曲线产出 `flip ≠ 1`**（方案1 删除后只剩「原地」两条）⇒ 该项恒 `0`。
 * 保留为「压扁收场绕哪条轴心」的旋钮，别在 flip 恒 1 的前提下以为它在起作用。
 */
export const HEX_FLIP_PIVOT_LIFT = 0;

/**
 * 翻面段内部「**先抬起、再原地翻面**」的分界比例。
 *
 * 两者必须串行：同步线性时轴心会跟着地块一起往上跑，视觉上读不出「绕固定的一条中心线翻」。
 *
 * ⚠️ 2026-10-16 起没有曲线按这个比例切段了（领地的两套方案 → 只剩「原地碎裂」），它现在只被
 * `hexFlipFoldProgress` 用来把「抬升量 / 等价 flip」反推成底光帧序 —— **别删**，
 * 对局的缩没段（`tileLift` 恒 0）也走那条推导。
 */
export const HEX_FLIP_RISE_RATIO = 0.45;

/**
 * **对局侧翻面段时长（秒）**：「抬起 + 原地压扁」。
 *
 * 对局的卡牌揭示要把起点推到这一刻（`ZCCardReveal.startedAt = now + 本值`），
 * `ZCBattlePresentationQueue.ZC_HEX_FLIP_SECONDS` 直接取本值 ⇒ **改它会改对局的分段**。
 *
 * ⚠️ 领地**不消费它**：随机资源格翻开按 `HEX_SHATTER_SECONDS` 计时 —— 别把它当成
 * 「两边共用的节奏」。
 */
export const HEX_FLIP_SECONDS = 0.384;

/** 地块收场的每帧参数。 */
export interface IZCHexFlipFx {
    /** 整格不渲染（对局的「卡牌独占视线」段用；领地不用）。 */
    hidden: boolean;
    /**
     * 整格 Y 上移像素（0 = 布局原位）。
     *
     * ⚠️ **2026-10-16 起所有曲线都恒 `0`**：方案1（`hexTurnFx` 的上抛弧）删除后，领地的碎裂
     *  与对局的缩没都要求「**原地**」，谁也不许位移。字段与两个消费方
     *  （`ZCHexView.applyTileOffset` / 底光强度）保留成共用写口 —— 但它现在是个**恒定 0 的轴**，
     *  别再拿它当「有东西会抬起」的信号（`ZCHexView.setRaised` 因此永远不抬升，底光也不再点亮）。
     */
    tileLift: number;
    /**
     * 绕水平轴的 **cos**：`1` = 正面朝上，`0` = 压扁成侧视。
     *
     * ⚠️ **2026-10-16 起所有曲线都恒 `1`**（不旋转）：方案1（整圈 360°，cos 会走负半轴）删除后
     *  只剩「原地碎裂」与「原地缩没」。留着是因为对局的压扁收场仍按它算 `y *= flip`
     *  （`ZCHexView.applyTileTransform`）与底光的「等价 flip」推导。
     */
    tileFlip: number;
    /**
     * **原地碎裂进度** `[0,1]`（喂 `shaders/hex-flip.effect` 的 `shatterParams.y`）：
     * `0` = 完好，`1` = 碎到底。`undefined` / 缺省 = 这一帧不碎裂。
     */
    shatter?: number;
    /**
     * **新地块的放大倍率**：`0` = 还没出现，`1` = 铺满格子（末尾会略微过冲再收回）。
     *
     * ⚠️ 写在**子节点 `Reveal`** 上，**不是**格根 —— 格根的缩放归对局的缩没段，领地恒 1；
     * 这里只放大「新地皮」那张图，格面框 / 底光 / 建筑都不跟着动。
     * `undefined` / 缺省 = 不放大（`Reveal` 收起）。
     */
    revealScale?: number;
    /** 起手那一下白闪强度 `[0,1]`（喂材质的 `flashStrength`）。 */
    flash?: number;
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

function makeShrinkFx(tileLift: number, tileScale: number): IZCHexFlipFx {
    return {
        // 缩没段格子还该显示「开发前」的图标+价格数字，建筑要等卡牌淡出那段才换上来 ——
        // 所以这里 buildingPopScale 恒 0（= 还没建筑），不是 1。
        hidden: false, tileLift, tileFlip: 1, tileScale, buildingPopScale: 0, glowRadius: 0, glowAlpha: 0,
    };
}

// ── 领地随机资源格「翻开」：只剩「原地快碎裂」（2026-10-16 用户口径） ──────────────
//
// 🔴 方案1（抬起后绕水平轴垂直翻转 360°）连同它的随机点将已**整条删除**：用户看完两套后
//    拍板「只保留地块破碎效果的方案」。删掉的东西（实现真源）：
//      · 曲线 `hexTurnFx` / `makeTurnFx`；时长 `HEX_TURN_SECONDS = 0.72s`；
//      · 换脸点 `HEX_TURN_FACE_SWAP = 0.75`、侧视淡出阈值 `HEX_TURN_EDGE_FADE_COS = 0.32`；
//      · 随机点将 `pickHexFlipVariant` + 类型 `ZCHexFlipVariant`（视图侧对应
//        `variant` / `lastVariant` / `totalSecondsOf`，也已清掉）；
//      · `IZCHexFlipFx.tileSin`（只有整圈翻转需要**有符号**的 sin）；
//      · `HEX_FLIP_PERSPECTIVE`（顶点层透视除法）与 `hexFlipBodyGlow`（正面开口补光）。
//    对应 `shaders/hex-flip.effect` 删掉的四段（顶点 3D 旋转 + 透视除法 / 体积明暗 /
//    侧视淡出 / 补光）都是**逐像素等价**的 —— 理由见模块头注释。
//    ⚠️ 别只把曲线补回来：着色器里那几段已经不在了，翻整圈会退化成纯压扁。

/** 方案的总时长（秒）：碎裂段 + 新地块放大段（「快」碎裂，比原先方案1 的 0.72s 短）。 */
export const HEX_SHATTER_SECONDS = 0.68;

/**
 * 碎裂段的结束比例（`0.55`）：到这里**旧地块已经碎没**，同一帧换脸。
 *
 * 🔴 碎裂进度到这里**停在 1**（不是回到 0）：旧地块要一直保持「碎没了」的状态，
 * 否则新地块放大到一半时会从碎片底下露出一块旧地皮。
 */
export const HEX_SHATTER_ERODE_END = 0.55;

/**
 * 新地块开始放大的比例（`0.42`，**早于**碎裂结束）。
 *
 * 留一小段重叠：`[0.42, 0.55]` 之间「碎片还在往外腐蚀、新地块已经从格心顶上来」，
 * 比「碎光了再长出新的」连贯；重叠期新地块还很小（约 5%），不会盖住碎片的观感。
 */
export const HEX_SHATTER_REVEAL_START = 0.42;

/** 碎裂片数（列 × 行）。`4×4` = 16 片：更少会读成「裂成几块」，更多在这个尺寸（126×117）下就糊了。 */
export const HEX_SHATTER_GRID_X = 4;
export const HEX_SHATTER_GRID_Y = 4;

/** 碎片中心抖动（单位 = 一个网格）：`0.7` ⇒ 碎块大小 / 朝向明显不规则（否则像瓷砖）。 */
export const HEX_SHATTER_JITTER = 0.7;

/** 起手「啪」那一下的白闪：峰值强度与窗口（进度比例，`0 ~ 0.16` 冲上去再退掉）。 */
export const HEX_SHATTER_FLASH = 0.7;
export const HEX_SHATTER_FLASH_WINDOW = 0.16;

/** 新地块落位的回弹余量：`0.06` ⇒ 长到约 `1.04` 再收回 `1`（「填充」那一下的手感）。 */
export const HEX_REVEAL_POP = 0.06;

/** easeInOutCubic：起手慢、中段快、落位慢 —— 新地块「填充」的手感。 */
function easeInOutCubic(t: number): number {
    if (t < 0.5) return 4 * t * t * t;
    const p = -2 * t + 2;
    return 1 - (p * p * p) / 2;
}

/**
 * 新地块的放大倍率：`0` → `1`，末尾**轻微过冲**再收回。
 *
 * 过冲项 `6.75 × t³(1−t)` 在 `t = 0.75` 处归一化到 1 ⇒ 峰值出现在落位前一刻
 * （落在中段会读成「弹了一下又缩回去」）。
 */
function revealScaleAt(u: number): number {
    const t = clamp01(u);
    return easeInOutCubic(t) + HEX_REVEAL_POP * 6.75 * t * t * t * (1 - t);
}

/**
 * 领地随机资源格「翻开」的**唯一**曲线：`k ∈ [0,1]` → 「原地快碎裂 → 新地块从格心放大填充」。
 *
 *  · **不抬起、不旋转、不缩整格**（`tileLift` / `tileScale` 恒 0、`tileFlip` 恒 1）：
 *    需求原文是「**原地**快碎裂」，所以格心坐标与格根缩放全程不动，碎裂完全由材质做
 *    （片元级的碎片腐蚀，见 `shaders/hex-flip.effect`）；格根不动 ⇒ 不会挪到邻格头上；
 *    🔴 这三个「恒」也是着色器能删掉顶点 3D 段的前提（详见模块头注释）；
 *  · `shatter` = 碎裂进度（喂材质 `shatterParams.y`）：`0` = 完好，`0.55` 起**恒 1**（理由见
 *    `HEX_SHATTER_ERODE_END`）；
 *  · `flash` = 起手那一下白闪（喂材质 `flashParams.x`）；
 *  · `revealScale` = 新地块的放大倍率（视图写在**子节点 `Reveal`** 上，不动格根）。
 */
export function hexShatterFx(k: number): IZCHexFlipFx {
    const t = clamp01(k);
    const erode = HEX_SHATTER_ERODE_END;
    return {
        hidden: false,
        tileLift: 0,
        tileFlip: 1,
        tileScale: 1,
        buildingPopScale: 1,
        glowRadius: 0,
        glowAlpha: 0,
        shatter: t >= erode ? 1 : t / erode,
        revealScale: t <= HEX_SHATTER_REVEAL_START
            ? 0
            : revealScaleAt((t - HEX_SHATTER_REVEAL_START) / (1 - HEX_SHATTER_REVEAL_START)),
        flash: t < HEX_SHATTER_FLASH_WINDOW
            ? HEX_SHATTER_FLASH * Math.sin(Math.PI * (t / HEX_SHATTER_FLASH_WINDOW))
            : 0,
    };
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
 * **建筑生成那一段还在消费**（`ZCHexView.hexActivationFx` 的 `HEX_ACT_GLOW_*`），
 * 以及领地翻格与对局共用同一份结构 —— 不是给收场曲线留的。
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
 * **反推收场进度**：由每帧拿到的 `tileLift / tileFlip` 还原出「收场走到哪儿了」`∈ [0,1]`。
 *
 * 用在「底光序列帧」这类**没有自己时间轴**的播放上：视图不能在里面存播放进度，
 * 只能从当前表现参数反推 —— 抬升段按 `tileLift` 走，压扁段按 `tileFlip` 走。
 *
 * ⚠️ 缩没段（对局）**没有 flip 变化**，调用方要把 `hexCollapseProgress` 换出来的
 * 「等价 flip」传进来（见那边的说明），否则帧序会停在抬升结束那一张不动。
 *
 * ⚠️ 里头的 `tileFlip < 1` 分支现在只被**对局的缩没段**（传等价 flip）走到；领地的碎裂
 * 传进来的 `tileFlip` 恒 `1` ⇒ 走抬升分支、而 `tileLift` 也恒 `0` ⇒ 恒得第 0 帧（这道光
 * 在领地本来就不点亮，见 `hexShrinkFx` 的连带影响说明）。
 */
export function hexFlipFoldProgress(tileLift: number, tileFlip: number): number {
    if (tileFlip >= 1) return HEX_FLIP_RISE_RATIO * clamp01(tileLift / HEX_FLIP_LIFT_PIXELS);
    return HEX_FLIP_RISE_RATIO + (1 - HEX_FLIP_RISE_RATIO) * (1 - clamp01(tileFlip));
}

// ── 开口补光 / 地面光斑（对局与领地共用的观感参数） ───────────────────────────

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
 * 地面光斑（三面侧体 + 贴边光）强度：随抬升量亮起，并在**收到底之前**平滑退场。
 *
 * 退场用 smoothstep：塌陷轴（`1 - collapseFlip`）涨到 `1 - FADE_COS` 以上时归零 ——
 * 那一刻地块已经压扁成一条线 / 缩到最小，再留着光带会读成「一块悬空的亮片」。
 *
 * `collapseFlip` = **等价 flip**（`1 - hexCollapseProgress(...)`）：压扁收场直接传 `tileFlip`，
 * 缩没收场传由缩放换出来的那个值 —— 两种收场因此共用同一条亮灭曲线。
 *
 * ⚠️ 现在**两边都传不出非零强度**（方案1 删除后 `tileLift` 恒 `0`，连对局的缩没段也是
 * 「不抬就没有开口」）—— 这道光如今全程熄灭，是本方案的**自洽结果**，不是漏接线。
 * ⚠️ 两个视图都必须走这个函数（别各自手写一遍），否则一处改了另一处不会跟。
 */
export function hexFlipGroundGlowStrength(tileLift: number, collapseFlip: number): number {
    const fade = clamp01(collapseFlip / HEX_FLIP_GROUND_GLOW_FADE_COS);
    const smooth = fade * fade * (3 - 2 * fade);
    return HEX_FLIP_GROUND_GLOW * clamp01(tileLift / HEX_FLIP_LIFT_PIXELS) * smooth;
}
