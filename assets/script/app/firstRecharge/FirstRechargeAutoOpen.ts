/**
 * 「新首充」**自动弹出**的运行时胶水层 —— 数据从哪来、弹窗怎么开。
 *
 * 分层（与 `FirstRechargeRepository` 同一套）：
 *   判定口径   `FirstRechargeTrigger`（纯函数，无 `cc`，可单测）
 *   本文件     「读表 / 读缓存 / 读写本地跨天戳 / 调弹窗管理器」这些必须碰引擎的活
 *   触发入口   `MainTabHost.onLoad`（= 进主界面，对齐老端 `TabFight.init()`）
 *
 * 老端的对应物：
 *   `TabFight.init()`（判定 + 开界面）+ `VORole.GetIsNewDay()/SaveToday()`（跨天戳）
 *   + `ModelChapterNew.GetMaxChallengeLevel()`（关卡进度）+ `TF_LayerBattleWin/Fail`（写战绩）。
 *
 *  ⚠️ **唯一对外入口是 `checkFirstRechargeOnEnterMain()`**，别在别处重复实现判定 ——
 *  触发条件、跨天戳的读写、战绩的清零三者必须成对出现，散开写必出"同一天弹两次"或"永远不弹"。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { LocalCache } from '../../framework/localstorage/LocalCache';
import { readSelfIdentity } from '../matching/MatchSelfProfile';
import { CacheMgr } from '../net/CacheMgr';
import { PopupManager } from '../../framework/ui/PopupManager';
import { PopupLayer } from '../../framework/ui/PopupDef';
import { FirstRechargePage } from './FirstRechargePage';
import {
    deriveMaxChallengeLevel,
    EMPTY_BATTLE_RESULT,
    isNewDay,
    parseGuankaLevelRow,
    resolveFirstRechargeTrigger,
    shouldMarkNewDay,
    startOfDayMs,
} from './FirstRechargeTrigger';
import type { FirstRechargeTriggerReason, IFirstRechargeBattleResult } from './FirstRechargeTrigger';

/** 关卡配置表名（`assets/remoteRef/guankaReward.json`）。 */
const GUANKA_REWARD_TABLE = 'guankaReward';

/**
 * 本地存档的 key 前缀 —— 与老端 `VORole` 逐字一致（`['LocalRoleData', roleId].join('-')`）。
 *
 * 保持同 key 是为了两个客户端共用一台设备的存档不打架；Demo3.8 只认 `lastLoginDayTime` 这一列。
 */
const LOCAL_SAVE_KEY_PREFIX = 'LocalRoleData';

/** 本地存档里读不到的兜底 roleId（没登录 / 缓存没落地时用）。 */
const UNKNOWN_ROLE_ID = 'unknown';

/** 本地存档的形状（只关心跨天戳）。 */
interface IFirstRechargeLocalSave {
    /** 上次「弹过了」那天的本地 0 点（毫秒）。`0` = 从没记过。 */
    lastLoginDayTime?: number;
}

// ============================================================
// 上一场关卡战斗的结果（对齐老端 `ModelRole.lastBattleResult`）
// ============================================================

/**
 * 模块级的「上一场关卡战斗结果」。
 *
 * ⚠️ **PVE 关卡战斗在 Demo3.8 还没接**（现在只有 `ZC_BATTLE_TYPE_PVP = 1001`）。
 * 关卡结算落地后，在结算入口调 `notifyLevelBattleResult(level, 1, star)`（胜利）
 * 或 `notifyLevelBattleResult(level, 0, 0)`（失败）即可接上，本文件不用改。
 *
 * 老端写这个值的地方是 `TF_LayerBattleWin.ts` / `TF_LayerBattleFail.ts`。
 */
let lastBattleResult: IFirstRechargeBattleResult = EMPTY_BATTLE_RESULT;

