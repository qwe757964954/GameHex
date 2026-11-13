import { Color, Graphics, Node, Sprite, SpriteFrame, UITransform } from 'cc';

export const BIGMAP_SKIN_COLORS = {
    text: new Color(245, 233, 205),
    /** 名字牌描边（参考图口径：白字压一圈深边，沙地/建筑上都压得住）。 */
    nameOutline: new Color(34, 30, 24, 255),
    muted: new Color(189, 180, 161),
    gold: new Color(255, 202, 92),
    dark: new Color(41, 32, 21),
    /** @deprecated 压在地图沙地上只有 1.22:1（选中态等于看不见），改用 {@link selectOuter} 双环。 */
    cyan: new Color(79, 216, 228),
    /**
     *地图上「选中」的双环配色：外深内金。
     *
     *沙地底色 `(201,176,138)` 亮度高，亮色单环最高只能到 2.09:1（纯白），
     *原来的 cyan 只有 1.22:1。深色外环 `(20,18,14)` 对沙地 8.96:1 撑起可辨识度，
     *暖金内环（1.38:1）只负责"这一格是我的"这层语感，不承担对比度。
     */
    selectOuter: new Color(20, 18, 14, 210),
    selectInner: new Color(255, 202, 92, 255),
    /** 放置预判：可放（对沙地 3.87:1）/ 不可放（5.06:1）。都配 ✓/✕，不只靠颜色。 */
    placeOk: new Color(24, 92, 40, 235),
    placeBad: new Color(122, 26, 26, 235),
    /** 选中底光（暖金压 25% —— 只是「亮了一点」，不参与对比度计算）。 */
    glowFill: new Color(255, 226, 150, 64),
    /** 进度环底圈 / 已建部分 / 剩余不足 1 分钟。 */
    ringUnder: new Color(28, 24, 18, 150),
    ringDone: new Color(255, 202, 92, 255),
    ringUrgent: new Color(255, 140, 90, 255),
};

/**
 *世界页「领地页 HUD 皮肤」的配色真源（2026-10-22 第二轮用户口径：
 * 「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式」，
 *追问后确认走领地页顶部 HUD 那套：半透明深色卡 + 金线，而不是底部菜单栏的木牌）。
 *
 *数值是取色取出来的，不是估的 —— 见 `image/main/hud/hud_player_card.png`：
 *  中心 `(72,73,83)` 深板岩灰、描边 `(7,7,8)` 近黑 2px、圆角外透明；
 *  资源/聊天条 `hud_entry_bar` / `hud_chat_bar` 是纯黑 alpha 153（= 60%，透出地图）。
 *所以这里把「卡」定义成「60%~90% 的黑板岩 + 2px 近黑描边」，靠底色深浅分层，不靠阴影。
 *
 * 和上面的 `BIGMAP_SKIN_COLORS` 分工不同：那套是地图上的据点（浅色纸卡风）用的老色板，
 *这里只服务「浮在地图上的 HUD 面板」。两套不要互相改。
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
    /**
     *危险 / 消耗不足（只能用于浅底或图标）。
     *
     * 实测对比度：压 `cardDeep` 3.55:1、压 `cardLight` 只有 1.74:1，正文（需 ≥4.5）不合格。
     *深色卡上的「不足 / 锁定」文字一律用 {@link BIGMAP_HUD_COLORS.dangerText}。
     */
    danger: new Color(214, 96, 62, 255),
    /**
     *深色卡上的「不足 / 锁定」正文色 —— `(255,205,190)` 在 `cardLight` 上 4.57:1、`card` 上 5.6:1。
     *
     *注意它读起来更像「提示」而不是「警告」：这是深底 UI 的固有限制 —— 深底上能达到 4.5 的
     *只有浅色，所以「不足」的警示由文案（差多少）+ 位置承担，不靠红。
     */
    dangerText: new Color(255, 205, 190, 255),
    /**
     *深色卡上的次要文字 —— `(224,220,208)` 在 `cardLight` 上 4.76:1。
     *
     *原来的 `muted(178,176,168)` 压 `cardLight` 只有 3.00、压 `card` 4.11，正文全部不合格。
     */
    mutedText: new Color(224, 220, 208, 255),
    /** 弹窗暗底（与领地页 `TerritorySiteDetail` 的 `Dim` 同值：5,10,14,205）。 */
    scrim: new Color(5, 10, 14, 205),
} as const;

export function requireBigMapTransform(node: Node): UITransform {
    const transform = node.getComponent(UITransform);
    if (!transform) throw new Error(`[BigMap] ${node.name} 缺少 UITransform`);
    return transform;
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
 *画一块领地页 HUD 卡：近黑描边 → 深板岩底 → 铜金细线，三层叠出来。
 *
 *为什么手画而不是贴 `hud_player_card` 九宫：
 * · 那张图 没有九宫边（`.meta` 里 border 全 0），是给固定 335×122 用的；我们这一堆面板从
 *   62 高的资源条到 400 高的弹窗都有，SIMPLE 拉伸会把圆角和右上角那块小装饰一起拉糊；
 * · 卡面本身就是「纯色 + 描边」，手画能精确对齐 2px 边和 1px 金线，还省一张贴图。
 *
 *三层与木牌皮肤同构（只是配色换了），所以调用点只改函数名。
 *
 *@param radius 圆角；顶栏给 0（通栏），浮层卡片给 12~14。
 */
export function drawBigMapCardPanel(
    graphics: Graphics,
    width: number,
    height: number,
    radius = 12,
    fill: Color = BIGMAP_HUD_COLORS.card,
): void {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    // inset 只跟「厚度」有关，不能跟圆角挂钩：通栏条是 radius 0，
    //   若写成 `min(2, r)`，圆角 0 就 inset 0 ⇒ 底色盖满整块、描边和金线全没了。
    const maxInset = Math.max(1, Math.floor(Math.min(width, height) / 2) - 1);
    const inset = Math.min(2, maxInset);
    const lineInset = Math.min(4, maxInset);
    graphics.clear();
    //1) 描边：整块铺近黑，露出来的那 2px 就是边框。
    graphics.fillColor = BIGMAP_HUD_COLORS.rim;
    graphics.roundRect(-width / 2, -height / 2, width, height, r);
    graphics.fill();
    //2) 卡面：往里收 2px。
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, Math.max(0, r - inset));
    graphics.fill();
    //3) 铜金细线：再往里收 2px，1px —— 只提一条亮边，别做成第二道框。
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
