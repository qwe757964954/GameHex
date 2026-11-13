import { _decorator, Component, Label, Prefab, Sprite, SpriteFrame, UIOpacity } from 'cc';
import { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardUnitPreview } from './CardUnitPreview';

const { ccclass, property } = _decorator;

/** 站台一次渲染的三张图：光效和角标按职业，立绘按卡。 */
export interface ZCSlotFrames {
    disc: SpriteFrame | null;
    hero: SpriteFrame | null;
    badge: SpriteFrame | null;
}

/**
 * 上阵区的一个站台：台座、品级光效、立绘、等级。
 * 立绘锚点在脚底，正好落在台座中心。
 */
@ccclass('CardLineupSlot')
export class CardLineupSlot extends Component {
    @property({ type: Sprite, tooltip: 'Stage：木台底座' })
    stage: Sprite = null;

    @property({ type: Sprite, tooltip: 'Disc：品级垫盘' })
    disc: Sprite = null;

    @property({ type: Sprite, tooltip: 'Hero：四职业营地雕像' })
    hero: Sprite = null;

    @property({ type: Sprite, tooltip: 'ClassBadge：职业角标' })
    classBadge: Sprite = null;

    @property({ type: Label, tooltip: 'LevelLabel：等级' })
    levelLabel: Label = null;

    @property({ tooltip: '养成表落地前的等级占位值' })
    fallbackLevel = 3;

    @property({ tooltip: '上阵兵种待机动画的可见高度' })
    previewHeight = 120;

    private preview: CardUnitPreview | null = null;
    private previewPrefab: Prefab | null = null;
    private previewUnitId: string | null = null;
    private previewPath: string | null = null;

    /**
     * 这张卡的体型系数。render 时先记下来，模型晚到时还能用对缩放。
     */
    private previewSize = 1;

    /** 落位淡入用的透明度组件（首次需要时补挂，Prefab 里不预置 —— 常态不需要它）。 */
    private enterOpacity: UIOpacity | null = null;

    /** @param frames null 项清空旧图；level 不传用 fallbackLevel。 */
    render(card: ZCDeckCard, frames: ZCSlotFrames, level?: number, prefab?: Prefab | null): void {
        const retainedPrefab = this.previewUnitId === card.unitId && this.previewPath === card.unitPrefabPath
            ? this.previewPrefab : null;
        this.previewUnitId = card.unitId;
        this.previewPath = card.unitPrefabPath;
        this.previewSize = card.prefabSize ?? 1;
        this.disc.spriteFrame = frames.disc;
        this.classBadge.spriteFrame = frames.badge;
        // 等级/资源刷新沿用同兵种模型，省掉清除后分帧重新实例化。
        if (!this.applyPreview(prefab === undefined ? retainedPrefab : prefab)) this.hero.spriteFrame = frames.hero;
        //  每次显式写 255：渲染幂等，不依赖上一次的透明度。
        this.opacityOf().opacity = 255;
        this.levelLabel.string = `${Math.max(1, Math.round(level ?? this.fallbackLevel))}${CARD_LINEUP_TEXTS.levelSuffix}`;
    }

    /**
     * 静态图晚到时只补图，等级和透明度不要动。
     * 首屏先用空台占位，页面拿到图后再调这里。
     */
    applyStaticArt(frames: ZCSlotFrames): void {
        this.disc.spriteFrame = frames.disc;
        this.classBadge.spriteFrame = frames.badge;
        // 模型展示时 Hero 会被 disable，clear 后重新 enable；用 hero.enabled 判断比 preview 引用可靠。
        if (this.hero.enabled) this.hero.spriteFrame = frames.hero;
    }

    /**
     * 只补单位模型。静态图已经画好后再调，页面会分帧逐个提交。
     *
     * 返回 false 表示这个预制体没有可用的待机动画，调用方继续用静态立绘。
     */
    applyPreview(prefab: Prefab | null): boolean {
        if (prefab
            && (this.preview ??= new CardUnitPreview(this.hero, this.previewHeight)).show(prefab, this.previewSize)) {
            this.previewPrefab = prefab;
            return true;
        }
        this.previewPrefab = null;
        this.preview?.clear();
        return false;
    }


    private opacityOf(): UIOpacity {
        return (this.enterOpacity ??= this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity));
    }

    setEmpty(): void {
        this.applyPreview(null);
        this.node.active = false;
    }
}
