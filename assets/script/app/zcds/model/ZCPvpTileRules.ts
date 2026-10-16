import { ZCCardRarity, ZCCardType, ZCDeckCard } from './ZCCombatCatalog';
import type { ZCMatchConfig } from './ZCMatchConfig';

/**
 * PVP 可开发地块的五种类别。
 *
 * 取值 = `pvpTile.json` 的 `id` 列（2026-10-13 从英文名改为数字）。
 * 代码里**一律用 `ZCPvpTileType.*` 常量**，不写裸数字 —— 存档（`ZCSnapshot`）里存的就是这些 id，
 * 改值等于改存档格式。
 */
export const ZCPvpTileType = {
    AllRandom: 10001,
    BarracksCommon: 10002,
    BarracksMedium: 10003,
    BarracksAdvanced: 10004,
    Mine: 10005,
} as const;
export type ZCPvpTileType = (typeof ZCPvpTileType)[keyof typeof ZCPvpTileType];

/** 五种地块类型枚举，供运行时配置完整性校验使用（程序逻辑，非策划数值）。 */
export const ZC_PVP_TILE_TYPES: readonly ZCPvpTileType[] = Object.values(ZCPvpTileType);

export type ZCPvpDrawRarity = '空' | ZCCardRarity;

export interface ZCPvpTileConfig {
    type: ZCPvpTileType;
    name: string;
    price: number;
    rarityWeights: Readonly<Record<ZCPvpDrawRarity, number>>;
    /** 该地块能抽到的卡类型（数字：1=金矿/2=兵营/3=防御塔…）；留空时按 `type` 走内置默认。 */
    eligibleCardTypes?: readonly ZCCardType[];
}

/** 地块配置由 pvpTile.json 注入（setPvpTileRules）；未加载配置时为空对象。 */
let tileConfigs: Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> =
    {} as Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;

export function getPvpTileConfigs(): Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> {
    return tileConfigs;
}

/** 全类型随机地块的金色保底抽数由 pvpPity.json 注入；未加载配置时为 0。 */
let allRandomGoldPity = 0;

export function getAllRandomGoldPity(): number {
    return allRandomGoldPity;
}

export interface ZCPvpTileTypeWeight {
    type: ZCPvpTileType;
    weight: number;
    /** 初始生成（主城邻格）阶段该类型个数上限。 */
    initialCountLimit: number;
    /** 同一集合（半场）内该类型个数上限。 */
    setCountLimit: number;
}

/**
 * 基础阵容权重随机表由 pvpTileGen.json / pvpBaseTeamWeight.json 注入；
 * 未加载配置时为空数组（selectPvpTileType 回退到 all-random）。
 */
let tileTypeWeights: readonly ZCPvpTileTypeWeight[] = [];

export function getPvpTileTypeWeights(): readonly ZCPvpTileTypeWeight[] {
    return tileTypeWeights;
}

/** 注入地块、生成权重与保底表解析出的规则；消费方通过 get* 读取。 */
export function setPvpTileRules(
    configs: Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>,
    weights: readonly ZCPvpTileTypeWeight[],
    goldPity: number,
): void {
    tileConfigs = configs;
    tileTypeWeights = weights;
    allRandomGoldPity = goldPity;
}

export interface ZCPvpDrawResult {
    card: ZCDeckCard | null;
    rarity: ZCPvpDrawRarity;
    pityTriggered: boolean;
    nextAllRandomNonGoldDraws: number;
}

function clampRandom(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(0.999999999999, value));
}

export function selectPvpTileType(
    random: () => number = Math.random,
    weights?: readonly ZCPvpTileTypeWeight[],
    excludedTypes?: ReadonlySet<ZCPvpTileType>,
    counts?: ReadonlyMap<ZCPvpTileType, number>,
): ZCPvpTileType {
    const source = weights ?? getPvpTileTypeWeights();
    const usable = source.filter((entry) => (
        entry.weight > 0
        && Number.isFinite(entry.weight)
        && !(excludedTypes?.has(entry.type))
    ));
    const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
        // 全部带权类型均已达上限（可生成格数超过上限总和）：改按当前数量最少的
        // 类型继续填充，均摊超限；避免固定回退 AllRandom 导致单类型爆量。
        const candidates = source.filter((entry) => entry.weight > 0 && Number.isFinite(entry.weight));
        let best = candidates[0];
        for (const entry of candidates) {
            if ((counts?.get(entry.type) ?? 0) < (counts?.get(best.type) ?? 0)) best = entry;
        }
        return best ? best.type : ZCPvpTileType.AllRandom;
    }
    let roll = clampRandom(random()) * total;
    for (const entry of usable) {
        if (roll < entry.weight) return entry.type;
        roll -= entry.weight;
    }
    return usable[usable.length - 1].type;
}

