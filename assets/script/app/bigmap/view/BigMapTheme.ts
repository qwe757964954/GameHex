import { Color, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';

/**
 * 大世界地图／基地建造的**线框配色与节点构建工具**。
 *
 * 本模块是刻意做成「零美术依赖」的：用户 2026-10-17 要求「先用游戏内现有的美术资源或线框图做示意」，
 * 而大世界的美术还没出，所以整套界面用 `Graphics` + `Label` 现画。
 * 等美术到位后，只需把这里的 `drawPanel` / 图标节点换成 Sprite，布局不用动。
 */

export const BIGMAP_COLORS = {
    pageBg: new Color(18, 24, 20, 255),
    panel: new Color(30, 40, 34, 240),
    panelLight: new Color(44, 58, 48, 255),
    border: new Color(96, 122, 100, 255),
    gold: new Color(240, 206, 108, 255),
    text: new Color(232, 240, 228, 255),
    muted: new Color(150, 168, 152, 255),
    danger: new Color(214, 92, 76, 255),
    open: new Color(96, 196, 120, 255),
    locked: new Color(120, 120, 120, 255),
    occupied: new Color(240, 206, 108, 255),
    unavailable: new Color(70, 76, 72, 255),
    player: new Color(86, 150, 236, 255),
    npc: new Color(186, 132, 96, 255),
    // 地形（大地图底色）
    plain: new Color(38, 52, 42, 255),
    forest: new Color(32, 66, 46, 255),
    rock: new Color(56, 56, 60, 255),
    water: new Color(30, 58, 86, 255),
    gridLine: new Color(70, 92, 74, 130),
    ringLine: new Color(120, 156, 126, 190),
} as const;

/** 建一个 UI 节点（默认挂在 UI_2D 层，否则 Canvas 不渲染）。 */
export function createUiNode(name: string, parent: Node, width = 0, height = 0): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    node.setParent(parent);
    return node;
}

/** 建一个 Label 节点（左对齐的正文 / 居中的标题都用它，靠 `align` 区分）。 */
export function createLabel(
    parent: Node,
    text: string,
    fontSize: number,
    color: Color,
    width = 0,
    height = 0,
): Label {
    const node = createUiNode(`Label_${text.slice(0, 6)}`, parent, width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.32);
    label.color = color;
    label.useSystemFont = true;
    label.overflow = Label.Overflow.NONE;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
}

/** 画一块面板底（圆角 + 描边），所有面板 / 按钮共用这一套观感。 */
export function drawPanel(
    graphics: Graphics,
    width: number,
    height: number,
    fill: Color,
    stroke: Color | null = BIGMAP_COLORS.border,
    radius = 8,
): void {
    graphics.clear();
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    if (stroke) {
        graphics.strokeColor = stroke;
        graphics.lineWidth = 2;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.stroke();
    }
}

/** 一个用 Graphics 画的方按钮：返回节点、Label、以及置灰方法。 */
export interface IBigMapButton {
    readonly node: Node;
    readonly label: Label;
    setEnabled(enabled: boolean): void;
    setText(text: string): void;
}

export function createButton(
    parent: Node,
    text: string,
    width: number,
    height: number,
    onClick: () => void,
    fontSize = 20,
): IBigMapButton {
    const node = createUiNode(`Btn_${text}`, parent, width, height);
    const graphics = node.addComponent(Graphics);
    const label = createLabel(node, text, fontSize, BIGMAP_COLORS.text, width - 8, height);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    let enabled = true;
    const paint = (): void => {
        drawPanel(
            graphics, width, height,
            enabled ? BIGMAP_COLORS.panelLight : BIGMAP_COLORS.panel,
            enabled ? BIGMAP_COLORS.border : BIGMAP_COLORS.muted,
        );
        label.color = enabled ? BIGMAP_COLORS.text : BIGMAP_COLORS.muted;
    };
    paint();
    node.on(Node.EventType.TOUCH_END, () => { if (enabled) onClick(); });
    return {
        node,
        label,
        setEnabled: (value: boolean) => { enabled = value; paint(); },
        setText: (value: string) => { label.string = value; },
    };
}

/** 把节点放到父节点坐标系里的某点（保持 z=0）。 */
export function placeAt(node: Node, x: number, y: number): void {
    node.setPosition(new Vec3(x, y, 0));
}
