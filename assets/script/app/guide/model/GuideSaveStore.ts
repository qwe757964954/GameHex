/**
 * 新手引导进度存档，纯 TS，不 import cc，tests 可直接 import。
 * 引擎 I/O 只在 GuideStorageAdapter 接入；key 为 guide.progress.v1.server:<id>:role:<id>，
 * 账号级，不随章节变化。
 */

import { GuideProgress } from './GuideProgress';
import type { GuideProgressData } from './GuideProgress';
import type { GuideStep } from './GuideStepConfig';

/** 存档 schema 版本。字段结构变了就 +1，并在 {@link GuideSaveStore.load} 里加迁移。 */
export const GUIDE_SAVE_VERSION = 1;

/** 存档 key 前缀（含版本）；后面拼命名空间。 */
export const GUIDE_SAVE_KEY_PREFIX = 'guide.progress.v1';

/** 存储端口。只要求这两个方法，方便单测塞内存实现、将来换服务端。 */
export interface IGuideStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** 存档归属：缺任一字段视为「无法确定账号」，只写内存不落盘。 */
export interface IGuideSaveOwner {
    readonly roleId: string;
    readonly serverId: string;
}

/** 落盘的完整结构。字段只增不改 —— 删字段要升 {@link GUIDE_SAVE_VERSION}。 */
export interface GuideSaveData {
    readonly version: number;
    /** 当前未完成的步；空串 = 引导已结束。 */
    readonly currentStepId: string;
    readonly completedSteps: readonly string[];
    readonly grantedSteps: readonly string[];
    readonly skipped: boolean;
    /**
     * 首次进入引导的毫秒时间戳，0 表示未知。判 firstLogin 用它，而不是看存档是否存在。
     */
    readonly startedAt: number;
    /** 最近一次写入时间戳；接服务端后用于两边取新。 */
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
            ? `${GUIDE_SAVE_KEY_PREFIX}.server:${encodeURIComponent(owner.serverId)}:role:${encodeURIComponent(owner.roleId)}`
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

    /** 清存档。只给调试 / 回归用，正常流程不该调 —— 清了会重跑一遍强制引导。 */
    clear(): void {
        GuideSaveStore.memoryFallback.delete(this.key);
        try {
            this.storage?.setItem(this.key, '');
        } catch {
            // 清不掉就清不掉：下次 save 会整份覆盖。
        }
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
