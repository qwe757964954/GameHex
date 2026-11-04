import { CacheMgr } from '../net/CacheMgr';
import { toCount } from '../net/RequestGuard';

/**
 * 「这一关通关了没有」—— `open.json` 里 `visibleCondition.type = battleLevel` 的取数口。
 *
 * 口径：`CmdBattleLevel.star >= 1`（打过就是 1 星以上，0 星 = 没过）。
 * 与 `HangTable` 的「已通关」、老端 `GetStageIsClean`、`FirstRechargeAutoOpen.isLevelPassed`
 * **同一个口径** —— 这里单列出来，是因为主界面两侧入口（`MainEntranceList`）和底部宝箱入口
 * （`MainPage` → `ChestEntryGate`）都要判同一件事，两处各写一份迟早会漂。
 *
 * 读缓存失败一律当「没通关」（宁可少显示，也不要在没解锁时把入口摆出来）。
 */
export function isLevelPassed(level: number): boolean {
    try {
        const row = CacheMgr.instance.getCmdBattleLevel(level);
        return row != null && toCount(row.star) >= 1;
    } catch (error) {
        console.warn('[BattleLevelPassed] 读 CmdBattleLevel 失败', error);
        return false;
    }
}

/**
 * 排障用：这一关在 `CmdBattleLevel` 里到底长什么样。
 *
 * 只在诊断日志里调（判定本身用 `isLevelPassed`）：「表里没这一关」和「有这一关但 0 星」
 * 在 `isLevelPassed` 眼里都是 `false`，要分开只能看这里。
 */
export function battleLevelPassDetail(level: number): string {
    try {
        const row = CacheMgr.instance.getCmdBattleLevel(level);
        if (row == null) return `CmdBattleLevel 里没有 level=${level} 这一行`;
        return `CmdBattleLevel(${level}).star=${toCount(row.star)}`;
    } catch (error) {
        return `读 CmdBattleLevel(${level}) 抛错：${String(error)}`;
    }
}
