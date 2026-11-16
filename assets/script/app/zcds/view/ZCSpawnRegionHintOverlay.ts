import { instantiate, Label, Node, Prefab, Sprite, UITransform, Vec3, type SpriteFrame } from 'cc';
import type { IZCSpawnRegionHint } from '../model/ZCSpawnRegionHint';

/** 区域气泡 prefab 的 resources 路径：尺寸、锚点、文字排版与九宫格拉伸都在 prefab 里。 */
export const SPAWN_REGION_HINT_PREFAB = 'ui/game/SpawnRegionHint';
const DEPTH_LABEL: Readonly<Record<IZCSpawnRegionHint['depth'], string>> = {
    front: '前区',
    mid: '中区',
    back: '后区',
};

/**
 * 各纵深的九宫格气泡底图；对应切图 = `image/spawn-region/frame_0X`
 * （`frame_02` 红 = 前区，`frame_01` 绿 = 中/后区，见 `SPAWN_REGION_ART_ROOT`）。
 * 帧缺失时保留 prefab 的默认底图，不阻断选点流程。
*/
export interface IZCSpawnRegionHintFrames {
    readonly front: SpriteFrame | null;
    readonly mid: SpriteFrame | null;
    readonly back: SpriteFrame | null;
}

interface ISpawnRegionBubble {
    node: Node;
    label: Label;
    /** 有贴图帧时非空（SLICED 九宫格底）。*/
    sprite: Sprite | null;
    depth: IZCSpawnRegionHint['depth'] | null;
    hintLabel: string | null;
}

/** Board-local, non-interactive region hints that sit above the hex layer.*/
export class ZCSpawnRegionHintOverlay {
    private readonly root = new Node('SpawnRegionHints');
    private readonly bubbles: ISpawnRegionBubble[] = [];
    private readonly frames: Readonly<Partial<IZCSpawnRegionHintFrames>>;
    private readonly prefab: Prefab | null;

    constructor(parent: Node, frames?: IZCSpawnRegionHintFrames | null, prefab?: Prefab | null) {
        this.frames = frames ?? {};
        this.prefab = prefab ?? null;
        this.root.layer = parent.layer;
        this.root.addComponent(UITransform);
        this.root.setPosition(Vec3.ZERO);
        this.root.setParent(parent);
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
            if (!bubble) return;
            if (!bubble.node.active) bubble.node.active = true;
            if (bubble.node.position.x !== hint.x || bubble.node.position.y !== hint.y) {
                bubble.node.setPosition(hint.x, hint.y, 0);
            }
            if (bubble.node.scale.x !== counterScale || bubble.node.scale.y !== counterScale) {
                bubble.node.setScale(counterScale, counterScale, 1);
            }
            if (bubble.sprite) {
                const frame = this.frames[hint.depth] ?? null;
                if (bubble.sprite.spriteFrame !== frame) bubble.sprite.spriteFrame = frame;
            }
            if (bubble.depth !== hint.depth || bubble.hintLabel !== hint.label) {
                bubble.label.string = `${DEPTH_LABEL[hint.depth]} · ${hint.label}`;
                bubble.depth = hint.depth;
                bubble.hintLabel = hint.label;
            }
        }
        for (let index = count; index < this.bubbles.length; index += 1) {
            if (this.bubbles[index].node.active) this.bubbles[index].node.active = false;
        }
    }

    clear(): void {
        if (this.root.isValid) this.root.destroy();
        this.bubbles.length = 0;
    }

    private ensureBubble(index: number): ISpawnRegionBubble | null {
        const existing = this.bubbles[index];
        if (existing) return existing;
        if (!this.prefab) return null;

        const node = instantiate(this.prefab);
        node.name = `SpawnRegionHint_${index}`;
        node.layer = this.root.layer;
        node.setParent(this.root);
        const sprite = node.getComponent(Sprite);
        const labelNode = node.getChildByName('Label');
        const label = labelNode?.getComponent(Label) ?? null;
        if (!label) {
            node.destroy();
            return null;
        }
        const bubble: ISpawnRegionBubble = { node, label, sprite, depth: null, hintLabel: null };
        this.bubbles.push(bubble);
        return bubble;
    }
}
