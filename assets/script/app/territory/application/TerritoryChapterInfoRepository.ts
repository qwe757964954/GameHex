import { sys } from 'cc';
import { GameNet } from '../../net/GameNet';
import { withTimeout, toCount } from '../../net/RequestGuard';
import { RequestCityChapterInfo } from './RequestTerritoryChapterInfoMsg';

/**
 * 占城（领地）账号级章节汇总 Repository（进程级单例）。
 *
 * 与单章格子的 TerritoryCellRepository 分工：本类只存跨章汇总（上次挂机时间与已开放章节），
 * 登录后拉一次并持久化到本地，冒险页打开时直接读取。
 * 服务端 Bro 是整包覆盖而非增量，收到后直接替换，不做集合并集，避免回档时本地不收敛。
 */

/** 归一后的章节快照。chapters 已去重、升序、过滤非法项；idleTime 为非负秒。 */
export interface ITerritoryChapterInfo {
    readonly idleTime: number;
    readonly chapters: readonly number[];
}

/** 读超时：与单章格子 Req 同一档（5s）；登录后并行发，不阻塞主流程。 */
const READ_TIMEOUT_MS = 5000;

/** localStorage key 前缀（与 `TerritorySaveStore` 同 namespace 口径）。 */
const STORAGE_KEY = 'territory.chapterInfo.v1';

/** 兜底章节：服务端一条都没给时，冒险页至少能开第 1 章。 */
const FALLBACK_CHAPTERS: readonly number[] = [1];

export class TerritoryChapterInfoRepository {
    private static _instance: TerritoryChapterInfoRepository | null = null;
    static get instance(): TerritoryChapterInfoRepository {
        if (!this._instance) this._instance = new TerritoryChapterInfoRepository();
        return this._instance;
    }

    private namespace = 'preview:';
    private snapshot: ITerritoryChapterInfo | null = null;
    private broListener: object | null = null;
    /** refresh 在途标记：避免登录后并行触发两次 Req。 */
    private refreshing: Promise<void> | null = null;

    private constructor() {}

    /** 当前快照；从未拉过 / 未绑定时为 `null`。界面应回落 {@link availableChapters}。 */
    get current(): ITerritoryChapterInfo | null {
        return this.snapshot;
    }

    /**
     * 冒险页可切的章节列表：
     * - 有服务器快照 ⇒ 用 `chapters`（至少补一个 1，兜底服务端漏发）；
     * - 没快照 ⇒ 返回 `[1]`，不让首屏空白。
     */
    get availableChapters(): readonly number[] {
        const chapters = this.snapshot?.chapters;
        if (!chapters || chapters.length === 0) return FALLBACK_CHAPTERS;
        return chapters.includes(1) ? chapters : [1].concat(chapters);
    }

    /**
     * 登录成功后绑定账号身份。
     *
     * 会立刻从 localStorage 把该账号上次存的快照读进内存 —— 冒险页在 `refresh()` 回包到之前
     * 就能用这份旧快照先渲染（生产口径：本地兜底、后台刷新）。
     *
     * @param roleId 角色 id（字符串，uint64 安全口径）
     * @param serverId 区服 id
     */
    bindOwner(roleId: string, serverId: string): void {
        if (!roleId.trim() || !serverId.trim()) {
            // 无主预览态：不清盘，但也不写持久存储（与 TerritorySaveStore 同口径）。
            this.namespace = 'preview:';
            this.snapshot = null;
            return;
        }
        this.namespace = `server:${encodeURIComponent(serverId)}:role:${encodeURIComponent(roleId)}:`;
        this.snapshot = this.readPersisted();
        this.ensureBroListener();
    }

    /**
     * 拉一次最新章节汇总。并发调用共享同一次在途 Req；离线 / 失败静默回落本地快照。
     *
     * 不抛错：登录后并行触发，失败不能影响进入主界面。
     */
    refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.doRefresh().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    /** 登出 / 切账号前清内存；不动 localStorage（新账号 bindOwner 会换 namespace）。 */
    clear(): void {
        this.snapshot = null;
    }

