import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RECHARGE_TEXTS, formatText } from './GiftTexts';
import type { IGiftSlotFrame } from './GiftRewardSlot';
import { RechargeDailyRow } from './RechargeDailyRow';
import type { IRechargeDailyButtonTexts } from './RechargeDailyRow';
import { RechargeDailyStage } from './RechargeDailyStage';
import type { RechargeStageState } from './RechargeDailyStage';
import { RechargeProgressBar } from './RechargeProgressBar';
import type { RechargeDailyButtonKey } from './RechargeDailyTable';

const { ccclass, property } = _decorator;

/** 一行（已把图与文案组装好）。 */
export interface IRechargeDailyRowPresent {
    /** 「第 N 天充值获取 M 金币」；组装归宿主（文案唯一出口是 `GiftTexts`）。 */
    readonly desc: string;
    /** 第几天 —— 点「领取」时回传。 */
    readonly days: number;
    readonly buttonKey: RechargeDailyButtonKey;
    readonly currentCoin: number;
    readonly targetCoin: number;
    /** 逐格的图（`goods0` / `goods1`）—— 两个奖励品质可以不同，不能共用一个框。 */
    readonly slots: readonly IGiftSlotFrame[];
}

/** 顶部一个累计阶段格。 */
export interface IRechargeDailyStagePresent {
    readonly days: number;
    readonly label: string;
    readonly state: RechargeStageState;
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
}

/** 一次刷新要的全部（图与文案都已由宿主备好 —— 本类不做异步、不读表）。 */
export interface IRechargeDailyPresentData {
    /** 页签顺序（= `rechargeDaily` 表里 `round` 去重升序）。 */
    readonly rounds: readonly number[];
    readonly selectedRound: number;
    /** 页签文案（`round` → 「60档」/「300档」）。 */
    readonly roundLabels: ReadonlyMap<number, string>;
    readonly accProgress: number;
    readonly accTotal: number;
    readonly stages: readonly IRechargeDailyStagePresent[];
    readonly rows: readonly IRechargeDailyRowPresent[];
}

/**
 * 「每日充值」页（`Gift.prefab` 的 `DailyPage`）。
 *
 * 版面照 FGUI `礼包/组件/子页面/每日充值页面/组件_礼包_每日充值.xml`：
 *   顶部静态提示条 + 「60 档 / 300 档」两个页签 + 顶部累计进度条（其上叠 3 个累计阶段格）
 *   + 可滚动的每日行列表。
 *
 * ## 与 FGUI 原稿的三处差异（都是「原稿没声明 / 声明了但老端不填」）
 *
 * ① 顶部进度条的文本：原稿给它挂了 `controller="显示进度文本,1"`（= 页名「否」）⇒ **不显示文本**，
 *    只有**行内**那个进度条（未挂 controller，用组件默认 `selected="0"` = 「是」）才显示 `v/m`。
 *    → prefab 里 `DailyTopProgress/Value` 已置为隐藏，别再打开。
 * ② `文本_倒计时`（`n2`，"活动倒计时:…"）**不做**：老端无代码填它，且 `CmdRechargeDaily`
 *    结构里没有结束时间（见 `GiftTexts.RECHARGE_TEXTS.dailyCountdownOmitted`）。
 * ③ 红点（`com_rd`）不接：项目统一后面做，本轮不建永远不可见的空节点。
 *
 * ## 分层
 *
 * 取数 / 判定 / 文案全在 `RechargeDailyTable`（纯函数）+ `GiftRepository`；本类只做
 * 「把视图模型铺到子视图」并把点击**回调**给宿主。子视图自己不碰网络。
 *
 * ⚠️ 列表用项目自带虚拟列表：`List/content/RowTemplate` 是它的模板节点（规则 8 的造型）。
 *   两个铁律（`VScrollView` 会静默失效、单测测不出）：
 *   ① `renderItemFn` **只绑一次** ⇒ 回调里必须按 `index` **现取** `this.rowViews[index]`，
 *      禁闭包捕获本趟入参（捕获的症状 = 点第 3 行领到第 1 行的奖励）；
 *   ② 异步预加载必须在 `present()` **之前** await 完，且那时别读 `this.rowViews`（还是上一帧的）。
 */
@ccclass('RechargeDailyView')
export class RechargeDailyView extends Component {
    /**
     * `Tab60` / `Tab300`：两个档位页签。
     *
     * ⚠️ FGUI 原稿里 `tab_0` / `tab_1` 是**页面节点的直接子节点**（没有 TabBar 容器），
     * prefab 照搬 ⇒ 这里直接收两个节点，不套父容器。
     * ⚠️ 顺序按 `x` 现排（`_children` 序 ≠ 视觉序）。
     */
    @property({ type: [Node], tooltip: 'Tab60/Tab300：两个档位页签（按 x 排序）' })
    roundTabs: Node[] = [];

