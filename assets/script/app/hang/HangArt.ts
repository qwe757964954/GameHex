/**
 * 征收（挂机，老端 `LayerHang`）美术口径 —— **资源路径的唯一入口**。
 *
 * 图分四类：
 *
 * | 类别 | 目录 | 说明 |
 * |---|---|---|
 * | 自有 13 张 | `image/hang/` | 从 FGUI「挂机」包 + 「公用0」包 + **「主界面_战斗」包**挑出，重命名成 `hj_` 前缀 |
 * | 跨模块复用 10 张 | `image/friend` / `image/firstRecharge` / `image/monthcard` / `image/activity` / `image/common` | md5 同源，**不另存第二份** |
 * | 货币图标 | `icons/resource/` | `图标_体力`（`roleProperty.end = 9`），唯一入口 `resolveRewardIconRef` |
 * | 品质框 | `image/frame/` | 与七日 / 礼包 / 活动 / 战令同一套 4 张 |
 *
 * ⚠️ 「主界面_战斗」那两张（`entryIcon` / `entryBg`）是 **2026-09-24 补迁**的：
 * 它们是**主界面左下角「快速扫荡」入口**（老端 `组件_战斗_章节选择` 里的 `快速扫荡` 节点）的图，
 * 属于「征收」这条功能链，但出自另一个 FGUI 包。第一轮只搬了弹窗本体，漏了入口 ⇒ 主界面上没有入口。
 * 判据 = FGUI `组件_战斗_快速扫荡.xml` 的 `<Button icon="ui://10z7u2rtuihv1xwmqye">`
 * （`主界面_战斗/package.xml:54` → `zjm_icon03_ZhengShou.png`）+ `n61` 的 `战斗选关_九宫_信息底01.png`。
 *
 * ## 复用哪些张（已 md5 逐字节比对，见 `tmp/_hang_verify_art.mjs`）
 *
 * | FGUI 源 | 落到 | 用途 | 九宫 |
 * |---|---|---|---|
 * | `公用0/图片/底板_panel/panel_window_01_9gong.png` | `friend/fd_panel_bg` | 弹窗底 626×903 | ✅ `129,128,123,36` |
 * | `公用0/图片/框体_frame/title_brown.png` | `firstRecharge/title_brown` | 弹窗标题底条 344×81 | ✅ `171,20,16,40` |
 * | `公用0/图片/按钮_btn/TY_btn23.png` | `friend/fd_tab_off` | **快速征收按钮底图** | ❌ 无 |
 * | `公用0/图片/按钮_btn/TY_btn06.png` | `friend/fd_btn_gold` | 领取按钮底图（`颜色=1` 橙） | ✅ `14,11,4,12` |
 * | `公用0/图片/按钮_btn/TY_btn07.png` | `friend/fd_btn_dark` | 领取按钮底图（`颜色=0` 蓝） | ✅ `15,11,4,9` |
 * | `公用0/图片/公用_按钮_关闭01.png` | `activity/act_btn_close` | 弹窗关闭键 60×60 | ❌ 无 |
 * | `公用0/图片/公用_图标_红点.png` | `common/cm_red_dot` | 普通红点 | ❌ 无 |
 * | `公用0/图片/公用_图标_红点02.png` | `common/cm_red_dot_num` | 数字红点 | ❌ 无 |
 * | `公用0/图片/公用_图标_新.png` | `common/cm_red_dot_new` | 「新」红点 | ❌ 无 |
 *
 * ⚠️ **九宫不是看名字猜的**：`TY_btn23` 在 `公用0/package.xml` 里**没有** `scale9grid`
 * （`<image ... name="TY_btn23.png" exported="true"/>`，无 `scale`），而 `TY_btn06/07` 有。
 * 判据一律读各自 `.meta` 的 `subMetas.f9941.userData.border*`（非 0 即九宫）；
 * 生成器 `tmp/gen_hang.mjs` 就是按 `.meta` 决定 `_type` 的，**别在 TS 里再抄一份名单**。
 *
 * ⚠️ `按钮_切换` 里那个小箭头 `change_btn` 的 `icon="ui://w3m64m87wtic1yxnapo"` ——
 * `wtic1yxnapo` 在 `公用0/package.xml:297` 是 **`zhek_2.png`**，也就是**本模块自有**的
 * `hj_gear_icon`（34×37，与显示尺寸 34×37 完全吻合）。**它不是 `TY_btn21`**，不必另找复用件。
 *
 * ## ⚠️ 九宫格（`HJ_ART_SLICED`）
 *
 * 三张图带 FGUI `scale9grid`；四边 border 已写进各自 `.meta` 的
 * `subMetas.f9941.userData.border*`（见 `tmp/_set_hang_slice.mjs`）。
 * **`.prefab` 里的 `cc.Sprite._type` 必须写 `1(SLICED)` 才用得上它** ——
 * 漏写的症状是「图照样显示、只是整张被拉伸」，不报错。
 *
 * ⚠️ `hj_bar_fill`（14×17）与 `hj_bar_bg`（30×23）都是**小图被拉成 290×20**
 * ⇒ 按原图算的 border 会整体偏边，必须把 `trimType` 钉成 `none` 后 refresh 重新导入，
 * 尺寸才回到原图（已做，实测 `width === rawWidth`）。
 */

