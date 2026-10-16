import { _decorator, Component, Label, Sprite, UITransform, sp } from 'cc';
import { loadRedDotFrame, RED_DOT_SPINE_ANIMATION, redDotIconSize } from './RedDotArt';
import {
    IRedDotState,
    normalizeRedDotType,
    RED_DOT_TYPE_DEFAULT,
    RedDotArtKey,
    RedDotType,
    resolveRedDotState,
} from './RedDotState';

const { ccclass, property } = _decorator;

/**
 * 红点组件 —— FGUI `组件_公用_红点`（`com_rd`）的 Cocos 版。
 *
 * 一份到底的使用方式只有一个：**`setRedDot(count, type?)`**（名字刻意对齐老端 `GObjRD.OnRDUpdate`）。
 * 判定口径全在 `RedDotState.resolveRedDotState()`（纯函数、可单测），本类只负责把结果落到节点上。
 *
 * ## 节点结构（`ui/common/RedDot.prefab`，根 30×30）
 * ```
 * RedDot            30×30  ← 本脚本；FGUI 的「是否显示红点」控制器 = 本节点 active
 * ├─ Icon           Sprite  静态图（普通兜底 / 数字底 / 新），帧与尺寸按状态换
 * ├─ Spine          sp.Skeleton  普通红点的「红点闪闪」（33×38.4 = 骨架自然尺寸，**不是**老端 prefab 的 27.5×32）
 * └─ Title          Label   数字红点的数值
 * ```
 * `_children` 序 = 渲染序：数字要压在底图上面 ⇒ `Title` 必须排最后。
 *
 * ## 三条与老端对齐的行为
 * 1. `count <= 0` ⇒ 整块不显示（老端 `setSelectedPage('是否显示红点', '不显示')`）；
 *    `boolean` 也接得住（老端调用点大量写 `OnRDUpdate(data.hasRD)`）。
 * 2. 普通红点 = **spine**，不是静态图；spine 不可用（SkeletonData 没加载上）时**回退到静态图**，
 *    不静默留白（这是本项目对「静默降级」的统一处理：降级可以，留白不行）。
 * 3. 数字文案原样写，不截断（老端 `title.setText(rdNum)`）。
 *
 * ## 复用安全
 * 每次落地都**绝对赋值**三个子节点的 `active` / 帧 / 尺寸 / 文案 —— 不读上一帧状态做增量。
 * 对象池或虚拟列表复用本组件时不会留残影（见项目规则：对象池复用必须绝对赋值）。
 */
@ccclass('RedDot')
export class RedDot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：静态图（普通红点兜底 / 数字底 / 新红点）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Title：数字红点的数值（无数字时整节点隐藏）' })
    titleLabel: Label = null!;

    @property({ type: sp.Skeleton, tooltip: 'Spine：普通红点的「红点闪闪」（素材是 塔防/spine/reddot）' })
    spine: sp.Skeleton = null!;

    private type: RedDotType = RED_DOT_TYPE_DEFAULT;
    /** 最近一次的原始入参（`setRedDotType` 只换类型时要拿它重算，不能丢计数）。 */
    private count: number | boolean | null | undefined = 0;
    private state: IRedDotState = resolveRedDotState(0);
    /** 当前 Icon 上挂的是哪张图（避免每次 apply 都重新 load）。 */
    private appliedArtKey: RedDotArtKey | null = null;
    /** spine 是否已经在播（避免每次 apply 都把动画打回第一帧）。 */
    private spinePlaying = false;
    private loadGeneration = 0;
    private iconTransform: UITransform | null = null;

    protected onLoad(): void {
        this.iconTransform = this.icon.getComponent(UITransform);
        // 默认**收起三个子节点**，但**不动根节点 active** —— 根节点的显隐归宿主 / `setRedDot` 管。
        // 不在这里调 `setRedDot(0)`：那会把根节点也置成 inactive，宿主再写 `node.active = true`
        // 就会出现「根开着、子里却全是上一帧状态」的两头打架（复用残影）。
        this.icon.node.active = false;
        this.spine.node.active = false;
        this.titleLabel.node.active = false;
    }

    // ============================================================
    // 对外 API
    // ============================================================

    /**
     * **唯一入口**：设置红点。对齐老端 `GObjRD.OnRDUpdate(rdNum, rdType?)`。
     *
     * @param count `<= 0`（含 `false` / `null` / `undefined`）整块不显示；`number` 与 `boolean` 都接受。
     * @param type  红点类型；省略 = 沿用上次设过的（首次 = 普通红点），与老端一致。
     */
    setRedDot(count: number | boolean | null | undefined, type?: RedDotType | null): void {
        if (type !== null && type !== undefined) this.type = normalizeRedDotType(type);
        this.count = count;
        this.state = resolveRedDotState(count, this.type);
        this.applyState();
    }

    /** 只改类型（计数不变），对齐老端 `SetRDType`。 */
    setRedDotType(type: RedDotType): void {
        this.type = normalizeRedDotType(type);
        this.state = resolveRedDotState(this.count, this.type);
        this.applyState();
    }

    /** 当前类型。 */
    getRedDotType(): RedDotType {
        return this.type;
    }

    /** 收起红点（等价 `setRedDot(0)`）。 */
    hide(): void {
        this.setRedDot(0);
    }

    // ============================================================
    // 落地
    // ============================================================

    private applyState(): void {
        const state = this.state;
        this.node.active = state.visible;

        const useSpine = state.showSpine && this.spineAvailable();
        this.applyIcon(state, useSpine);
        this.applySpine(useSpine);
        this.applyTitle(state);
    }

    private applyIcon(state: IRedDotState, useSpine: boolean): void {
        const key = state.artKey;
        const show = state.visible && !useSpine && key !== null;
        this.icon.node.active = show;
        if (!show || key === null) {
            this.appliedArtKey = null;
            return;
        }
        const [width, height] = redDotIconSize(key);
        this.iconTransform?.setContentSize(width, height);
        if (this.appliedArtKey === key) return;
        this.appliedArtKey = key;
        const generation = this.loadGeneration;
        void loadRedDotFrame(key).then((frame) => {
            // 期间组件销毁 / 已切到别的图 / 被别的实例顶掉 ⇒ 丢掉这次结果
            if (!this.isValid || generation !== this.loadGeneration) return;
            if (this.appliedArtKey !== key) return;
            // 加载失败时保留现有帧（loadRedDotFrame 已经打过 warn），不主动抹成空白
            if (frame) this.icon.spriteFrame = frame;
        });
    }

    private applySpine(useSpine: boolean): void {
        this.spine.node.active = this.state.visible && useSpine;
        if (!useSpine) {
            this.spinePlaying = false;
            return;
        }
        if (this.spinePlaying) return;
        this.spinePlaying = true;
        this.spine.setAnimation(0, RED_DOT_SPINE_ANIMATION, true);
    }

    private applyTitle(state: IRedDotState): void {
        // 绝对赋值：先写文案再定显隐，复用时不会读到上一帧的字符串
        this.titleLabel.string = state.text;
        this.titleLabel.node.active = state.visible && state.text !== '';
    }

    /**
     * spine 能不能用。`skeletonData` 由 prefab 的依赖关系带进来（同 prefab 一起加载），
     * 所以正常情况下 `onLoad` 时就有值；这里判空只为「素材没挂上」时能干净地回退到静态图。
     */
    private spineAvailable(): boolean {
        return !!this.spine && !!this.spine.skeletonData;
    }

    protected onDestroy(): void {
        // 让在途的帧加载结果作废（避免往已销毁的节点上写）
        this.loadGeneration += 1;
    }
}
