import { BigMapQueueState, type IBigMapBaseState, type IBigMapConfig } from './BigMapTypes';

export interface IBigMapServerBuild {
    readonly instanceId: number;
    readonly buildingId: number;
    readonly position: number;
    readonly level: number;
    readonly state: number;
    readonly finishAt: number;
}

export interface IBigMapServerQueue {
    readonly queueId: number;
    readonly type: number;
    readonly instanceId: number;
}

export interface IBigMapServerBuildInfo {
    readonly builds: readonly IBigMapServerBuild[];
    readonly queues: readonly IBigMapServerQueue[];
    readonly unlockQueue: number;
}

export function bigMapServerRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function bigMapServerUint(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
}

/** 协议实例ID是正数uint32；边界拒绝旧Long/字符串和越界值，避免编码时静默截断。 */
export function bigMapServerInstanceId(value: unknown): number | null {
    const id = bigMapServerUint(value);
    return id !== null && id > 0 ? id : null;
}

export function normalizeBigMapBuild(value: unknown): IBigMapServerBuild | null {
    const row = bigMapServerRecord(value);
    if (!row) return null;
    const instanceId = bigMapServerInstanceId(row.buildInstId);
    const buildingId = bigMapServerUint(row.buildingId);
    const position = bigMapServerUint(row.position);
    const level = bigMapServerUint(row.level);
    const state = bigMapServerUint(row.state);
    const finishAt = bigMapServerUint(row.finishTime ?? 0);
    if (!instanceId || !buildingId || position === null || level === null || state === null || state > 2
        || finishAt === null || (state === 0 && level === 0) || (state !== 0 && finishAt === 0)) return null;
    return { instanceId, buildingId, position, level, state, finishAt };
}

export function normalizeBigMapBuildQueue(value: unknown): IBigMapServerQueue | null {
    const row = bigMapServerRecord(value);
    if (!row) return null;
    const queueId = bigMapServerUint(row.queueId);
    const type = bigMapServerUint(row.type);
    const instanceId = bigMapServerInstanceId(row.buildInstId);
    if (!queueId || (type !== 1 && type !== 2) || !instanceId) return null;
    return { queueId, type, instanceId };
}

export function normalizeBigMapBuildInfo(value: unknown): IBigMapServerBuildInfo | null {
    const row = bigMapServerRecord(value);
    if (!row) return null;
    const unlockQueue = bigMapServerUint(row.unlockQueue);
    if (!unlockQueue || !Array.isArray(row.builds) || !Array.isArray(row.queues)) return null;
    const builds: IBigMapServerBuild[] = [];
    const queues: IBigMapServerQueue[] = [];
    const ids = new Set<number>();
    const positions = new Set<number>();
    for (const item of row.builds) {
        const build = normalizeBigMapBuild(item);
        if (!build || ids.has(build.instanceId) || positions.has(build.position)) return null;
        ids.add(build.instanceId);
        positions.add(build.position);
        builds.push(build);
    }
    const queueIds = new Set<number>();
    const queuedBuilds = new Set<number>();
    for (const item of row.queues) {
        const queue = normalizeBigMapBuildQueue(item);
        const build = queue ? builds.find((entry) => entry.instanceId === queue.instanceId) : null;
        if (!queue || !build || queue.queueId > unlockQueue || queueIds.has(queue.queueId)
            || queuedBuilds.has(queue.instanceId) || build.state !== queue.type) return null;
        queueIds.add(queue.queueId);
        queuedBuilds.add(queue.instanceId);
        queues.push(queue);
    }
    if (builds.some((build) => build.state !== 0 && !queuedBuilds.has(build.instanceId))) return null;
    return { builds, queues, unlockQueue };
}

/** uint32实例ID直接用于展示；联机基地不写入离线存档。 */
export function projectBigMapServerBase(
    info: IBigMapServerBuildInfo, config: IBigMapConfig, now: number,
): IBigMapBaseState | null {
    if (info.unlockQueue > config.queue.maxBuildQueue || info.builds.some((build) =>
        !config.buildings.has(build.buildingId) || build.position >= config.queue.plotRows * config.queue.plotCols
        || !config.levels.get(build.buildingId)?.has(Math.max(1, build.level)))) return null;
    const buildings = info.builds.filter((build) => build.state !== 1).map((build) => ({
        instanceId: build.instanceId, buildingId: build.buildingId, level: build.level,
        hexId: build.position, stored: 0, lastTickAt: now,
    }));
    const queues = Array.from({ length: config.queue.maxBuildQueue }, (_, slotIndex) => {
        // 协议队列编号 1 起，视图槽位下标 0 起；所有转换集中在这里。
        const queue = info.queues.find((entry) => entry.queueId === slotIndex + 1);
        const build = queue ? info.builds.find((entry) => entry.instanceId === queue.instanceId) : null;
        const targetLevel = build ? (build.state === 1 ? Math.max(1, build.level) : build.level + 1) : 0;
        const duration = build ? config.levels.get(build.buildingId)?.get(targetLevel)?.buildTime ?? 0 : 0;
        return {
            slotIndex, state: build ? BigMapQueueState.Building : BigMapQueueState.Idle,
            buildingId: build?.buildingId ?? 0, instanceId: build && build.state !== 1 ? build.instanceId : 0,
            targetLevel, anchorHexId: build?.position,
            startAt: build ? build.finishAt - duration : 0, finishAt: build?.finishAt ?? 0,
        };
    });
    return { instanceSeq: info.builds.reduce((max, build) => Math.max(max, build.instanceId), 0), buildings, queues, queueUnlocked: info.unlockQueue,
        res: { grain: 0, wood: 0, iron: 0, coin: 0, stamina: 0 }, stamina: 0, staminaAt: now };
}
