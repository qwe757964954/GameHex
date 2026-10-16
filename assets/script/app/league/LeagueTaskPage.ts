/**
 * 「联盟任务」弹窗（老端 `play/LayerLeagueTask`，`ui/League/LeagueTask`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/任务/组件_联盟_任务.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「联盟任务」） | (40,187) **640×895** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `n29` 横幅底（`frame_Zhikuang01` 染色 `#657d54`） | (85,249) 550×160 | `HeadBg` |
 * | `comp_progress`（`组件_联盟_进度条`） | (134,303) 452×38 | `TaskProgress` |
 * | `n31` 圆环装饰（`frame_yuan_pic02`） | (106,288) 43×46 `scale 1.4` | `Circle` |
 * | `list`（`overflow=scroll`、`lineGap=10`、9 项） | (85,415) **550×537** | `TaskListView`（虚拟列表） |
 * | `lab_jump` | (157,969) 405×34 | `AdLabel` |
 * | `lab_count` | (126,299) 21×39 | `CountLabel` |
 * | `box_3` / `box_5` / `box_8` | (245,277) / (358,277) / (517,277) 90×100 | `Box1` / `Box2` / `Box3` |
 * | `reward`（`组件_联盟_任务_奖励框`） | (289,178) 110×110 `visible=false` | `Reward` |
 *
 * `popBg` 那组的关系是 `center-center,middle-middle` ⇒ 弹窗**恒居中**（`popBg` 中心设计态
 * 是 (360,634.5)，不是画布中心 (360,640) —— 那 5.5px 是设计意图，照抄）。
 *
 * ## 老端行为（`LayerLeagueTaskUI`）与移植取舍
 *
 * 1. **不发任何请求**：`init()` 只挂 `VOLeagueTaskBag` / `VORoleUnionBag` / `VORoleBag` 的
 *    `OnChanged → updateView`，自己一个包都不发（联盟任务 = 通用任务缓存，见
 *    `LeagueRepository.loadTask`）。本端 `CacheMgr` 只读取值、不发变更事件 ⇒
 *    `onOpen` 主动读一次，**领奖成功后自己再读一次**（同 P4 三面板口径）。
 * 2. **按钮三支**（老端 `initList()` 里）：
 *    `btn_get → RequestTaskReward(resId)` / `btn_go → CtrlJumpView` + `unload()` /
 *    `btn_adv → RequestWatchAdvert(unionTask, false, resId)`。
 *    后两支本端都接不了（跳转路由、广告子系统都没迁）⇒ 明确提示，不发包。
 * 3. **宝箱点击三支**（老端 `setBoxState` 的 `onClick`）：
 *    可领取 ⇒ 领进度奖励（**请求体只有 `subType`、没有宝箱 id**）；
 *    不可领取 ⇒ 弹奖励浮框；已领取 ⇒ 什么都不做。
 * 4. **浮框位置**：老端 `rewardCom.x = box.x; rewardCom.y = box.y - rewardCom.height`
 *    —— 以 FGUI 的「左上角 + 向下为正」换算到 Cocos 就是「浮框下沿贴宝箱上沿」，
 *    即 `reward.y = box.y + 宝箱半高 + 浮框半高`（见 `TASK_BOX_REWARD_GAP`）。
 * 5. **顶部进度条的 `lab_title` 是空的**（老端 `setText("")`；行内那条才有百分比）。
 *
 * ## 本端有意增补
 *
 * - `busy` 防连点（老端没有）：`requestTaskReward` / `requestTaskProgressReward` 都是
 *   写请求、走 5s 超时，连点会重复发包（同 `LeagueStorePage.beginWrite()`）。
 * - 奖励图标**先取完再刷列表**（`loadLeagueRewardArt`），否则虚拟列表槽位复用会闪上一行的图。
 * - 面板上只建 **3 个**宝箱节点（对齐 FGUI 原稿）；`taskUnionProgress` 表万一超过 3 行，
 *   多出来的会被丢掉并在控制台留一条 warn（不错位、也不静默）。
 */

