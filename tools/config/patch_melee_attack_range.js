// 战士 / 坦克 基础射程统一改成 45（2026-10-30 用户口径）。
//
// 口径同 patch_ranged_attack_range.js：只改 `pvpCard.unitAttackRange`，这是单位射程的
// 唯一真源（`pvpUnitGrowth.attackRangeFlat` 全 0、`pvpModifierOverride` 无 attackRange 条目、
// `ZCPvpTableParser` 只从这一列读）。
//
// 判定按 `traits.attack`（职业）不看当前值：表里原本 300 的三张（仙桃行者 / 窝瓜人 / 仙人侍卫）
// 也一并压到 45 —— 用户口径是「战士和坦克」全部。45 仍在 `ZCTargetingSystem.attackReach` 的
// 近战分支（`attackRange <= 100`），因此仍然吃「+ 目标碰撞半径」的补正，不会够不着。
const { readTable, writeTable } = require('./ref_table_io.js');

const JOB_RANGE = { '战士': 45, '坦克': 45 };

const TABLES = [
    'assets/remoteRef/pvpCard.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/sever/pvpCard.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const before = new Map(table.rows.map((row) => [row.id, row.unitAttackRange]));

    const warriors = table.rows.filter((row) => row.traits && row.traits.attack === '战士');
    const tanks = table.rows.filter((row) => row.traits && row.traits.attack === '坦克');
    // 守卫：战士 12 张、坦克 5 张。数量一变说明卡表动过，先别写。
    if (warriors.length !== 12 || tanks.length !== 5) {
        throw new Error(`卡表职业数量变了：战士 ${warriors.length} / 坦克 ${tanks.length}，预期 12 / 5`);
    }

    const changes = [];
    for (const row of [...warriors, ...tanks]) {
        const target = JOB_RANGE[row.traits.attack];
        const from = before.get(row.id);
        if (from === target) continue;
        row.unitAttackRange = target;
        changes.push(`${row.id} ${row.name}（${row.traits.attack}）${from} → ${target}`);
    }

    for (const row of [...warriors, ...tanks]) {
        if (row.unitAttackRange !== 45) throw new Error(`${row.id} 射程不是 45`);
    }
    // 非目标行必须逐字未动（主城 / 金矿该项是 null，法师 / 射手保持 550 / 500）
    const touched = table.rows.filter((row) => {
        const job = row.traits && row.traits.attack;
        return !JOB_RANGE[job] && row.unitAttackRange !== before.get(row.id);
    });
    if (touched.length) throw new Error(`误改了非战士/坦克行：${touched.map((r) => r.id).join(',')}`);

    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）改 ${changes.length} 行`);
    if (path === TABLES[0]) changes.forEach((line) => console.log('   ', line));
}
