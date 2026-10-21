/**
 * 城池攻城日程 —— **纯规则，零 `cc` 依赖、零 `Date`**。
 *
 * 文档口径：「所有时间均走配置，服务器统一定时切换，客户端只读倒计时」。
 * 所以这里只做一件事：把「当前时刻」翻译成一个**阶段 + 三个动作判据 + 距下一阶段的秒数**，
 * 视图每帧 `render(resolve(...))` 即可（`AGENTS.md`：渲染幂等，不许在 view 里累加计时器）。
 *
 * ```
 * 00:00 ─────── 09:00 ─────────────── 21:00 ── 21:10 ────── 22:00 ─────── 次日 09:00
 *   closed      │      prepare          │  locked  │  settling  │   closed
 *               └ 可宣战 / 可打分 ──────┘ └ 停计分 ┘ └ 归属结算 ┘
 * ```
 *
 * ⚠️ 两个刻意的边界口径（文档未明写，等策划定稿前先按这套走，改这里即可）：
 * 1. **锁榜后仍可攻城，但不再计分** —— `canAttack` 覆盖 `prepare` + `locked`，`canScore` 只有 `prepare`；
 * 2. **归属随攻击即时变更**（沿用现有 `BigMapBattle` 实现），不是等到 `settling` 才切，
 *    所以这里不提供 `canChangeOwner`，免得两处真源。
 *
 * 日程**真源是 `bigmapSchedule` 表**（`openTime/lockTime/settleTime/snapshotTime` 写 `"HH:MM"`），
 * `parseBigMapConfig` 把它解析成 `IBigMapConfig.schedule`；本文件的
 * `DEFAULT_BIGMAP_CITY_SCHEDULE` 只给测试夹具和兜底用。
 */

const SECONDS_PER_DAY = 86400;

/** 攻城日程的四个阶段。 */
export type BigMapCityPhase = 'closed' | 'prepare' | 'locked' | 'settling';

/**
 * 日程表 —— 一天内的四个切换时点（均为**当日秒**）。
 *
 * `utcOffsetSeconds` 是「本地时区相对 UTC 的偏移」，因为注入的时钟是 `Date.now()/1000`
 * （UTC 秒），而 09:00 / 21:00 是玩家眼里的本地时间。东八区 = `8 * 3600`。
 * 联机版应由服务器下发，客户端不自己算 —— 改系统时区不该影响结算。
 *
 * 真源 = `bigmapSchedule` 表（客户端由 `parseBigMapConfig` 解析进来），
 * `DEFAULT_BIGMAP_CITY_SCHEDULE` 只是**测试夹具与兜底**，不要拿它当配置用。
 */
export interface IBigMapCitySchedule {
    /** 本地时区偏移（秒），东八区 = 28800。 */
    readonly utcOffsetSeconds: number;
    /** 开放宣战/攻城（当日秒）。 */
    readonly openAt: number;
    /** 锁榜：停止计分（当日秒）。 */
    readonly lockAt: number;
    /** 归属结算（当日秒）。 */
    readonly settleAt: number;
    /** 快照发奖，之后进入 `closed`（当日秒）。 */
    readonly snapshotAt: number;
}

/** 兜底日程（与 `bigmapSchedule` 表首版同值）：测试夹具用，运行时以配置为准。 */
export const DEFAULT_BIGMAP_CITY_SCHEDULE: IBigMapCitySchedule = {
    utcOffsetSeconds: 8 * 3600,
    openAt: 9 * 3600,
    lockAt: 21 * 3600,
    settleAt: 21 * 3600 + 10 * 60,
    snapshotAt: 22 * 3600,
};

/** 阶段中文名（界面直接用；放这里是为了「改文案不用翻 view」）。 */
export const BIGMAP_CITY_PHASE_LABEL: Readonly<Record<BigMapCityPhase, string>> = {
    closed: '休战',
    prepare: '可攻打',
    locked: '已锁榜',
    settling: '结算中',
};

/** 某一时刻的攻城时间轴快照 —— 视图只读它，不自己判断时间。 */
export interface IBigMapCityTimeline {
    readonly phase: BigMapCityPhase;
    /** 当日秒（0 ~ 86399.999，已叠加时区偏移）。 */
    readonly secondsOfDay: number;
    /** 距下一阶段切换的秒数（`closed` 段的下一阶段是次日 09:00）。 */
    readonly remainSeconds: number;
    /** 能否发起攻城（`prepare` + `locked`）。 */
    readonly canAttack: boolean;
    /** 攻城是否计入当日战功（只有 `prepare`）。 */
    readonly canScore: boolean;
}

/**
 * 日程合法性校验 —— 时间必须同一天内严格递增（允许相邻相等，表示该阶段被省略）。
 *
 * 配置写错时直接抛错：日程错一天，全服玩家的战功和归属都错，绝不能静默退化。
 * `parseBigMapConfig` 解析 `bigmapSchedule` 时也走这里，保证「表和代码同一套校验」。
 */
