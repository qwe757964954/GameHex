import { sys } from 'cc';
import type { IBigMapStorage } from './BigMapPresenter';
import { BIGMAP_SAVE_KEY, createMemoryBigMapStorage } from './BigMapSaveKeys';
import type { IBigMapSaveOwner } from './BigMapSaveKeys';

export { BIGMAP_SAVE_KEY, createMemoryBigMapStorage } from './BigMapSaveKeys';

/**
 * 端上存储实现：`sys.localStorage`。
 *
 * ⚠️ 这个文件 `import 'cc'`，所以 `tests/` 里**不要** import 它（Node 解析不到 `cc`）。
 * 单测请用 `BigMapSaveKeys` 里的 `createMemoryBigMapStorage`。
 */
export function createBigMapStorage(owner: IBigMapSaveOwner | null): IBigMapStorage {
    if (!owner) return createMemoryBigMapStorage();
    if (!owner.roleId.trim() || !owner.serverId.trim()) throw new Error('大地图存档缺少角色或区服身份');
    // 捕获身份；无归属的旧共享档保留原样，不能自动导入当前角色。
    const prefix = `${BIGMAP_SAVE_KEY}.server:${encodeURIComponent(owner.serverId)}:role:${encodeURIComponent(owner.roleId)}`;
    return {
        read: (key) => sys.localStorage.getItem(`${prefix}.${key}`),
        write: (key, value) => sys.localStorage.setItem(`${prefix}.${key}`, value),
    };
}
