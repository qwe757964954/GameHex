import type { SpriteFrame } from 'cc';
import type { ZCCardRarity } from '../zcds/model/ZCCombatCatalog';
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

export interface ICardUpgradedChrome {
    readonly background: SpriteFrame | null;
    readonly frame: SpriteFrame | null;
}

/** 背景是整屏 720×1610，走 `image/carddetail_bg` 独立目录，不参与 carddetail 图集。 */
export function loadCardUpgradedChrome(rarity: ZCCardRarity): Promise<ICardUpgradedChrome> {
    const skin = RARITY_SKIN[rarity];
    return Promise.all([
        loadArt(`kpxx_bg_${skin}`, BACKGROUND_ROOT),
        loadArt(`frame_${skin}`, UPGRADE_POPUP_ROOT),
    ]).then(([background, frame]) => ({ background, frame }));
}

/** 职业图标沿用阵容页的 `yx_zhiye_*` 40×40。 */
export function loadCardUpgradedClassIcon(cardClass: ZCCardClass): Promise<SpriteFrame | null> {
    return loadIconByArtPath(CLASS_ICON[cardClass]);
}
