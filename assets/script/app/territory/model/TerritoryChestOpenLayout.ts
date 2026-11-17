/**
 * 「领地宝箱开启」奖励页的**纯口径**（零 `cc`）：行数、缩放兜底、图标适配、
 * 数量文案与入场时间轴。
 *
 * 卡宽、卡高、列/行间距、首行位置、卡框/图标/底条尺寸、宝箱与按钮边距、字号
 * 全部由 `TerritoryChestOpen.prefab` 配置；本文件不再保存第二份布局常量。
 *
 * 适配口径
 *
 * · `Cards` 用 Widget 贴顶、`Chest` 用 Widget 贴底、`Skip` 贴左上、`Close` 贴底居中；
 * · 卡片行列由 prefab 的 `cc.Layout`（Cards 纵向、RowTemplate 横向）排版，
 * 页面只按列数分行，不计算卡位；
 * · 短屏放不下时按 Widget 边距算出的可用高度做等比兜底，下限由 prefab 属性传入。
 */
// ============================================================
// 卡片栅格（只算行数，尺寸/间距交给 prefab Layout）
// ============================================================

/** 卡片行数（0 条奖励或列数非法为 0）。 */
export function chestOpenRowsOf(total: number, columns: number): number {
    if (total <= 0 || !(columns > 0)) return 0;
    return Math.ceil(total / columns);
}

/** 缩放兜底：内容高 vs 可用高，结果夹在 `[minScale, 1]`。 */
export function chestOpenGridScaleOf(contentHeight: number, availableHeight: number, minScale: number): number {
    if (!(contentHeight > 0)) return 1;
    if (!(availableHeight > 0)) return minScale;
    return Math.max(minScale, Math.min(1, availableHeight / contentHeight));
}

/**
 * 图标等比适配 prefab 的图标位：`scale = min(slotW/w, slotH/h, maxUpscale)`。
 *
 * 尺寸取到 0（表里没登记 / 美术缺失）时按整格返回，由视图决定隐藏。
 * 结果保留两位小数：`200×0.56` 这类会算出 `112.00000000000001`，
 * 直接塞给 `setContentSize` 是**亚像素**尺寸，缩放动画里会抖。
 */
export function chestOpenIconFitOf(
    width: number,
    height: number,
    slotWidth: number,
    slotHeight: number,
    maxUpscale: number,
): { readonly width: number; readonly height: number } {
    if (!(width > 0) || !(height > 0) || !(slotWidth > 0) || !(slotHeight > 0)) {
        return { width: slotWidth, height: slotHeight };
    }
    const cap = maxUpscale > 0 ? maxUpscale : 1;
    const scale = Math.min(slotWidth / width, slotHeight / height, cap);
    return {
        width: Math.round(width * scale * 100) / 100,
        height: Math.round(height * scale * 100) / 100,
    };
}

/**
 * 数量文案。
 *
 * 设计稿两种形态是**两类奖励**的证件照，不是随机：
 * · 道具（碎片 / 经验 / 材料）→ `X1`（大写 X，出处是设计稿第 1/3/4/5 张卡）；
 * · 货币（银币 / 晶石）→ `+4095` / `+3`（出处是第 2 张卡的「+4095」与设计稿的「+3」）。
 *
 * `roleProperty`（resId 1~17）与 `item`（resId 10xxx）id 段不重叠，判定见视图。
 */
export function chestOpenCountTextOf(number: number, isCurrency: boolean): string {
    const value = Math.max(0, Math.floor(number));
    return isCurrency ? `+${value}` : `X${value}`;
}

// ============================================================
// 入场时间轴
// ============================================================
//
// 设计稿是**静止态**（跳过 + 卡片 + 关闭同屏），动画只能自拟。取「底图先亮 → 宝箱弹入 →
// 卡片逐张错峰弹出，跳过同时淡入」：结束态与设计稿像素一致，过程不额外遮挡任何内容。
//
// ⏱ 总时长 = cardDelay + (n-1)*stagger + card ⇒ 5 张 0.66s、4 张 0.585s。

export const CHEST_OPEN_REVEAL = {
    /** 全屏底图淡入。 */
    bg: 0.16,
    /** 宝箱 scale 弹入（backOut）。 */
    chest: 0.46,
    /** 单张卡片从 0.72 弹到 1。 */
    card: 0.26,
    /** 相邻两张的启动间隔。 */
    cardStagger: 0.075,
    /** 第一张卡延迟（等宝箱先落位）。 */
    cardDelay: 0.1,
    /** 「跳过」淡入时长（设计稿静止态带跳过 ⇒ 淡入后常驻，不再消失）。 */
    skipFade: 0.16,
} as const;

/** 全部卡片入场完成的时间点。 */
export function chestOpenRevealSecondsOf(total: number): number {
    if (total <= 0) return CHEST_OPEN_REVEAL.cardDelay;
    return CHEST_OPEN_REVEAL.cardDelay + (total - 1) * CHEST_OPEN_REVEAL.cardStagger + CHEST_OPEN_REVEAL.card;
}

/** 整段入场结束的时间点（= 收起动画落到静止态、放开空白点击关闭）。 */
export function chestOpenRevealDoneSecondsOf(total: number): number {
    return chestOpenRevealSecondsOf(total);
}

/** 0..1 线性收敛。 */
export function chestOpenClamp01(value: number): number {
    return value <= 0 ? 0 : (value >= 1 ? 1 : value);
}

/** 标准 backOut（末段回弹，t=0 恰为 0）。 */
export function chestOpenEaseOutBack(t: number): number {
    const c1 = 1.70158;
    const p = t - 1;
    return 1 + (c1 + 1) * p * p * p + c1 * p * p;
}

