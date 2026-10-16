/**
 * 「活动 → 每日任务」的数据口径 —— **纯逻辑，不 import `cc`，可在 Node 单测里直接跑**。
 *
 * 移植自老客户端：
 *   配置表 `dayChallengeActTask` / `dayChallengeActTaskProgress` / `activityTab` / `activity`
 *   界面   `client/assets/script/app/game/ctrl/Activity/LayerActivity.ts`
 *          `.../ctrl/Activity/TabDayChallengeActTask.ts`
 *   判定   `.../model/Activity/ModelActivity.ts` + `.../model/vo/Other/VOActivity.ts`
 *
 * 老端这些判定挂在 `ModelMgr` / `VOBagSubset` / DI 容器上，没法单测；这里全部收敛成
 * **传参的纯函数**：表行只做「读字段 + 归一化」，解析失败的行走跳过策略，不抛异常。
 *
 * ## 三张表的形状（`assets/remoteRef/*.json`）
 *   - `dayChallengeActTask`（当前 5 行，列式数组）：`{resId, plan, name, targetType,
 *     param:{count}, order, unlockChapter, goto, reward:[{resId, number}]}`
 *   - `dayChallengeActTaskProgress`（当前 8 行，`{k,v}` 列式）：`{id, priceType, cost,
 *     rewards:[{resId, number}]}`
 *   - `activityTab`：`{id, name, tlType:[活动类型], desc, key}`
 *   - `activity`：`{resId, type, name, plan}` —— **`CmdActivity.activityRefId` 查的是本表的
 *     `resId`，不是 `type`**（见 `VOActivity.GetRefByCmd`），`type` 才是「每日挑战 = 1001」。
 *
 * ## 与老端**刻意不同**的两处
 *   ① **列表排序**：老端 `TabDayChallengeActTask.RefreshList` 的比较器在
 *      「A 无状态 && B 已领取」时会 `detailA.state` 空引用抛异常（实测分支可达）。
 *      这里换成等价的**分级排序**（可领取 → 未完成 → 已领取，组内按 `order`），既保住
 *      「领奖按钮排最前、领完的沉底」这条意图，又不炸。
 *   ② **进度宝箱排布**：老端把「上一档到本档」的区间进度做成一串 **118px 定宽、互相
 *      压盖**的片段（`item.node.zIndex = 100 - index`），因为美术片段是定宽的，档位间隔
 *      一旦不等长，画出来的进度条长度就是错的。这里改成**一根真进度条 + 按 `cost/costMax`
 *      定位的宝箱**（见 `chestRatioOf` / `barRatioOf`），视觉一致且与档位间隔无关。
 */

import { toCount } from '../net/RequestGuard';

/** `activity.type`：每日挑战。 */
export const DAY_CHALLENGE_ACT_TYPE = 1001;

/** 服务器任务状态（`CmdCommonState`）。 */
export const ACTIVITY_STATE_FINISH = 1;
export const ACTIVITY_STATE_REWARDED = 2;

/** 一条奖励：`{ resId, number }`。 */
export interface IActivityReward {
    readonly resId: number;
    readonly number: number;
}

/** `dayChallengeActTask` 的一行（归一化后）。 */
export interface IActivityTaskRow {
    readonly resId: number;
    readonly plan: number;
    readonly name: string;
    readonly targetType: number;
    /** `param.count`：达成条件需要的次数。 */
    readonly count: number;
    readonly order: number;
    readonly unlockChapter: number;
    /** 老端 `CtrlJumpView.JumpType` 的跳转 id。 */
    readonly goto: number;
    readonly rewards: readonly IActivityReward[];
}

/** `dayChallengeActTaskProgress` 的一行（归一化后）—— 一个周活跃进度宝箱。 */
export interface IActivityProgressRow {
    readonly id: number;
    /** 达标所需周活跃积分（**阈值**，不是消耗：领奖不会扣积分）。 */
    readonly cost: number;
    readonly rewards: readonly IActivityReward[];
}

