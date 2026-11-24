/**
 * 升级成功弹窗（`ui/card/CardUpgraded.prefab`）—— 渲染 + 表现时序。
 *
 * 2026-11-20 需求：「增加升级详情界面的 UI 表现动画」，五条按顺序串成一条时间轴
 * （曲线与关键节点在 `CardUpgradedTimeline`，本文件只负责**按时刻把值写进节点**）：
 *
 *   ① 入场：各块**同时**起播，各从屏幕的不同方向滑到自己的坐标
 *      （上部整体自上、左右属性框各自自左右、增益条自下）；
 *   ② 角色升级特效：`CardUpgradeFx`（15 帧序列帧）压在立绘上层，播 1 次；
 *   ③ 等级数字：放大到峰值时换成新数字，再带回弹落下；
 *   ④ 进度条刷光：刷光扫过 → 从「满格」退到下一级比例；
 *   ⑤ 属性数值刷光：刷光结束 → 数值直接切换。
 *
 * 「所有刷光动画同步」由结构保证：`shineProgressAt` 只有一个 0→1，
 * 进度条、属性左框、属性右框三条光带都由它驱动 —— 但**每条只在自己那个框里扫**
 * （2026-11-20 二改：之前属性区是一条 720 宽的大光带横跨两个框，看着像一整块在亮）。
 *
 * ⚠️ 一律**不建 `cc.tween`**（同 `UIMotionPlayer`）：弹窗节点会进对象池，
 * tween 在回收之后还会跑完，回调里拿到的已经是别人的节点。这里用
 * `schedule(step, 0)` 逐帧采样，静止时完全不进函数，`onClose` / `onDestroy` 里收干净。
 *
 * ⚠️ 刷光条与特效节点**跟着资源作用域一起销毁**（`_internalReleaseResources`）：
 * `PopupBase` 每次打开都会重建作用域，上一轮加载的 SpriteFrame 在下一次 open 时
 * 已经 decRef 过头，留在节点上就是「Batcher2D 提交已销毁的帧」那类崩溃。
 */
import {
    _decorator,
    Animation,
    instantiate,
    Label,
    Node,
    Prefab,
    RichText,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CardUnitPreview } from './CardUnitPreview';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';
import {
    buildCardUpgradedSchedule,
    entranceDirectionAt,
    entranceOffsetAt,
    levelScaleAt,
    progressPopScaleAt,
    progressRatioAt,
    progressZeroTextOf,
    shineOpacityAt,
    shineProgressAt,
    shineSweepAt,
    type ICardUpgradedSchedule,
} from './CardUpgradedTimeline';

const { ccclass, property } = _decorator;

/** 设计稿英雄立绘高 426，骨骼 idle 也按这个可见高归一。 */
const HERO_VISIBLE_HEIGHT = 426;

/** 进度填充的满格宽度（= 底槽 442 - 两侧各 3 的内缩）。 */
const FILL_TRACK_WIDTH = 436;

/** 刷光条贴图：横向中间亮、两端全透明的白色光带（128×32）。 */
const SHINE_FRAME_PATH = 'image/card_effect_levelup/shine/spriteFrame';

/** 升级序列帧特效预制（`ui/card/CardUpgradeFx`，15 帧、`wrapMode: 1` 播 1 次）。 */
const FX_PREFAB_PATH = 'ui/card/CardUpgradeFx';

/**
 * 特效起播时刻之后，还能再等资源多久（秒）。
 *
 * 资源现在与首帧并行加载（见 `onOpen`），可能比 `fxAt`（0.55s）晚到一点点。
 * 没到齐就不要把「已播过」的门闩置位，下一帧再试；但也不能一直空转 ——
 * 过了这个窗口就当这次没有特效（总时长 1.25s，再晚就已经跳到等级数字了）。
 */
const FX_RETRY_WINDOW = 0.3;

/** 进度条刷光：光带自身宽 / 允许溢出目标区两端 / 峰值不透明度。 */
const SHINE_BAR_WIDTH = 120;
const SHINE_BAR_ALPHA = 0.9;
/**
 * 属性框刷光：左右框**各自一条**，光带只在自己的框里扫（2026-11-20 二改）。
 *
 * 之前是属性区一条 720 宽的带子横跨两框 ⇒ 「一个大刷光」；现在按框拆开，
 * 带子宽度贴着单框（271）收一点，压暗一点，别把数值糊掉。
 */
