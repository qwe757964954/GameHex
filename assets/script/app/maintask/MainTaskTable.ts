/**
 * 主线任务（`taskMain` 表 + `CmdTask` 缓存）的判定口径 —— 零 import 纯函数层。
 *
 * ## 「10级领取」是什么
 *
 * 主界面上那个挂着物品框的小角标（老端 `组件_主界面_领取武将`），数据源是 `taskMain` 表里
 * **`targetType = 99`** 的那一行（全表 49 行里只有 1 行）：
 *
 * ```json
 * { "resId": 500099, "preResId": 0, "targetType": 99,
 *   "param": { "count": 10 }, "reward": [{ "number": 1, "resId": 18014 }],
 *   "name": "10级获取英雄", "goto": null }
 * ```
 *
 * ⇒ 角标文案「10级领取」里的 `10` 就是 `param.count`，进度 `(7/10)` 的 7 来自
 * 服务端 `CmdTask.count`、10 来自这张表。奖励是 `18014`「猎头者」碎片。
 *
 * ## 为什么是 `targetType = 99`
 *
 * 老端 `VOMainTaskBag.SpecialTaskForHeroId = 99`，`GetHeroVO()` 就这么过滤的：
 *
 * ```js
 * for (let vo of tmVO) { if (vo.GetRef().targetType == this.SpecialTaskForHeroId) return vo }
 * ```
 *
 * 同一个包里的 `GetFirstVO()` 还**主动排除** 99（`targetType != 99 && …`），
 * 说明 99 是「英雄任务」这条独立支线的哨兵值 —— 别把它混进主线列表。
 */

/** 英雄任务（= 主界面「10级领取」）在 `taskMain.targetType` 里的哨兵值。 */
export const MAIN_TASK_HERO_TARGET_TYPE = 99;

/**
 * `CmdCommonState`（`Cmd.d.ts` 的枚举，值必须逐字对上）。
 * `UNDONE = 0` 未完成 / `FINISH = 1` 已完成待领 / `REWARDED = 2` 已领取。
 */
export const CMD_COMMON_STATE = {
    UNDONE: 0,
    FINISH: 1,
    REWARDED: 2,
} as const;

/** `taskMain` 表一行的收敛形状。 */
export interface IMainTaskRow {
    readonly resId: number;
    readonly preResId: number;
    readonly targetType: number;
    /** 进度上限（`param.count`）。 */
    readonly maxCount: number;
    /** 奖励列表（老端 `GetHeroReward` 取**第一个**）。 */
    readonly reward: readonly { readonly resId: number; readonly number: number }[];
    /** 任务名（可含 `{count}` 占位符，老端 `GetTitle()` 会替换）。 */
    readonly name: string;
    /** 跳转 id（老端 `goto`）。 */
    readonly goto: number;
}

function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** 奖励列表解析（`[{number, resId}]`）。 */
function parseRewards(value: unknown): { resId: number; number: number }[] {
    if (!Array.isArray(value)) return [];
    const out: { resId: number; number: number }[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = num(row.resId);
        if (resId <= 0) continue;
        out.push({ resId, number: num(row.number, 1) });
    }
    return out;
}

export function parseMainTaskRow(raw: unknown): IMainTaskRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = num(row.resId);
    if (resId <= 0) return null;
    const param = row.param && typeof row.param === 'object'
        ? (row.param as Record<string, unknown>)
        : null;
    return {
        resId,
        preResId: num(row.preResId),
        targetType: num(row.targetType),
        maxCount: param ? num(param.count) : 0,
        reward: parseRewards(row.reward),
        name: str(row.name),
        goto: num(row.goto),
    };
}

/** `taskMain` 全表 → `resId → IMainTaskRow`。 */
export function parseMainTaskRows(rows: readonly unknown[]): Map<number, IMainTaskRow> {
    const out = new Map<number, IMainTaskRow>();
    for (const raw of rows) {
        const row = parseMainTaskRow(raw);
        if (row) out.set(row.resId, row);
    }
    return out;
}

/**
 * 取出英雄任务那一行（`targetType = 99`）。
 * 全表恰有 1 行；万一策划配了多行，取 **`resId` 最小**的那行（确定性，不靠 Map 迭代序）。
 */
