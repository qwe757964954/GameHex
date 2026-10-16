/**
 * 「创建联盟」弹窗（老端 `LayerLeagueCreat`，`ui/League/LeagueCreate`）—— 只有**未入盟**态才可达。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/加入联盟/组件_联盟_创建联盟.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「创建联盟」） | (40,343) **640×593** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `btn_creat`（`按钮_联盟_消耗按钮`，`TY_btn21` 300×130） | (211,723) | `BtnCreate`（+ `Bar` / `Submit` / `Cost`） |
 * | `n8` 输入框底板 `frame_shurukuang` | (172,614) 376×50 | `NameBg` |
 * | `lab_leagueName`（`input="true"`，24px） | (177,622) 366×34 | `NameInput`（`cc.EditBox`） |
 * | `list_banner`（`flow_vt` + `scroll=horizontal`，`defaultItem` = `组件_联盟_旗帜` 179×196） | (98,408) **544×206** | `BannerListView`（横向虚拟列表） |
 * | `按钮_勾选`（`<Button checked="true"/>` ⇒ 默认**已勾**） | (92,666) 50×50 | `QuickJoinBox`（+ `Box` / `Check`） |
 * | `n10`「允许快速加入」 | (137,674) 172×34 | `QuickJoinLabel` |
 *
 * 渲染序 = FGUI `displayList` 序（`popBg → btn_creat → n8 → lab → list → 勾选 → n10`），
 * 骨架（条 / 字 / 闭钮）按本工程既有口径紧跟在 `PopupBg` 之后。
 * 板根的 y 偏移见下（**593 是奇数** ⇒ 板中心 639.5）。
 *
 * ## 板根 y = +0.5、条 = 284.5、字 / 闭钮 = 287
 *
 * `popBg` 640×593 @ (40,343) ⇒ 板中心 = 343 + 296.5 = **639.5**（不是 640）
 * ⇒ 画布中心 640 − 639.5 = **0.5**（复刻 FGUI 绝对画布坐标，不是「摆到几何正中」）。
 * 骨架再叠加该偏移（`组件_公共弹窗_新` 里 `xy` 是**相对板**的：条距顶边 12.5、字 / 闭钮距顶边 10）
 * ⇒ 条 `0.5 + 296.5 − 12.5 = 284.5`、字 / 闭钮 `0.5 + 296.5 − 10 = 287`。
 * （与等级预览 0.5/440.5/443、申请列表 0/340.5/343、编辑信息 0.5/206.5/209、管理 −34.5/442.5/445 同解算。）
 *
 * ## 横向列表（`list_banner`）—— 本工程**第一张横向虚拟列表**
 *
 * FGUI 是 `flow_vt` + `scroll=horizontal` + `colGap=1`、`autoResizeItem` 缺省（= false，
 * 见 `tmp/_fgui_bin.mjs` 对已发布 bin 的取证）⇒ 8 个 179×196 的旗帜**一列一个**、
 * 横向滚动，`colGap=1` ⇒ 步长 180。
 *
 * `VirtualScrollView` 的横向分支（`_layoutSingleSlot` 的 `else`）把 item 放在
 * `x = idx·(itemMain + spacing) + itemMain·anchorX`、`y = 0`（`gridCount === 1`）。
 * 也就是说 item 从 **content 的锚点往 +x 方向长**、在 y 方向居中 ⇒
 * **content / 列表节点的锚点都必须是 `(0, 0.5)`**（锚点在左中），
 * 否则第一张旗会跑到列表中线右边去。纵向那批用 `(0.5, 1)` 是同一个道理
 * （item 往 −y 方向长 ⇒ 锚点在顶部）。
 *
 * ## 老端行为（`LayerLeagueCreatUI`）与移植取舍
 *
 * 1. **`selectIndex` 默认 0**（老端字段初值），`arr = [0..7]` ⇒ 传出去的就是颜色下标本身
 *    （`LeagueTable.leagueCreateBannerIndices()`）。
 * 2. **点旗只刷选中态**：老端 `onItemClick` 改 `selectIndex` 后调 `list.updateShowItem()`
 *    —— 注释里明确写了**不用** `refreshVirtualList()`（它走 `callLater`，下一帧整表重排，
 *    在横向列表上点了容易看不到反馈）。本端对应 `VirtualScrollView.getItemByIndex()`
 *    逐槽改「选中外框」的显隐（`repaintBanners`），不重跑 `renderItemFn`。
 * 3. **旗面按「颜色下标」换图**（FGUI `gearIcon controller="颜色"`，不是染色）；
 *    选中外框 = `gearDisplay controller="选中"`。8 张图**一次性预载**（`bannerFrames`）
 *    ⇒ `renderItemFn` 变成**纯同步**，槽位复用不会闪（同 `LeaguePage.applyBannerColor` 的口径）。
 * 4. **点击守卫链**（`onClickCreat`）：`_creating` 防连点 → 空名 / `***` 静默 return
 *    → 违禁词校验（**本端无 SDK 层，跳过**，同 `LeagueEditPage`）→ 消耗校验 → 发包。
 *    ⚠️ 本端 `_creating` 的置位点**比老端更早**（挪到第一个 `await` 之前）：
 *    老端的消耗校验是同步读缓存，本端要 `await createCost()` 读三张表，
 *    照老端写法会在那次 await 的空档里被第二次点击穿透（见 `onSubmit` 的注释）。
 *    本端把第 2 步的「静默」改成**给一条提示**（`LEAGUE_TIP_UNION_NAME_EMPTY`）——
 *    点「创建」毫无反应会让玩家以为卡了（有意偏离，见该常量的注释）。
 * 5. **消耗**：`creatCost = { resId: roleProperty.coin, number: gameConfig.unionCreateCost }`
 *    ⇒ 交给 `ILeagueRepository.createCost()`（读表 + 读缓存，不发包），
 *    上屏口径照 `ViewConsumeItemOne.updateByConsume`：`lab_has` 两态换色、`lab_need` 恒一色。
 * 6. **创建成功后 `unload()`**：本端 `close()` + 回敲 `onCreated`（老端靠 `CmdRoleUnion`
 *    的**推送**让容器页 `TabLeague.updateView` 切到主页；本端没有推送事件，
 *    只能由「写成功」这条链路主动通知 —— 见 `LeagueTabPage.refresh`）。
 * 7. **`lab_leagueName` 是多行输入**（FGUI 没写 `singleLine`，同 `LeagueEditPage` 的判据）
 *    ⇒ 两个 label 锚点 `(0,1)` + `lpos` = 框左上角，正文开 `enableWrapText`。
 *    FGUI 该节点**没写 `maxLength`**（FGUI 语义 0 = 不限），但 cocos 的 `cc.EditBox` 会把 `0`
 *    原样透传给原生 `maxlength=0` —— **一个字符都打不进去**，而且不报错。
 *    ⇒ prefab 里落的是 **20**（联盟名的合理上限；老端只做违禁词校验、不截断，
 *    超长由服务端 `UNION_NAME_TOO_LONG` 兜）。加入页的 id 查询框同理取 **19**（Long 的十进制上限）。
 */

