/**
 * 引导对话条和角色立绘，挂在 GuideDialog.prefab 根节点上。
 * Controller 只交状态，本类负责按 dialogId 播台词、按说话人切立绘，
 * 台词播完且 completeCond 为 click 时经事件报告推进意图。
 * 立绘帧由外部注入，View 不自己 load。
 */

import {
    _decorator,
    Button,
    Component,
    EventTouch,
    Graphics,
    input,
    Input,
    instantiate,
    Label,
    Layers,
    Mask,
    Node,
    Prefab,
    RichText,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
    Widget,
} from 'cc';
import { DEBUG } from 'cc/env';
import { GuideDebugEvent, GuideEvent } from '../application/GuideEvents';
import type { IGuideViewState } from '../application/GuideController';
import { EventMgr } from '../../../framework/event/EventMgr';
import { getGuidePortraitAsset } from '../model/GuideDialogConfig';
import type { GuideDialogLine } from '../model/GuideDialogConfig';
import type { GuideMaskType } from '../model/GuideStepConfig';
import { fitGuidePortrait, formatGuideContent, guideDialogBottom, guideHintMotion, PORTRAIT_BOX_WIDTH_RATIO, unionGuideFocusRects, type IGuideFocusRect } from '../model/GuidePresentation';
import { HEX_GRID_CONTENT_LIFT, HEX_GRID_FACE_WIDTH, HEX_GRID_FACE_HEIGHT } from '../../../core/hex/HexGridLayout';

const { ccclass, property } = _decorator;

/** 指南骨骼立绘的固定骨架子节点（`skel/豌豆射手`：根节点 + `spine`）。 */
const GUIDE_PORTRAIT_SPINE_NODE_NAME = 'spine';

export interface IGuideFocusTarget {
    readonly node: Node;
    readonly shape: 'hex' | 'rect';
    /**
     * 要一起圈进来的附加节点（世界包围盒取并集）。
     *
     * 地块和它的「关卡编号气泡」不是父子关系（气泡挂在 `StationBadgeLayer` 上、抬在建筑顶上方），
     * 只按地块算孔就会出现「气泡在圈外、圈挖在空地上」—— 用户 2026-11-17 第 17 条要求
     * 光圈把 `1-1` 气泡一起囊括，所以焦点可以带几个附加节点，孔/光圈取整组的外接矩形。
     */
    readonly extra?: readonly Node[];
}


/**
 * 单句无人点击时自动推进的秒数，对应设计案的 8s 无响应兜底。
 */
const IDLE_ADVANCE_SECONDS = 8;

/** 遮罩不透明度：设计案「全屏半透明黑 60%」= 153，取整 150；hole 步降到 40% 把注意力留给焦点区。 */
const FULL_MASK_ALPHA = 150;
const HOLE_MASK_ALPHA = 100;

/**
 * 焦点没解析出来时，隔多久再问一次业务侧要目标节点。
 *
 * 为什么要重试：`resolveFocus` 只在 `render` 时跑一次，可目标节点常常**晚几帧**才出现 /
 * 才 active —— 切回主页那几帧底栏还没亮（焦点是底栏里的「英雄」格）、翻地后地块节点
 * 还在重建。一次解析不到就再也不解析，表现就是「光圈手指要等一会儿才到位」
 * （用户 2026-11-17 第 13 条 ①⑤）。
 */
const FOCUS_RETRY_INTERVAL_MS = 150;

/**
 * 立绘脚点下沉到对话条后面多少（占显示高度的比例）。
 *
 * 需求（2026-11-17）：立绘置于对话框**下层**，只露上半身 —— 脚点落到对话条上沿以下
 * 1/4 处，剩下的被 `DialogBox/Bg`（不透明）真挡住。`Portrait`(42) 排在 `DialogBox`(94)
 * 之前，渲染顺序天然在下层，不用裁切/蒙版，角色比例也不变。
 */
const PORTRAIT_SINK_RATIO = 0.25;

/** 立绘右边与对话框右边框的留白（px）；0 = 真右对齐。 */
const PORTRAIT_RIGHT_INSET = 0;

/**
 * 立绘与焦点孔之间至少留多少（px）。
 *
 * `hole` 步的立绘不再「一律藏」，而是按**几何相交**判（见 `syncPortraitSuppression`）：
 * 挡住玩家该点的那一格 = 必须让开；差一点贴边（手伸过去会压到立绘）也算挡。
 * 8px 是手指图标与描边之间那点余地。
 */
const PORTRAIT_FOCUS_GAP = 8;

/**
 * 「点击高亮区域」气泡比焦点上沿再高多少（px）。
 *
 * 用户 2026-11-17 第 16 条 ②：原来 140 飘得太远，气泡跟手指之间空出一大截，
 * 看着不像在说同一件事 ⇒ 下移 80，落到手指 icon 上方一点点。
 */
const HINT_ABOVE_FOCUS = 60;

/**
 * 光圈描边的最高不透明度（0~255）。呼吸时在 `RING_ALPHA_MAX × ringAlpha` 之间走，
 * 低点约 140 —— 描边只剩一层淡淡的轮廓，高点回到实心黄。
 */
const RING_ALPHA_MAX = 255;

/** 没有附加节点时的共享空数组（别每次 new，`focusExtra` 会逐帧读长度）。 */
const NO_FOCUS_EXTRA: readonly Node[] = [];

/**
 * 这几类焦点**不出气泡文案**：结算页那颗「确定」按钮，气泡只会压住奖励格，
 * 而玩家该点哪里手指已经指得清清楚楚（用户 2026-11-17 第 16 条 ①）。
 */
const HINT_HIDDEN_PREFIXES = ['BattleResult/'];

@ccclass('GuideDialogView')
export class GuideDialogView extends Component {
    @property({ type: Node, group: '立绘', tooltip: 'Portrait：角色立绘节点（锚点 0.5/0，居中站在对话框上方）' })
    portraitNode: Node = null!;

    @property({ group: '立绘', tooltip: '立绘盒高度（绿框口径 233）；宽度 = 宿主宽 × 149/720，图按比例 contain 进盒子' })
    portraitHeight = 233;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox：底部对话条容器' })
    dialogBox: Node = null!;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox/NameLab：说话人名字' })
    nameLabelNode: Node = null!;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox/ContentLab：台词正文' })
    contentLabelNode: Node = null!;

    @property({ type: Node, group: '交互', tooltip: 'Blocker：全屏点击区（Button transition=NONE）' })
    blockerNode: Node = null!;


    /** `立绘资源路径 → 资源`（静图是 `SpriteFrame`、骨骼是 `Prefab`）；由 `initialize` 注入。 */
    private frames: ReadonlyMap<string, SpriteFrame | Prefab> = new Map();
    /** 骨骼立绘实例（豌豆游侠）；首次用到时建一次，之后只切 active。 */
    private npcNode: Node | null = null;
    /** 组 id → 台词列表；由 `initialize` 注入。 */
    private groups: ReadonlyMap<string, readonly GuideDialogLine[]> = new Map();
    /** 当前组；空数组 = 没有可播台词。 */
    private queue: readonly GuideDialogLine[] = [];
    private index = 0;
    /** 仅 click 步在台词播完后接受推进点击。 */
    private canAdvance = false;
    /** 台词播完、对话条已收起（本步要靠玩家点高亮目标推进）；换步由 `render` 重置。 */
    private dialogClosed = false;
    private stepId = '';
    /**
     * 换步被「上一组台词还没说完」挡住时暂存的新状态（只留最新一份，别攒队列）。
     * 台词收起的同一帧再拿它重放 `render`（见 `flushPendingState`）。
     */
    private pendingState: IGuideViewState | null = null;
    /**
     * 「等手指落到地块上再开口」的待播标记（`Map/Level_*` 的步，见 {@link waitsForLevelFocus}）。
     *
     * 关卡建筑那一格还锁着时 `guideMapFocusCells` 返回空集 ⇒ 光圈解析不出来，
     * 这时候把台词播掉就是「对着挂锁的格子发号令」，8s 后还会被自动推进耗掉（第 24 条）。
     * 置真时 `render` 不 `playLine`、不 arm 计时器，只等 `placeFocusRing` 里 `visible` 变真的那一帧。
     */
    private narrationPending = false;
    /** 当前这句的无人操作计时器是否在跑（`schedule` 按回调去重，这里只做状态记录）。 */
    private idleArmed = false;
    /** 调试跳过区连点计数（仅 `DEBUG` 构建有效）。 */
    private debugSkipTaps = 0;
    private debugSkipAt = 0;

