/**
 * 引导上报的待发队列，纯 TS，不 import cc。
 *
 * 服务端是进度权威，但现有协议的上报既不重试也会被切页取消，所以每次推进先入队、
 * 业务回 `succ=1` 才出队。队列随账号落盘，跨页面、跨进程都还在，下次启动继续补发。
 */

import { guideOwnerKeySuffix } from './GuideSaveStore';
import type { IGuideSaveOwner, IGuideStorage } from './GuideSaveStore';

/** 队列 key 前缀（含版本）；与存档 key 分命名空间，互不覆盖。 */
export const GUIDE_OUTBOX_KEY_PREFIX = 'guide.outbox.v1';

/** 队列文件 schema；结构变了就 +1，并在 {@link GuideSyncOutbox.load} 里兼容旧档。 */
const OUTBOX_VERSION = 1;

/** 待发项；`at` 为入队时间，排查顺序问题用。 */
export interface IGuideOutboxItem {
    readonly stepId: string;
    readonly at: number;
}

interface GuideOutboxFile {
    readonly version: number;
    readonly items: readonly IGuideOutboxItem[];
}

/**
 * 待发队列。只做顺序、去重、裁剪与落盘，不发请求；发送由 Controller 的 drain 循环驱动。
 */
export class GuideSyncOutbox {
    /** storage 抛异常时的进程内兜底；归属本类，不泄漏到模块作用域。 */
    private static readonly memoryFallback = new Map<string, string>();

    private readonly key: string;
    private readonly storage: IGuideStorage | null;
    /** 懒加载：构造时不读盘，避免启动路径上多做一次 localStorage 访问。 */
    private items: IGuideOutboxItem[] | null = null;

    /**
     * @param owner 账号归属；null 表示预览或未登录，只进内存。
     * @throws owner 非空但 roleId 或 serverId 为空，避免写串账号。
     */
    constructor(owner: IGuideSaveOwner | null, storage: IGuideStorage | null = null) {
        if (owner && (!owner.roleId.trim() || !owner.serverId.trim())) {
            throw new Error('引导待发队列缺少角色或区服身份');
        }
        this.key = owner
            ? `${GUIDE_OUTBOX_KEY_PREFIX}.${guideOwnerKeySuffix(owner)}`
            : `${GUIDE_OUTBOX_KEY_PREFIX}.preview`;
        // 预览态不落盘：编辑器里跑出来的待发项不该发到真账号。
        this.storage = owner ? storage : null;
    }

    /** 队列 key，日志与排查用。 */
    get storageKey(): string {
        return this.key;
    }

    get size(): number {
        return this.load().length;
    }

    /** 队头；`null` = 没有待发项。 */
    head(): IGuideOutboxItem | null {
        return this.load()[0] ?? null;
    }

    /**
     * 入队。同一步已在队列里时不重复入队，保持原顺序。
     * @returns 是否真的入队。
     */
    push(stepId: string, now: number = Date.now()): boolean {
        if (!stepId) return false;
        const items = this.load();
        if (items.some((item) => item.stepId === stepId)) return false;
        items.push({ stepId, at: now });
        this.persist(items);
        return true;
    }

    /** 出队：服务端已确认（或永远不可能成功）的步从队列移除。 */
    ack(stepId: string): void {
        const items = this.load();
        const next = items.filter((item) => item.stepId !== stepId);
        if (next.length === items.length) return;
        this.persist(next);
    }

    /** 按远端校正后的完成集裁剪，避免把服务端已经有的步再补发一遍。 */
    prune(completedStepIds: readonly string[]): void {
        const items = this.load();
        const completed = new Set(completedStepIds);
        const next = items.filter((item) => !completed.has(item.stepId));
        if (next.length === items.length) return;
        this.persist(next);
    }

    /** 清空；只给调试 / 回归用。 */
    clear(): void {
        this.items = [];
        this.writeRaw(JSON.stringify({ version: OUTBOX_VERSION, items: [] } satisfies GuideOutboxFile));
    }

    private load(): IGuideOutboxItem[] {
        if (this.items) return this.items;
        this.items = parseOutbox(this.readRaw());
        return this.items;
    }

    private persist(items: IGuideOutboxItem[]): void {
        this.items = items;
        this.writeRaw(JSON.stringify({ version: OUTBOX_VERSION, items } satisfies GuideOutboxFile));
    }

    private readRaw(): string | null {
        // 先读内存：同一会话里刚写的值可能还没来得及 / 没权限落盘。
        const cached = GuideSyncOutbox.memoryFallback.get(this.key);
        if (cached !== undefined) return cached || null;
        try {
            const raw = this.storage?.getItem(this.key) ?? null;
            return raw && raw.length > 0 ? raw : null;
        } catch (error) {
            console.warn('[GuideSyncOutbox] 读取存储失败，本次会话改用内存', error);
            return null;
        }
    }

    private writeRaw(raw: string): void {
        GuideSyncOutbox.memoryFallback.set(this.key, raw);
        try {
            this.storage?.setItem(this.key, raw);
        } catch (error) {
            console.warn('[GuideSyncOutbox] 写入存储失败，本次会话改用内存', error);
        }
    }
}

/** 坏档、版本不符、结构不对一律当空队列，不抛也不阻断引导。 */
function parseOutbox(raw: string | null): IGuideOutboxItem[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.warn('[GuideSyncOutbox] 队列 JSON 损坏，按空队列处理', error);
        return [];
    }
    if (!parsed || typeof parsed !== 'object') return [];
    const file = parsed as Record<string, unknown>;
    if (Number(file.version) !== OUTBOX_VERSION || !Array.isArray(file.items)) return [];

    const items: IGuideOutboxItem[] = [];
    for (const value of file.items) {
        if (!value || typeof value !== 'object') continue;
        const item = value as Record<string, unknown>;
        if (typeof item.stepId !== 'string' || !item.stepId) continue;
        const at = Number(item.at);
        items.push({ stepId: item.stepId, at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0 });
    }
    return items;
}
