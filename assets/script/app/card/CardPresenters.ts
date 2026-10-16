import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type {
    CardLineupData,
    ICardRepository,
    LineupBoardData,
} from './CardRepository';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { FormationSaveResult } from './FormationService';
import { LineupDraftStore } from './LineupDraftStore';
import { buildPresetDecks } from './LineupPresets';

export interface CardLineupView {
    isAlive(): boolean;
    presentLineup(data: CardLineupData): void | Promise<void>;
}

export class CardLineupPresenter {
    private revision = 0;
    constructor(private readonly repository: ICardRepository) {}

    async refresh(autoLoadDecks: boolean, view: CardLineupView): Promise<void> {
        const revision = ++this.revision;
        const data = await this.repository.loadLineup(autoLoadDecks);
        if (revision !== this.revision || !view.isAlive()) return;
        await view.presentLineup(data);
    }

    dispose(): void { this.revision += 1; }
}

export interface LineupBoardPresentation extends LineupBoardData {
    readonly draft: LineupDraftStore;
}

export interface LineupBoardView {
    isAlive(): boolean;
    presentBoard(data: LineupBoardPresentation): void | Promise<void>;
}

export class LineupBoardPresenter {
    private revision = 0;
    constructor(private readonly repository: ICardRepository) {}

    async refresh(
        autoLoadDecks: boolean,
        presetCount: number,
        selectedPreset: number,
        view: LineupBoardView,
    ): Promise<void> {
        const revision = ++this.revision;
        const data = await this.repository.loadBoard(autoLoadDecks);
        if (revision !== this.revision || !view.isAlive()) return;
        // 每个页签的初始卡组来自后端阵型（`formationId = 页签下标 + 1`）；
        // 没有后端数据时 `buildPresetDecks` 会让所有页签都用本地卡组。
        const decks = buildPresetDecks(data, presetCount);
        // 优先用服务端返回的选中阵型，没有再用默认页签
        let initialPreset = selectedPreset;
        if (data.formations) {
            const selectedFormation = data.formations.find((f) => f.selected);
            if (selectedFormation) {
                initialPreset = selectedFormation.formationId - 1;
            }
        }
        await view.presentBoard({
            ...data,
            draft: new LineupDraftStore(data.deck, 8, presetCount, initialPreset, decks),
        });
    }

    /**
     * 保存（覆盖）一个阵型。返回服务端确认后的结果，由 View 决定怎么提示。
     *
     *  这里不做「先发后到丢弃」—— 保存是用户动作、页面同时只允许一笔（View 用 saving 锁），
     * 与 `refresh()` 的竞态语义不同，硬套 revision 反而会把结果吞掉。
     */
    submit(formationId: number, heroIds: readonly number[], caller?: unknown): Promise<FormationSaveResult> {
        return this.repository.saveFormation(formationId, heroIds, caller);
    }

    dispose(): void { this.revision += 1; }
}

/** 从卡牌页打开升级弹窗时带的业务数据。 */
export interface ICardUpgradeOpenData {
    readonly card: ZCDeckCard | null;
    readonly cardId: string;
    readonly level: number;
    readonly onUpgraded?: (heroId: number, level: number) => void;
}

export type CardUpgradePhase = 'loading' | 'ready' | 'submitting' | 'offline' | 'failed';

export interface CardUpgradePresentation {
    readonly data: ICardUpgradeOpenData;
    readonly cardId: string;
    readonly level: number;
    readonly status: ZCUpgradeStatus | null;
    readonly phase: CardUpgradePhase;
}

export interface CardUpgradeView {
    isAlive(): boolean;
    presentUpgrade(data: CardUpgradePresentation): void;
}

/** 升级弹窗状态机；网络与表读取都经 Repository，View 只负责把状态铺到节点。 */
export class CardUpgradePresenter {
    private revision = 0;
    private data: ICardUpgradeOpenData | null = null;
    private cardId = '';
    private level = 0;
    private status: ZCUpgradeStatus | null = null;
    private phase: CardUpgradePhase = 'loading';

    constructor(private readonly repository: ICardRepository) {}

    async open(data: ICardUpgradeOpenData, view: CardUpgradeView): Promise<void> {
        this.data = data;
        this.cardId = String(data.cardId);
        this.level = Math.max(0, Math.floor(Number(data.level) || 0));
        this.status = null;
        this.phase = 'loading';
        this.emit(view);
        await this.refresh(view);
    }

    async submit(caller: unknown, view: CardUpgradeView): Promise<void> {
        if (!this.data || this.phase === 'submitting' || !this.status?.canUpgrade) return;
        this.phase = 'submitting';
        this.emit(view);
        const result = await this.repository.upgradeHero(Number(this.cardId), caller);
        if (!view.isAlive()) return;
        if (result.kind === 'offline' || result.kind === 'failed') {
            this.phase = result.kind;
            this.emit(view);
            return;
        }
        this.level = result.level;
        this.repository.applyHeroLevel(result.heroId, result.level);
        this.data.onUpgraded?.(result.heroId, result.level);
        await this.refresh(view);
    }

    dispose(): void { this.revision += 1; }

    private async refresh(view: CardUpgradeView): Promise<void> {
        if (!this.data) return;
        const revision = ++this.revision;
        const status = await this.repository.loadUpgradeStatus(this.cardId, this.level);
        if (revision !== this.revision || !view.isAlive()) return;
        this.status = status;
        this.phase = 'ready';
        this.emit(view);
    }

    private emit(view: CardUpgradeView): void {
        if (!this.data || !view.isAlive()) return;
        view.presentUpgrade({
            data: this.data,
            cardId: this.cardId,
            level: this.level,
            status: this.status,
            phase: this.phase,
        });
    }
}
