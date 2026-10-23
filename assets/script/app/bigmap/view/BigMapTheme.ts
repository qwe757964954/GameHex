import { Color, Graphics, Label, Layers, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';

/**
 * 大世界地图／基地建造的配色与 UI 构建工具。
 *
 * 色板口径（2026-10-21 v2）：参考项目现有 Q 版卡通等距美术（`grounds/` 地块 + `barracks-*` 建筑 +
 * `decor/wasteland` 道具），UI 走「浅色纸卡 + 深棕包边 + 橙色主按钮」，与美术同源。
 *
 * 三条硬约束（缺一条卡片就糊进沙色地图）：
 * 1. 卡片/面板必须有 2px `border` 深棕描边（不靠阴影分隔）；
 * 2. 需要立体感时配深色厚边（`drawPanel` 的 stroke）；
 * 3. 文字一律深棕 `text`，不要白字——白字在浅色卡上不可读。
 *
 * ⚠️ `gold` 现在是橙色（`#E8891A`）：旧版是金黄色，在浅沙底上对比只有 1.5:1。
 * 任何「金色文字压在地图上」的写法都要改成压深色底或换 `danger`。
 */
export const BIGMAP_COLORS = {
    campOccupied: new Color(220, 60, 50, 255),
    campUnoccupied: new Color(245, 205, 60, 255),
    /** 页面最底（地图未覆盖处的露底）。 */
    pageBg: new Color(201, 176, 138, 255),
    /** 纸面（面板/弹窗底）。 */
    panel: new Color(248, 239, 221, 250),
    /** 卡片底（比纸面暖一档）。 */
    panelLight: new Color(245, 224, 172, 255),
    /** 统一描边。 */
    border: new Color(176, 138, 78, 255),
    /** 主强调 = 橙（按钮/数值/标题）。 */
    gold: new Color(232, 137, 26, 255),
    /** 正文深棕。 */
    text: new Color(90, 58, 24, 255),
    /** 次要信息。 */
    muted: new Color(138, 106, 68, 255),
    /** 危险 / 消耗不足。 */
    danger: new Color(180, 70, 15, 255),
    /** 己方占领 / 可挑战。 */
    open: new Color(95, 168, 46, 255),
    /** 未解锁。 */
    locked: new Color(138, 128, 115, 255),
    occupied: new Color(232, 137, 26, 255),
    unavailable: new Color(74, 79, 74, 255),
    /** 玩家基地。 */
    player: new Color(62, 134, 216, 255),
    npc: new Color(193, 105, 74, 255),
    // 地形（大地图底色）—— 与美术地块同色系，不随 UI 变。
    plain: new Color(38, 52, 42, 255),
    forest: new Color(32, 66, 46, 255),
    rock: new Color(56, 56, 60, 255),
    water: new Color(30, 58, 86, 255),
    gridLine: new Color(70, 92, 74, 130),
    ringLine: new Color(120, 156, 126, 190),
} as const;

/** 卡片底部厚边（`shadow` 用；`drawPanel` 不画，留给 prefab 的九宫）。 */
export const BIGMAP_EDGE_DARK = new Color(122, 87, 48, 255);

/**
 * 势力范围色板（2026-10-21 用户口径：*「每个城池占据的势力范围都用颜色叠加，相邻的势力用不同的颜色」*）。
 *
 * 三条约束，缺一条就会毁掉地图：
 * 1. **不要用高饱和纯色**：地图底是浅沙色（`grounds/` 约 `#CFAF8C`），纯红纯蓝压上去像 UI 小红点，
 *    不像"势力范围"。这里统一取「暗两档 + 降饱和」，和现有美术的苔绿/赭石同族。
 * 2. **色相要拉开**：绿 / 赭 / 蓝 / 紫 / 红 / 青 / 麦黄 / 岩灰，8 个色相互相≥ 40°，
 *    缩略图上也能一眼分辨。
 * 3. **亮度接近**：只用色相区分势力，不靠明暗 —— 明暗会让人误读成"深浅等级"。
 *
 * 顺序有意义：色板越靠前越"主"，DSATUR 优先取低位，所以主力势力集中在绿/赭/蓝。
 */
export const BIGMAP_TERRITORY_COLORS: readonly Color[] = [
    new Color(96, 170, 104),    // 苔绿
    new Color(206, 132, 62),    // 赭橙
    new Color(92, 138, 208),    // 靛蓝
    new Color(166, 106, 190),   // 紫罗兰
    new Color(202, 94, 92),     // 砖红
    new Color(72, 168, 166),    // 青碧
    new Color(186, 168, 72),    // 麦黄
    new Color(120, 122, 132),   // 岩灰
];

/**
 * 势力染色透明度。
 *
 * 填充只给 ~40%（`104/255`）：**必须透出地块的裂缝与明暗**，这正是图片 3「颜色叠加」的样子 ——
 * 全不透明就变成色块贴纸，地形和装饰（草/石头）全被盖住。
 * 描边给 ~85%：范围边界得看得清，否则相邻两块势力会糊成一片。
 */
export const BIGMAP_TERRITORY_FILL_ALPHA = 104;
export const BIGMAP_TERRITORY_STROKE_ALPHA = 216;

/**
 * 「相邻势力」的判定距离（六边格数）。
 *
 * ⚠️ 这个数字不能取 2（贴身）：城池是按环上槽位排布的（`BigMapWorld.pickRingAnchor`），
 * 实测**最近的两座城也相距 4 格**，按贴身判定等于一条边都没有 —— 结果 25 座城全部拿到
 * 同一个颜色，看起来像"根本没染色"（这个坑已经踩过一次，见
 * `tests/bigmap-territory-color.test.ts` 里"至少用到 4 种颜色"那条断言）。
 *
 * 取 10 格 ≈ 屏幕上一屏内看得见的两块势力；此时 DSATUR 只用 5 色就能保证任意两块不撞色。
 */
export const BIGMAP_TERRITORY_NEIGHBOR_GAP = 10;

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
    setSkin(frame: SpriteFrame | null, foreground: Color): void;
}

