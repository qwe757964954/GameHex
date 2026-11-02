// 通用：按卡牌 id 改 `pvpCard` 的单个数值字段（两套磁盘格式一起改）。
//
// 用法：
//   node tools/config/patch_pvp_card_field.js unitMaxHp 68001=40 68012=50
//   node tools/config/patch_pvp_card_field.js unitAttack 68001=14
//
// 为什么参数化：pvpCard 的调平衡基本就是「某几张卡的某一列改成某值」，
// 每来一次就新写一个脚本会攒一堆一次性文件。这里只做三件事并带守卫：
//   ① 两套格式（remoteRef 列存 / doc 转表产物）必须同时写；
//   ② 目标 id 必须存在，字段必须原本就有（写进去一个表里没有的列 = 静默无效）；
//   ③ 除目标行外，任何一行的该字段都不许变。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'assets/remoteRef/pvpCard.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
];

const [field, ...pairs] = process.argv.slice(2);
if (!field || !pairs.length) {
    console.error('用法：node patch_pvp_card_field.js <字段名> <卡牌id=值> [卡牌id=值 ...]');
    process.exit(1);
}
const targets = new Map(pairs.map((pair) => {
    const [id, value] = pair.split('=');
    if (!id || value === undefined) throw new Error(`参数格式不对：${pair}，应为 id=值`);
    return [Number(id), Number(value)];
}));

for (const path of TABLES) {
    const table = readTable(path);
    const before = new Map(table.rows.map((row) => [row.id, row[field]]));
    const hit = new Set();

    for (const row of table.rows) {
        if (!targets.has(row.id)) continue;
        if (!(field in row)) throw new Error(`${path} 里 ${row.id} 没有字段 ${field}，请先确认列名`);
        row[field] = targets.get(row.id);
        hit.add(row.id);
    }
    const missing = [...targets.keys()].filter((id) => !hit.has(id));
    if (missing.length) throw new Error(`${path} 里找不到卡牌：${missing.join(', ')}`);

    for (const row of table.rows) {
        const expected = targets.has(row.id) ? targets.get(row.id) : before.get(row.id);
        if (row[field] !== expected) {
            throw new Error(`${path} 的 ${row.id} 写后校验失败：${row[field]} !== ${expected}`);
        }
    }

    writeTable(path, table);
    const detail = [...targets].map(([id, value]) => `${id}: ${before.get(id)} → ${value}`).join('，');
    console.log(`[ok] ${path}（${table.mode}）${field} ${detail}`);
}
