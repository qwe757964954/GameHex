/**
 * 资源栏「被奖励击中 / 被扣除」的反馈曲线 —— **纯函数，零引擎依赖**。
 *
 * ## 为什么单独一个文件
 *
 *  资源栏要的反馈有**三段**，都是「时间 → 数值」的映射：
 *
 *  | 反馈 | 载体 | 曲线 |
 *  |---|---|---|
 *  | 单格（加） | 图标放大 / 数字滚动 | {@link resBarHitFx} |
 *  | 单格（**扣**） | 数字**白色闪烁** + 跳动，跳完才扣；同时上方飘一条 `-N` | {@link resBarSpendFx} + {@link resBarSpendFloatFx} |
 *  | 单格 | 这一格的底色闪光 | {@link resBarFlashFx} |
 *
 *  ⚠️ 闪光的作用域是**被命中的那一格**（2026-10-26 改口径：原先闪整条，用户看不出到底哪个资源涨了）。
 *  曲线本身与作用域无关，还是那只单峰。
 *
 *  三段都必须**可单测**（时序错位在编辑器里极难看出来），而 `ResBar` / `MainResBarSlot`
 *  是 `cc.Component`、在 node 测试沙箱里跑不起来 ⇒ 把曲线抽到这里，视图只做「取 fx → 写节点」。
 *
 * ## 硬约束
 *
 *  · **不用 tween**（全工程口径）：视图记 `elapsed`，每帧向这里要一个值；
 *  · **不逐帧累加**：所有输出都只由 `elapsed` 直接算出，暂停 / 掉帧都不会漂；
 *  · 抖动一律确定性（本文件根本不需要抖动 —— 反馈是单次脉冲）。
 */

/** 单格跳动（图标弹一下 + 数字滚动）的总时长（秒）。 */
export const RES_BAR_HIT_SECONDS = 0.46;

/** 资源格闪光的总时长（秒）。作用域 = 命中的那一格（见 `ResBar.flash`）。 */
export const RES_BAR_FLASH_SECONDS = 0.58;

/** 图标峰值放大比例（`0.34` = 最大到 1.34 倍）。 */
export const RES_BAR_HIT_ICON_POP = 0.34;

/** 数字峰值放大比例（比图标克制：文字放大易糊）。 */
export const RES_BAR_HIT_LABEL_POP = 0.18;

/** 弹跳过程的收窄系数：`0.62` ⇒ 0 ~ 62% 的时间内完成「起 → 峰 → 落」。 */
const RES_BAR_HIT_POP_SPAN = 0.62;

/** 闪光最亮时的填充透明度（`0~1`，视图再乘 255）。 */
export const RES_BAR_FLASH_PEAK_ALPHA = 0.42;

/** 一帧的跳动状态。 */
export interface IResBarHitFx {
    /** 图标缩放（`1` = 原大）。 */
    readonly iconScale: number;
    /** 数字缩放（`1` = 原大）。 */
    readonly labelScale: number;
    /** 数字滚动进度 `0..1`（调用方按 `from + (to - from) × countRatio` 写文本）。 */
    readonly countRatio: number;
}

/** `0..1` 夹紧（脏 `elapsed` 不产出 NaN 几何）。 */
function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `EaseOutCubic`：起手快、收尾稳（数字滚动用它，最后几十点不会拖）。 */
function easeOutCubic(t: number): number {
    const inv = 1 - clamp01(t);
    return 1 - inv * inv * inv;
}

/**
 * 单格跳动在 `elapsed` 秒时的状态；`null` = 这一格没有反馈在播（视图据此复原）。
 *
 * 曲线：
 *  · 图标 / 数字都是**单峰弹跳**（`sin(π × p/0.62)`）—— `p=0` 与 `p≥0.62` 时恰好 `1`，
 *    所以「开始」和「结束」都不需要额外的归位帧，也不会有残留的 1.0001 倍数；
 *  · 数字滚动占满整个 `RES_BAR_HIT_SECONDS`（`EaseOutCubic`），比弹跳长一点 ——
 *    弹跳先落地、数字再收尾，读起来是「弹一下 + 数字追上」而不是两件事同时结束。
 */
