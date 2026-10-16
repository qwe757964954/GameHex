/**
 * 「商城」5 段分组的**静态内容表** —— 引擎无关（不 import `cc`），单测直接 import。
 *
 * ## 数据从哪来（**每一行都有出处，不拍脑袋**）
 *
 * 全部对齐 `assets/remoteRef/` 的**真配置表**（本工程已有，与老端同一份）：
 *
 * | 段 | 真源表 | 取行 |
 * |---|---|---|
 * | 宝箱（宝石宝箱） | `gemShop.json` / 设计稿 | 2 卡（普通 / 高级）—— FGUI `品质` 控制器只有 2 页 |
 * | 关卡礼包 | `guankaGift.json` | **id=18**（`level=50 / cost=1280 / discount=550 / limit=1`） |
 * | 金币（元宝铺） | `payChannel.json` | `type=1 && isShow=1` 的前 6 条（id 1–6） |
 * | 银币（铜钱铺） | `goldShop.json` | 全部 4 条 |
 * | 黑市宝箱（杂货铺） | `resourceShop.json` + `item.json` | 全部 7 条 |
 *
 * 图标路径一律是 **相对 `assets/resources/` 的图片路径**（不带扩展名、不带 `/spriteFrame`），
 * 直接喂 `CardLineupIcons.loadIconByArtPath()`：
 *
 * - `item` 表 / `payChannel.path` / `goldShop.icon` 给的 key → 见下面每行的注释；
 * - 货币类（`roleProperty.json` 的 `icon`）→ `icons/resource/`；
 * - 道具 / 钥匙类 → `icons/item/`；
 * - `图标_幻灵丹_0N`（`payChannel.path`）实际落在 `icons/common/`。
 *
 * ## 与「运行期」的分工
 *
 * 本表是**唯一真源**：`tmp/_store2_build.mjs`（构建期写 prefab 的初始图）与
 * `StoreSectionPage`（运行期刷新）**都读它** ⇒ 不会出现「构建器填 A、运行期刷成 B」。
 * 真协议（`CmdShop` 系列）到位后，把这里换成「从 `RefUtil` 读表 + 从 `VOBag` 读状态」
 * 即可，**prefab 与节点名约定都不用动**。
 *
 * ## 关卡礼包为什么是「一次一卡」
 *
 * 老端 `TabStoreMain.renderGuanKaPage` 用 `list.scrollPane.setPercX(index/(n-1))` +
 * 左右箭头翻页，一次只显示一卡；本端同构（`List/Card` 单卡 + `ArrowLeft/ArrowRight`）。
 * `pages:5 / page:0` 就是那排 5 个页码点。
 */

// ============================================================
// 一、宝箱段（`组件_商店_宝箱页面item`）
// ============================================================
export type StoreChestQuality = 'low' | 'high';

/**
 * 宝箱卡的钥匙**逐档不同**，不要再用「一张通用钥匙图」的口径：
 * - 1 档（普通宝箱）消耗 **`10991 银钥匙`**（`gemBox[0].priceType`）；
 * - 2 档（传世宝箱）消耗 **`10992 金钥匙`**（`gemBox[1].priceType`）。
 *
 * 真源是 `item.json`：`10991 → {name:"银钥匙", icon:"icons/item/图标_银钥匙"}`、
 * `10992 → {name:"金钥匙", icon:"icons/item/图标_金钥匙"}`（两行 `desc` 分别写着
 * 「可进行一次普通宝箱抽卡」/「可进行一次传世宝箱抽卡」—— 与 `gemBox` 的档位一一对应）。
 *
 * 逐档图标见 {@link IStoreChestRow.keyIcon}。
 */
