/**
 * 「联盟」P4 三面板的**奖励图标预加载器** —— 品质框 + 道具图标，一次性取好，之后同步取用。
 *
 * ## 为什么必须预加载
 *
 * 三个面板的奖励格都落在**虚拟列表的行**里（商店行 / 砍价行）或**会被复用**的节点上。
 * 如果让行脚本在 `render()` 里现加载，会出现两类问题（两条都在本工程实测过）：
 *
 * 1. **残影**：`VScrollView` 复用槽位时，上一行的图还没被新图覆盖，就会先闪一帧旧图；
 * 2. **错图**：异步回来的图属于已经滚过去的行（同 `LeagueApplyRow` 的头像令牌问题）。
 *
 * ⇒ 口径与 `MainEntranceList`（「先取完图标再刷列表」）、`LayerActivityPage.loadIconFrames`
 *    一致：**宿主**先把本趟要用到的帧全取进内存，行只做同步的 `spriteFrame = frame`。
 *
 * ## 两支分流（`item` 直通 / `roleProperty` 落 `icons/resource`）
 *
 * 图标解析走 `LeagueArt.leagueRewardIconRef`（→ 全工程唯一入口
 * `LayerActivityArt.resolveRewardIconRef`）。联盟 P4 的奖励里**两支都有**：
 *
 * | 来源 | 举例 |
 * |---|---|
 * | `item`（`iconIsPath = true`，路径直通） | 武库石板 `icons/common/图标_武库石板`、银钥匙 `icons/item/图标_银钥匙` |
 * | `roleProperty`（`iconIsPath = false`，FGUI 裸名） | 联盟银币 `图标_联盟银币`、金币 `图标_幻灵玉`、联盟贡献 `图标_联盟贡献` |
 *
 * ⚠️ 只走 `item` 一支的症状：所有「货币类」奖励格**只剩品质框、没有图标**，而且**不报错**。
 *    商店的「购买」按钮货币小图标（`priceType = 11` 联盟银币）也是这一支，
 *    它只在 `roleProperty` 表里 ⇒ 少查一张表就是「按钮上光秃秃只剩数字」。
 *
 * ## 品质框
 *
 * FGUI 的「物品框」是个 `ItemBehavior2` 动态撑起来的空盒子（见 `LeagueRewardSlot` 的说明），
 * 品质框那 8 张图的引用 id 换成了本工程已迁移的 `image/frame/common_img_pzk_0N`
 * （4 档，`LayerActivityArt.QUALITY_FRAME_NAMES`）—— 与活动 / 七日 / 礼包**同一套**。
 */

import type { SpriteFrame } from 'cc';
import { loadArt } from '../card/CardLineupIcons';
import { leagueRewardIconRef } from './LeagueArt';
import type { ILeagueGoodsInfo } from './LeagueArt';
import {
    qualityFrameLevel,
    QUALITY_FRAME_NAMES,
    QUALITY_FRAME_ROOT,
} from '../activity/LayerActivityArt';

/** 「品质档(1..4) → 品质框帧」。 */
type QualityFrameMap = ReadonlyMap<number, SpriteFrame | null>;

/** 一次预加载的结果句柄；所有取值方法都是**同步**的。 */
export interface ILeagueRewardArt {
    /** 某个 `resId` 的图标帧（`null` = 没解析出 / 没加载上 ⇒ 格子里隐藏图标）。 */
    iconFrameOf(resId: number): SpriteFrame | null;
    /** 某个 `resId` 的品质框帧（按 `item`/`roleProperty` 表的 `quality` 挑；查不到按 1 档）。 */
    qualityFrameOf(resId: number): SpriteFrame | null;
    /** `{ frame, icon }` 一站式（写行 / 页时少两行）。 */
    framesOf(resId: number): { frame: SpriteFrame | null; icon: SpriteFrame | null };
}

/**
 * 预加载一批 `resId` 的图标 + 4 张品质框。
 *
 * @param resIds    本趟界面上会出现**全部**奖励 id（含按钮上的货币 id）
 * @param items     `item` 表索引（`ILeagueRepository` 的快照里给）
 * @param resources `roleProperty` 表索引
 *
 * 单张失败**不 reject**（`loadArt` 解不出就返回 `null`），只是那一格没图标 ——
 * 比整页刷不出来好。所以这里不 try/catch，`Promise.all` 里的每个任务都已经自带降级。
 */
export async function loadLeagueRewardArt(
    resIds: Iterable<number>,
    items: ReadonlyMap<number, ILeagueGoodsInfo>,
    resources: ReadonlyMap<number, ILeagueGoodsInfo>,
): Promise<ILeagueRewardArt> {
    // ---- 品质框：4 张，固定要（谁都用）----
    const qualities = new Map<number, SpriteFrame | null>();
    await Promise.all(QUALITY_FRAME_NAMES.map(async (name, index) => {
        const frame = await loadArt(name, QUALITY_FRAME_ROOT);
        qualities.set(index + 1, frame);
    }));

    // ---- 图标：按 resId 去重取 ----
    const icons = new Map<number, SpriteFrame | null>();
    const wanted = new Map<number, { root: string; name: string }>();
    for (const resId of resIds) {
        if (!Number.isFinite(resId) || resId <= 0 || wanted.has(resId)) continue;
        const ref = leagueRewardIconRef(resId, items, resources);
        if (ref) wanted.set(resId, ref);
    }
    await Promise.all(Array.from(wanted.entries()).map(async ([resId, ref]) => {
        const frame = await loadArt(ref.name, ref.root);
        icons.set(resId, frame);
    }));

    const qualityLevels = new Map<number, number>();
    for (const resId of wanted.keys()) {
        const info = items.get(resId) ?? resources.get(resId) ?? null;
        qualityLevels.set(resId, info ? info.quality : 0);
    }

    const qualityFrameOf = (resId: number): SpriteFrame | null => {
        const level = qualityLevelOf(resId, qualityLevels);
        return qualities.get(level) ?? null;
    };

    return {
        iconFrameOf: (resId) => icons.get(resId) ?? null,
        qualityFrameOf,
        framesOf: (resId) => ({ frame: qualityFrameOf(resId), icon: icons.get(resId) ?? null }),
    };
}

/**
 * `resId` → 品质框档（1..4）。
 *
 * 直接用 `LayerActivityArt.qualityFrameLevel`（`quality − 1` 后钳到 1..4，最低档兜 1）
 * —— 本工程的品质框名就是 `common_img_pzk_0{level}`，档位算法只此一份。
 * 表里查不到这个 `resId` 时按 1 档（与 `resolveRewardIconRef` 的「解析不出降级」同口径）。
 */
function qualityLevelOf(resId: number, levels: ReadonlyMap<number, number>): number {
    const quality = levels.get(resId);
    if (quality === undefined) return 1;
    return qualityFrameLevel(quality);
}

/** 「该 `resId` 有没有图」—— 供探针 / 单测快速判空（不加载）。 */
export const LEAGUE_QUALITY_FRAME_COUNT = QUALITY_FRAME_NAMES.length;
