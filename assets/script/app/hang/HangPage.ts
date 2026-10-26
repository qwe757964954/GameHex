import { _decorator, Button, Label, Node, ProgressBar, SpriteFrame, UITransform } from 'cc';
import { POPUP_BLANK_CATCHER, PopupBase } from '../../framework/ui/PopupBase';
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';
import { routedLoad } from '../common/RoutedResource';
import { MonthCardGiftPage } from '../monthcard/MonthCardGiftPage';
import { HJ_COST_ICON_PATH, hjSharedPath } from './HangArt';
import {
    HJ_DEFAULT_GEAR_INDEX,
    HJ_MAX_IDLE_MS,
    HJ_SWEEP_TYPE_CHAPTER,
    canClaim,
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
import type { IHjLocalBox } from './HangTable';
import { HJ_TEXTS, hjFormat } from './HangTexts';
import {
    HJ_AD_TYPE_SWEEP,
    adCountTextOf,
    costTextOf,
    freePageOf,
    goodsOf,
    hangRepository,
    monthCardBarVisibleOf,
    monthCardPriceTextOf,
    rewardIconRefOf,
    rewardQualityOf,
    timesOf,
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
 * ② **玩家持卡状态读不到**（`protoCache.json` 里没有月卡表）⇒ `hasUnlimited` 恒 `false`
 *    ⇒ 倍率恒 1、月卡条恒显示（这正是用户拍板的「无月卡默认分支」）。
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
    closeButton: Node = null!;

    @property({ type: Node, tooltip: '「领取」按钮（FGUI `按钮_领取`，`颜色=1` 橙底）' })
    claimButton: Node = null!;

    @property({ type: ProgressBar, tooltip: '征收进度条（FGUI `征收_进度`）' })
    progressBar: ProgressBar = null!;

    @property({ type: Label, tooltip: '已征收时长 `08:00:00`（FGUI `time`）' })
    timeLabel: Label = null!;

    @property({ type: Node, tooltip: '`MAX` 角标（FGUI `maxImg`，只在到顶时显示）' })
    maxBadge: Node = null!;

    @property({ type: HangGainItem, tooltip: '收益条 1（吃 `mergedRewards[0]`）' })
    gain1: HangGainItem = null!;

    @property({ type: HangGainItem, tooltip: '收益条 2（吃 `mergedRewards[1]`）' })
    gain2: HangGainItem = null!;

    @property({ type: [HangRewardSlot], tooltip: '产出奖励网格的 6 个格子（顺序 = 网格顺序，多余隐藏）' })
    rewardSlots: HangRewardSlot[] = [];

    @property({ type: HangSweepButton, tooltip: '「快速征收」按钮' })
    sweepButton: HangSweepButton = null!;

    @property({ type: Label, tooltip: '广告次数行（`今日剩余(3/3)` / `今日看广告次数:5/5` / `无限征收`）' })
    adCountLabel: Label = null!;

    @property({ type: HangGearSwitch, tooltip: '倍率切换角标（FGUI `change_btn`）' })
    gearSwitch: HangGearSwitch = null!;

    @property({ type: Node, tooltip: '月卡销售条（FGUI 组 `n74`，无月卡时显示）' })
    monthCardBar: Node = null!;

    @property({ type: Node, tooltip: '月卡入口图标（FGUI `taskBtn`，点它进月卡礼包页）' })
    monthCardEntry: Node = null!;

    @property({ type: Node, tooltip: '月卡购买按钮（FGUI `月卡_按钮`）' })
    monthCardBuy: Node = null!;

    @property({ type: Label, tooltip: '月卡价格 `￥30`（FGUI `月卡_按钮/title`）' })
    monthCardPriceLabel: Label = null!;

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

    /** 图片缓存（`resources.load` 结果；`null` = 加载失败，别反复重试）。 */
    private readonly _frames = new Map<string, SpriteFrame | null>();

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
        this.sweepButton?.bindTap(() => { void this._onTapSweep(); });
        this.gearSwitch?.bindTap(() => this._onTapGear());
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.unscheduleAllCallbacks();
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
        const start = snapshot.role ? snapshot.role.lastIdleRewardTimeMs : 0;
        this._startMs = start > 0 ? start : Date.now();
        // 无月卡 ⇒ 倍率复位（老端 refreshGearBtn：不复位的话「刚点到 50 倍月卡就到期」
        // 的玩家下一次快速征收会按 50 倍扣体力）。
        if (!snapshot.hasUnlimited) this._gearIndex = HJ_DEFAULT_GEAR_INDEX;

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

        const times = timesOf(snapshot, this._gearIndex);
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
        const first = rewardAt(snapshot.mergedRewards, 0);
        const second = rewardAt(snapshot.mergedRewards, 1);
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
        for (let i = 0; i < this.rewardSlots.length; i++) {
            const slot = this.rewardSlots[i];
            if (!slot) continue;
            const reward = rewardAt(snapshot.mergedRewards, i);
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

    /** 领取：不足 1 小时只提示（老端 `onClickReceive`）。 */
    private _onTapClaim(): void {
        if (this._busy) return;
        if (!canClaim(this._elapsed())) {
            FW.showTip(HJ_TEXTS.fullOneHour);
            return;
        }
        void this._claim();
    }

    private async _claim(): Promise<void> {
        this._busy = true;
        try {
            const result = await hangRepository.claimReward(this);
            if (result === 'offline') {
                FW.showTip(HJ_TEXTS.offlineTip);
                return;
            }
            if (result !== 'ok') {
                FW.showTip(HJ_TEXTS.failedTip);
                return;
            }
            FW.showTip(HJ_TEXTS.claimSuccess);
            // 老端 requestHangGetReward 由服务端推 `lastIdleRewardTime`；这里本地先复位起点，
            // 免得等推送到达之前进度条还停在满格。
            this._startMs = Date.now();
            await this.reload();
        } finally {
            this._busy = false;
        }
    }

    /** 倍率切换：非月卡只提示（老端 `onClickChangeGear`）。 */
    private _onTapGear(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        if (!snapshot.hasUnlimited) {
            FW.showTip(HJ_TEXTS.monthCardLockTip);
            return;
        }
        this._gearIndex = nextGearIndex(this._gearIndex);
        this._refreshButtons();
    }

    /**
     * 快速征收。
     *
     * 与老端 `onClickLevy` 逐步对齐：
     * ① 500ms 防抖；② 体力校验（`sweepEnd × times`）；③ 免费次数用完且还有广告次数
     * ⇒ 弹「看广告」二次确认（**这一支不继续扫荡**，等玩家点「立即观看」）。
     */
    private async _onTapSweep(): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot || this._busy) return;

        const now = Date.now();
        if (this._lastSweepMs > 0 && now - this._lastSweepMs < SWEEP_DEBOUNCE_MS) return;
        this._lastSweepMs = now;

        if (snapshot.sweepLevel <= 0 || snapshot.sweepEnd <= 0) return;

        const times = timesOf(snapshot, this._gearIndex);
        // 体力校验：服务端按 `end × times` 扣，客户端同口径先拦一道
        // （老端 `CheckHaveEnoughCostAndOpenAlert` —— 体力不足时它自己会弹提示）
        if (!this._hasEnoughEnd(snapshot, snapshot.sweepEnd * times)) {
            FW.showTip(HJ_TEXTS.failedTip);
            return;
        }

        const used = snapshot.role ? snapshot.role.sweepTimes : 0;
        if (!snapshot.hasUnlimited && used >= snapshot.sweepFreeTimes && snapshot.adRest > 0) {
            await this._confirmWatchAd(snapshot);
            return;
        }

        await this._doSweep();
    }

    /** 弹「免费次数用完，看广告 +1 次」二次确认（老端 `GObjChapterSelect_1`）。 */
    private async _confirmWatchAd(snapshot: IHangSnapshot): Promise<void> {
        await CommonTips.open({
            userData: {
                content: hjFormat(HJ_TEXTS.adConfirmContent, snapshot.adRest, snapshot.adLimit),
                sureText: HJ_TEXTS.adConfirmWatch,
                onSure: () => { void this._watchAdThenSweep(); },
            },
        });
    }

    /** 「立即观看」：放广告 → 记一次 → 再扫荡。SDK 没接时只提示（见 `HJ_AD_PLAYBACK_AVAILABLE`）。 */
    private async _watchAdThenSweep(): Promise<void> {
        if (!HJ_AD_PLAYBACK_AVAILABLE) {
            FW.showTip(HJ_TEXTS.adUnavailable);
            return;
        }
        const result = await hangRepository.watchAd(HJ_AD_TYPE_SWEEP, this);
        if (result !== 'ok') {
            FW.showTip(result === 'offline' ? HJ_TEXTS.offlineTip : HJ_TEXTS.failedTip);
            return;
        }
        await this._doSweep();
    }

    private async _doSweep(): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        this._busy = true;
        try {
            const result = await hangRepository.sweep(snapshot.sweepLevel, HJ_SWEEP_TYPE_CHAPTER, this);
            if (result === 'offline') {
                FW.showTip(HJ_TEXTS.offlineTip);
                return;
            }
            if (result !== 'ok') {
                FW.showTip(HJ_TEXTS.failedTip);
                return;
            }
            // 老端 onClickLevy 成功后就 refreshLastTime()（挂机重新从 0 计）
            this._startMs = Date.now();
            await this.reload();
        } finally {
            this._busy = false;
        }
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
        for (const reward of snapshot.mergedRewards) {
            const ref = rewardIconRefOf(snapshot, reward.resId);
            if (ref) paths.add(hjSharedPath(ref));
            paths.add(qualityFramePath(rewardQualityOf(snapshot, reward.resId)));
        }
        await Promise.all(Array.from(paths).map((p) => this._loadFrame(p)));
    }

    private _loadFrame(path: string): Promise<SpriteFrame | null> {
        if (this._frames.has(path)) return Promise.resolve(this._frames.get(path)!);
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

    // ============================================================
    // 体力校验
    // ============================================================

    /**
     * 体力够不够（老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert` 的判定那一半）。
     *
     * ⚠️ 新工程没有「背包持有量」读层（`CacheMgr` 里没有 `CmdGoods` 缓存入口）⇒ 这里
     * **读不到就放行**（`true`），把把关交给服务端。老端那套会顺带弹「体力不足」的引导框，
     * 本轮不接（要跳购买页）。宁可让服务端拒一次，也别在客户端把能点的人拦在外面。
     */
    private _hasEnoughEnd(_snapshot: IHangSnapshot, _cost: number): boolean {
        return true;
    }
}

/** `HJ_MAX_IDLE_MS` 的展示口径（给探针 / 单测读，避免两边各写一遍 8h）。 */
export const HJ_MAX_IDLE_TEXT = formatHms(HJ_MAX_IDLE_MS);
