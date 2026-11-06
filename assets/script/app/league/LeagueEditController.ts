import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { LeagueEditEvent, type ILeagueEditIntent, type ILeagueEditViewState } from './LeagueEditEvents';
import type { LeagueEditModel } from './LeagueEditModel';
import type { ILeagueRepository } from './LeagueRepository';
import { LEAGUE_TIP_FAILED, LEAGUE_TIP_OFFLINE } from './LeagueTexts';

export interface ILeagueEditControllerOptions {
    readonly owner: object;
    readonly model: LeagueEditModel;
    readonly repository: Pick<ILeagueRepository, 'edit'>;
    readonly view: {
        readonly render: (state: ILeagueEditViewState) => void;
        readonly close: () => void;
    };
    readonly feedback: { readonly tip: (text: string) => void };
    readonly requests: { readonly removeCaller: (caller: object) => void };
}

export class LeagueEditController extends ControllerBase {
    private started = false;
    private submitting = false;

    constructor(context: IControllerContext, private readonly options: ILeagueEditControllerOptions) {
        super(context, 'league-edit');
        this.own(() => options.requests.removeCaller(this));
    }

    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(LeagueEditEvent.Intent, this.onIntent);
        this.publish();
    }

    private readonly onIntent = (event: ILeagueEditIntent): void => {
        if (event.owner !== this.options.owner) return;
        if (event.kind === 'change') {
            this.options.model.setContent(event.content);
        } else if (event.kind === 'submit') {
            void this.submit(event.content);
        }
    };

    private async submit(content: string): Promise<void> {
        if (this.submitting) return;
        const { model, repository, view, feedback } = this.options;
        model.setContent(content);
        if (!model.canSubmit) return;
        this.submitting = true;
        this.publish();
        try {
            const result = await repository.edit(model.type, content, this);
            if (this.isDisposed || model.content !== content) return;
            if (result === 'ok') view.close();
            else feedback.tip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
        } catch (error) {
            if (this.isDisposed || model.content !== content) return;
            console.warn('[LeagueEditController] 编辑请求失败', error);
            feedback.tip(LEAGUE_TIP_FAILED);
        } finally {
            this.submitting = false;
            if (!this.isDisposed) this.publish();
        }
    }

    private publish(): void {
        this.options.view.render({ content: this.options.model.content, submitting: this.submitting });
    }
}
