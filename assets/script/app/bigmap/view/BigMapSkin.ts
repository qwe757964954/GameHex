import { Color, Graphics, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { createUiNode } from './BigMapTheme';

export const BIGMAP_SKIN_COLORS = {
    text: new Color(245, 233, 205),
    muted: new Color(189, 180, 161),
    gold: new Color(255, 202, 92),
    dark: new Color(41, 32, 21),
    cyan: new Color(79, 216, 228),
};

/**
 * 世界页「领地页 HUD 皮肤」的配色真源（2026-10-22 第二轮用户口径：
 * *「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式」*，
 * 追问后确认走**领地页顶部 HUD 那套**：半透明深色卡 + 金线，而不是底部菜单栏的木牌）。
 *
 * 数值是**取色取出来的**，不是估的 —— 见 `image/main/hud/hud_player_card.png`：
 *   中心 `(72,73,83)` 深板岩灰、描边 `(7,7,8)` 近黑 2px、圆角外透明；
 *   资源/聊天条 `hud_entry_bar` / `hud_chat_bar` 是**纯黑 alpha 153**（= 60%，透出地图）。
 * 所以这里把「卡」定义成「60%~90% 的黑板岩 + 2px 近黑描边」，靠底色深浅分层，不靠阴影。
 *
 * ⚠️ 和上面的 `BIGMAP_SKIN_COLORS` 分工不同：那套是**地图上的据点**（浅色纸卡风）用的老色板，
 * 这里只服务「浮在地图上的 HUD 面板」。两套不要互相改。
 */
export const BIGMAP_HUD_COLORS = {
    /** 面板底（深板岩，90%）—— 透出一点地图，和领地页玩家卡同一个观感。 */
    card: new Color(72, 73, 83, 232),
    /** 更深一档：队列条 / 次级条。 */
    cardDeep: new Color(46, 47, 55, 240),
    /** 行 / 卡片底（比面板亮一档，压出层次）。 */
    cardLight: new Color(92, 93, 104, 236),
    /** 描边（近黑 2px）—— `hud_player_card` 的边就是这个色。 */
    rim: new Color(7, 7, 8, 255),
    /** 铜金细线（内圈 1px）—— 领地页的金色描边在暗底上的低饱和版。 */
    line: new Color(176, 138, 78, 170),
    /** 米白正文。 */
    cream: new Color(238, 235, 214, 255),
    muted: new Color(178, 176, 168, 255),
    /** 标题 / 强调金。 */
    gold: new Color(245, 201, 92, 255),
    /** 压金色按钮上的文字色（深棕，不用纯黑：纯黑在暖底上发脏）。 */
    ink: new Color(48, 34, 22, 255),
    /** 危险 / 消耗不足。 */
    danger: new Color(214, 96, 62, 255),
    /** 弹窗暗底（与领地页 `TerritorySiteDetail` 的 `Dim` 同值：5,10,14,205）。 */
    scrim: new Color(5, 10, 14, 205),
} as const;

export function createBigMapSprite(name: string, parent: Node): Sprite {
    const sprite = createUiNode(name, parent).addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.RAW;
    sprite.trim = false;
    return sprite;
}

export function requireBigMapTransform(node: Node): UITransform {
    const transform = node.getComponent(UITransform);
    if (!transform) throw new Error(`[BigMap] ${node.name} 缺少 UITransform`);
    return transform;
}

export function applyBigMapPanel(node: Node, frame: SpriteFrame | null): Sprite | null {
    if (!frame) return null;
    const transform = requireBigMapTransform(node);
    const graphics = node.getComponent(Graphics);
    if (graphics) graphics.enabled = false;
    const sprite = createBigMapSprite('PanelArt', node);
    sprite.type = Sprite.Type.SLICED;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    requireBigMapTransform(sprite.node).setContentSize(transform.width, transform.height);
    sprite.node.setSiblingIndex(0);
    return sprite;
}

export function fitBigMapSprite(sprite: Sprite, frame: SpriteFrame | null, width: number, x = 0, y = 0): void {
    sprite.spriteFrame = frame;
    sprite.node.active = !!frame;
    if (!frame) return;
    const scale = width / Math.max(1, frame.rect.width);
    sprite.node.setScale(scale, scale, 1);
    sprite.node.setPosition(x - frame.offset.x * scale, y - frame.offset.y * scale, 0);
}

/**
 * 画一块**领地页 HUD 卡**：近黑描边 → 深板岩底 → 铜金细线，三层叠出来。
 *
 * 为什么手画而不是贴 `hud_player_card` 九宫：
 *  · 那张图 **没有九宫边**（`.meta` 里 border 全 0），是给固定 335×122 用的；我们这一堆面板从
 *    62 高的资源条到 400 高的弹窗都有，SIMPLE 拉伸会把圆角和右上角那块小装饰一起拉糊；
 *  · 卡面本身就是「纯色 + 描边」，手画能精确对齐 2px 边和 1px 金线，还省一张贴图。
 *
 * 三层与木牌皮肤同构（只是配色换了），所以调用点只改函数名。
 *
 * @param radius 圆角；顶栏给 0（通栏），浮层卡片给 12~14。
 */
export function drawBigMapCardPanel(
    graphics: Graphics,
    width: number,
    height: number,
    radius = 12,
    fill: Color = BIGMAP_HUD_COLORS.card,
): void {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    // ⚠️ inset 只跟「厚度」有关，**不能跟圆角挂钩**：通栏条是 radius 0，
    //    若写成 `min(2, r)`，圆角 0 就 inset 0 ⇒ 底色盖满整块、描边和金线全没了。
    const maxInset = Math.max(1, Math.floor(Math.min(width, height) / 2) - 1);
    const inset = Math.min(2, maxInset);
    const lineInset = Math.min(4, maxInset);
    graphics.clear();
    // 1) 描边：整块铺近黑，露出来的那 2px 就是边框。
    graphics.fillColor = BIGMAP_HUD_COLORS.rim;
    graphics.roundRect(-width / 2, -height / 2, width, height, r);
    graphics.fill();
    // 2) 卡面：往里收 2px。
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, Math.max(0, r - inset));
    graphics.fill();
    // 3) 铜金细线：再往里收 2px，1px —— 只提一条亮边，别做成第二道框。
    if (width - lineInset * 2 > 0 && height - lineInset * 2 > 0) {
        graphics.strokeColor = BIGMAP_HUD_COLORS.line;
        graphics.lineWidth = 1;
        graphics.roundRect(
            -width / 2 + lineInset, -height / 2 + lineInset,
            width - lineInset * 2, height - lineInset * 2, Math.max(0, r - lineInset),
        );
        graphics.stroke();
    }
}

/**
 * 给节点挂一块 HUD 卡（幂等：有 `Graphics` 就重画，没有就加一个）。
 *
 * 与 `applyBigMapPanel` 分工：那个贴成品概念图（深铁框），这个手画深色卡。
 * 两者都往 `siblingIndex(0)` 压，前景内容不用动层级。
 */
export function paintBigMapCardPanel(
    node: Node,
    width: number,
    height: number,
    radius = 12,
    fill: Color = BIGMAP_HUD_COLORS.card,
): Graphics {
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.enabled = true;
    drawBigMapCardPanel(graphics, width, height, radius, fill);
    return graphics;
}