/** 按本局地图、保底和权重配置生成整张 PVP 地图的地块类型。 */
export function createPvpTileTypes(random: () => number, config: ZCMatchConfig): ZCPvpTileType[] {
    const hexes = config.map.hexes;
    const playerHomeId = config.map.playerHomeId;
    const enemyHomeId = config.map.enemyHomeId;
    const homeIds = config.map.homes?.length ? config.map.homes : [playerHomeId, enemyHomeId];
    const homeSet = new Set(homeIds);
    const result = Array<ZCPvpTileType>(hexes.length);
    const rules = config.rules;
    const weights = config.tileWeights;

    // 每对敌我地块只生成一次，再通过 mirrorId 同步地块类型。
    // 初始生成格 = 各席位主城 6 邻格（记录其在“处理侧”的格 id，便于阶段 2 跳过）。
    const processIdOf = (hexId: number): number => (
        hexId <= hexes[hexId].mirrorId ? hexId : hexes[hexId].mirrorId
    );
    const initialProcessIds = new Set<number>();
    for (const homeId of homeIds) {
        const home = hexes[homeId];
        if (!home) continue;
        for (const neighborId of home.neighbors) initialProcessIds.add(processIdOf(neighborId));
    }

    // 半场计数：处理侧（敌方半场）各类型数量；镜像后玩家半场保持一致。
    const counts = new Map<ZCPvpTileType, number>();
    const assign = (processId: number, type: ZCPvpTileType): void => {
        result[processId] = type;
        result[hexes[processId].mirrorId] = type;
        counts.set(type, (counts.get(type) ?? 0) + 1);
    };

    const limitOf = (entry: ZCPvpTileTypeWeight, initial: boolean): number => (
        initial ? entry.initialCountLimit : entry.setCountLimit
    );
    const excludedFor = (initial: boolean): Set<ZCPvpTileType> => {
        const excluded = new Set<ZCPvpTileType>();
        for (const entry of weights) {
            const limit = limitOf(entry, initial);
            if (limit > 0 && (counts.get(entry.type) ?? 0) >= limit) excluded.add(entry.type);
        }
        return excluded;
    };
    /** 初始名额（`initialCountLimit`）是否还抽得出类型；抽不出就说明这批格该交给阶段 2。 */
    const hasInitialRoom = (excluded: ReadonlySet<ZCPvpTileType>): boolean => weights.some((entry) => (
        entry.weight > 0 && Number.isFinite(entry.weight) && !excluded.has(entry.type)
    ));

    // 阶段 1a：金矿保底 —— 每个席位各保底 `initialGuaranteedMine` 个，只在自己的主城邻格里挑。
    const guaranteedPerHome = Math.max(0, Math.floor(rules.initialGuaranteedMine));
    const claimed = new Set<number>();
    for (const homeId of homeIds) {
        const home = hexes[homeId];
        if (!home) continue;
        const candidates: number[] = [];
        let existing = 0;
        for (const neighborId of home.neighbors) {
            if (result[neighborId] === ZCPvpTileType.Mine) existing += 1;
            const processId = processIdOf(neighborId);
            if (!claimed.has(processId)) candidates.push(processId);
        }
        for (let index = existing; index < guaranteedPerHome && candidates.length > 0; index += 1) {
            const pick = Math.floor(clampRandom(random()) * candidates.length);
            const processId = candidates.splice(pick, 1)[0];
            claimed.add(processId);
            assign(processId, ZCPvpTileType.Mine);
        }
    }

    // 阶段 1b：主城邻格其余格按权重抽，受 initialCountLimit 约束。
    // 名额用完的格留给阶段 2，避免 selectPvpTileType 的均摊超限分支突破初始上限。
    for (const processId of Array.from(initialProcessIds)) {
        if (result[processId] !== undefined) continue;
        const excluded = excludedFor(true);
        if (!hasInitialRoom(excluded)) continue;
        assign(processId, selectPvpTileType(random, weights, excluded, counts));
    }

    // 阶段 2：其余格子按权重抽，受 setCountLimit（半场）约束。阶段 1 未定下的邻格也在这里补。
    for (const hex of hexes) {
        if (!hex.playable) continue;
        if (hex.id > hex.mirrorId) continue;
        if (homeSet.has(hex.id)) continue;
        if (result[hex.id] !== undefined) continue;
        assign(hex.id, selectPvpTileType(random, weights, excludedFor(false), counts));
    }

    return result;
}

