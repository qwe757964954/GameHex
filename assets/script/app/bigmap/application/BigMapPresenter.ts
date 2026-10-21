/**
 * 大世界 Presenter —— 把「配置 + 世界 + 存档 + 冒险进度」粘起来，只吐**视图数据**与动作结果。
 *
 * 分层口径（见 `AGENTS.md`）：
 * - `model/` 里全是纯规则，不知道 lodash/引擎/UI 存在；
 * - 这里负责时序（tick）、持久化（经 `IBigMapStorage` 端口）、把规则结果翻译成界面能直接画的结构；
 * - `view/` 只读这里的数据、只调这里的方法，不自己算规则、不自己读配置。
 */
import {
    BIGMAP_RES_ORDER,
    BigMapQueueState,
    type BigMapCityState,
    type BigMapResType,
    type IBigMapConfig,
    type IBigMapBaseState,
    type IBigMapWorld,
} from '../model/BigMapTypes';
import {
    bigMapBuildingCountWithQueue,
    bigMapCanAfford,
    bigMapCanPlace,
    bigMapCancelQueue,
    bigMapClampQueueUnlocked,
    bigMapHarvest,
    bigMapHarvestAll,
    bigMapMainBuilding,
    bigMapMainLevel,
    bigMapPendingHarvest,
    bigMapProducePerHour,
    bigMapResCap,
    bigMapStartBuild,
    bigMapStartUpgrade,
    bigMapTick,
    bigMapUnlockQueue,
} from '../model/BigMapBase';
import {
    bigMapAttackCity,
    bigMapAttackMonster,
    bigMapAttackPower,
    bigMapCityAttackPreview,
    bigMapCityHpRatio,
    bigMapMonsterAttackPreview,
    bigMapMonsterHpRatio,
    bigMapUnlockContextOf,
    type IBigMapBattleProgress,
} from '../model/BigMapBattle';
import {
    bigMapBuildingUnlock,
    bigMapCityState,
    bigMapCityUnlock,
    bigMapMonsterUnlock,
    bigMapUpgradeUnlock,
    type IBigMapUnlockContext,
} from '../model/BigMapUnlock';
import { bigMapHexDistance, buildBigMapWorld } from '../model/BigMapWorld';
import { buildBigMapWorldFromLayout, type IBigMapLayout } from '../model/BigMapLayout';
import { parseBigMapSave, serializeBigMapSave, type IBigMapSaveData } from '../model/BigMapSaveData';
import {
    bigMapCityAttackGate,
    bigMapCityTimeline,
    type BigMapCityPhase,
    type IBigMapCityTimeline,
} from '../model/BigMapCitySchedule';
import {
    buildBigMapCityRankBoard,
    buildSoloRankBoard,
    type IBigMapCityRankBoard,
    type IBigMapRankProvider,
} from '../model/BigMapRank';
import {
    bigMapSnapshotDue,
    buildBigMapDaySnapshot,
    type IBigMapDaySnapshot,
} from '../model/BigMapSnapshot';

/** 存储端口（`sys.localStorage` 由 application 适配器注入，Presenter 不 import 引擎）。 */
export interface IBigMapStorage {
    read(key: string): string | null;
    write(key: string, value: string): void;
}

export interface IBigMapPresenterDeps {
    readonly config: IBigMapConfig;
    readonly storage: IBigMapStorage;
    readonly saveKey: string;
    /** 冒险已通关章节数（`TerritorySaveStoreAdapter.loadLastChapter` 的口径）。 */
    readonly adventureChapter: () => number;
    readonly now: () => number;
    /** 世界种子，缺省用默认值；改它等于换一张地图。 */
    readonly seed?: number;
    /** 开服天数，缺省 0（单机版恒 0）。 */
    readonly openDay?: number;
    /**
     * 策划布局（`BigMapLayoutLoader` 产出）。缺省 / `null` = 按种子生成世界。
     * 传了就**布局优先**：城池/野怪/基地的落位全部以它为准。
     */
    readonly layout?: IBigMapLayout | null;
    /** 城池榜单来源（联机 = 服务器；缺省 = 本地 NPC 模拟）。 */
    readonly rankProvider?: IBigMapRankProvider;
}

