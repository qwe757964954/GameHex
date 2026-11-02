// 法师 / 射手 基础射程统一：法师 550、射手 500（2026-10-30 用户口径）。
//
// 只改 `pvpCard.unitAttackRange` —— 这是单位射程的**唯一真源**：
//   · `pvpUnitGrowth.attackRangeFlat` 全 0，不带射程成长；
//   · `pvpModifierOverride` 里没有 attackRange 条目；
//   · `ZCPvpTableParser` 只从 pvpCard.unitAttackRange 读 attackRange。
// 所以这一列改完即生效，不需要动技能表或成长表。
//
// 判定口径按 `traits.attack`（职业），不看当前值：表里 70 的那批（杰克藕 / 镭射飞龙 /
// 萨满 / 魔术师 / 猎头者）也一并抬到职业基线 —— 用户口径是「所有法师和射手角色」。
const { readTable, writeTable } = require('./ref_table_io.js');

const JOB_RANGE = { '法师': 550, '射手': 500 };

const TABLES = [
    'assets/remoteRef/pvpCard.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const before = new Map(table.rows.map((row) => [row.id, row.unitAttackRange]));

    const mages = table.rows.filter((row) => row.traits && row.traits.attack === '法师');
    const archers = table.rows.filter((row) => row.traits && row.traits.attack === '射手');
    // 守卫：法师 9 张、射手 9 张。数量一变说明卡表动过，先别写。
    if (mages.length !== 9 || archers.length !== 9) {
        throw new Error(`卡表职业数量变了：法师 ${mages.length} / 射手 ${archers.length}，预期 9 / 9`);
    }

    const changes = [];
    for (const row of [...mages, ...archers]) {
        const job = row.traits.attack;
        const target = JOB_RANGE[job];
        const from = before.get(row.id);
        if (from === target) continue;
        row.unitAttackRange = target;
        changes.push(`${row.id} ${row.name}（${job}）${from} → ${target}`);
    }

    for (const row of mages) {
        if (row.unitAttackRange !== 550) throw new Error(`${row.id} 法师射程不是 550`);
    }
    for (const row of archers) {
        if (row.unitAttackRange !== 500) throw new Error(`${row.id} 射手射程不是 500`);
    }
    // 非目标行必须逐字未动（主城 / 金矿的该项是 null）
    const touched = table.rows.filter((row) => {
        const job = row.traits && row.traits.attack;
        return !JOB_RANGE[job] && row.unitAttackRange !== before.get(row.id);
    });
    if (touched.length) throw new Error(`误改了非法师/射手行：${touched.map((r) => r.id).join(',')}`);

    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）改 ${changes.length} 行`);
    if (path === TABLES[0]) changes.forEach((line) => console.log('   ', line));
}
