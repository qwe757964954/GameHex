/**
 * 基地建造与资源产出 —— **纯规则，零 `cc` 依赖**。
 *
 * 覆盖文档「建造系统」一~七条 + 「玩家基地系统」的资源口径：
 * - 六边建造区按格摆放、不可重叠（`occupyHex` 支持多格建筑）；
 * - 建筑解锁**只来自冒险章节**（判定在 `BigMapUnlock`，这里只消费结果）；
 * - 建造队列（默认 1、最多 3），队列里同一时间只能有一个动作；
 * - 升级前置（`preBuildId` / `preBuildLevel`）与主城等级上限（`maxOtherLevel`）；
 * - 资源田主动收获、累积上限 `produceCap`、资源栏上限受主城 `resCap` 控制；
 * - 离线结算按 `offlineMaxHours` 截断，避免离线一个月回来爆仓。
 *
 * 所有写操作都是 **state in → new state out**（不改入参），这样 Presenter 可以先算一遍
 * 预览值再决定要不要提交，也方便单测。
 */
import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import {
    BigMapBuildingKind,
    BigMapQueueState,
    BIGMAP_BUILD_RES,
    type BigMapResType,
    type IBigMapBuildingConfig,
    type IBigMapBuildingInstance,
    type IBigMapConfig,
    type IBigMapBaseState,
    type IBigMapQueueSlot,
    type IBigMapActionResult,
} from './BigMapTypes';
import { bigMapBuildingUnlock, bigMapUpgradeUnlock, type IBigMapUnlockContext } from './BigMapUnlock';

/** 建造区格 id：`row * plotCols + column`，与大地图格 id 分开编号。 */
export function bigMapPlotHexId(row: number, column: number, plotCols: number): number {
    return row * plotCols + column;
}

/** 建造区中心格（主城默认位置）。行列是奇数，中心格唯一。 */
export function bigMapPlotCenterHexId(plotRows: number, plotCols: number): number {
    return Math.floor(plotRows / 2) * plotCols + Math.floor(plotCols / 2);
}

/** 建造区内的邻居（复用对局的六边拓扑，保证与大地图观感一致）。 */
export function bigMapPlotNeighbors(hexId: number, plotRows: number, plotCols: number): readonly number[] {
    return hexGridNeighborIds(hexId, plotRows, plotCols);
}

function emptyRes(): Record<BigMapResType, number> {
    return { grain: 0, wood: 0, iron: 0, coin: 0, stamina: 0 };
}

/** 新号初始状态：资源取 `startAmount`，主城自动落在中心格（避免开局空场地寸步难行）。 */
export function createBigMapBaseState(config: IBigMapConfig, now: number): IBigMapBaseState {
    const res = emptyRes();
    for (const item of config.resources.values()) res[item.resType] = item.startAmount;
    const center = bigMapPlotCenterHexId(config.queue.plotRows, config.queue.plotCols);
    const main: IBigMapBuildingInstance = {
        instanceId: 1,
        buildingId: config.mainBuildingId,
        level: 1,
        hexId: center,
        stored: 0,
        lastTickAt: now,
    };
    const queues: IBigMapQueueSlot[] = [];
    for (let index = 0; index < config.queue.maxBuildQueue; index += 1) {
        queues.push({
            slotIndex: index,
            state: BigMapQueueState.Idle,
            buildingId: 0,
            instanceId: 0,
            targetLevel: 0,
            startAt: 0,
            finishAt: 0,
        });
    }
    return {
        instanceSeq: 1,
        buildings: [main],
        queues,
        queueUnlocked: config.queue.initBuildQueue,
        res,
        stamina: config.stamina.staminaMax,
        staminaAt: now,
    };
}

// ------------------------------------------------------------------ 查询

export function bigMapMainBuilding(
    config: IBigMapConfig,
    state: IBigMapBaseState,
): IBigMapBuildingInstance | null {
    return state.buildings.find((item) => item.buildingId === config.mainBuildingId) ?? null;
}