export function resBarHitFx(elapsed: number): IResBarHitFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_HIT_SECONDS) return null;
    const progress = elapsed / RES_BAR_HIT_SECONDS;
    const pop = Math.sin(Math.PI * clamp01(progress / RES_BAR_HIT_POP_SPAN));
    return {
        iconScale: 1 + RES_BAR_HIT_ICON_POP * pop,
        labelScale: 1 + RES_BAR_HIT_LABEL_POP * pop,
        countRatio: easeOutCubic(progress),
    };
}

/**
 * 资源格闪光在 `elapsed` 秒时的**归一强度**（`0..1`，视图乘 `RES_BAR_FLASH_PEAK_ALPHA`）；
 * `null` = 没在闪。
 *
 * 对称的单峰（`sin(π × p)`）：起手即亮、峰值在中点、收尾回到 0。
 * 不用「快升慢落」的偏斜曲线 —— 闪光是个**短促的确认**，拖着半秒的余晖会盖住数字。
 */
export function resBarFlashFx(elapsed: number): number | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_FLASH_SECONDS) return null;
    return Math.sin(Math.PI * (elapsed / RES_BAR_FLASH_SECONDS));
}

// ============================================================
// 扣除（花钱）的反馈：白色闪烁 → 跳一下 → **然后**才扣 + 上方飘 `-N`
// ============================================================
//
// 需求（2026-11-03 用户，附顶部资源栏截图 —— 上一版是「显红」，这次改口径）：
//   > 「1. 数字不显示红色，白色闪烁
//   >  2. 在资源栏的上方 2px 的位置，播放【-】符号和扣除数字 UI 一起上移消失的提示」
//
// ## 为什么"白"要靠**透明度**做，而不是只改字色
//
// 资源栏的数字本来就是**纯白**（`ResBar.prefab` 的 `Value` 是 `#FFFFFF`）⇒ 把字色混向白
// 等于什么都没变。真正看得见的是**闪烁**：白度（`whiteStrength`）负责"如果是深色字，先变白"，
// 透明度（`labelAlpha`）负责"白字闪两下"。两个输出分开给，视图各写各的，别在模型里耦合。
//
// ## 三段的先后顺序是有意的，别改成一锅
//
// | 阶段 | 时间 | 数字文本 | 颜色 / 透明度 | 缩放 / 位移 |
// | --- | --- | --- | --- | --- |
// | ① 闪烁 + 跳 | `0 ~ HOLD(0.34)` | **一动不动**（还是扣之前那个值） | 白度 0→1，透明度闪 2 下 | 单峰弹跳 + 向上跳 6px |
// | ② 扣减 | `HOLD ~ 0.9` | 从「扣前」滚到「扣后」 | 回到常态色 / 全不透明 | 已经归位，不再动 |
//
// 🔴 **①的「一动不动」是这条需求的核心**：数字一上来就掉下去、闪烁只是"事后闪一下"，
//   玩家读到的顺序就是「先扣了、再闪」，与需求相反。所以 `countRatio` 在前 HOLD 段恒 0。
//
// 🔴 **闪烁必须收在 ① 之内**：数字一边滚一边闪，读数会被打断（玩家看不清扣到多少）。

/** 扣除反馈的总时长（秒）。比「被奖励击中」长一档：它多了一段「先不扣」的定格。 */
export const RES_BAR_SPEND_SECONDS = 0.9;

/** ①「闪烁 + 跳」的定格段（秒）：这段时间数字**一点不动**，之后才开始往下滚。 */
export const RES_BAR_SPEND_HOLD_SECONDS = 0.34;

/** 闪烁窗口（秒）—— 与定格段同长：闪完正好开始扣。 */
export const RES_BAR_SPEND_FLASH_SECONDS = RES_BAR_SPEND_HOLD_SECONDS;

/** 白度升到 1 用多久（秒）：颜色比位移敏感，起手 0.05s 就该看出变白。 */
export const RES_BAR_SPEND_FLASH_RISE_SECONDS = 0.05;

/** 白度在闪烁窗口**末尾**淡回常态色用多久（秒）。 */
export const RES_BAR_SPEND_FLASH_FADE_SECONDS = 0.08;

