import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueRewardEvent, type ILeagueRewardIntent, type ILeagueRewardCompletion } from './LeagueRewardEvents';
/**
 * 北伐中原主面板。进入拉活动列表，每秒刷剩余时间。
 * 擂鼓和扫荡是写请求，挑战只弹帮助说明，boss 半身像未迁不画空框。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { RedDot } from '../common/RedDot';
import { LeagueNorthRankPage } from './LeagueNorthRankPage';
import { LeagueNorthRewardPage } from './LeagueNorthRewardPage';
import {
    leagueRepository,
    LeagueACT_TYPE,
    type ILeagueNorthSnapshot,
    type ILeagueRepository,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import { openLeagueHelp } from './LeagueHelp';
import {
    isLeagueNorthOpen,
    leagueNorthBuffRemainSec,
    leagueNorthHms,
    leagueNorthOpenHourText,
    leagueNorthResetRemainSec,
} from './LeagueTable';
import {
    LEAGUE_NORTH_DRUM_LIMIT,
    LEAGUE_NORTH_HELP_ID,
    LEAGUE_NORTH_REMAIN_TIME_TEMPLATE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    fillLeagueText
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/** 面板上「今日挑战奖励」最多铺几个物品框（FGUI 原稿就 2 个：`com_goods` / `com_goods1`）。 */
const NORTH_DAILY_SLOTS = 2;

/**
 * 「挑战」按钮下红点子节点的**路径**（相对面板根）。
 *
 * 老端 `按钮_挑战.组件_红点` 取的是**按钮组件内部**的节点（`按钮_公共_通用.xml` 自带
 * `组件_公用_红点`）；本端挑战按钮是**内联**节点，红点挂在它下面。
 *
 * 这是**兜底**：`@property challengeRedDot` 在 Inspector 绑好时优先用它；没绑时按本路径
 * 现查一次（与 `LeaguePage` 按名查入口红点 `LEAGUE_ENTRANCE_RED_DOT` 同一口径）。
 */
const CHALLENGE_RED_DOT_PATH = 'ChallengeBtn/RedDot';

