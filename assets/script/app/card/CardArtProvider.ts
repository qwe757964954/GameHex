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

const DETAIL_QUALITY_ART = {
    gold: 'legendary', purple: 'epic', blue: 'rare', green: 'uncommon',
} as const;

// ── 卡牌阵容页（蓝湖「卡牌阵容-新」）固定用图 ──
// 这几组图不随品级/阵营矩阵表走，也不再由 `cardUiArt*.json` 提供：
// 站台光圈按品级、站台/卡面角标按职业、统计条按职业+阵营。
// 布阵页的角标改走 `cardUiArtClass.badge`（已切到 `yx_zhiye_*`），立绘两页统一走 `headIcon`。

/**
 * 站台光圈：**按品级**取图。
 *
 * 🔴 2026-11-23 用户口径：「阵容显示的品质和卡牌实际的品质不符合」。原来这里是按**职业**取的
 *  （金战士 / 蓝射手 / 绿坦克 / 紫法师，蓝湖稿原样），但这四色与品级四色是**同一套色板** ——
 *  卡面框 `common_img_kp_01..04` 实测主色就是金 (218,149,42) / 紫 (173,112,221) /
 *  绿 (109,164,66) / 蓝 (81,126,203)，和光圈实测 (248,191,10) / (189,80,238) /
 *  (155,231,60) / (55,132,247) 一一对应。
 *
 *  于是同一屏上光圈在说职业、卡库边框在说品级，玩家读色即读品级 ⇒ 八格里有一半两边对不上
 *  （截图里 僵尸站台光圈绿的、卡框紫的，正是被圈出来的那格）。职业已经由左下角角标
 *  （剑/弓/盾/卷轴）表达，光圈改成品级，三个通道互不重叠，也和布阵页
 *  `loadBoardSlot` 的 `disc.${card.rarity}` 口径一致。
 *
 * 🔴 键是 `ZCCardRarity`，**不是** `ZCCardClass`。色板必须对着 `yx_img_guang_0X` 的实测主色
 *  写死：01 金 → gold、02 蓝 → blue、03 绿 → green、04 紫 → purple。注意这个顺序和卡面框
 *  的 01..04（金/紫/绿/蓝）不同，别按下标搬。
 */
const LINEUP_SLOT_GLOW: Record<ZCCardRarity, string> = {
    gold: 'image/card_lineup/yx_img_guang_01',
    blue: 'image/card_lineup/yx_img_guang_02',
    green: 'image/card_lineup/yx_img_guang_03',
    purple: 'image/card_lineup/yx_img_guang_04',
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
    /**
     * 上阵站台：光圈按**品级**（与卡库卡面框同源）、角标按**职业**（与卡库角标同图）。
     *
     * 两个通道各管一件事，玩家在站台和卡库里读到的是同一组色 / 同一个图案 —— 这是
     * 「阵容显示的品质 == 卡牌实际品质」的唯一保证，别把光圈改回按职业取图。
     */
    loadLineupSlot(card: ZCDeckCard, art: ICardArtConfig): Promise<ZCSlotFrames> {
        const cardClass = resolveCardClass(card, art.lineup);
        return Promise.all([
            this.loadPath(LINEUP_SLOT_GLOW[card.rarity]),
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
