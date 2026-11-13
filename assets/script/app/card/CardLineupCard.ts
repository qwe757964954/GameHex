import { _decorator, Color, Component, Label, Node, ProgressBar, Sprite, SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

const { ccclass, property } = _decorator;

/** 已解锁：乘算白 = 原色。 */
const COLOR_NORMAL = new Color(255, 255, 255, 255);

/** 卡牌一次渲染要的三张图。 */
export interface ZCCardFrames {
    readonly face: SpriteFrame | null;
    readonly hero: SpriteFrame | null;
    readonly badge: SpriteFrame | null;
}

/** 条目自取图的入口：返回已就绪的图，失败同样按 `null` 项降级。 */
export type ZCCardArtLoader = (card: ZCDeckCard) => Promise<ZCCardFrames>;

/** 碎片进度，页面算好传进来；本组件只负责显示。 */
export interface ZCCardFragmentProgress {
    /** 已持有碎片数。 */
    readonly owned: number;
    /** 升到下一级（或解锁）所需碎片数；已满级时传 0。 */
    readonly need: number;
    /** 已满级（进度条走满、文案显示「已满级」）。 */
    readonly maxed: boolean;
}

/**
 * 卡库里的单张卡。层级：卡面、职业角标、立绘、出战中、等级/碎片、锁。
 * 等级 0 当未解锁处理：开遮罩、挂锁，等级底板不显示。
 *
 * card 入参现在没用到，但槽位是复用的，靠它区分“这一格正在画哪张卡”，别删。
 */
@ccclass('CardLineupCard')
export class CardLineupCard extends Component {
    @property({ type: Sprite, tooltip: 'Face：卡面底图' })
    face: Sprite = null;

    @property({ type: Sprite, tooltip: 'Badge：职业角标（品级由本图标表达）' })
    badge: Sprite = null;

    @property({ type: Sprite, tooltip: 'Hero：营地雕像' })
    hero: Sprite = null;

    @property({ type: Node, tooltip: 'OnField：已出战标（未上阵隐藏）' })
    onField: Node = null;

    @property({ type: Label, tooltip: 'OnField/Label' })
    onFieldLabel: Label = null;

    @property({ type: Node, tooltip: 'LevelPlate：等级底板，0 级隐藏' })
    levelPlate: Node = null;

    @property({ type: Label, tooltip: 'LevelPlate/LevelLabel：卡牌等级' })
    levelLabel: Label = null;

    @property({ type: ProgressBar, tooltip: 'CardFragmentProgress/ProgressBar：卡牌进度（bar = CardFragmentFill）' })
    progressBar: ProgressBar = null;

    @property({ type: Label, tooltip: 'CardFragmentCountLabel：卡牌数「已持有/所需」' })
    cardFragmentLabel: Label = null;

    @property({ type: Node, tooltip: 'Lock：未解锁锁标（卡框右上角，仅未解锁时显示）' })
    lock: Node = null;

    @property({ type: Node, tooltip: 'LockVeil：未解锁压暗遮罩（yx_mask，仅未解锁时显示）' })
    lockVeil: Node = null;

    @property({ type: Node, tooltip: 'UpgradeArrow：可升级箭头（碎片已够、且未满级时显示）' })
    upgradeArrow: Node = null;

    @property({ tooltip: '碎片数占位值（页面没给进度时的兜底）' })
    fallbackOwned = 3;

    @property({ tooltip: '所需碎片数占位值' })
    fallbackNeed = 10;

    /**
     * 当前这次 render 的序号。图异步回来时对不上就丢，别把上一张的立绘贴到新卡上。
     */
    private artToken = 0;

    /**
     * 上次 render 的输入摘要。列表刷新会对同一批槽位重画，值没变就跳过，
     * 免得重复写 Sprite、Label、ProgressBar。key 带 card.id，换卡不会误判。
     */
    private lastRenderKey = '';
    private lastFrames: ZCCardFrames | null = null;

    /**
     * @param frames 已备好的图；传 null 表示还没到，先清空占位。
     * @param loader 条目自己的取图入口。页面不等全部卡库图，只让可见槽位按需加载。
     * @param progress 不传就用占位值。
     * @param level 卡牌等级；0 表示未解锁。
     */
    render(
        card: ZCDeckCard,
        frames: ZCCardFrames | null,
        onField: boolean,
        level?: number,
        progress?: ZCCardFragmentProgress,
        loader?: ZCCardArtLoader,
    ): void {
        const normalizedLevel = Math.max(0, Math.round(level ?? 0));
        const owned = Math.max(0, Math.round(progress?.owned ?? this.fallbackOwned));
        const need = Math.max(0, Math.round(progress?.need ?? this.fallbackNeed));
        const maxed = progress?.maxed ?? need <= 0;
        const key = `${card.id}|${onField ? 1 : 0}|${normalizedLevel}|${owned}|${need}|${maxed ? 1 : 0}`;
        // 图按引用比较：异步补完是另一个对象，必须重画。
        // 短路时不自增 artToken，让上一次 loader 回来还能认这个槽位。
        if (key === this.lastRenderKey && frames === this.lastFrames) return;
        this.lastRenderKey = key;
        this.lastFrames = frames;

        // 三张图都要写，null 也写空。槽位复用，跳过赋值会把上一张的图留下。
        this.applyArt(card, frames, loader);

        this.levelPlate.active = normalizedLevel > 0;
        this.levelLabel.string = String(normalizedLevel);
        this.onField.active = onField;
        this.onFieldLabel.string = CARD_LINEUP_TEXTS.onField;
        // 等级 > 0 才算解锁，和排序口径一致。
        this.applyLocked(normalizedLevel <= 0);
        // 已解锁、未满级、碎片够，才显示可升级箭头。
        this.upgradeArrow.active = normalizedLevel > 0 && !maxed && need > 0 && owned >= need;

        // 满级或没有需求时进度走满，文案显示“已满级”，别出现 12/0。
        this.cardFragmentLabel.string = maxed
            ? CARD_LINEUP_TEXTS.upgradeMaxed
            : `${owned}${CARD_LINEUP_TEXTS.progressSeparator}${need}`;
        // 只写 progress，别手改 ProgressFill 的宽度，下一次 ProgressBar 刷新会盖回去。
        this.progressBar.progress = maxed ? 1 : need > 0 ? Math.min(1, owned / need) : 0;
    }

    /**
     * 未解锁：开遮罩和锁。槽位会复用，必须无条件写，不能只处理 true。
     * 压暗交给 prefab 的 LockVeil，图本身保持白色，不再乘颜色。
     */
    private applyLocked(locked: boolean): void {
        this.face.color = COLOR_NORMAL;
        this.hero.color = COLOR_NORMAL;
        this.badge.color = COLOR_NORMAL;
        this.lockVeil.active = locked;
        this.lock.active = locked;
    }

    /**
     * 有图直接画，没图先清空，再让 loader 异步补。
     * 清空不能省，否则槽位换卡时会留着上一张的图。
     */
    private applyArt(card: ZCDeckCard, frames: ZCCardFrames | null, loader?: ZCCardArtLoader): void {
        const token = ++this.artToken;
        this.applyFrames(frames);
        if (frames || !loader) return;
        void loader(card).then((next) => {
            // 槽位已经换卡或页面销毁了，这张图就不要再写。
            if (token !== this.artToken || !this.isValid) return;
            this.applyFrames(next);
        }).catch(() => undefined);
    }

    /** 三张图无条件全量赋值；`null` = 缺图，写空而不是跳过。 */
    private applyFrames(frames: ZCCardFrames | null): void {
        this.face.spriteFrame = frames ? frames.face : null;
        this.badge.spriteFrame = frames ? frames.badge : null;
        this.hero.spriteFrame = frames ? frames.hero : null;
    }
}
