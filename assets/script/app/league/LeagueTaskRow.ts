/**
 * 联盟任务列表行。三态通过 active 切换领取/前往/广告按钮，按钮点击由行脚本自己绑定。
 * 广告按钮当前恒隐藏（广告子系统未接）。
 */

import {_decorator, Button, Component, Label, Node, Sprite, UITransform} from 'cc';
import { RedDot } from '../common/RedDot';
import type { ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import type { ILeagueReward, ILeagueTaskRowView } from './LeagueTable';
import { LEAGUE_AD_PLAYBACK_AVAILABLE } from './LeagueTexts';

const { ccclass, property } = _decorator;

/**
 * 行内进度条的**满宽**（= prefab 里 `Progress/ProgressFill` 的 `contentSize.width`）。
 *
 * 来历：FGUI `组件_联盟_进度条` 原生 652×38，`bar` 在 `(8,8) 637×21`；
 * 行内实例把整条压到 **160** 宽 ⇒ 填充满宽 = `637 / 652 × 160 ≈ 156.3`，取 **156**。
 * 同 `LeagueHallPage.PROGRESS_FULL_WIDTH`：不要在这里按 `UITransform` 现算 ——
 * 填充节点的宽度正是本类在改的东西，现算会随每次 render 越缩越小。
 */
export const LEAGUE_TASK_ROW_PROGRESS_FULL_WIDTH = 156;

@ccclass('LeagueTaskRow')
export class LeagueTaskRow extends Component {
    @property({ type: Label, tooltip: 'title：任务名（24px 居中）' })
    titleLabel: Label = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods：奖励 1（缺位整格隐藏）' })
    rewardSlot: LeagueRewardSlot = null;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods1：奖励 2（缺位整格隐藏）' })
    rewardSlot1: LeagueRewardSlot = null;

    @property({ type: Node, tooltip: 'comp_progress：整条进度（「已领取」页整块不显示）' })
    progressNode: Node = null!;

    @property({ type: Sprite, tooltip: 'comp_progress/bar：填充（按 value/max 改宽度）' })
    progressFill: Sprite = null!;

    @property({ type: Label, tooltip: 'comp_progress/lab_title：百分比文案（18/20px）' })
    progressLabel: Label = null!;

    @property({ type: Node, tooltip: 'btn_get：领取按钮（仅「可领取」页）' })
    getButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_get/组件_红点：可领取红点（与按钮可见性同源）' })
    getRedDot: Node = null!;

    @property({ type: Node, tooltip: 'btn_go：前往按钮（仅「未完成」页）' })
    goButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_adv：看广告按钮（仅「未完成」+ 有广告次数 + 广告能力可用）' })
    advButton: Node = null!;

    @property({ type: Node, tooltip: 'n35：整幅「已领取」标（仅「已领取」页）' })
    doneTag: Node = null!;

    /** 点「领取」（`view` 是**点击那一刻**这一槽位上的行数据）。 */
    onGet: ((view: ILeagueTaskRowView) => void) | null = null;
    /** 点「前往」。 */
    onGo: ((view: ILeagueTaskRowView) => void) | null = null;
    /** 点「看广告」。 */
    onAdv: ((view: ILeagueTaskRowView) => void) | null = null;

    /** 当前铺在这一行上的任务（`null` = 空槽）。 */
    private current: ILeagueTaskRowView | null = null;
    private bound = false;

    protected onLoad(): void {
        this.bind();
    }

    protected onDestroy(): void {
        // 判 `isValid` 后再摘：宿主销毁时子节点可能已先被拆
        this.unbind(this.getButton, this.onGetClick);
        this.unbind(this.goButton, this.onGoClick);
        this.unbind(this.advButton, this.onAdvClick);
    }

    /** 当前行的任务 id（没铺数据时 = 0）。 */
    get taskResId(): number {
        return this.current?.resId ?? 0;
    }

    /**
     * 铺一行（所有状态**绝对赋值** —— 槽位复用不留残影）。
     *
     * @param view   行视图（`null` ⇒ 藏掉整行）
     * @param art    本趟的奖励图帧句柄（`null` ⇒ 奖励格只剩品质框）
     * @param showAd `显示广告` controller 的那一页（`true` = 该显示；
     * 来自 `CmdRoleUnion.todayTaskAdvTimes <= 0`）
     */
    render(view: ILeagueTaskRowView | null, art: ILeagueRewardArt | null, showAd: boolean): void {
        this.current = view;

        if (!view) {
            this.hide();
            return;
        }

        this.titleLabel.string = view.title;

        const canReward = view.state === 'canReward';
        const undone = view.state === 'undone';
        const rewarded = view.state === 'rewarded';

        this.renderReward(this.rewardSlot, view.rewards[0] ?? null, art);
        this.renderReward(this.rewardSlot1, view.rewards[1] ?? null, art);

        this.applyProgress(view.value, view.maxValue, view.percentText);

        this.getButton.active = canReward;
        this.goButton.active = undone;
        this.advButton.active = undone && showAd && LEAGUE_AD_PLAYBACK_AVAILABLE;
        this.doneTag.active = rewarded;
        this.progressNode.active = !rewarded;

        // 红点走共用组件（`ui/common/RedDot.prefab`，普通红点 = spine「红点闪闪」）。
        // 必须 `setRedDot()` 而不是写 `node.active`：`RedDot.onLoad` 会把
        // `Icon` / `Spine` / `Title` 三个子节点压 inactive，只翻根节点会出现「根开着、子里全灭」。
        // 绑的是实例**根节点**（跨嵌套 prefab 边界取不到内部组件，见 `getRedDot` 的声明口径）。
        const dot = this.getRedDot ? this.getRedDot.getComponent(RedDot) : null;
        if (dot) dot.setRedDot(canReward ? 1 : 0);
        else this.getRedDot.active = canReward;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }

    // 内部

    /** 一个奖励格：缺位整格隐藏，有位则按 `resId` 取帧 + 写数量。 */
    private renderReward(slot: LeagueRewardSlot, reward: ILeagueReward | null, art: ILeagueRewardArt | null): void {
        if (!slot) return;
        if (!reward) {
            slot.hide();
            return;
        }
        slot.node.active = true;
        const frames = art ? art.framesOf(reward.resId) : { frame: null, icon: null };
        slot.render(frames.frame, frames.icon, reward.number, true);
    }

    /**
     * 进度条 + 百分比。
     *
     * 百分比口径与老端**逐字一致**：`Math.floor(now / max * 100) + "%"`，
     * 其中 `now = Math.min(GetValue(), GetMaxValue())`（`ILeagueTaskRowView` 已算好），
     * 分母为 0 时老端不设 `pro_title`（整条留空）⇒ 这里是 `percentText === ''`。
     */
    private applyProgress(value: number, maxValue: number, percentText: string): void {
        this.progressLabel.string = percentText;
        const uit = this.progressFill.node.getComponent(UITransform);
        const ratio = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
        // 最小 1px：`setContentSize(0)` 会让 Sprite 在九宫格下算出 NaN 顶点
        uit.setContentSize(Math.max(LEAGUE_TASK_ROW_PROGRESS_FULL_WIDTH * ratio, 1), uit.contentSize.height);
    }

    /** 三颗按钮各绑一次（克隆体各绑自己的，`bound` 保证只绑一次）。 */
    private bind(): void {
        if (this.bound) return;
        this.bound = true;
        this.wire(this.getButton, this.onGetClick, 'BtnGet');
        this.wire(this.goButton, this.onGoClick, 'BtnGo');
        this.wire(this.advButton, this.onAdvClick, 'BtnAdv');
    }

    private wire(node: Node | null, handler: () => void, label: string): void {
        if (!node) {
            console.warn(`[LeagueTaskRow] ${label} 缺失，点击不会生效`);
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private unbind(node: Node | null, handler: () => void): void {
        if (!node || !node.isValid) return;
        const button = node.getComponent(Button);
        if (button) button.node.off(Button.EventType.CLICK, handler, this);
        else node.off(Node.EventType.TOUCH_END, handler, this);
    }

    /** 三颗按钮的出口都先过 `current` —— 空槽（复用瞬间）点了不发。 */
    private readonly onGetClick = (): void => {
        const view = this.current;
        if (!view) return;
        if (this.onGet) this.onGet(view);
    };

    private readonly onGoClick = (): void => {
        const view = this.current;
        if (!view) return;
        if (this.onGo) this.onGo(view);
    };

    private readonly onAdvClick = (): void => {
        const view = this.current;
        if (!view) return;
        if (this.onAdv) this.onAdv(view);
    };
}
