/**
 * 北伐排行行 —— FGUI `主界面_联盟/副本/北伐中原/组件_联盟_北伐中原_排行Item.xml`（550×130）。
 *
 * ## 一条行**两种版式**（靠 `标签` controller 切，两页的字段完全不同）
 *
 * | controller 页 | 本类里的节点 | 老端渲染函数 |
 * |---|---|---|
 * | 0「排名」 | `RankFields`（联盟名 / 伤害 / 人数 / 两个奖励格） | `renderRank()` |
 * | 1「进度」 | `ProgressFields`（头像 / 玩家名 / 伤害 / 战斗力） | `renderProgress()` |
 *
 * 两页**互斥显示**（FGUI `gearDisplay pages="0"` / `pages="1"`），但**数据一次算全**
 * （`ILeagueNorthRankRowView` 两个版式的字段都有）⇒ 本类按 `tab` 决定铺哪一半、
 * 并把另一半整块藏掉（不做半铺装，免得切页签时闪出上一版的残影）。
 *
 * ## `显示背景` controller（本行独有的第二个控制器）
 *
 * `0 = 显示` / `1 = 不显示`。面板上的 `heroItem`（我的名次，独立于列表）用的是**第 1 页**
 * （`controller="显示背景,1"`）—— 因为那一格下面已经垫了一整块 `n13`（594×160），
 * 再画 550×130 的行底就是两层框。列表里的行用第 0 页。
 *
 * ⇒ 本类用 `showBackground` 开关（由 `render()` 的入参给），**不**从节点树上猜。
 *
 * ## 名次那一格
 *
 * FGUI `rank`（`组件_联盟_北伐中原_排名`，60×60）自己也是一个 5 页控制器：
 * `0 第一名 / 1 第二名 / 2 第三名 / 3 第N名 / 4 未上榜`。
 * ⚠️ 老端**从来只切到「第一名」或「未上榜」两页**（`setSelectedPage("标签", data.rank == -1 ? "未上榜" : "第一名")`）
 *    —— 前 3 名没有专属的奖牌图，`rank.lab` 就是统一的白字数字。照抄，不"补全"。
 */

import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ILeagueNorthRankRowView } from './LeagueTable';
import { LEAGUE_NORTH_RANK_UNRANKED } from './LeagueTexts';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import type { ILeagueRewardArt } from './LeagueRewardArt';

const { ccclass, property } = _decorator;

/** 排行行展示哪一页（= 面板的两个页签）。 */
export type LeagueNorthRankRowMode = 'rank' | 'progress';

@ccclass('LeagueNorthRankRow')
export class LeagueNorthRankRow extends Component {
    // ---------- 名次格（两页共用） ----------

    @property({ type: Sprite, tooltip: 'RowBg：行底框（`显示背景` 控制器第 1 页时藏掉）' })
    rowBg: Sprite = null!;

    @property({ type: Label, tooltip: 'Rank/lab：名次数字（未上榜时整块换成 Unranked）' })
    rankLabel: Label = null!;

    @property({ type: Node, tooltip: 'Rank/Unranked：「未上榜」那块（名次 = -1 时显示）' })
    unranked: Node = null!;

    // ---------- 「联盟排名」页 ----------

    @property({ type: Node, tooltip: 'RankFields：联盟名 / 伤害 / 人数 / 奖励（第 0 页）' })
    rankFields: Node = null!;

    @property({ type: Label, tooltip: 'leagueName：联盟名' })
    leagueName: Label = null!;

    @property({ type: Label, tooltip: 'leaguePower：联盟伤害（`formatNumberToZH`）' })
    leaguePower: Label = null!;

    @property({ type: Label, tooltip: 'lab_role：人数（`count/maxCount`）' })
    roleCount: Label = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods：奖励格 1' })
    rewardSlot: LeagueRewardSlot = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods1：奖励格 2' })
    rewardSlot1: LeagueRewardSlot = null!;

    // ---------- 「盟内进度」页 ----------

    @property({ type: Node, tooltip: 'ProgressFields：头像 / 玩家名 / 伤害 / 战斗力（第 1 页）' })
    progressFields: Node = null!;

