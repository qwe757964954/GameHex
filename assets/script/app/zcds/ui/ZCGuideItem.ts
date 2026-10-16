/**
 * ZCGuideItem —— 战斗指南列表的单个条目视图（挂在 ZCGuideItem.prefab 根节点上）。
 *
 * 卡片布局对齐参考图 assets/resources/image/战斗_指南.png：
 *   zd_list     一整张卡片底图（594×184，含顶部标题区 + 正文区）
 *   TitleLab    标题，居中放在卡片顶部标题区
 *   HexIcon     左侧绿色六边形（100×107）
 *     CostIcon  金币图标 + CostLab 消耗数（压在六边形左下角）
 *     icon_question  六边形里的图标槽位：金矿 / 兵营 / 问号
 *   zd_line_02  六边形与奖励文字之间的竖分隔线
 *   Reward0~3   奖励概率文字栅格（2 列，1~2 行，整块在正文区垂直居中）
 *
 * 图标槽位只有一个 Sprite（节点名 `icon_question`）：每个图标键各有一条
 * SpriteFrame 路径（见 ZCGuideConfig.GUIDE_ICON_PATHS），包括「问号」也走美术
 * `gameui/icon_question.png`，不再用「'?' 文字」+ 回退标签的老方案。
 *
 * 所有子节点引用通过 @property 在 Inspector 拖拽绑定，不在运行时按名字查找。
 */