export interface IStoreChestRow {
    readonly quality: StoreChestQuality;
    /** 卡片底图（低级 = 蓝 `sd_panel_01`，高级 = 金 `sd_panel_02`）。 */
    readonly art: string;
    /** 按钮底图（低级 = 青绿 `TY_btn22`，高级 = 金黄 `TY_btn21`）。 */
    readonly buttonArt: string;
    /** 按钮文字色（`#86caf8` / `#ff9a22`，取自 FGUI `按钮绿` / `按钮黄`）。 */
    readonly buttonColor: readonly [number, number, number];
    /** 保底文案的**纯文本**形态（富文本着色属后续分期）。 */
    readonly title: string;
    /**
     * 「拥有」数量的**构建期占位**。
     *
     * ⚠️ 真值只能运行期读背包（`CmdItem` 缓存）—— 构建器看不到玩家存档。
     *    所以这里恒为 `'0'`，由 `StoreSectionPage.refreshGem()` 按
     *    {@link IStoreChestRow.keyResId} 读**真实的钥匙持有量**覆盖；**没有钥匙时整块隐藏**
     *    （对齐老端 `RenderBox` 里 `ownItem.visible = ownNum > 0`）。
     */
    readonly own: string;
    /**
     * 抽 1 次 / 抽 10 次的**钥匙**消耗量（`gemBox.cost` / `cost × 10`）。
     *
     * ⚠️ 这只是**钥匙充足时**的数字。钥匙不够时老端会退到备选货币（金币，`cost3` / `cost2`）
     *    ⇒ 运行期的消耗条由 `resolveDrawCost` 现算后覆盖（见 `StoreSectionPage.refreshGem`）。
     */
    readonly cost1: string;
    readonly cost10: string;
    /** 本档消耗的钥匙 `resId`（= `gemBox.priceType`；1 档 10991 银 / 2 档 10992 金）。 */
    readonly keyResId: number;
    /** 本档钥匙的图标路径（`item.json.icon`，已是 `icons/**` 相对路径）。 */
    readonly keyIcon: string;
    /** 本档钥匙名（`item.json.name`，用于提示文案）。 */
    readonly keyName: string;
}

/**
 * 宝箱两档。
 *
 * ⚠️ `keyResId` / `keyIcon` / `keyName` 一律写成**字面量**，不要引 `STORE_KEY_*` 常量：
 *    `tmp/_store2_build.mjs` 用 `new Function(...Object.keys(SHOP_SCOPE))` 求值本数组的
 *    **字面量 RHS**，而 `SHOP_SCOPE` 只收「值本身是对象 / 数组字面量」的导出 ⇒
 *    引一个 `number` 常量会当场 `ReferenceError`（与 `iconPath` 不能拼串是同一条约束）。
 */
export const STORE_CHEST_ROWS: readonly IStoreChestRow[] = [
    {
        quality: 'low', art: 'sd_panel_01', buttonArt: 'TY_btn22', buttonColor: [0x86, 0xca, 0xf8],
        title: '剩余9次必得 蓝色宝石', own: '0', cost1: '1', cost10: '10',
        // `gemBox[0].priceType = 10991` ⇒ `item.json` 的「银钥匙」（普通宝箱）。
        keyResId: 10991, keyIcon: 'icons/item/图标_银钥匙', keyName: '银钥匙',
    },
    {
        quality: 'high', art: 'sd_panel_02', buttonArt: 'TY_btn21', buttonColor: [0xff, 0x9a, 0x22],
        title: '剩余9次必得 紫色宝石', own: '0', cost1: '1', cost10: '10',
        // `gemBox[1].priceType = 10992` ⇒ `item.json` 的「金钥匙」（传世宝箱）。
        keyResId: 10992, keyIcon: 'icons/item/图标_金钥匙', keyName: '金钥匙',
    },
];

// ============================================================
// 二、关卡礼包段（`组件_商店_关卡礼包页面item`）
// ============================================================
/** 奖励槽（85×85 = `物品框` 80×80 @(5,5) + `icon_fg_selected` 85×85 选中层）。 */
export interface IStoreGiftReward {
    /** 图标路径（相对 `assets/resources/`）。 */
    readonly iconPath: string;
    /** 物品框品质（`frame/common_img_pzk_0N`，1–4）。 */
    readonly quality: number;
}

export interface IStoreGiftRow {
    /**
     * `guankaGift.id`。
     *
     * ⚠️ **发请求用的是这个 id，不是 `level`** —— 老端 `ModelStore.requestBuyGuanKaGift(ref.id)`
     * 传的是 `guankaGift.id`（本档 = 18），而 `level`（= 50）只用于「要通关到第几关」的判定与标题。
     * 两者在 `guankaGift.json` 里**不是一回事**（28 行里 `id` 与 `level` 一一错开）。
     */
    readonly id: number;
    /** 关卡数（标题 = `${level}关卡礼包`）。 */
    readonly level: number;
    readonly title: string;
    /** 返利百分比文案（`guankaGift.discount` 直接带 `%`）。 */
    readonly rebate: string;
    /** 限购文案（`limit` − `buyCount`）。 */
    readonly buyCount: string;
    /** 购买按钮金额（`guankaGift.cost`）。 */
    readonly price: string;
    /** 金额左侧的货币图标（`priceType=10` → `roleProperty[10].icon = 图标_幻灵玉`）。 */
    readonly priceIcon: string;
    /** 页码指示器（点数 / 当前页 0 基）。 */
    readonly pages: number;
    readonly page: number;
    /** 卡上 3 个奖励槽（`guankaGift.rewards` 逐条 → `item.json` / `roleProperty.json` 的图标）。 */
    readonly rewards: readonly IStoreGiftReward[];
}