import { FRAME_ART_ROOT, RESOURCE_ICON_ART_ROOT as ART_RESOURCE_ICON_ROOT, spriteFramePath } from '../ArtPaths';

/** 征收自有图目录（运行时相对 `resources` 的路径）。 */
export const HJ_ART_ROOT = 'image/hang';

/**
 * 征收自有图（`key` → 文件名，不含扩展名）。
 *
 * 与 FGUI 源的对应关系写在每行注释里；11 张全部 md5 与源图逐字节一致。
 */
export const HJ_ART_NAMES: Readonly<Record<string, string>> = {
    /** 头部底图 550×324（FGUI `挂机/图片/gj_img_bg.png`）。 */
    headBg: 'hj_head_bg',
    /** 进度条**填充** 14×17，9 宫 `4,3,4,8`（FGUI `挂机/图片/ss1.png`）。 */
    barFill: 'hj_bar_fill',
    /** 进度条**底槽** 30×23，9 宫 `7,5,14,10`（FGUI `挂机/图片/ss2.png`）。 */
    barBg: 'hj_bar_bg',
    /** 月卡条底图 603×141（FGUI `挂机/图片/ss3.png`）。 */
    monthBg: 'hj_month_bg',
    /** 月卡条装饰条 152×38（FGUI `挂机/图片/ss4.png`）。 */
    monthDeco: 'hj_month_deco',
    /** 月卡按钮底 140×80（FGUI `挂机/图片/ss5.png`）。 */
    monthBtn: 'hj_month_btn',
    /** 「MAX」角标 44×21（FGUI `公用0/图片/标签_tag/tag_ZiTi_MAX.png`）。 */
    tagMax: 'hj_tag_max',
    /** 奖励区底板 407×103，9 宫 `101,25,202,50`（FGUI `公用0/图片/框体_frame/tycb_pt.png`）。 */
    rewardFrame: 'hj_reward_frame',
    /** 「看视频」小图标 39×28（FGUI `公用0/图片/散件_img/img_video.png`）。 */
    ad: 'hj_ad',
    /** 倍率切换底图 115×61（FGUI `公用0/图片/装饰_texture/zhek_1.png`）。 */
    gearBg: 'hj_gear_bg',
    /** 倍率切换上的小箭头 34×37（FGUI `公用0/图片/装饰_texture/zhek_2.png`）。 */
    gearIcon: 'hj_gear_icon',
    /**
     * **主界面左下角「征收」入口**的按钮脸 113×102
     * （FGUI `主界面_战斗/图片/zjm_icon03_ZhengShou.png`，非九宫）。
     *
     * ⚠️ 它不是「挂机」包的图 —— 入口本身长在**主界面**（老端 `组件_战斗_章节选择`）里，
     * 只是点下去开的是征收弹窗。第一轮漏迁的就是它 + `entryBg`。
     */
    entryIcon: 'hj_entry_icon',
    /** 主界面入口的文案底板 80×30，9 宫（FGUI `主界面_战斗/图片/战斗选关_九宫_信息底01.png`）。 */
    entryBg: 'hj_entry_bg',
};

/** 自有图的 key 类型。 */
export type HangArtKey = keyof typeof HJ_ART_NAMES;

