/**
 * 参与抽卡权重调整的品质键。
 *
 * 与 `pvpTile.rarityWeights` / `pvpCard.rarity` 是同一套词表（`ZCCardRarity`），
 * 这里单独声明是为了不让 `territory/model` 反向依赖 `zcds/model`。两边都改时必须同改，
 * 守卫见 `tests/zcds-npc-rarity-modifier.test.ts`「品质键词表两处一致」。
 */
export const TERRITORY_CARD_RARITY_KEYS = ['green', 'blue', 'purple', 'gold'] as const;
export type TerritoryCardRarityKey = (typeof TERRITORY_CARD_RARITY_KEYS)[number];

/**
 * `levelInfo.gradeProModifier`：品级 → 抽卡权重**乘数**。
 *
 * 缺省 / 0 / 非正数 ⇒ 1（表说明的「0 = 没变化」）。只作用于 **NPC 席位**，
 * 计算方式见 `applyPvpRarityModifier`（`zcds/model/ZCPvpTileRules.ts`）。
 */
export type TerritoryGradeProModifier = Partial<Record<TerritoryCardRarityKey, number>>;

/** 领地/冒险入口用到的 PVE 表行投影。 */
export interface TerritoryLevelRow {
    levelId: number;
    levelChapter: number;
    chapterStage: number;
    /** 1 = 异步匹配，2 = 塔防。 */
    levelMod: number;
    /** 异步匹配表中的 NPC 数量目前不决定参战人数；塔防值仍对应 defenceModWave.startId。 */
    levelModValue: number;
    levelHp: number;
    levelAttack: number;
    levelCost: number;
    /** 「关卡翻地块频率（秒）」：本关地块翻开的间隔上限，0 = 够钱就翻。 */
    openGrideTime: number;
    /** NPC 抽卡品质权重乘数（`{ green: 2, blue: 3 }`）；缺省 / 空对象 = 不调整。 */
    gradeProModifier?: TerritoryGradeProModifier;
    extraCards?: { enemy?: number };
    idleReward?: TerritoryRewardRow[];
}

export interface TerritoryCardRow {
    id: number;
    name: string;
    type: string | number;
    enabled: number | boolean;
    unitId?: number;
    rarity?: number;
    /** `pvpCard.headIcon`：敌军头像（关卡提示的敌军卡用）。 */
    headIcon?: string;
    /** `pvpCard.description`：敌方说明（关卡提示的描述框用）。 */
    description?: string;
}

export interface TerritoryNpcTeamRow {
    npcTeamId: number;
    /** NPC 表中 1 / 3 = 匹配阵容，2 = 主线 BOSS；20001+ 异步据点使用类型 3。 */
    npcTeamType?: number;
    /** 异步匹配适用的关卡 ID 闭区间。 */
    npcTeamMatch?: number[];
    npcCard: Array<number | { cardID: number; level?: number }>;
}

export interface TerritoryDefenceWaveRow {
    startId: number;
    waveId: number;
    waveShowTime: number;
    monsterId: number;
    monsterSize: number;
    monsterNum: number;
    hpRate: number;
    atkRate: number;
    restMonsterNum: number;
    /**
     * `defenceModWave.monsterType`：`1` 普通 / `2` 精英 / `3` BOSS。
     *
     * 可选是因为客户端 JSON 目前还没有这一列（表里已按「每组最后一波 = 3」补齐，
     * 但还没重新导表）。缺列时按「每组最后一波是 BOSS」兜底，见 {@link buildTerritoryCampaign}。
     */
    monsterType?: number;
}

export interface TerritoryRewardRow {
    resId: number;
    number: number;
    /** 万分比概率。 */
    pro: number;
}

export interface TerritoryResourceRow {
    resId: number;
    name: string;
}

export interface TerritoryGameConfigRow {
    key: string;
    value: unknown;
}

export const TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK = 8;