/**
 * 关卡礼包当前页 = `guankaGift.json` **id 18**（`level=50 / cost=1280 / discount=550 / limit=1`）。
 *
 * 三个奖励逐条对应 `rewards`：
 * `{10,10992}` 金钥匙 → `icons/item/图标_金钥匙`（品质 5）；
 * `{200,10011}` 随机装备图纸 → `icons/item/图标_图纸_问号`（品质 3）；
 * `{25000,7}` 银币 → `roleProperty[7].icon = 图标_铜币` → `icons/resource/图标_铜币`（品质 4）。
 */
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

// ============================================================
// 三、金币段 = 元宝铺（`组件_商店_元宝页面item`）
// ============================================================
/**
 * ⚠️ 这里的「金币」是 **元宝铺**（`StoreType.Gift` → `组件_商店_元宝页面`），卖的是**人民币直购元宝**：
 * 卡上是「元宝图标 + 首充额外送 xN + 需付 N 元」。
 * 真源 `payChannel.json` 的 `type=1`（直购元宝）前 6 档。
 */
export interface IStoreGoldRow {
    /** `payChannel.id`。 */
    readonly id: number;
    /** 商品名（`payChannel.name`，首充过后显示在卡上）。 */
    readonly name: string;
    /** 元宝数量（`payChannel.coin`）。 */
    readonly coin: number;
    /** 人民币金额（`payChannel.rmb`）。 */
    readonly rmb: number;
    /** 卡面主图标（`payChannel.path`，如 `图标_幻灵丹_01` → `icons/common/图标_幻灵丹_01`）。 */
    readonly iconPath: string;
    /** 「首充额外送」药丸右端的小图标（老端 `exIcon`：`type=1` 时取 `roleProperty[10]` = 金币）。 */
    readonly extraIcon: string;
}

/** `roleProperty[10]` = `coin 金币`，`icon = 图标_幻灵玉` ⇒ 迁到 `icons/resource/`。 */
const COIN_ICON = 'icons/resource/图标_幻灵玉';

/**
 * 金币图标（对外导出）。
 *
 * 用途：宝箱的**备选价**（钥匙不够时退到金币，`gemBox.priceType3 = 10`）在消耗条上要换成它 ——
 * 与元宝铺「首充额外送」用的是同一张图（`roleProperty[10].icon`）。
 */
export const STORE_COIN_ICON = COIN_ICON;

/**
 * 元宝铺 6 档 —— 逐条抄自 `payChannel.json`（`type=1` 直购元宝，`isShow=1`）。
 *
 * ⚠️ `iconPath` 一律写成**字面量字符串**，不要用 `图标_幻灵丹_0${n}` 这类拼串辅助函数：
 * `tmp/_store2_build.mjs` 靠 `new Function` 求值本文件的**字面量 RHS**，
 * 遇到函数调用会 `ReferenceError`（构建器宁可直接炸，也不静默算错）。
 * FGUI 的 `payChannel.path` 是裸 key（`图标_幻灵丹_01`），实物在 `icons/common/`。
 */
export const STORE_GOLD_ROWS: readonly IStoreGoldRow[] = [
    { id: 1, name: '少量元宝', coin: 60, rmb: 6, iconPath: 'icons/common/图标_幻灵丹_01', extraIcon: COIN_ICON },
    { id: 2, name: '一堆元宝', coin: 300, rmb: 30, iconPath: 'icons/common/图标_幻灵丹_02', extraIcon: COIN_ICON },
    { id: 3, name: '很多元宝', coin: 680, rmb: 68, iconPath: 'icons/common/图标_幻灵丹_03', extraIcon: COIN_ICON },
    { id: 4, name: '一袋元宝', coin: 1280, rmb: 128, iconPath: 'icons/common/图标_幻灵丹_04', extraIcon: COIN_ICON },
    { id: 5, name: '一箱元宝', coin: 3280, rmb: 328, iconPath: 'icons/common/图标_幻灵丹_05', extraIcon: COIN_ICON },
    { id: 6, name: '海量元宝', coin: 6480, rmb: 648, iconPath: 'icons/common/图标_幻灵丹_06', extraIcon: COIN_ICON },
];

// ============================================================
// 四、银币段 = 铜钱铺（`组件_商店_铜钱页面item`）
// ============================================================
/**
 * ⚠️ 这里的「银币」对应 `StoreType.gold` → `组件_商店_铜钱页面`，真源 `goldShop.json`。
 *
 * `price` 的三种形态（与老端 `RendCoinItem` 的状态机一致）：
 * - `免费`：`buyTimes < freeTimes` 或落进广告档（`adTimes > 0`）⇒ 卡上带「看视频」图标；
 * - `0`：`cost = 0`；
 * - 数字：正常钻石价（`discount > 0` 时带折扣角标）。
 */
