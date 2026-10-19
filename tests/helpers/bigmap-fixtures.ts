/**
 * BigMap 测试夹具：直接从 `assets/remoteRef/` 读盘上的 `{k,v}` 压缩表，
 * 走**与运行时同一条**解析入口 `parseBigMapConfig`。
 *
 * 这样「配置表写错」「公式改坏」会先在单测里炸，而不是等进游戏才炸。
 */
import { readFileSync } from 'node:fs';
import { BIGMAP_TABLE, parseBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapConfig';
import type { IBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapTypes';
import type { IBigMapUnlockContext } from '../../assets/script/app/bigmap/model/BigMapUnlock';

function readTable(name: string): unknown {
    const url = new URL(`../../assets/remoteRef/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
}

/** 读取全部 12 张 BigMap 表并解析成强类型配置。 */
export function loadBigMapConfig(): IBigMapConfig {
    const tables: Record<string, unknown> = {};
    for (const name of Object.values(BIGMAP_TABLE)) tables[name] = readTable(name);
    return parseBigMapConfig(tables);
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
