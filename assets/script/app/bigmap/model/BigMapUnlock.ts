/**
 * 大世界解锁链 —— **纯规则，零 `cc` 依赖**。
 *
 * 本期只有一条主链（用户 2026-10-17 明确的核心目标）：
 *
 * ```
 * 冒险关卡通关 ──┬─→ 基地建筑解锁（主城 1 章 / 资源田 2 章 / 货币田 3 章 / 科技树 4 章 / 功能建筑 5 章 / 装饰小玩法）
 *               └─→ 城池解锁（章节 + 开服天数 + 前置城池已占领，三重条件）
 * 野怪通关等级 ──→ 更高级野怪解锁（逐级，攻 5 级需先通关 4 级）
 * ```
 *
 * 所有判定都做成**纯函数 + 返回原因**，界面直接拿 `reason` 显示「未解锁：需通关第 3 章」，
 * 避免「按钮灰着但不知道为啥」。
 */
import {
    BigMapCityLayer,
    type BigMapCityState,
    type IBigMapBuildingConfig,
    type IBigMapCityConfig,
    type IBigMapConfig,
    type IBigMapMonsterConfig,
} from './BigMapTypes';

/** 解锁判定需要的玩家进度快照。 */
export interface IBigMapUnlockContext {
    /** 冒险玩法已通关章节数（`TerritorySaveStoreAdapter.loadLastChapter` 的口径：0 表示一章都没过）。 */
    readonly adventureChapter: number;
    /** 开服天数，0 起（本期单机版恒为 0，联机版由服务器下发）。 */
    readonly openDay: number;
    /** 已占领的城池 id 集合。 */
    readonly occupiedCityIds: ReadonlySet<number>;
    /** 已通关的最高野怪等级（0 = 一只都没打）。 */
    readonly maxClearedMonsterLevel: number;
}

export interface IBigMapUnlockResult {
    readonly unlocked: boolean;
    /** 未解锁时的展示文案；已解锁为空串。 */
    readonly reason: string;
}

const OK: IBigMapUnlockResult = { unlocked: true, reason: '' };

export function bigMapLocked(reason: string): IBigMapUnlockResult {
    return { unlocked: false, reason };
}

/** 建筑解锁 —— **唯一来源是冒险章节通关**（用户要求）。 */
export function bigMapBuildingUnlock(
    building: IBigMapBuildingConfig,
    context: IBigMapUnlockContext,
): IBigMapUnlockResult {
    if (building.unlockChapter > context.adventureChapter) {
        return bigMapLocked(`通关冒险第 ${building.unlockChapter} 章解锁`);
    }
    return OK;
}