/** `activityTab` 的一行。 */
export interface IActivityTabRow {
    readonly id: number;
    readonly name: string;
    /** 这个页签收纳哪些 `activity.type`。 */
    readonly types: readonly number[];
    readonly desc: string;
    readonly key: string;
}

/**
 * 奖励展示要用的字段 —— `item` 表与 `roleProperty` 表**统一成这一个形状**。
 *
 * ⚠️ 两张表的 `icon` 列**语义不一样**，`iconIsPath` 就是用来区分它们的：
 *   - `item`：存的是**相对 `assets/resources/` 的资源路径**（`icons/item/图标_兵书随机`，规则 56）
 *     ⇒ `iconIsPath = true`；
 *   - `roleProperty`：**没迁过**，存的还是 FGUI 组件名（`图标_活跃度`）⇒ `iconIsPath = false`，
 *     落到 `icons/resource/<name>`（见 `LayerActivityArt.resolveRewardIconRef`）。
 */
export interface IActivityGoodsInfo {
    readonly name: string;
    readonly quality: number;
    readonly icon: string;
    /** `icon` 是否已经是资源路径（见上面的说明）。 */
    readonly iconIsPath: boolean;
}

/** 一条任务的服务器状态（`CmdDayChallengeTask`）。 */
export interface IActivityTaskState {
    readonly process: number;
    /** `CmdCommonState`：0 未完成 / 1 可领取 / 2 已领取。 */
    readonly state: number;
}

/** 每日挑战活动的服务器状态。 */
export interface IActivityServerState {
    /** 活动实例 id（`CmdActivity.openResId`）—— 领奖请求里的 `resId` 就是它。 */
    readonly instanceId: number;
    /** `resId` → 任务进度。 */
    readonly tasks: ReadonlyMap<number, IActivityTaskState>;
    /**
     * `CmdDayChallengeActDetail.tlProgressInfo` 原样保留（下标 = 宝箱下标，1 = 已领）。
     * 老端 `VOActivity.GetDayTaskBoxState(i) = tlProgressInfo[i] || 0`。
     */
    readonly claimedBoxes: readonly number[];
    /** 周活跃积分（`CmdRole.activityCoin`）。 */
    readonly coin: number;
}

/** 服务器上没这个活动实例 / 缓存还是空的时候的兜底。 */
export const EMPTY_ACTIVITY_STATE: IActivityServerState = {
    instanceId: 0,
    tasks: new Map<number, IActivityTaskState>(),
    claimedBoxes: [],
    coin: 0,
};

/** 任务行的按钮三态（多一个 `undone`：既没完成也不知道往哪跳）。 */
export type ActivityTaskPhase = 'goto' | 'claimable' | 'taken' | 'undone';

/** 进度宝箱三态。 */
export type ActivityBoxPhase = 'locked' | 'claimable' | 'taken';

// ============================================================
// 表解析
// ============================================================

/** 读一条奖励数组；非法条目跳过。 */
export function parseRewards(raw: unknown): IActivityReward[] {
    const out: IActivityReward[] = [];
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const resId = toCount(row.resId);
        const number = toCount(row.number);
        if (resId <= 0 || number <= 0) continue;
        out.push({ resId, number });
    }
    return out;
}

/** `dayChallengeActTask` 全表 → 归一化行（按 `order` 升序）。 */
export function parseTaskRows(rows: readonly unknown[]): IActivityTaskRow[] {
    const out: IActivityTaskRow[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        const name = typeof row.name === 'string' ? row.name : '';
        if (resId <= 0 || name.length === 0) continue;
        const param = row.param && typeof row.param === 'object'
            ? (row.param as Record<string, unknown>)
            : null;
        out.push({
            resId,
            plan: toCount(row.plan),
            name,
            targetType: toCount(row.targetType),
            count: param ? toCount(param.count) : 0,
            order: toCount(row.order),
            unlockChapter: toCount(row.unlockChapter),
            goto: toCount(row.goto),
            rewards: parseRewards(row.reward),
        });
    }
    out.sort((a, b) => a.order - b.order || a.resId - b.resId);
    return out;
}