/**
 * 记录一场**关卡**战斗的结果（PVP 不要调）。
 *
 * @param level   关卡号（1-based，与 `guankaReward.level` 同一套编号）
 * @param result  `1` = 胜利，`0` = 失败
 * @param star    星级（0~3；失败的关卡传 0）
 */
export function notifyLevelBattleResult(level: number, result: number, star: number): void {
    lastBattleResult = {
        level: Number.isFinite(level) ? level : 0,
        result: Number.isFinite(result) ? result : 0,
        star: Number.isFinite(star) ? star : 0,
    };
}

/** 读当前待处理的战绩（测试 / 调试用）。 */
export function peekLevelBattleResult(): IFirstRechargeBattleResult {
    return lastBattleResult;
}

/** 清零 —— 与老端 `TabFight.init()` 末尾那三行同义。 */
function clearLevelBattleResult(): void {
    lastBattleResult = EMPTY_BATTLE_RESULT;
}

// ============================================================
// 关卡进度
// ============================================================

/**
 * 某一关是否已通关 —— `CmdBattleLevel.star >= 1`。
 *
 * 老端走的是 `VOBattleChapter.GetStageIsClean(stage)`（按章-关查）；Demo3.8 的缓存
 * 直接按 `level` 存一行 `CmdBattleLevel { level, star, takeStar, battleTime, buyTimes }`，
 * 所以「star 至少 1」就是通关的同义口径。
 */
function isLevelPassed(level: number): boolean {
    try {
        const row = CacheMgr.instance.getCmdBattleLevel(level);
        return row != null && Number(row.star) >= 1;
    } catch (error) {
        // 缓存没初始化（编辑器里直接进主界面 / 登录半途）→ 当成没过，不抛。
        console.warn('[FirstRecharge] 读 CmdBattleLevel 缓存失败', error);
        return false;
    }
}

/**
 * 关卡进度 —— 读 `guankaReward` 表 + `CmdBattleLevel` 缓存算出「当前可挑战的下一关」。
 *
 * 表读不到（离线 / 表没加载）时返回 `1`（= 一关没过），此时跨天那支天然不满足阈值，
 * 也就不会误弹。
 */
export async function getMaxChallengeLevel(): Promise<number> {
    let rows: unknown[] = [];
    try {
        rows = (await RefUtil.instance.getRefAllAsync(GUANKA_REWARD_TABLE)) ?? [];
    } catch (error) {
        console.warn('[FirstRecharge] 读 guankaReward 表失败', error);
        return 1;
    }

    const allRows: { level: number; instanceType: number }[] = [];
    for (const raw of rows) {
        const row = parseGuankaLevelRow(raw);
        if (row) allRows.push(row);
    }
    if (allRows.length === 0) return 1;

    return deriveMaxChallengeLevel(allRows, isLevelPassed);
}

// ============================================================
// 跨天戳（本地存档）
// ============================================================

/** 取本机玩家的 roleId；拿不到就退回 `unknown`（此时跨天戳退化成"全局一份"）。 */
function currentRoleId(): string {
    try {
        return readSelfIdentity()?.roleId || UNKNOWN_ROLE_ID;
    } catch (error) {
        console.warn('[FirstRecharge] 读本机 roleId 失败', error);
        return UNKNOWN_ROLE_ID;
    }
}

/** 打开本地存档并读出跨天戳（读不到算 `0` = 从没记过）。 */
function readSavedDayStart(roleId: string): number {
    const cache = new LocalCache<IFirstRechargeLocalSave>([LOCAL_SAVE_KEY_PREFIX, roleId].join('-'));
    try {
        cache.Load();
        const data = cache.Get();
        const saved = data == null ? 0 : Number(data.lastLoginDayTime);
        return Number.isFinite(saved) ? saved : 0;
    } catch (error) {
        // 存档坏了（JSON 解析失败 / 被外部写坏）→ 当成"从没记过"，不炸。
        console.warn('[FirstRecharge] 读本地跨天戳失败', error);
        return 0;
    }
}

