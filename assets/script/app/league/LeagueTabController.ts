import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { LeagueTabEvent, type ILeagueJoinedEvent } from './LeagueTabEvents';

export interface ILeagueTabControllerOptions {
    readonly owner: object;
    readonly load: () => Promise<{ readonly joined: boolean }>;
    readonly showPage: (joined: boolean) => void;
    readonly failed: (error: unknown) => void;
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
    private onRefresh(event: ILeagueJoinedEvent & { readonly force?: boolean }): void {
        if (event.owner === this.options.owner) void this.refresh(event.force);
    }
    private onJoined(event: ILeagueJoinedEvent): void {
        if (event.owner === this.options.owner) void this.refresh();
    }
    async refresh(force = false): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision;
        try {
            const snapshot = await this.options.load();
            if (this.isDisposed || revision !== this.revision) return;
            if (!force && snapshot.joined === this.joined) return;
            this.options.showPage(snapshot.joined);
            this.joined = snapshot.joined;
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    get currentJoined(): boolean | null { return this.joined; }
}
