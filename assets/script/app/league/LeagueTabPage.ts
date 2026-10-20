/**
 * 「联盟」**容器页**（老端 `TabLeague`，`ui/League/LeagueTab`）—— 按「入没入盟」整页二选一。
 *
 * ## 为什么要有这一层
 *
 * 老端 FGUI 里 `组件_联盟_容器` 是 `GameTabUI` 的**壳**：它在跟前的两个子页
 * `TabLeagueJoin`（未入盟）与 `TabLeagueMain`（已入盟）之间切，切法只有一句
 *
 * ```ts
 * protected enter(): void { this.updateView(); }
 * private updateView(): void {
 *     if (ModelLeague.IsJoinedLeague()) this.proxy.switchTab2(TabLeagueMain.__cname);
 *     else                               this.proxy.switchTab2(TabLeagueJoin.__cname);
 * }
 * ```
 *
 * 本端没有 FGUI 的 tab 框架，`MainTabHost.alliancePage` 只能吃**一个** prefab
 * ⇒ 用本页当那个 prefab：自己不画任何东西，只决定实例化哪一张。
 *
 * ## `btn_join` / `btn_main` 为什么**不落**
 *
 * FGUI `组件_联盟_容器.xml` 里只有那两颗页签按钮，且都在 `xy="83/473, 1383"` ——
 * **整块在 1280 的画布之外**（`GameTabUI` 把它们当 tab 按钮收走，设计态坐标就留在了外面）。
 * 本端底部导航由 `MainTabHost` 和共用 `TabButton` 承担 ⇒ 本 prefab 是**纯空壳**，只挂一个脚本。
 *
 * ## 刷新链路：没有推送，只能「写成功后回敲」
 *
 * 老端两处 `toolSet.addListener(VORoleUnionBag, "OnChanged", …)` 把「联盟态变了」变成
 * 「重跑 `updateView`」。本端 `CacheMgr` 是**只读取值器**（`GameCacheMgr extends ScriptObject`，
 * 没有 `EventTarget` / `emit`）⇒ 没有等价物。所以：
 *
 * - 进页面：`onLoad` → `refresh()`（读一次快照）；
 * - **加入 / 创建成功**：`LeagueJoinPage` 把 `onJoined` 赋成 `() => this.refresh()`，
 *   写成功后主动回敲（见 `LeagueJoinPage.afterWrite` / `finishCreated`）。
 */

import { _decorator, Component, instantiate, Node, Prefab, Vec3 } from 'cc';
import { LeagueJoinPage } from './LeagueJoinPage';
import { leagueRepository, type ILeagueRepository } from './LeagueRepository';

const { ccclass, property } = _decorator;

@ccclass('LeagueTabPage')
export class LeagueTabPage extends Component {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
     * 本页由 `MainRoot.prefab` 的 `MainTabHost.alliancePage` 实例化，这个常量主要给测试 / 文档引用。
     */
    static prefabPath = 'ui/League/LeagueTab';

    @property({ type: Prefab, tooltip: '已入盟页预制体（ui/League/League，主页外壳）' })
    joinedPage: Prefab = null!;

    @property({ type: Prefab, tooltip: '未入盟页预制体（ui/League/LeagueJoin）' })
    joinPage: Prefab = null!;

    /** 当前挂在本节点下的子页。 */
    private currentPage: Node | null = null;

    /** 当前子页对应「已入盟」还是「未入盟」；`null` = 还没铺过。 */
    private currentJoined: boolean | null = null;

    /** 每次判定递增，用来作废在飞的异步结果。 */
    private revision = 0;

    onLoad(): void {
        void this.refresh();
    }

    onDestroy(): void {
        this.revision += 1;
    }

    // ============================================================
    // 判定 + 切页
    // ============================================================

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 重判「入没入盟」并整页切换。
     *
     * `force` 只在调试 / 测试里用；正常两条链路（`onLoad`、写成功回敲）都是
     * 「状态真的变了才重建」⇒ 不会因为一次多余调用白销毁重建一整页。
     */
    async refresh(force = false): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;
        if (!force && this.currentPage?.isValid && snapshot.joined === this.currentJoined) return;
        this.showPage(snapshot.joined);
    }

    /** 整页替换：销毁旧的，实例化新的挂到本节点下（位置归零，两者都是 720×1280）。 */
    private showPage(joined: boolean): void {
        const prefab = joined ? this.joinedPage : this.joinPage;
        if (!prefab) {
            console.warn(`[LeagueTab] ${joined ? 'joinedPage' : 'joinPage'} 没绑预制体，联盟页打不开`);
            return;
        }

        this.currentPage?.destroy();
        this.currentPage = instantiate(prefab);
        this.currentPage.setParent(this.node);
        this.currentPage.setPosition(Vec3.ZERO);
        this.currentJoined = joined;

        // 未入盟页要能在「加入 / 创建联盟成功」后把容器叫回来重判一次（老端靠推送）。
        const join = this.currentPage.getComponent(LeagueJoinPage);
        if (join) join.onJoined = () => void this.refresh();
    }

    // ============================================================
    // 只读出口（供单测 / 探针断言）
    // ============================================================

    /** 当前铺的是不是「未入盟」那张页。 */
    get isShowingJoinPage(): boolean {
        return this.currentJoined === false;
    }

    /** 当前子页节点（没铺过为 `null`）。 */
    get currentPageNode(): Node | null {
        return this.currentPage;
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