export function readTerritoryIdleRewardMaxHours(
    rows: readonly TerritoryGameConfigRow[],
    fallback = TERRITORY_IDLE_REWARD_MAX_HOURS_FALLBACK,
): number {
    const value = Number(rows.find((row) => row.key === 'idleRewardMaxHour')?.value);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * `gameConfig.chapterLevelAutoStartConfig` 的缺省值。
 *
 * 策划表 `S-数据配置` 原话：「章节地图【首次】激活关卡地块，自动进入战斗（1开 0关」，
 * 表里当前是 `1`。⚠️ 缺省取 **开**：取关会让整个功能在配置读不到时**静默失效**
 * （表现是「点了格子只解锁、不进战斗」，零报错）。要关请改表，不要靠删配置行来关。
 */
export const TERRITORY_LEVEL_AUTO_START_FALLBACK = true;

/**
 * 读「章节地图首次激活关卡地块是否自动进战斗」。
 *
 * 口径（`1` 开 / `0` 关）来自策划表；`0` 是唯一表示「关」的值 —— 认不出的脏值退回
 * `fallback`（开），不把 `NaN` 当「关」，否则表里多打个空格就静默关掉整个功能。
 */
export function readTerritoryLevelAutoStart(
    rows: readonly TerritoryGameConfigRow[],
    fallback = TERRITORY_LEVEL_AUTO_START_FALLBACK,
): boolean {
    const raw = rows.find((entry) => entry.key === 'chapterLevelAutoStartConfig')?.value;
    if (raw == null) return fallback;
    // ⚠️ 别直接 `Number(raw)`：`Number('')` / `Number('  ')` / `Number(null)` 全是 **0**
    // ⇒ 空值会被当成「关」⇒ 表里多一个空格就把功能静默关掉。空串必须走 fallback。
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw !== 0 : fallback;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text === '') return fallback;
    const value = Number(text);
    return Number.isFinite(value) ? value !== 0 : fallback;
}

export interface TerritoryCampaignEnemy {
    cardId: number;
    /** 同名映射到战斗运行时 pvpCard；存在时可直接构建本地 PVE 敌方卡组。 */
    pvpCardId?: number;
    name: string;
    level: number;
    /** 敌军头像路径（`pvpCard.headIcon`）。可选：老夹具/查不到时不写。 */
    headIcon?: string;
    /** 敌方说明（`pvpCard.description`）。可选：查不到时不写。 */
    description?: string;
}

export interface TerritoryCampaignWave {
    waveId: number;
    showAtSeconds: number;
    monsterId: number;
    pvpCardId?: number;
    monsterName: string;
    monsterSize: number;
    monsterCount: number;
    hpRate: number;
    attackRate: number;
    restMonsterNum: number;
    /** 本波是不是 BOSS 波（`monsterType=3`；表里没这一列时按「最后一波」兜底）。 */
    isBoss: boolean;
}

export interface TerritoryCampaignReward {
    resId: number;
    name: string;
    amount: number;
    probability: number;
}

export interface TerritoryCampaignStage {
    levelId: number;
    chapterId: number;
    stage: number;
    mode: 'match' | 'defence';
    isBoss: boolean;
    /** 本关实际参战的 NPC 队伍。 */
    enemyTeamId: number | null;
    enemyTeamIds: number[];
    /** 本关唯一 NPC 队伍映射出的 PVP 卡牌 ID。 */
    enemyTeamCardIds: number[][];
    /** 领地关卡统一为玩家对一名 AI。 */
    opponentCount: 1;
    enemies: TerritoryCampaignEnemy[];
    waves: TerritoryCampaignWave[];
    idleRewards: TerritoryCampaignReward[];
    staminaCost: number;
    /**
     * `levelInfo.openGrideTime`：本关「NPC 翻地块频率」（秒，0 = 不额外限速，按全局 2.8s）。
     *
     * 🔴 **只管战斗内 NPC 点地块的最小间隔**（两次点击之间的间距，计时从第一次翻格之后开始），
     * 与领地格子的「探索中」时长**没有任何关系** —— 后者是地图配置自己的
     * `site.unlock.exploreSeconds`（`TerritoryMapConfig`，缺省 2 秒，走 `TerritoryProgress` 的倒计时）。
     * 2026-11-11 之前这里把同一列也喂给 `exploreSeconds`，导致「把 NPC 调慢到 10 秒，
     * 领地通关后开那一格也要等 10 秒」，已拆开。
     */
    openGrideTime: number;
    /**
     * `levelInfo.gradeProModifier`：NPC 翻地块抽卡的品质权重乘数。
     *
     * 只影响 **NPC 席位**，玩家抽卡仍走 `pvpTile.rarityWeights` 原表。
     * 缺省（`undefined`）⇒ 不调整：塔防关卡与该列留空的关卡都是这一条。
     */
    gradeProModifier?: TerritoryGradeProModifier;
    hpRate: number;
    attackRate: number;
}

function asNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * 解析 `levelInfo.gradeProModifier`。
 *
 * 表里是 `{ blue: 3, green: 2 }` 这种「品级 → 乘数」；也有 17 关整列留空，
 * 转表器会写成 `{}`（与 `idleReward` / `npcTeam` 同一个坑）—— 空对象必须归一成
 * `undefined`，否则下游「有没有配」的判断会误判成「配了但全是 1」。
 *
 * 只收**正数**：0 / 负数 / 非数字按「没变化」丢掉（表说明「0 = 没变化」）。
 * 未知键（写错成 `Green` / `purple1`）直接丢，不会静默变成某个品级的乘数。
 */
function asGradeProModifier(value: unknown): TerritoryGradeProModifier | undefined {
    const record = asRecord(value);
    const result: TerritoryGradeProModifier = {};
    let count = 0;
    for (const rarity of TERRITORY_CARD_RARITY_KEYS) {
        const factor = Number(record[rarity]);
        if (Number.isFinite(factor) && factor > 0) {
            result[rarity] = factor;
            count += 1;
        }
    }
    return count > 0 ? result : undefined;
}

/**
 * 表格列 → 数组。**`x ?? []` 顶不住空对象**（见 218）。
 *
 * 转表器可能把「空列表」写成 **`{}`** 而不是 `[]`。`{}` 不是 nullish ⇒ `??` **不生效** ⇒
 * 下游 `.flatMap` / `.map` 直接抛 `is not a function`，
 * 整章领地数据加载失败（`TerritoryModel.loadChapter` →「领地数据加载失败」+ 提示条）。
 *
 * 归一放在读表边界，而不是逐个调用点打补丁。
 *
 * ⚠️ 泛型默认 `any`（不是 `unknown`）：`asArray(x).flatMap((reward) => reward.resId)` 里
 * `reward` 会推成 `unknown` ⇒ 下游读字段报 `TS2339`。列在转表产物里就是松散 JSON，
 * 收紧成 `unknown[]` 只是把脏值的锅推给调用方，不提供任何安全性。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? value : [];
}

function teamMatchesLevel(team: TerritoryNpcTeamRow, levelId: number): boolean {
    // ⚠️ 同 `idleReward`：转表器把空列表写成 `{}`（见 `asArray` 注释）。
    //当前 npcTeam 表 38 行都是数组，但同表同机制，不能靠"现在没脏"当防护。
    const values = asArray(team.npcTeamMatch).map((value) => asNumber(value)).filter(Boolean);
    if (!values.length) return false;
    if (values.length === 1) return values[0] === levelId;
    const min = Math.min(values[0], values[1]);
    const max = Math.max(values[0], values[1]);
    return levelId >= min && levelId <= max;
}

/**
 * 把 `PVP-关卡` 表与两种真实 PVE 模式拼到一起：
 *
 * - 匹配战：从 `npcTeamType=1/3` 的匹配队伍里按 ID 取第一支，与玩家两人对战。
 * - 塔防：`levelModValue` → `defenceModWave.startId`，额外 BOSS 队伍来自 `extraCards.enemy`。
 */
