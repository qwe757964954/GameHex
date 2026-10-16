/**
 * 「邮件」的美术口径 —— **资源路径的唯一来源**。
 *
 * ## 目录
 *
 * 本模块自有的 6 张（`tmp/_copy_mail_art.py` 从老端 FGUI `公用0/图片` + `邮件/图片` 拷来）：
 *
 * ```
 * resources/image/mail/ml_row_bg_read.png   行底·已读/已领取（frame_Zhikuang06_b，九宫 12,12,292,119）
 * resources/image/mail/ml_split_line.png    详情分割线（公用_九宫_分割线01，九宫 46,0,16,14）
 * resources/image/mail/ml_content_box.png   详情奖励底框（公用_九宫_内容底框01，九宫 14,13,5,5）
 * resources/image/mail/ml_mail_deco.png     行内信纸装饰（texture_long_pic02，193×183）
 * resources/image/mail/ml_taken_stamp.png   「已领取」印章（公用_图标_已领取，119×74）
 * resources/image/mail/ml_mail_icon.png     信封图标（战斗选关_按钮_邮件，100×72）
 * ```
 *
 * ## 与「好友」模块共用公共图（**不另存第二份**）
 *
 * 弹窗底板 / 标题飘带 / 行底（未读）/ 两个按钮底 / 关闭钮，与 friend 模块**同源同 md5**
 * （都来自 FGUI `公用0` 包）⇒ 直接引用 friend / login 目录那一份。
 * `tmp/_copy_mail_art.py` 会逐张校验 **md5 + 九宫边框**，不一致就报错
 * （防止「别人改了那份图 / friend 那轮被回滚」导致邮件九宫静默变形）。
 *
 * ## 奖励图标：**不许自己造一套**
 *
 * 奖励里混着两类东西（`item` 表路径直通 + `roleProperty` 表的货币类）——
 * 「跑只查 `item` 表」的坑已经在活动模块栽过一次（10 个格子 8 个只剩品质框、不报错）。
 * 所以这里**直接复用**活动模块的统一入口，不复制实现。
 */

import { ART_ROOT, spriteFramePath } from '../ArtPaths';
import {
    QUALITY_FRAME_ROOT,
    qualityFrameLevel,
    qualityFrameName,
    RESOURCE_ICON_ART_ROOT,
    resolveRewardIconRef,
} from '../activity/LayerActivityArt';
import { rewardGoodsOf } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
import { MAIL_STATE_READ, MAIL_STATE_TAKEN, MAIL_STATE_UNREAD } from './MailTable';

/** 本模块自有美术的目录（不含 `resources/` 前缀；`loadArt(name, root)` 用）。 */
export const MAIL_ART_ROOT = `${ART_ROOT}/mail`;

/** 复用公共图的两个目录（FGUI `公用0` 包 → friend / login 两处）。 */
export const MAIL_ART_ROOT_FRIEND = `${ART_ROOT}/friend`;
export const MAIL_ART_ROOT_LOGIN = `${ART_ROOT}/login`;

/** 行底图的两个资源名（`MailPage.loadRowArt` 直接喂给 `loadArt`）。 */
export const MAIL_ROW_BG_UNREAD_NAME = 'fd_row_bg';
export const MAIL_ROW_BG_READ_NAME = 'ml_row_bg_read';

/** 逻辑名 → 资源名（无扩展名）。 */
export const MAIL_ART_NAMES: Readonly<Record<string, string>> = {
    /** 行底·已读 / 已领取（**九宫**）。 */
    rowBgRead: 'ml_row_bg_read',
    /** 详情页分割线（**九宫**）。 */
    splitLine: 'ml_split_line',
    /** 详情页奖励底框（**九宫**）。 */
    contentBox: 'ml_content_box',
    /** 行内信纸装饰（非九宫，整图缩放）。 */
    mailDeco: 'ml_mail_deco',
    /** 「已领取」印章。 */
    takenStamp: 'ml_taken_stamp',
    /** 信封图标。 */
    mailIcon: 'ml_mail_icon',
};

/** 逻辑名 → `resources` 下的**装配路径**（`spriteFramePath` 的入参口径，带 `/spriteFrame`）。 */
export function mailArtPath(key: string): string | null {
    const name = MAIL_ART_NAMES[key];
    return name ? spriteFramePath(MAIL_ART_ROOT, name) : null;
}

// ============================================================
// 与好友 / 登录模块共用的公共图
// ============================================================

