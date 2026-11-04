import type { SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type { ZCBoardCardFrames } from './LineupBoardCard';
import type { ZCBoardSlotFrames } from './LineupBoardSlot';
import type { ZCCardFrames } from './CardLineupCard';
import type { ZCSlotFrames } from './CardLineupSlot';
import { loadCardHeroArt, loadFrameArt, loadIconArt, loadLineupArt } from './CardLineupIcons';
import {
    BOARD_HERO_ART,
    CAMP_ICON_ON_ART,
    cardArtKey,
    CARD_FACE_ART,
    CLASS_BADGE_ART,
    CLASS_ICON_OFF_ART,
    CLASS_ICON_ON_ART,
    POOL_FRAME_ART,
    resolveCardClass,
    resolveCardHeroArt,
    resolveHeroArt,
    STAGE_DISC_ART,
    ZCCardCamp,
    ZCCardClass,
    ZCCardTally,
} from './CardLineupTypes';

export interface CardClassFrames {
    readonly on: SpriteFrame | null;
    readonly off: SpriteFrame | null;
}

/** 组合卡牌所需图片并按“品级 + 职业”复用 Promise；底层单图缓存仍由 CardLineupIcons 管理。 */
export class CardArtProvider {
    private readonly lineupSlots = new Map<string, Promise<ZCSlotFrames>>();
    private readonly lineupCards = new Map<string, Promise<ZCCardFrames>>();
    private readonly boardSlots = new Map<string, Promise<ZCBoardSlotFrames>>();
    private readonly boardCards = new Map<string, Promise<ZCBoardCardFrames>>();
    private readonly classFrames = new Map<ZCCardClass, Promise<CardClassFrames>>();
    /** 图标行条目（职业 / 阵营）的图标，键 = `${kind}|${key}`。 */
    private readonly tallyFrames = new Map<string, Promise<SpriteFrame | null>>();

    loadLineupSlot(card: ZCDeckCard): Promise<ZCSlotFrames> {
        const key = this.key(card);
        let task = this.lineupSlots.get(key);
        if (!task) {
            const cardClass = resolveCardClass(card);
            task = Promise.all([
                loadLineupArt(STAGE_DISC_ART[card.rarity]),
                this.loadHeroArt(card, resolveHeroArt(cardClass)),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
            ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
            this.lineupSlots.set(key, task);
        }
        return task;
    }

    loadLineupCard(card: ZCDeckCard): Promise<ZCCardFrames> {
        const key = this.key(card);
        let task = this.lineupCards.get(key);
        if (!task) {
            const cardClass = resolveCardClass(card);
            task = Promise.all([
                loadLineupArt(CARD_FACE_ART[card.rarity]),
                this.loadHeroArt(card, resolveHeroArt(cardClass)),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
            ]).then(([face, hero, badge]) => ({ face, hero, badge }));
            this.lineupCards.set(key, task);
        }
        return task;
    }

    loadBoardSlot(card: ZCDeckCard): Promise<ZCBoardSlotFrames> {
        const key = this.key(card);
        let task = this.boardSlots.get(key);
        if (!task) {
            const cardClass = resolveCardClass(card);
            task = Promise.all([
                loadLineupArt(STAGE_DISC_ART[card.rarity]),
                this.loadHeroArt(card, BOARD_HERO_ART[cardClass], loadCardHeroArt),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
            ]).then(([disc, hero, badge]) => ({ disc, hero, badge }));
            this.boardSlots.set(key, task);
        }
        return task;
    }

    loadBoardCard(card: ZCDeckCard): Promise<ZCBoardCardFrames> {
        const key = this.key(card);
        let task = this.boardCards.get(key);
        if (!task) {
            const cardClass = resolveCardClass(card);
            task = Promise.all([
                loadFrameArt(POOL_FRAME_ART[card.rarity]),
                this.loadHeroArt(card, BOARD_HERO_ART[cardClass], loadCardHeroArt),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
            ]).then(([frame, hero, badge]) => ({ frame, hero, badge }));
            this.boardCards.set(key, task);
        }
        return task;
    }

    /** 专属图统一从 cardHead 取；缺图沿用各界面的占位，缩放由视图负责。 */
    private loadHeroArt(
        card: ZCDeckCard,
        fallbackName: string,
        loadFallback: (name: string) => Promise<SpriteFrame | null> = loadIconArt,
    ): Promise<SpriteFrame | null> {
        const heroName = resolveCardHeroArt(card);
        return heroName ? loadCardHeroArt(heroName) : loadFallback(fallbackName);
    }

    loadClassFrames(cardClass: ZCCardClass): Promise<CardClassFrames> {
        let task = this.classFrames.get(cardClass);
        if (!task) {
            task = Promise.all([
                loadIconArt(CLASS_ICON_ON_ART[cardClass]),
                loadIconArt(CLASS_ICON_OFF_ART[cardClass]),
            ]).then(([on, off]) => ({ on, off }));
            this.classFrames.set(cardClass, task);
        }
        return task;
    }

    /** 职业与阵营分别查图，并复用同一条目的加载请求。 */
    loadTallyFrames(item: ZCCardTally): Promise<SpriteFrame | null> {
        const key = `${item.kind}|${item.key}`;
        let task = this.tallyFrames.get(key);
        if (!task) {
            const name = item.kind === 'class'
                ? CLASS_ICON_ON_ART[item.key as ZCCardClass]
                : CAMP_ICON_ON_ART[item.key as ZCCardCamp];
            task = name ? loadIconArt(name) : Promise.resolve(null);
            this.tallyFrames.set(key, task);
        }
        return task;
    }

    /** 品级、职业与卡牌 id 共同决定美术缓存。 */
    private key(card: ZCDeckCard): string {
        return cardArtKey(card);
    }
}

export const cardArtProvider = new CardArtProvider();
