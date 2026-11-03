import { TerritoryProgress } from '../model/TerritoryProgress';
import type { ITerritoryViewState } from './TerritoryModel';

export type ITerritoryProgressView = Pick<TerritoryProgress,
    'isCellUnlocked' | 'isOwned' | 'isAreaPassed' | 'explorationAt' | 'checkUnlock'>;
export interface ITerritoryRenderState extends Omit<ITerritoryViewState, 'progress'> {
    readonly progress: ITerritoryProgressView | null;
}

/** Capture progress so an already published frame cannot change under a delayed renderer. */
export function buildTerritoryViewState(state: ITerritoryViewState): ITerritoryRenderState {
    const source = state.progress;
    let progress: ITerritoryProgressView | null = null;
    if (source && state.map) {
        const snapshot = new TerritoryProgress(state.map, source.toJSON());
        // false clears unlocked cells; unknown server state must preserve the local save.
        if (source.serverStateKnown) snapshot.markServerStateKnown();
        progress = Object.freeze({
            isCellUnlocked: (id: number) => snapshot.isCellUnlocked(id),
            isOwned: (id: number) => snapshot.isOwned(id),
            isAreaPassed: (id: number) => snapshot.isAreaPassed(id),
            explorationAt: (id: number) => snapshot.explorationAt(id),
            checkUnlock: (id: number, power: number) => snapshot.checkUnlock(id, power),
        });
    }
    return Object.freeze({
        ...state,
        // 钱包同 `progress` 一样要**拍快照**：延迟一帧的渲染若读到已经扣过费的实时钱包，
        // 银币数字会在同一帧里从红变白（玩家看到"闪一下"），红/白也就不再对应付款前的事实。
        wallet: Object.freeze({ silver: state.wallet.silver, stamina: state.wallet.stamina }),
        progress,
    });
}
