#!/usr/bin/env node
/**
 * pvpCard 同步（2026-11-03）：SVN 更新后 doc（转表产物，策划源）与 assets/remoteRef 出现 46 处不一致。
 *
 * 差异三类（方向全部是 doc 新、remoteRef 旧）：
 *   1. 35 处 `soilderAddTime`：整体 −2（策划在 WPS 里整列下调，随 SVN 提交）；
 *   2. 5 处卡名换皮：冰冻菇→水手菇 / 猎头者→菇八戒 / 驭兽师→分裂菇 / 泰兰德→毒箭蘑菇 / 九头蛇→诅咒蘑菇；
 *   3. 6 处 `unitPrefabPath` 换新模型：68009/68021/68024/68025/68026/68027 从 `skel/xxx` 换到 `units/xxx`。
 *
 * 运行时读 remoteRef ⇒ 必须把 remoteRef 对齐 doc。一律走 `ref_table_io`（直接覆写会写坏列存格式）。
 */
const path = require('path');
const { readTable, writeTable } = require(path.resolve(__dirname, 'ref_table_io.js'));

const REMOTE = path.resolve(__dirname, '../../assets/remoteRef/pvpCard.json');
const DOC = path.resolve(__dirname, '../../../doc/塔防数据配置/json/client/pvpCard.json');

const remote = readTable(REMOTE);
const doc = readTable(DOC);

const rowsOf = (table) => (Array.isArray(table.rows) ? table.rows : table.rows ?? table);

let patched = 0;
const log = [];
const index = new Map();
for (const row of rowsOf(remote)) index.set(String(row.id), row);
for (const fresh of rowsOf(doc)) {
    const row = index.get(String(fresh.id));
    if (!row) continue;
    for (const key of Object.keys(fresh)) {
        if (JSON.stringify(row[key]) !== JSON.stringify(fresh[key])) {
            log.push(`${fresh.id}.${key}: ${JSON.stringify(row[key])} -> ${JSON.stringify(fresh[key])}`);
            row[key] = fresh[key];
            patched += 1;
        }
    }
}

if (patched === 0) {
    console.log('[ok] pvpCard 已一致，无需写入');
    process.exit(0);
}

writeTable(REMOTE, remote);

// 回读断言
const after = readTable(REMOTE);
const afterRows = rowsOf(after);
let bad = 0;
for (const fresh of rowsOf(doc)) {
    const row = afterRows.find((r) => String(r.id) === String(fresh.id));
    if (!row) continue;
    for (const key of Object.keys(fresh)) {
        if (JSON.stringify(row[key]) !== JSON.stringify(fresh[key])) bad += 1;
    }
}
if (bad > 0) {
    console.error(`[fail] 回读仍有 ${bad} 处不一致`);
    process.exit(1);
}
console.log(`[ok] pvpCard 同步 ${patched} 格：`);
for (const line of log) console.log('  ', line);
