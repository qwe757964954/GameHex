import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';

const artCache = createRoutedSpriteFrameCache('StoreArt');

/** 商城配置给出 resources 相对图路径，缺图返回 null。 */
export function loadStoreIcon(artPath: string): Promise<SpriteFrame | null> {
    return artCache.load(artPath);
}

export function releaseStoreArt(): void {
    artCache.clear();
}