/** 按品级配置抽牌：先抽空/品级，再从命中品级的本局卡池中等概率选一张。 */
export function drawPvpTile(
    deck: readonly ZCDeckCard[],
    tileType: ZCPvpTileType,
    allRandomNonGoldDraws: number,
    random: () => number = Math.random,
    configs = getPvpTileConfigs(),
    goldPity = getAllRandomGoldPity(),
): ZCPvpDrawResult {
    const config = configs[tileType];
    if (!config) throw new Error(`地块配置未加载：${tileType}`);
    const eligibleTypes: ReadonlySet<ZCCardType> = config.eligibleCardTypes?.length
        ? new Set(config.eligibleCardTypes)
        : new Set<ZCCardType>(tileType === ZCPvpTileType.Mine
            ? [ZCCardType.Mine]
            : tileType === ZCPvpTileType.AllRandom
                ? [ZCCardType.Mine, ZCCardType.Barracks, ZCCardType.Tower]
                : [ZCCardType.Barracks]);
    const eligibleCards = deck.filter((card) => eligibleTypes.has(card.type));
    const goldCards = eligibleCards.filter((card) => card.rarity === '金');
    const pityTriggered = tileType === ZCPvpTileType.AllRandom
        && allRandomNonGoldDraws >= goldPity - 1
        && goldCards.length > 0;
    if (pityTriggered) {
        const card = goldCards[Math.floor(clampRandom(random()) * goldCards.length)];
        return { card, rarity: '金', pityTriggered: true, nextAllRandomNonGoldDraws: 0 };
    }

    const cardsByRarity = new Map<ZCCardRarity, ZCDeckCard[]>();
    for (const card of eligibleCards) {
        const cards = cardsByRarity.get(card.rarity) ?? [];
        cards.push(card);
        cardsByRarity.set(card.rarity, cards);
    }
    const rarities: readonly ZCCardRarity[] = ['绿', '蓝', '紫', '金'];
    const configuredTotal = config.rarityWeights.空
        + rarities.reduce((sum, rarity) => sum + config.rarityWeights[rarity], 0);
    if (configuredTotal <= 0) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: '空', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }

    const roll = clampRandom(random()) * configuredTotal;
    if (roll < config.rarityWeights.空) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: '空', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }

    const availableRarities = rarities.filter((rarity) => (
        config.rarityWeights[rarity] > 0 && (cardsByRarity.get(rarity)?.length ?? 0) > 0
    ));
    const availableTotal = availableRarities.reduce((sum, rarity) => sum + config.rarityWeights[rarity], 0);
    if (availableTotal <= 0) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: '空', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }
    const configuredNonEmptyTotal = configuredTotal - config.rarityWeights.空;
    let rarityRoll = clampRandom((roll - config.rarityWeights.空) / configuredNonEmptyTotal) * availableTotal;
    let selectedRarity = availableRarities[availableRarities.length - 1];
    for (const rarity of availableRarities) {
        if (rarityRoll < config.rarityWeights[rarity]) {
            selectedRarity = rarity;
            break;
        }
        rarityRoll -= config.rarityWeights[rarity];
    }
    const rarityCards = cardsByRarity.get(selectedRarity) ?? [];
    const selectedCard = rarityCards[Math.floor(clampRandom(random()) * rarityCards.length)];
    if (!selectedCard) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: '空', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }
    const next = tileType !== ZCPvpTileType.AllRandom
        ? allRandomNonGoldDraws
        : selectedRarity === '金' ? 0 : allRandomNonGoldDraws + 1;
    return {
        card: selectedCard,
        rarity: selectedRarity,
        pityTriggered: false,
        nextAllRandomNonGoldDraws: next,
    };
}
