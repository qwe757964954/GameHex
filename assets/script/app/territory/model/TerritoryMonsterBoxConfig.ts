/**
 * 怪物宝箱配置（`monsterBox` 表）的解析。
 *
 * ## 为什么单独一层
 *
 * 地图上的巡逻宝箱站点配置的 battleId 为宝箱组 id（monsterBox.monsterBoxId），
 * 需按组 ID 与等级索引 monsterBox 表获取上限、消耗、成功率及奖励配置。
 *
 * ## 字段口径（与策划表列名一一对应）
 *
 * | 列 | 含义 |
 * | --- | --- |
 * | `monsterBoxId` | 宝箱组 id（= 地图 `site.battleId`） |
 * | `monsterBoxGrade` | 等级（1 起，连续） |
 * | `monsterBoxLevel` | **这一级**打的关卡 id（`levelInfo.levelId`） |
 * | `monsterBoxUpCostCoins` | **升到这一级**的银币消耗 |
 * | `monsterBoxUpPro` | **升到这一级**的成功率（百分数，`90` ⇒ 90%） |
 * | `maxUpFailTimes` | **升到这一级**允许的失败次数（达到后本格不能再升） |
 * | `monsterBoxVictoryRwrad` | 这一级的胜利奖励池（`pro` 是**万分比**，`10000` = 100%） |
 *
 * @note 表中配置表示「目标等级」所需属性：grade 1 为初始态，当前等级为 N 时，升级消耗取 grade = N + 1 行。
 */

/** 奖励池一条：资源 id + 数量 + 概率（万分比）。 */
export interface ITerritoryMonsterBoxRewardEntry {
    readonly resId: number;
    readonly amount: number;
    /** 万分比：`10000` = 100%，`500` = 5%。 */
    readonly pro: number;
}

/** 一个等级行。 */
export interface ITerritoryMonsterBoxGrade {
    readonly grade: number;
    /** 这一级对应的 `levelInfo.levelId`（战斗打哪一关）。 */
    readonly levelId: number;
    /** **升到这一级**消耗的银币；`0` = 没有升级入口（初始级 / 未开放）。 */
    readonly upCostCoins: number;
    /** **升到这一级**失败达上限后消耗的金币（幻灵玉）；`0` = 没配金币消耗。 */
    readonly upCostDiamond: number;
    /** **升到这一级**的成功率（百分数）；`0` = 不显示。 */
    readonly upPro: number;
    /** **升到这一级**的失败次数上限；`0` = 不限。 */
    readonly maxFailTimes: number;
    /** 这一级的胜利奖励池（按表顺序）。 */
    readonly rewards: readonly ITerritoryMonsterBoxRewardEntry[];
}

/** 一个宝箱组（同 `monsterBoxId` 的全部等级行，按 `grade` 升序）。 */
export interface ITerritoryMonsterBoxGroup {
    readonly grades: readonly ITerritoryMonsterBoxGrade[];
}

/** 表行（只取这条链路要的列）。 */
interface IMonsterBoxRow {
    readonly monsterBoxId?: unknown;
    readonly monsterBoxGrade?: unknown;
    readonly monsterBoxLevel?: unknown;
    readonly monsterBoxUpCostCoins?: unknown;
    readonly monsterBoxUpCostDiamond?: unknown;
    readonly monsterBoxUpPro?: unknown;
    readonly maxUpFailTimes?: unknown;
    readonly monsterBoxVictoryRwrad?: unknown;
}

function readInt(value: unknown, fallback = 0): number {
    const num = Number(value);
    return Number.isInteger(num) ? num : fallback;
}

function readRewardPool(raw: unknown): ITerritoryMonsterBoxRewardEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: ITerritoryMonsterBoxRewardEntry[] = [];
    for (const item of raw) {
        const record = item as { resId?: unknown; number?: unknown; pro?: unknown };
        const resId = readInt(record?.resId, -1);
        if (resId < 0) continue;
        out.push({
            resId,
            amount: Math.max(0, readInt(record?.number, 0)),
            pro: Math.max(0, readInt(record?.pro, 0)),
        });
    }
    return out;
}

/**
 * 读整张 `monsterBox` 表 ⇒ `组 id → 该组全部等级行`。
 *
 * 脏行只丢那一条（与 `TerritoryMonsterBox` 同口径）：宝箱是附属信息，
 * 一条坏数据不该让整章地图加载不出来。
 */
export function readTerritoryMonsterBoxGroups(raw: unknown): Map<number, ITerritoryMonsterBoxGroup> {
    const rows = Array.isArray(raw) ? (raw as IMonsterBoxRow[]) : [];
    const byId = new Map<number, ITerritoryMonsterBoxGrade[]>();
    for (const row of rows) {
        const id = readInt(row?.monsterBoxId, -1);
        const grade = readInt(row?.monsterBoxGrade, 0);
        if (id < 0 || grade <= 0) continue;
        const list = byId.get(id) ?? [];
        list.push({
            grade,
            levelId: readInt(row?.monsterBoxLevel, 0),
            upCostCoins: Math.max(0, readInt(row?.monsterBoxUpCostCoins, 0)),
            upCostDiamond: Math.max(0, readInt(row?.monsterBoxUpCostDiamond, 0)),
            upPro: Math.max(0, readInt(row?.monsterBoxUpPro, 0)),
            maxFailTimes: Math.max(0, readInt(row?.maxUpFailTimes, 0)),
            rewards: readRewardPool(row?.monsterBoxVictoryRwrad),
        });
        byId.set(id, list);
    }
    const groups = new Map<number, ITerritoryMonsterBoxGroup>();
    for (const [id, list] of byId) {
        // 按 grade 升序；同 grade 重复下发时**保留先出现的**（表顺序即权威，别自作主张取大）。
        const seen = new Set<number>();
        const sortedList = list.slice().sort((a, b) => a.grade - b.grade);
        const grades: ITerritoryMonsterBoxGrade[] = [];
        for (let i = 0; i < sortedList.length; i++) {
            const item = sortedList[i];
            if (!seen.has(item.grade)) {
                seen.add(item.grade);
                grades.push(item);
            }
        }
        groups.set(id, { grades });
    }
    return groups;
}

/**
 * 组里的**最低等级行**（= 还没升级时的关卡）。
 *
 * 地图绑定只用它：`site.battleId → monsterBoxLevel` 拿到"这一片打哪一关"。
 * 满级后换关（如 1002 组的 grade 4 换成 60004）属于升级后的口径，
 * 静态绑定不跟它走 —— 见 `TerritorySite.patrolLevelId` 的注释。
 */
export function lowestGradeOf(group: ITerritoryMonsterBoxGroup | undefined): ITerritoryMonsterBoxGrade | null {
    if (!group || group.grades.length === 0) return null;
    return group.grades[0];
}

/** 组里的**最高等级**（面板的 `maxLv`）；没有配置时返回 `0`。 */
export function maxGradeOf(group: ITerritoryMonsterBoxGroup | undefined): number {
    if (!group || group.grades.length === 0) return 0;
    return group.grades[group.grades.length - 1].grade;
}

/** 取「升到 `targetGrade`」的那一行；没有则 `null`。 */
export function gradeOf(group: ITerritoryMonsterBoxGroup | undefined, targetGrade: number): ITerritoryMonsterBoxGrade | null {
    if (!group) return null;
    for (const item of group.grades) {
        if (item.grade === targetGrade) return item;
    }
    return null;
}
