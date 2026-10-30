import { _decorator, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { routedLoad } from '../common/RoutedResource';
import {
    BT_QUALITY_FRAME_NAMES,
    BT_QUALITY_FRAME_ROOT,
    BT_SHARED_CHECK,
    BT_SHARED_LOCK_MASK,
    btPageArtPath,
    btSharedPath,
    qualityFrameName,
    qualityFramePath,
    resolveRewardIconRef,
} from './BattleTokenArt';
import {
    BT_DEFAULT_TYPE,
    BT_EXP_COST_RES_ID,
    BT_TABS,
    BT_TYPE_END,
    BT_TYPE_LEVEL_FUND,
    artKeyOf,
    battleTokenTabRdExpr,
    buyButtonPos,
    countdownText,
    expMaxOf,
    hintBoxOf,
    isSupportedTab,
    isThreePlan,
    pageHintOf,
    plansOfType,
    priceOf,
    qipaoBoxOf,
    scrollTargetIndex,
} from './BattleTokenTable';
import type { ILevelRow, IPlanRow } from './BattleTokenTable';
import {
    battleTokenRepository,
    goodsOf,
    levelUpCostOf,
    maxLevelOf,
    payRmbOf,
    rowsOf,
    stateOf,
} from './BattleTokenRepository';
import type { IBattleTokenSnapshot, IPlanState, ITokenState } from './BattleTokenRepository';
import { BT_TEXTS, btMoneyText } from './BattleTokenTexts';
import { BattleTokenBuyButton } from './BattleTokenBuyButton';
import { BattleTokenProgressBar } from './BattleTokenProgressBar';
import { BattleTokenRow } from './BattleTokenRow';
import type { IRowContext } from './BattleTokenRow';
import { TabButton } from '../common/TabButton';

const { ccclass, property } = _decorator;

/** 倒计时刷新间隔（秒）。 */
const TICK_SECONDS = 1;
const DESIGN_HEIGHT = 1280;
const PANEL_BASE_HEIGHT = 740;
const LIST_BASE_HEIGHT = 580;

/**
 * 战令主控 —— 挂在 `assets/resources/ui/BattleToken/BattleToken.prefab` 的根节点上。
 *
 * ## 一个 prefab 装下「外壳 + 内容」
 *
 * 老端是**两个** FGUI 组件叠在一起：
 *   - `组件_战令`（`LayerBattleToken`，`sortingOrder = 1`）—— 底栏：返回 + 4 个页签 + 背影
 *   - `组件_超值战令`（`TabBattleTokenPage`）—— 内容页：页头三图 + 提示 + 购买行 + 列表 + 经验条
 *
 * 移植时合成**一个 prefab 的两个子树**（`PageRoot` 排在前、底栏排在后 ⇒ 底栏盖在内容上，
 * 与老端 `sortingOrder = 1` 等效）。4 个页签共用**同一份**内容节点，切页只换图 / 换数据，
 * 与老端「一个 `TabBattleTokenPage` 实例被 4 个 tab 复用」完全一致。
 *
 * ## ⚠️ 底栏 4 个页签 = 工程共用的 `ui/common/TabButton.prefab`
 *
 * 2026-09-28 起，底栏不再用战令私有脚本：`TabBar` 的四个子节点换成**共用页签组件**
 * `TabButton`（与主界面底栏六格是同一个 prefab，依据见 `TabButton.ts` 的文件头 ——
 * 老端 `按钮_首页_菜单.xml` 本来就同时被这两处引用）。
 *
 * 差异只在实例参数里，不在代码里：
 * | 参数 | 战令四格 | 主界面六格 |
 * |---|---|---|
 * | `tabType` | `CmdBattleTokenType`（1/2/3/4） | 0 |
 * | `iconRaiseY` | 26（选中时图标上浮） | 0 |
 * | `offIcon` / `onIcon` | `ui/Gift/art/<artKey>_1` / `<artKey>` | 运行时 `setIconFrame` |
 *
 * ⚠️ **`iconRaiseY = 26` 而不是 36**：Icon 节点是「底边对齐」（锚点 `(0.5,0)`，老端 FGUI
 * 的 loader 本来就是 `pivot="0.5,1"`）。选中时字号 80 的图换成 100 的图，**底边**从
 * −42.5 抬到 −16.5 ⇒ 位移 26；若按「中心位移」写就会多抬 5px（图变高带来的 10/2）。
 *
 * ## ⚠️ 页头三张图是**按页签换图**，不是 4 套节点
 *
 * FGUI 用三处 `gearIcon controller="标签"` 在 4 张图之间切：
 *   - `img_header`（353×357 @ 20,29）→ 角色立绘 `bt_<artKey>_hero`
 *   - `title_icon`（406×167 @ 314,32）→ 标题 logo `bt_<artKey>_title`
 *   - `n125`（720×484 @ 0,0）→ 页头背景 `bt_<artKey>_headbg`
 *
 * ⚠️ 立绘的**原图尺寸每个页签都不同**（txz 353×357 / ggl 303×391 / djjj 338×346 / qrdl 440×454），
 * 但 FGUI 里 `img_header` 的显示尺寸**恒为 353×357**（`align="center" vAlign="middle" fill="scale"`）
 * ⇒ 换图时**只换帧、不改节点尺寸**，否则各页人物大小不一致。
 *
 * ## ⚠️ 只有通行证（`type = 1`）有经验条和「已消耗」
 *
 * FGUI 里 `progress` / `costIcon` / `文本_消耗` / `n138`（已消耗：）四处都挂
 * `gearDisplay controller="标签" pages="1"` ⇒ **只在通行证页显示**。
 *
 * ## ⚠️ 列表有两个（不是一套节点改格子数）
 *
 * FGUI 本身就是两个 `list`：`list`（3 格，`gearDisplay pages="1"` = 「个数=三个」）与
 * `list2`（2 格，`pages="0"`）—— 底板图（`zhanl3` / `zhanl1`）与格位 `xy` 都不同。
 * 移植照抄成两个 `VirtualScrollView` + 两个模板 prefab，按 `isThreePlan(type)` 显隐。
 */
@ccclass('BattleTokenPage')
export class BattleTokenPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/BattleToken/`，B 与 T 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/battletoken/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/BattleToken/BattleToken';

    // ---------------- 底栏 ----------------
    @property({ type: Node, tooltip: '返回按钮（FGUI 按钮_返回）' })
    backButton: Node = null;

    @property({ type: Node, tooltip: '内容页根（长屏时贴顶）' })
    pageRoot: Node = null;

    @property({ type: Node, tooltip: '中间面板底（长屏时随列表向下拉伸）' })
    panelBg: Node = null;

    @property({ type: Node, tooltip: '底栏底图（长屏时贴底）' })
    bottomBar: Node = null;

    @property({ type: Node, tooltip: '底部页签容器（长屏时贴底）' })
    tabBar: Node = null;

    // ---------------- 页头 ----------------
    @property({ type: Sprite, tooltip: '页头背景（720×484，按页签换帧）' })
    headBg: Sprite = null;

    @property({ type: Sprite, tooltip: '角色立绘（显示尺寸恒 353×357）' })
    hero: Sprite = null;

    @property({ type: Sprite, tooltip: '标题 logo（406×167）' })
    titleIcon: Sprite = null;

    @property({ type: Node, tooltip: '标题条底板（FGUI n127，`pages="1,3,0"` ⇒ 等级基金不显示）' })
    titleBg: Node = null;

    @property({ type: Node, tooltip: '页头说明气泡（FGUI n141，七日登录比其他页宽 48）' })
    qipao: Node = null;

    @property({ type: Label, tooltip: '页头说明（FGUI n13，按页签换文案 + 换框尺寸）' })
    hintLabel: Label = null;

    @property({ type: Label, tooltip: '倒计时（FGUI 文本_倒计时）' })
    countdownLabel: Label = null;

    // ---------------- 通行证专有 ----------------
    @property({ type: Node, tooltip: '整块「经验条 + 已消耗」容器（只在通行证页显示）' })
    expGroup: Node = null;

    @property({ type: BattleTokenProgressBar, tooltip: '经验条（FGUI progress）' })
    expBar: BattleTokenProgressBar = null;

    @property({ type: Label, tooltip: '「已消耗：」（FGUI n138）' })
    consumedLabel: Label = null;

    @property({ type: Label, tooltip: '已消耗数值（FGUI 文本_消耗）' })
    consumedValue: Label = null;

    @property({ type: Sprite, tooltip: '消耗的道具图标（FGUI costIcon）' })
    costIcon: Sprite = null;

    // ---------------- 购买行 ----------------
    @property({ type: BattleTokenBuyButton, tooltip: '方案 1（免费 / 基础）' })
    plan1Btn: BattleTokenBuyButton = null;

    @property({ type: BattleTokenBuyButton, tooltip: '方案 2（只有通行证有第 3 个方案时才会出现）' })
    plan2Btn: BattleTokenBuyButton = null;

    @property({ type: BattleTokenBuyButton, tooltip: '方案 3（仅通行证）' })
    plan3Btn: BattleTokenBuyButton = null;

    // ---------------- 列表 ----------------
    @property({ type: VirtualScrollView, tooltip: '三方案列表（通行证用）' })
    list3: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: '两方案列表（其余 3 个页签用）' })
    list2: VirtualScrollView = null;

    // ---------------- 运行时 ----------------
    private _snapshot: IBattleTokenSnapshot | null = null;
    private _type = BT_DEFAULT_TYPE;
    private _rows: readonly ILevelRow[] = [];
    private _rowContext: IRowContext | null = null;
    private _frames = new Map<string, SpriteFrame>();
    private _listBound3 = false;
    private _listBound2 = false;
    private _tick = 0;
    private _busy = false;

    /**
     * 底栏 4 个页签 —— **运行时**从 `tabBar` 收集（见 `collectTabButtons`），不走 Inspector 数组。
     *
     * 4 个页签的语义由各自的 `tabType` 决定（`_applyTabSelection` 是相等比较、`_wireStatic`
     * 逐个按 `tabType` 接线），**与子节点顺序无关** ⇒ 不需要手工维护一份绑定数组。
     * 与 `MainTabHost` 收集六格 `TabButton` 是同一套做法。
     */
    private _tabButtons: readonly TabButton[] = [];

    protected onInit(): void {
        this._wireStatic();
    }

    /**
     * 每次打开：**重新**读一次缓存（`CacheMgr` 里的 `CmdBattleToken` 由服务端另推）——
     * 不在 `_snapshot` 上做跨次缓存的复用，否则关了再开还是上一轮的数据。
     */
    protected async onOpen(): Promise<void> {
        this._busy = false;
        this._snapshot = null;
        this._type = BT_DEFAULT_TYPE;
        this._applyScreenLayout();
        await this._loadAndShow(BT_DEFAULT_TYPE);
    }

    /**
     * 倒计时每秒走一格。
     *
     * ⚠️ 用 `update` 累加而不是 `schedule`：`schedule` 挂在组件上、节点被 `PopupManager`
     * 回收（`active = false`）时**不会自动停**（`onDisable` 才停），而 `update` 天然只在
     * 节点激活时跑 —— 少一条「关了还每秒刷一次」的时序坑。
     */
    protected update(deltaTime: number): void {
        if (!this._snapshot) return;
        this._tick += deltaTime;
        if (this._tick < TICK_SECONDS) return;
        this._tick = 0;
        this._applyCountdown();
    }

    protected onClose(): void {
        this._tick = 0;
        this._busy = false;
    }

    // ============================================================
    // 静态接线（只做一次）
    // ============================================================

    private _wireStatic(): void {
        if (this.backButton) {
            this.backButton.on(Node.EventType.TOUCH_END, this._onBack, this);
        }
        this._tabButtons = collectTabButtons(this.tabBar);
        for (const btn of this._tabButtons) {
            const type = btn.tabType;
            btn.bindSelect(() => { void this._loadAndShow(type); });
            // 页签红点：后端推送 → 变量标脏 → 表达式重算 → `RedDot.setRedDot`。
            // 组件自己持有绑定器并在 `onDestroy` 解绑，这里只喂表达式（与主界面六格同一条通路）。
            btn.bindRedDotExpr(battleTokenTabRdExpr(type));
        }
        if (this.consumedLabel) this.consumedLabel.string = BT_TEXTS.consumedLabel;
    }

    private _onBack = (): void => {
        // 老端走 `unload()` 卸 layer ⇒ 这里交给 `PopupManager` 统一出栈 / 回收（`PopupBase.closeByButton`）。
        this.closeByButton();
    };

    // ============================================================
    // 加载 + 切页
    // ============================================================

    private async _loadAndShow(type: number): Promise<void> {
        if (!isSupportedTab(type)) return;
        this._type = type;

        if (!this._snapshot) {
            this._snapshot = await battleTokenRepository.load();
            await this._preloadCommonFrames();
        }
        const snapshot = this._snapshot;

        this._applyTabSelection(type);
        this._applyHead(type);
        await this._rebuildList(snapshot, type);
        this._applyBuyRow(snapshot, type);
        this._applyCountdown();
    }

    /** 底栏选中态（4 个都写，规则 10）。 */
    private _applyTabSelection(type: number): void {
        for (const btn of this._tabButtons) {
            btn.setSelected(btn.tabType === type);
        }
    }

    /** 页头三图 + 提示 + 「通行证专有」的显隐。 */
    private _applyHead(type: number): void {
        const artKey = artKeyOf(type);
        this._setFrame(this.headBg, btPageArtPath(artKey, 'headbg'));
        this._setFrame(this.hero, btPageArtPath(artKey, 'hero'));
        this._setFrame(this.titleIcon, btPageArtPath(artKey, 'title'));

        // 说明文字：文案 + **框尺寸**都要按页签换（FGUI n13 的 `gearText` + `gearSize`）。
        // 七日登录那页的框是 `gearSize` 的 default `425,42`（比通行证的 230,71 宽而矮），
        // 不跟着改就会把「持续登录 每日领取丰厚奖励」折进 230 宽里 ⇒ 静默变两行 / 缩小字号。
        if (this.hintLabel) {
            this.hintLabel.string = pageHintOf(type);
            const box = hintBoxOf(type);
            this.hintLabel.node.getComponent(UITransform)?.setContentSize(box.w, box.h);
        }
        // 说明气泡：FGUI `n141` 的 `gearSize pages="1,3"` ⇒ 七日登录 378 宽、其余 330 宽；
        // 高度恒 195（`scale (1,0.6)` 在 prefab 上，**不要在这里改高度**）。
        if (this.qipao) {
            const box = qipaoBoxOf(type);
            this.qipao.getComponent(UITransform)?.setContentSize(box.w, box.h);
        }

        // FGUI `n127`（标题条）与 `文本_倒计时` 都挂 `gearDisplay controller="标签" pages="1,3,0"`
        // ⇒ 通行证(page 1) / 七日登录(3) / 过关令(0) 显示，**等级基金(2) 不显示**
        // （老端也刚好不给 levelFund 起定时器：`if (type != battleToken_levelFund) addTimer(...)`）。
        // ⚠️ 别按「通行证不显示」写 —— 那正好反了，而且不报错、只是少一条底 + 多一条倒计时。
        const showTitleBar = type !== BT_TYPE_LEVEL_FUND;
        if (this.titleBg) this.titleBg.active = showTitleBar;
        if (this.countdownLabel) this.countdownLabel.node.active = showTitleBar;

        // FGUI `progress` / `costIcon` / `文本_消耗` / `n138`（已消耗：）都是 `pages="1"` ⇒ 只在通行证
        if (this.expGroup) this.expGroup.active = type === BT_TYPE_END;
    }

    /** 通行证页的经验条 + 已消耗。 */
    private _applyHeadExp(state: ITokenState, maxLevel: number, levelUpCost: number): void {
        if (this._type !== BT_TYPE_END || !this._snapshot) return;
        const level = state.level;
        const exp = state.exp;
        // 满级时 `max` 换成写死的 1000（老端 `VOBattleToken.GetExpMax()`），由 `expMaxOf` 负责
        const expMax = expMaxOf(level, maxLevel, levelUpCost);
        // ⚠️ 条上的文案是 **`value/max`**：FGUI 那个进度条组件是
        //    `组件/进度条/进度条01_公用_数值.xml`，`<ProgressBar titleType="valueAndmax"/>`
        //    ⇒ `GProgressBar.update()` 自己写成 `value + "/" + max`（老端只设 value/max、不碰 title）。
        //    只写 `${exp}` 不报错，只是和 FGUI 显示的不一样。
        if (this.expBar) this.expBar.setProgress(exp, expMax, `${exp}/${expMax}`);
        if (this.consumedValue) this.consumedValue.string = `${exp}`;
        // 消耗图标：老端 `GetGoodsIconKeyByRefId(roleProperty.end)`，`end = 9`（体力）。
        // ⚠️ 这一张**不在奖励表里** ⇒ `_preloadCommonFrames` 必须显式带上（见那里的注释）。
        this._setFrame(this.costIcon, this._iconPathOf(BT_EXP_COST_RES_ID));
    }

    // ============================================================
    // 列表
    // ============================================================

    private async _rebuildList(snapshot: IBattleTokenSnapshot, type: number): Promise<void> {
        const three = isThreePlan(type);
        const state = stateOf(snapshot, type);
        const maxLevel = maxLevelOf(snapshot);
        const level = state.level;
        const rows = rowsOf(snapshot, type);

        // ⚠️ 先把这一趟的数据存进字段，**再 await 预加载**（规则 55：异步预加载若在本行之前
        //    `await`，`refreshList` 会读到上一帧 / 空的 `this.rows` ⇒ 一项都不加载）
        this._rows = rows;

        await this._preloadRowFrames(snapshot, rows, type);

        const plans = plansOfType(snapshot.plans, type);
        const opened: boolean[] = [];
        const taken: (readonly number[] | null)[] = [];
        for (const plan of plans) {
            const ps: IPlanState | null = state.planStates.get(plan.resId) ?? null;
            opened.push(!!ps?.open);
            taken.push(ps ? ps.takenLevels : null);
        }

        this._rowContext = {
            rows: this._rows,
            plans,
            level,
            opened,
            takenLevels: taken,
            qualityOf: (resId) => goodsOf(snapshot, resId)?.quality ?? 1,
            iconOf: (resId) => this._rewardIcon(resId),
            frameOf: (quality) => this._frames.get(qualityFrameName(quality)) ?? null,
            onTake: (order, index, resId) => { void this._takeReward(order, index, resId); },
        };

        // 两个列表都接上（显隐另算）—— 只挂一次回调（规则 55）
        if (this.list3) {
            this.list3.node.active = three;
            if (!this._listBound3) {
                this._listBound3 = true;
                this.list3.renderItemFn = (node, index) => this._renderRow(node, index);
            }
            if (three) this.list3.refreshList(this._rows as unknown[]);
        }
        if (this.list2) {
            this.list2.node.active = !three;
            if (!this._listBound2) {
                this._listBound2 = true;
                this.list2.renderItemFn = (node, index) => this._renderRow(node, index);
            }
            if (!three) this.list2.refreshList(this._rows as unknown[]);
        }

        this._applyHeadExp(state, maxLevel, levelUpCostOf(snapshot));
        this._scrollToClaim(rows, state, opened, taken, maxLevel);
    }

    /** 虚拟列表的行渲染（**每次现取 `this._rowContext`**，禁闭包捕获）。 */
    private _renderRow(node: Node, index: number): void {
        const view = node.getComponent(BattleTokenRow);
        if (!view || !this._rowContext) {
            node.active = false;
            return;
        }
        view.render(index, this._rowContext);
    }

    /** 滚到「当前可领取」那一行（老端 `UpdateList` 的 `scrollToView`）。 */
    private _scrollToClaim(
        rows: readonly ILevelRow[],
        state: ITokenState,
        opened: readonly boolean[],
        taken: readonly (readonly number[] | null)[],
        maxLevel: number,
    ): void {
        const list = isThreePlan(this._type) ? this.list3 : this.list2;
        if (!list || !rows.length) return;
        let claimLv = state.level;
        outer: for (const row of rows) {
            for (let i = 0; i < opened.length; i++) {
                if (!opened[i]) continue;
                if (!(state.level > row.index)) continue;
                const t = taken[i];
                if (t && !t.includes(row.index + 1)) { claimLv = row.index + 1; break outer; }
            }
        }
        const target = scrollTargetIndex(claimLv, Math.min(maxLevel, rows.length));
        const anyList = list as unknown as { scrollToIndex?: (i: number, animated?: boolean) => void };
        if (typeof anyList.scrollToIndex === 'function') anyList.scrollToIndex(target, false);
    }

    // ============================================================
    // 购买行
    // ============================================================

    private _applyBuyRow(snapshot: IBattleTokenSnapshot, type: number): void {
        const plans = plansOfType(snapshot.plans, type);
        const state = stateOf(snapshot, type);
        const three = isThreePlan(type);
        const btns = [this.plan1Btn, this.plan2Btn, this.plan3Btn];

        for (let i = 0; i < btns.length; i++) {
            const btn = btns[i];
            if (!btn) continue;
            const plan: IPlanRow | undefined = plans[i];
            const show = !!plan && (i < 2 || three);
            btn.node.active = show;
            if (!show || !plan) continue;

            // FGUI `gearXY controller="个数"` —— 两个方案与三个方案的 x 差 50px 左右，必须跟着摆
            const pos = buyButtonPos(three, i);
            if (pos) btn.node.setPosition(pos.x, pos.y, btn.node.position.z);

            const ps = state.planStates.get(plan.resId) ?? null;
            const unlocked = !!ps?.open;
            const price = priceOf(plan);
            // ⚠️ 红底的是**方案 2（`order 3` / Advanced）**，即下标 2 —— FGUI `按钮.方案2`
            //    挂 `controller="颜色,1"`；写成下标 1 会把「基础」画成红色、不报错。
            const red = i === 2;
            const iconFrame = price.kind === 'item'
                ? this._frameOrNull(this._iconPathOf(price.resId))
                : null;
            const text = price.kind === 'rmb'
                ? btMoneyText(payRmbOf(snapshot, price.rmb))
                : (price.kind === 'item' ? `${price.num}` : BT_TEXTS.freeTitle);

            btn.render(price.kind, text, iconFrame, unlocked, red);
            // 免费档在 FGUI 里是 `touchable="false"` 的展示条（老端也没给它 setClick）⇒ 不可点
            if (price.kind === 'free') {
                btn.bindBuy(null);
                if (btn.button) btn.button.interactable = false;
            } else {
                const payChannelId = price.kind === 'rmb' ? price.rmb : 0;
                btn.bindBuy(() => { void this._buy(plan.resId, payChannelId, unlocked); });
            }
        }
    }

    private async _buy(resId: number, payChannelId: number, alreadyOpen: boolean): Promise<void> {
        if (this._busy) return;
        if (alreadyOpen) {
            console.warn('[BattleToken]', BT_TEXTS.alreadyOpen);
            return;
        }
        this._busy = true;
        try {
            const result = await battleTokenRepository.openPlan(resId, payChannelId, this);
            if (result === 'rejected') {
                console.warn('[BattleToken]', BT_TEXTS.alreadyOpen);
            } else if (result === 'offline') {
                console.warn('[BattleToken]', BT_TEXTS.offlineTip);
            } else if (result === 'failed') {
                console.warn('[BattleToken]', BT_TEXTS.failedTip);
            }
            // 状态由服务端**另推** `CmdBattleToken`，重新读一次快照
            this._snapshot = null;
            await this._loadAndShow(this._type);
        } finally {
            this._busy = false;
        }
    }

    /**
     * 战令原稿是 720×1280，在 720×1555 一类长屏上如果整块居中，顶部和底部都会留空。
     * 这里保留原稿横向尺寸：页头贴顶、底栏贴底，额外高度全部给中间面板和列表。
     */
    private _applyScreenLayout(): void {
        const rootTransform = this.node.getComponent(UITransform);
        const parentTransform = this.node.parent?.getComponent(UITransform);
        const visibleHeight = Math.max(DESIGN_HEIGHT, parentTransform?.contentSize.height ?? DESIGN_HEIGHT);
        const extra = visibleHeight - DESIGN_HEIGHT;
        rootTransform?.setContentSize(rootTransform.contentSize.width, visibleHeight);

        if (this.pageRoot) this.pageRoot.setPosition(0, extra / 2, this.pageRoot.position.z);
        if (this.panelBg) {
            this.panelBg.getComponent(UITransform)?.setContentSize(720, PANEL_BASE_HEIGHT + extra);
            this.panelBg.setPosition(this.panelBg.position.x, -143 - extra / 2, this.panelBg.position.z);
        }
        for (const list of [this.list3, this.list2]) {
            list?.node.getComponent(UITransform)?.setContentSize(656, LIST_BASE_HEIGHT + extra);
        }

        const bottomOffset = -extra / 2;
        if (this.bottomBar) this.bottomBar.setPosition(this.bottomBar.position.x, -588 + bottomOffset, this.bottomBar.position.z);
        if (this.backButton) this.backButton.setPosition(this.backButton.position.x, -586.5 + bottomOffset, this.backButton.position.z);
        if (this.tabBar) this.tabBar.setPosition(this.tabBar.position.x, -584 + bottomOffset, this.tabBar.position.z);
    }

    private async _takeReward(order: number, index: number, resId: number): Promise<void> {
        if (this._busy || !this._snapshot) return;
        this._busy = true;
        try {
            const result = await battleTokenRepository.takeReward(this._type, resId, index + 1, this);
            if (result === 'offline') console.warn('[BattleToken]', BT_TEXTS.offlineTip);
            else if (result === 'failed') console.warn('[BattleToken]', BT_TEXTS.failedTip);
            this._snapshot = null;
            await this._loadAndShow(this._type);
        } finally {
            this._busy = false;
        }
    }

    // ============================================================
    // 倒计时
    // ============================================================

    private _applyCountdown(): void {
        if (!this.countdownLabel || !this._snapshot) return;
        const state = stateOf(this._snapshot, this._type);
        const nowSec = Math.floor(Date.now() / 1000);
        this.countdownLabel.string = countdownText(state.endSeconds, nowSec);
    }

    // ============================================================
    // 图（加载 + 缓存）
    // ============================================================

    /**
     * 页头 12 张 + 品质框 4 张 + 复用的 3 张（对勾 / 遮罩圆 / 底栏）+ 战令自有小件。
     *
     * ⚠️ **预加载集合 = 界面会 `_setFrame()` 的每一处**（规则 60 的同族）：`_setFrame` 只从
     * `this._frames` 里取帧，取不到就**静默跳过**（保留 prefab 上的空帧）。
     * 页头的「已消耗：」小图标（`BT_EXP_COST_RES_ID` = 体力 9）**不在任何 `row.resIds` 里**，
     * 早期只加载了奖励与按钮固定图 ⇒ 它永久留白（不报错、单测测不出，只有端到端探针能逮）。
     */
    private async _preloadCommonFrames(): Promise<void> {
        const paths: string[] = [];
        for (const tab of BT_TABS) {
            paths.push(btPageArtPath(tab.artKey, 'title'), btPageArtPath(tab.artKey, 'headbg'), btPageArtPath(tab.artKey, 'hero'));
        }
        for (const name of BT_QUALITY_FRAME_NAMES) paths.push(`${BT_QUALITY_FRAME_ROOT}/${name}/spriteFrame`);
        for (const path of [btSharedPath(BT_SHARED_CHECK), btSharedPath(BT_SHARED_LOCK_MASK), qualityFramePath(1)]) paths.push(path);
        const costPath = this._iconPathOf(BT_EXP_COST_RES_ID);
        if (costPath) paths.push(costPath);
        await Promise.all(paths.map((p) => this._loadFrame(p)));
    }

    /**
     * 本趟列表要用的图。
     *
     * ⚠️ **预加载集合 = 奖励 resId ∪ 按钮要用的固定图**（规则 60）：购买按钮左侧的货币 /
     * 道具图标**不在 `row.resIds` 里**（它来自 `battleTokenPlan.openCostItemResId`）——
     * 只传奖励会让那几个按钮**静默降级**成「只有数字没有图标」，单测测不出、只有端到端探针能逮。
     */
    private async _preloadRowFrames(
        snapshot: IBattleTokenSnapshot,
        rows: readonly ILevelRow[],
        type: number,
    ): Promise<void> {
        const paths = new Set<string>();
        for (const row of rows) {
            for (const resId of row.resIds) {
                const p = this._iconPathOf(resId);
                if (p) paths.add(p);
            }
        }
        for (const plan of plansOfType(snapshot.plans, type)) {
            const price = priceOf(plan);
            if (price.kind === 'item') {
                const p = this._iconPathOf(price.resId);
                if (p) paths.add(p);
            }
        }
        await Promise.all(Array.from(paths).map((p) => this._loadFrame(p)));
    }

    private _loadFrame(path: string): Promise<SpriteFrame | null> {
        if (this._frames.has(this._keyOf(path))) return Promise.resolve(this._frames.get(this._keyOf(path)));
        return new Promise((resolve) => {
            // ⚠️ 必须带 `/spriteFrame`（规则 57）：裸路径会报
            //    `Bundle resources doesn't contain xxx`，且只是静默留白 + 一条 warn。
            routedLoad(path, SpriteFrame, (error, frame) => {
                if (error || !frame) {
                    console.warn('[BattleToken] 加载图失败', path, error);
                    resolve(null);
                    return;
                }
                this._frames.set(this._keyOf(path), frame);
                resolve(frame);
            });
        });
    }

    private _keyOf(path: string): string {
        return path;
    }

    /** 一个奖励 `resId` 的图标装配路径（两支分流；解析不出返回 `null`）。 */
    private _iconPathOf(resId: number): string | null {
        if (!this._snapshot || resId <= 0) return null;
        const goods = goodsOf(this._snapshot, resId);
        if (!goods || !goods.icon) return null;
        // 复用活动的统一入口（`item` 直通 / `roleProperty` 落 `icons/resource`）
        const ref = resolveRewardIconRef(goods);
        return ref ? `${ref.root}/${ref.name}/spriteFrame` : null;
    }

    private _rewardIcon(resId: number): SpriteFrame | null {
        const path = this._iconPathOf(resId);
        return path ? this._frames.get(this._keyOf(path)) ?? null : null;
    }

    private _frameOrNull(path: string | null): SpriteFrame | null {
        return path ? this._frames.get(this._keyOf(path)) ?? null : null;
    }

    private _setFrame(sprite: Sprite | null, path: string | null): void {
        if (!sprite) return;
        const frame = this._frameOrNull(path);
        if (frame) sprite.spriteFrame = frame;
    }
}

/**
 * 底栏页签：从 `tabBar` 收集子 `TabButton`（工程共用的页签组件 `ui/common/TabButton.prefab`）。
 *
 * 为什么不走 `@property` 数组：`TabBar` 的子节点一改（换 prefab 源、增删页签），
 * Inspector 里的数组就变成**悬空引用**——界面照常打开、页签点不动、零报错。
 * 这里从**已绑定的** `tabBar` 现场收集，节点一改自动跟上。
 *
 * 取不到只打一条 warn（不许静默）：`tabBar` 没绑 / 子节点上没挂 `TabButton` 都会落到这里。
 */
function collectTabButtons(tabBar: Node | null): readonly TabButton[] {
    if (!tabBar || !tabBar.isValid) {
        console.warn('[BattleToken] tabBar 未装配，底栏页签不可点 —— 检查 BattleToken.prefab 的 `tabBar` 绑定');
        return [];
    }
    const buttons = tabBar.getComponentsInChildren(TabButton);
    if (buttons.length === 0) {
        console.warn('[BattleToken] tabBar 下没有 TabButton，底栏页签不可点 —— 检查四个页签是否用了 ui/common/TabButton');
    }
    return buttons;
}
