import { calculateDeckBonuses } from './ZCCombatCatalog';
import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from './ZCCombatCatalog';
import type { ZCMatchConfig } from './ZCMatchConfig';
import { ZC_OWNER_ORDER } from './ZCMapConfig';
import type { ZCOwner } from './ZCMapConfig';
import { resolveZCUnitDefinition, resolveZCUnitStatPatch } from './ZCModifierRuntime';
import type { ZCCompiledModifierLoadout, ZCUnitStatPatch } from './ZCModifierRuntime';
import { ZCSkillRuntimeRegistry } from './ZCSkillRuntime';
import type { ZCSkillRuntimeDefinition } from './ZCSkillRuntime';

export interface IZCMatchRuntime {
    readonly definitions: ReadonlyMap<string, ZCUnitDefinition>;
    readonly effectiveDefinitions: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCUnitDefinition>>>;
    readonly cards: ReadonlyMap<string, ZCDeckCard>;
    readonly skillRuntime: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>>;
    readonly legacyAttributes: Readonly<Record<ZCOwner, ReadonlyMap<string, Readonly<Record<string, unknown>>>>>;
    readonly deckBonuses: Readonly<Record<ZCOwner, ZCDeckBonuses>>;
    /**
     * 2026-10-13 新增的 9 种 statId 的累加值（暴击/弹幕/连击/产兵）。
     * 它们不在 `ZCUnitDefinition` 上（没有基础值），只能按 `owner × unitId` 索引后在战斗结算处查。
     */
    readonly unitStatPatches: Readonly<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>>;
}

/** 本局静态目录只从已冻结配置派生，不读取全局表也不消费随机数。 */
export function compileZCMatchRuntime(config: Readonly<ZCMatchConfig>): IZCMatchRuntime {
    const deckFor = (owner: ZCOwner): readonly ZCDeckCard[] => config.ownerDecks?.[owner]
        ?? (owner === 'player' ? config.playerDeck : config.enemyDeck);
    const loadoutsFor = (owner: ZCOwner): readonly ZCCompiledModifierLoadout[] => config.modifiers?.[owner]
        ?? (owner === 'player' ? [] : config.modifiers?.enemy ?? []);
    const definitions = new Map(config.units.map((unit) => [unit.unitId, unit]));
    const effectiveDefinitions = {} as Record<ZCOwner, ReadonlyMap<string, ZCUnitDefinition>>;
    const unitStatPatches = {} as Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>;
    const skillRuntime = {} as Record<ZCOwner, ReadonlyMap<string, ZCSkillRuntimeDefinition>>;
    const legacyAttributes = {} as Record<ZCOwner, ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    const deckBonuses = {} as Record<ZCOwner, ZCDeckBonuses>;
    const cards = new Map<string, ZCDeckCard>();
    const skillRegistry = new ZCSkillRuntimeRegistry();

    for (const owner of ZC_OWNER_ORDER) {
        const loadouts = loadoutsFor(owner);
        const deck = deckFor(owner);
        effectiveDefinitions[owner] = new Map(config.units.map((unit) => [
            unit.unitId,
            resolveZCUnitDefinition(unit, loadouts),
        ]));
        unitStatPatches[owner] = new Map(config.units.map((unit) => [
            unit.unitId,
            resolveZCUnitStatPatch(unit, loadouts),
        ]));
        const typed = loadouts.flatMap((loadout) => loadout.typedModifiers);
        const runtimes = new Map<string, ZCSkillRuntimeDefinition>(skillRegistry
            .compileBindings((config.skillBindings ?? []).filter((binding) => binding.enabled), typed)
            .map((runtime) => [`${runtime.unitId}:${runtime.skillId}`, runtime] as const));
        //  技能计划在构筑期就选好了（`loadout.skillPlans`），这里只把有行为钩子的登记进运行时。
        for (const loadout of loadouts) {
            for (const plan of loadout.skillPlans ?? []) {
                if (!plan.behaviorKey) continue;
                const key = `${loadout.targetUnitId}:${plan.pvpSkillId}`;
                if (runtimes.has(key)) continue;
                const compiled = skillRegistry.compile({ ...plan, targetUnitId: loadout.targetUnitId } as never, typed);
                if (compiled) runtimes.set(key, compiled);
            }
        }
        skillRuntime[owner] = runtimes;
        legacyAttributes[owner] = new Map(loadouts.map((loadout) => [loadout.targetUnitId, loadout.rawAttributes]));
        deckBonuses[owner] = calculateDeckBonuses(deck);
        for (const card of deck) cards.set(card.id, card);
    }

    return { definitions, effectiveDefinitions, unitStatPatches, cards, skillRuntime, legacyAttributes, deckBonuses };
}
