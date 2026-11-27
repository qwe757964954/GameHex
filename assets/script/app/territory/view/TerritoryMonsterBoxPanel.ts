/**
 * 「巡逻宝箱」弹窗 —— 领地地图上野怪宝箱格的详情与升级入口面板。
 *
 * 三态（设计稿左中右三张）：
 * - `Lv.1~3`：等级星 + 守护怪 + 奖励 + 「开始挑战 / 升级宝箱」两个按钮，**升级为主、打为次**；
 * - 升级中：等级星不动，下一个空槽里演虚影呼吸（`upgrading = true` 或本地摇奖中），两个按钮都不可点；
 * - 满级：等级星全亮、守护怪全部点亮，只剩「开始挑战」（`upgradeCost = 0` ⇒ 升级按钮收起来）。
 *
 * ## 只做渲染，不做业务
 *
 * 所有数字都从 {@link ITerritoryMonsterBoxContent} 进来，**脚本里一个都不推算**：
 * 消耗、成功率、失败次数上限、守护怪解锁条件、奖励区间 —— 协议目前只下发 `lv`
 * （`CmdCityChapterCellInfoRspMsg.monsterBoxInfos`），其余要等配置 / 下发。
 * 缺数据时**整块隐藏**而不是显示 0：「没有数据」和「数值是 0」在界面上必须能区分开。
 *
 * ## 升级摇奖动画（2026-11-24 改版，替代 11-22 的进度条）
 *
 * 点「升级宝箱」→ **不再有进度条**，动画直接演在等级星的空槽与宝箱上：
 *
 * 1. 下一个空槽里出现**星星虚影**，放大缩小 + 明暗呼吸（一次呼吸 1.2s 逐渐拉长到 2.5s）；
 * 2. 同时**宝箱左右晃动**，并**逐渐叠上一层纯白**（越来越白）；
 * 3. 回包到了：成功 ⇒ 换下一等级宝箱图、白色褪回；失败 ⇒ 白褪回、图不变。
 *
 * 曲线（含迟到的回包怎么处理）全在 `model/TerritoryMonsterBoxRoll`（零 `cc`、可单测）；
 * 这里只做四件事：把姿态写进虚影缩放/透明度、宝箱坐标、白色叠层透明度，以及在
 * `revealing` 那一拍换图。
 *
 * 动画从**点击**起演（玩家立刻看到反馈），落点等回包：`upgradeAttempt.seq` 比开演时更大
 * 才算这一轮的结果 —— 换格子 / 连点 / 重开弹窗都不会重放旧结果。
 *
 * ## 数字反馈（2026-11-25）：概率滚动 + 奖励数字刷光
 *
 * 升级成功会把面板换成下一级的内容，两个数字会变，各给一条过渡：
 *
 * 1. **成功率**（`90% → 60%`）：不是直接跳数，而是从旧值**滚过去**（0.36s，`outCubic`），
 *    并给 Label 一点弹（`sin(πt)`）。**只在值真的变了才演** —— `applyContent` 会被同一份内容
 *    重复调用，不 diff 就会「每次重绘都闪一下」（判据是 `shownRate`）。
 * 2. **奖励数字**（`300+100 → 400+100`）：一条白色光带扫过那一格（0.46s，缓进快出 + 梯形包络）。
 *    光带尺寸/行程**全部按该格数字 Label 的 `UITransform` 反算**，挂在 Label 的父节点、
 *    插在 Label 之前（文字之下）。同样只由「同一种资源 + 文案变了」触发。
 *
 * 两条曲线都在 `model/TerritoryMonsterBoxFx`（零 `cc`、可单测），这里只逐帧写节点。
 *
 * ## 升级成功的提示 = spine「升级成功」（2026-11-25）
 *
 * 成功那一刻**不再弹 toast**，改成在屏幕正中播一次字特效：预制
 * `ui/territory/TerritoryMonsterBoxUpgradeFx`（单节点 `sp.Skeleton`，指向
 * `skel/UI升级升星升阶特效字/shengduan` 的 `shengji`）。三条口径：
 *
 * 1. **播一次**：`setAnimation(0, 'shengji', false)`，播完（素材 1.07s）把节点
 *    `active = false` —— 字特效会停在最后一帧，不收起来就一直糊在屏幕中间；
 * 2. **屏正中**：挂在弹窗根节点（720×1280、锚点 0.5/0.5）的 `(0, 0)` 并排到兄弟最后
 *    ⇒ 压在 `Dim` / `Panel` 之上。弹窗本身就是全屏居中的，不用再做坐标换算；
 * 3. **失败不播**：失败仍是 toast（文案归 Model），`shengji` 只表达「成功了」。
 *
 * 预制/动画名/时长单点登记在 {@link UPGRADE_FX_PREFAB_PATH} 与
 * `TERRITORY_MONSTER_BOX_FX.upgradeFxSeconds`，视图不写第二份。
 *
 * ## 结构约定（prefab 由 `TerritoryMonsterBoxPanel` 保证，别在别处复制这个约定）
 *
 * - `LevelStars`：子节点 `StarOn_i` / `StarOff_i` 按 1..N 级叠放，按 `lv` 显隐，不换帧；
 * - `GuardRow/Guard_i`：每格固定子节点 `CardBg` / `LockBg` / `Icon`(cc.Sprite) / `Lock`(Node) / `UnlockLabel`(cc.Label)；
 * - `RewardSection/RewardRow`：四列虚拟列表，奖励卡复用公共 `RewardItemView`；
 * - `ChestModel`：宝箱 Sprite，白化叠层（`ChestWhite`）是它的运行时子节点；
 * - `StarGhost`：虚影节点，运行时建在 `LevelStars` 下，开演时挪到目标空槽位置；
 * - `NumShine`：奖励数字光带，运行时建在**数字 Label 的父节点**下（每格一条，随槽位复用重建）。
 */