    /**
     * 领奖回包里的 `idleTime` 写回快照（新的挂机起点）。
     *
     * `CmdCityChapterIdleRewardRspMsg.idleTime` 只跟着领奖回包回来，
     * 服务端**不保证**再推一条 `CmdCityChapterInfoBroMsg`。不写回的话
     * 征收弹窗与主城金币车的计时会停在上一次 `ChapterInfo` 的值（领完还显示满格）。
     *
     * @param seconds 秒；非正数忽略（避免把 1970 年当起点）
     */
    applyIdleTime(seconds: number): void {
        const idleTime = Math.floor(Number(seconds));
        if (!Number.isFinite(idleTime) || idleTime <= 0) return;
        this.applySnapshot({ idleTime, chapters: this.snapshot?.chapters ?? FALLBACK_CHAPTERS }, true);
    }

    // ============================================================
    // 内部
    // ============================================================

    private async doRefresh(): Promise<void> {
        const net = GameNet.instance;
        if (!net?.isConnected) return;
        let resolved: ITerritoryChapterInfo | null = null;
        const sent = await withTimeout(
            net.send(
                new RequestCityChapterInfo({}, undefined, (rsp) => {
                    // Rsp 外层是 `{ info: ChapterInfo }`，必须先剥壳，否则读到的永远是外层
                    // （外层没有 idleTime/chapters ⇒ 归一化成 idleTime=0, chapters=[] 的假空快照）。
                    const info = readInfoField(rsp);
                    console.info('[TerritoryChapterInfo] Rsp 原始 info =', JSON.stringify(info));
                    resolved = normalizeChapterInfo(info);
                }) as never,
                false,
            ),
            READ_TIMEOUT_MS,
            () => false,
        );
        console.info('[TerritoryChapterInfo] send 结果 =', sent, ' resolved =', JSON.stringify(resolved));
        if (sent !== true || !resolved) return;
        this.applySnapshot(resolved, /*persist*/ true);
    }

    /** 幂等挂 Bro 监听。进程级单例，挂一次即可。 */
    private ensureBroListener(): void {
        if (this.broListener) return;
        this.broListener = {};
        GameNet.instance.addEvent(
            'CmdCityChapterInfoBroMsg',
            this.broListener,
            (msg: unknown) => {
                const info = readInfoField(msg);
                const normalized = normalizeChapterInfo(info);
                if (!normalized) return;
                this.applySnapshot(normalized, true);
                console.info('[TerritoryChapterInfo] 收到章节汇总广播', normalized);
            },
        );
    }

    private applySnapshot(info: ITerritoryChapterInfo, persist: boolean): void {
        this.snapshot = info;
        if (persist) this.writePersisted(info);
    }

    private storageKey(): string {
        return `${STORAGE_KEY}.${this.namespace}`;
    }

    private readPersisted(): ITerritoryChapterInfo | null {
        if (this.namespace === 'preview:') return null;
        let raw: string | null = null;
        try {
            raw = sys.localStorage.getItem(this.storageKey());
        } catch (error) {
            console.warn('[TerritoryChapterInfo] 读本地快照失败', error);
            return null;
        }
        if (!raw) return null;
        try {
            return normalizeChapterInfo(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    private writePersisted(info: ITerritoryChapterInfo): void {
        if (this.namespace === 'preview:') return;
        try {
            sys.localStorage.setItem(this.storageKey(), JSON.stringify(info));
        } catch (error) {
            console.warn('[TerritoryChapterInfo] 写本地快照失败', error);
        }
    }
}

// ============================================================
// 纯函数：归一化（不碰引擎，便于单测）
// ============================================================

/** Bro/Rsp 的外层包：`{ info: ChapterInfo }`。剥一层壳。 */
function readInfoField(msg: unknown): unknown {
    if (!msg || typeof msg !== 'object') return null;
    return (msg as { info?: unknown }).info ?? msg;
}

/**
 * 把任意形状的 `ChapterInfo` 归一为 {@link ITerritoryChapterInfo}。
 *
 * - `idleTime`：uint32 → 非负整数；非法给 0；
 * - `chapters`：repeated uint32 → 过滤非正整数、去重、升序；
 * - 整个 `info` 形状都不对时返回 `null`（不抛、不落库）。
 */
export function normalizeChapterInfo(info: unknown): ITerritoryChapterInfo | null {
    if (!info || typeof info !== 'object') return null;
    const record = info as { idleTime?: unknown; chapters?: unknown };
    const idle = toCount(record.idleTime);
    const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
    const chapters = Array.from(new Set(
        rawChapters
            .map((item) => Math.floor(toCount(item)))
            .filter((n) => Number.isSafeInteger(n) && n >= 1),
    )).sort((a, b) => a - b);
    return { idleTime: Number.isSafeInteger(idle) && idle >= 0 ? idle : 0, chapters };
}
