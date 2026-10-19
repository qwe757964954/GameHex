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

    render(hints: readonly IZCSpawnRegionHint[], visible: boolean): void {
        const count = Math.min(hints.length, 3);
        this.root.active = visible && count > 0;
        for (let index = 0; index < count; index += 1) {
            const hint = hints[index];
            const bubble = this.ensureBubble(index);
            bubble.node.active = visible;
            bubble.node.setPosition(hint.x, hint.y, 0);
            bubble.label.string = `${DEPTH_LABEL[hint.depth]} · ${hint.label}`;
            bubble.label.color = BUBBLE_TEXT;
            bubble.graphics.clear();
            bubble.graphics.fillColor = BUBBLE_BACKGROUND;
            bubble.graphics.roundRect(-BUBBLE_WIDTH / 2, -BUBBLE_HEIGHT / 2, BUBBLE_WIDTH, BUBBLE_HEIGHT, 10);
            bubble.graphics.fill();
        }
        for (let index = count; index < this.bubbles.length; index += 1) {
            this.bubbles[index].node.active = false;
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

        const bubble = { node, label, graphics };
        this.bubbles.push(bubble);
        return bubble;
    }
}
