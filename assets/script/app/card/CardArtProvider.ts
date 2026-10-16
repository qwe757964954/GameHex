import type { SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type { ZCBoardCardFrames } from './LineupBoardCard';
import type { ZCBoardSlotFrames } from './LineupBoardSlot';
import type { ZCCardFrames } from './CardLineupCard';
import type { ZCSlotFrames } from './CardLineupSlot';
import { loadCardHeadArt, loadFrameArt, loadIconArt, loadLineupArt } from './CardLineupIcons';
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
                loadIconArt(resolveHeroArt(cardClass)),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
                loadCardHeadArt(card.headIcon),
            ]).then(([disc, hero, badge, head]) => ({ disc, hero, badge, head }));
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
                loadIconArt(resolveHeroArt(cardClass)),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
                loadCardHeadArt(card.headIcon),
            ]).then(([face, hero, badge, head]) => ({ face, hero, badge, head }));
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
                loadIconArt(BOARD_HERO_ART[cardClass]),
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
                loadIconArt(BOARD_HERO_ART[cardClass]),
                loadIconArt(CLASS_BADGE_ART[cardClass]),
                loadCardHeadArt(card.headIcon),
            ]).then(([frame, hero, badge, head]) => ({ frame, hero, badge, head }));
            this.boardCards.set(key, task);
        }
        return task;
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

    /**
     * 图标行一项的那枚图标（只有一个了）。
     *
     *  职业与阵营各查各的表（`CLASS_ICON_ON_ART` / `CAMP_ICON_ON_ART`），缓存键带上 `kind`
     *  以免两套 key 撞名。阵营那套图**美术还没出**，这里会拿到 `null` —— 属于预期内的降级，
     *  调用方按「`null` 就保留占位图」处理。
     *
     *  返回裸 `SpriteFrame` 而不是 `CardClassFrames`：条目 2026-09-22 起只剩一枚图标，
     *  「亮 / 灰」不再是两枚，别为了对齐类型再塞一个永远为 `null` 的字段。
     */
    loadTallyFrames(item: ZCCardTally): Promise<SpriteFrame | null> {
        const key = `${item.kind}|${item.key}`;
        let task = this.tallyFrames.get(key);
        if (!task) {
            task = item.kind === 'class'
                ? loadIconArt(CLASS_ICON_ON_ART[item.key as ZCCardClass])
                : loadIconArt(CAMP_ICON_ON_ART[item.key as ZCCardCamp]);
            this.tallyFrames.set(key, task);
        }
        return task;
    }

    /**
     * 缓存键：**必须带上 `headIcon`**（口径与判据都在 `CardLineupTypes.cardArtKey`，
     * 那边是零引擎依赖的纯函数，单测直接钉住「只差头像的两张卡不能同键」）。
     */
    private key(card: ZCDeckCard): string {
        return cardArtKey(card);
    }
}

export const cardArtProvider = new CardArtProvider();
