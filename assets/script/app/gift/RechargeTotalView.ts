import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RECHARGE_TEXTS, formatText } from './GiftTexts';
import type { IGiftSlotFrame } from './GiftRewardSlot';
import { RechargeChest } from './RechargeChest';
import { RechargeProgressBar } from './RechargeProgressBar';
import { RechargeTotalRow } from './RechargeTotalRow';
import type { IRechargeTotalRowTexts } from './RechargeTotalRow';
import type { RechargeRowState } from './RechargeActivityTable';

const { ccclass, property } = _decorator;

/** 一行（图与文案都已由宿主组装好）。 */
export interface IRechargeTotalRowPresent {
    /** 「充值 N 元 (M/N)」；文案模板归 `GiftTexts.RECHARGE_TEXTS.totalRowTitle`。 */
    readonly title: string;
    readonly state: RechargeRowState;
    /** 该档位要求的累计金额（点「领取」时要回传）。 */
    readonly rechargeProcess: number;
    /** 逐格的图（最多 5 格）—— 每格品质可以不同，不能共用一个框。 */
    readonly slots: readonly IGiftSlotFrame[];
}

/** 顶部一个宝箱（`type 1005` 那个活动的档位）。 */
export interface IRechargeTotalChestPresent {
    readonly rechargeProcess: number;
    readonly taken: boolean;
    readonly reachable: boolean;
    /** `M/N`（`GiftTexts.RECHARGE_TEXTS.progressText`）。 */
    readonly progressText: string;
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
}

/** 一次刷新要的全部（图与文案都已由宿主备好 —— 本类不做异步、不读表）。 */
export interface IRechargeTotalPresentData {
    /** 当前页签（`RechargeActivityTable.RECHARGE_TAB.base` / `.advanced`）。 */
    readonly selectedTab: number;
    /** 页签顺序（`base` 在前）。 */
    readonly tabOrder: readonly number[];
    /** 页签文案（`tab` → 「累计充值」/「充值好礼」）。 */
    readonly tabLabels: ReadonlyMap<number, string>;
    /** 「活动介绍」正文（`activityTab.desc`；空串 ⇒ 整块藏掉）。 */
    readonly introText: string;
    readonly progressValue: number;
    readonly progressMax: number;
    /** 列表那个活动实例 `id`；`0` = 该页签当前没有开启的活动。 */
    readonly listActivityId: number;
    /** 宝箱那个活动实例 `id`（`type 1005`）；`0` = 没开启。 */
    readonly chestActivityId: number;
    /** 顶部宝箱（最多 2 个；空数组 ⇒ 两个槽位全藏）。 */
    readonly chests: readonly IRechargeTotalChestPresent[];
    readonly rows: readonly IRechargeTotalRowPresent[];
}

/**
 * 「累计充值」页。
 *
 * 顶部为两个页签、活动介绍、总进度条和两个宝箱，下方是档位行虚拟列表。
 * 「充值好礼」页签随 `type 1004` 活动显隐；限购控件保留但当前恒不显示，
 * 红点未接入。本类只铺视图模型，点击通过回调交给宿主。
 */
@ccclass('RechargeTotalView')
export class RechargeTotalView extends Component {
    @property({ type: [Node], tooltip: 'TabTotal/TabGift：两个页签（按 x 排序）' })
    tabs: Node[] = [];

    @property({ type: RechargeProgressBar, tooltip: 'RechargeTopProgress：顶部总进度条（原稿不带文本）' })
    topProgress: RechargeProgressBar = null!;

    @property({ type: Label, tooltip: 'RechargeIntro/Text：活动介绍正文' })
    introLabel: Label = null!;

    @property({ type: [RechargeChest], tooltip: 'Chest1/Chest2：顶部两个宝箱（按 x 排序）' })
    chests: RechargeChest[] = [];

    @property({ type: VirtualScrollView, tooltip: 'List：档位行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    /** 换页签（回传 `RechargeActivityTable.RECHARGE_TAB.*`）。 */
    onSwitchTab: ((tab: number) => void) | null = null;

    /** 领某档位的奖励。 */
    onClaim: ((activityId: number, rechargeProcess: number) => void) | null = null;

    /** 未达成时点「前往」；当前只给提示。 */
    onGoto: ((rechargeProcess: number) => void) | null = null;

    /** 当前行；`renderItemFn` 按索引实时读取。 */
    private rowViews: IRechargeTotalRowPresent[] = [];

    private chestViews: readonly IRechargeTotalChestPresent[] = [];

    private tabOrder: readonly number[] = [];

    private selectedTab = 0;

    private listActivityId = 0;

    private chestActivityId = 0;

    /** 页签底图直接从 prefab 现有 Sprite 上取。 */
    private tabOnFrame: SpriteFrame | null = null;

    private tabOffFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        this.captureTabFrames();

        const tabs = this.tabsSorted;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].on(Button.EventType.CLICK, () => this.emitSwitch(index));
        }

