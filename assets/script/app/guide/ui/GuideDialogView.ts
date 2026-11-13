/**
 * 引导对话条 + 角色立绘（View 层，挂在 `GuideDialog.prefab` 根节点上）。
 *
 * ## 与 Controller 的契约
 *
 * Controller 只交状态（`IGuideViewState` + 一个 `advance` 回调），本类负责：
 *   ① 按 `dialogId` 找台词组并逐句播放；
 *   ② 按说话人切立绘；
 *   ③ 台词播完、且本步 `requireAction === 'click'` 时，下一次点击调 `advance()`。
 *
 * 立绘帧**由外部注入**（`initialize`），View 不自己 load —— 与 `ZCGuideItem` 的口径一致：
 * 表现层不碰资源管线，加载归属 application。
 *
 * ## 逐句 vs 整组
 *
 * 设计案注①写「整组算 1 次点击」，但一组有 3 句（最长 38 字），一次点击全播完等于玩家没得看。
 * 这里按**逐句点击**实现：点一次下一句，最后一句再点才触发 `advance()`。
 * 步的 `completeCond` 仍是 `click`，语义不变，只是点击次数变多。
 *
 * ## 立绘缺失
 *
 * 没交图的角色（当前是豌豆游侠）`portrait` 会隐藏，只显示台词，不报错也不留白框。
 */

import {
    _decorator,
    Button,
    Component,
    instantiate,
    Label,
    Layers,
    Node,
    Prefab,
    Sprite,
    SpriteFrame,
    UITransform,
} from 'cc';
import { DEBUG } from 'cc/env';
import { GuideDebugEvent } from '../application/GuideController';
import type { IGuideViewState } from '../application/GuideController';
import { EventMgr } from '../../../framework/event/EventMgr';
import { getGuidePortraitAsset } from '../model/GuideDialogConfig';
import type { GuideDialogLine } from '../model/GuideDialogConfig';
import type { GuideMaskType } from '../model/GuideStepConfig';

const { ccclass, property } = _decorator;

/**
 * 立绘显示高度（设计分辨率 720×1280，脚底贴屏幕底、头顶到约 y=+60）。
 *
 * 2026-11-13 真机反馈「太大」：940 时头顶到 +300、宽 647 几乎满宽，把对话条和背景全压住了。
 * 现在按 700 走（约 55% 屏高），静图与骨骼同一口径。
 */
const PORTRAIT_HEIGHT = 700;

/**
 * 单句无人点击时自动推进的秒数。
 *
 * 设计案「分步脚本」页每一行的「失败/兜底」列都写着「8s 无响应自动推进」——
 * 之前没实现，玩家不点就永久停在这一句（真机上表现为"引导卡死、点什么都没用"）。
 */
const IDLE_ADVANCE_SECONDS = 8;

/** 遮罩不透明度：设计案「全屏半透明黑 60%」= 153，取整 150；hole 步降到 40% 把注意力留给焦点区。 */
const FULL_MASK_ALPHA = 150;
const HOLE_MASK_ALPHA = 100;

@ccclass('GuideDialogView')
export class GuideDialogView extends Component {
    @property({ type: Node, group: '根', tooltip: 'Root：整层显隐（遮罩 + 立绘 + 对话条）' })
    root: Node = null;

    @property({ type: Node, group: '立绘', tooltip: 'Portrait：角色立绘节点（锚点 0.5/0，脚底贴屏幕底部）' })
    portraitNode: Node = null;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox：底部对话条容器' })
    dialogBox: Node = null;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox/NameLab：说话人名字' })
    nameLabelNode: Node = null;

    @property({ type: Node, group: '对话条', tooltip: 'DialogBox/ContentLab：台词正文' })
    contentLabelNode: Node = null;

    @property({ type: Node, group: '交互', tooltip: 'Blocker：全屏点击区（Button transition=NONE）' })
    blockerNode: Node = null;


