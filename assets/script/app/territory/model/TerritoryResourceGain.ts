import { TERRITORY_SILVER_RES_ID, TERRITORY_STAMINA_RES_ID } from './TerritoryIdleReward';

/**
 * 领地「资源点 / 挂机」发奖的表现分流（山猫 2026-10-15 定）。
 *
 * ## 为什么要分流
 *
 *  领地发下来的奖励里，**银币（`resId 7`）与体力（`resId 9`）直接进钱包**，玩家在顶部
 *  钱包行就能看到数值变化；再弹一次「恭喜获得」弹窗是重复反馈，还会挡住地图。
 *  道具（其余 `resId`）进领地库存、界面上看不到增量 ⇒ **必须**靠弹窗告知。
 *
 * ⇒ 口径：**7 / 9 走「icon + 数字升起」飘字，其余走奖励弹窗**；一批奖励里两类都有时
 *  **逐条分开处理**（各走各的通道），不是整批二选一。
 *
 * ⚠️ `7 / 9` 不是本文件自造的字面量：真源是 `TerritoryIdleReward` 里那两个
 *  `roleProperty` 常量（`idleRewardDestinationOf` 也在用它判钱包去向），改表要改那里。
 */
export const TERRITORY_WALLET_RES_IDS: readonly number[] = [
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
];

/** 转出真源：飘字要按 id 选图标（银币 / 体力各一张图），别在调用方再抄一份 7 / 9。 */
export { TERRITORY_SILVER_RES_ID, TERRITORY_STAMINA_RES_ID };

/** 一条奖励的最小形状：两种来源（`ITerritoryGrantedReward` / `TerritoryIdleRewardGain`）都满足。 */
export interface ITerritoryRewardEntry {
    readonly resId: number;
    readonly amount: number;
}

export interface ITerritoryRewardSplit<T> {
    /** resId 7 / 9 ⇒ 走飘字。 */
    readonly gains: readonly T[];
    /** 其余 ⇒ 走奖励弹窗。 */
    readonly popup: readonly T[];
}

/** 这条奖励是不是「直接进钱包」的资源（进钱包才用飘字替代弹窗）。 */
export function isTerritoryWalletResId(resId: unknown): boolean {
    const id = Number(resId);
    if (!Number.isFinite(id)) return false;
    return TERRITORY_WALLET_RES_IDS.includes(id);
}

/**
 * 按 resId 把一批奖励分成「飘字 / 弹窗」两组。
 *
 * ⚠️ **保持原顺序**：飘字先后即视觉上下顺序，弹窗顺序即 `ShowRewardPage` 的格序，
 * 用 `filter` 两次而不是一次遍历塞两个数组也能保序，但两处判据会各自漂移 ⇒ 单一循环。
 */
export function splitTerritoryRewards<T extends ITerritoryRewardEntry>(
    rewards: readonly T[],
): ITerritoryRewardSplit<T> {
    const gains: T[] = [];
    const popup: T[] = [];
    for (const reward of rewards ?? []) {
        if (reward && isTerritoryWalletResId(reward.resId)) gains.push(reward);
        else popup.push(reward);
    }
    return { gains, popup };
}

// ============================================================
// 升起曲线（纯函数，零 cc —— 与 `TerritoryHexFlip` 同一套路）
// ============================================================

/** 一条飘字的总时长（秒）。 */
export const TERRITORY_GAIN_SECONDS = 1.15;
/** 整条飘字期间向上飘多少像素。 */
export const TERRITORY_GAIN_RISE_PX = 96;
/** 入场段（缩放弹出 + 大部分位移）占整条时长的比例；之后是淡出段。 */
export const TERRITORY_GAIN_ENTRANCE_RATIO = 0.32;
/** 入场段末尾的峰值缩放（>1 才看得见"弹一下"）。 */
export const TERRITORY_GAIN_POP_SCALE = 1.18;
/** 入场段的起始缩放。 */
export const TERRITORY_GAIN_FROM_SCALE = 0.6;
/** 同一格同时飘多条（银币 + 体力）时的纵向间距。 */
export const TERRITORY_GAIN_STACK_GAP_PX = 40;
/**
 * 飘字起点相对**喷发原点**（= 格心，见 `territoryBurstParticle` 的说明）的抬升。
 *
 * 2026-10-16 row17 用户口径：「图标和数字 ui 增加上移的动画放在**粒子效果坐标点的上方间隔 40px**」
 * ⇒ 这个值就是需求里的那个 40（此前是 30，为「别盖住建筑图标」的经验值）。
 */
