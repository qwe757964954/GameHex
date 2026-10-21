import { Color, Graphics, Label, Node, Sprite, UITransform, Vec3, type SpriteFrame } from 'cc';
import type { IZCSpawnRegionHint } from '../model/ZCSpawnRegionHint';

const BUBBLE_WIDTH = 150;
const BUBBLE_HEIGHT = 42;
const BUBBLE_BACKGROUND = new Color(28, 55, 105, 225);
const BUBBLE_TEXT = new Color(255, 255, 255, 255);
/**
 * 气泡切图是「圆角矩形主体（94×36）+ 右下角小尾巴（9px）」一张整图：
 * 九宫格拉伸后主体中心比节点中心高约 5px。Label 以节点中心为基准会相对主体
 * 偏下，所以整体上移这个值对齐「可见主体」，不按含尾巴的整图居中。
 */
const BUBBLE_TEXT_CENTER_OFFSET_Y = 5;
const DEPTH_LABEL: Readonly<Record<IZCSpawnRegionHint['depth'], string>> = {
    front: '前区',
    mid: '中区',
    back: '后区',
};

/**
 * 各纵深的九宫格气泡底图；对应切图 = `image/spawn-region/frame_0X`
 * （`frame_02` 红 = 前区，`frame_01` 绿 = 中/后区，见 `SPAWN_REGION_ART_ROOT`）。
 * 帧缺失时该纵深回退 Graphics 色块（旧样式），不阻断选点流程。
 */
export interface IZCSpawnRegionHintFrames {
    readonly front: SpriteFrame | null;
    readonly mid: SpriteFrame | null;
    readonly back: SpriteFrame | null;
}

interface ISpawnRegionBubble {
    node: Node;
    label: Label;
    /** 有贴图帧时非空（SLICED 九宫格底）；否则回退 Graphics 色块。 */
    sprite: Sprite | null;
    graphics: Graphics | null;
    depth: IZCSpawnRegionHint['depth'] | null;
    hintLabel: string | null;
}

/** Board-local, non-interactive region hints that sit above the hex layer. */
export class ZCSpawnRegionHintOverlay {
    private readonly root = new Node('SpawnRegionHints');
    private readonly bubbles: ISpawnRegionBubble[] = [];
    private readonly frames: Readonly<Partial<IZCSpawnRegionHintFrames>>;

    constructor(parent: Node, frames?: IZCSpawnRegionHintFrames | null) {
        this.frames = frames ?? {};
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

    private ensureBubble(index: number): ISpawnRegionBubble {
        const existing = this.bubbles[index];
        if (existing) return existing;

        const node = new Node(`SpawnRegionHint_${index}`);
        node.layer = this.root.layer;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(BUBBLE_WIDTH, BUBBLE_HEIGHT);
        const hasFrames = this.frames.front != null || this.frames.mid != null
            || this.frames.back != null;
        let sprite: Sprite | null = null;
        let graphics: Graphics | null = null;
        if (hasFrames) {
            sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SLICED;
            sprite.trim = false;
        } else {
            graphics = node.addComponent(Graphics);
            graphics.fillColor = BUBBLE_BACKGROUND;
            graphics.roundRect(-BUBBLE_WIDTH / 2, -BUBBLE_HEIGHT / 2, BUBBLE_WIDTH, BUBBLE_HEIGHT, 10);
            graphics.fill();
        }

        const labelNode = new Node('Label');
        labelNode.layer = this.root.layer;
        labelNode.setPosition(0, BUBBLE_TEXT_CENTER_OFFSET_Y, 0);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(BUBBLE_WIDTH - 12, BUBBLE_HEIGHT);
        const label = labelNode.addComponent(Label);
        label.fontSize = 18;
        label.lineHeight = 22;
        // overflow 默认 NONE 时 verticalAlign 不生效（文本自适应），必须 SHRINK 才有对齐框。
        // 138×42 装「前区 · 速攻」6 个 18 号字符绰绰有余，不会触发 SHRINK 压字号。
        label.overflow = Label.Overflow.SHRINK;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = BUBBLE_TEXT;
        labelNode.setParent(node);
        node.setParent(this.root);

        const bubble: ISpawnRegionBubble = { node, label, sprite, graphics, depth: null, hintLabel: null };
        this.bubbles.push(bubble);
        return bubble;
    }
}
