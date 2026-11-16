import type { SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type { ZCBoardCardFrames } from './LineupBoardCard';
import type { ZCBoardSlotFrames } from './LineupBoardSlot';
import type { ZCCardFrames } from './CardLineupCard';
import type { ZCSlotFrames } from './CardLineupSlot';
import { loadCardDetailArt, loadIconByArtPath } from './CardLineupIcons';
import { resolveCardClass } from './CardLineupTypes';
import type { ZCCardClass, ZCCardTally } from './CardLineupTypes';
import type { ICardArtConfig, ICardArtKey } from './CardArtConfig';

export interface ICardDetailArt {
    readonly hero: SpriteFrame | null;
    readonly diamond: SpriteFrame | null;
    readonly classTag: SpriteFrame | null;
}

const DETAIL_QUALITY_ART = {
    gold: 'legendary', purple: 'epic', blue: 'rare', green: 'uncommon',
} as const;

/**
 * 卡牌阵容页（蓝湖「卡牌阵容-新」）固定用图。
 *
 * 这三组图不随品级/阵营矩阵表走，也不再由 `cardUiArt*.json` 提供：
 * 站台光效按**职业**四色、卡/站台角标按职业、统计条按职业+阵营。
 * 布阵页的角标改走 `cardUiArtClass.badge`（已切到 `yx_zhiye_*`），立绘两页统一走 `headIcon`。
 */
const LINEUP_SLOT_GLOW: Record<ZCCardClass, string> = {
    warrior: 'image/card_lineup/yx_img_guang_01',
    archer: 'image/card_lineup/yx_img_guang_02',
    tank: 'image/card_lineup/yx_img_guang_03',
    mage: 'image/card_lineup/yx_img_guang_04',
};

const LINEUP_CLASS_BADGE: Record<ZCCardClass, string> = {
    warrior: 'icons/card/yx_zhiye_zs',
    mage: 'icons/card/yx_zhiye_fs',
    archer: 'icons/card/yx_zhiye_ss',
    tank: 'icons/card/yx_zhiye_tk',
};

const LINEUP_TALLY_ICON: Record<string, string> = {
    'class.warrior': 'icons/card/common_img_zs',
    'class.mage': 'icons/card/common_img_fs',
    'class.archer': 'icons/card/common_img_ss',
    'class.tank': 'icons/card/common_img_tk',
    'camp.huaguo': 'icons/card/common_img_hg',
    'camp.jiangshi': 'icons/card/common_img_js',
    'camp.mogu': 'icons/card/common_img_mg',
    'camp.penzai': 'icons/card/common_img_pz',
};

/**
 * 卡牌图组合器。这里不做请求缓存，单图去重交给 SpriteFrameCache。
 */
export class CardArtProvider {
    loadLineupSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadPath(LINEUP_SLOT_GLOW[cardClass]),
            this.loadHeroArt(card, art),
            this.loadPath(LINEUP_CLASS_BADGE[cardClass]),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadLineupCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `face.${card.rarity}`),
            this.loadHeroArt(card, art),
            this.loadPath(LINEUP_CLASS_BADGE[cardClass]),
        ]).then(([face, hero, badge]) => ({ face, hero, badge }));
    }

    loadBoardSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `disc.${card.rarity}`),
            this.loadHeroArt(card, art),
            this.load(art, `badge.${cardClass}`),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadBoardCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `frame.${card.rarity}`),
            this.loadHeroArt(card, art),
            this.load(art, `badge.${cardClass}`),
        ]).then(([frame, hero, badge]) => ({ frame, hero, badge }));
    }

    /**
     * 立绘统一用配置里的 headIcon，经 icon.json 找到 cardHead 图；
     * 缺专属图时退回 `boardHero` 的 cardHead 占位，不再加载职业雕像。
     */
    private loadHeroArt(card: ZCDeckCard, art: ICardArtConfig): Promise<SpriteFrame | null> {
        const cardClass = resolveCardClass(card, art.lineup);
        const fallback = () => this.load(art, `boardHero.${cardClass}`);
        const target = card.headIcon ? art.heroIcons.resolve(card.headIcon) : null;
        if (!target) return fallback();
        return loadIconByArtPath(`${target.root}/${target.art}`).then(frame => frame ?? fallback());
    }

    /** 职业筛选按钮的亮/暗两态已随旧图标下线，入口只保留统计条固定图。 */
    loadTallyFrames(item: ZCCardTally): Promise<SpriteFrame | null> {
        return this.loadPath(LINEUP_TALLY_ICON[`${item.kind}.${item.key}`]);
    }

    loadDetail(card: ZCDeckCard | null, art: ICardArtConfig): Promise<ICardDetailArt> {
        if (!card) return Promise.resolve({ hero: null, diamond: null, classTag: null });
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadHeroArt(card, art),
            loadCardDetailArt(`identity/icon_quality_${DETAIL_QUALITY_ART[card.rarity]}`),
            loadCardDetailArt(`identity/icon_class_${cardClass}`),
        ]).then(([hero, diamond, classTag]) => ({ hero, diamond, classTag }));
    }

    private load(art: ICardArtConfig, key: ICardArtKey): Promise<SpriteFrame | null> {
        return loadIconByArtPath(art.paths.get(key));
    }

    private loadPath(path: string | undefined): Promise<SpriteFrame | null> {
        return path ? loadIconByArtPath(path) : Promise.resolve(null);
    }
}

export const cardArtProvider = new CardArtProvider();
