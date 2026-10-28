import { Color, Graphics, Node, ProgressBar, UITransform } from 'cc';
import {
    HEALTH_BAR_DAMAGE_TRAIL_SECONDS,
    healthBarDamageTrailWidth,
} from './ZCGameViewUtil';

/** 白条颜色：纯白不透明 —— 压在黑色底框上才一眼看出「这一段已经没了」。 */
const DAMAGE_TRAIL_COLOR = new Color(255, 255, 255, 255);
/** 窄到这个值以下就直接收手：省一次 `clear` + 一次 draw call，肉眼也看不出这一丝白。 */
const DAMAGE_TRAIL_MIN_WIDTH = 0.5;
/** 读不到填充高时的兜底（与蓝湖稿 8 高同值；只在 prefab 没写 UITransform 时用得上）。 */
const DAMAGE_TRAIL_FALLBACK_HEIGHT = 8;
/** 同一块画布的名字：单位回池 / 地块复用后靠它判断「是不是自己那一份」。 */
const DAMAGE_TRAIL_NODE_NAME = 'ZCDamageTrail';

/**
 * 血条扣血白条（2026-10-27 需求）：被扣掉的那一段先显示成白色，**0.13s 内从右往左缩短消失**，
 * 露出黑色底框。
 *
 * 单位条（`ZCUnitView`）与城墙/建筑条（`ZCHexView`）共用这一份实现 —— 两边都是
 * 「一根 `cc.ProgressBar` + 左侧锚点 (0, 0.5) 的填充条」，几何口径完全一致。
 *
 * 三条设计约束，改之前先读：
 *
 * 1. **白条是「被扣掉的那段」，不是「旧血量」**：左缘钉在填充条的**当前右缘**上，
 *    右缘是「扣血前那条边」。所以宽度收窄时只有右缘往左走 —— 正是需求要的方向。
 * 2. **纯函数时间轴**：只记 `startedAt`，每帧按 `now - startedAt` 算宽度（同 `ZCNeutralRewardFx`），
 *    不建 tween、不按 `dt` 累加，掉帧也不会跑偏。
 * 3. **画布懒建、只建一次**：`Graphics` 挂在 `HealthBar` 的**第一个子节点**上（垫在填充条下面），
 *    这样「白条左缘」与「填充右缘」重合处的亚像素重叠永远由填充条盖住，不会出现白条吃掉一点血。
 */
export class ZCHealthBarDamageTrail {
    private node: Node | null = null;
    private graphics: Graphics | null = null;
    /** 上一帧的比例：**比例变小**就是这一帧挨了打（血量回升 / 换阵营不会起白条）。 */
    private lastRatio = Number.NaN;
    /** 扣血前的那条边（比例），白条的右缘。 */
    private fromRatio = 0;
    private startedAt = Number.NaN;

    /** 复用 / 换局复位：单位回池后第一帧满血，绝不能带着上一条命的白条。 */
    reset(): void {
        this.lastRatio = Number.NaN;
        this.fromRatio = 0;
        this.startedAt = Number.NaN;
        this.hide();
    }

    /**
     * 每帧喂一次当前比例。返回 **`true` = 这一帧还画着白条**（调用方据此决定下一帧还要不要来）。
     *
     * `bar.node.active` 由调用方（血量窗口）决定；本类只负责「该不该画、画多宽」，
     * 父节点隐藏时子节点自然不显示，所以这里不重复判可见性。
     */
    render(bar: ProgressBar | null, progress: number, now: number): boolean {
        const previous = this.lastRatio;
        const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
        this.lastRatio = ratio;
        // 掉血才起白条；`>` 的反向（回血）与相等都只更新基线。
        if (Number.isFinite(previous) && ratio < previous) {
            this.fromRatio = previous;
            this.startedAt = now;
        }
        const elapsed = now - this.startedAt;
        // 时间窗是硬闸：没起过白条（`startedAt` 是 NaN）、或已经播完，直接收手，
        // 连宽度都不算 —— 这条每帧每根血条都会走，别在这里做无意义的浮点。
        if (!Number.isFinite(elapsed) || elapsed >= HEALTH_BAR_DAMAGE_TRAIL_SECONDS) {
            this.hide();
            return false;
        }
        const totalLength = bar ? bar.totalLength : 0;
        const width = healthBarDamageTrailWidth(totalLength, ratio, this.fromRatio, elapsed);
        if (!bar || width < DAMAGE_TRAIL_MIN_WIDTH) {
            this.hide();
            return false;
        }
        this.draw(bar, ratio, width);
        return true;
    }

    private draw(bar: ProgressBar, progress: number, width: number): void {
        const graphics = this.ensureGraphics(bar.node);
        const node = this.node;
        if (!graphics || !node) return;
        const fillNode = bar.barSprite ? bar.barSprite.node : null;
        // 填充条锚点是 (0, 0.5)：它的 `position.x` 就是这一格的左缘（单位条是 −宽度/2 + 内缩，
        // 地块条是 −填充宽/2），所以白条的起点直接用这个值换算，不必知道各自的 inset。
        const left = fillNode ? fillNode.position.x : 0;
        const fillTransform = fillNode ? fillNode.getComponent(UITransform) : null;
        const fillHeight = fillTransform && fillTransform.contentSize
            ? fillTransform.contentSize.height : 0;
        const height = fillHeight > 0 ? fillHeight : DAMAGE_TRAIL_FALLBACK_HEIGHT;
        graphics.enabled = true;
        graphics.clear();
        graphics.fillColor = DAMAGE_TRAIL_COLOR;
        graphics.rect(left + bar.totalLength * progress, -height / 2, width, height);
        graphics.fill();
        if (!node.active) node.active = true;
    }

    /**
     * 懒建画布。判活看**节点**而不是 `Graphics`：与 `ZCGameRenderWorld.ensureHintOutlineGraphics`
     * 同一口径（组件的 `isValid` 在池化节点上不可靠）。
     */
    private ensureGraphics(parent: Node): Graphics | null {
        if (this.node && this.node.isValid === true && this.node.parent === parent) {
            return this.graphics;
        }
        this.node = null;
        this.graphics = null;
        const node = new Node(DAMAGE_TRAIL_NODE_NAME);
        node.layer = parent.layer;
        node.addComponent(UITransform).setContentSize(1, 1);
        const graphics = node.addComponent(Graphics);
        node.setParent(parent);
        // 垫在填充条下面（子节点序 = 渲染顺序）：见类头注释第 3 条。
        node.setSiblingIndex(0);
        this.node = node;
        this.graphics = graphics;
        return graphics;
    }

    /** 收手：清空路径并关掉画布（重复调用幂等，别每帧都写）。 */
    private hide(): void {
        const node = this.node;
        const graphics = this.graphics;
        if (!node || !graphics) return;
        if (node.isValid !== true) {
            this.node = null;
            this.graphics = null;
            return;
        }
        if (!node.active && graphics.enabled === false) return;
        graphics.clear();
        graphics.enabled = false;
        node.active = false;
    }
}
