import { EventMgr } from '../../../framework/event/EventMgr';
import {
    _decorator, Button, Label, Node, Sprite, SpriteFrame, UITransform,
} from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { TerritoryUiEvent } from '../application/TerritoryEvents';
import { RewardItemView } from '../../common/RewardItemView';
import type { IRewardItemData } from '../../common/RewardItemView';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';

const { ccclass, property } = _decorator;

/** 一格占领奖励的**显示数据**（帧已按 `roleProperty` / `item` 解析好）。 */
export interface IBigMapPlayerLevelReward {
    /** 品质框帧（`cu_quality_0N`）；查不到品质时传 `null`，格子退化成只有图标。 */
    readonly frame: SpriteFrame | null;
    readonly icon: SpriteFrame | null;
    readonly amount: number;
}

/** 弹窗内容。全部由 Controller 的纯规则算出，视图只负责写节点。 */
export interface IBigMapPlayerLevelContent {
    /** 标题木牌：据点名（服务端暂不下发对手昵称，见 `TerritoryModel.playerStageContent`）。 */
    readonly title: string;
    /** 第一条占领奖励的文案（如「获得 1 个卡牌宝箱」）。空串 = 整条隐藏。 */
    readonly chestText: string;
    /** 第二条占领奖励的图标格（最多 3 个）。 */
    readonly rewards: readonly IRewardItemData[];
    /** 「侦查」按钮的**体力**消耗；`<= 0` 不显示费用角标。 */
    readonly scoutCost: number;
    /** 「开始战斗」按钮的**体力**消耗；`<= 0` 不显示费用角标。 */
    readonly fightCost: number;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
    /** 费用图标（体力）。`null` ⇒ 只藏图标、数字照常显示。 */
    readonly staminaIcon?: SpriteFrame | null;
}

/**
 * 「玩家关卡」弹窗 —— 领地页点**异步据点**（`TERRITORY_SITE_TYPE.asyncPvp`）时弹出。
 *
 * 走 `PopupBase` 处理，层级、遮罩与点击空白关闭均由 `PopupManager` / `PopupBase` 统一接管。
 *
 * 交互：只派发意图，不收回调
 * 按钮点击一律经 `EventMgr.instance.emit` 派发意图事件，由页面/控制器集中处理。
 */
@ccclass('BigMapPlayerLevelPanel')
export class BigMapPlayerLevelPanel extends PopupBase {
    /** 预制体路径（PopupManager 统一按需加载）。 */
    static prefabPath = 'ui/territory/BigMapPlayerLevelPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：据点名' })
    private titleLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/RewardText1：第一条占领奖励文案' })
    private chestLabel: Label = null!;

    /** 占领奖励：**公共格子 `ui/common/RewardItem.prefab`** 的 3 列网格虚拟列表。 */
    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'Panel/RewardSlots：占领奖励（itemPrefab = common/RewardItem）' })
    private dropList: VirtualScrollView = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnSecondary：侦查' })
    private scoutButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/Label：侦查文案' })
    private scoutLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnSecondary/CostBg：费用底色（无费用时隐藏）' })
    private scoutCostRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnSecondary/CostIcon：货币图标' })
    private scoutCostIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/CostLabel：费用数字' })
    private scoutCostLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnPrimary：开始战斗' })
    private fightButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/Label：开战文案' })
    private fightLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnPrimary/CostBg：费用底色' })
    private fightCostRoot: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnPrimary/CostIcon：货币图标' })
    private fightCostIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/CostLabel：费用数字' })
    private fightCostLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/Close：关闭' })
    private closeButton: Button = null!;

    /** 兼容字段（历史留存，不再参与手工尺寸适配与事件监听）。 */
    panelTransform?: UITransform;
    dimTransform?: UITransform;

    /** 上一次渲染的内容。 */
    private lastContent: IBigMapPlayerLevelContent | null = null;

    /** 本趟的奖励（`renderItemFn` 按下标现取）。 */
    private rewards: readonly IRewardItemData[] = [];

    protected onInit(): void {
        this.dropList.renderItemFn = this.renderReward;
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
        this.scoutButton.node.on(Button.EventType.CLICK, this.handleScout, this);
        this.fightButton.node.on(Button.EventType.CLICK, this.handleFight, this);
    }

    protected onOpen(userData?: unknown): void {
        if (userData) this.applyContent(userData as IBigMapPlayerLevelContent);
    }

    protected onClose(): void {
        this.lastContent = null;
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
    }

    /**
     * 兼容历史接口；改用 PopupBase 后全屏适配由 PopupManager 与 Widget 统一负责。
     */
    initialize(_width?: number, _height?: number, costIcon: SpriteFrame | null = null): void {
        if (costIcon !== null) this.setCostIcon(costIcon);
    }

    /** 单格渲染 —— 走公共 `RewardItemView`（不带概率）。 */
    private readonly renderReward = (item: Node, index: number): void => {
        item.getComponent(RewardItemView).render(this.rewards[index]);
    };

    /**
     * 费用角标的货币图标（两个按钮共用同一张，内容是**体力**）。
     *
     * 页面加载完体力图后单独补一次：`onLoad` 里实例化时图还在异步加载，那时只能给 `null`。
     */
    setCostIcon(frame: SpriteFrame | null): void {
        this.scoutCostIcon.spriteFrame = frame;
        this.fightCostIcon.spriteFrame = frame;
        if (this.lastContent && this.isPopupOpen) {
            this.applyCosts(this.lastContent);
        }
    }

    /** 面板已开时换内容或由 onOpen 填充（幂等）。 */
    applyContent(content: IBigMapPlayerLevelContent): void {
        this.titleLabel.string = content.title;
        this.chestLabel.string = content.chestText;
        this.chestLabel.node.active = content.chestText !== '';

        this.rewards = content.rewards;
        this.dropList.setTotalCount(content.rewards.length);

        this.scoutLabel.string = '侦查';
        this.scoutButton.interactable = true;

        this.fightLabel.string = content.fightCaption;
        this.fightButton.interactable = content.fightEnabled;

        if (content.staminaIcon !== undefined) {
            this.scoutCostIcon.spriteFrame = content.staminaIcon;
            this.fightCostIcon.spriteFrame = content.staminaIcon;
        }

        this.lastContent = content;
        this.applyCosts(content);
    }

    /** 两颗按钮的费用角标（数字 + 底色 + **体力图标**一起显隐）。 */
    private applyCosts(content: IBigMapPlayerLevelContent): void {
        this.applyCost(this.scoutCostRoot, this.scoutCostIcon, this.scoutCostLabel, content.scoutCost);
        this.applyCost(this.fightCostRoot, this.fightCostIcon, this.fightCostLabel, content.fightCost);
    }

    private applyCost(root: Node, icon: Sprite, label: Label, cost: number): void {
        const has = Number.isFinite(cost) && cost > 0;
        label.string = has ? String(Math.round(cost)) : '';
        root.active = has;
        icon.node.active = has && icon.spriteFrame !== null;
    }

    private handleScout(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'scout' } });
    }

    private handleFight(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    }

    private handleClose(): void {
        this.closeByButton();
    }
}
