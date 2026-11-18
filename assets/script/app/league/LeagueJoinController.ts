import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { LeagueJoinEvent, type ILeagueJoinIntent, type ILeagueJoinView } from './LeagueJoinEvents';
import type { ILeagueRepository } from './LeagueRepository';
import {
    buildLeagueUnionViews,
    pickQuickJoinIdsFor,
    pickUnionListForSearch,
    type ILeagueUnionRow,
    type ILeagueUnionView,
} from './LeagueTable';
import {
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_NO_JOINABLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_INPUT_UNION_ID,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from './LeagueTexts';

export type ILeagueJoinRepository = Pick<
    ILeagueRepository,
    'requestList' | 'load' | 'search' | 'cachedSearch' | 'join'
>;

export interface ILeagueJoinControllerOptions {
    readonly owner: object;
    /** 容器页 owner；成功后按它发 `LeagueTabEvent.Joined`，替代视图回调穿透。 */
    readonly joinedOwner: object | null;
    readonly repository: ILeagueJoinRepository;
    readonly view: ILeagueJoinView;
    readonly feedback: {
        readonly tip: (text: string) => void;
        readonly notifyJoined: (owner: object | null) => void;
    };
    readonly popups: {
        readonly openCreate: (owner: object | null) => void;
        readonly openUnion: (view: ILeagueUnionView) => void;
    };
    readonly requests: { readonly removeCaller: (caller: object) => void };
}

/** 全服行的三段前缀（与大厅 / 加入页同源）。 */
const JOIN_ROW_TEXTS = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
} as const;

/**
 * 加入联盟页的业务编排：搜索、快速加入、创建入口、行详情入口。
 *
 * 每次 `LeagueTabController` 铺出加入页时由组合新建一个实例，页面销毁 / 容器重铺时
 * `dispose()`：`removeCaller(this)` 作废在飞请求，`revision` 作废迟到的缓存读取，
 * 迟到结果不再上屏。
 */
export class LeagueJoinController extends ControllerBase {
    private started = false;
    private busy = false;
    private revision = 0;
    private searchKey = '';

    constructor(context: IControllerContext, private readonly options: ILeagueJoinControllerOptions) {
        super(context, 'league-join');
        this.own(() => options.requests.removeCaller(this));
    }

    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(LeagueJoinEvent.Intent, this.onIntent);
        void this.reload();
    }

    private readonly onIntent = (event: ILeagueJoinIntent): void => {
        if (event.owner !== this.options.owner) return;
        switch (event.kind) {
            case 'input':
                this.searchKey = event.text;
                return;
            case 'search':
                void this.search();
                return;
            case 'quickJoin':
                void this.quickJoin();
                return;
            case 'create':
                this.options.popups.openCreate(this.options.joinedOwner);
                return;
            case 'openUnion':
                this.options.popups.openUnion(event.union);
                return;
        }
    };

    /** 拉一次列表 + 铺行；失败仍铺缓存，离线 / 失败只补提示。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;
        try {
            const result = await this.options.repository.requestList(this);
            if (this.isDisposed || revision !== this.revision) return;

            const snapshot = await this.options.repository.load();
            if (this.isDisposed || revision !== this.revision) return;

            this.present(snapshot.unions);
            this.report(result);
        } catch (error) {
            if (this.isDisposed || revision !== this.revision) return;
            console.warn('[LeagueJoinController] 读联盟列表失败', error);
            this.options.feedback.tip(LEAGUE_TIP_FAILED);
        }
    }

    /**
     * 按「搜索缓存」铺行 —— 老端 `GetCmdUnionListBySearch`：
     * 命中过搜索缓存就只显示那一条，否则显示全部。
     */
    private present(rows: readonly ILeagueUnionRow[]): void {
        this.options.view.render(buildLeagueUnionViews(
            pickUnionListForSearch(rows, this.options.repository.cachedSearch(this.searchKey)),
            JOIN_ROW_TEXTS,
        ));
    }

    /** 点「查询」：空输入提示；否则按 id 搜，回来后按缓存重铺列表。 */
    private async search(): Promise<void> {
        if (!this.searchKey) {
            this.options.feedback.tip(LEAGUE_TIP_INPUT_UNION_ID);
            return;
        }
        const revision = ++this.revision;
        try {
            const result = await this.options.repository.search(this.searchKey, this);
            if (this.isDisposed || revision !== this.revision) return;
            this.report(result);
            if (result !== 'ok') return;

            // 搜索成功后不重新拉列表：老端也只是 updateView() 重铺一遍，
            // GetCmdUnionListBySearch 会命中刚写进缓存的这一条。
            const snapshot = await this.options.repository.load();
            if (this.isDisposed || revision !== this.revision) return;
            this.present(snapshot.unions);
        } catch (error) {
            if (this.isDisposed || revision !== this.revision) return;
            console.warn('[LeagueJoinController] 搜索联盟失败', error);
            this.options.feedback.tip(LEAGUE_TIP_FAILED);
        }
    }

    /**
     * 「快速加入」—— 老端 `onClickJoin()`：
     * 取「可快速加入」列表（命中搜索缓存时直接点名那一个），空则提示且不发包。
     */
    private async quickJoin(): Promise<void> {
        const snapshot = await this.options.repository.load();
        if (this.isDisposed) return;

        const ids = pickQuickJoinIdsFor(snapshot.unions, this.options.repository.cachedSearch(this.searchKey));
        if (!ids.length) {
            this.options.feedback.tip(LEAGUE_NO_JOINABLE);
            return;
        }
        if (!this.beginWrite()) return;
        try {
            const result = await this.options.repository.join(ids, this);
            if (this.isDisposed) return;
            this.report(result);
            if (result !== 'ok') return;

            await this.reload();
            if (this.isDisposed) return;
            this.options.feedback.notifyJoined(this.options.joinedOwner);
        } catch (error) {
            if (!this.isDisposed) {
                console.warn('[LeagueJoinController] 快速加入失败', error);
                this.options.feedback.tip(LEAGUE_TIP_FAILED);
            }
        } finally {
            this.busy = false;
        }
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    /** 三态归一：只有 `'ok'` 静默。 */
    private report(result: 'ok' | 'offline' | 'failed'): void {
        if (result === 'ok') return;
        this.options.feedback.tip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }
}
