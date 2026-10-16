/**
 * 「商城」的**版面表 + 美术表** —— 引擎无关（不 import `cc`），单测直接 import。
 *
 * ## 真源
 *
 * FGUI 包 `主界面_商店`：
 * `zarts/art/UIProject/trunk/UIProject/assets/主界面_商店/`。
 * 外壳是 `组件/组件_商店_界面.xml` —— **一条长滚动**（NPC 背景 + 5 段分组卡），**没有页签**。
 * 老端 `TabStoreMain.init()` 用 `list.initVirtualList(renderListItem, getListItemResource)`
 * 驱动，`getListItemResource` 按 `StoreType` 返回 5 个**独立**页面组件的 URL
 * ⇒ 本端同构：外壳 `Store` + 5 个分段 prefab，段就是 `list` 的 5 个 item。
 *
 * ## 段高是**长出来的**，不是设计稿那个数
 *
 * 5 个页面组件 XML 里的 `size` 只有 3 个占位 `<item>` 那么高（元宝页 377 / 铜钱页 369 /
 * 杂货页 378）。但每个页面都带 `<relation target="n58_h2ls" sidePair="bottomext-bottom"/>`
 * —— 组件的**下边界跟着 `list` 的内容走**。所以真实高度 = 标题带高 + 行数 × 276 + 行距 × (行数−1)。
 * {@link STORE_SECTION_H} 用的是**真实高度**，`tmp/_store2_build.mjs` 与 `tests/store.test.ts`
 * 都读它。
 */

/** 商城自有图目录（`loadArt(name, STORE_ART_ROOT)` 用；不带 `resources/` 前缀）。 */
export const STORE_ART_ROOT = 'image/store';

// 货币图标不再单独记目录：`StorePage` 走 `main/MainResBarArt.loadResBarSprite`，
// 它的默认根 = `ArtPaths.RESOURCE_ICON_ART_ROOT`（`icons/resource`，全工程唯一真源）。
// 这里原先那句 `STORE_RESBAR_ART_ROOT = 'image/main/resbar'` 从来没人引用，已删（规则 113）。

// ============================================================
// 一、美术名（保留 FGUI 原名，不做改名）
// ============================================================
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

// ============================================================
// 二、5 段（顺序 = 外壳 `list` 的 item 顺序 = 老端 `StoreType` 数组顺序）
// ============================================================
export type StoreSectionKey = 'gem' | 'gift' | 'gold' | 'silver' | 'goods';

export interface IStoreSection {
    readonly key: StoreSectionKey;
    /** 段标题（截图逐字）。 */
    readonly title: string;
    /** 分段 prefab（`resources/ui/Store/<prefab>.prefab`）。 */
    readonly prefab: string;
    /** 该段竖/横排卡片的**行数**（`gem`/`gift` 为 0 = 不走 3 列网格）。 */
    readonly rows: number;
    /**
     * 行数 × 卡片数（= 段内卡片总数）。
     * `gem` 2（普通/高级各一）、`gift` 1（横向翻页，一次一卡）、其余按 {@link STORE_SHOP_ROWS} 长度。
     */
    readonly cards: number;
    /** 行距（FGUI `list lineGap`）；`gem`/`gift` 为 0。 */
    readonly lineGap: number;
}

/** FGUI 段内 `list lineGap`：元宝页 20，铜钱/杂货页 10。 */
export const STORE_GRID_LINE_GAP: Readonly<Record<string, number>> = { gold: 20, silver: 10, goods: 10 };

/** 竖卡高（三段共用的 `kfqd03` 摆放尺寸）。 */
export const STORE_CARD_H = 276;

/** 三列网格的列心（容器 632 宽、3×200 + 2×15 = 630 居中）。 */
export const STORE_GRID_COL_X: readonly number[] = [-215, 0, 215];

/** 三列网格段的行数（`STORE_SECTIONS[].rows` 由此派生，只有一份真值）。 */
export const STORE_GRID_ROWS: Readonly<Record<string, number>> = { gold: 2, silver: 2, goods: 3 };