export function pickHeroTaskRow(rows: ReadonlyMap<number, IMainTaskRow>): IMainTaskRow | null {
    let best: IMainTaskRow | null = null;
    for (const row of rows.values()) {
        if (row.targetType !== MAIN_TASK_HERO_TARGET_TYPE) continue;
        if (!best || row.resId < best.resId) best = row;
    }
    return best;
}

// ============================================================
// 进度 / 状态
// ============================================================

/**
 * 进度文案 `(7/10)` —— 老端 `com_task_hero.tm("lab_value").setText(\`(${GetValue()}/${GetMaxValue()})\`)`。
 * 越界（负数）钳到 0。
 */
export function progressTextOf(value: number, max: number): string {
    const v = Number.isFinite(value) ? Math.max(Math.floor(value), 0) : 0;
    const m = Number.isFinite(max) ? Math.max(Math.floor(max), 0) : 0;
    return `(${v}/${m})`;
}

/** 老端 `CanBeReward()`：`rewardState == FINISH`。 */
export function canClaimOf(rewardState: number): boolean {
    return Math.floor(rewardState) === CMD_COMMON_STATE.FINISH;
}

/** 老端 `IsUnDone()`：`rewardState == UNDONE`。 */
export function isUndoneOf(rewardState: number): boolean {
    return Math.floor(rewardState) === CMD_COMMON_STATE.UNDONE;
}

/**
 * 角标显不显示。老端：
 *
 * ```js
 * if (heroTaskVo && (canGet || heroTaskVo.IsUnDone())) { …显示… } else { com_task_hero.visible = false }
 * ```
 *
 * ⚠️ 后果是**已领取（REWARDED）时整块隐藏** —— 别「优化」成常显。
 */
export function entryVisibleOf(hasTask: boolean, rewardState: number): boolean {
    if (!hasTask) return false;
    return canClaimOf(rewardState) || isUndoneOf(rewardState);
}

/** 红点亮不亮：老端 `comRd.OnRDUpdate(canGet ? 1 : 0)` —— **只有可领时才亮**。 */
export function redDotVisibleOf(rewardState: number): boolean {
    return canClaimOf(rewardState);
}

/** 一条主线任务在服务端缓存（`CmdTask`）里的**状态**，收敛后的形状。 */
export interface IMainTaskState {
    /** 当前进度（服务端 `CmdTask.count`，已收敛成 `number`）。 */
    readonly count: number;
    /** `CmdCommonState`。 */
    readonly rewardState: number;
}

/** 服务器没推过这条任务时的兜底 `CmdTask`（`count = 0`、未完成）。 */
export const EMPTY_TASK_STATE = { count: 0, rewardState: CMD_COMMON_STATE.UNDONE } as const;

/**
 * 从 `CmdTask` 缓存行里读出 `{ count, rewardState }`。
 *
 * `CmdTask` 的形状（`Cmd.d.ts`）：`{ count: Long, resId: number, rewardState: CmdCommonState }`。
 * `count` 是 **`uint64` ⇒ Long**，必须走 `toIdString` / `Number()` 之前先收敛成字符串
 * （项目规则 23：禁直接 `Number(long)` 当数值用；这里只做展示与进度比较，
 * 用 `toCount`（`RequestGuard`）即可 —— 但本文件是零依赖层，所以只接**已经收敛好的 number**）。
 */
export function normalizeTaskState(raw: unknown): IMainTaskState {
    if (!raw || typeof raw !== 'object') return { ...EMPTY_TASK_STATE };
    const row = raw as Record<string, unknown>;
    const count = Number(row.count);
    const rewardState = Number(row.rewardState);
    return {
        count: Number.isFinite(count) ? count : 0,
        rewardState: Number.isFinite(rewardState) ? rewardState : CMD_COMMON_STATE.UNDONE,
    };
}

// ============================================================
// 「当前主线任务」—— 详情弹窗 + 主界面入口共用的那一条
// ============================================================

/** 选中的一条主线任务：表行 + 它在服务端缓存里的状态。 */
export interface IMainTaskPick {
    readonly row: IMainTaskRow;
    readonly state: IMainTaskState;
}

