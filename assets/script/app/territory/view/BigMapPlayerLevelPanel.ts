import { EventMgr } from '../../../framework/event/EventMgr';
import {
    _decorator, BlockInputEvents, Button, Component, Label, Node, Sprite, SpriteFrame, UITransform,
} from 'cc';
import { TERRITORY_EVENTS } from './TerritoryEvents';
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

/** 弹窗内容。全部由 Presenter 的纯规则算出，视图只负责写节点。 */
export interface IBigMapPlayerLevelContent {
    /** 标题木牌：据点名（服务端暂不下发对手昵称，见 `TerritoryPresenter.playerStageContent`）。 */
    readonly title: string;
    /** 第一条占领奖励的文案（如「获得 1 个卡牌宝箱」）。空串 = 整条隐藏。 */
    readonly chestText: string;
    /** 第二条占领奖励的图标格（最多 3 个）。 */
    readonly rewards: readonly IRewardItemData[];
    /** 「侦查」按钮的货币消耗；`<= 0` 不显示费用角标。 */
    readonly scoutCost: number;
    /** 「开始战斗」按钮的货币消耗；`<= 0` 不显示费用角标。 */
    readonly fightCost: number;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
}

/**
 * 「玩家关卡」弹窗 —— 领地页点**异步据点**（`TERRITORY_SITE_TYPE.asyncPvp`）时弹出。
 *
 * 资产名沿用设计稿（蓝湖「玩家关卡」，`ui/territory/BigMapPlayerLevelPanel.prefab`），
 * 类名与 prefab 同名便于对照；归属是领地页，所以代码放在 `app/territory/view`。
 *
 * ## 为什么不是 `BigMapTargetPanel`
 *
 * 后者是「三行文字 + 一颗开战按钮」的通用关卡弹窗（`BigMapLevelInfoPanel` 在用）；
 * 这个面板是**玩家据点专用**结构：标题木牌 + 两条占领奖励（第二条是图标格）+ 侦查/开战双按钮，
 * 两个按钮**各带一份货币消耗**。硬塞进通用组件会把它的字段撑成一半永远用不上。
 *
 * ## 交互：只派发意图，不收回调
 *
 * 按钮点击一律在本节点上 `emit`（`TERRITORY_EVENTS`），页面订阅后转给 Presenter。
 * 这是 `docs/AI架构与代码规范.md` §2.1 的口径 —— 视图不持有控制器入口，
 * 漏传回调不会变成「点了没反应且零报错」。
 */
@ccclass('BigMapPlayerLevelPanel')
export class BigMapPlayerLevelPanel extends Component {
    @property({ type: UITransform, group: '节点引用', tooltip: 'Panel：弹窗主卡（用于等比缩放适配）' })
    private panelTransform: UITransform = null!;

    @property({ type: UITransform, group: '节点引用', tooltip: 'Dim：全屏暗底（点它 = 关闭）' })
    private dimTransform: UITransform = null!;

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

    private inited = false;

    /**
     * 绑一次交互并做屏幕适配；重复调用无副作用（页面在 `onLoad` 里调一次）。
     *
     * `costIcon` 是银币图标：弹窗自己不解表（避免视图里出现配置读取），由页面加载后注入。
     */
    initialize(width: number, height: number, costIcon: SpriteFrame | null): void {
        this.dropList.renderItemFn = this.renderReward;
        this.setCostIcon(costIcon);
        if (width > 0 && height > 0) {
            const root = this.node.getComponent(UITransform);
            if (root) root.setContentSize(width, height);
            this.dimTransform.setContentSize(width, height);
            const scale = Math.min(1, (width - 32) / this.panelTransform.width,
                (height - 64) / this.panelTransform.height);
            this.panelTransform.node.setScale(scale, scale, 1);
        }
        if (this.inited) return;
        this.inited = true;
        if (!this.dimTransform.node.getComponent(BlockInputEvents)) {
            this.dimTransform.node.addComponent(BlockInputEvents);
        }
        if (!this.panelTransform.node.getComponent(BlockInputEvents)) {
            this.panelTransform.node.addComponent(BlockInputEvents);
        }
        this.dimTransform.node.on(Node.EventType.TOUCH_END, this.handleClose, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.handleClose, this);
        this.scoutButton.node.on(Button.EventType.CLICK, this.handleScout, this);
        this.fightButton.node.on(Button.EventType.CLICK, this.handleFight, this);
        this.node.active = false;
    }

    /** 本趟的奖励（`renderItemFn` 按下标现取）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 单格渲染 —— 走公共 `RewardItemView`（不带概率）。 */
    private readonly renderReward = (item: Node, index: number): void => {
        item.getComponent(RewardItemView)!.render(this.rewards[index]);
    }

    get isOpen(): boolean {
        return this.node.active;
    }

    /**
     * 费用角标的货币图标（两个按钮共用同一张）。
     *
     * 页面加载完银币图后单独补一次：`onLoad` 里实例化时图还在异步加载，那时只能给 `null`。
     */
    setCostIcon(frame: SpriteFrame | null): void {
        this.scoutCostIcon.spriteFrame = frame;
        this.fightCostIcon.spriteFrame = frame;
    }

    /** 打开并全量赋值（幂等：连续两次 `open` 与一次等价）。 */
    open(content: IBigMapPlayerLevelContent): void {
        this.titleLabel.string = content.title;
        this.chestLabel.string = content.chestText;
        this.chestLabel.node.active = content.chestText !== '';

        // 条数交给虚拟列表（3 列网格）；`renderItemFn` 按下标现取
        this.rewards = content.rewards;
        this.dropList.setTotalCount(content.rewards.length);

        this.scoutLabel.string = '侦查';
        this.scoutButton.interactable = true;
        this.applyCost(this.scoutCostRoot, this.scoutCostLabel, content.scoutCost);

        this.fightLabel.string = content.fightCaption;
        this.fightButton.interactable = content.fightEnabled;
        this.applyCost(this.fightCostRoot, this.fightCostLabel, content.fightCost);

        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent ? this.node.parent.children.length - 1 : 0);
    }

    close(): void {
        this.node.active = false;
    }

    private applyCost(root: Node, label: Label, cost: number): void {
        const has = Number.isFinite(cost) && cost > 0;
        label.string = has ? String(Math.round(cost)) : '';
        root.active = has;
    }

    private handleScout(): void {
        EventMgr.instance.emit(TERRITORY_EVENTS.DETAIL_SCOUT);
    }

    private handleFight(): void {
        if (!this.fightButton.interactable) return;
        EventMgr.instance.emit(TERRITORY_EVENTS.DETAIL_START);
    }

    private handleClose(): void {
        EventMgr.instance.emit(TERRITORY_EVENTS.DETAIL_CLOSE);
    }
}
