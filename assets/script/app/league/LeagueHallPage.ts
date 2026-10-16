/**
 * 「联盟 · 大厅」母面板（老端 `play/LayerLeagueHall`，`assets/resources/ui/League/LeagueHall.prefab`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅.xml`，720×1280）
 *
 * 一屏三块：
 *  - **头部信息区**：联盟旗帜（`Banner`）+ 名称 / 等级 / ID / 微信 / 公告底板 + 经验进度条
 *    + 帮助 / 管理 / 复制 ID / 复制微信四个小按钮；
 *  - **底部页签栏**：返回 + 三个页签（详情 / 动态 / 全服联盟），页签底图与图标各分「选中 / 未选中」两套；
 *  - **页签内容区**：`TabDetail` / `TabLog` / `TabAllServer` 三个互斥容器（切页签 = 切 `active`）。
 *
 * ## 页签模型（FGUI `标签` controller → 三个 `active` 容器）
 *
 * FGUI 里三个页签是**三个独立组件**，由页签框架叠在内容区互斥显示，每个组件在
 * `initAsync` 各发一条请求（详情 / 动态 / 全服）。Demo3.8 侧不引页签框架，
 * 直接用「三个容器 + 一个选中下标」——`selectTab(i)` 同时切容器可见性与页签按钮的
 * 选中 / 未选中子节点（`BgUp/BgDown/IconUp/IconDown`），口径与 `MainTabHost` 一致；
 * 取数搬到 `activateTab(i)`，**第一次切到该页签才发请求**（等价于老端的懒建 tab 组件）。
 *
 * ## 三张列表都是「行模板内联在本 prefab 里」的虚拟列表
 *
 * | 页签 | 列表节点 | 行模板 | 行高 / 间距 |
 * |---|---|---|---|
 * | 详情 | `TabDetail/DetailList` | `…/content/MemberRow` | 109 / `lineGap 8` |
 * | 动态 | `TabLog/LogList` | `…/content/LogRow` | 70 / `lineGap 8` |
 * | 全服 | `TabAllServer/ServerList` | `…/content/ServerRow` | 113 / `lineGap 4` |
 *
 * 行模板**不必单独出 prefab**：`VirtualScrollView` 支持 `itemNode` 指向 content 下的节点
 * （`_initFixedSizeMode` 还会把 content 的**第一个子节点**当模板 `removeFromParent` 掉，
 * 所以上屏后 content 里不会留一个「多余的假行」）。
 *
 * ## 与老端的**有意偏差**
 *
 * 1. 老端 `updateView` 在「未入盟」时会 `unload()`（把大厅整个关掉）。本端**不关**：
 *    大厅只可能从「已入盟」的入口进来，真出现空态时把面板自己关掉反而更难查；
 *    这里退回占位头部 + 空列表。
 * 2. `league_copyid` / `league_copywx` 两个节点老端**压根没接线**；本端现已接通：
 *    复制联盟 ID / 微信号（走 `copyLeagueText`，非微信环境自动退回 `navigator.clipboard`）。
 * 3. `btn_help` 老端接的是等级预览（`OpenLayerLeagueLevelPreview`）⇒ 本端同样打开
 *    `LeagueLevelPreviewPage`（已落地）。
 */

