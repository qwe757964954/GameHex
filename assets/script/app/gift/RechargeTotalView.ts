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
 * 「累计充值」页（`Gift.prefab` 的 `RechargeTotalPage`）。
 *
 * 版面照 FGUI `礼包/组件/子页面/累计充值页面/组件_累计充值_内容.xml`：
 *   「累计充值 / 充值好礼」两个页签 + 充值图标 + 活动介绍气泡 + 顶部总进度条
 *   + 两个宝箱（`共用组件` 的 `Button1` 红 / `Button2` 紫）+ 可滚动的档位行列表。
 *
 * ## 与 FGUI 原稿的四处差异（都是「原稿没声明 / 声明了但老端不填」）
 *
 * ① 限购（`Limit`）**恒不显示**：原稿 controller「是否限购」默认页是「不限购」，
 *    且老端 `TabGiftRechargeTotal` 里**零 limit 相关代码** ⇒ `present()` 永远传 `null`。
 *    （节点留着，将来接上就有位置，不删。）
 * ② 「已领取」是**图标**（`公用_图标_已领取`），不是 FGUI 那种把按钮切到第 3 页 ——
 *    原稿的 `n31` 就是一张独立图，照搬。
 * ③ 页签「充值好礼」的显隐跟数据走（老端 `tab_1` 的 `gearDisplay controller="好礼"`）：
 *    `type 1004` 的活动没开就整页签藏掉。
 * ④ 红点不接（项目统一后面做，本轮不建永远不可见的空节点）。
 *
 * ## 分层
 *
 * 取数 / 判定 / 排序全在 `RechargeActivityTable`（纯函数）+ `RechargeActivityRepository`；
 * 本类只做「把视图模型铺到子视图」并把点击**回调**给宿主。子视图自己不碰网络。
 *
 * ⚠️ 列表用项目自带虚拟列表：`List/content/RowTemplate` 是它的模板节点（规则 8 的造型）。
 *   两条铁律（`VScrollView` 会静默失效、单测测不出）：
 *   ① `renderItemFn` **只绑一次** ⇒ 回调里必须按 `index` **现取** `this.rowViews[index]`，
 *      禁闭包捕获本趟入参（捕获的症状 = 点第 3 行领到第 1 行的奖励）；
 *   ② 异步预加载必须在 `present()` **之前** await 完，且那时别读 `this.rowViews`（还是上一帧的）。
 */
@ccclass('RechargeTotalView')
export class RechargeTotalView extends Component {
    /**
     * `TabTotal` / `TabGift`：两个页签。
     *
     * ⚠️ 与每日充值页同款 —— FGUI 原稿里它们是页面节点的**直接子节点**，没有 TabBar 容器。
     * ⚠️ 顺序按 `x` 现排（`_children` 序 ≠ 视觉序）。
     */
    @property({ type: [Node], tooltip: 'TabTotal/TabGift：两个页签（按 x 排序）' })
    tabs: Node[] = [];

    @property({ type: RechargeProgressBar, tooltip: 'RechargeTopProgress：顶部总进度条（原稿不带文本）' })
    topProgress: RechargeProgressBar = null;

    @property({ type: Label, tooltip: 'RechargeIntro/Text：活动介绍正文' })
    introLabel: Label = null;

    @property({ type: [RechargeChest], tooltip: 'Chest1/Chest2：顶部两个宝箱（按 x 排序）' })
    chests: RechargeChest[] = [];

    @property({ type: VirtualScrollView, tooltip: 'List：档位行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null;

    /** 换页签（回传 `RechargeActivityTable.RECHARGE_TAB.*`）。 */
    onSwitchTab: ((tab: number) => void) | null = null;

    /** 领某档位的奖励（`activityId` + `rechargeProcess`）。 */
    onClaim: ((activityId: number, rechargeProcess: number) => void) | null = null;

    /** 未达成时点「前往」（老端跳商店；Demo3.8 只给提示）。 */
    onGoto: ((rechargeProcess: number) => void) | null = null;

    /** 当前行（`renderItemFn` 按 index 现取，不能闭包捕获）。 */
    private rowViews: readonly IRechargeTotalRowPresent[] = [];

    /** 当前宝箱（固定 2 个，但状态每次刷新都变 —— 回调里按 index 现取）。 */
    private chestViews: readonly IRechargeTotalChestPresent[] = [];

    /** 页签顺序（点击时按 index 现取，不能捕获）。 */
    private tabOrder: readonly number[] = [];

    /** 当前页签。 */
    private selectedTab = 0;

    /** 当前列表活动的 `id`（点「领取」时要回传）。 */
    private listActivityId = 0;

    /** 当前宝箱活动的 `id`。 */
    private chestActivityId = 0;

    /** `renderItemFn` 只需绑一次（长驻回调）。 */
    private rowRendererBound = false;

    /**
     * 页签的选中 / 未选中底图 —— 直接从 prefab 上那两个页签的 `cc.Sprite` 里**取**，
     * 不去异步加载（`TabTotal` 上烤的是选中图 `ZB_btn01`、`TabGift` 上是未选中图 `ZB_btn02`）。
     */
    private tabOnFrame: SpriteFrame | null = null;

    private tabOffFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        this.captureTabFrames();

        const tabs = this.tabsSorted;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].on(Button.EventType.CLICK, () => this.emitSwitch(index), this);
        }

