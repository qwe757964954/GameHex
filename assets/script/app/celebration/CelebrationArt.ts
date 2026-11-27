/**
 * 开服庆典的美术入口（对齐 `RoleArt.ts` / `HangArt.ts` / `GiftArt.ts`）。
 *
 * - value 是相对 `assets/resources/image/` 的路径，不带扩展名；
 * - 取图走 `osArtPath(key)`：拼 `image/` 前缀，再过 `ArtPaths.spriteFramePathOf`。漏了前缀或
 *   `/spriteFrame` 都只会静默留白 + 一条 warn（2026-09-28 详细排名页实测）；
 * - `OS_ART_SLICED` 必须与 `.png.meta` 的 border 一一对应，`tests/celebration.test.ts` 的 B1/F1 会双向对账。
 *
 * 前缀：`os_` 是开服冲榜包自有（`image/celebration/`），`cu_` 是前几轮迁进来的共用图（`image/common/`）。
 * 九宫数据由生成器从老端 `.bin` 的 `scale9Grid` 写入 `.meta`，不要手抄。
 */
import { ART_ROOT, FRAME_ART_ROOT, spriteFramePath, spriteFramePathOf } from '../ArtPaths';
import { qualityFrameNameOfLevel } from '../common/QualityFrameArt';
import { ECelebrationRankSegment } from './CelebrationTable';
import type { ICelebrationGoodsInfo } from './CelebrationTable';

// 奖励图标统一走 common/RewardIcon；本文件不保留旧 activity 转发入口。
import { resolveRewardIconRef as osResolveRewardIconRef } from '../common/RewardIcon';

export const OS_ART_NAMES = {
    // ---------- 开服冲榜包自有（image/celebration）----------
    /** 整屏底图 720×1668（老端 `qd_tongyong.jpg`，比屏高，故意溢出下边） */
    bg: 'celebration/os_qd_tongyong',
    /** 标题横幅底 `titlebg` 747×63，九宫 228,18,247,19 */
    titleBg: 'celebration/os_titlebg',
    /** 倒计时条底 `bb_pic30` 143×32，九宫 35,0,28,0 */
    tagBg: 'celebration/os_bb_pic30',
    /** 标题左侧小图标 `kfqd02` 42×57 */
    icoTitle: 'celebration/os_kfqd02',
    /** 左上装饰旗帜 `kfqd04` 501×136 */
    banner: 'celebration/os_kfqd04',
    /** 帮助按钮底 `zx_btn01` 61×62 */
    helpPlate: 'celebration/os_zx_btn01',
    /** 排名页表头底 `kfqd06` 193×74，九宫 74,27,53,24 */
    rankHeaderBg: 'celebration/os_kfqd06',
    /** 庆典目标项左上标签底 `kfqd07` 276×49，九宫 82,19,96,13 */
    targetTagBg: 'celebration/os_kfqd07',
    /** 「已领取」印章 119×74 */
    claimedMark: 'celebration/os_icon_claimed',
    /** 排名项里的竖分隔线 `kfqd05` 7×63 */
    divider: 'celebration/os_kfqd05',
    /** 限时特惠商品卡底 `kfqd03` 206×303，九宫 15,12,17,15 */
    shopCardBg: 'celebration/os_kfqd03',
    /** 原价删除线 `qd_7` 85×15 */
    strikeLine: 'celebration/os_qd_7',
    /** 折扣角标底 `kfqd01` 67×55 */
    saleMark: 'celebration/os_kfqd01',
    /** 头像底 `img_Touxiang_01` 73×73 */
    avatarBg: 'celebration/os_img_touxiang01',
    // 底栏三页签图标（`按钮_民兵页签` 的 `icon` / `selectIcon`，按控制器 `类型` 0/1/4 换图）
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
    /** 主界面入口按钮图标 90×100（`open.json` 的 `战斗选关_按钮_开服冲榜`） */
    entryIcon: 'activityIcon/战斗选关_按钮_开服冲榜',

    // ---------- 共用图（image/common，只指路，不重复拷）----------
    /** 通用大底板 `tybg` 620×656，九宫 155,164,155,164 */
    panelBg: 'common/cu_tybg',
    /** 底栏底板 `diban_BG` 992×212，九宫 347,69,607,136 */
    diaBan: 'common/cu_diban_bg',
    /** 返回按钮底 `btn_FanHui` 115×119 */
    btnBack: 'common/cu_btn_fan_hui',
    /** 底栏页签未选中底板 `TY_btn13` 168×132 */
    tabPlateUp: 'common/cu_ty_btn13',
    /** 底栏页签选中底板 `TY_btn14` 168×132 */
    tabPlateDown: 'common/cu_ty_btn14',
    /** 列表项底板 `tycb_pt` 407×103，九宫 101,25,104,28（目标项 / 排名项共用） */
    itemBg: 'common/cu_tycb_pt',
    /** 二级按钮底 `ZB_btn02` 147×66，九宫 51,23,55,26 */
    btn2Dark: 'common/cu_zb_btn02',
    /** 一级按钮底 `TY_btn29` 218×69，九宫 54,17,56,18 */
    btn1Dark: 'common/cu_ty_btn29',
    /** 红点 29×28 */
    redDot: 'common/cu_icon_dot',
    /** 弹窗底板 `panel_window_01_9gong` 394×307，九宫 129,128,142,143 */
    popPanel: 'common/cu_panel_window_01_9gong',
    /** 弹窗标题底 `title_brown` 344×81，九宫 171,20,157,21 */
    popTitle: 'common/cu_title_brown',
    /** 关闭按钮 60×60 */
    btnClose: 'common/cu_btn_close_01',
    /** 排行行底 / 边框 `frame_Zhikuang01` 155×113，九宫 38,28,41,29 */
    rowBg: 'common/cu_frame_zhikuang01',
    /** 表头分隔条 `BB_img03` 233×31，九宫 58,0,59,0 */
    barBg: 'common/cu_bb_img03',
};

