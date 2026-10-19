/**
 * 攻城 / 野怪战斗结算 —— **纯规则，零 `cc` 依赖**。
 *
 * 本期是「纯玩家个人战斗」版：没有联盟、没有战盟、没有实时 PVP，
 * 所以这里把文档里那一大套「多人混战 + 名次系数」简化成**单人 + NPC 竞争者**的可算版本：
 *
 * ```
 * 伤害   = (基础攻击 + 主城等级加成) × 势力范围系数（不在范围内 −20%）
 * 战功   = 边际递减(伤害) × 城池战功倍率 × 名次系数 × 拥挤系数
 * 城防   = 城池 defenseHp 逐次扣减；打穿 且 战功 ≥ minOccupyWarScore ⇒ 占领
 * ```
 *
 * 所有公式都写成**可复现的纯函数**并在 `docs/bigmap-系统实现说明.md` §2 记了推算口径，
 * 改数值只需改 `BigMap-城池等级` / `BigMap-积分规则`，不用动代码。
 */
import {
    BigMapQueueState,
    type BigMapResType,
    type IBigMapBaseState,
    type IBigMapCityConfig,
    type IBigMapCitySite,
    type IBigMapConfig,
    type IBigMapMonsterSite,
} from './BigMapTypes';
import { bigMapMonsterUnlock, bigMapWithinCityRange, type IBigMapUnlockContext } from './BigMapUnlock';
import { bigMapResCap } from './BigMapBase';

/** 主城 1 级的基础攻城伤害；每升 1 级 +180（主城等级是唯一的「战力」来源）。 */
export const BIGMAP_BASE_ATTACK = 420;
export const BIGMAP_ATTACK_PER_MAIN_LEVEL = 180;

/** 玩家在大地图上的战斗进度（存档的一部分，与基地状态分开存，互不干扰）。 */
export interface IBigMapBattleProgress {
    /** cityId → 剩余城防。缺省视为满血（`defenseHp`）。 */
    readonly cityHp: Readonly<Record<number, number>>;
    /** cityId → 本轮累计战功（用于占领判定与界面进度条）。 */
    readonly cityWarScore: Readonly<Record<number, number>>;
    /** 野怪实例 id → 本轮累计战功（与城池分开记，避免 id 空间混淆）。 */
    readonly monsterWarScore: Readonly<Record<number, number>>;
    readonly occupiedCityIds: readonly number[];
    /** 野怪实例 id → 剩余血量。缺省视为满血。 */
    readonly monsterHp: Readonly<Record<number, number>>;
    /** 野怪实例 id → 可再次挑战的时刻（逻辑秒）。 */
    readonly monsterRespawnAt: Readonly<Record<number, number>>;
    readonly clearedMonsterLevel: number;
    readonly totalWarScore: number;
}

export function createBigMapBattleProgress(): IBigMapBattleProgress {
    return {
        cityHp: {},
        cityWarScore: {},
        monsterWarScore: {},
        occupiedCityIds: [],
        monsterHp: {},
        monsterRespawnAt: {},
        clearedMonsterLevel: 0,
        totalWarScore: 0,
    };
}

/** 战斗进度 → 解锁判定需要的上下文（把两套状态粘起来，避免调用方自己拼）。 */
export function bigMapUnlockContextOf(
    progress: IBigMapBattleProgress,
    adventureChapter: number,
    openDay = 0,
): IBigMapUnlockContext {
    return {
        adventureChapter,
        openDay,
        occupiedCityIds: new Set(progress.occupiedCityIds),
        maxClearedMonsterLevel: progress.clearedMonsterLevel,
    };
}

/** 单次攻打预览：界面在按下去之前就能显示「伤害 / 战功 / 消耗 / 是否在范围内」。 */
export interface IBigMapAttackPreview {
    readonly staminaCost: number;
    readonly damage: number;
    readonly warScore: number;
    /** 基地是否在城池势力范围内；不在时伤害按配置削减。 */
    readonly inRange: boolean;
    /** 伤害削减百分点（0 表示没有惩罚），界面用它显示「伤害 -20%」。 */
    readonly damageCutPct: number;
}

/** 主城等级 → 大地图攻击力。 */
export function bigMapAttackPower(config: IBigMapConfig, base: IBigMapBaseState): number {
    const main = base.buildings.find((item) => item.buildingId === config.mainBuildingId);
    const level = Math.max(1, main?.level ?? 1);
    return BIGMAP_BASE_ATTACK + (level - 1) * BIGMAP_ATTACK_PER_MAIN_LEVEL;
}

