import { _decorator, Button, Component, Node, SpriteFrame, UITransform } from 'cc';
import { ChestSlotView } from './ChestSlotView';
import { resolveChestPanelX } from './MainHudMotion';
import type { IChestSlotData } from './ChestTypes';

const { ccclass, property } = _decorator;
const CHEST_PANEL_SLIDE_SECONDS = 0.28;
const CHEST_COLLAPSE_HIT_AREA_SIZE = { width: 96, height: 180 };

/**
 * 主城底部**宝箱栏**（2026-10-19 蓝湖「塔防主界面-2」）。
 *
 * 版式（设计稿 720×1610，底栏之上）：
 * ```
 * ChestBar            720×317  （bx_di，压在底栏上沿）
 *   Slot0 … Slot3     155×246  （pitch 163，一屏 4 个，左侧箭头翻页）
 *     Card            卡片底：蓝(list_01) / 金(list_02) / 空槽(list_04)
 *     Timer           顶部计时：TimeBg(progress_02) + TimeFill(progress_lv_01, FILLED) + Clock + TimeText
 *     Box             宝箱图(baoxiang 113×93)
 *     NameLabel       「宝箱名字」
 *     EmptyLabel      「空槽位」（空槽态）
 *     Cost            闪电 + 数字（空槽态的体力消耗）
 *     Btn             按钮：金(开启) / 蓝(开始战斗) / 绿(-30分钟)
 * ```
 *
 * 状态与数据由外部喂（`render`），本组件只做**幂等的全量赋值** —— 与
 * `MainTabHost.renderNavItem` 同一口径：每帧/每次刷新都写全，不依赖上一次的残留。
 *
 *  ⚠️ 插槽数组**不走 `@property` 数组**（MCP 写不了数组），走 `getComponentsInChildren`，
 *  按父节点 x 从左到右排序 —— 和 `MainTabHost` 收集底栏 `TabButton` 是同一套做法。
 */
@ccclass('ChestBar')
export class ChestBar extends Component {
    @property({ type: Node, tooltip: 'List：槽位容器（里面放 4 个 ChestSlot 实例）' })
    list: Node = null!;

    @property({ type: Node, tooltip: 'Prev：左翻箭头' })
    prevButton: Node = null!;

    @property({ type: Node, tooltip: 'Next：右翻箭头' })
    nextButton: Node = null!;