/**
 * 世界实例：**布局优先，种子兜底**。
 *
 * `resolveBigMapLayout` 已经做过解析与尺寸校验，这里再 try/catch 一次是给「绕过 loader
 * 直接塞进来」的调用方（单测、调试台）兜底 —— 建世界失败不该让大世界白屏。
 */
function createBigMapWorldInstance(
    config: IBigMapConfig,
    seed: number | undefined,
    layout: IBigMapLayout | null | undefined,
): IBigMapWorld {
    if (layout) {
        try {
            return buildBigMapWorldFromLayout(config, layout);
        } catch (error) {
            console.warn('[BigMapPresenter] 用布局建世界失败，回退种子生成', error);
        }
    }
    return buildBigMapWorld(config, seed);
}

// ------------------------------------------------------------------ 视图数据

export interface IBigMapResourceView {
    readonly type: BigMapResType;
    readonly name: string;
    readonly amount: number;
    readonly cap: number;
    readonly pending: number;
    readonly perHour: number;
}

export interface IBigMapPlotCellView {
    readonly hexId: number;
    readonly row: number;
    readonly column: number;
    readonly instanceId: number;
    readonly buildingId: number;
    readonly name: string;
    readonly level: number;
    readonly stored: number;
    /** 站位预览色：空闲 / 已占 / 正在建造。 */
    readonly slot: 'empty' | 'building' | 'constructing';
}

export interface IBigMapBuildEntryView {
    readonly buildingId: number;
    readonly name: string;
    readonly kind: number;
    readonly unlocked: boolean;
    readonly reason: string;
    readonly count: number;
    readonly maxOwnNum: number;
    readonly unlockChapter: number;
    readonly costGrain: number;
    readonly costWood: number;
    readonly costIron: number;
    readonly buildTime: number;
    readonly affordable: boolean;
}

export interface IBigMapQueueView {
    readonly slotIndex: number;
    readonly busy: boolean;
    readonly name: string;
    readonly targetLevel: number;
    readonly remainSeconds: number;
    readonly totalSeconds: number;
    readonly progress: number;
}

export interface IBigMapCityView {
    readonly cityId: number;
    readonly name: string;
    readonly layer: number;
    readonly level: number;
    readonly state: BigMapCityState;
    readonly reason: string;
    readonly hpRatio: number;
    readonly warScore: number;
    readonly minWarScore: number;
    readonly staminaCost: number;
    readonly rewardCoin: number;
    readonly desc: string;
    readonly hexId: number;
    readonly distance: number;
    /** 本次攻打的预览值（未开放/已占领时为 0）。 */
    readonly previewDamage: number;
    readonly previewWarScore: number;
    readonly inRange: boolean;
    readonly damageCutPct: number;
    /** 当前攻城日程阶段（顶栏/详情面板显示「可攻打 / 已锁榜 / 休战」）。 */
    readonly phase: BigMapCityPhase;
    /** 现在能不能打（= 已开放 + 日程放行）；`attackReason` 是打不了的具体原因。 */
    readonly canAttack: boolean;
    readonly attackReason: string;
    /** 玩家在这座城的当前名次（喂名次系数；没刷新过榜单时按「独自一人」算 = 1）。 */
    readonly playerRank: number;
    /** 同时在打的人数（喂拥挤系数）。 */
    readonly attackerCount: number;
    readonly topWarScore: number;
}

export interface IBigMapMonsterView {
    readonly instanceId: number;
    readonly monsterId: number;
    readonly name: string;
    readonly level: number;
    readonly hexId: number;
    readonly unlocked: boolean;
    readonly reason: string;
    readonly hpRatio: number;
    readonly staminaCost: number;
    readonly respawnInSeconds: number;
}

/** 建造队列解锁状态（给 UI 显示「解锁第 2 条 · 货币 120」）。 */
export interface IBigMapQueueUnlockInfo {
    readonly current: number;
    readonly max: number;
    /** 下一条的价格（已满时为 0）。 */
    readonly cost: number;
    readonly canUnlock: boolean;
    readonly reason: string;
}

/** 动作结果：`message` 直接丢给 toast，`ok=false` 时是失败原因。 */
export interface IBigMapActionFeedback {
    readonly ok: boolean;
    readonly message: string;
}

