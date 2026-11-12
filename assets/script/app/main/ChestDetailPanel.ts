import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CHEST_EVENTS } from './ChestEvents';
import { RewardItemView, type IRewardItemData } from '../common/RewardItemView';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { formatChestCountdown } from './ChestTypes';

const { ccclass, property } = _decorator;

/**
 * 「打开」按钮的两种排版（蓝湖设计稿 = **带倒计时的两行态**）：
 * · 有倒计时 → 文案在上（y = 21.5），倒计时胶囊在下（y = -22.5）；
 * · 无倒计时 → 胶囊隐藏，文案必须回到按钮正中（按钮高 108，中心 y = 0），
 *   否则下半截全空、字看着偏上没居中（2026-11-05 实机截图）。
 *
 * x 沿用 prefab 的 4（设计稿原值，含胶囊同一条竖轴），不动。
 */
const OPEN_LABEL_X = 4;
const OPEN_LABEL_Y_TWO_LINE = 21.5;
const OPEN_LABEL_Y_CENTER = 0;

/** 「加速」态：播放 icon（42×44）与文案拼成**一组整体居中**，与 `ChestSlotView` 同口径。 */
const OPEN_SPEED_UP_ICON_WIDTH = 42;
const OPEN_SPEED_UP_ICON_GAP = 6;
const OPEN_SPEED_UP_FONT_SIZE_FALLBACK = 34;

/** 主按钮一次刷新的完整状态：文案 / 倒计时 / 是否加速态 / 可点。 */
interface IChestOpenButtonState {
    readonly caption: string;
    readonly countdown: string;
    readonly speedUp: boolean;
    readonly enabled: boolean;
}

/** 页面「每秒 + 状态变化」要补传的那两位（倒计时与可点由 `updateCountdown` 自己算）。 */
export interface IChestOpenButtonRefresh {
    readonly caption: string;
    readonly speedUp: boolean;
}

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
    /**
     * 「加速」态（2026-11-11）：主按钮换**绿色底** + 文案前显示**播放 icon**。
     * 「解锁」/「开启」仍用 prefab 上的黄色底、不带 icon。
     */
    readonly openSpeedUp: boolean;
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
 * ## 弹窗职责
 *
 * 尺寸 / 遮罩 / 点击空白关闭 / 层级全部交给 `PopupManager`（prefab 上 Dim 与根节点挂 `cc.Widget` 四边对齐）。
 * 三颗按钮的意图事件见 `ChestEvents.ts`（语义在那儿写一次，这里不重复）。
 */
