import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { CardLineupEvent, CardLineupUiEvent, type ICardLineupIntent, type ICardLineupRender, type IHeroUpgradedPayload } from './CardLineupEvents';
import type { CardLineupData } from './CardRepository';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';

export interface ICardLineupControllerOptions {
    readonly owner: object;
    readonly autoLoadDecks: boolean;
    readonly fallbackLevel: number;
    readonly repository: {
        loadArtConfig(): Promise<unknown>;
        loadLineupSnapshot(): CardLineupData | null;
        loadLineup(autoLoad: boolean, refreshFormations?: boolean): Promise<CardLineupData>;
    };
    readonly failed: (error: unknown) => void;
    readonly popups: {
        readonly openEditor: () => void;
        readonly openUpgrade: (card: ZCDeckCard, level: number) => void;
    };
}

export class CardLineupController extends ControllerBase {
    private revision = 0;
    private data: CardLineupData | null = null;
    private started = false;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: ICardLineupControllerOptions) {
        super(context, 'card-lineup');
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
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
            // 权威数据刷新统一报告配置错误。
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
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    private publish(data: CardLineupData): void {
        this.data = data;
        EventMgr.instance.emit(CardLineupUiEvent.Render, { owner: this.options.owner, data } satisfies ICardLineupRender);
    }
    private onDeckSaved(): void { void this.refresh(); }
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
        if (event.owner !== this.options.owner) return;
        if (event.kind === 'refresh') { void this.refresh(); return; }
        if (event.kind === 'edit') { this.options.popups.openEditor(); return; }
        const card = event.card;
        if (!card) return;
        const level = this.data?.heroLevels.get(card.id) ?? (this.data?.heroListKnown ? 0 : this.options.fallbackLevel);
        this.options.popups.openUpgrade(card, level);
    }
}
