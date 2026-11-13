import { ZC_RUNTIME_CONFIG } from './ZCRuntimeConfigStore';
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

/**
 * 一个抽取集合包含的地块数 —— 口径是**每侧** 20 个地块（= 20 个镜像对，全场 40 格）。
 *
 * 集合按「处理侧可玩格 id 升序」每 20 个切一批（与地形位置无关，可复现）；
 * `pvpBaseTeamWeight.setCountLimit` 在**每个集合内独立**计数。
 * 2026-11-10 之前是整半场一个计数器，半场格数超过上限之和时金矿会被溢出兜底填到上限的数倍。
 */
export const ZC_PVP_TILE_SET_SIZE = 20;

/** 抽牌结果品级：`empty` 是「抽空/空地」，其余是卡牌品级 id。 */
export type ZCPvpDrawRarity = 'empty' | ZCCardRarity;

/** 参与权重调整的品级（`empty` 不算品级，不参与）。 */
export const ZC_PVP_RARITY_KEYS: readonly ZCCardRarity[] = ['green', 'blue', 'purple', 'gold'];

/**
 * 关卡 `levelInfo.gradeProModifier`：品级 → 权重**乘数**。
 *
 * 表里实况是 `{ blue: 3, green: 2 }`（190 关）与空对象（17 关）。口径：
 *
 * - 缺省 / `0` / 非正数 / 非数字 ⇒ 该品级乘数 **1**（表说明的「0 = 没变化」）；
 * - 乘完在**非空品级内部**归一（见 `applyPvpRarityModifier`），所以 `empty` 的空手率不变，
 *   绿蓝抬升的份额由紫金（及彼此）分摊 —— 金卡占比被动下降。
 *
 * 只给 **NPC 席位**用：玩家的抽卡始终是 `pvpTile.rarityWeights` 原表。
 */
export type ZCPvpRarityModifier = Readonly<Partial<Record<ZCCardRarity, number>>>;

/**
 * 单个席位在本局的抽卡规则（关卡难度旋钮）。
 *
 * 目前两项都只由 **NPC 席位**使用：玩家恒传 `null`，即「原表权重 + 保留金色保底」。
 * 判定归属放在模型层（`ZCGameModel.buildDevelopmentContext().drawRulesOf`），
 * 抽卡内核只负责「拿到什么规则就怎么算」，不判断谁是 NPC。
 */
export interface ZCPvpSeatDrawRules {
    /** 品级权重乘数（`levelInfo.gradeProModifier`）；缺省 / 空 ⇒ 走原表。 */
    rarityModifier?: ZCPvpRarityModifier | null;
    /**
     * 是否允许「全类型随机」的金色保底；缺省 `true`。
     *
     * **NPC 传 `false`**：保底本质是给玩家的体验补偿（连续 N 次不出金就必送一张），
     * 对 AI 就等于「无论关卡多难，隔固定次数必得金卡」，会把关卡难度拉平；
     * 且它绕过 `rarityWeights`，与本关的 `gradeProModifier` 目的直接冲突。
     */
    goldPity?: boolean;
}

export interface ZCPvpTileConfig {
    type: ZCPvpTileType;
    name: string;
    price: number;
    rarityWeights: Readonly<Record<ZCPvpDrawRarity, number>>;
    /** 该地块能抽到的卡类型（数字：1=金矿/2=兵营/3=防御塔…）；留空时按 `type` 走内置默认。 */
    eligibleCardTypes?: readonly ZCCardType[];
    /**
     * 生成权重（`pvpTile.weight`，2026-11-10 从已废弃的「基础阵容权重随机表」并入）。
     * 玩家阵容变化时按此权重随机抽取地块类型；`0` / 非正数 ⇒ 该类型不参与抽取。
     */
    weight: number;
    /** 初始生成（主城邻格）阶段该类型个数上限（**半场**口径，不含保底格）；`0` = 不限。 */
    initialCountLimit: number;
    /** 同一集合（每侧 20 个地块）内该类型个数上限（不含保底格）；`0` = 不限。 */
    setCountLimit: number;
}

const EMPTY_TILE_CONFIGS: Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> =
    {} as Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;

export function getPvpTileConfigs(): Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> {
    return ZC_RUNTIME_CONFIG.snapshot.tileConfigs ?? EMPTY_TILE_CONFIGS;
}

export function getAllRandomGoldPity(): number {
    return ZC_RUNTIME_CONFIG.snapshot.goldPity ?? 0;
}

export interface ZCPvpTileTypeWeight {
    type: ZCPvpTileType;
    weight: number;
    /** 初始生成（主城邻格）阶段该类型个数上限。 */
    initialCountLimit: number;
    /** 同一集合（每侧 20 个地块，见 `ZC_PVP_TILE_SET_SIZE`）内该类型个数上限（不含保底格）。 */
    setCountLimit: number;
}

