import { TerritoryProgress } from '../model/TerritoryProgress';
import { buildTerritoryMonsterPatrols, type ITerritoryMonsterPatrol } from '../model/TerritoryMonsterPatrol';
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

/**
 * 「宝箱还没翻出来、点一下就翻」：`fixedResource` 且仍在 `siteOpenableCells` 里。
 *
 * 资源据点是**两步**（`TerritoryModel.selectSite` → `handleUnlockThenPass`）：
 * 第一下 `unlockCell`（翻出宝箱）→ 第二下 `passCell`（点开宝箱领奖）。
 * 这里是**第一步**的口径，`Map/Tile_*` 翻地步用它。
 */
function territoryUnlockableChestCells(state: Pick<ITerritoryRenderState, 'map' | 'siteOpenableCells'>): readonly number[] {
    return state.map?.sites
        .filter(site => site.type === TERRITORY_SITE_TYPE.fixedResource
            && state.siteOpenableCells.includes(site.cellId))
        .map(site => site.cellId) ?? [];
}

/**
 * 「宝箱已翻出来、还没点开」：`fixedResource` 且**已解锁未通关**。
 *
 * 🔴 第二步时这一格已经**不在** `siteOpenableCells` 里（那个集合只收「未解锁」的格），
 * 所以 `2-2 打开宝箱` 的焦点必须按「已解锁未通关」筛。按前者筛的后果不是"少画一个圈"：
 * 孔挖不出来 ⇒ `Dim` + 铺满屏的 `Blocker` 压在宝箱上 ⇒ 玩家连点都点不到，整条引导死在这里。
 */
function territoryChestPendingCells(state: Pick<ITerritoryRenderState, 'map' | 'progress'>): readonly number[] {
    const progress = state.progress;
    if (!progress) return [];
    return state.map?.sites
        .filter(site => site.type === TERRITORY_SITE_TYPE.fixedResource
            && progress.isCellUnlocked(site.cellId)
            && !progress.isOwned(site.cellId))
        .map(site => site.cellId) ?? [];
}

/**
 * 引导「翻地 / 点宝箱」的**同源判据**：这一格点下去会不会推进 `tileFlipped`。
 *
 * `TerritoryController.onIntent('siteTap')`（上报）与 {@link guideMapFocusCells}（手指指哪）
 * 都必须走这一个函数 —— 两边各写一份，迟早出现「手指指向点不动的箱子」或反过来。
 */
export function isTerritoryChestActionable(
    state: Pick<ITerritoryRenderState, 'map' | 'progress' | 'siteOpenableCells'>,
    cellId: number,
): boolean {
    const site = state.map?.sites.find(one => one.cellId === cellId);
    if (!site || site.type !== TERRITORY_SITE_TYPE.fixedResource) return false;
    if (state.siteOpenableCells.includes(cellId)) return true;
    const progress = state.progress;
    return !!progress && progress.isCellUnlocked(cellId) && !progress.isOwned(cellId);
}

/** 引导只消费模型发布的可操作集合，不把「未拥有」误当作「可以翻开」。 */
export function guideMapFocusCells(focusNode: string, state: Pick<ITerritoryRenderState,
    'map' | 'randomResourceOpenableCells' | 'siteOpenableCells' | 'stageByCell' | 'progress'>): readonly number[] {
    // `Map/Chest_N`：网箱已翻出来、等玩家点开（`2-2 打开宝箱`），只要箱子，别把随机格混进来。
    if (/^Map\/Chest_\d+$/.test(focusNode)) return territoryChestPendingCells(state);
    if (/^Map\/(Tile_[123]|TileNew_1)$/.test(focusNode)) {
        const fixed = territoryUnlockableChestCells(state);
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
    readonly monsterPatrols: readonly ITerritoryMonsterPatrol[];
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
        monsterPatrols: state.map && progress ? buildTerritoryMonsterPatrols(state.map, progress) : [],
        stationStates: buildTerritoryStationStates({ ...state, progress }),
    });
}
