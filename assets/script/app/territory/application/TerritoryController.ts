import { ControllerBase, type IControllerResources } from '../../../framework/controller/ControllerBase';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { ITerritoryNavigateBattlePayload, TerritoryModel, TerritoryModelOutput } from './TerritoryModel';
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
    readonly battle?: {
        prepare(payload: ITerritoryNavigateBattlePayload, owner: ResourceScope): Promise<unknown> | undefined;
        enter(payload: ITerritoryNavigateBattlePayload): void;
    };
}

/** Owns all business inputs and clocks. Views only send intents. */
export class TerritoryController extends ControllerBase {
    private started = false;
    private stopping = false;
    private ticking = false;
    private stopOutput: (() => void) | null = null;

    private readonly model: TerritoryModel;

    constructor(createModel: (resources: IControllerResources) => TerritoryModel, private readonly options: ITerritoryControllerOptions) {
        super(options.context, 'territory-controller');
        try { this.model = createModel(this.resources); }
        catch (error) { super.dispose(); throw error; }
    }

    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.stopOutput = this.model.onOutput((output) => this.onOutput(output));
        this.bindNetworkEvents();
        this.own(() => this.options.network.removeCaller(this));
        this.own(this.options.roleCache.subscribe(() => {
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
        this.listen(TerritoryUiEvent.Intent, this.onIntent);
        this.listen(TerritoryUiEvent.Ready, this.onReady);
        this.listen(TerritoryUiEvent.Disposed, this.onDisposed);
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
            case 'claimIdleRewards': this.model.claimIdleRewards(this.options.now?.() ?? Date.now()); break;
            case 'chapter': this.model.switchChapter(intent.offset); break;
            case 'selectChapter': this.model.selectChapter(intent.chapterId); break;
            case 'enterBattle': {
                if (!this.options.battle) throw new Error('领地战斗入口尚未装配');
                this.options.battle.enter(intent.payload);
                break;
            }
            case 'battle': this.command({ kind: 'prepareBattle' }); this.model.requestBattle(); break;
            case 'closeDetail': this.model.closeDetail(); break;
            case 'keepBattleRequest': this.model.keepBattleRequest(); break;
            case 'cancelBattleStart': this.model.cancelBattleStart(); break;
            case 'openLevelTip': this.model.openLevelTip(); break;
            case 'closeLevelTip': this.model.closeLevelTip(); break;
            case 'scout': this.command({ kind: 'tip', payload: { text: TERRITORY_TEXTS.asyncPlayerScoutUnavailable } }); break;
            case 'focusLevel': {
                const cellId = this.model.focusCurrentLevel();
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
        if (output.kind === 'navigate') {
            const ready = this.options.battle?.prepare(output.payload, this.scope);
            this.command({ ...output, ready });
        } else if (output.kind === 'changed') this.publish();
        else this.command(output);
    }
    private publish(): void {
        const state = this.model.state;
        if (state.ready && !this.ticking) {
            this.ticking = true;
            this.own(this.options.schedule(() => this.tick(false), 1));
            this.own(this.options.schedule(() => this.tick(true), 60));
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
        if (this.isDisposed || this.stopping) return;
        this.stopping = true;
        this.releaseInputs();
        this.model.dispose();
        this.stopOutput?.();
        this.stopOutput = null;
        super.dispose();
    }
}