export function createButton(
    parent: Node,
    text: string,
    width: number,
    height: number,
    onClick: () => void,
    fontSize = 20,
    isPrimary = false,
): IBigMapButton {
    const node = createUiNode(`Btn_${text}`, parent, width, height);
    const graphics = node.addComponent(Graphics);
    const label = createLabel(node, text, fontSize, BIGMAP_COLORS.text, width - 8, height);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    let enabled = true;
    let skin: Sprite | null = null;
    let skinForeground: Color | null = null;
    const paint = (): void => {
        drawPanel(
            graphics, width, height,
            enabled ? (isPrimary ? BIGMAP_COLORS.gold : BIGMAP_COLORS.panelLight) : BIGMAP_COLORS.panel,
            enabled ? (isPrimary ? new Color(66, 42, 19) : BIGMAP_COLORS.border) : BIGMAP_COLORS.muted,
        );
        label.color = enabled ? (isPrimary ? new Color(48, 34, 22) : BIGMAP_COLORS.text) : BIGMAP_COLORS.muted;
        if (skin && skinForeground) {
            skin.color = enabled ? Color.WHITE : new Color(140, 140, 140);
            label.color = enabled ? skinForeground : new Color(167, 159, 143);
        }
    };
    paint();
    node.on(Node.EventType.TOUCH_END, () => { if (enabled) onClick(); });
    return {
        node,
        label,
        setEnabled: (value: boolean) => { enabled = value; paint(); },
        setText: (value: string) => { label.string = value; },
        setSkin: (frame: SpriteFrame | null, foreground: Color) => {
            if (!frame) return;
            if (!skin) {
                skin = createUiNode('ButtonArt', node, width, height).addComponent(Sprite);
                skin.type = Sprite.Type.SLICED;
                skin.sizeMode = Sprite.SizeMode.CUSTOM;
                skin.trim = false;
                skin.node.setSiblingIndex(0);
            }
            graphics.enabled = false;
            skin.spriteFrame = frame;
            skinForeground = foreground;
            paint();
        },
    };
}

/** 把节点放到父节点坐标系里的某点（保持 z=0）。 */
export function placeAt(node: Node, x: number, y: number): void {
    node.setPosition(new Vec3(x, y, 0));
}
