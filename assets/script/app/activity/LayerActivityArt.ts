/**
 * 活动（每日任务）美术口径。
 *
 * 图都落在 `assets/resources/image/activity/`（20 张，从 zarts FGUI 的
 * `活动/图片` + `公用0/图片` 里挑出来，命名口径与 `image/sevenDay` 的 `sd_*`、
 * `image/gift` 的 `gf_*` 一致 —— 去中文 + `act_` 前缀）。
 *
 * ## 三条**原图 ≠ FGUI 显示尺寸**，别按原图比例推常量
 *   | 图 | 原图 | FGUI 显示 |
 *   |---|---|---|
 *   | `act_panel_bg`（`frame_Dikuang04`） | 318×257 | **720×1020**（九宫 40,97,245,100） |
 *   | `act_row_bg`（`frame_Zhikuang01`）   | 155×113 | **658×175**（九宫 38,28,76,56） |
 *   | `act_bar_fill/bg`（九宫进度条02）      | 40×24   | **110×24**（九宫 20,11,2,3 / 19,12,3,2） |
 *   | `act_btn_red/green/gray`（TY_btn2x） | 218×69  | **132×63**（九宫 54,17,108,34） |
 * 所以 Sprite 一律 `sizeMode = CUSTOM(0)`、`trim = false`，节点尺寸写死在 prefab 上；
 * 九宫参数已经由 `tmp/_activity_art_rename.py` 写进各自 `.meta` 的 SpriteFrame 边框。
 *
 * ⚠️ 标题横幅 `title_02` **没有**拷进本目录，直接用 `image/common/title_02.png`
 * （工程里已存在，别再拷一份 —— 同内容两份资源在 Cocos 里就是两个 uuid，
 * 后面谁改了哪份说不清）。
 *
 * ⚠️ 美术目录里**没有自动图集**：`image/{sevenDay,firstRecharge,gift,matching}` 都没有
 * `.pac`，`activity` 同样不放 —— 图集是可选优化，混着来只会让「某张图有没有进图集」
 * 变成不可预测的运行时状态。这条与规则 57（图标加载失败跟图集无关）是同一件事的两面。
 */

import {
    COMMON_ART_ROOT,
    RESOURCE_ICON_ART_ROOT as ART_RESOURCE_ICON_ROOT,
    spriteFramePath,
} from '../ArtPaths';
import type { ActivityBoxPhase } from './LayerActivityTable';

/** 活动美术目录（相对 `resources` 的路径）。 */
export const ACTIVITY_ART_ROOT = 'image/activity';

/** 标题横幅所在目录（复用工工程既有的 `image/common/title_02.png`）。 */
export const ACTIVITY_TITLE_ART_ROOT = COMMON_ART_ROOT;

/** 活动要用的全部图（`key` → 文件名，不含扩展名）。 */
export const ACTIVITY_ART_NAMES: Readonly<Record<string, string>> = {
    /** 主底板 720×1020（九宫）。 */
    panelBg: 'act_panel_bg',
    /** 顶部装饰底 673×239（森林景，压在页签/周活跃区后面）。 */
    topBg: 'act_top_bg',
    /** 任务行底框 658×175（九宫）。 */
    rowBg: 'act_row_bg',
    /** 行标题飘带 420×105 → 显示 420×73.5（FGUI `scale="1,0.7"`）。 */
    rowRibbon: 'act_row_ribbon',
    /** 「已领取」印章。 */
    takenStamp: 'act_taken_stamp',
    /** 普通红点 29×28。 */
    redDot: 'act_red_dot',
    /** 大号红点 30×30（FGUI 红点组件的「新红点」样式）。 */
    redDotBig: 'act_red_dot_02',
    /** 按钮底：红（`TY_btn27`，FGUI 多颜色按钮 `颜色=4`）。 */
    btnRed: 'act_btn_red',
    /** 按钮底：绿（`TY_btn28`，`颜色=1`，领取态）。 */
    btnGreen: 'act_btn_green',
    /** 按钮底：灰（`TY_btn29`，`颜色=0`，不可点态）。 */
    btnGray: 'act_btn_gray',
    /** 按钮底：蓝（`ZB_btn02`，`颜色=3`，「前往」态）。 */
    btnBlue: 'act_btn_blue',
    /** 周活跃徽章 83×94。 */
    medal: 'act_medal',
    /** 「周活跃」字底 79×36（九宫）。 */
    weekTag: 'act_week_tag',
    /** 进度条填充（九宫）。 */
    barFill: 'act_bar_fill',
    /** 进度条底（九宫）。 */
    barBg: 'act_bar_bg',
    /** 宝箱：已领取（FGUI `by0`）。 */
    boxTaken: 'act_box_taken',
    /** 宝箱：可领取（`by1`）。 */
    boxClaimable: 'act_box_claimable',
    /** 宝箱：不可领取（`by2`）。 */
    boxLocked: 'act_box_locked',
    /** 宝箱上的对勾（`tag_gou`，FGUI 里 `scale="0.5,0.5"`）。 */
    boxCheck: 'act_box_check',
    /** 右上角关闭按钮 60×60。 */
    btnClose: 'act_btn_close',
};