/**
 * 伤害转战功的**边际递减**：`cap × (1 − e^(−damage/cap))`。
 *
 * 直线上限会让「堆一次超高伤害」直接吃满战功，文档要求递减，所以用指数饱和：
 * 伤害 = cap 时拿到约 63%，伤害 = 3×cap 时约 95%。
 */
export function bigMapMarginalWarScore(damage: number, cap: number): number {
    if (damage <= 0) return 0;
    const safeCap = Math.max(1, cap);
    return safeCap * (1 - Math.exp(-damage / safeCap));
}

/** 名次系数：1..10 取 `BigMap-名次系数`，第 11 名起每降一名扣 `rankExtendStepPct`，有下限。 */
export function bigMapRankCoeff(config: IBigMapConfig, rank: number): number {
    const table = config.ranks;
    const index = Math.max(1, Math.round(rank));
    if (index <= table.length) return table[index - 1].coeffPct / 100;
    const extra = (index - table.length) * config.scoreRule.rankExtendStepPct;
    const pct = Math.max(config.scoreRule.rankExtendMinPct, table[table.length - 1].coeffPct - extra);
    return pct / 100;
}

/**
 * 拥挤系数：同一座城围攻的人越多，单次战功越低（抑制「一窝蜂」）。
 * `crowdBase = 0.5`、`crowdK = 0.5` 时：1 人 = 1.0，3 人 ≈ 0.68，10 人 ≈ 0.51。
 */
export function bigMapCrowdCoeff(config: IBigMapConfig, attackers: number): number {
    const { crowdBase, crowdK } = config.scoreRule;
    const count = Math.max(1, attackers);
    return crowdBase + (1 - crowdBase) * Math.exp(-crowdK * (count - 1));
}

/** 攻城预览（不扣任何东西，纯算数）。 */
export function bigMapCityAttackPreview(
    config: IBigMapConfig,
    base: IBigMapBaseState,
    city: IBigMapCityConfig,
    distanceToCity: number,
    attackers = 1,
    rank = 1,
): IBigMapAttackPreview {
    const inRange = bigMapWithinCityRange(city, distanceToCity);
    const cutPct = inRange ? 0 : config.scoreRule.offRangeDamageCutPct;
    const damage = Math.max(1, Math.round(
        bigMapAttackPower(config, base) * (1 - cutPct / 100),
    ));
    const warScore = Math.round(
        bigMapMarginalWarScore(damage, config.scoreRule.marginalDamageCap)
        * config.cityLevels.get(city.cityLevel)!.warScoreRate
        * bigMapRankCoeff(config, rank)
        * bigMapCrowdCoeff(config, attackers),
    );
    return { staminaCost: city.staminaCost, damage, warScore, inRange, damageCutPct: cutPct };
}

/** 一次攻打的完整结果。`progress` / `base` 为空表示前置检查没过（此时不改任何状态）。 */
export interface IBigMapAttackOutcome {
    readonly ok: boolean;
    readonly reason: string;
    readonly preview: IBigMapAttackPreview | null;
    readonly base: IBigMapBaseState | null;
    readonly progress: IBigMapBattleProgress | null;
    /** 本次打穿城防（第一次把血量打到 0）。 */
    readonly breached: boolean;
    /** 本次完成占领。 */
    readonly occupied: boolean;
    /** 占领 / 击杀掉落。 */
    readonly reward: Readonly<Partial<Record<BigMapResType, number>>>;
}

/** 攻城的外部条件（服务器下发的部分）。 */
export interface IBigMapAttackOptions {
    /** 冒险已通关章节数。 */
    readonly adventureChapter: number;
    /** 开服天数，缺省 0。 */
    readonly openDay?: number;
    /** 同城围攻人数，缺省 1（单机版恒为 1）。 */
    readonly attackers?: number;
    /** 玩家当前名次，缺省 1。 */
    readonly rank?: number;
}

function fail(reason: string, preview: IBigMapAttackPreview | null = null): IBigMapAttackOutcome {
    return { ok: false, reason, preview, base: null, progress: null, breached: false, occupied: false, reward: {} };
}

function spendStamina(base: IBigMapBaseState, cost: number): IBigMapBaseState | null {
    if (base.stamina < cost) return null;
    return { ...base, stamina: base.stamina - cost };
}

