/**
 * 新手引导进度存档，纯 TS，不 import cc，tests 可直接 import。
 * 引擎 I/O 只在 GuideStorageAdapter 接入；key 为 guide.progress.v1.server:<id>:role:<id>，
 * 账号级，不随章节变化。
 */

import { GuideProgress } from './GuideProgress';
import type { GuideProgressData } from './GuideProgress';
import { GUIDE_STEP_END } from './GuideStepConfig';
import type { GuideStep } from './GuideStepConfig';

/** 存档 schema 版本。字段结构变了就 +1，并在 {@link GuideSaveStore.load} 里加迁移。 */
export const GUIDE_SAVE_VERSION = 1;

/** 存档 key 前缀（含版本）；后面拼命名空间。 */
export const GUIDE_SAVE_KEY_PREFIX = 'guide.progress.v1';

/** 存储端口。引擎侧由 GuideStorageAdapter 注入 `sys.localStorage`；单测注入内存实现。 */
export interface IGuideStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** 存档归属：缺任一字段视为「无法确定账号」，只写内存不落盘。 */
export interface IGuideSaveOwner {
    readonly roleId: string;
    readonly serverId: string;
}

/** 服务端回包的功能引导游标；`0/0` 表示建号后尚未开始（契约待后端确认）。 */
export interface IGuideRemoteCursor {
    readonly funcId: number;
    readonly step1: number;
    readonly step2: number;
}

/** 账号级 key 后缀；存档与待发队列共用同一口径，避免两套 key 规则。 */
export function guideOwnerKeySuffix(owner: IGuideSaveOwner): string {
    return `server:${encodeURIComponent(owner.serverId)}:role:${encodeURIComponent(owner.roleId)}`;
}

/** 落盘的完整结构。字段只增不改 —— 删字段要升 {@link GUIDE_SAVE_VERSION}。 */
export interface GuideSaveData {
    readonly version: number;
    /** 当前未完成的步；空串 = 引导已结束。 */
    readonly currentStepId: string;
    readonly completedSteps: readonly string[];
    /** 兼容旧版字段，不作为服务端发奖或到账依据。 */
    readonly grantedSteps: readonly string[];
    readonly skipped: boolean;
    /**
     * 首次进入引导的毫秒时间戳，0 表示未知。仅落盘保留；`firstRun` 以存档是否存在判定。
     */
    readonly startedAt: number;
    /** 最近一次写入时间戳，仅落盘与排查；远端取新走游标，不看它。 */
    readonly updatedAt: number;
}

/**
 * 内存存储，供单测、编辑器预览和 localStorage 不可用时兜底。
 */
export function createMemoryGuideStorage(seed: Record<string, string> = {}): IGuideStorage {
    const map = new Map<string, string>(Object.entries(seed));
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
    };
}

/**
 * 引导进度存档。进度字段只增不减，写入幂等，读写异常降级而不抛出。
 */
export class GuideSaveStore {
    /** storage 抛异常时的进程内兜底；归属本类，不泄漏到模块作用域。 */
    private static readonly memoryFallback = new Map<string, string>();

    private readonly key: string;
    private readonly storage: IGuideStorage | null;

    /**
     * @param owner 账号归属；null 表示预览或未登录，只写内存。
     * @param storage 存储端口；省略时走内存兜底。
     * @throws owner 非空但 roleId 或 serverId 为空，避免写串账号。
     */
    constructor(owner: IGuideSaveOwner | null, storage: IGuideStorage | null = null) {
        if (owner && (!owner.roleId.trim() || !owner.serverId.trim())) {
            throw new Error('引导存档缺少角色或区服身份');
        }
        this.key = owner
            ? `${GUIDE_SAVE_KEY_PREFIX}.${guideOwnerKeySuffix(owner)}`
            : `${GUIDE_SAVE_KEY_PREFIX}.preview`;
        // 预览态不落盘：编辑器里跑出来的进度不该污染真账号。
        this.storage = owner ? storage : null;
    }

    /** 存档 key，日志与排查用。 */
    get storageKey(): string {
        return this.key;
    }

    /**
     * 读存档。返回 null 表示从未开始过或存档损坏，调用方不要把它和空进度等价。
     */
    load(): GuideSaveData | null {
        const raw = this.readRaw();
        if (!raw) return null;

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            // 坏档不删、不抛：下次 save 会整份覆盖；删了反而丢失"曾经开始过"的信息。
            console.warn('[GuideSaveStore] 存档 JSON 损坏，按未开始处理', error);
            return null;
        }
        return normalizeSave(parsed);
    }

    /**
     * 写存档，与磁盘已有值合并后写入；内容没变返回 false。
     */
    save(data: GuideProgressData, now: number = Date.now()): boolean {
        const existing = this.load();
        const merged = mergeSave(existing, data, now);
        const raw = JSON.stringify(merged);
        if (this.readRaw() === raw) return false;
        this.writeRaw(raw);
        return true;
    }

    /**
     * 用服务端游标校正本地存档。只有远端更靠后时才写入，返回是否真的前进。
     * 落后、相等、游标非法都返回 false 且不改动本地，避免远端丢包把进度打回。
     */
    applyRemoteCursor(cursor: IGuideRemoteCursor | null, steps: readonly GuideStep[], now: number = Date.now()): boolean {
        const remote = remoteCursorToData(cursor, steps);
        if (!remote) return false;
        const existing = this.load();
        const merged = mergeSave(existing, remote, now);
        // updatedAt 每次都会刷新，只有进度字段变化才算前进。
        if (existing && hasSameProgress(existing, merged)) return false;
        this.writeRaw(JSON.stringify(merged));
        return true;
    }

    private readRaw(): string | null {
        // 先读内存：同一会话里刚写的值可能还没来得及 / 没权限落盘。
        const cached = GuideSaveStore.memoryFallback.get(this.key);
        if (cached !== undefined) return cached || null;
        try {
            const raw = this.storage?.getItem(this.key) ?? null;
            return raw && raw.length > 0 ? raw : null;
        } catch (error) {
            console.warn('[GuideSaveStore] 读取存储失败，本次会话改用内存', error);
            return null;
        }
    }

    private writeRaw(raw: string): void {
        GuideSaveStore.memoryFallback.set(this.key, raw);
        try {
            this.storage?.setItem(this.key, raw);
        } catch (error) {
            console.warn('[GuideSaveStore] 写入存储失败，本次会话改用内存', error);
        }
    }
}

