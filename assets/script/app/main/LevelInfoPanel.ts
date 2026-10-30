import { _decorator, Button, Label, Node, Sprite, type SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RewardItemView, type IRewardItemData } from '../common/RewardItemView';
import { TerritoryUiEvent } from '../territory/application/TerritoryEvents';

const { ccclass, property } = _decorator;

/** 「关卡界面」内容。 */
export interface ILevelInfoContent {
    readonly title: string;
    /** 有没有敌军提示（false ⇒ 隐藏右上角感叹号）。 */
    readonly hasTip: boolean;
    /** 通关目标（如「第一名成功通过关卡」）。 */
    readonly objective: string;
    /** 占据奖励（硬币 / 按天）。 */
    readonly occupy: string;
    readonly drops: readonly IRewardItemData[];
    /** 推荐文案；空串 = 整行隐藏（没有数据源时不放假话）。 */
    readonly recommend: string;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
    readonly staminaCost: number;
    /**
     * 费用图标（体力）。`null` ⇒ 只藏图标、数字照常显示。
     *
     * 由**页面**加载后透传（`MainTerritoryMap` 在建内容时塞 `图标_体力`），
     * 弹窗自己不解配置表 —— 与 `BigMapTargetPanel.staminaIcon` 同一口径。
     */
    readonly staminaIcon: SpriteFrame | null;
}

/**
 * 「关卡界面」弹窗 —— 领地页点**关卡 / 首领**据点时弹出（蓝湖「关卡界面」设计稿）。
 *
 * 资产：`ui/main/LevelInfoPanel.prefab`（原 `bigmap` 分包的 `BigMapLevelInfoPanel`，
 * 2026-10-27 搬到 `resources`：`image/bigmap/auto-atlas.pac` 递归覆盖整棵树）。
 *
 * ## 走 `PopupBase`，不自己管尺寸 / 遮罩 / 层级
 *
 * 交给 `PopupManager` 后这三件事都不用写：
 * - **尺寸与拉伸**：弹窗挂在常驻 `Popup` 根（尺寸 = Canvas），prefab 里 `Dim` 和根节点用
 *   `cc.Widget` 四边对齐，长屏由引擎撑开 —— 不需要 `initialize(width, height)`；
 * - **点击空白关闭**：`closeOnBlank` + `contentNodes`（缺省取全部直接子节点）+ `POPUP_BLANK_TOLERANCE`
 *   容差判定，比手工在 Dim 上挂 `TOUCH_END` 准（手工那套点到卡片边缘也会关）；
 * - **层级**：深度栈 + `onCover`/`onReveal`，与「关卡提示」天然形成上下层。
 *
 * ## 交互：只派发意图
 *
 * 感叹号 / 开始战斗都用 `EventMgr` 派发，页面订阅后转给 Presenter。
 *
 * 右上角**只有感叹号**（蓝湖 2026-10-27 终稿）：没有 × 按钮，关闭走 PopupBase 的 `closeOnBlank`
 * —— 点面板以外的空白处就收（`contentNodes` 缺省取全部直接子节点，点到卡片上不会误关）。
 */