export class BigMapPresenter {
    private config: IBigMapConfig;
    private worldInstance: IBigMapWorld;
    private data: IBigMapSaveData;
    private version = 0;
    private readonly listeners = new Set<() => void>();
    /** 城池榜单缓存：`cityId → board`。只在 `refreshCityRank` 里写，视图同步读。 */
    private readonly rankBoards = new Map<number, IBigMapCityRankBoard>();
    private readonly deps: IBigMapPresenterDeps;

    constructor(deps: IBigMapPresenterDeps) {
        this.deps = deps;
        this.config = deps.config;
        this.worldInstance = createBigMapWorldInstance(deps.config, deps.seed, deps.layout);
        this.data = parseBigMapSave(deps.storage.read(deps.saveKey), deps.config, deps.now()).save;
        // 进页面先补一次离线结算，再落盘（否则「离线 8 小时」要等第一次操作才生效）。
        this.tick(false);
        this.persist();
    }

    // -------------------------------------------------------------- 基础访问

    get world(): IBigMapWorld {
        return this.worldInstance;
    }

    get battle(): IBigMapBattleProgress {
        return this.data.battle;
    }

    /** 主城建筑 id（视图给主城换特殊底色时用）。 */
    get mainBuildingId(): number {
        return this.config.mainBuildingId;
    }

    /** 某个建造区格子上「正在建造」的建筑名（空串 = 该格没有在建工程）。 */
    buildingNameOfQueueAt(hexId: number): string {
        const slot = this.data.base.queues.find((item) => (
            item.state === BigMapQueueState.Building && item.instanceId === 0 && item.anchorHexId === hexId
        ));
        if (!slot) return '';
        return this.config.buildings.get(slot.buildingId)?.name ?? '';
    }

    get base(): IBigMapBaseState {
        return this.data.base;
    }

    /** 视图订阅用：任何会改变显示结果的操作都会 +1。 */
    get refreshVersion(): number {
        return this.version;
    }

    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get unlockContext(): IBigMapUnlockContext {
        return bigMapUnlockContextOf(this.data.battle, this.deps.adventureChapter(), this.deps.openDay ?? 0);
    }

    get adventureChapter(): number {
        return this.deps.adventureChapter();
    }

    private emit(): void {
        this.version += 1;
        for (const listener of this.listeners) listener();
    }

    private persist(): void {
        this.data = { ...this.data, savedAt: this.deps.now() };
        this.deps.storage.write(this.deps.saveKey, serializeBigMapSave(this.data));
    }

    private applyBase(base: IBigMapBaseState): void {
        this.data = { ...this.data, base };
    }

    private applyBattle(battle: IBigMapBattleProgress): void {
        this.data = { ...this.data, battle };
    }

    // -------------------------------------------------------------- 时间推进

    /** 结算时间差（产出 / 队列 / 行动力）并顺手补当日快照。 */
    tick(notify = true): void {
        const result = bigMapTick(this.config, this.data.base, this.deps.now());
        this.applyBase(result.state);
        const snapshotted = this.refreshDaySnapshot();
        if (result.completed.length > 0 || snapshotted) this.persist();
        // 快照是「玩家没操作也会发生」的状态变化，必须自己触发重绘。
        if (notify || snapshotted) this.emit();
    }

    /**
     * 过了 22:00（或次日开战前）就定格一份当日战绩快照；同一天只出一份。
     *
     * 只用**确定性**的输入（战功 + 榜单名次 + 日程），所以离线补算与在线结算结果一致。
     */
    private refreshDaySnapshot(): boolean {
        const now = this.deps.now();
        if (!bigMapSnapshotDue(this.config.schedule, now, this.data.snapshot)) return false;
        const snapshot = buildBigMapDaySnapshot(
            this.config.schedule,
            now,
            this.data.battle,
            (cityId) => {
                // 当刻现算，不依赖「玩家是否点开过这座城」——否则名次会随点没点过而变。
                try {
                    return buildBigMapCityRankBoard(this.config, cityId, this.data.battle.cityWarScore[cityId] ?? 0)
                        .playerRank;
                } catch {
                    return 1;
                }
            },
        );
        this.data = { ...this.data, snapshot };
        return true;
    }

