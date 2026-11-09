import { _decorator, Color, Component, Label, Node, ProgressBar, Sprite, SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';

const { ccclass, property } = _decorator;

/** 已解锁：乘算白 = 原色。 */
const COLOR_NORMAL = new Color(255, 255, 255, 255);

/** 未解锁：整卡压暗并略微偏冷，对齐参考图里那张被遮暗的灰蓝卡（压暗量级同 `ChangeHeadItem` 的置灰）。 */
const COLOR_LOCKED = new Color(92, 98, 112, 255);

/** 卡牌一次渲染要的三张图。 */
export interface ZCCardFrames {
    readonly face: SpriteFrame | null;
    readonly hero: SpriteFrame | null;
    readonly badge: SpriteFrame | null;
}

/** 条目自取图的入口：返回已就绪的图，失败同样按 `null` 项降级。 */
export type ZCCardArtLoader = (card: ZCDeckCard) => Promise<ZCCardFrames>;

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
 * 层次：卡面 → 职业角标 → 立绘/头像 → 已出战标 → 底部（等级/ 卡牌进度条+ 卡牌数）→ 未解锁锁标。
 *
 * ## 四处口径
 *
 *  1. `LevelLabel` = **卡牌等级**（`heroLevels`，未拥有时隐藏等级底板）。
 *     ⚠️ 2026-10-10 之前这里放的是**品级数字**（绿1/蓝2/紫3/金4）：品级是静态配置、
 *     等级是养成结果，同一个数字位表达两件事早晚要打架。现在品级由 `ClassBadge`
 *     角标图自己表达（角标本就是按职业/品级画的），这个位置腾给会变的等级。
 *  2. `CardFragmentCountLabel` = `已持有卡牌/ 所需卡牌`，进度条按同一比例走。
 *  3. 进度是**引擎 `cc.ProgressBar`**（2026-10-10 之前是手改 `ProgressFill` 的
 *     `contentSize.width`）—— 裸 Sprite 改宽度会在 `sizeMode=TRIMMED` 下被贴图原尺寸
 *     覆写回去（规则 129），而且拿不到引擎的进度动画。
 *  4. 未解锁（等级 0）= 卡面 / 角标 / 立绘整体压暗 + 右上角 `Lock` 显形。压暗用
 *     `Sprite.color` 乘算而非叠遮罩，理由见 `applyLocked`。
 *
 * @param card 这张卡。**当前渲染不用它的任何字段**（品级已交给 `ClassBadge` 图标），
 *   但保留在签名里：条目是虚拟列表复用槽位，「这张槽位正在画哪张卡」只能靠入参区分；
 *   将来按品级换卡面/边框时也要用到。别为了「当前没引用」就删。
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

    @property({ tooltip: '碎片数占位值（页面没给进度时的兜底）' })
    fallbackOwned = 3;

    @property({ tooltip: '所需碎片数占位值' })
    fallbackNeed = 10;

    /**
     * 本条目「当前画的是哪一次渲染」。
     *
     * 静态图改由条目自取后，图可能在槽位换成另一张卡之后才到（虚拟列表复用 + 滚动），
     * 每次 `render` 自增一次，迟到的图与当前 token 不符就丢弃，否则会把上一张卡的立绘
     * 贴到这一张上 —— 而且是永久错到底，直到这张被再次渲染。
     */
    private artToken = 0;

    /**
     * 上一次 `render` 的输入指纹。
     *
     * `VScrollView.refreshList` 会**同步重画所有可见槽位**（`_updateVisible(true)` →
     * `_layoutSlots`），而 `Sprite.spriteFrame` / `Label.string` / `ProgressBar.progress`
     * 即使赋的是同一个值也会标脏、下一帧重新合批。数据没变时重复写这十来个属性，
     * 就是「列表刷新一下就顿一下」的主要来源。
     *
     * 指纹含 `card.id`：槽位复用给另一张卡时必然不同，不会误跳过。
     */
    private lastRenderKey = '';
    private lastFrames: ZCCardFrames | null = null;

    /**
     * @param frames 已备好的图；`null` = 还没到，先清空占位（**不能保留上一张的**），
     *   有 `loader` 就由条目自己异步补。
     * @param loader 条目自取图的入口。页面不再等 35 张卡库图才提交列表 —— 那是首屏
     *   800ms 的来源（实测 2026-11-04：卡库 817ms / 整页 822ms），且虚拟列表只用得到
     *   可见的十来个槽位，全量备图本来就在为看不见的卡付钱。
     * @param progress 不传用占位值。
     * @param level 卡牌等级；`0` = 未解锁 —— 整卡压暗 + 右上角挂锁、不显示等级底板。
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
        //  图按**引用**比：池图异步补完后是另一个 `ZCCardFrames` 对象，必须重画。
        //  短路时**故意不自增 artToken** —— 上一次 render 发起的 loader 还在飞，
        //  让它到达时仍能认领这个槽位（否则图永远不会补上来）。
        if (key === this.lastRenderKey && frames === this.lastFrames) return;
        this.lastRenderKey = key;
        this.lastFrames = frames;

        //  三张图**无条件赋值**：本组件由虚拟列表复用，`null` 时若跳过赋值，
        //  会把上一张卡的职业框 / 角标留在这一张上（串图）。`this.face` 等是必绑组件。
        this.applyArt(card, frames, loader);

        this.levelPlate.active = normalizedLevel > 0;
        this.levelLabel.string = String(normalizedLevel);
        this.onField.active = onField;
        this.onFieldLabel.string = CARD_LINEUP_TEXTS.onField;
        //  未解锁口径与排序分组同一把尺子：等级 > 0 才算已解锁（后端列表里没有这张卡 ⇒ 0 级）。
        this.applyLocked(normalizedLevel <= 0);

        // 满级 / 无需求 ⇒ 进度走满、文案说「已满级」，别显示成 `12/0`。
        this.cardFragmentLabel.string = maxed
            ? CARD_LINEUP_TEXTS.upgradeMaxed
            : `${owned}${CARD_LINEUP_TEXTS.progressSeparator}${need}`;
        // ⚠️ 只写 `progress`（0~1），**不要**再手改 `ProgressFill` 的 `contentSize`：
        //   ProgressBar 自己在 `updateBarStatus()` 里按 anchorX 算填充宽度，
        //   外面改宽度会被它下一次刷新覆盖回去（两处写同一个值 = 谁赢看时序）。
        this.progressBar.progress = maxed ? 1 : need > 0 ? Math.min(1, owned / need) : 0;
    }

    /**
     * 未解锁态：整卡压暗 + 右上角挂锁。**无条件写**（槽位复用，条件式赋值会把上一张的锁留在这一张上）。
     *
     * 压暗走 `Sprite.color` 乘算，而不是在卡框上铺一张黑色遮罩：这里的立绘是 `sizeMode=RAW`
     * 的 256×256 原图，比卡框（155×195）大一圈，矩形遮罩只能压住卡框那一块，越界的头肩会
     * 留在亮处；乘算跟着图走，没有接缝，也不用再为遮罩节点同步尺寸。
     */
    private applyLocked(locked: boolean): void {
        const tint = locked ? COLOR_LOCKED : COLOR_NORMAL;
        this.face.color = tint;
        this.hero.color = tint;
        this.badge.color = tint;
        this.lock.active = locked;
    }

    /**
     * 画图：已就绪的同步写，没到的先清空再由 loader 异步补。
     *
     * 清空这一步不能省：虚拟列表把槽位换给下一张卡时，留着上一张的卡面比空白更像「卡错了」。
     */
    private applyArt(card: ZCDeckCard, frames: ZCCardFrames | null, loader?: ZCCardArtLoader): void {
        const token = ++this.artToken;
        this.applyFrames(frames);
        if (frames || !loader) return;
        void loader(card).then((next) => {
            //  槽位已被复用给另一张卡 / 页面已销毁 ⇒ 这张图到此为止。
            if (token !== this.artToken || !this.isValid) return;
            this.applyFrames(next);
        }).catch(() => undefined);
    }

    /** 三张图**无条件**全量赋值；`null` = 缺图，写空而不是跳过。 */
    private applyFrames(frames: ZCCardFrames | null): void {
        this.face.spriteFrame = frames ? frames.face : null;
        this.badge.spriteFrame = frames ? frames.badge : null;
        this.hero.spriteFrame = frames ? frames.hero : null;
    }
}