/**
 * 老端 `VOMainTaskBag.GetFirstVO()` —— 当前该展示的**主线任务**（不是「10级领取」那条）。
 *
 * ```js
 * GetFirstVO() {
 *     let tmVO = this.GetBagsTask();            // taskMain 全表 → 逐条取缓存行
 *     tmVO.sort((a, b) => a.GetRef().preResId - b.GetRef().preResId);
 *     for (let vo of tmVO) {
 *         if (vo.GetRef().targetType != this.SpecialTaskForHeroId &&      // ≠ 99
 *             (vo.GetCmd().rewardState == UNDONE || vo.GetCmd().rewardState == FINISH)) {
 *             return vo
 *         }
 *     }
 * }
 * ```
 *
 * 三条口径，逐条说明：
 *
 * 1. **主动排除 `targetType = 99`** —— 那是「10级领取」那条独立支线（见文件头）。
 * 2. **只认 `UNDONE` / `FINISH`** —— `REWARDED`（已领）的跳过，继续往后找。
 * 3. **按 `preResId` 升序**取第一个 —— 这是「任务链顺序」，不是 `resId`。
 *    ⚠️ `preResId` 打平时补 `resId` 升序做 tie-break（老端靠 V8 `Array.sort` 的稳定性，
 *    不写就是「看 Map 迭代序」，同样的表换个引擎版本会选出不同的任务）。
 *
 * ## 有意偏离：不照抄老端对 `null` 调 `GetRef()`
 *
 * 老端 `GetBagsTask()` 是「表里每行都 `GetVOByTaskId(ref.resId)` 然后 push」，
 * 缓存里没有的行会 push 进一个 `null` ⇒ 紧接着的 `sort` 里 `a.GetRef()` 直接
 * `TypeError`。也就是说**老端隐含要求「缓存里必须有 taskMain 的每一行」**。
 * 这里改成**只遍历真有缓存行的候选**（没有缓存的直接跳过）—— 未登录 / 缓存没到
 * 时返回 `null`（入口隐藏、弹窗不弹），而不是崩。
 */
export function pickFirstTaskRow(
    rows: ReadonlyMap<number, IMainTaskRow>,
    states: ReadonlyMap<number, IMainTaskState>,
): IMainTaskPick | null {
    const candidates: { row: IMainTaskRow; state: IMainTaskState }[] = [];
    for (const row of rows.values()) {
        if (row.targetType === MAIN_TASK_HERO_TARGET_TYPE) continue;
        const state = states.get(row.resId);
        if (!state) continue;
        if (!isUndoneOf(state.rewardState) && !canClaimOf(state.rewardState)) continue;
        candidates.push({ row, state });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (a.row.preResId - b.row.preResId) || (a.row.resId - b.row.resId));
    return candidates[0];
}

/**
 * 任务标题 —— 老端 `VOMainTask.GetTitle()`：
 * `ref.name.replace("{count}", GetMaxValue().toString())`。
 *
 * `taskMain` 表里的名字带 `{count}` 占位（例：`累计击败精英5个` 不带、但有些行写
 * `升到{count}级`）。占位值 = **`param.count`（进度上限）**，不是当前进度。
 */
export function taskTitleOf(row: IMainTaskRow): string {
    return row.name.replace('{count}', String(row.maxCount));
}

/**
 * 详情弹窗的标题文案 —— 老端 `LayerMainTaskDetailUI.initView()`：
 *
 * ```js
 * com.tm("lab_title").setText(`${vo.GetTitle()} (${vo.GetValue()}/${vo.GetMaxValue()})`)
 * ```
 *
 * ⚠️ **`GetTitle()` 与 `(x/y)` 之间有一个空格**（FGUI 原稿里那段设计期占位文字
 * `玩家等级打到10级(9/10)` 是**没空格**的，别照抄原稿 —— 代码才是行为真源）。
 */
export function taskDetailTitleOf(row: IMainTaskRow, state: IMainTaskState): string {
    return `${taskTitleOf(row)} (${state.count}/${row.maxCount})`;
}

/**
 * 主界面入口的文案 —— 老端 `GObjChapterSelect.onMainTaskChange()`：
 *
 * ```js
 * com_mainTask.tm("lab_task").setText(`${first.GetTitle()}\n(${first.GetValue()}/${first.GetMaxValue()})`)
 * ```
 *
 * ⇒ **两行**（任务名 + 换行 + 进度），FGUI `lab_task` 的 `size="130,59"` 正是两行高。
 * 本工程 Label 靠 `\n` 换行即可（不需要 `wrap`）。
 */
export function taskEntryLabelOf(row: IMainTaskRow, state: IMainTaskState): string {
    return `${taskTitleOf(row)}\n(${state.count}/${row.maxCount})`;
}