const SHINE_SLOT_WIDTH = 96;
const SHINE_SLOT_ALPHA = 0.55;
/** 光带越出目标区两端的余量，避免扫到边缘时「凭空出现 / 突然消失」。 */
const SHINE_BLEED = 16;

/** 进度条所在容器（`Level/Progress`）的尺寸；光带按它算行程。 */
const PROGRESS_AREA_WIDTH = 450;

/**
 * 升级特效相对「角色脚底」的下移量（逻辑 px）。
 *
 * 需求（2026-11-20 三改）：特效往下挪，让亮芯中心对住角色中心、比较均匀地盖住角色。
 *
 * 为什么原来偏高：`CardUpgradeFx` 锚点在底边（0.5, 0），772×2214 的序列帧在 0.4 缩放下
 * 可见高 855.6，立在脚下时亮芯中心在「脚上 +402」，而角色中心只在「脚上 +213」
 * （立绘区 426 高、锚点居中）—— 于是整根光柱几乎全飘在头顶。
 * 严格中心对齐要挪 189~215；这里先按你给的 70 落一档，实机若仍偏高就只改这一个数。
 *
 * 2026-11-24：源图已按 0.4 显示比缩到 309×886 并收进本目录 `auto-atlas.pac`；
 * prefab 的 772×2214 / 0.4 未动，所以这里的落位与下移量全部照旧。
 */
export const FX_DROP_PX = 70;

/** 当前时刻（秒）。与 `UIMotionPlayer` / `ChestBar` 同一口径。 */
function nowSeconds(): number {
    return Date.now() / 1000;
}

/** 入场一块：节点 + 它在入场方向表里的序号 + prefab 里的原始坐标（收尾要精确复位）。 */
interface IEntranceBlock {
    readonly node: Node;
    readonly index: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** 一条刷光带：节点、不透明度、框中心、行程、峰值亮度。 */
interface IShineStreak {
    readonly node: Node;
    readonly opacity: UIOpacity;
    /** 该框中心在父节点坐标系里的 x（光带只在这个中心两侧的行程内扫）。 */
    readonly centerX: number;
    readonly centerY: number;
    readonly travel: number;
    readonly alpha: number;
}

/** 升级成功弹窗：只渲染控制器给的数据；关闭走 PopupBase 的空白接收层。 */
@ccclass('CardUpgradedPage')
export class CardUpgradedPage extends PopupBase {
    static prefabPath = 'ui/card/CardUpgraded';

    private progressFillUi: UITransform | null = null;
    private heroPreview: CardUnitPreview | null = null;

    // ---- 表现时序的运行时状态 ----
    private timeline: ICardUpgradedSchedule | null = null;
    private content: ICardUpgradedContent | null = null;
    private playAt = 0;
    private entranceBlocks: IEntranceBlock[] = [];
    private shines: IShineStreak[] = [];
    private shineFrame: SpriteFrame | null = null;
    private fxPrefab: Prefab | null = null;
    private heroFx: Node | null = null;
    /** 当前特效节点是由哪份 prefab 实例化的（作用域重建后 prefab 会换，得跟着重建）。 */
    private heroFxPrefab: Prefab | null = null;
    /** 进度条的换档端点：满格 `progressFrom` → 清空 → 涨到 `progressTo`。 */
    private progressFrom = 0;
    private progressTo = 0;
    // 一次性事件的门闩（同一次打开内只触发一次；`render` 会全部重置）。
    private fxStarted = false;
    private fxFinished = false;
    private levelSwitched = false;
    private valueSwitched = false;
    /** 换档当拍：数量文字已切成「0/need」。 */
    private progressSwitched = false;
    /** 涨格结束：数量文字已切成下一级的真实值。 */
    private progressGrown = false;

    @property({ group: '背景', type: Sprite, tooltip: 'Bg：720×1610 品质背景' })
    background: Sprite = null!;

