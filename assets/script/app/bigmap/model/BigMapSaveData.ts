/**
 * 存档结构 —— **纯数据 + 纯函数**，不碰 `sys.localStorage`（引擎 I/O 在 application 适配器里）。
 *
 * 存档必须能「坏」，所以读盘后一律走 `normalizeBigMapSave` 修一遍：
 * 建筑 id 不认识就丢掉、等级越界就夹住、格子越界就回收、资源 NaN 就回初始值。
 * 宁可少一点进度，也不能让脏存档把玩法卡死。
 */
import {
    BigMapQueueState,
    BIGMAP_RES_ORDER,
    type BigMapResType,
    type IBigMapBaseState,
    type IBigMapBuildingInstance,
    type IBigMapConfig,
    type IBigMapQueueSlot,
} from './BigMapTypes';
import { bigMapPlotCenterHexId, bigMapQueueCapacity, createBigMapBaseState } from './BigMapBase';
import { createBigMapBattleProgress, type IBigMapBattleProgress } from './BigMapBattle';

/** 存档版本：结构变更时 +1，`normalize` 里按版本补字段。 */
export const BIGMAP_SAVE_VERSION = 1;

export interface IBigMapSaveData {
    readonly version: number;
    readonly base: IBigMapBaseState;
    readonly battle: IBigMapBattleProgress;
    /** 上次保存的逻辑秒（离线产出按它算）。 */
    readonly savedAt: number;
}