/** 在基地建造列表里，当前进度下可见（已解锁）的建筑，按 `sort` 升序。 */
export function bigMapUnlockedBuildings(
    config: IBigMapConfig,
    context: IBigMapUnlockContext,
): readonly IBigMapBuildingConfig[] {
    return [...config.buildings.values()]
        .filter((building) => bigMapBuildingUnlock(building, context).unlocked)
        .sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/** 「建筑升级」功能本身也要解锁：文档写「第 1 章解锁主城，通过第 {3} 章后解锁建筑升级」。 */
export function bigMapUpgradeUnlock(config: IBigMapConfig, context: IBigMapUnlockContext): IBigMapUnlockResult {
    const chapter = config.queue.upgradeUnlockChapter;
    if (context.adventureChapter < chapter) {
        return bigMapLocked(`通关冒险第 ${chapter} 章解锁建筑升级`);
    }
    return OK;
}

/** 城池解锁：`available`（本期开放层）→ 已占领 → 章节 → 开服天数 → 前置城池。 */
export function bigMapCityState(city: IBigMapCityConfig, context: IBigMapUnlockContext): BigMapCityState {
    if (!city.available) return 'unavailable';
    if (context.occupiedCityIds.has(city.cityId)) return 'occupied';
    return bigMapCityUnlock(city, context).unlocked ? 'open' : 'locked';
}

/** 城池未解锁的具体原因（按「最容易被玩家理解」的顺序报告，一次只说一条）。 */
export function bigMapCityUnlock(city: IBigMapCityConfig, context: IBigMapUnlockContext): IBigMapUnlockResult {
    if (!city.available) return bigMapLocked('联盟 / 战盟玩法本期未开放');
    if (context.adventureChapter < city.unlockChapter) {
        return bigMapLocked(`通关冒险第 ${city.unlockChapter} 章解锁`);
    }
    if (context.openDay < city.openDay) {
        return bigMapLocked(`开服第 ${city.openDay + 1} 天开放`);
    }
    if (city.prevCityId !== 0 && !context.occupiedCityIds.has(city.prevCityId)) {
        return bigMapLocked('需先占领前置城池');
    }
    return OK;
}

/**
 * 下一个「值得打」的城池：优先同环已开放且未占领，其次更低等级。
 *
 * 用于界面上的「主线指引」箭头 —— 纯玩家个人层的解锁是 4 条并行链，
 * 没有唯一目标，给个确定性排序比让玩家自己在 25 座城里找更靠谱。
 */
export function bigMapNextTargetCity(
    config: IBigMapConfig,
    context: IBigMapUnlockContext,
): IBigMapCityConfig | null {
    const open = [...config.cities.values()]
        .filter((city) => bigMapCityState(city, context) === 'open')
        .sort((a, b) => a.cityLevel - b.cityLevel || a.cityId - b.cityId);
    return open.length > 0 ? open[0] : null;
}

/** 野怪解锁：必须逐级通关（`preLevel = 0` 的 1 级怪无门槛）。 */
export function bigMapMonsterUnlock(
    monster: IBigMapMonsterConfig,
    context: IBigMapUnlockContext,
): IBigMapUnlockResult {
    if (monster.battle) {
        if (monster.battle.unlockType === 0) return OK;
        return bigMapLocked('野怪解锁条件待服务端确认');
    }
    const offline = monster.offlineBattle;
    if (!offline) return bigMapLocked('野怪配置缺少战斗信息');
    if (offline.preLevel > context.maxClearedMonsterLevel) {
        return bigMapLocked(`需先通关 ${offline.preLevel} 级野怪`);
    }
    return OK;
}

/**
 * 攻打城池前的「势力范围」检查 —— 文档规定：
 * 基地不在城池势力范围内时，攻城伤害 −{offRangeDamageCutPct}%。
 *
 * **判据（2026-10-23 后端补 `SlgGameInfo.toCampId` 后改口径）**：
 * - 有服务器下发的 `toCampId`（`> 0`）时，**它就是唯一真源** —— 在不在范围内 = 是不是我这座城；
 *   不再用几何距离近似（`radiateCapacity` 是配置半径，与服务器实际划的势力范围不是一回事）。
 * - `toCampId === 0` 表示「还没收到包 / 尚未归属」，此时才回退 `radiateCapacity` 距离判定。
 *
 * 这里只回答「在不在范围内」，削减数值由战斗模型取配置；
 * 这样界面能分开展示「距离过远，伤害 -20%」，而不是把这个惩罚藏在伤害数字里。
 */
export function bigMapWithinCityRange(
    city: IBigMapCityConfig,
    hexDistance: number,
    playerCampId = 0,
): boolean {
    if (playerCampId > 0) return city.cityId === playerCampId;
    return hexDistance <= city.radiateCapacity;
}

/** 城池层级的展示名（线框图左上角标签用）。 */
export function bigMapCityLayerName(layer: BigMapCityLayer): string {
    switch (layer) {
        case BigMapCityLayer.Legion: return '军团';
        case BigMapCityLayer.WarAlliance: return '战盟';
        case BigMapCityLayer.Throne: return '王座';
        default: return '个人';
    }
}
