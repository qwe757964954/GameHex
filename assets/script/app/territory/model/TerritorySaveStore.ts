import type { TerritoryProgressData } from './TerritoryProgress';
import { idleRewardDestinationOf, settleTerritoryIdleRewards } from './TerritoryIdleReward';
import type { TerritoryIdleRewardGain, TerritoryIdleRewardSource } from './TerritoryIdleReward';
import {
    TERRITORY_LAST_CHAPTER_KEY,
    TERRITORY_STORAGE_PREFIX,
    TERRITORY_TEXTS,
} from '../application/TerritoryTexts';

export interface ITerritorySaveOwner {
    readonly roleId: string;
    readonly serverId: string;
}

export interface ITerritoryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface TerritoryWallet {
    silver: number;
    stamina: number;
}

export interface TerritoryBattleRecord {
    chapterId: number;
    cellId: number;
    levelId: number;
    status: 'pending' | 'victory' | 'defeat';
    startedAt: number;
    resolvedAt?: number;
}

export interface TerritoryChapterSave {
    version: 1;
    progress: TerritoryProgressData;
    wallet: TerritoryWallet;
    inventory: Record<string, number>;
    idleRewardAtByLevel: Record<string, number>;
    /** 本地生成的随机资源位置；服务端发布该状态后由快照接管。 */
    randomResourceCells?: number[];
    battle?: TerritoryBattleRecord;
}

export interface TerritoryIdleRewardSaveResult {
    save: TerritoryChapterSave;
    rewards: TerritoryIdleRewardGain[];
    settledHours: number;
    changed: boolean;
}

export type TerritoryBeginBattleResult =
    | { ok: true; save: TerritoryChapterSave }
    | { ok: false; reason: string; save: TerritoryChapterSave };

function amount(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function countRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, count]) => {
        const normalized = amount(count);
        return normalized > 0 ? [[key, normalized]] : [];
    }));
}

function timestampRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, timestamp]) => {
        const parsed = Number(timestamp);
        return Number.isFinite(parsed) && parsed >= 0 ? [[key, Math.floor(parsed)]] : [];
    }));
}

/**
 * 领地本地存档。
 *
 *  服务端领地协议接入后只需替换这一层。localStorage 不可用（隐私模式 / 禁 cookie）时
 *  退回进程内 Map，本次会话不丢存档，但不会跨启动保留。
 */
export class TerritorySaveStore {
    /** localStorage 不可用时的内存兜底；归属本类，不泄漏到模块作用域。 */
    private static readonly memoryFallback = new Map<string, string>();
    private readonly namespace: string;
    private readonly storage: ITerritoryStorage | null;

    constructor(owner: ITerritorySaveOwner | null, storage: ITerritoryStorage | null = null) {
        if (owner && (!owner.roleId.trim() || !owner.serverId.trim())) {
            throw new Error('领地存档缺少角色或区服身份');
        }
        // 无法确定归属的 v1 无作用域存档只保留，不导入任何角色；预览不写持久存储。
        this.namespace = owner
            ? `server:${encodeURIComponent(owner.serverId)}:role:${encodeURIComponent(owner.roleId)}:`
            : 'preview:';
        this.storage = owner ? storage : null;
    }

    loadLastChapter(availableChapters: readonly number[], fallback = 1): number {
        const key = `${TERRITORY_LAST_CHAPTER_KEY}.${this.namespace}`;
        let raw: string | null = null;
        try {
            raw = TerritorySaveStore.memoryFallback.get(key) ?? this.storage?.getItem(key) ?? null;
        } catch {
            raw = TerritorySaveStore.memoryFallback.get(key) ?? null;
        }
        const chapterId = Math.max(1, Math.floor(Number(raw)));
        return availableChapters.includes(chapterId) ? chapterId : fallback;
    }

    saveLastChapter(chapterId: number): void {
        const key = `${TERRITORY_LAST_CHAPTER_KEY}.${this.namespace}`;
        const raw = String(Math.max(1, Math.floor(chapterId)));
        TerritorySaveStore.memoryFallback.set(key, raw);
        try {
            this.storage?.setItem(key, raw);
        } catch (error) {
            console.warn('[TerritorySaveStore] 无法保存最近章节，本次会话改用内存记录', error);
        }
    }