export function bigMapMainLevel(config: IBigMapConfig, state: IBigMapBaseState): number {
    return bigMapMainBuilding(config, state)?.level ?? 0;
}

export function bigMapBuildingCount(state: IBigMapBaseState, buildingId: number): number {
    return state.buildings.filter((item) => item.buildingId === buildingId).length;
}

/**
 * 含**排队中**的数量上限口径。
 *
 * 只数 `buildings` 会漏掉「3 个队列同时排 3 座同名建筑」的情况：
 * 上限是 1 的建筑（主城）会被排成 3 座，等落地时才炸。
 */
export function bigMapBuildingCountWithQueue(state: IBigMapBaseState, buildingId: number): number {
    const queued = state.queues.filter((slot) => (
        slot.state === BigMapQueueState.Building && slot.instanceId === 0 && slot.buildingId === buildingId
    )).length;
    return bigMapBuildingCount(state, buildingId) + queued;
}

/** 资源栏上限：主城 `resCap` 控制建造三种资源；货币与行动力各有自己的上限。 */
export function bigMapResCap(config: IBigMapConfig, state: IBigMapBaseState, res: BigMapResType): number {
    if (res === 'stamina') return config.stamina.staminaMax;
    if (res === 'coin') return Number.POSITIVE_INFINITY;
    const level = bigMapMainLevel(config, state);
    const levelConfig = config.levels.get(config.mainBuildingId)?.get(level);
    return levelConfig ? levelConfig.resCap : Number.POSITIVE_INFINITY;
}

function occupyCells(
    config: IBigMapConfig,
    buildingId: number,
    anchorHexId: number,
): readonly number[] {
    const configBuilding = config.buildings.get(buildingId);
    const size = Math.max(1, configBuilding?.occupyHex ?? 1);
    const rows = config.queue.plotRows;
    const cols = config.queue.plotCols;
    if (size === 1) return [anchorHexId];
    // 多格建筑从锚点向外 BFS 扩张；越界格由调用方按建造区尺寸拦掉。
    const cells: number[] = [];
    const queue: number[] = [anchorHexId];
    const seen = new Set<number>();
    while (queue.length > 0 && cells.length < size) {
        const hexId = queue.shift()!;
        if (seen.has(hexId) || hexId < 0 || hexId >= rows * cols) continue;
        seen.add(hexId);
        cells.push(hexId);
        for (const neighbor of bigMapPlotNeighbors(hexId, rows, cols)) queue.push(neighbor);
    }
    return cells;
}

/**
 * 队列容量：初始 1 条，每建成一座「建造队列」功能建筑 +1，封顶 `maxBuildQueue`。
 *
 * **由建筑反推**而不是只信存档里的 `queueUnlocked` —— 存档字段会被脏数据写坏，
 * 而「你建了几座队列建筑」永远和界面显示一致，推出来不会漂。
 * 本期唯一的功能建筑就是「建造队列」(71007)，按 `kind = Function` 匹配，换 id 不用改代码。
 */
export function bigMapQueueCapacity(
    config: IBigMapConfig,
    buildings: readonly IBigMapBuildingInstance[],
): number {
    const extra = buildings.filter((item) => (
        config.buildings.get(item.buildingId)?.kind === BigMapBuildingKind.Function
    )).length;
    return Math.min(config.queue.maxBuildQueue, config.queue.initBuildQueue + extra);
}

/** 建造区占位检查：返回被占用的格（含自己，升级时用 `ignoreInstanceId` 排除）。 */
function occupiedPlotCells(state: IBigMapBaseState, ignoreInstanceId = 0): Set<number> {
    const cells = new Set<number>();
    for (const item of state.buildings) {
        if (item.instanceId === ignoreInstanceId) continue;
        cells.add(item.hexId);
    }
    // 建造中的队列也占位（防止排队时同一格被摆两次）。
    for (const queue of state.queues) {
        if (queue.state === BigMapQueueState.Building && queue.instanceId === 0) {
            cells.add(queue.anchorHexId ?? -1);
        }
    }
    cells.delete(-1);
    return cells;
}