/**
 * `dayChallengeActTaskProgress` 全表 → 归一化行（按 `cost` 升序）。
 *
 * ⚠️ 该表在 `remoteRef` 里是 `{k,v}` 列式（规则 24.1：`k` 的序 = 该列行数降序），
 * 但 `RefUtil.getRefAllAsync` 已经把列式还原成**行对象数组**（表的其它字段也一样），
 * 所以这里按行对象读，别自己去解 `k`/`v`。
 */
export function parseProgressRows(rows: readonly unknown[]): IActivityProgressRow[] {
    const out: IActivityProgressRow[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const id = toCount(row.id);
        const cost = toCount(row.cost);
        if (id <= 0 || cost <= 0) continue;
        out.push({ id, cost, rewards: parseRewards(row.rewards) });
    }
    out.sort((a, b) => a.cost - b.cost || a.id - b.id);
    return out;
}

/** `activityTab` 全表 → 归一化行（按 `id` 升序）。 */
export function parseTabRows(rows: readonly unknown[]): IActivityTabRow[] {
    const out: IActivityTabRow[] = [];
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const id = toCount(row.id);
        if (id <= 0) continue;
        const types: number[] = [];
        if (Array.isArray(row.tlType)) {
            for (const type of row.tlType) {
                const value = toCount(type);
                if (value > 0) types.push(value);
            }
        }
        out.push({
            id,
            name: typeof row.name === 'string' ? row.name : '',
            types,
            desc: typeof row.desc === 'string' ? row.desc : '',
            key: typeof row.key === 'string' ? row.key : '',
        });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}

/**
 * `item` 全表 → `resId` → 展示字段。
 *
 * ⚠️ `item.icon` 现在存的是**相对 `assets/resources/` 的资源路径**（规则 56）⇒ `iconIsPath = true`。
 * 解析交给 `LayerActivityArt.resolveRewardIconRef`（只认 `icons/` 前缀）。这里只搬字段。
 */
export function parseItemRows(rows: readonly unknown[]): Map<number, IActivityGoodsInfo> {
    const map = new Map<number, IActivityGoodsInfo>();
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        map.set(resId, {
            name: typeof row.name === 'string' ? row.name : '',
            quality: toCount(row.quality),
            icon: typeof row.icon === 'string' ? row.icon : '',
            iconIsPath: true,
        });
    }
    return map;
}

/**
 * `roleProperty` 全表 → `resId` → 展示字段（**货币 / 属性类**，`item` 表里没有它们）。
 *
 * 老端这一类走 `ModelGoods.GetGoodsIconKeyByRefId` 的 `GoodsType.playerAtt` 分支
 * （`RefMgrroleProperty.getRef("resId", refId).icon`）。每日任务的奖励里就混着它们：
 * 银币 7 / 洗炼石 8 / 金币 10 / **活跃度 15（每条任务都奖励它）**。
 * 只搬 `item` 那一支的话，10 个奖励格里 8 个会**只剩品质框、没有图标**。
 *
 * ⚠️ `roleProperty.icon` 还是 FGUI 组件名（`图标_活跃度`），**不是**资源路径 ⇒ `iconIsPath = false`。
 */
export function parseRolePropertyRows(rows: readonly unknown[]): Map<number, IActivityGoodsInfo> {
    const map = new Map<number, IActivityGoodsInfo>();
    for (const raw of rows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        map.set(resId, {
            name: typeof row.name === 'string' ? row.name : '',
            quality: toCount(row.quality),
            icon: typeof row.icon === 'string' ? row.icon : '',
            iconIsPath: false,
        });
    }
    return map;
}

/**
 * 一个奖励 `resId` 的展示信息：`item` 表优先，查不到再回落 `roleProperty`。
 *
 * 等价于老端 `ModelGoods.GetGoodsIconKeyByRefId` 的两支分流（`playerAtt` 走 `roleProperty`，
 * 其余 `CreateGoods(resId).GetIconKey()` 走 `item`）。两张表都查不到返回 `null`，
 * 调用方按「品质 1 + 只画品质框」降级。
 */