export function createBigMapSave(config: IBigMapConfig, now: number): IBigMapSaveData {
    return {
        version: BIGMAP_SAVE_VERSION,
        base: createBigMapBaseState(config, now),
        battle: createBigMapBattleProgress(),
        savedAt: now,
    };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sanitizeBuilding(
    raw: unknown,
    config: IBigMapConfig,
    now: number,
): IBigMapBuildingInstance | null {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Partial<IBigMapBuildingInstance>;
    const buildingId = Number(item.buildingId);
    const levels = config.levels.get(buildingId);
    if (!levels) return null;
    const maxLevel = Math.max(...levels.keys());
    const level = clampInt(item.level, 1, maxLevel, 1);
    const plotSize = config.queue.plotRows * config.queue.plotCols;
    const hexId = clampInt(item.hexId, 0, plotSize - 1, bigMapPlotCenterHexId(config.queue.plotRows, config.queue.plotCols));
    const produce = config.produce.get(buildingId)?.get(level);
    const stored = produce ? Math.min(produce.produceCap, Math.max(0, Number(item.stored) || 0)) : 0;
    return {
        instanceId: Math.max(1, Math.round(Number(item.instanceId) || 1)),
        buildingId,
        level,
        hexId,
        stored,
        lastTickAt: Number.isFinite(Number(item.lastTickAt)) ? Number(item.lastTickAt) : now,
    };
}

/** 修档：不认识的东西一律丢，认识的字段一律夹到合法区间。 */
export function normalizeBigMapSave(
    raw: unknown,
    config: IBigMapConfig,
    now: number,
): IBigMapSaveData {
    const fallback = createBigMapSave(config, now);
    if (!raw || typeof raw !== 'object') return fallback;
    const source = raw as Partial<IBigMapSaveData>;
    const baseRaw = source.base as Partial<IBigMapBaseState> | undefined;
    if (!baseRaw || typeof baseRaw !== 'object') return fallback;

    const buildings: IBigMapBuildingInstance[] = [];
    const usedCells = new Set<number>();
    const usedIds = new Set<number>();
    let instanceSeq = 1;
    for (const item of Array.isArray(baseRaw.buildings) ? baseRaw.buildings : []) {
        const sanitized = sanitizeBuilding(item, config, now);
        if (!sanitized) continue;
        // 同格重复 / 同 id 重复都丢掉 —— 这两种脏数据会直接让建造区渲染错位。
        if (usedCells.has(sanitized.hexId) || usedIds.has(sanitized.instanceId)) continue;
        usedCells.add(sanitized.hexId);
        usedIds.add(sanitized.instanceId);
        instanceSeq = Math.max(instanceSeq, sanitized.instanceId);
        buildings.push(sanitized);
    }
    // 没有主城就补一座（否则整条建造链都点不动）。
    if (!buildings.some((item) => item.buildingId === config.mainBuildingId)) {
        const center = bigMapPlotCenterHexId(config.queue.plotRows, config.queue.plotCols);
        if (!usedCells.has(center)) {
            instanceSeq += 1;
            buildings.push({
                instanceId: instanceSeq,
                buildingId: config.mainBuildingId,
                level: 1,
                hexId: center,
                stored: 0,
                lastTickAt: now,
            });
        }
    }

    const queues: IBigMapQueueSlot[] = [];
    for (let index = 0; index < config.queue.maxBuildQueue; index += 1) {
        const rawSlot = Array.isArray(baseRaw.queues)
            ? baseRaw.queues.find((slot) => Number(slot?.slotIndex) === index)
            : undefined;
        const buildingId = Number(rawSlot?.buildingId);
        const valid = rawSlot
            && Number(rawSlot.state) === BigMapQueueState.Building
            && config.buildings.has(buildingId)
            && Number(rawSlot.finishAt) > 0;
        if (!valid) {
            queues.push({
                slotIndex: index, state: BigMapQueueState.Idle, buildingId: 0,
                instanceId: 0, targetLevel: 0, startAt: 0, finishAt: 0,
            });
            continue;
        }
        queues.push({
            slotIndex: index,
            state: BigMapQueueState.Building,
            buildingId,
            instanceId: Math.max(0, Math.round(Number(rawSlot.instanceId) || 0)),
            targetLevel: Math.max(1, Math.round(Number(rawSlot.targetLevel) || 1)),
            anchorHexId: Number.isFinite(Number(rawSlot.anchorHexId)) ? Number(rawSlot.anchorHexId) : undefined,
            startAt: Number(rawSlot.startAt) || now,
            finishAt: Number(rawSlot.finishAt) || now,
        });
    }

    const res = { ...fallback.base.res };
    const rawRes = (baseRaw.res ?? {}) as Record<string, unknown>;
    for (const type of BIGMAP_RES_ORDER) {
        const value = Number(rawRes[type]);
        res[type as BigMapResType] = Number.isFinite(value) && value >= 0 ? value : res[type as BigMapResType];
    }

    const base: IBigMapBaseState = {
        instanceSeq,
        buildings,
        queues,
        // 队列容量由建筑反推（`bigMapQueueCapacity`），不信存档字段：
        // 存档里的 queueUnlocked 一旦被写坏，会出现「有 3 个槽但只显示 1 条」的死状态。
        queueUnlocked: bigMapQueueCapacity(config, buildings),
        res,
        stamina: clampInt(baseRaw.stamina, 0, config.stamina.staminaMax, config.stamina.staminaMax),
        staminaAt: Number.isFinite(Number(baseRaw.staminaAt)) ? Number(baseRaw.staminaAt) : now,
    };

    const battleRaw = (source.battle ?? {}) as Partial<IBigMapBattleProgress>;
    const battle: IBigMapBattleProgress = {
        cityHp: { ...(battleRaw.cityHp ?? {}) },
        cityWarScore: { ...(battleRaw.cityWarScore ?? {}) },
        monsterWarScore: { ...(battleRaw.monsterWarScore ?? {}) },
        // 只保留配置里存在的城池，防止删表后残留脏 id 卡住解锁链。
        occupiedCityIds: (Array.isArray(battleRaw.occupiedCityIds) ? battleRaw.occupiedCityIds : [])
            .map((id) => Number(id))
            .filter((id) => config.cities.has(id)),
        monsterHp: { ...(battleRaw.monsterHp ?? {}) },
        monsterRespawnAt: { ...(battleRaw.monsterRespawnAt ?? {}) },
        clearedMonsterLevel: clampInt(battleRaw.clearedMonsterLevel, 0, 99, 0),
        totalWarScore: Math.max(0, Number(battleRaw.totalWarScore) || 0),
    };

    return {
        version: BIGMAP_SAVE_VERSION,
        base,
        battle,
        savedAt: Number.isFinite(Number(source.savedAt)) ? Number(source.savedAt) : now,
    };
}

/** 序列化：只写必要字段，避免把整份配置/世界塞进存档。 */
export function serializeBigMapSave(save: IBigMapSaveData): string {
    return JSON.stringify({
        version: save.version,
        savedAt: save.savedAt,
        base: {
            instanceSeq: save.base.instanceSeq,
            queueUnlocked: save.base.queueUnlocked,
            res: save.base.res,
            stamina: save.base.stamina,
            staminaAt: save.base.staminaAt,
            buildings: save.base.buildings.map((item) => ({
                instanceId: item.instanceId,
                buildingId: item.buildingId,
                level: item.level,
                hexId: item.hexId,
                stored: item.stored,
                lastTickAt: item.lastTickAt,
            })),
            queues: save.base.queues.map((slot) => ({
                slotIndex: slot.slotIndex,
                state: slot.state,
                buildingId: slot.buildingId,
                instanceId: slot.instanceId,
                targetLevel: slot.targetLevel,
                anchorHexId: slot.anchorHexId,
                startAt: slot.startAt,
                finishAt: slot.finishAt,
            })),
        },
        battle: save.battle,
    });
}

/** 反序列化：解析失败/版本不认识都退回新档，绝不抛错到界面。 */
export function parseBigMapSave(
    text: string | null | undefined,
    config: IBigMapConfig,
    now: number,
): { save: IBigMapSaveData; fresh: boolean } {
    if (!text) return { save: createBigMapSave(config, now), fresh: true };
    try {
        const parsed = JSON.parse(text);
        return { save: normalizeBigMapSave(parsed, config, now), fresh: false };
    } catch {
        return { save: createBigMapSave(config, now), fresh: true };
    }
}
