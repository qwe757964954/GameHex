import { _decorator, Component, Label, Sprite, UITransform, sp } from 'cc';
import { loadRedDotFrame, RED_DOT_SPINE_ANIMATION, redDotIconSize } from './RedDotArt';
import {
    normalizeRedDotType,
    RED_DOT_TYPE_DEFAULT,
    resolveRedDotState,
    type IRedDotState,
    type RedDotArtKey,
    type RedDotType,
} from './RedDotState';

const { ccclass, property } = _decorator;

/**
 * 红点组件：FGUI `组件_公用_红点`（`com_rd`）的 Cocos 版。
 * 对外只有一个入口 `setRedDot(count, type?)`，判定口径全在 `RedDotState.resolveRedDotState`，
 * 本类只负责把结果落到节点上。
 *
 * 节点结构（`ui/common/RedDot.prefab`，根 30×30）：
 *   Icon   静态图（普通兜底 / 数字底 / 新红点）
 *   Spine  sp.Skeleton，普通红点的「红点闪闪」（33×38.4，骨架自然尺寸）
 *   Title  数字红点的数值
 * 子节点顺序即渲染顺序，Title 必须排最后。
 *
 * 行为对齐老端：`count <= 0` 整块不显示（boolean 也接得住）；普通红点播 spine，
 * spine 不可用时回退静态图而不是留白；数字原样写，不截断。
 * 每次落地都绝对赋值三个子节点，对象池 / 虚拟列表复用时不会留残影。
 */
@ccclass('RedDot')
export class RedDot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：静态图（普通红点兜底 / 数字底 / 新红点）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Title：数字红点的数值（无数字时整节点隐藏）' })
    titleLabel: Label = null!;

    @property({ type: sp.Skeleton, tooltip: 'Spine：普通红点的「红点闪闪」（素材是 塔防/spine/reddot）' })
    spine: sp.Skeleton = null!;

    private dotType: RedDotType = RED_DOT_TYPE_DEFAULT;
    /** 最近一次的原始入参（`setRedDotType` 只换类型时要拿它重算，不能丢计数）。 */
    private count: number | boolean | null | undefined = 0;
    private state: IRedDotState = resolveRedDotState(0);
    /** 当前 Icon 上挂的是哪张图（避免每次 apply 都重新 load）。 */
    private appliedArtKey: RedDotArtKey | null = null;
    /** spine 是否已经在播（避免每次 apply 都把动画打回第一帧）。 */
    private spinePlaying = false;
    private loadGeneration = 0;
    private iconTransform: UITransform;

    protected onLoad(): void {
        this.iconTransform = this.icon.getComponent(UITransform);
        // 默认收起三个子节点，但不动根节点：根节点显隐归宿主 / `setRedDot`。
        // 不在 onLoad 里调 `setRedDot(0)`，否则根节点被置成 inactive，
        // 宿主再写 `node.active = true` 就会带着上一帧的子节点状态复现残影。
        this.icon.node.active = false;
        this.spine.node.active = false;
        this.titleLabel.node.active = false;
    }

    protected onDestroy(): void {
        // 让在途的帧加载结果作废，避免往已销毁的节点上写
        this.loadGeneration += 1;
    }

    // ============================================================
    // 对外 API
    // ============================================================

    /**
     * 唯一入口：设置红点，对齐老端 `GObjRD.OnRDUpdate(rdNum, rdType?)`。
     *
     * @param count `<= 0`（含 `false` / `null` / `undefined`）整块不显示；`number` 与 `boolean` 都接受。
     * @param type  红点类型；省略 = 沿用上次设过的（首次 = 普通红点）。
     */
    setRedDot(count: number | boolean | null | undefined, type?: RedDotType | null): void {
        if (type !== null && type !== undefined) this.dotType = normalizeRedDotType(type);
        this.count = count;
        this.state = resolveRedDotState(count, this.dotType);
        this.applyState();
    }

    /** 只改类型（计数不变），对齐老端 `SetRDType`。 */
    setRedDotType(type: RedDotType): void {
        this.dotType = normalizeRedDotType(type);
        this.state = resolveRedDotState(this.count, this.dotType);
        this.applyState();
    }

    getRedDotType(): RedDotType {
        return this.dotType;
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
        if (!show) {
            this.appliedArtKey = null;
            return;
        }
        const [width, height] = redDotIconSize(key);
        this.iconTransform.setContentSize(width, height);
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
     * spine 能不能用。`skeletonData` 由 prefab 依赖带进来，正常情况下 onLoad 时就有值；
     * 判空只为素材没挂上时能干净地回退到静态图。
     */
    private spineAvailable(): boolean {
        return !!this.spine.skeletonData;
    }
}
