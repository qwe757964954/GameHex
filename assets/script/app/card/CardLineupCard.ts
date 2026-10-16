import { _decorator, Component, Label, Node, ProgressBar, Sprite, SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { applyCardHeadArt } from './CardHeadView';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

const { ccclass, property } = _decorator;

/** 卡牌一次渲染要的四张图。 */
export interface ZCCardFrames {
    readonly face: SpriteFrame | null;
    readonly hero: SpriteFrame | null;
    readonly badge: SpriteFrame | null;
    /** 该卡头像；null = 没配（金矿/主城等），保留 hero 立绘。 */
    readonly head: SpriteFrame | null;
}

/**
 * 卡牌进度（碎片）的显示口径 —— **纯数据**，由页面算好后传进来。
 *
 * 使用升级需求的 `card` 行；`exp` 是升级弹窗里的另一项材料。
 * 本组件只负责显示，不关心它从哪来。
 */
export interface ZCCardFragmentProgress {
    /** 已持有碎片数。 */
    readonly owned: number;
    /** 升到下一级（或解锁）所需碎片数；已满级时传 0。 */
    readonly need: number;
    /** 已满级（进度条走满、文案显示「已满级」）。 */
    readonly maxed: boolean;
}

/**
 * 卡牌阵容页卡库的单张卡。
 *
 * 层次：卡面 → 职业角标 → 立绘/头像 → 已出战标 → 底部（等级/ 卡牌进度条+ 卡牌数）。
 *
 * ## 三处口径
 *
 *  1. `LevelLabel` = **卡牌等级**（`heroLevels`，未拥有时隐藏等级底板）。
 *     ⚠️ 2026-10-10 之前这里放的是**品级数字**（绿1/蓝2/紫3/金4）：品级是静态配置、
 *     等级是养成结果，同一个数字位表达两件事早晚要打架。现在品级由 `ClassBadge`
 *     角标图自己表达（角标本就是按职业/品级画的），这个位置腾给会变的等级。
 *  2. `CardFragmentCountLabel` = `已持有卡牌/ 所需卡牌`，进度条按同一比例走。
 *  3. 进度是**引擎 `cc.ProgressBar`**（2026-10-10 之前是手改 `ProgressFill` 的
 *     `contentSize.width`）—— 裸 Sprite 改宽度会在 `sizeMode=TRIMMED` 下被贴图原尺寸
 *     覆写回去（规则 129），而且拿不到引擎的进度动画。
 *
 * @param card 这张卡。**当前渲染不用它的任何字段**（品级已交给 `ClassBadge` 图标），
 *   但保留在签名里：条目是虚拟列表复用槽位，「这张槽位正在画哪张卡」只能靠入参区分；
 *   将来按品级换卡面/边框时也要用到。别为了「当前没引用」就删。
 */
@ccclass('CardLineupCard')
export class CardLineupCard extends Component {
    @property({ type: Sprite, tooltip: 'Face：卡面底图' })
    face: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Badge：职业角标（品级由本图标表达）' })
    badge: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Hero：营地雕像' })
    hero: Sprite = null!;

    @property({ type: Sprite, tooltip: 'HeadIcon：该卡头像（与 Hero 互斥）' })
    headIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'OnField：已出战标（未上阵隐藏）' })
    onField: Node = null!;

    @property({ type: Label, tooltip: 'OnField/Label' })
    onFieldLabel: Label = null!;

    @property({ type: Node, tooltip: 'LevelPlate：等级底板，0 级隐藏' })
    levelPlate: Node = null!;

    @property({ type: Label, tooltip: 'LevelPlate/LevelLabel：卡牌等级' })
    levelLabel: Label = null!;

    @property({ type: ProgressBar, tooltip: 'CardFragmentProgress/ProgressBar：卡牌进度（bar = CardFragmentFill）' })
    progressBar: ProgressBar = null!;

    @property({ type: Label, tooltip: 'CardFragmentCountLabel：卡牌数「已持有/所需」' })
    cardFragmentLabel: Label = null!;

    @property({ tooltip: '碎片数占位值（页面没给进度时的兜底）' })
    fallbackOwned = 3;

    @property({ tooltip: '所需碎片数占位值' })
    fallbackNeed = 10;

    /** @param frames null 项保留 prefab 现图；progress 不传用占位值。 */
    render(
        card: ZCDeckCard,
        frames: ZCCardFrames,
        onField: boolean,
        level?: number,
        progress?: ZCCardFragmentProgress,
    ): void {
        if (frames.face) this.face.spriteFrame = frames.face;
        if (frames.badge) this.badge.spriteFrame = frames.badge;
        applyCardHeadArt(this, frames.hero, frames.head);

        const normalizedLevel = Math.max(0, Math.round(level ?? 0));
        this.levelPlate.active = normalizedLevel > 0;
        this.levelLabel.string = String(normalizedLevel);
        this.onField.active = onField;
        this.onFieldLabel.string = CARD_LINEUP_TEXTS.onField;

        const owned = Math.max(0, Math.round(progress?.owned ?? this.fallbackOwned));
        const need = Math.max(0, Math.round(progress?.need ?? this.fallbackNeed));
        // 满级 / 无需求 ⇒ 进度走满、文案说「已满级」，别显示成 `12/0`。
        const maxed = progress?.maxed ?? need <= 0;
        this.cardFragmentLabel.string = maxed
            ? CARD_LINEUP_TEXTS.upgradeMaxed
            : `${owned}${CARD_LINEUP_TEXTS.progressSeparator}${need}`;
        // ⚠️ 只写 `progress`（0~1），**不要**再手改 `ProgressFill` 的 `contentSize`：
        //   ProgressBar 自己在 `updateBarStatus()` 里按 anchorX 算填充宽度，
        //   外面改宽度会被它下一次刷新覆盖回去（两处写同一个值 = 谁赢看时序）。
        this.progressBar.progress = maxed ? 1 : need > 0 ? Math.min(1, owned / need) : 0;
    }
}
