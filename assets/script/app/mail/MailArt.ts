/**
 * 邮件模块的资源路径唯一来源。
 * v2 底板 / 未读行卡 / 按钮改用 main 图集与邮件自有切图；不再跨模块复用 friend 图。
 * 奖励图标复用活动模块的统一解析；九宫格图必须按 SLICED 使用。
 */

import { ART_ROOT, spriteFramePath } from '../ArtPaths';
import {
    QUALITY_FRAME_ROOT,
    qualityFrameLevel,
    qualityFrameName,
} from '../common/QualityFrameArt';
import { resolveRewardIconRef } from '../common/RewardIcon';
import { rewardGoodsOf } from '../common/ResTypes';
import type { IResGoodsInfo as IActivityGoodsInfo } from '../common/ResTypes';
import { MAIL_STATE_READ, MAIL_STATE_TAKEN, MAIL_STATE_UNREAD } from './MailTable';

/** 本模块自有美术的目录（不含 `resources/` 前缀；`loadArt(name, root)` 用）。 */
export const MAIL_ART_ROOT = `${ART_ROOT}/mail`;

/** 行底图的两个资源名（`MailPage.loadRowArt` 直接喂给 `loadArt`）。 */
export const MAIL_ROW_BG_UNREAD_NAME = 'ml_row_v2';
export const MAIL_ROW_BG_READ_NAME = 'ml_row_v2_read';

/** 逻辑名 → 资源名（无扩展名）。 */
export const MAIL_ART_NAMES: Readonly<Record<string, string>> = {
    /** 行底·已读 / 已领取（**九宫**）。 */
    rowBgRead: 'ml_row_v2_read',
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

// 行底（未读）复用本模块自有图。

const MAIL_SHARED_ROW_BG_UNREAD = { root: `${ART_ROOT}/mail`, name: MAIL_ROW_BG_UNREAD_NAME } as const;

/** 行底·已读 / 已领取（本模块自有图，`_b` 版）。 */
const MAIL_ROW_BG_READ = { root: `${ART_ROOT}/mail`, name: MAIL_ROW_BG_READ_NAME } as const;

/**
 * 行底图（`state` → 哪一张）：未读 = 复用好友那张 `fd_row_bg`；已读 / 已领取 = 本模块 `_b` 版。
 *
 * 返回 `{ root, name }` 直接喂 `loadArt`（宿主 `MailPage.loadRowArt` 预加载后交给 `MailRow.render`）。
 * 两个分支**必须是同一种形状** —— 早期一个返路径、一个返资源名，静默拼出两张不同的图。
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

// 奖励格：品质框 + 道具图标（统一入口，别自己再造一套）

/** 品质框目录（与活动 / 七日 / 礼包共用 `image/frame/`）。 */
export const MAIL_QUALITY_FRAME_ROOT = QUALITY_FRAME_ROOT;

/** 品质框名（4 档）。 */
export { qualityFrameLevel, qualityFrameName };

/**
 * 一条奖励 → 图标 `{ root, name }`（解析不出返回 `null` ⇒ 奖励格只剩品质框）。
 *
 * `rewardGoodsOf` 需要 `item` / `roleProperty` 两张表建好的索引 Map（由 Repository 提供）。
 */
export function mailRewardIconRef(
    resId: number,
    items: ReadonlyMap<number, IActivityGoodsInfo>,
    resources: ReadonlyMap<number, IActivityGoodsInfo>,
): { root: string; name: string } | null {
    return resolveRewardIconRef(rewardGoodsOf(resId, items, resources));
}

export type { IActivityGoodsInfo };
