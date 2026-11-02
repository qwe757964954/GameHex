// 临时工具：读写 PVP 配表，两套磁盘格式都要认。
//
//  1. `assets/remoteRef/*.json` —— 列存竖排 `{k:[], v:[[]], c:int}`；
//  2. `doc/塔防数据配置/json/client/*.json`（转表产物）—— 紧凑行对象数组 `[{...}]`。
//
// 两套格式对同一张表必须是同一份数据（`tests/zcds-model.test.ts` 有逐格互校守卫），
// 所以补丁脚本必须同时写两边。
const fs = require('fs');

function render(value) {
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        return `[\r\n${value.map(render).join(',\r\n')}\r\n]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (!entries.length) return '{}';
        return `{\r\n${entries.map(([key, item]) => `${JSON.stringify(key)}:${render(item)}`).join(',\r\n')}\r\n}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function readTable(path) {
    const raw = fs.readFileSync(path, 'utf8');
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return { mode: 'rows', keys: null, rows: json, c: null, raw };
    const keys = json.k;
    const rows = json.v.map((row) => {
        const obj = {};
        keys.forEach((name, index) => { obj[name] = row[index]; });
        return obj;
    });
    return { mode: 'packed', keys, rows, c: json.c, raw };
}

function writeTable(path, table) {
    if (table.mode === 'rows') {
        fs.writeFileSync(path, JSON.stringify(table.rows), 'utf8');
        return;
    }
    const matrix = table.rows.map((row) => (Array.isArray(row)
        ? row
        : table.keys.map((name) => (name in row ? row[name] : null))));
    fs.writeFileSync(path, `{\r\n"k":${render(table.keys)},\r\n"v":${render(matrix)},\r\n"c":${table.c}\r\n}`, 'utf8');
}

module.exports = { readTable, writeTable, render };