/**
 * 抽取权重表由 `pvpTile` 编译产出（`ZCPvpConfigCompiler` 从每条地块配置取
 * `weight / initialCountLimit / setCountLimit`）；未加载配置时为空数组。
 *
 * 2026-11-10 起不再有独立的「基础阵容权重随机表」(`pvpBaseTeamWeight`)。
 */
export function getPvpTileTypeWeights(): readonly ZCPvpTileTypeWeight[] {
    return ZC_RUNTIME_CONFIG.snapshot.tileWeights ?? [];
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

/**
 * 在「未被排除」的类型里按权重抽一个。
 *
 * `excludedTypes` 由调用方按 `setCountLimit` / `initialCountLimit` 算好（见 `createPvpTileTypes`）。
 * **全部类型都被排除时**（单集合上限之和小于该集合格数，属配表问题）按权重在全部带权类型里溢出：
 * 溢出份额与权重同比例，不会因为某个类型上限低就被反复硬填 —— 旧实现「挑当前数量最少」会把
 * 金矿（上限 3）一路填到 18 个/半场，那正是「一局多个金矿」的成因。
 */
export function selectPvpTileType(
    random: () => number = Math.random,
    weights?: readonly ZCPvpTileTypeWeight[],
    excludedTypes?: ReadonlySet<ZCPvpTileType>,
): ZCPvpTileType {
    const source = weights ?? getPvpTileTypeWeights();
    const weighted = source.filter((entry) => entry.weight > 0 && Number.isFinite(entry.weight));
    const usable = weighted.filter((entry) => !(excludedTypes?.has(entry.type)));
    const pool = usable.length ? usable : weighted;
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return ZCPvpTileType.AllRandom;
    let roll = clampRandom(random()) * total;
    for (const entry of pool) {
        if (roll < entry.weight) return entry.type;
        roll -= entry.weight;
    }
    return pool[pool.length - 1].type;
}

/**
 * 按本局地图、保底和权重配置生成整张 PVP 地图的地块类型。
 *
 * 计数口径（2026-11-10 起，见 `ZC_PVP_TILE_SET_SIZE`）：
 * - **集合** = 每侧 20 个地块（= 20 个镜像对，全场 40 格），按处理侧可玩格 id 升序切批；
 *   `setCountLimit` 在每个集合内**独立**计数，集合格数超过上限时不再溢出硬填。
 * - **金矿保底**（阶段 1a）完全独立：既不检查也不占用 `setCountLimit` / `initialCountLimit` 名额。
 */
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

    // 集合划分：处理侧可玩格（镜像对取一份）按 id 升序，每 ZC_PVP_TILE_SET_SIZE 个一批。
    // 主城对一个格子都不产，不占集合名额。
    const setIdOf = new Map<number, number>();
    const orderedProcessIds = hexes
        .filter((hex) => hex.playable && hex.id <= hex.mirrorId
            && !(homeSet.has(hex.id) && homeSet.has(hex.mirrorId)))
        .map((hex) => hex.id)
        .sort((left, right) => left - right);
    orderedProcessIds.forEach((processId, index) => {
        setIdOf.set(processId, Math.floor(index / ZC_PVP_TILE_SET_SIZE));
    });

    // 集合内计数：一个集合一份 `Map<type, count>`，全程只增不清 —— 集合之间互不影响。
    const setCounts = new Map<number, Map<ZCPvpTileType, number>>();
    const countsOf = (processId: number): Map<ZCPvpTileType, number> => {
        const setId = setIdOf.get(processId) ?? 0;
        let counts = setCounts.get(setId);
        if (!counts) {
            counts = new Map<ZCPvpTileType, number>();
            setCounts.set(setId, counts);
        }
        return counts;
    };
    // 初始阶段计数（半场口径，只统计阶段 1b 抽出来的格，保底不占名额）。
    const initialCounts = new Map<ZCPvpTileType, number>();
    const bump = (counts: Map<ZCPvpTileType, number>, type: ZCPvpTileType): void => {
        counts.set(type, (counts.get(type) ?? 0) + 1);
    };
    /** 只写类型（保底用）：不进任何计数器。 */
    const place = (processId: number, type: ZCPvpTileType): void => {
        result[processId] = type;
        result[hexes[processId].mirrorId] = type;
    };

    /** 该格所在集合／初始阶段是否已用满名额（`limit = 0` 表示不限）。 */
    const excludedFor = (processId: number, initial: boolean): Set<ZCPvpTileType> => {
        const counts = countsOf(processId);
        const excluded = new Set<ZCPvpTileType>();
        for (const entry of weights) {
            const setLimit = entry.setCountLimit;
            if (setLimit > 0 && (counts.get(entry.type) ?? 0) >= setLimit) {
                excluded.add(entry.type);
                continue;
            }
            if (!initial) continue;
            const initialLimit = entry.initialCountLimit;
            if (initialLimit > 0 && (initialCounts.get(entry.type) ?? 0) >= initialLimit) {
                excluded.add(entry.type);
            }
        }
        return excluded;
    };
    /** 名额是否还抽得出类型；抽不出就说明这批格该交给阶段 2。 */
    const hasRoom = (excluded: ReadonlySet<ZCPvpTileType>): boolean => weights.some((entry) => (
        entry.weight > 0 && Number.isFinite(entry.weight) && !excluded.has(entry.type)
    ));

    // 阶段 1a：金矿保底 —— 每个席位各保底 `initialGuaranteedMine` 个，只在自己的主城邻格里挑。
    // **完全独立于集合限制**：不查 `setCountLimit`，也不占用集合／初始名额。
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
            place(processId, ZCPvpTileType.Mine);
        }
    }

    // 阶段 1b：主城邻格其余格按权重抽，同时受 `initialCountLimit`（半场初始名额）与
    // 所在集合的 `setCountLimit` 约束；名额用完的格留给阶段 2。
    for (const processId of Array.from(initialProcessIds)) {
        if (result[processId] !== undefined) continue;
        const excluded = excludedFor(processId, true);
        if (!hasRoom(excluded)) continue;
        const type = selectPvpTileType(random, weights, excluded);
        place(processId, type);
        bump(countsOf(processId), type);
        bump(initialCounts, type);
    }

    // 阶段 2：其余格子按权重抽，各集合独立受自己的 `setCountLimit` 约束。
    for (const hex of hexes) {
        if (!hex.playable) continue;
        if (hex.id > hex.mirrorId) continue;
        // 自选主城不一定互为镜像；只有两端都是主城才能跳过整对，
        // 否则另一端普通格会缺类型，运行时只剩默认价格而没有图标。
        if (homeSet.has(hex.id) && homeSet.has(hex.mirrorId)) continue;
        if (result[hex.id] !== undefined) continue;
        const type = selectPvpTileType(random, weights, excludedFor(hex.id, false));
        place(hex.id, type);
        bump(countsOf(hex.id), type);
    }

    return result;
}