    @property({ type: RechargeProgressBar, tooltip: 'DailyTopProgress：顶部累计进度条' })
    topProgress: RechargeProgressBar = null!;

    @property({ type: [RechargeDailyStage], tooltip: 'Reward0/1/2：顶部三个累计阶段格' })
    stages: RechargeDailyStage[] = [];

    @property({ type: VirtualScrollView, tooltip: 'List：每日行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    /** 换档位（回传 `rechargeDaily.round`）。 */
    onSwitchRound: ((round: number) => void) | null = null;

    /** 领当天的奖励。 */
    onClaimDay: ((round: number, day: number) => void) | null = null;

    /** 领顶部累计奖励（点阶段格触发）。 */
    onClaimAcc: ((round: number, day: number) => void) | null = null;

    /**
     * 行内「去充值 / 前往」按钮。
     *
     * ⚠️ 与 `onClaimAcc` **不是**一回事：`goto` 态是「已解锁但没充够」⇒ 老端跳商店；
     *    累计奖励是点**顶部阶段格**领的（两条完全不同的路径，别合流）。
     */
    onGoto: ((round: number) => void) | null = null;

    /** 当前行（`renderItemFn` 按 index 现取，不能闭包捕获）。 */
    private rowViews: readonly IRechargeDailyRowPresent[] = [];

    /** 当前阶段格（固定 3 个；回调里按 index 现取）。 */
    private stageViews: readonly IRechargeDailyStagePresent[] = [];

    /** 页签顺序（点击时按 index 现取，不能捕获）。 */
    private rounds: readonly number[] = [];

    /** 当前档位。 */
    private selectedRound = 0;

    /** `renderItemFn` 只需绑一次（长驻回调）。 */
    private rowRendererBound = false;

    /**
     * 页签的选中 / 未选中底图 —— 直接从 prefab 上那两个页签的 `cc.Sprite` 里**取**，
     * 不去异步加载（`Tab60` 上烤的是选中图 `ZB_btn01`、`Tab300` 上是未选中图 `ZB_btn02`）。
     */
    private tabOnFrame: SpriteFrame | null = null;

    private tabOffFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        this.captureTabFrames();
        // ⚠️ `roundTabs` 里装的就是 Node 本身（不是子组件）⇒ 直接 `node.on`，没有第二层 `.node`。
        const tabs = this.tabs;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].on(Button.EventType.CLICK, () => this.emitSwitch(index), this);
        }

