/**
 * 商城 5 段的静态内容表，引擎无关，构建器与单测共用。
 *
 * 数据来自 remoteRef 的配置表：gemShop / guankaGift / payChannel / goldShop / resourceShop。
 * 图标路径是相对 assets/resources 的图片路径，不带扩展名和 /spriteFrame。
 * 真协议到位后只需把这张表换成运行时读表，prefab 和节点名都不用动。
 */

// 宝箱段
export type StoreChestQuality = 'low' | 'high';

/** 宝箱两档用不同的钥匙：普通宝箱 10991 银钥匙，传世宝箱 10992 金钥匙。 */
export interface IStoreChestRow {
    readonly quality: StoreChestQuality;
    /** 卡片底图。 */
    readonly art: string;
    /** 按钮底图。 */
    readonly buttonArt: string;
    /** 按钮文字色。 */
    readonly buttonColor: readonly [number, number, number];
    /** 保底文案。 */
    readonly title: string;
    /** 「拥有」数量的构建期占位；运行期由 StoreSectionPage 按真实背包覆盖。 */
    readonly own: string;
    /** 抽 1 次 / 10 次的钥匙消耗量；钥匙不足时运行期会换成备选货币。 */
    readonly cost1: string;
    readonly cost10: string;
    /** 本档钥匙的 resId。 */
    readonly keyResId: number;
    /** 本档钥匙图标。 */
    readonly keyIcon: string;
    /** 本档钥匙名。 */
    readonly keyName: string;
}

/**
 * 宝箱两档。keyResId / keyIcon / keyName 必须写成字面量：
 * 构建器用 new Function 求值本数组，引用外部常量会直接报 ReferenceError。
 */
export const STORE_CHEST_ROWS: readonly IStoreChestRow[] = [
    {
        quality: 'low', art: 'sd_panel_01', buttonArt: 'TY_btn22', buttonColor: [0x86, 0xca, 0xf8],
        title: '剩余9次必得 蓝色宝石', own: '0', cost1: '1', cost10: '10',
        keyResId: 10991, keyIcon: 'icons/item/图标_银钥匙', keyName: '银钥匙',
    },
    {
        quality: 'high', art: 'sd_panel_02', buttonArt: 'TY_btn21', buttonColor: [0xff, 0x9a, 0x22],
        title: '剩余9次必得 紫色宝石', own: '0', cost1: '1', cost10: '10',
        keyResId: 10992, keyIcon: 'icons/item/图标_金钥匙', keyName: '金钥匙',
    },
];

// 关卡礼包段
/** 奖励槽。 */
export interface IStoreGiftReward {
    /** 图标路径（相对 assets/resources）。 */
    readonly iconPath: string;
    /** 物品框品质（1–4）。 */
    readonly quality: number;
}

export interface IStoreGiftRow {
    /** 礼包 id；发请求用它，不是关卡号。 */
    readonly id: number;
    /** 关卡数，用于标题。 */
    readonly level: number;
    readonly title: string;
    /** 返利百分比文案。 */
    readonly rebate: string;
    /** 限购文案。 */
    readonly buyCount: string;
    /** 购买按钮金额。 */
    readonly price: string;
    /** 金额左侧的货币图标。 */
    readonly priceIcon: string;
    /** 页码指示器。 */
    readonly pages: number;
    readonly page: number;
    /** 卡上 3 个奖励槽。 */
    readonly rewards: readonly IStoreGiftReward[];
}

/** 当前只上架 50 关卡礼包（guankaGift id 18）。 */
export const STORE_GIFT_ROW: IStoreGiftRow = {
    id: 18, level: 50, title: '50关卡礼包', rebate: '550%', buyCount: '限购:1/1', price: '1280',
    priceIcon: 'icons/resource/图标_幻灵玉',
    pages: 5, page: 0,
    rewards: [
        { iconPath: 'icons/item/图标_金钥匙', quality: 5 },
        { iconPath: 'icons/item/图标_图纸_问号', quality: 3 },
        { iconPath: 'icons/resource/图标_铜币', quality: 4 },
    ],
};

// 金币段：元宝铺
/** 元宝铺卖人民币直购元宝，数据取 payChannel type=1 的前 6 档。 */
export interface IStoreGoldRow {
    /** payChannel.id。 */
    readonly id: number;
    readonly name: string;
    /** 元宝数量。 */
    readonly coin: number;
    /** 人民币金额。 */
    readonly rmb: number;
    /** 卡面主图标。 */
    readonly iconPath: string;
    /** 「首充额外送」药丸右端的小图标。 */
    readonly extraIcon: string;
}

/** 钥匙不足时退到的备选货币图标；与元宝铺首充额外送用的是同一张。 */
export const STORE_COIN_ICON = 'icons/resource/图标_幻灵玉';

/**
 * 元宝铺 6 档。iconPath 写成字面量，构建器用 new Function 求值，拼串函数会报错。
 */
