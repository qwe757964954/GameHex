import type { LineupBoardData } from './CardRepository';
import { LineupDraftStore } from './LineupDraftStore';
import { buildPresetDecks, presetFormationId } from './LineupPresets';
import { isCompleteLineup } from './CardLineupTypes';
import type { LineupBoardPresentation } from './CardPresentations';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

export interface FormationSubmission {
    readonly formationId: number;
    readonly heroIds: readonly number[];
    readonly revision: number;
}
export class LineupBoardModel {
    private draft: LineupDraftStore | null = null;
    private data: LineupBoardData | null = null;
    private revision = 0;
    private saving = false;
    private saveText: string = CARD_LINEUP_TEXTS.boardSave;
    constructor(private readonly presetCount: number, private readonly defaultPreset: number) {}
    load(data: LineupBoardData): void {
        this.data = data;
        const selected = data.formations?.find(entry => entry.selected);
        this.draft = new LineupDraftStore(data.deck, 8, this.presetCount,
            selected ? selected.formationId - 1 : this.defaultPreset, buildPresetDecks(data, this.presetCount));
    }
    get snapshot(): LineupBoardPresentation | null {
        if (!this.draft || !this.data) return null;
        return { ...this.data, ...this.draft.snapshot(), saving: this.saving, canSave: !this.saving, saveText: this.saveText };
    }
    selectPreset(index: number): void { if (!this.draft) return; this.draft.selectPreset(index); this.edited(); }

    /** 当前选中方案的下标。 */
    get selectedPreset(): number {
        return this.draft ? this.draft.selectedIndex : this.defaultPreset;
    }

    /** 当前选中方案对应的后端阵型 id（切页签要把它同步给服务器）。 */
    get selectedFormationId(): number {
        return this.draft ? this.draft.selectedFormationId : presetFormationId(this.defaultPreset);
    }

    /** 目标页签（越界按夹紧后的口径）是否就是当前方案；是的话切页签无意义，也不用提交。 */
    isCurrentPreset(index: number): boolean {
        return !this.draft || this.draft.selectedFormationId === this.draft.formationIdOf(index);
    }

    /**
     * 当前方案是否已是一份「完整阵容」：满编 + 每个品级至少一张（`isCompleteLineup`）。
     *
     * 切页签前用来判定原方案是否可自动保存，切换后用来判定目标方案是否可同步选中。
     * 空方案 / 半成品留在本地 —— 它们没有「最新阵容」可同步，硬发还会把服务端的
     * 出战阵型（`select = 1`）改到一条残缺阵型上。
     */
    get currentLineupComplete(): boolean {
        if (!this.draft) return false;
        return isCompleteLineup(this.draft.snapshot().cards, this.draft.slotLimit);
    }

    /**
     * 切页签前是否要先把当前方案提交给服务器（`saveFormation`）。
     *
     * 比 `currentLineupComplete` 多一个条件：**有未提交改动**。
     * 没改过还发保存，等于把服务端的出战阵型无谓地指到这条上。
     */
    get switchNeedsCommit(): boolean {
        return !!this.draft && this.draft.currentDirty && this.currentLineupComplete;
    }
    reset(): void { if (!this.draft) return; this.draft.reset(); this.edited(); }
    toggle(cardId: string): void {
        if (!this.draft || !this.data) return;
        const card = this.data.pool.find(entry => entry.id === cardId) ?? this.data.deck.find(entry => entry.id === cardId);
        if (!card) return;
        if (this.draft.snapshot().deployedIds.has(cardId)) this.draft.remove(cardId);
        else this.draft.put(card);
        this.edited();
    }
    private edited(): void { this.revision++; if (!this.saving) this.saveText = CARD_LINEUP_TEXTS.boardSave; }
    beginSave(): FormationSubmission | null {
        if (!this.draft || this.saving) return null;
        const heroIds = this.draft.snapshot().cards.map(card => Number(card.id));
        if (heroIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
        this.saving = true; this.saveText = CARD_LINEUP_TEXTS.boardSaving;
        return { formationId: this.draft.selectedFormationId, heroIds, revision: this.revision };
    }
    finishSave(submission: FormationSubmission, result: 'success' | 'offline' | 'failed'): boolean {
        this.saving = false;
        const unchanged = submission.revision === this.revision;
        if (result === 'success' && unchanged) this.draft?.commit();
        this.saveText = result === 'success' ? (unchanged ? CARD_LINEUP_TEXTS.boardSaved : CARD_LINEUP_TEXTS.boardSave)
            : result === 'offline' ? CARD_LINEUP_TEXTS.boardSaveOffline : CARD_LINEUP_TEXTS.boardSaveFailed;
        return unchanged;
    }
}
