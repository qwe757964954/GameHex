/**
 * 「北伐中原 · 排行」弹窗 —— 老端 `play/LayerLeagueNorthernExpeditionRank.ts`，
 * prefab `ui/League/LeagueNorthRank`。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/副本/北伐中原/组件_联盟_北伐中原_排行.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（`组件_公共弹窗_新`，标题=排名） | (40,162) 640×895 | `PopBg`（**公共弹窗骨架实例**） |
 * | `n5` 表头底条（`BB_img03`，`alpha 0.5`） | (104,223) 488×32 | 含在 `popBg` 内（表头） |
 * | `n6`/`n7`/`n8`/`n9` 表头文字（排名/联盟及伤害/人数/奖励） | y=225 | `HeaderRank` 一组（静态） |
 * | `n10`/`n11` 表头文字（伤害总量/玩家信息） | y=226 | `HeaderProgress` 一组（静态） |
 * | `list`（`overflow=scroll`、`lineGap=10`、9 项） | (85,270) **550×537** | `RankList`（`VirtualScrollView`） |
 * | `defaultItem` = `组件_联盟_北伐中原_排行Item`（550×130） | — | `RankList/content/RankRow` |
 * | `n13` 我的名次底板（`frame_Zhikuang01`） | (63,783) 594×160 | `MyBg` |
 * | `heroItem`（排行Item，`controller="显示背景,1"`） | (84,793) 550×130 | `HeroItem`（**不画行底框**） |
 * | `n12` 发奖说明（26px `#fcf0d6` bold + 描边 `#160e08`/2） | (120,944) 480×36 | `AwardTip`（静态文案） |
 * | `tab_rank`（`组件_联盟_页签`，title=联盟排名，checked） | (76,1013) 207×105 | `TabRank`（`LeagueNorthTab`） |
 * | `tab_progress`（同上，title=盟内进度） | (293,1013) | `TabProgress`（`LeagueNorthTab`） |
 *
 * ⚠️ 表头两行（`n7`..`n11`）分别属于两个 group `n15`/`n16`，各带 `gearDisplay pages=0` / `pages=1`
 *    ⇒ **随页签显隐**。本端把它们做成两组节点，`applyTabPage()` 里按当前页签整块切 `active`。
 *
 * ## 老端行为与移植取舍
 *
 * 1. **两个页签 = 两个 `rankType`**：`[24, 22][页签]`（`getRankType()`），
 *    切换时**重新发一次** `RequestGetRank` —— 请求体见 `LeagueRepository.loadNorthRank`。
 *    老端 `init()` 先把页签置到「联盟排名」，`enter()` 里才发第一条包 ⇒ 本端 `onOpen` 里
 *    以 `rank` 页签进 `reload()` 即可（`loadNorthRank` 内部按页签发）。
 * 2. **`heroItem` 是「我的名次」那一格**：老端 `updateView()` 里对 `rsp.rankInfo.myRank` 单独
 *    渲染一次 `heroItem`；**响应里没有 `myRank` 时老端会抛**（`renderRank(undefined)` 取 `.rank`）
 *    ⇒ 本端 `myRow === null` 时**整块藏掉**（`MyBg` + `HeroItem` 一起），不抛也不画空行。
 * 3. **名次格的两页**：老端 `rank.lab` 恒定写 `data.rank`、`setSelectedPage("标签", rank == -1 ? "未上榜" : "第一名")`
 *    —— 前 3 名**没有专属奖牌图**（`组件_联盟_北伐中原_排名` 的 `第一名` 页就是那颗白字 `lab`）。
 *    本端把这条口径收在 `LeagueNorthRankRow.render()` 里（`rank > 0` ⇒ 显示数字，否则「未上榜」）。
 * 4. **头像**：老端 `head.SetUrlByIcon(ModelPlayer.GetPlayerIcon(usedSkinResId))` —— 玩家头像系统
 *    Demo3.8 没迁 ⇒ 头像内层恒隐藏（同主面板 boss 立绘那条）。`LeagueNorthRankRow` 里已处置。
 *
 * ## 本端有意增补
 *
 * - `!ok` 时**保留上一趟数据**（不清空成 0 行）+ 提示 —— 老端只有推送刷新、没有这个岔路，
 *   但本端排行是「请求-响应」式，超时/离线时把列表清空会看着像「没人上榜」，那是错的。
 * - 页签切换的 `revision` 闸：连点两个页签时，先到的响应不许覆盖后点的结果。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT } from './LeagueArt';
import { LeagueNorthRankRow } from './LeagueNorthRankRow';
import { LeagueNorthTab, LEAGUE_NORTH_TAB_ART_NAMES } from './LeagueNorthTab';
import {
    leagueRepository,
    type ILeagueNorthRankSnapshot,
    type ILeagueRepository,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import type { ILeagueNorthRankRowView, LeagueNorthRankTab } from './LeagueTable';
import {
    LEAGUE_NORTH_RANK_AWARD_TIP,
    LEAGUE_NORTH_TAB_PROGRESS,
    LEAGUE_NORTH_TAB_RANK,
    LEAGUE_TIP_FAILED,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueNorthRankPage')
export class LeagueNorthRankPage extends PopupBase {
    /** ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）。 */
    static prefabPath = 'ui/League/LeagueNorthRank';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    /**
     * `TabRank` / `TabProgress`：两个页签。
     *
     * ⚠️ 与 `heroItem` 同理 —— 页签是 `LeagueNorthTab.prefab` 的**嵌套实例** ⇒ 绑节点，
     *    运行时 `getComponent(LeagueNorthTab)`。
     */
    @property({ type: Node, tooltip: 'TabRank：「联盟排名」页签（默认选中）' })
    tabRank: Node = null;

    @property({ type: Node, tooltip: 'TabProgress：「盟内进度」页签' })
    tabProgress: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'RankList：名次列表（虚拟列表）' })
    rankList: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'MyBg：我的名次底板（n13，594×160）' })
    myBg: Node = null;

    /**
     * `HeroItem`：我的名次那一行（**不画行底框**）。
     *
     * ⚠️ 这里绑的是**节点**而不是组件 —— `HeroItem` 是 `LeagueNorthRankRow.prefab` 的
     *    **嵌套实例**，实例壳上的脚本组件跨 prefab 引用在编辑器里序列化不可靠
     *    （同 `LeagueTaskPage.box1/box2/box3` 对 `LeagueTaskBox` 的处置）
     *    ⇒ 绑节点、运行时 `getComponent(LeagueNorthRankRow)`。
     */
    @property({ type: Node, tooltip: 'HeroItem：我的名次那一行的节点（挂 LeagueNorthRankRow）' })
    heroItem: Node = null;

    @property({ type: Node, tooltip: 'HeaderRank：联盟排名页的表头（n15，随页签显隐）' })
    headerRank: Node = null;

    @property({ type: Node, tooltip: 'HeaderProgress：盟内进度页的表头（n16，随页签显隐）' })
    headerProgress: Node = null;

    @property({ type: Label, tooltip: 'AwardTip：发奖说明（n12，静态文案）' })
    awardTip: Label = null;

    /** 当前页签。 */
    private tab: LeagueNorthRankTab = 'rank';

    /** 两个页签的脚本实例（`onInit` 里从嵌套实例壳上取一次）。 */
    private tabRankRef: LeagueNorthTab | null = null;
    private tabProgressRef: LeagueNorthTab | null = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueNorthRankRowView[] = [];

    /** 本趟的奖励图帧（第 0 页两颗物品框用）。 */
    private art: ILeagueRewardArt | null = null;

    /** 页签底图（读一次就够）。 */
    private tabFramesReady = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const button = this.closeButton?.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueNorthRank] CloseBtn 上没有 cc.Button，点击不会生效');

        // 页签与 HeroItem 都是嵌套实例 ⇒ 运行时从壳上取脚本（见各自的 @property 注释）
        this.tabRankRef = this.tabRank ? this.tabRank.getComponent(LeagueNorthTab) : null;
        this.tabProgressRef = this.tabProgress ? this.tabProgress.getComponent(LeagueNorthTab) : null;

        if (this.rankList) this.rankList.renderItemFn = (node, index) => this.renderRow(node, index);
        if (this.tabRankRef) this.tabRankRef.onTabClick = () => void this.onTabClick('rank');
        if (this.tabProgressRef) this.tabProgressRef.onTabClick = () => void this.onTabClick('progress');
        if (this.awardTip) this.awardTip.string = LEAGUE_NORTH_RANK_AWARD_TIP;
        // 页签文案由图里的静态文字兜底，这里再写一遍（改文案表时不用回 prefab 改）
        if (this.tabRankRef) this.tabRankRef.setTitle(LEAGUE_NORTH_TAB_RANK);
        if (this.tabProgressRef) this.tabProgressRef.setTitle(LEAGUE_NORTH_TAB_PROGRESS);
        this.applyTabPage();
    }

    protected async onOpen(): Promise<void> {
        // 老端 `init()` 先把页签置到「联盟排名」（本类字段初值即 'rank'）
        await this.loadTabFrames();
        if (!this.alive) return;
        this.applyTabPage();
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 数据端口
    // ============================================================

    static get titleText(): string {
        return '排名';
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    // ============================================================
    // 页签
    // ============================================================

    /** 页签切换（`rank` = 联盟排名 / `progress` = 盟内进度）。 */
    private async onTabClick(tab: LeagueNorthRankTab): Promise<void> {
        if (tab === this.tab) return;
        this.tab = tab;
        this.applyTabPage();
        await this.reload();
    }

    /** 把当前页签落到两颗按钮 + 两行表头 + 我的那行（重铺一次，因为版式不同）。 */
    private applyTabPage(): void {
        if (this.tabRankRef) this.tabRankRef.setSelected(this.tab === 'rank');
        if (this.tabProgressRef) this.tabProgressRef.setSelected(this.tab === 'progress');
        if (this.headerRank) this.headerRank.active = this.tab === 'rank';
        if (this.headerProgress) this.headerProgress.active = this.tab === 'progress';
        this.presentHero();
    }

    /** 预取页签的两张底图（选中 / 未选中）。 */
    private async loadTabFrames(): Promise<void> {
        if (this.tabFramesReady) return;
        this.tabFramesReady = true;
        const names = LEAGUE_NORTH_TAB_ART_NAMES;
        const frames = await Promise.all(names.map((name) => loadArt(name, LEAGUE_ART_ROOT)));
        if (!this.alive) return;
        const payload = { normal: frames[0] ?? null, selected: frames[1] ?? null };
        if (this.tabRankRef) this.tabRankRef.setFrames(payload);
        if (this.tabProgressRef) this.tabProgressRef.setFrames(payload);
    }

    // ============================================================
    // 取数 / 铺数据
    // ============================================================

    /** 按当前页签发一条排行请求（老端 `enter()` / 切页签各发一次）。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const tab = this.tab;

        const snapshot = await this.repository.loadNorthRank(tab, this);
        if (!this.alive || revision !== this.revision || tab !== this.tab) return;

        this.art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision || tab !== this.tab) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision || tab !== this.tab) return;

        // ⚠️ `!ok` ⇒ 保留上一趟的列表（见类头「有意增补」），只提示
        if (snapshot.ok) {
            this.rows = snapshot.rows.slice();
            this.presentMyRank(snapshot.myRow);
        } else {
            FW.showTip(LEAGUE_TIP_FAILED);
        }

        this.refreshList();
        this.presentHero();
    }

    /** 预取本趟排行行里所有奖励的图帧（第 0 页两颗物品框）。 */
    private loadArtFrames(snapshot: ILeagueNorthRankSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>();
        for (const row of snapshot.rows) {
            for (const reward of row.rewards) resIds.add(reward.resId);
        }
        if (snapshot.myRow) {
            for (const reward of snapshot.myRow.rewards) resIds.add(reward.resId);
        }
        // 排行的奖励只带 `resId`（`bfUnionRankAward` 里没有 `quality`）⇒ 品质框靠这两张表反查
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    /** 「我的名次」那一格（`myRow === null` ⇒ 整块藏掉）。 */
    private presentMyRank(myRow: ILeagueNorthRankRowView | null): void {
        this.myRow = myRow;
        this.presentHero();
    }

    private presentHero(): void {
        const visible = !!this.myRow;
        if (this.myBg) this.myBg.active = visible;
        if (!this.heroItem) return;
        this.heroItem.active = visible;
        if (!visible) return;
        // 实例壳上的脚本只能运行时取（见 `heroItem` 的 @property 注释）
        const hero = this.heroItem.getComponent(LeagueNorthRankRow);
        if (!hero) return;
        // 我的那一格不画行底框（FGUI `controller="显示背景,1"`）
        hero.render(this.myRow, this.tab, this.art, false);
    }

    /** 刷新虚拟列表（首次已在 `onOpen` 里等过一帧，槽位已建好）。 */
    private refreshList(): void {
        if (!this.rankList) return;
        this.rankList.refreshList(this.rows);
        this.rankList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueNorthRankRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.render(null, this.tab, this.art, true);
            return;
        }
        row.render(view, this.tab, this.art, true);
    }

    /** 我的那一行（探针 / 单测用）。 */
    private myRow: ILeagueNorthRankRowView | null = null;

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
