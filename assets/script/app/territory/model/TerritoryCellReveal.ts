import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';
import type { TerritoryProgress } from './TerritoryProgress';

/**
 * 已开启格、前置满足的非随机站点，以及紧邻的随机候选格；远处格子保持未知。
 *
 * 非随机站点（fixedResource / stage / boss / asyncPvp 等）以「前置条件满足」为显示门槛：
 * 只要 `requiredCells` 全部满足就揭示，不要求与已开格相邻——否则配置里
 * 「依赖主城 367」的 fixedResource_326 会被相邻揭示过滤掉（它与主城中心距 ≈169px，隔 1.7 格）。
 * 无前置（`requiredCells` 为空，如 bonus）的站点与随机候选格仍按相邻揭示。
 *
 * 🔴 **「满足」的判据只有一份**：{@link TerritoryProgress.isPrerequisiteComplete}。
 *    关卡 / 首领 / 异步据点前置必须**通关**（`isAreaPassed`），宝箱前置解锁即可 ——
 *    与点击拦截 `checkUnlock` 完全同源。2026-11-06 之前这里写的是「前置格 ∈ `owned ∪ unlocked`」，
 *    于是「花钱解锁了 2-9、没打」也会把 2-10 揭示出来（用户报的「提前披露」）。
 *
 * ⚠️ **只揭示有内容的格**（2026-11-05 山猫）：前沿上「没有站点、没有随机候选」的空格
 *   一律留在云里，不要为了放锁标把它们露出来 —— 那会让地图边缘凭空长出一整排灰地块。
 *   锁标只叠在**本来就会显示**的未解锁格上（见 `TerritoryMapView.isHexLockCell`）。
 *
 * ## 第三条通道：`previewCells`（提前披露，2026-11-09）
 *
 * 用户要求「开局就看得见第 1 关、通过第 1 关就看得见首领」，即**有意**提前披露 —— 这与
 * 上面那条「前置必须通关才揭示」的判据**方向相反**。所以它是**独立的可选入参**，
 * 不是把 `isPrerequisiteComplete` 放宽：
 *
 *  · 不传 `previewCells` ⇒ 行为与本函数上一版**逐格相同**（守卫用例继续成立）；
 *  · 传了 ⇒ 这些格**无条件**并进揭示集合（它们的 `requiredCells` 一个都没满足，仍然开不了）。
 *
 * 🔴 披露 ≠ 能开：解锁/扣银币那条链只认前置与钱包，与揭示集合无关。
 *    用户原话「提前展示不改变消耗银币激活地块的逻辑」。
 */
export function territoryRevealedCells(
    map: TerritoryMapConfig,
    progress: TerritoryProgress,
    /** 提前披露的格（见 `model/TerritoryPreview`）。缺省 = 不披露任何额外格。 */
    previewCells: readonly number[] = [],
): number[] {
    const opened = new Set(progress.ownedCells.concat(progress.unlockedCells));
    const frontier = new Set<number>();
    for (const cellId of opened) {
        for (const neighbor of hexGridNeighborIds(cellId, map.rows, map.columns)) {
            frontier.add(neighbor);
        }
    }
    const revealed = new Set<number>(opened);
    for (const site of map.sites) {
        const required = site.unlock.requiredCells;
        // 🔴 2026-11-06：前置是否满足**必须问 `progress.isPrerequisiteComplete`**，
        //    不能只判「前置格在 `opened`（`owned ∪ unlocked`）里」——
        //    那样「用银币解锁了 2-9 的格子、但没打」也会让 2-10 露出来
        //    （用户：「boss 关卡的解锁关系没有绑定到 2-9 的关卡中，提前披露了」）。
        //    与点击拦截（`checkUnlock` → `prerequisiteBlockers`）同源后，「看得见」与
        //    「点得动」才是同一套条件：关卡前置必须**通关**，宝箱前置解锁即可。
        if (required.length > 0 && required.every((cell) => progress.isPrerequisiteComplete(cell))) {
            revealed.add(site.cellId);
        } else if (required.length === 0 && frontier.has(site.cellId)) {
            revealed.add(site.cellId);
        }
    }
    for (const cellId of map.randomSites?.candidateCells ?? []) {
        if (frontier.has(cellId)) revealed.add(cellId);
    }
    // 提前披露（独立通道，见文件头）：无条件并入，不看前置。
    for (const cellId of previewCells) revealed.add(cellId);
    return Array.from(revealed).sort((a, b) => a - b);
}
