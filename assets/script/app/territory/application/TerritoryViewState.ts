import { TerritoryProgress } from '../model/TerritoryProgress';
import {
    buildTerritoryMonsterPatrols,
    territoryPatrolPassedCells,
    type ITerritoryMonsterPatrol,
} from '../model/TerritoryMonsterPatrol';
import { isTerritoryBattleSite, isTerritoryChestSite, TERRITORY_SITE_TYPE, type TerritorySite } from '../model/TerritoryMapConfig';
import { territoryUnlockShortfall } from '../model/TerritoryCostShortfall';
import { territoryMonsterBoxLvByCell } from '../model/TerritoryMonsterBox';
import type { ITerritoryViewState } from './TerritoryModel';

export type ITerritoryProgressView = Pick<TerritoryProgress,
    'isCellUnlocked' | 'isOwned' | 'isAreaPassed' | 'isDisabled' | 'explorationAt' | 'checkUnlock'
    // 引导焦点要判「这一格点不点得动」= 真前置满足（`guideMapFocusCells` 的关卡分支），
    // 与 `checkUnlock` 的拦截同源；只给 `isCellUnlocked` 会把「银币价已显示、还没付钱」的格漏掉。
    | 'prerequisiteBlockers'
    // 「有没有锁标」的唯一口径（前置关卡没打通 ∪ 前置宝箱解锁了没点开），关卡焦点只认没锁的格。
    | 'isPrerequisitePending'>;
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
    /**
     * 这一格的怪物宝箱等级；`0` = 这一格没有怪物宝箱（或还没拉到章节快照）。
     *
     * 真源是服务端 `monsterBoxInfos`（`ITerritoryViewState.monsterBoxes`），
     * 升级成功后由 Model 用回包的新等级覆盖 —— 视图只展示，不参与判定。
     */
    readonly monsterBoxLv: number;
}

/**
 * 「宝箱还没翻出来、点一下就翻」：宝箱格（`fixedResource` / `patrolChest`）且仍在 `siteOpenableCells` 里。
 *
 * 宝箱是**两步**（`TerritoryModel.selectSite` → `handleUnlockThenPass`）：
 * 第一下 `unlockCell`（翻出宝箱）→ 第二下 `passCell`（点开宝箱领奖）。
 * 这里是**第一步**的口径，`Map/Tile_*` 翻地步用它。
 */
function territoryUnlockableChestCells(state: Pick<ITerritoryRenderState, 'map' | 'siteOpenableCells'>): readonly number[] {
    const sites = state.map?.sites;
    if (!sites || sites.length === 0) return [];
    const openableSet = new Set(state.siteOpenableCells);
    const result: number[] = [];
    for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        if (isTerritoryChestSite(site) && openableSet.has(site.cellId)) {
            result.push(site.cellId);
        }
    }
    return result;
}

/**
 * 已翻出但尚未领取的固定宝箱（fixedResource 且已解锁未通关）。
 * 此时地块已脱离 siteOpenableCells，需单独由 Chest_N 引导捕获。
 */
function territoryChestPendingCells(state: Pick<ITerritoryRenderState, 'map' | 'progress'>): readonly number[] {
    const progress = state.progress;
    const sites = state.map?.sites;
    if (!progress || !sites || sites.length === 0) return [];
    const result: number[] = [];
    for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        if (site.type === TERRITORY_SITE_TYPE.fixedResource
            && progress.isCellUnlocked(site.cellId)
            && !progress.isOwned(site.cellId)) {
            result.push(site.cellId);
        }
    }
    return result;
}

/**
 * 引导「翻地 / 点宝箱」的**同源判据**：这一格点下去会不会推进 `tileFlipped`。
 *
 * `TerritoryController.onIntent('siteTap')`（上报）与 {@link guideMapFocusCells}（手指指哪）
 * 都必须走这一个函数 —— 两边各写一份，迟早出现「手指指向点不动的箱子」或反过来。
 *
 * 野怪宝箱只有**第一下**（翻地解锁）算：已解锁之后再点是开战，不该上报 `tileFlipped`。
 */
export function isTerritoryChestActionable(
    state: Pick<ITerritoryRenderState, 'map' | 'progress' | 'siteOpenableCells'>,
    cellId: number,
): boolean {
    const sites = state.map?.sites;
    if (!sites) return false;
    let site: TerritorySite | null = null;
    for (let i = 0; i < sites.length; i++) {
        if (sites[i].cellId === cellId) {
            site = sites[i];
            break;
        }
    }
    if (!site || !isTerritoryChestSite(site)) return false;
    if (state.siteOpenableCells.includes(cellId)) return true;
    if (site.type === TERRITORY_SITE_TYPE.patrolChest) return false;
    const progress = state.progress;
    return !!progress && progress.isCellUnlocked(cellId) && !progress.isOwned(cellId);
}

/**
 * 可翻开地块候选池：包含可开启随机地块及待解锁固定资源宝箱。
 * 已翻出未领取的宝箱归属于 Chest_N，不纳入翻地候选池。
 */
function territoryFlipPool(state: Pick<ITerritoryRenderState, 'map' | 'siteOpenableCells' | 'randomResourceOpenableCells'>): readonly number[] {
    const fixed = territoryUnlockableChestCells(state);
    return fixed.length ? [...state.randomResourceOpenableCells, ...fixed] : state.randomResourceOpenableCells;
}