/** `OS_ART_NAMES` 的全部 key（单测做「有没有漏摆」的反向对账）。 */
export const OS_ART_ALL_KEYS = Object.keys(OS_ART_NAMES);

/**
 * 需要 `Sprite._type = SLICED` 的图，即 `.meta` 里任意一条 border 非 0。
 * 这份名单不是第二真源，`tests/celebration.test.ts` 的 F1 会与 `.meta` 对账。
 */
export const OS_ART_SLICED = new Set<string>([
    'titleBg',      // titlebg                    border 228,18,247,19
    'tagBg',        // bb_pic30                   border 35,0,28,0
    'rankHeaderBg', // kfqd06                     border 74,27,53,24
    'targetTagBg',  // kfqd07                     border 82,19,96,13
    'shopCardBg',   // kfqd03                     border 15,12,17,15
    'panelBg',      // cu_tybg                    border 155,164,155,164
    'diaBan',       // cu_diban_bg                border 347,69,607,136
    'itemBg',       // cu_tycb_pt                 border 101,25,104,28
    'btn2Dark',     // cu_zb_btn02                border 51,23,55,26
    'btn1Dark',     // cu_ty_btn29                border 54,17,56,18
    'popPanel',     // cu_panel_window_01_9gong   border 129,128,142,143
    'popTitle',     // cu_title_brown             border 171,20,157,21
    'rowBg',        // cu_frame_zhikuang01        border 38,28,41,29
    'barBg',        // cu_bb_img03                border 58,0,59,0
]);

/** 需要 `Sprite._type = TILED` 的图。开服庆典包没有 `scale="tile"` 的图，空集合是事实。 */
export const OS_ART_TILED = new Set<string>([]);

/** `Sprite.Type.SIMPLE` / `SLICED` 的数值，省得为它 import `cc`。 */
export const OS_SPRITE_SIMPLE = 0;
const OS_SPRITE_SLICED = 1;

/**
 * `OS_ART_NAMES` 的 key → `{root, name}`：把值的最后一个 `/` 切开。
 *
 * value 已经带目录（`celebration/…` / `common/…` / `activityIcon/…`），这里只做归一化，
 * 不要自己拼 `OS_ART_ROOT + '/' + name`：共用图不在 `image/celebration/` 下。
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
 * 庆典固定图的根（相对 `assets/resources/image/`）。
 * 运行时 load 必须带这个前缀，否则报 `Bundle resources doesn't contain …`，表现是静默留白。
 */
export const OS_ART_ROOT = ART_ROOT;

/**
 * `OS_ART_NAMES` 的 key → `resources.load` 能吃的装配路径（含 `/spriteFrame`）。
 * 两件事都要做对：拼 `OS_ART_ROOT`，再过 `ArtPaths.spriteFramePathOf`。
 */
export function osArtPath(key: string): string {
    const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
    if (!value) return '';
    return spriteFramePathOf(`${OS_ART_ROOT}/${value}`);
}

/** `OS_ART_NAMES` 的 key → `cc.Sprite._type`（九宫名单里的走 SLICED）。 */
export function osSpriteType(key: string): number {
    return OS_ART_SLICED.has(key) ? OS_SPRITE_SLICED : OS_SPRITE_SIMPLE;
}

/**
 * `{root, name}` → 装配路径（奖励图标这种运行期才知道的路径走这里）。
 *
 * 这里的 `root` 来自 `common/RewardIcon.resolveRewardIconRef`（`icons/item/**` / `icons/resource`），
 * 已经相对 `assets/resources/`，与 `OS_ART_NAMES` 不是同一口径，不能再拼 `OS_ART_ROOT`。
 */
export function osSharedPath(ref: { root: string; name: string }): string {
    return spriteFramePath(ref.root, ref.name);
}

// ============================================================
// 奖励格（品质框 + 道具图标）
// ============================================================

