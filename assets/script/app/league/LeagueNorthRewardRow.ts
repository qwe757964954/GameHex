/**
 * 北伐奖励行 —— FGUI `主界面_联盟/副本/北伐中原/组件_联盟_北伐中原_奖励Item.xml`（550×160）。
 *
 * ## 三态一把控制器（`标签` pages = `0 未完成 / 1 已完成 / 2 已领取`）
 *
 * | 页 | 状态 | 进度条 `comp_progress` | 「已领取」印章 `n7` | 按钮 `按钮` | 按钮文案 | 按钮置灰 |
 * |---|---|---|---|---|---|---|
 * | 0 | 未完成 | **显示** | 藏 | 显示 | 未完成 | **是**（`gearLook pages="0" values="1,0,1,1"`） |
 * | 1 | 已完成 | **显示** | 藏 | 显示 | 领取 | 否 |
 * | 2 | 已领取 | 藏 | **显示** | 藏 | — | — |
 *
 * ⚠️ 「未完成」那页的按钮是**灰的但仍然点得动**（FGUI `grayed=1`；老端在 click 里判
 *    `taskVo.CanBeReward()` 决定发不发包）⇒ 本类只染 `color`，**不动 `interactable`**
 *    （口径同 `LeagueStoreRow`，见 `LeagueArt.LEAGUE_TINT_GRAY` 的说明）。
 *
 * ## 进度条
 *
 * FGUI `comp_progress` 是 `组件_联盟_进度条` 压到 **160×38**（原生 652×38）⇒ 填充满宽
 * = `637 / 652 × 160 ≈ 156.3` → **156**，左内缩 `8 / 652 × 160 ≈ 2`。
 * 与 `LeagueTaskPage.TASK_PROGRESS_FULL_WIDTH` 同一套算法（那边是 452 宽 → 441）。
 *
 * ## 数据必须由宿主**预加载好**再传进来
 *
 * `render()` 是同步的（见 `LeagueNorthRewardSlot` 的说明）—— 槽位复用现加载会闪上一行的图。
 */

