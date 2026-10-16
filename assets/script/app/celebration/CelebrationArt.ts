/**
 * 开服庆典（老端 FGUI `开服冲榜` 包 + `LayerOSRankUI` 三页签）美术的**唯一入口**。
 *
 * 约定（对齐 `RoleArt.ts` / `HangArt.ts` / `GiftArt.ts`）：
 *  - value 是**相对 `assets/resources/image/` 的路径（不带扩展名）**；
 *  - 取图走 `osArtPath(key)`（= `OS_ART_NAMES` + **`image/` 前缀** + `/spriteFrame`）；
 *    🔴 只过 `ArtPaths.spriteFramePathOf()` 不拼 `image/` 前缀会报
 *    `Bundle resources doesn't contain celebration/…`（2026-09-28「详细排名」实测）；
 *  - `OS_ART_SLICED` 必须与 `.png.meta` 的 border 一一对应（`tmp/gen_osrank.mjs` 会双向对账）。
 *
 * 前缀：`os_` = 开服冲榜包自有（`image/celebration/`），`cu_` = 前几轮已迁的共用图（`image/common/`）。
 * 九宫来源：自有图由 `tmp/_celebration_set_border.mjs` 从老端 `.bin` 的 `scale9Grid` 反查写入，
 * 共用图在各自迁入的那一轮已写好 —— **一个都不手抄**。
 */
import { FRAME_ART_ROOT, spriteFramePath, spriteFramePathOf } from '../ArtPaths';
import type { ICelebrationGoodsInfo } from './CelebrationTable';

// ⚠️ 必须**单独 import 一次**进本地作用域：文件下方那句
//    `export { resolveRewardIconRef as osResolveRewardIconRef } from '…'` 是**重导出**，
//    它只把名字挂到本模块的导出面上、**不创建本地绑定** ——
//    少了这一行，同文件里的 `celebrationNeededArtPaths` 用 `osResolveRewardIconRef` 会
//    `TS2304: Cannot find name`（编译期就断，不是运行期才炸）。
import { resolveRewardIconRef as osResolveRewardIconRef } from '../activity/LayerActivityArt';