/** 品质框根目录（与 activity / sevenDay / hang 共用 `image/frame`）。 */
const OS_QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/**
 * 品质档 → 框档（越界钳到 1..4）。
 *
 * 注意与 `common/QualityFrameArt.qualityFrameLevel` 的换算不同：那边按 `quality - 1` 折算，
 * 本模块是老端直接拿品质当框档，不要互换。
 */
export function osQualityFrameLevel(quality: number): number {
    if (!Number.isFinite(quality)) return 1;
    const n = Math.floor(quality);
    if (n <= 1) return 1;
    if (n >= 4) return 4;
    return n;
}

/** 品质档 → 品质框名（`common_img_pzk_0N`）。 */
export function osQualityFrameName(quality: number): string {
    return qualityFrameNameOfLevel(osQualityFrameLevel(quality));
}

/** 品质档 → 品质框的装配路径。 */
export function osQualityFramePath(quality: number): string {
    return spriteFramePath(OS_QUALITY_FRAME_ROOT, osQualityFrameName(quality));
}

/**
 * 奖励图标的两支分流解析（`item` 走图路径 / `roleProperty` 走 `icons/resource`）。
 * 统一走 `common/RewardIcon.resolveRewardIconRef`；本文件只保留内部使用，不再对外转发。
 */

// ============================================================
// 「这次刷新需要哪些图」
// ============================================================

/**
 * 算出一份快照下界面会动态换图的全部装配路径（去重），供预加载。
 *
 * 四类都要算进来：奖励图标（各列表的 `rewards`）、品质框、限时特惠的货币图标
 * （`shopArr[].costType`，不在 `rewards` 里）、`extraKeys` 点名传入的固定图。
 *
 * 详情排行那一页的头像不在这里：它走 `HeadArt.loadHeadFrame`，按行异步加载。
 * 返回的是装配路径（已带 `/spriteFrame`），可以直接喂 `resources.load(path, SpriteFrame)`。
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
        // 货币图标走 `roleProperty` 那一支，`iconIsPath` 由 `resources` 表决定。
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

/** 颜色一律以三通道元组表达，本文件不 new `Color`。 */
export type OsRgb = readonly [number, number, number];

/** `#rrggbb` → 三通道，只给本文件的常量用。 */
function hex(value: string): OsRgb {
    const n = parseInt(value.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * 名次文案的三档颜色（FGUI `item2` 的 `文本_排名`，`gearColor 名次`）。
 *
 * `<gearColor controller="名次" pages="1,2" values="#33d6ff,#1e160f|#eae2b6,#1e160f" default="#f33333,#1e160f"/>`：
 * `values` 按 `pages` 列出的页 id 顺序一一对应，第一名（页 id 0）不在 `pages` 里，走 `default`。
 */
const OS_RANK_TEXT_COLORS: Readonly<Record<ECelebrationRankSegment, OsRgb>> = {
    [ECelebrationRankSegment.First]: hex('#f33333'),
    [ECelebrationRankSegment.SecondThird]: hex('#33d6ff'),
    [ECelebrationRankSegment.Other]: hex('#eae2b6'),
};

/** 名次文案的描边色（三档同色）。 */
export const OS_RANK_TEXT_STROKE: OsRgb = hex('#1e160f');

/**
 * 战力要求文案的两档颜色（FGUI `item2` 的 `lab_power`，`gearColor 状态`）。
 *
 * 达标是灰 `#818181`、未达标是米黄 `#eae2b6`：达标那一档没被 `values` 覆盖，走的是元素自身的
 * `color`（设计期默认色）；未达标更亮是老端的强调。两档不要对调。
 */
export const OS_POWER_TEXT_REACHED: OsRgb = hex('#818181');
const OS_POWER_TEXT_UNREACHED: OsRgb = hex('#eae2b6');

/** 战力要求文案的描边色。 */
export const OS_POWER_TEXT_STROKE: OsRgb = hex('#000000');

/** 原始（未染色）tint。 */
const OS_TINT_NORMAL: OsRgb = [255, 255, 255];

/**
 * 置灰 tint。
 *
 * FGUI 的 `grayed` 是真灰度滤镜，Cocos 3.x 的 `Sprite` / `Label` 没有内置灰度，这里用灰色 tint 近似，
 * 取 132 与 `FriendArt` / `ChatArt` 同口径。要真灰度得挂灰度材质的 effect，对「未达标」这种非关键态不值得。
 */
const OS_TINT_GRAY: OsRgb = [132, 132, 132];

/** 按是否置灰取 tint。 */
export function osTint(gray: boolean): OsRgb {
    return gray ? OS_TINT_GRAY : OS_TINT_NORMAL;
}

/** 按名次分段取文案颜色。 */
export function osRankTextColor(segment: ECelebrationRankSegment): OsRgb {
    return OS_RANK_TEXT_COLORS[segment];
}

/** 按是否达标取战力文案颜色。 */
export function osPowerTextColor(reached: boolean): OsRgb {
    return reached ? OS_POWER_TEXT_REACHED : OS_POWER_TEXT_UNREACHED;
}
