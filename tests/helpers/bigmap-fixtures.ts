/**
 * BigMap 测试夹具：直接从 `assets/remoteRef/` 读盘上的 `{k,v}` 压缩表，
 * 走**与运行时同一条**解析入口 `parseBigMapConfig`。
 *
 * 这样「配置表写错」「公式改坏」会先在单测里炸，而不是等进游戏才炸。
 */
import { readFileSync } from 'node:fs';
import { BIGMAP_TABLE, parseBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapConfig';
import { parseBigMapLayout, type IBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';
import type { IBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapTypes';
import type { IBigMapUnlockContext } from '../../assets/script/app/bigmap/model/BigMapUnlock';

function readTable(name: string): unknown {
    const url = new URL(`../../assets/remoteRef/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
}

/** 读取全部 12 张 BigMap 表并解析成强类型配置。 */
export function loadBigMapConfig(offlineMonsters = false): IBigMapConfig {
    const tables: Record<string, unknown> = {};
    for (const name of Object.values(BIGMAP_TABLE)) tables[name] = readTable(name);
    // 旧版战斗公式测试固定使用历史快照；页面与配置契约测试始终默认读取最新导出表。
    if (offlineMonsters) {
        tables[BIGMAP_TABLE.monster] = JSON.parse(readFileSync(
            new URL('../fixtures/bigmap-monster-legacy.json', import.meta.url), 'utf8',
        ));
    }
    return parseBigMapConfig(tables);
}

/**
 * 读取一份大地图布局（默认 `world_01`，即**线上真正在用的那份**）。
 *
 * 走的是与运行时同一条解析入口 `parseBigMapLayout`，所以「策划把布局改坏了」会在单测里当场炸。
 * 需要垫图布局数据（势力范围 `rangeHex`、邻接 `adjacentCityIds`）的用例都用这个，
 * 不要手搓 —— 手搓的数据永远比盘上的干净，测不出真问题。
 *
 * @param name `bigmap-maps/` 下的文件名（不带 `.json`）。`dadi_tuchugao` 是 100×100 的设计稿，
 *             与 40×40 的线上配置尺寸不同，只能做**纯布局层**断言，不能拿去 `buildBigMapWorldFromLayout`。
 */
export function loadBigMapLayout(name = 'world_01'): IBigMapLayout {
    const url = new URL(`../../assets/resources/config/bigmap-maps/${name}.json`, import.meta.url);
    return parseBigMapLayout(JSON.parse(readFileSync(url, 'utf8')));
}

/** 造一份解锁上下文，未传的字段给「全新号」默认值。 */
export function makeUnlockContext(patch: Partial<IBigMapUnlockContext> = {}): IBigMapUnlockContext {
    return {
        adventureChapter: 0,
        openDay: 0,
        occupiedCityIds: new Set<number>(),
        maxClearedMonsterLevel: 0,
        ...patch,
    };
}
