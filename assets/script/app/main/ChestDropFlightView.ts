/**
 * 「战斗掉落宝箱获得」的轻量视图 —— 一枚宝箱 icon + 一条三角形拖尾，沿弧线飞进
 * `BottomHud/ChestEntry`。
 *
 * 与 `TerritoryHeroFlight` 同一套做法：非 `Component`、不建 `cc.tween`、逐帧 `step(dt)`
 * 由 `MainPage.update` 统一推进，节点池化（`stop()` 只收不销毁），时钟 `-1` 即空闲。
 * 不建 tween 是硬口径：主城页每局重建，tween 挂在回收后的节点上会继续写缩放。
 *
 * ## 宿主
 * 挂在 `MainRoot` **最后一位**（`MainPage.chestDropFxRoot()`）：`BottomNav` 是 `MainRoot`
 * 的最后一个子节点，只有排到它后面才能盖过底栏与 `ArenaRoot/BottomHud` 的聊天框；
 * `PopupManager` 的弹窗挂在 `MainRoot` 之外，仍盖在飞行图标之上。
 *
 * 起点（地图 PVP 格心）与终点（`ChestEntry`）都由调用方给**世界坐标**，
 * 这里用同一个宿主的 `UITransform.convertToNodeSpaceAR` 换算 —— 换宿主会作废旧坐标。
 *
 * ## 图层顺序
 * `Graphics`（拖尾）加在根节点上，`Sprite`（宝箱）是后建的子节点 ⇒ 图标压在拖尾上。
 * 拖尾颜色 / 每帧重画都在这里，纯几何在 `model/ChestDropFlight`，视图不复制算法。
 */

import { Color, Graphics, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3 } from 'cc';
import {
    CHEST_DROP_FLIGHT_SECONDS,
    CHEST_DROP_ICON_SIZE,
    chestDropFlightFrame,
    chestDropTrailQuads,
    type IChestDropPoint,
} from './ChestDropFlight';

const CHEST_DROP_FX_NODE = 'ChestDropFlight';
/** 拖尾色：暖金，跟宝箱的金属高光同色系；alpha 按段算。 */
const CHEST_DROP_TRAIL_RGB = { r: 255, g: 208, b: 96 } as const;

export class ChestDropFlightView {
    readonly node: Node;

    private readonly trail: Graphics;
    private readonly icon: Sprite;
    private readonly iconOpacity: UIOpacity;
    private readonly hostTransform: UITransform;
    private origin: IChestDropPoint = { x: 0, y: 0 };
    private target: IChestDropPoint = { x: 0, y: 0 };
    /** < 0 = 空闲（可被复用）。 */
    private elapsed = -1;
    /** 本场只通知一次落地，避免按钮被连抖 / 绿点被反复点亮。 */
    private landed = false;
    private onLanded: (() => void) | null = null;

    constructor(layer: Node, frame: SpriteFrame | null) {
        this.node = new Node(CHEST_DROP_FX_NODE);
        this.node.layer = layer.layer;
        this.node.setParent(layer);
        this.node.setSiblingIndex(layer.children.length - 1);
        this.node.active = false;
        this.hostTransform = this.node.addComponent(UITransform);
        this.trail = this.node.addComponent(Graphics);

        const iconNode = new Node('ChestDropIcon');
        iconNode.layer = layer.layer;
        iconNode.setParent(this.node);
        iconNode.addComponent(UITransform).setContentSize(CHEST_DROP_ICON_SIZE, CHEST_DROP_ICON_SIZE);
        this.icon = iconNode.addComponent(Sprite);
        this.icon.trim = false;
        // 运行时 new Sprite 必须显式 CUSTOM：TRIMMED 会跟着帧改节点大小（见 §17）。
        this.icon.sizeMode = Sprite.SizeMode.CUSTOM;
        this.icon.spriteFrame = frame;
        this.iconOpacity = iconNode.addComponent(UIOpacity);
    }

    /**
     * 起播一次飞行。
     *
     * @param originWorld 地图 PVP 格心的世界坐标（`TerritoryMapView.cellWorldPoint`）
     * @param targetWorld `BottomHud/ChestEntry` 的世界坐标
     * @param onLanded 落地那一帧回调一次（抖动 icon + 点亮最后一颗绿点）
     */
    play(
        originWorld: IChestDropPoint,
        targetWorld: IChestDropPoint,
        onLanded: (() => void) | null,
    ): boolean {
        if (!this.node.isValid || !this.hostTransform.isValid) return false;
        this.origin = this.toLocal(originWorld);
        this.target = this.toLocal(targetWorld);
        this.elapsed = 0;
        this.landed = false;
        this.onLanded = onLanded;
        this.node.active = true;
        this.apply(0);
        return true;
    }

    /** 每帧推进。@returns 是否还在飞（false = 已收工）。 */
    step(dt: number): boolean {
        if (this.elapsed < 0) return false;
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.elapsed += step;
        // 按显式到达时刻判，而不是看 `fx` 变 null 的隐式窗口（掉帧会漏）。
        if (!this.landed && this.elapsed >= CHEST_DROP_FLIGHT_SECONDS) {
            this.landed = true;
            this.onLanded?.();
        }
        if (this.elapsed >= CHEST_DROP_FLIGHT_SECONDS) {
            this.stop();
            return false;
        }
        this.apply(this.elapsed);
        return true;
    }

    /** 立刻收尾（切页 / 进战斗前调）：整批收起，节点留着给下次 `play` 复用。 */
    stop(): void {
        this.elapsed = -1;
        this.landed = false;
        this.onLanded = null;
        if (this.node.active) this.node.active = false;
        if (this.trail?.isValid) this.trail.clear();
    }

    /** 页面销毁时调：运行时建的节点不跟着 prefab 走，必须自己收掉。 */
    dispose(): void {
        this.stop();
        if (this.node.isValid) this.node.destroy();
    }

    private toLocal(world: IChestDropPoint): IChestDropPoint {
        const point = this.hostTransform.convertToNodeSpaceAR(
            new Vec3(world.x, world.y, 0), new Vec3());
        return { x: point.x, y: point.y };
    }

    /** 把这一帧写进节点；每帧清屏重画，避免池化后留下上一场的拖尾。 */
    private apply(elapsed: number): void {
        const fx = chestDropFlightFrame(elapsed, this.origin, this.target);
        if (!this.trail.isValid) return;
        this.trail.clear();
        if (!fx) return;

        const iconNode = this.icon.node;
        iconNode.setPosition(fx.x, fx.y, 0);
        iconNode.setScale(fx.scale, fx.scale, 1);
        const alpha = Math.max(0, Math.min(255, Math.round(fx.opacity * 255)));
        if (this.iconOpacity.opacity !== alpha) this.iconOpacity.opacity = alpha;

        const { r, g, b } = CHEST_DROP_TRAIL_RGB;
        for (const quad of chestDropTrailQuads(fx)) {
            if (quad.alpha <= 0.004) continue;
            this.trail.fillColor = new Color(r, g, b, Math.round(255 * Math.min(1, quad.alpha)));
            this.trail.moveTo(quad.ax, quad.ay);
            this.trail.lineTo(quad.bx, quad.by);
            this.trail.lineTo(quad.cx, quad.cy);
            this.trail.lineTo(quad.dx, quad.dy);
            this.trail.close();
            this.trail.fill();
        }
    }
}
