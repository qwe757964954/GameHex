/**
 * PVP-卡牌 单位列完整性守卫（合表后）。
 *
 * 背景：2026-09-20 起 `PVP-单位` 表**并入** `PVP-卡牌` —— 单位列内联在卡行上、一律加
 * `unit` 前缀，`unitId` 取「本行卡自己的 id」（同表自引用）。合表消掉了原来那条映射守卫
 * 要防的「两张表行序不一致 → 卡名与所引用单位名对不上」整类问题（实测两表严格 1:1，
 * 35 卡 ↔ 35 单位，按名字唯一命中）。
 *
 * 但合表引入了新的失败模式，而且**都只在运行时才炸**：
 *
 *   - 新增卡行时只填了 `unitPrefabPath`、忘了 `unitSkillId`（或反之）
 *     → `parseUnits` 抛「pvpCard[x] 只配了一半」，整个对局预加载失败；
 *   - `unitPrefabPath` 写了个不存在的路径 → `resources.load` 在预加载阶段失败；
 *   - `unitSkillId` 指向 `pvpSkill` 里没有的技能 → `parseUnits` 抛「找不到普攻技能」；
 *   - `unitId` 与 `id` 脱钩，或者**建筑卡也填了 unitId** —— 后者最阴：客户端拿
 *     `ZCDeckCard.unitId == null` 当「这是建筑卡」的判据
 *     （`ZCGameRuntimeConfig.findUnplayableDeckCards` 里 `if (!card.unitId) continue;`），
 *     建筑行一填，预加载闸就会把它当成引用了不存在单位的出战卡，
 *     抛「pvpCard 有 1 张出战卡不可上场（…）：2001（金矿）」把整局拦死。
 *     （2026-09-20 合表时就真踩了：合并脚本给所有行都填了 `unitId = 本行 id`。）
 *
 * 所以本文件守的是**单位列的成对性与可解析性**，在转表后立刻拦下，不用等对局跑起来。
 *
 * 第一个用例是守卫自检：喂桩数据必须能检出「只填一半」。没有它，`collectUnitColumnIssues`
 * 一旦退化成恒返空数组，真实表的用例会安静地永远通过 —— 这正是上一版守卫要写自检的原因。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPvpTables, parseUnits, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

interface CardRow {
    id: number;
    name: string;
    unitId: number | null;
    unitPrefabPath: string | null;
    unitSkillId: number | null;
}

/**
 * 兵种卡上必须齐备的单位数值列。
 *
 * 判据来自 `ZCGameRuntimeConfig.parseUnits` —— 这些列在那边是**硬取**的（缺列即抛错），
 * 所以这里列全，报错时能直接点名是哪张卡的哪一列。
 */
const REQUIRED_UNIT_NUMERIC_COLUMNS = [
    'unitMaxHp', 'unitAttack', 'unitMoveSpeed', 'unitAttackRange',
    'unitAttackInterval', 'unitAttackDuration', 'unitAttackHitTime',
] as const;

/** 读 remoteRef 表 → 行对象数组。两种形态都认：未压缩行数组 / 列存 `{k, v}`。 */
function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function asCards(rows: Array<Record<string, unknown>>): CardRow[] {
    const optionalNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
    return rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        unitId: optionalNumber(row.unitId),
        unitPrefabPath: typeof row.unitPrefabPath === 'string' && row.unitPrefabPath ? row.unitPrefabPath : null,
        unitSkillId: optionalNumber(row.unitSkillId),
    }));
}

/** 与 `parseUnits` 同源的「是不是兵种卡」判据：两列都空 = 建筑卡（主城 / 金矿），不带单位列合法。 */
function isUnitRow(row: CardRow): boolean {
    return Boolean(row.unitPrefabPath) || row.unitSkillId !== null;
}

/**
 * 体检单位列，返回问题描述列表（空 = 通过）。
 *
 * `prefabExists` 与 `numericColumns` 都写成参数，是为了让自检用例能脱离真实文件系统喂桩；
 * 生产调用见文件底部那两个用例。
 */