/**
 * 各段内层 `list` 的 FGUI **顶边 y**（逐段抄自 5 个页面组件的 `list` 节点）。
 *
 * 之所以要它：段高 = 标题带 + 这段 y + 内容高（见 {@link STORE_SECTION_H}），
 * 而外层 `list` 的 5 个 `<item>` 是**紧贴**排布的 ⇒ 中间那个「标题带到 list 之间」的
 * 空隙也必须算进段高，否则 5 段会互相重叠。
 */
export const STORE_SECTION_LIST_TOP: Readonly<Record<StoreSectionKey, number>> = {
    gem: 89, gift: 85, gold: 90, silver: 79, goods: 88,
};

/** 段列表：顺序即滚动顺序。 */
export const STORE_SECTIONS: readonly IStoreSection[] = [
    { key: 'gem', title: '宝石宝箱', prefab: 'StoreGemBox', rows: 0, cards: 2, lineGap: 0 },
    { key: 'gift', title: '50关卡礼包', prefab: 'StoreLevelGift', rows: 0, cards: 1, lineGap: 0 },
    { key: 'gold', title: '金币', prefab: 'StoreGold', rows: STORE_GRID_ROWS.gold, cards: 6, lineGap: STORE_GRID_LINE_GAP.gold },
    { key: 'silver', title: '银币', prefab: 'StoreSilver', rows: STORE_GRID_ROWS.silver, cards: 4, lineGap: STORE_GRID_LINE_GAP.silver },
    { key: 'goods', title: '黑市宝箱', prefab: 'StoreGoods', rows: STORE_GRID_ROWS.goods, cards: 7, lineGap: STORE_GRID_LINE_GAP.goods },
];

/** 段高 = `list` 顶边 y + 真实内容高（`gem`/`gift` 不走三列网格，走设计稿高度）。 */
export const STORE_SECTION_H: Readonly<Record<StoreSectionKey, number>> = {
    gem: 842,   // 设计稿已按 2 张宝箱卡量好（89 + 377 + 376）
    gift: 365,  // 横向翻页，一次一卡，高度固定
    gold: STORE_SECTION_LIST_TOP.gold + (STORE_GRID_ROWS.gold * STORE_CARD_H + (STORE_GRID_ROWS.gold - 1) * STORE_GRID_LINE_GAP.gold),
    silver: STORE_SECTION_LIST_TOP.silver + (STORE_GRID_ROWS.silver * STORE_CARD_H + (STORE_GRID_ROWS.silver - 1) * STORE_GRID_LINE_GAP.silver),
    goods: STORE_SECTION_LIST_TOP.goods + (STORE_GRID_ROWS.goods * STORE_CARD_H + (STORE_GRID_ROWS.goods - 1) * STORE_GRID_LINE_GAP.goods),
};

/** 段与段之间的间距（外层 `list` 的 `lineGap="10"`）。 */
export const STORE_SECTION_GAP = 10;

/** 外壳 `cc.ScrollView` 的 `content` 总高 = Σ 段高 + 4 条 {@link STORE_SECTION_GAP}。 */
export const STORE_CONTENT_H: number =
    STORE_SECTIONS.reduce((sum, s) => sum + STORE_SECTION_H[s.key], 0) + STORE_SECTION_GAP * (STORE_SECTIONS.length - 1);

/** 段键 → 它在 `content` 里的 y（相对 `content` 顶边，向下为负）。 */
export function storeSectionTop(key: StoreSectionKey): number {
    let y = 0;
    for (const s of STORE_SECTIONS) {
        if (s.key === key) return y;
        y -= STORE_SECTION_H[s.key] + STORE_SECTION_GAP;
    }
    return y;
}

// ============================================================
// 三、资源条（截图顶部那两枚药丸）
// ============================================================
/**
 * 商城资源条只显示**两格**（金币 / 钻石）—— 截图逐格对得上。
 *
 * ⚠️ 2026-09-29：「显示哪两格」**已移出本表**，配置落在
 * `Store.prefab` → `ResBar` 组件 → `resKeys = 'gold,gem'`（同一份值只留一处真源，
 * 见 `app/common/ResBar` 的「与 MainResBar 的分工」）。这里原本的 `STORE_RES_KEYS`
 * 已删除 —— **别再加回来**，否则 prefab 与代码各一份、迟早分叉。
 *
 * 判据：`tests/store.test.ts` 的「资源条」用例直接读 prefab 断言 `resKeys`。
 */
