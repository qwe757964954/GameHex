/**
 * 礼包美术资源口径。图片位于 `image/gift`，文件名统一 `gf_` 前缀。
 *
 * `gf_panel_bg`、`gf_bottom_bar`、`gf_subtab_on/off` 在原稿中被有意拉伸，
 * Sprite 使用 CUSTOM 尺寸，节点大小由 prefab 固定；不要按原图比例反推。
 */

import { spriteFramePath } from '../ArtPaths';
import { resIconRoot } from '../common/ResTypes';
import { resolveItemIconRef } from '../sevenDay/SevenDayArt';

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

/** 子页签 `artKey` → 标题图 key，与 `GiftTable.giftSubTabOf` 对齐。 */
export const GIFT_SUB_TAB_ART: Readonly<Record<string, string>> = {
    daily: 'tabDaily',
    week: 'tabWeek',
    month: 'tabMonth',
    // `once` 未映射：416 未开启，工程里也没有对应标题图。
};

/**
 * `roleProperty` 资源档 → 图标名。
 *
 * 这些 id 不在 `item` 表中，图位于 `icons/resource/`。内容以 `roleProperty.json`
 * 的 `icon` 列为准，`tests/res-types.test.ts` 会逐条校验。
 */
export const GIFT_RES_ICON_ART: Readonly<Record<number, string>> = {
    6: '图标_灵石',
    7: '图标_铜币',
    8: '图标_洗炼石',
    9: '图标_体力',
    10: '图标_幻灵玉',
};

/** 取一个资源档图标的加载参数；没有对应图时返回 `null`。 */
export function giftResIconRef(resId: number): { readonly root: string; readonly name: string } | null {
    const name = GIFT_RES_ICON_ART[resId];
    if (!name) return null;
    return { root: resIconRoot(name), name };
}

/** `priceType` / `roleProperty.coin` 的货币图标（购买按钮 + 灵玉卡中间那张）。 */
export function giftCurrencyIconRef(): { readonly root: string; readonly name: string } {
    const name = GIFT_RES_ICON_ART[10];
    return { root: resIconRoot(name), name };
}

/** 品质框定义在 `common/QualityFrameArt`。 */
export { QUALITY_FRAME_NAMES, qualityFrameName } from '../common/QualityFrameArt';

/** 取某个礼包美术图的装配路径；`key` 未知时返回 `null`。 */
export function giftArtPath(key: string): string | null {
    const name = GIFT_ART_NAMES[key];
    if (!name) return null;
    return spriteFramePath(GIFT_ART_ROOT, name);
}

/**
 * 道具图标口径与七日狂欢一致，直接复用其 `item.icon` 解析。
 */
export function resolveGiftIconRef(
    item: { readonly icon: string } | undefined,
    resId: number,
): { readonly root: string; readonly name: string } | null {
    const fromItem = item ? resolveItemIconRef(item.icon) : null;
    if (fromItem) return { root: fromItem.root, name: fromItem.name };
    return giftResIconRef(resId);
}