export function bigMapFreeQueueSlot(state: IBigMapBaseState): IBigMapQueueSlot | null {
    for (let index = 0; index < state.queueUnlocked; index += 1) {
        const slot = state.queues[index];
        if (slot && slot.state === BigMapQueueState.Idle) return slot;
    }
    return null;
}

/** 摆放合法性：解锁 → 数量上限 → 建造区边界 → 占位 → 空闲队列 → 资源。 */
export function bigMapCanPlace(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    unlock: IBigMapUnlockContext,
    buildingId: number,
    hexId: number,
): IBigMapActionResult {
    const building = config.buildings.get(buildingId);
    if (!building) return { ok: false, reason: `建筑 ${buildingId} 不存在` };
    const unlocked = bigMapBuildingUnlock(building, unlock);
    if (!unlocked.unlocked) return { ok: false, reason: unlocked.reason };
    if (bigMapBuildingCountWithQueue(state, buildingId) >= building.maxOwnNum) {
        return { ok: false, reason: `${building.name}最多建造 ${building.maxOwnNum} 个` };
    }
    const plotSize = config.queue.plotRows * config.queue.plotCols;
    const cells = occupyCells(config, buildingId, hexId);
    if (cells.length < building.occupyHex) return { ok: false, reason: '建造区空间不足' };
    if (cells.some((cell) => cell < 0 || cell >= plotSize)) return { ok: false, reason: '超出建造区' };
    const taken = occupiedPlotCells(state);
    if (cells.some((cell) => taken.has(cell))) return { ok: false, reason: '该位置已有建筑' };
    if (!bigMapFreeQueueSlot(state)) return { ok: false, reason: '建造队列已满' };
    const cost = config.levels.get(buildingId)?.get(1);
    if (!cost) return { ok: false, reason: '缺少 1 级建造配置' };
    const lack = bigMapMissingRes(state, cost);
    if (lack) return { ok: false, reason: `资源不足：${lack}` };
    return { ok: true, reason: '' };
}

function bigMapMissingRes(
    state: IBigMapBaseState,
    cost: { readonly costGrain: number; readonly costWood: number; readonly costIron: number },
): string {
    const need: [BigMapResType, number][] = [
        ['grain', cost.costGrain], ['wood', cost.costWood], ['iron', cost.costIron],
    ];
    const lack = need.filter(([res, amount]) => state.res[res] < amount);
    if (lack.length === 0) return '';
    return lack.map(([res, amount]) => `${res} 差 ${amount - state.res[res]}`).join('、');
}

function payRes(
    res: Readonly<Record<BigMapResType, number>>,
    cost: { readonly costGrain: number; readonly costWood: number; readonly costIron: number },
): Record<BigMapResType, number> {
    return {
        ...res,
        grain: res.grain - cost.costGrain,
        wood: res.wood - cost.costWood,
        iron: res.iron - cost.costIron,
    };
}

