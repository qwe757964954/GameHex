// 把 `pvpSkillPlan.desc` 的文案同步到 `armySkillLevelUp` 的两份产物（2026-11-25 21:00）。
//
// 三写里的两份 JSON（xlsx 那一份见 `sync_army_skill_desc_excel.py`）：
//   · `assets/remoteRef/armySkillLevelUp.json` —— 列存 `{k,v,c}`、CRLF、元素独占行（运行期读这份）；
//   · `doc/塔防数据配置/json/client/armySkillLevelUp.json` —— 行对象数组、`,\n` 分隔、无尾换行。
//
// 口径：以 `pvpSkillPlan.desc`（技能面板）为准，理由见 `sync_army_skill_desc_excel.py` 头注释里的
// 对照表 —— 27 条里两条**数值冲突**的都能被 `skillParamJson` / 子链 `damageRate` 判出对错，且都对在计划行。
//
// 两道自检（都过才写）：
//   1. 用本文件的序列化方式重建两份文件，必须与原文件**逐字节相同** —— 证明「我改的只有目标那几格」；
//   2. 写前要求 client 与 remote 的现值互相一致（两边不同 ⇒ 有人只改了一半，停下来人工确认）。
const fs = require('fs');
const path = require('path');
const { readTable, writeTable, render } = require('./ref_table_io.js');

const ROOT = 'assets/remoteRef';
const PLAN = path.join(ROOT, 'pvpSkillPlan.json');
const ARMY_REMOTE = path.join(ROOT, 'armySkillLevelUp.json');
const ARMY_CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/armySkillLevelUp.json';

/** 与 `ref_table_io.writeTable` 的列存模板一致（自检用）。 */
function renderPacked(table) {
    const matrix = table.rows.map((row) => (Array.isArray(row)
        ? row
        : table.keys.map((name) => (name in row ? row[name] : null))));
    return `{\r\n"k":${render(table.keys)},\r\n"v":${render(matrix)},\r\n"c":${table.c}\r\n}`;
}

function renderRows(rows) {
    return '[' + rows.map((row) => JSON.stringify(row)).join(',\n') + ']';
}

function main() {
    const planRows = readTable(PLAN).rows;
    const plan = new Map(planRows.map((row) => [`${row.skillChainId}#${row.skillLevel}`, row]));

    const remoteRaw = fs.readFileSync(ARMY_REMOTE, 'utf8');
    const clientRaw = fs.readFileSync(ARMY_CLIENT, 'utf8');
    const remote = readTable(ARMY_REMOTE);
    const client = readTable(ARMY_CLIENT);
    if (remote.mode !== 'packed') throw new Error('[fail] remoteRef 那份必须是列存');
    if (client.mode !== 'rows') throw new Error('[fail] client 那份必须是行对象数组');

    if (renderPacked(remote) !== remoteRaw) throw new Error('[fail] remoteRef 序列化自检失败，拒绝写入');
    if (renderRows(client.rows) !== clientRaw) throw new Error('[fail] client 序列化自检失败，拒绝写入');
    console.log(`[ok] 序列化自检通过（remote ${remote.rows.length} 行 / client ${client.rows.length} 行）`);

    const clientById = new Map(client.rows.map((row) => [`${row.id}#${row.skilllevel}`, row]));
    const targets = [];
    const conflict = [];
    for (const row of remote.rows) {
        const key = `${row.id}#${row.skilllevel}`;
        const source = plan.get(key);
        const twin = clientById.get(key);
        if (!source || !twin) continue;
        if ((row.desc ?? '') === (twin.desc ?? '')) {
            // 两边一致，才允许一起改；不一致说明有人只改了一半。
            if ((row.desc ?? '') !== (source.desc ?? '')) {
                targets.push({ key, row, twin, name: source.skillName, from: row.desc ?? '', to: source.desc ?? '' });
            }
        } else {
            conflict.push(`${key}：remote「${(row.desc ?? '').slice(0, 20)}…」 vs client「${(twin.desc ?? '').slice(0, 20)}…」`);
        }
    }
    if (conflict.length) {
        conflict.slice(0, 5).forEach((line) => console.log('  ' + line));
        throw new Error(`[fail] 两份产物本身就不一致（${conflict.length} 行），先查清再同步`);
    }
    if (!targets.length) {
        console.log('[skip] 升级表描述已与计划行一致');
        return;
    }

    for (const t of targets) {
        console.log(`[patch] ${t.key} ${t.name}\n   - ${t.from.slice(0, 70)}\n   + ${t.to.slice(0, 70)}`);
        t.row.desc = t.to;
        t.twin.desc = t.to;
    }

    writeTable(ARMY_REMOTE, remote);
    fs.writeFileSync(ARMY_CLIENT, renderRows(client.rows), 'utf8');

    // 回读校验：两份互等，且与计划行逐字一致。
    const afterRemote = readTable(ARMY_REMOTE).rows;
    const afterClient = readTable(ARMY_CLIENT).rows;
    const clientAfter = new Map(afterClient.map((row) => [`${row.id}#${row.skilllevel}`, row]));
    let drift = 0;
    for (const row of afterRemote) {
        const key = `${row.id}#${row.skilllevel}`;
        const twin = clientAfter.get(key);
        const source = plan.get(key);
        if (!twin || !source) continue;
        if ((row.desc ?? '') !== (twin.desc ?? '') || (row.desc ?? '') !== (source.desc ?? '')) drift += 1;
    }
    if (drift) throw new Error(`[fail] 回读有 ${drift} 行仍不一致`);
    console.log(`[ok] 写入 ${targets.length} 行；三份（计划行 / remote / client）逐字一致`);
}

main();