    /**
     * 子组件缓存。MCP 写 prefab 时组件引用可能在序列化阶段丢失，Node 引用能正常落盘，
     * 所以这里绑 Node，再在 onLoad 里取组件，既不用按名字查找，也不会静默丢引用。
     */
    private portraitSprite: Sprite = null!;
    private nameText: Label = null!;
    private contentText: RichText = null!;
    /** 遮罩用的 Sprite（prefab 里已绑 `white.png`，这里只取引用做「按 maskType 改 alpha」）。 */
    private dimSprite: Sprite = null!;
    @property(Node) dimNode: Node = null!;
    @property(Node) tapHint: Node = null!;
    @property(Node) mapHint: Node = null!;
    @property(Node) focusRing: Node = null!;
    @property(Node) focusHand: Node = null!;
    @property(Node) debugSkipNode: Node = null!;
    private hostTransform: UITransform = null!;
    private hintTransform: UITransform = null!;
    private blockerTransform: UITransform = null!;
    private dialogTransform: UITransform = null!;
    private dialogWidget: Widget = null!;
    private defaultDialogBottom = 0;
    private maskTransforms: UITransform[] = [];
    @property(Label) focusHintText: Label = null!;
    private focusGraphics: Graphics = null!;
    /** 描边呼吸用的透明度组件（`focusRing` 上自动补一个，prefab 不用改）。 */
    private ringOpacity: UIOpacity = null!;
    private animationStartedAt = 0;
    @property([Node]) focusMasks: Node[] = [];
    private focusMaskSprites: Sprite[] = [];
    private focusKey = '';
    private focusTarget: IGuideFocusTarget | null = null;
    private focusTransform: UITransform | null = null;
    private focusWidth = 0;
    private focusHeight = 0;
    /** 焦点自身那一块的逻辑尺寸（地块 = 格面、控件 = 尺寸 + 8）；孔被附加节点撑大时也不变。 */
    private focusBaseWidth = 0;
    private focusBaseHeight = 0;
    /** 光圈描边的形状是否需要按六边形画（只有地图地块是 hex）。 */
    private focusShapeHex = false;
    /** 已画出来的描边尺寸，用来「没变就不重画」。 */
    private focusShapeWidth = 0;
    private focusShapeHeight = 0;
    private focusShapeDrawn = false;
    /** 上次画的是不是六边形（换形状但尺寸恰好相同也要重画）。 */
    private focusShapeDrawnHex = false;
    /** 当前焦点要一起圈进来的附加节点（关卡编号气泡等），没配就是空数组。 */
    private focusExtra: readonly Node[] = NO_FOCUS_EXTRA;
    private readonly focusLocal = new Vec3();
    private readonly focusWorld = new Vec3();
    private readonly focusEdgeWorld = new Vec3();
    private readonly focusCorner = new Vec3();
    private readonly clipCenter = new Vec3();
    private readonly clipCorner = new Vec3();
    /** 附加节点的世界/本地角点（每帧复用，别在循环里 new）。 */
    private readonly extraWorld = new Vec3();
    private readonly extraLocal = new Vec3();
    private readonly extraCornerWorld = new Vec3();
    private readonly extraCornerLocal = new Vec3();
    private focusClips: UITransform[] = [];
    private focusScaleX = 1;
    private focusScaleY = 1;
    private focusProvider: ((key: string) => IGuideFocusTarget | null) | null = null;
    /** 下一次可以再问业务侧要焦点的时间戳（见 `FOCUS_RETRY_INTERVAL_MS`）。 */
    private focusRetryAt = 0;
    /** 当前立绘的显示宽度（`placePortrait` 算右对齐偏移用；0 = 没有立绘在显示）。 */
    private portraitDisplayWidth = 0;
    /** 当前立绘的显示高度（`placePortrait` 算下沉量用；0 = 没有立绘在显示）。 */
    private portraitDisplayHeight = 0;
    /** 这一句的说话人有没有配到立绘（`applyPortrait` 的结果）。 */
    private portraitShown = false;
    /** 立绘是否正因「挡住焦点孔」被临时藏起来（两侧都站不下才会置真）。 */
    private portraitSuppressed = false;
    /** 立绘当前站哪一侧：1 = 右侧（默认），-1 = 左侧（孔占了右边时让位）。 */
    private portraitSide: 1 | -1 = 1;
    /** 当前步的遮罩类型 —— 立绘遮挡只在 `hole` 步判（`full` / `none` 一律站着）。 */
    private currentMaskType: GuideMaskType = 'full';