        const chests = this.chestsSorted;
        for (let index = 0; index < chests.length; index++) {
            chests[index].onAction = () => this.emitChest(index);
        }
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    /** 铺一次页面（页签 + 介绍 + 顶部进度 + 宝箱 + 行列表）。 */
    present(data: IRechargeTotalPresentData): void {
        this.tabOrder = data.tabOrder;
        this.selectedTab = data.selectedTab;
        this.listActivityId = data.listActivityId;
        this.chestActivityId = data.chestActivityId;

        this.presentTabs(data);
        this.presentIntro(data.introText);
        this.presentTop(data);
        this.presentChests(data.chests);
        this.presentRows(data.rows);
    }

    // ============================================================
    // 页签
    // ============================================================

    /** 页签（按 x 排序 —— `_children` 序 ≠ 视觉序）。 */
    private get tabsSorted(): Node[] {
        return this.tabs.slice().sort((a, b) => a.position.x - b.position.x);
    }

    /** 宝箱（按 x 排序）。 */
    private get chestsSorted(): RechargeChest[] {
        return this.chests.slice().sort((a, b) => a.node.position.x - b.node.position.x);
    }

    private captureTabFrames(): void {
        const tabs = this.tabsSorted;
        // 第一个页签上烤的是「选中」图、第二个是「未选中」图（见生成器 `TAB_ART`）；两态按角色取，不靠循环下标。
        this.tabOnFrame = tabs[0]?.getComponent(Sprite)?.spriteFrame ?? null;
        this.tabOffFrame = tabs[1]?.getComponent(Sprite)?.spriteFrame ?? null;
    }

    private presentTabs(data: IRechargeTotalPresentData): void {
        const tabs = this.tabsSorted;
        for (let index = 0; index < tabs.length; index++) {
            const tab = data.tabOrder[index];
            const node = tabs[index];
            if (tab === undefined) {
                // 页签不够用（`type 1004` 的活动没开）⇒ 多余槽位整块藏掉。
                node.active = false;
                continue;
            }
            node.active = true;
            const selected = tab === data.selectedTab;
            const sprite = node.getComponent(Sprite);
            const frame = selected ? this.tabOnFrame : this.tabOffFrame;
            if (sprite && frame) sprite.spriteFrame = frame;
            const label = node.getChildByName('Label')?.getComponent(Label);
            if (label) label.string = data.tabLabels.get(tab) ?? '';
        }
    }

    private emitSwitch(index: number): void {
        const tab = this.tabOrder[index];
        if (tab === undefined || tab === this.selectedTab) return;
        this.onSwitchTab?.(tab);
    }

    // ============================================================
    // 介绍 / 顶部进度 / 宝箱
    // ============================================================

    private presentIntro(text: string): void {
        this.introLabel.node.parent.active = text.length > 0;
        this.introLabel.string = text;
    }

    private presentTop(data: IRechargeTotalPresentData): void {
        this.topProgress.render(data.progressValue, data.progressMax);
    }

    private presentChests(chests: readonly IRechargeTotalChestPresent[]): void {
        this.chestViews = Array.from(chests);
        const views = this.chestsSorted;
        for (let index = 0; index < views.length; index++) {
            const view = chests[index];
            if (!view) {
                views[index].hide();
                continue;
            }
            views[index].render(view.taken, view.reachable, view.progressText, view.qualityFrame, view.iconFrame);
        }
    }

    private emitChest(index: number): void {
        const view = this.chestViews[index];
        if (!view) return;
        // 老端：`touchable = curProcess >= rechargeProcess`，且已领取的不能点。
        if (view.taken || !view.reachable) return;
        this.onClaim?.(this.chestActivityId, view.rechargeProcess);
    }

    // ============================================================
    // 行列表
    // ============================================================

    private presentRows(rows: readonly IRechargeTotalRowPresent[]): void {
        this.rowViews = Array.from(rows);
        this.rowList.refreshList(this.rowViews);
        // 换页签后回到顶部，避免短列表停在上一页的越界位置。
        this.rowList.scrollToTop(false);
    }

    /** 虚拟列表行渲染；槽位会被复用，每次按当前索引重铺。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(RechargeTotalRow);
        view.onAction = () => {
            const row = this.rowViews[index];
            if (!row) return;
            if (row.state === 'claimable') this.onClaim?.(this.listActivityId, row.rechargeProcess);
            else if (row.state === 'undone') this.onGoto?.(row.rechargeProcess);
        };

        const row = this.rowViews[index];
        if (!row) {
            view.hide();
            return;
        }
        view.render(
            row.title,
            row.state,
            RECHARGE_TOTAL_ROW_TEXTS,
            row.slots,
            // 限购恒不显示：老端零 limit 代码 + 原稿默认页「不限购」。
            null,
        );
    }

    /** 行标题；模板中 `{0}` 出现两次，必须走全局占位符替换。 */
    static rowTitle(rechargeProcess: number, curProcess: number): string {
        return formatText(RECHARGE_TEXTS.totalRowTitle, rechargeProcess, curProcess);
    }

    /** 宝箱进度文本（「M/N」）。 */
    static chestProgress(curProcess: number, rechargeProcess: number): string {
        return formatText(RECHARGE_TEXTS.progressText, curProcess, rechargeProcess);
    }
}

/** 两态按钮文案。 */
const RECHARGE_TOTAL_ROW_TEXTS: IRechargeTotalRowTexts = {
    claim: RECHARGE_TEXTS.btnClaim,
    goto: RECHARGE_TEXTS.btnGoto,
};
