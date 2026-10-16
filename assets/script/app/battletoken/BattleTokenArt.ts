/**
 * 战令（`LayerBattleToken`）美术口径 —— **资源路径的唯一入口**。
 *
 * 图分三类：
 *
 * | 类别 | 目录 | 说明 |
 * |---|---|---|
 * | 战令自有 24 张 | `image/battletoken/` | 从 FGUI「超值战令」包 + 「公用0」包挑出重命名（`bt_` 前缀） |
 * | 跨模块复用 3 张 | `image/gift`、`image/sevenDay` | md5 同源，**不另存第二份** |
 * | 工程公用 | `image/frame` | 品质框（与七日 / 礼包 / 活动同一套） |
 *
 * ## 复用哪三张（已 md5 逐字节比对）
 *
 * | FGUI 源 | 落到 | 用途 |
 * |---|---|---|
 * | `公用0/图片/diban_BG.png` | `gift/gf_bottom_bar`（992×212 → 显示 720×120） | 底栏背景 |
 * | `公用0/图片/散件_img/bb_pic24.png` | `sevenDay/sd_bb24`（60×59） | 锁定「未解锁」遮罩圆 |
 * | `公用0/图片/散件_img/shaixuan_duigou.png` | `sevenDay/sd_check`（32×33） | 已领取对勾 |
 *
 * ## ⚠️ 九宫格（`BT_ART_SLICED`）
 *
 * 值 = FGUI `package.xml` 的 `scale9grid="x,y,w,h"` 换算成 Cocos 四边边框，
 * 已写进各自 `.meta` 的 `subMetas.f9941.userData.border*`（见 `tmp/_set_battletoken_slice.mjs`）。
 * **`.prefab` 里的 `cc.Sprite._type` 必须写 `1(SLICED)` 才用得上它** ——
 * 漏写的症状是「图照样显示、只是整张被拉伸」，不报错。
 *
 * ⚠️ 其中 `bt_bar_fill`（40×24）与 `bt_line_fill`（14×16）首次导入时被 `trimType: auto`
 * **裁掉了透明边**（变成 36×20 / 10×16）⇒ 按原图算的 border 会整体偏边。处置 = 把 `trimType`
 * 钉成 `none` 后 refresh 重新导入，尺寸才回到原图。
 *
 * ## ⚠️ `bt_bg` 老端**注释掉了**
 *
 * `LayerBattleTokenUI.init` 里那行 `this.com.tm<AppGloaderEx>("bg").SetUrlByBg("zhuangbei_bg")`
 * 是注释状态 ⇒ 本轮**不摆这个背景**（图仍备在目录里，`bt_bg.jpg`）。
 */

import { FRAME_ART_ROOT, spriteFramePath } from '../ArtPaths';

/** 战令自有图目录（运行时时相对 `resources` 的路径）。 */
export const BT_ART_ROOT = 'image/battletoken';

/**
 * 战令自有图（`key` → 文件名，不含扩展名）。
 *
 * ⚠️ `bg` 在磁盘上是 **`.jpg`**（FGUI 源 `zhuangbei_bg.png` 的扩展名骗人，文件头是 `ffd8ffe1`）
 * ⇒ 落成 `bt_bg.jpg`。`resources.load` 按不带扩展名的资源名找，调用方不受影响。
 */
