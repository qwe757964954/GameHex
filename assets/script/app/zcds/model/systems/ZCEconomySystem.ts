import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCBuildingCooldownState, ZCHexState, ZCSnapshot } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';

export type ZCUnitDefinitionResolver = (unitId: string) => ZCUnitDefinition;
export type ZCCardResolver = (owner: ZCOwner, cardId: string) => ZCDeckCard | undefined;

export interface ZCEconomyContext {
    rules: Readonly<ZCRuntimeRules>;
    owners: readonly ZCOwner[];
    homeId(owner: ZCOwner): number;
    bonuses(owner: ZCOwner): ZCDeckBonuses;
    cardById: ZCCardResolver;
    cycleSeconds(hex: ZCHexState, card: ZCDeckCard): number;
    grantGold(owner: ZCOwner, amount: number, hexId: number): void;
    constructionComplete(hex: ZCHexState): void;
    unitCount(owner: ZCOwner): number;
    spawnUnit(owner: ZCOwner, card: ZCDeckCard, tier: number, hexId: number): void;
    recruitPatch?(owner: ZCOwner, card: ZCDeckCard): Readonly<ZCUnitStatPatch>;
}

/** 建筑建造、周期推进、主城和金矿收入、兵营产兵规则。 */
export class ZCEconomySystem {
    static tickConstruction(state: ZCSnapshot, dt: number, context: ZCEconomyContext): void {
        for (const hex of state.hexes) {
            if (hex.building === 'none' || hex.constructionRemainingSeconds <= 0) continue;
            hex.constructionRemainingSeconds = Math.max(0, Math.round((hex.constructionRemainingSeconds - dt) * 1e9) / 1e9);
            if (hex.constructionRemainingSeconds === 0) context.constructionComplete(hex);
        }
    }

    static tickIncome(state: ZCSnapshot, dt: number, context: ZCEconomyContext): void {
        const rules = context.rules;
        state.incomeClock = Math.round((state.incomeClock + dt) * 1e9) / 1e9;
        while (state.incomeClock >= rules.hqIncomeIntervalSeconds) {
            state.incomeClock -= rules.hqIncomeIntervalSeconds;
            for (const owner of context.owners) {
                context.grantGold(owner, rules.hqIncomeAmount + context.bonuses(owner).incomeBonus * rules.hqIncomeIntervalSeconds,
                    context.homeId(owner));
            }
        }
        for (const mine of state.hexes) {
            if (mine.building !== 'mine' || mine.owner === 'neutral' || !this.isBuildingOperational(mine)) continue;
            const card = mine.cardId ? context.cardById(mine.owner, mine.cardId) : undefined;
            if (!card) continue;
            const interval = context.cycleSeconds(mine, card);
            const key = this.cycleKey(mine);
            this.advanceCycle(state, key, dt);
            while (state.spawnClocks[key] >= interval) {
                state.spawnClocks[key] -= interval;
                context.grantGold(mine.owner, card.buildDigGoldNum ?? 0, mine.id);
            }
        }
    }

    static tickBarracks(state: ZCSnapshot, dt: number, context: ZCEconomyContext): void {
        const rules = context.rules;
        for (const hex of state.hexes) {
            if (hex.building !== 'barracks' || hex.owner === 'neutral' || !hex.cardId || !this.isBuildingOperational(hex)) continue;
            if (context.unitCount(hex.owner) >= rules.unitCapPerSide) continue;
            const card = context.cardById(hex.owner, hex.cardId);
            if (!card?.unitId) continue;
            const key = this.cycleKey(hex);
            const interval = this.recruitIntervalSeconds(hex, card, context);
            this.advanceCycle(state, key, dt);
            if (state.spawnClocks[key] < interval) continue;
            state.spawnClocks[key] -= interval;
            this.spawnBarracksBatch(hex, card, context);
        }
    }

    static recruitIntervalSeconds(hex: ZCHexState, card: ZCDeckCard, context: ZCEconomyContext): number {
        const patch = hex.owner === 'neutral' ? undefined : context.recruitPatch?.(hex.owner, card);
        const cycle = context.cycleSeconds(hex, card);
        return Math.max(
            context.rules.spawnMinimumSeconds,
            (cycle + (patch?.recruitCdFlat ?? 0)) * Math.max(0.1, 1 + (patch?.recruitCdPct ?? 0) / 100),
        );
    }

    static spawnFirstBarracksUnit(hex: ZCHexState, context: ZCEconomyContext): void {
        if (hex.building !== 'barracks' || hex.owner === 'neutral' || !hex.cardId || !this.isBuildingOperational(hex)) return;
        const card = context.cardById(hex.owner, hex.cardId);
        if (!card?.unitId) return;
        this.spawnBarracksBatch(hex, card, context);
    }

