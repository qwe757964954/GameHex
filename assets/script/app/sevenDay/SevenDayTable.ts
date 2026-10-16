/**
 * 七日狂欢的数据口径 —— **纯逻辑，不 import 任何东西，可在 Node 单测里直接跑**。
 *
 * 移植自老客户端：
 *   - 配置表 `sevenDayTask`（69 行）/ `sevenDayShop`（21 行）/ `sevenDayPoint`（5 行）
 *   - 服务器 `CmdSevenDayInfo`（`tlCmdTask` / `tlCmdSevenDayShop` / `cmdSevenDayPoint`）
 *   - 判定 `client/assets/script/app/game/model/sevenday/ModelSevenday.ts`
 *     + 界面 `.../ctrl/sevenday/LayerSevenday.ts`
 *
 * 老端这些判定散在 `ModelSevenday`（依赖 DI 容器 / `TimeUtil` / `ModelMgr`）」里，没法单测；
 * 这里全部收敛成**传参的纯函数**：
 *   - 时间一律走参数（毫秒），不读 `Date.now()` —— 测试才能定住「第几天」；
 *   - 表行只做「读字段 + 归一化」，解析失败的行走跳过策略，不抛异常。
 *
 * ## 界面口径：**完全对齐老端**（2026-09-26 按用户要求收敛，别再「优化」回去）
 *   老端 `LayerSevenday` 里 `list_tab` 在 FGUI 原稿就是 `visible="false"`，代码也只
 *   `listTab.update([SevenDayTab.task])` 喂一个页签、`selectTab` 恒为 `SevenDayTab.task`
 *   ⇒ 界面上**没有页签栏**，只有一个混合列表 = 当天**全部** `type = 2` 的行（今日福利 + 今日挑战混排）。
 *   所以界面走 `listRowsOfDay`。`listDayTabs` / `listRowsOfTab` 是**数据层能力**
 *   （按 `typeName` 分组，与 FGUI 页签控制器那三个 page 对应），当前**不被界面消费** ——
 *   留着是为了「将来要恢复页签」时不用重写；开关见 `SevenDayPage.SHOW_PAGE_TAB_BAR`。
 *   ⚠️ 恢复页签时必须**同时**把 `RowView` 的顶边从 392 退回 450（页签栏占 382..450，否则列表压住它）。
 */

/** 一条奖励：`{ resId, number }`。 */
export interface ISevenDayReward {
    readonly resId: number;
    readonly number: number;
}

/** 配置表 `sevenDayTask` 的一行（归一化后）。 */
export interface ISevenDayTaskRow {
    readonly resId: number;
    /** 属于创角第几天。 */
    readonly days: number;
    /** 老端的类型号（任务恒为 2）。 */
    readonly type: number;
    /** 页签名（`今日福利` / `今日挑战`）。 */
    readonly typeName: string;
    readonly name: string;
    /** 任务目标类型；`8` = 通关某关（进度文案特殊）。 */
    readonly targetType: number;
    /** `param.count` = 目标数量。 */
    readonly targetCount: number;
    readonly reward: readonly ISevenDayReward[];
    /** 老端 `CtrlJumpView.JumpType(ref.goto)` 的入参；`0` = 不跳。 */
    readonly goto: number;
}

/** 配置表 `sevenDayShop` 的一行（归一化后）。 */
export interface ISevenDayShopRow {
    readonly id: number;
    readonly days: number;
    readonly type: number;
    readonly typeName: string;
    readonly name: string;
    readonly rewards: readonly ISevenDayReward[];
    /** 货币 `resId`（`item.json` 口径）。 */
    readonly priceType: number;
    /** 实付数量。 */
    readonly cost: number;
    /** 原价（用于展示划线价）。 */
    readonly originalPrice: number;
    /** 限购次数。 */
    readonly limit: number;
    /** 折扣，`10` = 不打折（`5` 显示「5折」）。 */
    readonly discount: number;
}

/** 配置表 `sevenDayPoint` 的一行（积分宝箱档位）。 */
export interface ISevenDayPointRow {
    /** 宝箱 id，**也是**领奖请求的 `resId`。 */
    readonly resId: number;
    /** 达到多少积分可领。 */
    readonly point: number;
    readonly reward: readonly ISevenDayReward[];
}