export function rewardGoodsOf(
    resId: number,
    items: ReadonlyMap<number, IActivityGoodsInfo>,
    resources: ReadonlyMap<number, IActivityGoodsInfo>,
): IActivityGoodsInfo | null {
    return items.get(resId) ?? resources.get(resId) ?? null;
}

/** 取「每日任务」那个页签（`tlType` 含 1001）；没有返回 `null`。 */
export function findDayChallengeTab(tabs: readonly IActivityTabRow[]): IActivityTabRow | null {
    for (const tab of tabs ?? []) {
        if (tab.types.includes(DAY_CHALLENGE_ACT_TYPE)) return tab;
    }
    return null;
}

// ============================================================
// 服务器状态
// ============================================================

/**
 * 从缓存里的 `CmdActivity` 全表 + `activity` 表，抽出每日挑战活动的状态。
 *
 * 老端对应 `ModelActivity.GetVoActivitySubSet(evenyDay)` 的过滤 + `VOActivity.Get*`：
 *   ① `activity` 表按 `resId` 建索引（`activityRefId` 查的是它）；
 *   ② 只收 `type === 1001` 的那条 `CmdActivity`；
 *   ③ 任务进度 / 已领宝箱 / 实例 id 全部从它身上取。
 *
 * 找不到（活动没开、或还没登录同步）返回 `EMPTY_ACTIVITY_STATE`（`instanceId === 0`）。
 */
export function normalizeActivityState(
    activityCmds: readonly unknown[],
    activityRows: readonly unknown[],
): IActivityServerState {
    const typeByResId = new Map<number, number>();
    for (const raw of activityRows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        typeByResId.set(resId, toCount(row.type));
    }

    for (const raw of activityCmds ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const cmd = raw as Record<string, unknown>;
        if (typeByResId.get(toCount(cmd.activityRefId)) !== DAY_CHALLENGE_ACT_TYPE) continue;

        const detailWrap = cmd.detail && typeof cmd.detail === 'object'
            ? (cmd.detail as Record<string, unknown>)
            : null;
        const detailRaw = detailWrap?.dayChallengeActDetail;
        const detail = detailRaw && typeof detailRaw === 'object'
            ? (detailRaw as Record<string, unknown>)
            : null;

        const tasks = new Map<number, IActivityTaskState>();
        if (Array.isArray(detail?.tlDayChallengeTask)) {
            for (const item of detail.tlDayChallengeTask as unknown[]) {
                if (!item || typeof item !== 'object') continue;
                const row = item as Record<string, unknown>;
                const resId = toCount(row.resId);
                if (resId <= 0) continue;
                tasks.set(resId, { process: toCount(row.process), state: toCount(row.state) });
            }
        }

        const claimedBoxes: number[] = [];
        if (Array.isArray(detail?.tlProgressInfo)) {
            for (const value of detail.tlProgressInfo as unknown[]) claimedBoxes.push(toCount(value));
        }

        return {
            instanceId: toCount(cmd.openResId),
            tasks,
            claimedBoxes,
            // `activityCoin` 挂在 CmdRole 上，不在这里；由 `activityCoinOf` 单独读。
            coin: 0,
        };
    }
    return EMPTY_ACTIVITY_STATE;
}

/**
 * 周活跃积分（`CmdRole.activityCoin`，proto 字段 47）。
 *
 * 老端 `TabDayChallengeActTask.RefreshView` 是 `role.GetCmd().activityCoin || 0`，
 * 一条都读不到时返回 0（而不是抛）。
 */
export function activityCoinOf(roleRows: readonly unknown[]): number {
    for (const raw of roleRows ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const coin = toCount((raw as Record<string, unknown>).activityCoin);
        if (coin > 0) return coin;
    }
    return 0;
}

// ============================================================
// 任务行
// ============================================================

/** 某条任务现在的状态。 */
export function taskPhaseOf(task: IActivityTaskRow, state: IActivityServerState): ActivityTaskPhase {
    const server = state.tasks.get(task.resId);
    // 服务器没下发这一条 = 还没开始做（老端 `detail == null` 也按「未完成 + 进度 0」显示）
    if (!server) return task.goto > 0 ? 'goto' : 'undone';
    if (server.state === ACTIVITY_STATE_REWARDED) return 'taken';
    if (server.state === ACTIVITY_STATE_FINISH) return 'claimable';
    return task.goto > 0 ? 'goto' : 'undone';
}