function collectUnitColumnIssues(
    rows: CardRow[],
    skillIds: ReadonlySet<number>,
    prefabExists: (path: string) => boolean,
    numericColumnsOf: (row: CardRow) => Record<string, unknown> = () => ({}),
): string[] {
    const issues: string[] = [];
    const unitIdOwner = new Map<number, string>();

    for (const row of rows) {
        const label = `${row.id} 「${row.name}」`;
        const unitRow = isUnitRow(row);

        // `unitId` 是「本行产出的兵种」的引用：
        //   * 兵种卡 → 填**本行卡自己的 id**（1:1 期间恒等，将来多卡共用兵种时指向另一行的 id）；
        //   * 建筑卡 → **必须留空**。客户端以 `unitId == null` 判建筑卡（见文件头），填上会把预加载闸拦死。
        if (unitRow && row.unitId === null) {
            issues.push(`${label} 是兵种卡却没填 unitId（应为本行卡自己的 id=${row.id}）`);
        } else if (!unitRow && row.unitId !== null) {
            issues.push(`${label} 是建筑卡（没有单位预设）却填了 unitId=${row.unitId}`
                + ' —— 客户端以 `unitId == null` 判建筑卡，填上会让预加载闸抛「不可上场的单位」');
        } else if (unitRow && row.unitId !== row.id) {
            issues.push(`${label} 的 unitId=${row.unitId} 与本行 id 不一致（同表自引用契约）`);
        } else if (row.unitId !== null) {
            if (unitIdOwner.has(row.unitId)) {
                issues.push(`${label} 的 unitId=${row.unitId} 与 ${unitIdOwner.get(row.unitId)} 重复`);
            } else {
                unitIdOwner.set(row.unitId, label);
            }
        }

        if (!unitRow) continue; // 建筑卡：单位预设 / 技能 / 数值列都不该有

        if (!row.unitPrefabPath) {
            issues.push(`${label} 只配了 unitSkillId=${row.unitSkillId}，缺 unitPrefabPath（两列必须成对）`);
        }
        if (row.unitSkillId === null) {
            issues.push(`${label} 只配了 unitPrefabPath=${row.unitPrefabPath}，缺 unitSkillId（两列必须成对）`);
        }
        if (row.unitPrefabPath && row.unitPrefabPath.includes('\\')) {
            // ⚠️ 这条判据**不能**靠 `prefabExists`（下一行那个）：Windows 上 `existsSync` 把 `\` 与 `/`
            // 当同一个分隔符，`assets/resources/skel\豌豆射手\豌豆射手.prefab` 照样返回 true
            // —— 表里写反斜杠时那条判据**永远抓不到**，要等对局预加载才报
            // `Bundle resources doesn't contain skel\豌豆射手\豌豆射手`（看着像资源缺失、其实是路径格式不对）。
            // 跨平台判据只有一个：这个字符串里不许出现 `\`。
            // （2026-09-24 实测：36 张卡都写 `/`，只有新加的两张手填成了 `\`，全量用例当时是绿的。）
            issues.push(`${label} 的 unitPrefabPath=${row.unitPrefabPath} 用了反斜杠`
                + ' —— Cocos 的 resources.load 只认 `/`，反斜杠是普通字符（而 Windows 上 existsSync 照样为真，'
                + '所以这条只能靠字符串判据）');
        }
        if (row.unitPrefabPath && !prefabExists(row.unitPrefabPath)) {
            issues.push(`${label} 的 unitPrefabPath=${row.unitPrefabPath} 对应的 .prefab 不存在`);
        }
        if (row.unitSkillId !== null && !skillIds.has(row.unitSkillId)) {
            issues.push(`${label} 的 unitSkillId=${row.unitSkillId} 在 pvpSkill 里不存在`);
        }

        const numeric = numericColumnsOf(row);
        for (const column of REQUIRED_UNIT_NUMERIC_COLUMNS) {
            if (numeric[column] !== undefined && typeof numeric[column] !== 'number') {
                issues.push(`${label} 的 ${column}=${String(numeric[column])} 不是数字（转表后应为 number）`);
            }
        }
    }
    return issues;
}

function readSkillIds(): Set<number> {
    return new Set(readPvpRows('pvpSkill').map((row) => Number(row.skillId)));
}

/** 给 `loadPvpTables` 用的全量表（与 `ZCGameLoader.loadPvpRuntimeConfig` 同一份清单）。 */
function readAllPvpTables(): ZCPvpTables {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    ];
    return Object.fromEntries(names.map((name) => [name, readPvpRows(name)])) as unknown as ZCPvpTables;
}

test('守卫自检：只填一半、prefab 缺失、技能不存在、unitId 脱钩、建筑乱填都要被检出', () => {
    const rows: CardRow[] = [
        { id: 1, name: '齐备卡', unitId: 1, unitPrefabPath: 'units/齐备卡/齐备卡', unitSkillId: 1001 },
        { id: 2, name: '缺Prefab', unitId: 2, unitPrefabPath: null, unitSkillId: 1002 },
        { id: 3, name: '缺技能', unitId: 3, unitPrefabPath: 'units/缺技能/缺技能', unitSkillId: null },
        { id: 4, name: '预制体不在', unitId: 4, unitPrefabPath: 'units/幽灵/幽灵', unitSkillId: 1004 },
        { id: 5, name: '技能不在', unitId: 5, unitPrefabPath: 'units/技能不在/技能不在', unitSkillId: 9999 },
        { id: 6, name: 'id脱钩', unitId: 600, unitPrefabPath: 'units/id脱钩/id脱钩', unitSkillId: 1006 },
        { id: 7, name: '金矿', unitId: null, unitPrefabPath: null, unitSkillId: null },  // 建筑卡：合法
        { id: 8, name: '建筑乱填', unitId: 8, unitPrefabPath: null, unitSkillId: null }, // 建筑卡填 unitId：非法
        { id: 9, name: '反斜杠路径', unitId: 9, unitPrefabPath: 'skel\\豌豆射手\\豌豆射手', unitSkillId: 1006 },
    ];
    const skillIds = new Set([1001, 1002, 1004, 1006]);

    const issues = collectUnitColumnIssues(rows, skillIds, (path) => path.startsWith('units/齐备卡') || path === 'units/缺技能/缺技能' || path === 'units/技能不在/技能不在' || path === 'units/id脱钩/id脱钩' || path === 'skel\\豌豆射手\\豌豆射手');

    assert.deepEqual(
        issues.map((issue) => issue.slice(0, issue.indexOf(' '))),
        ['2', '3', '4', '5', '6', '8', '9'],
        `齐备卡（1）与金矿（7）不该被检出，其余每行各一条：\n${issues.join('\n')}`,
    );
    assert.match(issues[0], /缺 unitPrefabPath/);
    assert.match(issues[1], /缺 unitSkillId/);
    assert.match(issues[2], /\.prefab 不存在/);
    assert.match(issues[3], /在 pvpSkill 里不存在/);
    assert.match(issues[4], /unitId=600 与本行 id 不一致/);
    assert.match(issues[5], /是建筑卡（没有单位预设）却填了 unitId=8/);
    // 第 9 行是「路径存在、但分隔符跨平台不合法」—— 桩里 `prefabExists` 对它返回 true，
    // 所以只该报反斜杠这一条（正是为了证明这条判据不是从 existsSync 那边蹭出来的）。
    assert.match(issues[6], /用了反斜杠/);
});