export const TERRITORY_GAIN_START_LIFT_PX = 40;

export interface ITerritoryGainFx {
    /** 相对起点的纵向位移（像素，向上为正）。 */
    readonly offsetY: number;
    readonly scale: number;
    /** 0 → 1（淡出用）。 */
    readonly opacity: number;
}

function easeOutCubic(t: number): number {
    const p = Math.min(1, Math.max(0, t));
    return 1 - (1 - p) * (1 - p) * (1 - p);
}

/**
 * 播到第 `elapsed` 秒时的表现参数；`null` = 已播完（该回收了）。
 *
 * 位移用**整条**的 easeOutCubic（快起慢收，收尾时几乎悬停，数字看得清）；
 * 缩放在入场段 `0.6 → 1.18` 弹出、淡出段回落到 1；不透明度只在淡出段衰减
 * （`1 - fade²` ⇒ 前段几乎不淡，最后才消失）。
 */
export function territoryGainFx(elapsed: number): ITerritoryGainFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_GAIN_SECONDS) return null;
    const progress = elapsed / TERRITORY_GAIN_SECONDS;
    const offsetY = TERRITORY_GAIN_RISE_PX * easeOutCubic(progress);
    if (progress < TERRITORY_GAIN_ENTRANCE_RATIO) {
        const entrance = easeOutCubic(progress / TERRITORY_GAIN_ENTRANCE_RATIO);
        const scale = TERRITORY_GAIN_FROM_SCALE
            + (TERRITORY_GAIN_POP_SCALE - TERRITORY_GAIN_FROM_SCALE) * entrance;
        return { offsetY, scale, opacity: 1 };
    }
    const fade = (progress - TERRITORY_GAIN_ENTRANCE_RATIO) / (1 - TERRITORY_GAIN_ENTRANCE_RATIO);
    const scale = TERRITORY_GAIN_POP_SCALE
        + (1 - TERRITORY_GAIN_POP_SCALE) * easeOutCubic(fade);
    return { offsetY, scale, opacity: 1 - fade * fade };
}

