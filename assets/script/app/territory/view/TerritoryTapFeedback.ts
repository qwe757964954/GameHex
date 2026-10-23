import { Color, Graphics, Node, UIOpacity, UITransform, type Vec3 } from 'cc';
import {
    TERRITORY_TAP_RING_RADIUS,
    TERRITORY_TAP_RING_SECONDS,
    territoryTapGlowFx,
    territoryTapPressScale,
    territoryTapRingFx,
} from '../model/TerritoryTapFeedback';

/**
 * **点击反馈**：地块按压回弹 + 绿色光圈 + 蓝色圆环（规格 §1 的 0.00~0.05s 那一段）。
 *
 * ## 为什么不是 `cc.Button` 的 `Transition = SCALE`
 *
 * 引擎那套是「按下放大到 `zoomScale`、抬起还原」，手感读作"按下去变胖、松手跳一下"；
 * 而规格要的是 **PressBounce（先压 94%、再弹 102%、落回 100%）**，且必须**按下当帧**就有反应。
 * 所以按压由这里自己写（见 `model/TerritoryTapFeedback` 的注释）。
 *
 * ## 两层环画在哪
 *
 * 页面坐标系（不随地图滚动）。`play(origin)` 的 `origin` 是**格子的台面中心**，
 * 由 `TerritoryMapView` 用 `convertToNodeSpaceAR` 换算好后传进来 —— 本类不碰 ScrollView。
 *
 * ## 复用
 *
 * 同时最多 4 组（连点时手指不会比这更快）。用**固定槽位**而不是池：
 * 每组就是一个 `Graphics` + 一个 `UIOpacity`，比反复建/销毁便宜，也不会漏节点。
 */

/** 同时最多几组点击反馈（连点也不会超过这个数；超了就抢最早的那组）。 */
const TAP_SLOT_COUNT = 4;

interface ITapSlot {
    readonly node: Node;
    readonly graphics: Graphics;
    readonly opacity: UIOpacity;
    elapsed: number;
}

export class TerritoryTapFeedback {
    /** 页面坐标系的根（`active` 恒 true，槽位各自开关）。 */
    readonly node: Node;

    private readonly slots: ITapSlot[] = [];
    /** 正在被按的节点 → 剩余时长；同一帧只记一个（手指只有一根）。 */
    private pressedNode: Node | null = null;
    private pressedElapsed = -1;

    constructor(layer: Node) {
        this.node = new Node('TerritoryTapFeedback');
        this.node.layer = layer.layer;
        this.node.setParent(layer);
        this.node.addComponent(UITransform);
        for (let index = 0; index < TAP_SLOT_COUNT; index += 1) {
            const node = new Node(`TapFx_${index}`);
            node.layer = layer.layer;
            node.setParent(this.node);
            node.addComponent(UITransform);
            node.active = false;
            this.slots.push({
                node,
                graphics: node.addComponent(Graphics),
                opacity: node.addComponent(UIOpacity),
                elapsed: -1,
            });
        }
    }

    /**
     * 播一次点击反馈。
     *
     * @param origin     页面坐标系里的格子中心（台面中心）
     * @param pressTarget 要「压一下」的节点（通常是被点地块的六边格节点）；
     *                    `null` = 只画光圈圆环，不压任何东西（例如点到空地）
     */
    play(origin: Vec3, pressTarget: Node | null = null): void {
        const slot = this.acquireSlot();
        slot.elapsed = 0;
        slot.node.active = true;
        slot.node.setPosition(origin.x, origin.y, 0);
        this.apply(slot, 0);
        if (pressTarget && pressTarget.isValid) {
            // 上一组还没弹完就先把它复位，否则「上一格的缩放」会留在那个格子上。
            this.releasePress();
            this.pressedNode = pressTarget;
            this.pressedElapsed = 0;
            pressTarget.setScale(territoryTapPressScale(0) ?? 1, territoryTapPressScale(0) ?? 1, 1);
        }
    }

    /** 逐帧推进（页面 / 地图视图的 `update` 里调）。 */
    step(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        for (const slot of this.slots) {
            if (slot.elapsed < 0) continue;
            slot.elapsed += dt;
            if (!this.apply(slot, slot.elapsed)) {
                slot.elapsed = -1;
                if (slot.node.active) slot.node.active = false;
            }
        }
        if (this.pressedElapsed >= 0) {
            this.pressedElapsed += dt;
            const scale = territoryTapPressScale(this.pressedElapsed);
            if (scale === null) this.releasePress();
            else if (this.pressedNode?.isValid) this.pressedNode.setScale(scale, scale, 1);
        }
    }

    /** 立刻收掉全部反馈（换章 / 页面销毁前调），并**把按压复位**，别让格子停在压扁的样子。 */
    stop(): void {
        for (const slot of this.slots) {
            slot.elapsed = -1;
            if (slot.node.active) slot.node.active = false;
        }
        this.releasePress();
    }

    /** 把按压复位成 1 并清状态（幂等）。 */
    private releasePress(): void {
        if (this.pressedNode?.isValid) this.pressedNode.setScale(1, 1, 1);
        this.pressedNode = null;
        this.pressedElapsed = -1;
    }

    private acquireSlot(): ITapSlot {
        // 先找空闲槽；全在播就抢**播得最久**的那组（`elapsed` 最大 = 最接近结束）。
        let oldest = this.slots[0];
        for (const slot of this.slots) {
            if (slot.elapsed < 0) return slot;
            if (slot.elapsed > oldest.elapsed) oldest = slot;
        }
        return oldest;
    }

    /**
     * 画这一帧的两层环。@returns 是否还在播（false = 该槽可以收了）。
     */
    private apply(slot: ITapSlot, elapsed: number): boolean {
        const glow = territoryTapGlowFx(elapsed);
        const ring = territoryTapRingFx(elapsed);
        const g = slot.graphics;
        g.clear();
        if (!glow && !ring) return false;

        if (glow) {
            // 径向光圈：同心圆叠加，最内圈最亮（没有渐变贴图也能读成"中心亮、边缘透明"）。
            const rings = 6;
            for (let step = rings; step >= 1; step -= 1) {
                const radius = glow.radius * (step / rings);
                const alpha = glow.alpha * (1 - step / (rings + 1));
                if (alpha <= 0.01) continue;
                g.fillColor = new Color(126, 232, 132, Math.round(alpha * 92));
                g.circle(0, 0, radius);
                g.fill();
            }
        }

        if (ring) {
            const radius = TERRITORY_TAP_RING_RADIUS * ring.scale;
            g.strokeColor = new Color(126, 206, 255, Math.round(Math.max(0, ring.alpha) * 235));
            g.lineWidth = 3;
            // 手画 32 段折线（`Graphics.circle` 只有填充路径，描边要自己拼）。
            const segments = 32;
            for (let step = 0; step < segments; step += 1) {
                const a = (step / segments) * Math.PI * 2;
                const b = ((step + 1) / segments) * Math.PI * 2;
                g.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
                g.lineTo(Math.cos(b) * radius, Math.sin(b) * radius);
            }
            g.stroke();
        }

        const alpha = Math.max(glow?.alpha ?? 0, ring?.alpha ?? 0);
        const alphaByte = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        if (slot.opacity.opacity !== alphaByte) slot.opacity.opacity = alphaByte;
        // 两条曲线的时长一样，但用「两者都没了」判收尾，将来单独拉长其中一条也不会出错。
        return elapsed < TERRITORY_TAP_RING_SECONDS;
    }
}
