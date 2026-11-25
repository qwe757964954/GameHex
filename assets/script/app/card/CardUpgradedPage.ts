/**
 * 升级成功弹窗（`ui/card/CardUpgraded.prefab`）—— 渲染 + 表现时序。
 *
 * 2026-11-20 需求：「增加升级详情界面的 UI 表现动画」，按顺序串成一条时间轴
 * （曲线与关键节点在 `CardUpgradedTimeline`，本文件只负责**按时刻把值写进节点**）：
 *
 *   ① 入场：各块**同时**起播，各从屏幕的不同方向滑到自己的坐标
 *      （上部整体自上、左右属性框各自自左右、增益条自下）；
 *   ② 等级数字：放大到峰值时换成新数字，再带回弹落下；
 *   ③ 刷光：光柱扫过 + 角色本体叠一层发光颜色 + 进度条边缘发光（同一个 0→1），
 *      随后满格顿一拍、清空归零、绿色从左往右涨到下一级比例；
 *   ④ 角色升级特效：`CardUpgradeFx`（spine `ddz_cj_nextlevel`，1.0s）压在立绘上层，**与③同一拍**起播
 *      （2026-11-25 用户：「光效需要等待本体叠颜色同步播放」，原来它挂在「立绘落位」上）；
 *   ⑤ 属性数值：刷光结束 → 数值直接切换。
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
    Color,
    EffectAsset,
    instantiate,
    Label,
    Material,
    Node,
    Prefab,
    RichText,
    sp,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { CardUnitPreview } from './CardUnitPreview';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';
import {
    BAR_GLOW_ALPHA,
    HERO_GLOW_ALPHA,
    HERO_HALO_ALPHA,
    PROGRESS_BEAM_LAYERS,
    SLOT_BEAM_LAYERS,
    buildCardUpgradedSchedule,
    entranceDirectionAt,
    entranceOffsetAt,
    barGlowAt,
    heroGlowAt,
    levelScaleAt,
    progressPopScaleAt,
    progressRatioAt,
    progressZeroTextOf,
    shineOpacityAt,
    shineProgressAt,
    shineSweepAt,
    type ICardUpgradedSchedule,
    type IShineLayerSpec,
} from './CardUpgradedTimeline';

const { ccclass, property } = _decorator;

/** 设计稿英雄立绘高 426，骨骼 idle 也按这个可见高归一。 */
const HERO_VISIBLE_HEIGHT = 426;

/** 进度填充的满格宽度（= 底槽 442 - 两侧各 3 的内缩）。 */
const FILL_TRACK_WIDTH = 436;

/** 刷光条贴图：横向中间亮、两端全透明的白色光带（128×32）。 */
const SHINE_FRAME_PATH = 'image/card_effect_levelup/shine/spriteFrame';

/**
 * 柔光贴图：径向、中心亮四周淡（200×200）。
 *
 * 光柱最外层与「进度条边缘发光」「角色身后光晕」三处共用它 ——
 * `shine.png` 竖直方向没有渐变（整列都是 255），撑高只会得到一块硬边矩形，
 * 只有径向图撑起来才是软的。
 */
const GLOW_FRAME_PATH = 'image/showReward/sr_glow/spriteFrame';

/**
 * 「整只角色形状」的纯色剪影 shader（战斗里兵种外描边、领地宝箱变白同一份）。
 *
 * 只采样 alpha、输出顶点色 ⇒ 顶点色 = 纯色剪影，用它给角色叠一层发光颜色。
 */
const GLOW_COPY_SHADER_PATH = 'shaders/unit-outline-copy';

/** 角色本体发光的颜色：白中带一点绿黄（对着进度条那条绿：`#5CDF68` 的亮部 `#B0FFAA`）。 */
const HERO_GLOW_TINT = new Color(236, 255, 206, 255);
/** 角色身后光晕：更黄一档，和本体那层叠出「白芯 + 绿黄边」。 */
const HERO_HALO_TINT = new Color(168, 240, 110, 255);
/** 进度条边缘光的颜色（与光柱最外层同色，才像同一束光打出来的）。 */
const BAR_GLOW_TINT = new Color(150, 236, 96, 255);

