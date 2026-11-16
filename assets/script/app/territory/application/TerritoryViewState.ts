import { TerritoryProgress } from '../model/TerritoryProgress';
import { isTerritoryBattleSite, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import { territoryUnlockShortfall } from '../model/TerritoryCostShortfall';
import type { ITerritoryViewState } from './TerritoryModel';

export type ITerritoryProgressView = Pick<TerritoryProgress,
    'isCellUnlocked' | 'isOwned' | 'isAreaPassed' | 'isDisabled' | 'explorationAt' | 'checkUnlock'>;
export const TERRITORY_STATION_STATE = {
    owned: 'owned', exploring: 'exploring', available: 'available', locked: 'locked',
} as const;
export type TerritorySiteState = typeof TERRITORY_STATION_STATE[keyof typeof TERRITORY_STATION_STATE];

export interface ITerritoryStationState {
    readonly unlocked: boolean;
    readonly owned: boolean;
    readonly opened: boolean;
    readonly battle: boolean;
    readonly areaPassed: boolean;
    readonly openable: boolean;
    readonly pending: boolean;
    readonly phase: TerritorySiteState;
    readonly silverRed: boolean;
    readonly staminaShort: boolean;
}

/** 引导只消费模型发布的可操作集合，不把「未拥有」误当作「可以翻开」。 */
export function guideMapFocusCells(focusNode: string, state: Pick<ITerritoryRenderState,
    'map' | 'randomResourceOpenableCells' | 'siteOpenableCells' | 'stageByCell' | 'progress'>): readonly number[] {
    if (/^Map\/(Tile_[123]|TileNew_1)$/.test(focusNode)) {
        const fixed = state.map?.sites.filter(site => site.type === TERRITORY_SITE_TYPE.fixedResource
            && state.siteOpenableCells.includes(site.cellId)).map(site => site.cellId) ?? [];
        return fixed.length ? [...state.randomResourceOpenableCells, ...fixed] : state.randomResourceOpenableCells;
    }
    const level = /^Map\/Level_(\d+)$/.exec(focusNode);
    if (!level || !state.progress) return [];
    const cells: number[] = [];
    for (const [cellId, stage] of state.stageByCell) {
        if (stage.levelId === Number(level[1]) && (state.siteOpenableCells.includes(cellId)
            || state.progress.isCellUnlocked(cellId))) cells.push(cellId);
    }
    return cells;
}

type TerritoryStationSource = Pick<ITerritoryRenderState,
    'map' | 'progress' | 'wallet' | 'siteOpenableCells' | 'pendingFixedResourceCells'>;

/** 站点业务事实按发布帧统一计算；渲染只选图、颜色和排版。 */
export function buildTerritoryStationStates(state: TerritoryStationSource): ReadonlyMap<number, ITerritoryStationState> {
    const states = new Map<number, ITerritoryStationState>();
    const progress = state.progress;
    if (!state.map || !progress) return states;
    const openableCells = new Set(state.siteOpenableCells);
    const pendingCells = new Set(state.pendingFixedResourceCells);
    for (const site of state.map.sites) {
        const unlocked = progress.isCellUnlocked(site.cellId);
        const owned = progress.isOwned(site.cellId);
        const openable = openableCells.has(site.cellId);
        const short = territoryUnlockShortfall(state.wallet, site.unlock);
        // 地图忽略战力门槛，详情中的开战按钮仍按真实战力判断。
        const phase = owned ? TERRITORY_STATION_STATE.owned
            : progress.explorationAt(site.cellId) ? TERRITORY_STATION_STATE.exploring
                : progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER).ok
                    ? TERRITORY_STATION_STATE.available : TERRITORY_STATION_STATE.locked;
        states.set(site.cellId, Object.freeze({
            unlocked, owned, opened: unlocked || owned,
            battle: isTerritoryBattleSite(site), areaPassed: progress.isAreaPassed(site.cellId),
            openable, pending: pendingCells.has(site.cellId), phase,
            silverRed: short.silver || (!openable && !short.stamina), staminaShort: short.stamina,
        }));
    }
    return states;
}

export interface ITerritoryRenderState extends Omit<ITerritoryViewState, 'progress'> {
    readonly progress: ITerritoryProgressView | null;
    readonly stationStates: ReadonlyMap<number, ITerritoryStationState>;
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
            isDisabled: (id: number) => snapshot.isDisabled(id),
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
        stationStates: buildTerritoryStationStates({ ...state, progress }),
    });
}