function addRes(
    config: IBigMapConfig,
    base: IBigMapBaseState,
    gain: Readonly<Partial<Record<BigMapResType, number>>>,
): IBigMapBaseState {
    const res = { ...base.res };
    for (const [key, value] of Object.entries(gain)) {
        const type = key as BigMapResType;
        const cap = bigMapResCap(config, base, type);
        res[type] = Math.min(cap, res[type] + (value ?? 0));
    }
    return { ...base, res };
}

/**
 * 攻打城池。
 *
 * 一轮打完（`defenseHp <= 0`）时**不会自动占领**：还要战功达到
 * `BigMap-城池等级.minOccupyWarScore`，对应文档里「打穿只是第一步，站住才算占领」。
 *
 * ⚠️ 这里刻意**不接 `IBigMapUnlockContext`**：解锁上下文里的 `occupiedCityIds` 必须与
 * `progress` 完全一致，两处各自维护迟早会不一致（前置城池判定就会错）。所以只接
 * 「章节 / 开服天数」两个标量，占领集合一律从 `progress` 现取。
 */
export function bigMapAttackCity(
    config: IBigMapConfig,
    base: IBigMapBaseState,
    progress: IBigMapBattleProgress,
    city: IBigMapCityConfig,
    distanceToCity: number,
    options: IBigMapAttackOptions,
): IBigMapAttackOutcome {
    const openDay = options.openDay ?? 0;
    const attackers = options.attackers ?? 1;
    const rank = options.rank ?? 1;
    // 未开放 / 未解锁 / 已占领 都不允许再打。
    if (!city.available) return fail('该城池本期未开放');
    if (progress.occupiedCityIds.includes(city.cityId)) return fail('该城池已占领');
    if (options.adventureChapter < city.unlockChapter) return fail(`通关冒险第 ${city.unlockChapter} 章解锁`);
    if (openDay < city.openDay) return fail(`开服第 ${city.openDay + 1} 天开放`);
    if (city.prevCityId !== 0 && !progress.occupiedCityIds.includes(city.prevCityId)) {
        return fail('需先占领前置城池');
    }

    const preview = bigMapCityAttackPreview(config, base, city, distanceToCity, attackers, rank);
    const nextBase = spendStamina(base, preview.staminaCost);
    if (!nextBase) return fail(`行动力不足（需要 ${preview.staminaCost}）`, preview);

    const hpBefore = progress.cityHp[city.cityId] ?? city.defenseHp;
    const hpAfter = Math.max(0, hpBefore - preview.damage);
    const warScoreTotal = (progress.cityWarScore[city.cityId] ?? 0) + preview.warScore;

    const levelConfig = config.cityLevels.get(city.cityLevel)!;
    const breached = hpBefore > 0 && hpAfter <= 0;
    const occupied = hpAfter <= 0 && warScoreTotal >= levelConfig.minOccupyWarScore;

    let reward: Partial<Record<BigMapResType, number>> = {};
    let finalBase = nextBase;
    if (occupied) {
        reward = { coin: city.rewardCoin };
        finalBase = addRes(config, nextBase, reward);
    }

    return {
        ok: true,
        reason: '',
        preview,
        base: finalBase,
        progress: {
            ...progress,
            cityHp: { ...progress.cityHp, [city.cityId]: occupied ? city.defenseHp : hpAfter },
            // 占领后战功清零重新计（下一轮归属争夺用），没占领则继续累加。
            cityWarScore: { ...progress.cityWarScore, [city.cityId]: occupied ? 0 : warScoreTotal },
            occupiedCityIds: occupied
                ? [...progress.occupiedCityIds, city.cityId]
                : progress.occupiedCityIds,
            totalWarScore: progress.totalWarScore
                + preview.warScore
                + (occupied ? levelConfig.occupyScore : 0),
        },
        breached,
        occupied,
        reward,
    };
}

/** 野怪预览：伤害 / 战功 / 行动力，规则与攻城一致但不吃势力范围惩罚。 */
export function bigMapMonsterAttackPreview(
    config: IBigMapConfig,
    base: IBigMapBaseState,
    site: IBigMapMonsterSite,
    rank = 1,
): IBigMapAttackPreview {
    const monster = config.monsters.get(site.monsterId)!;
    const damage = Math.max(1, Math.round(bigMapAttackPower(config, base)));
    const warScore = Math.round(
        bigMapMarginalWarScore(damage, config.scoreRule.marginalDamageCap)
        * bigMapRankCoeff(config, rank),
    );
    void monster;
    return { staminaCost: monster.staminaCost, damage, warScore, inRange: true, damageCutPct: 0 };
}

