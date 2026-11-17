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
    Graphics,
    instantiate,
    Label,
    Layers,
    Mask,
    Node,
    Prefab,
    RichText,
    Sprite,
    SpriteFrame,
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
import { fitGuidePortrait, formatGuideContent, guideDialogBottom, guideHintMotion } from '../model/GuidePresentation';
import { HEX_GRID_CONTENT_LIFT, HEX_GRID_FACE_WIDTH, HEX_GRID_FACE_HEIGHT } from '../../../core/hex/HexGridLayout';

const { ccclass, property } = _decorator;

/** 指南骨骼立绘的固定骨架子节点（`skel/豌豆射手`：根节点 + `spine`）。 */
const GUIDE_PORTRAIT_SPINE_NODE_NAME = 'spine';

export interface IGuideFocusTarget {
    readonly node: Node;
    readonly shape: 'hex' | 'rect';
}


/**
 * 单句无人点击时自动推进的秒数，对应设计案的 8s 无响应兜底。
 */
const IDLE_ADVANCE_SECONDS = 8;

/** 遮罩不透明度：设计案「全屏半透明黑 60%」= 153，取整 150；hole 步降到 40% 把注意力留给焦点区。 */
const FULL_MASK_ALPHA = 150;
const HOLE_MASK_ALPHA = 100;

/** 为对话框上方的姓名牌留出空间，角色脚底不压住姓名牌。 */
const PORTRAIT_DIALOG_GAP = 48;

@ccclass('GuideDialogView')
export class GuideDialogView extends Component {
    @property({ type: Node, group: '立绘', tooltip: 'Portrait：角色立绘节点（锚点 0.5/0，居中站在对话框上方）' })
    portraitNode: Node = null!;

    @property({ group: '立绘', tooltip: '立绘显示高度；宽度按原图比例计算' })
    portraitHeight = 460;

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
    private stepId = '';
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
    private animationStartedAt = 0;
    @property([Node]) focusMasks: Node[] = [];
    private focusMaskSprites: Sprite[] = [];
    private focusKey = '';
    private focusTarget: IGuideFocusTarget | null = null;
    private focusTransform: UITransform | null = null;
    private focusWidth = 0;
    private focusHeight = 0;
    private readonly focusLocal = new Vec3();
    private readonly focusWorld = new Vec3();
    private readonly focusEdgeWorld = new Vec3();
    private readonly focusCorner = new Vec3();
    private readonly clipCenter = new Vec3();
    private readonly clipCorner = new Vec3();
    private focusClips: UITransform[] = [];
    private focusScaleX = 1;
    private focusScaleY = 1;
    private focusProvider: ((key: string) => IGuideFocusTarget | null) | null = null;
    /** 当前步的遮罩类型 —— `applyPortrait` 靠它决定要不要显示立绘。 */
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
        this.warnIfNotUiLayer();
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
     */
    private applyMaskStyle(maskType: GuideMaskType): void {
        const dim = this.dimSprite;
        const color = dim.color.clone();
        color.a = maskType === 'hole' ? HOLE_MASK_ALPHA : FULL_MASK_ALPHA;
        dim.color = color;
        for (const sprite of this.focusMaskSprites) sprite.color = color;
        this.layoutBlocker();
    }

    /** 只按配置的焦点标识定位；没有焦点的对话步骤不显示操作手指。 */
    private applyHints(state: IGuideViewState): void {
        this.focusKey = state.focusNode;
        this.focusTarget = null;
        this.focusTransform = null;
        this.tapHint.active = state.completeCond === 'click' && !state.focusNode;
        this.mapHint.active = false;
        this.focusRing.active = false;
        this.focusHand.active = false;
        this.animationStartedAt = Date.now();
        this.tapHint.setScale(1, 1, 1);
        this.mapHint.setScale(1, 1, 1);
        this.focusHintText.string = state.focusNode === 'Battle/DrawnCard' ? '当前抽到的卡牌' : state.requireAction === 'drag'
            ? '拖拽卡牌到指定格子' : state.focusNode.startsWith('Map/Tile') ? '点击地图上的地块' : '点击高亮区域';
        this.resolveFocus();
        this.layoutBlocker();
    }