/**
 * 弹窗底板 / 标题飘带 / 行底（未读）/ 两个按钮底 / 关闭钮，与 friend 模块**同源同 md5**
 * （都来自 FGUI `公用0` 包）⇒ 直接引用 friend / login 目录那一份，**不另存第二份**。
 * `tmp/_copy_mail_art.py` 会逐张校验 **md5 + 九宫边框**，不一致就报错
 * （防止「别人改了那份图 / friend 那轮被回滚」导致邮件九宫静默变形）。
 *
 * ⚠️ 一律是 `{ root, name }`（`loadArt(name, root)` 口径），**不是**裸路径 ——
 *    `resources` 的索引里只登记 `<path>/spriteFrame`，裸路径 load 不到（记忆规则 57）。
 */
export const MAIL_SHARED_PANEL_BG = { root: `${ART_ROOT}/friend`, name: 'fd_panel_bg' } as const;
export const MAIL_SHARED_TITLE_BG = { root: `${ART_ROOT}/friend`, name: 'fd_title_bg' } as const;
export const MAIL_SHARED_ROW_BG_UNREAD = { root: `${ART_ROOT}/friend`, name: MAIL_ROW_BG_UNREAD_NAME } as const;
export const MAIL_SHARED_BTN_GOLD = { root: `${ART_ROOT}/friend`, name: 'fd_btn_gold' } as const;
export const MAIL_SHARED_BTN_DARK = { root: `${ART_ROOT}/friend`, name: 'fd_btn_dark' } as const;
export const MAIL_SHARED_CLOSE = { root: `${ART_ROOT}/login`, name: '公用_按钮_关闭01' } as const;

/** 行底·已读 / 已领取（本模块自有图，`_b` 版）。 */
export const MAIL_ROW_BG_READ = { root: `${ART_ROOT}/mail`, name: MAIL_ROW_BG_READ_NAME } as const;

/**
 * 需要拉伸的图 —— 这些图对应的 `cc.Sprite._type` 必须是 **1(SLICED)**，
 * 且 `.png.meta` 的 `borderTop/Bottom/Left/Right` 已按 FGUI `scale9grid` 配好。
 * 漏写 `_type=1` **不报错**，只是整张被拉伸。
 */
export const MAIL_ART_SLICED: readonly { readonly root: string; readonly name: string }[] = [
    MAIL_ROW_BG_READ,
    { root: `${ART_ROOT}/mail`, name: MAIL_ART_NAMES.splitLine },
    { root: `${ART_ROOT}/mail`, name: MAIL_ART_NAMES.contentBox },
    MAIL_SHARED_PANEL_BG,
    MAIL_SHARED_ROW_BG_UNREAD,
    MAIL_SHARED_BTN_GOLD,
    MAIL_SHARED_BTN_DARK,
];

/**
 * 行底图（`state` → 哪一张）：未读 = 复用好友那张 `fd_row_bg`；已读 / 已领取 = 本模块 `_b` 版。
 *
 * 返回 `{ root, name }` 直接喂 `loadArt`（宿主 `MailPage.loadRowArt` 预加载后交给 `MailRow.render`）。
 * ⚠️ 两个分支**必须是同一种形状** —— 早期一个返路径、一个返资源名，静默拼出两张不同的图。
 */
export function mailRowArt(state: number): { root: string; name: string } {
    return state === MAIL_STATE_UNREAD ? MAIL_SHARED_ROW_BG_UNREAD : MAIL_ROW_BG_READ;
}

/** 行状态文本的显隐：只有「已读」显示文本（「已领取」由印章表达 —— FGUI 的 gearDisplay）。 */
export function mailStateTextVisible(state: number): boolean {
    return state === MAIL_STATE_READ;
}

/** 印章的显隐：只有「已领取」。 */
export function mailStampVisible(state: number): boolean {
    return state === MAIL_STATE_TAKEN;
}

// ============================================================
// 奖励格：品质框 + 道具图标（统一入口，别自己再造一套）
// ============================================================

/** 品质框目录（与活动 / 七日 / 礼包共用 `image/frame/`）。 */
export const MAIL_QUALITY_FRAME_ROOT = QUALITY_FRAME_ROOT;

/** 品质框名（4 档）。 */
export { qualityFrameLevel, qualityFrameName };

/** 资源类道具（货币 / 属性）的图标目录。 */
export const MAIL_RESOURCE_ICON_ART_ROOT = RESOURCE_ICON_ART_ROOT;

/**
 * 一条奖励 → 图标 `{ root, name }`（解析不出返回 `null` ⇒ 奖励格只剩品质框）。
 *
 * ⚠️ `rewardGoodsOf` 需要 `item` / `roleProperty` 两张表建好的索引 Map（由 Repository 提供）。
 */
export function mailRewardIconRef(
    resId: number,
    items: ReadonlyMap<number, IActivityGoodsInfo>,
    resources: ReadonlyMap<number, IActivityGoodsInfo>,
): { root: string; name: string } | null {
    return resolveRewardIconRef(rewardGoodsOf(resId, items, resources));
}

export type { IActivityGoodsInfo };
