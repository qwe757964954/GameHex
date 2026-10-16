import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { presetFormationId } from './LineupPresets';

/** 布阵编辑器对外暴露的不可变快照。 */
export interface LineupDraftSnapshot {
    readonly cards: readonly ZCDeckCard[];
    readonly deployedIds: ReadonlySet<string>;
    readonly selectedPreset: number;
    readonly dirty: boolean;
}

/**
 * 布阵弹窗的局部 Store。它是界面实例私有的，不是全局单例。
 * 页面只从 snapshot 渲染，保存也从 Store 取值，不再从节点名称反查业务数据。
 *
 *  每个「方案」对应一条后端阵型（`CmdFormationInfo.formationId`），页签下标 i → `formationId = i + 1`
 * （见 `formationIdOf`，也是 `LineupBoard.prefab` 的 `PresetRow` 上「1/2/3/4」四个 Label 的口径）。
 * 改建方案时**只改当前方案的草稿**，别的方案原样保留。
 */
export class LineupDraftStore {
    private readonly presets: ZCDeckCard[][];
    private selected = 0;
    private changed = false;

    /**
     * @param initial       兜底卡组：没给 `presets` 时，全部方案都用它做种子
     * @param maxSlots      单个方案的上阵上限（与 prefab 上站台数一致）
     * @param presetCount   方案数量（等于 `PresetRow` 的子节点数）
     * @param selectedPreset 初始选中的方案
     * @param presets       各方案的初始卡组（来自后端阵型）；给定时逐项覆盖 `initial` 的播种结果
     */
    constructor(
        initial: readonly ZCDeckCard[],
        private readonly maxSlots = 8,
        presetCount = 4,
        selectedPreset = 0,
        presets?: readonly (readonly ZCDeckCard[])[],
    ) {
        const total = Math.max(1, Math.floor(presetCount) || 1);
        if (presets && presets.length > 0) {
            this.presets = Array.from({ length: total }, (_unused, index) =>
                this.normalize(presets[index] ?? []));
        } else {
            const seed = this.normalize(initial);
            this.presets = Array.from({ length: total }, () => seed.slice());
        }
        this.selected = this.clampPreset(selectedPreset);
    }

    /**
     * 页签下标 → 后端阵型 id。
     * 口径定义在 `LineupPresets.presetFormationId()`（唯一定义处），这里只是先按方案数夹紧。
     */
    formationIdOf(index: number): number {
        return presetFormationId(this.clampPreset(index));
    }

    /** 当前选中方案对应的阵型 id（保存时用它发包）。 */
    get selectedFormationId(): number {
        return presetFormationId(this.selected);
    }

    snapshot(): LineupDraftSnapshot {
        const cards = this.current().slice();
        return {
            cards,
            deployedIds: new Set(cards.map((card) => card.id)),
            selectedPreset: this.selected,
            dirty: this.changed,
        };
    }

    selectPreset(index: number): LineupDraftSnapshot {
        this.selected = this.clampPreset(index);
        return this.snapshot();
    }

    reset(): LineupDraftSnapshot {
        if (this.current().length > 0) {
            this.presets[this.selected] = [];
            this.changed = true;
        }
        return this.snapshot();
    }

    /** 把卡放进指定槽；同一张卡只允许出现一次。 */
    put(card: ZCDeckCard, slot = this.current().length): LineupDraftSnapshot {
        const next = this.current().filter((entry) => entry.id !== card.id);
        const target = Math.max(0, Math.min(this.maxSlots - 1, Math.floor(slot)));
        next.splice(Math.min(target, next.length), 0, card);
        this.presets[this.selected] = next.slice(0, this.maxSlots);
        this.changed = true;
        return this.snapshot();
    }

    remove(cardId: string): LineupDraftSnapshot {
        const current = this.current();
        const next = current.filter((card) => card.id !== cardId);
        if (next.length !== current.length) {
            this.presets[this.selected] = next;
            this.changed = true;
        }
        return this.snapshot();
    }

    /** 标记当前草稿已保存，并返回稳定的上阵 id 顺序。 */
    commit(): readonly string[] {
        this.changed = false;
        return this.current().map((card) => card.id);
    }

    private current(): ZCDeckCard[] {
        return this.presets[this.selected];
    }

    private normalize(cards: readonly ZCDeckCard[]): ZCDeckCard[] {
        const ids = new Set<string>();
        const result: ZCDeckCard[] = [];
        for (const card of cards) {
            if (!card || ids.has(card.id)) continue;
            ids.add(card.id);
            result.push(card);
            if (result.length >= this.maxSlots) break;
        }
        return result;
    }

    private clampPreset(index: number): number {
        return Math.max(0, Math.min(this.presets.length - 1, Math.round(Number(index) || 0)));
    }
}