/** 标题横幅（`image/common/title_02.png`，461×119）。 */
export const ACTIVITY_TITLE_ART = 'title_02';

/** 取一张活动美术图的装配路径；`key` 未知时返回 `null`。 */
export function activityArtPath(key: string): string | null {
    const name = ACTIVITY_ART_NAMES[key];
    if (!name) return null;
    return spriteFramePath(ACTIVITY_ART_ROOT, name);
}

/** 标题横幅的装配路径。 */
export function activityTitlePath(): string {
    return spriteFramePath(ACTIVITY_TITLE_ART_ROOT, ACTIVITY_TITLE_ART);
}

/** 宝箱三态 → 图 key。 */
export function boxArtKey(phase: ActivityBoxPhase): string {
    if (phase === 'taken') return 'boxTaken';
    return phase === 'claimable' ? 'boxClaimable' : 'boxLocked';
}

/** 按钮配色 → 图 key（FGUI 多颜色二级按钮的四档）。 */
export function buttonArtKey(tone: 'green' | 'blue' | 'red' | 'gray'): string {
    if (tone === 'green') return 'btnGreen';
    if (tone === 'blue') return 'btnBlue';
    return tone === 'red' ? 'btnRed' : 'btnGray';
}

// ============================================================
// 奖励格：品质框 + 道具图标
// ============================================================

/** 品质框统一在 `common/QualityFrameArt`，这里只转发，不重算。 */
export {
    QUALITY_FRAME_ROOT,
    QUALITY_FRAME_NAMES,
    qualityFrameLevel,
    qualityFrameName,
} from '../common/QualityFrameArt';

/** 奖励图标实现已归位到 `common/RewardIcon`；这里保留旧路径，调用方可继续 import activity。 */
export {
    resolveItemIconPath,
    resolveItemIconRef,
    resolveRewardIconRef,
} from '../common/RewardIcon';
export type { IItemIconRef as IActivityIconRef } from '../common/RewardIcon';

/**
 * 资源类道具（货币 / 属性，`roleProperty` 表）的图标目录。
 *
 * ⚠️ 值转发 `ArtPaths.RESOURCE_ICON_ART_ROOT`（**唯一真源**）——别在这里写字面量。
 */
export const RESOURCE_ICON_ART_ROOT = ART_RESOURCE_ICON_ROOT;

/**
 * `roleProperty` 里**不落 `icons/resource/`** 的裸名图标例外表 + 通用图标目录。
 * 定义在 `common/ResTypes.ts`（资源口径唯一出口），这里只转发保留对外 import 面。
 */
export {
    COMMON_ICON_ART_ROOT,
    ROLE_PROPERTY_ICON_ROOT_OVERRIDE,
    resIconRoot,
} from '../common/ResTypes';
