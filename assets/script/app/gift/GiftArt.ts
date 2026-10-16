/**
 * 礼包（`LayerGift`）美术口径。
 *
 * 图都落在 `assets/resources/image/gift/`（19 张，从老端 FGUI 的
 * `礼包/图片` + `公用0/图片` 里挑出来重命名，口径与 `image/sevenDay/` 一致：去中文 + 模块前缀）。
 *
 * ⚠️ 三张图**原图尺寸 ≠ FGUI 显示尺寸**，是原稿有意的拉伸，别按原图比例推常量：
 *   | 图 | 原图 | FGUI 显示 |
 *   |---|---|---|
 *   | `gf_panel_bg` | 597×585 | **597×852**（纵向拉 1.456×） |
 *   | `gf_bottom_bar` | 992×212 | 720×120 |
 *   | `gf_subtab_on/off` | 198×71 | 159×64 |
 * 所以 Sprite 一律 `sizeMode = CUSTOM(0)`，节点尺寸由 prefab 写死（见 `tmp/gen_gift.mjs`）。
 *
 * 礼包组件**没有任何九宫**（XML 里 `scale9grid` 一个都没出现），`trim` 也一律关。
 */

import { FRAME_ART_ROOT, MAIN_ART_ROOT, spriteFramePath } from '../ArtPaths';
import { resIconRoot } from '../common/ResTypes';

/** 礼包美术目录（运行时时相对 `resources` 的路径）。 */
export const GIFT_ART_ROOT = 'image/gift';

/** 礼包要用的全部图（`key` → 文件名，不含扩展名）。 */
export const GIFT_ART_NAMES: Readonly<Record<string, string>> = {
    /** 左下返回按钮 115×119（FGUI 显示 123×123）。 */
    back: 'gf_btn_back',
    /** 主界面底部条 720×120。 */
    bottomBar: 'gf_bottom_bar',
    /** 超值礼包页底板 597×852。 */
    panelBg: 'gf_panel_bg',
    /** 超值礼包页顶部装饰（原图 653×186）。 */
    deco: 'gf_deco',
    /** 商品行底框 503×175。 */
    rowBg: 'gf_row_bg',
    /** 已售罄标。 */
    soldOut: 'gf_soldout',
    /** 折扣角标。 */
    discount: 'gf_discount',
    /** 子页签底（未选）159×64。 */
    subTabOff: 'gf_subtab_off',
    /** 子页签底（选中）159×64。 */
    subTabOn: 'gf_subtab_on',
    /** 子页签标题图：每日礼包。 */
    tabDaily: 'gf_tab_daily',
    /** 子页签标题图：周常礼包。 */
    tabWeek: 'gf_tab_week',
    /** 子页签标题图：月度礼包。 */
    tabMonth: 'gf_tab_month',
    /** 灵玉卡底 230×330。 */
    cardBg: 'gf_card_bg',
    /** 灵玉卡标题条 189×33。 */
    cardStrip: 'gf_card_strip',
    /** 灵玉卡方框 186×186。 */
    cardSquare: 'gf_card_square',
    /** 首充翻倍角标（40×256）。 */
    doubleTag: 'gf_double_tag',
    /** 灵玉购买按钮底 157×48。 */
    btnLingYu: 'gf_btn_lingyu',
    /** 晶石购买按钮底 160×69（晶石页当前关闭，先备着）。 */
    btnJingShi: 'gf_btn_jingshi',
    /** 通用购买按钮底 156×60。 */
    btnBuy: 'gf_btn_buy',
    /** 灵石小图标（购买按钮上的货币图标，40×40）。 */
    iconStone: 'gf_icon_stone',
};

/** 子页签 `artKey` → 标题图 key（与 `GiftTable.giftSubTabOf` 的 `artKey` 对齐）。 */
export const GIFT_SUB_TAB_ART: Readonly<Record<string, string>> = {
    daily: 'tabDaily',
    week: 'tabWeek',
    month: 'tabMonth',
    // ⚠️ `once`（终身礼包）**故意不映射** —— `open.json` 里 `416` 是关的（`roleLevel >= 9999`），
    //    工程里也没有 `gf_tab_once` 这张图。真要开 `416` 得先补图 + 补这里。
};

/**
 * `roleProperty` 资源档 → 图标名（按 `resId` 索引，礼包自己的展示需求）。
 *
 * 这几个 id **不在 `item` 表里**（`item.resId` 查不到），`icon` 存的是 FGUI 裸组件名
 * ⇒ 落 `ArtPaths.RESOURCE_ICON_ART_ROOT`（`icons/resource/<名>`）。命名口径与
 * `MainResBarTypes.RES_BAR_ICON_ART` 一致（`coin` = 幻灵玉，**别再叫元宝**）。
 *
 * ⚠️ 映射内容以 `assets/remoteRef/roleProperty.json` 的 `icon` 列为真源，
 * `tests/res-types.test.ts` 会逐条比对（手抄表漂移 = 用例红）。
 *
 * `8`（洗炼石）**原先缺图**已降级；`icons/resource/图标_洗炼石.png` 现在是有的
 * ⇒ 2026-09-29 补上，不再走「只画品质框」的降级。
 */