    private readonly resolveFocus = (): void => {
        const target = this.focusKey && this.focusProvider ? this.focusProvider(this.focusKey) : null;
        this.focusTarget = target;
        this.focusTransform = target ? target.node.getComponent(UITransform) : null;
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
            const graphics = this.focusGraphics;
            const x = this.focusWidth / 2, y = this.focusHeight / 2;
            graphics.clear();
            if (hex) {
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
        this.placeFocusRing();
    };

    private placeFocusRing(): void {
        const target = this.focusTarget;
        const transform = this.focusTransform;
        let visible = false;
        let dialogBottom = this.defaultDialogBottom;
        if (target && transform && target.node.isValid && target.node.activeInHierarchy) {
            // 控件的可视中心可能不在锚点；六边形还要包含格面的内容偏移。
            this.focusCorner.set((0.5 - transform.anchorX) * transform.width,
                (0.5 - transform.anchorY) * transform.height + (target.shape === 'hex' ? HEX_GRID_CONTENT_LIFT : 0), 0);
            transform.convertToWorldSpaceAR(this.focusCorner, this.focusWorld);
            this.hostTransform.convertToNodeSpaceAR(this.focusWorld, this.focusLocal);
            this.focusCorner.x += this.focusWidth / 2;
            this.focusCorner.y += this.focusHeight / 2;
            transform.convertToWorldSpaceAR(this.focusCorner, this.focusEdgeWorld);
            this.hostTransform.convertToNodeSpaceAR(this.focusEdgeWorld, this.focusCorner);
            const halfWidth = Math.abs(this.focusCorner.x - this.focusLocal.x);
            const halfHeight = Math.abs(this.focusCorner.y - this.focusLocal.y);
            // 装饰框的留白可以越过边缘，控件本身仍完整可见（如贴底的英雄页签）。
            const contentRatioX = target.shape === 'hex' ? 1 : transform.width / this.focusWidth;
            const contentRatioY = target.shape === 'hex' ? 1 : transform.height / this.focusHeight;
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
                const hintY = Math.min(this.focusLocal.y + halfHeight + 140, this.hostTransform.height / 2 - 100);
                const hint = this.mapHint.position;
                if (hint.x !== hintX || hint.y !== hintY) this.mapHint.setPosition(hintX, hintY, 0);
                this.layoutFocusMasks(this.focusLocal.x, this.focusLocal.y, halfWidth, halfHeight);
                dialogBottom = guideDialogBottom(this.hostTransform.height, this.dialogTransform.height,
                    this.defaultDialogBottom, this.focusLocal.y, halfHeight);
            }
        }
        const changed = this.focusRing.active !== visible;
        this.focusRing.active = visible;
        this.focusHand.active = visible;
        this.mapHint.active = visible;
        const waitingForBattleFocus = !visible && (this.focusKey.startsWith('Battle/') || this.focusKey.startsWith('BattleResult/'));
        this.dimNode.active = !visible && !waitingForBattleFocus;
        this.dialogBox.active = !waitingForBattleFocus && this.queue.length > 0;
        this.blockerNode.active = !waitingForBattleFocus;
        for (const mask of this.focusMasks) mask.active = visible;
        const dialogMoved = this.dialogWidget.bottom !== dialogBottom;
        // `Widget.bottom` 的 setter 无条件 `_recursiveDirty()`（引擎 widget.ts 的 442-445），
        // 值没变也写会让对话框每帧重排一次 ⇒ 只在真的位移时赋值。
        if (dialogMoved) this.dialogWidget.bottom = dialogBottom;
        if (changed || dialogMoved) this.layoutBlocker();
        this.placePortrait();
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
        if (this.focusKey) this.placeFocusRing();
        const motion = guideHintMotion(this.animationStartedAt, Date.now());
        const hint = this.tapHint.active ? this.tapHint : this.mapHint.active ? this.mapHint : null;
        if (hint) hint.setScale(motion.hintScale, motion.hintScale, 1);
        if (this.focusHand.active) {
            this.focusHand.setPosition(this.focusRing.position.x,
                this.focusRing.position.y + motion.handLift, 0);
            this.focusRing.setScale(this.focusScaleX * motion.hintScale, this.focusScaleY * motion.hintScale, 1);
        }
    }