import { _decorator, Button, Color, EditBox, Label, Node, Sprite, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import {
    LEAGUE_ART_ROOT,
    LEAGUE_COST_ENOUGH_COLOR,
    LEAGUE_COST_ENOUGH_STROKE,
    LEAGUE_COST_ICON_ROOT,
    LEAGUE_COST_SHORT_COLOR,
    LEAGUE_COST_SHORT_STROKE,
    leagueBannerArt,
} from './LeagueArt';
import { leagueRepository, type ILeagueRepository, type LeagueRequestResult } from './LeagueRepository';
import {
    isLeagueNameUsable,
    leagueCreateBannerIndices,
    type ILeagueCostView,
} from './LeagueTable';
import {
    fillLeagueText,
    LEAGUE_COST_NOT_ENOUGH_FALLBACK,
    LEAGUE_COST_NOT_ENOUGH_TEMPLATE,
    LEAGUE_CREATE_NAME_PROMPT,
    LEAGUE_CREATE_QUICK_JOIN,
    LEAGUE_CREATE_SUBMIT,
    LEAGUE_CREATE_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_TIP_UNION_NAME_EMPTY,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/** 打开本弹窗的参数（`PopupBase.open({ userData: ... })`）。 */
export interface ILeagueCreateParams {
    /** 建盟成功后的回敲（`LeagueJoinPage.onCreateClick` 传 `onJoined`）。 */
    readonly onCreated?: () => void;
}

/** 旗帜行的两个可切节点名（与别的页面同源：`组件_联盟_旗帜` 的 `n5` / `icon`）。 */
const BANNER_FRAME = 'Frame';
const BANNER_COLOR_ICON = 'ColorIcon';

@ccclass('LeagueCreatePage')
export class LeagueCreatePage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueCreate';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: EditBox, tooltip: 'NameInput：lab_leagueName 的 cc.EditBox（多行）' })
    nameInput: EditBox = null!;

    @property({ type: VirtualScrollView, tooltip: 'BannerListView：可选旗帜色（横向虚拟列表，8 项）' })
    bannerList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'QuickJoinBox：「允许快速加入」勾选框（整块 50×50 是热区）' })
    quickJoinBox: Node = null!;

    @property({ type: Node, tooltip: 'QuickJoinBox/Check：勾（FGUI 实例 checked=true ⇒ 默认已勾）' })
    quickJoinCheck: Node = null!;

    @property({ type: Node, tooltip: 'BtnCreate：消耗按钮（底图 + 衬底 + 「创建」+ 消耗项）' })
    costButton: Node = null!;

    @property({ type: Sprite, tooltip: 'BtnCreate/Cost/CostIcon：消耗图标（运行时按表换帧）' })
    costIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'BtnCreate/Cost/Has：持有量（「100/」，两态换色）' })
    costHasLabel: Label = null!;

    @property({ type: Label, tooltip: 'BtnCreate/Cost/Need：需要量（恒一色，FGUI 没有 gearColor）' })
    costNeedLabel: Label = null!;

    /** 建盟成功后的回敲（由 `LeagueJoinPage` 传入）。 */
    private onCreated?: () => void;

    /** 当前选中的旗帜色下标（= FGUI `颜色` controller 页序；老端 `selectIndex` 初值 0）。 */
    private selectIndex = 0;

    /** 列表数据源 —— 就是颜色下标本身（`[0..7]`）。 */
    private readonly bannerIndices: number[] = leagueCreateBannerIndices();

    /** 8 张旗面（首次打开后缓存，之后 `renderItemFn` 不再走异步）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    /** 最近一次的消耗展示模型（发包前要复读一遍「够不够」）。 */
    private cost: ILeagueCostView | null = null;

    /** 老端 `_creating`（防连点）。 */
    private creating = false;

    private buttonsBound = false;

    private rendererBound = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        if (this.buttonsBound) return;
        this.buttonsBound = true;

        const close = this.closeButton?.getComponent(Button);
        if (close) close.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueCreate] CloseBtn 上没有 cc.Button，点击不会生效');

        this.bindClick(this.costButton, () => void this.onSubmit());
        this.bindClick(this.quickJoinBox, () => this.toggleQuickJoin());

        if (!this.rendererBound) {
            this.rendererBound = true;
            if (this.bannerList) {
                this.bannerList.renderItemFn = (node, index) => this.renderBanner(node, index);
                this.bannerList.onItemClickFn = (_node, index) => this.onBannerClick(index);
            } else {
                console.warn('[LeagueCreate] BannerListView 没绑上，旗帜列表不会渲染');
            }
        }
    }

    protected async onOpen(userData?: ILeagueCreateParams): Promise<void> {
        this.onCreated = userData?.onCreated;
        this.creating = false;
        this.selectIndex = 0;
        if (this.nameInput) this.nameInput.string = '';
        this.applyStaticTexts();

        await this.loadBannerFrames();
        if (!this.alive) return;

        const revision = ++this.revision;
        await this.refreshCost();
        if (!this.alive || revision !== this.revision) return;

        // ⚠️ 列表槽位在 `VirtualScrollView.start()` 里建，而 `onOpen` 早于它
        //    ⇒ 必须让出一帧再 `refreshList`，否则落在「槽位还没建」的空档（表现为列表空白）。
        await this.nextPopupFrame();
        if (!this.alive) return;
        this.present();
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
        return LEAGUE_CREATE_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /** 8 张旗面一次性预载（之后行渲染是纯同步的，槽位复用时不会闪上一张的图）。 */
    private async loadBannerFrames(): Promise<void> {
        if (this.bannerFrames) return;
        const frames = await Promise.all(
            this.bannerIndices.map((index) => loadArt(leagueBannerArt(index), LEAGUE_ART_ROOT)),
        );
        if (!this.alive) return;
        this.bannerFrames = frames;
    }

    /** 读一次消耗展示模型（三张表全是**读**，不发包）。 */
    private async refreshCost(): Promise<void> {
        const cost = await this.repository.createCost();
        if (!this.alive) return;
        this.cost = cost;
        this.applyCost(cost);
    }

    /** 铺列表（`bannerIndices` 是静态的 8 项，直接 `refreshList`）。 */
    private present(): void {
        if (!this.bannerList || !this.bannerList.isValid) return;
        this.bannerList.refreshList(this.bannerIndices);
    }

    // ============================================================
    // 消耗项上屏
    // ============================================================

    /**
     * 消耗项上屏 —— 老端 `ViewConsumeItemOne.updateByConsume()`：
     *
     * ```ts
     * t.com.setSelectedPage("足够", hasNum >= needNum ? "是" : "否");
     * t.com.tm("lab_has").setText(hasNumStr + "/");
     * t.com.tm("lab_need").setText(needNumStr);
     * ```
     *
     * `足够` controller 落成的是 `lab_has` 的两套字色（`gearColor`）；
     * ⚠️ `lab_need` **没有** gearColor ⇒ 两态都保持 `#e6e5d9` / `#181614`（别顺手也染红）。
     */
    private applyCost(cost: ILeagueCostView): void {
        if (this.costHasLabel) {
            this.costHasLabel.string = cost.hasText;
            this.paintLabel(
                this.costHasLabel,
                cost.enough ? LEAGUE_COST_ENOUGH_COLOR : LEAGUE_COST_SHORT_COLOR,
                cost.enough ? LEAGUE_COST_ENOUGH_STROKE : LEAGUE_COST_SHORT_STROKE,
            );
        }
        if (this.costNeedLabel) {
            this.costNeedLabel.string = cost.needText;
            this.paintLabel(this.costNeedLabel, LEAGUE_COST_ENOUGH_COLOR, LEAGUE_COST_ENOUGH_STROKE);
        }
        void this.applyCostIcon(cost);
    }

    /** 消耗图标（`roleProperty.icon` 是 FGUI 组件名 ⇒ 目录固定 `icons/resource`）。 */
    private async applyCostIcon(cost: ILeagueCostView): Promise<void> {
        const sprite = this.costIcon;
        if (!sprite) return;
        const frame = await loadArt(cost.iconName, cost.iconRoot || LEAGUE_COST_ICON_ROOT);
        if (!sprite.isValid) return;
        if (!frame) {
            // 表里没有图标（或图挂了）：藏掉节点，别留一个空框
            sprite.node.active = false;
            return;
        }
        sprite.node.active = true;
        sprite.spriteFrame = frame;
    }

    /**
     * 给 label 换字色 / 描边色。
     *
     * FGUI 的 `gearColor` 只改 `color` 与 `strokeColor` 两个值；本端对应 `Label.color` /
     * `Label.outlineColor`。描边宽度已在 prefab 里写好（2），这里不动。
     */
    private paintLabel(
        label: Label,
        color: readonly [number, number, number],
        stroke: readonly [number, number, number],
    ): void {
        label.color = new Color(color[0], color[1], color[2], 255);
        if (label.enableOutline) label.outlineColor = new Color(stroke[0], stroke[1], stroke[2], 255);
    }

    // ============================================================
    // 旗帜列表
    // ============================================================

    /**
     * 铺一行的旗帜（**纯同步**：8 张图已在 `onOpen` 里预载完）。
     *
     * 槽位会被 clone 复用 ⇒ 每次都**绝对赋值**（选中外框的显隐 + 旗面图）。
     */
    private renderBanner(node: Node, index: number): void {
        const colorIndex = this.bannerIndices[index];
        if (colorIndex === undefined) {
            node.active = false;
            return;
        }
        node.active = true;

        const frame = node.getChildByName(BANNER_FRAME);
        if (frame) frame.active = index === this.selectIndex;

        const icon = node.getChildByName(BANNER_COLOR_ICON)?.getComponent(Sprite);
        if (icon) icon.spriteFrame = this.bannerFrames?.[colorIndex] ?? null;
    }

    /**
     * 点一张旗 ⇒ 选中它。
     *
     * 只刷「选中外框」的显隐，**不重跑 `renderItemFn`**（老端 `updateShowItem` 的同义做法）：
     * 重排整表会让横向列表跳一下，而且这里要改的只是一个布尔值。
     */
    private onBannerClick(index: number): void {
        if (this.bannerIndices[index] === undefined) return;
        this.selectIndex = index;
        this.repaintBanners();
    }

    /** 逐槽刷选中态（取不到的槽位说明该行不在可视区，跳过即可）。 */
    private repaintBanners(): void {
        if (!this.bannerList || !this.bannerList.isValid) return;
        for (let index = 0; index < this.bannerIndices.length; index += 1) {
            const node = this.bannerList.getItemByIndex(index);
            if (!node) continue;
            const frame = node.getChildByName(BANNER_FRAME);
            if (frame) frame.active = index === this.selectIndex;
        }
    }

    // ============================================================
    // 勾选框
    // ============================================================

    /** 当前是否勾了「允许快速加入」（老端读 `按钮_勾选` 的 `selected`）。 */
    get quickJoinSelected(): boolean {
        return this.quickJoinCheck?.active === true;
    }

    private toggleQuickJoin(): void {
        if (!this.quickJoinCheck) {
            console.warn('[LeagueCreate] QuickJoinBox/Check 没绑上，勾选框点不动');
            return;
        }
        this.quickJoinCheck.active = !this.quickJoinCheck.active;
    }

    // ============================================================
    // 提交
    // ============================================================

    /**
     * 点「创建」—— 老端 `onClickCreat()` 的守卫链照搬，只把「空名静默」改成给提示。
     *
     * ⚠️ 消耗在这里**重新读一次**（不是复用打开时那份）：表可以热更、金币也可能刚被花掉，
     *    老端 `CheckHaveEnoughCostAndOpenAlert` 也是现读。
     *
     * ⚠️⚠️ `creating` 必须在**第一个 `await` 之前**就置位、在 `finally` 里清除。
     *    老端 `CheckHaveEnoughCostAndOpenAlert` 是**同步**读本地缓存，所以它的
     *    `if (this._creating) return;` 天然覆盖整条链路；本端的 `createCost()` 是
     *    **异步**的（要读三张表）⇒ 若照老端只在发包前置位，则「取消耗」那段空档里
     *    的第二次点击会**穿透**守卫、并发发两次包（探针 2G.3 实测到的就是这条）。
     */
    private async onSubmit(): Promise<void> {
        if (this.creating) return;
        this.creating = true;
        try {
            const input = this.nameInput;
            const name = input ? input.string : '';
            if (!isLeagueNameUsable(name)) {
                // 老端这里是静默 return；本端补提示（有意偏离，见 LeagueTexts 的说明）
                FW.showTip(LEAGUE_TIP_UNION_NAME_EMPTY);
                return;
            }

            const cost = await this.repository.createCost();
            if (!this.alive) return;
            this.cost = cost;
            this.applyCost(cost);
            if (!cost.enough) {
                FW.showTip(this.costTip(cost));
                return;
            }
            // 结果回来时输入框已被改动 ⇒ 放弃（同老端的 `input.text != labName`）
            if (!input || input.string !== name) return;

            const result = await this.repository.requestCreat(this.selectIndex, name, this.quickJoinSelected, this);
            if (!this.alive) return;
            if (result === 'ok') {
                this.finishCreated();
                return;
            }
            FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
        } finally {
            this.creating = false;
        }
    }

    /**
     * 消耗不足的提示 —— 老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert()`：
     * 优先用 `roleProperty.unenoughTips`（现网 resId=10 写着「金币不足」），
     * 没写就用 `ModelGoods_1`（`{0}不足`）拿资源名拼，再兜底一句通用提示。
     */
    private costTip(cost: ILeagueCostView): string {
        if (cost.unenoughTips) return cost.unenoughTips;
        if (cost.name) return fillLeagueText(LEAGUE_COST_NOT_ENOUGH_TEMPLATE, cost.name);
        return LEAGUE_COST_NOT_ENOUGH_FALLBACK;
    }

    /** 建盟成功：关掉自己 + 回敲容器（老端 `unload()` 后靠推送刷新）。 */
    private finishCreated(): void {
        this.closeByButton();
        try {
            this.onCreated?.();
        } catch (error) {
            console.error('[LeagueCreate] onCreated 回调抛错', error);
        }
    }

    // ============================================================
    // 杂项
    // ============================================================

    /**
     * 静态文案（FGUI 就是静态 `title` / `text`，prefab 已写好，这里只兜「空」）。
     *
     * ⚠️ 「允许快速加入」在 FGUI 里是**面板上的独立文本 `n10`**（`组件_联盟_勾选` 自带的
     *    `title` 是空的、`autoClearText`）⇒ 它是 `QuickJoinBox` 的**兄弟**、不是后代，
     *    `getComponentInChildren` 找不到它（会静默空转）⇒ 必须按兄弟名取。
     */
    private applyStaticTexts(): void {
        setLabelIfEmpty(this.costButton, LEAGUE_CREATE_SUBMIT);
        const quickJoinLabel = this.node?.getChildByName(QUICK_JOIN_LABEL_NODE) ?? null;
        setLabelIfEmpty(quickJoinLabel, LEAGUE_CREATE_QUICK_JOIN);
        const placeholder = this.nameInput?.placeholderLabel;
        if (placeholder && !placeholder.string) placeholder.string = LEAGUE_CREATE_NAME_PROMPT;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 按名字接按钮；节点有 `cc.Button` 走 CLICK，否则退回 `TOUCH_END`（缺节点只 warn）。 */
    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueCreate] 按钮节点缺失，点击不会生效');
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

/**
 * 「允许快速加入」的文本节点名。
 *
 * FGUI `组件_联盟_创建联盟.xml` 里它叫 `n10`（`xy="137,674" size="172,34"`），
 * 与勾选框 `按钮_勾选`（`92,666`）**同级** —— 勾选组件自带的 `title` 是空的（`autoClearText`），
 * 面板另起了一个文本当说明 ⇒ 构建器把它落成根下的 `QuickJoinLabel`。
 */
const QUICK_JOIN_LABEL_NODE = 'QuickJoinLabel';

/** 按钮底下的文案：prefab 已写好，运行期只在「空」时兜一次（免得手滑删了 label 就成空按钮）。 */
function setLabelIfEmpty(node: Node | null, text: string): void {
    const label = node ? node.getComponentInChildren(Label) : null;
    if (label && !label.string) label.string = text;
}