export const OS_ART_NAMES = {
    // ---------- 开服冲榜包自有（image/celebration）----------
    /** 整屏底图 720×1668（老端 `qd_tongyong.jpg`，比屏幕高，故意溢出下边） */
    bg: 'celebration/os_qd_tongyong',
    /** 标题横幅底 `titlebg` 747×63，九宫 228,18,247,19 */
    titleBg: 'celebration/os_titlebg',
    /** 倒计时条底 `bb_pic30` 143×32，九宫 35,0,28,0（标题下方那根彩条） */
    tagBg: 'celebration/os_bb_pic30',
    /** 标题左侧小图标 `kfqd02` 42×57 */
    icoTitle: 'celebration/os_kfqd02',
    /** 左上装饰旗帜 `kfqd04` 501×136 */
    banner: 'celebration/os_kfqd04',
    /** 帮助按钮底 `zx_btn01` 61×62（实为 `按钮_公共_通用自动大小` 的 icon） */
    helpPlate: 'celebration/os_zx_btn01',
    /** 排名页表头底 `kfqd06` 193×74，九宫 74,27,53,24（「排名 / 基础奖励 / 战力要求」三格底） */
    rankHeaderBg: 'celebration/os_kfqd06',
    /** 庆典目标项左上标签底 `kfqd07` 276×49，九宫 82,19,96,13 */
    targetTagBg: 'celebration/os_kfqd07',
    /** 「已领取」印章 `公用_图标_已领取` 119×74 */
    claimedMark: 'celebration/os_icon_claimed',
    /** 排名项里的竖分隔线 `kfqd05` 7×63 */
    divider: 'celebration/os_kfqd05',
    /** 限时特惠商品卡底 `kfqd03` 206×303，九宫 15,12,17,15 */
    shopCardBg: 'celebration/os_kfqd03',
    /** 原价删除线 `qd_7` 85×15 */
    strikeLine: 'celebration/os_qd_7',
    /** 折扣角标底 `kfqd01` 67×55（右上「5折」） */
    saleMark: 'celebration/os_kfqd01',
    /** 头像底 `img_Touxiang_01` 73×73（`组件_公用_头像框` 的 `n0`） */
    avatarBg: 'celebration/os_img_touxiang01',
    // 底栏三页签图标（FGUI `按钮_民兵页签` 的 `icon` / `selectIcon` × 控制器 `类型` 0/1/4）
    // ⚠️ url 映射出处：`开服冲榜/package.xml` 的 `apue1xfrh76|74|7a`（未选中）/ `75|73|7k`（选中），
    //    对应文件名 zd_icon_qingdianMB / PM / TH（MB=目标、PM=排名、TH=特惠）。
    /** 庆典目标 未选中 100×100 */
    tabIconTarget: 'celebration/os_zd_icon_qingdianMB',
    /** 庆典目标 选中 80×80 */
    tabIconTargetOn: 'celebration/os_zd_icon_qingdianMB_1',
    /** 庆典排名 未选中 100×100 */
    tabIconRank: 'celebration/os_zd_icon_qingdianPM',
    /** 庆典排名 选中 80×80 */
    tabIconRankOn: 'celebration/os_zd_icon_qingdianPM_1',
    /** 限时特惠 未选中 100×100 */
    tabIconShop: 'celebration/os_zd_icon_qingdianTH',
    /** 限时特惠 选中 80×80 */
    tabIconShopOn: 'celebration/os_zd_icon_qingdianTH_1',
    /** 主界面入口按钮图标 90×100（open.json `icon` = 战斗选关_按钮_开服冲榜） */
    entryIcon: 'activityIcon/战斗选关_按钮_开服冲榜',

    // ---------- 共用图（image/common，前几轮已迁；这里只指路，不重复拷）----------
    /** 通用大底板 `tybg` 620×656，九宫 155,164,155,164 */
    panelBg: 'common/cu_tybg',
    /** 底栏底板 `diban_BG` 992×212，九宫 347,69,607,136 */
    diaBan: 'common/cu_diban_bg',
    /** 返回按钮底 `btn_FanHui` 115×119 */
    btnBack: 'common/cu_btn_fan_hui',
    /** 底栏页签 未选中态底板 `TY_btn13` 168×132（FGUI `button` 页 0=up） */
    tabPlateUp: 'common/cu_ty_btn13',
    /** 底栏页签 选中态底板 `TY_btn14` 168×132（FGUI `button` 页 1=down） */
    tabPlateDown: 'common/cu_ty_btn14',
    /** 列表项底板 `tycb_pt` 407×103，九宫 101,25,104,28（目标项 / 排名项共用） */
    itemBg: 'common/cu_tycb_pt',
    /** 二级按钮底（`_变暗狂欢`）`ZB_btn02` 147×66，九宫 51,23,55,26 */
    btn2Dark: 'common/cu_zb_btn02',
    /** 一级按钮底（`_多颜色_一级_变暗`）`TY_btn29` 218×69，九宫 54,17,56,18 */
    btn1Dark: 'common/cu_ty_btn29',
    /** 红点 `公用_图标_红点` 29×28 */
    redDot: 'common/cu_icon_dot',
    /** 弹窗底板 `panel_window_01_9gong` 394×307，九宫 129,128,142,143 */
    popPanel: 'common/cu_panel_window_01_9gong',
    /** 弹窗标题底 `title_brown` 344×81，九宫 171,20,157,21 */
    popTitle: 'common/cu_title_brown',
    /** 关闭按钮 `公用_按钮_关闭01` 60×60 */
    btnClose: 'common/cu_btn_close_01',
    /** 排行行底 / 边框 `frame_Zhikuang01` 155×113，九宫 38,28,41,29 */
    rowBg: 'common/cu_frame_zhikuang01',
    /** 表头分隔条 `BB_img03` 233×31，九宫 58,0,59,0 */
    barBg: 'common/cu_bb_img03',
};