/** 升级合法性：功能未解锁 → 满级 → 前置建筑等级 → 主城等级上限 → 资源 → 队列。 */
export function bigMapCanUpgrade(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    unlock: IBigMapUnlockContext,
    instanceId: number,
): IBigMapActionResult {
    const feature = bigMapUpgradeUnlock(config, unlock);
    if (!feature.unlocked) return { ok: false, reason: feature.reason };
    const instance = state.buildings.find((item) => item.instanceId === instanceId);
    if (!instance) return { ok: false, reason: '建筑不存在' };
    const levels = config.levels.get(instance.buildingId);
    const next = levels?.get(instance.level + 1);
    if (!next) return { ok: false, reason: '已达到最高等级' };
    if (state.queues.some((queue) => queue.state === BigMapQueueState.Building
        && queue.instanceId === instanceId)) {
        return { ok: false, reason: '该建筑正在升级中' };
    }
    // 主城之外：不得超过主城当前等级，也不得低于前置建筑等级。
    if (instance.buildingId !== config.mainBuildingId) {
        if (instance.level + 1 > bigMapMainLevel(config, state)) {
            return { ok: false, reason: '受主城等级限制' };
        }
    }
    if (next.preBuildId !== 0) {
        const pre = state.buildings.find((item) => item.buildingId === next.preBuildId);
        if (!pre || pre.level < next.preBuildLevel) {
            const preName = config.buildings.get(next.preBuildId)?.name ?? '前置建筑';
            return { ok: false, reason: `需先将${preName}升到 ${next.preBuildLevel} 级` };
        }
    }
    if (!bigMapFreeQueueSlot(state)) return { ok: false, reason: '建造队列已满' };
    const lack = bigMapMissingRes(state, next);
    if (lack) return { ok: false, reason: `资源不足：${lack}` };
    return { ok: true, reason: '' };
}

// ------------------------------------------------------------------ 提交动作

function fillQueue(
    state: IBigMapBaseState,
    slotIndex: number,
    patch: Partial<IBigMapQueueSlot>,
): IBigMapQueueSlot[] {
    return state.queues.map((slot) => (slot.slotIndex === slotIndex ? { ...slot, ...patch } : slot));
}

/** 排队建造。扣资源在下单瞬间完成（取消只退 `cancelReturnRate`）。 */
export function bigMapStartBuild(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    unlock: IBigMapUnlockContext,
    buildingId: number,
    hexId: number,
    now: number,
): IBigMapActionResult {
    const check = bigMapCanPlace(config, state, unlock, buildingId, hexId);
    if (!check.ok) return check;
    const slot = bigMapFreeQueueSlot(state)!;
    const cost = config.levels.get(buildingId)!.get(1)!;
    return {
        ok: true,
        reason: '',
        state: {
            ...state,
            res: payRes(state.res, cost),
            queues: fillQueue(state, slot.slotIndex, {
                state: BigMapQueueState.Building,
                buildingId,
                instanceId: 0,
                targetLevel: 1,
                anchorHexId: hexId,
                startAt: now,
                finishAt: now + cost.buildTime,
            }),
        },
    };
}

/** 排队升级。 */
export function bigMapStartUpgrade(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    unlock: IBigMapUnlockContext,
    instanceId: number,
    now: number,
): IBigMapActionResult {
    const check = bigMapCanUpgrade(config, state, unlock, instanceId);
    if (!check.ok) return check;
    const instance = state.buildings.find((item) => item.instanceId === instanceId)!;
    const slot = bigMapFreeQueueSlot(state)!;
    const next = config.levels.get(instance.buildingId)!.get(instance.level + 1)!;
    return {
        ok: true,
        reason: '',
        state: {
            ...state,
            res: payRes(state.res, next),
            queues: fillQueue(state, slot.slotIndex, {
                state: BigMapQueueState.Building,
                buildingId: instance.buildingId,
                instanceId,
                targetLevel: instance.level + 1,
                anchorHexId: instance.hexId,
                startAt: now,
                finishAt: now + next.buildTime,
            }),
        },
    };
}

