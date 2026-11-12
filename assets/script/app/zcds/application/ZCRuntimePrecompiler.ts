import type { ConfigService } from '../../../core/config/ConfigService';
import { isZCRuntimeCompiled, loadPvpTables } from '../model/ZCGameRuntimeConfig';
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
 * 幂等确保 PVP 运行时目录已编译安装（getTable ×24 → loadPvpTables 内部编译）。
 *
 * 已编译直接返回；本模块为纯 TS、不依赖 cc，由组合根注入会话空闲任务，把全量解压与编译的
 * 同步 CPU 移出"切对局"关键路径。不绑定单局 scope，故不做取消：编译结果为配置级只读数据，
 * 对局间可安全复用，重复调用幂等。
 */
export async function ensureZCRuntimeCompiled(configs: ConfigService): Promise<void> {
    if (isZCRuntimeCompiled()) return;
    await configs.initialize();
    const values = await Promise.all(ZC_RUNTIME_TABLE_NAMES.map((name) => configs.getTable(name)));
    // 表名与 ZCPvpTables 的可选字段一一对应，按 Partial<ZCPvpTables> 拼装，不做双重断言。
    const tables: Partial<ZCPvpTables> = {};
    ZC_RUNTIME_TABLE_NAMES.forEach((name, index) => {
        (tables as Record<string, unknown>)[name] = values[index] ?? [];
    });
    loadPvpTables(tables);
}