/** 引导只消费模型发布的可操作集合，不把「未拥有」误当作「可以翻开」。 */
export function guideMapFocusCells(focusNode: string, state: Pick<ITerritoryRenderState,
    'map' | 'randomResourceOpenableCells' | 'siteOpenableCells' | 'stageByCell' | 'progress'>): readonly number[] {
    // `Map/Chest_N`：网箱已翻出来、等玩家点开（`2-2 打开宝箱`），只要箱子，别把随机格混进来。
    if (/^Map\/Chest_\d+$/.test(focusNode)) return territoryChestPendingCells(state);
    const tile = /^Map\/Tile_([123])$/.exec(focusNode);
    if (tile) {
        // Map/Tile_N 中的 N 代表第 N 块待翻开地块，通过将对应地块排在首位确保引导定位唯一稳定。
        const pool = territoryFlipPool(state);
        if (!pool.length) return [];
        const index = Math.min(Number(tile[1]) - 1, pool.length - 1);
        return [...pool.slice(index), ...pool.slice(0, index)];
    }
    // `Map/TileNew_1`（解锁新地块）只有一个目标，保持原来的「随机格优先」口径。
    if (focusNode === 'Map/TileNew_1') return territoryFlipPool(state);
    const level = /^Map\/Level_(\d+)$/.exec(focusNode);
    if (!level || !state.progress) return [];
    const levelId = Number(level[1]);
    const progress = state.progress;
    /**
     * 关卡聚焦点筛选：优先定位带有实心建筑的主地块，兄弟格作为视口外兜底。
     * 仅当格子未被前置条件锁定时（!isPrerequisitePending）才可作为可点击引导目标。
     */
    const building: number[] = [];
    const shared: number[] = [];
    let buildingLocked = false;
    for (const site of state.map?.sites ?? []) {
        const stage = state.stageByCell.get(site.cellId);
        if (!stage || stage.levelId !== levelId) continue;
        if (!isTerritoryBattleSite(site)) continue;
        if (progress.isDisabled(site.cellId)) continue;
        // 「可花银币解锁（前置满足）」= 已解锁，或者没有锁标（!isPrerequisitePending）。
        const unlocked = progress.isCellUnlocked(site.cellId);
        const locked = !unlocked && (progress.isPrerequisitePending?.(site.cellId) ?? false);
        if (locked) {
            if (site.buildingId) buildingLocked = true;
            continue;
        }
        (site.buildingId ? building : shared).push(site.cellId);
    }
    // 若主建筑格仍处于锁定状态，则整步暂不展示引导，避免将光标引向不带建筑标志的兄弟格。
    if (buildingLocked && !building.length) return [];
    return building.length ? [...building, ...shared] : shared;
}

type TerritoryStationSource = Pick<ITerritoryRenderState,
    'map' | 'progress' | 'wallet' | 'siteOpenableCells' | 'pendingFixedResourceCells' | 'monsterBoxes'>;

/** 站点业务事实按发布帧统一计算；渲染只选图、颜色和排版。 */
export function buildTerritoryStationStates(state: TerritoryStationSource): ReadonlyMap<number, ITerritoryStationState> {
    const states = new Map<number, ITerritoryStationState>();
    const progress = state.progress;
    if (!state.map || !progress) return states;
    const openableCells = new Set(state.siteOpenableCells);
    const pendingCells = new Set(state.pendingFixedResourceCells);
    // 逐格查询用表，不在循环里 `find` 数组（站点上百，别做 O(n × m)）。
    const boxLvByCell = territoryMonsterBoxLvByCell(state.monsterBoxes);
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
            monsterBoxLv: boxLvByCell.get(site.cellId) ?? 0,
        }));
    }
    return states;
}

export interface ITerritoryRenderState extends Omit<ITerritoryViewState, 'progress'> {
    readonly monsterPatrols: readonly ITerritoryMonsterPatrol[];
    /**
     * 巡逻区「已挑战成功」的格子（含 footprint）。与 `monsterPatrols` 同一拍快照：
     * 视图拿它同时判「地皮绿 / 红框摘掉」和「野怪取消暗色红描边」，
     * 保证三者在同一帧一起恢复，不会出现「地块绿了、怪还灰着」。
     */
    readonly patrolPassedCells: ReadonlySet<number>;
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
            prerequisiteBlockers: (id: number) => snapshot.prerequisiteBlockers(id),
            isPrerequisitePending: (id: number) => snapshot.isPrerequisitePending(id),
        });
    }
    return Object.freeze({
        ...state,
        // 钱包同 `progress` 一样要**拍快照**：延迟一帧的渲染若读到已经扣过费的实时钱包，
        // 银币数字会在同一帧里从红变白（玩家看到"闪一下"），红/白也就不再对应付款前的事实。
        wallet: Object.freeze({ silver: state.wallet.silver, stamina: state.wallet.stamina }),
        progress,
        monsterPatrols: state.map && progress ? buildTerritoryMonsterPatrols(state.map, progress) : [],
        patrolPassedCells: state.map && progress
            ? territoryPatrolPassedCells(state.map.sites, progress) : new Set<number>(),
        stationStates: buildTerritoryStationStates({ ...state, progress }),
    });
}
