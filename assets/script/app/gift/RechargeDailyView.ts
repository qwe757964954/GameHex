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
 * 「每日充值」页。
 *
 * 顶部为档位页签、累计进度条和三个阶段格，下方是每日行虚拟列表。
 * 顶部进度条不显示文本；`CmdRechargeDaily` 没有结束时间，因此不显示倒计时。
 * 本类只铺视图模型，点击通过回调交给宿主。
 */
@ccclass('RechargeDailyView')
export class RechargeDailyView extends Component {
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

    /** 行内「去充值」按钮，与累计奖励领取是两条路径。 */
    onGoto: ((round: number) => void) | null = null;

    /** 当前行；`renderItemFn` 按索引实时读取。 */
    private rowViews: IRechargeDailyRowPresent[] = [];

    private stageViews: readonly IRechargeDailyStagePresent[] = [];

    /** 页签顺序，点击时按索引读取。 */
    private rounds: readonly number[] = [];

    private selectedRound = 0;

    /** 页签底图直接从 prefab 现有 Sprite 上取，不异步加载。 */
    private tabOnFrame: SpriteFrame | null = null;

    private tabOffFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        this.captureTabFrames();
        const tabs = this.tabs;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].on(Button.EventType.CLICK, () => this.emitSwitch(index), this);
        }

        for (let index = 0; index < this.stages.length; index++) {
            this.stages[index].onAction = () => this.emitClaimAcc(index);
        }
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
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
        // 第一个页签上烤的是「选中」图、第二个是「未选中」图（见生成器 `TAB_ART`）；两态按角色取，不靠循环下标。
        this.tabOnFrame = tabs[0]?.getComponent(Sprite)?.spriteFrame ?? null;
        this.tabOffFrame = tabs[1]?.getComponent(Sprite)?.spriteFrame ?? null;
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
        // 顶部进度条不显示文本。
        this.topProgress.render(data.accProgress, data.accTotal);
    }

    private presentStages(stages: readonly IRechargeDailyStagePresent[]): void {
        this.stageViews = Array.from(stages);
        for (let index = 0; index < this.stages.length; index++) {
            const view = stages[index];
            if (!view) {
                this.stages[index].hide();
                continue;
            }
            this.stages[index].render(view.label, view.state, view.qualityFrame, view.iconFrame);
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
        this.rowViews = Array.from(rows);
        this.rowList.refreshList(this.rowViews);
        // 换档位后回到顶部，避免短列表停在上一档的越界位置。
        this.rowList.scrollToTop(false);
    }

    /** 虚拟列表行渲染；槽位会被复用，每次按当前索引重铺。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(RechargeDailyRow);
        view.onAction = () => {
            const row = this.rowViews[index];
            if (!row) return;
            const round = this.selectedRound;
            if (row.buttonKey === 'claim') this.onClaimDay?.(round, row.days);
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

    /** 档位页签文案；仅有两档，未知档位返回空串。 */
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

/** 按钮四态文案。 */
const RECHARGE_DAILY_BUTTON_TEXTS: IRechargeDailyButtonTexts = {
    locked: RECHARGE_TEXTS.dailyLocked,
    goto: RECHARGE_TEXTS.dailyGoto,
    claim: RECHARGE_TEXTS.btnClaim,
    taken: RECHARGE_TEXTS.taken,
};