// ============================================================
// 喷发曲线（纯函数，零 cc —— 与上面那条升起曲线同一套路）
// ============================================================
//
// 2026-10-16 row17 初版口径：「播放喷发效果，喷发多个图标，范围限制在一个倒圆锥，
//   坐标点对应点击地块的中心点，图标和数字 ui 在粒子坐标点上方间隔 40px」。
// 2026-10-17 用户给出**细化后的完整口径**，本节按新口径重写（初版是「固定距离 + 径向直线飞出」，
//   没有重力、没有翻面、只有 6 颗）：
//
//   · 每次喷发 12 颗，错峰 0.025s（**不得同一帧全部生成**）；
//   · 出射方向以**屏幕竖直向上为轴**，左右各 26°：
//       `phi = random(-1, 1) · 半顶角`、`vx = speed · sin(phi)`、`vy = speed · cos(phi)`；
//   · 初速 650 px/s ±12%，重力 1500 px/s²，轨迹是抛物线；
//   · 每颗 icon 飞行中**绕自身水平轴上下翻面**：`scaleY = baseScale · cos(ωt + phase)`、
//     `scaleX` 恒为 `baseScale`（余弦过零即「侧立最窄」，负值即「倒面」）；
//     频率 2~4 次/秒、初相随机；**禁止正负硬切**，也**不做平面自转**（不叠 `angle`）；
//   · 每隔 1.1s ±15% 的生命，末段 0.25s `UIOpacity` 淡出；
//     下落回到地块表面（`offsetY ≤ 0`）时立刻在 0.12s 内淡出并回收，**绝不穿进地块**。
//
// 逐句对应到代码（谁管哪一句别记混）：
//  · 「12 颗 + 错峰」        → `TERRITORY_GAIN_BURST_COUNT` / `..._STAGGER_SECONDS`
//    （一次点击喷出 COUNT 颗，**每颗都是一个资源图标**，不是一颗带动画的图）。
//  · 「开口朝上的倒锥」      → 约束的是**出射方向**：`|phi| ≤ 半顶角`，即 `|vx| / vy ≤ tan(半顶角)`。
//    ⚠️ 别把它误当成「任意时刻都满足 `|x| ≤ y · tan`」：初版是径向直线运动才成立，
//       抛物线**不成立**（位置角从出射角开始一路变大，到顶点时 x/y 趋于无穷）。
//       抛物线的水平包络是 `|x| ≤ 2 · tan(半顶角) · apex`（`apex = vy² / 2g`），单测验的是这一条。
//  · 「喷发坐标点 = 地块中心点」 → 原点由调用方给（`TerritoryMapView.playResourceGain`：
//    格心 = `hex.position.y + HEX_GRID_CONTENT_LIFT`，即「人眼看到的台面中心」）。
//    本节只产出**相对原点的偏移**，不碰任何世界坐标。
//  · 「上方间隔 40px」       → `TERRITORY_GAIN_START_LIFT_PX`（图标 + 数字那一条的起点抬升）。
//
// ⚠️ 轨迹用**解析式**而不是逐帧累加：
//    `y = vy·t − ½·g·t²` 正是 `vy -= g·dt; y += vy·dt` 的**精确解**，
//    但写成累加会让落点依赖帧率（30fps 两帧与 60fps 四帧结果不同），
//    而本工程的动画一律「记录 startedAt + 纯函数算进度」（见 AGENTS.md「渲染幂等与纯函数时间轴」）。
//    所以这里保留解析式，**语义与需求里的逐帧积分完全等价**。
//
// ⚠️ 与上面那条「升起曲线」是**两条独立的时间线**：升起的飘字 1.15s、喷发粒子最长 1.54s，
//   两者同时开始、各自结束（喷发只负责「喷出来的图标」，飘字负责「+N 读数」）。

/** 一次喷发吐出多少个图标（需求口径：12；**满喷**的上限，实际个数按奖励量分级）。 */
export const TERRITORY_GAIN_BURST_COUNT = 12;

/**
 * 粒子数**按奖励总量分级**（需求 2026-10-22）：
 *
 *   > 「沿用宝箱获得资源中级别的粒子喷射动画，**减少粒子个数来区分奖励**，
 *   >   资源奖励数**小于 50 时粒子数量很稀疏**」
 *
 * | 奖励总量 | 粒子数 | 读感 |
 * | --- | --- | --- |
 * | `< 50` | 5（`SPARSE`） | 稀疏 —— 一眼看出是小奖励 |
 * | `50 ~ 200`（含） | 9（`MEDIUM`） | 中等 |
 * | `> 200` | 12（满喷 `COUNT`） | 密 —— 大奖励才给满 |
 *
 * ⚠️ 分级只看**总量**，与「哪个资源」无关（与宝箱分档同一口径：不加权、不按种类）。
 * ⚠️ 稀疏档也**不是 0**：一次点击必须有反馈，5 颗已经能读成「喷了一下」，0 颗等于没做。
 */
export const TERRITORY_GAIN_BURST_COUNT_SPARSE = 5;
export const TERRITORY_GAIN_BURST_COUNT_MEDIUM = 9;
/** 稀疏档的上界（不含）：总量 `< 50` ⇒ 稀疏。 */
export const TERRITORY_GAIN_BURST_SPARSE_BELOW = 50;
/** 中档的上界（含）：总量 `> 200` ⇒ 满喷。 */
export const TERRITORY_GAIN_BURST_DENSE_ABOVE = 200;

/**
 * 奖励总量 → 喷发粒子数（见上面那张表）。
 *
 * 非有限值（`NaN` / `±Infinity`）按**稀疏**处理：脏数据最多是"喷得少"，
 * 绝不能因为一个 NaN 喷满屏。负数 / 0 同样是稀疏档。
 */
export function territoryBurstCountForTotal(total: number): number {
    if (!Number.isFinite(total) || total < TERRITORY_GAIN_BURST_SPARSE_BELOW) {
        return TERRITORY_GAIN_BURST_COUNT_SPARSE;
    }
    if (total <= TERRITORY_GAIN_BURST_DENSE_ABOVE) return TERRITORY_GAIN_BURST_COUNT_MEDIUM;
    return TERRITORY_GAIN_BURST_COUNT;
}

