import { Color, Label, Node, SpriteFrame } from 'cc';

/**
 *大世界地图／基地建造的配色与 UI 构建工具。
 *
 *色板口径（2026-10-21 v2）：参考项目现有 Q 版卡通等距美术（`grounds/` 地块 + `barracks-*` 建筑 +
 *`decor/wasteland` 道具），UI 走「浅色纸卡 + 深棕包边 + 橙色主按钮」，与美术同源。
 *
 *三条硬约束（缺一条卡片就糊进沙色地图）：
 *1. 卡片/面板必须有 2px `border` 深棕描边（不靠阴影分隔）；
 *2. 需要立体感时配深色厚边（`drawPanel` 的 stroke）；
 *3. 文字一律深棕 `text`，不要白字——白字在浅色卡上不可读。
 *
 * `gold` 现在是橙色（`#E8891A`）：旧版是金黄色，在浅沙底上对比只有 1.5:1。
 *任何「金色文字压在地图上」的写法都要改成压深色底或换 `danger`。
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
    //地形（大地图底色）—— 与美术地块同色系，不随 UI 变。
    plain: new Color(38, 52, 42, 255),
    forest: new Color(32, 66, 46, 255),
    rock: new Color(56, 56, 60, 255),
    water: new Color(30, 58, 86, 255),
    gridLine: new Color(70, 92, 74, 130),
    ringLine: new Color(120, 156, 126, 190),
} as const;

/**
 *势力范围色板 —— 无主势力用的颜色（2026-10-21 用户口径：
 * 「每个城池占据的势力范围都用颜色叠加，相邻的势力用不同的颜色」）。
 *
 *五条约束，缺一条就会毁掉地图：
 *1.  不许出现红族与绿族（2026-10-28 用户口径：「除了红色和绿色外，用任意颜色填充」）。
 *   红 = 被其他玩家占据、绿 = 被我占据，这两个色相由归属独占（见下面的
 *   `BIGMAP_TERRITORY_SELF_COLOR` / `BIGMAP_TERRITORY_ENEMY_COLOR`）；色板里再放绿/红，
 *   玩家就分不清「这块地是谁的」和「这块地的势力编号是多少」。
 *   旧色板里的「苔绿 / 砖红」就是因此被移除的。
 *2.  一律走冷色系（2026-10-28 用户口径：「将橙色和黄色都改成偏冷色系，一定要和背景图的颜色区分开」）。
 *   地图底是暖沙色（`grounds/` 约 `#CFAF8C`）+ 暖赭石装饰 ⇒ 橙 / 黄 / 土褐压在沙地上等于没染
 *   （玩家原话：「橙色和黄色都看不出边界」）。所以色相只取 青 → 蓝 → 紫 这一段
 *   （HSV 160°~330°），和背景天然反色相，叠 41% 也能一眼看出边界。
 *3. 不要用高饱和纯色：纯色压上去像 UI 小红点，不像"势力范围"。统一取「降饱和」。
 *4. 色相要拉开：天蓝 / 青碧 / 紫罗兰 / 蓝紫，相邻两片得靠色相直接分辨（≥ 40°）；
 *   相邻色相不够时靠明度差补（石板蓝 / 青灰 是同色系的深浅两档）。
 *5. 亮度接近：同族内不要忽明忽暗，免得被误读成"深浅等级"。
 *
 *顺序有意义：色板越靠前越"主"，DSATUR 优先取低位 ⇒ 主色只用前 4 个（真布局实测只用 4 色）。
 *后 4 个是备用近色：仅当没有邻接表、退化成「按距离判相邻」时才需要第 5~8 色。
 */
export const BIGMAP_TERRITORY_COLORS: readonly Color[] = [
    new Color(78, 143, 214),    // 天蓝（主，211°）
    new Color(47, 163, 155),    // 青碧（176°）
    new Color(156, 107, 196),   // 紫罗兰（273°）
    new Color(170, 96, 150),    // 藕荷（317°，青→蓝→紫弧上离前三色最远的一档）
    new Color(112, 118, 206),   // 蓝紫（236°，备用）
    new Color(72, 108, 146),    // 石板蓝（211°，暗一档，备用）
    new Color(124, 140, 160),   // 青灰（213°，浅且低饱和，备用）
    new Color(46, 111, 134),    // 深青（196°，备用）
];

/**
 *势力归属色（2026-10-28 用户口径）：
 *- 己方占据的城池 → 绿（「当玩家占据了城池时，城池所属的颜色变成绿色」）；
 *- 其他玩家占据的城池 → 红（「当其他玩家占据了城池时……变成红色」）。
 *
 *取 `BIGMAP_COLORS` 里已有的 `open` / `campOccupied`，与城池角标同一套红绿，
 *让「地图上那片地」和「城头上的状态色」说同一件事。
 */