    private static spawnBarracksBatch(hex: ZCHexState, card: ZCDeckCard, context: ZCEconomyContext): void {
        if (hex.owner === 'neutral') return;
        const patch = context.recruitPatch?.(hex.owner, card);
        // 配表上限与全局人口上限都作用于该方当前存活单位数。
        const cap = patch?.recruitMaxNumFlat && patch.recruitMaxNumFlat > 0
            ? Math.min(context.rules.unitCapPerSide, Math.round(patch.recruitMaxNumFlat))
            : context.rules.unitCapPerSide;
        const amount = Math.max(1, Math.floor(card.cycleBaseValue ?? 1)
            + Math.round(patch?.singleRecruitNumFlat ?? 0)
            + Math.round(patch?.singleRecruitLegionCountFlat ?? 0));
        for (let index = 0; index < amount; index += 1) {
            if (context.unitCount(hex.owner) >= cap) break;
            context.spawnUnit(hex.owner, card, hex.tier, hex.id);
        }
    }

    private static advanceCycle(state: ZCSnapshot, key: string, dt: number): void {
        state.spawnClocks[key] = Math.round(((state.spawnClocks[key] || 0) + dt) * 1e9) / 1e9;
    }

    static isBuildingOperational(hex: ZCHexState): boolean {
        return hex.hp > 0 && hex.constructionRemainingSeconds <= 0;
    }

    static cycleKey(hex: Pick<ZCHexState, 'id' | 'building'>): string {
        return `${hex.building}:${hex.id}`;
    }

    static buildingCycleSeconds(
        hex: ZCHexState,
        card: ZCDeckCard,
        bonuses: ZCDeckBonuses,
        rules: Readonly<ZCRuntimeRules>,
        resolveUnit: ZCUnitDefinitionResolver,
    ): number {
        if (hex.building === 'barracks') {
            //  单位定义**延迟求值**：`soilderAddTime`（= card.cycleSeconds）就是产兵间隔，
            // 只有它缺失时才回落到单位表的 `spawnSeconds`。
            // 原来的写法无条件先 `resolveUnit(...)`，等于让每一次 tick 都强依赖「单位可上场」——
            // 卡表引用了单位表里还没配好「预设 / 普攻技能」的行时，第一个 tick 就抛错（对局瞬间崩）。
            const cycle = card.cycleSeconds || (card.unitId ? resolveUnit(card.unitId).spawnSeconds : 8);
            return Math.max(
                rules.spawnMinimumSeconds,
                cycle * bonuses.spawnIntervalMultiplier - hex.tier * rules.spawnTierReduction,
            );
        }
        return Math.max(0.05, card.cycleSeconds || (hex.building === 'tower' ? rules.towerAttackInterval : 1));
    }

    static buildingCooldown(
        state: ZCSnapshot,
        hex: ZCHexState,
        card: ZCDeckCard | undefined,
        cycleSeconds: number,
    ): ZCBuildingCooldownState | null {
        if (hex.building === 'none') return null;
        if (hex.constructionRemainingSeconds > 0) {
            const total = Math.max(0.001, hex.constructionTotalSeconds);
            const remaining = Math.min(total, hex.constructionRemainingSeconds);
            return {
                phase: 'construction',
                progress: Math.max(0, Math.min(1, 1 - remaining / total)),
                remainingSeconds: remaining,
                totalSeconds: total,
                ready: false,
            };
        }
        if (hex.building !== 'hq' && !card) return null;
        const phase = hex.building === 'hq' ? 'income'
            : hex.building === 'mine' ? 'income'
                : hex.building === 'barracks' ? 'spawn' : 'attack';
        const total = Math.max(0.001, cycleSeconds);
        const clock = hex.building === 'hq'
            ? state.incomeClock
            : state.spawnClocks[ZCEconomySystem.cycleKey(hex)] || 0;
        const progress = Math.max(0, Math.min(1, clock / total));
        return {
            phase,
            progress,
            remainingSeconds: Math.max(0, total - clock),
            totalSeconds: total,
            ready: progress >= 0.999,
        };
    }

    static mineIncome(
        owner: ZCOwner,
        hexes: readonly ZCHexState[],
        resolveCard: ZCCardResolver,
        cycleSeconds: (hex: ZCHexState, card: ZCDeckCard) => number,
    ): number {
        return hexes
            .filter((hex) => hex.owner === owner && hex.building === 'mine' && ZCEconomySystem.isBuildingOperational(hex))
            .reduce((total, hex) => {
                const card = hex.cardId ? resolveCard(owner, hex.cardId) : undefined;
                if (!card) return total;
                // 每次产金数量：卡表 `buildDigGoldNum`，**固定值不随品级变化**。
                const amount = card.buildDigGoldNum ?? 0;
                return total + amount / cycleSeconds(hex, card);
            }, 0);
    }
}
