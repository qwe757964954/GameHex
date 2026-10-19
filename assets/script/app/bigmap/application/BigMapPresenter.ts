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
import { parseBigMapSave, serializeBigMapSave, type IBigMapSaveData } from '../model/BigMapSaveData';

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
    private readonly deps: IBigMapPresenterDeps;

    constructor(deps: IBigMapPresenterDeps) {
        this.deps = deps;
        this.config = deps.config;
        this.worldInstance = buildBigMapWorld(deps.config, deps.seed);
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

    /** 结算时间差（产出 / 队列 / 行动力）。`notify=false` 用于构造函数里那次静默结算。 */
    tick(notify = true): void {
        const result = bigMapTick(this.config, this.data.base, this.deps.now());
        this.applyBase(result.state);
        if (result.completed.length > 0) this.persist();
        if (notify) this.emit();
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

    mainLevel(): number {
        return bigMapMainLevel(this.config, this.data.base);
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

    cityView(cityId: number): IBigMapCityView | null {
        const city = this.config.cities.get(cityId);
        const site = this.worldInstance.cities.get(cityId);
        if (!city || !site) return null;
        const context = this.unlockContext;
        const state = bigMapCityState(city, context);
        const reason = bigMapCityUnlock(city, context).reason;
        const distance = bigMapHexDistance(
            this.worldInstance.rows, this.worldInstance.cols,
            this.worldInstance.playerBase.hexId, site.anchorHexId,
        );
        const preview = state === 'open'
            ? bigMapCityAttackPreview(this.config, this.data.base, city, distance)
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
        const outcome = bigMapAttackCity(
            this.config, this.data.base, this.data.battle, city, view.distance,
            { adventureChapter: this.deps.adventureChapter(), openDay: this.deps.openDay ?? 0 },
        );
        if (!outcome.ok || !outcome.base || !outcome.progress) {
            return { ok: false, message: outcome.reason };
        }
        this.applyBase(outcome.base);
        this.applyBattle(outcome.progress);
        this.persist();
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