    /** `立绘资源路径 → 资源`（静图是 `SpriteFrame`、骨骼是 `Prefab`）；由 `initialize` 注入。 */
    private frames: ReadonlyMap<string, SpriteFrame | Prefab> = new Map();
    /** 骨骼立绘实例（豌豆游侠）；首次用到时建一次，之后只切 active。 */
    private npcNode: Node | null = null;
    /** 组 id → 台词列表；由 `initialize` 注入。 */
    private groups: ReadonlyMap<string, readonly GuideDialogLine[]> = new Map();
    /** 当前组；空数组 = 没有可播台词。 */
    private queue: readonly GuideDialogLine[] = [];
    private index = 0;
    /** 台词播完后要回调的推进函数；`null` = 本步不靠点击推进。 */
    private advance: (() => void) | null = null;
    private started = false;
    /** 当前这句的无人操作计时器是否在跑（`schedule` 按回调去重，这里只做状态记录）。 */
    private idleArmed = false;
    /** 调试跳过区连点计数（仅 `DEBUG` 构建有效）。 */
    private debugSkipTaps = 0;
    private debugSkipAt = 0;

    /**
     * 子组件缓存。
     *
     * 为什么绑 Node 再 `getComponent`：MCP 写 prefab 时 `cc.Sprite` / `cc.Label` 这类
     * **组件引用**在序列化阶段会被丢掉（实测 2026-11-13：接口返回 success，存盘后是 `null`），
     * 而 `Node` 引用能正确落盘。用 Node 绑 + 代码取组件，既不按名字查找，也不会静默丢引用。
     */
    private portraitSprite: Sprite | null = null;
    private nameText: Label | null = null;
    private contentText: Label | null = null;
    private tapButton: Button | null = null;
    /** 遮罩用的 Sprite（prefab 里已绑 `white.png`，这里只取引用做「按 maskType 改 alpha」）。 */
    private dimSprite: Sprite | null = null;

    protected onLoad(): void {
        this.portraitSprite = this.portraitNode ? this.portraitNode.getComponent(Sprite) : null;
        this.nameText = this.nameLabelNode ? this.nameLabelNode.getComponent(Label) : null;
        this.contentText = this.contentLabelNode ? this.contentLabelNode.getComponent(Label) : null;
        this.tapButton = this.blockerNode ? this.blockerNode.getComponent(Button) : null;
        // 遮罩 / 底板按**固定结构名**取，而不是 `@property`：
        // MCP 写 prefab 时编辑器还没重编译脚本，新属性在组件上不存在（实测
        // "Property 'dimNode' not found"），绑上去也是空。等编辑器重新编译后可改回 @property。
        // 结构是 prefab 内的固定层级（Dim 是根的子节点、Bg 是 DialogBox 的子节点），改名要同步这里。
        // 结构名固定（Dim / Bg 是 prefab 内的固定层级），这里只取组件引用做动态改色；
        // 尺寸、颜色、字体、位置等**静态值全部在 prefab 里配**（走 MCP），代码不再兜。
        const dimNode = this.node.getChildByName('Dim');
        this.dimSprite = dimNode ? dimNode.getComponent(Sprite) : null;
        this.warnIfNotUiLayer();
        this.createDebugSkipArea();
    }

    private setNodeSize(node: Node, width: number, height: number): void {
        const transform = node.getComponent(UITransform);
        if (transform) transform.setContentSize(width, height);
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
        if (dim) {
            const color = dim.color.clone();
            color.a = maskType === 'hole' ? HOLE_MASK_ALPHA : FULL_MASK_ALPHA;
            dim.color = color;
        }
        this.layoutBlocker(maskType);
    }

    /**
     * 点击区尺寸随遮罩类型切换（运行时数据，进不了 prefab）。
     *
     * 🔴 `hole` 步（翻地 2-1/3-1/4-1、解锁地块 7-1）要玩家去点**地图格子**，
     * 点击区若保持全屏 720×1280 就会把所有点击吃掉 —— 表现就是「对话停在这一句、
     * 点哪都没反应、像卡死」（2026-11-13 真机实锤）。
     */
    private layoutBlocker(maskType: GuideMaskType): void {
        const node = this.blockerNode;
        if (!node) return;
        if (maskType === 'hole') {
            node.setPosition(0, -505, 0);
            this.setNodeSize(node, 680, 260);
            return;
        }
        node.setPosition(0, 0, 0);
        this.setNodeSize(node, 720, 1280);
    }