/** 服务器下发的状态（窄化自 `CmdSevenDayInfo`）。 */
export interface ISevenDayServerState {
    /** 当前积分。 */
    readonly point: number;
    /** 已领取的宝箱 `resId` 列表。 */
    readonly takenBoxIds: readonly number[];
    /** 任务：`resId` → `{ count, rewardState }`。 */
    readonly tasks: ReadonlyMap<number, ISevenDayTaskServerState>;
    /** 商品：`id` → 已购买次数。 */
    readonly shops: ReadonlyMap<number, number>;
}

/** 单个任务的服务端状态。 */
export interface ISevenDayTaskServerState {
    readonly count: number;
    /** `CmdCommonState`：`0` 未完成 / `1` 可领取 / `2` 已领取。 */
    readonly rewardState: number;
}

/** `CmdCommonState` 的三个值（不 import 生成代码，保持本文件零依赖）。 */
export const SEVEN_DAY_STATE_UNDONE = 0;
export const SEVEN_DAY_STATE_FINISH = 1;
export const SEVEN_DAY_STATE_REWARDED = 2;

/** `targetType === 8` = 「通关第 N 关」，进度文案走 `taskFight` 模板。 */
export const SEVEN_DAY_TARGET_FIGHT = 8;

/**
 * 老端 `enum SevenDayTab { reward = 1, task = 2, buy = 3 }` 里的 `task` —— 也正好是
 * `sevenDayTask.type` 的取值（商品表 `sevenDayShop.type` 恒为 3）。
 *
 * 界面默认那张**混合列表**就按它过滤（见 `listRowsOfDay`）。
 */
export const SEVEN_DAY_TASK_TYPE = 2;

const DAY_MS = 86400000;

/** 服务器状态为空时的快照（没连服 / 刚进游戏）。 */
export const EMPTY_SEVEN_DAY_STATE: ISevenDayServerState = {
    point: 0,
    takenBoxIds: [],
    tasks: new Map(),
    shops: new Map(),
};

// ============================================================
// 表行解析
// ============================================================

function asNumber(value: unknown, fallback: number = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback: string = ''): string {
    return typeof value === 'string' ? value : fallback;
}

/** 解析 `[{ resId, number }]` 形状的奖励数组；非法项跳过。 */
function parseRewards(value: unknown): ISevenDayReward[] {
    if (!Array.isArray(value)) return [];
    const out: ISevenDayReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const resId = asNumber(row.resId, 0);
        if (resId <= 0) continue;
        out.push({ resId, number: asNumber(row.number, 0) });
    }
    return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/** `sevenDayTask` 一行 → 归一化；`resId` 非法返回 `null`。 */
export function parseTaskRow(value: unknown): ISevenDayTaskRow | null {
    const row = asRecord(value);
    if (!row) return null;
    const resId = asNumber(row.resId, 0);
    if (resId <= 0) return null;
    const param = asRecord(row.param);
    return {
        resId,
        days: asNumber(row.days, 0),
        type: asNumber(row.type, 0),
        typeName: asString(row.typeName),
        name: asString(row.name),
        targetType: asNumber(row.targetType, 0),
        targetCount: param ? asNumber(param.count, 0) : 0,
        reward: parseRewards(row.reward),
        goto: asNumber(row.goto, 0),
    };
}

/** `sevenDayShop` 一行 → 归一化；`id` 非法返回 `null`。 */
export function parseShopRow(value: unknown): ISevenDayShopRow | null {
    const row = asRecord(value);
    if (!row) return null;
    const id = asNumber(row.id, 0);
    if (id <= 0) return null;
    return {
        id,
        days: asNumber(row.days, 0),
        type: asNumber(row.type, 0),
        typeName: asString(row.typeName),
        name: asString(row.name),
        rewards: parseRewards(row.rewards),
        priceType: asNumber(row.priceType, 0),
        cost: asNumber(row.cost, 0),
        originalPrice: asNumber(row.originalPrice, 0),
        limit: asNumber(row.limit, 0),
        discount: asNumber(row.discount, 10),
    };
}

/** `sevenDayPoint` 一行 → 归一化；`resId` 非法返回 `null`。 */
export function parsePointRow(value: unknown): ISevenDayPointRow | null {
    const row = asRecord(value);
    if (!row) return null;
    const resId = asNumber(row.resId, 0);
    if (resId <= 0) return null;
    return { resId, point: asNumber(row.point, 0), reward: parseRewards(row.reward) };
}

/**
 * `item` 表的一行（窄化视图）。
 *
 * 七日狂欢只用它来取**奖励的展示信息**：品质（决定品质框）与图标名。
 * 读整张 `item` 表是因为 `reward[].resId` 会落在任意道具上，
 * 按 id 逐条查表要发 N 次异步请求，一次性读了更省。
 */