    /** 最近一次当日战绩快照（没出过就是 `null`）。 */
    daySnapshot(): IBigMapDaySnapshot | null {
        return this.data.snapshot;
    }

    // -------------------------------------------------------------- 资源栏

    resourceBar(): readonly IBigMapResourceView[] {
        const pending = bigMapPendingHarvest(this.config, this.data.base);
        const perHour = bigMapProducePerHour(this.config, this.data.base);
        return BIGMAP_RES_ORDER.map((type) => ({
            type,
            name: this.config.resources.get(type)?.name ?? type,
            // ⚠️ 行动力走 `base.stamina`（会随攻打消耗、随时间恢复），不是资源包里的
            // `res.stamina`（那只是「初始值」的展示位）。两者同名字段，别串了。
            amount: type === 'stamina'
                ? Math.floor(this.data.base.stamina)
                : Math.floor(this.data.base.res[type]),
            cap: bigMapResCap(this.config, this.data.base, type),
            pending: Math.floor(pending[type]),
            perHour: perHour[type],
        }));
    }

    /**
     * 建造队列的解锁状态。
     *
     * 🔴 文档口径（`docs/bigmap-系统落地方案.md` §2「建造 · 队列」）：3 队列、**付费解锁** ——
     * 所以队列数量只看存档 `queueUnlocked`，与建了哪些建筑无关。
     */
    queueUnlockInfo(): IBigMapQueueUnlockInfo {
        const current = bigMapClampQueueUnlocked(this.config, this.data.base.queueUnlocked);
        const max = this.config.queue.maxBuildQueue;
        if (current >= max) {
            return { current, max, cost: 0, canUnlock: false, reason: '建造队列已满' };
        }
        const cost = current <= 1
            ? this.config.queue.queueUnlockCost2
            : this.config.queue.queueUnlockCost3;
        const affordable = Number.isFinite(cost) && cost > 0 && this.data.base.res.coin >= cost;
        return {
            current,
            max,
            cost: affordable || Number.isFinite(cost) ? cost : 0,
            canUnlock: affordable,
            reason: affordable ? '' : `货币不足（需要 ${Math.round(cost || 0)}）`,
        };
    }