/** 取消建造：按 `cancelReturnRate` 返还（配置 1.0 = 全退，本期就是全退）。 */
export function bigMapCancelQueue(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    slotIndex: number,
): IBigMapActionResult {
    const slot = state.queues.find((item) => item.slotIndex === slotIndex);
    if (!slot || slot.state !== BigMapQueueState.Building) {
        return { ok: false, reason: '该队列没有进行中的建造' };
    }
    const cost = config.levels.get(slot.buildingId)?.get(slot.targetLevel);
    const rate = config.queue.cancelReturnRate;
    const res = { ...state.res };
    if (cost) {
        res.grain += Math.floor(cost.costGrain * rate);
        res.wood += Math.floor(cost.costWood * rate);
        res.iron += Math.floor(cost.costIron * rate);
    }
    return {
        ok: true,
        reason: '',
        state: {
            ...state,
            res,
            queues: fillQueue(state, slotIndex, {
                state: BigMapQueueState.Idle,
                buildingId: 0,
                instanceId: 0,
                targetLevel: 0,
                anchorHexId: undefined,
                startAt: 0,
                finishAt: 0,
            }),
        },
    };
}

// ------------------------------------------------------------------ 结算

/**
 * 时间推进：结算资源田累积 + 完成到期的建造队列。
 *
 * `now` 是逻辑秒（`Date.now()/1000` 或测试假的时钟），离线返回时直接传真实时间即可，
 * 中间的小时差由各资源田的 `produceCap` 与 `offlineMaxHours` 共同封顶。
 */
export function bigMapTick(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    now: number,
): { state: IBigMapBaseState; completed: readonly IBigMapBuildingInstance[] } {
    const elapsed = Math.max(0, now - state.staminaAt);
    let next: IBigMapBaseState = state;

    // 1) 队列：到期即落地（新建 → 生成实例；升级 → 提升等级）。
    const completed: IBigMapBuildingInstance[] = [];
    let buildings = next.buildings;
    let instanceSeq = next.instanceSeq;
    const queues = next.queues.map((slot) => {
        if (slot.state !== BigMapQueueState.Building || slot.finishAt > now) return slot;
        if (slot.instanceId === 0) {
            instanceSeq += 1;
            const created: IBigMapBuildingInstance = {
                instanceId: instanceSeq,
                buildingId: slot.buildingId,
                level: slot.targetLevel,
                hexId: slot.anchorHexId ?? bigMapPlotCenterHexId(config.queue.plotRows, config.queue.plotCols),
                stored: 0,
                lastTickAt: slot.finishAt,
            };
            buildings = [...buildings, created];
            completed.push(created);
        } else {
            buildings = buildings.map((item) => {
                if (item.instanceId !== slot.instanceId) return item;
                const upgraded: IBigMapBuildingInstance = { ...item, level: slot.targetLevel, lastTickAt: slot.finishAt };
                completed.push(upgraded);
                return upgraded;
            });
        }
        return {
            ...slot,
            state: BigMapQueueState.Idle,
            buildingId: 0,
            instanceId: 0,
            targetLevel: 0,
            anchorHexId: undefined,
            startAt: 0,
            finishAt: 0,
        };
    });

    // 2) 资源田：按秒累积，封顶 `produceCap`（离线再久也不会超过单块上限）。
    const maxOffline = config.queue.offlineMaxHours * 3600;
    const fields = buildings.map((item) => {
        const produce = config.produce.get(item.buildingId)?.get(item.level);
        if (!produce) return item;
        const span = Math.min(maxOffline, Math.max(0, now - item.lastTickAt));
        if (span <= 0) return { ...item, lastTickAt: now };
        const gained = produce.producePerHour * span / 3600;
        return {
            ...item,
            stored: Math.min(produce.produceCap, item.stored + gained),
            lastTickAt: now,
        };
    });

    // 3) 行动力恢复：每 `recoverInterval` 秒 1 点，封顶 `staminaMax`。
    const regen = Math.floor(elapsed / config.stamina.recoverInterval);
    const stamina = Math.min(config.stamina.staminaMax, next.stamina + regen);
    const staminaAt = regen > 0
        ? next.staminaAt + regen * config.stamina.recoverInterval
        : next.staminaAt;

    next = {
        ...next,
        buildings: fields,
        queues,
        // 队列容量随「建造队列」建筑落地而增加：这里必须重算，否则建完队列建筑还要等存档
        // 再读一次才生效（玩家会以为白建了）。
        queueUnlocked: bigMapQueueCapacity(config, fields),
        instanceSeq,
        stamina,
        staminaAt,
    };
    return { state: next, completed };
}

