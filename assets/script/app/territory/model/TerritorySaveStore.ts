import {
    TERRITORY_ACTIVATED_LEVELS_KEY,
    TERRITORY_LAST_CHAPTER_KEY,
    TERRITORY_PASSED_LEVELS_KEY,
    TERRITORY_STORAGE_PREFIX,
    TERRITORY_TEXTS,
} from '../application/TerritoryTexts';
import { TERRITORY_BATTLE_STATUS, type TerritoryBattleStatus } from './TerritoryBattleStatus';
import type { TerritoryIdleRewardGain, TerritoryIdleRewardSource } from './TerritoryIdleReward';
import { idleRewardDestinationOf, settleTerritoryIdleRewards, TERRITORY_IDLE_REWARD_DESTINATION } from './TerritoryIdleReward';
import type { TerritoryProgressData } from './TerritoryProgress';

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
    status: TerritoryBattleStatus;
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
    // 存档里都是 JSON 可序列化的普通对象/数组：优先 structuredClone（不生成中间字符串），
    // 旧环境没有它时退回 JSON 往返，保持原有语义。
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
}

function filterValidNonNegativeIntegers(values: unknown[]): number[] {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (Number.isSafeInteger(val) && (val as number) >= 0) {
            result.push(val as number);
        }
    }
    return result;
}

function countRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, number> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        const normalized = amount(obj[key]);
        if (normalized > 0) {
            result[key] = normalized;
        }
    }
    return result;
}

function timestampRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, number> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        const parsed = Number(obj[key]);
        if (Number.isFinite(parsed) && parsed >= 0) {
            result[key] = Math.floor(parsed);
        }
    }
    return result;
}

/**
 * 领地本地存档。
 *
 * 服务端领地协议接入后只需替换这一层。localStorage 不可用（隐私模式 / 禁 cookie）时
 * 退回进程内 Map，本次会话不丢存档，但不会跨启动保留。
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
        const raw = this.readRaw(key);
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

    /**
     * 账号级「已通关的领地关卡」（**不分章节**，见 {@link TERRITORY_PASSED_LEVELS_KEY}）。
     *
     * 存档损坏 / 写成非数组时给空表而不是抛：它只决定「某个入口晚一点出现」，
     * 不该连累领地页整页加载失败。
     */
    loadPassedLevels(): number[] {
        const parsed = this.readJson(this.passedLevelsKey());
        if (!Array.isArray(parsed)) return [];
        const result: number[] = [];
        for (let i = 0; i < parsed.length; i++) {
            const levelId = parsed[i];
            if (Number.isSafeInteger(levelId) && levelId > 0) result.push(levelId);
        }
        return result;
    }

    /**
     * 把这几关记成「已通关」，返回这次**真正新增**的那些（幂等）。
     *
     * 幂等是必须的：条件判定每次渲染都会走一遍，没有新增就不该写盘。
     */
    markLevelsPassed(levelIds: readonly number[]): number[] {
        const passed = this.loadPassedLevels();
        const known = new Set(passed);
        const added: number[] = [];
        for (const levelId of levelIds) {
            if (!Number.isSafeInteger(levelId) || levelId <= 0 || known.has(levelId)) continue;
            known.add(levelId);
            added.push(levelId);
        }
        if (!added.length) return added;
        this.writeRaw(this.passedLevelsKey(), JSON.stringify([...passed, ...added]));
        return added;
    }

    load(
        chapterId: number,
        walletSeed: TerritoryWallet = { silver: 0, stamina: 0 },
    ): TerritoryChapterSave {
        const key = this.key(chapterId);
        const raw = this.readRaw(key);
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
                        ? { randomResourceCells: filterValidNonNegativeIntegers(parsed.randomResourceCells) }
                        : {}),
                    ...(parsed.battle ? { battle: parsed.battle } : {}),
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
                case TERRITORY_IDLE_REWARD_DESTINATION.walletSilver:
                    save.wallet.silver += reward.amount;
                    break;
                case TERRITORY_IDLE_REWARD_DESTINATION.walletStamina:
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
        if (save.wallet.stamina < staminaCost) {
            return { ok: false, reason: TERRITORY_TEXTS.staminaNotEnough, save };
        }
        save.wallet.silver -= silverCost;
        save.wallet.stamina -= staminaCost;
        save.battle = {
            chapterId,
            cellId: request.cellId,
            levelId: request.levelId,
            status: TERRITORY_BATTLE_STATUS.pending,
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
            status: victory ? TERRITORY_BATTLE_STATUS.victory : TERRITORY_BATTLE_STATUS.defeat,
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
        this.writeRaw(this.key(chapterId), JSON.stringify(state));
    }

    /**
     * 账号级成就的 key：故意不带 chapterId，避免切章后查不到。
     */
    private passedLevelsKey(): string {
        return `${TERRITORY_PASSED_LEVELS_KEY}.${this.namespace}`;
    }

    /**
     * 账号级「已激活的领地关卡」（**不分章节**，见 {@link TERRITORY_ACTIVATED_LEVELS_KEY}）。
     *
     * 与 {@link loadPassedLevels} 一一对应，判据换成「花银币激活」。
     * 存档损坏 / 写成非数组时同样给空表而不是抛 —— 它只决定「快速寻敌按钮晚一点出现」。
     */
    loadActivatedLevels(): number[] {
        const parsed = this.readJson(this.activatedLevelsKey());
        if (!Array.isArray(parsed)) return [];
        const result: number[] = [];
        for (let i = 0; i < parsed.length; i++) {
            const levelId = parsed[i];
            if (Number.isSafeInteger(levelId) && levelId > 0) result.push(levelId);
        }
        return result;
    }

    /**
     * 把这几关记成「已激活」，返回这次**真正新增**的那些（幂等）。
     *
     * 幂等是必须的：`MainPage` 每次领地渲染都会整批记一遍，没有新增就不该写盘。
     */
    markLevelsActivated(levelIds: readonly number[]): number[] {
        const activated = this.loadActivatedLevels();
        const known = new Set(activated);
        const added: number[] = [];
        for (const levelId of levelIds) {
            if (!Number.isSafeInteger(levelId) || levelId <= 0 || known.has(levelId)) continue;
            known.add(levelId);
            added.push(levelId);
        }
        if (!added.length) return added;
        this.writeRaw(this.activatedLevelsKey(), JSON.stringify([...activated, ...added]));
        return added;
    }

    private activatedLevelsKey(): string {
        return `${TERRITORY_ACTIVATED_LEVELS_KEY}.${this.namespace}`;
    }

    /** 读原始串：先看内存兜底（storage 不可用时 `save` 只写了内存）。 */
    private readRaw(key: string): string | null {
        try {
            return TerritorySaveStore.memoryFallback.get(key) ?? this.storage?.getItem(key) ?? null;
        } catch {
            return TerritorySaveStore.memoryFallback.get(key) ?? null;
        }
    }

    private readJson(key: string): unknown {
        const raw = this.readRaw(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as unknown;
        } catch {
            return null;
        }
    }

    private writeRaw(key: string, raw: string): void {
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