/** 闪几下（窗口内完整「亮 → 暗 → 亮」的次数）。2 下 ≈ 5.9Hz：像"闪"，再多就像信号故障。 */
export const RES_BAR_SPEND_BLINKS = 2;

/** 闪到最暗时的不透明度（`1` = 不闪）。别取 0 —— 数字整段消失会被读成"扣没了"。 */
export const RES_BAR_SPEND_BLINK_MIN_ALPHA = 0.25;

/** 扣除时图标的峰值放大比例（比奖励那档克制：扣东西不该像中奖）。 */
export const RES_BAR_SPEND_ICON_POP = 0.12;

/** 扣除时数字的峰值放大比例（比图标大一点 —— 玩家读的是数字）。 */
export const RES_BAR_SPEND_LABEL_POP = 0.2;

/** 数字向上跳的像素（`0` = 只放大不位移）。 */
export const RES_BAR_SPEND_LABEL_HOP = 6;

/**
 * 闪烁时数字混向的**目标色**（纯白）。
 *
 * 与上一版的红（`#E83B30`）互斥 —— 用户 2026-11-03 明确「数字不显示红色」。
 * 资源栏只有"扣"这一侧会用到它，与涨跌色无关。
 */
export const RES_BAR_SPEND_FLASH: readonly [number, number, number] = [0xff, 0xff, 0xff];

/** 一帧的扣除状态。 */
export interface IResBarSpendFx {
    /** 图标缩放（`1` = 原大）。 */
    readonly iconScale: number;
    /** 数字缩放（`1` = 原大）。 */
    readonly labelScale: number;
    /** 数字相对原位的**向上**位移（像素，0 = 原位）。 */
    readonly labelHop: number;
    /** 数字滚动进度 `0..1`（前 {@link RES_BAR_SPEND_HOLD_SECONDS} 秒恒 0）。 */
    readonly countRatio: number;
    /** 字色白度 `0..1`（视图按它把字色从常态色混向 {@link RES_BAR_SPEND_FLASH}）。 */
    readonly whiteStrength: number;
    /** 数字不透明度 `0..1`（闪烁时在 `1 ↔ RES_BAR_SPEND_BLINK_MIN_ALPHA` 之间摆）。 */
    readonly labelAlpha: number;
}

/**
 * 扣除反馈在 `elapsed` 秒时的状态；`null` = 没在播（视图据此复原）。
 *
 * 采样口径（判据钉的就是这四条）：
 *  · `countRatio` 在 `[0, HOLD]` 内**恒为 0**，之后单调不减；
 *  · `labelAlpha` 在闪烁窗口内摆动 `RES_BAR_SPEND_BLINKS` 次，窗口起点 / 终点都是 1（不残留半透明）；
 *  · `whiteStrength` 起手 0 → `RISE` 秒到 1 → 窗口末尾淡回 0，扣减段恒 0；
 *  · `iconScale / labelScale / labelHop` 都是**单峰**，`0` 与窗口末尾恒为 1 / 0。
 */
export function resBarSpendFx(elapsed: number): IResBarSpendFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_SPEND_SECONDS) return null;
    const hold = RES_BAR_SPEND_HOLD_SECONDS;
    // ① 定格段的单峰弹跳：`sin(π · p)`，p=0 与 p=1（= HOLD 那一刻）都恰好 0。
    const pop = elapsed < hold ? Math.sin(Math.PI * clamp01(elapsed / hold)) : 0;
    // ② 扣减：HOLD 之前一步都不走（这就是「跳动**再**扣除」）。
    const countProgress = elapsed <= hold ? 0 : clamp01((elapsed - hold) / (RES_BAR_SPEND_SECONDS - hold));
    return {
        iconScale: 1 + RES_BAR_SPEND_ICON_POP * pop,
        labelScale: 1 + RES_BAR_SPEND_LABEL_POP * pop,
        labelHop: RES_BAR_SPEND_LABEL_HOP * pop,
        countRatio: easeOutCubic(countProgress),
        whiteStrength: resBarSpendWhiteStrength(elapsed),
        labelAlpha: resBarSpendBlinkAlpha(elapsed),
    };
}