/** 收获一块资源田（`stored → res`，并受资源栏上限截断）。 */
export function bigMapHarvest(
    config: IBigMapConfig,
    state: IBigMapBaseState,
    instanceId: number,
): { state: IBigMapBaseState; resType: BigMapResType | null; amount: number; capped: boolean } {
    const instance = state.buildings.find((item) => item.instanceId === instanceId);
    const produce = instance ? config.produce.get(instance.buildingId)?.get(instance.level) : undefined;
    if (!instance || !produce || instance.stored <= 0) {
        return { state, resType: null, amount: 0, capped: false };
    }
    const cap = bigMapResCap(config, state, produce.resType);
    const room = Math.max(0, cap - state.res[produce.resType]);
    const amount = Math.floor(Math.min(room, instance.stored));
    const capped = amount < Math.floor(instance.stored);
    const res = { ...state.res, [produce.resType]: state.res[produce.resType] + amount };
    return {
        state: {
            ...state,
            res,
            buildings: state.buildings.map((item) => (
                item.instanceId === instanceId ? { ...item, stored: item.stored - amount } : item
            )),
        },
        resType: produce.resType,
        amount,
        capped,
    };
}

/** 一键收获全部资源田（顶栏「收取」按钮）。 */
export function bigMapHarvestAll(
    config: IBigMapConfig,
    state: IBigMapBaseState,
): { state: IBigMapBaseState; gained: Readonly<Record<BigMapResType, number>> } {
    const gained = emptyRes();
    let next = state;
    for (const instance of [...state.buildings]) {
        const result = bigMapHarvest(config, next, instance.instanceId);
        if (result.resType && result.amount > 0) gained[result.resType] += result.amount;
        next = result.state;
    }
    return { state: next, gained };
}

/** 基地总产出（每小时），给界面显示「+x/时」。 */
export function bigMapProducePerHour(
    config: IBigMapConfig,
    state: IBigMapBaseState,
): Readonly<Record<BigMapResType, number>> {
    const total = emptyRes();
    for (const instance of state.buildings) {
        const produce = config.produce.get(instance.buildingId)?.get(instance.level);
        if (produce) total[produce.resType] += produce.producePerHour;
    }
    return total;
}

/** 未收取的资源总量（顶栏红点用）。 */
export function bigMapPendingHarvest(
    config: IBigMapConfig,
    state: IBigMapBaseState,
): Readonly<Record<BigMapResType, number>> {
    const pending = emptyRes();
    for (const instance of state.buildings) {
        const produce = config.produce.get(instance.buildingId)?.get(instance.level);
        if (produce) pending[produce.resType] += instance.stored;
    }
    return pending;
}

/** 建造资源是否够付某个等级的钱（界面置灰用，不产生副作用）。 */
export function bigMapCanAfford(
    state: IBigMapBaseState,
    cost: { readonly costGrain: number; readonly costWood: number; readonly costIron: number },
): boolean {
    return BIGMAP_BUILD_RES.every((res) => {
        if (res === 'grain') return state.res.grain >= cost.costGrain;
        if (res === 'wood') return state.res.wood >= cost.costWood;
        return state.res.iron >= cost.costIron;
    });
}

/** 建筑展示名（视图直接用，省得每处都 get 一次配置）。 */
export function bigMapBuildingName(config: IBigMapConfig, buildingId: number): string {
    return config.buildings.get(buildingId)?.name ?? '未知建筑';
}

/** 建筑配置（视图取图标/占格用）。 */
export function bigMapBuildingConfig(
    config: IBigMapConfig,
    buildingId: number,
): IBigMapBuildingConfig | null {
    return config.buildings.get(buildingId) ?? null;
}
