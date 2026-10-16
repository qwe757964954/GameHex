/**
 * 「联盟信息」弹窗（老端 `play/LayerLeagueInfo`，`ui/League/LeagueInfo`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅_联盟信息.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「联盟信息」） | (40,254) **640×771** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `league_banner`（`组件_联盟_旗帜`，scale **0.76**） | (113,336) 179×196 | `Banner`（+`Frame` / `Base` / `ColorIcon`） |
 * | `n27` = `white_jiao8`（alpha 0.4 / color `#cbaa85`） | (246,325) 386×184 | `BannerBg` |
 * | `league_name` | (252,336) | `LeagueName` |
 * | `league_leader` | (252,379) | `LeagueLeader` |
 * | `league_lv` | (568,336) | `LeagueLv` |
 * | `league_id` | (252,429) | `LeagueId` |
 * | `league_wx` | (252,462) | `LeagueWx` |
 * | `comp_dec`（`组件_联盟_告示`，标题「联盟宣言」） | (80,524) 560×240 | `DecBox`（+`Bg` / `TitleBar` / `Title` / `Content`） |
 * | `lab_user`「成员:46/51」 | (280,834) | `LabUser` |
 * | `btn_join`（`TY_btn06`，169×70） | (275,883) | `BtnJoin` |
 *
 * ## 高度 771 是**奇数** ⇒ 板根 y = **0.5**
 *
 * `popBg` 高 771 @ y=254 ⇒ 板中心 = `254 + 385.5 = 639.5`，画布中心 640
 * ⇒ 板相对画布中心 **−0.5**（板上移了 0.5）⇒ 根内 y = **+0.5**。
 * 骨架随之：条 `0.5 + 373 = 373.5`、字/闭钮 `0.5 + 375.5 = 376`
 * （解算口径同 `LeagueLevelPreview`：0.5 / 440.5 / 443）。
 *
 * ⚠️ 与「管理」那张一样：老端 `toFullCenterParent` 是**恒等变换**（组件自身就是 720×1280），
 *    所以 FGUI 里那对 `xy` 是最终画布坐标，照抄。
 *
 * ## `n27` 是**盖在旗帜之上**的一层茶色晕影（不是旗帜的底）
 *
 * FGUI `displayList` 的序是 `league_banner` → `n27` → 各 text ⇒ 渲染序**先旗后晕影**
 * （半透明暖调压一层，让白字更跳）。所以本 prefab 的层级也是 `Banner` 在 `BannerBg` **之前**，
 * 别按「背景该在底下」的直觉调换。
 *
 * ## `wxChat` / `declaration` 为什么在**行视图**上
 *
 * 全服页签的 `CmdUnion` 来自 `RequestUnionSearch` 的 **Rsp**，而 `LeagueRepository`
 * **刻意不**把搜索结果写进 `CmdUnion` 缓存表（免得抢「我所在的联盟」那个 `tlKey`，
 * 见该文件类头的说明）⇒ 本面板**不能**靠 id 回缓存查，只能把行数据透传进来。
 * 这就是 `ILeagueUnionView` 后来补上 `wxChat` / `declaration` 两个字段的原因。
 *
 * ## 老端行为对照（`LayerLeagueInfoUI`）
 *
 * ```ts
 * init()      { com.tm("btn_join").setClick(this.onClickJoin, this); }
 * onClickJoin() { let cmd = this.proxy.Union; ModelLeague.RequestLeagueJoin([cmd.id]); }
 * updateView() {
 *     let cmd = this.proxy.Union;
 *     if (cmd) { 铺 8 个节点 }
 *     else { FW.showTip(FW.G_W("LEAGUE_INFO_NOT_FOUND")); this.unload(); }
 * }
 * ```
 *
 * 1. **`cmd` 为空 ⇒ 提示 + 关面板**（老端仅此一处提示），逐字照搬。
 * 2. **「加入」按钮不判「是否本盟」**：老端 `updateView()` 里没有对 `btn_join` 做任何显隐，
 *    两个调用方（全服列表 / 联盟页签的加入列表）也都不展开自己所在的盟 ⇒ 本端保持同口径。
 *    若将来要拦，判据现成：`snapshot.unionId === view.id` 时藏掉（`LeagueRepository.load()`
 *    已经给出 `unionId`）—— 但那属**新增行为**，不在本次迁移范围。
 * 3. **加入成功不关面板**：老端 `.then()` 里什么都不做，靠 `CmdRoleUnion` 的推送去更新别处。
 *    本端照搬（只按三态给提示）——**不**顺手 `close()`。
 *
 * ## 本端有意增补
 *
 * - `busy` 防连点（老端没有）：`join` 是写请求、会走 5s 超时，连点会重复发包。
 *   同 `LeagueApplyListPage.beginWrite()` 的性质。
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
import { leagueRepository, type ILeagueRepository, type LeagueRequestResult } from './LeagueRepository';
import {
    buildLeagueInfoViewFromUnionView,
    type ILeagueInfoTexts,
    type ILeagueInfoView,
    type ILeagueUnionView,
} from './LeagueTable';
import {
    LEAGUE_HALL_ID_PREFIX,
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_HALL_WX_PREFIX,
    LEAGUE_INFO_NOT_FOUND,
    LEAGUE_INFO_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/** 文案前缀（与大厅头部 / 全服行同源）。 */
