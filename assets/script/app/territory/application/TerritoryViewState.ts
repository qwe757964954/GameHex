import { TerritoryProgress } from '../model/TerritoryProgress';
import { buildTerritoryMonsterPatrols, type ITerritoryMonsterPatrol } from '../model/TerritoryMonsterPatrol';
import { isTerritoryBattleSite, isTerritoryChestSite, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
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
    return state.map?.sites
        .filter(site => isTerritoryChestSite(site)
            && state.siteOpenableCells.includes(site.cellId))
        .map(site => site.cellId) ?? [];
}

/**
 * 「宝箱已翻出来、还没点开」：**普通宝箱**（`fixedResource`）且**已解锁未通关**。
 *
 * 🔴 第二步时这一格已经**不在** `siteOpenableCells` 里（那个集合只收「未解锁」的格），
 * 所以 `2-2 打开宝箱` 的焦点必须按「已解锁未通关」筛。按前者筛的后果不是"少画一个圈"：
 * 孔挖不出来 ⇒ `Dim` + 铺满屏的 `Blocker` 压在宝箱上 ⇒ 玩家连点都点不到，整条引导死在这里。
 *
 * 野怪宝箱（`patrolChest`）不算：它已解锁后的下一步是**开战**，不是「打开宝箱」，
 * 引导手指指过去会让玩家以为点一下就能领奖（2026-11-18）。
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
 *
 * 野怪宝箱只有**第一下**（翻地解锁）算：已解锁之后再点是开战，不该上报 `tileFlipped`。
 */
export function isTerritoryChestActionable(
    state: Pick<ITerritoryRenderState, 'map' | 'progress' | 'siteOpenableCells'>,
    cellId: number,
): boolean {
    const site = state.map?.sites.find(one => one.cellId === cellId);
    if (!site || !isTerritoryChestSite(site)) return false;
    if (state.siteOpenableCells.includes(cellId)) return true;
    if (site.type === TERRITORY_SITE_TYPE.patrolChest) return false;
    const progress = state.progress;
    return !!progress && progress.isCellUnlocked(cellId) && !progress.isOwned(cellId);
}

/**
 * 「还能翻的地块」候选池：随机格在前（既有顺序）+ 还能翻出来的固定资源宝箱。
 *
 * 🔴 已翻出、还没点开的箱子**不在池里** —— 它已经离开 `siteOpenableCells`，
 * 那一格的下一步是「点开宝箱」，归 `Map/Chest_N` 管，不该再被当成「翻一格」的目标。
 * 池的顺序必须**稳定**（同一次会话里跑两次得到同一顺序），`Map/Tile_N` 靠它取第 N 个。
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
        // 🔴 `Map/Tile_N` 的 N 是**「第几块要翻的地」**（1 起），不是随便一个序号：
        //    翻地步（2-1 / 3-1 / 4-1）连着三步，如果每步都给同一份候选、让调用方
        //    「取离屏幕中心最近的那个」，手指就会一直停在**同一格**上，
        //    要等宝箱被点开（候选集合变了）才跳到下一格 —— 玩家看到的就是
        //    「手指要等宝箱打开才移动」（用户 2026-11-17 第 13 条 ①）。
        //    这里把「本步该指的那一格」**直接排到最前**，顺序即语义。
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
     * 🔴 `stageByCell` 是**扩散后**的表（`expandBindingsToAreaSites`：同一区域的多个站点
     * 共享同一个关卡号）⇒ 一个 `levelId` 会命中好几格，光按它挑就会指到**兄弟格**上：
     * 手指落在空地、真正的关卡建筑在下面一格（用户 2026-11-17 第 17 条）。
     *
     * 所以这里分两档，且**只认「这一刻点得动」**：
     * ① `building`：有建筑的那一格（`site.buildingId`）—— 玩家看到的关卡建筑就在这儿，排最前；
     * ② `shared`：同区域里共享关卡号的兄弟格，跟在后面**兜底**（建筑那格挪出视口时，
     *    调用方按顺序取第一个可见的，不至于整步没有光圈）。
     *
     * 「点得动」的判据 = **没有锁标**（`!isPrerequisitePending`），不是 `isCellUnlocked`：
     * 没解锁但前置满足的关卡格显示「银币 + 数字」，点一下 = 花银币解锁并**直接开战**
     * （`TerritoryModel.selectSite` → `handleUnlockThenBattle`）—— 这正是 `5-1` 要让玩家做的那一下
     * （用户 2026-11-17 第 21 条）。只按「已解锁」筛会漏掉最常见的现场：格子已经露出来、
     * 价格也显示了、玩家还没付钱 ⇒ 光圈压根不出现，只剩一句台词飘在屏幕底部。
     *
     * 🔴 **锁标照旧一律不算**（用户 2026-11-18 第 24 条：「必须是可花银币解锁（前置满足）才会触发」）：
     * `isPrerequisitePending` 两种来源都拒 —— 前置关卡没打通（点了只弹「先打通 xxx」）与
     * 前置宝箱解锁了没点开（玩家眼里同样是锁）。后者服务端其实允许解锁，但画面上顶着锁，
     * 这时候出手指等于叫玩家点一个看着点不动的格子。
     */
    const building: number[] = [];
    const shared: number[] = [];
    let buildingLocked = false;
    for (const site of state.map?.sites ?? []) {
        const stage = state.stageByCell.get(site.cellId);
        if (!stage || stage.levelId !== levelId) continue;
        if (!isTerritoryBattleSite(site)) continue;
        if (progress.isDisabled(site.cellId)) continue;
        // 「可花银币解锁（前置满足）」= 已解锁，或者**没有锁标**（`isPrerequisitePending`：
        // 前置关卡没打通 ∪ 前置宝箱解锁了没点开 —— 后者玩家眼里同样是锁）。
        // 缺方法的桩（老夹具只给 `isCellUnlocked`）按「没被卡住」处理，别让渲染层抛。
        const unlocked = progress.isCellUnlocked(site.cellId);
        const locked = !unlocked && (progress.isPrerequisitePending?.(site.cellId) ?? false);
        if (locked) {
            if (site.buildingId) buildingLocked = true;
            continue;
        }
        (site.buildingId ? building : shared).push(site.cellId);
    }
    // 🔴 关卡建筑那一格还锁着 ⇒ 这一步**整步不出引导**（对话框也会一起压住，
    // 见 `GuideDialogView.waitsForLevelFocus`）。绝不能退到「同区域共享关卡号的兄弟格」上：
    // 兄弟格可能自己能开（有银币价、没锁标），光圈就画到了隔壁空地、而玩家认的是带 `1-1` 气泡的
    // 建筑格（用户 2026-11-18 第 24 条现场：光圈套在左侧价格格上，绿框的建筑格还挂着锁）。
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
        stationStates: buildTerritoryStationStates({ ...state, progress }),
    });
}
