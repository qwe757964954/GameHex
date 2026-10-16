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
    FRAME_ART_ROOT,
    RESOURCE_ICON_ART_ROOT as ART_RESOURCE_ICON_ROOT,
    spriteFramePath,
} from '../ArtPaths';
import { resolveItemIconPath, resolveItemIconRef } from '../sevenDay/SevenDayArt';
import { resIconRoot } from '../common/ResTypes';
import type { ActivityBoxPhase, IActivityGoodsInfo } from './LayerActivityTable';

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

/** 品质框目录（与七日狂欢 / 礼包共用 `image/frame/`）。 */
export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框名（按框档枚举，恰好 4 张）。 */
export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

/**
 * 道具图标口径 —— **`item` 那一支与七日狂欢完全一致**（资源路径直通 + 只认 `icons/` 前缀）。
 * 转出去是为了让活动模块不直接依赖 sevenDay 目录。
 *
 * ⚠️ 这只是**两支**里的一支，奖励图标请统一走 `resolveRewardIconRef`。
 */
export { resolveItemIconPath, resolveItemIconRef };
export type { ISevenDayIconRef as IActivityIconRef } from '../sevenDay/SevenDayArt';

/**
 * 资源类道具（货币 / 属性，`roleProperty` 表）的图标目录。
 *
 * ⚠️ 值转发 `ArtPaths.RESOURCE_ICON_ART_ROOT`（**唯一真源**）——别在这里写字面量：
 * 同值常量曾经散在 `HangArt` / `GiftArt` 与若干注释里，"改一处漏一处"。
 */
export const RESOURCE_ICON_ART_ROOT = ART_RESOURCE_ICON_ROOT;

/**
 * `roleProperty` 里**不落 `icons/resource/`** 的裸名图标例外表 + 通用图标目录。
 *
 * ⚠️ 定义已搬到 `common/ResTypes.ts`（资源口径**唯一出口**，`resIconRoot()` 同口径），
 * 这里只**转发**保留对外 import 面 —— 别在本文件重新写一份（覆盖表有 B11 防锈用例）。
 */
export {
    COMMON_ICON_ART_ROOT,
    ROLE_PROPERTY_ICON_ROOT_OVERRIDE,
} from '../common/ResTypes';
export { resIconRoot };

/**
 * 一条奖励的展示信息 → 装配用 `{ root, name }`；解析不出返回 `null`（奖励格降级成只画品质框）。
 *
 * ⚠️ **奖励的图标必须走这个函数，不能只走 `resolveItemIconRef`。**
 * 每日任务的奖励里混着两类东西（老端 `ModelGoods.GetGoodsIconKeyByRefId` 也是这么分流的两支）：
 *
 * | 来源 | 举例 | `icon` 存的是 | 怎么解析 |
 * |---|---|---|---|
 * | `item` 表（`iconIsPath = true`） | 图纸 / 升级石 | **相对 `resources` 的路径** `icons/item/xxx` | 直通，且只认 `icons/` 前缀 |
 * | `roleProperty` 表（`iconIsPath = false`） | 银币 7 / 洗炼石 8 / 金币 10 / **活跃度 15** | FGUI 组件名 `图标_活跃度` | 默认 `icons/resource/<name>`，**例外查 `ROLE_PROPERTY_ICON_ROOT_OVERRIDE`** |
 *
 * 只处理 `item` 那一支时的症状：5 条任务 × 2 个奖励 = 10 个格子，其中 8 个**只剩品质框、
 * 没有图标**（每条任务都奖励 40 活跃度，所以几乎每行都缺）—— 静默降级、不报错，只有端到端
 * 探针量「奖励格 icon 有没有加载出来」才逮得到。
 *
 * ⚠️ `roleProperty` 那 4 张图（铜币 / 洗炼石 / 幻灵玉 / 活跃度）原本不在工程里，
 * 是从 zarts `UIIcon/assets/图标/道具/` 拷进来的；`活跃度.png` 进来时按 `icon.json` 的 key
 * 改名成 `图标_活跃度.png`，与另外三张的命名口径对齐。
 */
export function resolveRewardIconRef(info: IActivityGoodsInfo | null): { root: string; name: string } | null {
    if (!info || !info.icon) return null;
    if (info.iconIsPath) return resolveItemIconRef(info.icon);
    return { root: resIconRoot(info.icon), name: info.icon };
}
