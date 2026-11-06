import { LEAGUE_EDIT_REJECTED_PLACEHOLDER } from './LeagueTexts';

export interface ILeagueEditParams {
    readonly type: number;
    readonly content: string;
}

/** 一次打开的编辑类型与草稿；不持有视图、请求或提交锁。 */
export class LeagueEditModel {
    readonly type: number;
    private draft: string;

    constructor(data?: ILeagueEditParams) {
        this.type = Number(data?.type ?? 0);
        this.draft = data?.content ?? '';
    }

    get content(): string { return this.draft; }

    setContent(content: string): void { this.draft = content; }

    get canSubmit(): boolean {
        return Number.isFinite(this.type) && this.type > 0
            && this.draft.length > 0 && this.draft !== LEAGUE_EDIT_REJECTED_PLACEHOLDER;
    }
}