/** `OS_ART_NAMES` 里所有图的 key（生成器 / 单测用来做「有没有漏摆」的反向对账）。 */
export const OS_ART_ALL_KEYS = Object.keys(OS_ART_NAMES);

/**
 * 需要 `Sprite._type = SLICED(1)` 的图（= `.png.meta` 里 border 有任意一条非 0）。
 * ⚠️ 这份名单**不是**第二真源：`tmp/gen_osrank.mjs` 会把它和 `.meta` 双向对账，不一致直接 fail。
 */
export const OS_ART_SLICED = new Set<string>([
    'titleBg',    // titlebg                      border 228,18,247,19
    'tagBg',      // bb_pic30                     border 35,0,28,0
    'rankHeaderBg', // kfqd06                     border 74,27,53,24
    'targetTagBg', // kfqd07                      border 82,19,96,13
    'shopCardBg', // kfqd03                       border 15,12,17,15
    'panelBg',    // cu_tybg                      border 155,164,155,164
    'diaBan',     // cu_diban_bg                  border 347,69,607,136
    'itemBg',     // cu_tycb_pt                   border 101,25,104,28
    'btn2Dark',   // cu_zb_btn02                  border 51,23,55,26
    'btn1Dark',   // cu_ty_btn29                  border 54,17,56,18
    'popPanel',   // cu_panel_window_01_9gong     border 129,128,142,143
    'popTitle',   // cu_title_brown               border 171,20,157,21
    'rowBg',      // cu_frame_zhikuang01          border 38,28,41,29
    'barBg',      // cu_bb_img03                  border 58,0,59,0
]);

/**
 * `Sprite._type = TILED(2)` 的图（FGUI `scale="tile"`）。
 * 开服庆典包**没有** `scale="tile"` 的图 —— 空集合是事实，不是漏写。
 */
export const OS_ART_TILED = new Set<string>([]);

/** `Sprite.Type.SIMPLE`（`cc.Sprite.Type` 的数值，避免 import `cc` 只为拿它）。 */
export const OS_SPRITE_SIMPLE = 0;

/** `Sprite.Type.SLICED`。 */
export const OS_SPRITE_SLICED = 1;

/**
 * `OS_ART_NAMES` 的 key → **完整 resources 相对路径**（不带扩展名）。
 *
 * ⚠️ `OS_ART_NAMES` 的 value 已经带了目录（`celebration/…` / `common/…` / `activityIcon/…`），
 * 所以这里不做任何拼接，只做**归一化**：把「最后一个 `/`」切开，得到 `{root, name}`。
 * 别自己拼 `OS_ART_ROOT + '/' + name` —— 共用图那 15 张不在 `image/celebration/` 下。
 */
export function osArtRef(key: string): { root: string; name: string } | null {
    const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
    if (!value) return null;
    const cut = value.lastIndexOf('/');
    if (cut <= 0) return { root: '', name: value };
    return { root: value.slice(0, cut), name: value.slice(cut + 1) };
}

// ============================================================
// 固定图（OS_ART_NAMES）的装配路径
// ============================================================

/**
 * 庆典固定图的根（`OS_ART_NAMES` 的 value 是**相对 `assets/resources/image/`** 的路径，
 * 与 `RoleArtLoader.ROLE_ART_ROOT` 同一口径）。
 *
 * 🔴 **运行时 load 必须带上这个前缀**（2026-09-28 实测：`celebration/os_zd_icon_qingdianTH/spriteFrame`
 * ⇒ `Bundle resources doesn't contain …`，而图明明在 `assets/resources/image/celebration/` 下）。
 * 漏它的症状是**静默留白 + 一条 warn**，只有点到「详细排名」那种会动态换图的页面才看得见。
 */
