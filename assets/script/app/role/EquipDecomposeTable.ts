/**
 * 装备分解的纯规则（零 `cc` 依赖，可直接 import 单测）。
 *
 * 口径来自老端：
 *   · `client/.../ctrl/main/role/Equip/LayerRoleEquipBreak.ts` —— 列表只取背包装备、
 *     筛选「N 阶及以下 / 品质及以下」、一次最多 99 件；
 *   · `client/.../model/vo/Goods/VOEquipItem.ts` —— 单件返还 = 基础品阶行
 *     `equipRank[rank, baseQuality].decompose` + `floor(CmdEquipItem.costNum * gainPer / 100)`，
 *     `gainPer` 取 `gameConfig.equipDecomposeGainPer`（当前 70）。
 *
 * 本文件只做纯计算 / 纯筛选，不读缓存、不碰配置表；收益字段由 `RoleRepository.readEquipBag()`
 * 装配到 `IRoleBagEntry.decompose`，分解请求也由仓库统一发。
 */

/** 一次最多分解的装备件数（老端 `EQUIP_BREAK_MAX_99`：一次最多分解 99 件装备）。 */
export const EQUIP_DECOMPOSE_MAX = 99;

/** 展示品质档上限（`equipResonance.quality` / `gameConfig.qualityname` 1..7 普通…神话）。 */
export const EQUIP_DECOMPOSE_QUALITY_MAX = 7;

/** `equipDecomposeGainPer` 缺行时的兜底（与当前配置一致；只用于防止 0 收益）。 */
export const EQUIP_DECOMPOSE_DEFAULT_GAIN_PER = 70;

/** 一条可分解装备的纯事实（`RoleRepository` 由 `IRoleBagEntry` 投影）。 */
export interface IEquipDecomposeFacts {
    /** 装备唯一 id（十进制字符串，避免 Long 精度）。 */
    readonly uniqueId: string;
    /** 品阶 `CmdEquipItem.rank`（1..20）。 */
    readonly rank: number;
    /** 展示品质 1..7（`equipRank.quality`；不是 `curQuality` 的品质档 1..17）。 */
    readonly quality: number;
    /** 单件分解返还的精炼石数量。 */
    readonly decompose: number;
    /** 已穿戴 / 镶嵌中的装备不可分解。 */
    readonly equipped: boolean;
}

/**
 * 分解筛选条件（-1 = 该项不筛）。
 * 老端未选择时不过滤；本端补「全部」行用于回到不筛状态（产品确认）。
 */
export interface IEquipDecomposeFilter {
    readonly rank: number;
    readonly quality: number;
}

/**
 * 单件分解收益：`equipRank.decompose` + `floor(costNum * gainPer / 100)`。
 *
 * 只接受非负整数；`costNum` 是养成投入的累计材料数（强化 / 升品都会加），
 * 所以同品阶装备的返还仍随投入不同，不能只看品阶。
 */
export function equipDecomposeGain(
    rankDecompose: number,
    costNum: number,
    gainPer: number = EQUIP_DECOMPOSE_DEFAULT_GAIN_PER,
): number {
    const base = Math.max(0, Math.floor(rankDecompose) || 0);
    const invested = Math.max(0, Math.floor(costNum) || 0);
    const per = Number.isFinite(gainPer) && gainPer > 0 ? gainPer : EQUIP_DECOMPOSE_DEFAULT_GAIN_PER;
    return base + Math.floor(invested * per / 100);
}

/** 单件是否落在筛选区间（`rank` / `quality` 任一项为 -1 表示该项不筛）。 */
export function decomposeFitsFilter(
    rank: number,
    quality: number,
    filter: IEquipDecomposeFilter,
): boolean {
    const rankLimit = Number.isFinite(filter.rank) ? filter.rank : -1;
    const qualityLimit = Number.isFinite(filter.quality) ? filter.quality : -1;
    if (rankLimit >= 0 && rank > rankLimit) return false;
    if (qualityLimit >= 0 && quality > qualityLimit) return false;
    return true;
}

/**
 * 阶筛选下拉的候选值：**背包里实际出现的阶**（升序去重）。
 *
 * 只统计可分解条目（未穿戴且有 uniqueId），避免列 `equipRank` 全表 1..20 但大多数档位
 * 对当前玩家为空。返回 `[]` 时界面只剩「全部」。
 */
