import { Node, Sprite, UIOpacity, type SpriteFrame } from 'cc';
import {
    TERRITORY_HEX_RECOLOR_SECONDS,
    territoryHexRecolorFrame,
} from '../model/TerritoryHexRecolor';

/** 「旧地皮」临时节点名（`TerritoryMapView.createHex` 挂；缩小 + 淡出写在它身上）。 */
export const TERRITORY_HEX_RECOLOR_OLD_NODE = 'RecolorOld';
/** 「新地皮」临时节点名（同上；从格心长开 + 淡入写在它身上）。 */
export const TERRITORY_HEX_RECOLOR_NEW_NODE = 'RecolorNew';

/** 一格正在播的换色。`elapsed` 从**负的延迟**起算，跨过 0 才开始动。 */
interface ITerritoryHexRecolorActive {
    readonly node: Node;
    /** 格根的地皮 Sprite —— 换色期间要**藏起来**（否则"长大的新地皮"底下还垫着一张满尺寸的新的）。 */
    readonly ground: Sprite;
    readonly oldSprite: Sprite;
    readonly newSprite: Sprite;
    readonly oldOpacity: UIOpacity;
    readonly newOpacity: UIOpacity;
    readonly toFrame: SpriteFrame;
    /** 已用时（秒）：`< 0` = 还在等自己的档期。 */
    elapsed: number;
}

/**
 * 「关卡通过后地皮换色」表现：旧地皮缩小淡出 + 新地皮放大淡入，多格按批错峰。
 *
 * ## 结构（`createHex` 里挂的那两个子节点）
 *
 * ```
 * Hex_<cellId>        ← 格根：地皮 Sprite（换色期间 enabled=false）
 * ├── RecolorNew      ← 新地皮：0.6 → 1，透明度 0 → 1
 * ├── RecolorOld      ← 旧地皮：1 → 0.55，透明度 1 → 0
 * ├── Frame           ← 格面框（通关即消失，不参与本动画）
 * ├── GroundGlow      ← 翻格底光
 * └── Reveal          ← 翻格用的"新地皮放大填充"
 * ```
 *
 * `RecolorOld` 排在 `RecolorNew` **之后**（渲染序 ⇒ 画在上面）：旧地皮缩小的过程里
 * 新地皮从它身下露出来，读作"换了一张"，而不是"两张叠在一起各淡各的"。
 *
 * ## 为什么不动格根
 *
 * 需求第四条「地块上的建筑保持原地不动」。建筑本来就不在格节点下（`StationIconLayer` 等四层），
 * 但**格根一缩放，格面框 / 底光 / `Reveal` 都会跟着缩** —— 那会露出一圈"框跟着地皮一起缩"的破绽。
 * 所以缩放只写在两个临时子节点上，格根缩放全程恒 1。
 *
 * ## 池化契约
 *
 * 与其它表现层一致：`isPlaying / play / step / stop / reset`，`settle()` 必须收口 ——
 * 藏起来的格根地皮要**重新 `enabled`**（不然这一格会永久变成空白），两个临时节点要收起、
 * 缩放复位、透明度置 255（节点被复用时会带着上一格的半透明明明可见）。
 */
export class TerritoryHexRecolor {
    private readonly actives: ITerritoryHexRecolorActive[] = [];

    /** 这一格是否正在播（调用方用它避免和翻格 / 生成抢同一格）。 */
    isPlaying(node: Node): boolean {
        for (const active of this.actives) {
            if (active.node === node) return true;
        }
        return false;
    }

    /** 正在播的格数（调试 / 用例用）。 */
    get playingCount(): number {
        return this.actives.length;
    }

    /**
     * 开始播一格换色。
     *
     * @param from  旧地皮帧（**调用方在 `applyTileFrame` 之前读到的**那张）
     * @param to    新地皮帧
     * @param delay 这一格的档期（秒，`>= 0`）；同批格子由 `territoryHexRecolorDelays` 算出来
     * @returns 是否真的开始（同一格已经在播 / 缺临时节点 / 缺帧 ⇒ `false`）
     */
    play(node: Node, from: SpriteFrame | null, to: SpriteFrame | null, delay = 0): boolean {
        if (!node || !node.isValid || this.isPlaying(node)) return false;
        if (!from || !to) return false;
        const ground = node.getComponent(Sprite);
        const oldSprite = node.getChildByName(TERRITORY_HEX_RECOLOR_OLD_NODE)?.getComponent(Sprite) ?? null;
        const newSprite = node.getChildByName(TERRITORY_HEX_RECOLOR_NEW_NODE)?.getComponent(Sprite) ?? null;
        // 节点不是 `createHex` 建的（用例手搓的假节点 / prefab 结构被改）⇒ 静默降级成"直接换色"，
        // 不抛错：换色只是观感，缺了它格子照样是对的。
        if (!ground || !oldSprite || !newSprite) return false;
        const active: ITerritoryHexRecolorActive = {
            node,
            ground,
            oldSprite,
            newSprite,
            oldOpacity: oldSprite.node.getComponent(UIOpacity) ?? oldSprite.node.addComponent(UIOpacity),
            newOpacity: newSprite.node.getComponent(UIOpacity) ?? newSprite.node.addComponent(UIOpacity),
            toFrame: to,
            elapsed: -(Number.isFinite(delay) && delay > 0 ? delay : 0),
        };
        if (oldSprite.spriteFrame !== from) oldSprite.spriteFrame = from;
        if (newSprite.spriteFrame !== to) newSprite.spriteFrame = to;
        this.actives.push(active);
        // ⚠️ 起手必须先写一遍：`paintHexes` 已经把格根地皮换成**新帧**了，这一帧若不藏起来，
        //    就会先渲染一帧"满尺寸的新地皮"，下一帧才缩成 0.6 —— 表现为"闪一下再长"。
        this.apply(active, 0);
        return true;
    }

