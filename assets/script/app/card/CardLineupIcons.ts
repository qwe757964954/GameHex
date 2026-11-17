import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import {
    CARD_DETAIL_ART_ROOT,
    CARD_HEAD_ART_ROOT,
    COMMON_ART_ROOT,
    FRAME_ART_ROOT,
} from '../ArtPaths';

/** 卡牌图标归会话缓存；资源目录由本模块负责。 */
const artCache = createRoutedSpriteFrameCache('ArtIcons');

export function loadArt(name: string, root: string): Promise<SpriteFrame | null> {
    return artCache.loadNamed(name, root);
}

/** 退出登录时释放本次会话的美术引用。 */
export function releaseArtCache(): void {
    artCache.clear();
}

export function loadIconByArtPath(artPath: string): Promise<SpriteFrame | null> {
    return artCache.load(artPath);
}

/** 卡牌详情页切图（`image/carddetail`）：面板 / 六边形 / 品质菱形 / 图标 / 按钮。 */
export function loadCardDetailArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, CARD_DETAIL_ART_ROOT);
}

/** 专属角色图与兵种头像统一归 `icons/cardHead`，共用其自动图集。 */
export function loadCardHeroArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, CARD_HEAD_ART_ROOT);
}

/** 布阵卡池卡框（`image/frame`）：`common_img_pzk_01..04`。 */
export function loadFrameArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, FRAME_ART_ROOT);
}

/** 通用底图 / 按钮（`image/common`）：`bg_04`、`bg_05`、`title_01`、`anniu_0*`。 */
export function loadCommonArt(name: string): Promise<SpriteFrame | null> {
    return loadArt(name, COMMON_ART_ROOT);
}