/** 二次缓出。 */
export function chestOpenEaseOutQuad(t: number): number {
    const p = 1 - t;
    return 1 - p * p;
}

export function chestOpenBgProgressOf(elapsed: number): number {
    return chestOpenClamp01(elapsed / CHEST_OPEN_REVEAL.bg);
}

export function chestOpenChestProgressOf(elapsed: number): number {
    return chestOpenClamp01(elapsed / CHEST_OPEN_REVEAL.chest);
}

export function chestOpenCardProgressOf(elapsed: number, index: number): number {
    const start = CHEST_OPEN_REVEAL.cardDelay + index * CHEST_OPEN_REVEAL.cardStagger;
    return chestOpenClamp01((elapsed - start) / CHEST_OPEN_REVEAL.card);
}

/** 0..1：「跳过」的不透明度（入场开头淡入，之后常驻）。 */
export function chestOpenSkipAlphaOf(elapsed: number): number {
    return chestOpenClamp01(elapsed / CHEST_OPEN_REVEAL.skipFade);
}

/** 一张卡在每个时刻的**视觉量**（视图只负责写 transform，不做任何算术）。 */
export interface IChestOpenCardVisual {
    /** 卡片整体缩放（0.72 → 1，回弹到约 1.09）。 */
    readonly scale: number;
    /** 不透明度 0..255。 */
    readonly opacity: number;
    /** 相对最终位置的竖直偏移（正 = 更低，用于「从下往上落位」）。 */
    readonly rise: number;
    /** 是否已完成（= 可停更）。 */
    readonly done: boolean;
}

/** 卡片起始缩放 / 上升距离。 */
export const CHEST_OPEN_CARD_FROM_SCALE = 0.72;
export const CHEST_OPEN_CARD_RISE = 16;

export function chestOpenCardVisualOf(elapsed: number, index: number): IChestOpenCardVisual {
    const progress = chestOpenCardProgressOf(elapsed, index);
    // 两端直接返回常量：`easeOutBack` 在 t=0/1 会差 1e-16，落到节点上是亚像素抖动
    if (progress <= 0) {
        return { scale: CHEST_OPEN_CARD_FROM_SCALE, opacity: 0, rise: CHEST_OPEN_CARD_RISE, done: false };
    }
    if (progress >= 1) {
        return { scale: 1, opacity: 255, rise: 0, done: true };
    }
    const eased = chestOpenEaseOutBack(progress);
    return {
        scale: CHEST_OPEN_CARD_FROM_SCALE + (1 - CHEST_OPEN_CARD_FROM_SCALE) * eased,
        // 不透明度比缩放**更快到位**（不然小卡先是最透的，看起来像没弹出来）。
        opacity: Math.round(255 * chestOpenClamp01(progress * 2.2)),
        rise: (1 - chestOpenEaseOutQuad(progress)) * CHEST_OPEN_CARD_RISE,
        done: false,
    };
}

/** 宝箱在每个时刻的视觉量。 */
export interface IChestOpenChestVisual {
    readonly scale: number;
    readonly opacity: number;
}

export const CHEST_OPEN_CHEST_FROM_SCALE = 0.82;

export function chestOpenChestVisualOf(elapsed: number): IChestOpenChestVisual {
    const progress = chestOpenChestProgressOf(elapsed);
    if (progress <= 0) return { scale: CHEST_OPEN_CHEST_FROM_SCALE, opacity: 0 };
    if (progress >= 1) return { scale: 1, opacity: 255 };
    return {
        scale: CHEST_OPEN_CHEST_FROM_SCALE + (1 - CHEST_OPEN_CHEST_FROM_SCALE) * chestOpenEaseOutBack(progress),
        opacity: Math.round(255 * chestOpenClamp01(progress * 3)),
    };
}

/** 橙卡（金/传说）在 `pvpCard.rarity` 里的数值；1..4 依次 绿/蓝/紫/金。 */
export const CHEST_LEGEND_CARD_RARITY = 4;

/**
 * 这一批奖励里的**橙卡碎片**英雄 id，按**卡牌 id 升序**。
 *
 * 🔴 判据是**卡牌品级**（`pvpCard.rarity === 4` = 金/传说），不是碎片道具的 `item.quality`：
 * 碎片 `18003` 在 item 表里是 quality 2，按道具品质筛永远命中不了 —— 老实现（quality === 5）
 * 在任何真实数据上都是空集，等于「获得传说英雄」从来没弹过。
 *
 * 碎片 → 英雄走 `cardLevelUp.costCardID`（升级表的真实关联），同英雄只展示一次；
 * 多个橙卡碎片按卡牌 id 升序轮流展示（需求 2026-11-17 ②）。
 */
export function chestLegendHeroesOf(
    entries: readonly { readonly resId: number; readonly number: number }[],
    rows: readonly { readonly id: string; readonly costCardID: string }[],
    rarityOfCard: (cardId: string) => number,
): readonly string[] {
    const ids = new Set<string>();
    for (const entry of entries) {
        if (!(entry.number > 0)) continue;
        const row = rows.find((one) => Number(one.costCardID) === entry.resId);
        if (!row) continue;
        if (rarityOfCard(row.id) !== CHEST_LEGEND_CARD_RARITY) continue;
        ids.add(row.id);
    }
    // 顺序是需求的一部分：多个橙卡按**卡牌 id 升序**逐个展示，不跟奖励数组顺序。
    return Array.from(ids).sort((a, b) => Number(a) - Number(b));
}
