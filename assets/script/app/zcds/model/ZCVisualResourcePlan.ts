import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type { ZCCompiledModifierLoadout } from './ZCModifierRuntime';
import { zcMissileFxOf } from './ZCCombatEffectFlight';
import { ZC_BLINK_CAST_EFFECT_PREFAB_PATH, zcBlinkCastEffectPath } from './ZCBlinkCastFx';
import { zcSelfAuraEffectPath } from './ZCSelfAuraFx';
import { ZC_BOLT_EFFECT_PREFAB_PATH, zcBoltStrikeEffectPath } from './ZCBoltStrikeFx';
import {
    ZC_TRAP_EXPIRE_PREFAB_PATH, ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_PREFAB_PATH, zcTrapEffectPath,
} from './ZCTrapFx';

export interface IZCVisualDependency {
    readonly unitId: string;
    readonly details: unknown;
}

/** 只识别目录中真实存在的单位 ID，保守保留技能、召唤和替换模型传递依赖。 */
export function resolveZCVisualUnitIds(
    knownIds: readonly string[],
    heroIds: readonly number[],
    dependencies: readonly IZCVisualDependency[],
): ReadonlySet<string> {
    const known = new Set(knownIds);
    const required = new Set(heroIds.map(String).filter((id) => known.has(id)));
    const visit = (value: unknown): void => {
        if (typeof value === 'string' || typeof value === 'number') {
            if (known.has(String(value))) required.add(String(value));
        } else if (Array.isArray(value)) {
            for (const entry of value) visit(entry);
        } else if (value && typeof value === 'object') {
            for (const entry of Object.values(value)) visit(entry);
        }
    };
    for (const unitId of required) {
        for (const dependency of dependencies) if (dependency.unitId === unitId) visit(dependency.details);
    }
    return required;
}

type ZCVisualUnit = Pick<ZCUnitDefinition, 'unitId' | 'prefabPath'> & {
    readonly attackProfile: Pick<ZCUnitDefinition['attackProfile'], 'effectPrefabPath' | 'impactEffectPrefabPath'>;
    readonly empoweredProfile?: Pick<ZCUnitDefinition['attackProfile'], 'effectPrefabPath' | 'impactEffectPrefabPath'>;
    readonly secondaryProfile?: Pick<ZCUnitDefinition['attackProfile'], 'effectPrefabPath'>;
};
type ZCVisualLoadout = Pick<ZCCompiledModifierLoadout, 'targetUnitId'> & {
    readonly textModifiers?: readonly { readonly statId: string; readonly value: string }[];
};