/**
 * 升级特效预制（`ui/card/CardUpgradeFx`）：单节点 `sp.Skeleton`，
 * 骨骼为 `resources/skel/ddz_cj_nextlevel`，只有一条 1.0s 的动画、播 1 次。
 *
 * 2026-11-25：美术把旧的 15 帧序列帧（`007-2_run_loop_05..19`）换成了这套 spine。
 * 光爆中心比旧版低（落在角色脚下一圈），缩放 1.4 烘在 prefab 里，代码只管落位。
 */
const FX_PREFAB_PATH = 'ui/card/CardUpgradeFx';

/** 特效里的动画名（SkeletonData 里只有这一条，见 `ddz_cj_nextlevel.skel`）。 */
const FX_ANIMATION = 'ddz_cj_nextlevel';

/**
 * 特效起播时刻之后，还能再等资源多久（秒）。
 *
 * 资源现在与首帧并行加载（见 `onOpen`），可能比 `fxAt`（= 刷光那一拍，1.4s）晚到一点点。
 * 没到齐就不要把「已播过」的门闩置位，下一帧再试；但也不能一直空转 ——
 * 过了这个窗口就当这次没有特效（特效总时长 1.0s，再晚进度条已经开始清空了）。
 */
const FX_RETRY_WINDOW = 0.3;

/** 进度条刷光：光带越出目标区两端的余量（宽度与分层见 `PROGRESS_BEAM_LAYERS`）。 */
const SHINE_BLEED = 16;

/** 进度条所在容器（`Level/Progress`）的尺寸；光带按它算行程。 */
const PROGRESS_AREA_WIDTH = 450;

/**
 * 进度条边缘光的尺寸（宽 × 高）。
 *
 * 底条是 442×32 ⇒ 四周各外扩 19 / 16：外扩的那一圈就是「边缘在发光」，
 * 因为光层压在底条下面，只有露出底条轮廓外的那部分看得见。
 */
const BAR_GLOW_SIZE = { width: 480, height: 64 } as const;
/** 底条在容器里不是正中（442 装在 450 里，x = -3），光层跟着它走。 */
const BAR_GLOW_X = -3;

/** 角色身后光晕相对立绘尺寸的放大倍数。 */
const HERO_HALO_SCALE = 1.25;

/**
 * 升级特效相对「角色脚底」的下移量（逻辑 px）。
 *
 * 2026-11-25 换 spine 后重新推导（数值恰好仍是旧版的 70）：
 * `ddz_cj_nextlevel` 的骨架画布 275.755×600，Cocos 按 bounds 反算出锚点
 * **(0.4944, 0.1630)** —— 即节点原点只落在矩形高度的 16.3% 处，矩形中心在**原点上方**
 * 600×(0.5−0.163)=202.2。prefab 里烘了 1.4 倍缩放 ⇒ 中心上移 283。
 * 角色中心在脚上 213（立绘区 426 高、锚点居中），把特效矩形中心对到角色中心，
 * 节点就该落在 `foot + 213 − 283 = foot − 70`。
 *
 * 实拍（编辑器内按 0.2s / 0.4s 逐帧看）：光爆圆盘正好压在脚下一圈、上升的光丝盖住身体，
 * 不再像旧序列帧那样整根光柱飘在头顶。要整体上/下挪只改这一个数。
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

/** 光带里的一层：Sprite + 它自己的 `UIOpacity` + 分层规格（换作用域时要按规格重贴帧）。 */
interface IShineLayer {
    readonly sprite: Sprite;
    readonly opacity: UIOpacity;
    readonly spec: IShineLayerSpec;
}

/**
 * 一条刷光带：一个父节点（三层一起动）+ 各层自己的不透明度 + 框中心 + 行程。
 *
 * 2026-11-24 起光带可以是**多层同轴**（进度条那条是三层：绿黄外晕 / 淡黄绿 / 白热芯）：
 * 位移只写在父节点上（否则三层会各扫各的），亮度按层写 —— 层的相对亮度已经在 `sprite.color`
 * 里，这里再乘同一个包络 ⇒ 三层永远同一拍明灭。
 */