@ccclass('ChestDetailPanel')
export class ChestDetailPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/main/`）。 */
    static prefabPath = 'ui/main/ChestDetailPanel';

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/QualityFrame：品质框' })
    private qualityFrame: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/ChestIcon：宝箱图标' })
    private chestIcon: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/ChestName：宝箱名' })
    private nameLabel: Label = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/QualityText：品质' })
    private qualityLabel: Label = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/CountText：数量' })
    private countLabel: Label = null;

    /** 奖励说明：四列网格使用详情页样式，仍由公共 RewardItemView 解析物品。 */
    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'Panel/ItemSlots：奖励说明（itemPrefab = ChestDetailRewardItem）' })
    private dropList: VirtualScrollView = null;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnSecondary：立即打开（花银币）' })
    private fastButton: Button = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/Label' })
    private fastLabel: Label = null;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnSecondary/CostBg：费用底' })
    private fastCostRoot: Node = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnSecondary/CostIcon：银币图标' })
    private fastCostIcon: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnSecondary/CostLabel：费用数字' })
    private fastCostLabel: Label = null;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnPrimary：打开 / 倒计时' })
    private openButton: Button = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/Label：打开' })
    private openLabel: Label = null;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnPrimary/CostBg：倒计时底' })
    private openCostRoot: Node = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnPrimary/CostLabel：倒计时文本' })
    private openCostLabel: Label = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnPrimary：主按钮底图（加速态换绿）' })
    private openFrame: Sprite = null;

    @property({ type: SpriteFrame, group: '节点引用', tooltip: '按钮·绿色「加速」（btn_speed_up，与 btn_open 同形状）' })
    private openSpeedUpFrame: SpriteFrame = null;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnPrimary/SpeedUpIcon：加速播放图标（chest_bolt）' })
    private openSpeedUpIcon: Node = null;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnClose：关闭' })
    private closeButton: Button = null;

    private fallbackChestIcon: SpriteFrame | null = null;
    /** prefab 上那张黄色主按钮底；加速态结束后要**还原它**，不能留一块绿。 */
    private defaultOpenFrame: SpriteFrame | null = null;
    private openCaption = '';
    private openSpeedUp = false;
    private openLabelY = OPEN_LABEL_Y_TWO_LINE;

    protected onInit(): void {
        this.fallbackChestIcon = this.chestIcon.spriteFrame;
        this.defaultOpenFrame = this.openFrame?.spriteFrame ?? null;
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

        this.applyOpenButton({
            caption: content.openCaption,
            countdown: content.openCountdown,
            speedUp: content.openSpeedUp === true,
            enabled: content.openEnabled,
        });
        // 传 null 时保留 prefab 上的静态银币图（不要清空）
        if (content.costIcon) this.fastCostIcon.spriteFrame = content.costIcon;
    }

    /**
     * 轻量刷新（页面每秒调）。
     *
     * 整窗重开（`open`）会重写全部标签并重设兄弟顺序 ⇒ 每秒闪一下；这条只碰主按钮。
     * 🔴 2026-11-11：`state` 必须随**当前槽位状态**一起传 —— 点「解锁」后槽位从
     *    `Activate` 变 `SpeedUp`，只刷倒计时的话弹窗会一直停在黄色「解锁」，
     *    而下方栏位已经是绿色「加速」（用户截图红框）。
     */
    updateCountdown(
        remainSeconds: number,
        isCounting = true,
        state?: IChestOpenButtonRefresh,
    ): void {
        this.applyOpenButton({
            caption: state?.caption ?? this.openCaption,
            countdown: remainSeconds > 0 ? formatChestCountdown(remainSeconds) : '',
            speedUp: state?.speedUp ?? this.openSpeedUp,
            enabled: !isCounting || remainSeconds <= 0,
        });
    }

    /**
     * 主按钮**全量赋值**（幂等）：文案 / 底图 / 播放 icon / 倒计时胶囊 / 可点。
     *
     * `applyContent`（开窗、换箱）与 `updateCountdown`（每秒、状态变化）都走这一条，
     * 不再有「只改了倒计时、文案和底图还停在上一态」的半刷新。
     */
    private applyOpenButton(state: IChestOpenButtonState): void {
        this.openCaption = state.caption;
        this.openSpeedUp = state.speedUp;
        this.openLabel.string = state.caption;
        this.openButton.interactable = state.enabled;
        const frame = state.speedUp ? this.openSpeedUpFrame : this.defaultOpenFrame;
        if (this.openFrame && frame) this.openFrame.spriteFrame = frame;
        this.updateCountdownText(state.countdown);
        this.layoutOpenLabel(state.speedUp);
    }

    /**
     * 加速态把「播放 icon + 文案」拼成一组整体居中；其余态文案回到设计稿的 x=4。
     * 倒计时胶囊保持原位，不跟着挪。
     *
     * 字宽按「字数 × 字号 + 字距」估（CJK 一字符号一号宽），与 `ChestSlotView` 一样
     * 不去开关 `Overflow` 量真宽 —— 那会把 SHRINK 的框永久改窄。
     */
    private layoutOpenLabel(speedUp: boolean): void {
        const labelNode = this.openLabel.node;
        if (this.openSpeedUpIcon) this.openSpeedUpIcon.active = speedUp;
        if (!speedUp) {
            labelNode.setPosition(OPEN_LABEL_X, this.openLabelY);
            return;
        }
        const fontSize = Number(this.openLabel.fontSize) || OPEN_SPEED_UP_FONT_SIZE_FALLBACK;
        const spacing = Number(this.openLabel.spacingX) || 0;
        const chars = Math.max(1, this.openLabel.string.length);
        const textWidth = chars * fontSize + Math.max(0, chars - 1) * spacing;
        const total = OPEN_SPEED_UP_ICON_WIDTH + OPEN_SPEED_UP_ICON_GAP + textWidth;
        const left = OPEN_LABEL_X - total / 2;
        if (this.openSpeedUpIcon) {
            this.openSpeedUpIcon.setPosition(
                left + OPEN_SPEED_UP_ICON_WIDTH / 2, this.openLabelY, 0);
        }
        labelNode.setPosition(
            left + OPEN_SPEED_UP_ICON_WIDTH + OPEN_SPEED_UP_ICON_GAP + textWidth / 2,
            this.openLabelY);
    }

    /** 本趟的奖励（`renderItemFn` 按下标现取，别在回调里闭包捕获某一趟的 content）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 单格渲染 —— 走公共 `RewardItemView`（带概率的那套只有这个弹窗用）。 */
    private readonly renderReward = (item: Node, index: number): void => {
        item.getComponent(RewardItemView).render(this.rewards[index]);
    };

    private updateCountdownText(text: string): void {
        const hasCountdown = text !== '';
        this.openCostLabel.string = text;
        this.openCostRoot.active = hasCountdown;
        this.openLabelY = hasCountdown ? OPEN_LABEL_Y_TWO_LINE : OPEN_LABEL_Y_CENTER;
        // 两态全量赋值：倒计时一藏，就把「打开」放回按钮正中；下一次 applyContent /
        // 每秒 updateCountdown 都会重算，幂等，不会累加偏移。
        this.openLabel.node.setPosition(OPEN_LABEL_X, hasCountdown ? OPEN_LABEL_Y_TWO_LINE : OPEN_LABEL_Y_CENTER);
    }

    private handleFastOpen(): void {
        EventMgr.instance.emit(CHEST_EVENTS.FAST_OPEN);
    }

    private handleOpen(): void {
        EventMgr.instance.emit(CHEST_EVENTS.OPEN);
    }

    private handleClose(): void {
        this.closeByButton();
    }
}