    @property({ type: SpriteFrame, tooltip: '卡底·蓝色（list_01）' })
    cardBlue: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '卡底·金色（list_02）' })
    cardGold: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '卡底·空槽（list_04）' })
    cardEmpty: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '按钮·金色「开启」（btn_01）' })
    btnGold: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '按钮·蓝色「开始战斗」（btn_02）' })
    btnBlue: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '按钮·绿色「-30分钟」（btn_03）' })
    btnGreen: SpriteFrame = null!;

    private slots: ChestSlotView[] = [];

    /** 翻页回调（`-1` 上一页 / `+1` 下一页）；由宿主接。 */
    private onPage: ((delta: number) => void) | null = null;
    /** 展开状态下左箭头收起侧栏。 */
    private onCollapse: (() => void) | null = null;
    private openX: number | null = null;
    private isOpen = false;
    private motionFromX = 0;
    private motionToX = 0;
    private motionStartedAt = 0;
    private isMoving = false;

    get opened(): boolean { return this.isOpen; }

    onLoad(): void {
        this.captureOpenX();
        this.ensureSlots();
        this.prevButton?.on(Node.EventType.TOUCH_END, this.onPrev, this);
        this.nextButton?.on(Node.EventType.TOUCH_END, this.onNext, this);
        this.createCollapseHitArea();
    }

    /** 设置展开状态；关闭时整栏从左侧滑出视口。 */
    setOpen(open: boolean, animate = true): void {
        this.captureOpenX();
        this.isOpen = open;
        const fromX = this.node.position.x;
        const toX = open ? this.openX! : this.closedX();
        if (open) this.node.active = true;
        if (!animate) {
            this.isMoving = false;
            this.node.setPosition(toX, this.node.position.y, this.node.position.z);
            this.node.active = open;
            return;
        }
        this.motionFromX = fromX;
        this.motionToX = toX;
        this.motionStartedAt = Date.now() / 1000;
        this.isMoving = Math.abs(fromX - toX) > 0.01;
        if (!this.isMoving) this.node.active = open;
    }

    update(): void {
        if (!this.isMoving) return;
        const now = Date.now() / 1000;
        const x = resolveChestPanelX(
            this.motionFromX,
            this.motionToX,
            this.motionStartedAt,
            now,
            CHEST_PANEL_SLIDE_SECONDS,
        );
        this.node.setPosition(x, this.node.position.y, this.node.position.z);
        if (now - this.motionStartedAt < CHEST_PANEL_SLIDE_SECONDS) return;
        this.isMoving = false;
        this.node.active = this.isOpen;
    }

    private captureOpenX(): void {
        if (this.openX !== null) return;
        this.openX = this.node.position.x;
    }

    private closedX(): number {
        const width = this.node.getComponent(UITransform)?.width ?? 720;
        return this.openX! - width;
    }

    /** 额外放大左箭头的点击范围，箭头 Sprite 自身尺寸保持原样。 */
    private createCollapseHitArea(): void {
        const hitArea = new Node('ChestCollapseHitArea');
        hitArea.layer = this.node.layer;
        hitArea.addComponent(UITransform).setContentSize(
            CHEST_COLLAPSE_HIT_AREA_SIZE.width,
            CHEST_COLLAPSE_HIT_AREA_SIZE.height,
        );
        const button = hitArea.addComponent(Button);
        button.target = hitArea;
        hitArea.setPosition(this.prevButton.position);
        hitArea.setParent(this.node);
        hitArea.on(Node.EventType.TOUCH_END, this.onPrev, this);
    }

    /**
     * 惰性装配槽位 + 美术。
     *
     * ⚠️ **不能只在 `onLoad` 里做**：宿主 `MainPage` 在**父节点**上，父的 `onLoad` 先于子节点跑，
     * 那一刻 `slots` 还是空数组 ⇒ `render()` 什么都不会画（实测 4 格全是 prefab 默认态）。
     * 所以每次 `render` 都先补一次（幂等，已装配直接返回）。
     */
    private ensureSlots(): ChestSlotView[] {
        if (this.slots.length === 0 && this.list) {
            ChestSlotView.setArt(
                { blue: this.cardBlue, gold: this.cardGold, empty: this.cardEmpty },
                { gold: this.btnGold, blue: this.btnBlue, green: this.btnGreen },
            );
            this.slots = this.list.getComponentsInChildren(ChestSlotView)
                .slice()
                .sort((a, b) => a.node.position.x - b.node.position.x);
        }
        return this.slots;
    }

    /** 接翻页回调。 */
    bindPage(handler: ((delta: number) => void) | null): void {
        this.onPage = handler;
    }

    /** 接收关闭回调；展开时左侧大热区优先执行收起。 */
    bindCollapse(handler: (() => void) | null): void {
        this.onCollapse = handler;
    }

    private onPrev(): void {
        if (this.isOpen) {
            this.onCollapse?.();
            return;
        }
        this.onPage?.(-1);
    }

    private onNext(): void {
        this.onPage?.(1);
    }

    /**
     * 全量渲染：按数组顺序填槽位，多出来的槽位隐藏。
     *
     * @param data 槽位数据（长度可变：不到 4 个时后面的槽位收起）
     * @param onClick 点了某一格的按钮
     */
    render(data: readonly IChestSlotData[], onClick?: (index: number) => void): void {
        const slots = this.ensureSlots();
        for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index];
            const item = data[index];
            if (!item) {
                slot.node.active = false;
                continue;
            }
            slot.node.active = true;
            slot.render(item);
            slot.bindAction(onClick ? () => onClick(index) : null);
        }
    }

    /** 翻页箭头是否显示（只有一页时收起）。 */
    setPageButtonsVisible(visible: boolean): void {
        if (this.prevButton) this.prevButton.active = visible;
        if (this.nextButton) this.nextButton.active = visible;
    }
}