export interface IStoreSilverRow {
    /** `goldShop.id`。 */
    readonly id: number;
    readonly name: string;
    readonly price: string;
    /** 折扣角标（`null` = 不显示）。 */
    readonly sale: string | null;
    /** 是否显示「看视频」小图标。 */
    readonly video: boolean;
    /** 卡面主图标（`goldShop.icon`，如 `图标_货币_几个铜钱` → `icons/resource/图标_货币_几个铜钱`）。 */
    readonly iconPath: string;
}

export const STORE_SILVER_ROWS: readonly IStoreSilverRow[] = [
    { id: 1, name: '银币x520', price: '免费', sale: null, video: true, iconPath: 'icons/resource/图标_货币_几个铜钱' },
    { id: 2, name: '银币x300', price: '0', sale: null, video: false, iconPath: 'icons/resource/图标_货币_几个铜钱' },
    { id: 3, name: '银币x1000', price: '90', sale: '9折', video: false, iconPath: 'icons/resource/图标_货币_少量铜钱' },
    { id: 4, name: '银币x5000', price: '400', sale: '8折', video: false, iconPath: 'icons/resource/图标_货币_大量铜钱' },
];

// ============================================================
// 五、黑市宝箱段 = 杂货铺（`组件_商店_杂货item`）
// ============================================================
/**
 * 真源 `resourceShop.json` 7 条；`iconPath / quality / number` 来自 `item.json`
 * 对 `rewards[0].resId` 的查表。
 *
 * ⚠️ `price` 以**配置表的 `cost`** 为准（100/100/10/100/30/30/10），
 * 不是早期按截图目测的 10/100/10/10/30/30/10 —— 配置表是机器可读的真源。
 */
export interface IStoreGoodsRow {
    /** `resourceShop.id`。 */
    readonly id: number;
    readonly name: string;
    /** 价格文案（`resourceShop.cost`）。 */
    readonly price: string;
    /** 限购上限（`resourceShop.limit`）。 */
    readonly limit: number;
    /** 已买次数（静态视图取 0 ⇒ 卡上显示 `限购{limit-limit}…` 的满额形态）。 */
    readonly bought: number;
    /** 奖励物品图标（`item.json` 的 `icon`，**已是** `icons/**` 完整相对路径）。 */
    readonly iconPath: string;
    /** 物品品质（`item.json.quality`，1–5；物品框按它取 `common_img_pzk_0N`）。 */
    readonly quality: number;
    /** 单次获得的件数（`rewards[0].number`，显示在图标右下角）。 */
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
 * 物品框底：品质 → 图路径。
 *
 * 项目既有约定（`RoleArt.RL_ART_NAMES` 的 `quality1..quality4`，注释写明「100×100 物品框专用」）。
 * ⚠️ 那 4 张在 `image/` 下（`roleArtRelPath` 会补 `image/` 前缀），
 *    而 `icons/**` 与 `image/` **平级**、**不能**再补前缀 —— 两套口径别混。
 *
 * ⚠️ 写成**字面量 Record**（不是 `return \`..._0${q}\``）：构建器 `tmp/_store2_build.mjs`
 *    用 `new Function` 求值本文件的字面量，模板串会在那边 `ReferenceError`。
 *    构建器读的就是这张表 ⇒ 只有一份真值。
 */
export const STORE_QUALITY_FRAMES: Readonly<Record<number, string>> = {
    1: 'image/frame/common_img_pzk_01',
    2: 'image/frame/common_img_pzk_02',
    3: 'image/frame/common_img_pzk_03',
    4: 'image/frame/common_img_pzk_04',
};

/** 品质（1–5，`item.json.quality`）→ 物品框底图路径（越界夹到 1–4）。 */
export function storeQualityFrame(quality: number): string {
    const q = Math.min(Math.max(Math.round(quality) || 1, 1), 4);
    return STORE_QUALITY_FRAMES[q] ?? STORE_QUALITY_FRAMES[1];
}

// ============================================================
// 六、行数查询（探针 / 单测的**唯一真源**）
// ============================================================
export function storeCardCount(key: string): number {
    if (key === 'gem') return STORE_CHEST_ROWS.length;
    if (key === 'gift') return 1;
    if (key === 'gold') return STORE_GOLD_ROWS.length;
    if (key === 'silver') return STORE_SILVER_ROWS.length;
    if (key === 'goods') return STORE_GOODS_ROWS.length;
    return 0;
}