    @property({ group: '属性框', type: Sprite, tooltip: 'Stats/Left/Frame：左属性框' })
    frameLeft: Sprite = null!;

    @property({ group: '属性框', type: Sprite, tooltip: 'Stats/Right/Frame：右属性框' })
    frameRight: Sprite = null!;

    @property({ group: '角色', type: Sprite, tooltip: 'Hero：英雄立绘，同时作为骨骼加载失败时的兜底' })
    hero: Sprite = null!;

    @property({ group: '角色', type: Sprite, tooltip: 'Hero/Shadow：脚下影子' })
    shadow: Sprite = null!;

    @property({ group: '头部', type: Node, tooltip: 'Header：入场第 1 块' })
    headerRoot: Node = null!;

    @property({ group: '头部', type: Sprite, tooltip: 'Header/Quality：品质徽章' })
    quality: Sprite = null!;

    @property({ group: '头部', type: Sprite, tooltip: 'Header/Class/Icon：职业图标' })
    classIcon: Sprite = null!;

    @property({ group: '头部', type: Label, tooltip: 'Header/Name：卡牌名' })
    nameLabel: Label = null!;

    @property({ group: '头部', type: Label, tooltip: 'Header/Class/Label：职业名' })
    classLabel: Label = null!;

    @property({ group: '等级', type: Node, tooltip: 'Level：等级整组（入场第 3 块）' })
    levelRoot: Node = null!;

    @property({ group: '等级', type: Label, tooltip: 'Level/Bar/Label：等级' })
    levelLabel: Label = null!;

    @property({ group: '等级', type: Node, tooltip: 'Level/Progress：进度条整组' })
    progressRoot: Node = null!;

    @property({ group: '等级', type: Sprite, tooltip: 'Level/Progress/Fill：绿色进度填充' })
    progressFill: Sprite = null!;

    @property({ group: '等级', type: Label, tooltip: 'Level/Progress/Label：材料进度' })
    progressLabel: Label = null!;

    @property({ group: '属性', type: Node, tooltip: 'Stats：左右属性整组（入场第 4 块）' })
    statsRoot: Node = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Left/Hp/Value：生命值' })
    hpValue: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Left/Hp/Gain：生命增量' })
    hpGain: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Right/Attack/Value：攻击力' })
    attackValue: Label = null!;

    @property({ group: '属性', type: Label, tooltip: 'Stats/Right/Attack/Gain：攻击增量' })
    attackGain: Label = null!;

    @property({ group: '增益', type: Node, tooltip: 'Bonus：底部战斗力增益条（入场第 5 块）' })
    bonusRoot: Node = null!;

    @property({ group: '增益', type: RichText, tooltip: 'Bonus/Desc：增益描述（主色+高亮）' })
    bonusDesc: RichText = null!;

    @property({ group: '弹窗', type: Node, tooltip: 'TapArea：1×1 隐藏节点，令整屏点击都按空白关闭' })
    tapArea: Node = null!;

    protected onInit(): void {
        this.progressFillUi = this.progressFill.getComponent(UITransform);
        this.heroPreview = new CardUnitPreview(this.hero, HERO_VISIBLE_HEIGHT);
        this.contentNodes = [this.tapArea];
        this.entranceBlocks = this.collectEntranceBlocks();
    }