@ccclass('LevelInfoPanel')
export class LevelInfoPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/main/`）。 */
    static prefabPath = 'ui/main/LevelInfoPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：关卡标题' })
    private titleLabel: Label = null;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/HintIcon：感叹号 → 关卡提示' })
    private hintButton: Button = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/ObjectiveText：通关目标' })
    private objectiveLabel: Label = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/OccupyText：占据奖励' })
    private occupyLabel: Label = null;

    /** 掉落奖励：**公共格子 `ui/common/RewardItem.prefab`** 的 3 列网格虚拟列表。 */
    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'Panel/DropSlots：掉落奖励（VirtualScrollView，itemPrefab = common/RewardItem）' })
    private dropList: VirtualScrollView = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TipText：推荐文案' })
    private recommendLabel: Label = null;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnPrimary：开始战斗' })
    private fightButton: Button = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/Label：按钮文案' })
    private fightLabel: Label = null;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnPrimary/CostBg：体力费用底' })
    private fightCostRoot: Node = null;

    /**
     * `BtnPrimary/CostIcon`：费用**图标**。
     *
     * 🔴 2026-10-28 用户：「挑战按钮上的图标要更换成对应的体力图标」。
     * prefab 里焊的是 `coin.png`（硬币），但这一行写的是**体力**消耗 ⇒ 运行时由
     * `applyContent` 换成 `图标_体力`（页面加载后透传 `staminaIcon`），
     * prefab 里那张硬币只作编辑器里的占位。
     */
    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnPrimary/CostIcon：费用图标（体力）' })
    private fightCostIcon: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/CostLabel：体力数字' })
    private fightCostLabel: Label = null;

    /** 本趟要铺的掉落（`renderItemFn` 按下标取）。 */
    private drops: readonly IRewardItemData[] = [];

    protected onInit(): void {
        this.hintButton.node.on(Button.EventType.CLICK, this.handleHint, this);
        this.fightButton.node.on(Button.EventType.CLICK, this.handleFight, this);
        // 格子是公共 `RewardItem`，这里只负责按条数喂数据；列表配置全在 prefab 的 Inspector 上
        this.dropList.renderItemFn = this.renderDrop;
    }

    protected onOpen(userData?: unknown): void {
        if (userData) this.applyContent(userData as ILevelInfoContent);
    }

    /**
     * 面板已经开着时换内容。
     *
     * `PopupManager.openAsync` 对同类弹窗**单实例去重**（已开就返回现有实例、不重走 `onOpen`），
     * 所以「点另一个关卡」要直接改内容，不能靠再 open 一次。
     */
    applyContent(content: ILevelInfoContent): void {
        this.titleLabel.string = content.title;
        // 没有敌军提示就把感叹号藏起来（点空白仍可关闭）
        this.hintButton.node.active = content.hasTip;
        this.objectiveLabel.string = content.objective;
        this.occupyLabel.string = content.occupy;

        // 条数交给虚拟列表（它按 itemPrefab 的尺寸铺 3 列、超出可滚）；`renderItemFn` 按下标取
        this.drops = content.drops;
        this.dropList.setTotalCount(content.drops.length);

        this.recommendLabel.string = content.recommend;
        this.recommendLabel.node.active = content.recommend !== '';
        this.fightLabel.string = content.fightCaption;
        this.fightButton.interactable = content.fightEnabled;
        const hasCost = Number.isFinite(content.staminaCost) && content.staminaCost > 0;
        this.fightCostLabel.string = hasCost ? String(Math.round(content.staminaCost)) : '';
        this.fightCostRoot.active = hasCost;
        // 图标跟着数字走：没有费用就整块藏起来；有费用但图没加载到 ⇒ 只少一颗图标，数字照常。
        // ⚠️ 判据必须是 `hasCost && frame !== null`：CostIcon 是 `BtnPrimary` 的**直接子节点**
        // （和 `CostBg` / `CostLabel` 平级），不跟着 `fightCostRoot.active` 一起关，
        // 少了这根判据就会留一颗没有数字的体力图标挂在按钮上。
        this.fightCostIcon.spriteFrame = content.staminaIcon;
        this.fightCostIcon.node.active = hasCost && content.staminaIcon !== null;
    }

    /** 单格渲染 —— 数据按**当前**下标现取，别在回调里闭包捕获某一趟的 `content`。 */
    private readonly renderDrop = (item: Node, index: number): void => {
        // 组件由 `itemPrefab` 焊死、下标由 `setTotalCount` 限死，两处都不可能为空
        item.getComponent(RewardItemView).render(this.drops[index]);
    }

    protected onClose(): void {
        // Presenter 靠这条清 `detailSite`（页面订阅后调 closeDetail，幂等）
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
    }

    private handleHint(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'openLevelTip' } });
    }

    private handleFight(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    }
}
