// 按 id 改 `pvpCard` / `monsterCard` 的 `unitPrefabPath`（字符串列，两套磁盘格式一起改）。
//
// 用法：
//   node tools/config/patch_card_model_json.js pvpCard 68022=skel/香蕉雷神/香蕉雷神
//   node tools/config/patch_card_model_json.js monsterCard 50024=skel/香蕉雷神/香蕉雷神
//
// 与 `patch_pvp_card_field.js` 的分工：那个只处理数值列（会把路径 Number 成 NaN），
// 这个只处理模型路径这类字符串列。守卫同它一致：
//   ① 两套格式（remoteRef 列存 / doc 转表产物）必须同时写；
//   ② 目标 id 必须存在，字段必须原本就有（写进不存在的列 = 静默无效）；
//   ③ 除目标行外，任何一行的该字段都不许变。
//
// 注意：Excel 才是唯一真源。本脚本只负责把「已经改好的表」同步到两份 json，
// 先跑 `patch_pvp_card_model_excel.py` 改表，再跑这个。
const path = require('path');
const fs = require('fs');
const { readTable, render } = require(path.resolve(__dirname, 'ref_table_io.js'));

const TABLES = {
    pvpCard: [
        'assets/remoteRef/pvpCard.json',
        'D:/City1001/doc/塔防数据配置/json/client/pvpCard.json',
    ],
    monsterCard: [
        'assets/remoteRef/monsterCard.json',
        'D:/City1001/doc/塔防数据配置/json/client/monsterCard.json',
    ],
};

const FIELD = 'unitPrefabPath';
const [table, ...pairs] = process.argv.slice(2);
if (!table || !TABLES[table] || !pairs.length) {
    console.error('用法：node patch_card_model_json.js <pvpCard|monsterCard> <id=路径> [id=路径 ...]');
    process.exit(1);
}
const targets = new Map(pairs.map((pair) => {
    const at = pair.indexOf('=');
    if (at <= 0) throw new Error(`参数格式不对：${pair}，应为 id=路径`);
    return [Number(pair.slice(0, at)), pair.slice(at + 1)];
}));

// `ref_table_io.writeTable` 对 rows 模式写的是单行 `JSON.stringify`，而 doc 转表产物是
// 「`[{...},\n{...}]`，一行一个对象」。直接复用它会让 `svn diff` 显示整文件替换，
// 真实差异（一个字段）反而看不见 —— 所以 rows 模式按原换行风格重写。
function writePreserving(file, doc) {
    if (doc.mode !== 'rows') {
        const matrix = doc.rows.map((row) => doc.keys.map((name) => (name in row ? row[name] : null)));
        fs.writeFileSync(file, `{\r\n"k":${render(doc.keys)},\r\n"v":${render(matrix)},\r\n"c":${doc.c}\r\n}`, 'utf8');
        return;
    }
    const multiline = doc.raw.includes('\n') && /^\[\s*\{/.test(doc.raw.trim());
    const body = multiline
        ? `[${doc.rows.map((row) => JSON.stringify(row)).join(',\n')}]`
        : JSON.stringify(doc.rows);
    fs.writeFileSync(file, body, 'utf8');
}

for (const file of TABLES[table]) {
    const doc = readTable(file);
    const before = new Map(doc.rows.map((row) => [row.id, row[FIELD]]));
    const hit = new Set();

    for (const row of doc.rows) {
        if (!targets.has(row.id)) continue;
        if (!(FIELD in row)) throw new Error(`${file} 里 ${row.id} 没有字段 ${FIELD}，请先确认列名`);
        row[FIELD] = targets.get(row.id);
        hit.add(row.id);
    }
    const missing = [...targets.keys()].filter((id) => !hit.has(id));
    if (missing.length) throw new Error(`${file} 里找不到 id：${missing.join(', ')}`);

    for (const row of doc.rows) {
        const expected = targets.has(row.id) ? targets.get(row.id) : before.get(row.id);
        if (row[FIELD] !== expected) {
            throw new Error(`${file} 的 ${row.id} 写后校验失败：${row[FIELD]} !== ${expected}`);
        }
    }

    writePreserving(file, doc);
    const detail = [...targets].map(([id, value]) => `${id}: ${before.get(id)} → ${value}`).join('，');
    console.log(`[ok] ${file}（${doc.mode}）${FIELD} ${detail}`);
}
