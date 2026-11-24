/**
 * 结算页（蓝湖「结算-MVP」720×1610）的样式与布局 token。
 *
 * 设计稿的数值集中在这里，prefab / 页面 / 测试共用同一份口径：
 * 改字号、颜色、奖励列数或标题套图时只改本文件，不再到处搜数字。
 * 纯 TS（规则 78：不 import `cc`），可被 ui / view / 测试直接引用。
 */
export const ZC_SETTLEMENT_STYLE = {
    /** 胜利 / 失败的标题套图（`image/settlement/` 下的资源 key）。*/
    title: {
        victory: { plate: 'settlement/JS_title_bg_01', text: 'settlement/title_text_01' },
        defeat: { plate: 'settlement/JS_title_02', text: 'settlement/title_text' },
    } as const,

    /** MVP 骨骼立绘的动画契约与归一比例。*/
    mvpArt: {
        /** 所有兵种 prefab 的固定骨骼子节点名。*/
        spineNodeName: 'spine',
        /** 结算立绘只播待机。*/
        idleAnimation: 'idle',
        /**
         * 设计稿立绘位 170×265，角色实际美术高约 288（帽子/影子略溢出宿主）。
         * 归一目标是「宿主高 × 该比例」，不是宿主高本身，否则会比稿面小 9%。
         */
        artHeightRatio: 1.09,
        /** 量不到包围盒时的 canvas 兜底；正常路径用 idle 首帧包围盒。*/
        canvasFallbackRatio: 0.97,
    } as const,

    /** 文字颜色（prefab 里是 cc.Color，这里是设计稿十六进制）。*/
    colors: {
        rankName: '#FFD028',
        rankAdd: '#57E467',
        teamLink: '#86C8FF',
        rewardTitle: '#FFFEFA',
    } as const,

    /** 字号 / 行高（设计稿 dp，Cocos 直接按同值使用）。*/
    fonts: {
        mvpLevel: { size: 26, line: 32 },
        mvpName: { size: 32, line: 36 },
        mvpStatLabel: { size: 24, line: 30 },
        /** 百分比比左侧文案小一号，避免 `51%` 抢过「总输出」。*/
        mvpStatRate: { size: 22, line: 28 },
        mvpStatValue: { size: 26, line: 30 },
        teamLink: { size: 24, line: 28 },
    } as const,

    /** 通关奖励虚拟列表：设计稿 5 列、列距 15、行距 18、格子 96×96。*/
    rewardGrid: {
        columns: 5,
        spacing: 18,
        gridSpacing: 15,
        itemSize: 96,
    } as const,

    /** MVP 徽标与立绘的自适应布局 token。*/
    mvpBadge: {
        /** 徽标默认中心 X（蓝湖设计稿基准值，Lv.名字 左侧）。*/
        defaultX: -46.5,
        /** 徽标默认中心 Y（蓝湖设计稿基准值）。*/
        defaultY: 132.5,
        /** 徽标与角色可见头顶之间的安全呼吸间距（设计稿懂王头顶 91，91 + 21.5 + 20 = 132.5）。*/
        gapY: 21.5,
        /** 徽标高 40，半高 20。*/
        halfHeight: 20,
        /** 徽标中心最低 Y（避免偏矮角色徽标下沉过多）。*/
        minCenterY: 125,
        /** 徽标中心最高 Y（严禁超出蓝湖设计稿 132.5，确保与上方战斗胜利飘带留出安全留白）。*/
        maxCenterY: 132.5,
        /** 角色头顶/最高点在 MvpBlock 坐标系中的最大允许高度（对齐设计稿角色高 231，-140 + 231 = 91）。*/
        maxHeadTopInBlock: 91,
    } as const,

    /** 段位行 / 奖励区之间的垂直节奏（运行时只在「段位行收起」时用来补位）。*/
    layout: {
        /** 段位行与奖励框之间的设计间距。*/
        rankRewardGap: 2,
        /** prefab 里段位行的高度；取不到 UITransform 时兜底。*/
        rankRowHeight: 91,
    } as const,
} as const;

export type ZCSettlementStyle = typeof ZC_SETTLEMENT_STYLE;

/**
 * 根据体型上限与头顶安全线，计算 MVP 立绘的实际允许高度。
 * 超出头顶安全线时等比收敛，避免高个子角色/带头盔角色顶天立地碰横幅。
 */
export function calcMvpEffectiveArtHeight(
    desiredHeight: number,
    footInBlock: number,
    maxHeadTopInBlock: number = ZC_SETTLEMENT_STYLE.mvpBadge.maxHeadTopInBlock,
): number {
    const maxAllowed = Math.max(0, maxHeadTopInBlock - footInBlock);
    return Math.min(desiredHeight, maxAllowed);
}

/**
 * 根据角色在 MvpBlock 坐标系中的真实头顶高度，计算 MVP 徽标自适应落位 Y。
 * 无模型 / 坐标无效时返回蓝湖设计稿默认值 132.5。
 */
export function calcMvpAdaptiveBadgeY(headTopInBlock: number): number {
    const token = ZC_SETTLEMENT_STYLE.mvpBadge;
    if (!Number.isFinite(headTopInBlock)) return token.defaultY;
    const desired = headTopInBlock + token.gapY + token.halfHeight;
    return Math.max(token.minCenterY, Math.min(token.maxCenterY, desired));
}
