/**
 * 商城版面表与美术表。引擎无关，构建器和单测都直接 import。
 *
 * FGUI 真源是 `主界面_商店/组件/组件_商店_界面.xml`：一条长滚动，外壳
 * `Store` + 5 个独立分段 prefab，顺序与外壳 list 的 item 一致。
 * 分段高度按段内 list 的实际内容计算，不能直接取设计稿里的占位尺寸。
 */

/** 商城自有图目录（`loadArt(name, STORE_ART_ROOT)` 用；不带 `resources/` 前缀）。 */
export const STORE_ART_ROOT = 'image/store';

/**
 * 商城资源条只显示金币和钻石，具体显示哪些格由 `Store.prefab` 的
 * `ResBar.resKeys` 决定。资源图走 `MainResBarArt` 的默认目录，这里不重复维护。
 */

// 美术资源名。保留 FGUI 原名，避免和导出资源对不上。
/** 地牢货架整屏（源是 `.jpg`，720×1280）。 */
export const STORE_ART_BG = 'sd_fg_01_3gong';
/** 商店木框面板（源图 720×589，靠九宫格撑到 720×1280）。 */
export const STORE_ART_PANEL = 'sd_bg_01';
/** NPC 哥布林商人（720×330 透明底）。 */
export const STORE_ART_NPC = 'shoping_bg04';
/** 5 段共用的标题绶带（665×81，九宫格）。 */
export const STORE_ART_TITLE = 'title_brown';
/** 宝箱卡整张 · 普通（低级）。 */
export const STORE_ART_CHEST_LOW = 'sd_panel_01';
/** 宝箱卡整张 · 高级。 */
export const STORE_ART_CHEST_HIGH = 'sd_panel_02';
/** 关卡礼包卡整张。 */
export const STORE_ART_GIFT_CARD = 'gklb';
/** 折扣/角标标签。 */
export const STORE_ART_TAG = 'kfqd01';
/** 「超值返利」爆标。 */
export const STORE_ART_REBATE = 'newsd3';
/** 左右翻页箭头（右箭头靠 `scale(-1,1)` 镜像）。 */
export const STORE_ART_ARROW = 'btn_jiantou';
/** 页码点 · 亮 / 暗。 */
export const STORE_ART_DOT_ON = 'sd3';
export const STORE_ART_DOT_OFF = 'sd5';
/** 竖卡底 200×276（金币 / 银币 / 黑市宝箱三段 15 张卡共用）。 */
export const STORE_ART_CARD = 'kfqd03';
/** 按钮底 · 金黄（宝箱「高级」行、价格条、购买按钮）。 */
export const STORE_ART_BTN_GOLD = 'TY_btn21';
/** 按钮底 · 青绿（宝箱「低级」行）。 */
export const STORE_ART_BTN_GREEN = 'TY_btn22';
/** 按钮底 · 灰（广告 / 免费 128×74）。 */
export const STORE_ART_BTN_GREY = 'TY_btn10';
/** 「看视频」图标（广告按钮 48×36 / 银币卡 39×28 两个尺寸各一张）。 */
export const STORE_ART_ICON_VIDEO_NEW = 'img_video_new';
export const STORE_ART_ICON_VIDEO = 'img_video';
/** 消耗/价格条底 65×31（`组件_公用_消耗_商店` 的 n7）。 */
export const STORE_ART_PILL = 'zj3';
/** 物品框选中描边。 */
export const STORE_ART_ITEM_FRAME = 'icon_fg_selected';
/** 宝箱卡右上「?」帮助按钮。 */
export const STORE_ART_HELP = 'zx_btn01';

/** 需要九宫格（`cc.Sprite.type = SLICED`）的图名集合。 */
export const STORE_ART_SLICED: ReadonlySet<string> = new Set<string>([
    STORE_ART_PANEL,
    STORE_ART_TITLE,
    STORE_ART_CHEST_LOW,
    STORE_ART_CHEST_HIGH,
    STORE_ART_CARD,
    STORE_ART_BTN_GOLD,
    STORE_ART_BTN_GREY,
    STORE_ART_PILL,
    STORE_ART_ITEM_FRAME,
]);

// 分段版面。key 顺序即外壳 list 的 item 顺序。
export type StoreSectionKey = 'gem' | 'gift' | 'gold' | 'silver' | 'goods';

export interface IStoreSection {
    readonly key: StoreSectionKey;
    /** 段标题（截图逐字）。 */
    readonly title: string;
    /** 分段 prefab（`resources/ui/Store/<prefab>.prefab`）。 */
    readonly prefab: string;
    /** 该段竖排或横排的行数；gem/gift 为 0，表示不走三列网格。 */
    readonly rows: number;
    /** 段内卡片总数。gem 2 张，gift 1 张，其余与对应段的行表一致。 */
    readonly cards: number;
    /** 行距（FGUI `list lineGap`）；`gem`/`gift` 为 0。 */
    readonly lineGap: number;
}

/** FGUI 段内 `list lineGap`：元宝页 20，铜钱/杂货页 10。 */
export const STORE_GRID_LINE_GAP: Readonly<Record<string, number>> = { gold: 20, silver: 10, goods: 10 };

/** 三列网格段的行数（STORE_SECTIONS[].rows 由此派生）。 */
export const STORE_GRID_ROWS: Readonly<Record<string, number>> = { gold: 2, silver: 2, goods: 3 };

/** 分段列表。gem/gift 不走三列网格，行数为 0。 */
export const STORE_SECTIONS: readonly IStoreSection[] = [
    { key: 'gem', title: '宝石宝箱', prefab: 'StoreGemBox', rows: 0, cards: 2, lineGap: 0 },
    { key: 'gift', title: '50关卡礼包', prefab: 'StoreLevelGift', rows: 0, cards: 1, lineGap: 0 },
    { key: 'gold', title: '金币', prefab: 'StoreGold', rows: STORE_GRID_ROWS.gold, cards: 6, lineGap: STORE_GRID_LINE_GAP.gold },
    { key: 'silver', title: '银币', prefab: 'StoreSilver', rows: STORE_GRID_ROWS.silver, cards: 4, lineGap: STORE_GRID_LINE_GAP.silver },
    { key: 'goods', title: '黑市宝箱', prefab: 'StoreGoods', rows: STORE_GRID_ROWS.goods, cards: 7, lineGap: STORE_GRID_LINE_GAP.goods },
];

/** 资源条显示哪些格由 Store.prefab 的 ResBar.resKeys 决定，代码不再保留第二份配置。 */
