/**
 * 红点判定的**胶水层** —— 把各模块的纯判定函数装配成「这个变量该不该亮」。
 *
 * ## 为什么单独一个文件
 * `RdVars.ts` 里的变量类要 import 各模块的 Repository，而 Repository 依赖 `cc`（`CacheMgr`）；
 * 本工程约定「被 Node 用例 import 的模块依赖链上禁出现 `cc`」。所以判定逻辑放这儿：
 *
 * - 只 import **零 `cc`** 的表模块（`BattleTokenTable` 零 import；
 *   `FriendTable` → `RequestGuard`，同样零 `cc`）；
 * - 其余只 `import type`（编译期擦除，运行时无依赖）。
 *
 * ⇒ `tests/rdVars.test.ts` 可以直接 import 本文件跑判定，不用起引擎。
 *
 * ⚠️ 这里**只组装、不重写**：真正的判据一律调各模块已实现且有单测的纯函数
 * （`hasClaimableRedDot` / `canGetEnd`）。重写一遍 = 给自己造第二份真源。
 */

import { canGetEnd } from '../friend/FriendTable';
import type { IFriendRow } from '../friend/FriendTable';
import { BT_DEFAULT_TYPE, buildLevelRows, hasClaimableRedDot, plansOfType } from '../battletoken/BattleTokenTable';
import type { ILevelRow, IPlanRow, IRewardRow } from '../battletoken/BattleTokenTable';

// ============================================================
// 战令
// ============================================================

/** `CmdBattleToken` 一档位的状态（`IPlanState` 的结构子集，避免 import 依赖 `cc` 的模块）。 */
export interface IRdPlanStateLike {
    readonly open?: boolean;
    readonly takenLevels?: readonly number[] | null;
}

/** `CmdBattleToken` 一个类型的状态（`ITokenState` 的结构子集）。 */
export interface IRdTokenStateLike {
    readonly level?: number;
    readonly planStates?: ReadonlyMap<number, IRdPlanStateLike>;
}

/** `battleTokenRedDot` 的入参：直接从 `IBattleTokenSnapshot` 上摘四样（见 `RdVars` 的调用点）。 */
export interface IRdBattleTokenInput {
    readonly plans: readonly IPlanRow[] | null | undefined;
    readonly rewards: readonly IRewardRow[] | null | undefined;
    /** 按 `type` 分表的状态（快照的 `states`）。 */
    readonly states: ReadonlyMap<number, IRdTokenStateLike> | null | undefined;
    /** 等级上限（快照的 `maxLevelOf()`）。 */
    readonly maxLevel: number;
}

/**
 * 战令**某一个页签**「有没有可领」 —— 老端 `ModelBattleToken.GetBattleTokenRD(type)`。
 *
 * 老端：取该类型那一条的等级，遍历**已开启**的方案，看有没有
 * 「等级已到、该级奖励还没领」的行；有则亮。
 *
 * ## `type` 的两个来源（同一份判定，别分叉）
 * - **不传**（默认 `BT_DEFAULT_TYPE` = 通行证）—— 老端 `RDBattleToken.OnComputeResult()`
 *   的口径（它取**第一个** VO），即 `open.json` `refId=104` 战令**入口**的红点；
 * - **传**（页内四格）—— 由表达式 `[RDBattleToken:<type>]` 的参数来，
 *   见 `BattleTokenTable.battleTokenTabRdExpr` / `RdVars.RDBattleTokenVar`。
 *
 * 这里的分工：`buildLevelRows`（表 → 分级行）+ `plansOfType`（表 → 该类型的方案，顺序
 * 与分级行的每方案列**一一对应**）+ `hasClaimableRedDot`（判据）。三者都必须用**同一个
 * `type`**，方案数组的顺序也必须和 `buildLevelRows` 内部用的那一份一致 ——
 * `cmdOpenFlags[i]` / `takenLevels[i]` 是按**下标**对到方案上的，顺序错了会静默判错。
 */