export const BT_ART_NAMES: Readonly<Record<string, string>> = {
    /** 主背景 720×1280（老端注释未启用，备着）。 */
    bg: 'bt_bg',
    /** 内容页面板底 620×656（FGUI 显示 720×740，九宫 155,164,310,328）。 */
    panelBg: 'bt_panel_bg',
    /** 内容页标题条 747×63（FGUI 显示 720×67，九宫 228,18,272,26）。 */
    titleBg: 'bt_title_bg',
    /** 页头说明气泡 331×119（FGUI 显示 330×195 × scale 1,0.6，九宫 117,29,126,58）。 */
    qipao: 'bt_qipao',
    /** 列表行底板·**两方案**版 656×103（FGUI 显示 656×107）。 */
    rowBg2: 'bt_row_bg_2',
    /** 列表行底板·**三方案**版 656×103（FGUI 显示 656×106）。 */
    rowBg3: 'bt_row_bg_3',
    /** 行间竖线·填充 14×16（九宫 6,6,4,6）。 */
    lineFill: 'bt_line_fill',
    /** 行间竖线·底 14×16（九宫 4,6,6,4）。 */
    lineBg: 'bt_line_bg',
    /** 购买按钮底·红 193×74（九宫 74,27,66,23）。 */
    btnRed: 'bt_btn_red',
    /** 购买按钮底·黄 193×74。 */
    btnYellow: 'bt_btn_yellow',
    /** 免费按钮底 193×74。 */
    btnFree: 'bt_btn_free',
    /** 锁标 35×38（方案没开时压在奖励格左上）。 */
    lock: 'bt_lock',
    /** 奖励格图标遮罩 100×100（置灰用）。 */
    iconMask: 'bt_icon_mask',
    /** 经验条·底 40×24。 */
    barBg: 'bt_bar_bg',
    /** 经验条·填充 40×24（九宫 20,11,2,3）。 */
    barFill: 'bt_bar_fill',
};

/** 页头三件套：每个页签一套（FGUI `gearIcon` 三处 loader 各切一次图）。 */
export const BT_PAGE_ART: Readonly<Record<string, { title: string; headbg: string; hero: string }>> = {
    txz: { title: 'bt_txz_title', headbg: 'bt_txz_headbg', hero: 'bt_txz_hero' },
    qrdl: { title: 'bt_qrdl_title', headbg: 'bt_qrdl_headbg', hero: 'bt_qrdl_hero' },
    djjj: { title: 'bt_djjj_title', headbg: 'bt_djjj_headbg', hero: 'bt_djjj_hero' },
    ggl: { title: 'bt_ggl_title', headbg: 'bt_ggl_headbg', hero: 'bt_ggl_hero' },
};

/** 页头三张图的 `part`。 */
export type BTPageArtPart = 'title' | 'headbg' | 'hero';

/** 页头三张图的文件名。 */
export function btPageArtName(artKey: string, part: BTPageArtPart): string {
    return BT_PAGE_ART[artKey]?.[part] ?? BT_PAGE_ART.txz[part];
}

/** 页头三张图的装配路径。 */
export function btPageArtPath(artKey: string, part: BTPageArtPart): string {
    return spriteFramePath(BT_ART_ROOT, btPageArtName(artKey, part));
}

/** 取某个战令自有图的装配路径；`key` 未知时返回 `null`。 */
export function btArtPath(key: string): string | null {
    const name = BT_ART_NAMES[key];
    if (!name) return null;
    return spriteFramePath(BT_ART_ROOT, name);
}

// ============================================================
// 跨模块复用（md5 同源，不另存）
// ============================================================

/** 底栏背景 —— 与礼包同一张（`公用0/diban_BG.png`）。 */
export const BT_SHARED_BOTTOM_BAR = { root: 'image/gift', name: 'gf_bottom_bar' } as const;

/**
 * 返回按钮 —— 与礼包同一张（`公用0/图片/按钮_btn/btn_FanHui.png`，md5 逐字节相同）。
 * FGUI 战令用的是公用组件 `组件/按钮/按钮_公共_通用.xml`，它的 `icon` 就是这张图。
 */
export const BT_SHARED_BACK = { root: 'image/gift', name: 'gf_btn_back' } as const;

/** 「未解锁」遮罩圆 —— 与七日狂欢同一张（`公用0/散件_img/bb_pic24.png`）。 */
export const BT_SHARED_LOCK_MASK = { root: 'image/sevenDay', name: 'sd_bb24' } as const;

/** 已领取对勾 —— 与七日狂欢同一张（`公用0/散件_img/shaixuan_duigou.png`）。 */
export const BT_SHARED_CHECK = { root: 'image/sevenDay', name: 'sd_check' } as const;