/**
 * 读存档并构造步骤机。配置非法时 GuideProgress 会抛，这里统一吞掉返回 null，
 * 语义是本次不做引导，而不是让主界面进不去。
 */
export function restoreGuideProgress(
    store: Pick<GuideSaveStore, 'load'>,
    steps: readonly GuideStep[],
    saved: GuideSaveData | null = store.load(),
): GuideProgress | null {
    try {
        return new GuideProgress(steps, saved
            ? {
                currentStepId: saved.currentStepId,
                completedSteps: saved.completedSteps,
                grantedSteps: saved.grantedSteps,
                skipped: saved.skipped,
            }
            : undefined);
    } catch (error) {
        console.error('[GuideSaveStore] 引导配置不可用，本次跳过引导', error);
        return null;
    }
}

/**
 * 把服务端游标还原成步骤存档。
 *
 * 口径按「最后已完成步」：`(2,2)` ⇒ 已完成到 2-2、下一步 3-1。
 * 若后端确认存的是「当前待做步」，只改这一个函数。
 * 游标不在当前表里（表热更后编号变了）返回 null，交给本地存档继续。
 */
export function remoteCursorToData(
    cursor: IGuideRemoteCursor | null,
    steps: readonly GuideStep[],
): GuideProgressData | null {
    if (!cursor || (cursor.step1 === 0 && cursor.step2 === 0)) return null;
    const stepId = `${cursor.step1}-${cursor.step2}`;
    const index = steps.findIndex((step) => step.stepId === stepId);
    if (index < 0) return null;

    const next = steps[index].nextStep;
    if (next !== GUIDE_STEP_END && !steps.some((step) => step.stepId === next)) return null;

    return {
        currentStepId: next === GUIDE_STEP_END ? '' : next,
        completedSteps: steps.slice(0, index + 1).map((step) => step.stepId),
        grantedSteps: [],
        skipped: false,
    };
}

// 内部：结构校验与合并

/** 单条 stepId 的合法性：非空字符串。表里的 stepId 形如 `'1-1'`。 */
function isStepId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function toStepIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!isStepId(item) || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
    }
    return out;
}

function toTimestamp(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 把任意 JSON 归一成存档结构，版本不符直接丢弃；字段坏了给默认，不整份丢弃。
 */
function normalizeSave(value: unknown): GuideSaveData | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (toTimestamp(raw.version) !== GUIDE_SAVE_VERSION) {
        console.warn(`[GuideSaveStore] 存档版本不符（${String(raw.version)}≠${GUIDE_SAVE_VERSION}），按未开始处理`);
        return null;
    }
    return {
        version: GUIDE_SAVE_VERSION,
        currentStepId: isStepId(raw.currentStepId) ? raw.currentStepId : '',
        completedSteps: toStepIds(raw.completedSteps),
        grantedSteps: toStepIds(raw.grantedSteps),
        skipped: raw.skipped === true,
        startedAt: toTimestamp(raw.startedAt),
        updatedAt: toTimestamp(raw.updatedAt),
    };
}

/**
 * 合并写入，进度字段只增不减，防止旧实例晚写覆盖新进度。
 * 传入的 currentStepId 已完成时说明数据落后，沿用磁盘的当前步。
 */
function mergeSave(
    existing: GuideSaveData | null,
    data: GuideProgressData,
    now: number,
): GuideSaveData {
    const completed = new Set<string>([
        ...(existing?.completedSteps ?? []),
        ...toStepIds(data.completedSteps),
    ]);
    const granted = new Set<string>([
        ...(existing?.grantedSteps ?? []),
        ...toStepIds(data.grantedSteps),
    ]);

    const incomingCursor = isStepId(data.currentStepId) ? data.currentStepId : '';
    const existingCursor = existing?.currentStepId ?? '';
    // 传入的当前步已完成 ⇒ 这份数据落后，沿用磁盘的当前步。
    const preferIncoming = incomingCursor.length > 0 && !completed.has(incomingCursor);
    let cursor = preferIncoming ? incomingCursor : existingCursor;
    if (cursor && completed.has(cursor)) cursor = '';

    return {
        version: GUIDE_SAVE_VERSION,
        currentStepId: cursor,
        completedSteps: [...completed],
        grantedSteps: [...granted],
        skipped: (existing?.skipped ?? false) || data.skipped === true,
        // 首次开始时间一旦写下就不再改；缺了才用本次时间补。
        startedAt: existing?.startedAt && existing.startedAt > 0 ? existing.startedAt : now,
        updatedAt: now,
    };
}

/** 只比较进度字段（忽略 updatedAt），用于判断远端校正是否真的前进了。 */
function hasSameProgress(a: GuideSaveData, b: GuideSaveData): boolean {
    return a.currentStepId === b.currentStepId
        && a.skipped === b.skipped
        && sameIds(a.completedSteps, b.completedSteps)
        && sameIds(a.grantedSteps, b.grantedSteps);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const known = new Set(a);
    return b.every((id) => known.has(id));
}
