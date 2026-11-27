import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { CardLineupEvent, CardLineupUiEvent, type CardLineupOutput, type ICardLineupIntent, type ICardLineupRender, type IHeroUpgradedPayload } from './CardLineupEvents';
import type { CardLineupData } from './CardRepository';
import { resolveCardDisplayLevel } from './CardLineupTypes';
import type { ZCDeckCard } from './CardLineupTypes';

export interface ICardLineupControllerOptions {
    readonly autoLoadDecks: boolean;
    readonly fallbackLevel: number;
    readonly repository: {
        loadArtConfig(): Promise<unknown>;
        loadLineupSnapshot(): CardLineupData | null;
        loadLineup(autoLoad: boolean, refreshFormations?: boolean): Promise<CardLineupData>;
    };
}

export class CardLineupController extends ControllerBase {
    private revision = 0;
    private data: CardLineupData | null = null;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: ICardLineupControllerOptions) {
        super(context, 'card-lineup');
    }
    start(): void {
        this.listen(CardLineupUiEvent.Intent, this.onIntent);
        this.listen(CardLineupEvent.DeckSaved, this.onDeckSaved);
        this.listen(CardLineupEvent.HeroUpgraded, this.onHeroUpgraded);
        const snapshot = this.options.repository.loadLineupSnapshot();
        if (snapshot) this.publish(snapshot);
        else void this.prepareSnapshot();
        void this.refresh();
    }
    private async prepareSnapshot(): Promise<void> {
        try {
            await this.options.repository.loadArtConfig();
            if (this.isDisposed || this.data) return;
            const snapshot = this.options.repository.loadLineupSnapshot();
            if (snapshot) this.publish(snapshot);
        } catch (error) {
            // 配置错误统一由 refresh 上报，这里不重复报。
        }
    }
    async refresh(refreshFormations = true): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision;
        try {
            const data = await this.options.repository.loadLineup(this.options.autoLoadDecks, refreshFormations);
            if (this.isDisposed || revision !== this.revision) return;
            this.publish(data);
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) {
                EventMgr.instance.emit(CardLineupUiEvent.Output, { kind: 'failed', error } satisfies CardLineupOutput);
            }
        }
    }
    private publish(data: CardLineupData): void {
        this.data = data;
        EventMgr.instance.emit(CardLineupUiEvent.Render, { data } satisfies ICardLineupRender);
    }
    private onDeckSaved(): void {
        void this.refresh();
    }

    private onHeroUpgraded(payload: IHeroUpgradedPayload): void {
        if (this.data) {
            const heroLevels = new Map(this.data.heroLevels);
            heroLevels.set(String(payload.heroId), payload.level);
            this.data = { ...this.data, heroLevels };
        }
        // 升级只改变英雄等级，沿用已有阵型重算战力。
        void this.refresh(false);
    }

    private onIntent(event: ICardLineupIntent): void {
        if (event.kind === 'refresh') {
            void this.refresh();
            return;
        }
        if (event.kind === 'edit') {
            EventMgr.instance.emit(CardLineupUiEvent.Output, { kind: 'openEditor' } satisfies CardLineupOutput);
            return;
        }
        const card = event.card;
        if (!card) {
            return;
        }
        const level = resolveCardDisplayLevel(
            card.id,
            this.data?.heroLevels,
            !!this.data?.heroListKnown,
            this.options.fallbackLevel,
        );
        EventMgr.instance.emit(CardLineupUiEvent.Output, { kind: 'openUpgrade', card, level } satisfies CardLineupOutput);
    }
}