import { _decorator, Button, EditBox, Label, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { HeadArt } from '../HeadArt';
import {
    LEAGUE_ART_BANNER_BASE,
    LEAGUE_ART_BANNER_FRAME,
    LEAGUE_ART_ROOT,
    LEAGUE_ART_TAB_UP,
    LEAGUE_ART_TAB_DOWN,
    LEAGUE_BANNER_COLOR_COUNT,
    LEAGUE_BANNER_DEFAULT_COLOR,
    LEAGUE_HALL_TAB_ARTS,
    LEAGUE_TAB_ICON_ROOT,
    leagueBannerArt,
} from './LeagueArt';
import {
    buildLeagueLogViews,
    buildLeagueMemberViews,
    buildLeagueUnionViews,
    buildMemberCountText,
    isLeagueSearchId,
    pickUnionListForSearch,
    resolveLeagueMemberActions,
    LeaguePosition,
    type ILeagueLogView,
    type ILeagueMemberView,
    type ILeagueOfficialRow,
    type ILeagueUnionView,
} from './LeagueTable';
import { leagueRepository, type ILeagueRepository, type ILeagueSnapshot, type LeagueRequestResult } from './LeagueRepository';
import { LeagueInfoPage } from './LeagueInfoPage';
import { LeagueLevelPreviewPage } from './LeagueLevelPreviewPage';
import { LeagueLogRow } from './LeagueLogRow';
import { LeagueMemberRow } from './LeagueMemberRow';
import { LeagueMgrPage } from './LeagueMgrPage';
import { LeagueOpsBar, type LeagueOpsAction } from './LeagueOpsBar';
import { LeagueUnionRow } from './LeagueUnionRow';
import {
    LEAGUE_HALL_ID_PREFIX,
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_HALL_PLACEHOLDER,
    LEAGUE_HALL_TABS,
    LEAGUE_HALL_WX_PREFIX,
    LEAGUE_LOG_JOIN,
    LEAGUE_LOG_KICK,
    LEAGUE_LOG_QUIT,
    LEAGUE_MEMBER_COUNT_PREFIX,
    LEAGUE_MEMBER_ONLINE,
    LEAGUE_OFFLINE_DAYS,
    LEAGUE_OFFLINE_HOURS,
    LEAGUE_OFFLINE_MINUTES,
    LEAGUE_POSITION_ADMIN,
    LEAGUE_POSITION_LEADER,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_INPUT_UNION_ID,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_TIP_VIEW_SELF,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from './LeagueTexts';
import { copyLeagueText } from './LeagueClipboard';
import { CommonTips } from '../common/CommonTips';

const { ccclass, property } = _decorator;

/** 一个页签按钮内部的四个状态子节点名（口径同 FGUI `按钮_大厅页签`）。 */
const TAB_UP_NODES = ['BgUp', 'IconUp'] as const;
const TAB_DOWN_NODES = ['BgDown', 'IconDown'] as const;

/** 进度条满宽（与 prefab 里 `Progress/ProgressFill` 的 contentSize.width 一致）。 */
const PROGRESS_FULL_WIDTH = 383;

/** 页签下标（与 `LEAGUE_HALL_TABS` 同序）。 */
const TAB_DETAIL = 0;
const TAB_LOG = 1;
const TAB_ALL_SERVER = 2;

/**
 * 操作浮层的中心相对「被点行的竖向中点」的偏移（正数 = 浮层往下挪）。
 *
 * 老端 `comp_ctrl.y = local.y`（该行中点在详情组件里的 y），浮层高 100、pivot 0.5
 * ⇒ 浮层中心 = 行中点 + 50（FGUI y 向下）。本端 y 轴朝上 ⇒ 等价的 cocos 偏移就是
 * **−50**。0.8 的缩放是绕中心做的，不改变中心位置。
 */
const OPS_BAR_CENTER_OFFSET = 50;

/** 拿不到行 / 容器变换时的兜底 y（浮层原本的设计位，别把界面炸掉）。 */
const OPS_BAR_FALLBACK_Y = 35;

const _rowWorld = new Vec3();
const _pageLocal = new Vec3();

@ccclass('LeagueHallPage')
export class LeagueHallPage extends PopupBase {
    /** ⚠️ 目录名大小写必须与磁盘一致（`assets/resources/ui/League/`）。 */
    static prefabPath = 'ui/League/LeagueHall';

    @property({ type: Node, tooltip: 'Banner：联盟旗帜容器' })
    banner: Node = null!;

    @property({ type: Sprite, tooltip: 'Banner/ColorIcon：旗面' })
    bannerColor: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Banner/Frame：选中态外框' })
    bannerFrame: Sprite = null!;

    @property({ type: Label, tooltip: 'LabName：联盟名' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabLv：等级' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabNotice：公告' })
    noticeLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabId：联盟 ID' })
    idLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabWx：联系微信号' })
    wxLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'Progress/ProgressFill：经验进度填充' })
    progressFill: Sprite = null!;

    @property({ type: Label, tooltip: 'Progress/ProgressLabel：经验数值' })
    progressLabel: Label = null!;

    @property({ type: Node, tooltip: 'BtnBack：返回（关面板）' })
    backButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnMgr：管理（子面板未落地 ⇒ 提示）' })
    mgrButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnHelp：帮助 ⇒ 打开等级预览' })
    helpButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnCopyId：复制联盟 ID（老端未接线 ⇒ 提示）' })
    copyIdButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnCopyWx：复制联系微信（老端未接线 ⇒ 提示）' })
    copyWxButton: Node = null!;

    @property({ type: Node, tooltip: 'TabAllServer/Search/BtnSearch：全服联盟查询' })
    searchButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnDetail：页签「详情」' })
    tabDetailButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnLog：页签「动态」' })
    tabLogButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnAllServer：页签「全服联盟」' })
    tabAllServerButton: Node = null!;

    @property({ type: Node, tooltip: 'TabDetail：详情内容容器' })
    tabDetailPage: Node = null!;

    @property({ type: Node, tooltip: 'TabLog：动态内容容器' })
    tabLogPage: Node = null!;

    @property({ type: Node, tooltip: 'TabAllServer：全服联盟内容容器' })
    tabAllServerPage: Node = null!;

    @property({ type: Label, tooltip: 'TabDetail/LabUserCount：联盟成员(N/M)' })
    memberCountLabel: Label = null!;

    @property({ type: VirtualScrollView, tooltip: 'TabDetail/DetailList：成员列表' })
    memberList: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'TabLog/LogList：动态列表' })
    logList: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'TabAllServer/ServerList：全服联盟列表' })
    serverList: VirtualScrollView = null!;

    @property({ type: EditBox, tooltip: 'TabAllServer/Search/Input：联盟 ID 查询框（数字键盘）' })
    searchInput: EditBox = null!;

    @property({ type: LeagueOpsBar, tooltip: 'TabDetail/OpsBar：角色操作浮层' })
    opsBar: LeagueOpsBar = null!;

    /** 当前选中的页签下标（0=详情 / 1=动态 / 2=全服联盟）。 */
    selectedTab = 0;

    /** 三个页签按钮（按 `LEAGUE_HALL_TABS` 序）。 */
    private tabButtons: Node[] = [];

    /** 三个内容容器（按 `LEAGUE_HALL_TABS` 序）。 */
    private tabPages: Node[] = [];

    /** 旗面八张图（首次用到后缓存）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    /** 数据端口（默认走模块单例；单测/探针可替换）。 */
    protected repository: ILeagueRepository = leagueRepository;

    /** 最近一次快照（行渲染按它现取）。 */
    private snapshot: ILeagueSnapshot | null = null;

    /** 三张列表各自的视图模型。 */
    private memberRows: ILeagueMemberView[] = [];
    private logRows: ILeagueLogView[] = [];
    private serverRows: ILeagueUnionView[] = [];

    /** `position → 权限`（`unionOfficial` 表）。 */
    private officialPowers: ReadonlyMap<number, ILeagueOfficialRow> = new Map();

    /** 操作浮层当前针对的成员。 */
    private selectedMember: ILeagueMemberView | null = null;

    /** 哪个页签已经取过数（老端的 tab 组件建一次 ⇒ 这里等价于「请求过一次且成功」）。 */
    private tabRequested: boolean[] = [false, false, false];

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    /** 按钮 / 列表回调只绑一次（`onLoad` 与 `onOpen` 都会兜一次）。 */
    private bound = false;
    private listsBound = false;

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad(): void {
        this.ensureBound();
        this.applyHeaderPlaceholder();
        this.applyTabState(this.selectedTab);
        void this.applyBannerColor(LEAGUE_BANNER_DEFAULT_COLOR);
        void this.applyTabIconArt();
    }

    /**
     * 首屏取数。
     *
     * ⚠️ 不放 `onLoad`：`onLoad` 由引擎在节点激活时调，而 `onOpen` 才由弹窗管理器调，
     *    两者先后不确定（管理器可能先 `onInit` 再入场景）。取数放 `onOpen` 更贴「面板被打开」。
     */
    protected onOpen(): void {
        this.ensureBound();
        void this.activateTab(this.selectedTab);
    }

    protected onClose(): void {
        this.revision += 1;
        this.opsBar?.hide();
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 按钮接线
    // ============================================================

    /**
     * 按钮 / 列表接线（`onLoad` 与 `onOpen` 都会兜一次，所以必须幂等）。
     *
     * ⚠️ 顺序有讲究：`tabButtons/tabPages` 必须在 `bindButtons()` **之前**填好，
     *    否则「页签按钮一个都没接上」—— 而且不报错（`for` 循环跑了个空数组）。
     */
    private ensureBound(): void {
        if (!this.tabButtons.length) {
            this.tabButtons = [this.tabDetailButton, this.tabLogButton, this.tabAllServerButton];
            this.tabPages = [this.tabDetailPage, this.tabLogPage, this.tabAllServerPage];
        }
        this.bindButtons();
        this.bindLists();
    }

    /** 按名字接按钮；节点有 `cc.Button` 走 CLICK，否则退回 `TOUCH_END`（缺节点只 warn）。 */
    private bindButtons(): void {
        if (this.bound) return;
        this.bound = true;

        this.onClick(this.backButton, () => this.close());
        // 老端 `btn_mgr` → `OpenLayerLeagueHallMgr`（管理面板已落地）
        this.onClick(this.mgrButton, () => void LeagueMgrPage.open());
        // 老端 `btn_help` → `OpenLayerLeagueLevelPreview`（等级预览已落地）
        this.onClick(this.helpButton, () => this.openLevelPreview());
        this.onClick(this.copyIdButton, () => this.onCopyId());
        this.onClick(this.copyWxButton, () => this.onCopyWx());
        this.onClick(this.searchButton, () => void this.onSearchClick());

        for (let index = 0; index < this.tabButtons.length; index += 1) {
            const button = this.tabButtons[index];
            const target = index;
            this.onClick(button, () => this.selectTab(target));
        }
    }

    /**
     * 列表回调 + 查询框监听。
     *
     * ⚠️ `renderItemFn` **只能绑一次**（放 `onLoad` / `onOpen` 都会随每次打开重复叠加，
     *    叠加后同一帧会被渲染 N 次）。
     */
    private bindLists(): void {
        if (!this.listsBound) {
            this.listsBound = true;

            if (this.memberList) {
                this.memberList.renderItemFn = (node, index) => this.renderMemberRow(node, index);
                this.memberList.onItemClickFn = (node, index) => this.onMemberClick(node, index);
            }
            if (this.logList) {
                this.logList.renderItemFn = (node, index) => this.renderLogRow(node, index);
            }
            if (this.serverList) {
                this.serverList.renderItemFn = (node, index) => this.renderServerRow(node, index);
                this.serverList.onItemClickFn = (node, index) => this.onUnionClick(node, index);
            }

            const input = this.searchInput;
            if (input) {
                // 老端 `onInputTextChange`：非正整数就清空（FGUI 的 `restrict="[0-9]"` 只挡键盘，
                // 粘贴等旁路仍会漏进来）。
                input.node.on('text-changed', this.onSearchTextChanged, this);
            }
        }

        if (this.opsBar) this.opsBar.onSelect = (action) => this.onOpsAction(action);
    }

    private onClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueHall] 按钮节点缺失，点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    // ============================================================
    // 页签
    // ============================================================

    /**
     * 切换页签（同步部分 = 切容器 + 切按钮态；随后异步取数）。
     * 越界按下标夹取（外部调用不应把界面切崩）。
     */
    selectTab(index: number): void {
        this.applyTabState(index);
        void this.activateTab(this.selectedTab);
    }

    /** 纯同步的页签态（`onLoad` 用它初始化，不发请求）。 */
    private applyTabState(index: number): void {
        const clamped = Math.min(Math.max(Math.trunc(index), 0), LEAGUE_HALL_TABS.length - 1);
        this.selectedTab = clamped;
        for (let i = 0; i < this.tabPages.length; i += 1) {
            const page = this.tabPages[i];
            if (page) page.active = i === clamped;
        }
        for (let i = 0; i < this.tabButtons.length; i += 1) {
            this.applyTabButtonState(this.tabButtons[i], i === clamped);
        }
        // 浮层是「详情页签里贴着某一行」的东西 ⇒ 切走页签必须收起
        this.opsBar?.hide();
        this.selectedMember = null;
    }

    /** 单个页签按钮的选中态：`BgUp/IconUp` 与 `BgDown/IconDown` 两组互斥。 */
    private applyTabButtonState(button: Node | null, selected: boolean): void {
        if (!button) return;
        for (const name of TAB_UP_NODES) {
            const node = button.getChildByName(name);
            if (node) node.active = !selected;
        }
        for (const name of TAB_DOWN_NODES) {
            const node = button.getChildByName(name);
            if (node) node.active = selected;
        }
    }

    /**
     * 取该页签的数据（老端每个 tab 组件 `initAsync` 各发一条请求）。
     *
     * 只在**第一次切到**该页签时发；请求失败（离线 / 超时）不标记已请求，
     * 下次切回来会重试（比老端「发一次就再也不发」更稳）。
     */
    private async activateTab(index: number): Promise<void> {
        const revision = ++this.revision;

        if (!this.tabRequested[index]) {
            const result = await this.requestTab(index);
            if (result === 'ok') this.tabRequested[index] = true;
            if (!this.alive || revision !== this.revision) return;
        }

        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;
        this.applySnapshot(snapshot, index);
    }

    private requestTab(index: number): Promise<LeagueRequestResult> {
        if (index === TAB_DETAIL) return this.repository.requestDetail();
        if (index === TAB_LOG) return this.repository.requestLog();
        return this.repository.requestList();
    }

    /** 快照落库 + 铺当前页签。 */
    private applySnapshot(snapshot: ILeagueSnapshot, index: number): void {
        this.snapshot = snapshot;
        this.officialPowers = snapshot.officialPowers;
        this.applyHeader(snapshot);
        this.presentTab(index);
    }

    /** 只要数据变了就重铺（写操作成功后调）。 */
    private async reloadCurrentTab(): Promise<void> {
        const revision = ++this.revision;
        const index = this.selectedTab;
        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;
        this.applySnapshot(snapshot, index);
    }

    private presentTab(index: number): void {
        if (index === TAB_DETAIL) this.presentMembers();
        else if (index === TAB_LOG) this.presentLogs();
        else this.presentUnions();
    }

    // ============================================================
    // 头部信息
    // ============================================================

    /** 头部信息（数据没回来前 = 占位串）。 */
    private applyHeaderPlaceholder(): void {
        const p = LEAGUE_HALL_PLACEHOLDER;
        if (this.nameLabel) this.nameLabel.string = p.name;
        if (this.levelLabel) this.levelLabel.string = `${p.level}${LEAGUE_HALL_LV_SUFFIX}`;
        if (this.noticeLabel) this.noticeLabel.string = p.notice;
        if (this.idLabel) this.idLabel.string = `${LEAGUE_HALL_ID_PREFIX}${p.id}`;
        if (this.wxLabel) this.wxLabel.string = `${LEAGUE_HALL_WX_PREFIX}${p.wxChat}`;
        this.applyProgress(p.exp, p.maxExp);
        if (this.memberCountLabel) {
            this.memberCountLabel.string = buildMemberCountText(
                LEAGUE_MEMBER_COUNT_PREFIX, p.memberCount, p.maxMemberCount,
            );
        }
    }

    /** 头部信息（真值口径同老端 `updateView`）。 */
    private applyHeader(snapshot: ILeagueSnapshot): void {
        const union = snapshot.myUnion;
        if (!union) {
            // 未入盟 / 还没推回来 ⇒ 保持占位（老端这里是 `unload()`，见类头的「有意偏差」）
            return;
        }
        if (this.nameLabel) this.nameLabel.string = union.name;
        if (this.levelLabel) this.levelLabel.string = `${union.level}${LEAGUE_HALL_LV_SUFFIX}`;
        if (this.noticeLabel) this.noticeLabel.string = union.notice;
        if (this.idLabel) this.idLabel.string = `${LEAGUE_HALL_ID_PREFIX}${union.id}`;
        if (this.wxLabel) this.wxLabel.string = `${LEAGUE_HALL_WX_PREFIX}${union.wxChat}`;
        if (this.memberCountLabel) {
            this.memberCountLabel.string = buildMemberCountText(
                LEAGUE_MEMBER_COUNT_PREFIX, union.count, union.maxCount,
            );
        }
        this.applyProgress(union.exp, snapshot.myMaxExp);
        void this.applyBannerColor(union.icon);
    }

    /** 经验进度条：按 `exp/maxExp` 改填充宽度 + 写数值文本。 */
    applyProgress(exp: number, maxExp: number): void {
        const safeMax = maxExp > 0 ? maxExp : 1;
        const ratio = Math.min(Math.max(exp / safeMax, 0), 1);
        if (this.progressFill) {
            const uit = this.progressFill.node.getComponent(UITransform);
            if (uit) uit.setContentSize(Math.max(PROGRESS_FULL_WIDTH * ratio, 1), uit.contentSize.height);
        }
        if (this.progressLabel) this.progressLabel.string = `${exp}/${maxExp}`;
    }

    /** 切旗帜颜色（FGUI `颜色` controller 8 色，下标 = `CmdUnion.icon`）。 */
    async applyBannerColor(colorIndex: number): Promise<void> {
        if (!this.bannerColor) return;
        if (!this.bannerFrames) {
            const names: string[] = [];
            for (let index = 0; index < LEAGUE_BANNER_COLOR_COUNT; index += 1) names.push(leagueBannerArt(index));
            const frames = await Promise.all(names.map((name) => loadArt(name, LEAGUE_ART_ROOT)));
            if (!this.node || !this.node.isValid) return;
            this.bannerFrames = frames;
        }
        const frame = this.bannerFrames[colorIndex] ?? null;
        if (frame) this.bannerColor.spriteFrame = frame;
    }

    /** 三个页签按钮的底图 + 图标（选中 / 未选中各一套），按 `LEAGUE_HALL_TAB_ARTS` 取图。 */
    private async applyTabIconArt(): Promise<void> {
        const upBg = await loadArt(LEAGUE_ART_TAB_UP, LEAGUE_ART_ROOT);
        const downBg = await loadArt(LEAGUE_ART_TAB_DOWN, LEAGUE_ART_ROOT);
        if (!this.node || !this.node.isValid) return;

        for (let index = 0; index < this.tabButtons.length; index += 1) {
            const button = this.tabButtons[index];
            if (!button) continue;
            const arts = LEAGUE_HALL_TAB_ARTS[index];
            const [upIcon, downIcon] = await Promise.all([
                loadArt(arts.up, LEAGUE_TAB_ICON_ROOT),
                loadArt(arts.down, LEAGUE_TAB_ICON_ROOT),
            ]);
            setSprite(button.getChildByName('BgUp'), upBg);
            setSprite(button.getChildByName('BgDown'), downBg);
            setSprite(button.getChildByName('IconUp'), upIcon);
            setSprite(button.getChildByName('IconDown'), downIcon);
        }
    }

    // ============================================================
    // 详情页签（成员）
    // ============================================================

    private presentMembers(): void {
        const snapshot = this.snapshot;
        this.memberRows = snapshot
            ? buildLeagueMemberViews(snapshot.members, snapshot.now, LEAGUE_OFFLINE_TEXTS)
            : [];
        this.refreshList(this.memberList, this.memberRows.length);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderMemberRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueMemberRow);
        if (!row) return;
        const view = this.memberRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
        void this.loadMemberAvatar(row, view);
    }

    /** 头像异步取图（令牌由行脚本管，防「A 的头像贴到 B 身上」）。 */
    private async loadMemberAvatar(row: LeagueMemberRow, view: ILeagueMemberView): Promise<void> {
        const token = row.avatarToken;
        const frame = await HeadArt.loadHeadFrame(view.img);
        if (!row.isValid) return;
        row.applyAvatar(frame, token);
    }

    /**
     * 点成员行 ⇒ 在该行位置弹出角色操作浮层（老端 `itemClick`）。
     *
     * ⚠️ 浮层展开时它自带一层全屏遮罩：**先收起、本次点击不透传**（不然点页签会「既收起又切页」）。
     */
    private onMemberClick(node: Node, index: number): void {
        if (this.opsBar?.isOpen) {
            this.opsBar.hide();
            return;
        }
        const view = this.memberRows[index];
        if (!view) return;
        const myPosition = this.snapshot?.myPosition ?? 0;
        const actions = resolveLeagueMemberActions(myPosition, view.position, this.officialPowers);
        this.selectedMember = view;
        this.opsBar?.show(actions, this.placeOpsBar(node));
    }

    /**
     * 浮层该贴在哪儿：**该行竖向中点**（横向不动，见 `OPS_BAR_CENTER_OFFSET`）。
     *
     * 老端是在 FGUI 的局部坐标里直接 `ctrl.y = local.y`；本端把「行的世界坐标」换算回
     * `TabDetail` 的局部坐标（两层 content 的锚点由引擎算，别自己手推）。
     */
    private placeOpsBar(rowNode: Node): number {
        const rowTransform = rowNode.getComponent(UITransform);
        const pageTransform = this.tabDetailPage?.getComponent(UITransform);
        if (!rowTransform || !pageTransform) return OPS_BAR_FALLBACK_Y;
        rowTransform.convertToWorldSpaceAR(Vec3.ZERO, _rowWorld);
        pageTransform.convertToNodeSpaceAR(_rowWorld, _pageLocal);
        return _pageLocal.y - OPS_BAR_CENTER_OFFSET;
    }

    // ============================================================
    // 动态页签（日志）
    // ============================================================

    private presentLogs(): void {
        const snapshot = this.snapshot;
        this.logRows = snapshot ? buildLeagueLogViews(snapshot.logs, LEAGUE_LOG_TEXTS) : [];
        this.refreshList(this.logList, this.logRows.length);
    }

    private renderLogRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueLogRow);
        if (!row) return;
        const view = this.logRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
    }

    // ============================================================
    // 全服页签（联盟列表 + 搜索）
    // ============================================================

    private presentUnions(): void {
        const snapshot = this.snapshot;
        const key = this.searchInput?.string ?? '';
        // 老端 `GetCmdUnionListBySearch`：命中过搜索缓存就只显示那一条，否则显示全部
        const rows = snapshot
            ? pickUnionListForSearch(snapshot.unions, this.repository.cachedSearch(key))
            : [];
        this.serverRows = buildLeagueUnionViews(rows, LEAGUE_UNION_TEXTS);
        this.refreshList(this.serverList, this.serverRows.length);
    }

    private renderServerRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueUnionRow);
        if (!row) return;
        const view = this.serverRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
        void this.loadUnionBanner(row, view);
    }

    /** 旗面按颜色下标**换图**（FGUI 是 `gearIcon` 换图，不是给一张图染色）。 */
    private async loadUnionBanner(row: LeagueUnionRow, view: ILeagueUnionView): Promise<void> {
        const token = row.bannerToken;
        const frame = await loadArt(leagueBannerArt(view.icon), LEAGUE_ART_ROOT);
        if (!row.isValid) return;
        row.applyBanner(frame, token);
    }

    /** 查询框输入：非正整数就地清空（老端 `onInputTextChange` 逐字照搬）。 */
    private onSearchTextChanged(): void {
        const input = this.searchInput;
        if (!input) return;
        if (!isLeagueSearchId(input.string)) input.string = '';
    }

    /** 点「查询」：空输入提示；否则按 id 搜，回来后按缓存重铺列表。 */
    private async onSearchClick(): Promise<void> {
        if (this.opsBar?.isOpen) {
            this.opsBar.hide();
            return;
        }
        const key = this.searchInput?.string ?? '';
        if (!key) {
            FW.showTip(LEAGUE_TIP_INPUT_UNION_ID);
            return;
        }
        const revision = ++this.revision;
        const result = await this.repository.search(key);
        if (!this.alive || revision !== this.revision) return;
        this.reportResult(result);
        this.presentUnions();
    }

    /**
     * 点全服列表里的某一行 ⇒ 开「联盟信息」。
     *
     * ⚠️ 传的是**行视图对象本身**，不是 id：全服列表的 `CmdUnion` 来自
     *    `RequestUnionSearch` 的 Rsp，而 `LeagueRepository` **刻意不**把搜索结果写进
     *    缓存表（免得抢「我所在的联盟」那个 `tlKey`）⇒ 详情面板回缓存查是查不到的。
     *    这就是 `ILeagueUnionView` 带 `wxChat` / `declaration` 两个字段的原因。
     */
    private onUnionClick(_node: Node, index: number): void {
        if (this.opsBar?.isOpen) {
            this.opsBar.hide();
            return;
        }
        const view = this.serverRows[index];
        if (!view) return;
        void LeagueInfoPage.open({ userData: { union: view } });
    }

    // ============================================================
    // 角色操作浮层
    // ============================================================

    private onOpsAction(action: LeagueOpsAction): void {
        const view = this.selectedMember;
        this.selectedMember = null;
        if (!view) return;
        switch (action) {
            case 'show':
                this.onShowMember(view);
                return;
            case 'toLeader':
                void this.runMemberOp((id) => this.repository.appointLeader(id), view);
                return;
            case 'toAdmin':
                void this.runMemberOp((id) => this.repository.appointAdmin(id), view);
                return;
            case 'unAdmin':
                void this.runMemberOp((id) => this.repository.dismissAdmin(id), view);
                return;
            case 'kick':
                void this.runMemberOp((id) => this.repository.kick(id), view);
                return;
            default:
                return;
        }
    }

    /** 复制联盟 ID（老端没接线，本端接通）。 */
    private onCopyId(): void {
        this.copyField(this.snapshot?.myUnion?.id ?? '', '联盟ID');
    }

    /** 复制联盟微信号（老端没接线，本端接通）。 */
    private onCopyWx(): void {
        this.copyField(this.snapshot?.myUnion?.wxChat ?? '', '微信号');
    }

    /** 字段为空给提示、否则走安全复制通道。 */
    private copyField(value: string, label: string): void {
        if (!value) {
            FW.showTip(`${label}为空`);
            return;
        }
        copyLeagueText(value);
    }

    /** 查看：看自己 ⇒ 明确提示（老端 `CLICK_TIP_0`）；看别人 ⇒ 用联盟自有数据弹轻量资料卡（老端 `openOtherPlayerInfo` 本工程未移植）。 */
    private onShowMember(view: ILeagueMemberView): void {
        if (view.roleId === this.snapshot?.selfRoleId) {
            FW.showTip(LEAGUE_TIP_VIEW_SELF);
            return;
        }
        this.showMemberCard(view);
    }

    /** 看成员：老端走通用玩家信息面板（未移植），这里用联盟已有字段拼一张轻量资料卡。 */
    private showMemberCard(view: ILeagueMemberView): void {
        const positionText = view.position === LeaguePosition.LEADER
            ? LEAGUE_POSITION_LEADER
            : view.position === LeaguePosition.ADMIN
                ? LEAGUE_POSITION_ADMIN
                : '成员';
        const lines = [
            `名称：${view.name}`,
            `等级：${view.levelText}`,
            `战力：${view.powerText}`,
            `职位：${positionText}`,
            `贡献：${view.contributeText}`,
            `状态：${view.timeText}`,
        ];
        void CommonTips.open({
            userData: { title: '成员信息', content: lines.join('\n'), showCancel: false },
        });
    }

    /** 写操作：发出去 → 三态提示 → 重新读缓存铺界面。 */
    private async runMemberOp(
        send: (memberId: string) => Promise<LeagueRequestResult>,
        view: ILeagueMemberView,
    ): Promise<void> {
        const revision = ++this.revision;
        const result = await send(view.roleId);
        if (!this.alive || revision !== this.revision) return;
        this.reportResult(result);
        if (result === 'ok') await this.reloadCurrentTab();
    }

    /** 三态归一：只有 `'ok'` 静默。 */
    private reportResult(result: LeagueRequestResult): void {
        if (result === 'ok') return;
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 公共小工具
    // ============================================================

    private openLevelPreview(): void {
        void LeagueLevelPreviewPage.open({});
    }

    /**
     * 铺列表。
     *
     * ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     *    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private refreshList(list: VirtualScrollView | null, count: number): void {
        if (!list) return;
        void this.deferRefresh(list, count);
    }

    private async deferRefresh(list: VirtualScrollView, count: number): Promise<void> {
        await this.nextPopupFrame();
        if (!this.alive || !list.isValid) return;
        list.refreshList(count);
        list.scrollToTop(false);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /** 旗帜底图 / 外框图名（供需要按名取图的调用方）。 */
    static bannerBaseArt(): string {
        return LEAGUE_ART_BANNER_BASE;
    }
    static bannerFrameArt(): string {
        return LEAGUE_ART_BANNER_FRAME;
    }
}

/** 详情行「离线时长」的三档模板。 */
const LEAGUE_OFFLINE_TEXTS = {
    onlineText: LEAGUE_MEMBER_ONLINE,
    days: LEAGUE_OFFLINE_DAYS,
    hours: LEAGUE_OFFLINE_HOURS,
    minutes: LEAGUE_OFFLINE_MINUTES,
} as const;

/** 动态行的三句模板。 */
const LEAGUE_LOG_TEXTS = {
    join: LEAGUE_LOG_JOIN,
    kick: LEAGUE_LOG_KICK,
    quit: LEAGUE_LOG_QUIT,
} as const;

/** 全服行的三段前缀。 */
const LEAGUE_UNION_TEXTS = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
} as const;

/** 给节点上的 `cc.Sprite` 换帧（节点没有 Sprite 时静默跳过）。 */
function setSprite(node: Node | null, frame: SpriteFrame | null): void {
    if (!node || !frame) return;
    const sprite = node.getComponent(Sprite);
    if (sprite) sprite.spriteFrame = frame;
}
