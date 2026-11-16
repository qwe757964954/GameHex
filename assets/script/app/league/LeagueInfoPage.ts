/**
 * 联盟信息弹窗，数据由调用方以行视图传入，不回缓存按 id 查。
 * 加入按钮不判「是否本盟」，加入成功后不主动关闭。
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
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueInfo';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: Sprite, tooltip: 'Banner/ColorIcon：旗面（按 icon 换图）' })
    bannerColor: Sprite = null;

    @property({ type: Label, tooltip: 'LeagueName：联盟名' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'LeagueLv：等级（`6级`）' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'LeagueLeader：盟主（`盟主:xxx`）' })
    leaderLabel: Label = null;

    @property({ type: Label, tooltip: 'LeagueId：联盟 ID' })
    idLabel: Label = null;

    @property({ type: Label, tooltip: 'LeagueWx：联系微信号' })
    wxLabel: Label = null;

    @property({ type: Label, tooltip: 'LabUser：成员数（`成员:46/51`）' })
    memberLabel: Label = null;

    @property({ type: Label, tooltip: 'DecBox/Content：联盟宣言正文' })
    declarationLabel: Label = null;

    @property({ type: Node, tooltip: 'BtnJoin：加入' })
    joinButton: Node = null;

    /** 本趟铺上来的视图（点「加入」时取它的 id）。 */
    private view: ILeagueInfoView | null = null;

    /** 旗面帧缓存（8 色，只加载一次）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    /** 加入请求在飞（防连点，**本端有意增补**）。 */
    private busy = false;

    // 生命周期

    protected onInit(): void {

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

    // 铺界面

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

    // 加入

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

    // 杂项

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