        // 宝箱是固定 2 个槽位（不虚拟化）⇒ 回调绑一次，动作按 index 现取当趟的视图模型。
        const chests = this.chestsSorted;
        for (let index = 0; index < chests.length; index++) {
            const chest = chests[index];
            if (!chest) continue;
            chest.onAction = () => this.emitChest(index);
        }
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
        // 第一个页签上烤的是「选中」图、第二个是「未选中」图（见生成器 `TAB_ART`）。
        for (let index = 0; index < tabs.length; index++) {
            const frame = tabs[index].getComponent(Sprite)?.spriteFrame ?? null;
            if (index === 0) this.tabOnFrame = frame;
            else if (index === 1) this.tabOffFrame = frame;
        }
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
        if (!this.introLabel) return;
        // 介绍气泡整块跟着文本显隐（空 `desc` ⇒ 藏，别留一个空气泡）。
        const intro = this.introLabel.node.parent;
        if (intro) intro.active = text.length > 0;
        this.introLabel.string = text;
    }

    private presentTop(data: IRechargeTotalPresentData): void {
        if (!this.topProgress) return;
        // 顶部条**不带文本**（原稿 `显示进度文本` 页名「否」）⇒ 第三个参数不传。
        this.topProgress.render(data.progressValue, data.progressMax);
    }

    private presentChests(chests: readonly IRechargeTotalChestPresent[]): void {
        this.chestViews = Array.from(chests);
        const views = this.chestsSorted;
        for (let index = 0; index < views.length; index++) {
            const chest = views[index];
            if (!chest) continue;
            const view = chests[index];
            if (!view) {
                chest.hide();
                continue;
            }
            chest.render(view.taken, view.reachable, view.progressText, view.qualityFrame, view.iconFrame);
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
        // ⚠️ 视图模型整体换掉，`renderItemFn` 里按 index **现取**（长驻回调，禁闭包捕获）
        this.rowViews = Array.from(rows);

        const list = this.rowList;
        if (!list) return;
        if (!this.rowRendererBound) {
            this.rowRendererBound = true;
            list.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        list.refreshList(this.rowViews as unknown[]);
        // 换页签后回到顶部（两页档位数不同，不复位会停在「内容变短后的越界位置」）。
        list.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 → 每次都按当前 `rowViews` 重铺）。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(RechargeTotalRow);
        if (!view) return;

        // 回调按 **index 现取** `rowViews[index]`，不能闭包捕获 —— 同一个实例会复用到别的下标。
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

    /** 行标题（「充值 N 元 (M/N)」）；供宿主组装 `IRechargeTotalRowPresent.title`。 */
    static rowTitle(rechargeProcess: number, curProcess: number): string {
        // ⚠️ 模板里 `{0}` 出现**两次**（`充值{0}元 ({1}/{0})`）—— 必须走 `formatText`
        //    的全局替换，手写 `replace` 只会换掉第一个。
        return formatText(RECHARGE_TEXTS.totalRowTitle, rechargeProcess, curProcess);
    }

    /** 宝箱进度文本（「M/N」）。 */
    static chestProgress(curProcess: number, rechargeProcess: number): string {
        return formatText(RECHARGE_TEXTS.progressText, curProcess, rechargeProcess);
    }
}

/** 两态按钮文案（唯一出口 `GiftTexts.RECHARGE_TEXTS`，子组件不造字符串）。 */
const RECHARGE_TOTAL_ROW_TEXTS: IRechargeTotalRowTexts = {
    claim: RECHARGE_TEXTS.btnClaim,
    goto: RECHARGE_TEXTS.btnGoto,
};
