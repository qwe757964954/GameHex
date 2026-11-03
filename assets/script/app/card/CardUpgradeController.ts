import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ICardRepository } from './CardRepository';
import type { CardUpgradePresentation, ICardSkillOpenData } from './CardPresentations';
import { CardUpgradeModel } from './CardUpgradeModel';
import { CardPopupEvent, type CardUpgradeIntent } from './CardPopupEvents';
import { CardLineupEvent } from './CardLineupEvents';

export interface CardUpgradeControllerOptions {
    readonly owner: object;
    readonly model: CardUpgradeModel;
    readonly repository: Pick<ICardRepository, 'loadUpgradeStatus' | 'upgradeHero' | 'applyHeroLevel'>;
    readonly render: (state: CardUpgradePresentation) => void;
    readonly beginLoading: () => () => void;
    readonly removeCaller: (caller: object) => void;
    readonly close: () => void;
    readonly openSkills: (data: ICardSkillOpenData) => void;
    readonly failed: (error: unknown) => void;
}
export class CardUpgradeController extends ControllerBase {
    private started = false;
    private releaseLoading: (() => void) | null = null;
    constructor(context: IControllerContext, private readonly options: CardUpgradeControllerOptions) {
        super(context, 'card-upgrade');
        this.own(() => options.removeCaller(this));
        this.own(() => this.stopLoading());
    }
    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(CardPopupEvent.UpgradeIntent, this.onIntent);
        this.publish();
        await this.refresh();
    }
    private publish(): void { this.options.render(this.options.model.snapshot); }
    private async refresh(): Promise<void> {
        const { model, repository } = this.options;
        try {
            const status = await repository.loadUpgradeStatus(model.snapshot.cardId, model.snapshot.level);
            if (this.isDisposed) return;
            model.setStatus(status);
        } catch (error) {
            if (this.isDisposed) return;
            model.setPhase('failed'); this.options.failed(error);
        }
        this.publish();
    }
    private onIntent(event: CardUpgradeIntent): void {
        if (event.owner !== this.options.owner) return;
        if (event.kind === 'submit') { void this.submit(); return; }
        const { model } = this.options;
        if (event.kind !== 'skills' || !Number.isSafeInteger(model.heroId) || model.heroId <= 0) return;
        const data = { heroId: model.heroId, cardName: model.snapshot.data.card?.name ?? '' };
        this.options.close();
        this.options.openSkills(data);
    }
    private stopLoading(): void {
        const release = this.releaseLoading;
        this.releaseLoading = null;
        release?.();
    }
    private async submit(): Promise<void> {
        const { model, repository } = this.options;
        if (!model.canSubmit || this.isDisposed) return;
        model.setPhase('submitting'); this.publish();
        this.releaseLoading = this.options.beginLoading();
        try {
            const result = await repository.upgradeHero(model.heroId, this);
            if (this.isDisposed) return;
            if (result.kind === 'success') {
                model.confirm(result.level);
                repository.applyHeroLevel(result.heroId, result.level);
                EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: result.heroId, level: result.level });
                if (this.isDisposed) return;
                this.publish(); await this.refresh();
            } else { model.setPhase(result.kind); this.publish(); }
        } catch (error) {
            if (!this.isDisposed) { model.setPhase('failed'); this.publish(); this.options.failed(error); }
        } finally { this.stopLoading(); }
    }
}