export function decomposeRankOptions(entries: readonly IEquipDecomposeFacts[]): number[] {
    const ranks = new Set<number>();
    for (const entry of entries) {
        if (entry.equipped || !entry.uniqueId) continue;
        const rank = Math.floor(entry.rank);
        if (Number.isFinite(rank) && rank > 0) ranks.add(rank);
    }
    return [...ranks].sort((a, b) => a - b);
}

/**
 * 按筛选条件全选（老端 `fliterEquipItem()`：切筛选先清空，再把命中的前 99 件勾上）。
 *
 * 顺序沿用传入的背包顺序（品质降序 → resId → id），已穿戴的跳过。
 */
export function autoSelectDecompose(
    entries: readonly IEquipDecomposeFacts[],
    filter: IEquipDecomposeFilter,
    limit: number = EQUIP_DECOMPOSE_MAX,
): string[] {
    const max = Math.max(1, Math.floor(limit) || EQUIP_DECOMPOSE_MAX);
    const out: string[] = [];
    for (const entry of entries) {
        if (entry.equipped || !entry.uniqueId) continue;
        if (!decomposeFitsFilter(entry.rank, entry.quality, filter)) continue;
        out.push(entry.uniqueId);
        if (out.length >= max) break;
    }
    return out;
}

/** 勾选 / 取消勾选一格的返回：`rejected = 'limit'` 表示已满 99 件、本次未加入。 */
export interface IDecomposeToggleResult {
    readonly selected: readonly string[];
    readonly rejected: 'limit' | null;
}

/** 点一格：已选则取消；未选且未满 99 则加入，满 99 时返回 `rejected = 'limit'`。 */
export function toggleDecomposeSelection(
    selected: readonly string[],
    uniqueId: string,
    limit: number = EQUIP_DECOMPOSE_MAX,
): IDecomposeToggleResult {
    const id = String(uniqueId ?? '');
    if (!id) return { selected: selected.slice(), rejected: null };
    const next = selected.slice();
    const index = next.indexOf(id);
    if (index >= 0) {
        next.splice(index, 1);
        return { selected: next, rejected: null };
    }
    const max = Math.max(1, Math.floor(limit) || EQUIP_DECOMPOSE_MAX);
    if (next.length >= max) return { selected: next, rejected: 'limit' };
    next.push(id);
    return { selected: next, rejected: null };
}

/** 分解收益汇总（顺序跟随背包，去重、跳过已穿戴、最多 99 件）。 */
export interface IDecomposeSummary {
    readonly ids: readonly string[];
    readonly count: number;
    readonly gain: number;
}

/** 把已选 id 收敛成实际可分解的条目，并汇总返还数量。 */
export function summarizeDecompose(
    entries: readonly IEquipDecomposeFacts[],
    selectedIds: readonly string[],
    limit: number = EQUIP_DECOMPOSE_MAX,
): IDecomposeSummary {
    const wanted = new Set(selectedIds.map(id => String(id ?? '')).filter(Boolean));
    const max = Math.max(1, Math.floor(limit) || EQUIP_DECOMPOSE_MAX);
    const ids: string[] = [];
    let gain = 0;
    for (const entry of entries) {
        if (entry.equipped || !entry.uniqueId || !wanted.has(entry.uniqueId)) continue;
        ids.push(entry.uniqueId);
        gain += Math.max(0, Math.floor(entry.decompose) || 0);
        if (ids.length >= max) break;
    }
    return { ids, count: ids.length, gain };
}

/** 发请求前的 id 规范化：去空、去重、截到 99 件（防止手选 + 筛选叠加超限）。 */
export function normalizeDecomposeIds(
    ids: readonly (string | number)[],
    limit: number = EQUIP_DECOMPOSE_MAX,
): string[] {
    const max = Math.max(1, Math.floor(limit) || EQUIP_DECOMPOSE_MAX);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of ids) {
        const id = String(raw ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * 服务端回包后仍未确认移除的 id（保持请求顺序）。
 *
 * 用于「整包请求只接受一部分」时逐件补发；回包里多出来的 id 不参与反向计算。
 */
export function decomposeMissingIds(
    requested: readonly string[],
    removed: readonly string[],
): string[] {
    const removedSet = new Set(removed.map(id => String(id ?? '')).filter(Boolean));
    return requested.filter(id => !removedSet.has(String(id ?? '')));
}
