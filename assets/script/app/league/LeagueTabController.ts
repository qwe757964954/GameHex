import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { LeagueTabEvent } from './LeagueTabEvents';
import type { LeagueJoinController } from './LeagueJoinController';
import type { ILeagueJoinView } from './LeagueJoinEvents';

export interface ILeagueTabControllerOptions {
    readonly failed: (error: unknown) => void;
    readonly repository: {
        readonly load: () => Promise<{ readonly joined: boolean }>;
    };
    readonly view: {
        readonly showPage: (joined: boolean) => ILeagueJoinView | null;
    };
    /** 加入页由容器持有：页面铺出后创建，重铺 / 关闭时先释放。 */
    readonly join?: {
        readonly create: (view: ILeagueJoinView) => LeagueJoinController;
    };
}
export class LeagueTabController extends ControllerBase {
    private revision = 0;
    private joined: boolean | null = null;
    private started = false;
    private joinController: LeagueJoinController | null = null;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: ILeagueTabControllerOptions) {
        super(context, 'league-tab');
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(LeagueTabEvent.Joined, this.onJoined);
        this.listen(LeagueTabEvent.Refresh, this.onRefresh);
        void this.refresh();
    }
    private onRefresh(event: { readonly force?: boolean }): void {
        void this.refresh(event.force);
    }
    private onJoined(): void {
        void this.refresh();
    }
    async refresh(force = false): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision;
        try {
            const snapshot = await this.options.repository.load();
            if (this.isDisposed || revision !== this.revision) return;
            if (!force && snapshot.joined === this.joined) return;
            this.disposeJoinController();
            const page = this.options.view.showPage(snapshot.joined);
            this.joined = snapshot.joined;
            if (page && this.options.join) {
                const join = this.options.join.create(page);
                this.joinController = join;
                join.start();
            }
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    dispose(): void {
        this.disposeJoinController();
        super.dispose();
    }
    private disposeJoinController(): void {
        this.joinController?.dispose();
        this.joinController = null;
    }
    get currentJoined(): boolean | null { return this.joined; }
}