export function battleTokenRedDot(
    input: IRdBattleTokenInput | null | undefined,
    type: number = BT_DEFAULT_TYPE,
): boolean {
    if (!input) return false;
    const states = input.states;
    if (!states) return false;

    const state = states.get(type);
    if (!state) return false;

    const plans = plansOfType(input.plans ?? [], type);
    if (plans.length === 0) return false;

    const rows: ILevelRow[] = buildLevelRows(input.plans ?? [], input.rewards ?? [], type, input.maxLevel);
    if (rows.length === 0) return false;

    const opened: boolean[] = [];
    const taken: (readonly number[] | null)[] = [];
    for (const plan of plans) {
        const planState = state.planStates?.get(plan.resId) ?? null;
        opened.push(planState?.open === true);
        taken.push(planState?.takenLevels ?? null);
    }
    return hasClaimableRedDot(rows, state.level ?? 0, opened, taken);
}

// ============================================================
// 好友
// ============================================================

/**
 * 好友入口红点 —— 老端 `RDFriend.OnComputeResult()`：
 * ```
 * hasApplyRD()  ||  canGetEnd()
 * ```
 * - `hasApplyRD()` = 有好友申请（老端直接判申请包条数 > 0，即这里的 `applyCount > 0`）；
 * - `canGetEnd()`  = 「领取体力」该亮（有可领的人 **且** 今日次数没满，老端 `ModelFriend.canGetEnd()`）。
 *
 * ⚠️ 两个条件**都要**：只判申请会漏掉「体力可领」，只判体力会漏掉申请列表。
 */
export function friendRedDot(
    applyCount: number,
    friendRows: readonly IFriendRow[] | null | undefined,
    maxTakeTimes: number,
): boolean {
    if (applyCount > 0) return true;
    return canGetEnd(friendRows ?? [], maxTakeTimes);
}

// ============================================================
// 联盟
// ============================================================

/** `leagueRedDot` 的入参：`ILeagueEntryRedDots` 的结构子集（避免 import 依赖 `cc` 的模块）。 */
export interface ILeagueRedDotLike {
    /** 每日砍价（`todayBargainTimes < unionBargainBuyCount`）。 */
    readonly discount?: boolean;
    /** 联盟任务（有任务可领 ∪ 有宝箱可领）。 */
    readonly task?: boolean;
    /** 联合战线 / 北伐中原（挑战 ∪ 奖励）。 */
    readonly north?: boolean;
}

/**
 * 联盟入口红点 —— 老端 `RDLeague.OnComputeResult()`，驱动 `open.json` 的 `[RDLeague]`。
 *
 * 老端：
 * ```
 * if (!IsJoinedLeague()) return 0;          // ← 这道闸在 Repository 里（见下）
 * if (hasTaskRD()) return 1;                // 任务
 * if (hasDonateRD()) return 1;              // 捐献（广告次数 > 0）
 * if (hasDiscountRD()) return 1;            // 每日砍价
 * // if (hasStoreRD()) return 1;            // 商店：老端**注释掉了**
 * if (hasNorthernExpeditionRD()) return 1;  // 北伐（挑战 ∪ 奖励）
 * return 0;
 * ```
 *
 * 「必须已入盟」那道闸**不在本函数里** —— `LeagueRepository.loadLeagueEntryRedDots()` 已经把
 * `joined` 分别与进三个字段（见 `ILeagueEntryRedDots` 的逐条注释）⇒ 这里「任一为真」即等价。
 *
 * ⚠️ **与老端的唯一差异**：老端还有一条 `hasDonateRD()`（广告剩余次数 > 0），本工程广告链路
 *    未迁（`LEAGUE_AD_PLAYBACK_AVAILABLE = false`）⇒ **有意不接**。补广告时在这里加一条
 *    `|| input.donate === true`，并同步 `ILeagueRedDotLike` / `ILeagueEntryRedDots` /
 *    `LEAGUE_ENTRANCE_RED_DOT_SOURCE`（理由详见 `LeagueRepository` 对应字段）。
 */
export function leagueRedDot(input: ILeagueRedDotLike | null | undefined): boolean {
    if (!input) return false;
    return input.discount === true || input.task === true || input.north === true;
}