    @property({ type: Sprite, tooltip: 'com_head/Icon：头像内层（本端解析不出玩家头像 ⇒ 隐藏）' })
    headIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'userName：玩家名' })
    userName: Label = null!;

    @property({ type: Label, tooltip: 'userPower：伤害（`numAbbr` 缩写）' })
    userPower: Label = null!;

    @property({ type: Label, tooltip: '文本_战斗力：战斗力/伤害那一格（同 `numAbbr`）' })
    powerText: Label = null!;

    /** 当前铺在这一行的数据（`null` = 没铺）。 */
    private current: ILeagueNorthRankRowView | null = null;

    /**
     * 铺一行。
     *
     * @param view           行视图（`null` ⇒ 整行藏掉）
     * @param tab            当前页签（决定铺哪一半、藏哪一半）
     * @param art            本趟预载好的奖励图帧（第 0 页的两个奖励格用）
     * @param showBackground 是否画行底框（列举行 = true；`heroItem` = false）
     */
    render(
        view: ILeagueNorthRankRowView | null,
        tab: LeagueNorthRankRowMode,
        art: ILeagueRewardArt | null,
        showBackground: boolean,
    ): void {
        this.current = view;
        if (!view) {
            this.node.active = false;
            return;
        }
        this.node.active = true;

        if (this.rowBg) this.rowBg.node.active = showBackground;

        // ---- 名次格（两页共用）----
        const ranked = view.rank > 0;
        if (this.rankLabel) {
            this.rankLabel.node.active = ranked;
            this.rankLabel.string = ranked ? String(view.rank) : '';
        }
        if (this.unranked) {
            this.unranked.active = !ranked;
            // 「未上榜」是 FGUI 里那颗 `n10` 的静态文案 —— 只在未上榜那页显示
            const label = this.unranked.getComponent(Label);
            if (label && !label.string) label.string = LEAGUE_NORTH_RANK_UNRANKED;
        }

        const rankMode = tab === 'rank';
        if (this.rankFields) this.rankFields.active = rankMode;
        if (this.progressFields) this.progressFields.active = !rankMode;

        if (rankMode) this.renderRank(view, art);
        else this.renderProgress(view);
    }

    // ============================================================
    // 内部
    // ============================================================

    /** 第 0 页：联盟名 / 伤害 / 人数 / 两个奖励格（老端 `renderRank()`）。 */
    private renderRank(view: ILeagueNorthRankRowView, art: ILeagueRewardArt | null): void {
        if (this.leagueName) this.leagueName.string = view.leagueName;
        if (this.leaguePower) this.leaguePower.string = view.powerText;
        if (this.roleCount) this.roleCount.string = view.roleCountText;

        // ⚠️ 老端：名次落在奖励区间里才显示两颗物品框，否则 `visible = false`（**不隐藏行**）。
        //    未上榜（rank = -1）永远查不到区间 ⇒ 两颗都藏。
        const slots: readonly (LeagueRewardSlot | null)[] = [this.rewardSlot, this.rewardSlot1];
        for (let i = 0; i < slots.length; i += 1) {
            const slot = slots[i];
            if (!slot) continue;
            const reward = view.rewards[i];
            if (!reward) {
                slot.node.active = false;
                continue;
            }
            const frames = art ? art.framesOf(reward.resId) : { frame: null, icon: null };
            slot.node.active = true;
            slot.render(frames.frame, frames.icon, reward.number, true);
        }
    }

    /** 第 1 页：头像 / 玩家名 / 伤害 / 战斗力（老端 `renderProgress()`）。 */
    private renderProgress(view: ILeagueNorthRankRowView): void {
        if (this.userName) this.userName.string = view.userName;
        if (this.userPower) this.userPower.string = view.powerAbbrText;
        if (this.powerText) this.powerText.string = view.powerAbbrText;

        // ⚠️ 老端 `head.SetUrlByIcon(ModelPlayer.GetPlayerIcon(usedSkinResId))` ——
        //    玩家头像系统（`ModelPlayer.GetPlayerIcon`）在 Demo3.8**没迁**（同战斗入口那条）
        //    ⇒ 头像内层恒隐藏，只留 `img_Touxiang_01` 那个空框（**不画问号占位**，同
        //    `LeagueRewardSlot.render` 对「解析不出图标」的处置）。等头像系统落地后把这里换成查表即可。
        if (this.headIcon) this.headIcon.node.active = false;
    }

    /** 当前铺的数据（探针 / 单测用）。 */
    get view(): ILeagueNorthRankRowView | null {
        return this.current;
    }
}