import { _decorator, Button, Label, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT, leagueTaskBoxArt } from './LeagueArt';
import { LeagueTaskBox } from './LeagueTaskBox';
import { LeagueTaskRow } from './LeagueTaskRow';
import {
    leagueRepository,
    LeagueUnionTaskType,
    type ILeagueRepository,
    type ILeagueTaskSnapshot,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import { gotoLeagueTask } from './LeagueJump';
import { playLeagueAd } from './LeagueAd';
import type { ILeagueTaskBoxView, ILeagueTaskRowView } from './LeagueTable';
import {
    LEAGUE_TASK_AD_TEXT_TEMPLATE,
    LEAGUE_TASK_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    fillLeagueText,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/**
 * 顶部进度条的**满宽**（= prefab 里 `TaskProgress/ProgressFill` 的 `contentSize.width`）。
 *
 * 来历：FGUI `组件_联盟_进度条` 原生 652×38、`bar` 在 `(8,8) 637×21`；
 * 面板实例把整条压到 **452** 宽 ⇒ 填充满宽 = `637 / 652 × 452 ≈ 441.6`，取 **441**。
 * ⚠️ 同 `LeagueHallPage.PROGRESS_FULL_WIDTH`：不按 `UITransform` 现算（填充宽度正是本类在改的东西）。
 */
const TASK_PROGRESS_FULL_WIDTH = 441;

/**
 * 奖励浮框与宝箱的**垂直间距**（浮框下沿贴宝箱上沿）。
 *
 * = 宝箱半高 (100/2) + 浮框半高 (110/2) = 105 —— 老端那两行
 * `rewardCom.y = box.y - rewardCom.height` 在「左上角 + 向下为正」坐标系里的等价物。
 */
const TASK_BOX_REWARD_GAP = 105;

/** 面板上能容纳的宝箱个数（FGUI 原稿就 3 个）。 */
const TASK_BOX_SLOTS = 3;

@ccclass('LeagueTaskPage')
export class LeagueTaskPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueTask';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'TaskListView：任务列表（虚拟列表 + Mask）' })
    taskList: VirtualScrollView = null!;

    @property({ type: Sprite, tooltip: 'TaskProgress/ProgressFill：顶部进度填充' })
    progressFill: Sprite = null!;

    @property({ type: Label, tooltip: 'TaskProgress/ProgressLabel：顶部进度文案（老端恒置空）' })
    progressLabel: Label = null!;

    @property({ type: Label, tooltip: 'lab_count：已领奖任务数' })
    countLabel: Label = null!;

    @property({ type: Label, tooltip: 'lab_jump：看广告跳过次数（广告未接入 ⇒ 整行隐藏）' })
    adLabel: Label = null!;

    @property({ type: Node, tooltip: 'Box1：第 1 个宝箱（FGUI `box_3`，里程碑取自表）' })
    box1: Node = null!;

    @property({ type: Node, tooltip: 'Box2：第 2 个宝箱（FGUI `box_5`）' })
    box2: Node = null!;

    @property({ type: Node, tooltip: 'Box3：第 3 个宝箱（FGUI `box_8`）' })
    box3: Node = null!;

    @property({ type: Node, tooltip: 'reward：宝箱奖励浮框（默认隐藏）' })
    rewardNode: Node = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'reward/com_goods：浮框里的奖励格' })
    rewardSlot: LeagueRewardSlot = null!;

    @property({ type: Node, tooltip: 'reward/clickNode：点任意处关掉浮框' })
    rewardClose: Node = null!;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueTaskRowView[] = [];

    /** 本趟的奖励图帧（列表奖励 + 宝箱奖励），`present()` 之前一定已就绪。 */
    private art: ILeagueRewardArt | null = null;

    /** 本趟的宝箱图帧（三态各一张）。 */
    private boxFrames: ReadonlyMap<string, SpriteFrame | null> = new Map();

    /** 本趟快照。 */
    private snapshot: ILeagueTaskSnapshot | null = null;

    /** `renderItemFn` 只绑一次（放 `onOpen` 会随每次打开重复叠加）。 */
    private rendererBound = false;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const button = this.closeButton?.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueTask] CloseBtn 上没有 cc.Button，点击不会生效');

        if (this.rewardClose) this.rewardClose.on(Node.EventType.TOUCH_END, this.onRewardCloseClick, this);

        for (const node of this.boxNodes) {
            const box = node?.getComponent(LeagueTaskBox);
            if (box) box.onBoxClick = (view) => void this.onBoxClick(view);
        }

        if (!this.rendererBound) {
            this.rendererBound = true;
            if (this.taskList) this.taskList.renderItemFn = (node, index) => this.renderRow(node, index);
        }
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_TASK_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /** 面板上的三个宝箱节点（按 FGUI 的左右序 = `taskUnionProgress.id` 升序）。 */
    private get boxNodes(): readonly (Node | null)[] {
        return [this.box1, this.box2, this.box3];
    }

    /**
     * 读一次任务（缓存 + 表），再把本趟要用到的图全取好，最后铺行 / 铺宝箱。
     *
     * ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     *    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const snapshot = await this.repository.loadTask();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.rows = snapshot.rows.slice();
        this.art = await this.loadArtFrames(snapshot);
        this.boxFrames = await this.loadBoxFrames();
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    /**
     * 预取本趟所有要用到的图：行内两格奖励 + 宝箱浮框里的那一格奖励。
     *
     * 品质框由 `loadLeagueRewardArt` 内部固定取 4 张。
     */
    private async loadArtFrames(snapshot: ILeagueTaskSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>();
        for (const row of snapshot.rows) {
            for (const reward of row.rewards) if (reward) resIds.add(reward.resId);
        }
        for (const box of snapshot.boxes) {
            const reward = box.rewards[0];
            if (reward) resIds.add(reward.resId);
        }
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    /**
     * 预取宝箱的三张图（不可领取 / 可领取 / 已领取）。
     *
     * 三张全取（不按当前状态挑）：宝箱状态会因为领奖立刻变，只取当下用到的那一张
     * 会在领完奖后闪一帧空箱（`loadArt` 有缓存，第二趟不会再读盘）。
     */
    private async loadBoxFrames(): Promise<ReadonlyMap<string, SpriteFrame | null>> {
        const states = ['locked', 'canReward', 'rewarded'] as const;
        const entries = await Promise.all(states.map(async (state) => {
            const art = leagueTaskBoxArt(state);
            return [state, await loadArt(art, LEAGUE_ART_ROOT)] as const;
        }));
        return new Map(entries);
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        this.applyProgress(snapshot.progressValue, snapshot.progressMax);
        if (this.countLabel) this.countLabel.string = String(snapshot.done);
        this.applyAdLabel(snapshot);
        this.renderBoxes(snapshot);
        this.hideReward();

        if (this.taskList) {
            this.taskList.refreshList(this.rows);
            this.taskList.scrollToTop(false);
        }
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueTaskRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        const snapshot = this.snapshot;
        row.render(view, this.art, snapshot ? snapshot.showAd : false);
        // 行自己的按钮回调：读取「点击那一刻」这一槽位上的数据（槽位复用到哪行就是哪行）
        row.onGet = (current) => void this.claim(current);
        row.onGo = (current) => this.jump(current);
        row.onAdv = (current) => void this.watchAd(current);
    }

    /**
     * 顶部进度条 + `lab_count`。
     *
     * ⚠️ 老端 `progress.value = Math.min(done, total)`、`max = total`，且
     *    `comp_progress.lab_title` 被**显式置空**（百分比只在行内那条上有）⇒ 这里也写空串。
     *    `max = 0`（服务端还没下发任何 `CmdTask`）时比例算 0，不让它出 `NaN`。
     */
    private applyProgress(value: number, max: number): void {
        if (this.progressLabel) this.progressLabel.string = '';
        if (!this.progressFill) return;
        const uit = this.progressFill.node.getComponent(UITransform);
        if (!uit) return;
        const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        uit.setContentSize(Math.max(TASK_PROGRESS_FULL_WIDTH * ratio, 1), uit.contentSize.height);
    }

    /**
     * 底部「每日观看广告跳过剩余次数 N/M」。
     *
     * ⚠️ 两个数字来自**广告子系统**（`ModelRole.GetAdvertRestTimes/GetAdvertLimit`），
     *    Demo3.8 没迁 ⇒ 编不出数字。与其显示一个假的「0/0」，不如整行隐藏
     *    （见 `LEAGUE_TASK_AD_TEXT_TEMPLATE` 的说明）。等广告落地后把 `active` 打开即可。
     */
    private applyAdLabel(snapshot: ILeagueTaskSnapshot): void {
        if (!this.adLabel) return;
        const available = snapshot.adAvailable;
        this.adLabel.node.active = available;
        if (!available) return;
        // 真值：`ad` 表 `type=14` 的 limit − `CmdRole.tlCmdAdvert` 已用（见 `LeagueRepository.loadTask`）
        this.adLabel.string = fillLeagueText(LEAGUE_TASK_AD_TEXT_TEMPLATE, snapshot.adRest, snapshot.adLimit);
    }

    /** 三个宝箱：按 `id` 升序一一对应，多出来的丢弃（表最多 3 行）。 */
    private renderBoxes(snapshot: ILeagueTaskSnapshot): void {
        const nodes = this.boxNodes;
        for (let i = 0; i < TASK_BOX_SLOTS; i += 1) {
            const node = nodes[i];
            const box = node?.getComponent(LeagueTaskBox) ?? null;
            if (!node || !box) continue;
            const view = snapshot.boxes[i] ?? null;
            if (!view) {
                node.active = false;
                continue;
            }
            box.render(view, this.boxFrames.get(view.state) ?? null);
        }
        if (snapshot.boxes.length > TASK_BOX_SLOTS) {
            console.warn(`[LeagueTask] taskUnionProgress 有 ${snapshot.boxes.length} 行，面板只显示前 ${TASK_BOX_SLOTS} 个`);
        }
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 点「领取」—— 老端 `btn_get.onClick` 只有一句 `RequestTaskReward(ref.resId)`。 */
    private async claim(view: ILeagueTaskRowView): Promise<void> {
        if (!this.beginWrite()) return;
        try {
            const result = await this.repository.requestTaskReward(view.resId, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /**
     * 点「前往」—— 老端 `CtrlJumpView.JumpType(ref.goto)` 后 `unload()`。
     *
     * Demo3.8 没有全工程跳转路由，建了联盟任务专用 `gotoLeagueTask`：已知可开的页面
     * （征收 / 联盟商店 / 联盟捐献 / 每日挑战）直接开、其余提示、**不关面板**
     * （关了反而让玩家以为跳成功了）。`view.goto <= 0` 时同样提示 —— 老端对 0 也是交给
     * `JumpType` 去忽略，本端不区分，一句话说清。
     */
    private jump(view: ILeagueTaskRowView): void {
        gotoLeagueTask(view.goto);
    }

    /**
     * 点「看广告」—— 老端 `btn_adv.onClick` 的 `RequestWatchAdvert(unionTask, false, resId)`。
     *
     * ⚠️ **先播后发**：`RequestRoleWatchAdvert` 本身就是「记一次广告」的凭据，
     *    没放完就发等于白送 ⇒ `playLeagueAd()` 返回 `false` 时直接退出、**一个包都不发**。
     */
    private async watchAd(view: ILeagueTaskRowView): Promise<void> {
        if (!this.beginWrite()) return;
        try {
            const watched = await playLeagueAd();
            if (!watched) {
                FW.showTip(LEAGUE_TIP_FAILED);
                return;
            }
            const result = await this.repository.requestTaskAdvert(view.resId, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /**
     * 点一个宝箱 —— 老端 `setBoxState` 的 `onClick` 三支（见类头）。
     *
     * ⚠️ 领进度奖励的请求体**只有 `subType`**，没有宝箱 id：服务端按
     *    `CmdRoleUnion.todayTaskGetProgressCount` 自己推进。所以这里传的是
     *    `LeagueUnionTaskType.leagueTask`，不是 `view.id`。
     */
    private async onBoxClick(view: ILeagueTaskBoxView): Promise<void> {
        if (view.state === 'canReward') {
            if (!this.beginWrite()) return;
            try {
                const result = await this.repository.requestTaskProgressReward(LeagueUnionTaskType.leagueTask, this);
                await this.afterWrite(result);
            } finally {
                this.busy = false;
            }
            return;
        }
        if (view.state === 'locked') this.showReward(view);
        // 'rewarded'：老端没有这一支（点已领取的箱子什么都不做）
    }

    /**
     * 弹奖励浮框（老端 `showReward(rewardId, box)`）。
     *
     * 位置：`reward.y = box.y + TASK_BOX_REWARD_GAP`、`reward.x = box.x`（见类头第 4 条）。
     * box 节点与 reward 节点都是**面板根的直接子节点** ⇒ 直接在根坐标系里对齐，无需换算。
     */
    private showReward(view: ILeagueTaskBoxView): void {
        if (!this.rewardNode) return;
        const reward = view.rewards[0];
        if (!reward) {
            console.warn(`[LeagueTask] taskUnionProgress#${view.id} 没有奖励，浮框不弹`);
            return;
        }
        const box = this.boxNodes.find((node) => node?.getComponent(LeagueTaskBox)?.boxId === view.id);
        if (box) {
            const p = box.position;
            this.rewardNode.setPosition(new Vec3(p.x, p.y + TASK_BOX_REWARD_GAP, p.z));
        }
        if (this.rewardSlot) {
            const frames = this.art ? this.art.framesOf(reward.resId) : { frame: null, icon: null };
            this.rewardSlot.node.active = true;
            this.rewardSlot.render(frames.frame, frames.icon, reward.number, true);
        }
        this.rewardNode.active = true;
    }

    private hideReward(): void {
        if (this.rewardNode) this.rewardNode.active = false;
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 杂项
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    private readonly onRewardCloseClick = (): void => {
        this.hideReward();
    };

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
