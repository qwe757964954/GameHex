import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ICardRepository } from './CardRepository';
import type { CardUpgradePresentation, ICardSkillOpenData, ICardUpgradeOpenData } from './CardPresentations';
import { resolveDetailNeighbor } from './CardDetailPresenter';
import { CardUpgradeModel } from './CardUpgradeModel';
import { CardPopupEvent, type CardUpgradeIntent } from './CardPopupEvents';
import { CardLineupEvent } from './CardLineupEvents';

export interface ICardUpgradeControllerOptions {
    readonly owner: object;
    readonly model: CardUpgradeModel;
    readonly repository: Pick<ICardRepository, 'loadUpgradeStatus' | 'loadCardDetail' | 'upgradeHero' | 'applyHeroLevel' | 'loadDetailNavigation'>;
    readonly failed: (error: unknown) => void;
    readonly view: {
        readonly render: (state: CardUpgradePresentation) => void;
        readonly close: () => void;
    };
    readonly loading: {
        readonly beginLoading: () => () => void;
    };
    readonly requests: {
        readonly removeCaller: (caller: object) => void;
    };
    readonly popups: {
        readonly openSkills: (data: ICardSkillOpenData) => void;
        readonly openEditor: () => void;
        readonly openDetail: (data: ICardUpgradeOpenData) => void;
    };
}
export class CardUpgradeController extends ControllerBase {
    private started = false;
    private switching = false;
    private refreshRevision = 0;
    private releaseLoading: (() => void) | null = null;
    constructor(context: IControllerContext, private readonly options: ICardUpgradeControllerOptions) {
        super(context, 'card-upgrade');
        this.own(() => options.requests.removeCaller(this));
        this.own(() => this.stopLoading());
    }
    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(CardPopupEvent.UpgradeIntent, this.onIntent);
        this.publish();
        await this.refresh();
    }
    private publish(): void { this.options.view.render(this.options.model.snapshot); }
    private async refresh(): Promise<void> {
        const { model, repository } = this.options;
        const revision = ++this.refreshRevision;
        const { cardId, level } = model.snapshot;
        const current = () => !this.isDisposed && revision === this.refreshRevision;
        // 各区就绪即展示；升级开始后旧等级的在途结果全部失效。
        await Promise.all([
            repository.loadUpgradeStatus(cardId, level)
                .then((value) => {
                    if (!current()) return;
                    model.setStatus(value);
                    this.publish();
                })
                .catch((error) => {
                    if (!current()) return;
                    model.setPhase('failed'); this.options.failed(error); this.publish();
                }),
            repository.loadCardDetail(cardId, level)
                .then((detail) => {
                    if (!current()) return;
                    model.setDetail(detail); this.publish();
                })
                .catch((error) => {
                    if (!current()) return;
                    console.warn('[CardUpgradeController] 详情数据加载失败，详情区保持占位', error);
                    model.setDetail(null); this.publish();
                }),
        ]);
    }
    private onIntent(event: CardUpgradeIntent): void {
        if (event.owner !== this.options.owner || this.switching) return;
        if (event.kind === 'submit') { void this.submit(); return; }
        const { model } = this.options;
        if (model.snapshot.phase === 'submitting') return;
        if (event.kind === 'team') {
            this.options.view.close();
            this.options.popups.openEditor();
            return;
        }
        if (event.kind === 'previous' || event.kind === 'next') {
            void this.switchDetail(event.kind === 'previous' ? -1 : 1);
            return;
        }
        if (event.kind !== 'skills' || !Number.isSafeInteger(model.heroId) || model.heroId <= 0) return;
        const data = { heroId: model.heroId, cardName: model.snapshot.data.card?.name ?? '' };
        this.options.view.close();
        this.options.popups.openSkills(data);
    }
    private async switchDetail(direction: -1 | 1): Promise<void> {
        this.switching = true;
        try {
            const data = await this.options.repository.loadDetailNavigation();
            if (this.isDisposed) return;
            const card = resolveDetailNeighbor(data.catalog, this.options.model.snapshot.cardId, direction);
            if (!card) return;
            const level = data.heroLevels.get(card.id) ?? (data.heroListKnown ? 0 : 1);
            this.options.view.close();
            this.options.popups.openDetail({ card, cardId: card.id, level });
        } catch (error) {
            if (!this.isDisposed) this.options.failed(error);
        } finally { this.switching = false; }
    }
    private stopLoading(): void {
        const release = this.releaseLoading;
        this.releaseLoading = null;
        release?.();
    }
    private async submit(): Promise<void> {
        const { model, repository } = this.options;
        if (!model.canSubmit || this.isDisposed) return;
        this.refreshRevision++;
        model.setPhase('submitting'); this.publish();
        this.releaseLoading = this.options.loading.beginLoading();
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
