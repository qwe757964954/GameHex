/**
 * 世界页「目标详情」弹窗内部的**居中竖排**布局（纯函数、零 `cc`）。
 *
 * ## 口径（2026-10-22 用户）
 *
 * 「弹窗内的 icon 和描述以及标题需要统一居中对齐」。
 *
 * 老排法是「左图标 + 右文字栏」：图标用**视口宽**算 x 而父节点是卡片 ⇒ 被推到卡片左边缘、
 * 压在正文上；标题为让开图标又整体右移 ⇒ 三样东西谁都不在一条中线上。
 * 现在统一成一条竖排中线（`centerX = 0`）：标题 → 图标 → 正文 → 按钮。
 *
 * ## 为什么要单独抽出来
 *
 * 排版里有三处**互相牵制**的约束，写在组件里只能靠肉眼验收：
 *
 *  1. 正文是 `CLAMP`（`Label.Overflow.CLAMP`）—— 位置/高度给错就是**直接截字**，不报错；
 *  2. 图标的可用高度取决于「正文需要多高」，所以必须**先算文字、再分空间给图标**；
 *  3. 空间不够时图标要让位（缩到 `MIN_ICON_HEIGHT` 以下就干脆不显示，文字优先）。
 *
 * 抽成纯函数后：视图只把结果写进节点；`tests/bigmap-info-layout.test.ts` 能直接钉住
 * 「三者的 x 都是 0」「正文不越过按钮」「图标与正文不重叠」「不截字（高度够）」。
 */

/** 标题中心距卡片顶边的距离（含关闭按钮那一行的高度）。 */
export const BIGMAP_INFO_TITLE_TOP_GAP = 46;
/** 标题中心到图标上沿的距离。 */
export const BIGMAP_INFO_ICON_GAP = 30;
/** 图标下沿到正文上沿的距离。 */
export const BIGMAP_INFO_ICON_BODY_GAP = 12;
/** 按钮中心距卡片底边的距离（与领地页弹窗的「返回地图 / 开战」同一排法）。 */
export const BIGMAP_INFO_ACTION_BOTTOM_GAP = 46;
/** 有按钮时，正文下沿与卡片底边之间留多少（要让开按钮 + 描边）。 */
export const BIGMAP_INFO_BODY_BOTTOM_GAP_ACTIONS = 78;
/** 没有按钮时（纯说明卡），正文可以再往下探一点。 */
export const BIGMAP_INFO_BODY_BOTTOM_GAP_IDLE = 30;
/** 正文左右各留多少（卡片内边距）。 */
export const BIGMAP_INFO_PADDING_X = 28;
/** 图标缩到这个高度以下就不显示（再小也读不出是什么，不如把空间给文字）。 */
export const BIGMAP_INFO_MIN_ICON_HEIGHT = 56;
/** 正文最少给多高（一行半，保证不会缩成一条缝）。 */
export const BIGMAP_INFO_MIN_BODY_HEIGHT = 40;
/** 两颗按钮并排时的中心间距（各离中线 `±BIGMAP_INFO_ACTION_GAP`）。 */
export const BIGMAP_INFO_ACTION_GAP = 76;

/** 一帧的排版输入。全部是**卡片局部坐标**下的尺寸（像素）。 */
export interface IBigMapInfoLayoutInput {
    readonly panelWidth: number;
    readonly panelHeight: number;
    /** 正文**行数**（按 `\n` 切）；决定正文需要多高。 */
    readonly lines: number;
    readonly lineHeight: number;
    /** 「攻打」类主按钮这一帧是否可见。 */
    readonly hasPrimary: boolean;
    /** 「定位 / 收取」类次按钮这一帧是否可见。 */
    readonly hasSecondary: boolean;
    /** 图标的**自然可见高度**（按请求宽度铺开后的高度；`0` = 没有图标）。 */
    readonly iconHeight: number;
}

