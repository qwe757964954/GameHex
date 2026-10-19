import { sys } from 'cc';
import type { IBigMapStorage } from './BigMapPresenter';
import { BIGMAP_SAVE_KEY } from './BigMapSaveKeys';

export { BIGMAP_SAVE_KEY, createMemoryBigMapStorage } from './BigMapSaveKeys';

/**
 * 端上存储实现：`sys.localStorage`。
 *
 * ⚠️ 这个文件 `import 'cc'`，所以 `tests/` 里**不要** import 它（Node 解析不到 `cc`）。
 * 单测请用 `BigMapSaveKeys` 里的 `createMemoryBigMapStorage`。
 */
export function createBigMapStorage(prefix = BIGMAP_SAVE_KEY): IBigMapStorage {
    return {
        read: (key) => sys.localStorage.getItem(`${prefix}.${key}`),
        write: (key, value) => sys.localStorage.setItem(`${prefix}.${key}`, value),
    };
}