/**
 * 倒锥的**半顶角**（度）：出射方向与屏幕竖直轴的夹角上限（需求默认 26°）。
 *
 *  ⚠️ 改这个值会同步改变 `|vx| / vy ≤ tan(半顶角)` 与水平包络 `2·tan·apex` 两条判据 ——
 *  单测读的就是这个常量算 tan，别在测试里另抄一个角度。
 */
export const TERRITORY_GAIN_BURST_HALF_ANGLE_DEG = 26;

/** 初速度（px/s）。 */
export const TERRITORY_GAIN_BURST_SPEED = 650;

/** 初速度的随机幅度（±12%）—— 不加抖动的话 12 条轨迹会叠成一束。 */
export const TERRITORY_GAIN_BURST_SPEED_JITTER = 0.12;

/** 重力加速度（px/s²）：抛物线靠它把粒子拉回来。 */
export const TERRITORY_GAIN_BURST_GRAVITY = 1500;

/**
 * 相邻两颗粒子的出发间隔（秒）。
 *
 *  12 颗 × 0.025s = 0.275s 铺开 ⇒ **绝不会同一帧全部生成**（一格 60fps 才 16ms）。
 */
export const TERRITORY_GAIN_BURST_STAGGER_SECONDS = 0.025;

/** 单颗粒子的存活时长基准（秒）。 */
export const TERRITORY_GAIN_BURST_LIFE_SECONDS = 1.1;

/** 存活时长的随机幅度（±15%）。 */
export const TERRITORY_GAIN_BURST_LIFE_JITTER = 0.15;

/**
 * 生命末段淡出时长（秒）——**没落回地面**的那几颗走这条。
 *
 *  大多数粒子会在 ~0.8s 落回台面走下面那条「快速淡出」，这条只兜「飞得高、落得慢」的少数。
 */
export const TERRITORY_GAIN_BURST_FADE_SECONDS = 0.25;

/**
 * 落回地块表面后的快速淡出时长（秒）。
 *
 *  ⚠️ 从这一刻起 `offsetY` 被夹在 0：粒子**停在台面上淡出**，不会穿进地块。
 */
export const TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS = 0.12;

/** 基础缩放的基准值（`1` = icon 的设计边长）与随机幅度 ⇒ 实际 0.8 ~ 1.2。 */
export const TERRITORY_GAIN_BURST_BASE_SCALE = 1;
export const TERRITORY_GAIN_BURST_SCALE_JITTER = 0.2;

/** 翻面频率区间（次/秒）：每颗落在这个区间里的随机值，12 颗不会同步翻。 */
export const TERRITORY_GAIN_BURST_FLIP_MIN_HZ = 2;
export const TERRITORY_GAIN_BURST_FLIP_MAX_HZ = 4;

/**
 * 整次喷发的**上限**时长（秒）= 最后一颗的出发时刻 + 它可能达到的最长生命。
 *
 *  只是给视图兜底用的硬上限（防止某颗因为脏数据一直不消失）；实际收尾更早 ——
 *  视图逐帧看「还有没有活着的粒子」。
 *
 *  ⚠️ 粒子数现在是**可变**的（见 `territoryBurstCountForTotal`），所以真正的上限
 *  要按本次实际个数算：`territoryBurstTotalSeconds(count)`。下面这个常量只是
 *  **满喷（12 颗）**时的值，留给默认参数与单测用。
 */
export const TERRITORY_GAIN_BURST_TOTAL_SECONDS = (TERRITORY_GAIN_BURST_COUNT - 1) * TERRITORY_GAIN_BURST_STAGGER_SECONDS
    + TERRITORY_GAIN_BURST_LIFE_SECONDS * (1 + TERRITORY_GAIN_BURST_LIFE_JITTER);

/** 按**本次粒子数**算整喷上限（粒子少 ⇒ 错峰铺开的尾巴也短）。 */
export function territoryBurstTotalSeconds(count: number = TERRITORY_GAIN_BURST_COUNT): number {
    const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : TERRITORY_GAIN_BURST_COUNT;
    return (safe - 1) * TERRITORY_GAIN_BURST_STAGGER_SECONDS
        + TERRITORY_GAIN_BURST_LIFE_SECONDS * (1 + TERRITORY_GAIN_BURST_LIFE_JITTER);
}

