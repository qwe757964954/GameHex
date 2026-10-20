import { Color, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import type { IZCSpawnRegionHint } from '../model/ZCSpawnRegionHint';

const BUBBLE_WIDTH = 150;
const BUBBLE_HEIGHT = 42;
const BUBBLE_BACKGROUND = new Color(28, 55, 105, 225);
const BUBBLE_TEXT = new Color(255, 255, 255, 255);
const DEPTH_LABEL: Readonly<Record<IZCSpawnRegionHint['depth'], string>> = {
    front: '前区',
    mid: '中区',
    back: '后区',
};

interface ISpawnRegionBubble {
    node: Node;
    label: Label;
    graphics: Graphics;
    depth: IZCSpawnRegionHint['depth'] | null;
    hintLabel: string | null;
}

/** Board-local, non-interactive region hints that sit above the hex layer. */
export class ZCSpawnRegionHintOverlay {
    private readonly root = new Node('SpawnRegionHints');
    private readonly bubbles: ISpawnRegionBubble[] = [];

    constructor(parent: Node) {
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
            if (!bubble.node.active) bubble.node.active = true;
            if (bubble.node.position.x !== hint.x || bubble.node.position.y !== hint.y) {
                bubble.node.setPosition(hint.x, hint.y, 0);
            }
            if (bubble.node.scale.x !== counterScale || bubble.node.scale.y !== counterScale) {
                bubble.node.setScale(counterScale, counterScale, 1);
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

    private ensureBubble(index: number): ISpawnRegionBubble {
        const existing = this.bubbles[index];
        if (existing) return existing;

        const node = new Node(`SpawnRegionHint_${index}`);
        node.layer = this.root.layer;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(BUBBLE_WIDTH, BUBBLE_HEIGHT);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = BUBBLE_BACKGROUND;
        graphics.roundRect(-BUBBLE_WIDTH / 2, -BUBBLE_HEIGHT / 2, BUBBLE_WIDTH, BUBBLE_HEIGHT, 10);
        graphics.fill();

        const labelNode = new Node('Label');
        labelNode.layer = this.root.layer;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(BUBBLE_WIDTH - 12, BUBBLE_HEIGHT);
        const label = labelNode.addComponent(Label);
        label.fontSize = 18;
        label.lineHeight = 22;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = BUBBLE_TEXT;
        labelNode.setParent(node);
        node.setParent(this.root);

        const bubble = { node, label, graphics, depth: null, hintLabel: null };
        this.bubbles.push(bubble);
        return bubble;
    }
}