/**
 * **需要九宫格渲染的图**（prefab 里挂 `cc.Sprite` 且 `_type` 必须 = 1）。
 *
 * 与 FGUI 里的 `scale9grid` 一一对应；每张的四边 border 已写进各自 `.meta` 的
 * `subMetas.f9941.userData.border*`（**`.meta` 才是引擎读的真源**，本表只声明「哪些张要九宫」）。
 *
 * | 图 | FGUI `scale9grid` | Cocos `borderLeft/Top/Right/Bottom` |
 * |---|---|---|
 * | `hj_bar_fill` | `4,3,4,8`（原图 14×17） | `4 / 3 / 6 / 6` |
 * | `hj_bar_bg` | `7,5,14,10`（原图 30×23） | `7 / 5 / 9 / 8` |
 * | `hj_reward_frame` | `101,25,202,50`（原图 407×103） | `101 / 25 / 104 / 28` |
 * | `hj_entry_bg` | `20,7,40,14`（原图 80×30） | `20 / 7 / 20 / 9` |
 *
 * 换算口径：`left=x / top=y / right=W-(x+w) / bottom=H-(y+h)`。
 *
 * ⚠️ `hj_entry_bg` 与 `hj_entry_icon` 两张**必须** `trimType: none`：FGUI 的
 * `<loader fill="scaleFree">` 是把**整张原图**（含透明留白）缩放到 loader 尺寸，
 * 而 Cocos 默认 `trimType: auto` 会先裁掉透明边 —— 实测 `hj_entry_bg` 被裁掉左侧 3px
 * （80→75），border 就会整体偏边。已钉成 `none`（`tmp/_set_hang_slice.mjs`）。
 */
export const HJ_ART_SLICED: ReadonlySet<string> = new Set<string>([
    HJ_ART_NAMES.barFill,
    HJ_ART_NAMES.barBg,
    HJ_ART_NAMES.rewardFrame,
    HJ_ART_NAMES.entryBg,
]);

/**
 * `cc.Sprite._type` 的取值（生成器 / 页面共用，避免各处写魔数）。
 *
 * `SIMPLE = 0` / `SLICED = 1`；`_sizeMode` 恒为 `CUSTOM = 0`（规则 7：被渲染组件回写
 * `contentSize` 的坑）。
 */
export const HJ_SPRITE_SIMPLE = 0;
export const HJ_SPRITE_SLICED = 1;

/** 按资源名给出该图应使用的 `cc.Sprite._type`。 */
export function hjSpriteType(artName: string): number {
    return HJ_ART_SLICED.has(artName) ? HJ_SPRITE_SLICED : HJ_SPRITE_SIMPLE;
}

/** 自有图的 `resources.load` 路径（带 `/spriteFrame`）。 */
export function hjArtPath(key: HangArtKey): string {
    return spriteFramePath(HJ_ART_ROOT, HJ_ART_NAMES[key]);
}

/** 自有图的 `{ root, name }` 形态（给统一装配函数用）。 */
export function hjArtRef(key: HangArtKey): { root: string; name: string } {
    return { root: HJ_ART_ROOT, name: HJ_ART_NAMES[key] };
}

// ============================================================
// 跨模块复用（md5 同源，不另存第二份）
// ============================================================

/** 弹窗底板 626×903（九宫 `129,128,123,36`）。 */
export const HJ_SHARED_PANEL_BG = { root: 'image/friend', name: 'fd_panel_bg' } as const;
/** 弹窗标题底条 344×81（九宫 `171,20,16,40`，居中挂在弹窗顶部、上半截露在弹窗外面）。 */
export const HJ_SHARED_PANEL_TITLE = { root: 'image/firstRecharge', name: 'title_brown' } as const;
/** 「快速征收」按钮底图 224×79（**非**九宫；FGUI `TY_btn23` 没有 `scale9grid`）。 */
export const HJ_SHARED_BTN_SWEEP = { root: 'image/friend', name: 'fd_tab_off' } as const;
/** 「领取」按钮底图（`颜色=1` 橙，九宫 `14,11,4,12`）。 */
export const HJ_SHARED_BTN_GOLD = { root: 'image/friend', name: 'fd_btn_gold' } as const;
/** 「领取」按钮底图（`颜色=0` 蓝，九宫 `15,11,4,9`）—— 本轮用不到，留着备切换。 */
export const HJ_SHARED_BTN_DARK = { root: 'image/friend', name: 'fd_btn_dark' } as const;
/** 弹窗关闭键 60×60（**非**九宫）。 */
export const HJ_SHARED_CLOSE = { root: 'image/activity', name: 'act_btn_close' } as const;
/** 普通红点（圆点）。 */
export const HJ_SHARED_RED_DOT = { root: 'image/common', name: 'cm_red_dot' } as const;
/** 数字红点（椭圆底 + 数字）。 */
export const HJ_SHARED_RED_DOT_NUM = { root: 'image/common', name: 'cm_red_dot_num' } as const;
/** 「新」角标红点。 */
export const HJ_SHARED_RED_DOT_NEW = { root: 'image/common', name: 'cm_red_dot_new' } as const;

