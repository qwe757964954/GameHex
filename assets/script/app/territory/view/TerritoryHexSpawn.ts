import { Node, UIOpacity } from 'cc';
import {
    TERRITORY_HEX_SPAWN_SECONDS,
    territoryHexSpawnFrame,
} from '../model/TerritoryHexSpawn';

/** 一格正在播的生成动画。`elapsed` 从**负的延迟**起算，跨过 0 才开始长。 */
interface ITerritoryHexSpawnActive {
    readonly node: Node;
    readonly opacity: UIOpacity;
    /** 已用时（秒）：`< 0` = 还在等自己的档期。 */
    elapsed: number;
    /** 最近一帧的不透明度（0~1）—— `opacityOf` 用它回答"现在淡到几成"。 */
    lastOpacity: number;
    /**
     * 同帧通知（可选）：站点那几块视觉节点不在地皮节点下（它们在 `StationIconLayer` 等
     * 另外 4 个层里），格节点上的 `UIOpacity` 管不到 ⇒ 用这个回调把同一档透明度递出去。
     * `null` = 这一格没有站点（或调用方不关心）。
     */
    readonly onFrame: ((opacity: number) => void) | null;
}

/**
 * 新地块**生成**表现：整格从透明渐显 + 从小长到 1，多格按批错峰。
 *
 * ## 为什么是「纯类」而不是 `Component`
 *
 * 与 `TerritoryGainBurst` / `TerritoryHexFlip` 同一口径：这个类只持一格一格的计时器，
 * 由 `TerritoryMapView.update` 逐帧 `step(dt)` 驱动（`AGENTS.md`：禁止在视图里零散建 tween）。
 * 挂 `Component` 的话，池化回来 / 换章重建时还要处理组件的启停，反而多一处状态。
 *
 * ## 透明度写在哪
 *
 * 写在**格节点自己的 `UIOpacity`** 上 ⇒ 地皮、格面框、底光、新地皮 `Reveal` 一起淡，
 * 正是需求说的「**整个节点**由透明渐变」。不要逐个给子节点加 —— 那要处理
 * `active` 与组件复用，且子节点数量以后还会变。
 *
 * ⚠️ 节流到「值变了才写」：`update` 每帧都在跑，`node.setScale` / `opacity` 的赋值
 * 会触发渲染数据标脏，几百格同时播时能省就省（这里最多同时几格，但口径与其它表现层一致）。
 */
export class TerritoryHexSpawn {
    private readonly actives: ITerritoryHexSpawnActive[] = [];

    /** 是否正在播这一格（调用方用它避免和翻格抢同一格的缩放）。 */
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
     * 开始播一格。
     *
     * @param delay   这一格的档期（秒，`>= 0`）。同批格子由 `territoryHexSpawnDelays` 算出来。
     * @param onFrame 同帧通知（可选）：站点图标/文字不在格节点下，靠它把同一档透明度递过去。
     * @returns 是否真的开始（同一格已经在播 ⇒ `false`，不重置它的进度）
     */
    play(node: Node, delay = 0, onFrame: ((opacity: number) => void) | null = null): boolean {
        if (!node || !node.isValid || this.isPlaying(node)) return false;
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        const active: ITerritoryHexSpawnActive = {
            node,
            opacity,
            elapsed: -(Number.isFinite(delay) && delay > 0 ? delay : 0),
            lastOpacity: 0,
            onFrame,
        };
        this.actives.push(active);
        // ⚠️ 起手必须先写一遍「全透明 + 最小」：节点刚被 `paintHexes` 置 `active = true`，
        //    这一帧若不写，就会先按 1.0 满尺寸渲染一帧，下一帧才缩回去 —— 表现为"闪一下再长"。
        this.apply(active, 0);
        return true;
    }

    /**
     * 这一格当前的生成进度（不透明度 `0~1`）；`null` = 它没在播。
     *
     *  为什么需要它：`renderMap` 里 **站点是排在格子之后**建的（`syncStations` 在 `paintHexes` 后面），
     *  新格子的站点视图在这一帧才刚 `render` 出来 ⇒ 它错过了 `play` 那一次起手帧。
     *  调用方拿这个值补写一次，站点才不会先以全不透明闪一帧。
     */
    opacityOf(node: Node): number | null {
        for (const active of this.actives) {
            if (active.node === node) return active.lastOpacity;
        }
        return null;
    }

    /** 立刻收掉这一格（被翻格接管 / 换章重建时用）：缩放置 1、透明度置满。 */
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
            if (active.elapsed >= TERRITORY_HEX_SPAWN_SECONDS) {
                this.settle(active);
                this.actives.splice(index, 1);
                continue;
            }
            this.apply(active, Math.max(0, active.elapsed));
        }
        return this.actives.length > 0;
    }

    /** 写一帧：把模型给的 `scale / opacity` 落到节点上（值没变就不写）。 */
    private apply(active: ITerritoryHexSpawnActive, seconds: number): void {
        const frame = territoryHexSpawnFrame(seconds);
        active.lastOpacity = frame.opacity;
        const node = active.node;
        if (node.scale.x !== frame.scale || node.scale.y !== frame.scale) {
            node.setScale(frame.scale, frame.scale, 1);
        }
        const value = Math.round(frame.opacity * 255);
        if (active.opacity.opacity !== value) active.opacity.opacity = value;
        active.onFrame?.(frame.opacity);
    }

    /** 收口：缩放置回 1、透明度置满（池化复用不能带着上一格的半透明/半尺寸）。 */
    private settle(active: ITerritoryHexSpawnActive): void {
        const node = active.node;
        active.lastOpacity = 1;
        if (node.isValid && (node.scale.x !== 1 || node.scale.y !== 1)) node.setScale(1, 1, 1);
        if (active.opacity.isValid && active.opacity.opacity !== 255) active.opacity.opacity = 255;
        active.onFrame?.(1);
    }
}
