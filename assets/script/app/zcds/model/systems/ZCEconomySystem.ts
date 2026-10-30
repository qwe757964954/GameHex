import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCBuildingCooldownState, ZCHexState, ZCSnapshot } from '../ZCGameTypes';
import { ZCBuildingPhase } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCUnitStatPatch } from '../ZCModifierRuntime';
import type { IZCModelServices } from './ZCModelServices';

export type ZCUnitDefinitionResolver = (unitId: string) => ZCUnitDefinition;
export type ZCCardResolver = (owner: ZCOwner, cardId: string) => ZCDeckCard | undefined;

export interface ZCEconomyContext extends Pick<IZCModelServices, 'rules' | 'bonuses' | 'unitCount' | 'spawnUnit'> {
    owners: readonly ZCOwner[];
    homeId(owner: ZCOwner): number;
    cardById: ZCCardResolver;
    cycleSeconds(hex: ZCHexState, card: ZCDeckCard): number;
    grantGold(owner: ZCOwner, amount: number, hexId: number): void;
    constructionComplete(hex: ZCHexState): void;
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
                // 🔴 主城收入必须**先确认主城还在**（需求 2026-10-29：「形成废墟的建筑不会再生产金币」）。
                //
                // 这里原来是**无条件**给每一方发钱、并且把金币飘字挂在 `homeId(owner)` 上 ——
                // 主城被打成废墟（`building = 'none'` + `state = 'ruins'` + `hp = 0`）之后，
                // 只要这一方还有别的建筑（`developedCount > 0`，对局没有结束），这段循环照跑，
                // 于是**废墟格上每一拍都飘一次「金币 + 数字」、还带着建筑抖动**，看起来就是
                // 「废墟还在产金币」。金矿那条下面本来就有 `building !== 'mine'` 兜着，
                // 只有主城这一路漏了判断（它的来源不是 `state.hexes` 里的建筑，而是 `homeId`）。
                const homeId = context.homeId(owner);
                if (!this.isIncomeSource(this.hexById(state, homeId), 'hq')) continue;
                context.grantGold(owner, rules.hqIncomeAmount + context.bonuses(owner).incomeBonus * rules.hqIncomeIntervalSeconds,
                    homeId);
            }
        }
        for (const mine of state.hexes) {
            // 与主城同一条闸（`isIncomeSource` = 还是金矿 + 还在运转），废墟金矿不再产出。
            if (mine.owner === 'neutral' || !this.isIncomeSource(mine, 'mine')) continue;
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
        // 「有一栋建筑且它在运转」—— 废墟两条都占反：`building = 'none'`、`state = 'ruins'`。
        // `state` 那一半是**冗余保险**：`damageBuilding` 会同时改这两个字段，但存档 / 回放里
        // 只留下 `state = 'ruins'` 而 `building` 被补回旧值的脏数据不该重新开始产出。
        return hex.building !== 'none' && hex.state !== 'ruins'
            && hex.hp > 0 && hex.constructionRemainingSeconds <= 0;
    }

    /**
     * 这一格现在是不是「某类正在运转的**产出**建筑」—— `tickIncome` 的主城与金矿两条路共用它
     * （兵营 / 箭塔只判 `isBuildingOperational`，它们不产金币）。
     *
     * `hex` 允许 `undefined`（`homeId` 是配置里查出来的 id，快照残缺时可能查不到格子）
     * —— 查不到就是**没有产出**，不是「照发」。
     */
    private static isIncomeSource(hex: ZCHexState | undefined, kind: ZCHexState['building']): hex is ZCHexState {
        return !!hex && hex.building === kind && this.isBuildingOperational(hex);
    }

    /**
     * 按 id 取格。
     *
     * `state.hexes` 是**按 id 稠密排列**的（`id === 下标`，虚空也保留），所以绝大多数情况
     * 一次下标就够；`find` 只是兜住「快照经过裁剪 / 重排」这类不该发生但也不该崩的情况。
     */
    private static hexById(state: ZCSnapshot, hexId: number): ZCHexState | undefined {
        const direct = state.hexes[hexId];
        if (direct && direct.id === hexId) return direct;
        return state.hexes.find((hex) => hex.id === hexId);
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
                phase: ZCBuildingPhase.Construction,
                progress: Math.max(0, Math.min(1, 1 - remaining / total)),
                remainingSeconds: remaining,
                totalSeconds: total,
                ready: false,
            };
        }
        if (hex.building !== 'hq' && !card) return null;
        const phase = hex.building === 'hq' ? ZCBuildingPhase.Income
            : hex.building === 'mine' ? ZCBuildingPhase.Income
                : hex.building === 'barracks' ? ZCBuildingPhase.Spawn : ZCBuildingPhase.Attack;
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