/** 纯计算本局模型与特效清单；不加载资源，不读取全局目录。 */
export function buildZCVisualResourcePlan<T extends ZCVisualUnit>(
    all: readonly T[],
    adapters: {
        readonly skillPlans?: readonly {
            readonly enabled: boolean;
            readonly unitId: string;
            /** 行为键：只有它能让「施法瞬间」这类**代码级**表现被认出来（见 `ZCBlinkCastFx`）。 */
            readonly behaviorKey?: string;
        }[];
        readonly textOverrides: ReadonlyMap<string, { readonly enabled: boolean; readonly statId: string; readonly value: string }>;
    },
    heroIds?: readonly number[],
    modifiers?: Readonly<Record<string, readonly ZCVisualLoadout[] | undefined>>,
): { readonly units: readonly T[]; readonly effectPaths: readonly string[] } {
    const loadouts = Object.values(modifiers ?? {}).flatMap(items => items ?? []);
    const required = heroIds === undefined ? null : resolveZCVisualUnitIds(all.map(unit => unit.unitId), heroIds, [
        all.map(unit => ({ unitId: unit.unitId, details: unit })),
        (adapters.skillPlans ?? []).filter(plan => plan.enabled).map(plan => ({ unitId: plan.unitId, details: plan })),
        loadouts.map(item => ({ unitId: item.targetUnitId, details: item })),
    ].flat());
    const units = required ? all.filter(unit => required.has(unit.unitId)) : all;
    //  移形换影（`blink_strike`，2026-11-07）：施法瞬间在**本体位置**闪的那张
    //  「瞬间移动特效」，路径只登记在代码常量里（行为技能在 `pvpSkill` 里没有造型槽），
    //  所以下面那四个字段一个都收不到 —— 与追踪导弹同一类问题。
    //  漏收的后果：`ZCGameLoader` 不加载 ⇒ 技能照常结算、屏幕上一次闪都没有、且不报错。
    const blinkUnits = new Set((adapters.skillPlans ?? [])
        .filter(plan => plan.enabled && zcBlinkCastEffectPath(plan.behaviorKey))
        .map(plan => plan.unitId));
    //  自身光环（`self_aura`，2026-11-09 大威天芦「无尘禁土」102503）同理：那条光柱的路径
    //  只登记在 `ZCSelfAuraFx` 的代码常量里（行为技能在 `pvpSkill` 里没有造型槽）。
    //  漏收的后果同样静默：技能照常每秒扣血，屏幕上一次都不亮。
    const selfAuraUnits = new Set((adapters.skillPlans ?? [])
        .filter(plan => plan.enabled && zcSelfAuraEffectPath(plan.behaviorKey))
        .map(plan => plan.unitId));
    //  五雷轰顶（`bolt_strike`，2026-11-11 磁电菇 101603）同理：每道雷的 `area` 事件带的是
    //  `ZC_BOLT_EFFECT_PREFAB_PATH`（代码常量），`pvpSkill` 里没有造型槽。
    //  漏收的后果：雷照常结算伤害、屏幕上一道闪电都不画，且不报错。
    const boltUnits = new Set((adapters.skillPlans ?? [])
        .filter(plan => plan.enabled && zcBoltStrikeEffectPath(plan.behaviorKey))
        .map(plan => plan.unitId));
    //  精密陷阱（`trap_place`，2026-11-12 科学家 103504）**有三条**路径，全部只登记在
    //  `ZCTrapFx` 的代码常量里（行为技能在 `pvpSkill` 里没有造型槽）：
    //  生成段 / 常驻段 / 爆炸段。漏收任何一条的后果都是静默的 —— 技能照常结算，
    //  那一段美术凭空消失（生成段漏了是「陷阱直接跳出来」，爆炸段漏了是「踩了不掉血以外没反应」）。
    const trapUnits = new Set((adapters.skillPlans ?? [])
        .filter(plan => plan.enabled && zcTrapEffectPath(plan.behaviorKey))
        .map(plan => plan.unitId));
    // 普攻、命中附加、强化与副轨技能都可能声明独立表现。
    const effects = new Set(units.flatMap(unit => [
        unit.attackProfile.effectPrefabPath,
        unit.attackProfile.impactEffectPrefabPath,
        unit.empoweredProfile?.effectPrefabPath,
        //  强化那一击的**命中爆炸**（2026-11-11 麻辣铁锅「凤凰降临」102604 的
        //  `麻辣铁锅_爆炸龙卷`）。放在**武将技行**上（36182）而不是普攻行，
        //  只收 `attackProfile` 那一份会漏掉它 ⇒ 命中照样结算、屏幕上不炸。
        unit.empoweredProfile?.impactEffectPrefabPath,
        unit.secondaryProfile?.effectPrefabPath,
        blinkUnits.has(unit.unitId) ? ZC_BLINK_CAST_EFFECT_PREFAB_PATH : null,
        selfAuraUnits.has(unit.unitId) ? zcSelfAuraEffectPath('self_aura', unit.unitId) : null,
        boltUnits.has(unit.unitId) ? ZC_BOLT_EFFECT_PREFAB_PATH : null,
        trapUnits.has(unit.unitId) ? ZC_TRAP_SPAWN_PREFAB_PATH : null,
        trapUnits.has(unit.unitId) ? ZC_TRAP_IDLE_PREFAB_PATH : null,
        trapUnits.has(unit.unitId) ? ZC_TRAP_EXPIRE_PREFAB_PATH : null,
        //  追踪导弹（2026-11-03）：弹体/爆炸路径只登记在 `ZCCombatEffectFlight` 的
        //  代码常量表里，pvpSkill 任何一行都不携带 ⇒ 上面四个字段收不到。
        //  漏收的后果：`ZCGameLoader` 不加载 ⇒ `effectVisualPrefabs.get()` 返回 null
        //  ⇒ 导弹弹体与爆炸凭空消失且一条错都不报（2026-11-03 用户反馈「特效没有了」）。
        zcMissileFxOf(unit.unitId)?.missilePrefabPath,
        zcMissileFxOf(unit.unitId)?.impactPrefabPath,
    ]).filter((path): path is string => !!path));
    if (required === null) {
        for (const override of adapters.textOverrides.values()) {
            if (override.enabled && override.statId === 'model') effects.add(override.value);
        }
    } else {
        for (const loadout of loadouts) {
            if (!required.has(loadout.targetUnitId)) continue;
            for (const modifier of loadout.textModifiers ?? []) {
                if (modifier.statId === 'model') effects.add(modifier.value);
            }
        }
    }
    return { units, effectPaths: Array.from(effects) };
}
