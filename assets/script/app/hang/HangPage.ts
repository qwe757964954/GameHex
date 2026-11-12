import { _decorator, Button, Label, Node, ProgressBar, SpriteFrame, UITransform } from 'cc';
import { POPUP_BLANK_CATCHER, PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { TerritoryUiEvent, TerritoryViewEvent } from '../territory/application/TerritoryEvents';
import type { ITerritoryCommandEvent, ITerritoryRenderEvent } from '../territory/application/TerritoryEvents';
import { findHighestPassedTerritoryLevel } from '../territory/model/TerritoryStageBinding';
import { TerritoryChapterInfoRepository } from '../territory/application/TerritoryChapterInfoRepository';
import { CommonTips } from '../common/CommonTips';
import { routedLoad } from '../common/RoutedResource';
import { MonthCardGiftPage } from '../monthcard/MonthCardGiftPage';
import { HJ_COST_ICON_PATH, hjSharedPath } from './HangArt';
import {
    HJ_DEFAULT_GEAR_INDEX,
    HJ_MAX_IDLE_MS,
    contentCenterOffsetY,
    formatHms,
    gearLabel,
    idleCappedMs,
    idleElapsedMs,
    idleProgress01,
    idleReachedMax,
    nextGearIndex,
    perHourText,
    rewardAt,
} from './HangTable';
import type { IHjLocalBox, IHjReward } from './HangTable';
import {
    adCountTextOf,
    costTextOf,
    freePageOf,
    goodsOf,
    hangRepository,
    monthCardBarVisibleOf,
    monthCardPriceTextOf,
    readRoleState,
    rewardIconRefOf,
    rewardQualityOf,
    subscribeRoleChange,
    sweepTimesOf,
} from './HangRepository';
import type { IHangSnapshot } from './HangRepository';
import { qualityFramePath } from './HangArt';
import { HangGainItem } from './HangGainItem';
import { HangGearSwitch } from './HangGearSwitch';
import { HangRewardSlot } from './HangRewardSlot';
import { HangSweepButton } from './HangSweepButton';

const { ccclass, property } = _decorator;

/** 倒计时刷新间隔（秒）。 */
const TICK_SECONDS = 1;

/**
 * 广告**播放**能力是否可用。
 *
 * ⚠️ 老端 `ModelRole.RequestWatchAdvert` 是两步：先 `CtrlPay.PayforAdVideo(type)` 真的放广告，
 * 拿到凭据再发 `CmdRoleWatchAdvertReqMsg`。**Demo3.8 里 `CtrlPay` 与任何广告 SDK 都没迁** ——
 * 直接发请求等于玩家不看完也能白拿一次扫荡次数（可刷，且服务端未必校验）。
 *
 * ⇒ 这一支先关着：点「立即观看」只提示 `adUnavailable`，**不发请求**。
 * 等广告 SDK 接上，把这里改成 `true` 即可（网络那一半 `hangRepository.watchAd` 已经写好）。
 */
export const HJ_AD_PLAYBACK_AVAILABLE = false;

/** 快速征收连点防抖（毫秒）—— 老端 `onClickLevy` 的 500ms。 */
const SWEEP_DEBOUNCE_MS = 500;

/**
 * 征收（挂机）主控 —— 挂在 `assets/resources/ui/Hang/Hang.prefab` 的根节点上。
 *
 * ## 一个 prefab 装下整个界面
 *
 * 老端 `LayerHang` 是**一个** FGUI 组件（`挂机/组件/组件_挂机_界面.xml`，720×1280）：
 * 弹窗底板（`组件_公共弹窗_新` 626×903 @ 48,241）+ 头部插画 + 进度条 + 产出奖励网格
 * + 两个按钮 + 月卡销售条。移植时原样搬成一个 prefab（节点名按语义重命名）。
 *
 * ## 刷新链路
 *
 * ```
 * onOpen → reload()
 *            ├─ hangRepository.load()            读表 + 读缓存（不发请求）
 *            ├─ _preloadFrames()                 预加载「界面会 _setFrame() 的每一处」
 *            ├─ _renderStatic()                  收益条 / 奖励网格 / 月卡条（跟心跳无关的一次性内容）
 *            └─ _refreshTime() + _refreshButtons()
 *         之后每秒 _tick() 只刷进度条 + 时间（到 MAX 停表，与老端 refreshTime 一致）
 * ```
 *
 * ## ⚠️ 三个「静默降级」点（都会在单测 / 探针里钉住）
 *
 * ① **`sweepTimes` 读不到就恒 0** ⇒ 免费次数永远「没用过」⇒ 广告分支本轮走不到
 *    （`CmdRole.sweepTimes` 字段存在、离线时不给值）。
 * ② **玩家持卡状态读不到**（`protoCache.json` 里没有月卡表，`readMonthCard` 的 `owned`
 *    写死 `false`）⇒ `hasUnlimited` 恒 `false` ⇒ 月卡条恒显示。它**只影响月卡条与
 *    免费次数文案**；2026-11-11 起**不再限制倍率切换**（协议已带 `times`）。
 * ③ **预加载集合必须覆盖「界面会 `_setFrame()` 的每一处」**：收益条图标 ×2、快速征收的
 *    体力图标、6 个奖励格的图标 + 品质框。漏了不报错，只是那一格永远留白。
 */
@ccclass('HangPage')
export class HangPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Hang/`，H 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/hang/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/Hang/Hang';

    @property({ type: Node, tooltip: '弹窗关闭键（`组件_公共弹窗_新/按钮_关闭`）' })
    closeButton: Node = null;

    @property({ type: Node, tooltip: '「领取」按钮（FGUI `按钮_领取`，`颜色=1` 橙底）' })
    claimButton: Node = null;

    @property({ type: ProgressBar, tooltip: '征收进度条（FGUI `征收_进度`）' })
    progressBar: ProgressBar = null;

    @property({ type: Label, tooltip: '已征收时长 `08:00:00`（FGUI `time`）' })
    timeLabel: Label = null;

    @property({ type: Node, tooltip: '`MAX` 角标（FGUI `maxImg`，只在到顶时显示）' })
    maxBadge: Node = null;

    @property({ type: HangGainItem, tooltip: '收益条 1（吃 `mergedRewards[0]`）' })
    gain1: HangGainItem = null;

    @property({ type: HangGainItem, tooltip: '收益条 2（吃 `mergedRewards[1]`）' })
    gain2: HangGainItem = null;

    @property({ type: [HangRewardSlot], tooltip: '产出奖励网格的 6 个格子（顺序 = 网格顺序，多余隐藏）' })
    rewardSlots: HangRewardSlot[] = [];

    @property({ type: HangSweepButton, tooltip: '「快速征收」按钮' })
    sweepButton: HangSweepButton = null;

    @property({ type: Label, tooltip: '广告次数行（`今日剩余(3/3)` / `今日看广告次数:5/5` / `无限征收`）' })
    adCountLabel: Label = null;

    @property({ type: HangGearSwitch, tooltip: '倍率切换角标（FGUI `change_btn`）' })
    gearSwitch: HangGearSwitch = null;

    @property({ type: Node, tooltip: '月卡销售条（FGUI 组 `n74`，无月卡时显示）' })
    monthCardBar: Node = null;

    @property({ type: Node, tooltip: '月卡入口图标（FGUI `taskBtn`，点它进月卡礼包页）' })
    monthCardEntry: Node = null;

    @property({ type: Node, tooltip: '月卡购买按钮（FGUI `月卡_按钮`）' })
    monthCardBuy: Node = null;

    @property({ type: Label, tooltip: '月卡价格 `￥30`（FGUI `月卡_按钮/title`）' })
    monthCardPriceLabel: Label = null;

    // ---------------- 运行态 ----------------

    /** 当前快照（`load()` 的产物）。 */
    private _snapshot: IHangSnapshot | null = null;

    /** 当前倍率档下标（无月卡恒 `HJ_DEFAULT_GEAR_INDEX`）。 */
    private _gearIndex: number = HJ_DEFAULT_GEAR_INDEX;

    /** 挂机起点（毫秒）—— 老端 `refreshLastTime()` 的 `startTime`。 */
    private _startMs: number = 0;

    /** 上一次 `MAX` 态（用于「只在翻转时写 `active`」，避免每帧写节点）。 */
    private _atMax = false;

    /** 上一次点快速征收的时间（500ms 防抖）。 */
    private _lastSweepMs = 0;

    /** 正在跑请求（防重入）。 */
    private _busy = false;

    /**
     * `CmdRole` 缓存更新的退订函数（`onOpen` 订阅、`onClose` 退订）。
     *
     * `sweepTimes` 没有查询协议、扫荡回包也不带次数 ⇒ 这是 AdCountText 唯一的实时刷新源。
     */
    private _unsubscribeRole: (() => void) | null = null;

    /** 图片缓存（`resources.load` 结果；`null` = 加载失败，别反复重试）。 */
    private readonly _frames = new Map<string, SpriteFrame | null>();

    /**
     * 产出奖励的**占城数据源**：`levelInfo.idleReward`（已通关最高关卡的配置）。
     *
     * `null` = 还没收到领地渲染（活动 / 军团跳转直接开弹窗、主城 Controller 不在），
     * 这时回落到老表 `guankaReward.idleRewards`（`snapshot.mergedRewards`）。
     */
    private _territoryRewards: readonly IHjReward[] | null = null;

    /** 上一次铺的 resId 串（Render 每秒可能来一次，列表没变就不重铺）。 */
    private _territoryRewardKey = '';

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        // ⚠️ 监听一律挂在**节点**上（`cc.Button` 的 click 就是 node.emit 出来的，
        //    所以监听节点与监听组件等价）；弹窗预制体里这几个按钮存的都是节点。
        this.closeButton?.on(Button.EventType.CLICK, this._onTapClose, this);
        this.claimButton?.on(Button.EventType.CLICK, this._onTapClaim, this);
        // 🔴 月卡入口**不能**用 `Button.EventType.CLICK`：它在 FGUI 原稿里是
        //    `<loader id="n77_" name="taskBtn" ...>`（**不是按钮**），迁过来只有 `cc.Sprite`、
        //    **没有 `cc.Button`** ⇒ `Button.EventType.CLICK` 永远不会被 emit，点了毫无反应、
        //    且不报任何错（本模块踩过一次：探针 `真点月卡入口` 一直是 `mcFound:false`）。
        //    老端也是手动开的触摸：`taskBtn.touchable = true; taskBtn.setClick(this.onClickMonthCard, this);`
        //    ⇒ 这里改成节点级触摸事件（会走引擎的命中检测：按下在外、松手在外都不会触发）。
        //    ⚠️ 别想着「顺手加个 `cc.Button`」—— 那要改 prefab，而 FGUI 的 loader 本来就没有
        //    按钮的缩放反馈，加了反而多一个老端没有的表现。
        this.monthCardEntry?.on(Node.EventType.TOUCH_END, this._onTapMonthCard, this);
        this.monthCardBuy?.on(Button.EventType.CLICK, this._onTapMonthCard, this);
        this.sweepButton?.bindTap(() => { this._onTapSweep(); });
        this.gearSwitch?.bindTap(() => this._onTapGear());
        // 领奖 / 扫荡的回包由领地 Controller 发 `rewards` 命令 ⇒ 收到后重读服务端起点。
        EventMgr.instance.on(TerritoryViewEvent.Command, this._onTerritoryCommand, this);
        // 产出奖励格的真正数据源是 `levelInfo.idleReward`（随领地状态变化）。
        EventMgr.instance.on(TerritoryViewEvent.Render, this._onTerritoryRender, this);
    }

    protected async onOpen(): Promise<void> {
        // 🔴 `CmdRole` 没有查询协议、扫荡回包（`CmdCityChapterSweepRspMsg`）也不带次数
        //    ⇒ `sweepTimes` 只在服务端推 `cmdCaches` 时变。订阅它，AdCountText / 免费角标
        //    才能实时跟上；只靠「打开弹窗读一次」会在扫荡后一直显示旧值（看着就像字段没接）。
        //    订阅放 `onOpen` 而不是 `onInit`：弹窗可能被复用（`cache=true`），
        //    `onInit` 只跑一次，`onClose` 退订后再次打开就漏订阅了。
        this._unsubscribeRole?.();
        this._unsubscribeRole = subscribeRoleChange(this, () => { this._refreshRoleState(); });
        // 借 Ready 让领地 Controller 重发一帧渲染：产出奖励格的数据源（`levelInfo.idleReward`）
        // 只在 Render 里给，而弹窗常常在主城渲染完之后才打开。`onReady` 就是一次幂等 publish。
        EventMgr.instance.emit(TerritoryUiEvent.Ready);
        await this.reload();
    }

    protected onClose(): void {
        this.unscheduleAllCallbacks();
        // 缓存订阅按 caller 一次摘干净（`removeEventCaller` 内部 `peekCache`，
        // 缓存还没建也不会抛）—— 不清会和下一次打开的弹窗实例抢同一份回调。
        this._unsubscribeRole?.();
        this._unsubscribeRole = null;
        EventMgr.instance.offTarget(this);
    }

    // 空白关闭：**不覆写** `canCloseOnBlank()` —— 老端 `LayerHangUI.init()` 里
    // `this.enableBlackClick()` 明确开了「点黑底关闭」，prefab 的 `closeOnBlank` 也是 `true`
    // （与礼包 / 邮件 / 活动 / 七日 同一个口径）。曾经在这里返回 false，属于与老端不符，
    // 已删；要改成不关请同时改 prefab 的属性，别只在代码里拦（两处打架会让人查半天）。

    // ============================================================
    // 刷新
    // ============================================================

    /** 重读一次数据并把整屏铺一遍。 */
    async reload(): Promise<void> {
        const snapshot = await hangRepository.load();
        this._snapshot = snapshot;
        // 老端 refreshLastTime()：`lastIdleRewardTime || now` —— 起点为 0 时退到「现在」，
        // 否则进度条会从 1970 年算起（`elapsed` 溢出成 8h 满格）。
        //
        // 🔴 占城接入后（2026-11-09）：**服务端 `ChapterInfo.idleTime` 优先**。
        // 它是账号级、登录后拉一次 + Bro 覆盖的唯一权威起点；`CmdRole.lastIdleRewardTime`
        // 是旧主线挂机那套，与领地征收不是一条账。
        const start = snapshot.role ? snapshot.role.lastIdleRewardTimeMs : 0;
        this._startMs = this._serverIdleStartMs() ?? (start > 0 ? start : Date.now());
        // ⚠️ 2026-11-11 起**不再**「无月卡就把倍率复位到 1 倍」（老端 `refreshGearBtn` 的做法）。
        //    协议新增 `times` 后倍率对所有玩家开放（山猫口径）；每次 reload 都复位会把档位
        //    抹回 x1 —— 表现就是「点了 GearSwitch 角标闪一下又变回来、请求永远 1 倍」。
        //    越界兜底在 `sweepTimesOf`，这里刻意不动 `_gearIndex`。

        await this._preloadFrames(snapshot);
        this._renderGains(snapshot);
        this._renderRewards(snapshot);
        this._renderMonthCard(snapshot);
        // ⚠️ 这里**不要**预置 `_atMax = false`。`_refreshTime()` 是无条件写节点的，
        //    预置只会让「面板刚打开时角标是亮的」这个现象看起来像被修过（其实靠的是下一句）。
        this._refreshTime();
        this._refreshButtons();
        // ⚠️ 必须排在 `_renderMonthCard()`（决定月卡条显隐）之后 —— 居中量随月卡条显隐变。
        this._fitContentCenter();
        this._restartTimer();
    }

    /** 每秒一跳：只动进度条 + 时间 + `MAX`（到顶就停表，与老端 `refreshTime` 一致）。 */
    private _tick(): void {
        this._refreshTime();
        if (this._atMax) this.unschedule(this._tick);
    }

    private _restartTimer(): void {
        this.unschedule(this._tick);
        if (!this._atMax) this.schedule(this._tick, TICK_SECONDS);
    }

    /** 已挂机时长（毫秒，未钳）—— 用**当前时间**，不能用快照里的 `now`（那是死值）。 */
    private _elapsed(): number {
        return idleElapsedMs(this._startMs, Date.now());
    }

    /**
     * 服务端章节级挂机起点（毫秒）；没拉到返回 `null`。
     *
     * 真源 `TerritoryChapterInfoRepository.instance.current.idleTime`（秒）——
     * 账号级单例，登录后拉一次，服务端 `CmdCityChapterInfoBroMsg` 会整包覆盖。
     */
    private _serverIdleStartMs(): number | null {
        const seconds = TerritoryChapterInfoRepository.instance.current?.idleTime;
        return seconds && seconds > 0 ? seconds * 1000 : null;
    }

    /**
     * 领地 Controller 的命令：收到 `rewards`（领奖 / 扫荡的实际发放）就重读服务端状态。
     *
     * 🔴 必须重读，不能本地 `_startMs = Date.now()`：服务端 `idleTime` 是**秒级时间戳**，
     * 且按整小时结余（领完还会留零头），本地「从现在重新计时」会与下一次结算错位。
     * 只有快照真的变了才动 —— 扫荡不一定重置挂机起点。
     *
     * 🔴 同一处还要重读 `CmdRole`：**扫荡回包 `CmdCityChapterSweepRspMsg` 只有 `succ` +
     * `tlCmdGoods`，根本没有次数**。`sweepTimes` 靠服务端更新 `CmdRole` 后推 `cmdCaches`，
     * 客户端不重读就只能一直显示打开弹窗那一刻的旧值（症状 =「次数接了但看着没接」）。
     */
    private _onTerritoryCommand(event: ITerritoryCommandEvent): void {
        if (event.command.kind !== 'rewards') return;
        const next = this._serverIdleStartMs();
        if (next !== null && next !== this._startMs) {
            this._startMs = next;
            this._refreshTime();
            this._restartTimer();
        }
        this._refreshRoleState();
    }

    /**
     * 重读 `CmdRole`（`sweepTimes` / `lastIdleRewardTime`）并刷新按钮区。
     *
     * ⚠️ 读不到（离线 / 缓存没推）就**保留旧值直接返回** —— 不能把 `sweepTimes` 当成 0 写回去，
     * 那会让「今日剩余」瞬移回满、免费角标重新亮起来，比不刷新更糟。
     */
    private _refreshRoleState(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        const role = readRoleState();
        if (!role) return;
        const prev = snapshot.role;
        if (prev && prev.sweepTimes === role.sweepTimes
            && prev.lastIdleRewardTimeMs === role.lastIdleRewardTimeMs) return;
        this._snapshot = { ...snapshot, role };
        this._refreshButtons();
    }

    /**
     * 领地渲染：用「已通关的最高关卡格」那一关的 `levelInfo.idleReward` 铺产出奖励区。
     *
     * 🔴 口径与扫荡目标**同源**（`findHighestPassedTerritoryLevel`）：
     * 展示的每小时产出就是征收 / 扫荡按的那一关，不用「下一关」，也不用老主线表
     * `guankaReward.idleRewards`（那是主线挂机，和占城不是一条账）。
     *
     * 一格都没通关 / 还没收到 Render ⇒ 保持 `null`（回落老表），否则产出区会整块空掉。
     */
    private _onTerritoryRender(event: ITerritoryRenderEvent): void {
        const { map, progress, stageByCell } = event.state;
        if (!map || !progress) return;
        const target = findHighestPassedTerritoryLevel(map.sites, stageByCell, progress);
        if (!target) return;
        const next: IHjReward[] = target.stage.idleRewards
            .filter((reward) => reward.probability > 0 && reward.amount > 0)
            .map((reward) => ({ resId: reward.resId, number: Math.floor(reward.amount) }));
        if (!next.length) return;
        // Render 可能每秒来一次：列表没变就不重铺（重铺会重建图标请求）
        const key = next.map((reward) => reward.resId).join(',');
        if (key === this._territoryRewardKey) return;
        this._territoryRewardKey = key;
        this._territoryRewards = next;
        const snapshot = this._snapshot;
        if (!snapshot) return;
        // 先补图再铺格：漏加载会静默留白（`_iconFrameOf` 拿不到就返回 null）
        void this._preloadFrames(snapshot).then(() => {
            const current = this._snapshot;
            if (!current) return;
            this._renderGains(current);
            this._renderRewards(current);
        });
    }

    /** 产出奖励区（收益条 + 6 格）的数据源：占城 `levelInfo.idleReward` 优先，回落老表。 */
    private _displayRewards(snapshot: IHangSnapshot): readonly IHjReward[] {
        return this._territoryRewards ?? snapshot.mergedRewards;
    }

    /**
     * 进度条 / 时间文案 / `MAX` 角标。
     *
     * 🔴 `maxBadge.active` **必须无条件写**（哪怕值没变），不能写成「只在翻转时写」——
     * 这是本模块踩过的坑：prefab 里 `MaxBadge._active` 烘的是 **`true`**
     * （FGUI 原稿 `<image name="maxImg" …>` 没有 `visible="false"` ⇒ 默认可见），
     * 而首次 `_refreshTime()` 时 `atMax === _atMax === false` ⇒ 「只在翻转时写」会**短路不写**，
     * 于是刚打开面板 MAX 角标就一直亮着（探针实测 `maxBadgeActive === true` / `timeText = 00:00:02`）。
     * 老端 `LayerHang.refreshTime()` 是**每秒无条件** `tm("maxImg").visible = true/false`。
     * 代价可以忽略：`cc.Node.active` 的 setter 自己会 `if (this._active !== value)` 早退。
     */
    private _refreshTime(): void {
        const elapsed = this._elapsed();
        const capped = idleCappedMs(elapsed);
        if (this.progressBar) this.progressBar.progress = idleProgress01(elapsed);
        if (this.timeLabel) this.timeLabel.string = formatHms(capped);
        const atMax = idleReachedMax(elapsed);
        this._atMax = atMax;
        if (this.maxBadge) this.maxBadge.active = atMax;
    }

    /** 收益条 / 奖励格 / 按钮文案 —— 只跟「数据 + 档位」有关，不跟心跳。 */
    private _refreshButtons(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        const times = sweepTimesOf(this._gearIndex);
        this.sweepButton?.renderCost(costTextOf(snapshot, this._gearIndex));
        // `免费 = 是`（page 1）才是「还有免费次数」—— 语义反直觉，别写反
        this.sweepButton?.renderFree(freePageOf(snapshot) === 1);
        // 红点：FGUI `com_rd` 默认可见、但老端从头到尾没接管它，用户截图里也没有
        // ⇒ 默认隐藏，留给后面的红点系统接（`renderRedDot` 已经留好口子）。
        this.sweepButton?.renderRedDot(false);
        this.sweepButton?.renderCostIcon(this._frameOf(HJ_COST_ICON_PATH));
        this.gearSwitch?.render(gearLabel(times));
        if (this.adCountLabel) {
            this.adCountLabel.string = adCountTextOf(snapshot, snapshot.adRest, snapshot.adLimit);
        }
    }

    /** 收益条 1/2：`mergedRewards[0]` / `[1]` 的「图标 + `16/h`」。 */
    private _renderGains(snapshot: IHangSnapshot): void {
        const rewards = this._displayRewards(snapshot);
        const first = rewardAt(rewards, 0);
        const second = rewardAt(rewards, 1);
        this.gain1?.render(this._iconFrameOf(snapshot, first ? first.resId : 0), perHourText(first));
        this.gain2?.render(this._iconFrameOf(snapshot, second ? second.resId : 0), perHourText(second));
    }

    /**
     * 奖励网格：`mergedRewards` 有几条铺几格，多余的格子**隐藏**。
     *
     * ⚠️ 条数口径（容易记反，两侧都别看错）：老端 `_mergeTaxRewards` 是
     * `baseRewards.map(...)` **原样拷贝** `idleRewards`，只把「互动建筑加成」按 resId 相加
     * ⇒ **列表条数 = `idleRewards.length`（表里 1432 行全是 6）**，其中第 3/4 条是同一个
     * `resId`（`10012`）。**去重后的唯一 resId 才是 5 个**。
     * 所以 6 格网格是**刚好铺满**的，不存在「第 6 格永远隐藏」——
     * 那句旧结论已被 1632 行全量统计推翻（分布 `{0: 200, 6: 1432}`）。
     * 「条数 ≤ 6」这个约束在单测里钉住，免得以后策划加第 7 条产出时静默丢格。
     */
    private _renderRewards(snapshot: IHangSnapshot): void {
        const rewards = this._displayRewards(snapshot);
        for (let i = 0; i < this.rewardSlots.length; i++) {
            const slot = this.rewardSlots[i];
            if (!slot) continue;
            const reward = rewardAt(rewards, i);
            if (!reward) {
                slot.hide();
                continue;
            }
            slot.render(
                this._frameOf(qualityFramePath(rewardQualityOf(snapshot, reward.resId))),
                this._iconFrameOf(snapshot, reward.resId),
            );
        }
    }

    /** 月卡销售条：无月卡 ⇒ 显示 + 铺价格。 */
    private _renderMonthCard(snapshot: IHangSnapshot): void {
        if (this.monthCardBar) this.monthCardBar.active = monthCardBarVisibleOf(snapshot);
        if (this.monthCardPriceLabel) this.monthCardPriceLabel.string = monthCardPriceTextOf(snapshot);
    }

    /**
     * 让内容块在屏幕上**竖直居中** —— 复刻老端 `com.toFullCenterParent(this.container)`
     * 配合 FGUI 组 `n78` 的 `relation center-center,middle-middle`。
     *
     * 老端是「组件铺满容器 + 组在组件里居中」⇒ 内容块恒居中于屏幕；新端弹窗根节点
     * 固定 720×1280（`PopupManager` 每次 open 把它摆到屏幕中心）⇒ 只要把内容块
     * **在根节点里**摆正中间，效果就等价。预览实测偏下 128，这里补回来。
     *
     * ⚠️ 三个坑：
     *   ① 必须排除运行时补的 `__BlankClose`（`PopupBase.ensureBlankCatcher`）——
     *      它是**全屏**的，算进包围盒会把整块撑成屏幕大小、偏移恒 0（看起来"没 bug"）；
     *   ② 只统计 `activeInHierarchy` 的节点 —— 月卡条（FGUI `n74`）无月卡才显示，
     *      它显隐直接改变内容块高度（1054 ↔ 903）⇒ 居中位移 128 ↔ 52.5；
     *   ③ 用「声明矩形」（`position + contentSize + anchorPoint`）而不是
     *      `getBoundingBoxToWorld()` —— 后者含标题横幅骑出底板的 28px，与老端差 14px
     *      （口径写在 `contentCenterOffsetY` 的注释里）。
     *
     * 这里改的是**弹窗根节点自己的位置**（`PopupManager` 只在 open 时设过一次
     * `setPosition(0,0,0)`，之后不会再动它），不是各子节点的坐标 ——
     * 静态坐标保持与 FGUI 设计稿一致，居中纯属运行时行为。
     */
    private _fitContentCenter(): void {
        const boxes: IHjLocalBox[] = [];
        for (const child of this.node.children) {
            if (child.name === POPUP_BLANK_CATCHER) continue;
            if (!child.activeInHierarchy) continue;
            const ui = child.getComponent(UITransform);
            if (!ui) continue;
            const h = ui.height;
            const pos = child.position;
            boxes.push({
                bottom: pos.y - h * ui.anchorPoint.y,
                top: pos.y + h * (1 - ui.anchorPoint.y),
            });
        }
        this.node.setPosition(0, -contentCenterOffsetY(boxes), 0);
    }

    // ============================================================
    // 点击
    // ============================================================

    private _onTapClose(): void {
        void this.close();
    }

    /**
     * 领取（`ClaimBtn`）：发意图给领地 Controller。
     *
     * 🔴 2026-11-09 起征收走占城协议 `CmdCityChapterIdleRewardReqMsg`，
     * 奖励由服务端 `tlCmdGoods` 决定、由 `MainTerritoryMap.presentRewards({ popup: true })`
     * 弹窗展示。本地不再判「满 1 小时」—— 结算口径在服务端，客户端拦一道只会
     * 把合法领取挡在门外（且服务端按整小时结算，前端判据必然对不齐）。
     */
    private _onTapClaim(): void {
        if (this._busy) return;
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'claimIdleRewards' } });
    }

    /**
     * 倍率切换（`GearSwitch`）：`1 → 5 → 10 → 20 → 50 → 1` 循环。
     *
     * ⚠️ 2026-11-11 口径变更：**不再拦月卡**。老端 `onClickChangeGear` 对非月卡玩家
     * 只弹「激活月卡后解锁功能」，但协议已加 `times` 字段、扣费在服务端，
     * 客户端再拦一道只会让「界面有角标但永远切不动」。
     */
    private _onTapGear(): void {
        if (!this._snapshot) return;
        this._gearIndex = nextGearIndex(this._gearIndex);
        this._refreshButtons();
    }

    /**
     * 扫荡（`SweepBtn`）：发意图给领地 Controller，走 `CmdCityChapterSweepReqMsg`。
     *
     * 老端那套「体力校验 / 免费次数 / 看广告换次数」全部下线 —— 它们是主线挂机
     * （`CmdBattleSweepReqMsg`）的规则，占城扫荡由服务端按章节格子扣，客户端只防连点。
     *
     * 🔴 `times` 必须随意图带上：它既是「请求倍率」，也是「服务端扣多少体力」的唯一依据。
     * 漏带 ⇒ 界面角标显示 x50、实际只扫 1 倍，且零报错（协议字段可缺省）。
     */
    private _onTapSweep(): void {
        const now = Date.now();
        if (this._lastSweepMs > 0 && now - this._lastSweepMs < SWEEP_DEBOUNCE_MS) return;
        this._lastSweepMs = now;
        EventMgr.instance.emit(TerritoryUiEvent.Intent, {
            intent: { kind: 'sweepChapter', times: sweepTimesOf(this._gearIndex) },
        });
    }

    /** 月卡入口 / 购买键 —— 都进已移植的月卡礼包页（老端 `SystemId.MonthCardGift`）。 */
    private _onTapMonthCard(): void {
        void MonthCardGiftPage.open({});
    }

    // ============================================================
    // 图片
    // ============================================================

    /**
     * **预加载「界面会 `_setFrame()` 的每一处」**（规则 60 / 73 的合并口径）。
     *
     * 挂机界面会动态换图的只有三类：收益条图标 ×2、快速征收的体力图标、奖励格的
     * 图标 + 品质框。**按钮固定底图不在此列**（`fd_tab_off` / `fd_btn_gold` / 弹窗底板
     * 都是 prefab 里烘死的 `SpriteFrame` 引用，不走 `resources.load`）。
     */
    private async _preloadFrames(snapshot: IHangSnapshot): Promise<void> {
        const paths = new Set<string>([HJ_COST_ICON_PATH]);
        for (const reward of this._displayRewards(snapshot)) {
            const ref = rewardIconRefOf(snapshot, reward.resId);
            if (ref) paths.add(hjSharedPath(ref));
            paths.add(qualityFramePath(rewardQualityOf(snapshot, reward.resId)));
        }
        await Promise.all(Array.from(paths).map((p) => this._loadFrame(p)));
    }

    private _loadFrame(path: string): Promise<SpriteFrame | null> {
        if (this._frames.has(path)) return Promise.resolve(this._frames.get(path));
        return new Promise((resolve) => {
            // ⚠️ 必须带 `/spriteFrame`（规则 57）：裸路径会报
            //    `Bundle resources doesn't contain xxx`，且只是静默留白 + 一条 warn。
            routedLoad(path, SpriteFrame, (error, frame) => {
                if (error || !frame) {
                    console.warn('[Hang] 加载图失败', path, error);
                    this._frames.set(path, null);
                    resolve(null);
                    return;
                }
                this._frames.set(path, frame);
                resolve(frame);
            });
        });
    }

    private _frameOf(path: string): SpriteFrame | null {
        return this._frames.get(path) ?? null;
    }

    /** 一个奖励 `resId` 的图标帧（两支分流；解析不出返回 `null` ⇒ 那只画品质框）。 */
    private _iconFrameOf(snapshot: IHangSnapshot, resId: number): SpriteFrame | null {
        if (resId <= 0) return null;
        const goods = goodsOf(snapshot, resId);
        if (!goods || !goods.icon) return null;
        const ref = rewardIconRefOf(snapshot, resId);
        return ref ? this._frameOf(hjSharedPath(ref)) : null;
    }

}

/** `HJ_MAX_IDLE_MS` 的展示口径（给探针 / 单测读，避免两边各写一遍 8h）。 */
export const HJ_MAX_IDLE_TEXT = formatHms(HJ_MAX_IDLE_MS);