    /**
     * 点击区布局。
     *
     * 有焦点孔时，**孔外的点击全部由四块遮罩接住**（它们都绑了 CLICK → `onTap`，见 `onLoad`），
     * `Blocker` 只守对话条自己那一块；孔内不放任何遮挡，地块 / 弹窗按钮照常收点击。
     *
     * 没有孔时（`full` 步，或 `hole` 步的焦点还没就绪）必须铺满宿主：需求是
     * 「对话框出现时屏蔽其他点击，点哪都等于点对话条」，漏一条缝玩家就点到主界面底栏去了。
     * ⚠️ 因此**不能按 `maskType === 'hole'` 判**：焦点未就绪时孔并不存在，那样整屏点击会漏下去，
     * 而该步又要等玩家点地块，等于两头都卡死。
     */
    private layoutBlocker(): void {
        const node = this.blockerNode;
        if (this.focusRing.active) {
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

        // 显隐控制挂在自己身上（root 绑的就是本节点）：整层实例由组合层 addChild，
        // 没引导时置 active=false，不遮挡主界面。
        this.node.active = true;
        this.currentMaskType = state.maskType;
        this.stepId = state.stepId;
        this.queue = this.groups.get(state.dialogId) ?? [];
        this.index = 0;

        // 真机上唯一能证明"对话层真的出来了"的证据。组缺失是最常见的静默失败
        // （表现为黑屏没字），单独打一条 warn，别和正常路径混在一起。
        if (this.queue.length === 0) {
            console.warn(`[GuideDialog] 步 ${state.stepId} 找不到台词组 ${state.dialogId || '(空)'}，对话条将不可见`);
        } else {
            console.log(`[GuideDialog] 步 ${state.stepId}(${state.flowName}) · 台词 ${state.dialogId} · ${this.queue.length} 句 · 遮罩 ${state.maskType}`);
        }
        this.applyMaskStyle(state.maskType);
        this.applyHints(state);
        // 判据是 completeCond === 'click'，不是 requireAction。
        // requireAction 只说玩家要做一个动作，拿它当「点对话条就推进」会误推带参步。
        this.canAdvance = state.completeCond === 'click';

        if (this.queue.length === 0) {
            // 没有台词（或表没打进包）：藏对话条，只留遮罩/立绘，等业务事件。
            this.dialogBox.active = false;
            this.nameText.string = '';
            this.contentText.string = '';
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
        this.stepId = '';
        this.focusKey = '';
        this.focusTarget = null;
        this.focusTransform = null;
    }

    // 内部实现

    /** 点击：先逐句推进，最后一句再点才报告推进意图。 */
    private onTap(): void {
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        if (this.index + 1 < this.queue.length) {
            this.playLine(this.index + 1);
            return;
        }
        if (this.canAdvance) {
            this.canAdvance = false;
            EventMgr.instance.emit(GuideEvent.Advance, { owner: this, stepId: this.stepId });
        }
    }

    private playLine(index: number): void {
        this.index = index;
        const line = this.queue[index];
        if (!line) return;
        this.nameText.string = line.speaker;
        this.contentText.string = formatGuideContent(line.content);
        this.applyPortrait(line.speaker);
        // 日志报实际显示状态：hole 步会刻意藏立绘。
        const portraitShown = this.portraitNode.active
            && (!!this.portraitSprite.spriteFrame || this.npcNode?.active === true);
        console.log(`[GuideDialog] 播 ${line.id} · ${line.speaker} · 立绘=${portraitShown ? '显示' : '隐藏'} · ${line.content.length} 字`);
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

    /** 两位角色均居中站在对话框上方，对话框避让焦点时跟随移动。 */
    private placePortrait(): void {
        const dialogTop = -this.hostTransform.height / 2 + this.dialogWidget.bottom + this.dialogTransform.height;
        const foot = dialogTop + PORTRAIT_DIALOG_GAP;
        const pos = this.portraitNode.position;
        // 同上：这个方法每帧被 `placeFocusRing` 顺带调用，值没变就别写。
        if (pos.x !== 0 || pos.y !== foot) this.portraitNode.setPosition(0, foot, 0);
    }

    /**
     * 切换立绘。静图换 SpriteFrame 并按 portraitHeight 等比设尺寸；
     * 骨骼实例化一次后只切 active；未登记或加载失败时两个都藏起来。
     */
    private applyPortrait(speaker: string): void {
        const portrait = getGuidePortraitAsset(speaker);
        const sprite = this.portraitSprite;

        // hole 步不显示立绘，立绘会罩住屏幕中部的焦点地块。
        if (this.currentMaskType === 'hole' || this.focusKey) {
            this.hidePortrait();
            return;
        }

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
            const size = fitGuidePortrait(raw.width, raw.height, this.portraitHeight, this.hostTransform.width);
            const width = Math.round(size.width);
            const height = Math.round(size.height);
            this.setNodeSize(sprite.node, width, height);
            this.placePortrait();
            return;
        }

        sprite.spriteFrame = null;
        // 骨骼挂在同一宿主下，只关静图组件，不能关掉父节点。
        sprite.enabled = false;
        sprite.node.active = true;
        const npc = this.ensureNpc(loaded as Prefab);
        npc.active = true;
        // 骨骼节点只建一次，但宿主宽度可能变化，显示尺寸每次都要重算。
        this.fitNpc();
        this.placePortrait();
    }

    private hidePortrait(): void {
        this.portraitSprite.spriteFrame = null;
        this.portraitSprite.node.active = false;
        if (this.npcNode) this.npcNode.active = false;
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
     * 把骨骼按绑定框等比缩到目标尺寸并让脚点贴住立绘原点（锚点 0.5/0）。
     *
     * 和静图一样受 {@link PORTRAIT_MAX_WIDTH_RATIO} 的宽度上限约束 —— 骨骼绑定框
     * （`skel/豌豆射手` 是 654×916）普遍比立绘"胖"，只按高度缩会横向撑出对话条。
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
        const size = fitGuidePortrait(rawWidth, rawHeight, this.portraitHeight, this.hostTransform.width);
        const scale = size.height / rawHeight;
        node.setScale(scale, scale, 1);
        node.setPosition(0, transform.anchorY * size.height, 0);
    }
}