export const GIFT_RES_ICON_ART: Readonly<Record<number, string>> = {
    6: '图标_灵石',
    7: '图标_铜币',
    8: '图标_洗炼石',
    9: '图标_体力',
    10: '图标_幻灵玉',
};

/** 取一个资源档的加载参数；没有对应图时返回 `null`（调用方隐藏图标节点）。 */
export function giftResIconRef(resId: number): { readonly root: string; readonly name: string } | null {
    const name = GIFT_RES_ICON_ART[resId];
    if (!name) return null;
    return { root: resIconRoot(name), name };
}

/** 取一个资源档图标的装配路径；没有对应图时返回 `null`。 */
export function giftResIconPath(resId: number): string | null {
    const ref = giftResIconRef(resId);
    return ref ? spriteFramePath(ref.root, ref.name) : null;
}

/** `priceType` / `roleProperty.coin` 的货币图标（购买按钮 + 灵玉卡中间那张）。 */
export function giftCurrencyIconRef(): { readonly root: string; readonly name: string } {
    const name = GIFT_RES_ICON_ART[10];
    return { root: resIconRoot(name), name };
}

/**
 * 底部**大页签**底图（`image/main/tab_bg_01` 未选 / `tab_bg_02` 选中）。
 *
 * 与首充弹窗的档位页签（`FirstRechargeTierTab`）**是同一对图**，口径直接沿用。
 * 原图 122×96，prefab 里按 FGUI 声明的 120×111 拉（首充那边也拉到 148×75，拉伸是既定做法）。
 *
 * ⚠️ FGUI 主界面底部页签用的是 `组件/底菜单/按钮_首页_菜单.xml` —— 那是个靠 `类型` 控制器
 *   在 **27 个 page 之间切一整套主界面图标**的组件。礼包面板只有两个页签，为它引一整套
 *   主界面图标包不划算（`GiftTabButton` 的文件头也写了这条），所以只取底图 + Label 文案。
 */
export const GIFT_TAB_ART = {
    off: 'tab_bg_01',
    on: 'tab_bg_02',
} as const;

/** 底部大页签底图的根目录。 */
export const GIFT_TAB_ART_ROOT = MAIN_ART_ROOT;

/** 品质框（奖励格用，与七日狂欢共用同一套 `image/frame/`）。 */
export const QUALITY_FRAME_LEVELS = 4;

/** 品质档 → 框档（1..4）。与 `SevenDayArt.qualityFrameLevel` 同算法。 */
export function qualityFrameLevel(quality: number): number {
    const raw = Math.floor(quality) - 1;
    return Math.min(QUALITY_FRAME_LEVELS, Math.max(1, raw > 0 ? raw : 1));
}

/** 品质档 → 框资源名（不带扩展名）。 */
export function qualityFrameName(quality: number): string {
    return `common_img_pzk_0${qualityFrameLevel(quality)}`;
}

/** 品质框目录。 */
export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框名（按框档枚举，恰好 4 张）。 */
export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

/** 取某个礼包美术图的装配路径；`key` 未知时返回 `null`。 */
export function giftArtPath(key: string): string | null {
    const name = GIFT_ART_NAMES[key];
    if (!name) return null;
    return spriteFramePath(GIFT_ART_ROOT, name);
}

/**
 * 道具图标口径 —— **与七日狂欢完全一致**（同一套 `item.icon` 路径直通 + `icons/` 前缀判定）。
 * 这里转出去，是为了让礼包模块不直接依赖 sevenDay 目录。
 */
import { resolveItemIconPath, resolveItemIconRef } from '../sevenDay/SevenDayArt';
export { resolveItemIconPath, resolveItemIconRef };
export type { ISevenDayIconRef as IGiftIconRef } from '../sevenDay/SevenDayArt';

/**
 * 取一个奖励 `resId` 的图标加载参数 —— **两级兜底**，顺序不能反：
 *   ① `item` 表查得到 ⇒ 用 `item.icon`（绝大多数据道具）；
 *   ② 查不到（`7/8/9/10` 这类 `roleProperty` 货币档）⇒ 走 `image/main/resbar`。
 *
 * `item` 表里 `icon` 解析不出（老格式裸组件名）时**也会**继续往下兜底 ——
 * 因为 `resId` 有可能同时也是资源档 id。
 */
export function resolveGiftIconRef(
    item: { readonly icon: string } | undefined,
    resId: number,
): { readonly root: string; readonly name: string } | null {
    const fromItem = item ? resolveItemIconRef(item.icon) : null;
    if (fromItem) return { root: fromItem.root, name: fromItem.name };
    return giftResIconRef(resId);
}
