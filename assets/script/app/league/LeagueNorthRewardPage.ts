/**
 * 「北伐中原 · 奖励」弹窗 —— 老端 `play/LayerLeagueNorthernExpeditionReward.ts`，
 * prefab `ui/League/LeagueNorthReward`。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/副本/北伐中原/组件_联盟_北伐中原_奖励.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（`组件_公共弹窗_新`，标题=联合战线奖励） | (40,191) 640×895 | `PopBg`（**公共弹窗骨架实例**） |
 * | `list`（`overflow=scroll`、`lineGap=10`、9 项） | (85,246) **550×772** | `RewardList`（`VirtualScrollView`） |
 * | `defaultItem` = `组件_联盟_北伐中原_奖励Item`（550×160） | — | `RewardList/content/RewardRow` |
 * | `tab_league`（`组件_联盟_页签`，title=联盟奖励，checked） | (76,1042) 207×105 | `TabLeague`（`LeagueNorthTab`） |
 * | `tab_role`（同上，title=个人奖励） | (293,1042) | `TabRole`（`LeagueNorthTab`） |
 *
 * ## 两个页签 = 两档 `taskUnion.subType`
 *
 * `[EnumUnionTaskType.LeagueDamage(2), EnumUnionTaskType.LeagueRoleDamage(3)][页签]`。
 * 老端 `updateView()` 里**一次只过滤一档**（`refArray.filter(t => t.subType == subType)`），
 * 然后在列表里铺。本端 `loadNorthReward()` 把**两档都算好**（`leagueRows` / `roleRows`）——
 * 切页签**不再发包**，只是换一份已算好的数组（协议是读缓存的，重算一遍要重读 5 张表，白花）。
 *
 * ## 排序
 *
 * 老端那个 `list.sort()` 的比较器**不是合法比较器**（`CanBeReward || CanBeReward` 就返回 ±1、
 * 且只比 A 不看 B，结果依赖引擎排序实现）⇒ 本端把它收敛成 `LeagueTable.buildLeagueNorthRewardRowViews`
 * 里的**显式 rank + 稳定排序**（可领在前 / 已领在后 / 其余保序）。页里不再排。
 *
 * ## 老端行为与移植取舍
 *
 * 1. **`init()` 挂两个事件监听**（`VORoleUnionBag` / `VOLeagueTaskBag` 的 `OnChanged` → `updateView()`）
 *    —— 那是「推送即刷新」的路子。本端是拉取式：领奖成功后 `afterWrite('ok')` 里自己 `reload()` 一次。
 * 2. **领奖**：老端 `ModelLeague.RequestTaskReward(ref.resId)`，且**只有 `CanBeReward()` 时才挂
 *    onClick**。本端把这道判据收在 `LeagueNorthRewardRow` 里（不可领直接不发），页里再防一次（`busy`）。
 * 3. **页签红点**：老端 `tab_league.com_rd` / `tab_role.com_rd`，判据是
 *    `hasNorthernExpeditionReward(subType)` —— 本端快照的 `leagueRedDot` / `roleRedDot`。
 */

