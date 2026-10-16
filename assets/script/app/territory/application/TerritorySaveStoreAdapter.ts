import { sys } from 'cc';
import type { ITerritoryChapterStore } from './TerritoryPresenter';
import type { TerritoryProgressData } from '../model/TerritoryProgress';
import {
    TerritorySaveStore,
    type ITerritorySaveOwner,
    type TerritoryChapterSave,
    type TerritoryWallet,
} from '../model/TerritorySaveStore';
import type { TerritoryIdleRewardSource } from '../model/TerritoryIdleReward';

/**
 * 本地存档适配器：捕获角色归属并提供引擎存储端口，Presenter 不接触 Cocos。
 */
export class TerritorySaveStoreAdapter implements ITerritoryChapterStore {
    private readonly store: TerritorySaveStore;

    constructor(
        owner: ITerritorySaveOwner | null,
        private readonly availableChapters: readonly number[],
        private readonly fallbackChapter = 1,
    ) {
        this.store = createTerritorySaveStore(owner);
    }

    loadLastChapter(): number {
        return this.store.loadLastChapter(this.availableChapters, this.fallbackChapter);
    }

    saveLastChapter(chapterId: number): void {
        this.store.saveLastChapter(chapterId);
    }

    load(chapterId: number, walletSeed: TerritoryWallet): TerritoryChapterSave {
        return this.store.load(chapterId, walletSeed);
    }

    saveProgress(
        chapterId: number,
        progress: TerritoryProgressData,
        source: TerritoryChapterSave,
    ): TerritoryChapterSave {
        return this.store.saveProgress(chapterId, progress, source);
    }

    saveWallet(chapterId: number, wallet: TerritoryWallet, source: TerritoryChapterSave): TerritoryChapterSave {
        return this.store.saveWallet(chapterId, wallet, source);
    }

    settleIdleRewards(
        chapterId: number,
        sources: readonly TerritoryIdleRewardSource[],
        maxHours: number,
        now: number,
        source: TerritoryChapterSave,
    ) {
        return this.store.settleIdleRewards(
            chapterId, sources, maxHours, now, source);
    }

    beginBattle(
        chapterId: number,
        request: {
            cellId: number;
            levelId: number;
            silverCost: number;
            staminaCost: number;
        },
        source: TerritoryChapterSave,
    ) {
        return this.store.beginBattle(chapterId, request, source);
    }

    clearBattle(chapterId: number, source: TerritoryChapterSave): TerritoryChapterSave {
        return this.store.clearBattle(chapterId, source);
    }
}

/** 页面与战斗结算使用同一命名空间；引擎 I/O 只在此边界接入。 */
export function createTerritorySaveStore(owner: ITerritorySaveOwner | null): TerritorySaveStore {
    return new TerritorySaveStore(owner, {
        getItem: (key) => sys.localStorage.getItem(key),
        setItem: (key, value) => sys.localStorage.setItem(key, value),
    });
}
