import type { ZCUnitDefinition } from './ZCCombatCatalog';
import { classifyModifierTypes, hasUncoveredModifierTypes } from './ZCModifierMapper';
import { compileZCCombatBuild, type ZCCombatBuildSelection, type ZCModifierCatalogs } from './ZCModifierRuntime';

export interface ZCConfigValidationReport {
    ok: boolean;
    errors: readonly string[];
    warnings: readonly string[];
}

/** 导表 / 启动期自检：引用完整性、修改器 type 覆盖，以及指定构筑能不能编出来。*/
export function validateZCModifierConfiguration(
    catalogs: ZCModifierCatalogs,
    units: readonly ZCUnitDefinition[],
    builds: readonly ZCCombatBuildSelection[] = [],
): ZCConfigValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const row of catalogs.generalStars.values()) {
        for (const modifierId of [...row.modify, ...row.impactData]) {
            if (!catalogs.modifiers.has(modifierId)) {
                errors.push(`generalStar ${row.id}:${row.star} 引用缺失修改器 ${modifierId}`);
            }
        }
    }

    const modifierTypes: string[] = [];
    for (const row of catalogs.modifiers.values()) {
        for (const item of row.modify) modifierTypes.push(item.type);
    }
    const coverage = classifyModifierTypes(modifierTypes);
    if (hasUncoveredModifierTypes(coverage)) {
        errors.push(...coverage.filter((item) => item.status === 'unknown').map((item) => `未覆盖修改器类型：${item.type}`));
    }
    warnings.push(...coverage.filter((item) => item.status === 'ignored').map((item) => `显式忽略修改器类型：${item.type}`));

    for (const build of builds) {
        try {
            compileZCCombatBuild(build, units, catalogs);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return { ok: errors.length === 0, errors, warnings };
}
