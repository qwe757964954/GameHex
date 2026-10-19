import type { IBigMapStorage } from './BigMapPresenter';

/**
 * 存档键前缀。与领地章节（`TERRITORY_LAST_CHAPTER_KEY`）分开命名空间，
 * 避免两个玩法的版本号/字段名互相污染 —— 这两个存档的 `version` 语义完全不同。
 */
export const BIGMAP_SAVE_KEY = 'zhancheng.bigmap.save';

/**
 * 内存存储：单测 / 编辑器预览用，不进磁盘。
 *
 * 单独放在这个**不依赖引擎**的文件里，是为了让 `tests/` 能直接 import 到它 ——
 * `BigMapStorage.ts` 里有 `import { sys } from 'cc'`，Node 环境解析不到 `cc`。
 */
export function createMemoryBigMapStorage(seed: Record<string, string> = {}): IBigMapStorage {
    const map = new Map<string, string>(Object.entries(seed));
    return {
        read: (key) => map.get(key) ?? null,
        write: (key, value) => { map.set(key, value); },
    };
}