    /** 花货币解锁下一条建造队列。 */
    unlockBuildQueue(): IBigMapActionFeedback {
        const result = bigMapUnlockQueue(this.config, this.data.base);
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: `建造队列 +1（消耗货币 ${Math.round(result.cost)}）` };
    }

    mainLevel(): number {        return bigMapMainLevel(this.config, this.data.base);
    }

    attackPower(): number {
        return bigMapAttackPower(this.config, this.data.base);
    }

    // -------------------------------------------------------------- 建造区

    plotCells(): readonly IBigMapPlotCellView[] {
        const rows = this.config.queue.plotRows;
        const cols = this.config.queue.plotCols;
        const views: IBigMapPlotCellView[] = [];
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < cols; column += 1) {
                const hexId = row * cols + column;
                const instance = this.data.base.buildings.find((item) => item.hexId === hexId);
                const constructing = this.data.base.queues.some((slot) => (
                    slot.state === BigMapQueueState.Building
                    && slot.instanceId === 0
                    && slot.anchorHexId === hexId
                ));
                views.push({
                    hexId,
                    row,
                    column,
                    instanceId: instance?.instanceId ?? 0,
                    buildingId: instance?.buildingId ?? 0,
                    name: instance ? (this.config.buildings.get(instance.buildingId)?.name ?? '') : '',
                    level: instance?.level ?? 0,
                    stored: Math.floor(instance?.stored ?? 0),
                    slot: constructing ? 'constructing' : instance ? 'building' : 'empty',
                });
            }
        }
        return views;
    }

    buildMenu(): readonly IBigMapBuildEntryView[] {
        const context = this.unlockContext;
        return [...this.config.buildings.values()]
            .sort((a, b) => a.sort - b.sort || a.id - b.id)
            .map((building) => {
                const unlock = bigMapBuildingUnlock(building, context);
                const cost = this.config.levels.get(building.id)?.get(1);
                return {
                    buildingId: building.id,
                    name: building.name,
                    kind: building.kind,
                    unlocked: unlock.unlocked,
                    reason: unlock.reason,
                    count: bigMapBuildingCountWithQueue(this.data.base, building.id),
                    maxOwnNum: building.maxOwnNum,
                    unlockChapter: building.unlockChapter,
                    costGrain: cost?.costGrain ?? 0,
                    costWood: cost?.costWood ?? 0,
                    costIron: cost?.costIron ?? 0,
                    buildTime: cost?.buildTime ?? 0,
                    affordable: cost ? bigMapCanAfford(this.data.base, cost) : false,
                };
            });
    }

    /** 建筑升级入口是否已解锁（第 3 章），界面据此给「升级」按钮置灰。 */
    upgradeUnlocked(): boolean {
        return bigMapUpgradeUnlock(this.config, this.unlockContext).unlocked;
    }

    queues(): readonly IBigMapQueueView[] {
        const now = this.deps.now();
        return this.data.base.queues.slice(0, this.data.base.queueUnlocked).map((slot) => {
            const busy = slot.state === BigMapQueueState.Building;
            const total = Math.max(1, slot.finishAt - slot.startAt);
            const remain = Math.max(0, slot.finishAt - now);
            return {
                slotIndex: slot.slotIndex,
                busy,
                name: busy ? (this.config.buildings.get(slot.buildingId)?.name ?? '') : '',
                targetLevel: slot.targetLevel,
                remainSeconds: Math.ceil(remain),
                totalSeconds: total,
                progress: busy ? Math.min(1, Math.max(0, 1 - remain / total)) : 0,
            };
        });
    }

    // -------------------------------------------------------------- 动作：建造

    startBuild(hexId: number, buildingId: number): IBigMapActionFeedback {
        const result = bigMapStartBuild(this.config, this.data.base, this.unlockContext, buildingId, hexId, this.deps.now());
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: `开始建造${this.config.buildings.get(buildingId)?.name ?? ''}` };
    }

    startUpgrade(instanceId: number): IBigMapActionFeedback {
        const result = bigMapStartUpgrade(this.config, this.data.base, this.unlockContext, instanceId, this.deps.now());
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: '开始升级' };
    }

    cancelQueue(slotIndex: number): IBigMapActionFeedback {
        const result = bigMapCancelQueue(this.config, this.data.base, slotIndex);
        if (!result.ok || !result.state) return { ok: false, message: result.reason };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: '已取消，资源已返还' };
    }

    harvest(instanceId: number): IBigMapActionFeedback {
        const result = bigMapHarvest(this.config, this.data.base, instanceId);
        if (!result.resType) return { ok: false, message: '暂无可收取资源' };
        if (result.amount <= 0) return { ok: false, message: '仓库已满，先花掉一些资源' };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        const name = this.config.resources.get(result.resType)?.name ?? result.resType;
        return { ok: true, message: `${name} +${result.amount}${result.capped ? '（仓库已满）' : ''}` };
    }

    harvestAll(): IBigMapActionFeedback {
        const result = bigMapHarvestAll(this.config, this.data.base);
        const parts = BIGMAP_RES_ORDER
            .filter((type) => result.gained[type] > 0)
            .map((type) => `${this.config.resources.get(type)?.name ?? type} +${Math.floor(result.gained[type])}`);
        if (parts.length === 0) return { ok: false, message: '暂无可收取资源' };
        this.applyBase(result.state);
        this.persist();
        this.emit();
        return { ok: true, message: parts.join('，') };
    }

    /** 点击建造区某格：建造中 → 取消；已建 → 升级；空 → 返回空（让界面进入摆放模式）。 */
    tapPlotCell(hexId: number): IBigMapActionFeedback {
        const instance = this.data.base.buildings.find((item) => item.hexId === hexId);
        if (instance) return this.startUpgrade(instance.instanceId);
        const constructing = this.data.base.queues.find((slot) => (
            slot.state === BigMapQueueState.Building && slot.instanceId === 0 && slot.anchorHexId === hexId
        ));
        if (constructing) return this.cancelQueue(constructing.slotIndex);
        return { ok: false, message: '空位：先从建造列表选一座建筑' };
    }

    // -------------------------------------------------------------- 动作：战斗

    /**
     * 当前攻城日程 —— 视图每帧直接读它（幂等），不自己算时间。
     *
     * 日程来自 `bigmapSchedule` 表（`config.schedule`），代码里不写 `21:00` 这种字面量；
     * 时钟走 `deps.now()` 端口（联机版换服务器校准秒即可），所以这里不出现 `Date.now()`。
     */
    cityTimeline(): IBigMapCityTimeline {
        return bigMapCityTimeline(this.config.schedule, this.deps.now());
    }

    /** 某座城当前的榜单（未刷新过就是「只有你」的兜底榜，绝不返回 null）。 */
    cityRankBoard(cityId: number): IBigMapCityRankBoard {
        const cached = this.rankBoards.get(cityId);
        if (cached) return cached;
        return buildSoloRankBoard(cityId, this.data.battle.cityWarScore[cityId] ?? 0);
    }

    /**
     * 刷新某座城的榜单 —— 进详情/进排行页时调，拿回来缓存住并通知重绘。
     *
     * 端口失败不抛给界面（与「存档损坏退回新档」同一口径）：回退到本地 NPC 榜。
     */
    async refreshCityRank(cityId: number): Promise<void> {
        if (!this.config.cities.has(cityId)) return;
        const warScore = this.data.battle.cityWarScore[cityId] ?? 0;
        let board: IBigMapCityRankBoard;
        try {
            board = this.deps.rankProvider
                ? await this.deps.rankProvider.fetchCityRank(cityId, warScore)
                : buildBigMapCityRankBoard(this.config, cityId, warScore);
        } catch {
            board = buildBigMapCityRankBoard(this.config, cityId, warScore);
        }
        this.rankBoards.set(cityId, board);
        this.emit();
    }

    cityView(cityId: number): IBigMapCityView | null {
        const city = this.config.cities.get(cityId);
        const site = this.worldInstance.cities.get(cityId);
        if (!city || !site) return null;
        const context = this.unlockContext;
        const state = bigMapCityState(city, context);
        const reason = bigMapCityUnlock(city, context).reason;
        const timeline = this.cityTimeline();
        const gate = bigMapCityAttackGate(state, timeline);
        const board = this.cityRankBoard(cityId);
        const distance = bigMapHexDistance(
            this.worldInstance.rows, this.worldInstance.cols,
            this.worldInstance.playerBase.hexId, site.anchorHexId,
        );
        const preview = state === 'open'
            ? bigMapCityAttackPreview(
                this.config, this.data.base, city, distance,
                board.attackerCount, board.playerRank,
            )
            : null;
        return {
            cityId: city.cityId,
            name: city.name,
            layer: city.layer,
            level: city.cityLevel,
            state,
            reason,
            hpRatio: bigMapCityHpRatio(this.data.battle, city),
            warScore: Math.round(this.data.battle.cityWarScore[city.cityId] ?? 0),
            minWarScore: this.config.cityLevels.get(city.cityLevel)?.minOccupyWarScore ?? 0,
            staminaCost: city.staminaCost,
            rewardCoin: city.rewardCoin,
            desc: city.desc,
            hexId: site.anchorHexId,
            distance,
            previewDamage: preview?.damage ?? 0,
            previewWarScore: preview?.warScore ?? 0,
            inRange: preview?.inRange ?? false,
            damageCutPct: preview?.damageCutPct ?? 0,
            phase: timeline.phase,
            canAttack: gate.canAttack,
            attackReason: gate.reason,
            playerRank: board.playerRank,
            attackerCount: board.attackerCount,
            topWarScore: board.topWarScore,
        };
    }

    allCityViews(): readonly IBigMapCityView[] {
        return [...this.config.cities.values()]
            .map((city) => this.cityView(city.cityId))
            .filter((view): view is IBigMapCityView => view !== null);
    }

    monsterView(instanceId: number): IBigMapMonsterView | null {
        const site = this.worldInstance.monsters.find((item) => item.instanceId === instanceId);
        if (!site) return null;
        const monster = this.config.monsters.get(site.monsterId);
        if (!monster) return null;
        const unlock = bigMapMonsterUnlock(monster, this.unlockContext);
        const respawnAt = this.data.battle.monsterRespawnAt[instanceId] ?? 0;
        return {
            instanceId,
            monsterId: site.monsterId,
            name: monster.name,
            level: monster.level,
            hexId: site.anchorHexId,
            unlocked: unlock.unlocked,
            reason: unlock.reason,
            hpRatio: bigMapMonsterHpRatio(this.config, this.data.battle, site),
            staminaCost: bigMapMonsterAttackPreview(this.config, this.data.base, site).staminaCost,
            respawnInSeconds: Math.max(0, Math.ceil(respawnAt - this.deps.now())),
        };
    }

    attackCity(cityId: number): IBigMapActionFeedback {
        const city = this.config.cities.get(cityId);
        const view = this.cityView(cityId);
        if (!city || !view) return { ok: false, message: '城池不存在' };
        // 日程是**唯一入口**：休战/结算期即使城池开放也不许打，否则「锁榜后还能刷战功」。
        if (!view.canAttack) return { ok: false, message: view.attackReason || '当前无法攻城' };
        const outcome = bigMapAttackCity(
            this.config, this.data.base, this.data.battle, city, view.distance,
            {
                adventureChapter: this.deps.adventureChapter(),
                openDay: this.deps.openDay ?? 0,
                // 名次 / 拥挤系数用当前榜单的真值，不再恒等于 1。
                attackers: view.attackerCount,
                rank: view.playerRank,
            },
        );
        if (!outcome.ok || !outcome.base || !outcome.progress) {
            return { ok: false, message: outcome.reason };
        }
        this.applyBase(outcome.base);
        this.applyBattle(outcome.progress);
        this.persist();
        // 战功变了名次就变：同步重算一次本地榜（联机时再让 provider 覆盖成服务器真值）。
        this.rankBoards.set(
            cityId,
            buildBigMapCityRankBoard(this.config, cityId, this.data.battle.cityWarScore[cityId] ?? 0),
        );
        if (this.deps.rankProvider) void this.refreshCityRank(cityId);
        this.emit();
        if (outcome.occupied) return { ok: true, message: `占领 ${city.name}！货币 +${city.rewardCoin}` };
        if (outcome.breached) return { ok: true, message: `${city.name} 城防已破，继续积累战功` };
        return { ok: true, message: `造成 ${outcome.preview?.damage ?? 0} 伤害，战功 +${outcome.preview?.warScore ?? 0}` };
    }

    attackMonster(instanceId: number): IBigMapActionFeedback {
        const site = this.worldInstance.monsters.find((item) => item.instanceId === instanceId);
        if (!site) return { ok: false, message: '野怪不存在' };
        const outcome = bigMapAttackMonster(
            this.config, this.data.base, this.data.battle, site, this.deps.now(),
        );
        if (!outcome.ok || !outcome.base || !outcome.progress) {
            return { ok: false, message: outcome.reason };
        }
        this.applyBase(outcome.base);
        this.applyBattle(outcome.progress);
        this.persist();
        this.emit();
        if (outcome.breached) return { ok: true, message: '击杀成功，资源已入账' };
        return { ok: true, message: `造成 ${outcome.preview?.damage ?? 0} 伤害` };
    }

    // -------------------------------------------------------------- 便捷查询

    /** 玩家基地到某格的距离（界面显示「距离 x 格」）。 */
    distanceFromBase(hexId: number): number {
        return bigMapHexDistance(
            this.worldInstance.rows, this.worldInstance.cols,
            this.worldInstance.playerBase.hexId, hexId,
        );
    }

    /** 主城建筑实例（建造区中心那座），给「主城」按钮用。 */
    mainInstanceId(): number {
        return bigMapMainBuilding(this.config, this.data.base)?.instanceId ?? 0;
    }

    /** 重置存档（调试面板用；正式版不给玩家入口）。 */
    resetSave(): IBigMapActionFeedback {
        const fresh = parseBigMapSave(null, this.config, this.deps.now()).save;
        this.data = fresh;
        this.persist();
        this.emit();
        return { ok: true, message: '基地已重置' };
    }
}
