import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueTabEvent, type LeagueTabOutput } from './LeagueTabEvents';

export interface ILeagueTabControllerOptions {
    readonly repository: {
        readonly load: () => Promise<{ readonly joined: boolean }>;
    };
}
export class LeagueTabController extends ControllerBase {
    private revision = 0;
    private joined: boolean | null = null;
    private started = false;
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
            this.joined = snapshot.joined;
            EventMgr.instance.emit(LeagueTabEvent.Output, { kind: 'page', joined: snapshot.joined } satisfies LeagueTabOutput, this);
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) {
                EventMgr.instance.emit(LeagueTabEvent.Output, { kind: 'failed', error } satisfies LeagueTabOutput, this);
            }
        }
    }
    get currentJoined(): boolean | null { return this.joined; }
}