        // 阶段格也是固定 3 个（不虚拟化）⇒ 回调绑一次，动作按 index 现取当趟的视图模型。
        for (let index = 0; index < this.stages.length; index++) {
            const stage = this.stages[index];
            if (!stage) continue;
            stage.onAction = () => this.emitClaimAcc(index);
        }
    }

    /** 铺一次页面（页签 + 顶部进度 + 累计格 + 行列表）。 */
    present(data: IRechargeDailyPresentData): void {
        this.presentRounds(data);
        this.presentTop(data);
        this.presentStages(data.stages);
        this.presentRows(data.rows);
    }

    // ============================================================
    // 页签
    // ============================================================

    /** 页签（按 x 排序 —— `_children` 序 ≠ 视觉序）。 */
    private get tabs(): Node[] {
        return this.roundTabs.slice().sort((a, b) => a.position.x - b.position.x);
    }

    private captureTabFrames(): void {
        const tabs = this.tabs;
        // 第一个页签上烤的是「选中」图、第二个是「未选中」图（见生成器 `TAB_ART`）。
        for (let index = 0; index < tabs.length; index++) {
            const frame = tabs[index].getComponent(Sprite)?.spriteFrame ?? null;
            if (index === 0) this.tabOnFrame = frame;
            else if (index === 1) this.tabOffFrame = frame;
        }
    }

    private presentRounds(data: IRechargeDailyPresentData): void {
        this.rounds = data.rounds;
        this.selectedRound = data.selectedRound;
        const tabs = this.tabs;
        for (let index = 0; index < tabs.length; index++) {
            const round = data.rounds[index];
            const node = tabs[index];
            if (round === undefined) {
                node.active = false;
                continue;
            }
            node.active = true;
            const selected = round === data.selectedRound;
            const sprite = node.getComponent(Sprite);
            const frame = selected ? this.tabOnFrame : this.tabOffFrame;
            if (sprite && frame) sprite.spriteFrame = frame;
            const label = node.getChildByName('Label')?.getComponent(Label);
            if (label) label.string = data.roundLabels.get(round) ?? '';
        }
    }

    private emitSwitch(index: number): void {
        const round = this.rounds[index];
        if (round === undefined || round === this.selectedRound) return;
        this.onSwitchRound?.(round);
    }

    // ============================================================
    // 顶部
    // ============================================================

    private presentTop(data: IRechargeDailyPresentData): void {
        if (!this.topProgress) return;
        // 顶部条**不带文本**（原稿 `显示进度文本` 页名「否」）⇒ 第三个参数不传。
        this.topProgress.render(data.accProgress, data.accTotal);
    }

    private presentStages(stages: readonly IRechargeDailyStagePresent[]): void {
        this.stageViews = Array.from(stages);
        for (let index = 0; index < this.stages.length; index++) {
            const stage = this.stages[index];
            if (!stage) continue;
            const view = stages[index];
            if (!view) {
                stage.hide();
                continue;
            }
            stage.render(view.label, view.state, view.qualityFrame, view.iconFrame);
        }
    }

    private emitClaimAcc(index: number): void {
        const view = this.stageViews[index];
        if (!view) return;
        // 只有「达标未领」才发请求（未达标 / 已领的格子点了不该发）。
        if (view.state !== 'claimable') return;
        this.onClaimAcc?.(this.selectedRound, view.days);
    }

    // ============================================================
    // 行列表
    // ============================================================

    private presentRows(rows: readonly IRechargeDailyRowPresent[]): void {
        // ⚠️ 视图模型整体换掉，`renderItemFn` 里按 index **现取**（长驻回调，禁闭包捕获）
        this.rowViews = Array.from(rows);

        const list = this.rowList;
        if (!list) return;
        if (!this.rowRendererBound) {
            this.rowRendererBound = true;
            list.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        list.refreshList(this.rowViews as unknown[]);
        // 换档位后回到顶部（两档天数不同，不复位会停在「内容变短后的越界位置」）。
        list.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 → 每次都按当前 `rowViews` 重铺）。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(RechargeDailyRow);
        if (!view) return;

        // 回调按 **index 现取** `rowViews[index]`，不能闭包捕获 —— 同一个实例会复用到别的下标。
        view.onAction = () => {
            const row = this.rowViews[index];
            if (!row) return;
            const round = this.selectedRound;
            if (row.buttonKey === 'claim') this.onClaimDay?.(round, row.days);
            // `goto` = 没充够 ⇒ 老端跳商店，**不是**领累计奖（累计奖走顶部阶段格）。
            else if (row.buttonKey === 'goto') this.onGoto?.(round);
        };

        const row = this.rowViews[index];
        if (!row) {
            view.hide();
            return;
        }
        view.render(
            row.desc,
            row.buttonKey,
            row.currentCoin,
            row.targetCoin,
            RECHARGE_DAILY_BUTTON_TEXTS,
            row.slots,
        );
    }

    /** 顶部累计格的文案（「累计 N 天」）；供宿主组装 `IRechargeDailyStagePresent.label`。 */
    static accStageLabel(days: number): string {
        return formatText(RECHARGE_TEXTS.dailyAccDay, days);
    }

    /**
     * 档位页签文案（`round` → 「60档」/「300档」）。
     *
     * 老端 `TabGiftEveryDay.getRound()` 就是 `selectIndex === 0 ? 1 : 2` 的硬编码
     * （页签文案写在 FGUI 上，只有两档）⇒ 这里同样按 `round` 查表，不做「{0}档」拼装
     * （表里出现第三档时页签会是空串 —— 与老端一致，不是静默编造一个文案）。
     */
    static roundLabel(round: number): string {
        if (round === 1) return RECHARGE_TEXTS.tabDailyRound1;
        if (round === 2) return RECHARGE_TEXTS.tabDailyRound2;
        return '';
    }

    /** 行描述（「第 N 天充值获取 M 金币」）。 */
    static rowDesc(days: number, targetCoin: number): string {
        return formatText(RECHARGE_TEXTS.dailyRowTitle, days, targetCoin);
    }
}

/** 四态按钮文案（唯一出口 `GiftTexts.RECHARGE_TEXTS`，子组件不造字符串）。 */
const RECHARGE_DAILY_BUTTON_TEXTS: IRechargeDailyButtonTexts = {
    locked: RECHARGE_TEXTS.dailyLocked,
    goto: RECHARGE_TEXTS.dailyGoto,
    claim: RECHARGE_TEXTS.btnClaim,
    taken: RECHARGE_TEXTS.taken,
};