interface IShineStreak {
    readonly node: Node;
    /** 该框中心在父节点坐标系里的 x（光带只在这个中心两侧的行程内扫）。 */
    readonly centerX: number;
    readonly centerY: number;
    readonly travel: number;
    readonly layers: readonly IShineLayer[];
}

/** 升级成功弹窗：只渲染控制器给的数据；关闭走 PopupBase 的空白接收层。 */
@ccclass('CardUpgradedPage')
export class CardUpgradedPage extends PopupBase {
    static prefabPath = 'ui/card/CardUpgraded';

    private progressFillUi: UITransform | null = null;
    private heroPreview: CardUnitPreview | null = null;
    /**
     * 立绘在 prefab 里的**原位**（`onInit` 抓一次）。
     *
     * 光晕是立绘的兄弟节点、不跟着入场滑行 —— 所以要按原位摆，不能读 `hero.node.position`：
     * 资源晚到时立绘可能正滑在半路，读到的就是那个偏移值，光晕会永久错位。
     */
    private heroHome = { x: 0, y: 0 };

    // ---- 表现时序的运行时状态 ----
    private timeline: ICardUpgradedSchedule | null = null;
    private content: ICardUpgradedContent | null = null;
    private playAt = 0;
    private entranceBlocks: IEntranceBlock[] = [];
    private shines: IShineStreak[] = [];
    private shineFrame: SpriteFrame | null = null;
    private glowFrame: SpriteFrame | null = null;
    /** 「纯色剪影」材质（`GLOW_COPY_SHADER_PATH` 实例化出来的那份）；拿不到就不做本体发光。 */
    private glowMaterial: Material | null = null;
    /** 进度条边缘光（压在底条下面，露出来的一圈 = 边缘发光）。 */
    private barGlow: Node | null = null;
    private barGlowOpacity: UIOpacity | null = null;
    /** 角色身后的柔光光晕。 */
    private heroHalo: Node | null = null;
    private heroHaloOpacity: UIOpacity | null = null;
    /** 静态立绘兜底的剪影层（有骨骼时这一层不建）。 */
    private heroSpriteGlow: Node | null = null;
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
        const heroPosition = this.hero?.node?.position;
        if (heroPosition) {
            this.heroHome.x = heroPosition.x;
            this.heroHome.y = heroPosition.y;
        }
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
                // 边缘光 / 本体发光都吃柔光帧与剪影材质，资源到齐后才建得出来。
                this.ensureBarGlow();
                this.ensureHeroGlow();
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
     * 留在节点上的 SpriteFrame / SkeletonData 引用就成了悬空帧。
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
        // 光带 / 边缘光 / 本体发光都可能在首帧就缺资源（异步加载），三处都做惰性补建。
        this.ensureBarGlow();
        this.ensureHeroGlow();
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
        // 2026-11-24：角色本体与进度条边缘也吃**同一个**刷光进度，只是各自包络的进出占比更缓
        // （`heroGlowAt` / `barGlowAt`）—— 不是第二份时间轴。
        this.applyHeroGlow(heroGlowAt(shine));
        this.applyBarGlow(barGlowAt(shine));

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

    /** 刷光带：`progress` 为 `-1` 表示此刻没有刷光（只把各层亮度归零）。 */
    private applyShine(streak: IShineStreak, progress: number): void {
        if (!streak.node.isValid) return;
        if (progress < 0) {
            this.applyShineAlpha(streak, 0);
            return;
        }
        // 位移走「缓进快出」（`shineSweepAt`），亮度仍按线性时间淡入淡出 ——
        // 让光带先在框口拱进来、再甩出去，同时两端不会因为加速而被硬切。
        const swept = shineSweepAt(progress);
        const x = streak.centerX - streak.travel / 2 + streak.travel * swept;
        streak.node.setPosition(x, streak.centerY, 0);
        this.applyShineAlpha(streak, Math.round(255 * shineOpacityAt(progress)));
    }