/**
 * 确定性哈希 → `[0, 1)`：给「同一 index 每次喷发长得不一样」的抖动取值用。
 *
 *  为什么不用 `Math.random()`：同一 `(seed, index)` 必须给出**同一个**偏移，
 *  否则单测无法验证倒锥判据，池化复用也无法复现问题。
 *  视觉上的「随机」由调用方**每次喷发换一个 seed**（`TerritoryMapView` 的自增计数）提供。
 */
function burstNoise(seed: number, index: number, salt: number): number {
    let h = Math.imul(seed | 0, 0x27d4eb2d)
        ^ Math.imul(index + 1, 0x9e3779b1)
        ^ Math.imul(salt + 1, 0x85ebca6b);
    h = (h ^ (h >>> 15)) | 0;
    h = Math.imul(h, 0x2545f491);
    h = (h ^ (h >>> 13)) | 0;
    return (h >>> 0) / 4294967296;
}

/** 单颗粒子的**出射参数**（一次喷发内恒定，逐帧只需要时间）。 */
export interface ITerritoryBurstLaunch {
    /** 出射方向相对屏幕竖直轴的偏角（弧度，右正左负），`|phi| ≤ 半顶角`。 */
    readonly phi: number;
    /** 初速度（px/s，含 ±12% 抖动）。 */
    readonly speed: number;
    /** 初速度的横向分量（px/s）。 */
    readonly vx: number;
    /** 初速度的纵向分量（px/s，向上为正）。 */
    readonly vy: number;
    /** 基础缩放（`1` = icon 设计边长）；翻面只在这上面给 `y` 乘余弦。 */
    readonly baseScale: number;
    /** 翻面频率（次/秒，2~4）。 */
    readonly flipHz: number;
    /** 翻面初始相位（弧度，0~2π）—— 每颗不同，避免 12 颗同步翻面。 */
    readonly phase: number;
    /** 这一颗的存活时长（秒，1.1 ±15%）。 */
    readonly life: number;
}

/**
 * 第 `index` 颗粒子的出射参数（确定性：同一 `(seed, index)` 恒等）。
 *
 *  `index` 越界 / 非整数 ⇒ `null`（调用方少配了粒子引用时，多余那颗就该「不存在」）。
 *
 *  @param count 本次喷发的粒子数（默认满喷 12）—— 由 `territoryBurstCountForTotal` 按奖励量给。
 */
export function territoryBurstLaunch(
    seed: number,
    index: number,
    count: number = TERRITORY_GAIN_BURST_COUNT,
): ITerritoryBurstLaunch | null {
    if (!Number.isInteger(index) || index < 0 || index >= count) return null;
    const halfAngle = (TERRITORY_GAIN_BURST_HALF_ANGLE_DEG * Math.PI) / 180;
    // 需求原式：`phi = random(-1, 1) * coneHalfAngle`
    const phi = (burstNoise(seed, index, 0) * 2 - 1) * halfAngle;
    // 需求原文：初速带 ±12% 随机量，避免轨迹雷同。
    const speed = TERRITORY_GAIN_BURST_SPEED
        * (1 + (burstNoise(seed, index, 1) * 2 - 1) * TERRITORY_GAIN_BURST_SPEED_JITTER);
    return {
        phi,
        speed,
        vx: speed * Math.sin(phi),
        vy: speed * Math.cos(phi),
        baseScale: TERRITORY_GAIN_BURST_BASE_SCALE
            * (1 + (burstNoise(seed, index, 2) * 2 - 1) * TERRITORY_GAIN_BURST_SCALE_JITTER),
        flipHz: TERRITORY_GAIN_BURST_FLIP_MIN_HZ
            + burstNoise(seed, index, 3) * (TERRITORY_GAIN_BURST_FLIP_MAX_HZ - TERRITORY_GAIN_BURST_FLIP_MIN_HZ),
        phase: burstNoise(seed, index, 4) * Math.PI * 2,
        life: TERRITORY_GAIN_BURST_LIFE_SECONDS
            * (1 + (burstNoise(seed, index, 5) * 2 - 1) * TERRITORY_GAIN_BURST_LIFE_JITTER),
    };
}