export const BIGMAP_TERRITORY_SELF_COLOR = BIGMAP_COLORS.open;
export const BIGMAP_TERRITORY_ENEMY_COLOR = BIGMAP_COLORS.campOccupied;

/**
 *「打不了」的据点势力范围色 —— 中性灰 `#757575`（2026-11-26 用户指定色值，
 * 同日口径：「这类不可攻打的城池据点的势力范围都要使用灰色」）。
 *
 * 两条硬约束：
 * 1. **必须严格无色相（r = g = b）**。灰靠「没有颜色」这件事自证，一旦掺一点蓝就落回色板
 *    的「青灰（124,140,160）」—— 玩家会读成「某号势力」，而不是「这块不开」。
 *    用例按饱和度 = 0 断言（`tests/bigmap-transparent-tiles.test.ts`）。
 * 2. **压得比沙地暗一档**。地图底是暖沙（`grounds/` 约 `#CFAF8C`），中灰按 41% 叠上去几乎
 *    就是「没染」（沙色本身亮度已经很高）；取 `#757575` + 52% 才落成一块「发闷的暗灰」，
 *    和周围冷色块、己方绿、他人红都能一眼分开。
 *
 * 判定「打不了」**不看 `state`**（服务器快照会把它改写成 open/occupied），
 * 只看 `IBigMapCityView.unplayable`（配置层：本期未开放 / 未解锁），见 `BigMapWorldView.territoryPaint`。
 *
 * 注意它只管**地块填充**：据点图标与名条仍走原口径（图标见
 * `BigMapWorldView.refresh` 里 `state === 'unavailable'` 的压暗，名条只表达归属）。
 */
export const BIGMAP_TERRITORY_LOCKED_COLOR = new Color(0x75, 0x75, 0x75);

/**
 *势力染色透明度。
 *
 *填充只给 ~40%（`104/255`）：必须透出地块的裂缝与明暗，这正是图片 3「颜色叠加」的样子 ——
 *全不透明就变成色块贴纸，地形和装饰（草/石头）全被盖住。
 *描边给 ~85%：范围边界得看得清，否则相邻两块势力会糊成一片。
 */
export const BIGMAP_TERRITORY_FILL_ALPHA = 104;
export const BIGMAP_TERRITORY_STROKE_ALPHA = 216;

/**
 *己方 / 他人势力的填充浓度（比无主的 `BIGMAP_TERRITORY_FILL_ALPHA` 实一档）。
 *
 *理由：无主色板是「暗两档 + 降饱和」的柔和色，而红绿是状态色 —— 玩家扫一眼地图就要看出
 *「哪几片是我的、哪几片被人占了」。同样的 41% 叠在沙地上，赭橙和红几乎分不开，
 *所以归属地给到 ~59%，仍然透得出地块裂缝，但不靠色相也能看出重点。
 */
export const BIGMAP_TERRITORY_OWNED_FILL_ALPHA = 150;

/**
 *「未开放」据点地块的填充浓度（`BIGMAP_TERRITORY_LOCKED_COLOR` 专用）。
 *
 * 取在无主（104）与归属（150）之间：比无主实 —— 否则那块灰会被沙地吃掉、看不出「封着」；
 * 但又不该比「己方 / 他人占据」更抢眼 —— 那是玩家要冲的目标，未开放只是「别去」。
 */
export const BIGMAP_TERRITORY_LOCKED_FILL_ALPHA = 132;

/**
 *「相邻势力」的判定距离（六边格数）。
 *
 * 这个数字不能取 2（贴身）：城池是按环上槽位排布的（`BigMapWorld.pickRingAnchor`），
 *实测最近的两座城也相距 4 格，按贴身判定等于一条边都没有 —— 结果 25 座城全部拿到
 *同一个颜色，看起来像"根本没染色"（这个坑已经踩过一次，见
 *`tests/bigmap-territory-color.test.ts` 里"至少用到 4 种颜色"那条断言）。
 *
 *取 10 格 ≈ 屏幕上一屏内看得见的两块势力；此时 DSATUR 只用 5 色就能保证任意两块不撞色。
 */
export const BIGMAP_TERRITORY_NEIGHBOR_GAP = 10;

/** 一个用 Graphics 画的方按钮：返回节点、Label、以及置灰方法。 */
export interface IBigMapButton {
    readonly node: Node;
    readonly label: Label;
    setEnabled(enabled: boolean): void;
    setText(text: string): void;
    setSkin(frame: SpriteFrame | null, foreground: Color): void;
}
