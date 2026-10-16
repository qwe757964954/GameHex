/**
 * 「联盟任务」列表里的一行 —— **550×160**
 * （`ui/League/LeagueTask.prefab` 的 `TaskListView/content/TaskRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/任务/组件_联盟_任务item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n27` 行底框 `frame_Zhikuang01`（155×113 九宫格 `38,28,76,56`，显示 **550×160**） | 本节点自己的 `cc.Sprite` | 九宫格 |
 * | `n28` 标题衬底 `BB_img03`（488×32、`alpha=0.5`） | `TitleBar` | 静态 |
 * | `title`（24px、居中、`autoSize=none`） | `Title` | 任务名（`{count}` 已替换） |
 * | `com_goods`（物品框 120×120 × `scale 0.8`） | `Reward`（`LeagueRewardSlot`） | 奖励 1 |
 * | `com_goods1`（同上） | `Reward1`（`LeagueRewardSlot`） | 奖励 2（老端按下标硬取 `rewards[1]`） |
 * | `comp_progress`（`组件_联盟_进度条`，显示 160×38） | `Progress` | 条 + 百分比 |
 * | `btn_get`（「领取」，`TY_btn06`） | `BtnGet` + `Label` + `RedDot` | 见下 |
 * | `btn_go`（「前往」，`TY_btn07`） | `BtnGo` + `Label` | 见下 |
 * | `btn_adv`（`按钮_公共_通用_图标`，`TY_btn07` + `img_video`） | `BtnAdv` + `Badge` | 见下 |
 * | `n35`「已领取」整幅标（`公用_图标_已领取`，119×74） | `DoneTag` | 只在「已领取」页 |
 *
 * ## 三态来自**一个** controller（`状态` pages `0,未完成,1,可领取,2,已领取`）
 *
 * 老端 `item.setSelectedPage("状态", state)` 一句就切换了下面 5 处 `gearDisplay`：
 *
 * | 子节点 | FGUI `gearDisplay` | ⇒ 本节点 `active` |
 * |---|---|---|
 * | `btn_get` | `状态 pages="1"` | `state === 'canReward'` |
 * | `btn_go` | `状态 pages="0"` | `state === 'undone'` |
 * | `btn_adv` | `状态 pages="0"` **且** `显示广告 pages="0"` | `state === 'undone' && showAd && 广告能力可用` |
 * | `n35` | `状态 pages="2"` | `state === 'rewarded'` |
 * | `comp_progress` | `状态 pages="0,1"` | `state !== 'rewarded'` |
 *
 * FGUI 的控制器在 Cocos 里没有等价物，只能摊成 bool ⇒ 本类在 `render()` 里**绝对赋值**
 * （同 `LeagueAdButton.setPage` / `LeagueStoreRow.render` 的口径）。
 *
 * ## 三处「别按直觉改」
 *
 * 1. **`btn_get` 的红点与它的可见性同源**：老端
 *    ```ts
 *    let rd = taskVo && taskVo.CanBeReward() ? 1 : 0;
 *    (item.tm("btn_get.组件_红点") as GObjRD).OnRDUpdate(rd);
 *    ```
 *    而 `btn_get` 本身也只在 `CanBeReward()` 时才可见 ⇒ **按钮一出现红点必然是亮的**。
 *    看着冗余，但这是老端的行为，照搬（别"顺手优化"掉，否则将来加了别的显示条件就对不上）。
 * 2. **`btn_go` / `btn_adv` 不建红点**：FGUI 的 `按钮_公共_通用` / `按钮_公共_通用_图标`
 *    都自带 `组件_红点`，但老端**从没驱动过这两颗**（`initList()` 里只有 `btn_get.组件_红点`）
 *    ⇒ 建出来也只是恒灭、白挂两个嵌套 prefab 实例（每个槽位 ×2）。这是**有意偏离**，
 *    不是漏掉了；将来真要接时按 `BtnGet/RedDot` 的写法加即可。
 * 3. **`btn_adv` 在本端恒不可见**：老端那两处门是「`cmd.todayTaskAdvTimes > 0` 就整块不显示」
 *    （`显示广告` controller）**加上**「`adTime > 0` 才 `alpha=1 / touchable`」。
 *    本工程广告子系统没迁（`LEAGUE_AD_PLAYBACK_AVAILABLE = false`）⇒ 第三道门直接关死，
 *    点了也不可能拿到东西。节点仍建（结构保真），只是恒 `active=false`。
 *
 * ## 为什么按钮点击由**行脚本自己**接
 *
 * 同 `LeagueStoreRow`：整行会被虚拟列表 clone 复用（`VScrollView` 的槽位池），
 * 宿主要在 `renderItemFn` 里**每帧现取**数据、**不能**按 index 捕获回调。
 * 行脚本在 `onLoad` 里绑一次自己的按钮，点击时读 `this.current` —— 槽位复用到哪一行
 * 就读哪一行，天然不会串。
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
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
 * ⚠️ 同 `LeagueHallPage.PROGRESS_FULL_WIDTH`：不要在这里按 `UITransform` 现算 ——
 *    填充节点的宽度正是本类在改的东西，现算会随每次 render 越缩越小。
 */