    /** 把同一个亮度字节写到这条光带的每一层（层的相对亮度在 `sprite.color` 里，不用重算）。 */
    private applyShineAlpha(streak: IShineStreak, byte: number): void {
        for (const layer of streak.layers) {
            if (layer.opacity.isValid && layer.opacity.opacity !== byte) layer.opacity.opacity = byte;
        }
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
        // 本体发光 / 光晕 / 边缘光也是逐帧写的：收工必须归零，否则下次打开带着上一次的余辉。
        this.applyHeroGlow(0);
        this.applyBarGlow(0);
        for (const streak of this.shines) this.applyShineAlpha(streak, 0);
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
                for (const layer of streak.layers) {
                    const next = this.frameOfSpec(layer.spec);
                    if (next && layer.sprite.isValid && layer.sprite.spriteFrame !== next) layer.sprite.spriteFrame = next;
                }
            }
            return;
        }
        // 进度条：居中扫过整条 450 宽的槽，三层同轴（绿黄外晕 → 白热芯）。
        const bar = this.createShine(
            this.progressRoot, 2, 0, 0,
            PROGRESS_AREA_WIDTH, this.heightOf(this.progressRoot, 45),
            PROGRESS_BEAM_LAYERS);
        if (bar) this.shines.push(bar);
        // 属性框：行程与中心全部取自 prefab 里那个框本身，改位置也不用回头改常量。
        const left = this.createShineForFrame(this.frameLeft, 2);
        if (left) this.shines.push(left);
        const right = this.createShineForFrame(this.frameRight, 3);
        if (right) this.shines.push(right);
    }

    /** 分层规格 → 贴图；柔光帧没加载到就退回白光带（「渐变」降级成单色，但刷光本身不能消失）。 */
    private frameOfSpec(spec: IShineLayerSpec): SpriteFrame | null {
        if (spec.frame === 'glow' && this.glowFrame?.isValid) return this.glowFrame;
        return this.shineFrame?.isValid ? this.shineFrame : null;
    }

    /** 按属性框自己（`Stats/LeftFrame` / `Stats/RightFrame`）的位置与宽度建一条带子。 */
    private createShineForFrame(frame: Sprite | null, index: number): IShineStreak | null {
        const node = frame?.node;
        if (!node || !node.isValid) return null;
        const transform = node.getComponent(UITransform);
        if (!transform) return null;
        const position = node.position;
        return this.createShine(
            node.parent, index, position.x, position.y,
            transform.width, transform.height, SLOT_BEAM_LAYERS);
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
     *
     * 分层（2026-11-24）：每层是父节点的一个子 Sprite，尺寸与色相各自不同、中心都在父节点原点；
     * 位移与亮度只写在父节点上 ⇒ 三层永远同轴、同步，不可能「各层扫各层的」。
     * 层的色相走 `Sprite.color` 的 rgb、层的相对亮度走它的 a，父层的 `UIOpacity` 再乘包络。
     */
    private createShine(
        parent: Node | null,
        index: number,
        centerX: number,
        centerY: number,
        width: number,
        height: number,
        specs: readonly IShineLayerSpec[],
    ): IShineStreak | null {
        if (!parent || !parent.isValid) return null;
        try {
            const node = new Node('Shine');
            node.layer = parent.layer;
            node.addComponent(UITransform);
            const layers: IShineLayer[] = [];
            for (const spec of specs) {
                const frame = this.frameOfSpec(spec);
                if (!frame) continue;
                const layerNode = new Node(spec.frame);
                layerNode.layer = parent.layer;
                const transform = layerNode.addComponent(UITransform);
                const sprite = layerNode.addComponent(Sprite);
                sprite.spriteFrame = frame;
                // 尺寸必须走 CUSTOM：TRIMMED 会让节点跟着帧自带的裁剪尺寸变，光带宽度就不可控了。
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.type = Sprite.Type.SIMPLE;
                const layerHeight = spec.height === 'area' ? height : spec.height;
                transform.setContentSize(spec.width, layerHeight);
                sprite.color = new Color(spec.rgb[0], spec.rgb[1], spec.rgb[2], Math.round(255 * spec.alpha));
                // 每层一个 `UIOpacity`：父节点不挂 —— 三层各自明灭，不依赖 UIOpacity 的父子继承。
                const layerOpacity = layerNode.addComponent(UIOpacity);
                layerOpacity.opacity = 0;
                layerNode.setParent(node);
                layerNode.setPosition(0, 0, 0);
                layers.push({ sprite, opacity: layerOpacity, spec });
            }
            if (layers.length === 0) {
                node.destroy();
                return null;
            }
            parent.insertChild(node, Math.min(index, parent.children.length));
            node.setPosition(centerX, centerY, 0);
            // 行程按**最宽那层**算：窄层要跟着宽层一起进出框，否则两端会看到内层先出现。
            const streakWidth = specs.reduce((widest, spec) => Math.max(widest, spec.width), 0);
            return { node, centerX, centerY, travel: width + streakWidth + SHINE_BLEED * 2, layers };
        } catch (error) {
            console.warn('[CardUpgradedPage] 刷光条创建失败，跳过刷光', error);
            return null;
        }
    }

    // ============================================================
    // 进度条边缘发光 / 角色本体发光（2026-11-24）
    // ============================================================

    /**
     * 进度条边缘光：一张径向柔光**压在底条下面**，比底条大一圈。
     *
     * 底条是不透明的，所以只有露出轮廓外的那一圈看得见 —— 那就是「边缘在发光」，
     * 不用额外做描边。插在 0 位（底条之前）才在它下面。
     */
    private ensureBarGlow(): void {
        const frame = this.glowFrame;
        const parent = this.progressRoot;
        if (!frame || !frame.isValid || !parent || !parent.isValid) return;
        if (this.barGlow && this.barGlow.isValid) {
            const sprite = this.barGlow.getComponent(Sprite);
            if (sprite && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
            return;
        }
        try {
            const node = new Node('BarGlow');
            node.layer = parent.layer;
            const transform = node.addComponent(UITransform);
            const sprite = node.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.color = new Color(BAR_GLOW_TINT.r, BAR_GLOW_TINT.g, BAR_GLOW_TINT.b, 255);
            transform.setContentSize(BAR_GLOW_SIZE.width, BAR_GLOW_SIZE.height);
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;
            parent.insertChild(node, 0);
            node.setPosition(BAR_GLOW_X, 0, 0);
            this.barGlow = node;
            this.barGlowOpacity = opacity;
        } catch (error) {
            console.warn('[CardUpgradedPage] 进度条边缘光创建失败，跳过', error);
        }
    }

    /** 写进度条边缘光的亮度（0..1）；0 时干脆停掉这一层。 */
    private applyBarGlow(value: number): void {
        const node = this.barGlow;
        const opacity = this.barGlowOpacity;
        if (!node || !node.isValid || !opacity || !opacity.isValid) return;
        const level = value > 0 ? (value >= 1 ? 1 : value) : 0;
        const visible = level > 0.004;
        if (node.active !== visible) node.active = visible;
        const byte = Math.round(255 * BAR_GLOW_ALPHA * level);
        if (opacity.opacity !== byte) opacity.opacity = byte;
    }

    /**
     * 角色本体发光：两层。
     *
     * ① 本体那一层是**纯色剪影副本**（`CardUnitPreview.attachGlow`，同 prefab、放大 3.5%、
     *    挂 `unit-outline-copy`）—— 骨架自己的顶点色只能压暗，亮不起来，只能另起一层盖上去；
     * ② 身后再垫一张径向柔光，把角色从背景里托出来（只有剪影会像「换了个白色贴图」，加光晕才像发光）。
     *
     * 静态立绘兜底：没有骨骼时用同一张立绘 + 同一份材质做剪影（素材路径不同、观感一致）。
     */
    private ensureHeroGlow(): void {
        const heroNode = this.hero?.node;
        if (!heroNode || !heroNode.isValid) return;
        const material = this.glowMaterial;
        if (material) {
            if (!this.heroPreview?.attachGlow(material, HERO_GLOW_TINT)) this.ensureHeroSpriteGlow(material);
        }
        this.ensureHeroHalo();
    }

    /** 静态立绘（没有骨骼 prefab）时的剪影层：同一张图 + 同一份材质 + 放大 3.5%。 */
    private ensureHeroSpriteGlow(material: Material): void {
        const hero = this.hero;
        const heroNode = hero?.node;
        if (!heroNode || !heroNode.isValid || !hero.spriteFrame) return;
        const transform = heroNode.getComponent(UITransform);
        const existing = this.heroSpriteGlow?.isValid ? this.heroSpriteGlow : null;
        if (existing) {
            const sprite = existing.getComponent(Sprite);
            if (sprite) {
                sprite.spriteFrame = hero.spriteFrame;
                sprite.customMaterial = material;
            }
            return;
        }
        const node = new Node('HeroGlow');
        node.layer = heroNode.layer;
        const nodeTransform = node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.spriteFrame = hero.spriteFrame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.customMaterial = material;
        sprite.color = new Color(HERO_GLOW_TINT.r, HERO_GLOW_TINT.g, HERO_GLOW_TINT.b, 255);
        if (transform) nodeTransform.setContentSize(transform.width, transform.height);
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 0;
        node.setParent(heroNode);
        node.setScale(1.035, 1.035, 1);
        node.setPosition(0, 0, 0);
        node.active = false;
        this.heroSpriteGlow = node;
    }

    /** 角色身后的柔光光晕：垫在立绘**前一格**（在立绘下面、其它板块更下面）。 */
    private ensureHeroHalo(): void {
        const frame = this.glowFrame;
        const heroNode = this.hero?.node;
        const host = heroNode?.parent;
        if (!frame || !frame.isValid || !heroNode || !host) return;
        const transform = heroNode.getComponent(UITransform);
        if (!transform) return;
        const width = transform.width * HERO_HALO_SCALE;
        const height = transform.height * HERO_HALO_SCALE;
        if (this.heroHalo && this.heroHalo.isValid) {
            const haloTransform = this.heroHalo.getComponent(UITransform);
            if (haloTransform) haloTransform.setContentSize(width, height);
            const sprite = this.heroHalo.getComponent(Sprite);
            if (sprite && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
            this.heroHalo.setPosition(this.heroHome.x, this.heroHome.y, 0);
            return;
        }
        try {
            const node = new Node('HeroHalo');
            node.layer = heroNode.layer;
            const nodeTransform = node.addComponent(UITransform);
            const sprite = node.addComponent(Sprite);
            sprite.spriteFrame = frame;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.color = new Color(HERO_HALO_TINT.r, HERO_HALO_TINT.g, HERO_HALO_TINT.b, 255);
            nodeTransform.setContentSize(width, height);
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;
            host.insertChild(node, Math.min(heroNode.getSiblingIndex(), host.children.length));
            node.setPosition(this.heroHome.x, this.heroHome.y, 0);
            this.heroHalo = node;
            this.heroHaloOpacity = opacity;
        } catch (error) {
            console.warn('[CardUpgradedPage] 角色光晕创建失败，跳过', error);
        }
    }

    /** 写本体剪影 + 光晕的亮度（2026-11-24：都吃同一个刷光进度，包络见 `heroGlowAt`）。 */
    private applyHeroGlow(value: number): void {
        const level = value > 0 ? (value >= 1 ? 1 : value) : 0;
        this.heroPreview?.setGlowAlpha(HERO_GLOW_ALPHA * level);
        const spriteGlow = this.heroSpriteGlow;
        if (spriteGlow && spriteGlow.isValid) {
            const visible = HERO_GLOW_ALPHA * level > 0.004;
            if (spriteGlow.active !== visible) spriteGlow.active = visible;
            const opacity = spriteGlow.getComponent(UIOpacity);
            if (opacity) {
                const byte = Math.round(255 * HERO_GLOW_ALPHA * level);
                if (opacity.opacity !== byte) opacity.opacity = byte;
            }
        }
        const halo = this.heroHalo;
        const haloOpacity = this.heroHaloOpacity;
        if (halo && halo.isValid && haloOpacity && haloOpacity.isValid) {
            const visible = HERO_HALO_ALPHA * level > 0.004;
            if (halo.active !== visible) halo.active = visible;
            const byte = Math.round(255 * HERO_HALO_ALPHA * level);
            if (haloOpacity.opacity !== byte) haloOpacity.opacity = byte;
        }
    }

    // ============================================================
    // 角色升级特效
    // ============================================================

    private async loadAnimationAssets(): Promise<void> {
        const [shine, glow, fx, effect] = await Promise.all([
            this.loadShineFrame(),
            this.loadGlowFrame(),
            this.loadFxPrefab(),
            this.loadGlowEffect(),
        ]);
        this.shineFrame = shine;
        this.glowFrame = glow;
        this.fxPrefab = fx;
        this.glowMaterial = effect ? this.createGlowMaterial(effect) : null;
    }

    private loadShineFrame(): Promise<SpriteFrame | null> {
        return this.assets.load(SHINE_FRAME_PATH, SpriteFrame)
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 刷光条贴图加载失败，跳过刷光', error);
                return null;
            });
    }

    /** 柔光帧（光柱外晕 / 边缘光 / 角色光晕共用）；拿不到就只掉「渐变」与两处光晕。 */
    private loadGlowFrame(): Promise<SpriteFrame | null> {
        return this.assets.load(GLOW_FRAME_PATH, SpriteFrame)
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 柔光贴图加载失败，发光降级为单色', error);
                return null;
            });
    }

    private loadGlowEffect(): Promise<EffectAsset | null> {
        return this.assets.load(GLOW_COPY_SHADER_PATH, EffectAsset)
            .catch((error: unknown) => {
                console.warn('[CardUpgradedPage] 剪影 shader 加载失败，跳过角色本体发光', error);
                return null;
            });
    }

    /** 每份材质各自持有（三个分段同时在屏上时不能共用同一个 `Material` 实例）。 */
    private createGlowMaterial(effect: EffectAsset): Material | null {
        try {
            const material = new Material();
            material.initialize({ effectAsset: effect });
            return material;
        } catch (error) {
            console.warn('[CardUpgradedPage] 剪影材质创建失败，跳过角色本体发光', error);
            return null;
        }
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
     * 光爆往上涨的时候不会盖住文字。
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
            // 特效原点不在矩形中心（spine 的 bounds 反算出锚点 0.4944/0.1630），
            // 所以先落到角色脚底，再整体下移 `FX_DROP_PX` 把光爆压到脚下一圈（见常量处推导）。
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
     * 下一帧再试）。例外是「节点建好了但上面没 `sp.Skeleton`」—— 那是预制做错了，
     * 重试也不会变好，按已处理返回 `true`，别每帧都去查一遍。
     */
    private playHeroFx(): boolean {
        const node = this.ensureHeroFx();
        if (!node || !node.isValid) return false;
        node.active = true;
        const skeleton = node.getComponent(sp.Skeleton);
        if (!skeleton) {
            console.warn('[CardUpgradedPage] 升级特效预制缺少 sp.Skeleton，跳过特效');
            return true;
        }
        try {
            // 同一条轨道上重设即从头播（`setAnimation` 会替换 track 0），不用先 stop。
            skeleton.setAnimation(0, FX_ANIMATION, false);
        } catch (error) {
            console.warn('[CardUpgradedPage] 升级特效播放失败', error);
        }
        return true;
    }

    private resetHeroFx(): void {
        const node = this.heroFx;
        if (node && node.isValid && node.active) node.active = false;
    }

    /** 销毁随资源作用域一起走的节点（刷光条 + 边缘光 + 光晕 + 升级特效）。 */
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
        if (this.barGlow && this.barGlow.isValid) this.barGlow.destroy();
        this.barGlow = null;
        this.barGlowOpacity = null;
        if (this.heroHalo && this.heroHalo.isValid) this.heroHalo.destroy();
        this.heroHalo = null;
        this.heroHaloOpacity = null;
        // 剪影副本挂在立绘下，跟着 `heroPreview` 一起收；材质是本次打开的作用域产物，一并丢掉。
        this.heroPreview?.clearGlow();
        if (this.heroSpriteGlow && this.heroSpriteGlow.isValid) this.heroSpriteGlow.destroy();
        this.heroSpriteGlow = null;
        this.shineFrame = null;
        this.glowFrame = null;
        this.glowMaterial = null;
        this.fxPrefab = null;
    }
}

/** 比例收敛到 0..1；非法值（NaN / undefined）当 0 处理。 */
function clampRatio(value: number): number {
    if (!(value > 0)) return 0;
    return value >= 1 ? 1 : value;
}
