import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { resIconRoot } from '../common/ResTypes';

const resBarCache = createRoutedSpriteFrameCache('MainResBarArt');

/** 货币目录取 roleProperty 映射；经验值等例外由 resIconRoot 处理。 */
export function loadResBarSprite(
    name: string,
    root: string = resIconRoot(name),
): Promise<SpriteFrame | null> {
    return resBarCache.loadNamed(name, root);
}
