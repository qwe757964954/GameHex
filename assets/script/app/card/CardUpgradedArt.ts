import { Prefab, type SpriteFrame } from 'cc';
import { scopeAssetService, type AssetService } from '../../core/asset/AssetService';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCCardRarity, ZCDeckCard } from './CardLineupTypes';
import type { ZCCardClass } from './CardLineupTypes';
import { loadArt, loadIconByArtPath } from './CardLineupIcons';

/** 品级 → 蓝湖「卡牌详情」皮肤编号；金/橙=01、蓝=02、紫=03、绿=04。 */
const RARITY_SKIN: Record<ZCCardRarity, string> = {
    gold: '01',
    blue: '02',
    purple: '03',
    green: '04',
};

const CLASS_ICON: Record<ZCCardClass, string> = {
    warrior: 'icons/card/yx_zhiye_zs',
    mage: 'icons/card/yx_zhiye_fs',
    archer: 'icons/card/yx_zhiye_ss',
    tank: 'icons/card/yx_zhiye_tk',
};

const UPGRADE_POPUP_ROOT = 'image/carddetail/upgrade_popup';
/** 720×1610 整屏背景走 main-pages 独立目录，避免进 carddetail 自动图集被缩糊。 */
const BACKGROUND_ROOT = 'image/carddetail_bg';

export interface ICardUpgradedArtBundle {
    readonly chrome: {
        readonly background: SpriteFrame | null;
        readonly frame: SpriteFrame | null;
    };
    readonly classIcon: SpriteFrame | null;
    readonly heroPrefab: Prefab | null;
}

export async function loadCardUpgradedArt(
    assets: AssetService,
    card: ZCDeckCard,
    cardClass: ZCCardClass,
    scope: ResourceScope,
): Promise<ICardUpgradedArtBundle> {
    const skin = RARITY_SKIN[card.rarity];
    const path = card.unitPrefabPath;
    try {
        // 骨骼缺失时仍显示弹窗，已加载的 prefab 由本次弹窗作用域释放。
        const hero = path
            ? scopeAssetService(assets, scope).load(path, Prefab).catch((error: unknown) => {
                console.warn(`[CardUpgradedArt] 升级弹窗骨骼加载失败：${path}`, error);
                return null;
            })
            : null;
        const [background, frame, classIcon, heroPrefab] = await Promise.all([
            loadArt(`kpxx_bg_${skin}`, BACKGROUND_ROOT),
            loadArt(`frame_${skin}`, UPGRADE_POPUP_ROOT),
            loadIconByArtPath(CLASS_ICON[cardClass]),
            hero,
        ]);
        return { chrome: { background, frame }, classIcon, heroPrefab };
    } catch (error) {
        console.warn('[CardUpgradedArt] 升级弹窗美术加载失败', error);
        return { chrome: { background: null, frame: null }, classIcon: null, heroPrefab: null };
    }
}
