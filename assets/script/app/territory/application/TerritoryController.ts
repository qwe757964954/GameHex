import { ControllerBase, type IControllerResources } from '../../../framework/controller/ControllerBase';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import type { TerritoryModel, TerritoryModelOutput } from './TerritoryModel';
import type { TerritoryCellRepository } from './TerritoryCellRepository';
import { TerritoryUiEvent, TerritoryViewEvent, type ITerritoryIntentEvent,
    type TerritoryViewCommand } from './TerritoryEvents';
import { buildTerritoryViewState } from './TerritoryViewState';
import { TERRITORY_TEXTS } from './TerritoryTexts';

export interface ITerritoryControllerOptions {
    readonly context: IControllerContext;
    readonly network: {
        addEvent(name: string, caller: object, handler: (message: unknown) => void): void;
        removeCaller(caller: object): void;
    };
    readonly roleCache: { subscribe(callback: () => void): () => void };
    readonly cells: Pick<TerritoryCellRepository, 'readPassCellsBro' | 'readCellInfo'>;
    readonly schedule: (callback: () => void, seconds: number) => () => void;
    readonly now?: () => number;
}

/** Owns all business inputs and clocks. Views only send intents. */
export class TerritoryController extends ControllerBase {
    private started = false;
    private disposed = false;
    private stopping = false;
    private ticking = false;
    private stopOutput: (() => void) | null = null;
    private readonly stops: Array<() => void> = [];

    private readonly model: TerritoryModel;

    constructor(createModel: (resources: IControllerResources) => TerritoryModel, private readonly options: ITerritoryControllerOptions) {
        super(options.context, 'territory-controller');
        try { this.model = createModel(this.resources); }
        catch (error) { super.dispose(); throw error; }
    }

    start(): void {
        if (this.started || this.disposed) return;
        this.started = true;
        this.stopOutput = this.model.onOutput((output) => this.onOutput(output));
        this.bindNetworkEvents();
        this.stops.push(this.options.roleCache.subscribe(() => {
            this.model.refreshWalletFromServer();
        }));
        this.bindUiEvents();
        this.model.start();
    }

    private bindNetworkEvents(): void {
        this.options.network.addEvent('CmdCityChapterPassCellBroMsg', this, this.onPassCellsBro);
        this.options.network.addEvent('CmdCityChapterCellInfoRspMsg', this, this.onCellInfo);
    }
    private onPassCellsBro(message: unknown): void {
        const bro = this.options.cells.readPassCellsBro(message);
        if (bro) this.model.applyPassCellsBro(bro.levelChapter, bro.cellIds);
    }
    private onCellInfo(message: unknown): void {
        const state = this.options.cells.readCellInfo(message);
        if (state) this.model.applyCellInfoState(state);
    }
    private bindUiEvents(): void {
        EventMgr.instance.on(TerritoryUiEvent.Intent, this.onIntent, this);
        EventMgr.instance.on(TerritoryUiEvent.Ready, this.onReady, this);
        EventMgr.instance.on(TerritoryUiEvent.Disposed, this.onDisposed, this);
    }
    private onReady(): void {
        this.publish();
    }
    private onDisposed(): void {
        this.dispose();
    }
    private onIntent(event: ITerritoryIntentEvent): void {
        const intent = event.intent;
        switch (intent.kind) {
            case 'siteTap': {
                const site = this.model.state.map?.sites.find((site) => site.cellId === intent.cellId);
                if (site) this.model.selectSite(site);
                break;
            }
            case 'randomTap': this.model.selectRandomResource(intent.cellId); break;
            case 'chapter': this.model.switchChapter(intent.offset); break;
            case 'battle': this.command({ kind: 'prepareBattle' }); this.model.requestBattle(); break;
            case 'closeDetail': this.model.closeDetail(); break;
            case 'openLevelTip': this.model.openLevelTip(); break;
            case 'closeLevelTip': this.model.closeLevelTip(); break;
            case 'scout': this.command({ kind: 'tip', payload: { text: TERRITORY_TEXTS.asyncPlayerScoutUnavailable } }); break;
            case 'focusBoss': {
                const cellId = this.model.focusCurrentBoss();
                if (cellId !== null) this.command({ kind: 'focusCell', cellId });
                break;
            }
        }
    }
    private onOutput(output: TerritoryModelOutput): void {
        if (this.stopping) {
            // Balance only this session's outstanding loading contributions before disconnecting the view.
            if (output.kind === 'busy' && !output.payload.busy) this.command(output);
            return;
        }
        if (output.kind === 'changed') this.publish();
        else this.command(output);
    }
    private publish(): void {
        const state = this.model.state;
        if (state.ready && !this.ticking) {
            this.ticking = true;
            this.stops.push(this.options.schedule(() => this.tick(false), 1));
            this.stops.push(this.options.schedule(() => this.tick(true), 60));
        }
        EventMgr.instance.emit(TerritoryViewEvent.Render, { state: buildTerritoryViewState(state) });
    }
    private tick(slow: boolean): void {
        const now = this.options.now?.() ?? Date.now();
        if (slow) this.model.slowTick(now);
        else this.model.fastTick(now);
    }
    private command(command: TerritoryViewCommand): void {
        EventMgr.instance.emit(TerritoryViewEvent.Command, { command });
    }
    dispose(): void {
        if (this.disposed || this.stopping) return;
        this.stopping = true;
        EventMgr.instance.offTarget(this);
        this.options.network.removeCaller(this);
        for (const stop of this.stops.splice(0)) stop();
        this.model.dispose();
        this.stopOutput?.();
        this.stopOutput = null;
        this.disposed = true;
        super.dispose();
    }
}