/** 进度文案：`{name} (161/666)`；模板由调用方给（`ACTIVITY_TEXTS.taskProgress`）。 */
export function taskProgressText(
    task: IActivityTaskRow,
    state: IActivityServerState,
    template: string,
): string {
    const process = state.tasks.get(task.resId)?.process ?? 0;
    return task.name + template.replace('{0}', String(process)).replace('{1}', String(task.count));
}

export function taskHasRedDot(task: IActivityTaskRow, state: IActivityServerState): boolean {
    return taskPhaseOf(task, state) === 'claimable';
}

/**
 * 列表排序：可领取(0) → 未完成(1) → 已领取(2)，组内保持表里的 `order`。
 *
 * 老端意图写在它的比较器注释里（`state=2 已完成放到最后，state=1 可领取放到最前边`），
 * 但实现里有无状态时 `detailA.state` 空引用的分支，这里换成无异常的分级排序。
 */
export function sortTasksForDisplay(
    tasks: readonly IActivityTaskRow[],
    state: IActivityServerState,
): IActivityTaskRow[] {
    const rankOf = (task: IActivityTaskRow): number => {
        const phase = taskPhaseOf(task, state);
        if (phase === 'claimable') return 0;
        if (phase === 'taken') return 2;
        return 1;
    };
    return (tasks ?? []).slice().sort((a, b) => rankOf(a) - rankOf(b) || a.order - b.order);
}

// ============================================================
// 周活跃进度宝箱
// ============================================================

/** 下标 `index` 的宝箱是否已被服务器标记为「已领取」。 */
export function boxClaimed(index: number, state: IActivityServerState): boolean {
    const raw = state.claimedBoxes[index];
    return toCount(raw) === 1;
}

/**
 * 宝箱状态。
 *
 * 老端先判 `activityCoin < cost` → 不可领取，再判已领 / 可领。因为 `cost` 是阈值
 * （不是消耗，领奖不扣积分）且积分单调不减，所以两种顺序等价；这里先判已领，
 * 语义更直白，也不会出现「领过了却因为积分配置被改小而显示成不可领」。
 */
export function boxPhaseOf(
    row: IActivityProgressRow,
    index: number,
    state: IActivityServerState,
): ActivityBoxPhase {
    if (boxClaimed(index, state)) return 'taken';
    return state.coin >= row.cost ? 'claimable' : 'locked';
}

/** 最高一档的门槛；空表返回 0。 */
export function lastBoxCost(rows: readonly IActivityProgressRow[]): number {
    let max = 0;
    for (const row of rows ?? []) {
        if (row.cost > max) max = row.cost;
    }
    return max;
}

/** 一个宝箱在进度条上的位置（`0..1`）。 */
export function chestRatioOf(row: IActivityProgressRow, costMax: number): number {
    if (!(costMax > 0)) return 0;
    return clamp01(row.cost / costMax);
}

/** 进度条填充比例（`0..1`）：当前积分 / 最高档门槛。 */
export function barRatioOf(state: IActivityServerState, rows: readonly IActivityProgressRow[]): number {
    const max = lastBoxCost(rows);
    if (!(max > 0)) return 0;
    return clamp01(state.coin / max);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value >= 1 ? 1 : value;
}

// ============================================================
// 周活跃积分的读写（跨帧比较用）
// ============================================================

/** 把「已领宝箱」压成一个可比较的字符串（调试 / 判定是否需要重铺界面）。 */
export function stateSignatureOf(state: IActivityServerState): string {
    const parts: string[] = [String(state.instanceId), String(state.coin)];
    const ids = Array.from(state.tasks.keys()).sort((a, b) => a - b);
    for (const id of ids) {
        const row = state.tasks.get(id)!;
        parts.push(`${id}:${row.process}:${row.state}`);
    }
    parts.push(`box:${state.claimedBoxes.join(',')}`);
    return parts.join('|');
}
