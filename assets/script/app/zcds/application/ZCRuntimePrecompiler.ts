import type { ConfigService } from '../../../core/config/ConfigService';
import { compilePvpTables } from '../model/ZCPvpConfigCompiler';
import { ZC_RUNTIME_CONFIG } from '../model/ZCRuntimeConfigStore';
import type { ZCPvpTables } from '../model/ZCGameRuntimeConfig';

/** 进对局要用的全部 PVP 分表；空闲期预编译和进对局加载共用这份清单。*/
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

/** 并发调用共用同一个配置任务；会话 reset 后旧结果返回 false，不会装进新会话。*/
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