/** 白度：`0 →1`（RISE）→ 保持 → 窗口末尾淡回 0；闪烁窗口之外恒 0。 */
function resBarSpendWhiteStrength(elapsed: number): number {
    if (!(elapsed >= 0) || elapsed >= RES_BAR_SPEND_FLASH_SECONDS) return 0;
    if (elapsed < RES_BAR_SPEND_FLASH_RISE_SECONDS) {
        return clamp01(elapsed / RES_BAR_SPEND_FLASH_RISE_SECONDS);
    }
    const fadeStart = RES_BAR_SPEND_FLASH_SECONDS - RES_BAR_SPEND_FLASH_FADE_SECONDS;
    if (elapsed <= fadeStart) return 1;
    return clamp01((RES_BAR_SPEND_FLASH_SECONDS - elapsed) / RES_BAR_SPEND_FLASH_FADE_SECONDS);
}

/**
 * 闪烁：`|sin(BLINKS·π·p)|` 的波峰处最暗。
 *
 * 用 `|sin|` 而不是方波：方波在开关那一帧会硬切，TTF 字的抗锯齿边缘会跳一下；
 * `|sin|` 两端都贴 0 ⇒ 起点 / 终点天然是"全不透明"，不需要额外归位帧。
 */
function resBarSpendBlinkAlpha(elapsed: number): number {
    if (!(elapsed >= 0) || elapsed >= RES_BAR_SPEND_FLASH_SECONDS) return 1;
    const p = clamp01(elapsed / RES_BAR_SPEND_FLASH_SECONDS);
    const wave = Math.abs(Math.sin(RES_BAR_SPEND_BLINKS * Math.PI * p));
    return 1 - (1 - RES_BAR_SPEND_BLINK_MIN_ALPHA) * wave;
}

/**
 * 字色混合：`strength = 0` ⇒ 原色，`1` ⇒ {@link RES_BAR_SPEND_FLASH}（纯白）。
 *
 * 为什么不直接把字写死成白：资源栏的常态字色来自 prefab，换成常量白之后再换回来就对不上原值
 * ⇒ 必须**从这个格子自己的底色出发**混（同上一版显红的做法，只是目标色换了）。
 */
export function resBarSpendFlashColor(
    base: readonly [number, number, number],
    strength: number,
): [number, number, number] {
    const t = clamp01(strength);
    const from = [toChannel(base?.[0]), toChannel(base?.[1]), toChannel(base?.[2])];
    return [
        Math.round(from[0] + (RES_BAR_SPEND_FLASH[0] - from[0]) * t),
        Math.round(from[1] + (RES_BAR_SPEND_FLASH[1] - from[1]) * t),
        Math.round(from[2] + (RES_BAR_SPEND_FLASH[2] - from[2]) * t),
    ];
}

// ============================================================
// 上方飘字：`-30` 从「资源栏上沿 + 2px」起，上移 + 淡出
// ============================================================
//
// 需求原文第 2 条：「在资源栏的上方 2px 的位置，播放【-】符号和扣除数字 UI 一起上移消失的提示」。
//
// ## 为什么飘字和数字闪烁是**两条**曲线
//
//  数字闪烁在格子里、只演 0.34s（要在扣减开始前收掉），飘字要飘满整个窗口才读得完
//  「扣了多少」。共用一个 `elapsed`（都是 `spendElapsed`），但曲线各自算 —— 别合并成一个 fx。

/** 飘字的总时长（秒）：与扣除反馈同窗口，扣完它正好飘没。 */
export const RES_BAR_SPEND_FLOAT_SECONDS = RES_BAR_SPEND_SECONDS;

/** 飘字起点 = **格子（资源栏）上沿再往上 2px** —— 需求原文给的数。 */
export const RES_BAR_SPEND_FLOAT_GAP = 2;

/** 整个窗口里向上飘多少像素。 */
export const RES_BAR_SPEND_FLOAT_RISE = 46;

/** 飘到几成时开始淡出（`0.45` = 前段看得清、后段让位给扣减）。 */
export const RES_BAR_SPEND_FLOAT_FADE_FROM = 0.45;

