import { SpriteFrame } from 'cc';
import { RefUtil } from '../../framework/ref/RefUtil';
import { loadItemIconArt, loadQualityFrameArt } from '../itemdetail/ItemDetailArtLoader';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
import { parseCmdGoodsList, rewardEntryOf, sortRewardEntries } from './ShowRewardTable';
import type { IRewardEntry } from './ShowRewardTable';

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

/** 奖励换算要用的两张表（`item` 道具 + `roleProperty` 货币）。 */
export interface IRewardGoodsTables {
    readonly items: Map<number, IActivityGoodsInfo>;
    readonly resources: Map<number, IActivityGoodsInfo>;
}

/**
 * 拉并解析 `item` / `roleProperty` 两张表。
 *
 * ⚠️ 两张表都要读：漏掉 `roleProperty` 那一支，货币格只剩品质框、没有图标（静默降级）。
 */
export async function loadRewardGoodsTables(): Promise<IRewardGoodsTables> {
    const [itemRows, resourceRows] = await Promise.all([
        RefUtil.instance.getRefAllAsync('item'),
        RefUtil.instance.getRefAllAsync('roleProperty'),
    ]);
    return {
        items: parseItemRows(itemRows ?? []),
        resources: parseRolePropertyRows(resourceRows ?? []),
    };
}

/** 一条奖励 → 两张图（品质框按 `quality` 换档，图标可能没有）。 */
export async function loadRewardFramesOf(entry: IRewardEntry): Promise<IRewardFrames> {
    const [qualityFrame, iconFrame] = await Promise.all([
        loadQualityFrameArt(qualityFrameSuffixOf(entry.quality)),
        entry.iconPath ? loadItemIconArt(entry.iconPath) : Promise.resolve(null),
    ]);
    return { qualityFrame, iconFrame };
}

/** 一串条目 → **同序**的图（`Promise.all` 保序）。 */
export function loadRewardFrames(entries: readonly IRewardEntry[]): Promise<IRewardFrames[]> {
    return Promise.all(entries.map((entry) => loadRewardFramesOf(entry)));
}

/**
 * **一站式**：原始 `CmdGoods[]` → 条目 + 已加载好的图。给「奖励格」宿主直接铺用。
 *
 * 排序走 `sortRewardEntries`（老端口径：品质降序、同品质按 resId 升序），
 * **在加载图之前排**，`entries` 与 `frames` 才会同序（与 `ShowRewardPage` 同款）。
 */
export async function resolveCmdGoodsFrames(
    raw: unknown,
): Promise<{ entry: IRewardEntry; frames: IRewardFrames }[]> {
    const goods = parseCmdGoodsList(raw);
    if (!goods.length) return [];
    const tables = await loadRewardGoodsTables();
    const entries = sortRewardEntries(goods.map((one) => rewardEntryOf(one, tables.items, tables.resources)));
    const frames = await loadRewardFrames(entries);
    return entries.map((entry, index) => ({ entry, frames: frames[index] }));
}