export interface ISevenDayItemInfo {
    readonly resId: number;
    readonly name: string;
    /**
     * `item.icon` 原样带出。2026-09-23 起它是「相对 `assets/resources/` 的资源路径」
     * （`icons/item/图标_兵书随机`），由 `SevenDayArt.resolveItemIconRef` 解析；
     * 老数据的裸组件名（`图标_图纸_帽子`）解析不出，奖励格会降级成「只画品质框」。
     */
    readonly icon: string;
    readonly quality: number;
}

/** `item` 一行 → 展示信息；`resId` 非法返回 `null`。 */
export function parseItemRow(value: unknown): ISevenDayItemInfo | null {
    const row = asRecord(value);
    if (!row) return null;
    const resId = asNumber(row.resId, 0);
    if (resId <= 0) return null;
    return {
        resId,
        name: asString(row.name),
        icon: asString(row.icon),
        quality: asNumber(row.quality, 1),
    };
}

/** 批量解析 `item` 表（重复 resId 只留第一条）。 */
export function parseItemRows(rows: readonly unknown[]): Map<number, ISevenDayItemInfo> {
    const out = new Map<number, ISevenDayItemInfo>();
    for (const row of rows) {
        const parsed = parseItemRow(row);
        if (parsed && !out.has(parsed.resId)) out.set(parsed.resId, parsed);
    }
    return out;
}

/** 批量解析（跳过非法行）。 */
export function parseTaskRows(rows: readonly unknown[]): ISevenDayTaskRow[] {
    const out: ISevenDayTaskRow[] = [];
    for (const row of rows) {
        const parsed = parseTaskRow(row);
        if (parsed) out.push(parsed);
    }
    return out;
}

export function parseShopRows(rows: readonly unknown[]): ISevenDayShopRow[] {
    const out: ISevenDayShopRow[] = [];
    for (const row of rows) {
        const parsed = parseShopRow(row);
        if (parsed) out.push(parsed);
    }
    return out;
}

export function parsePointRows(rows: readonly unknown[]): ISevenDayPointRow[] {
    const out: ISevenDayPointRow[] = [];
    for (const row of rows) {
        const parsed = parsePointRow(row);
        if (parsed) out.push(parsed);
    }
    // 宝箱按积分升序 —— 老端直接用表序（表本身就是升序），这里排一次更稳。
    out.sort((a, b) => a.point - b.point);
    return out;
}

// ============================================================
// 时间口径
// ============================================================