    /**
     * 联调逃生口（只有 `DEBUG` 构建会建）：右上角 90×90 连点 5 次 = 强制跳过整条引导。
     *
     * 为什么需要它：1-1~1-3 是强制步、`skipAble=0`，正常路径没有退出方式；联调时
     * 一旦卡在某步（比如业务事件还没接），没有这个口子就只能清存档。
     */
    private createDebugSkipArea(): void {
        if (!DEBUG) return;
        const node = new Node('DebugSkip');
        node.layer = this.node.layer;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(90, 90);
        node.setPosition(315, 595, 0);
        const button = node.addComponent(Button);
        button.transition = Button.Transition.NONE;
        this.node.addChild(node);
        node.on(Button.EventType.CLICK, this.onDebugSkipTap, this);
    }

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
     * @param advance 本步「台词播完后再点一次」要执行的动作；不传 = 本步不吃点击。
     */
    render(state: IGuideViewState, advance?: () => void): void {
        this.ensureBound();

        if (state.finished) {
            this.hide();
            return;
        }

        // 显隐控制挂在自己身上（root 绑的就是本节点）：整层实例由组合层 addChild，
        // 没引导时置 active=false，不遮挡主界面。
        this.node.active = true;
        this.queue = this.groups.get(state.dialogId) ?? [];
        this.index = 0;

        // 真机上唯一能证明"对话层真的出来了"的证据。组缺失是最常见的静默失败
        // （表现为黑屏没字），单独打一条 warn，别和正常路径混在一起。
        if (this.queue.length === 0) {
            console.warn(`[GuideDialog] 步 ${state.stepId} 找不到台词组 ${state.dialogId || '(空)'}，对话条将不可见`);
        } else {
            console.log(`[GuideDialog] 步 ${state.stepId}(${state.flowName}) · 台词 ${state.dialogId} · ${this.queue.length} 句 · 遮罩 ${state.maskType}`);
        }
        this.warnIfNotReady();
        // `hole` 的挖空需要「焦点锚点 → 屏幕矩形」，锚点注册还没做（`focusNode` 目前是
        // `Map/Tile_1` 这类占位名）。这里先按"淡遮罩 + 明显提示"降级，不能装作已经挖了洞 ——
        // 翻地步骤若按 full 画死，玩家会以为卡住。
        this.applyMaskStyle(state.maskType);
        if (state.maskType === 'hole') {
            console.warn(`[GuideDialog] 步 ${state.stepId} 是 hole 遮罩，但焦点锚点未接入（focusNode=${state.focusNode || '(空)'}），暂按淡遮罩降级`);
        }
        // 🔴 判据是 `completeCond === 'click'`，不是 `requireAction`。
        //    `requireAction` 只说"玩家要做一个点击动作"（可能点的是地块/「收下」按钮）；
        //    拿它当"点对话条就推进"会让 2-1（tileFlipped）被误推、2-2（popupClosed）永远推不动。
        this.advance = state.completeCond === 'click' ? (advance ?? null) : null;

        if (this.queue.length === 0) {
            // 没有台词（或表没打进包）：藏对话条，只留遮罩/立绘，等业务事件。
            this.dialogBox.active = false;
            if (this.nameText) this.nameText.string = '';
            if (this.contentText) this.contentText.string = '';
            return;
        }
        this.dialogBox.active = true;
        this.playLine(0);
    }

    hide(): void {
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        this.node.active = false;
        this.queue = [];
        this.index = 0;
        this.advance = null;
    }

    
    // 内部实现
    

    /**
     * 子组件没就绪的探测。
     *
     * 典型成因：实例化时 `active=false`，而父节点当时也不在激活层级 ⇒ `onLoad` 不跑 ⇒
     * 缓存全是 null ⇒ 表现为"黑屏、没字、点了没反应"，日志里一条错都没有。
     * 提前喊出来，比让人去猜"是不是表没打进包"快得多。
     */
    private warnIfNotReady(): void {
        if (this.portraitSprite || this.nameText || this.contentText) return;
        console.warn('[GuideDialog] 子组件未就绪（onLoad 未执行？）—— 检查实例化时父节点是否处于激活层级');
    }