    load(
        chapterId: number,
        walletSeed: TerritoryWallet = { silver: 0, stamina: 0 },
    ): TerritoryChapterSave {
        const key = this.key(chapterId);
        let raw: string | null = null;
        try {
            raw = TerritorySaveStore.memoryFallback.get(key) ?? this.storage?.getItem(key) ?? null;
        } catch {
            raw = TerritorySaveStore.memoryFallback.get(key) ?? null;
        }
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<TerritoryChapterSave>;
                return {
                    version: 1,
                    progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
                    wallet: {
                        silver: amount(parsed.wallet?.silver),
                        stamina: amount(parsed.wallet?.stamina),
                    },
                    inventory: countRecord(parsed.inventory),
                    idleRewardAtByLevel: timestampRecord(parsed.idleRewardAtByLevel),
                    ...(Array.isArray(parsed.randomResourceCells)
                        ? { randomResourceCells: parsed.randomResourceCells.filter(
                            (cell): cell is number => Number.isSafeInteger(cell) && cell >= 0,
                        ) }
                        : {}),
                    ...(parsed.battle ? { battle: clone(parsed.battle) } : {}),
                };
            } catch (error) {
                console.warn(`[TerritorySaveStore] 章节 ${chapterId} 存档损坏，已重建`, error);
            }
        }
        const created: TerritoryChapterSave = {
            version: 1,
            progress: {},
            wallet: {
                silver: amount(walletSeed.silver),
                stamina: amount(walletSeed.stamina),
            },
            inventory: {},
            idleRewardAtByLevel: {},
        };
        this.save(chapterId, created);
        return created;
    }

    saveProgress(
        chapterId: number,
        progress: TerritoryProgressData,
        source?: TerritoryChapterSave,
    ): TerritoryChapterSave {
        const save = source ? clone(source) : this.load(chapterId);
        save.progress = clone(progress);
        this.save(chapterId, save);
        return save;
    }

    saveWallet(
        chapterId: number,
        wallet: TerritoryWallet,
        source: TerritoryChapterSave,
    ): TerritoryChapterSave {
        const save = clone(source);
        save.wallet = { silver: amount(wallet.silver), stamina: amount(wallet.stamina) };
        this.save(chapterId, save);
        return save;
    }

    settleIdleRewards(
        chapterId: number,
        sources: readonly TerritoryIdleRewardSource[],
        maxHours: number,
        now = Date.now(),
        source?: TerritoryChapterSave,
        random: () => number = Math.random,
    ): TerritoryIdleRewardSaveResult {
        const save = source ? clone(source) : this.load(chapterId);
        const settlement = settleTerritoryIdleRewards(
            save.idleRewardAtByLevel,
            sources,
            now,
            maxHours,
            random,
        );
        save.idleRewardAtByLevel = settlement.claimedAtByLevel;
        for (const reward of settlement.rewards) {
            switch (idleRewardDestinationOf(reward.resId)) {
                case 'wallet.silver':
                    save.wallet.silver += reward.amount;
                    break;
                case 'wallet.stamina':
                    save.wallet.stamina += reward.amount;
                    break;
                default: {
                    const key = String(reward.resId);
                    save.inventory[key] = amount(save.inventory[key]) + reward.amount;
                    break;
                }
            }
        }
        if (settlement.changed) this.save(chapterId, save);
        return { save, ...settlement };
    }

    beginBattle(
        chapterId: number,
        request: { cellId: number; levelId: number; silverCost: number; staminaCost: number },
        source?: TerritoryChapterSave,
    ): TerritoryBeginBattleResult {
        const save = source ? clone(source) : this.load(chapterId);
        const silverCost = amount(request.silverCost);
        const staminaCost = amount(request.staminaCost);
        if (save.wallet.silver < silverCost) {
            return { ok: false, reason: TERRITORY_TEXTS.silverNotEnough, save };
        }
        if (save.wallet.stamina < staminaCost) {
            return { ok: false, reason: TERRITORY_TEXTS.staminaNotEnough, save };
        }
        save.wallet.silver -= silverCost;
        save.wallet.stamina -= staminaCost;
        save.battle = {
            chapterId,
            cellId: request.cellId,
            levelId: request.levelId,
            status: 'pending',
            startedAt: Date.now(),
        };
        this.save(chapterId, save);
        return { ok: true, save };
    }

    /** 战斗流程在结算出现时写回；领地页下次打开时负责转成探索/占领进度。 */
    resolveBattle(
        chapterId: number,
        cellId: number,
        levelId: number,
        victory: boolean,
    ): TerritoryChapterSave {
        const save = this.load(chapterId);
        const current = save.battle;
        save.battle = {
            chapterId,
            cellId,
            levelId,
            status: victory ? 'victory' : 'defeat',
            startedAt: current?.startedAt ?? Date.now(),
            resolvedAt: Date.now(),
        };
        this.save(chapterId, save);
        return save;
    }

    clearBattle(
        chapterId: number,
        source?: TerritoryChapterSave,
    ): TerritoryChapterSave {
        const save = source ? clone(source) : this.load(chapterId);
        delete save.battle;
        this.save(chapterId, save);
        return save;
    }

    save(chapterId: number, state: TerritoryChapterSave): void {
        const key = this.key(chapterId);
        const raw = JSON.stringify(state);
        TerritorySaveStore.memoryFallback.set(key, raw);
        try {
            this.storage?.setItem(key, raw);
        } catch (error) {
            console.warn('[TerritorySaveStore] localStorage 不可用，本次会话改用内存存档', error);
        }
    }

    private key(chapterId: number): string {
        return `${TERRITORY_STORAGE_PREFIX}${this.namespace}${Math.max(1, Math.floor(chapterId))}`;
    }
}
