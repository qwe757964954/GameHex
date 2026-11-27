import type { ZCUnitDefinition } from './ZCCombatCatalog';
import type { ZCCompiledModifierLoadout } from './ZCModifierRuntime';
import {
    ZC_EFFECT_BEHAVIOR_SPECS,
    zcEffectMissilePathsForUnit,
    zcEffectPathsForBehavior,
    zcRangeRingPathsForUnit,
    zcSelfAuraLandingPath,
} from './ZCEffectCatalog';
import { zcLanceEffectPrefabPathsForUnit } from './ZCLanceFx';
import { zcTrapFlightPathsForUnit } from './ZCTrapFx';
import { zcBulletRainImpactPathsForUnit } from './ZCProjectileDropStyle';

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
            // 「落地那一击」是**另一张表**（`SELF_AURA_LANDING_FX_BY_UNIT`），不在 behavior 组里
            // ⇒ 不单独收的话，本局没有那位施法单位时这条路径根本不加载：
            // 区域照常结算、天上什么都没砸下来、且不报错。
            // 2026-11-25 第 51 批换冰法师通用子弹时才发现这条漏收（旧 `iceCone` 是靠
            // 冰法师在场时被 `attackProfile.effectPrefabPath` 顺带收进去的）。
            for (const key of behaviorKeys) paths.push(zcSelfAuraLandingPath(key, unit.unitId));
        }
        // 追踪导弹的弹体 / 爆炸只在目录的按单位表里登记，pvpSkill 任何一行都不携带。
        paths.push(...zcEffectMissilePathsForUnit(unit.unitId));
        // 弹道雨的**命中特效**同理（第 56 批）：弹体掉完就消失，地上的那一下全靠这条路径。
        // 漏收 = 子弹到点凭空没了、落点什么都没有，且不报错。
        paths.push(...zcBulletRainImpactPathsForUnit(unit.unitId));
        // 技能范围指示白环同理：只在 `ZCSkillRangeRingFx` 的按单位名单里（戈壁狂箭 / 冰山陨落 /
        // 篮球火 三张卡），配置行的造型槽里没有它。
        paths.push(...zcRangeRingPathsForUnit(unit.unitId));
        // 破阵术的弹体也不在 `attackProfile` 里（`lanceProfileOf` 现造，2026-11-26 第 57 批）：
        // 漏收 = 投枪飞出去是一根隐形的枪，伤害照常结算、画面全无。
        paths.push(...zcLanceEffectPrefabPathsForUnit(unit.unitId));
        // 投掷陷阱的**飞行段**美术同理（`ZC_TRAP_FLIGHT_PREFAB_BY_UNIT`，2026-11-26 第 57 批）：
        // 漏收 = 蘑菇只有落地之后那一半，「丢出去」的过程什么都没有。
        paths.push(...zcTrapFlightPathsForUnit(unit.unitId));
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