import { _decorator, Color, Component, Label, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import type { ZCGuideEntry, ZCGuideRarity, ZCGuideReward } from './ZCGuideConfig';

const { ccclass, property } = _decorator;

/** 百分比去尾零：100 → '100'，8.5 → '8.5'。 */
function formatRate(rate: number): string {
    return String(Math.round(rate * 100) / 100);
}

/** 奖励文字两列的左边界（卡片本地坐标，锚点左中）；取自参考图 x254 / x484。 */
const REWARD_COLUMN_X = [-105, 125] as const;
/** 奖励文字行距；参考图两行中心 y440 / y484。 */
const REWARD_ROW_PITCH = 44;
/** 奖励文字整块的垂直中心（相对卡片中心）。 */
const REWARD_BLOCK_CENTER_Y = -15;
/**
 * 图标槽位的最大显示框。
 * 建筑图标原图 128×128，比六边形（100×107）还大，必须缩到框内才不会溢出；
 * 「问号」原图只有 24×40，fitInside 不会放大，保持原生尺寸与 prefab 里的位置。
 */
const ICON_BOX_WIDTH = 62;
const ICON_BOX_HEIGHT = 58;

@ccclass('ZCGuideItem')
export class ZCGuideItem extends Component {
    /** 正文/标题深棕，与参考图取色一致。原在 `ui/ZCGuideConfig.ts` 导出，仅本类用。 */
    private static readonly GUIDE_INK = new Color(87, 46, 35, 255);

    /** 品级高亮色；'空' 沿用正文色，不做强调。 */
    private static readonly RARITY_COLORS: Readonly<Record<ZCGuideRarity, Color>> = {
        空: ZCGuideItem.GUIDE_INK,
        绿: new Color(74, 143, 34, 255),
        蓝: new Color(42, 111, 184, 255),
        紫: new Color(139, 63, 196, 255),
        金: new Color(229, 115, 3, 255),
    };

    /** 取奖励文字颜色；未登记品级回退正文色。不依赖实例状态，静态即可。 */
    private static guideRewardColor(reward: ZCGuideReward): Color {
        return ZCGuideItem.RARITY_COLORS[reward.rarity] ?? ZCGuideItem.GUIDE_INK;
    }

    @property({ type: Label, group: '标题', tooltip: 'TitleLab：卡片标题，如「获得一座金矿」' })
    titleLabel: Label = null!;

    @property({ type: Sprite, group: '图标', tooltip: 'HexIcon：绿色六边形地块底图' })
    hexIcon: Sprite = null!;

    @property({ type: Sprite, group: '图标', tooltip: 'HexIcon/icon_question：六边形里的图标槽位（金矿/兵营/问号）' })
    iconSprite: Sprite = null!;

    @property({ type: Sprite, group: '消耗', tooltip: 'HexIcon/CostIcon：金币图标' })
    costIcon: Sprite = null!;

    @property({ type: Label, group: '消耗', tooltip: 'HexIcon/CostLab：开发消耗金币' })
    costLabel: Label = null!;

    // 奖励槽位拆成 4 个显式 @property，方便在 Inspector 逐个拖拽绑定
    // （cc 的组件数组属性在编辑器脚本里不便批量赋值，显式字段更稳）。
    @property({ type: Label, group: '奖励', tooltip: 'Reward0：奖励文字槽位 1（行优先，左列）' })
    reward0: Label = null!;

    @property({ type: Label, group: '奖励', tooltip: 'Reward1：奖励文字槽位 2（行优先，右列）' })
    reward1: Label = null!;

    @property({ type: Label, group: '奖励', tooltip: 'Reward2：奖励文字槽位 3（行优先，左列第二行）' })
    reward2: Label = null!;

    @property({ type: Label, group: '奖励', tooltip: 'Reward3：奖励文字槽位 4（行优先，右列第二行）' })
    reward3: Label = null!;

    /** 4 个奖励槽位，按「行优先」顺序展开，供内部遍历。 */
    private get rewardSlots(): Label[] {
        return [this.reward0, this.reward1, this.reward2, this.reward3];
    }

    /**
     * 用一条指南数据刷新卡片。
     * @param entry 指南条目
     * @param iconFrames 预加载好的图标帧表（key = 条目 icon 字段）
     */
    render(entry: ZCGuideEntry, iconFrames: ReadonlyMap<string, SpriteFrame>): void {
        this.titleLabel.string = entry.title;
        this.costLabel.string = String(Math.max(0, Math.floor(entry.price)));
        this.renderIcon(iconFrames.get(entry.icon) ?? null);
        this.renderRewards(entry);
    }

    /** 无数据时把卡片清空，避免虚拟列表复用残留上一条内容。 */
    clear(): void {
        this.titleLabel.string = '';
        this.costLabel.string = '';
        this.renderIcon(null);
        for (const label of this.rewardSlots) {
            label.string = '';
            label.node.active = false;
        }
    }

    
    // 内部实现
    

    /**
     * 刷新六边形里的图标槽位。
     * 位置由 prefab 决定（参考图里问号/建筑图标都偏六边形上半部，左下角留给金币徽章），
     * 代码只换 SpriteFrame 并统一尺寸，避免 128×128 的建筑图标撑破 100×107 的六边形。
     */
    private renderIcon(frame: SpriteFrame | null): void {
        const sprite = this.iconSprite;
        sprite.node.active = !!frame;
        sprite.spriteFrame = frame;
        if (!frame) return;

        // 尺寸由代码统一控制，所以切成 CUSTOM：TRIMMED 会在换图时把节点拉回原图尺寸
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const size = fitInside(frame, ICON_BOX_WIDTH, ICON_BOX_HEIGHT);
        sprite.node.getComponent(UITransform)!.setContentSize(size.width, size.height);
    }

    /**
     * 奖励文字按「行优先」填进 2 列栅格，整块在卡片正文里垂直居中：
     * 1 行 → y = -15；2 行 → y = +7 / -37（由 REWARD_BLOCK_CENTER_Y 与 REWARD_ROW_PITCH 推出）。
     */
    private renderRewards(entry: ZCGuideEntry): void {
        const slots = this.rewardSlots;
        const count = Math.min(entry.rewards.length, slots.length);
        const rows = Math.max(1, Math.ceil(count / REWARD_COLUMN_X.length));
        const topY = REWARD_BLOCK_CENTER_Y + ((rows - 1) * REWARD_ROW_PITCH) / 2;

        for (let i = 0; i < slots.length; i += 1) {
            const label = slots[i];
            const reward = i < count ? entry.rewards[i] : undefined;
            if (!reward) {
                label.string = '';
                label.node.active = false;
                continue;
            }
            const column = i % REWARD_COLUMN_X.length;
            const row = Math.floor(i / REWARD_COLUMN_X.length);
            label.node.setPosition(new Vec3(REWARD_COLUMN_X[column], topY - row * REWARD_ROW_PITCH, 0));
            label.node.active = true;
            label.string = `${reward.name}:${formatRate(reward.rate)}%`;
            label.color = ZCGuideItem.guideRewardColor(reward);
        }
    }
}

/**
 * 在给定框内等比缩放，返回应使用的显示尺寸。
 * 只缩小、不放大（scale 上限 1）：问号原图 24×40 小于框，保持原生尺寸；
 * 建筑图标 128×128 大于框，缩到 58×58。
 */
function fitInside(frame: SpriteFrame, boxWidth: number, boxHeight: number): { width: number; height: number } {
    const rawWidth = frame.originalSize.width || frame.rect.width || boxWidth;
    const rawHeight = frame.originalSize.height || frame.rect.height || boxHeight;
    const scale = Math.min(1, boxWidth / rawWidth, boxHeight / rawHeight);
    return {
        width: Math.round(rawWidth * scale),
        height: Math.round(rawHeight * scale),
    };
}