/** 排版结果，视图照抄（`centerX` 恒为 0，留着这个字段是为了让"统一居中"可断言）。 */
export interface IBigMapInfoLayout {
    /** 竖排中线（恒 0）。标题 / 图标 / 正文 / 单颗按钮都摆在这条线上。 */
    readonly centerX: number;
    readonly titleY: number;
    readonly iconVisible: boolean;
    readonly iconSize: number;
    readonly iconY: number;
    readonly bodyY: number;
    readonly bodyHeight: number;
    readonly bodyWidth: number;
    readonly actionY: number;
    readonly secondaryX: number;
    readonly primaryX: number;
    /** 正文是否因空间不足被压缩（高度 < 所需高度）⇒ 会截字。测试用来挡回归。 */
    readonly bodyClipped: boolean;
}

/**
 * 算出一帧的排版。
 *
 * 顺序是**先文字后图标**：正文高度先按行数占住，剩下的余量才给图标；
 * 余量不足 `BIGMAP_INFO_MIN_ICON_HEIGHT` 时图标让位（`iconVisible = false`），正文顶到标题下方。
 */
export function bigMapInfoLayout(input: IBigMapInfoLayoutInput): IBigMapInfoLayout {
    const panelWidth = Math.max(1, input.panelWidth);
    const panelHeight = Math.max(1, input.panelHeight);
    const lineHeight = Math.max(1, input.lineHeight);
    const lines = Math.max(1, Math.floor(input.lines) || 1);
    const hasActions = input.hasPrimary || input.hasSecondary;

    const titleY = panelHeight / 2 - BIGMAP_INFO_TITLE_TOP_GAP;
    const bodyBottom = -panelHeight / 2
        + (hasActions ? BIGMAP_INFO_BODY_BOTTOM_GAP_ACTIONS : BIGMAP_INFO_BODY_BOTTOM_GAP_IDLE);
    // 正文上沿的最高位置：紧贴标题下方（标题高 34）。
    const bodyTopLimit = titleY - 34;
    const bodyNeeded = lines * lineHeight + 8;
    // 图标能用的余量 = 标题下沿 − （正文下沿 + 正文所需高度）− 图标与正文的间距。
    const room = Math.max(0, bodyTopLimit - (bodyBottom + bodyNeeded) - BIGMAP_INFO_ICON_BODY_GAP);
    const iconVisible = input.iconHeight > 0 && room >= BIGMAP_INFO_MIN_ICON_HEIGHT;
    const iconSize = iconVisible ? Math.min(input.iconHeight, room) : 0;
    const iconY = iconVisible ? titleY - BIGMAP_INFO_ICON_GAP - iconSize / 2 : titleY - BIGMAP_INFO_ICON_GAP;
    const bodyTop = iconVisible ? iconY - iconSize / 2 - BIGMAP_INFO_ICON_BODY_GAP : bodyTopLimit;
    const bodyHeight = Math.max(BIGMAP_INFO_MIN_BODY_HEIGHT, bodyTop - bodyBottom);

    const actionY = -panelHeight / 2 + BIGMAP_INFO_ACTION_BOTTOM_GAP;
    // 两颗都在 ⇒ 并排；只剩一颗 ⇒ 摆中线（居中竖排下偏一边会显得歪）。
    const bothActions = input.hasPrimary && input.hasSecondary;
    const secondaryX = bothActions ? -BIGMAP_INFO_ACTION_GAP : 0;
    const primaryX = bothActions ? BIGMAP_INFO_ACTION_GAP : 0;

    return {
        centerX: 0,
        titleY,
        iconVisible,
        iconSize,
        iconY,
        bodyY: (bodyTop + bodyBottom) / 2,
        bodyHeight,
        bodyWidth: Math.max(1, panelWidth - BIGMAP_INFO_PADDING_X * 2),
        actionY,
        secondaryX,
        primaryX,
        bodyClipped: bodyHeight < bodyNeeded,
    };
}
