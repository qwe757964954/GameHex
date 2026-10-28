import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CHEST_EVENTS } from './ChestEvents';
import { RewardItemView, type IRewardItemData } from '../common/RewardItemView';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { formatChestCountdown } from './ChestTypes';

const { ccclass, property } = _decorator;

/** 弹窗内容，全部由 `NewTreasureRepository` 的数据 + 配置算出。 */
export interface IChestDetailContent {
    readonly name: string;
    /** 「品质：史诗」这类整句（品质名映射在数据层做，视图不做翻译）。 */
    readonly qualityText: string;
    /** 「数量：1」。 */
    readonly countText: string;
    readonly icon: SpriteFrame | null;
    /** 宝箱品质框（`cu_quality_0N`）。 */
    readonly qualityFrame: SpriteFrame | null;
    readonly rewards: readonly IRewardItemData[];
    /** 「立即打开」的银币消耗；`<= 0` 不显示价格。 */
    readonly fastOpenCost: number;
    readonly fastOpenEnabled: boolean;
    /** 「打开」的按钮文案。 */
    readonly openCaption: string;
    /** 「打开」按钮上的倒计时文本（`01:35:25`）；空串 = 不显示。 */
    readonly openCountdown: string;
    readonly openEnabled: boolean;
    /** 「立即打开」那颗按钮上的银币图标（弹窗自己不解表，页面解析好传进来）。 */
    readonly costIcon: SpriteFrame | null;
}

/**
 * 「宝箱详情」弹窗 —— 主界面底部宝箱栏点宝箱时弹出（蓝湖「宝箱详情」设计稿）。
 *
 * 资产：`ui/main/ChestDetailPanel.prefab`（原 `bigmap` 分包的 `BigMapChestDetailPanel`，
 * 2026-10-27 搬到 `resources`：`image/bigmap/auto-atlas.pac` 递归覆盖整棵树，
 * 留在分包等于主界面首屏要拉 16M 图集）。
 *
 * ## 为什么点击不再直接开箱
 *
 * 原来 `MainPage.onChestAction` 点一下就发 activate / fastOpen / open 三条请求之一 ——
 * 玩家看不到箱子里有什么、也不知道马上开要花多少钱。现在点宝箱只弹这个详情，
 * 由弹窗上的两颗按钮发请求（语义与原来一一对应，见 `MainPage`）。
 *
 * ## 交互：只派发意图
 *
 * 三颗按钮都走 `EventMgr`（`CHEST_EVENTS`），页面订阅后转给 Repository；
 * 尺寸 / 遮罩 / 点击空白关闭 / 层级全部交给 `PopupManager`（prefab 上 Dim 与根节点挂 `cc.Widget` 四边对齐）。
 * 视图不持有控制器入口 —— 与 `BigMapPlayerLevelPanel` / `LevelInfoPanel` 同口径。
 */
