import { _decorator, Component, EventTouch, Label, Node, Prefab, Sprite, SpriteFrame, Vec2 } from 'cc';
import { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type { IBoardCardHost } from './LineupBoardCard';
import { CardUnitPreview } from './CardUnitPreview';

const { ccclass, property } = _decorator;

/** 布阵站台一次渲染要的三张图（面板预加载传入）。 */
export interface ZCBoardSlotFrames {
    disc: SpriteFrame | null;
    hero: SpriteFrame | null;
    badge: SpriteFrame | null;
}

/**
 * 布阵面板上阵区一个站台。
 * 层次：木台底座 → 品级垫盘 → 职业 Q 版立绘 → 职业角标 + N级。
 * 与页面 CardLineupSlot 版式不同（立绘用 char_0X，不是 camp_*），不要互用。
 *
 * ── 交互 ─────────────────────────────────────────────────────────────
 * 点已上阵的卡 → 下阵（复用卡池同一条 `IBoardCardHost.onCardTap`：页面收到
 * 时这张卡已在 `deployedIds` 里，走的就是 remove 分支）。
 * 空站台没有 `currentCard`，抬手直接忽略，不会误下阵。
 * 位移超过 `pressSlop` 判定为滑动（虽然站台不参与滚动，但判定逻辑与
 * `LineupBoardCard` 保持一致，避免后续加拖拽时两套手势不一致）。
 */
@ccclass('LineupBoardSlot')
export class LineupBoardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Stage：木台底座' })
    stage: Sprite = null;

    @property({ type: Sprite, tooltip: 'Disc：品级垫盘' })
    disc: Sprite = null;

    @property({ type: Sprite, tooltip: 'Hero：职业 Q 版立绘' })
    hero: Sprite = null;

    @property({ type: Sprite, tooltip: 'ClassBadge：职业角标' })
    classBadge: Sprite = null;

    @property({ type: Label, tooltip: 'LevelLabel：等级' })
    levelLabel: Label = null;

    @property({ type: Node, tooltip: '空站位时整组隐藏（底座垫盘保留）' })
    unitGroup: Node = null;

    @property({ tooltip: '养成表落地前的等级占位值' })
    fallbackLevel = 3;

    @property({ tooltip: '上阵兵种待机动画的可见高度' })
    previewHeight = 90;

    @property({ tooltip: '拖拽悬停放大倍数' })
    dropTargetScale = 1.08;

    @property({ tooltip: '按下后位移超过多少像素就当成滑动，不再触发点击' })
    pressSlop = 16;

    /** 点击宿主，由 `LineupBoardPage` 在灌数据时注入（不是 @property，不落 prefab）。 */
    tapHost: IBoardCardHost | null = null;

    private baseScaleX = 1;
    private baseScaleY = 1;
    private baseScaleZ = 1;
    private dropTargetActive = false;
    private preview: CardUnitPreview | null = null;
    private currentCard: ZCDeckCard | null = null;
    private readonly pressStart = new Vec2();
    private pressing = false;

    protected onLoad(): void {
        const scale = this.node.scale;
        this.baseScaleX = scale.x;
        this.baseScaleY = scale.y;
        this.baseScaleZ = scale.z;
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.pressing = false;
    }

    /** 拖拽落点高亮（放大，幂等）。 */
    setDropTarget(active: boolean): void {
        if (active === this.dropTargetActive) return;
        this.dropTargetActive = active;
        const ratio = active ? Math.max(0.01, this.dropTargetScale) : 1;
        this.node.setScale(this.baseScaleX * ratio, this.baseScaleY * ratio, this.baseScaleZ);
    }

    /** @param frames null 项保留 prefab 现图；level 不传用 fallbackLevel。 */
    render(card: ZCDeckCard, frames: ZCBoardSlotFrames, level?: number, prefab?: Prefab | null): void {
        if (frames.disc) this.disc.spriteFrame = frames.disc;
        if (frames.hero) this.hero.spriteFrame = frames.hero;
        if (frames.badge) this.classBadge.spriteFrame = frames.badge;
        if (prefab) {
            (this.preview ??= new CardUnitPreview(this.hero, this.previewHeight)).show(prefab);
        } else {
            this.preview?.clear();
        }
        this.levelLabel.string = `${Math.max(1, Math.round(level ?? this.fallbackLevel))}${CARD_LINEUP_TEXTS.levelSuffix}`;
        this.currentCard = card;
        this.setEmpty(false);
    }

    /** 空站台：只切立绘与等级牌，底座垫盘始终在。 */
    setEmpty(empty: boolean): void {
        if (empty) {
            this.preview?.clear();
            // 空站台不再响应点击 —— 否则手指点到空格也会把上一张卡的下阵请求发出去。
            this.currentCard = null;
        }
        this.unitGroup.active = !empty;
    }

    // ========================================================================
    // 手势（与 LineupBoardCard 同一份实现，避免两套误触判定）
    // ========================================================================

    private onTouchStart(event: EventTouch): void {
        if (!this.tapHost || !this.currentCard) return;
        event.getUILocation(this.pressStart);
        this.pressing = true;
    }

    private onTouchEnd(event: EventTouch): void {
        if (!this.pressing) return;
        this.pressing = false;
        if (!this.currentCard || !this.tapHost) return;
        const loc = event.getUILocation();
        const dx = loc.x - this.pressStart.x;
        const dy = loc.y - this.pressStart.y;
        if (dx * dx + dy * dy > this.pressSlop * this.pressSlop) return;
        this.tapHost.onCardTap(this.currentCard);
    }

    private onTouchCancel(): void {
        this.pressing = false;
    }
}