    /**
     * 把格根地皮重新藏起来（幂等）。
     *
     * 为什么需要它：`paintHexes` 每秒都会全量走一遍 `applyTileFrame`，那一句会
     * `sprite.enabled = true` —— 换色播到一半被重绘一次，就会在"长大的新地皮"底下
     * 闪出一张满尺寸的新地皮。所以 `paintHexes` 写完帧要立刻再藏一次（同帧，看不见）。
     */
    hideGround(node: Node): void {
        const ground = node?.isValid ? node.getComponent(Sprite) : null;
        if (ground && ground.enabled) ground.enabled = false;
    }

    /** 立刻收掉这一格（被翻格接管 / 换章重建时用）：格根地皮恢复、两个临时节点收起。 */
    stop(node: Node): void {
        for (let index = this.actives.length - 1; index >= 0; index -= 1) {
            const active = this.actives[index];
            if (active.node !== node) continue;
            this.settle(active);
            this.actives.splice(index, 1);
        }
    }

    /** 立刻收掉全部在播的格子（换章 / 布局重建前调）。 */
    reset(): void {
        for (const active of this.actives) this.settle(active);
        this.actives.length = 0;
    }

    /** 每帧推进。@returns 是否还有在播的（调用方可据此省掉后续工作）。 */
    step(dt: number): boolean {
        if (this.actives.length === 0) return false;
        for (let index = this.actives.length - 1; index >= 0; index -= 1) {
            const active = this.actives[index];
            // 格节点被销毁（换章重建 / 页面关闭）⇒ 直接摘掉，别往死节点上写。
            if (!active.node.isValid) {
                this.actives.splice(index, 1);
                continue;
            }
            active.elapsed += dt;
            if (active.elapsed >= TERRITORY_HEX_RECOLOR_SECONDS) {
                this.settle(active);
                this.actives.splice(index, 1);
                continue;
            }
            this.apply(active, Math.max(0, active.elapsed));
        }
        return this.actives.length > 0;
    }

    /** 写一帧：藏格根地皮 + 把模型给的四个量落到两个临时节点上（值没变就不写）。 */
    private apply(active: ITerritoryHexRecolorActive, seconds: number): void {
        const frame = territoryHexRecolorFrame(seconds);
        if (active.ground.enabled) active.ground.enabled = false;
        this.applyLayer(active.oldSprite.node, active.oldOpacity, frame.outScale, frame.outOpacity);
        this.applyLayer(active.newSprite.node, active.newOpacity, frame.inScale, frame.inOpacity);
    }

    /** 单个临时地皮层：缩放 + 透明度 + 是否还要画。`opacity <= 0` ⇒ 整层收起（不做零透明绘制）。 */
    private applyLayer(node: Node, opacity: UIOpacity, scale: number, alpha: number): void {
        const visible = alpha > 0.004;
        if (node.active !== visible) node.active = visible;
        if (node.scale.x !== scale || node.scale.y !== scale) node.setScale(scale, scale, 1);
        const value = visible ? Math.round(Math.min(1, alpha) * 255) : 0;
        if (opacity.opacity !== value) opacity.opacity = value;
    }

    /**
     * 收口。
     *
     * 🔴 三件事一件都不能漏：
     *  1. 格根地皮必须重新 `enabled` —— 换色期间它是藏起来的，不还回来这一格就永远空白；
     *  2. 新地皮帧要写回格根 —— 动画中途被 `reset()` 打断时格根可能还停在旧帧（藏着的），
     *     还回来就变成"通关了还是泥巴块"；
     *  3. 两个临时节点收起 + 缩放复位 + 透明度 255（池化复用不能带着上一格的半尺寸 / 半透明）。
     */
    private settle(active: ITerritoryHexRecolorActive): void {
        const ground = active.ground;
        if (ground?.isValid) {
            if (ground.spriteFrame !== active.toFrame) ground.spriteFrame = active.toFrame;
            if (!ground.enabled) ground.enabled = true;
        }
        this.hideLayer(active.oldSprite.node, active.oldOpacity);
        this.hideLayer(active.newSprite.node, active.newOpacity);
    }

    private hideLayer(node: Node, opacity: UIOpacity): void {
        if (node.isValid) {
            if (node.active) node.active = false;
            if (node.scale.x !== 1 || node.scale.y !== 1) node.setScale(1, 1, 1);
        }
        if (opacity.isValid && opacity.opacity !== 255) opacity.opacity = 255;
    }
}
