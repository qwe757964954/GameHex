import type { ZCUnitDefinition } from './ZCCombatCatalog';
import { classifyModifierTypes, hasUncoveredModifierTypes } from './ZCModifierMapper';
import { compileZCCombatBuild, type ZCCombatBuildSelection, type ZCModifierCatalogs } from './ZCModifierRuntime';

export interface ZCConfigValidationReport {
    ok: boolean;
    errors: readonly string[];
    warnings: readonly string[];
}

/** 启动/构建期校验：引用、type 覆盖和指定构筑的属性白名单一次性闭环。 */
export function validateZCModifierConfiguration(
    catalogs: ZCModifierCatalogs,
    units: readonly ZCUnitDefinition[],
    builds: readonly ZCCombatBuildSelection[] = [],
): ZCConfigValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const row of catalogs.generalStars.values()) {
        for (const modifierId of [...row.modify, ...row.impactData]) {
            if (!catalogs.modifiers.has(modifierId)) errors.push(`generalStar ${row.id}:${row.star} 引用缺失修改器 ${modifierId}`);
        }
    }
    const types = Array.from(catalogs.modifiers.values()).flatMap((row) => row.modify.map((item) => item.type));
    const coverage = classifyModifierTypes(types);
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

export function assertZCModifierConfiguration(
    catalogs: ZCModifierCatalogs,
    units: readonly ZCUnitDefinition[],
    builds: readonly ZCCombatBuildSelection[] = [],
): void {
    const report = validateZCModifierConfiguration(catalogs, units, builds);
    if (!report.ok) throw new Error(`[ZCConfigValidator] ${report.errors.join('; ')}`);
}
