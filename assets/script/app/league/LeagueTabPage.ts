import { _decorator, Component, instantiate, Node, Prefab, Vec3 } from 'cc';
import { LeagueJoinPage } from './LeagueJoinPage';

import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueTabEvent } from './LeagueTabEvents';

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

    private showingJoined: boolean | null = null;
    onLoad(): void { EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' }); }
    onDestroy(): void { EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' }); }
    refresh(force = false): void { EventMgr.instance.emit(LeagueTabEvent.Refresh, { owner: this, force }); }

    /** 整页替换：销毁旧的，实例化新的挂到本节点下（位置归零，两者都是 720×1280）。 */
    showPage(joined: boolean): void {
        this.showingJoined = joined;
        const prefab = joined ? this.joinedPage : this.joinPage;
        this.currentPage?.destroy();
        this.currentPage = instantiate(prefab);
        this.currentPage.setParent(this.node);
        this.currentPage.setPosition(Vec3.ZERO);


        // 未入盟页要能在「加入 / 创建联盟成功」后把容器叫回来重判一次（老端靠推送）。
        const join = this.currentPage.getComponent(LeagueJoinPage);
        if (join) join.joinOwner = this;
    }

    // ============================================================
    // 只读出口（供单测 / 探针断言）
    // ============================================================

    /** 当前铺的是不是「未入盟」那张页。 */
    get isShowingJoinPage(): boolean {
        return this.showingJoined === false;
    }

    /** 当前子页节点（没铺过为 `null`）。 */
    get currentPageNode(): Node | null {
        return this.currentPage;
    }

}