export const OS_ART_ROOT = 'image';

/**
 * `OS_ART_NAMES` 的 key → `resources.load` 能吃的**装配路径**（含 `/spriteFrame`）。
 *
 * ⚠️ 两件事**都得**做对，缺一件就是 `Bundle resources doesn't contain xxx`：
 *  ① 拼上 `OS_ART_ROOT`（`OS_ART_NAMES` 的 value 相对 `image/`）；
 *  ② 过 `ArtPaths.spriteFramePathOf`（规则 57）：`resources` bundle 的索引里只登记了
 *     `xxx/spriteFrame`，裸路径 `resources.load` 会报同一个错，且**只是静默留白 + 一条 warn**。
 */
export function osArtPath(key: string): string {
    const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
    if (!value) return '';
    return spriteFramePathOf(`${OS_ART_ROOT}/${value}`);
}

/** `OS_ART_NAMES` 的 key → `cc.Sprite._type`（九宫名单里的走 `SLICED`）。 */
export function osSpriteType(key: string): number {
    return OS_ART_SLICED.has(key) ? OS_SPRITE_SLICED : OS_SPRITE_SIMPLE;
}

/**
 * `{root, name}` → 装配路径（奖励图标那种「运行期才知道」的路径走这里）。
 *
 * ⚠️ **这里的 `root` 与 `OS_ART_NAMES` 不是同一口径**：它来自
 * `LayerActivityArt.resolveRewardIconRef`（`icons/item/**` / `icons/resource`），
 * 已经**相对 `assets/resources/`**（`icons/` 与 `image/` 平级）⇒ **不能再拼 `OS_ART_ROOT`**。
 * 拼了就变成 `image/icons/...`，同样报 `Bundle resources doesn't contain`，且不崩只是留白。
 */
export function osSharedPath(ref: { root: string; name: string }): string {
    return spriteFramePath(ref.root, ref.name);
}

// ============================================================
// 奖励格（品质框 + 道具图标）
// ============================================================

/** 品质框根目录（与 `activity` / `sevenDay` / `hang` 同一份 `image/frame`）。 */
export const OS_QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 品质档 1..4 → 框档（越界钳到 1..4）。与 `LayerActivityArt.qualityFrameLevel` 同算法。 */
export function osQualityFrameLevel(quality: number): number {
    if (!Number.isFinite(quality)) return 1;
    const n = Math.floor(quality);
    if (n <= 1) return 1;
    if (n >= 4) return 4;
    return n;
}

/** 品质档 → 品质框名（`common_img_pzk_0N`）。 */
export function osQualityFrameName(quality: number): string {
    return `common_img_pzk_0${osQualityFrameLevel(quality)}`;
}

/** 品质档 → 品质框的装配路径。 */
export function osQualityFramePath(quality: number): string {
    return spriteFramePath(OS_QUALITY_FRAME_ROOT, osQualityFrameName(quality));
}

/**
 * 奖励图标的两支分流解析（`item` 走图路径 / `roleProperty` 走 `icons/resource`）。
 *
 * ⚠️ **唯一入口**：不要自己判 `iconIsPath` —— 与 `hang` / `activity` / `gift` / `sevenDay`
 * 共用 `LayerActivityArt.resolveRewardIconRef`（本模块这份只是转发，免得页面 import 两个模块）。
 */
export { resolveRewardIconRef as osResolveRewardIconRef } from '../activity/LayerActivityArt';

// ============================================================
// 「这次刷新需要哪些图」
// ============================================================