test('真实表：pvpCard 每一行的单位列都成对、可解析', () => {
    const cards = asCards(readPvpRows('pvpCard'));
    const rows = readPvpRows('pvpCard');
    const numericColumns = new Map(rows.map((row) => [Number(row.id), row]));

    const issues = collectUnitColumnIssues(
        cards,
        readSkillIds(),
        (path) => existsSync(`assets/resources/${path}.prefab`),
        (row) => numericColumns.get(row.id) ?? {},
    );

    assert.deepEqual(issues, [], `pvpCard 单位列体检未通过：\n${issues.join('\n')}`);

    // 防空转：守卫的「兵种卡」判据必须与解析层 `parseUnits` 的判据**同源同量**。
    // 若列名漂了（比如又改回 `prefabPath`），这里会变成 0 行 vs 35 个单位，立刻红 ——
    // 而不是「零行零问题」的假绿。
    const unitCount = loadPvpTables(readAllPvpTables()).unitCount;
    assert.equal(
        cards.filter(isUnitRow).length,
        unitCount,
        '守卫认定的兵种卡数与解析层认定的可上场单位数不一致（列名或判据漂了）',
    );
});

test('卡名唯一（`ZCModifierMapper` 的中文名 → id 解析前提）', () => {
    // 合表后 `pvpCard.name` 是显示名唯一真源，运行时按名字反查 id
    // （`ZCModifierResolvers.unitIdByName` / `cardIdByName`）。重名会让解析指错行，且不报错。
    const cards = asCards(readPvpRows('pvpCard'));
    const countByName = new Map<string, number>();
    for (const card of cards) countByName.set(card.name, (countByName.get(card.name) ?? 0) + 1);

    const duplicated = [...countByName.entries()]
        .filter(([, count]) => count > 1)
        .map(([name, count]) => `「${name}」出现 ${count} 次`);

    assert.deepEqual(duplicated, [], '卡名重名会让「按名解析 id」指错行');
});

/**
 * 解析层容错：`unitPrefabPath` 写成反斜杠时**不抛错**，归一化成 `/` 再交给加载层。
 *
 * 为什么是「容错」而不是「直接抛」：错的是 `PVP-卡牌.xlsx` 里那一格，而这张表的消费方有三处
 * （单位 prefab、技能特效 prefab、卡面立绘）。在解析层收口的收益是「下游拿到的路径一定是 `/`」；
 * 代价是「源头写错不再当场炸」—— 所以**源头守卫放在前面那条用例**（表值不许含 `\`）。
 * 两条一起才闭环：新表写错 → 表守卫红；已经下发的错表 → 归一化兜住，不至于连对局都进不去。
 */
test('解析层：unitPrefabPath 的反斜杠会被归一化成 `/`', () => {
    // 只用到 `skillId` 一个字段；`ZCAttackProfile` 的其它字段与本用例无关，就地造最小对象再断言类型。
    const skills = new Map([[1001, { skillId: 1001 }]]) as unknown as Parameters<typeof parseUnits>[1];
    const units = parseUnits([{
        id: 90001,
        name: '反斜杠卡',
        unitId: 90001,
        unitPrefabPath: 'skel\\豌豆射手\\豌豆射手',
        unitSkillId: 1001,
        unitMaxHp: 10,
        unitAttack: 1,
        unitMoveSpeed: 1,
        unitAttackRange: 1,
        unitAttackInterval: 1,
        unitAttackDuration: 1,
        unitAttackHitTime: 1,
    }], skills);

    assert.equal(units.get('90001')?.prefabPath, 'skel/豌豆射手/豌豆射手');
});
