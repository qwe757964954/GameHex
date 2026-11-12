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

export interface CardClassFrames {
    readonly on: SpriteFrame | null;
    readonly off: SpriteFrame | null;
}

/**
 * 无状态组合器：每次调用直接组合加载，不做请求级缓存。
 * 单图去重与引用管理统一由底层 SpriteFrameCache（CardLineupIcons 的 artCache）负责，
 * 命中已加载帧时为同步 resolve，无重复网络/资源请求。
 */
export class CardArtProvider {
    loadLineupSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `disc.${card.rarity}`),
            this.loadHeroArt(card, art, `hero.${cardClass}`),
            this.load(art, `badge.${cardClass}`),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadLineupCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `face.${card.rarity}`),
            this.loadHeroArt(card, art, `hero.${cardClass}`),
            this.load(art, `badge.${cardClass}`),
        ]).then(([face, hero, badge]) => ({ face, hero, badge }));
    }

    loadBoardSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `disc.${card.rarity}`),
            this.loadHeroArt(card, art, `boardHero.${cardClass}`),
            this.load(art, `badge.${cardClass}`),
        ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
    }

    loadBoardCard(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCBoardCardFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.load(art, `frame.${card.rarity}`),
            this.loadHeroArt(card, art, `boardHero.${cardClass}`),
            this.load(art, `badge.${cardClass}`),
        ]).then(([frame, hero, badge]) => ({ frame, hero, badge }));
    }

    /**
     * 专属立绘真源 = `pvpCard.headIcon`（配置），经 icon.json 解析到 `icons/cardHead` 资源名。
     * 配置解析器由 Repository 预先注入；缺图回退表内的布阵占位 / 职业雕像。
     */
    private loadHeroArt(
        card: ZCDeckCard,
        art: ICardArtConfig,
        fallback: ICardArtKey,
    ): Promise<SpriteFrame | null> {
        const target = card.headIcon ? art.heroIcons.resolve(card.headIcon) : null;
        return target
            ? loadIconByArtPath(`${target.root}/${target.art}`).then(frame => frame ?? this.load(art, fallback))
            : this.load(art, fallback);
    }

    loadClassFrames(cardClass: ZCCardClass, art: ICardArtConfig): Promise<CardClassFrames> {
        return Promise.all([
            this.load(art, `iconOn.${cardClass}`),
            this.load(art, `iconOff.${cardClass}`),
        ]).then(([on, off]) => ({ on, off }));
    }

    /** 职业与阵营分别查图；同图去重由底层缓存负责。 */
    loadTallyFrames(item: ZCCardTally, art: ICardArtConfig): Promise<SpriteFrame | null> {
        const key = `${item.kind === 'class' ? 'iconOn' : 'camp'}.${item.key}` as ICardArtKey;
        return this.load(art, key);
    }

    loadDetail(card: ZCDeckCard | null, art: ICardArtConfig): Promise<ICardDetailArt> {
        if (!card) return Promise.resolve({ hero: null, diamond: null, classTag: null });
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadHeroArt(card, art, `hero.${cardClass}`),
            loadCardDetailArt(`identity/icon_quality_${DETAIL_QUALITY_ART[card.rarity]}`),
            loadCardDetailArt(`identity/icon_class_${cardClass}`),
        ]).then(([hero, diamond, classTag]) => ({ hero, diamond, classTag }));
    }

    private load(art: ICardArtConfig, key: ICardArtKey): Promise<SpriteFrame | null> {
        return loadIconByArtPath(art.paths.get(key));
    }
}

export const cardArtProvider = new CardArtProvider();