export function validateBigMapCitySchedule(schedule: IBigMapCitySchedule): void {
    if (!Number.isFinite(schedule.utcOffsetSeconds)) {
        throw new Error(`[BigMap] 攻城日程时区偏移非法：${schedule.utcOffsetSeconds}`);
    }
    const marks: readonly (readonly [string, number])[] = [
        ['openAt', schedule.openAt],
        ['lockAt', schedule.lockAt],
        ['settleAt', schedule.settleAt],
        ['snapshotAt', schedule.snapshotAt],
    ];
    let previous = 0;
    let previousName = '';
    for (const [name, value] of marks) {
        if (!Number.isFinite(value) || value < 0 || value >= SECONDS_PER_DAY) {
            throw new Error(`[BigMap] 攻城日程 ${name} 必须落在 [0, 86400) 内：${value}`);
        }
        if (previousName !== '' && value < previous) {
            throw new Error(`[BigMap] 攻城日程倒挂：${name}(${value}) 早于 ${previousName}(${previous})`);
        }
        previous = value;
        previousName = name;
    }
}

/**
 * 把配置表里的 `"09:00"` 折成当日秒（32400）。
 *
 * 表里用字符串是为了策划能直接看懂；这里必须**严格**校验，否则 `"9:0"` / `"25:00"`
 * 这类脏值会静默变成 0 点或 90 分钟，日程整体错位而没有任何报错。
 */
export function parseBigMapClockTime(text: string, field = 'time'): number {
    const matched = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!matched) throw new Error(`[BigMap] 攻城日程 ${field} 不是 HH:MM 格式：${JSON.stringify(text)}`);
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (hour > 23 || minute > 59) {
        throw new Error(`[BigMap] 攻城日程 ${field} 超出 00:00~23:59：${text}`);
    }
    return hour * 3600 + minute * 60;
}

/** 把任意秒数折进 `[0, 86400)`（含负数，测试夹具会用到负时间戳）。 */
function wrapDay(seconds: number): number {
    const rest = seconds % SECONDS_PER_DAY;
    return rest < 0 ? rest + SECONDS_PER_DAY : rest;
}

/**
 * 取某一时刻的攻城时间轴。
 *
 * @param schedule 日程表（运行时来自 `IBigMapConfig.schedule`，即 `bigmapSchedule` 表）
 * @param nowSeconds 逻辑秒 —— 必须来自注入的时钟端口（`Date.now()/1000` 或服务器校准秒），
 *   **不要在 model 里直接 `Date.now()`**，否则改系统时间就能刷战功。
 */
export function bigMapCityTimeline(
    schedule: IBigMapCitySchedule,
    nowSeconds: number,
): IBigMapCityTimeline {
    if (!Number.isFinite(nowSeconds)) {
        throw new Error(`[BigMap] 攻城时间轴收到非法时刻：${nowSeconds}`);
    }
    validateBigMapCitySchedule(schedule);
    const secondsOfDay = wrapDay(nowSeconds + schedule.utcOffsetSeconds);

    let phase: BigMapCityPhase;
    let nextAt: number;
    if (secondsOfDay < schedule.openAt) {
        phase = 'closed';
        nextAt = schedule.openAt;
    } else if (secondsOfDay < schedule.lockAt) {
        phase = 'prepare';
        nextAt = schedule.lockAt;
    } else if (secondsOfDay < schedule.settleAt) {
        phase = 'locked';
        nextAt = schedule.settleAt;
    } else if (secondsOfDay < schedule.snapshotAt) {
        phase = 'settling';
        nextAt = schedule.snapshotAt;
    } else {
        phase = 'closed';
        nextAt = schedule.openAt + SECONDS_PER_DAY;
    }

    return {
        phase,
        secondsOfDay,
        remainSeconds: nextAt - secondsOfDay,
        canAttack: phase === 'prepare' || phase === 'locked',
        canScore: phase === 'prepare',
    };
}

/** 「现在能不能打这座城」的结论：`reason` 为空串表示可以打。 */
export interface IBigMapCityAttackGate {
    readonly canAttack: boolean;
    readonly reason: string;
}

/**
 * 把「城池解锁态」与「日程阶段」合成一个界面可直接用的结论。
 *
 * 顺序刻意按「玩家最想先知道的那条」排：未开放 → 未解锁 → 已占领 → 已攻破 → 日程。
 * 行动力 / 战力这些**战斗层**判据不在这里，由 `BigMapBattle` 给，避免两处真源。
 */
export function bigMapCityAttackGate(
    state: 'locked' | 'open' | 'breached' | 'occupied' | 'unavailable',
    timeline: IBigMapCityTimeline,
): IBigMapCityAttackGate {
    if (state === 'unavailable') return { canAttack: false, reason: '联盟 / 战盟玩法本期未开放' };
    if (state === 'locked') return { canAttack: false, reason: '尚未解锁' };
    if (state === 'occupied') return { canAttack: false, reason: '已占领' };
    if (state === 'breached') return { canAttack: false, reason: '已攻破，等待结算' };
    if (!timeline.canAttack) {
        const label = BIGMAP_CITY_PHASE_LABEL[timeline.phase];
        return { canAttack: false, reason: `${label}，无法攻城` };
    }
    return { canAttack: true, reason: '' };
}