import {
    _decorator,
    Button,
    Color,
    instantiate,
    Label,
    Material,
    Node,
    Prefab,
    sp,
    Sprite,
    SpriteFrame,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { EventMgr } from '../../../framework/event/EventMgr';
import { AudioMgr } from '../../../framework/audio/AudioMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import { GAME_AUDIO } from '../../ResConst';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
import { TerritoryUiEvent } from '../application/TerritoryEvents';
import type { ITerritoryMonsterBoxAttempt } from '../model/TerritoryMonsterBoxDetail';
import {
    monsterBoxRatePunchAt,
    monsterBoxRateRollAt,
    monsterBoxShineAlphaAt,
    monsterBoxShineBandOf,
    monsterBoxShineProgressAt,
    monsterBoxShineXAt,
    TERRITORY_MONSTER_BOX_FX,
} from '../model/TerritoryMonsterBoxFx';
import {
    monsterBoxRollPose,
    TERRITORY_MONSTER_BOX_ROLL,
    type ITerritoryMonsterBoxRollPose,
} from '../model/TerritoryMonsterBoxRoll';
import { TERRITORY_THEME_TOKENS } from './TerritoryTheme';
import { TerritoryMonsterBoxGuardSlot, type ITerritoryMonsterBoxGuard } from './TerritoryMonsterBoxGuardSlot';

export type { ITerritoryMonsterBoxGuard };

const { ccclass, property } = _decorator;

/** 弹窗内容。字段缺省（`0` / 空数组 / `null`）一律解释为「没有这项数据」，UI 自动收起来。 */
export interface ITerritoryMonsterBoxContent {
    /** 这一格的格子号（协议 `monsterBoxInfos[].cellId`）：升级请求要原样带回去。 */
    readonly cellId: number;
    readonly title: string;
    /** 当前等级（协议 `monsterBoxInfos[].lv`）。 */
    readonly lv: number;
    /** 等级上限；`<= 0` ⇒ 不知道上限，等级星只画到 `lv`。 */
    readonly maxLv: number;
    /** 宝箱模型图（按 `lv` 取 `territory_monsterBox_L{N}`，由页面加载后透传）。 */
    readonly chestIcon: SpriteFrame | null;
    readonly guards: readonly ITerritoryMonsterBoxGuard[];
    readonly rewards: readonly IRewardItemData[];
    /** 升级消耗（银币）；`<= 0` ⇒ 没有升级入口（满级 / 未开放）。 */
    readonly upgradeCost: number;
    /** 消耗图标；`null` ⇒ 只显示数字。 */
    readonly costIcon: SpriteFrame | null;
    /** 成功率（百分比，`90` ⇒ 90%）；`<= 0` ⇒ 不显示。 */
    readonly successRate: number;
    /** 已失败次数；`< 0` 表示服务端未提供。 */
    readonly failCount: number;
    /** 失败次数上限；`<= 0` ⇒ 不知道上限，不判「达上限」。 */
    readonly failLimit: number;
    readonly battleCaption: string;
    readonly battleEnabled: boolean;
    /** 升级按钮文案（如「升级宝箱」）。 */
    readonly upgradeCaption: string;
    /** 底部说明（如「升级为主，打为次」/「灰怪点亮，只可打开」）；空串 = 隐藏。 */
    readonly footerText: string;
    /** 升级进度态：`true` 时星槽静止、两个按钮都置灰（设计稿中间那张）。 */
    readonly upgrading?: boolean;
    /** 服务端下发的升级进度 0~1。**面板已不再展示进度条**，保留字段供别处读。 */
    readonly upgradeProgress?: number;
    /** 最近一次升级摇奖的结果（决定换成新等级宝箱还是原样褪白）；缺省 = 还没摇过。 */
    readonly upgradeAttempt?: ITerritoryMonsterBoxAttempt | null;
    /**
     * 宝箱「变白」叠层用的材质（巡逻怪描边那份 `shaders/unit-outline-copy`：
     * 只采样 alpha、输出顶点色 ⇒ 白 tint 就是**纯白剪影**）。
     * 缺省 / `null` ⇒ 不叠白层，只演虚影呼吸与晃动（降级不崩）。
     */
    readonly whiteMaskMaterial?: Material | null;
}

/**
 * 按钮不可用时的压色。
 *
 * `Button.interactable = false` 只挡点击、**不改外观**（本弹窗三个按钮都是 SCALE 过渡，
 * 没有 disabled 贴图），所以「升级中按钮要看得出来不能点」得自己在 Sprite 上压一层灰。
 */
const BTN_DIM = TERRITORY_THEME_TOKENS.buttonDim;
const FAIL_LIMIT_LABEL = '失败上限';
/** 运行时建的白色叠层节点名（重复开演时按名复用/清理）。 */
const CHEST_WHITE_NAME = 'ChestWhite';
/** 运行时建的星星虚影节点名。 */
const STAR_GHOST_NAME = 'StarGhost';
/** 运行时建的数字刷光带节点名（每格一条，跟着奖励格复用）。 */
const NUM_SHINE_NAME = 'NumShine';
/**
 * 数字刷光贴图：与卡牌升级页同一条白色光带（横向中间亮、两端全透明，128×32）。
 *
 * 走 `bundleForPath` 自动路由 —— 图在 `main-pages` 分包（见 `BundleCatalog`），
 * 面板自己在首包 `resources`，不带 bundle 会直接 `doesn't contain`。
 */
const SHINE_FRAME_PATH = 'image/card_effect_levelup/shine/spriteFrame';

/**
 * 升级成功特效预制（单节点 `sp.Skeleton`，见 `tools/build_monster_box_upgrade_fx.py`）。
 *
 * 与面板同在首包 `resources`，不带 bundle 也能加载（`bundleForPath` 返回 `undefined`
 * ⇒ 落到 `resources`）。
 */
const UPGRADE_FX_PREFAB_PATH = 'ui/territory/TerritoryMonsterBoxUpgradeFx';

/**
 * 特效里播哪条动画。
 *
 * `shengduan.skel` 一个文件里有三条（`shengji` 升级 / `shengjie` 升阶 / `shengxing` 升星，
 * 各 1.07s），这里要的是「升级成功」。
 */
const UPGRADE_FX_ANIMATION = 'shengji';

/** 升级摇奖的播放状态（只在视图里活，不进 Model）。 */
interface IMonsterBoxRollPlayback {
    /** 正在演哪一格（回包要认格子）。 */
    readonly cellId: number;
    /** 开演时已经收到的 attempt 序号：只有**更大**的才算这一轮的结果。 */
    readonly fromSeq: number;
    /** 闪哪一颗星槽（0-based，= 当前等级；即下一颗空槽）。 */
    readonly starIndex: number;
    /** 开演时刻（`performance.now()`，毫秒）。 */
    readonly startedAt: number;
    /** 结果到达时刻（秒，相对开演）；`null` = 还没回来。 */
    resultAt: number | null;
    success: boolean | null;
    /** 已经换过新等级宝箱图了（`revealing` 只切一次）。 */
    revealed: boolean;
}

/**
 * 一条正在扫的奖励数字光带（视图态，不进 Model）。
 *
 * 按**奖励格下标**登记而不是按节点：列表槽位会被回收复用，节点换了带子要跟着换
 * （见 `ensureShineNode`），但「第 2 格在刷光」这件事不能丢。
 */
interface IMonsterBoxShinePlay {
    readonly index: number;
    /** 开演时刻（`performance.now()`，毫秒）。 */
    readonly startedAt: number;
    /** 光带挂在哪个节点下 —— 数字 Label 的父节点（插在 Label 之前 = 文字之下）。 */
    target: Node | null;
    node: Node | null;
    sprite: Sprite | null;
    opacity: UIOpacity | null;
}

/** 一格奖励的「身份」：资源 + 数量文案，用来判断这次重绘该不该刷光。 */
interface IMonsterBoxRewardSignature {
    readonly resId: number;
    readonly text: string;
}

/**
 * 巡逻宝箱弹窗。
 *
 * 与 `LevelInfoPanel` 同一套骨架（`PopupBase` + 四边 Widget + `closeOnBlank`），
 * 差别只有内容区：模型 / 等级星 / 守护怪是本弹窗独有，奖励区复用公共 `RewardItem`。
 */
@ccclass('TerritoryMonsterBoxPanel')
export class TerritoryMonsterBoxPanel extends PopupBase {
    /** 预制体路径。 */
    static prefabPath = 'ui/territory/TerritoryMonsterBoxPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：标题' })
    private titleLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Panel/ChestModel：宝箱模型（按等级换帧）' })
    private chestSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/LevelLabel：Lv.N' })
    private levelLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/LevelStars：等级星容器（空槽里演虚影）' })
    private levelStars: Node = null!;

    @property({ type: [Sprite], group: '节点引用', tooltip: 'LevelStars/StarOn_i：已点亮星（按 1..N 级顺序）' })
    private starOn: Sprite[] = [];

    @property({ type: [Sprite], group: '节点引用', tooltip: 'LevelStars/StarOff_i：未点亮星（按 1..N 级顺序）' })
    private starOff: Sprite[] = [];

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/GuardRow：守护怪容器（每格 CardBg/LockBg/Icon/Lock/UnlockLabel）' })
    private guardRoot: Node = null!;

    @property({ type: [TerritoryMonsterBoxGuardSlot], group: '节点引用', tooltip: 'Panel/GuardRow：守护怪格列表（每格独立绑定头像/锁/解锁文案）' })
    private guardSlots: TerritoryMonsterBoxGuardSlot[] = [];

    @property({ type: Node, group: '节点引用', tooltip: 'Panel/RewardSection：奖励说明、底板与列表' })
    private rewardSection: Node = null!;

    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'RewardSection/RewardRow：四列奖励卡' })
    private rewardList: VirtualScrollView = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/CloseBtn：关闭' })
    private closeButton: Button = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnBattle：开始挑战' })
    private battleButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnBattle/Label：按钮文案' })
    private battleLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/BtnUpgrade：升级宝箱' })
    private upgradeButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/Label：按钮文案' })
    private upgradeLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'BtnUpgrade/CostIcon：消耗图标' })
    private costIcon: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/CostLabel：消耗数字' })
    private costLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BtnUpgrade/RateGroup/RateLabel：成功率' })
    private rateLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BtnUpgrade/RateGroup：成功率整块（底色 + 数字 + 说明）' })
    private rateGroup: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FailLabel：失败次数' })
    private failLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/FooterLabel：底部说明（可选）' })
    private footerLabel: Label | null = null;

    /** 本趟奖励（ 按下标现取，别在回调里闭包捕获某一趟的数据）。 */
    private rewards: readonly IRewardItemData[] = [];

    /** 当前内容，供按钮回调读「这一格是哪一格」。 */
    private content: ITerritoryMonsterBoxContent | null = null;

    /**
     * 正在演的升级摇奖；`null` = 没在演。
     *
     * 演的时候**不接整块重绘**（回包会带来新等级，重绘会把刚换上的宝箱拆回旧等级）：
     * 内容先落到 {@link pendingContent}，演完再一次性重绘。
     */
    private roll: IMonsterBoxRollPlayback | null = null;

    /** 演摇奖期间收到的最新内容；演完用它收尾重绘。 */
    private pendingContent: ITerritoryMonsterBoxContent | null = null;

    /** 星星虚影（运行时建在 `LevelStars` 下，位置每轮挪到目标空槽）。 */
    private starGhost: Node | null = null;
    private starGhostSprite: Sprite | null = null;
    private starGhostOpacity: UIOpacity | null = null;

    /** 宝箱白色叠层（运行时建在 `ChestModel` 下，跟进父节点的晃动）。 */
    private chestWhite: Sprite | null = null;
    private chestWhiteOpacity: UIOpacity | null = null;

    /** 变白叠层材质（随 content 进来；缺省时只演呼吸与晃动）。 */
    private whiteMaskMaterial: Material | null = null;

    /** 两个按钮并排时「开始挑战」的初始 x；满级只剩一个按钮时回到 0 居中（见 `renderButtons`）。 */
    private battleHomeX = 0;

    /**
     * 屏上正在显示的成功率（`-1` = 没显示 / 刚开面板）。
     *
     * 不能只看 `content.successRate`：过渡期间 Label 上写的是中间值，
     * 只有记住「从哪个数滚出来的」才能区分「值变了要演」和「同一份内容被重绘」。
     */
    private shownRate = -1;

    /** 成功率滚动：`null` = 没在演。 */
    private rateRoll: { readonly from: number; readonly to: number; readonly startedAt: number } | null = null;

    /** 上一趟每格奖励的身份（资源 + 文案），用于 diff 出「哪一格的数字变了」。 */
    private rewardSignatures: IMonsterBoxRewardSignature[] = [];

    /** 正在扫的奖励数字光带（每格最多一条）。 */
    private rewardShines: IMonsterBoxShinePlay[] = [];

    /** 数字刷光贴图（随面板开放周期加载，拿不到就整段不刷——数字与概率过渡照常）。 */
    private shineFrame: SpriteFrame | null = null;
    private shineLoaded = false;

    /** 升级成功字特效预制（随面板开放周期加载；拿不到就只少一场演出，等级与宝箱照常切）。 */
    private upgradeFxPrefab: Prefab | null = null;
    private upgradeFxLoaded = false;

    /** 屏正中的字特效节点（首次需要时才建，之后复用）。 */
    private upgradeFx: Node | null = null;

    /** 字特效该收起来的时刻（`performance.now()` 毫秒）；`0` = 没在演。 */
    private upgradeFxHideAt = 0;

    /**
     * 正在关闭。
     *
     * 关闭会走 `onClose → abortRoll → notifyRollSettled`（结果早就回来了要照报），
     * 但这时候起演字特效毫无意义：节点几帧后跟着弹窗一起销毁，只会闪一下。
     */
    private closing = false;

    /** 宝箱常态 y 坐标，动画后复位。 */
    private chestHomeY = 260.475;

    /** 宝箱常态缩放（prefab 里是 1，但按读到的值兜底），颤动的 `±8%` 叠在它上面。 */
    private chestHomeScale = new Vec3(1, 1, 1);

    /** 按钮精灵（onInit 缓存，避免每次渲染查组件）。 */
    private battleSprite: Sprite = null!;
    private upgradeSprite: Sprite = null!;

    /** 两个按钮的常态颜色（预制体里 Start 是白、Upgrade 是白，靠贴图本身区分蓝/金），置灰后要还原。 */
    private battleTint = new Color(255, 255, 255, 255);
    private upgradeTint = new Color(255, 255, 255, 255);

    protected onInit(): void {
        this.battleHomeX = this.battleButton.node.position.x;
        this.chestHomeY = this.chestSprite.node.position.y;
        this.chestHomeScale = this.chestSprite.node.scale.clone();
        this.battleSprite = this.battleButton.node.getComponent(Sprite);
        this.battleTint = this.battleSprite.color.clone();
        this.upgradeSprite = this.upgradeButton.node.getComponent(Sprite);
        this.upgradeTint = this.upgradeSprite.color.clone();
        // 奖励卡会被列表复用，渲染时按下标读取当前数据。
        this.rewardList.renderItemFn = this.renderRewardItem;
        this.battleButton.node.on(Button.EventType.CLICK, this.handleBattle, this);
        this.upgradeButton.node.on(Button.EventType.CLICK, this.handleUpgrade, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    protected onOpen(userData?: unknown): void {
        // 🔴 每次 open 都是新的资源作用域（`PopupBase._internalOpen` 会 dispose 上一趟的 scope）⇒
        // 上一趟那张帧已经被释放，`shineFrame` / `shineLoaded` 必须一起清，否则第二次开面板刷光永不出现。
        this.shineFrame = null;
        this.shineLoaded = false;
        // 同一理由：上一趟的 prefab 与实例都归上一趟的作用域，不能跨趟复用
        if (this.upgradeFx && this.upgradeFx.isValid) this.upgradeFx.destroy();
        this.upgradeFxPrefab = null;
        this.upgradeFxLoaded = false;
        this.upgradeFx = null;
        this.upgradeFxHideAt = 0;
        this.closing = false;
        // 刷光贴图与首帧并行拉：第一趟铺数据不演刷光，等玩家点升级时图早就到了。
        this.loadShineFrame();
        // 字特效同理：点升级后要摇 1.2s，光这 1.2s 就够把预制读进来
        this.loadUpgradeFx();
        if (userData) this.applyContent(userData as ITerritoryMonsterBoxContent);
    }

    /**
     * 面板已开着时换内容（`PopupManager` 对同类弹窗单实例去重，点另一格不会再走 `onOpen`）。
     */
    applyContent(content: ITerritoryMonsterBoxContent): void {
        // 换格子 ⇒ 数字过渡与刷光全部归零：这不是「值变了」，是「换了一个宝箱」，
        // 闪一下会被读成「升级成功了」。
        if (this.content && this.content.cellId !== content.cellId) this.clearNumberFx();
        this.content = content;
        this.whiteMaskMaterial = content.whiteMaskMaterial ?? null;
        const roll = this.roll;
        if (roll) {
            // 演到一半玩家点了别的格子 ⇒ 立即收掉摇奖，换成新格子的内容
            // （留着会「标题是新格子、宝箱还在演上一格」，演完才对齐）
            if (content.cellId !== roll.cellId) {
                this.abortRoll();
                this.renderContent(content);
                return;
            }
            // 演动画期间只记最新内容 + 认结果，绝不重绘（重绘会把宝箱换回去）
            this.pendingContent = content;
            this.bindRollResult(roll, content.upgradeAttempt ?? null);
            return;
        }
        this.renderContent(content);
    }

    /**
     * 收下这一次摇奖的结果。
     *
     * 三个条件缺一不可：同一格、状态还没定、序号比开演时大。
     * 少了序号判断，玩家「失败 → 再点一次」时，上一轮的 `attempt` 还在内容里，
     * 新一圈动画会**立刻**以旧结果落定（观感是「点了没演就失败」）。
     */
    private bindRollResult(roll: IMonsterBoxRollPlayback, attempt: ITerritoryMonsterBoxAttempt | null): void {
        if (!attempt || roll.success !== null) return;
        if (attempt.cellId !== roll.cellId || attempt.seq <= roll.fromSeq) return;
        roll.success = attempt.success;
        roll.resultAt = (performance.now() - roll.startedAt) / 1000;
    }

    /**
     * 每帧只做一件事：把这一帧的状态写进节点。
     *
     * 三条时间轴（摇奖姿态 / 成功率滚动 / 奖励数字刷光）各走各的纯函数，
     * 这里不判断「该不该成功」、不查配置、不建节点（光带是首次需要时才建）。
     */
    update(): void {
        this.stepRateRoll();
        this.stepRewardShines();
        this.stepUpgradeFx();
        const roll = this.roll;
        if (!roll) return;
        const elapsed = (performance.now() - roll.startedAt) / 1000;
        const pose = monsterBoxRollPose({ elapsed, success: roll.success, resultAt: roll.resultAt });
        this.applyRollPose(roll, pose);
        if (pose.finished) this.finishRoll();
    }

    /** 整块重绘（幂等、全量赋值）；摇奖播放期间不会走到这里。 */
    private renderContent(content: ITerritoryMonsterBoxContent): void {
        this.titleLabel.string = content.title;
        this.levelLabel.string = content.lv > 0 ? `Lv.${content.lv}` : '';
        this.levelLabel.node.active = content.lv > 0;

        this.chestSprite.spriteFrame = content.chestIcon;
        this.chestSprite.node.active = content.chestIcon !== null;
        this.syncChestWhite();

        this.renderLevelDots(content);
        this.renderGuards(content);
        this.renderRewards(content);
        this.renderButtons(content);

        if (this.footerLabel && this.footerLabel.node) {
            this.footerLabel.string = content.footerText;
            this.footerLabel.node.active = content.footerText !== '';
        }
    }

    /**
     * 等级星：按 `lv` 点亮，**动画期间也不让位**（虚影就演在下一个空槽里）。
     *
     * `upgrading`（服务端下发的升级中态）没有本地开演时刻 ⇒ 星槽静止、只把按钮置灰，
     * 不再像旧版那样画一条静态进度条。
     */
    private renderLevelDots(content: ITerritoryMonsterBoxContent): void {
        // 星数 = 上限；不知道上限时只画到当前等级。prefab 只有 4 颗，多出来的等级不补星。
        const count = Math.min(this.starOn.length, this.starOff.length);
        const total = Math.min(content.maxLv > 0 ? content.maxLv : content.lv, count);
        for (let index = 0; index < count; index += 1) {
            const inRange = index < total;
            const filled = inRange && index < content.lv;
            this.starOn[index].node.active = filled;
            this.starOff[index].node.active = inRange && !filled;
        }
        this.levelStars.active = total > 0;
        // 不在演的时候虚影必须收起来（收尾/关弹窗/切格子三条路都走这里兜底）
        if (this.roll === null && this.starGhost) this.starGhost.active = false;
    }

    /** 守护怪：按 guardSlots 逐格渲染；锁与解锁文案由格组件自治，多出来的格子隐藏。 */
    private renderGuards(content: ITerritoryMonsterBoxContent): void {
        const guards = content.guards;
        const slots = this.guardSlots;
        if (slots) {
            for (let index = 0; index < slots.length; index += 1) {
                slots[index].render(guards[index]);
            }
        }
        // 一格都没有 ⇒ 整块收起来，别留一个空标题占位
        this.guardRoot.active = guards.length > 0;
    }

    /**
     * 奖励卡的列数、间距与模板由 prefab 配置。
     *
     * 与「宝箱详情」`ChestDetailPanel` 同一套：同一个 `resId` 的多档已在 Model 合并成一格
     * （见 `buildRewards`），所以条数 = 资源种类数，不是掉落池行数。
     *
     * **刷光只由「数值变了」触发**：`applyContent` 会被同一份内容重复调用（回包、预取头像、
     * 摇奖收尾都会重绘一遍），不 diff 就会「每帧都在闪」。口径是「同一种资源 + 文案变了」——
     * 换格子（`resId` 换了）与首趟铺数据（没有上一趟）都不演。
     */
    private renderRewards(content: ITerritoryMonsterBoxContent): void {
        const previous = this.rewardSignatures;
        this.rewards = content.rewards;
        this.rewardSignatures = content.rewards.map((reward) => ({
            resId: reward.resId,
            text: reward.amountText ?? String(reward.amount),
        }));
        this.rewardSection.active = content.rewards.length > 0;

        const startedAt = performance.now();
        for (let index = 0; index < this.rewardSignatures.length; index += 1) {
            const before = previous[index];
            const after = this.rewardSignatures[index];
            if (!before || before.resId !== after.resId || before.text === after.text) continue;
            this.startRewardShine(index, startedAt);
        }

        this.rewardList.setTotalCount(content.rewards.length);
    }

    /**
     * 列表条目渲染（槽位池化复用，全量赋值防状态残留）。
     *
     * 顺手把这一格正在扫的光带挂到新的数字 Label 上 —— 列表在「条数没变」时也会重绘
     * （`setTotalCount` 末尾强制刷新），光带的父节点可能刚被换成另一个槽位。
     */
    private readonly renderRewardItem = (item: Node, index: number): void => {
        const data = this.rewards[index];
        if (!data) return;
        const view = item.getComponentInChildren(RewardItemView);
        if (!view) return;
        view.render(data);
        const play = this.rewardShines.find((entry) => entry.index === index);
        if (play) play.target = view.num.node;
    };

    /** 按可用性给按钮上色：不能用时压成灰色（`interactable` 本身不改外观）。 */
    private tintButton(sprite: Sprite, normal: Color, usable: boolean): void {
        sprite.color = usable ? normal : BTN_DIM;
    }

    private renderButtons(content: ITerritoryMonsterBoxContent): void {
        // 摇奖动画也算「忙」：回包到了动画还在演，按钮不能提前解禁
        const busy = content.upgrading === true || this.roll !== null;
        this.battleLabel.string = content.battleCaption;
        const battleUsable = content.battleEnabled && !busy;
        this.battleButton.interactable = battleUsable;
        this.tintButton(this.battleSprite, this.battleTint, battleUsable);

        // 满级 / 未开放 ⇒ 没有升级入口：整块收起来，不留一个灰按钮
        const hasUpgrade = content.upgradeCost > 0 || content.upgrading === true || this.roll !== null;
        this.upgradeButton.node.active = hasUpgrade;
        // 只剩「开始挑战」时回到中线，别留半个空位（设计稿满级那张是单个通栏按钮）
        this.battleButton.node.setPosition(
            hasUpgrade ? this.battleHomeX : 0,
            this.battleButton.node.position.y,
        );
        if (!hasUpgrade) {
            this.failLabel.node.active = false;
            // 满级 / 未开放：成功率整块跟着升级按钮一起收起来，过渡态也归零
            // （否则 `shownRate` 带着上一级的数，下次滚动的起点会错）。
            this.syncSuccessRate(0, false);
            return;
        }
        this.upgradeLabel.string = content.upgradeCaption;
        const upgradeUsable = !busy && content.upgradeCost > 0;
        this.upgradeButton.interactable = upgradeUsable;
        this.tintButton(this.upgradeSprite, this.upgradeTint, upgradeUsable);

        const hasCost = content.upgradeCost > 0;
        this.costLabel.string = hasCost ? String(Math.round(content.upgradeCost)) : '';
        this.costLabel.node.active = hasCost;
        this.costIcon.spriteFrame = content.costIcon;
        this.costIcon.node.active = hasCost && content.costIcon !== null;

        const hasRate = content.successRate > 0;
        this.syncSuccessRate(content.successRate, hasRate);

        const hasFailCount = content.failCount >= 0;
        const hasFailLimit = content.failLimit > 0;
        this.failLabel.node.active = hasFailCount || hasFailLimit;
        if (hasFailCount) {
            this.failLabel.string = hasFailLimit
                ? `失败次数：${Math.min(content.failCount, content.failLimit)} / ${content.failLimit}`
                : `失败次数：${content.failCount}`;
        } else {
            this.failLabel.string = hasFailLimit ? `${FAIL_LIMIT_LABEL}：${content.failLimit} 次` : '';
        }
    }

    /**
     * 成功率数字：值没变就直接写，变了才**滚过去**（`90 → 60`）。
     *
     * 三种情况必须分清（分不清就会「每次重绘都闪一下」）：
     * - 不显示（满级 / 没入口）⇒ 清空并复位，`shownRate = -1`；
     * - 首趟铺数据（`shownRate < 0`）或值没变 ⇒ 直写，不演；
     * - 值变了 ⇒ 记一条滚动（已经朝同一个目标滚着就别重开，否则数字会跳回去重滚）。
     */
    private syncSuccessRate(rate: number, hasRate: boolean): void {
        this.rateGroup.active = hasRate;
        const node = this.rateLabel.node;
        if (!hasRate) {
            this.rateLabel.string = '';
            this.shownRate = -1;
            this.rateRoll = null;
            node.setScale(1, 1, 1);
            return;
        }
        const target = Math.round(rate);
        if (this.shownRate < 0 || target === this.shownRate) {
            this.rateLabel.string = `${target}%`;
            this.shownRate = target;
            this.rateRoll = null;
            node.setScale(1, 1, 1);
            return;
        }
        if (this.rateRoll && this.rateRoll.to === target) return;
        this.rateLabel.string = `${this.shownRate}%`;
        this.rateRoll = { from: this.shownRate, to: target, startedAt: performance.now() };
    }

    /** 逐帧写成功率（滚动 + 一点弹）；演完把终值落定，别让 `Math.round` 的尾巴留在屏上。 */
    private stepRateRoll(): void {
        const roll = this.rateRoll;
        if (!roll) return;
        const elapsed = (performance.now() - roll.startedAt) / 1000;
        const done = elapsed >= TERRITORY_MONSTER_BOX_FX.rateRollSeconds;
        const value = done ? roll.to : monsterBoxRateRollAt(roll.from, roll.to, elapsed);
        this.rateLabel.string = `${value}%`;
        const scale = done ? 1 : monsterBoxRatePunchAt(elapsed);
        this.rateLabel.node.setScale(scale, scale, 1);
        if (!done) return;
        this.shownRate = roll.to;
        this.rateRoll = null;
    }

    // =========================================================================
    // 奖励数字刷光
    // =========================================================================

    /** 按需拉刷光贴图（一次；失败就整段不刷，数字与其它动画不受影响）。 */
    private loadShineFrame(): void {
        if (this.shineLoaded) return;
        this.shineLoaded = true;
        this.assets.load(SHINE_FRAME_PATH, SpriteFrame, { bundle: bundleForPath(SHINE_FRAME_PATH) })
            .then((frame) => { this.shineFrame = frame?.isValid ? frame : null; })
            .catch((error: unknown) => {
                // 出声：静默吞掉会变成「刷光时好时坏、零报错」
                console.warn('[TerritoryMonsterBoxPanel] 数字刷光贴图加载失败，跳过刷光', error);
            });
    }

    /** 给某一格排一条刷光（同一格连续变两次就重头扫，不叠两条）。 */
    private startRewardShine(index: number, startedAt: number): void {
        this.rewardShines = this.rewardShines.filter((play) => {
            if (play.index !== index) return true;
            this.destroyShine(play);
            return false;
        });
        this.rewardShines.push({ index, startedAt, target: null, node: null, sprite: null, opacity: null });
    }

    /** 逐帧推进光带；`progress < 0`（扫完）就收节点。 */
    private stepRewardShines(): void {
        if (this.rewardShines.length === 0) return;
        const now = performance.now();
        const alive: IMonsterBoxShinePlay[] = [];
        for (const play of this.rewardShines) {
            const progress = monsterBoxShineProgressAt((now - play.startedAt) / 1000);
            if (progress < 0) {
                this.destroyShine(play);
                continue;
            }
            if (this.ensureShineNode(play)) this.applyShineFrame(play, progress);
            alive.push(play);
        }
        this.rewardShines = alive;
    }

    /**
     * 保证这一格有一条可用的光带节点；`false` = 这帧还建不出来（贴图没到 / 格子已销毁）。
     *
     * 挂在数字 Label 的**父节点**、插在 Label 之前 —— 与卡牌升级页同一条约定
     * 「底框之上、文字之下」：盖在数字上会把数值糊掉，画到底框下又看不见。
     */
    private ensureShineNode(play: IMonsterBoxShinePlay): boolean {
        const target = play.target;
        if (!target || !target.isValid || !target.parent) return false;
        const frame = this.shineFrame;
        if (!frame || !frame.isValid) return false;
        if (play.node && play.node.isValid && play.node.parent === target.parent) {
            if (play.sprite && play.sprite.spriteFrame !== frame) play.sprite.spriteFrame = frame;
            return true;
        }
        this.destroyShine(play);
        const parent = target.parent;
        try {
            const node = new Node(NUM_SHINE_NAME);
            node.layer = parent.layer;
            node.addComponent(UITransform);
            const sprite = node.addComponent(Sprite);
            sprite.spriteFrame = frame;
            // 尺寸必须走 CUSTOM：TRIMMED 会让节点跟着帧自带裁剪尺寸变，宽度就匹配不上数字框了。
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.trim = false;
            const opacity = node.addComponent(UIOpacity);
            opacity.opacity = 0;
            parent.insertChild(node, target.getSiblingIndex());
            node.angle = TERRITORY_MONSTER_BOX_FX.shineAngleDeg;
            play.node = node;
            play.sprite = sprite;
            play.opacity = opacity;
            return true;
        } catch (error) {
            console.warn('[TerritoryMonsterBoxPanel] 数字刷光带创建失败，跳过刷光', error);
            return false;
        }
    }

    /** 写一帧：尺寸/行程/亮度**全部按目标数字框现算**（框换了、字号变了都不用回头改常量）。 */
    private applyShineFrame(play: IMonsterBoxShinePlay, progress: number): void {
        const target = play.target;
        const node = play.node;
        if (!target || !node || !node.isValid) return;
        const label = target.getComponent(UITransform);
        const band = monsterBoxShineBandOf(label?.width ?? 0, label?.height ?? 0);
        const transform = node.getComponent(UITransform);
        if (transform) transform.setContentSize(band.width, band.height);
        const position = target.position;
        node.setPosition(position.x + monsterBoxShineXAt(progress, label?.width ?? 0, band.width), position.y, 0);
        if (play.opacity) {
            const alpha = monsterBoxShineAlphaAt(progress) * TERRITORY_MONSTER_BOX_FX.shinePeakAlpha;
            play.opacity.opacity = Math.round(255 * alpha);
        }
    }

    /** 收掉一条光带的节点（播放记录由调用方摘）。 */
    private destroyShine(play: IMonsterBoxShinePlay): void {
        if (play.node && play.node.isValid) play.node.destroy();
        play.node = null;
        play.sprite = null;
        play.opacity = null;
    }

    /** 关面板 / 换格子：所有过渡态复位，别把光带和半截数字留到下次打开。 */
    private clearNumberFx(): void {
        for (const play of this.rewardShines) this.destroyShine(play);
        this.rewardShines = [];
        this.rewardSignatures = [];
        this.rateRoll = null;
        this.shownRate = -1;
        if (this.rateLabel && this.rateLabel.node && this.rateLabel.node.isValid) {
            this.rateLabel.node.setScale(1, 1, 1);
        }
    }

    // =========================================================================
    // 升级成功字特效（spine）
    // =========================================================================

    /** 按需拉预制（一次；失败只少一场演出，等级切换与数字反馈都不受影响）。 */
    private loadUpgradeFx(): void {
        if (this.upgradeFxLoaded) return;
        this.upgradeFxLoaded = true;
        this.assets.load(UPGRADE_FX_PREFAB_PATH, Prefab)
            .then((prefab) => { this.upgradeFxPrefab = prefab?.isValid ? prefab : null; })
            .catch((error: unknown) => {
                // 出声：静默吞掉会变成「特效时好时坏、零报错」
                console.warn('[TerritoryMonsterBoxPanel] 升级成功特效预制加载失败，跳过特效', error);
            });
    }

    /**
     * 屏正中的字特效节点。
     *
     * 弹窗根节点本身就是 720×1280、锚点 0.5/0.5 的全屏层 ⇒ 局部 `(0, 0)` 就是屏幕正中；
     * 排到兄弟最后即压在 `Dim` / `Panel` 之上（字压在面板上也读得出来）。
     */
    private ensureUpgradeFx(): Node | null {
        const prefab = this.upgradeFxPrefab;
        const host = this.node;
        if (!prefab || !host || !host.isValid) return null;
        let node = this.upgradeFx;
        if (node && node.isValid && node.parent === host) {
            node.setSiblingIndex(host.children.length - 1);
            return node;
        }
        if (node && node.isValid) node.destroy();
        this.upgradeFx = null;
        try {
            node = instantiate(prefab);
            host.addChild(node);
            node.setPosition(0, 0, 0);
            // 先以「不播」的状态挂好，起播时再点亮 ⇒ 不会出现「挂上去就停在第一帧」
            node.active = false;
            this.upgradeFx = node;
            return node;
        } catch (error) {
            console.warn('[TerritoryMonsterBoxPanel] 升级成功特效实例化失败，跳过特效', error);
            return null;
        }
    }

    /**
     * 播**一次**「升级成功」；播完由 {@link stepUpgradeFx} 收起来。
     *
     * @returns 是否真的起播了（`false` ⇒ 调用方让 Model 退回文案，别两边都没有反馈）
     */
    private playUpgradeFx(): boolean {
        if (this.closing) return false;
        const node = this.ensureUpgradeFx();
        if (!node) return false;
        const skeleton = node.getComponent(sp.Skeleton);
        if (!skeleton) {
            // 预制做错了（少了 sp.Skeleton）：重试也不会变好，报一次就够
            console.warn('[TerritoryMonsterBoxPanel] 升级成功特效预制缺少 sp.Skeleton，跳过特效');
            return false;
        }
        node.active = true;
        try {
            // 同一条轨道上重设即从头播（`setAnimation` 替换 track 0），不用先 stop；
            // 末位 `false` = 不循环，就是「播放1次」。
            skeleton.setAnimation(0, UPGRADE_FX_ANIMATION, false);
            this.upgradeFxHideAt = performance.now() + TERRITORY_MONSTER_BOX_FX.upgradeFxSeconds * 1000;
            return true;
        } catch (error) {
            console.warn('[TerritoryMonsterBoxPanel] 升级成功特效播放失败', error);
            node.active = false;
            this.upgradeFxHideAt = 0;
            return false;
        }
    }

    /** 到点把字收起来：`loop = false` 的骨架会停在最后一帧，不收就一直糊在屏幕中间。 */
    private stepUpgradeFx(): void {
        if (this.upgradeFxHideAt <= 0) return;
        if (performance.now() < this.upgradeFxHideAt) return;
        this.upgradeFxHideAt = 0;
        if (this.upgradeFx && this.upgradeFx.isValid && this.upgradeFx.active) this.upgradeFx.active = false;
    }

    protected onClose(): void {
        // 关闭途中 `abortRoll` 还会再报一次结果（等级确实变了）：那一刻起演字特效没意义，
        // 节点几帧后就跟着弹窗一起销毁，只会闪一下。
        this.closing = true;
        this.upgradeFxHideAt = 0;
        if (this.upgradeFx && this.upgradeFx.isValid) this.upgradeFx.active = false;
        // 演到一半被关掉：状态丢掉即可（面板关了就没人看；下次开重新算）
        this.abortRoll();
        this.clearNumberFx();
        this.syncChestWhite();
        // Presenter 靠这条清 `detailSite`（页面订阅后调 closeDetail，幂等）
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'closeDetail' } });
    }

    private handleBattle(): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'battle' } });
    }

    /**
     * 点「升级宝箱」：**先起演，再发请求**。
     *
     * 先起演是为了「点下去立刻有反馈」，不等网络；落点等回包（`applyContent` 里认）。
     * 演的过程中禁止再点（`this.roll` 非空即返回），否则两次请求的动画会叠在一起。
     */
    private handleUpgrade(): void {
        const content = this.content;
        const cellId = content?.cellId ?? 0;
        if (!content || cellId <= 0 || this.roll) return;
        this.startRoll(content);
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'upgradeMonsterBox', cellId } });
    }

    /**
     * 起演：虚影挪到下一个空槽、宝箱归位、白层归零。
     *
     * 起手先写一帧姿态（`elapsed = 0`），避免「点了没反应」到下一帧才动。
     */
    private startRoll(content: ITerritoryMonsterBoxContent): void {
        const starIndex = Math.max(0, Math.min(this.starOff.length - 1, Math.floor(content.lv)));
        this.roll = {
            cellId: content.cellId,
            fromSeq: content.upgradeAttempt?.seq ?? 0,
            starIndex,
            startedAt: performance.now(),
            resultAt: null,
            success: null,
            revealed: false,
        };
        this.pendingContent = null;
        this.prepareStarGhost(starIndex);
        this.ensureChestWhite();
        this.syncChestWhite();
        this.renderLevelDots(content);
        this.renderButtons(content);
        this.applyRollPose(this.roll, monsterBoxRollPose({ elapsed: 0, success: null, resultAt: null }));
    }

    /**
     * 摇奖演完（或被中途收掉）⇒ 成功播字特效与音效、结果提示交回 Model。
     *
     * 分工：**成功**这一拍由视图演（{@link playUpgradeFx} 在屏正中播一次「升级成功」，
     * 替掉原来的 toast），**失败**仍走 Model 的 toast（文案按 `monsterBoxAttempt` 取）。
     * 视图不自己拼文案、也不直接调 toast —— 那是 Controller/Model 的事。
     *
     * 音效（2026-11-26 用户）：成功 = 通用「升级成功」、失败 = 通用「升级失败」，
     * 与字特效同一拍起。关闭途中不播（节点几帧后就跟弹窗一起销毁，只会响一下）。
     */
    private notifyRollSettled(): void {
        const roll = this.roll;
        if (!roll || roll.success === null) return;
        const fxPlayed = roll.success ? this.playUpgradeFx() : false;
        EventMgr.instance.emit(TerritoryUiEvent.Intent, {
            intent: { kind: 'monsterBoxRollSettled', cellId: roll.cellId, fxPlayed },
        });
        // 音效与字特效同一拍（2026-11-26 用户）：成功 = 通用「升级成功」、失败 = 通用「升级失败」。
        // 关闭途中不播（节点几帧后就跟弹窗一起销毁，只会响一下）。
        if (this.closing) return;
        void AudioMgr.instance.playSound(
            roll.success ? GAME_AUDIO.upgradeSuccess : GAME_AUDIO.upgradeFailure,
            this.resourceScope,
        );
    }

    /** 中途收掉摇奖（关弹窗 / 换格子）：节点复位，别把白层留在屏上。 */
    private abortRoll(): void {
        // 结果已经回来了：提示照弹（玩家虽然没看完，但等级确实变了）
        this.notifyRollSettled();
        this.roll = null;
        this.pendingContent = null;
        Tween.stopAllByTarget(this.chestSprite.node);
        this.chestSprite.node.setScale(this.chestHomeScale);
        this.chestSprite.node.setPosition(0, this.chestHomeY, 0);
        if (this.starGhost) this.starGhost.active = false;
        if (this.chestWhiteOpacity) this.chestWhiteOpacity.opacity = 0;
    }

    /** 收尾：清播放态 → 用最新内容整块重绘（宝箱回新等级、星槽回新等级、按钮解禁）。 */
    private finishRoll(): void {
        const wasSuccess = this.roll?.success === true || (this.pendingContent !== null && this.content !== null && this.pendingContent.lv > this.content.lv);
        // 先取内容再清暂存：`pendingContent` 是回包带来的新等级，清早了会拿旧内容重绘
        const content = this.pendingContent ?? this.content;
        // 演完了才弹结果提示（reset 前发，视图才拿得到这一轮的 cellId）
        this.notifyRollSettled();
        this.roll = null;
        this.pendingContent = null;
        if (this.starGhost) this.starGhost.active = false;
        if (this.chestWhiteOpacity) this.chestWhiteOpacity.opacity = 0;
        if (content) this.renderContent(content);
        // 成功给个 Q 弹（白层此时已归零）；失败已经晃过一整轮，不再补晃
        if (wasSuccess) this.playChestSuccessBounce();
    }

    /** 升级成功：宝箱 Q 弹跳动回馈。 */
    private playChestSuccessBounce(): void {
        const node = this.chestSprite.node;
        Tween.stopAllByTarget(node);
        node.setScale(this.chestHomeScale);
        node.setPosition(0, this.chestHomeY, 0);
        tween(node)
            .to(0.1, { scale: new Vec3(0.92, 0.88, 1) }, { easing: 'quadOut' })
            .to(0.18, { scale: new Vec3(1.18, 1.22, 1) }, { easing: 'backOut' })
            .to(0.14, { scale: new Vec3(0.98, 0.98, 1) }, { easing: 'quadInOut' })
            .to(0.1, { scale: Vec3.ONE }, { easing: 'sineOut' })
            .start();
    }

    /**
     * 建/挪星星虚影：挂在 `LevelStars` 下，位置照抄目标空槽。
     *
     * 不挂材质 —— 虚影就是「半透明的星」：复用已点亮星的贴图，靠 `UIOpacity` 与缩放呼吸。
     */
    private prepareStarGhost(starIndex: number): void {
        const slot = this.starOff[starIndex];
        // 虚影用**点亮的金星图**（不是空槽的暗星）：压在暗星上闪才看得出来
        const frame = this.starOn[starIndex]?.spriteFrame ?? slot?.spriteFrame ?? null;
        let node = this.starGhost;
        if (!node || !node.isValid) {
            node = new Node(STAR_GHOST_NAME);
            node.layer = this.levelStars.layer;
            node.addComponent(UITransform);
            this.starGhostSprite = node.addComponent(Sprite);
            this.starGhostSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.starGhostSprite.type = Sprite.Type.SIMPLE;
            this.starGhostSprite.trim = false;
            this.starGhostOpacity = node.addComponent(UIOpacity);
            node.parent = this.levelStars;
            this.starGhost = node;
        }
        if (this.starGhostSprite) {
            this.starGhostSprite.spriteFrame = frame;
            const size = slot?.node.getComponent(UITransform);
            const ghostSize = node.getComponent(UITransform);
            if (size && ghostSize) ghostSize.setContentSize(size.width, size.height);
        }
        const position = slot?.node.position;
        if (position) node.setPosition(position.x, position.y, 0);
        node.active = true;
    }

    /**
     * 建宝箱白色叠层（`ChestModel` 的子节点，跟着父节点一起晃）。
     *
     * 材质是「只采样 alpha、输出顶点色」的 outline shader ⇒ 白 tint + 同图 = **纯白剪影**，
     * 用 `UIOpacity` 从 0 涨到 255 就是「越来越白」。材质拿不到时不建这一层（只演呼吸与晃动）。
     */
    private ensureChestWhite(): void {
        // 没材质就整层不建：否则白层只是一张和本体同色的复制品，多一次绘制还不变白
        if (!this.whiteMaskMaterial) {
            this.chestWhite = null;
            return;
        }
        const parent = this.chestSprite.node;
        let node = this.chestWhite?.node ?? null;
        if (!node || !node.isValid || node.parent !== parent) {
            const existing = parent.getChildByName(CHEST_WHITE_NAME);
            if (existing) existing.destroy();
            node = new Node(CHEST_WHITE_NAME);
            node.layer = parent.layer;
            node.addComponent(UITransform);
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.trim = false;
            // 白 tint：outline shader 输出顶点色，所以这里就是「纯白」
            sprite.color = new Color(255, 255, 255, 255);
            this.chestWhiteOpacity = node.addComponent(UIOpacity);
            this.chestWhiteOpacity.opacity = 0;
            node.parent = parent;
            node.setPosition(0, 0, 0);
            this.chestWhite = sprite;
        }
        this.syncChestWhite();
    }

    /** 白层贴图/尺寸/材质跟住宝箱本体（换等级后立刻同步，否则白层还是上一张图）。 */
    private syncChestWhite(): void {
        const white = this.chestWhite;
        const parentTransform = this.chestSprite.node.getComponent(UITransform);
        if (!white) return;
        white.spriteFrame = this.chestSprite.spriteFrame;
        white.customMaterial = this.whiteMaskMaterial;
        const transform = white.node.getComponent(UITransform);
        if (transform && parentTransform) {
            transform.setContentSize(parentTransform.width, parentTransform.height);
        }
        if (this.chestWhiteOpacity && this.roll === null) this.chestWhiteOpacity.opacity = 0;
    }

    /** 写一帧姿态：虚影缩放/明暗 + 宝箱原地颤动（位移 + 跳动 + 缩放）+ 白度；`revealing` 那一拍换等级图。 */
    private applyRollPose(roll: IMonsterBoxRollPlayback, pose: ITerritoryMonsterBoxRollPose): void {
        const { ghostMinScale, ghostMaxScale, ghostMinOpacity, ghostMaxOpacity } = TERRITORY_MONSTER_BOX_ROLL;
        const ghost = this.starGhost;
        if (ghost && ghost.isValid) {
            const scale = ghostMinScale + (ghostMaxScale - ghostMinScale) * pose.pulse;
            ghost.setScale(scale, scale, 1);
            if (this.starGhostOpacity) {
                this.starGhostOpacity.opacity = Math.round(ghostMinOpacity + (ghostMaxOpacity - ghostMinOpacity) * pose.pulse);
            }
        }
        const chest = this.chestSprite.node;
        // 原地颤动：水平只看 ±4（屏上 ≈3px）、垂直 ±2 跳动、缩放 1±0.08 —— 位移轻、缩放重
        chest.setPosition(pose.shakeX, this.chestHomeY + pose.shakeY, 0);
        chest.setScale(
            this.chestHomeScale.x * pose.shakeScale,
            this.chestHomeScale.y * pose.shakeScale,
            this.chestHomeScale.z,
        );
        if (this.chestWhiteOpacity) {
            this.chestWhiteOpacity.opacity = Math.round(255 * pose.whiten);
        }
        // 成功的那一拍：换成新等级宝箱图（白层同步换，所以看不到「换图」本身）
        if (pose.revealing && !roll.revealed) {
            roll.revealed = true;
            const next = this.pendingContent?.chestIcon ?? null;
            if (next) {
                this.chestSprite.spriteFrame = next;
                this.syncChestWhite();
            }
        }
    }
}
