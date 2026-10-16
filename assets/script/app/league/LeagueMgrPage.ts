/**
 * 「联盟管理」弹窗（老端 `play/LayerLeagueHallMgr`，`ui/League/LeagueMgr`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅_管理.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「联盟管理」） | (40,185) **640×979** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `league_banner`（`组件_联盟_旗帜`，scale **0.76**） | (113,267) 179×196 | `Banner`（+`Frame` / `Base` / `ColorIcon`） |
 * | `league_name` | (252,267) | `LeagueName` |
 * | `league_id` | (252,311) | `LeagueId` |
 * | `league_wx` | (252,344) | `LeagueWx` |
 * | `league_copyid`（`lm_btn01`） | (579,312) 28×30 | `CopyId` |
 * | `btnName` / `btnWx`（**无图热区**） | (253,266) / (252,343) | `NameHot` / `WxHot` |
 * | `comp_dec`（`组件_联盟_告示`，标题「联盟宣言」） | (80,423) 560×240 | `DecBox`（+`Bg` / `TitleBar` / `Title` / `Content`） |
 * | `comp_notice`（同组件，标题「联盟公告」） | (80,672) 560×240 | `NoticeBox`（同上） |
 * | `btn_mgr`（`TY_btn10`，页 1） | (386,976) 218×106 | `BtnMgr` |
 * | `btn_quit`（`TY_btn09`，页 1） | (115,976) 218×106 | `BtnQuit` |
 * | `btn_quit1`（`TY_btn09`，**页 0**） | (251,976) 218×106 | `BtnQuitOnly` |
 * | `按钮_勾选`（页 1） | (94,921) 50×50 | `QuickJoinBox`（+`Check`） |
 * | `n23`「允许快速加入」（页 1） | (139,929) | `QuickJoinLabel` |
 *
 * ## 高度是**奇数** ⇒ 板根 y = **−34.5**（不是 0）
 *
 * `popBg` 高 979 @ y=185 ⇒ 板中心 = `185 + 489.5 = 674.5`，画布中心 640
 * ⇒ 板相对画布中心 **+34.5**（y 向下为正）⇒ 根内 y = **−34.5**。
 *
 * ⚠️ 这里**没有**「恒居中」可用：老端确实调了 `com.toFullCenterParent(t.container)`，
 *    但组件自身 `size="720,1280"` = 整块画布 ⇒ 「居中」是恒等变换，
 *    FGUI 里那对 `xy` 就是**最终画布坐标**（`LeagueLevelPreview` / `LeagueEdit` 同理）。
 *    这张面板与那两张的区别只是「设计态没摆正中」—— 照抄即可，不要顺手摆到 640。
 *
 * ## 骨架为什么是 442.5 / 445（不是 440.5 / 443）
 *
 * 骨架（标题条 / 字 / 闭钮）的 `xy` 在 `组件_公共弹窗_新` 里是**相对 popBg 顶边**的
 * （常数：条 12.5、字/闭钮 10）⇒ 落根坐标 = 板根 y + 板半高 − 常数。
 * 板半高 = 489.5、板根 y = −34.5 ⇒ 条 `−34.5 + 477 = 442.5`、字/闭钮 `−34.5 + 479.5 = 445`。
 * 与已收口的等级预览（0.5 / 440.5 / 443）、申请列表（0 / 340.5 / 343）、
 * 编辑信息（0.5 / 206.5 / 209）同一套解算。
 *
 * ## 「管理」controller 是**两页互斥**的显隐，不是页签
 *
 * 老端 `updateView()` 里 `com.setSelectedPage("管理", model.GetMyMember().CanApprove() ? "是" : "否")`：
 *
 * | 页 | 可见 |
 * |---|---|
 * | `1`(`是`) | `btn_mgr` + `btn_quit`（居左）+ `按钮_勾选` + `n23` |
 * | `0`(`否`) | 只有 `btn_quit1`（**居中**） |
 *
 * 落地口径见 `LeagueTable.leagueMgrPage` —— 页面只把 4 + 1 个节点按页开关，不做任何几何调整。
 *
 * ## 老端行为对照
 *
 * 1. **四个编辑入口**（`btnName` / `btnWx` / `comp_dec` / `comp_notice`）每个都被
 *    `if (model.GetMyMember().CanEditor())` 包住 ⇒ 无权限时**点了什么都不发生**（老端不提示）。
 *    本端照搬（只 `console.warn` 一条，不弹提示）。
 * 2. **编辑结果靠推送刷新**：老端 `init()` 里挂了 `VOUnionBag` / `VORoleUnionBag` 的 `OnChanged`。
 *    本端改成 `onReveal()` 重新读一次缓存 —— 编辑信息弹窗关掉后本面板会被「重新露出」，
 *    那一拍正好把新名字 / 新宣言铺上来（不必给自己挂推送监听）。
 * 3. **「允许快速加入」在 `exitAfter()` 才发包**（不是在勾选的瞬间）：
 *    `if (IsJoinedLeague() && CanEditor()) { if (select != cmd.autoJoin) RequestLeagueSetQuickJoin(select) }`
 *    ⇒ 本端放在 `onClose()`。**这是有意的**：勾一下发一次包会产生一串中间态，
 *    而服务端会广播 `CmdUnionInfoUpdateBroMsg` 把勾选框按推送回写 ⇒ 界面会自己跳。
 * 4. **未入盟直接关**：老端 `if (!IsJoinedLeague()) return this.unload()`（**不提示**）。本端照搬。
 * 5. **退出联盟**：`btn_quit` / `btn_quit1` 绑同一方法 ⇒ 开 `LeagueExitConfirm`，
 *    点「确定」后**先关本面板再发包**（老端 `OpenLayerLeagueExitConfirm(this.unload.bind(this))`
 *    的 `onSure` 就是「先 unload 自己、再 `RequestLeagueQuit()`」）。
 *
 * ## 本端有意增补（与老端的偏差，逐条列出）
 *
 * - 勾选框**点击后立即翻本地面板态**（`quickJoinCheck.active`）：老端靠 FGUI
 *   `Button(mode="Check")` 自管，本端没有 controller 组件，所以自己持一个 `actualJoin` 字段 +
 *   显隐那颗勾（`QuickJoinBox/Check`）。
 * - 复制 ID 按钮（`league_copyid`）老端**没接线**，本端沿用大厅的占位口径（`copyLeagueText`）。
 */

