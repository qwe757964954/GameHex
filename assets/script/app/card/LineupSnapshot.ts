import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';

/**
 * 「卡牌阵容」页的**本地阵容快照**（`localStorage`，纯函数、零 `cc`）。
 *
 * 为什么需要：进页面的第一帧到服务端回包之间，原先显示的是 `LineupSlot.prefab` 的字面默认值
 * （8 个同款雕像 + 全「3级」），玩家会把它读成「我的阵容就是这样」。有了快照，第一帧就能
 * 画出**上一次服务端确认过的真实阵容**，网络回来再校正 —— 空窗从「假数据」变成「旧数据」。
 *
 * 三条边界，别顺手放宽：
 *   1. **只存服务端确认过的阵容**（`formations !== null` 且选中阵型解析成功）。本地卡表的
 *      「玩家默认」八卡不是玩家的阵容，写进去等于把假数据持久化。
 *   2. 快照**只用于抢首帧**，任何一次权威数据到达都会整页覆盖（`CardLineupPresenter.revision`
 *      已经挡住乱序），所以不需要「快照 vs 权威」的合并逻辑。
 *   3. 读的一侧必须自己兜脏数据（版本不符 / 过期 / JSON 坏 / 字段缺失）—— 存储是外来的。
 */

/** 结构版本：字段语义一变就 +1，旧快照整体丢弃（写迁移不如直接不要）。 */
export const LINEUP_SNAPSHOT_VERSION = 1;

/**
 * 快照有效期（7 天）。
 * 过期不是「可能不准」而是「大概率不准」（换设备、服务端改阵、赛季重置），
 * 与其画一个陈旧阵容让玩家以为自己的卡被换了，不如显示空台。
 */
export const LINEUP_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 存储键。加前缀避免与老端的键撞车。 */
export const LINEUP_SNAPSHOT_KEY = 'cardLineupSnapshot';

export interface LineupSnapshot {
    readonly version: number;
    /** 写入时间（毫秒）。 */
    readonly savedAt: number;
    /** 上阵八卡（整条 `ZCDeckCard` 存下来：渲染字段都在里面，不必再依赖表）。 */
    readonly cards: readonly ZCDeckCard[];
    /** 卡 id → 等级；口径与 `CardLineupData.heroLevels` 一致。 */
    readonly levels: Readonly<Record<string, number>>;
}

/** 只用得到的两个方法，方便测试注入。 */
export interface LineupSnapshotStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * 取端上存储。
 *
 * 不 `import { sys } from 'cc'`：本文件要能被 `tsx --test` 直接跑，而 `cc` 一进来单测就挂。
 * Cocos 原生把 `sys.localStorage` 挂到了全局 `localStorage`（`ChatRepository` 用的同一条路径，
 * 真机已验证），所以这里走 `globalThis` 是安全的；取不到（编辑器预览/测试环境）就当没有。
 */
function defaultStorage(): LineupSnapshotStorage | null {
    try {
        const candidate = (globalThis as { localStorage?: LineupSnapshotStorage }).localStorage;
        return candidate ?? null;
    } catch {
        return null;
    }
}

/**
 * 把磁盘上的原始 JSON 归一化成合法快照；任何一处不合法都返回 `null`（**不抛**）。
 *
 * 单独抽出来是为了能在 Node 里直接测：`read` 只是「取字符串 + 调本函数」。
 */
export function normalizeLineupSnapshot(
    raw: unknown,
    now: number,
    maxAgeMs: number = LINEUP_SNAPSHOT_MAX_AGE_MS,
): LineupSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Partial<LineupSnapshot>;
    if (source.version !== LINEUP_SNAPSHOT_VERSION) return null;
    if (typeof source.savedAt !== 'number' || !Number.isFinite(source.savedAt)) return null;
    const age = now - source.savedAt;
    // 负数（时间被往回调）也当过期：宁可不用，也不要画一个来历不明的阵容。
    if (age < 0 || age > maxAgeMs) return null;
    if (!Array.isArray(source.cards)) return null;
    const cards: ZCDeckCard[] = [];
    for (const entry of source.cards) {
        if (!entry || typeof entry !== 'object') return null;
        const card = entry as ZCDeckCard;
        if (typeof card.id !== 'string' || card.id.length === 0) return null;
        if (typeof card.name !== 'string') return null;
        cards.push(card);
    }
    const levels: Record<string, number> = {};
    const rawLevels = source.levels;
    if (rawLevels && typeof rawLevels === 'object') {
        for (const [key, value] of Object.entries(rawLevels as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value)) levels[key] = value;
        }
    }
    return { version: LINEUP_SNAPSHOT_VERSION, savedAt: source.savedAt, cards, levels };
}

/** 写快照（失败静默：存储满了/隐私模式不该影响进页面）。 */
export function writeLineupSnapshot(
    cards: readonly ZCDeckCard[],
    levels: ReadonlyMap<string, number>,
    now: number = Date.now(),
    storage: LineupSnapshotStorage | null = defaultStorage(),
): void {
    if (!storage) return;
    const levelRecord: Record<string, number> = {};
    for (const [key, value] of levels) levelRecord[key] = value;
    const payload: LineupSnapshot = {
        version: LINEUP_SNAPSHOT_VERSION,
        savedAt: now,
        cards: cards.slice(),
        levels: levelRecord,
    };
    try {
        storage.setItem(LINEUP_SNAPSHOT_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('[LineupSnapshot] 写快照失败', error);
    }
}

/** 读快照；没有 / 不合法 / 过期都返回 `null`。 */
export function readLineupSnapshot(
    now: number = Date.now(),
    storage: LineupSnapshotStorage | null = defaultStorage(),
): LineupSnapshot | null {
    if (!storage) return null;
    let text: string | null = null;
    try {
        text = storage.getItem(LINEUP_SNAPSHOT_KEY);
    } catch {
        return null;
    }
    if (!text) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // 坏数据不清也不影响（下次写会覆盖），但留着会每次进页面都失败一次，顺手删掉。
        clearLineupSnapshot(storage);
        return null;
    }
    const snapshot = normalizeLineupSnapshot(parsed, now);
    if (!snapshot) clearLineupSnapshot(storage);
    return snapshot;
}

/** 清快照（账号切换 / 脏数据时用）。 */
export function clearLineupSnapshot(storage: LineupSnapshotStorage | null = defaultStorage()): void {
    if (!storage) return;
    try {
        storage.removeItem(LINEUP_SNAPSHOT_KEY);
    } catch {
        /* 清不掉就算了，下次写入会覆盖 */
    }
}