/** 复用的 `{root,name}` → `resources.load` 路径。 */
export function hjSharedPath(ref: { root: string; name: string }): string {
    return spriteFramePath(ref.root, ref.name);
}

// ============================================================
// 货币图标（`roleProperty`，`iconIsPath = false`）
// ============================================================

/**
 * `roleProperty` 图标目录（FGUI 裸组件名 → 落这里）。
 *
 * ⚠️ 值转发 `ArtPaths.RESOURCE_ICON_ART_ROOT`（**唯一真源**）：这个字面量曾在
 * `LayerActivityArt` / 本模块 / `gift` 注释里各写一份，改目录时要同时改多处。
 */
export const HJ_RESOURCE_ICON_ROOT = ART_RESOURCE_ICON_ROOT;

/**
 * 快速征收按钮上那个体力小图标的资源名。
 *
 * ⚠️ `roleProperty.end = 9`，`icon` 存的是 FGUI 裸名 **`图标_体力`**（不是路径）
 * ⇒ 只能落 `icons/resource/`。这张图是**追加迁移**进来的（规则 74：按「用到的表」
 * 逐条对账时最容易漏的一张）—— 漏了不报错、按钮上永远留一块白。
 */
export const HJ_COST_ICON_NAME = '图标_体力';

/** 体力图标的加载路径。 */
export const HJ_COST_ICON_PATH = spriteFramePath(HJ_RESOURCE_ICON_ROOT, HJ_COST_ICON_NAME);

// ============================================================
// 品质框（与七日 / 礼包 / 活动 / 战令同一套）
// ============================================================

const QUALITY_FRAME_LEVELS = 4;

/**
 * 品质档 → 框档（1..4）。
 *
 * ⚠️ **转发 `SevenDayArt` 的实现口径，不在这里重算** —— 七日 / 礼包 / 活动 / 首充 / 战令
 * 五个模块已经是同一个算法 `clamp(floor(q) - 1, 1, 4)`，这里再抄一份迟早会走偏。
 * 抄写成本高于收益，故逐字保持一致。
 */
export function qualityFrameLevel(quality: number): number {
    const raw = Math.floor(quality) - 1;
    return Math.min(QUALITY_FRAME_LEVELS, Math.max(1, raw > 0 ? raw : 1));
}

/** 品质档 → 框资源名（不带扩展名）。 */
export function qualityFrameName(quality: number): string {
    return `common_img_pzk_0${qualityFrameLevel(quality)}`;
}

/** 品质框目录（与七日 / 礼包 / 活动共用 `image/frame/`）。 */
export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框名（按框档枚举，恰好 4 张）。 */
export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

/** 品质框的 `resources.load` 路径。 */
export function qualityFramePath(quality: number): string {
    return spriteFramePath(QUALITY_FRAME_ROOT, qualityFrameName(quality));
}

/**
 * 奖励图标的两支分流 —— **转发 `LayerActivityArt.resolveRewardIconRef`**。
 *
 * 为什么必须转发而不是自己判：奖励里混着两类东西。
 *
 * | 来源 | `icon` 存的是 | 怎么解析 |
 * |---|---|---|
 * | `item` 表（`iconIsPath = true`） | 相对 `resources` 的路径 `icons/item/xxx` | 直通，只认 `icons/` 前缀 |
 * | `roleProperty` 表（`iconIsPath = false`） | FGUI 裸组件名 `图标_体力` | 落 `icons/resource/<name>` |
 *
 * 只处理 `item` 那一支的症状：奖励格**只剩品质框、没有图标**（静默降级、不报错）。
 */
export { resolveRewardIconRef as hjResolveRewardIconRef } from '../activity/LayerActivityArt';