/** 一帧的飘字状态。 */
export interface IResBarSpendFloatFx {
    /** 相对起点的**向上**位移（像素，0 = 还压在"上沿 + 2px"处）。 */
    readonly rise: number;
    /** 不透明度 `0..1`。 */
    readonly alpha: number;
}

/**
 * 飘字在 `elapsed` 秒时的状态；`null` = 没在飘（视图据此把节点藏起来）。
 *
 * 曲线：`rise` 用 `EaseOutCubic`（起手窜出去、尾巴慢慢停 —— 线性上移像"被推上去"）；
 * `alpha` 前 `FADE_FROM` 保持 1，之后线性收到 0，窗口末尾正好不可见。
 */
export function resBarSpendFloatFx(elapsed: number): IResBarSpendFloatFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_SPEND_FLOAT_SECONDS) return null;
    const p = clamp01(elapsed / RES_BAR_SPEND_FLOAT_SECONDS);
    return {
        rise: easeOutCubic(p) * RES_BAR_SPEND_FLOAT_RISE,
        alpha: p <= RES_BAR_SPEND_FLOAT_FADE_FROM
            ? 1
            : clamp01((1 - p) / (1 - RES_BAR_SPEND_FLOAT_FADE_FROM)),
    };
}

/**
 * 飘字的文本：`-` 符号 + 扣除数字（需求原文「【-】符号和扣除数字」）。
 *
 * 不带千分位 —— 与资源栏自身的数字同口径（`formatResBarCountText` 也不加），
 * 上下两处排版一致才不会让人以为不是同一笔账。
 */
export function formatResBarSpendFloat(amount: number): string {
    const value = Number.isFinite(amount) ? Math.round(Math.abs(amount)) : 0;
    return `-${value}`;
}

/** 取 0~255 的整数通道（脏值归 0，别把 `undefined` 混进颜色里变成 NaN）。 */
function toChannel(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** 拆开的数值文本：`12/60` → `{ value: 12, suffix: '/60' }`；`1,234` → `{ 1234, '' }`。 */
export interface IResBarCountText {
    readonly value: number;
    /** 数值后面原样保留的部分（体力的 `/上限`、单位等）。 */
    readonly suffix: string;
}

/**
 * 把资源栏上的**显示文本**拆成「数值 + 后缀」。
 *
 * 不认千分位里的逗号（先剔掉）：`CmdRole` 的数值是本端拼的 `String(number)`，
 * 但老端存档 / 手改的缓存里出现过 `1,234`，剔掉最省事。
 * 拆不出来（空串 / 纯文字）⇒ `value = 0`，调用方据此跳过滚动（只弹跳）。
 */
export function parseResBarCountText(text: string): IResBarCountText {
    const raw = typeof text === 'string' ? text.replace(/,/g, '').trim() : '';
    const matched = /^(-?\d+)(.*)$/.exec(raw);
    if (!matched) return { value: 0, suffix: '' };
    const value = Number(matched[1]);
    return {
        value: Number.isFinite(value) ? value : 0,
        suffix: matched[2] ?? '',
    };
}

/**
 * 滚动中的显示文本：数值取整后拼回后缀。
 *
 * ⚠️ 不重排千分位 —— `CmdRole` 的数字本来就没有分隔符，这里加进去会在动画收尾那一下
 *   跳成另一个排版（数字滚动最刺眼的就是**最后一个字的排版突变**）。
 */
export function formatResBarCountText(base: IResBarCountText, value: number): string {
    const target = Number.isFinite(value) ? Math.round(value) : 0;
    return `${target}${base.suffix}`;
}

/**
 * 滚动到 `ratio` 时的数值：`from → to` 之间按 `ratio` 线性插值后取整。
 *
 * `from > to`（数据先回落再涨，例如换角色）也能用 —— 不夹方向，只夹 `ratio`。
 */
export function resBarCountValue(from: number, to: number, ratio: number): number {
    const start = Number.isFinite(from) ? from : 0;
    const end = Number.isFinite(to) ? to : 0;
    return Math.round(start + (end - start) * clamp01(ratio));
}
