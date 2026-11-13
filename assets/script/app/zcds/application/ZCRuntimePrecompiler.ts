import type { ConfigService } from '../../../core/config/ConfigService';
import { compilePvpTables } from '../model/ZCPvpConfigCompiler';
import { ZC_RUNTIME_CONFIG } from '../model/ZCRuntimeConfigStore';
import type { ZCPvpTables } from '../model/ZCGameRuntimeConfig';

/** 进入对局所需的全部 PVP 分表；空闲期预编译与进对局加载共用此清单。 */
export const ZC_RUNTIME_TABLE_NAMES = [
    'pvpGlobal',
    'pvpArtifact',
    'pvpCard',
    'pvpSkill',
    'pvpCounter',
    'pvpBond',
    'pvpTile',
    'pvpPity',
    'pvpTileGen',
    'pvpTileGenParams',
    'neutralResourceGroup',
    'neutralEnhanceGate',
    'skillAttrModifier',
    'generalStar',
    'pvpAttrMap',
    'pvpModifierOverride',
    'pvpUnitGrowth',
    'pvpSkillBinding',
    'pvpStatus',
    'pvpSkillPlan',
    'skillAttr',
    'skillView',
    'skillEffect',
    'skillBuff',
] as const;

/**
 * 并发调用复用同一配置任务；会话 reset 后旧结果返回 false，不安装到新会话。
 */
export function ensureZCRuntimeCompiled(configs: ConfigService): Promise<boolean> {
    return ZC_RUNTIME_CONFIG.ensure(async () => {
        await configs.initialize();
        const values = await Promise.all(ZC_RUNTIME_TABLE_NAMES.map((name) => configs.getTable(name)));
        const tables: Partial<ZCPvpTables> = {};
        ZC_RUNTIME_TABLE_NAMES.forEach((name, index) => {
            (tables as Record<string, unknown>)[name] = values[index] ?? [];
        });
        return compilePvpTables(tables);
    });
}