/**
 * 塔防出怪表 → 战斗波次，并标出**哪一波是 BOSS 波**。
 *
 * 口径（策划表 `defenceModWave.monsterType`，1 普通 / 2 精英 / 3 BOSS）：
 * 每组 `startId` 只有最后一波是 BOSS，其余都是普通小怪。两种数据形态都要成立：
 *
 * - 表里带了 `monsterType`：认 `3`；一组里一个 `3` 都没有（脏数据 / 忘填）时按最后一波兜底，
 *   否则「击杀 BOSS 才算胜利」会变成永远打不赢。
 * - 表里还没有这一列（当前客户端 JSON 就是这样）：直接按最后一波判 BOSS。
 *
 * ⚠️ BOSS 波是**胜负手**（见 `ZCOutcomeSystem` 的塔防分支），兜底宁可放宽也不能放宽成「没有 BOSS」。
 */
function projectDefenceWaves(
    rows: readonly TerritoryDefenceWaveRow[],
    projectCard: (cardId: number, level?: number) => TerritoryCampaignEnemy,
): TerritoryCampaignWave[] {
    const sorted = rows.slice().sort((a, b) => a.waveId - b.waveId);
    const declared = sorted.filter((wave) => wave.monsterType === 3).length > 0;
    const lastIndex = sorted.length - 1;
    return sorted.map((wave, index): TerritoryCampaignWave => {
        const enemy = projectCard(wave.monsterId);
        return {
            waveId: wave.waveId,
            showAtSeconds: wave.waveShowTime,
            monsterId: wave.monsterId,
            ...(enemy.pvpCardId ? { pvpCardId: enemy.pvpCardId } : {}),
            monsterName: enemy.name,
            monsterSize: wave.monsterSize,
            monsterCount: wave.monsterNum,
            hpRate: wave.hpRate,
            attackRate: wave.atkRate,
            restMonsterNum: wave.restMonsterNum,
            isBoss: declared ? wave.monsterType === 3 : index === lastIndex,
        };
    });
}