/** 取一张复用图的装配路径。 */
export function btSharedPath(ref: { readonly root: string; readonly name: string }): string {
    return spriteFramePath(ref.root, ref.name);
}

// ============================================================
// 品质框（与七日 / 礼包 / 活动同一套）
// ============================================================

const QUALITY_FRAME_LEVELS = 4;

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
export const BT_QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框名（按框档枚举，恰好 4 张）。 */
export const BT_QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

/** 品质框装配路径。 */
export function qualityFramePath(quality: number): string {
    return spriteFramePath(BT_QUALITY_FRAME_ROOT, qualityFrameName(quality));
}

// ============================================================
// 九宫
// ============================================================

/**
 * 必须在 prefab 里写 `_type = 1` 的战令自有图。
 *
 * 值来自 FGUI `package.xml` 的 `scale9grid="x,y,w,h"`：
 *   `bt_btn_red` `74,27,66,23` / `bt_bar_fill` `20,11,2,3` / **`bt_bar_bg` `18,10,7,3`** /
 *   `bt_line_fill` `6,6,4,6` / `bt_line_bg` `4,6,6,4` / `bt_bg` `0,1278,720,1` /
 *   `bt_panel_bg` `155,164,310,328` / `bt_title_bg` `228,18,272,26` / `bt_qipao` `117,29,126,58`
 *
 * ⚠️ 漏一张的症状是「图照样显示、只是整张被拉伸」，**不报错**：
 *   - `bt_panel_bg` 620→720 / 656→740 拉（边框会跟着变粗）
 *   - `bt_title_bg` 747→720 / 63→67
 *   - `bt_qipao` 331→330 / 119→195（**纵向 1.6 倍**，气泡尾巴明显变形）
 *   - `bt_bar_bg` 40→359（经验条底的两头圆角被拉成椭圆）
 *   - `bt_btn_red` 193 天然宽 ⇒ 只有竖向被拉伸时才看得见
 */
export const BT_ART_SLICED: ReadonlySet<string> = new Set<string>([
    BT_ART_NAMES.btnRed,
    BT_ART_NAMES.barBg,
    BT_ART_NAMES.barFill,
    BT_ART_NAMES.lineFill,
    BT_ART_NAMES.lineBg,
    BT_ART_NAMES.bg,
    BT_ART_NAMES.panelBg,
    BT_ART_NAMES.titleBg,
    BT_ART_NAMES.qipao,
]);

/** `cc.Sprite._type`：`SIMPLE = 0` / `SLICED = 1`；`_sizeMode` 恒为 `CUSTOM = 0`（规则 7）。 */
export const BT_SPRITE_SIMPLE = 0;
export const BT_SPRITE_SLICED = 1;

/** 按资源名给出该用的 `cc.Sprite._type`。 */
export function btSpriteType(artName: string): number {
    return BT_ART_SLICED.has(artName) ? BT_SPRITE_SLICED : BT_SPRITE_SIMPLE;
}

// ============================================================
// 奖励图标（两支分流，唯一入口）
// ============================================================

/**
 * 奖励图标的解析**唯一入口** —— 直接复用活动模块那条（老端 `ModelGoods.GetGoodsIconKeyByRefId` 的两支）：
 *   - `item` 表（`iconIsPath = true`）⇒ 资源路径直通，只认 `icons/` 前缀
 *   - `roleProperty` 表（`iconIsPath = false`）⇒ FGUI 裸名，落 `icons/resource/`
 *
 * ⚠️ 战令的奖励与消耗**几乎全是 `roleProperty` 档**（银币 7 / 体力 9 / 金币 10），
 * 只走 `item` 那一支会让奖励格**只剩品质框、不报错**。
 */
export { resolveRewardIconRef } from '../activity/LayerActivityArt';
export type { IActivityGoodsInfo as IBattleTokenGoodsInfo } from '../activity/LayerActivityTable';