    /**
     * 打开：**先落数据，再等资源**。
     *
     * 2026-11-20 三改（用户：「进入升级界面加载很慢，会先看到椰蛋战士的界面再切换」）：
     * 以前是 `await loadAnimationAssets()` 之后才 `render`，而弹窗此刻已经显示出来了 ——
     * 于是 prefab 自带的样例文案（`椰蛋战士 / 射手`，见 `CardUpgraded.prefab` 里
     * `NameLabel` / `ClassLabel` 的默认值）会在屏幕上停到资源到齐为止。
     * 现在 `render` 同步先跑（文案 / 立绘 / 时间轴立刻到位），资源在后台补齐。
     *
     * 刻意**不 await**：`onOpen` 返回的 Promise 会被 `PopupManager` 等，
     * 等它 = 把「弹窗可交互」推迟到资源就绪之后。资源没到也不影响内容与入场动画，
     * 只是刷光 / 特效慢一拍（见 `FX_RETRY_WINDOW` 的重试门闩）。
     */
    protected onOpen(userData?: ICardUpgradedContent): void {
        if (!userData) return;
        this.render(userData);
        void this.loadAnimationAssets()
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 动画资源准备失败，按无动画渲染', error);
            })
            .then(() => {
                if (!this.alive) return;
                // 刷光带按新帧补建（时间轴每帧都遍历 `this.shines`，迟到也能接上）。
                this.ensureShines();
                // 特效节点换过 prefab 就重建；正在播的那一根别打断。
                if (!this.fxStarted) this.resetHeroFx();
            });
    }

    /** 关闭 / 销毁 / 进缓存池都要收干净，别让逐帧回调打在已归还的节点上。 */
    protected onClose(): void {
        this.stopAnimation();
    }

    onDisable(): void {
        this.stopAnimation();
    }

    onDestroy(): void {
        this.stopAnimation();
        this.heroPreview?.clear();
        this.heroPreview = null;
        this.destroyAnimationVisuals();
        super.onDestroy();
    }

    /**
     * 节点交还（销毁 / 进缓存池）时，把刷光条与特效节点一起销毁。
     *
     * 必须与资源释放同一拍：`PopupBase` 会在这一刻 dispose 本次打开的作用域，
     * 留在节点上的 SpriteFrame / AnimationClip 引用就成了悬空帧。
     */
    public _internalReleaseResources(): void {
        this.destroyAnimationVisuals();
        super._internalReleaseResources();
    }

    // ============================================================
    // 渲染
    // ============================================================

    render(content: ICardUpgradedContent): void {
        this.stopAnimation();

        this.background.spriteFrame = content.background;
        this.background.node.active = !!content.background;

        this.frameLeft.spriteFrame = content.frame;
        this.frameRight.spriteFrame = content.frame;
        this.frameLeft.node.active = !!content.frame;
        this.frameRight.node.active = !!content.frame;

        const showHero = !!content.hero || !!content.heroPrefab;
        this.heroPreview?.clear();
        this.hero.spriteFrame = content.hero;
        this.hero.enabled = !!content.hero;
        this.hero.node.active = showHero;
        this.shadow.node.active = showHero;
        if (content.heroPrefab) {
            try {
                if (!this.heroPreview?.show(content.heroPrefab)) {
                    this.hero.enabled = !!content.hero;
                }
            } catch (error) {
                console.warn('[CardUpgradedPage] 骨骼 idle 启动失败，回退静态立绘', error);
                this.heroPreview?.clear();
                this.hero.spriteFrame = content.hero;
                this.hero.node.active = !!content.hero;
                this.hero.enabled = !!content.hero;
                this.shadow.node.active = !!content.hero;
            }
        }

        this.quality.spriteFrame = content.quality;
        this.quality.node.active = !!content.quality;

        this.classIcon.spriteFrame = content.classIcon;
        this.classIcon.node.active = !!content.classIcon && !!content.className;
        this.nameLabel.string = content.name;
        this.classLabel.string = content.className;

        // ③ 等级：先摆旧等级，起跳到峰值时再换成新等级。
        const previousLevel = content.previousLevelText ?? '';
        this.levelSwitched = !previousLevel || previousLevel === content.levelText;
        this.levelLabel.string = this.levelSwitched ? content.levelText : previousLevel;
        this.levelLabel.node.setScale(1, 1, 1);

        // ④ 进度条：刷光期间保持「本次消耗那一档的满格」，刷完清空归零、绿色再从左往右涨。
        this.progressRoot.active = content.progressText.length > 0;
        this.progressLabel.string = content.progressText;
        const ratio = clampRatio(content.progressRatio);
        this.progressFrom = ratio;
        this.progressTo = content.nextProgressRatio === undefined
            ? ratio
            : clampRatio(content.nextProgressRatio);
        this.progressSwitched = !(content.nextProgressText ?? '');
        this.progressGrown = this.progressSwitched;
        this.progressFill.node.active = ratio > 0;
        if (this.progressFillUi) this.progressFillUi.width = FILL_TRACK_WIDTH * ratio;

        // ⑤ 属性：先摆旧数值，刷光结束直接切新数值。
        const previousHp = content.previousHpValue ?? '';
        const previousAttack = content.previousAttackValue ?? '';
        this.valueSwitched = !previousHp && !previousAttack;
        this.hpValue.string = previousHp || content.hpValue;
        this.attackValue.string = previousAttack || content.attackValue;
        this.hpGain.string = content.hpGain;
        this.attackGain.string = content.attackGain;

        this.bonusRoot.active = content.bonusText.length > 0;
        this.bonusDesc.string = content.bonusText;

        // ② 特效与刷光：节点按「资源作用域」存活，这里只做复位。
        this.content = content;
        this.timeline = buildCardUpgradedSchedule();
        this.ensureShines();
        this.resetHeroFx();
        this.beginAnimation();
    }

    // ============================================================
    // 逐帧推进
    // ============================================================

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    private beginAnimation(): void {
        const timeline = this.timeline;
        const content = this.content;
        if (!timeline || !content || !this.alive) return;
        this.fxStarted = false;
        this.fxFinished = false;
        this.playAt = nowSeconds();
        // 先把 0 时刻写死：等第一帧 `step` 再写会先按原样渲染一帧（整页先摆到位再跳走）。
        this.applyDiscrete(timeline, content, 0);
        this.applyFrame(timeline, 0);
        this.unschedule(this.stepAnim);
        this.schedule(this.stepAnim, 0);
    }

    private readonly stepAnim = (): void => {
        const timeline = this.timeline;
        const content = this.content;
        if (!timeline || !content || !this.alive) {
            this.unschedule(this.stepAnim);
            return;
        }
        const t = Math.min(nowSeconds() - this.playAt, timeline.end);
        this.applyDiscrete(timeline, content, t);
        this.applyFrame(timeline, t);
        if (t >= timeline.end) this.unschedule(this.stepAnim);
    };

    /** 一次性事件（换字 / 换值 / 起播特响）—— 各自一个门闩，过点即触发一次。 */
    private applyDiscrete(timeline: ICardUpgradedSchedule, content: ICardUpgradedContent, t: number): void {
        if (!this.fxStarted && t >= timeline.fxAt) {
            // 资源没到就**别置门闩**：下一帧还能补播（`FX_RETRY_WINDOW` 之后才放弃）。
            if (this.playHeroFx()) this.fxStarted = true;
            else if (t >= timeline.fxAt + FX_RETRY_WINDOW) this.fxStarted = true;
        }
        if (!this.fxFinished && t >= timeline.fxEnd) {
            this.fxFinished = true;
            this.resetHeroFx();
        }
        if (!this.levelSwitched && t >= timeline.levelSwitchAt) {
            this.levelSwitched = true;
            this.levelLabel.string = content.levelText;
        }
        if (!this.valueSwitched && t >= timeline.valueSwitchAt) {
            this.valueSwitched = true;
            this.hpValue.string = content.hpValue;
            this.attackValue.string = content.attackValue;
        }
        if (!this.progressSwitched && t >= timeline.valueSwitchAt) {
            this.progressSwitched = true;
            // 条要归零了，数字先跟着归零 —— 否则「空条配 40/80」自相矛盾；
            // 也不逐帧插值：0→40 之间会闪一串读数，读起来像在抽奖。
            const zero = progressZeroTextOf(content.nextProgressText);
            if (zero) this.progressLabel.string = zero;
        }
        if (!this.progressGrown && t >= timeline.progressSettleAt) {
            this.progressGrown = true;
            const next = content.nextProgressText ?? '';
            if (next) this.progressLabel.string = next;
        }
    }

    /** 连续量（位移 / 缩放 / 刷光 / 退格）—— 每帧按同一套曲线重算，不做累加。 */
    private applyFrame(timeline: ICardUpgradedSchedule, t: number): void {
        for (const block of this.entranceBlocks) {
            if (!block.node.isValid) continue;
            // 行程是标量、方向按块序号取 —— 所有块同时起播，各自沿自己的方向收到原点。
            const offset = entranceOffsetAt(timeline, t, block.index);
            const direction = entranceDirectionAt(block.index);
            block.node.setPosition(
                block.x + direction.x * offset,
                block.y + direction.y * offset,
                block.z,
            );
        }

        if (this.levelLabel && this.levelLabel.isValid) {
            const scale = levelScaleAt(timeline, t);
            this.levelLabel.node.setScale(scale, scale, 1);
        }

        const shine = shineProgressAt(timeline, t);
        for (const streak of this.shines) this.applyShine(streak, shine);

        const fill = this.progressFillUi;
        if (fill && fill.isValid) {
            const width = FILL_TRACK_WIDTH * progressRatioAt(timeline, t, this.progressFrom, this.progressTo);
            if (Math.abs(fill.width - width) > 0.01) fill.width = width;
            const node = this.progressFill.node;
            if (node.isValid) {
                const visible = width > 0.5;
                if (node.active !== visible) node.active = visible;
            }
        }

        // 数量文字在换档那一拍弹一下 —— 条归零的同时数字动一下，才读得出「这一档被吃掉了」。
        if (this.progressLabel && this.progressLabel.isValid) {
            const scale = progressPopScaleAt(timeline, t);
            this.progressLabel.node.setScale(scale, scale, 1);
        }
    }

    /** 刷光带：`progress` 为 `-1` 表示此刻没有刷光（只把亮度归零）。 */
    private applyShine(streak: IShineStreak, progress: number): void {
        if (!streak.node.isValid || !streak.opacity.isValid) return;
        if (progress < 0) {
            if (streak.opacity.opacity !== 0) streak.opacity.opacity = 0;
            return;
        }
        // 位移走「缓进快出」（`shineSweepAt`），亮度仍按线性时间淡入淡出 ——
        // 让光带先在框口拱进来、再甩出去，同时两端不会因为加速而被硬切。
        const swept = shineSweepAt(progress);
        const x = streak.centerX - streak.travel / 2 + streak.travel * swept;
        streak.node.setPosition(x, streak.centerY, 0);
        const opacity = Math.round(255 * streak.alpha * shineOpacityAt(progress));
        if (streak.opacity.opacity !== opacity) streak.opacity.opacity = opacity;
    }

    /** 立即收工并复位到静止态（不写文案 —— 文案归 `render`）。 */
    private stopAnimation(): void {
        this.unschedule(this.stepAnim);
        if (!this.alive) return;
        for (const block of this.entranceBlocks) {
            if (block.node.isValid) block.node.setPosition(block.x, block.y, block.z);
        }
        if (this.levelLabel && this.levelLabel.isValid) this.levelLabel.node.setScale(1, 1, 1);
        // 数量文字的弹跳也是本页逐帧写的，收工时同样要回正（否则下次打开带着上一拍的缩放）。
        if (this.progressLabel && this.progressLabel.isValid) this.progressLabel.node.setScale(1, 1, 1);
        for (const streak of this.shines) {
            if (streak.opacity.isValid) streak.opacity.opacity = 0;
        }
        this.resetHeroFx();
    }

    // ============================================================
    // 入场块
    // ============================================================

    /**
     * 入场块：上部整体（Header / 立绘 + 影子 / 等级）自上而下，属性左右两框各自从左右，
     * 增益条自下而上 —— 序号对应 `ENTRANCE_DIRECTIONS`。
     *
     * 属性区在 prefab 里是**一整组扁平子节点**（`Stats/LeftFrame`、`Stats/LeftHpValue`…），
     * 没有 Left/Right 空组可攥，所以按节点名前缀拆成两块：左框从左边来、右框从右边来。
     * 前缀是 prefab 既有的命名纪律（`Left*` / `Right*`），比按 x 正负切更抗「挪位置」。
     */
    private collectEntranceBlocks(): IEntranceBlock[] {
        const blocks: IEntranceBlock[] = [];
        const push = (node: Node | null | undefined, index: number): void => {
            if (!node || !node.isValid) return;
            const position = node.position;
            blocks.push({ node, index, x: position.x, y: position.y, z: position.z });
        };
        push(this.headerRoot, 0);
        push(this.shadow?.node, 1);
        push(this.hero?.node, 1);
        push(this.levelRoot, 2);
        for (const child of this.statsRoot?.children ?? []) {
            if (child.name.startsWith('Left')) push(child, 3);
            else if (child.name.startsWith('Right')) push(child, 4);
        }
        push(this.bonusRoot, 5);
        return blocks;
    }

    // ============================================================
    // 刷光条
    // ============================================================

    /**
     * 惰性建三条光带：进度条一条、属性左右框各一条（贴图没加载到就整段刷光跳过）。
     *
     * 三条共用同一个 `shineProgressAt`（同步），但**各扫各的框** —— 这是
     * 「每个 UI 组件独立刷光、不是一个大的刷光」的落点。
     */
    private ensureShines(): void {
        const frame = this.shineFrame;
        if (!frame || !frame.isValid) return;
        if (this.shines.length > 0) {
            // 同一个弹窗实例被连续 open 时作用域已重建，节点还在、帧已经换了 —— 重新贴一次。
            for (const streak of this.shines) {
                if (!streak.node.isValid) continue;
                const sprite = streak.node.getComponent(Sprite);
                if (sprite && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
            }
            return;
        }
        // 进度条：居中扫过整条 450 宽的槽。
        const bar = this.createShine(
            this.progressRoot, 2, 0, 0,
            PROGRESS_AREA_WIDTH, this.heightOf(this.progressRoot, 45),
            SHINE_BAR_WIDTH, SHINE_BAR_ALPHA, frame);
        if (bar) this.shines.push(bar);
        // 属性框：行程与中心全部取自 prefab 里那个框本身，改位置也不用回头改常量。
        const left = this.createShineForFrame(this.frameLeft, 2, SHINE_SLOT_ALPHA, frame);
        if (left) this.shines.push(left);
        const right = this.createShineForFrame(this.frameRight, 3, SHINE_SLOT_ALPHA, frame);
        if (right) this.shines.push(right);
    }

    /** 按属性框自己（`Stats/LeftFrame` / `Stats/RightFrame`）的位置与宽度建一条带子。 */
    private createShineForFrame(
        frame: Sprite | null,
        index: number,
        alpha: number,
        shineFrame: SpriteFrame,
    ): IShineStreak | null {
        const node = frame?.node;
        if (!node || !node.isValid) return null;
        const transform = node.getComponent(UITransform);
        if (!transform) return null;
        const position = node.position;
        return this.createShine(
            node.parent, index, position.x, position.y,
            transform.width, transform.height, SHINE_SLOT_WIDTH, alpha, shineFrame);
    }

    /** 取节点高度（取不到就用兜底值），光带高度跟着目标区走。 */
    private heightOf(node: Node | null, fallback: number): number {
        const transform = node?.getComponent(UITransform);
        return transform && transform.height > 0 ? transform.height : fallback;
    }

    /**
     * 建一条光带，插在 `index` 位，扫过中心在父节点坐标系 `(centerX, centerY)` 处。
     *
     * 三条都插在「底框之上、文字之下」（进度条是 2、属性区也是 2/3）：
     * 刷光是**扫过**，盖在文字上会把数值糊掉；底下扫又看不见。
     */
    private createShine(
        parent: Node | null,
        index: number,
        centerX: number,
        centerY: number,
        width: number,
        height: number,
        streakWidth: number,
        alpha: number,
        frame: SpriteFrame,
    ): IShineStreak | null {
        if (!parent || !parent.isValid || !frame.isValid) return null;
        try {
            const node = new Node('Shine');
            node.layer = parent.layer;
            const nodeTransform = node.addComponent(UITransform);
            const sprite = node.addComponent(Sprite);
            sprite.spriteFrame = frame;
            // 尺寸必须走 CUSTOM：TRIMMED 会让节点跟着帧自带的裁剪尺寸变，光带宽度就不可控了。
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            nodeTransform.setContentSize(streakWidth, height);
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;
            parent.insertChild(node, Math.min(index, parent.children.length));
            node.setPosition(centerX, centerY, 0);
            return { node, opacity, centerX, centerY, travel: width + streakWidth + SHINE_BLEED * 2, alpha };
        } catch (error) {
            console.warn('[CardUpgradedPage] 刷光条创建失败，跳过刷光', error);
            return null;
        }
    }

    // ============================================================
    // 角色升级特效
    // ============================================================

    private async loadAnimationAssets(): Promise<void> {
        const [shine, fx] = await Promise.all([this.loadShineFrame(), this.loadFxPrefab()]);
        this.shineFrame = shine;
        this.fxPrefab = fx;
    }

    private loadShineFrame(): Promise<SpriteFrame | null> {
        return this.assets.load(SHINE_FRAME_PATH, SpriteFrame)
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 刷光条贴图加载失败，跳过刷光', error);
                return null;
            });
    }

    private loadFxPrefab(): Promise<Prefab | null> {
        return this.assets.load(FX_PREFAB_PATH, Prefab)
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 升级特效预制加载失败，跳过特效', error);
                return null;
            });
    }

    /**
     * 特效挂在**立绘的上一格**：压在角色身上，又还在其它板块（等级 / 属性 / 头部）下面，
     * 光柱往上涨的时候不会盖住文字。
     */
    private ensureHeroFx(): Node | null {
        if (this.heroFx && this.heroFx.isValid && this.heroFxPrefab === this.fxPrefab) return this.heroFx;
        if (this.heroFx && this.heroFx.isValid) this.heroFx.destroy();
        this.heroFx = null;
        this.heroFxPrefab = null;
        const prefab = this.fxPrefab;
        const heroNode = this.hero?.node;
        const host = heroNode?.parent;
        if (!prefab || !heroNode || !host || !heroNode.active) return null;
        try {
            const node = instantiate(prefab);
            host.insertChild(node, Math.min(heroNode.getSiblingIndex() + 1, host.children.length));
            const transform = heroNode.getComponent(UITransform);
            const position = heroNode.position;
            // 锚点 (0.5, 0) 的光柱立在角色脚下，再整体下移 `FX_DROP_PX`：
            // 光柱可见高 855.6 远大于立绘 426，不往下压就全飘在头顶（见常量处的推导）。
            const footY = position.y - (transform ? transform.height * transform.anchorY : 0);
            node.setPosition(position.x, footY - FX_DROP_PX, 0);
            node.active = false;
            this.heroFx = node;
            this.heroFxPrefab = prefab;
            return node;
        } catch (error) {
            console.warn('[CardUpgradedPage] 升级特效实例化失败，跳过特效', error);
            return null;
        }
    }

    /**
     * 起播特效；资源还没到 / 节点建不出来就返回 `false`（调用方据此决定门闩置不置位，
     * 下一帧再试）。例外是「节点建好了但上面没 Animation」—— 那是预制做错了，
     * 重试也不会变好，按已处理返回 `true`，别每帧都去查一遍。
     */
    private playHeroFx(): boolean {
        const node = this.ensureHeroFx();
        if (!node || !node.isValid) return false;
        node.active = true;
        const animation = node.getComponent(Animation);
        if (!animation) return true;
        try {
            animation.stop();
            animation.play();
        } catch (error) {
            console.warn('[CardUpgradedPage] 升级特效播放失败', error);
        }
        return true;
    }

    private resetHeroFx(): void {
        const node = this.heroFx;
        if (node && node.isValid && node.active) node.active = false;
    }

    /** 销毁随资源作用域一起走的节点（刷光条 + 升级特效）。 */
    private destroyAnimationVisuals(): void {
        this.unschedule(this.stepAnim);
        this.timeline = null;
        this.content = null;
        if (this.heroFx && this.heroFx.isValid) this.heroFx.destroy();
        this.heroFx = null;
        this.heroFxPrefab = null;
        for (const streak of this.shines) {
            if (streak.node.isValid) streak.node.destroy();
        }
        this.shines = [];
        this.shineFrame = null;
        this.fxPrefab = null;
    }
}

/** 比例收敛到 0..1；非法值（NaN / undefined）当 0 处理。 */
function clampRatio(value: number): number {
    if (!(value > 0)) return 0;
    return value >= 1 ? 1 : value;
}