/** 某个时刻所在自然日的 0 点（本地时区）。 */
export function dayStartOf(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * 创角第几天（`1` 起）。
 *
 * 老端 `ModelSevenday.GetCurDay`：`(今天0点 - 创角0点) / 一天 + 1`，上限之后再 clamp `>= 1`
 * —— **不能砍掉这个 clamp**：服务端时间比客户端早的时候差值是负数，会算出第 0 天甚至负数，
 * 界面表现为「一天都没解锁」。
 */
export function deriveCurDay(createTimeMs: number, nowMs: number): number {
    if (!(createTimeMs > 0)) return 1;
    const cur = Math.floor((dayStartOf(nowMs) - dayStartOf(createTimeMs)) / DAY_MS) + 1;
    return cur <= 0 ? 1 : cur;
}

/** 活动总天数（老端 `gameConfig.sevenTaskShowDay`）。Demo3.8 还没有这张表，用任务/商品表实际天数兜底。 */
export const SEVEN_DAY_FALLBACK_MAX_DAY = 7;

/**
 * 任务 / 商品表实际配置的天数（老端 `GetTaskMaxDay`）。
 *
 * ⚠️ 与「活动总天数」是两个口径：活动可开 N 天，但表不一定配满 N 天；
 * 界面上的天数按钮按**这个**值渲染，活动结束时间按 `SEVEN_DAY_FALLBACK_MAX_DAY` 算。
 */
export function deriveTaskMaxDay(
    tasks: readonly ISevenDayTaskRow[],
    shops: readonly ISevenDayShopRow[],
): number {
    let max = 0;
    for (const row of tasks) if (row.days > max) max = row.days;
    for (const row of shops) if (row.days > max) max = row.days;
    return max;
}

/** 活动结束时间（毫秒）：创角当天 0 点 + 活动天数（老端 `GetEndTime`）。 */
export function deriveEndTimeMs(createTimeMs: number, maxDay: number): number {
    if (!(createTimeMs > 0)) return 0;
    return dayStartOf(createTimeMs) + maxDay * DAY_MS;
}

/**
 * 倒计时文案：`3天12时` / `12时05分` / `05分09秒` / `已结束`。
 *
 * 对齐老端 `TimeUtil.timeSec2HMSStr14` 的显示粒度（到「时」为止；不足一天时给到「分」）。
 * 传入毫秒，`<= 0` 返回「已结束」。
 */
export function formatRemain(ms: number): string {
    if (!(ms > 0)) return '已结束';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    if (days > 0) return `${days}天${pad(hours)}时`;
    if (hours > 0) return `${hours}时${pad(minutes)}分`;
    return `${pad(minutes)}分${pad(seconds)}秒`;
}

// ============================================================
// 页签与列表
// ============================================================

/** 一个页签：`typeName` + 该页签下的行（任务行或商品行）。 */
export interface ISevenDayTabGroup {
    readonly typeName: string;
    /** 页签序号（从 0 起），供界面按固定槽位摆放。 */
    readonly index: number;
}

/**
 * 某一天可用的页签（按表中**首现序**：任务表的 typeName 在前，商品表在后）。
 *
 * ⚠️ 这是**数据层能力**，界面当前不消费（老端口径 = 无页签栏，见文件头与
 *    `SevenDayPage.SHOW_PAGE_TAB_BAR`）。表里某天一个任务都没有时也不会凭空造页签 ——
 *    返回空数组。
 */
export function listDayTabs(
    tasks: readonly ISevenDayTaskRow[],
    shops: readonly ISevenDayShopRow[],
    day: number,
): ISevenDayTabGroup[] {
    const names: string[] = [];
    for (const row of tasks) {
        if (row.days !== day || row.typeName.length === 0) continue;
        if (names.indexOf(row.typeName) < 0) names.push(row.typeName);
    }
    for (const row of shops) {
        if (row.days !== day || row.typeName.length === 0) continue;
        if (names.indexOf(row.typeName) < 0) names.push(row.typeName);
    }
    return names.map((typeName, index) => ({ typeName, index }));
}

/** 列表行（任务 / 商品二选一，判别联合）。 */
export type SevenDayListRow =
    | { readonly kind: 'task'; readonly task: ISevenDayTaskRow }
    | { readonly kind: 'shop'; readonly shop: ISevenDayShopRow };

/**
 * **当天的整张列表**（老端口径，界面默认走这条）：所有 `sevenDayTask` 里属于第 `day` 天、
 * `type === SEVEN_DAY_TASK_TYPE` 的行，已排序。
 *
 * 老端 `GetTlRefSevenDay(day, SevenDayTab.task)` 就是按 `["days","type"]` 过滤 ⇒
 * `typeName` 为「今日福利」和「今日挑战」的行**混在同一个列表**里（day1 一共 10 条：
 * 2 条福利 + 8 条挑战，与老端实拍一致）。按 `typeName` 拆页签（`listRowsOfTab`）是
 * **数据层能力**，界面当前不吃 —— 见文件头与 `SevenDayPage.SHOW_PAGE_TAB_BAR`。
 *
 * ⚠️ 商品（`sevenDayShop`，`type = 3`）**不在**这张列表里：老端 `tlShowTab = [task]`，
 *    半价礼包那一页本来就进不去。要把它露出来只能开页签栏。
 */
export function listRowsOfDay(
    tasks: readonly ISevenDayTaskRow[],
    day: number,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): SevenDayListRow[] {
    const out: SevenDayListRow[] = [];
    for (const task of tasks) {
        if (task.days === day && task.type === SEVEN_DAY_TASK_TYPE) out.push({ kind: 'task', task });
    }
    out.sort((a, b) => sortKeyOf(a, state) - sortKeyOf(b, state));
    return out;
}

/**
 * 某天某页签下的行，**已排序**。
 *
 * ⚠️ 数据层能力，界面当前不消费（老端口径 = 无页签栏 ⇒ 走 `listRowsOfDay`）。
 *
 * 排序口径照抄老端（`getTaskSortOrder` / `getShopSortOrder`）：可领取的排最前，
 * 其次未完成，最后已领取；同档按 id 升序。老端用 `t1 * 1e8 + id` 拼一个 key，
 * 这里保留同样的量级（`1e8` 远大于任何真实 id，不会串档）。
 */
export function listRowsOfTab(
    tasks: readonly ISevenDayTaskRow[],
    shops: readonly ISevenDayShopRow[],
    day: number,
    typeName: string,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): SevenDayListRow[] {
    const out: SevenDayListRow[] = [];
    for (const task of tasks) {
        if (task.days === day && task.typeName === typeName) out.push({ kind: 'task', task });
    }
    for (const shop of shops) {
        if (shop.days === day && shop.typeName === typeName) out.push({ kind: 'shop', shop });
    }
    out.sort((a, b) => sortKeyOf(a, state) - sortKeyOf(b, state));
    return out;
}

/** 单行的排序 key（越小越靠前）。 */
export function sortKeyOf(row: SevenDayListRow, state: ISevenDayServerState): number {
    if (row.kind === 'task') {
        const server = state.tasks.get(row.task.resId);
        // 老端：FINISH → 1（最前）；UNDONE → 4；其它（已领 / 无记录）→ 9
        const tier = !server
            ? 9
            : server.rewardState === SEVEN_DAY_STATE_FINISH
                ? 1
                : server.rewardState === SEVEN_DAY_STATE_UNDONE
                    ? 4
                    : 9;
        return tier * 1e8 + row.task.resId;
    }
    // 老端：已售空 → 1（排最后因为…… 不，老端把 1 排最前，与任务相反，照抄）
    const buyTimes = state.shops.get(row.shop.id) ?? 0;
    const tier = buyTimes >= row.shop.limit && row.shop.limit > 0 ? 1 : 2;
    return tier * 1e8 + row.shop.id;
}

// ============================================================
// 状态判定
// ============================================================

/** 任务行的四态（对应 FGUI「任务状态」控制器的四个 page）。 */
export type SevenDayTaskState = 'undone' | 'goto' | 'claimable' | 'taken';

/**
 * 任务行状态。
 *
 * ⚠️ 老端的口径是「**服务端先说话**」：`rewardState === FINISH` 才是可领取；
 * `REWARDED` 已领取；其余（含**没有服务端记录**）统一落到未完成 ——
 * 没记录**不等于**可领取，否则刚进游戏会把所有任务显示成能领。
 * 「可前往」只在未完成且配了 `goto` 时出现。
 */
export function taskStateOf(
    row: ISevenDayTaskRow,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): SevenDayTaskState {
    const server = state.tasks.get(row.resId);
    if (server) {
        if (server.rewardState === SEVEN_DAY_STATE_FINISH) return 'claimable';
        if (server.rewardState === SEVEN_DAY_STATE_REWARDED) return 'taken';
    }
    return row.goto > 0 ? 'goto' : 'undone';
}

/** 任务行的三态。 */
export type SevenDayShopState = 'free' | 'buyable' | 'soldOut';

/**
 * 商品行状态。
 *
 * ⚠️ 判断顺序不能反：**先判售空再判免费**。老端（`LayerSevenday`）也是这个顺序 ——
 * 免费的限量商品买完之后要显示「已售空」而不是继续显示「免费」。
 * `limit <= 0` 视为不限购（不会售空）。
 */
export function shopStateOf(
    row: ISevenDayShopRow,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): SevenDayShopState {
    const buyTimes = state.shops.get(row.id) ?? 0;
    if (row.limit > 0 && buyTimes >= row.limit) return 'soldOut';
    if (row.cost <= 0) return 'free';
    return 'buyable';
}

/** 宝箱的三态（对应 FGUI「状态」控制器）。 */
export type SevenDayBoxState = 'locked' | 'claimable' | 'taken';

/** 宝箱状态：积分够 + 没领过 = 可领取。 */
export function boxStateOf(
    box: ISevenDayPointRow,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): SevenDayBoxState {
    if (state.takenBoxIds.indexOf(box.resId) >= 0) return 'taken';
    return state.point >= box.point ? 'claimable' : 'locked';
}

/**
 * 第 `index` 个宝箱的进度条比例（`0..1`），照抄老端 `LayerSevendayUI.UpdateBox`。
 *
 * 第 0 个：`point / point`；第 N 个：在「上一档积分 → 本档积分」区间里取比例。
 * 老端在 `point < lastRef.point` 时给 `0`，否则会算出负数。
 */
export function boxProgressOf(
    index: number,
    boxes: readonly ISevenDayPointRow[],
    currentPoint: number,
): number {
    const box = boxes[index];
    if (!box || box.point <= 0) return 0;
    if (index === 0) return clamp01(currentPoint / box.point);
    const last = boxes[index - 1];
    if (!last) return clamp01(currentPoint / box.point);
    if (currentPoint < last.point) return 0;
    if (currentPoint >= box.point) return 1;
    const span = box.point - last.point;
    if (span <= 0) return currentPoint >= box.point ? 1 : 0;
    return clamp01((currentPoint - last.point) / span);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

/** 天数按钮是否解锁（第 `day` 天 `<=` 今天）。 */
export function isDayUnlocked(day: number, curDay: number): boolean {
    return day <= curDay;
}

/**
 * 某一天是否有红点（老端 `ModelSevenday.hasRedDot(day)`）。
 *
 * ⚠️ **未开启的天不亮**（2026-09-28 修）：老端循环里有三条硬过滤 ——
 * `ref.days == day` / `ref.days <= curDay` / `rewardState == FINISH`。
 * 本端原先漏了中间那条 ⇒ 服务端把未来天的任务也标成 `FINISH` 时（它确实会这么给），
 * 「第 5 天」这种还没开启的按钮就亮红点了。判据：`tests/seven-day.test.ts` A5。
 *
 * ⚠️ 老端宝箱那段有个**没生效的 bug**：`ids.findIndex(t => { t == ref.resId })`
 * 回调忘了 `return`，恒返回 `-1`，于是「已领取的宝箱」也会被算成未领取
 * （那是 `boxHasRedDot` 的路径，与这里无关）。本端按**正确语义**来（领过就不算）。
 */
export function dayHasRedDot(
    tasks: readonly ISevenDayTaskRow[],
    day: number,
    curDay: number,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): boolean {
    if (day > curDay) return false;                  // 老端 `if (ref.days > curDay) continue;`
    for (const task of tasks) {
        if (task.days !== day) continue;
        const server = state.tasks.get(task.resId);
        if (server && server.rewardState === SEVEN_DAY_STATE_FINISH) return true;
    }
    return false;
}

/** 宝箱区是否有红点。 */
export function boxHasRedDot(
    boxes: readonly ISevenDayPointRow[],
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): boolean {
    for (const box of boxes) {
        if (boxStateOf(box, state) === 'claimable') return true;
    }
    return false;
}

/** 整个活动是否有红点（天数按钮的汇总红点）。 */
export function anyDayHasRedDot(
    tasks: readonly ISevenDayTaskRow[],
    curDay: number,
    state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE,
): boolean {
    for (const task of tasks) {
        if (task.days > curDay) continue;
        const server = state.tasks.get(task.resId);
        if (server && server.rewardState === SEVEN_DAY_STATE_FINISH) return true;
    }
    return false;
}

// ============================================================
// 展示辅助
// ============================================================

/** 任务行进度文案。 */
export function taskProgressText(
    row: ISevenDayTaskRow,
    state: ISevenDayServerState,
    templates: { readonly progress: string; readonly fight: string; readonly unFight: string },
    fightLabel: (level: number) => string | null,
): string {
    const server = state.tasks.get(row.resId);
    if (row.targetType === SEVEN_DAY_TARGET_FIGHT) {
        // 通关类任务：已经完成时不显示进度（老端同）
        if (server && server.rewardState !== SEVEN_DAY_STATE_UNDONE) return '';
        const level = server ? Number(server.count) : 0;
        const label = level > 0 ? fightLabel(level) : null;
        return label ? templates.fight.replace('{0}', label) : templates.unFight;
    }
    const count = server ? Number(server.count) : 0;
    return templates.progress
        .replace('{0}', String(count))
        .replace('{1}', String(row.targetCount));
}

/** 折扣文案；`discount === 10`（不打折）返回空串。 */
export function discountText(discount: number, template: string): string {
    if (!(discount > 0) || discount >= 10) return '';
    return template.replace('{0}', String(discount));
}

/** 天数按钮文案：`第1天`。 */
export function dayLabelOf(day: number, prefix: string, suffix: string): string {
    return `${prefix}${day}${suffix}`;
}

/**
 * `param.count` 与 `targetType` 拼出「当前/目标」以外的兜底文案。
 *
 * 现在只有「通关类特殊、其余走 `taskProgress`」两条路，这个函数留给以后
 * 补别的特殊 `targetType` 时用 —— 保持单一出口，别在界面里写 `if`。
 */
export function isSpecialProgressTarget(targetType: number): boolean {
    return targetType === SEVEN_DAY_TARGET_FIGHT;
}