    private ensureBound(): void {
        if (this.started) return;
        this.started = true;
        // 按钮在 prefab 上是 transition=NONE、target=null，这里只绑 CLICK（规范：不做 TOUCH_END 兜底）。
        // 按钮在 prefab 上是 transition=NONE、target=null，这里只绑 CLICK（规范：不做 TOUCH_END 兜底）。
        this.blockerNode.on(Button.EventType.CLICK, this.onTap, this);
    }

    /** 点击：先逐句推进，最后一句再点才走 `advance`。 */
    private onTap(): void {
        this.idleArmed = false;
        this.unschedule(this.onIdleTimeout);
        if (this.index + 1 < this.queue.length) {
            this.playLine(this.index + 1);
            return;
        }
        const advance = this.advance;
        this.advance = null;
        advance?.();
    }

    private playLine(index: number): void {
        this.index = index;
        const line = this.queue[index];
        if (!line) return;
        console.log(`[GuideDialog] 播 ${line.id} · ${line.speaker} · 立绘=${getGuidePortraitAsset(line.speaker) ? '有' : '无'} · ${line.content.length} 字`);
        if (this.nameText) this.nameText.string = line.speaker;
        if (this.contentText) this.contentText.string = line.content;
        this.applyPortrait(line.speaker);
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
     * 切换立绘。两种来源：
     *   · 静图（埃莉斯）→ 换 `SpriteFrame` 并按 `PORTRAIT_HEIGHT` 等比设尺寸；
     *   · 骨骼（豌豆游侠）→ 实例化战场那份 `skel/豌豆射手`，播它自带的 `idle`，
     *     首次建好后只切 `active`（不重复 instantiate）。
     * 未登记 / 加载失败 ⇒ 两个都藏起来，不留白框。
     */
    private applyPortrait(speaker: string): void {
        const portrait = getGuidePortraitAsset(speaker);
        const sprite = this.portraitSprite;
        const loaded = portrait ? this.frames.get(portrait.asset) ?? null : null;

        if (!portrait || !loaded) {
            if (sprite) {
                sprite.spriteFrame = null;
                sprite.node.active = false;
            }
            if (this.npcNode) this.npcNode.active = false;
            return;
        }

        if (portrait.kind === 'sprite') {
            if (this.npcNode) this.npcNode.active = false;
            if (!sprite) return;
            const frame = loaded as SpriteFrame;
            sprite.node.active = true;
            sprite.spriteFrame = frame;
            // 尺寸由代码统一控制 ⇒ CUSTOM；TRIMMED 会在换图时把节点拉回原图尺寸
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            const raw = frame.originalSize;
            const width = raw.height > 0 ? Math.round(raw.width * (PORTRAIT_HEIGHT / raw.height)) : raw.width;
            this.setNodeSize(sprite.node, width, PORTRAIT_HEIGHT);
            return;
        }

        // 骨骼：藏掉静图，挂上/显示骨骼节点
        if (sprite) {
            sprite.spriteFrame = null;
            sprite.node.active = false;
        }
        const npc = this.ensureNpc(loaded as Prefab);
        if (npc) npc.active = true;
    }

    /**
     * 建骨骼立绘（只建一次）。
     *
     * 缩放按骨骼的 `UITransform.height` 反推到 `PORTRAIT_HEIGHT`；拿不到高度就按 1 处理并告警
     * （宁可小也不能因为猜错比例把整屏糊满）。
     */
    private ensureNpc(prefab: Prefab): Node | null {
        if (this.npcNode) return this.npcNode;
        const host = this.portraitNode;
        if (!host) return null;

        const node = instantiate(prefab);
        // 骨骼 prefab 的 layer 可能是 DEFAULT，UI 相机不认；跟着宿主走最稳。
        node.layer = host.layer;
        host.addChild(node);
        node.setPosition(0, 0, 0);

        const transform = node.getComponent(UITransform);
        const rawHeight = transform ? transform.height : 0;
        if (rawHeight > 0) {
            const scale = PORTRAIT_HEIGHT / rawHeight;
            node.setScale(scale, scale, 1);
            console.log(`[GuideDialog] 骨骼立绘 ${prefab.name} · 原始高 ${rawHeight} · scale ${scale.toFixed(2)}`);
        } else {
            console.warn('[GuideDialog] 骨骼立绘没有 UITransform 高度，缩放按 1 处理（可能偏小）');
        }

        this.npcNode = node;
        return node;
    }
}
