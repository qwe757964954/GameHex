import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ICardRepository } from './CardRepository';
import type { LineupBoardPresentation } from './CardPresentations';
import { LineupBoardModel } from './LineupBoardModel';
import { CardPopupEvent, type LineupBoardIntent } from './CardPopupEvents';
import { CardLineupEvent } from './CardLineupEvents';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

export interface ILineupBoardControllerOptions {
    readonly owner: object;
    readonly model: LineupBoardModel;
    readonly repository: Pick<ICardRepository, 'loadBoard' | 'saveFormation'>;
    readonly autoLoadDecks: boolean;
    readonly closeAfterSave: boolean;
    readonly failed: (error: unknown) => void;
    readonly view: {
        readonly render: (state: LineupBoardPresentation) => void | Promise<void>;
        readonly close: () => void;
    };
    readonly feedback: {
        readonly tip: (text: string) => void;
    };
    readonly requests: {
        readonly removeCaller: (caller: object) => void;
    };
}
export class LineupBoardController extends ControllerBase {
    private started = false;
    constructor(context: IControllerContext, private readonly options: ILineupBoardControllerOptions) {
        super(context, 'lineup-board');
        this.own(() => options.requests.removeCaller(this));
    }
    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(CardPopupEvent.BoardIntent, this.onIntent);
        try {
            const data = await this.options.repository.loadBoard(this.options.autoLoadDecks);
            if (this.isDisposed) return;
            this.options.model.load(data); await this.publish();
        } catch (error) {
            if (!this.isDisposed) { this.options.failed(error); this.options.feedback.tip(CARD_LINEUP_TEXTS.boardLoadFailed); }
        }
    }
    private async publish(): Promise<void> {
        const state = this.options.model.snapshot;
        if (state && !this.isDisposed) await this.options.view.render(state);
    }
    private onIntent(event: LineupBoardIntent): void {
        if (event.owner !== this.options.owner || !this.options.model.snapshot) return;
        if (event.kind === 'save') { void this.save(); return; }
        if (event.kind === 'preset') this.options.model.selectPreset(event.index);
        else if (event.kind === 'toggle') this.options.model.toggle(event.cardId);
        else if (event.kind === 'reset') this.options.model.reset();
        void this.publish().catch(error => { if (!this.isDisposed) this.options.failed(error); });
    }
    private async save(): Promise<void> {
        const { model } = this.options;
        const submission = model.beginSave();
        if (!submission) return;
        try {
            void this.publish().catch(error => { if (!this.isDisposed) this.options.failed(error); });
            const result = await this.options.repository.saveFormation(submission.formationId, submission.heroIds, this);
            if (this.isDisposed) return;
            const unchanged = model.finishSave(submission, result.kind);
            if (result.kind === 'success') {
                EventMgr.instance.emit(CardLineupEvent.DeckSaved, { formationId: submission.formationId, heroIds: submission.heroIds });
                if (this.isDisposed) return;
                this.options.feedback.tip(CARD_LINEUP_TEXTS.boardSaved);
                if (unchanged && this.options.closeAfterSave) { this.options.view.close(); return; }
            } else this.options.feedback.tip(result.kind === 'offline' ? CARD_LINEUP_TEXTS.boardSaveOffline : CARD_LINEUP_TEXTS.boardSaveFailed);
            await this.publish();
        } catch (error) {
            if (this.isDisposed) return;
            model.finishSave(submission, 'failed'); this.options.failed(error);
            this.options.feedback.tip(CARD_LINEUP_TEXTS.boardSaveFailed); await this.publish();
        }
    }
}
