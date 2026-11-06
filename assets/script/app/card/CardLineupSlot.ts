import { _decorator, Component, Label, Prefab, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { applyCardHeroArt } from './CardHeroView';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardUnitPreview } from './CardUnitPreview';

const { ccclass, property } = _decorator;

/** 站台一次渲染要的三张图（前三张按品级+职业复用，头像按卡）。 */
export interface ZCSlotFrames {
    disc: SpriteFrame | null;
    hero: SpriteFrame | null;
    badge: SpriteFrame | null;
}

/**
 * 卡牌阵容页上阵八卡的单个站台。
 * 层次：木台底座 → 品级垫盘 → 立绘 → 等级牌。
 * 立绘锚点 (0.5,0) 让营地雕像底座对齐。
 */
@ccclass('CardLineupSlot')
export class CardLineupSlot extends Component {
    @property({ type: Sprite, tooltip: 'Stage：木台底座' })
    stage: Sprite = null;

    @property({ type: Sprite, tooltip: 'Disc：品级垫盘' })
    disc: Sprite = null;

    @property({ type: Sprite, tooltip: 'Hero：四职业营地雕像' })
    hero: Sprite = null;

    @property({ type: UITransform, tooltip: 'Hero：立绘展示框' })
    heroTransform: UITransform = null!;


    @property({ type: Sprite, tooltip: 'ClassBadge：职业角标' })
    classBadge: Sprite = null;

    @property({ type: Label, tooltip: 'LevelLabel：等级' })
    levelLabel: Label = null;

    @property({ tooltip: '养成表落地前的等级占位值' })
    fallbackLevel = 3;

    @property({ tooltip: '上阵兵种待机动画的可见高度' })
    previewHeight = 120;

    private preview: CardUnitPreview | null = null;

    /** 落位淡入用的透明度组件（首次需要时补挂，Prefab 里不预置 —— 常态不需要它）。 */
    private enterOpacity: UIOpacity | null = null;

    /** @param frames null 项清空旧图；level 不传用 fallbackLevel。 */
    render(card: ZCDeckCard, frames: ZCSlotFrames, level?: number, prefab?: Prefab | null): void {
        this.disc.spriteFrame = frames.disc;
        this.classBadge.spriteFrame = frames.badge;
        if (!this.applyPreview(prefab ?? null)) applyCardHeroArt(this.hero, this.heroTransform, frames.hero);
        //  每次显式写 255：渲染幂等，不依赖上一次的透明度。
        this.opacityOf().opacity = 255;
        this.levelLabel.string = `${Math.max(1, Math.round(level ?? this.fallbackLevel))}${CARD_LINEUP_TEXTS.levelSuffix}`;
    }

    /**
     * 静态图**晚到**时只补图：等级牌、透明度这些 `render` 已经画好了，别再动。
     *
     * 冷启动第一屏不等 8 张站台图（实测 26ms），页面先把空台 + 等级提交出去，
     * 图由 `CardLineupPage.fillSlotArt` 在这里补齐。站台是固定的 8 个节点、不复用，
     * 所以不需要虚拟列表那种防串图 token；「旧阵容迟到图盖到新阵容」由页面 revision 挡。
     */
    applyStaticArt(frames: ZCSlotFrames): void {
        this.disc.spriteFrame = frames.disc;
        this.classBadge.spriteFrame = frames.badge;
        // 模型正在展示时 `CardUnitPreview.show` 会把 Hero Sprite 置为 disabled；
        // `clear()` 又把它 enabled 回来。用这个状态判，比 `this.preview != null` 准
        // （`clear()` 之后 preview 对象还在，但已经没在展示了）。
        if (this.hero.enabled) applyCardHeroArt(this.hero, this.heroTransform, frames.hero);
    }

    /**
     * 只补单位模型（站台图与等级已经画好之后再调）。
     *
     * 单位预制体是 `sp.Skeleton`，一次实例化实测 ~1.4~2.7ms（2026-11-03 探针）；
     * 八卡和整页数据一起提交会把 20ms 压进同一帧。页面因此拆成两步：先画静态立绘，
     * 再逐帧补模型 —— 数据完全一致，只是视觉上「立绘 → 模型」。
     *
     * 返回 `false` = 这个预制体给不了待机动画（`CardUnitPreview.show` 内部会销毁它），
     * 调用方据此保留静态立绘；已经在画立绘的站台不需要再补图。
     */
    applyPreview(prefab: Prefab | null): boolean {
        if (prefab && (this.preview ??= new CardUnitPreview(this.hero, this.previewHeight)).show(prefab)) {
            return true;
        }
        this.preview?.clear();
        return false;
    }


    private opacityOf(): UIOpacity {
        return (this.enterOpacity ??= this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity));
    }

    setEmpty(): void {
        this.preview?.clear();
        this.node.active = false;
    }
}