import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadArt } from '../card/CardLineupIcons';
import {
    LEAGUE_ART_ROOT,
    LEAGUE_BANNER_COLOR_COUNT,
    leagueBannerArt,
} from './LeagueArt';
import { LeagueApplyListPage } from './LeagueApplyListPage';
import { openLeagueExitConfirm } from './LeagueExitConfirm';
import { LeagueEditPage } from './LeagueEditPage';
import {
    leagueRepository,
    LeagueEditType,
    type ILeagueRepository,
    type LeagueRequestResult,
} from './LeagueRepository';
import {
    buildLeagueMgrView,
    canApproveJoin,
    canEditUnion,
    leagueMgrPage,
    type ILeagueMgrTexts,
    type ILeagueMgrView,
} from './LeagueTable';
import {
    LEAGUE_HALL_ID_PREFIX,
    LEAGUE_HALL_WX_PREFIX,
    LEAGUE_MGR_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';
import { copyLeagueText } from './LeagueClipboard';

const { ccclass, property } = _decorator;

/** 文案前缀（`idPrefix` / `contactPrefix` 与大厅头部同源）。 */
const MGR_TEXTS: ILeagueMgrTexts = {
    idPrefix: LEAGUE_HALL_ID_PREFIX,
    contactPrefix: LEAGUE_HALL_WX_PREFIX,
};

@ccclass('LeagueMgrPage')
export class LeagueMgrPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueMgr';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Sprite, tooltip: 'Banner/ColorIcon：旗面（按 icon 换图）' })
    bannerColor: Sprite = null!;

    @property({ type: Label, tooltip: 'LeagueName：联盟名（可点，改名字）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueId：联盟 ID' })
    idLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueWx：联系微信号（可点，改微信号）' })
    wxLabel: Label = null!;

    @property({ type: Node, tooltip: 'CopyId：复制联盟 ID' })
    copyIdButton: Node = null!;

    @property({ type: Node, tooltip: 'NameHot：联盟名的点击热区（无图）' })
    nameButton: Node = null!;

    @property({ type: Node, tooltip: 'WxHot：微信号的点击热区（无图）' })
    wxButton: Node = null!;

    @property({ type: Node, tooltip: 'DecBox：联盟宣言块（点它改宣言）' })
    declarationButton: Node = null!;

    @property({ type: Node, tooltip: 'NoticeBox：联盟公告块（点它改公告）' })
    noticeButton: Node = null!;

    @property({ type: Label, tooltip: 'DecBox/Content：宣言正文' })
    declarationLabel: Label = null!;

    @property({ type: Label, tooltip: 'NoticeBox/Content：公告正文' })
    noticeLabel: Label = null!;

    @property({ type: Node, tooltip: 'BtnMgr：申请管理（仅「是」页可见）' })
    mgrButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnQuit：退出联盟（仅「是」页可见，居左）' })
    quitButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnQuitOnly：退出联盟（仅「否」页可见，居中）' })
    quitOnlyButton: Node = null!;

    @property({ type: Node, tooltip: 'QuickJoinBox：允许快速加入勾选框（仅「是」页可见）' })
    quickJoinButton: Node = null!;

    @property({ type: Node, tooltip: 'QuickJoinBox/Check：勾（选中才显示）' })
    quickJoinCheck: Node = null!;

    @property({ type: Node, tooltip: 'QuickJoinLabel：勾选框右侧的说明文字（仅「是」页可见）' })
    quickJoinLabel: Node = null!;

    /** 本趟铺上来的视图（`onClose` 时拿它比对「勾选变了没」）。 */
    private view: ILeagueMgrView | null = null;

    /** 勾选框的**当前面板态**（不是数据态；老端 `按钮_勾选.selected`）。 */
    private actualJoin = false;

    /** 我的职位能否审批（决定显示哪一页）。 */
    private canApprove = false;

    /** 我的职位能否编辑联盟信息（四个编辑入口 + 快速加入发包的守卫）。 */
    private canEdit = false;

    /** 旗面帧缓存（8 色，只加载一次）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    private buttonsBound = false;

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
        else console.warn('[LeagueMgr] CloseBtn 上没有 cc.Button，点击不会生效');

        this.bindClick(this.nameButton, () => this.openEditor(LeagueEditType.NAME, this.view?.name));
        this.bindClick(this.wxButton, () => this.openEditor(LeagueEditType.WX, this.view?.wxChat));
        this.bindClick(this.declarationButton,
            () => this.openEditor(LeagueEditType.DECLARATION, this.view?.declaration));
        this.bindClick(this.noticeButton,
            () => this.openEditor(LeagueEditType.NOTICE, this.view?.notice));

        this.bindClick(this.copyIdButton, () => this.onCopyId());
        this.bindClick(this.mgrButton, () => void LeagueApplyListPage.open());
        // 两颗「退出联盟」都开同一个二次确认（老端 `btn_quit` / `btn_quit1` 绑同一方法）
        this.bindClick(this.quitButton, () => this.onQuitClick());
        this.bindClick(this.quitOnlyButton, () => this.onQuitClick());
        this.bindClick(this.quickJoinButton, () => this.toggleQuickJoin());
    }

    /** 复制联盟 ID（老端没接线，本端接通）。 */
    private onCopyId(): void {
        const id = this.view?.id ?? '';
        if (!id) {
            FW.showTip('联盟ID为空');
            return;
        }
        copyLeagueText(id);
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    /**
     * 重新露出（上层弹窗关掉）⇒ 重读一次缓存。
     *
     * 用它的场景只有一个：本面板点了联盟名 / 微信号 / 宣言 / 公告 ⇒ 开 `LeagueEditPage`，
     * 编辑框关掉之后本面板会被 `PopupManager._refreshCover()` 重新露出，
     * 这一拍正好把「新名字 / 新宣言」铺上来（老端靠 `VOUnionBag` 的推送做同一件事）。
     */
    protected onReveal(): void {
        void this.reload();
    }

    /**
     * 关面板 —— 老端 `exitAfter()`：**这一刻**才决定要不要发「快速加入」。
     *
     * ⚠️ 不走 `async`：`onClose` 是同步钩子，发包是 fire-and-forget（老端也是 `.then()` 不 await）。
     *    这里不做 revision 校验 —— 面板已经关了，结果只影响一条提示。
     */
    protected onClose(): void {
        this.revision += 1;
        this.flushQuickJoin();
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数 / 铺界面
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_MGR_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 读一次缓存 → 铺界面。
     *
     * ⚠️ **不主动发包**：老端这张面板只挂推送监听（`VOUnionBag` / `VORoleUnionBag` 的 `OnChanged`），
     *    明细数据由大厅母面板的 `requestDetail` 负责拉。本端保持一致 ——
     *    「从大厅点管理进来」时缓存里必然已经有我这盟那一行。
     *    未入盟 / 数据还没推回来 ⇒ 老端口径是**静默 `unload()`**，本端照搬（只 warn 一条）。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;

        this.canApprove = canApproveJoin(snapshot.myPosition, snapshot.officialPowers);
        this.canEdit = canEditUnion(snapshot.myPosition, snapshot.officialPowers);

        const view = buildLeagueMgrView(snapshot.myUnion, MGR_TEXTS);
        if (!view) {
            // 老端：`if (!IsLeagueJoined()) return this.unload()` —— 不提示
            console.warn('[LeagueMgr] 未入盟 / 联盟数据未就绪，按老端口径直接关闭');
            this.close();
            return;
        }

        this.view = view;
        this.actualJoin = view.autoJoin;
        this.present(view);
    }

    private present(view: ILeagueMgrView): void {
        if (this.nameLabel) this.nameLabel.string = view.name;
        if (this.idLabel) this.idLabel.string = view.idText;
        if (this.wxLabel) this.wxLabel.string = view.wxText;
        if (this.declarationLabel) this.declarationLabel.string = view.declaration;
        if (this.noticeLabel) this.noticeLabel.string = view.notice;
        void this.applyBannerColor(view.icon);
        this.applyPage(leagueMgrPage(this.canApprove));
        this.applyQuickJoin(this.actualJoin);
    }

    /**
     * 切「管理」controller 的两页（老端 `com.setSelectedPage("管理", 「是」/「否」)`）。
     *
     * ⚠️ 这是**互斥显隐**：页 1 露 4 个节点、页 0 只露中间那颗 `btn_quit1`。
     *    注意 `PopupBase` 的「点空白关闭」是按**激活的直接子节点**算内容区的
     *    ⇒ 切 `active` 的同时空白判定也跟着变（隐藏的那颗不再算内容），正好。
     */
    private applyPage(page: 0 | 1): void {
        const show = page === 1;
        this.setActive(this.mgrButton, show);
        this.setActive(this.quitButton, show);
        this.setActive(this.quickJoinButton, show);
        this.setActive(this.quickJoinLabel, show);
        this.setActive(this.quitOnlyButton, !show);
    }

    /** 勾选框显隐（FGUI `gearDisplay controller="button" pages="1"`）。 */
    private applyQuickJoin(checked: boolean): void {
        this.setActive(this.quickJoinCheck, checked);
    }

    /** 旗面按颜色下标**换图**（FGUI 是 `gearIcon` 换图，不是给一张图染色）。 */
    private async applyBannerColor(colorIndex: number): Promise<void> {
        if (!this.bannerColor) return;
        if (!this.bannerFrames) {
            const names: string[] = [];
            for (let index = 0; index < LEAGUE_BANNER_COLOR_COUNT; index += 1) names.push(leagueBannerArt(index));
            const frames = await Promise.all(names.map((name) => loadArt(name, LEAGUE_ART_ROOT)));
            if (!this.alive) return;
            this.bannerFrames = frames;
        }
        const frame = this.bannerFrames[colorIndex] ?? null;
        if (frame) this.bannerColor.spriteFrame = frame;
    }

    // ============================================================
    // 四个编辑入口（每一条都被 `CanEdit` 守卫 —— 老端同此）
    // ============================================================

    /**
     * 开「编辑信息」弹窗。
     *
     * ⚠️ `content` 一律传**裸值**（老端 `OpenLayerLeagueEdit(cmd.name, 1)` /
     *    `(cmd.wxChat, 2)` / `(cmd.notice, 3)` / `(cmd.declaration, 4)`）——
     *    尤其微信号：**不能**传带「微信号：」前缀的 `wxText`，否则前缀会被当正文改掉。
     */
    private openEditor(type: number, content: string | undefined): void {
        if (!this.canEdit) {
            console.warn('[LeagueMgr] 当前职位不能编辑联盟信息（老端此处静默）');
            return;
        }
        void LeagueEditPage.open({ userData: { type, content: content ?? '' } });
    }

    // ============================================================
    // 退出联盟
    // ============================================================

    private onQuitClick(): void {
        openLeagueExitConfirm(() => {
            // 老端 `onSure()`：先 unload 自己，再 `RequestLeagueQuit()`
            this.close();
            void this.repository.quit(this);
        });
    }

    // ============================================================
    // 允许快速加入
    // ============================================================

    /**
     * 勾 / 取消勾 —— **只改本地面板态**，不发包。
     *
     * 发包时机见 `onClose()`（老端 `exitAfter()`）。
     */
    private toggleQuickJoin(): void {
        this.actualJoin = !this.actualJoin;
        this.applyQuickJoin(this.actualJoin);
    }

    /**
     * 老端 `exitAfter()`：
     * ```ts
     * if (IsJoinedLeague() && GetMyMember().CanEditor()) {
     *     let select = 按钮_勾选.selected;
     *     if (select != cmd.autoJoin) RequestLeagueSetQuickJoin(select).then(() => {});
     * }
     * ```
     * ⇒ **无权限不发**、**值没变不发**。
     */
    private flushQuickJoin(): void {
        if (!this.canEdit) return;
        const saved = this.view?.autoJoin;
        if (saved === undefined) return;
        if (this.actualJoin === saved) return;
        void this.sendQuickJoin(this.actualJoin);
    }

    private async sendQuickJoin(quick: boolean): Promise<void> {
        const result: LeagueRequestResult = await this.repository.setQuickJoin(quick, this);
        if (result === 'ok') return;
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 杂项
    // ============================================================

    /** 按名字接按钮；节点有 `cc.Button` 走 CLICK，否则退回 `TOUCH_END`（缺节点只 warn）。 */
    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueMgr] 按钮节点缺失，点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private setActive(node: Node | null, active: boolean): void {
        if (node && node.isValid) node.active = active;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