/** 乘数：非正数 / 非数字一律按 1（表说明「0 = 没变化」），避免 0 把品级直接抹掉。 */
function rarityFactor(value: number | undefined): number {
    const factor = Number(value);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * 把关卡 `gradeProModifier` 乘进品质权重，**只在非空品级内部归一**。
 *
 * 归一方式（这是本字段最容易接错的地方）：
 *
 * 1. 记下原表非空品级权重和 `base = Σ g/b/p/gold`；
 * 2. 乘完得 `scaled = Σ w·factor`；
 * 3. 每个品级再 `*= base / scaled`。
 *
 * 于是 `Σ(调整后非空品级) === base`，**`empty` 的空手率一分不动** —— 抬升绿蓝挤掉的是
 * 紫金与彼此，不会顺手把「全类型随机」那 0.7 的空手率也一起吃掉（若整体归一，
 * 空手率会掉到 0.636，等于白送 NPC 三成开发次数，超出策划配置的本意）。
 *
 * 边界：
 * - 无调整项 / 全是 1 ⇒ **原对象原样返回**（调用方可以按引用比较，也省一次分配）；
 * - 该地块本来没有绿/蓝（如「兵营-高级」紫 0.9 金 0.1）⇒ 乘完仍为 0，结果与不调整一致 ——
 *   乘数只能放大已有份额，造不出一张本池里不存在品级的卡。
 */
export function applyPvpRarityModifier(
    weights: Readonly<Record<ZCPvpDrawRarity, number>>,
    modifier?: ZCPvpRarityModifier | null,
): Readonly<Record<ZCPvpDrawRarity, number>> {
    if (!modifier) return weights;
    let base = 0;
    let scaled = 0;
    let adjusted = false;
    for (const rarity of ZC_PVP_RARITY_KEYS) {
        const weight = weights[rarity] > 0 ? weights[rarity] : 0;
        const factor = rarityFactor(modifier[rarity]);
        if (factor !== 1) adjusted = true;
        base += weight;
        scaled += weight * factor;
    }
    if (!adjusted || !(base > 0) || !(scaled > 0)) return weights;
    const normalize = base / scaled;
    return {
        empty: weights.empty,
        green: (weights.green > 0 ? weights.green : 0) * rarityFactor(modifier.green) * normalize,
        blue: (weights.blue > 0 ? weights.blue : 0) * rarityFactor(modifier.blue) * normalize,
        purple: (weights.purple > 0 ? weights.purple : 0) * rarityFactor(modifier.purple) * normalize,
        gold: (weights.gold > 0 ? weights.gold : 0) * rarityFactor(modifier.gold) * normalize,
    };
}

/**
 * 按品级配置抽牌：先抽空/品级，再从命中品级的本局卡池中等概率选一张。
 *
 * @param seatRules 该席位的关卡规则（`levelInfo.gradeProModifier` + 是否保留金色保底）。
 *   **只由 NPC 席位**传入（见 `ZCDevelopmentSystem.develop` 的 `drawRulesOf`）；
 *   玩家传 `null` ⇒ 原表权重 + 正常保底。
 */
export function drawPvpTile(
    deck: readonly ZCDeckCard[],
    tileType: ZCPvpTileType,
    allRandomNonGoldDraws: number,
    random: () => number = Math.random,
    configs = getPvpTileConfigs(),
    goldPity = getAllRandomGoldPity(),
    seatRules?: ZCPvpSeatDrawRules | null,
): ZCPvpDrawResult {
    const config = configs[tileType];
    if (!config) throw new Error(`地块配置未加载：${tileType}`);
    const rarityWeights = applyPvpRarityModifier(config.rarityWeights, seatRules?.rarityModifier ?? null);
    const eligibleTypes: ReadonlySet<ZCCardType> = config.eligibleCardTypes?.length
        ? new Set(config.eligibleCardTypes)
        : new Set<ZCCardType>(tileType === ZCPvpTileType.Mine
            ? [ZCCardType.Mine]
            : tileType === ZCPvpTileType.AllRandom
                ? [ZCCardType.Mine, ZCCardType.Barracks, ZCCardType.Tower]
                : [ZCCardType.Barracks]);
    const eligibleCards = deck.filter((card) => eligibleTypes.has(card.type));
    const goldCards = eligibleCards.filter((card) => card.rarity === 'gold');
    const pityTriggered = seatRules?.goldPity !== false
        && tileType === ZCPvpTileType.AllRandom
        && allRandomNonGoldDraws >= goldPity - 1
        && goldCards.length > 0;
    if (pityTriggered) {
        const card = goldCards[Math.floor(clampRandom(random()) * goldCards.length)];
        return { card, rarity: 'gold', pityTriggered: true, nextAllRandomNonGoldDraws: 0 };
    }

    const cardsByRarity = new Map<ZCCardRarity, ZCDeckCard[]>();
    for (const card of eligibleCards) {
        const cards = cardsByRarity.get(card.rarity) ?? [];
        cards.push(card);
        cardsByRarity.set(card.rarity, cards);
    }
    const rarities = ZC_PVP_RARITY_KEYS;
    const configuredTotal = rarityWeights.empty
        + rarities.reduce((sum, rarity) => sum + rarityWeights[rarity], 0);
    if (configuredTotal <= 0) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: 'empty', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }

    const roll = clampRandom(random()) * configuredTotal;
    if (roll < rarityWeights.empty) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: 'empty', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }

    const availableRarities = rarities.filter((rarity) => (
        rarityWeights[rarity] > 0 && (cardsByRarity.get(rarity)?.length ?? 0) > 0
    ));
    const availableTotal = availableRarities.reduce((sum, rarity) => sum + rarityWeights[rarity], 0);
    if (availableTotal <= 0) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: 'empty', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }
    const configuredNonEmptyTotal = configuredTotal - rarityWeights.empty;
    let rarityRoll = clampRandom((roll - rarityWeights.empty) / configuredNonEmptyTotal) * availableTotal;
    let selectedRarity = availableRarities[availableRarities.length - 1];
    for (const rarity of availableRarities) {
        if (rarityRoll < rarityWeights[rarity]) {
            selectedRarity = rarity;
            break;
        }
        rarityRoll -= rarityWeights[rarity];
    }
    const rarityCards = cardsByRarity.get(selectedRarity) ?? [];
    const selectedCard = rarityCards[Math.floor(clampRandom(random()) * rarityCards.length)];
    if (!selectedCard) {
        const next = tileType === ZCPvpTileType.AllRandom ? allRandomNonGoldDraws + 1 : allRandomNonGoldDraws;
        return { card: null, rarity: 'empty', pityTriggered: false, nextAllRandomNonGoldDraws: next };
    }
    const next = tileType !== ZCPvpTileType.AllRandom
        ? allRandomNonGoldDraws
        : selectedRarity === 'gold' ? 0 : allRandomNonGoldDraws + 1;
    return {
        card: selectedCard,
        rarity: selectedRarity,
        pityTriggered: false,
        nextAllRandomNonGoldDraws: next,
    };
}