    protected onLoad(): void {
        this.portraitSprite = this.portraitNode.getComponent(Sprite);
        this.nameText = this.nameLabelNode.getComponent(Label);
        this.contentText = this.contentLabelNode.getComponent(RichText);
        this.dimSprite = this.dimNode.getComponent(Sprite);
        this.hostTransform = this.node.getComponent(UITransform);
        this.hintTransform = this.mapHint.getComponent(UITransform);
        this.blockerTransform = this.blockerNode.getComponent(UITransform);
        this.dialogTransform = this.dialogBox.getComponent(UITransform);
        this.dialogWidget = this.dialogBox.getComponent(Widget);
        this.defaultDialogBottom = this.dialogWidget.bottom;
        this.node.on(Node.EventType.SIZE_CHANGED, this.onLayoutChanged, this);
        this.focusGraphics = this.focusRing.getComponent(Graphics);
        // prefab 里没有 UIOpacity 就补一个：描边呼吸只改这个值，不重建 Graphics 几何。
        this.ringOpacity = this.focusRing.getComponent(UIOpacity) ?? this.focusRing.addComponent(UIOpacity);
        this.focusMaskSprites = this.focusMasks.map(node => node.getComponent(Sprite));
        this.maskTransforms = this.focusMasks.map(node => node.getComponent(UITransform));
        this.schedule(this.resolveFocus, 0.25);
        this.blockerNode.on(Button.EventType.CLICK, this.onTap, this);
        // 焦点孔外的四块遮罩同时也是「孔外点击区」：点了等于点对话条（推进台词）。
        // Button 是 prefab 里挂好的（transition=NONE、target=null），代码只绑 CLICK；
        // 只有焦点真的存在时它们才 active，孔内没有任何遮挡 ⇒ 地图格子 / 弹窗按钮照常收点击。
        for (const mask of this.focusMasks) mask.on(Button.EventType.CLICK, this.onTap, this);
        this.debugSkipNode.active = DEBUG;
        if (DEBUG) this.debugSkipNode.on(Button.EventType.CLICK, this.onDebugSkipTap, this);
        // 弱引导（`none`）：屏幕上**没有**遮罩/Blocker 去接「点哪都收对话条」的活儿（那种步要玩家
        // 去点地块，铺满屏的点击区会把地块吃掉）⇒ 挂全局触摸，只读不吞（见 `onAnywhereTap`）。
        input.on(Input.EventType.TOUCH_END, this.onAnywhereTap, this);
        this.warnIfNotUiLayer();
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_END, this.onAnywhereTap, this);
    }

    /**
     * 弱引导「点任意地方收起对话条」（用户 2026-11-18 第 27 条：7-1 解锁地块）。
     *
     * 三条约束同时成立才动：
     * ① 只认 `maskType === 'none'` 的步 —— `full` / `hole` 的收起路径是遮罩与 Blocker，
     *    在那些步上再加一只手会把「点对话条推进台词」变成一碰就关；
     * ② 点的是**对话条以外**的地方 —— 落在对话条上就交给 `onTap` 正常逐句推进；
     * ③ 本层真的在显示、而且这一步的台词还没收。
     *
     * ⚠️ 走 `input` 而不是加节点：Cocos 的 UI 事件命中即止，在引导层铺一块全屏点击区会把
     * 「可以点其他地块」这条要求直接废掉。全局 `input` 监听不消费触摸，地块照常收到点击
     * （`VScrollView` 的 `_onGlobalTouchEnd` 也是同一个用法）。
     */
    private onAnywhereTap(event: EventTouch): void {
        if (this.currentMaskType !== 'none' || !this.node.activeInHierarchy) return;
        if (this.dialogClosed || !this.dialogBox.active) return;
        const box = this.dialogTransform.getBoundingBoxToWorld();
        if (box.contains(event.getUILocation())) return;
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        this.dismissDialog();
    }

    private setNodeSize(node: Node, width: number, height: number): void {
        node.getComponent(UITransform).setContentSize(width, height);
    }

    /**
     * 层级自检：`prefab_lifecycle create` 会把节点 layer 从 UI_2D(33554432) 改成 DEFAULT(1073741824)，
     * 而 UI 相机只渲染 UI_2D ⇒ 表现为「日志全打、界面全空、零报错」。这条 warn 就是给那个现场用的。
     */
    private warnIfNotUiLayer(): void {
        const want = Layers.Enum.UI_2D as unknown as number;
        if (this.node.layer === want) return;
        console.warn(`[GuideDialog] 节点 layer=${this.node.layer} 不是 UI_2D(${want})，UI 相机不会渲染它`);
        this.node.layer = want;
        for (const child of this.node.children) child.layer = want;
    }

    /**
     * 遮罩样式：**只改 alpha**。颜色、白图、尺寸全在 prefab 里（走 MCP），代码不重复配。
     *
     * 为什么这部分进不了 prefab：`maskType` 是运行时数据（每步不同），同一个 `Dim`
     * 在 full 步要 60%、hole 步要 40% —— 静态资源撑不住这种切换。
     * `none`（弱引导）直接 0：连压暗都不要，节点显隐交给 `placeFocusRing` 统一管。
     */
    private applyMaskStyle(maskType: GuideMaskType): void {
        const dim = this.dimSprite;
        const color = dim.color.clone();
        color.a = maskType === 'none' ? 0 : maskType === 'hole' ? HOLE_MASK_ALPHA : FULL_MASK_ALPHA;
        dim.color = color;
        for (const sprite of this.focusMaskSprites) sprite.color = color;
        this.layoutBlocker();
    }

    /** 只按配置的焦点标识定位；没有焦点的对话步骤不显示操作手指。 */
    private applyHints(state: IGuideViewState): void {
        this.focusKey = state.focusNode;
        this.focusTarget = null;
        this.focusTransform = null;
        // 换步 ⇒ 立刻可以再问一次（上一步的节流不该拖住这一步）。
        this.focusRetryAt = 0;
        this.tapHint.active = state.completeCond === 'click' && !state.focusNode;
        this.mapHint.active = false;
        this.focusRing.active = false;
        this.focusHand.active = false;
        this.animationStartedAt = Date.now();
        this.tapHint.setScale(1, 1, 1);
        this.mapHint.setScale(1, 1, 1);
        this.focusHintText.string = state.focusNode === 'Battle/DrawnCard' ? '当前抽到的卡牌' : state.requireAction === 'drag'
            ? '拖拽卡牌到指定格子' : state.focusNode.startsWith('Map/Chest') ? '点击打开宝箱'
            // 关卡地块（5-1）：文案说「点击关卡」而不是「点击高亮区域」—— 那一步要玩家花银币进战斗，
            // 泛指的「高亮区域」在地图上有一堆同款光圈，读起来不知道该点哪个。
            : state.focusNode.startsWith('Map/Level') ? '点击关卡'
            : state.focusNode.startsWith('Map/Tile') ? '点击地图上的地块'
            // 8-1：高亮底栏的任务入口，让玩家自己点开主线任务面板（不再由引导代开）。
            : state.focusNode === 'Main/TaskEntry' ? '点击任务入口' : '点击高亮区域';
        this.resolveFocus();
        this.layoutBlocker();
    }

    /** 当前焦点目标还有效（节点活着且真的在树上）。 */
    private hasLiveFocus(): boolean {
        const target = this.focusTarget;
        return !!target && target.node.isValid && target.node.activeInHierarchy;
    }

    /**
     * 目标晚到就再要一次（节流到 {@link FOCUS_RETRY_INTERVAL_MS}）。
     *
     * 只解决「该有的目标还没出现」：拿到就对齐并返回 true（`resolveFocus` 内部已跑过
     * `placeFocusRing`）；拿不到返回 false，调用方照常按「暂无焦点」摆。
     */
    private reacquireFocus(): boolean {
        if (!this.focusProvider) return false;
        const now = Date.now();
        if (now < this.focusRetryAt) return false;
        this.focusRetryAt = now + FOCUS_RETRY_INTERVAL_MS;
        this.resolveFocus();
        return this.hasLiveFocus();
    }

    private readonly resolveFocus = (): void => {
        const target = this.focusKey && this.focusProvider ? this.focusProvider(this.focusKey) : null;
        this.focusTarget = target;
        this.focusTransform = target ? target.node.getComponent(UITransform) : null;
        this.focusExtra = target?.extra ?? NO_FOCUS_EXTRA;
        this.focusClips.length = 0;
        if (target) {
            for (let parent = target.node.parent; parent; parent = parent.parent) {
                if (parent.getComponent(Mask)) this.focusClips.push(parent.getComponent(UITransform));
            }
        }
        if (target && this.focusTransform) {
            const hex = target.shape === 'hex';
            this.focusWidth = hex ? HEX_GRID_FACE_WIDTH : this.focusTransform.width + 8;
            this.focusHeight = hex ? HEX_GRID_FACE_HEIGHT : this.focusTransform.height + 8;
            // 逻辑尺寸（地块自身那一块）：孔被附加节点撑大之后，逐帧算四角**必须**还用它，
            // 否则第二帧就拿「上一帧的并集尺寸」去推屏幕尺寸，越滚越大。
            this.focusBaseWidth = this.focusWidth;
            this.focusBaseHeight = this.focusHeight;
            // 描边的形状（六边形 / 圆角矩形）跟着焦点类型走；**尺寸**由 `placeFocusRing` 定
            // —— 有附加节点时孔要被撑大（关卡编号气泡要一起圈住），在那里才算得出来。
            this.focusShapeHex = hex;
        }
        this.placeFocusRing();
    };

    private placeFocusRing(): void {
        const target = this.focusTarget;
        const transform = this.focusTransform;
        let visible = false;
        let dialogBottom = this.defaultDialogBottom;
        // 孔的半宽半高要带出 if 块给立绘遮挡判定用（`syncPortraitSuppression`）。
        let focusHalfWidth = 0;
        let focusHalfHeight = 0;
        if (target && transform && target.node.isValid && target.node.activeInHierarchy) {
            // 控件的可视中心可能不在锚点；六边形还要包含格面的内容偏移。
            this.focusCorner.set((0.5 - transform.anchorX) * transform.width,
                (0.5 - transform.anchorY) * transform.height + (target.shape === 'hex' ? HEX_GRID_CONTENT_LIFT : 0), 0);
            transform.convertToWorldSpaceAR(this.focusCorner, this.focusWorld);
            this.hostTransform.convertToNodeSpaceAR(this.focusWorld, this.focusLocal);
            this.focusCorner.x += this.focusBaseWidth / 2;
            this.focusCorner.y += this.focusBaseHeight / 2;
            transform.convertToWorldSpaceAR(this.focusCorner, this.focusEdgeWorld);
            this.hostTransform.convertToNodeSpaceAR(this.focusEdgeWorld, this.focusCorner);
            let halfWidth = Math.abs(this.focusCorner.x - this.focusLocal.x);
            let halfHeight = Math.abs(this.focusCorner.y - this.focusLocal.y);
            // 装饰框的留白可以越过边缘，控件本身仍完整可见（如贴底的英雄页签）。
            const contentRatioX = target.shape === 'hex' ? 1 : transform.width / this.focusBaseWidth;
            const contentRatioY = target.shape === 'hex' ? 1 : transform.height / this.focusBaseHeight;
            const limitX = this.hostTransform.width / 2 - halfWidth * contentRatioX;
            const limitY = this.hostTransform.height / 2 - halfHeight * contentRatioY;
            visible = halfWidth > 0 && halfHeight > 0 && Number.isFinite(this.focusLocal.x) && Number.isFinite(this.focusLocal.y)
                && Math.abs(this.focusLocal.x) <= limitX && Math.abs(this.focusLocal.y) <= limitY;
            for (const clip of this.focusClips) {
                clip.convertToNodeSpaceAR(this.focusWorld, this.clipCenter);
                clip.convertToNodeSpaceAR(this.focusEdgeWorld, this.clipCorner);
                const x = this.clipCenter.x, y = this.clipCenter.y;
                const dx = Math.abs(this.clipCorner.x - x) * contentRatioX;
                const dy = Math.abs(this.clipCorner.y - y) * contentRatioY;
                if (x - dx < -clip.anchorX * clip.width || x + dx > (1 - clip.anchorX) * clip.width
                    || y - dy < -clip.anchorY * clip.height || y + dy > (1 - clip.anchorY) * clip.height) visible = false;
            }
            if (visible) {
                // 附加节点（关卡编号气泡）一起圈进来：孔、光圈、四块遮罩全按整组的外接矩形走。
                const merged = this.unionWithExtras(halfWidth, halfHeight);
                if (merged) {
                    this.focusLocal.set(merged.x, merged.y, 0);
                    halfWidth = merged.halfWidth;
                    halfHeight = merged.halfHeight;
                    // 并集是「屏幕上的矩形」⇒ 描边直接按它画，缩放回到 1（不再拿地块的逻辑尺寸去放大）。
                    this.focusWidth = merged.halfWidth * 2;
                    this.focusHeight = merged.halfHeight * 2;
                    this.focusShapeHex = false;
                } else {
                    // 没有附加节点（或气泡刚好不显示）⇒ 一切都回到地块自身的逻辑尺寸。
                    this.focusWidth = this.focusBaseWidth;
                    this.focusHeight = this.focusBaseHeight;
                    this.focusShapeHex = target.shape === 'hex';
                }
                this.drawFocusShape();
                this.focusScaleX = halfWidth * 2 / this.focusWidth;
                this.focusScaleY = halfHeight * 2 / this.focusHeight;
                // ⚠️ 这里是**每帧**跑的对齐（相机/父节点可能在动），所以四件事都先比较再写：
                // · `setPosition` / `setContentSize` 不比较就写，等于每帧把四条遮罩的 Sprite 顶点、
                //   光圈与手指的 transform 全部标脏重建 —— 手指的呼吸动画就会一卡一卡（用户实测反馈）。
                // · 缩放与手指浮动**不在这里写**：它们由 `update` 的呼吸每帧统一下发，两边都写会互相覆盖。
                if (!this.focusRing.position.equals(this.focusLocal)) this.focusRing.setPosition(this.focusLocal);
                const hintWidth = this.hintTransform.width;
                const hintLimitX = (this.hostTransform.width - hintWidth) / 2 - 12;
                const hintX = Math.max(-hintLimitX, Math.min(hintLimitX, this.focusLocal.x));
                const hintY = Math.min(this.focusLocal.y + halfHeight + HINT_ABOVE_FOCUS, this.hostTransform.height / 2 - 100);
                const hint = this.mapHint.position;
                if (hint.x !== hintX || hint.y !== hintY) this.mapHint.setPosition(hintX, hintY, 0);
                this.layoutFocusMasks(this.focusLocal.x, this.focusLocal.y, halfWidth, halfHeight);
                dialogBottom = guideDialogBottom(this.hostTransform.height, this.dialogTransform.height,
                    this.defaultDialogBottom, this.focusLocal.y, halfHeight);
                focusHalfWidth = halfWidth;
                focusHalfHeight = halfHeight;
            }
        }
        // 弱引导（`none`）：**不压暗、不挡点击、不弹气泡文案**，只留光圈 + 手指。
        // 这几步等的是玩家在世界里点地块，压暗会把手感做坏，气泡又和手指说的是同一件事。
        const noMask = this.currentMaskType === 'none';
        const noHint = HINT_HIDDEN_PREFIXES.some((prefix) => this.focusKey.startsWith(prefix));
        const changed = this.focusRing.active !== visible;
        this.focusRing.active = visible;
        this.focusHand.active = visible;
        this.mapHint.active = visible && !noMask && !noHint;
        const waitingForBattleFocus = !visible && (this.focusKey.startsWith('Battle/') || this.focusKey.startsWith('BattleResult/'));
        // 「孔外点哪都算点对话条」只对**靠点击推进**的步成立（判据集中在 `needsFullScreenBlock`）。
        //
        // 🔴 其余步（翻地块 / 点宝箱 / 抽卡 / 开战）等的是**世界里的动作**：此刻焦点要是没解析出来
        // （宝箱还没冒出来、格子挪出视口、只剩一格可点却已变成另一种状态），铺满屏的点击区就把玩家
        // 唯一能点的目标一起挡住了 —— 表现为「点屏幕任意地方无反馈」，整条引导死在这里（2-2 踩过）。
        // 宁可在这一小段时间不挡：玩家还能拖地图、点格子，等焦点一出来光圈照常接管。
        const fullBlock = this.needsFullScreenBlock();
        this.dimNode.active = !noMask && fullBlock;
        // 光圈等到了才开口（`narrationPending`）：同一帧把第一句放出来，对话条跟着亮。
        // 这里而不是 `render` 里判，因为焦点可能比这一步晚好几拍才解析出来（地块还在建）。
        if (visible && this.narrationPending) {
            this.narrationPending = false;
            this.playLine(0);
        }
        const awaitingNarration = this.narrationPending && !visible;
        const boxWasActive = this.dialogBox.active;
        this.dialogBox.active = !waitingForBattleFocus && !awaitingNarration
            && !this.dialogClosed && this.queue.length > 0;
        // 🔴 **对话条没了就没有立绘**：两者是同一条演出，分开显隐会在屏幕上留一个「光杆角色」。
        //
        // 收对话条的口子不止一处（点哪都收 / 空台词 / 等光圈 / 战斗焦点 / 被弹窗顶掉），
        // 谁漏一句 `hidePortrait()` 都表现为「台词已经说完，角色还杵在右下角」
        // （用户 2026-11-18 现场：7-1 弱引导把对话条点掉了，豌豆游侠还在）。这里逐帧兜底，
        // 让「立绘的画不画」只由这一个判据决定。
        //
        // 判据用 `portraitShown`（这句有立绘）+ `npcNode.active`（骨骼实例还亮着，见 `hide()` 的坑），
        // **不能**看 `portraitNode.active`：prefab 里那个宿主默认就是 true，空 SpriteFrame 什么都不画，
        // 按它判会变成每帧白写一遍 `spriteFrame = null`。
        if (!this.dialogBox.active && (this.portraitShown || this.npcNode?.active)) this.hidePortrait();
        // 点击区：**至少要盖住对话条自己**。
        //
        // 旧口径是 `!noMask && (visible || fullBlock)`：孔没解析出来、又不是「靠点对话条推进」的步，
        // 三样东西同时不在（无孔 ⇒ 四块遮罩全关；`fullBlock` false ⇒ Blocker 关；`noMask` 的弱引导
        // 更是整条关掉）⇒ 对话条变成**死区**：点它没反应，8s 超时推到末句也收不掉，
        // 一直钉在屏幕底部（用户 2026-11-17 第 19 条现场：6-2 卡牌页，`CardList/Card_68001` 没解析出来）。
        //
        // 现在只要有对话条就留一块点击区（尺寸见 `layoutBlocker`：不是 `fullBlock` 就只盖对话条），
        // 世界该能点的照旧能点 —— 2-2 宝箱 / 6-2 卡牌 / 7-1 地块踩过的整屏拦截不会再回来。
        this.blockerNode.active = fullBlock || this.dialogBox.active;
        for (const mask of this.focusMasks) mask.active = !noMask && visible;
        const dialogMoved = this.dialogWidget.bottom !== dialogBottom;
        // `Widget.bottom` 的 setter 无条件 `_recursiveDirty()`（引擎 widget.ts 的 442-445），
        // 值没变也写会让对话框每帧重排一次 ⇒ 只在真的位移时赋值。
        if (dialogMoved) this.dialogWidget.bottom = dialogBottom;
        // 对话条显隐一变就必须重排点击区：`layoutBlocker` 按「有没有对话条」在
        // 「只盖对话条 / 铺满整屏」之间切，漏这一次它就会带着上一步的整屏尺寸继续拦（2-2 那种死锁）。
        if (changed || dialogMoved || boxWasActive !== this.dialogBox.active) this.layoutBlocker();
        this.placePortrait();
        // 立绘让开孔：位置和孔都是这一帧刚算出来的，紧跟其后判（换步 / 地图滚动都吃得到）。
        this.syncPortraitSuppression(visible, focusHalfWidth, focusHalfHeight);
    }

    /**
     * 主焦点 + 附加节点的外接矩形（宿主本地坐标）；没有附加节点 / 全不可见 ⇒ `null`。
     *
     * 附加节点**跟着地图动**（关卡编号气泡挂在 `StationBadgeLayer`），所以每帧都算：
     * 地图一滚，气泡的世界位置就变了，孔也得跟着长。
     * 取「左下 / 右上」两个角换算到宿主空间再取 min/max —— 不假设节点没被旋转。
     */
    private unionWithExtras(halfWidth: number, halfHeight: number): IGuideFocusRect | null {
        if (!this.focusExtra.length) return null;
        const rects: IGuideFocusRect[] = [
            { x: this.focusLocal.x, y: this.focusLocal.y, halfWidth, halfHeight },
        ];
        for (const node of this.focusExtra) {
            if (!node || !node.isValid || !node.activeInHierarchy) continue;
            const transform = node.getComponent(UITransform);
            if (!transform) continue;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const [ax, ay] of [[-transform.anchorX, -transform.anchorY],
                [1 - transform.anchorX, 1 - transform.anchorY]] as const) {
                this.extraWorld.set(ax * transform.width, ay * transform.height, 0);
                transform.convertToWorldSpaceAR(this.extraWorld, this.extraCornerWorld);
                this.hostTransform.convertToNodeSpaceAR(this.extraCornerWorld, this.extraCornerLocal);
                minX = Math.min(minX, this.extraCornerLocal.x);
                maxX = Math.max(maxX, this.extraCornerLocal.x);
                minY = Math.min(minY, this.extraCornerLocal.y);
                maxY = Math.max(maxY, this.extraCornerLocal.y);
            }
            rects.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2,
                halfWidth: (maxX - minX) / 2, halfHeight: (maxY - minY) / 2 });
        }
        return unionGuideFocusRects(rects);
    }

    /**
     * 画光圈描边（六边形 / 圆角矩形）。
     *
     * 尺寸没变**不重画**：`Graphics.clear()` + `stroke()` 每帧跑一遍就是每帧重建顶点缓冲，
     * 和「手指呼吸卡顿」是同一类开销（见 `placeFocusRing` 的比较再写）。
     */
    private drawFocusShape(): void {
        if (this.focusShapeDrawn && this.focusShapeHex === this.focusShapeDrawnHex
            && this.focusShapeWidth === this.focusWidth && this.focusShapeHeight === this.focusHeight) return;
        this.focusShapeDrawn = true;
        this.focusShapeDrawnHex = this.focusShapeHex;
        this.focusShapeWidth = this.focusWidth;
        this.focusShapeHeight = this.focusHeight;
        const graphics = this.focusGraphics;
        const x = this.focusWidth / 2, y = this.focusHeight / 2;
        graphics.clear();
        if (this.focusShapeHex) {
            graphics.moveTo(-x, 0);
            graphics.lineTo(-x / 2, y);
            graphics.lineTo(x / 2, y);
            graphics.lineTo(x, 0);
            graphics.lineTo(x / 2, -y);
            graphics.lineTo(-x / 2, -y);
            graphics.close();
        } else graphics.roundRect(-x, -y, this.focusWidth, this.focusHeight, 8);
        graphics.stroke();
    }

    /** 四块 Sprite 拼出真实透亮的焦点孔；按钮消费孔外输入，孔内交给原控件。 */
    private layoutFocusMasks(x: number, y: number, halfWidth: number, halfHeight: number): void {
        const width = this.hostTransform.width, height = this.hostTransform.height;
        const left = x - halfWidth, right = x + halfWidth, bottom = y - halfHeight, top = y + halfHeight;
        this.placeMask(0, 0, (height / 2 + top) / 2, width, height / 2 - top);
        this.placeMask(1, 0, (-height / 2 + bottom) / 2, width, bottom + height / 2);
        this.placeMask(2, (-width / 2 + left) / 2, y, left + width / 2, halfHeight * 2);
        this.placeMask(3, (width / 2 + right) / 2, y, width / 2 - right, halfHeight * 2);
    }

    private placeMask(index: number, x: number, y: number, width: number, height: number): void {
        const node = this.focusMasks[index];
        const size = this.maskTransforms[index];
        const w = Math.max(0, width), h = Math.max(0, height);
        const pos = node.position;
        if (pos.x !== x || pos.y !== y) node.setPosition(x, y, 0);
        // 尺寸没变就不写：`setContentSize` 会触发 Sprite 重算渲染数据，每帧四块 = 每秒 240 次重建。
        if (size.width !== w || size.height !== h) size.setContentSize(w, h);
    }

    /**
     * 每帧只做两件事：把几何「对齐」到当前焦点、把呼吸动画写下去。
     *
     * ⚠️ 分工必须清楚（2026-11-16 修「手指呼吸卡顿」时定的）：
     * · 位置/尺寸这类**几何**归 `placeFocusRing`，它内部逐项比较后才写节点；
     * · **呼吸**（气泡缩放、光圈脉动、手指浮动）只在这里写 —— 每帧必写是它的本分。
     * 早先两边都写同一批属性，等于每帧把四条遮罩的 `contentSize` 重设一遍
     * （每次都会让 Sprite 重建顶点缓冲），动画就一卡一卡。
     */
    protected update(): void {
        if (this.focusKey) {
            // 目标晚到（底栏那几帧还没亮 / 地块节点在重建）⇒ 按间隔再问一次业务侧；
            // 问到了 `resolveFocus` 内部已经对齐过，这里别重复跑一遍 `placeFocusRing`。
            if (this.hasLiveFocus() || !this.reacquireFocus()) this.placeFocusRing();
        }
        const motion = guideHintMotion(this.animationStartedAt, Date.now());
        const hint = this.tapHint.active ? this.tapHint : this.mapHint.active ? this.mapHint : null;
        if (hint) hint.setScale(motion.hintScale, motion.hintScale, 1);
        if (this.focusHand.active) {
            this.focusHand.setPosition(this.focusRing.position.x,
                this.focusRing.position.y + motion.handLift, 0);
            this.focusRing.setScale(this.focusScaleX * motion.hintScale, this.focusScaleY * motion.hintScale, 1);
            // 描边呼吸：透明度跟着同一个波走（缩放之外再给一层「一明一暗」）。
            const alpha = Math.round(RING_ALPHA_MAX * motion.ringAlpha);
            if (this.ringOpacity.opacity !== alpha) this.ringOpacity.opacity = alpha;
        }
    }

    /**
     * 这一刻要不要「整屏都算点对话条」。
     *
     * 只对**靠点对话条推进**的步成立（`completeCond === 'click'`）：孔没就绪、又不是战斗焦点时
     * 必须铺满屏，漏一条缝玩家就点到主界面底栏去了。
     *
     * ⚠️ 判据只能读 `focusRing.active`（= 这一刻有没有孔），不能读 `focusKey`：焦点还没解析出来时
     * 孔并不存在，按 key 判会把整屏点击漏下去，而该步又要等玩家点地块，等于两头都卡死。
     */
    private needsFullScreenBlock(): boolean {
        if (this.focusRing.active) return false;
        if (!this.canAdvance || this.dialogClosed || this.queue.length === 0) return false;
        return !this.focusKey.startsWith('Battle/') && !this.focusKey.startsWith('BattleResult/');
    }

    /**
     * 点击区布局。
     *
     * 有三种情形：
     * ① **靠点对话条推进、孔还没就绪** ⇒ 铺满整屏：需求是「对话框出现时屏蔽其他点击，
     *    点哪都等于点对话条」；这一条优先于「只盖对话条」，否则整屏会漏给底栏。
     * ② **有焦点孔，或有对话条但不该铺满屏**（等世界动作的步：宝箱 / 卡牌 / 地块）⇒
     *    只守对话条自己那一块。孔外交给四块遮罩（都绑了 CLICK → `onTap`，见 `onLoad`），
     *    孔内不放任何遮挡；对话条那一块必须能点，否则就是个**死区**（第 19 条）。
     * ③ 既没有孔、也没有对话条 ⇒ 按 ① 的尺寸铺满（此时 `blockerNode.active` 多半是 false，
     *    尺寸留着只是为了下一帧不必重算）。
     * ⚠️ 因此**不能按 `maskType === 'hole'` 判**：焦点未就绪时孔并不存在，那样整屏点击会漏下去。
     */
    private layoutBlocker(): void {
        const node = this.blockerNode;
        if (!this.needsFullScreenBlock() && (this.focusRing.active || this.dialogBox.active)) {
            // 位置/尺寸直接取 `DialogBox` 的实际值，不写死 —— 对话条改了尺寸这里自动跟上。
            this.dialogWidget.updateAlignment();
            const box = this.dialogTransform;
            node.setPosition(this.dialogBox.position);
            this.blockerTransform.setContentSize(box.width, box.height);
            return;
        }

        // full：铺满宿主。取自己（Widget 已撑满父级）的 contentSize，而不是写死 720×1280 ——
        // 长屏设备上写死会在上下留出点不到的死区（视觉上的 Dim 已由 Widget 覆盖全屏）。
        node.setPosition(0, 0, 0);
        this.blockerTransform.setContentSize(this.hostTransform.width, this.hostTransform.height);
    }

    private readonly onLayoutChanged = (): void => {
        this.placeFocusRing();
        this.layoutBlocker();
    };

    private onDebugSkipTap(): void {
        const now = Date.now();
        if (now - this.debugSkipAt > 1200) this.debugSkipTaps = 0;
        this.debugSkipAt = now;
        this.debugSkipTaps += 1;
        if (this.debugSkipTaps < 5) return;
        this.debugSkipTaps = 0;
        console.log('[GuideDialog] 连点 5 次 → 强制跳过整条引导');
        EventMgr.instance.emit(GuideDebugEvent.ForceSkip);
    }


    /** 组合层按焦点标识交付真实节点；视图不查业务状态或猜节点路径。 */
    setFocusProvider(provider: (key: string) => IGuideFocusTarget | null): void {
        this.focusProvider = provider;
    }

    /** 注入台词与立绘帧。重复调用只覆盖数据，不重复绑事件。 */
    initialize(
        groups: ReadonlyMap<string, readonly GuideDialogLine[]>,
        frames: ReadonlyMap<string, SpriteFrame | Prefab>,
    ): void {
        this.groups = groups;
        this.frames = frames;
    }

    /**
     * 按 Controller 的状态刷新。
     *
     * 点击推进由 completeCond 决定，通过带实例和步骤作用域的事件报告。
     */
    render(state: IGuideViewState): void {
        if (state.finished) {
            this.hide();
            return;
        }
        // 换步时上一步的台词还没播完 ⇒ 先把话说完再换画面（见 `shouldHoldForDialog`）。
        if (this.shouldHoldForDialog(state)) {
            this.pendingState = state;
            return;
        }
        this.pendingState = null;

        // 显隐控制挂在自己身上（root 绑的就是本节点）：整层实例由组合层 addChild，
        // 没引导时置 active=false，不遮挡主界面。
        this.node.active = true;
        this.currentMaskType = state.maskType;
        this.stepId = state.stepId;
        this.queue = this.groups.get(state.dialogId) ?? [];
        this.index = 0;
        // 换步就是「重新开口」：上一步收起的对话条必须在下面按 queue 重新判一次显隐。
        this.dialogClosed = false;

        // 真机上唯一能证明"对话层真的出来了"的证据。组缺失是最常见的静默失败
        // （表现为黑屏没字），单独打一条 warn，别和正常路径混在一起。
        // `dialogId` 为空是表里的**纯引导步**（只出手指 + 气泡，例如「点击打开宝箱」），不是失败。
        if (this.queue.length === 0) {
            if (state.dialogId) {
                console.warn(`[GuideDialog] 步 ${state.stepId} 找不到台词组 ${state.dialogId}，对话条将不可见`);
            } else {
                console.log(`[GuideDialog] 步 ${state.stepId}(${state.flowName}) · 无台词 · 遮罩 ${state.maskType}`);
            }
        } else {
            console.log(`[GuideDialog] 步 ${state.stepId}(${state.flowName}) · 台词 ${state.dialogId} · ${this.queue.length} 句 · 遮罩 ${state.maskType}`);
        }
        // 判据是 completeCond === 'click'，不是 requireAction。
        // requireAction 只说玩家要做一个动作，拿它当「点对话条就推进」会误推带参步。
        // ⚠️ 必须在 `applyHints` **之前**赋值：`applyHints` 内部会 `resolveFocus` → `placeFocusRing`，
        // 而后者要按它决定「这一刻该不该铺满屏点击区」；无台词的步更是只走这一次（下面直接 return）。
        this.canAdvance = state.completeCond === 'click';
        // 关卡地块的步（`5-1`）：这一格能不能点由业务侧决定（要「可花银币解锁」，不能顶锁标），
        // 光圈解析不出来就先别开口 —— 判据集中在 `waitsForLevelFocus`。
        this.narrationPending = this.waitsForLevelFocus(state);
        this.applyMaskStyle(state.maskType);
        this.applyHints(state);

        if (this.queue.length === 0) {
            // 没有台词（或表没打进包）：藏对话条，只留遮罩/立绘，等业务事件。
            this.dialogBox.active = false;
            this.nameText.string = '';
            this.contentText.string = '';
            // 纯引导步不该继承上一步的立绘 —— 那是「刚说完话的人」站在屏幕中间，谁都不是。
            this.hidePortrait();
            return;
        }
        if (this.narrationPending) {
            // 等光圈：台词留在 `queue` 里，等 `placeFocusRing` 探到焦点那一刻才 `playLine(0)`。
            // 这里**不能** arm 8s 计时 —— 还没开口就被「自动推进」耗掉，玩家永远看不到那句话。
            this.dialogBox.active = false;
            this.nameText.string = '';
            this.contentText.string = '';
            this.hidePortrait();
            this.layoutBlocker();
            return;
        }
        this.dialogBox.active = true;
        this.playLine(0);
        this.placeFocusRing();
    }

    hide(): void {
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        this.node.active = false;
        this.queue = [];
        this.index = 0;
        this.canAdvance = false;
        this.dialogClosed = false;
        this.pendingState = null;
        this.narrationPending = false;
        // 🔴 立绘也得真收掉：这一层只是 `node.active = false`，骨骼实例（`npcNode`）是**建一次复用**的，
        // 只清标记不收节点，下次 `render` 重新开层时会先亮出一个「上一句的角色」
        // （用户 2026-11-18：对话条已经没了，角色还杵在右下角）。
        // `portraitSprite` 是 `onLoad` 里取的，本方法可能先于 `onLoad` 被调（引导已结束时首帧就 hide）。
        if (this.portraitSprite) this.hidePortrait();
        this.portraitShown = false;
        this.portraitSuppressed = false;
        this.stepId = '';
        this.focusKey = '';
        this.focusTarget = null;
        this.focusTransform = null;
    }

    /**
     * 这一步要不要「等手指落下去再开口」。
     *
     * 只认**关卡地块**（`Map/Level_*`）+ **不靠点对话条推进**的步（`5-1`）：
     * 那格子的「可花银币解锁（前置满足）」状态由业务侧决定，锁着的时候
     * `guideMapFocusCells` 返回空集、光圈解析不出来（用户 2026-11-18 第 24 条）。
     * 台词先说就等于对着挂锁的格子发号令，8s 后还会被自动推进吃掉。
     *
     * ⚠️ `completeCond === 'click'` 的步**不能等**：对话条是它唯一的推进手段，等了就死
     * （这也是 `!this.canAdvance` 这一条的原因）。
     */
    private waitsForLevelFocus(state: IGuideViewState): boolean {
        return !this.canAdvance && state.focusNode.startsWith('Map/Level');
    }

    /**
     * 换步要不要先等台词说完。
     *
     * 🔴 战斗里那张「抽到的卡」只活 **1.156s**（`ZC_CARD_REVEAL_SECONDS`）：卡牌一消失就上报
     * `cardRevealFinished`，`5-3` 立刻完成、切到 `5-4`，而 `5-4` 自己没有台词 ⇒ 视图当场把
     * D06 那 3 句（「看，这是刚抽到的卡牌…」）拆掉，玩家连第一句都没读完
     * （用户 2026-11-17 第 20 条：「战斗中的引导对话自动关闭太快」）。
     *
     * 判据收得很窄，三条同时成立才拦：
     * ① **这一步的焦点在战斗里**（`Battle/*`）—— 完成判定来自战斗内的动画，不是玩家点出来的；
     *    玩家自己点出来的换步（5-1 点关卡地块 → 5-2）立刻切，别让台阶变慢；
     * ② **新的一步自己没有台词** —— 那组比这组的剩余更该播；否则会把下一步的推进点击顶掉
     *    （6-2 点卡 → 6-3，玩家在挡住这段时间里点「升级」，`cardLevelUp` 会落在旧步上被丢掉）；
     * ③ 这一步确实还有没播完 / 没收起的台词。
     * 挡住的时间上限 = 剩余句数 × 8s（`IDLE_ADVANCE_SECONDS`），玩家随时可以点掉。
     */
    private shouldHoldForDialog(state: IGuideViewState): boolean {
        if (state.stepId === this.stepId) return false;
        if (state.dialogId) return false;
        if (!this.focusKey.startsWith('Battle/')) return false;
        return this.queue.length > 0 && !this.dialogClosed;
    }

    /** 被挡住的换步在台词收起后补上；只重放**最新**那份状态，避免把中间态画出来。 */
    private flushPendingState(): void {
        const pending = this.pendingState;
        if (!pending) return;
        this.pendingState = null;
        this.render(pending);
    }

    // 内部实现

    /**
     * 点击：先逐句推进；最后一句再点，click 步报告推进意图，其余步收起对话条。
     *
     * 最后一句必须有个去处：`completeCond` 不是 `click` 的步（翻地块 / 抽卡 / 确认按钮）
     * 早先「点了没反应」，对话条就常驻在屏幕底部，玩家以为还要继续点，
     * 实际该做的是点光圈里那个目标 —— 现在点最后一句就收起对话条，进入强制引导。
     */
    private onTap(): void {
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        if (this.index + 1 < this.queue.length) {
            this.playLine(this.index + 1);
            return;
        }
        if (this.canAdvance) {
            this.canAdvance = false;
            EventMgr.instance.emit(GuideEvent.Advance, { stepId: this.stepId });
            return;
        }
        this.dismissDialog();
    }

    /**
     * 收起对话条，只留光圈 / 手指 / 气泡。
     *
     * 旧判据是「没有孔就不许收」（怕玩家既没字看、也没东西可点）。可**焦点解析不出来的步**
     * —— 6-2 卡牌页的 `CardList/Card_68001` 就是 —— 就此永远收不掉：玩家点不掉、8s 超时那条
     * 也点不掉，对话条一直钉在屏幕底部（用户 2026-11-17 第 19 条）。
     *
     * 现在没有孔时整屏本来就不拦（见 `placeFocusRing` 的 `blockerNode.active`），世界完全可交互
     * ⇒ 收起对话条只会让玩家更自由。真正「没东西可点」的只有「靠点对话条推进」的步，
     * 而那一类在 `onTap` 里走的是 `Advance`，根本不会进到这里。
     */
    private dismissDialog(): void {
        if (this.dialogClosed || this.canAdvance) return;
        this.dialogClosed = true;
        this.dialogBox.active = false;
        // 不等下一帧 `placeFocusRing`：这块点击区刚把台词收走，再多留一帧就会白吃一次点击
        // （玩家的感受就是「点了没反应」——同一类现场）。
        this.blockerNode.active = false;
        this.hidePortrait();
        this.layoutBlocker();
        // 换步被这组台词挡住的，这一刻补上（战斗里 `5-3 → 5-4` 就靠它：卡牌 1.156s 就没了，
        // 步骤早完成，画面等台词说完才切）。
        this.flushPendingState();
    }

    private playLine(index: number): void {
        this.index = index;
        const line = this.queue[index];
        if (!line) return;
        this.nameText.string = line.speaker;
        this.contentText.string = formatGuideContent(line.content);
        this.applyPortrait(line.speaker);
        // 日志报实际显示状态：`hole` 步挡住孔时会被临时收起。
        const portraitVisible = this.portraitNode.active
            && (!!this.portraitSprite.spriteFrame || this.npcNode?.active === true);
        console.log(`[GuideDialog] 播 ${line.id} · ${line.speaker} · 立绘=${portraitVisible ? '显示' : '隐藏'} · ${line.content.length} 字`);
        this.armIdleTimer();
    }

    /**
     * 起 / 重置「无人点击自动推进」计时。
     *
     * 用 `scheduleOnce` 而不是自己记时间戳：组件失活（`node.active=false`）时 Cocos 会自动
     * 暂停调度，正好对上"走完引导 / 被隐藏时不推进"的语义，不用再判一次。
     */
    private armIdleTimer(): void {
        this.unschedule(this.onIdleTimeout);
        this.idleArmed = true;
        this.scheduleOnce(this.onIdleTimeout, IDLE_ADVANCE_SECONDS);
    }

    /** 超时：等价于点一下（逐句推进 / 最后一句走 advance）。 */
    private readonly onIdleTimeout = (): void => {
        if (!this.idleArmed) return;
        this.idleArmed = false;
        console.log(`[GuideDialog] ${IDLE_ADVANCE_SECONDS}s 无人操作，自动推进 · 句 ${this.index + 1}/${this.queue.length}`);
        this.onTap();
    };

    /**
     * 立绘右边贴住对话框右边框，脚点下沉到对话条后面；尺寸取绿框内含（见 {@link fitGuidePortrait}）。
     *
     * 两者都用 `DialogBox` 的**实际**尺寸算，不写死 660/184 —— 对话条改了大小，立绘跟着走。
     * 每帧被 `placeFocusRing` 顺带调用，值没变就别写。
     *
     * 左右由 {@link portraitSide} 决定：默认站右侧，孔压在右侧时改站左侧（见 `syncPortraitSuppression`）。
     */
    private placePortrait(): void {
        const x = this.portraitSide * this.portraitDropX();
        const foot = this.portraitFoot();
        const pos = this.portraitNode.position;
        if (pos.x !== x || pos.y !== foot) this.portraitNode.setPosition(x, foot, 0);
    }

    /** 立绘脚点（锚点 0.5/0）的 y：对话条上沿再往下沉 `PORTRAIT_SINK_RATIO`。 */
    private portraitFoot(): number {
        const dialogTop = -this.hostTransform.height / 2 + this.dialogWidget.bottom + this.dialogTransform.height;
        return dialogTop - this.portraitDisplayHeight * PORTRAIT_SINK_RATIO;
    }

    /** 立绘右对齐时相对屏幕中线的横向距离（`portraitSide` 乘它得到实际 x）。 */
    private portraitDropX(): number {
        return this.dialogTransform.width / 2 - this.portraitDisplayWidth / 2 - PORTRAIT_RIGHT_INSET;
    }

    /**
     * 切换立绘。静图换 SpriteFrame，按立绘盒（宿主宽 × 149/720、高 `portraitHeight`）contain 设尺寸；
     * 骨骼实例化一次后只切 active；未登记或加载失败时两个都藏起来。
     */
    private applyPortrait(speaker: string): void {
        const portrait = getGuidePortraitAsset(speaker);
        const sprite = this.portraitSprite;

        // 🔴 立绘藏不藏**不按 `maskType` 一刀切**（用户 2026-11-18 第 25 条）。
        //
        // 旧口径是「`hole` 步一律藏」，理由是「孔开在屏幕中部的地块 / 卡牌上，立绘正好罩住它」。
        // 但 6-3（升级按钮）的孔在**右下**、立绘在对话框上方靠右，两者根本不重叠 —— 那条口径
        // 白丢了「升级卡牌」这一整段的 NPC 形象（用户截图：立绘位置空着，只有气泡和手指）。
        // 真判据是**几何相交**：`placeFocusRing` 每帧按孔与立绘矩形判一次（见 `syncPortraitSuppression`），
        // 挡住才让开。`full` / `none` 步根本不压孔（前者暗层本来就把世界压住了，后者连暗层都没有），
        // 站着不动。
        const loaded = portrait ? this.frames.get(portrait.asset) ?? null : null;

        if (!portrait || !loaded) {
            this.hidePortrait();
            return;
        }

        if (portrait.kind === 'sprite') {
            if (this.npcNode) this.npcNode.active = false;
            const frame = loaded as SpriteFrame;
            sprite.node.active = true;
            sprite.enabled = true;
            sprite.spriteFrame = frame;
            // 尺寸由代码统一控制，必须用 CUSTOM；TRIMMED 会在换图时把节点拉回原图尺寸。
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            const raw = frame.originalSize;
            const size = fitGuidePortrait(raw.width, raw.height, this.portraitBoxWidth(), this.portraitHeight);
            const width = Math.round(size.width);
            const height = Math.round(size.height);
            this.setNodeSize(sprite.node, width, height);
            this.portraitDisplayWidth = width;
            this.portraitDisplayHeight = height;
            this.portraitShown = true;
            // 上一句可能正被「挡孔」压着 / 让到左边，换图后先站回右侧，这一帧末尾的
            // `placeFocusRing` 会重判（重判之后才轮到「换边 / 收起」）。
            this.portraitSuppressed = false;
            this.portraitSide = 1;
            this.placePortrait();
            return;
        }

        sprite.spriteFrame = null;
        // 骨骼挂在同一宿主下，只关静图组件，不能关掉父节点。
        sprite.enabled = false;
        sprite.node.active = true;
        const npc = this.ensureNpc(loaded as Prefab);
        npc.active = true;
        this.portraitShown = true;
        this.portraitSuppressed = false;
        this.portraitSide = 1;
        // 骨骼节点只建一次，但宿主宽度可能变化，显示尺寸每次都要重算。
        this.fitNpc();
        this.placePortrait();
    }

    private hidePortrait(): void {
        this.portraitSprite.spriteFrame = null;
        this.portraitSprite.node.active = false;
        if (this.npcNode) this.npcNode.active = false;
        this.portraitDisplayWidth = 0;
        this.portraitDisplayHeight = 0;
        // 这一句本来就没有立绘 ⇒ 遮挡判定直接跳过（`syncPortraitSuppression` 看 `portraitShown`）。
        this.portraitShown = false;
        this.portraitSuppressed = false;
        this.portraitSide = 1;
    }

    /**
     * 立绘避让焦点孔（每帧由 `placeFocusRing` 末尾调）。
     *
     * 三级让位，**能不收就不收**（用户 2026-11-18 第 25 条：升级卡牌这段 NPC 形象整个丢了）：
     * ① 右侧站得下就站右侧（默认位置）；
     * ② 右侧压到孔 ⇒ 换到左侧站（6-3 的「升级」按钮就在右下，换边即可）；
     * ③ 两侧都压 ⇒ 才收起来（此时立绘确实没有落脚处）。
     *
     * 什么时候不参与判定：
     * · 孔没解析出来（`focusVisible === false`）—— 屏幕上没有孔可挡；
     * · `full` / `none` 步 —— 前者暗层已经把世界压住、后者连暗层都没有，立绘站着是设计要的。
     *
     * ⚠️ 必须每帧算：孔跟着地图滚动 / 卡牌列表翻动变，`render` 时算一次不够。
     */
    private syncPortraitSuppression(focusVisible: boolean, halfWidth: number, halfHeight: number): void {
        if (!this.portraitShown) return;
        if (!focusVisible || this.currentMaskType !== 'hole') {
            this.applyPortraitPlacement(1, false);
            return;
        }
        if (!this.portraitHitsFocus(halfWidth, halfHeight, 1)) this.applyPortraitPlacement(1, false);
        else if (!this.portraitHitsFocus(halfWidth, halfHeight, -1)) this.applyPortraitPlacement(-1, false);
        else this.applyPortraitPlacement(this.portraitSide, true);
    }

    /** 落地一次摆放决定：左右位 / 收不收，值没变就什么都不写（这个函数逐帧被调）。 */
    private applyPortraitPlacement(side: 1 | -1, suppress: boolean): void {
        if (side === this.portraitSide && suppress === this.portraitSuppressed) return;
        this.portraitSide = side;
        this.portraitSuppressed = suppress;
        // 骨骼挂在 `portraitNode` 下面 ⇒ 关宿主静图与骨骼一起走，不用分别处理。
        this.portraitNode.active = !suppress;
        this.placePortrait();
    }

    /**
     * 立绘盒站在某一侧时，是否与焦点孔相交。
     *
     * 立绘宿主锚点 0.5/0、脚点在原点 ⇒ 矩形 = `[x − w/2, x + w/2] × [y, y + h]`；
     * 孔是 `focusLocal` 为中心的 `2×halfWidth` / `2×halfHeight`。留 {@link PORTRAIT_FOCUS_GAP} 的余量。
     */
    private portraitHitsFocus(halfWidth: number, halfHeight: number, side: 1 | -1): boolean {
        const width = this.portraitDisplayWidth;
        const height = this.portraitDisplayHeight;
        if (!(width > 0) || !(height > 0)) return false;
        const gap = PORTRAIT_FOCUS_GAP;
        const x = side * this.portraitDropX();
        const y = this.portraitFoot();
        const overlapX = Math.abs(x - this.focusLocal.x) < halfWidth + width / 2 + gap;
        const overlapY = y < this.focusLocal.y + halfHeight + gap
            && y + height > this.focusLocal.y - halfHeight - gap;
        return overlapX && overlapY;
    }

    /** 建骨骼立绘，只建一次（尺寸不在这里定，见 {@link fitNpc}）。 */
    private ensureNpc(prefab: Prefab): Node {
        if (this.npcNode) return this.npcNode;
        const host = this.portraitNode;

        const node = instantiate(prefab);
        // 骨骼 prefab 的 layer 可能是 DEFAULT，UI 相机不认；跟着宿主走最稳。
        node.layer = host.layer;
        host.addChild(node);
        node.setPosition(0, 0, 0);
        this.npcNode = node;
        return node;
    }

    /**
     * 把骨骼按绑定框等比缩进立绘盒，并让脚点贴住立绘原点（锚点 0.5/0）。
     *
     * 和静图同一套口径：{@link fitGuidePortrait} 在「宿主宽 × {@link PORTRAIT_BOX_WIDTH_RATIO}」
     * 与 `portraitHeight` 组成的盒子内做 contain —— 骨骼绑定框（`skel/豌豆射手` 是 654×916）
     * 比立绘"胖"，只按高度缩会横向撑出绿框。
     *
     * 每次切回骨骼都按当前宿主宽度重算，不能沿用首次实例化时的尺寸。
     */
    private fitNpc(): void {
        const node = this.npcNode;
        if (!node) return;
        const spineNode = node.getChildByName(GUIDE_PORTRAIT_SPINE_NODE_NAME);
        if (!spineNode) {
            throw new Error(`GuideDialogView 骨骼立绘缺少固定子节点 ${GUIDE_PORTRAIT_SPINE_NODE_NAME}`);
        }
        const transform = spineNode.getComponent(UITransform);
        if (!transform) {
            throw new Error(`GuideDialogView 骨骼立绘的 ${GUIDE_PORTRAIT_SPINE_NODE_NAME} 节点缺少 UITransform`);
        }
        const rawWidth = transform.width;
        const rawHeight = transform.height;
        if (!(rawWidth > 0) || !(rawHeight > 0)) {
            throw new Error(`GuideDialogView 骨骼立绘尺寸无效：${rawWidth}×${rawHeight}`);
        }
        const size = fitGuidePortrait(rawWidth, rawHeight, this.portraitBoxWidth(), this.portraitHeight);
        const scale = size.height / rawHeight;
        node.setScale(scale, scale, 1);
        node.setPosition(0, transform.anchorY * size.height, 0);
        this.portraitDisplayWidth = size.width;
        this.portraitDisplayHeight = size.height;
    }

    /** 立绘盒宽度：绿框口径按宿主宽等比（149/720）。 */
    private portraitBoxWidth(): number {
        return this.hostTransform.width * PORTRAIT_BOX_WIDTH_RATIO;
    }
}