/**
 * 算出一份快照下、**界面会动态换图**的全部装配路径（去重）。
 *
 * 这是「预加载集合 = 界面会 `_setFrame()` 的每一处」这条规则（60 / 73）在庆典模块的落点。
 * 挂机那轮的教训是「按钮要用的固定图不在 `row.rewards` 里 ⇒ 静默降级」；这里把
 * **四类**都算进来，一类都不漏：
 *
 * | # | 类别 | 出处 |
 * |---|---|---|
 * | ① | 奖励图标 | `targetArr[].rewards` / `rankArr[].rewards1` / `rankArr[].rewards2` / `shopArr[].rewards` |
 * | ② | 品质框 | 每个 `resId` 的 `quality`（查不到按 1） |
 * | ③ | 限时特惠的**货币图标** | `shopArr[].costType`（cost 分支 `icon_cost` 那格，**不在 `rewards` 里** ⇒ 正是规则 60 那个坑） |
 * | ④ | 固定图 | `extraKeys` 传进来的 key（页签选中 / 未选中的 6 张图标等，由调用方按界面实际情况点名） |
 *
 * ⚠️ 详情排行那一页的**头像**不在这里 —— 它走 `HeadArt.loadHeadFrame`（另一套两层查表 +
 * 包名分流），且是按行异步加载的，不在「打开面板一次性预加载」的集合里。
 *
 * ⚠️ 返回的是**装配路径**（已带 `/spriteFrame`），可以直接喂 `resources.load(path, SpriteFrame)`。
 */
export function celebrationNeededArtPaths(
    snapshot: {
        readonly targetArr: readonly { readonly rewards: readonly { readonly resId: number }[] }[];
        readonly rankArr: readonly {
            readonly rewards1: readonly { readonly resId: number }[];
            readonly rewards2: readonly { readonly resId: number }[];
        }[];
        readonly shopArr: readonly {
            readonly rewards: readonly { readonly resId: number }[];
            readonly costType: number;
        }[];
        readonly items: ReadonlyMap<number, ICelebrationGoodsInfo>;
        readonly resources: ReadonlyMap<number, ICelebrationGoodsInfo>;
    },
    extraKeys: readonly string[] = [],
): string[] {
    const paths = new Set<string>();

    const addReward = (resId: number): void => {
        if (resId <= 0) return;
        const info = snapshot.items.get(resId) ?? snapshot.resources.get(resId) ?? null;
        const ref = osResolveRewardIconRef(info);
        if (ref) paths.add(osSharedPath(ref));
        paths.add(osQualityFramePath(info ? info.quality : 1));
    };

    for (const row of snapshot.targetArr) for (const r of row.rewards) addReward(r.resId);
    for (const row of snapshot.rankArr) {
        for (const r of row.rewards1) addReward(r.resId);
        for (const r of row.rewards2) addReward(r.resId);
    }
    for (const row of snapshot.shopArr) {
        for (const r of row.rewards) addReward(r.resId);
        // ③ 货币图标：`roleProperty` 那一支（`iconIsPath` 由 `resources` 表决定）
        if (row.costType > 0) {
            const ref = osResolveRewardIconRef(snapshot.resources.get(row.costType) ?? null);
            if (ref) paths.add(osSharedPath(ref));
        }
    }
    for (const key of extraKeys) paths.add(osArtPath(key));

    return Array.from(paths);
}

/** 三个页签的 6 张图标 key（占位 / 选中），给页面算预加载集合用。 */
export const OS_TAB_ART_KEYS: readonly string[] = [
    'tabIconTarget', 'tabIconTargetOn',
    'tabIconRank', 'tabIconRankOn',
    'tabIconShop', 'tabIconShopOn',
];

// ============================================================
// 颜色（FGUI `gearColor` / `grayed` 的落地）
// ============================================================

/**
 * 颜色一律以**三通道元组**表达（本文件保持引擎无关 ⇒ 不在这里 `new Color`）。
 */
export type OsRgb = readonly [number, number, number];

