import { _decorator, Component, Label, Prefab, Sprite, SpriteFrame, UIOpacity } from 'cc';
import { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { applyCardHeadArt } from './CardHeadView';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardUnitPreview } from './CardUnitPreview';

const { ccclass, property } = _decorator;

/** 站台一次渲染要的四张图（前三张按品级+职业复用，头像按卡）。 */
export interface ZCSlotFrames {
    disc: SpriteFrame | null;
    hero: SpriteFrame | null;
    badge: SpriteFrame | null;
    /** 该卡头像；null = 没配，保留 hero 立绘。 */
    head: SpriteFrame | null;
}

/**
 * 卡牌阵容页上阵八卡的单个站台。
 * 层次：木台底座 → 品级垫盘 → 立绘 → 等级牌。
 * 立绘锚点 (0.5,0) 让营地雕像底座对齐。
 */
@ccclass('CardLineupSlot')
export class CardLineupSlot extends Component {
    @property({ type: Sprite, tooltip: 'Stage：木台底座' })
    stage: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Disc：品级垫盘' })
    disc: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Hero：四职业营地雕像' })
    hero: Sprite = null!;

    @property({ type: Sprite, tooltip: 'HeadIcon：该卡头像（与 Hero 互斥）' })
    headIcon: Sprite = null!;

    @property({ type: Sprite, tooltip: 'ClassBadge：职业角标' })
    classBadge: Sprite = null!;

    @property({ type: Label, tooltip: 'LevelLabel：等级' })
    levelLabel: Label = null!;

    @property({ tooltip: '养成表落地前的等级占位值' })
    fallbackLevel = 3;

    @property({ tooltip: '上阵兵种待机动画的可见高度' })
    previewHeight = 120;

    private preview: CardUnitPreview | null = null;

    /** 落位淡入用的透明度组件（首次需要时补挂，Prefab 里不预置 —— 常态不需要它）。 */
    private enterOpacity: UIOpacity | null = null;

    /** @param frames null 项保留 prefab 现图；level 不传用 fallbackLevel。 */
    render(card: ZCDeckCard, frames: ZCSlotFrames, level?: number, prefab?: Prefab | null): void {
        if (frames.disc) this.disc.spriteFrame = frames.disc;
        if (frames.badge) this.classBadge.spriteFrame = frames.badge;
        if (prefab && (this.preview ??= new CardUnitPreview(this.hero, this.previewHeight)).show(prefab)) {
            this.headIcon.node.active = false;
        } else {
            this.preview?.clear();
            applyCardHeadArt(this, frames.hero, frames.head);
        }
        //  每次显式写 255：渲染幂等，不依赖上一次的透明度。
        this.opacityOf().opacity = 255;
        this.levelLabel.string = `${Math.max(1, Math.round(level ?? this.fallbackLevel))}${CARD_LINEUP_TEXTS.levelSuffix}`;
    }

    private opacityOf(): UIOpacity {
        return (this.enterOpacity ??= this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity));
    }

    setEmpty(): void {
        this.preview?.clear();
        this.node.active = false;
    }
}