import { _decorator, Button, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT } from './LeagueArt';
import { LeagueNorthRewardRow } from './LeagueNorthRewardRow';
import { LeagueNorthTab, LEAGUE_NORTH_TAB_ART_NAMES } from './LeagueNorthTab';
import {
    leagueRepository,
    type ILeagueNorthRewardSnapshot,
    type ILeagueRepository,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import type { ILeagueNorthRewardRowView, LeagueNorthRewardTab } from './LeagueTable';
import {
    LEAGUE_NORTH_REWARD_TITLE,
    LEAGUE_NORTH_TAB_REWARD_LEAGUE,
    LEAGUE_NORTH_TAB_REWARD_ROLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueNorthRewardPage')
export class LeagueNorthRewardPage extends PopupBase {
    /** ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）。 */
    static prefabPath = 'ui/League/LeagueNorthReward';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    /**
     * `TabLeague` / `TabRole`：两个页签（`LeagueNorthTab.prefab` 的**嵌套实例**）。
     *
     * ⚠️ 绑节点、运行时 `getComponent(LeagueNorthTab)`（同 `LeagueNorthRankPage.heroItem`）。
     */
    @property({ type: Node, tooltip: 'TabLeague：「联盟奖励」页签（默认选中）' })
    tabLeague: Node = null!;

    @property({ type: Node, tooltip: 'TabRole：「个人奖励」页签' })
    tabRole: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'RewardList：奖励列表（虚拟列表）' })
    rewardList: VirtualScrollView = null!;

    /** 当前页签。 */
    private tab: LeagueNorthRewardTab = 'league';

    /** 两个页签的脚本实例（`onInit` 里从嵌套实例壳上取一次）。 */
    private tabLeagueRef: LeagueNorthTab | null = null;
    private tabRoleRef: LeagueNorthTab | null = null;

    /** 本趟快照（切页签复用，不重发）。 */
    private snapshot: ILeagueNorthRewardSnapshot | null = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueNorthRewardRowView[] = [];

    /** 本趟的奖励图帧。 */
    private art: ILeagueRewardArt | null = null;

    /** 页签底图（读一次就够）。 */
    private tabFramesReady = false;

    /** `renderItemFn` 只绑一次。 */
    private rendererBound = false;

    /** 页签只绑一次。 */
    private tabsBound = false;

    /** 领奖在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const closeBtn = this.closeButton?.getComponent(Button);
        if (closeBtn) closeBtn.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueNorthReward] CloseBtn 上没有 cc.Button，点击不会生效');

        // 页签是嵌套实例 ⇒ 运行时从壳上取脚本（见 `tabLeague` 的 @property 注释）
        this.tabLeagueRef = this.tabLeague ? this.tabLeague.getComponent(LeagueNorthTab) : null;
        this.tabRoleRef = this.tabRole ? this.tabRole.getComponent(LeagueNorthTab) : null;

        if (!this.rendererBound) {
            this.rendererBound = true;
            if (this.rewardList) this.rewardList.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        if (!this.tabsBound) {
            this.tabsBound = true;
            if (this.tabLeagueRef) this.tabLeagueRef.onTabClick = () => this.onTabClick('league');
            if (this.tabRoleRef) this.tabRoleRef.onTabClick = () => this.onTabClick('role');
        }
        if (this.tabLeagueRef) this.tabLeagueRef.setTitle(LEAGUE_NORTH_TAB_REWARD_LEAGUE);
        if (this.tabRoleRef) this.tabRoleRef.setTitle(LEAGUE_NORTH_TAB_REWARD_ROLE);
        this.applyTabPage();
    }

    protected async onOpen(): Promise<void> {
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
        return LEAGUE_NORTH_REWARD_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    // ============================================================
    // 页签
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 切页签：**不发包**，只换一份已算好的数组（见类头）。 */
    private onTabClick(tab: LeagueNorthRewardTab): void {
        if (tab === this.tab) return;
        this.tab = tab;
        this.applyTabPage();
        this.presentRows();
    }

    /** 把当前页签落到两颗按钮 + 页签红点。 */
    private applyTabPage(): void {
        if (this.tabLeagueRef) {
            this.tabLeagueRef.setSelected(this.tab === 'league');
            this.tabLeagueRef.setRedDot(!!this.snapshot?.leagueRedDot);
        }
        if (this.tabRoleRef) {
            this.tabRoleRef.setSelected(this.tab === 'role');
            this.tabRoleRef.setRedDot(!!this.snapshot?.roleRedDot);
        }
    }

    /** 预取页签的两张底图（选中 / 未选中）。 */
    private async loadTabFrames(): Promise<void> {
        if (this.tabFramesReady) return;
        this.tabFramesReady = true;
        const names = LEAGUE_NORTH_TAB_ART_NAMES;
        const frames = await Promise.all(names.map((name) => loadArt(name, LEAGUE_ART_ROOT)));
        if (!this.alive) return;
        const payload = { normal: frames[0] ?? null, selected: frames[1] ?? null };
        if (this.tabLeagueRef) this.tabLeagueRef.setFrames(payload);
        if (this.tabRoleRef) this.tabRoleRef.setFrames(payload);
    }

    // ============================================================
    // 取数 / 铺数据
    // ============================================================

    /** 读一次奖励快照（**不发包**：两档都在缓存里）→ 预取图 → 铺。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repository.loadNorthReward();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.applyTabPage();
        this.presentRows();
    }

    /** 预取两档里全部奖励的图帧（`LeagueNorthRewardRow.render` 是同步的）。 */
    private loadArtFrames(snapshot: ILeagueNorthRewardSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>();
        for (const row of snapshot.leagueRows) if (row.reward) resIds.add(row.reward.resId);
        for (const row of snapshot.roleRows) if (row.reward) resIds.add(row.reward.resId);
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    /** 按当前页签取行 + 刷新虚拟列表。 */
    private presentRows(): void {
        const snapshot = this.snapshot;
        this.rows = snapshot
            ? (this.tab === 'league' ? snapshot.leagueRows.slice() : snapshot.roleRows.slice())
            : [];
        if (!this.rewardList) return;
        this.rewardList.refreshList(this.rows);
        this.rewardList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueNorthRewardRow);
        if (!row) return;
        const view = this.rows[index];
        row.onClaim = (target) => void this.onClaim(target);
        row.render(view ?? null, this.art);
    }

    // ============================================================
    // 领奖
    // ============================================================

    /**
     * 点「领取」—— 老端 `ModelLeague.RequestTaskReward(ref.resId)`。
     *
     * ⚠️ 「不可领不发包」这道闸在 `LeagueNorthRewardRow` 里（同老端「只有 `CanBeReward` 才挂 onClick」），
     *    这里只再防一次 `busy`（连点两颗不同行会重复发包）。
     */
    private async onClaim(view: ILeagueNorthRewardRowView): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        try {
            const result = await this.repository.requestTaskReward(view.resId, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新，本端自己拉）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