import { _decorator, Button, Color, Component, Label, Node, Sprite, UITransform } from 'cc';
import { LEAGUE_TINT_GRAY, LEAGUE_TINT_NORMAL } from './LeagueArt';
import type { ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import type { ILeagueNorthRewardRowView } from './LeagueTable';
import {
    LEAGUE_NORTH_REWARD_BTN_CLAIM,
    LEAGUE_NORTH_REWARD_BTN_UNDONE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/**
 * 进度条的**满宽**（= prefab 里 `Progress/Fill` 的 `contentSize.width`，锚点 (0, 0.5)）。
 *
 * 来历：FGUI `组件_联盟_进度条` 原生 652×38、`bar` 在设计态 637×21；
 * 面板实例把整条压到 **160** 宽 ⇒ 填充满宽 = `637 / 652 × 160 ≈ 156.3`，取 **156**。
 * ⚠️ 不按 `UITransform` 现算 —— 填充宽度正是本类在改的东西（同 `LeagueTaskPage` 的口径）。
 */
const NORTH_ROW_PROGRESS_FULL_WIDTH = 156;

/** 正常态 / 置灰态的顶点色（复用 `LeagueArt` 的色板，避免每次 render 都 new）。 */
const TINT_NORMAL = new Color(...LEAGUE_TINT_NORMAL);
const TINT_GRAY = new Color(...LEAGUE_TINT_GRAY);

@ccclass('LeagueNorthRewardRow')
export class LeagueNorthRewardRow extends Component {
    @property({ type: Label, tooltip: 'labName：任务标题（`{count}` 已替换）' })
    nameLabel: Label = null;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods：奖励格' })
    rewardSlot: LeagueRewardSlot = null;

    @property({ type: Node, tooltip: 'comp_progress：进度条（未完成 / 已完成两页显示）' })
    progressNode: Node = null;

    @property({ type: Sprite, tooltip: 'comp_progress/bar：填充（按 value/max 改宽度）' })
    progressFill: Sprite = null;

    @property({ type: Label, tooltip: 'comp_progress/lab_title：进度文案（`now/max`）' })
    progressLabel: Label = null;

    @property({ type: Node, tooltip: 'n7：整幅「已领取」印章（只在「已领取」页显示）' })
    doneTag: Node = null;

    @property({ type: Node, tooltip: '按钮：领取按钮（未完成 / 已完成两页显示）' })
    claimButton: Node = null;

    @property({ type: Label, tooltip: '按钮/title：按钮文案（未完成 / 领取）' })
    claimLabel: Label = null;

    /** 点到那条「领取」（只在可领取时由宿主发包）。 */
    onClaim: ((view: ILeagueNorthRewardRowView) => void) | null = null;

    /** 当前铺在这一行的数据。 */
    private current: ILeagueNorthRewardRowView | null = null;

    protected onLoad(): void {
        const button = this.claimButton ? this.claimButton.getComponent(Button) : null;
        if (button) button.node.on(Button.EventType.CLICK, this.onClick, this);
        else if (this.claimButton) this.claimButton.on(Node.EventType.TOUCH_END, this.onClick, this);
        else console.warn('[LeagueNorthRewardRow] 按钮缺失，点击不会生效');
    }

    protected onDestroy(): void {
        // ⚠️ 只清自己的回调，**不**手动 off 事件（销毁期 `getComponent` 已不可用 ——
        //    同 `LeagueTaskBox.onDestroy` 那条教训）：监听随节点销毁由引擎清。
        this.current = null;
        this.onClaim = null;
    }

    /**
     * 铺一行。
     *
     * @param view 行视图（`null` ⇒ 整行藏掉）
     * @param art  本趟预载好的奖励图帧
     */
    render(view: ILeagueNorthRewardRowView | null, art: ILeagueRewardArt | null): void {
        this.current = view;
        if (!view) {
            this.node.active = false;
            return;
        }
        this.node.active = true;

        if (this.nameLabel) this.nameLabel.string = view.nameText;

        if (this.rewardSlot) {
            const reward = view.reward;
            if (!reward) {
                this.rewardSlot.node.active = false;
            } else {
                const frames = art ? art.framesOf(reward.resId) : { frame: null, icon: null };
                this.rewardSlot.node.active = true;
                this.rewardSlot.render(frames.frame, frames.icon, reward.number, true);
            }
        }

        const rewarded = view.state === 'rewarded';
        const claimable = view.state === 'canReward';

        // 进度条：未完成 / 已完成两页都显示（老端 `gearDisplay pages="0,1"`）
        if (this.progressNode) this.progressNode.active = !rewarded;
        this.applyProgress(view.progress);
        if (this.progressLabel) this.progressLabel.string = view.progressText;

        // 印章只有「已领取」页
        if (this.doneTag) this.doneTag.active = rewarded;

        // 按钮：未完成（灰）/ 已完成（亮）两页显示
        if (this.claimButton) {
            this.claimButton.active = !rewarded;
            const sprite = this.claimButton.getComponent(Sprite);
            if (sprite) sprite.color = claimable ? TINT_NORMAL : TINT_GRAY;
        }
        if (this.claimLabel) {
            this.claimLabel.string = claimable ? LEAGUE_NORTH_REWARD_BTN_CLAIM : LEAGUE_NORTH_REWARD_BTN_UNDONE;
        }
    }

    /** 当前铺的数据（探针 / 单测用）。 */
    get view(): ILeagueNorthRewardRowView | null {
        return this.current;
    }

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 进度条宽度 —— `percent` 是**已经算好的 0~100**（`ILeagueNorthRewardRowView.progress`）。
     *
     * ⚠️ 锚点是 `(0, 0.5)`（位置点 = 左中点）⇒ 宽度往**右**长，左端不动。
     */
    private applyProgress(percent: number): void {
        if (!this.progressFill) return;
        const uit = this.progressFill.node.getComponent(UITransform);
        if (!uit) return;
        const ratio = Number.isFinite(percent) ? Math.max(0, Math.min(1, percent / 100)) : 0;
        uit.setContentSize(Math.max(NORTH_ROW_PROGRESS_FULL_WIDTH * ratio, 1), uit.contentSize.height);
    }

    private readonly onClick = (): void => {
        const view = this.current;
        if (!view) return;
        // ⚠️ 老端只有「可领取」才挂 onClick（未完成那页 `clearClick()` 后什么都不绑）⇒
        //    不是可领取就**直接不发**（宿主也不用再判一遍）。
        if (view.state !== 'canReward') return;
        if (this.onClaim) this.onClaim(view);
    };
}