@ccclass('ChestDetailPanel')
export class ChestDetailPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/main/`）。 */
    static prefabPath = 'ui/main/ChestDetailPanel';

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/QualityFrame：品质框' })
    private qualityFrame: Sprite = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/ChestIcon：宝箱图标' })
    private chestIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/ChestName：宝箱名' })
    private nameLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/QualityText：品质' })
    private qualityLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/CountText：数量' })
    private countLabel: Label = null!;

    /** 奖励说明：四列网格使用详情页样式，仍由公共 RewardItemView 解析物品。 */
    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'Panel/ItemSlots：奖励说明（itemPrefab = ChestDetailRewardItem）' })
    private dropList: VirtualScrollView = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnSecondary：立即打开（花银币）' })
    private fastButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/Label' })
    private fastLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnSecondary/CostBg：费用底' })
    private fastCostRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnSecondary/CostIcon：银币图标' })
    private fastCostIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/CostLabel：费用数字' })
    private fastCostLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnPrimary：打开 / 倒计时' })
    private openButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/Label：打开' })
    private openLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnPrimary/CostBg：倒计时底' })
    private openCostRoot: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/CostLabel：倒计时文本' })
    private openCostLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnClose：关闭' })
    private closeButton: Button = null!;

    private fallbackChestIcon: SpriteFrame | null = null;

    protected onInit(): void {
        this.fallbackChestIcon = this.chestIcon.spriteFrame;
        this.dropList.renderItemFn = this.renderReward;
        this.closeButton.node.on(Button.EventType.CLICK, this.handleClose, this);
        this.fastButton.node.on(Button.EventType.CLICK, this.handleFastOpen, this);
        this.openButton.node.on(Button.EventType.CLICK, this.handleOpen, this);
    }

    protected onOpen(userData?: unknown): void {
        if (userData) this.applyContent(userData as IChestDetailContent);
    }

    protected onClose(): void {
        // 页面靠这条把 `detailSlot` 清掉（`PopupManager` 单实例，重复 close 无害）
        EventMgr.instance.emit(CHEST_EVENTS.CLOSE);
    }

    /**
     * 全量赋值（幂等）。
     *
     * ⚠️ 换箱子时不能靠「再 `open` 一次」刷新 —— `PopupManager.openAsync` 对同类弹窗单实例去重，
     * 已打开时直接返回现有实例、不重走 `onOpen`。页面拿 `PopupManager.inst.get(...)` 调这里。
     */
    applyContent(content: IChestDetailContent): void {
        this.nameLabel.string = content.name;
        this.qualityLabel.string = content.qualityText;
        this.countLabel.string = content.countText;
        this.chestIcon.spriteFrame = content.icon ?? this.fallbackChestIcon;
        this.qualityFrame.spriteFrame = content.qualityFrame;

        this.rewards = content.rewards;
        this.dropList.setTotalCount(content.rewards.length);

        this.fastLabel.string = '立即打开';
        this.fastButton.interactable = content.fastOpenEnabled;
        const hasCost = Number.isFinite(content.fastOpenCost) && content.fastOpenCost > 0;
        this.fastCostLabel.string = hasCost ? String(Math.round(content.fastOpenCost)) : '';
        this.fastCostRoot.active = hasCost;

        this.openLabel.string = content.openCaption;
        this.openButton.interactable = content.openEnabled;
        this.updateCountdownText(content.openCountdown);
        // 传 null 时保留 prefab 上的静态银币图（不要清空）
        if (content.costIcon) this.fastCostIcon.spriteFrame = content.costIcon;
    }

    /**
     * 只刷新「打开」按钮上的倒计时（页面每秒调）。
     *
     * 整窗重开（`open`）会重写全部标签并重设兄弟顺序 ⇒ 每秒闪一下；倒计时是唯一
     * 逐秒变化的东西，所以单独给一条轻量入口。
     */
    updateCountdown(remainSeconds: number, isCounting = true): void {
        this.updateCountdownText(remainSeconds > 0 ? formatChestCountdown(remainSeconds) : '');
        this.openButton.interactable = !isCounting || remainSeconds <= 0;
    }

    /** 本趟的奖励（`renderItemFn` 按下标现取，别在回调里闭包捕获某一趟的 content）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 单格渲染 —— 走公共 `RewardItemView`（带概率的那套只有这个弹窗用）。 */
    private readonly renderReward = (item: Node, index: number): void => {
        item.getComponent(RewardItemView)!.render(this.rewards[index]);
    };

    private updateCountdownText(text: string): void {
        this.openCostLabel.string = text;
        this.openCostRoot.active = text !== '';
    }

    private handleFastOpen(): void {
        if (!this.fastButton.interactable) return;
        EventMgr.instance.emit(CHEST_EVENTS.FAST_OPEN);
    }

    private handleOpen(): void {
        if (!this.openButton.interactable) return;
        EventMgr.instance.emit(CHEST_EVENTS.OPEN);
    }

    private handleClose(): void {
        this.closeByButton();
    }
}