/** 写回「今天弹过了」。写失败只告警，不回滚（最坏是下次进主界面再弹一次）。 */
function saveToday(roleId: string, nowMs: number): void {
    const cache = new LocalCache<IFirstRechargeLocalSave>([LOCAL_SAVE_KEY_PREFIX, roleId].join('-'));
    try {
        cache.Load();
        const data = cache.Get();
        if (data == null) {
            cache.Set({ lastLoginDayTime: startOfDayMs(nowMs) });
        } else {
            data.lastLoginDayTime = startOfDayMs(nowMs);
        }
        cache.Save();
    } catch (error) {
        console.warn('[FirstRecharge] 写本地跨天戳失败', error);
    }
}

// ============================================================
// 唯一对外入口
// ============================================================

/** 一次检查的结果（日志 / 测试用，业务不需要处理）。 */
export interface IFirstRechargeCheckOutcome {
    readonly reason: FirstRechargeTriggerReason;
    /** 关卡进度（算不出来时是 1）。 */
    readonly maxChallengeLevel: number;
    /** 弹窗有没有被成功拉起来。 */
    readonly opened: boolean;
}

/**
 * 进主界面时检查要不要自动弹首充。**这是本模块唯一的对外入口。**
 *
 * 行为（对齐老端 `TabFight.init()`）：
 *   1. 拿待处理的关卡战绩 + 跨天戳 + 关卡进度，交给 `resolveFirstRechargeTrigger` 判；
 *   2. 判出原因就开会话（`'newDay'` 顺带写「今天弹过了」）；
 *   3. **无论弹没弹，最后都把战绩清零** —— 老端无条件清零，
 *      否则同一场战斗的结果会在每次进主界面时被重复消费。
 *
 * ⚠️ 本函数**永不 reject**（调用方多半是 `void x().then(...)`，抛出去就是 unhandled rejection）。
 */
export async function checkFirstRechargeOnEnterMain(caller?: unknown): Promise<IFirstRechargeCheckOutcome> {
    let outcome: IFirstRechargeCheckOutcome = { reason: 'none', maxChallengeLevel: 1, opened: false };
    try {
        const roleId = currentRoleId();
        const nowMs = Date.now();
        const savedDayStart = readSavedDayStart(roleId);
        const maxChallengeLevel = await getMaxChallengeLevel();

        const reason = resolveFirstRechargeTrigger({
            lastBattleResult,
            isNewDay: isNewDay(savedDayStart, nowMs),
            maxChallengeLevel,
        });

        let opened = false;
        if (reason !== 'none') {
            if (shouldMarkNewDay(reason)) saveToday(roleId, nowMs);
            opened = await openFirstRecharge(caller);
            console.log(
                `[FirstRecharge] 自动弹出：原因=${reason}，关卡进度=${maxChallengeLevel}，结果=${opened ? '已打开' : '未打开'}`,
            );
        }
        outcome = { reason, maxChallengeLevel, opened };
    } catch (error) {
        // 兜底：任何一步炸了都不该把主界面流程带崩。
        console.warn('[FirstRecharge] 自动弹出检查失败', error);
    } finally {
        clearLevelBattleResult();
    }
    return outcome;
}

/** 调弹窗管理器拉起首充弹窗。加载失败返回 `false`（不抛）。 */
async function openFirstRecharge(caller?: unknown): Promise<boolean> {
    const manager = PopupManager.inst;
    if (!manager) {
        console.warn('[FirstRecharge] 弹窗管理器不可用，跳过自动弹出');
        return false;
    }
    try {
        // 默认同类单实例：已经开着时 `openAsync` 会返回现有实例，不会重复弹。
        const popup = await manager.openAsync(FirstRechargePage, { layer: PopupLayer.NORMAL, userData: caller });
        return popup != null;
    } catch (error) {
        console.warn('[FirstRecharge] 打开首充弹窗失败', error);
        return false;
    }
}
