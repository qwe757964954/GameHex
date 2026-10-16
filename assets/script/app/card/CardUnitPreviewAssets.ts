import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';

/** 一次阵容界面会话内的上阵单位预制体缓存；加载失败时交给站台静态图兜底。 */
export class CardUnitPreviewAssets<T> {
    private readonly prefabs = new Map<string, Promise<T | null>>();

    constructor(private readonly loadPrefab: (path: string) => Promise<T>) {}

    load(card: Pick<ZCDeckCard, 'unitId' | 'unitPrefabPath'>): Promise<T | null> {
        const path = card.unitId ? card.unitPrefabPath : null;
        if (!path) return Promise.resolve(null);
        let task = this.prefabs.get(path);
        if (!task) {
            task = this.loadPrefab(path).catch((error: unknown) => {
                console.warn(`[CardUnitPreviewAssets] 单位预制体加载失败：${path}`, error);
                return null;
            });
            this.prefabs.set(path, task);
        }
        return task;
    }
}
