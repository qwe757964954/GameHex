import { instantiate, Node, Prefab } from 'cc';
import type { ZCDepth } from '../model/ZCMapConfig';
import type { IZCSpawnRegionHint } from '../model/ZCSpawnRegionHint';
import { ZCSpawnRegionHintView } from './ZCSpawnRegionHintView';

const DEPTH_LABEL: Readonly<Record<ZCDepth, string>> = {
    front: '前区',
    mid: '中区',
    back: '后区',
};

function applyLayerRecursive(node: Node, layer: number): void {
    node.layer = layer;
    for (const child of node.children) {
        applyLayerRecursive(child, layer);
    }
}

/**
 * 棋盘局部、非交互的自选主城区域提示气泡层。
 *
 * 挂载容器来自 `ZCGameBoard.prefab` 的 `CooldownOverlay/SpawnRegionHints`，
 * 气泡尺寸、九宫格底图帧与字体排版全部由 `SpawnRegionHint.prefab`（`ZCSpawnRegionHintView`）提供。
 */
export class ZCSpawnRegionHintOverlay {
    private readonly bubbles: ZCSpawnRegionHintView[] = [];

    constructor(
        private readonly root: Node,
        private readonly prefab: Prefab,
    ) {
        this.root.active = false;
    }

    render(hints: readonly IZCSpawnRegionHint[], visible: boolean, mapScale: number): void {
        const count = Math.min(hints.length, 3);
        const shouldShow = visible && count > 0;
        if (this.root.active !== shouldShow) this.root.active = shouldShow;
        if (!shouldShow) return;
        const counterScale = Number.isFinite(mapScale) && mapScale > 0 ? 1 / mapScale : 1;
        for (let index = 0; index < count; index += 1) {
            const hint = hints[index];
            const bubble = this.ensureBubble(index);
            const node = bubble.node;
            if (!node.active) node.active = true;
            if (node.position.x !== hint.x || node.position.y !== hint.y) {
                node.setPosition(hint.x, hint.y, 0);
            }
            if (node.scale.x !== counterScale || node.scale.y !== counterScale) {
                node.setScale(counterScale, counterScale, 1);
            }
            bubble.applyHint(hint.depth, `${DEPTH_LABEL[hint.depth]} · ${hint.label}`);
        }
        for (let index = count; index < this.bubbles.length; index += 1) {
            if (this.bubbles[index].node.active) this.bubbles[index].node.active = false;
        }
    }

    clear(): void {
        for (const bubble of this.bubbles) {
            if (bubble.node.isValid) bubble.node.destroy();
        }
        this.bubbles.length = 0;
        if (this.root.isValid) this.root.active = false;
    }

    private ensureBubble(index: number): ZCSpawnRegionHintView {
        const existing = this.bubbles[index];
        if (existing) return existing;
        const node = instantiate(this.prefab);
        node.name = `SpawnRegionHint_${index}`;
        applyLayerRecursive(node, this.root.layer);
        node.setParent(this.root);
        const view = node.getComponent(ZCSpawnRegionHintView);
        this.bubbles.push(view);
        return view;
    }
}
