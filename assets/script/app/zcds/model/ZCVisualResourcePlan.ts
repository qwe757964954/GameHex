import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type { ZCCompiledModifierLoadout } from './ZCModifierRuntime';
import {
    ZC_EFFECT_BEHAVIOR_SPECS,
    zcEffectMissilePathsForUnit,
    zcEffectPathsForBehavior,
} from './ZCEffectCatalog';

export interface IZCVisualDependency {
    readonly unitId: string;
    readonly details: unknown;
}

/** 只识别目录中真实存在的单位 ID，保守保留技能、召唤和替换模型传递依赖。*/
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

/** 纯计算本局模型与特效清单；不加载资源，不读取全局目录。*/
export function buildZCVisualResourcePlan<T extends ZCVisualUnit>(
    all: readonly T[],
    adapters: {
        readonly skillPlans?: readonly {
            readonly enabled: boolean;
            readonly unitId: string;
            /** 行为键：代码级表现（闪现 / 光环 / 落雷 / 陷阱等）由目录按它取路径。*/
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

    // 行为技能在 pvpSkill 里没有造型槽；按 unit + behaviorKey 收一次，路径从目录取。
    const behaviorKeysByUnit = new Map<string, Set<string>>();
    for (const plan of adapters.skillPlans ?? []) {
        if (!plan.enabled || !plan.behaviorKey) continue;
        const keys = behaviorKeysByUnit.get(plan.unitId) ?? new Set<string>();
        keys.add(plan.behaviorKey);
        behaviorKeysByUnit.set(plan.unitId, keys);
    }

    // 普攻、命中附加、强化与副轨技能都可能声明独立表现；行为组按目录顺序追加，
    // 保持与旧实现相同的路径去重顺序。
    const effects = new Set(units.flatMap(unit => {
        const paths: Array<string | null | undefined> = [
            unit.attackProfile.effectPrefabPath,
            unit.attackProfile.impactEffectPrefabPath,
            unit.empoweredProfile?.effectPrefabPath,
            unit.empoweredProfile?.impactEffectPrefabPath,
            unit.secondaryProfile?.effectPrefabPath,
        ];
        const behaviorKeys = behaviorKeysByUnit.get(unit.unitId);
        if (behaviorKeys) {
            for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
                if (!behaviorKeys.has(spec.behaviorKey)) continue;
                paths.push(...zcEffectPathsForBehavior(spec.behaviorKey, unit.unitId));
            }
        }
        // 追踪导弹的弹体 / 爆炸只在目录的按单位表里登记，pvpSkill 任何一行都不携带。
        paths.push(...zcEffectMissilePathsForUnit(unit.unitId));
        return paths;
    }).filter((path): path is string => !!path));

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