export const STORE_GOLD_ROWS: readonly IStoreGoldRow[] = [
    { id: 1, name: '少量元宝', coin: 60, rmb: 6, iconPath: 'icons/common/图标_幻灵丹_01', extraIcon: STORE_COIN_ICON },
    { id: 2, name: '一堆元宝', coin: 300, rmb: 30, iconPath: 'icons/common/图标_幻灵丹_02', extraIcon: STORE_COIN_ICON },
    { id: 3, name: '很多元宝', coin: 680, rmb: 68, iconPath: 'icons/common/图标_幻灵丹_03', extraIcon: STORE_COIN_ICON },
    { id: 4, name: '一袋元宝', coin: 1280, rmb: 128, iconPath: 'icons/common/图标_幻灵丹_04', extraIcon: STORE_COIN_ICON },
    { id: 5, name: '一箱元宝', coin: 3280, rmb: 328, iconPath: 'icons/common/图标_幻灵丹_05', extraIcon: STORE_COIN_ICON },
    { id: 6, name: '海量元宝', coin: 6480, rmb: 648, iconPath: 'icons/common/图标_幻灵丹_06', extraIcon: STORE_COIN_ICON },
];

// 银币段：铜钱铺
/** 银币卡的价格有三种形态：免费、0、正常钻石价。 */
export interface IStoreSilverRow {
    /** goldShop.id。 */
    readonly id: number;
    readonly name: string;
    readonly price: string;
    /** 折扣角标；null 表示不显示。 */
    readonly sale: string | null;
    /** 是否显示看视频图标。 */
    readonly video: boolean;
    /** 卡面主图标。 */
    readonly iconPath: string;
}

export const STORE_SILVER_ROWS: readonly IStoreSilverRow[] = [
    { id: 1, name: '银币x520', price: '免费', sale: null, video: true, iconPath: 'icons/resource/图标_货币_几个铜钱' },
    { id: 2, name: '银币x300', price: '0', sale: null, video: false, iconPath: 'icons/resource/图标_货币_几个铜钱' },
    { id: 3, name: '银币x1000', price: '90', sale: '9折', video: false, iconPath: 'icons/resource/图标_货币_少量铜钱' },
    { id: 4, name: '银币x5000', price: '400', sale: '8折', video: false, iconPath: 'icons/resource/图标_货币_大量铜钱' },
];

// 黑市宝箱段：杂货铺
/** 杂货铺 7 条，图标和品质按 rewards[0].resId 查 item 表。 */
export interface IStoreGoodsRow {
    /** resourceShop.id。 */
    readonly id: number;
    readonly name: string;
    /** 价格文案。 */
    readonly price: string;
    /** 限购上限。 */
    readonly limit: number;
    /** 已买次数；静态视图取 0。 */
    readonly bought: number;
    /** 奖励物品图标。 */
    readonly iconPath: string;
    /** 物品品质。 */
    readonly quality: number;
    /** 单次获得件数。 */
    readonly number: number;
}

export const STORE_GOODS_ROWS: readonly IStoreGoodsRow[] = [
    { id: 1, name: '随机装备图纸', price: '100', limit: 10, bought: 0, iconPath: 'icons/item/图标_图纸_问号', quality: 3, number: 10 },
    { id: 2, name: '随机兵种卷轴', price: '100', limit: 10, bought: 0, iconPath: 'icons/item/图标_兵书随机', quality: 3, number: 100 },
    { id: 3, name: '天赋石', price: '10', limit: 2, bought: 0, iconPath: 'icons/common/图标_突破丹', quality: 3, number: 10 },
    { id: 4, name: '城墙升级石', price: '100', limit: 10, bought: 0, iconPath: 'icons/item/图标_城池升级材料', quality: 3, number: 10 },
    { id: 5, name: '城墙突破石', price: '30', limit: 10, bought: 0, iconPath: 'icons/item/图标_城池突破材料', quality: 4, number: 1 },
    { id: 6, name: '啤酒', price: '30', limit: 10, bought: 0, iconPath: 'icons/common/图标_请神酒', quality: 4, number: 1 },
    { id: 7, name: '禁军升级卷轴', price: '10', limit: 10, bought: 0, iconPath: 'icons/item/图标_禁军技能升级材料', quality: 3, number: 1 },
];

/**
 * 品质对应的物品框底图。四张图在 image/ 下，路径直接写全，不能再补 icons/ 前缀。
 * 构建器同样读这份字面量，不能用模板串拼。
 */
export const STORE_QUALITY_FRAMES: Readonly<Record<number, string>> = {
    1: 'image/frame/common_img_pzk_01',
    2: 'image/frame/common_img_pzk_02',
    3: 'image/frame/common_img_pzk_03',
    4: 'image/frame/common_img_pzk_04',
};

/** 品质映射到物品框路径，越界时夹到 1–4。 */
export function storeQualityFrame(quality: number): string {
    const q = Math.min(Math.max(Math.round(quality) || 1, 1), 4);
    return STORE_QUALITY_FRAMES[q] ?? STORE_QUALITY_FRAMES[1];
}

/** 段内卡片总数，探针和单测用。 */
export function storeCardCount(key: string): number {
    if (key === 'gem') return STORE_CHEST_ROWS.length;
    if (key === 'gift') return 1;
    if (key === 'gold') return STORE_GOLD_ROWS.length;
    if (key === 'silver') return STORE_SILVER_ROWS.length;
    if (key === 'goods') return STORE_GOODS_ROWS.length;
    return 0;
}
