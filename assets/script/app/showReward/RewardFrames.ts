import type { IControllerResources } from '../../framework/controller/ControllerBase';
import type { ConfigService } from '../../core/config/ConfigService';
import { bundleForPath } from '../../core/asset/BundleCatalog';
import { spriteFramePathOf } from '../ArtPaths';
import { itemQualityFrameRelPath, loadItemIconArt, loadItemQualityFrame } from '../itemdetail/ItemDetailArtLoader';
import { SpriteFrame } from 'cc';
import { RefUtil } from '../../framework/ref/RefUtil';
import { parseItemRows, parseRolePropertyRows } from '../common/ResTypes';
import type { IResGoodsInfo as IActivityGoodsInfo } from '../common/ResTypes';
import { parseCmdGoodsList, rewardEntryOf, sortRewardEntries } from '../common/RewardEntries';
import type { IShowRewardEntry as IRewardEntry } from '../common/RewardEntries';
import { GEM_QUALITY_TABLE, GEM_TABLE, parseGemQualityRows, parseGemRows } from '../common/GemReward';
import type { IGemTables } from '../common/GemReward';

import { ROLE_PROPERTY_TABLE, ITEM_TABLE } from '../../core/config/TableNames';
/**
 * `CmdGoods` → **可直接渲染的帧**（品质框 + 图标）。
 *
 * 这套换算原本只长在 `ShowRewardPage` 里（「获得奖励」弹窗是第一个宿主）；对局结算页是第二个，
 * 所以把三步（查 `item`/`roleProperty` 两张表 → `rewardEntryOf` → 两张图）独立到这里，**两边共用一份**。
 *
 * ⚠️ 帧必须**先 await 完再铺**：奖励格是池化复用的，`render` 是同步的、现加载会先闪上一格的图。
 */

/** 一格的两张图。 */
export interface IRewardFrames {
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
}

/** 奖励换算要用的三组表（`item` 道具 + `roleProperty` 货币 + `gem`/`gemQuality` 宝石）。 */
export interface IRewardGoodsTables {
    readonly items: Map<number, IActivityGoodsInfo>;
    readonly resources: Map<number, IActivityGoodsInfo>;
    readonly gems: IGemTables;
}

/**
 * 拉并解析 `item` / `roleProperty` / `gem` / `gemQuality`。
 *
 * ⚠️ 两张道具表都要读：漏掉 `roleProperty` 那一支，货币格只剩品质框、没有图标（静默降级）。
 * ⚠️ 宝石走 `gem`（部位 resId）+ `gemQuality`（品质图标）：服务端发的 `resId` 是宝石实例 id，
 *   两张道具表里都查不到，不接宝石分支就是「品质 1 灰框 + 没有图标」。
 */
export async function loadRewardGoodsTables(configs?: ConfigService): Promise<IRewardGoodsTables> {
    const [itemRows, resourceRows, gemRows, gemQualityRows] = await Promise.all([
        configs ? configs.getTable(ITEM_TABLE) : RefUtil.instance.getRefAllAsync(ITEM_TABLE),
        configs ? configs.getTable(ROLE_PROPERTY_TABLE) : RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE),
        configs ? configs.getTable(GEM_TABLE) : RefUtil.instance.getRefAllAsync(GEM_TABLE),
        configs ? configs.getTable(GEM_QUALITY_TABLE) : RefUtil.instance.getRefAllAsync(GEM_QUALITY_TABLE),
    ]);
    return {
        items: parseItemRows(itemRows ?? []),
        resources: parseRolePropertyRows(resourceRows ?? []),
        gems: {
            gems: parseGemRows(gemRows ?? []),
            qualities: parseGemQualityRows(gemQualityRows ?? []),
        },
    };
}

/** 使用调用方控制器持有资源；失败保留原有占位图语义。 */
async function loadControllerRewardFrame(resources: IControllerResources, path: string): Promise<SpriteFrame | null> {
    try {
        return await resources.assets.load(spriteFramePathOf(path), SpriteFrame, { bundle: bundleForPath(path) });
    } catch (error) {
        if (!resources.scope.disposed) console.warn(`[RewardFrames] 奖励图加载失败：${path}`, error);
        return null;
    }
}

/** 一条奖励 → 两张图（品质框按 `quality` 换档，图标可能没有）。 */
export async function loadRewardFramesOf(entry: IRewardEntry, resources?: IControllerResources): Promise<IRewardFrames> {
    const qualityFrameRel = itemQualityFrameRelPath(entry.quality);
    const [qualityFrame, iconFrame] = await Promise.all([
        resources ? loadControllerRewardFrame(resources, qualityFrameRel) : loadItemQualityFrame(entry.quality),
        entry.iconPath ? (resources ? loadControllerRewardFrame(resources, entry.iconPath) : loadItemIconArt(entry.iconPath)) : Promise.resolve(null),
    ]);
    return { qualityFrame, iconFrame };
}

/** 一串条目 → **同序**的图（`Promise.all` 保序）。 */
export function loadRewardFrames(entries: readonly IRewardEntry[], resources?: IControllerResources): Promise<IRewardFrames[]> {
    return Promise.all(entries.map((entry) => loadRewardFramesOf(entry, resources)));
}

/**
 * **一站式**：原始 `CmdGoods[]` → 条目 + 已加载好的图。给「奖励格」宿主直接铺用。
 *
 * 排序走 `sortRewardEntries`（老端口径：品质降序、同品质按 resId 升序），
 * **在加载图之前排**，`entries` 与 `frames` 才会同序（与 `ShowRewardPage` 同款）。
 */
export async function resolveCmdGoodsFrames(
    raw: unknown,
    resources?: IControllerResources,
): Promise<{ entry: IRewardEntry; frames: IRewardFrames }[]> {
    const goods = parseCmdGoodsList(raw);
    if (!goods.length) return [];
    const tables = await loadRewardGoodsTables(resources?.configs);
    const entries = sortRewardEntries(goods.map((one) => rewardEntryOf(one, tables.items, tables.resources, tables.gems)));
    const frames = await loadRewardFrames(entries, resources);
    return entries.map((entry, index) => ({ entry, frames: frames[index] }));
}
