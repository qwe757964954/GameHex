import type { SpriteFrame } from 'cc';
import type { ZCCardRarity, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
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

// 站台光圈与卡库边框按品级使用同色，职业由角标表达。
// 光圈编号 01–04 对应金、蓝、绿、紫，和卡库边框的编号顺序不同。
const LINEUP_SLOT_GLOW: Record<ZCCardRarity, string> = {
    gold: 'image/card_lineup/yx_img_guang_01',
    blue: 'image/card_lineup/yx_img_guang_02',
    green: 'image/card_lineup/yx_img_guang_03',
    purple: 'image/card_lineup/yx_img_guang_04',
};

// 羁绊统计条使用独立的职业和阵营图标。
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

/** 组合卡牌用图，单图请求去重与缓存由 SpriteFrameCache 负责。 */
export class CardArtProvider {
    loadLineupSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadPath(LINEUP_SLOT_GLOW[card.rarity]),
            this.loadHeroArt(card, art, cardClass),
            this.load(art, `badge.${cardClass}`),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadLineupCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `face.${card.rarity}`),
            this.loadHeroArt(card, art, cardClass),
            this.load(art, `badge.${cardClass}`),
        ]).then(([face, hero, badge]) => ({ face, hero, badge }));
    }

    loadBoardSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `disc.${card.rarity}`),
            this.loadHeroArt(card, art, cardClass),
            this.load(art, `badge.${cardClass}`),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadBoardCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `frame.${card.rarity}`),
            this.loadHeroArt(card, art, cardClass),
            this.load(art, `badge.${cardClass}`),
        ]).then(([frame, hero, badge]) => ({ frame, hero, badge }));
    }

    /** headIcon 支持图标名和资源直路径，缺少可用立绘时按职业使用 boardHero 占位。 */
    private loadHeroArt(card: ZCDeckCard, art: ICardArtConfig, cardClass: ZCCardClass): Promise<SpriteFrame | null> {
        const fallback = () => this.load(art, `boardHero.${cardClass}`);
        const target = card.headIcon ? art.heroIcons.resolve(card.headIcon) : null;
        if (!target) return fallback();
        return loadIconByArtPath(`${target.root}/${target.art}`).then(frame => frame ?? fallback());
    }

    loadTallyFrames(item: ZCCardTally): Promise<SpriteFrame | null> {
        return this.loadPath(LINEUP_TALLY_ICON[`${item.kind}.${item.key}`]);
    }

    loadDetail(card: ZCDeckCard | null, art: ICardArtConfig): Promise<ICardDetailArt> {
        if (!card) return Promise.resolve({ hero: null, diamond: null, classTag: null });
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadHeroArt(card, art, cardClass),
            this.load(art, `diamond.${card.rarity}`),
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
