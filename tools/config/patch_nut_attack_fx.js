// 巨力坚果普攻换新特效序列帧：30802 坚果重砸 / 30803 亡者护盾（强化击）。
//
// 30667 怪物范围攻击**不动** —— 它也用 `普攻爆炸`，但那是怪物共用的范围攻击表现。
// 两套磁盘格式（remoteRef 列存 + doc/client 行对象）必须同改，见 tools/config/ref_table_io.js 开头注释。
const { readTable, writeTable } = require('./ref_table_io.js');

const FX = 'units/projectiles/巨力坚果_普攻/巨力坚果_普攻';
const TARGETS = [30802, 30803];
const TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const hits = [];
    for (const row of table.rows) {
        if (!TARGETS.includes(row.skillId)) continue;
        hits.push(`${row.skillId} ${row.name}: ${row.effectPrefabPath} -> ${FX}`);
        row.effectPrefabPath = FX;
    }
    if (hits.length !== TARGETS.length) {
        throw new Error(`${path} 只命中 ${hits.length}/${TARGETS.length} 行，拒绝写入`);
    }
    writeTable(path, table);
    console.log(`[ok] ${path} (${table.mode})`);
    hits.forEach((line) => console.log('     ' + line));
}
