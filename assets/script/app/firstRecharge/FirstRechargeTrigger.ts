/**
 * 新首充自动弹出判定 —— 纯函数，可单测。
 * 一律走 PVE 关卡进度，不用 PVP 战绩。
 */

/** 关卡进度阈值：至少通关 3 关。 */
export const FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD = 3;

/** 普通关卡 instanceType。 */
export const GUANKA_INSTANCE_TYPE_NORMAL = 0;

/** 上一场关卡战斗结果。 */
export interface IFirstRechargeBattleResult {
    /** 关卡号（1-based），0 = 无待处理结果。 */
    readonly level: number;
    /** 1=胜利，0=失败。 */
    readonly result: number;
    readonly star: number;
}

export const EMPTY_BATTLE_RESULT: IFirstRechargeBattleResult = { level: 0, result: 0, star: 0 };

/** 触发原因：通关第3关 / 跨天保底 / 不弹。 */
export type FirstRechargeTriggerReason = 'level' | 'newDay' | 'none';

export interface IFirstRechargeTriggerInput {
    readonly lastBattleResult: IFirstRechargeBattleResult;
    readonly isNewDay: boolean;
    readonly maxChallengeLevel: number;
}

/**
 * 判定进主界面要不要自动弹首充。
 * 第1关失败不弹；通关第3关当场弹；跨天且过了阈值保底弹。
 */
export function resolveFirstRechargeTrigger(input: IFirstRechargeTriggerInput): FirstRechargeTriggerReason {
    const level = input.lastBattleResult.level;
    const result = input.lastBattleResult.result;

    if (level === 1 && result === 0) return 'none';
    if (result === 1 && level === 3) return 'level';
    if (input.isNewDay && input.maxChallengeLevel > FIRST_RECHARGE_CHALLENGE_LEVEL_THRESHOLD) return 'newDay';
    return 'none';
}

/** 只有 newDay 分支要标记"今天弹过了"。 */
export function shouldMarkNewDay(reason: FirstRechargeTriggerReason): boolean {
    return reason === 'newDay';
}

export interface IGuankaLevelRow {
    readonly level: number;
    readonly instanceType: number;
}

/** 解析 guankaReward 行；坏行返回 null。 */
export function parseGuankaLevelRow(value: unknown): IGuankaLevelRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const level = Number(row.level);
    if (!Number.isSafeInteger(level) || level <= 0) return null;
    const instanceType = Number(row.instanceType);
    return {
        level,
        instanceType: Number.isFinite(instanceType) ? instanceType : -1,
    };
}

/**
 * 关卡进度：从 1 起，顺序数普通关卡，遇到第一个没过就停，clamp 到普通关总数。
 * 通关 N 关 ⇒ 返回 N+1（当前可挑战的下一关）。
 */
export function deriveMaxChallengeLevel(
    rows: readonly IGuankaLevelRow[],
    isPassed: (level: number) => boolean,
): number {
    const normalLevels: number[] = [];
    for (const row of rows) {
        if (row.instanceType === GUANKA_INSTANCE_TYPE_NORMAL) normalLevels.push(row.level);
    }

    let maxLevel = 1;
    for (const level of normalLevels) {
        if (isPassed(level)) maxLevel += 1;
        else break;
    }

    return Math.min(maxLevel, normalLevels.length);
}

/** 跨天判定：今天 0 点 ≠ 上次记录的 0 点。 */
export function isNewDay(savedDayStartMs: number, nowMs: number): boolean {
    const today = startOfDayMs(nowMs);
    return today !== savedDayStartMs;
}

/** 本地时区当天 0 点（毫秒）。 */
export function startOfDayMs(timeMs: number): number {
    const date = new Date(timeMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}
