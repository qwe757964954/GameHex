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
    openGrideTime: number;
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

export interface TerritoryCampaignEnemy {
    cardId: number;
    /** 同名映射到战斗运行时 pvpCard；存在时可直接构建本地 PVE 敌方卡组。 */
    pvpCardId?: number;
    name: string;
    level: number;
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
    exploreSeconds: number;
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
 * 表格列 → 数组。**`x ?? []` 顶不住空对象**（见 218）。
 *
 * 转表器可能把「空列表」写成 **`{}`** 而不是 `[]`。`{}` 不是 nullish ⇒ `??` **不生效** ⇒
 * 下游 `.flatMap` / `.map` 直接抛 `is not a function`，
 * 整章领地数据加载失败（`TerritoryPresenter.loadChapter` →「领地数据加载失败」+ 提示条）。
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
        const pvpCard = pvpCardsById.get(cardId);
        if (pvpCard) return {
            cardId,
            pvpCardId: pvpCard.id,
            name: pvpCard.name || `卡牌 ${cardId}`,
            level: Math.max(1, level),
        };
        const monster = monsters.get(cardId);
        const name = monster?.name ?? `怪物 ${cardId}`;
        const pvpCardId = pvpCardByName.get(name.trim())?.id;
        return {
            cardId,
            ...(pvpCardId ? { pvpCardId } : {}),
            name,
            level: Math.max(1, level),
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
                : bossTeamId && teams.has(bossTeamId) ? [teams.get(bossTeamId)!] : [];
            const waves = mode === 'defence'
                ? defenceWaveRows
                    .filter((wave) => wave.startId === row.levelModValue)
                    .sort((a, b) => a.waveId - b.waveId)
                    .map((wave): TerritoryCampaignWave => {
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
                        };
                    })
                : [];
            const projected = [
                ...matchedTeams.flatMap((team) => team.npcCard.map((entry) => {
                    const raw = typeof entry === 'number' ? { cardID: entry, level: 1 } : entry;
                    return projectCard(asNumber(raw.cardID), Math.max(1, asNumber(raw.level, 1)));
                })),
                ...waves.map((wave) => projectCard(wave.monsterId)),
            ];
            const enemies = [...projected.reduce((result, enemy) => {
                const key = enemy.pvpCardId ? `pvp:${enemy.pvpCardId}` : `monster:${enemy.cardId}`;
                const old = result.get(key);
                if (!old || enemy.level > old.level) result.set(key, enemy);
                return result;
            }, new Map<string, TerritoryCampaignEnemy>()).values()];
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
                exploreSeconds: Math.max(0, row.openGrideTime),
                hpRate: row.levelHp,
                attackRate: row.levelAttack,
            };
        })
        .sort((a, b) => a.stage - b.stage || a.levelId - b.levelId);

    const playerCardCount = pvpCards.filter((card) => card.enabled === true || card.enabled === 1).length;
    return { stages, playerCardCount };
}