@ccclass('LeagueNorthExpeditionPage')
export class LeagueNorthExpeditionPage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 失败、开出一个空面板。
     */
    static prefabPath = 'ui/League/LeagueNorthExpedition';

    @property({ type: Node, tooltip: 'BackBtn：左下返回（挂 cc.Button）' })
    backButton: Node = null;

    @property({ type: Node, tooltip: 'HelpBtn：「英雄共鸣」右侧帮助按钮' })
    helpButton: Node = null;

    @property({ type: Node, tooltip: 'RewardBtn：左侧「奖励」入口（开奖励子页）' })
    rewardButton: Node = null;

    @property({ type: Node, tooltip: 'RankBtn：左侧「排行」入口（开排行子页）' })
    rankButton: Node = null;

    @property({ type: Node, tooltip: 'RewardRedDot：奖励入口上的红点' })
    rewardRedDot: Node = null;

    @property({ type: Node, tooltip: 'DrumBtn：「擂鼓」' })
    drumButton: Node = null;

    @property({ type: Node, tooltip: 'ChallengeBtn：「挑战」' })
    challengeButton: Node = null;

    /**
     * `ChallengeBtn/RedDot`：「挑战」按钮上的红点 —— 老端 `按钮_挑战.组件_红点`。
     *
     * 绑 **`Node`** 而不是 `RedDot`：红点是 `ui/common/RedDot.prefab` 的**嵌套实例**，
     * 它内部的 `RedDot` 组件存在**被引用 prefab 的文件里**、不在本 prefab 里 ⇒
     * 「外层脚本 → 实例内部组件」的引用**过不了序列化**（存盘会落成 `null`、静默失效）。
     * 实例的**根节点**是序列化在本文件里的 shell ⇒ 绑节点可行，运行时 `getComponent` 取。
     * （同口径：`rewardRedDot` / `LeagueDiscountPage.saleRedDot` / `LeagueStoreRow.redDot`。）
     */
    @property({ type: Node, tooltip: 'ChallengeBtn/RedDot：「挑战」按钮上的红点（还有挑战次数）' })
    challengeRedDot: Node = null;

    /** `challengeRedDot` 没绑时的兜底查询结果（见 `challengeRedDotNode()`）。 */
    private fallbackChallengeRedDot: Node | null = null;

    @property({ type: Node, tooltip: 'SweepBtn：「扫荡」' })
    sweepButton: Node = null;

    @property({ type: Label, tooltip: 'MonsterLabel：boss 名（`guankaReward` → `monster`）' })
    monsterLabel: Label = null;

    @property({ type: Label, tooltip: 'EndTimeLabel：活动剩余时间' })
    endTimeLabel: Label = null;

    @property({ type: Label, tooltip: 'TimesLabel：挑战次数' })
    timesLabel: Label = null;

    @property({ type: Label, tooltip: 'AttrLeaguePower/Value：今日联盟累计伤害' })
    attrLeaguePower: Label = null;

    @property({ type: Label, tooltip: 'AttrPower/Value：今日累计伤害（我）' })
    attrPower: Label = null;

    @property({ type: Label, tooltip: 'AttrTime/Value：Buff 剩余时间' })
    attrTime: Label = null;

    @property({ type: Label, tooltip: 'AttrAdd/Value：叠加层数' })
    attrAdd: Label = null;

    @property({ type: Label, tooltip: 'AttrBuff/Value：属性加成' })
    attrBuff: Label = null;

    @property({ type: LeagueRewardSlot, tooltip: 'DailySlot0：今日挑战奖励第 1 个物品框' })
    dailySlot0: LeagueRewardSlot = null;

    @property({ type: LeagueRewardSlot, tooltip: 'DailySlot1：今日挑战奖励第 2 个物品框' })
    dailySlot1: LeagueRewardSlot = null;

    /** 本趟快照（时间那两行每秒要用它重算）。 */
    private snapshot: ILeagueNorthSnapshot | null = null;

    /** 本趟的奖励图帧。 */
    private art: ILeagueRewardArt | null = null;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    /** 秒表是否已挂（`onClose` 要按它决定 `unschedule`）。 */
    private ticking = false;

    // 生命周期

    protected onInit(): void {
        EventMgr.instance.on(LeagueRewardEvent.Completed, this.onRewardCompleted, this);
        this.bind(this.backButton, this.onBackClick);
        this.bind(this.helpButton, () => openLeagueHelp(LEAGUE_NORTH_HELP_ID));
        this.bind(this.rankButton, () => void LeagueNorthRankPage.open({}));
        this.bind(this.rewardButton, () => void LeagueNorthRewardPage.open({}));
        this.bind(this.drumButton, () => void this.onDrumClick());
        this.bind(this.sweepButton, () => void this.onSweepClick());
        this.bind(this.challengeButton, () => void this.onChallengeClick());
    }

    protected async onOpen(): Promise<void> {
        const revision = ++this.revision;
        // 老端 `initAsync()` 只有这一条请求（数据本体随 `CmdUnionActivity` 落地）
        await this.repository.requestActList(LeagueACT_TYPE.NORTHERN_EXPEDITION, this);
        if (!this.alive || revision !== this.revision) return;
        await this.reload();
    }

    protected onClose(): void {
        this.busy = false;
        this.revision += 1;
        this.stopTick();
    }

    onDestroy(): void {
        EventMgr.instance.offTarget(this);
        this.revision += 1;
        this.stopTick();
        super.onDestroy();
    }

    // 取数 / 铺数据

    /** 弹窗标题（本面板是整屏面板、标题在图里，这里只给探针一个稳定标识）。 */
    static get titleText(): string {
        return '北伐中原';
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /** 读一次快照（缓存 + 表），把图取好，再铺。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repository.loadNorthExpedition();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
        this.startTick();
    }

    /** 预取「今日挑战奖励」那两个物品的图帧。 */
    private async loadArtFrames(snapshot: ILeagueNorthSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>();
        for (const reward of snapshot.dailyRewards) resIds.add(reward.resId);
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    /**
     * 「挑战」红点节点 —— `@property challengeRedDot` 没绑时按 `CHALLENGE_RED_DOT_PATH` 兜底。
     *
     * 查一次就缓存；路径也查不到时返回 `null`（下面自然跳过，不抛）。
     */
    private challengeRedDotNode(): Node | null {
        if (this.challengeRedDot) return this.challengeRedDot;
        if (!this.fallbackChallengeRedDot) {
            this.fallbackChallengeRedDot = this.node.getChildByPath(CHALLENGE_RED_DOT_PATH);
        }
        return this.fallbackChallengeRedDot;
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        if (this.monsterLabel) this.monsterLabel.string = snapshot.boss ? snapshot.boss.name : '';
        if (this.timesLabel) this.timesLabel.string = snapshot.timesText;
        if (this.attrLeaguePower) this.attrLeaguePower.string = String(snapshot.leagueValue);
        if (this.attrPower) this.attrPower.string = String(snapshot.selfValue);
        if (this.attrAdd) this.attrAdd.string = String(snapshot.buffAddTimes);
        if (this.attrBuff) this.attrBuff.string = snapshot.buffText;

        const dot = this.rewardRedDot ? this.rewardRedDot.getComponent(RedDot) : null;
        if (dot) dot.setRedDot(snapshot.rewardRedDot ? 1 : 0);
        else if (this.rewardRedDot) this.rewardRedDot.active = snapshot.rewardRedDot;

        // 「挑战」按钮上的红点 —— 老端 `按钮_挑战.组件_红点` ← `hasNorthernExpeditionChallengeRD()`
        // （「还有挑战次数」）。与奖励入口那颗**分开**：奖励可领不该把红点打到挑战按钮上。
        const challengeNode = this.challengeRedDotNode();
        const challengeDot = challengeNode ? challengeNode.getComponent(RedDot) : null;
        if (challengeDot) challengeDot.setRedDot(snapshot.challengeRedDot ? 1 : 0);
        else if (challengeNode) challengeNode.active = snapshot.challengeRedDot;

        this.renderDaily(snapshot);
        this.tick(); // 时间两行也要立刻出一版（不能等下一秒）
    }

    /** 「今日挑战奖励」的两个物品框（老端按下标硬取 `reward[0]` / `reward[1]`）。 */
    private renderDaily(snapshot: ILeagueNorthSnapshot): void {
        const slots: readonly (LeagueRewardSlot | null)[] = [this.dailySlot0, this.dailySlot1];
        for (let i = 0; i < NORTH_DAILY_SLOTS; i += 1) {
            const slot = slots[i];
            if (!slot) continue;
            const reward = snapshot.dailyRewards[i];
            if (!reward) {
                slot.node.active = false;
                continue;
            }
            const frames = this.art ? this.art.framesOf(reward.resId) : { frame: null, icon: null };
            slot.node.active = true;
            slot.render(frames.frame, frames.icon, reward.number, true);
        }
    }

    // 时间（每秒）

    private startTick(): void {
        if (this.ticking) return;
        this.ticking = true;
        // 老端 `toolSet.addTimer(1000, this.updateTime, this)`
        this.schedule(this.tick, 1);
    }

    private stopTick(): void {
        if (!this.ticking) return;
        this.ticking = false;
        this.unschedule(this.tick);
    }

    /**
     * 每秒刷「Buff 剩余时间」与「活动剩余时间」。
     *
     * 两行的口径都在 `LeagueTable` 的纯函数里（`leagueNorthBuffRemainSec` /
     * `leagueNorthResetRemainSec` / `leagueNorthHms`）—— 本方法只负责"现在几点"。
     */
    private readonly tick = (): void => {
        const snapshot = this.snapshot;
        if (!snapshot?.act) {
            if (this.attrTime) this.attrTime.string = leagueNorthHms(0);
            if (this.endTimeLabel) {
                this.endTimeLabel.string = fillLeagueText(LEAGUE_NORTH_REMAIN_TIME_TEMPLATE, leagueNorthHms(0));
            }
            return;
        }
        const now = Date.now();
        const buffSec = leagueNorthBuffRemainSec(snapshot.config, snapshot.act.addBuffTimeMs, now);
        if (this.attrTime) this.attrTime.string = leagueNorthHms(buffSec);
        if (this.endTimeLabel) {
            this.endTimeLabel.string = fillLeagueText(
                LEAGUE_NORTH_REMAIN_TIME_TEMPLATE,
                leagueNorthHms(leagueNorthResetRemainSec(snapshot.act.resetTimeSec, now)),
            );
        }
    };

    // 交互

    /** 「擂鼓」：次数用尽 ⇒ 提示；否则发 `CmdUnionActDrumReqMsg`。 */
    private async onDrumClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        // 量的是 `CmdRoleUnion.todayDrumTimes`（服务端权威），**不是** `selfTimes`
        // （那是挑战次数）。老端：`now >= unionBFZYDrumMaxCount` ⇒ 提示。
        if (snapshot.todayDrumTimes >= snapshot.config.drumMaxCount) {
            FW.showTip(LEAGUE_NORTH_DRUM_LIMIT);
            return;
        }
        if (!this.beginWrite()) return;
        try {
            await this.afterWrite(await this.repository.requestDrum(this));
        } finally {
            this.busy = false;
        }
    }

    /** 「扫荡」：先判开放时段，再发 `CmdUnionActSweepReqMsg`。 */
    private async onSweepClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        if (!this.ensureOpen()) return;
        if (!this.beginWrite()) return;
        EventMgr.instance.emit(LeagueRewardEvent.Intent, { owner: this, action: { kind: 'sweep' } } satisfies ILeagueRewardIntent);
    }

    /**
     * 「挑战」：先判开放时段，再开一局 —— **本端接不了**。
     *
     * 老端 `CtrlMgr.CtrlJumpView.GotoSingleFight(selectChapter, TF_BattleType.unionHurtInstance)`；
     * Demo3.8 的战斗入口是另一套、没有「按 chapter + 战斗类型直接开一局」这条路由
     * ⇒ 明确提示、**不发任何包**（同 P4/P5 两处跳转的处置）。
     */
    private async onChallengeClick(): Promise<void> {
        if (!this.snapshot) return;
        if (!this.ensureOpen()) return;
        // 老端 `GotoSingleFight(selectChapter, unionHurtInstance)` 是 PVE 副本战斗；
        // Demo3.8 没有 PVE 战斗场景（只有 PVP=1001）⇒ 弹北境说明，不伪造战斗、不发包。
        openLeagueHelp(LEAGUE_NORTH_HELP_ID);
    }

    /** 开放时段闸（老端两处一模一样的 `if (timelist[0] > now || now > timelist[1])`）。 */
    private ensureOpen(): boolean {
        const snapshot = this.snapshot;
        if (!snapshot) return false;
        if (isLeagueNorthOpen(new Date().getHours(), snapshot.config)) return true;
        // 老端 `FW.G_W("LayerRank_10_NOT_OPEN")` = `{0}点到{1}点开启`
        FW.showTip(leagueNorthOpenHourText(snapshot.config));
        return false;
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    private readonly onRewardCompleted = async (event: ILeagueRewardCompletion): Promise<void> => {
        if (event.owner !== this) return;
        try {
            await this.afterWrite(event.status);
        } finally {
            this.busy = false;
        }
    };

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // 杂项

    private onBackClick(): void {
        this.closeByButton();
    }

    /** 给一个节点挂点击（`cc.Button` 优先，没有就退回 `TOUCH_END`）。 */
    private bind(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueNorthExpedition] 有一个按钮节点没绑上（inspector 里补）');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