/** 单颗粒子在某一时刻的表现参数（全部**相对喷发原点**）。 */
export interface ITerritoryBurstParticle {
    /** 相对喷发原点的横向偏移（像素）。 */
    readonly offsetX: number;
    /** 相对喷发原点的纵向偏移（像素，向上为正；落回台面后恒 0）。 */
    readonly offsetY: number;
    /** 横向缩放（**恒**等于基础缩放 —— 翻面不许影响宽度）。 */
    readonly scaleX: number;
    /** 纵向缩放 = `基础缩放 · cos(ωt + 相位)`；过零即「侧立最窄」，负值即「翻到背面」。 */
    readonly scaleY: number;
    /** 0 → 1（每颗粒子各自淡出）。 */
    readonly opacity: number;
}

/**
 * 第 `index` 颗粒子喷发到第 `elapsed` 秒时的表现参数；`null` = 这一帧它不该出现
 * （**还没出发**、或**已经消失**）。
 *
 *  ## 轨迹
 *
 *  从喷发原点按 `(vx, vy)` 抛出，只受重力 ⇒ `x = vx·t`、`y = vy·t − ½·g·t²`。
 *  竖直方向先升后降，顶点在 `t = vy / g`（约 0.39~0.49s），落回原高度在 `t = 2·vy / g`
 *  （约 0.69~0.97s）。
 *
 *  ## 什么时候收
 *
 *  两条终止条件取**先到的那条**：
 *   · 落回台面（`t ≥ 2·vy / g` 且比 `life` 早）⇒ 从落点起 `SURFACE_FADE_SECONDS(0.12)` 淡出，
 *     期间位置**冻在落点**（`offsetY` 恒 0、横向也不再滑）：既不会穿进地块，也不会读成「贴地滑一段」；
 *   · 生命到期（`life` 更早，只发生在飞得最高最快的少数）⇒ 最后 `FADE_SECONDS(0.25)` 淡出。
 *
 *  ## 边界
 *
 *  `index` 不是 `[0, COUNT)` 里的整数、`elapsed` 非有限或为负 ⇒ `null`。
 */
export function territoryBurstParticle(
    seed: number,
    index: number,
    elapsed: number,
    count: number = TERRITORY_GAIN_BURST_COUNT,
): ITerritoryBurstParticle | null {
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;
    const launch = territoryBurstLaunch(seed, index, count);
    if (!launch) return null;

    const local = elapsed - index * TERRITORY_GAIN_BURST_STAGGER_SECONDS;
    if (local < 0) return null;

    const gravity = TERRITORY_GAIN_BURST_GRAVITY;
    const surfaceTime = (2 * launch.vy) / gravity;
    const reachesSurface = surfaceTime < launch.life;
    const fadeStart = reachesSurface ? surfaceTime : launch.life - TERRITORY_GAIN_BURST_FADE_SECONDS;
    const endTime = reachesSurface ? surfaceTime + TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS : launch.life;
    if (local >= endTime) return null;

    // 落地之后**位置冻住**（`flightTime` 夹到落点那一刻）：只淡出、不再横滑，
    // 否则会读成「图标贴着地皮滑一段」——那不是「落回地面淡出」。
    const flightTime = Math.min(local, surfaceTime);
    const rawY = launch.vy * flightTime - 0.5 * gravity * flightTime * flightTime;
    const span = Math.max(1e-6, endTime - fadeStart);
    const opacity = local <= fadeStart ? 1 : 1 - (local - fadeStart) / span;
    // 需求原话：每帧令 `scaleY = baseScale · cos(ωt + phase)`，`scaleX` 始终 `baseScale`。
    const flip = launch.flipHz * Math.PI * 2 * local + launch.phase;
    return {
        offsetX: launch.vx * flightTime,
        // 落地那一刻起 y 就恒为 0：宁可「趴在表面淡出」，也不能往下穿进地块。
        offsetY: Math.max(0, rawY),
        scaleX: launch.baseScale,
        scaleY: launch.baseScale * Math.cos(flip),
        opacity: Math.max(0, Math.min(1, opacity)),
    };
}
