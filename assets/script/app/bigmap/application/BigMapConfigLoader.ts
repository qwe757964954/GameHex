import type { ConfigService } from '../../../core/config/ConfigService';
import {
    BIGMAP_TABLE, attachBigMapResourceItemIcons, parseBigMapConfig, type BigMapRawTables,
} from '../model/BigMapConfig';
import { applyBigMapScheduleOverrides } from '../model/BigMapCitySchedule';
import type { IBigMapConfig } from '../model/BigMapTypes';
import { withBigMapCampCities } from '../model/BigMapCampWorld';

/**
 * 从 `ConfigService` 读取 BigMap 表（含联机据点 bigMapCamp）并解析成强类型配置。
 *
 * 读取走项目统一的 `getTable(name)`（运行时是 `RefUtil` 解压后的对象数组），
 * 解析统一走 `parseBigMapConfig`（与单测同一条路径），所以「表改了但没重启」这类问题
 * 会在构造阶段就抛错，而不是跑到一半发现某张表是空的。
 *
 * 攻城时点分两处配：`bigmapSchedule` 表给四个时点，`gameConfig` 的
 * `bigMapStartCountRankTime` / `bigMapRankRewardTime` / `bigMapReFreshRankStopTime`
 * 覆盖其中三项（2026-10-30 协议变更，见 `applyBigMapScheduleOverrides`）。
 */
export async function loadBigMapConfig(config: ConfigService): Promise<IBigMapConfig> {
    const tables: Record<string, unknown> = {};
    const names = Object.values(BIGMAP_TABLE);
    const rowsList = await Promise.all(names.map((name) => config.getTable(name)));
    names.forEach((name, index) => { tables[name] = rowsList[index]; });
    const parsed = await applyScheduleOverrides(config, withBigMapCampCities(parseBigMapConfig(tables as BigMapRawTables)));
    // 顶栏资源图标跟背包道具共用一份图（`bigmapResource.itemId` → `item.icon`）。
    return attachBigMapResourceItemIcons(parsed, await readItemRows(config, parsed));
}

/**
 * 用 `gameConfig` 覆盖攻城时点。
 *
 * `gameConfig` 是**全局表**、不在 `BIGMAP_TABLE` 清单里，所以单独读一次；
 * 读不到 / 表还没导都不影响打开世界页 —— 退回 `bigmapSchedule` 表值。
 */
async function applyScheduleOverrides(config: ConfigService, parsed: IBigMapConfig): Promise<IBigMapConfig> {
    let rows: readonly unknown[];
    try {
        rows = await config.getTable('gameConfig');
    } catch (error) {
        console.warn('[BigMapConfigLoader] gameConfig 读取失败，攻城时点退回 bigmapSchedule 表值', error);
        return parsed;
    }
    const schedule = applyBigMapScheduleOverrides(parsed.schedule, rows);
    return schedule === parsed.schedule ? parsed : { ...parsed, schedule };
}

/**
 * 读 `item` 表拿背包图标。表读不到 / 还没导（`item.json` 落后于 Excel）都不影响大地图打开 ——
 * 退回空表，视图就用概念图。
 */
async function readItemRows(config: ConfigService, parsed: IBigMapConfig): Promise<readonly unknown[]> {
    const usesItem = [...parsed.resources.values()].some((res) => res.itemId > 0);
    if (!usesItem) return [];
    try {
        return await config.getTable('item');
    } catch (error) {
        console.warn('[BigMapConfigLoader] 背包道具表读取失败，资源图标退回概念图', error);
        return [];
    }
}

/** 给编辑器/单测用：直接把已经读好的表塞进来。 */
export function loadBigMapConfigFromTables(tables: BigMapRawTables): IBigMapConfig {
    return parseBigMapConfig(tables);
}
