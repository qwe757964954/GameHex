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
//
// ⚠️ 2026-11-03 补充：`tests/zcds-model.test.ts` 的 `readPvpRef()` 读的是 **client** 那份
// （`../doc/塔防数据配置/json/client/<name>.json`），所以用例里同样会抛
// `skills.30707.secondarySkillId 必须是大于 0 的数字`。两份都要修，否则「测试绿了、
// 转表产物还是脏的」，下次重新导出又会把问题带回来。
//
// ✅ 2026-11-04 根治：上面第 9-13 行说的「表里声明就是 string」是**错的**——
// `PVP-技能.xlsx` 单元格本身存的是数字（XML 里 `t="n"`），是第 6 行类型行被写成了
// `string`，eSon 才按声明转成 `"30832"`。已把 R 列（`secondarySkillId`）的类型声明改回
// `int`（与同语义的 `empoweredSkillId` 一致），重导后 remoteRef 与 json/client 两份
// **天然都是数字**。本脚本因此退化为**兜底 + 幂等自检**（正常状态应打印 `[skip]`）；
// 再出现字符串化说明有人把类型行又改回 `string`，正解是改表、不是跑这个脚本。
// 导表侧还有一道闸：`validate_skill_pipeline.mjs` 的 `assertNumericSkillIds`。
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const PATHS = [
    'assets/remoteRef/pvpSkill.json',
    path.resolve(__dirname, '../../../doc/塔防数据配置/json/client/pvpSkill.json'),
];
//  只修「本来就该是数字」的 id 列。`chargeDistance` / `chargeSpeedScale` 等数值列顺带自检，
//  但只在它们真的是数字串时才转（说明同样是那次同步写坏的）。
const ID_KEYS = ['skillId', 'empoweredSkillId', 'empoweredEvery', 'secondarySkillId',
    'chargeDistance', 'chargeSpeedScale', 'cooldown', 'projectileSpeed', 'areaRadius'];

for (const PATH of PATHS) fixFile(PATH);

function fixFile(PATH) {
    const table = readTable(PATH);
    if (table.mode !== 'packed' && table.mode !== 'rows') throw new Error(`${PATH} 格式未知：${table.mode}`);

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
        console.log(`[skip] ${PATH}：没有字符串化的 id 列（幂等）`);
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
    console.log(`[ok] ${PATH} 回读一致：id 列全是数字`);
}
