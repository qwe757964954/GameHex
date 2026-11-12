/**
 * 「快速寻敌」按钮的**开启条件** —— 纯函数，零引擎依赖，可单测。
 *
 * 需求（2026-11-09）：*「快速寻敌按钮在激活第 1 章第 4 关的地块后才解锁该功能，
 * 解锁后所有章节都常驻」* + *「同步到【功能开启表中】，新增 id 702」*。
 *
 * ## 条件写在表里，代码不认关卡号
 * `open` 的 `refId = 702`（`name = 快速寻敌`）是这条功能的载体：
 *
 * ```json
 * {"refId":702,"belond":0,"order":0,"resShowType":[10,7],"type":2,
 *  "tipShow":"激活第1章第4关地块后解锁","name":"快速寻敌",
 *  "visibleCondition":[{"param":{"resId":10004},"type":"territoryLevelActivated"}],"condition":[]}
 * ```
 *
 * ⚠️ 条件类型是 **`territoryLevelActivated`（据点地块已激活）**，不是 `territoryLevel`（已通关）：
 *
 * ```
 * 激活第 4 关地块（花银币）  ⇒ 快速寻敌开（✔ 用户口径「激活地块后解锁」）
 * 打完第 4 关                ⇒ 也开（已占领必然已激活，`isCellActivated` 含 `isOwned`）
 * 只激活没打                 ⇒ 开（✘ 若用 `territoryLevel` 这里会一直锁着）
 * ```
 *
 * ## 「所有章节常驻」
 * 解锁跨章不丢，靠账号级落盘的已激活关卡集合
 * （`TerritorySaveStore.loadActivatedLevels` → `isTerritoryLevelActivatedInTerritory`）。
 * 客户端只负责「什么时候开」，开过之后由存档记住 —— 与 701 战斗宝箱入口同一套机制。
 *
 * ## `belond = 0`
 * 底部按钮是 HUD 上的节点（`ArenaRoot/BeginGame`），**不是**左右两列的活动入口。
 * `collectEntranceItems` 只收 `belond ∈ {2, 3}`，`belond = 0` 让它只当「条件载体」，
 * 不会在两侧多长出一颗图标（同 701 与 `refId = 13` 聊天入口）。
 *
 * ## 表缺行 ⇒ 不显示
 * 表没下发 / `refId` 被改 / 整张表读失败，一律按「未解锁」处理（`rowMissing` 单独报出来），
 * 与 701 同一个口径：宁可少一个入口，也不要把还没解锁的功能摆出来。
 */

import { findOpenRowByRefId, resolveOpenRowGate } from './ChestEntryGate';
import type { EntranceRowGate } from './ChestEntryGate';
import type { EntrancePlayerState, EntranceVisibleRow } from './MainEntranceVisible';

// ============================================================
// 常量
// ============================================================

/** 「快速寻敌」在 `open` 表里的行（2026-11-09 用户指定新增 `id 702`，`belond = 0` 纯条件载体）。 */
export const QUICK_FIND_OPEN_REF_ID = 702;

// ============================================================
// 判定
// ============================================================

/** 从 `open` 全表里捞「快速寻敌」那一行；没有返回 `null`。 */
export function findQuickFindRow(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
): EntranceVisibleRow | null {
    return findOpenRowByRefId(openRows, QUICK_FIND_OPEN_REF_ID);
}

/**
 * 快速寻敌现在开没开。
 *
 * `openRows` 传 `open` 全表（不是单行）：`preResId` 前置链要顺着全表往上找条件。
 */
export function resolveQuickFindGate(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
    state: EntrancePlayerState,
): EntranceRowGate {
    const gate = resolveOpenRowGate(openRows, state, QUICK_FIND_OPEN_REF_ID);
    if (!gate.rowMissing) return gate;
    // 与 701 同一句提醒：运行时只认 `refSmallAll.json` 的 `open` 块，同目录 `open.json` 是死文件。
    console.warn(
        `[QuickFindGate] open 表里找不到 refId=${QUICK_FIND_OPEN_REF_ID} 的快速寻敌行，按钮先不显示`
        + '（运行时读 assets/remoteRef/refSmallAll.json 的 open 块，改同目录 open.json 无效；'
        + 'SVN 合并后常被冲回旧版，重跑 tmp/patch_refsmallall_open702.py 恢复）',
    );
    return gate;
}

/** 只要「开没开」这一个布尔时的简写。 */
export function isQuickFindUnlocked(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
    state: EntrancePlayerState,
): boolean {
    return resolveQuickFindGate(openRows, state).unlocked;
}