/** 从 `#rrggbb` 转三通道（**只给本文件的常量用**；运行期别调它，白花时间）。 */
function hex(value: string): OsRgb {
    const n = parseInt(value.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * 名次文案的三档颜色（FGUI `item2` 的 `文本_排名`：`gearColor 名次`）。
 *
 * ```xml
 * <text name="文本_排名" color="#f33333" strokeColor="#1e160f">
 *   <gearColor controller="名次" pages="1,2"
 *              values="#33d6ff,#1e160f|#eae2b6,#1e160f" default="#f33333,#1e160f"/>
 * </text>
 * ```
 *
 * ⚠️ FGUI 的 `gearColor` `values` 按 `pages` 列出的**页 id 顺序**一一对应：
 * 这里 `pages="1,2"` ⇒ 第 1 个值给「2-3名」、第 2 个给「其他」；
 * 「第一名」（页 id `0`，未在 `pages` 里列出）用 `default`。
 */
export const OS_RANK_TEXT_COLORS: Readonly<Record<'first' | 'secondThird' | 'other', OsRgb>> = {
    first: hex('#f33333'),
    secondThird: hex('#33d6ff'),
    other: hex('#eae2b6'),
};

/** 名次文案的描边色（三档同色）。 */
export const OS_RANK_TEXT_STROKE: OsRgb = hex('#1e160f');

/**
 * 战力要求文案的两档颜色（FGUI `item2` 的 `lab_power`：`gearColor 状态`）。
 *
 * ```xml
 * <text name="lab_power" color="#818181" strokeColor="#000000">
 *   <gearColor controller="状态" pages="0,1"
 *              values="#818181,#000000|#eae2b6,#000000"/>
 * </text>
 * ```
 *
 * 🔴 **达标 = 灰（`#818181`）、未达标 = 米黄（`#eae2b6`）** —— 与直觉相反但原稿如此：
 * 达标那一档没被 `values` 覆盖，走的是 `default`，而 `default` 与元素自身的 `color` 一致，
 * 也就是「达标时保持设计期默认色」。「未达标」反而更亮，是老端的有意强调（要你去提升）。
 * 别"顺手"对调 —— 那会让两种状态的颜色整体反过来，而且**不报错**。
 */
export const OS_POWER_TEXT_REACHED: OsRgb = hex('#818181');
export const OS_POWER_TEXT_UNREACHED: OsRgb = hex('#eae2b6');

/** 战力要求文案的描边色。 */
export const OS_POWER_TEXT_STROKE: OsRgb = hex('#000000');

/** 原始（未染色）tint。 */
export const OS_TINT_NORMAL: OsRgb = [255, 255, 255];

/**
 * 置灰 tint。
 *
 * ⚠️ FGUI 的 `grayed`（`item2` 的 `com_goods` 上有 `gearLook 状态 pages="1" values="1,0,1,1"`）
 * 是**真灰度滤镜**；Cocos 3.x 的 `cc.Sprite` / `cc.Label` **没有内置灰度**。
 * 这里用**灰色 tint** 近似（口径与 `FriendArt` / `ChatArt` 完全一致，取 `132`），
 * 观感是「暗下来的同一块图」，但不是逐像素去色 —— **有意偏离**，已写进单测。
 *
 * 要真灰度得挂 `cc.Material`（灰度 effect），代价是每个实例多一个材质实例；
 * 对「排名奖档未达标」这种非关键态不值得。
 */
export const OS_TINT_GRAY: OsRgb = [132, 132, 132];

/** 按是否置灰取 tint（默认取值的唯一入口，避免各处写魔数）。 */
export function osTint(gray: boolean): OsRgb {
    return gray ? OS_TINT_GRAY : OS_TINT_NORMAL;
}

/** 按名次分段取文案颜色。 */
export function osRankTextColor(segment: 'first' | 'secondThird' | 'other'): OsRgb {
    return OS_RANK_TEXT_COLORS[segment] ?? OS_RANK_TEXT_COLORS.other;
}

/** 按是否达标取战力文案颜色。 */
export function osPowerTextColor(reached: boolean): OsRgb {
    return reached ? OS_POWER_TEXT_REACHED : OS_POWER_TEXT_UNREACHED;
}
