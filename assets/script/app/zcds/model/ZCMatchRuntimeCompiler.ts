import type { ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from './ZCCombatCatalog';
import { calculateDeckBonuses } from './ZCCombatCatalog';
import { ZCOwner } from './ZCMapConfig';
import { ZC_OWNER_ORDER } from './ZCMapConfig';
import type { ZCMatchConfig } from './ZCMatchConfig';
import type { ZCCompiledModifierLoadout, ZCUnitStatPatch } from './ZCModifierRuntime';
import { resolveZCUnitDefinition, resolveZCUnitStatPatch, shareLineupCritDamage } from './ZCModifierRuntime';
import type { ZCSkillPlanRecord } from './ZCStatSchema';
import type { ZCSkillRuntimeDefinition } from './ZCSkillRuntime';
import { ZCSkillRuntimeRegistry } from './ZCSkillRuntime';
import { skillCastLog, zcSkillCastWatched } from '../ZCSkillCastDiagnostics';

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
        ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
    const loadoutsFor = (owner: ZCOwner): readonly ZCCompiledModifierLoadout[] => config.modifiers?.[owner]
        ?? (owner === ZCOwner.Player ? [] : config.modifiers?.enemy ?? []);
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
            resolveZCUnitDefinition(unit, loadouts, config.ownerRates?.[owner]),
        ]));
        unitStatPatches[owner] = shareLineupCritDamage(new Map(config.units.map((unit) => [
            unit.unitId,
            resolveZCUnitStatPatch(unit, loadouts),
        ])));
        //  全队暴击伤害是 owner 级共享值（2026-11-10）：先把阵容里所有卡的 `critDamage` 汇总成一个数，
        //  再写回每一个单位 —— 见 `shareLineupCritDamage`。暴击率不走这条，仍然逐单位各自累加。
        const typed = loadouts.flatMap((loadout) => loadout.typedModifiers);
        const runtimes = new Map<string, ZCSkillRuntimeDefinition>(skillRegistry
            .compileBindings((config.skillBindings ?? []).filter((binding) => binding.enabled), typed)
            .map((runtime) => [`${runtime.unitId}:${runtime.skillId}`, runtime] as const));
        //  技能计划在构筑期就选好了（`loadout.skillPlans`），这里只把有行为钩子的登记进运行时。
        for (const loadout of loadouts) {
            for (const plan of loadout.skillPlans ?? []) {
                const key = `${loadout.targetUnitId}:${plan.pvpSkillId}`;
                //  2026-10-29：同一条 `unitId:pvpSkillId` 会有多个计划行（被动 100103 挂命中减益、
                //  主动 100104 给连发参数），它们共用「普攻 profile」这一个 key。原来 `runtimes.has(key)`
                //  直接 `continue`，先到的行把后面的参数整份吃掉 —— 表现为「表填了、参数没生效」。
                //  改成合并：参数叠加、状态各归各槽位，没有参数也没有状态时原样跳过。
                const merged = mergeSkillPlanIntoRuntime(runtimes.get(key), plan, loadout.targetUnitId);
                if (merged) {
                    runtimes.set(key, merged);
                    continue;
                }
                if (runtimes.has(key) || !plan.behaviorKey) continue;
                const compiled = skillRegistry.compile({ ...plan, targetUnitId: loadout.targetUnitId } as never, typed);
                //  2026-10-30：**没有 `pvpSkillBinding` 行的技能也只有这里一条路**。
                //  `compile` 只从 skill 域修饰器汇聚参数，看不见计划行自己的 `skillParamJson`；
                //  原来的写法把它整份丢掉，表现是「表里填了 pierceCount / statusEveryNAttacks、运行时读不到」。
                //  因为 `merge*` 在上面只对「已存在的 runtime」生效，新建这条分支必须自己把参数合进来。
                if (compiled) {
                    runtimes.set(key, plan.skillParams
                        ? { ...compiled, parameters: { ...compiled.parameters, ...plan.skillParams } }
                        : compiled);
                }
            }
        }
        skillRuntime[owner] = runtimes;
        //  诊断②：本局建出来的技能运行时里到底有什么参数。
        //  `auraCooldown` / `pierceCount` 这类键**只可能**从 `pvpSkillPlan.skillParamJson` 并进来，
        //  这里看不到就说明构筑期已经把整卡跳过了（诊断①会同时给出原因）。
        for (const runtime of runtimes.values()) {
            if (!zcSkillCastWatched(runtime.unitId)) continue;
            skillCastLog('运行时', `${owner} ${runtime.unitId}:${runtime.skillId}`
                + ` behaviorKey=${runtime.behaviorKey ?? 'null'}`
                + ` 参数=${JSON.stringify(runtime.parameters)}`);
        }
        const attributes = new Map<string, Readonly<Record<string, unknown>>>();
        for (const loadout of loadouts) {
            attributes.set(loadout.targetUnitId, {
                ...attributes.get(loadout.targetUnitId),
                ...loadout.rawAttributes,
            });
        }
        legacyAttributes[owner] = attributes;
        deckBonuses[owner] = calculateDeckBonuses(deck);
        for (const card of deck) cards.set(card.id, card);
    }
    for (const card of config.pveDefence?.cards ?? []) {
        if (!cards.has(card.id)) cards.set(card.id, card);
    }

    return { definitions, effectiveDefinitions, unitStatPatches, cards, skillRuntime, legacyAttributes, deckBonuses };
}

/**
 * 把一条计划行的「参数 + 状态」并进已存在的技能运行时（2026-10-29）。
 *
 * - 返回 `null` ⇒ 没有可合并的东西（调用方按原逻辑继续）；
 * - 参数**叠加**在旧参数之上（同名覆盖），状态只在计划声明了才覆盖 ——
 *   这样 100103（命中减速）与 100104（连发参数）可以共用一个 `unitId:pvpSkillId`。
 */
function mergeSkillPlanIntoRuntime(
    existing: ZCSkillRuntimeDefinition | undefined,
    plan: ZCSkillPlanRecord,
    unitId: string,
): ZCSkillRuntimeDefinition | null {
    if (!existing || existing.unitId !== unitId) return null;
    const params = plan.skillParams;
    const statusId = plan.statusId;
    if (!params && !statusId) return null;
    const passive = plan.behaviorKey === 'passive_status';
    return {
        ...existing,
        parameters: params ? { ...existing.parameters, ...params } : existing.parameters,
        statusId: statusId && !passive ? statusId : existing.statusId,
        passiveStatusId: statusId && passive ? statusId : existing.passiveStatusId,
    };
}