/**
 * 攻打野怪。
 *
 * 击杀后：发奖、记 `clearedMonsterLevel`（逐级解锁的唯一来源）、按 `respawnSeconds` 计时刷新。
 * 刷新期间再点会拿到 `ok: false`，界面据此显示倒计时。
 */
export function bigMapAttackMonster(
    config: IBigMapConfig,
    base: IBigMapBaseState,
    progress: IBigMapBattleProgress,
    site: IBigMapMonsterSite,
    now: number,
    rank = 1,
): IBigMapAttackOutcome {
    const monster = config.monsters.get(site.monsterId);
    if (!monster) return fail('野怪配置不存在');
    const unlock = bigMapMonsterUnlock(monster, {
        adventureChapter: 0,
        openDay: 0,
        occupiedCityIds: new Set(progress.occupiedCityIds),
        maxClearedMonsterLevel: progress.clearedMonsterLevel,
    });
    if (!unlock.unlocked) return fail(unlock.reason);
    const respawnAt = progress.monsterRespawnAt[site.instanceId] ?? 0;
    if (respawnAt > now) return fail('已击杀，等待刷新');

    const preview = bigMapMonsterAttackPreview(config, base, site, rank);
    const nextBase = spendStamina(base, preview.staminaCost);
    if (!nextBase) return fail(`行动力不足（需要 ${preview.staminaCost}）`, preview);

    const hpBefore = progress.monsterHp[site.instanceId] ?? monster.defenseHp;
    const hpAfter = Math.max(0, hpBefore - preview.damage);
    const killed = hpAfter <= 0;
    const warScoreTotal = (progress.monsterWarScore[site.instanceId] ?? 0) + preview.warScore;

    const reward: Partial<Record<BigMapResType, number>> = killed
        ? {
            grain: monster.rewardGrain,
            wood: monster.rewardWood,
            iron: monster.rewardIron,
            coin: monster.rewardCoin,
        }
        : {};

    return {
        ok: true,
        reason: '',
        preview,
        base: killed ? addRes(config, nextBase, reward) : nextBase,
        progress: {
            ...progress,
            monsterHp: { ...progress.monsterHp, [site.instanceId]: killed ? monster.defenseHp : hpAfter },
            monsterRespawnAt: killed
                ? { ...progress.monsterRespawnAt, [site.instanceId]: now + monster.respawnSeconds }
                : progress.monsterRespawnAt,
            monsterWarScore: { ...progress.monsterWarScore, [site.instanceId]: killed ? 0 : warScoreTotal },
            clearedMonsterLevel: killed
                ? Math.max(progress.clearedMonsterLevel, monster.level)
                : progress.clearedMonsterLevel,
            totalWarScore: progress.totalWarScore + preview.warScore + (killed ? monster.warScore : 0),
        },
        breached: killed,
        occupied: false,
        reward,
    };
}

/** 城池剩余城防百分比（界面进度条）。 */
export function bigMapCityHpRatio(
    progress: IBigMapBattleProgress,
    city: IBigMapCityConfig,
): number {
    const hp = progress.cityHp[city.cityId] ?? city.defenseHp;
    return Math.max(0, Math.min(1, hp / Math.max(1, city.defenseHp)));
}

/** 野怪剩余血量百分比。 */
export function bigMapMonsterHpRatio(
    config: IBigMapConfig,
    progress: IBigMapBattleProgress,
    site: IBigMapMonsterSite,
): number {
    const monster = config.monsters.get(site.monsterId);
    if (!monster) return 0;
    const hp = progress.monsterHp[site.instanceId] ?? monster.defenseHp;
    return Math.max(0, Math.min(1, hp / Math.max(1, monster.defenseHp)));
}

/** 建造队列是否空闲（攻城与建造互不阻塞，这里只给界面做「有队列正在跑」的角标）。 */
export function bigMapHasActiveQueue(base: IBigMapBaseState): boolean {
    return base.queues.some((slot) => slot.state === BigMapQueueState.Building);
}

/** 城池占位（供界面算「基地到城池」的距离时取锚点）。 */
export function bigMapCityAnchor(citySite: IBigMapCitySite): number {
    return citySite.anchorHexId;
}
