import type { ConfigService } from '../../../core/config/ConfigService';
import { BIGMAP_TABLE, parseBigMapConfig, type BigMapRawTables } from '../model/BigMapConfig';
import type { IBigMapConfig } from '../model/BigMapTypes';

/**
 * 从 `ConfigService` 把 12 张 BigMap 表读出来并解析成强类型配置。
 *
 * 读取走项目统一的 `getTable(name)`（运行时是 `RefUtil` 解压后的对象数组），
 * 解析统一走 `parseBigMapConfig`（与单测同一条路径），所以「表改了但没重启」这类问题
 * 会在构造阶段就抛错，而不是跑到一半发现某张表是空的。
 */
export async function loadBigMapConfig(config: ConfigService): Promise<IBigMapConfig> {
    const tables: Record<string, unknown> = {};
    const names = Object.values(BIGMAP_TABLE);
    const rowsList = await Promise.all(names.map((name) => config.getTable(name)));
    names.forEach((name, index) => { tables[name] = rowsList[index]; });
    return parseBigMapConfig(tables as BigMapRawTables);
}

/** 给编辑器/单测用：直接把已经读好的表塞进来。 */
export function loadBigMapConfigFromTables(tables: BigMapRawTables): IBigMapConfig {
    return parseBigMapConfig(tables);
}