export function buildTerritoryCampaign(
    levelRows: readonly TerritoryLevelRow[],
    monsterRows: readonly TerritoryCardRow[],
    npcTeams: readonly TerritoryNpcTeamRow[],
    pvpCards: readonly TerritoryCardRow[],
    chapterId: number,
    defenceWaveRows: readonly TerritoryDefenceWaveRow[] = [],
    resourceRows: readonly TerritoryResourceRow[] = [],
): { stages: TerritoryCampaignStage[]; playerCardCount: number } {
    const monsters = new Map(monsterRows.map((row) => [row.id, row]));
    const teams = new Map(npcTeams.map((row) => [row.npcTeamId, row]));
    const pvpCardsById = new Map(pvpCards.map((row) => [row.id, row]));
    const pvpCardByName = new Map(
        pvpCards
            .filter((card) => card.enabled === true || card.enabled === 1)
            .map((card) => [card.name.trim(), card]),
    );
    const resourceNames = new Map(resourceRows.map((row) => [row.resId, row.name]));

    const projectCard = (cardId: number, level = 1): TerritoryCampaignEnemy => {
        // 头像按 `npcTeam.cardId` → `pvpCard` → `monsterCard` 依次找（两张表都有 `headIcon`，`pvpCard` 另有 `icon` 口径）
        const headIconOf = (row: Record<string, unknown> | undefined): string => {
            const raw = row?.headIcon ?? row?.icon ?? '';
            return typeof raw === 'string' ? raw : '';
        };
        const headIconFor = (cardId: number): string =>
            headIconOf(pvpCardsById.get(cardId) as unknown as Record<string, unknown> | undefined)
            || headIconOf(monsters.get(cardId) as unknown as Record<string, unknown> | undefined);
        const pvpCard = pvpCardsById.get(cardId);
        if (pvpCard) return {
            cardId,
            pvpCardId: pvpCard.id,
            name: pvpCard.name || `卡牌 ${cardId}`,
            level: Math.max(1, level),
            headIcon: headIconFor(cardId),
            description: typeof pvpCard.description === 'string' ? pvpCard.description : '',
        };
        const monster = monsters.get(cardId);
        const name = monster?.name ?? `怪物 ${cardId}`;
        const sameName = pvpCardByName.get(name.trim());
        return {
            cardId,
            ...(sameName ? { pvpCardId: sameName.id } : {}),
            name,
            level: Math.max(1, level),
            headIcon: headIconFor(cardId),
            description: typeof sameName?.description === 'string' ? sameName.description : '',
        };
    };

    const stages = levelRows
        .filter((row) => row.levelChapter === chapterId)
        .map((row): TerritoryCampaignStage => {
            const mode = row.levelMod === 2 ? 'defence' : 'match';
            const opponentCount = 1;
            const bossTeamId = asNumber(asRecord(row.extraCards).enemy, 0) || null;
            const matchedTeams = mode === 'match'
                ? npcTeams
                    .filter((team) => (team.npcTeamType === 1 || team.npcTeamType === 3)
                        && teamMatchesLevel(team, row.levelId))
                    .sort((a, b) => a.npcTeamId - b.npcTeamId)
                    .slice(0, 1)
                : bossTeamId && teams.has(bossTeamId) ? [teams.get(bossTeamId)] : [];
            const waves = mode === 'defence'
                ? projectDefenceWaves(defenceWaveRows.filter((wave) => wave.startId === row.levelModValue), projectCard)
                : [];
            const projected = matchedTeams
                .flatMap((team) => team.npcCard.map((entry) => {
                    const raw = typeof entry === 'number' ? { cardID: entry, level: 1 } : entry;
                    return projectCard(asNumber(raw.cardID), Math.max(1, asNumber(raw.level, 1)));
                }))
                .concat(waves.map((wave) => projectCard(wave.monsterId)));
            const enemies = Array.from(projected.reduce((result, enemy) => {
                const key = enemy.pvpCardId ? `pvp:${enemy.pvpCardId}` : `monster:${enemy.cardId}`;
                const old = result.get(key);
                if (!old || enemy.level > old.level) result.set(key, enemy);
                return result;
            }, new Map<string, TerritoryCampaignEnemy>()).values());
            const enemyTeamIds = matchedTeams.map((team) => team.npcTeamId);
            const enemyTeamCardIds = matchedTeams.map((team) => Array.from(new Set(team.npcCard.flatMap((entry) => {
                const raw = typeof entry === 'number' ? { cardID: entry } : entry;
                const cardId = projectCard(asNumber(raw.cardID)).pvpCardId;
                return cardId ? [cardId] : [];
            }))));
            const idleRewards = asArray(row.idleReward).flatMap((reward) => {
                const resId = asNumber(reward?.resId);
                const amount = asNumber(reward?.number);
                const probability = asNumber(reward?.pro);
                return resId && amount > 0 && probability > 0 ? [{
                    resId,
                    name: resourceNames.get(resId) ?? `资源 ${resId}`,
                    amount,
                    probability,
                }] : [];
            });
            return {
                levelId: row.levelId,
                chapterId: row.levelChapter,
                stage: row.chapterStage,
                mode,
                isBoss: mode === 'defence',
                enemyTeamId: enemyTeamIds[0] ?? null,
                enemyTeamIds,
                enemyTeamCardIds,
                opponentCount,
                enemies,
                waves,
                idleRewards,
                staminaCost: row.levelCost,
                openGrideTime: Math.max(0, row.openGrideTime),
                gradeProModifier: asGradeProModifier(row.gradeProModifier),
                hpRate: row.levelHp,
                attackRate: row.levelAttack,
            };
        })
        .sort((a, b) => a.stage - b.stage || a.levelId - b.levelId);

    const playerCardCount = pvpCards.filter((card) => card.enabled === true || card.enabled === 1).length;
    return { stages, playerCardCount };
}