const INFO_TEXTS: ILeagueInfoTexts = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
    idPrefix: LEAGUE_HALL_ID_PREFIX,
    contactPrefix: LEAGUE_HALL_WX_PREFIX,
};

/** 打开本弹窗的参数（`PopupBase.open({ userData: ... })`）。 */
export interface ILeagueInfoParams {
    /**
     * 要展示的联盟 —— 老端 `LayerLeagueInfo.Union`（`CtrlLeague.OpenLayerLeagueInfo(league)`）。
     *
     * 传的是**全服行视图**（列表点行时手上就有那个对象），不是 id：
     * 搜索结果不在缓存表里，见文件头说明。
     */
    readonly union?: ILeagueUnionView | null;
}

@ccclass('LeagueInfoPage')
export class LeagueInfoPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueInfo';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Sprite, tooltip: 'Banner/ColorIcon：旗面（按 icon 换图）' })
    bannerColor: Sprite = null!;

    @property({ type: Label, tooltip: 'LeagueName：联盟名' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueLv：等级（`6级`）' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueLeader：盟主（`盟主:xxx`）' })
    leaderLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueId：联盟 ID' })
    idLabel: Label = null!;

    @property({ type: Label, tooltip: 'LeagueWx：联系微信号' })
    wxLabel: Label = null!;

    @property({ type: Label, tooltip: 'LabUser：成员数（`成员:46/51`）' })
    memberLabel: Label = null!;

    @property({ type: Label, tooltip: 'DecBox/Content：联盟宣言正文' })
    declarationLabel: Label = null!;

    @property({ type: Node, tooltip: 'BtnJoin：加入' })
    joinButton: Node = null!;

    /** 本趟铺上来的视图（点「加入」时取它的 id）。 */
    private view: ILeagueInfoView | null = null;

    /** 旗面帧缓存（8 色，只加载一次）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    private buttonsBound = false;

    /** 加入请求在飞（防连点，**本端有意增补**）。 */
    private busy = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        if (this.buttonsBound) return;
        this.buttonsBound = true;

        const close = this.closeButton?.getComponent(Button);
        if (close) close.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueInfo] CloseBtn 上没有 cc.Button，点击不会生效');

        const join = this.joinButton?.getComponent(Button);
        if (join) join.node.on(Button.EventType.CLICK, this.onJoinClick, this);
        else console.warn('[LeagueInfo] BtnJoin 上没有 cc.Button，点击不会生效');
    }

    protected onOpen(userData?: ILeagueInfoParams): void {
        const view = buildLeagueInfoViewFromUnionView(userData?.union, INFO_TEXTS);
        if (!view) {
            // 老端 `updateView()` 的 else 分支：提示 + 立刻 unload
            FW.showTip(LEAGUE_INFO_NOT_FOUND);
            this.close();
            return;
        }
        this.view = view;
        this.present(view);
    }

    protected onClose(): void {
        this.view = null;
    }

    // ============================================================
    // 铺界面
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_INFO_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    private present(view: ILeagueInfoView): void {
        if (this.nameLabel) this.nameLabel.string = view.name;
        if (this.levelLabel) this.levelLabel.string = view.levelText;
        if (this.leaderLabel) this.leaderLabel.string = view.leaderText;
        if (this.idLabel) this.idLabel.string = view.idText;
        if (this.wxLabel) this.wxLabel.string = view.wxText;
        if (this.memberLabel) this.memberLabel.string = view.memberText;
        if (this.declarationLabel) this.declarationLabel.string = view.declaration;
        void this.applyBannerColor(view.icon);
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
    // 加入
    // ============================================================

    /**
     * 老端 `onClickJoin()`：`RequestLeagueJoin([cmd.id])`
     * （协议 `unionIds` 是**数组**，见 `ILeagueRepository.join` 的说明）。
     */
    private async onJoinClick(): Promise<void> {
        if (this.busy) return;
        const view = this.view;
        if (!view) return;

        this.busy = true;
        try {
            const result: LeagueRequestResult = await this.repository.join([view.id], this);
            if (!this.alive) return;
            // 老端 `.then()` 里什么都不做（不关面板、不刷新）⇒ 只按三态给提示
            if (result === 'ok') return;
            FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
        } finally {
            this.busy = false;
        }
    }

    // ============================================================
    // 杂项
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
