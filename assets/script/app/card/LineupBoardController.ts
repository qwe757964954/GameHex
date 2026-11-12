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
    readonly repository: Pick<ICardRepository, 'loadBoard' | 'saveFormation' | 'selectFormation'>;
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
        if (event.kind === 'save') { void this.submit(false); return; }
        if (event.kind === 'preset') { void this.switchPreset(event.index); return; }
        if (event.kind === 'toggle') this.options.model.toggle(event.cardId);
        else this.options.model.reset();
        void this.publishSafely();
    }

    /**
     * 切页签。
     *
     * 切走前的方案完整时才自动保存；选中请求还要求目标方案完整。
     * 空方案 / 半成品可在本地查看，不能同步为服务端的出战阵型。
     *
     * 满足门槛后按顺序走两步，顺序不能颠倒：
     *  ① **切走前**：有未提交改动就先 `saveFormation`（协议口径是「保存并选中」）。
     *     失败就停在原方案 —— 草稿和 dirty 都还在，玩家看到「保存失败」，
     *     而不是切过去、再切回来发现服务器上还是旧阵容。
     *  ② **切换本身**：目标方案完整时，`CmdFormationSelectReqMsg` 把「出战阵型」指向新页签，卡组不动。
     *     没有它，服务端记着的仍是切走的那条（①的 select=1 正好指在它上面）。
     */
    private async switchPreset(index: number): Promise<void> {
        const { model } = this.options;
        if (model.isCurrentPreset(index)) return;
        const complete = model.currentLineupComplete;
        //  自动提交成功时不弹「已保存」：玩家点的是页签，不是保存按钮。
        if (complete && model.switchNeedsCommit && !await this.submit(true)) return;
        if (this.isDisposed || !model.snapshot) return;
        model.selectPreset(index);
        await this.publishSafely();
        if (complete) await this.selectOnServer();
    }

    /**
     * 把当前选中阵型同步给服务器（`CmdFormationSelectReqMsg`），成功后广播「出战阵型变了」。
     *
     * 离线 / 服务端不理都不阻塞切换：本地已经切过去了，最坏情况是下次进界面读到旧阵型。
     * `FormationService.selectFormation` 自己 catch，这里不用再包一层。
     *
     * 广播复用 `DeckSaved`：卡牌阵容页显示的八卡读的就是「选中阵型」，换选中等于换八卡，
     * 订阅方（`CardLineupController.onDeckSaved`）只关心「重取一次」（payload 口径见 `ICardDeckSavedPayload`）。
     */
    private async selectOnServer(): Promise<void> {
        const state = this.options.model.snapshot;
        if (!state || this.isDisposed || !this.options.model.currentLineupComplete) return;
        const formationId = this.options.model.selectedFormationId;
        if (!await this.options.repository.selectFormation(formationId, this)) return;
        if (this.isDisposed) return;
        EventMgr.instance.emit(CardLineupEvent.DeckSaved, {
            formationId,
            heroIds: state.cards.map(card => Number(card.id)),
        });
    }

    private publishSafely(): Promise<void> {
        return this.publish().catch(error => { if (!this.isDisposed) this.options.failed(error); });
    }

    /**
     * 保存当前方案（协议口径是「保存 **并** 选中」，见 `FormationService.sendFormationOp`）。
     *
     * @param quietSuccess 成功时不提示「已保存」（切页签的自动提交用）
     * @returns 服务端确认 **且** 请求期间没有新改动时才为 true —— 只有这种状态可以接着切页签，
     *          否则切走会把保存期间新点的那几张卡留在内存里、显示成「已保存」。
     */
    private async submit(quietSuccess: boolean): Promise<boolean> {
        const { model } = this.options;
        const submission = model.beginSave();
        if (!submission) return false;
        try {
            void this.publishSafely();
            const result = await this.options.repository.saveFormation(submission.formationId, submission.heroIds, this);
            if (this.isDisposed) return false;
            const unchanged = model.finishSave(submission, result.kind);
            if (result.kind !== 'success') {
                this.options.feedback.tip(result.kind === 'offline' ? CARD_LINEUP_TEXTS.boardSaveOffline : CARD_LINEUP_TEXTS.boardSaveFailed);
                await this.publishSafely();
                return false;
            }
            EventMgr.instance.emit(CardLineupEvent.DeckSaved, { formationId: submission.formationId, heroIds: submission.heroIds });
            if (this.isDisposed) return false;
            if (!quietSuccess) this.options.feedback.tip(CARD_LINEUP_TEXTS.boardSaved);
            if (unchanged && this.options.closeAfterSave) { this.options.view.close(); return true; }
            await this.publishSafely();
            return unchanged;
        } catch (error) {
            if (this.isDisposed) return false;
            model.finishSave(submission, 'failed'); this.options.failed(error);
            this.options.feedback.tip(CARD_LINEUP_TEXTS.boardSaveFailed); await this.publishSafely();
            return false;
        }
    }
}
