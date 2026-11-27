import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueEditEvent, type ILeagueEditIntent, type LeagueEditOutput } from './LeagueEditEvents';
import type { LeagueEditModel } from './LeagueEditModel';
import type { ILeagueRepository } from './LeagueRepository';
import { LEAGUE_TIP_FAILED, LEAGUE_TIP_OFFLINE } from './LeagueTexts';

export interface ILeagueEditControllerOptions {
    readonly model: LeagueEditModel;
    readonly repository: Pick<ILeagueRepository, 'edit'>;
}

export class LeagueEditController extends ControllerBase {
    private submitting = false;

    constructor(context: IControllerContext, private readonly options: ILeagueEditControllerOptions) {
        super(context, 'league-edit');
    }

    start(): void {
        this.listen(LeagueEditEvent.Intent, this.onIntent);
        this.publish();
    }

    private emitOutput(output: LeagueEditOutput): void {
        if (this.isDisposed) {
            return;
        }
        EventMgr.instance.emit(LeagueEditEvent.Output, output, this);
    }

    private readonly onIntent = (event: ILeagueEditIntent): void => {
        if (event.kind === 'change') {
            this.options.model.setContent(event.content);
        } else if (event.kind === 'submit') {
            void this.submit(event.content);
        }
    };

    private async submit(content: string): Promise<void> {
        if (this.submitting) return;
        const { model, repository } = this.options;
        model.setContent(content);
        if (!model.canSubmit) return;
        this.submitting = true;
        this.publish();
        try {
            const result = await repository.edit(model.type, content, this);
            if (this.isDisposed || model.content !== content) return;
            if (result === 'ok') this.emitOutput({ kind: 'close' });
            else this.emitOutput({ kind: 'tip', text: result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED });
        } catch (error) {
            if (this.isDisposed || model.content !== content) return;
            console.warn('[LeagueEditController] 编辑请求失败', error);
            this.emitOutput({ kind: 'tip', text: LEAGUE_TIP_FAILED });
        } finally {
            this.submitting = false;
            if (!this.isDisposed) this.publish();
        }
    }

    private publish(): void {
        this.emitOutput({
            kind: 'render',
            state: { content: this.options.model.content, submitting: this.submitting },
        });
    }
}
