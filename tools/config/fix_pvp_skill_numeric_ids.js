// 把 `assets/remoteRef/pvpSkill.json` 里被写成**字符串**的 id 列改回数字（2026-11-02）。
//
// 症状：跑 `tests/zcds-*.test.ts` 时整片中招 ——
//   `skills.30707.secondarySkillId 必须是大于 0 的数字`
//   栈指到 `ZCPvpTableParser.optionalPositiveNumber` → `compilePvpTables` → 所有 loadPvpTables 的用例。
// 60 多条用例的根因只有 7 个格子：某次「从表同步」把 `secondarySkillId` 这一列的**非空值**
// 统统写成了字符串（`30832` → `"30832"`，连 `0` 都成了 `"0"`）。
//
// 为什么只有 remoteRef 中招、`json/client` 没有：转表产物那边这个列在表里声明就是 `string`，
// 出字符串是正常的；运行时这份是打包态，消费方 `ZCPvpTableParser` 一律按数字读
// （`secondarySkillId` / `empoweredSkillId` 都是 `optionalPositiveNumber`），
// 所以**运行时这份必须是数字**。两份文件的类型差异是既有的、已知的，别顺手「统一」——
// 统一成字符串会让整张技能表编译失败，统一成数字又要动转表产物的形状。
const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const PATH = 'assets/remoteRef/pvpSkill.json';
//  只修「本来就该是数字」的 id 列。`chargeDistance` / `chargeSpeedScale` 等数值列顺带自检，
//  但只在它们真的是数字串时才转（说明同样是那次同步写坏的）。
const ID_KEYS = ['skillId', 'empoweredSkillId', 'empoweredEvery', 'secondarySkillId',
    'chargeDistance', 'chargeSpeedScale', 'cooldown', 'projectileSpeed', 'areaRadius'];

const table = readTable(PATH);
if (table.mode !== 'packed') throw new Error(`${PATH} 不是打包态 {k,v,c}，先核对格式`);

const fixed = [];
for (const row of table.rows) {
    for (const key of ID_KEYS) {
        const value = row[key];
        if (typeof value !== 'string') continue;
        if (!/^-?\d+(\.\d+)?$/.test(value.trim())) continue;
        //  空串是「这一格没值」，不是数字 —— 原样留着（改成 null 会动到另一层口径）。
        row[key] = Number(value);
        fixed.push(`${row.skillId}.${key}: "${value}" → ${row[key]}`);
    }
}

if (!fixed.length) {
    console.log('[skip] 没有字符串化的 id 列（幂等）');
} else {
    writeTable(PATH, table);
    console.log(`[ok] ${PATH} 修正 ${fixed.length} 格：`);
    for (const line of fixed) console.log('   ', line);
}

// 回读：id 列里不许再出现数字字符串，否则解析层会继续抛。
const check = readTable(PATH);
const dirty = [];
for (const row of check.rows) {
    for (const key of ID_KEYS) {
        if (typeof row[key] === 'string' && /^-?\d+(\.\d+)?$/.test(row[key].trim())) {
            dirty.push(`${row.skillId}.${key} = "${row[key]}"`);
        }
    }
}
if (dirty.length) throw new Error(`回读仍有字符串化的数值：${dirty.slice(0, 8).join(', ')}`);
console.log('[ok] 回读一致：id 列全是数字');
