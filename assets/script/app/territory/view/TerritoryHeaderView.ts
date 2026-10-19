import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { TERRITORY_EVENTS } from './TerritoryEvents';
import { TERRITORY_COLORS } from './TerritoryTheme';

const { ccclass, property } = _decorator;

/** 一次完整的 HUD 内容。视图**全量幂等赋值**：字段少一个就画不对，所以不设可选成员。 */
export interface ITerritoryHudRender {
    /** 章节名 · 已占领 N/M · 已启用 K 张卡牌。 */
    readonly chapterText: string;
    readonly walletText: string;
    /** 有战斗结果 / 结算提示时钱包行转金色。 */
    readonly walletHighlight: boolean;
    readonly inventoryText: string;
    readonly hintText: string;
    readonly previousEnabled: boolean;
    readonly nextEnabled: boolean;
    readonly nextCaption: string;
}

/**
 * 领地页的静态 HUD（顶部章节信息 + 底部提示条），挂在 `TerritoryPage.prefab` 的 `HudLayer` 上。
 *
 *  旧实现把这一整块也用 `box()/text()/spriteButton()` 现搭：每次 `drawMap()`（含每秒的 tick）
 *  都把 9 个节点销毁重建、文案重写一遍。现在节点与引用都在 prefab 上，这里只写文案与按钮态。
 *
 *  ⚠️ **定位一律交给 prefab 里的 `cc.Widget`**（距顶 / 距底固定），不再用
 *  `hudSize.height / 2 - N` 现算 —— 后者在长屏上会把整排 HUD 跟着屏幕中心往下带
 *  （旧实现在 1463 高的可见区里标题会跑到 639 处）。
 */
@ccclass('TerritoryHeaderView')
export class TerritoryHeaderView extends Component {
    @property({ type: Node, group: '节点引用', tooltip: 'Content：常态 HUD 的容器（历史加载态切换遗留的结构引用，现仅作绑定）' })
    contentLayer: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'HeaderPanel：顶部信息带底图' })
    headerSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Title：固定的「章节领地」' })
    titleLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'ChapterLabel：章节名 · 占领进度 · 已启用卡牌数' })
    chapterLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'WalletLabel：银币 / 体力 / 战斗结果提示' })
    walletLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'InventoryLabel：领地库存' })
    inventoryLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'PrevChapter：上一章' })
    previousButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'PrevChapter 的文案' })
    previousLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'NextChapter：下一章 / 完成后解锁 / 最终章' })
    nextButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'NextChapter 的文案' })
    nextLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'HintPanel：底部提示条底图' })
    hintPanel: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'HintLabel：底部提示文案' })
    hintLabel: Label = null!;

    /**
     * 绑一次按钮（页面在 `onLoad` 里调）。
     *
     * 按钮点击在**本组件节点**上发事件（`PREVIOUS_CHAPTER` / `NEXT_CHAPTER`），
     * 页面在 `hudView.node` 上监听；监听随节点销毁自动清理。
     * 监听回调必须是**命名 handler**（可 off、可 grep 追踪），严禁匿名闭包。
     */
    initialize(): void {
        this.previousButton.node.on(Button.EventType.CLICK, this.handlePreviousChapter, this);
        this.nextButton.node.on(Button.EventType.CLICK, this.handleNextChapter, this);
    }

    private readonly handlePreviousChapter = (): void => {
        this.node.emit(TERRITORY_EVENTS.PREVIOUS_CHAPTER);
    };

    private readonly handleNextChapter = (): void => {
        this.node.emit(TERRITORY_EVENTS.NEXT_CHAPTER);
    };

    render(state: ITerritoryHudRender): void {
        this.setLabel(this.chapterLabel, state.chapterText);
        this.setLabel(this.walletLabel, state.walletText);
        this.setLabel(this.inventoryLabel, state.inventoryText);
        this.setLabel(this.hintLabel, state.hintText);
        this.setLabel(this.nextLabel, state.nextCaption);
        this.setLabel(this.previousLabel, '上一章');
        this.walletLabel.color = state.walletHighlight
            ? TERRITORY_COLORS.gold
            : TERRITORY_COLORS.cream;
        this.previousButton.interactable = state.previousEnabled;
        this.nextButton.interactable = state.nextEnabled;
    }

    private setLabel(label: Label, value: string | null): void {
        const text = value ?? '';
        if (label.string !== text) label.string = text;
    }
}