export const LEAGUE_TASK_ROW_PROGRESS_FULL_WIDTH = 156;

@ccclass('LeagueTaskRow')
export class LeagueTaskRow extends Component {
    @property({ type: Label, tooltip: 'title：任务名（24px 居中）' })
    titleLabel: Label = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods：奖励 1（缺位整格隐藏）' })
    rewardSlot: LeagueRewardSlot = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods1：奖励 2（缺位整格隐藏）' })
    rewardSlot1: LeagueRewardSlot = null!;

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
        // ⚠️ 判 `isValid` 后再摘：宿主销毁时子节点可能已先被拆
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
     *               来自 `CmdRoleUnion.todayTaskAdvTimes <= 0`）
     */
    render(view: ILeagueTaskRowView | null, art: ILeagueRewardArt | null, showAd: boolean): void {
        this.current = view;

        if (!view) {
            this.hide();
            return;
        }

        if (this.titleLabel) this.titleLabel.string = view.title;

        const canReward = view.state === 'canReward';
        const undone = view.state === 'undone';
        const rewarded = view.state === 'rewarded';

        this.renderReward(this.rewardSlot, view.rewards[0] ?? null, art);
        this.renderReward(this.rewardSlot1, view.rewards[1] ?? null, art);

        this.applyProgress(view.value, view.maxValue, view.percentText);

        if (this.getButton) this.getButton.active = canReward;
        if (this.goButton) this.goButton.active = undone;
        if (this.advButton) this.advButton.active = undone && showAd && LEAGUE_AD_PLAYBACK_AVAILABLE;
        if (this.doneTag) this.doneTag.active = rewarded;
        if (this.progressNode) this.progressNode.active = !rewarded;

        // 红点走共用组件（`ui/common/RedDot.prefab`，普通红点 = spine「红点闪闪」）。
        // ⚠️ 必须 `setRedDot()` 而不是写 `node.active`：`RedDot.onLoad` 会把
        //    `Icon` / `Spine` / `Title` 三个子节点压 inactive，只翻根节点会出现「根开着、子里全灭」。
        //    绑的是实例**根节点**（跨嵌套 prefab 边界取不到内部组件，见 `getRedDot` 的声明口径）。
        const dot = this.getRedDot ? this.getRedDot.getComponent(RedDot) : null;
        if (dot) dot.setRedDot(canReward ? 1 : 0);
        else if (this.getRedDot) this.getRedDot.active = canReward;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }

    // ============================================================
    // 内部
    // ============================================================

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
     * ⚠️ 百分比口径与老端**逐字一致**：`Math.floor(now / max * 100) + "%"`，
     *    其中 `now = Math.min(GetValue(), GetMaxValue())`（`ILeagueTaskRowView` 已算好），
     *    分母为 0 时老端不设 `pro_title`（整条留空）⇒ 这里是 `percentText === ''`。
     */
    private applyProgress(value: number, maxValue: number, percentText: string): void {
        if (this.progressLabel) this.progressLabel.string = percentText;
        if (!this.progressFill) return;
        const uit = this.progressFill.node.getComponent(UITransform);
        if (!uit) return;
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
