import { _decorator, Component, EventTouch, Label, Node, Sprite, SpriteFrame, Vec2 } from 'cc';
import { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { applyCardHeadArt } from './CardHeadView';

const { ccclass, property } = _decorator;

/** 卡池单卡一次渲染需要的四张图（前三张按「品级 + 职业」复用，头像按卡）。 */
export interface ZCBoardCardFrames {
    /** 品级卡框 `common_img_pzk_01..04`（`image/frame`）。 */
    frame: SpriteFrame | null;
    /** 职业 Q 版立绘 `char_0X`（`image/icon/card`）。 */
    hero: SpriteFrame | null;
    /** 左上角职业角标 `class_*`（`image/icon/card`）。 */
    badge: SpriteFrame | null;
    /** 该卡自己的头像；`null` = 没配头像，保留 `hero` 立绘。 */
    head: SpriteFrame | null;
}

/**
 * 卡池单卡的点击宿主（由 `LineupBoardPage` 实现）。
 *
 * 卡看得见的是自己，决定「上阵 / 下阵」的是页面 —— 这里只上报点击，不碰草稿。
 */
export interface IBoardCardHost {
    /** 短按点击：未上阵 → 上阵；已上阵 → 下阵。 */
    onCardTap(card: ZCDeckCard): void;
}

/**
 * 「布阵」面板下半个卡池里的一张卡。
 *
 * 挂在 `LineupBoardCard.prefab` 根节点上，由 `LineupBoardPage` 批量取到后逐个填数据。
 *
 * 层次（自下而上）：品级卡框 → 职业角标 → 立绘 → **压暗遮罩** → 等级牌 → 「已上阵」对勾。
 * 压暗遮罩与对勾只用来表达「这张已经在上阵区」，`Dim` 的黑色与透明度**绑在 prefab 的
 * Sprite 上**（样式在 prefab、代码只切显隐），与项目既有约定一致。
 *
 *  卡框 99×100 来自 `image/frame`，与页面那套 155×195 的 `common_img_kp_*` 不是同一张，
 * 别把 `CARD_FACE_ART` 拿来这里用。
 *
 * ── 交互 ─────────────────────────────────────────────────────────────
 * 只保留短按点击：按下后位移超过 `pressSlop` 判定为滑动列表，不触发；
 * 否则松手上报 `onCardTap`，由页面决定上阵 / 下阵。
 */
@ccclass('LineupBoardCard')
export class LineupBoardCard extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品级卡框（common_img_pzk_01..04，按品级换图）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Badge：左上角职业角标（class_*）' })
    badge: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Hero：职业 Q 版立绘（char_0X）' })
    hero: Sprite = null!;

    /**
     * `HeadIcon`：**该卡自己的头像**（57×57，`PVP-卡牌.headIcon` 解出来的图）。
     *
     *  尺寸比卡库那处小（卡池卡只有 99×100），但**同为方图**，所以同一张 84×84 的头像
     *  在两边都是等比缩放、不会变形。
     */
    @property({ type: Sprite, tooltip: 'HeadIcon：该卡的头像（57×57，与 Hero 互斥显示）' })
    headIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'Dim：整卡压暗遮罩（已上阵时显示），压在角标/立绘之上、对勾之下' })
    dim: Node = null!;

    @property({ type: Node, tooltip: 'Check：绿色对勾（已上阵时显示）' })
    check: Node = null!;

    @property({ type: Label, tooltip: 'LevelLabel：左下角等级数字，只写数字本身（设计稿上是「1」）' })
    levelLabel: Label = null!;

    @property({ tooltip: '等级占位值：养成表落地前统一用这个数' })
    fallbackLevel = 1;

    @property({ tooltip: '按下后位移超过多少像素就当成滑动列表，不再触发点击' })
    pressSlop = 16;

    /** 点击宿主，由 `LineupBoardPage` 在灌数据时注入（不是 @property，不落 prefab）。 */
    tapHost: IBoardCardHost | null = null;

    private currentCard: ZCDeckCard | null = null;
    private readonly pressStart = new Vec2();
    /** 已按下、等待松开判定是否为点按。 */
    private pressing = false;

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

    /**
     * 填入一张卡池卡。
     *
     * @param card    卡牌数据
     * @param frames  已加载好的四张图；前三张为 `null` 时保留 prefab 现有图片
     * @param onField 是否已在上阵区（决定压暗遮罩与对勾的显隐）
     * @param level   该卡等级；不传用 `fallbackLevel`
     */
    render(card: ZCDeckCard, frames: ZCBoardCardFrames, onField: boolean, level?: number): void {
        if (frames.frame) this.frame.spriteFrame = frames.frame;
        if (frames.badge) this.badge.spriteFrame = frames.badge;
        // 头像一个入口、互斥显隐（`frames.head` 为 null 时自动退回 Hero 立绘）。
        applyCardHeadArt(this, frames.hero, frames.head);
        this.levelLabel.string = String(Math.max(1, Math.round(level ?? this.fallbackLevel)));
        this.setOnField(onField);
        this.currentCard = card;
    }

    /** 只切「已上阵」态（面板做一键下阵时用它整列刷新）。 */
    setOnField(onField: boolean): void {
        this.dim.active = onField;
        this.check.active = onField;
    }

    // ========================================================================
    // 手势
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
        // 位移太大算滑动列表，不触发点击
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
