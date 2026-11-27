// 同步 `pvpCard` 的「纯文本 / 纯路径」两列到转表产物：`description` + `headIcon`（2026-11-25 20:40）。
//
// ## 为什么要单独做这一步
//
// 1. **`description` 是手写文案**，点名了技能。技能改名（见 `sync_pvp_skill_plan_from_client.py`
//    的 210 处）不会自动改文案 ⇒ 玩家看到卡面写「噬血蔓延」、技能面板写「吸养根须」。
//    实测 1 处：68015 机甲菇。
//
// 2. **`headIcon` 指错目录**：remoteRef 那 35 行还是 `icons/head/xxx`，而
//    `ArtPaths.HEAD_ART_ROOT = 'icons/head'` 是**玩家头像**目录、
//    `CARD_HEAD_ART_ROOT = 'icons/cardHead'` 才是卡面（兵种）头像目录。
//    `iconArtTargetOfPath` 对直路径按目录查表（`ICON_ART_ROOTS`），两个目录都在白名单里
//    ⇒ 不会报错、也不会退占位图，**只是拿错了另一套同名图**（玩家头像当卡面）。
//    立绘 / 卡牌阵容 / 大招通报的卡面图全走这一格（`ZCGame.loadLegendCardArt`），
//    所以这属于「图看着有、但不是那张」的静默错。
//
// ## 口径
//
// · **只动这两列**，其它列一律不碰 —— `skillList` / `traits` 有只在 remoteRef 里调过的历史（§44），
//   整表覆盖会把线上调整抹回去；
// · 以 client 转表产物为准（= 设计案的产物）；
// · 前置闸：`headIcon` 的目标图必须真的在 `assets/bundles/main-pages/icons/cardHead` 下存在，
//   缺一张就整体放弃（宁可不动，也不要换出一堆占位图）；
// · 幂等：没有差异直接 `[skip]`。
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpCard.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpCard.json');
const CARD_HEAD_DIR = path.join(__dirname, '../../assets/bundles/main-pages/icons/cardHead');

/** 允许同步的列。新增一列之前先确认「remoteRef 不是唯一真源」。*/
const COLUMNS = ['description', 'headIcon'];

function main() {
    const remote = readTable(REMOTE);
    const client = readTable(CLIENT);
    if (remote.mode !== 'packed') throw new Error('[fail] remoteRef 那份必须是列存 {k,v,c}');
    if (client.mode !== 'rows') throw new Error('[fail] client 那份必须是行对象数组');

    const byId = new Map(client.rows.map((row) => [String(row.id), row]));
    const changes = [];
    for (const row of remote.rows) {
        const target = byId.get(String(row.id));
        if (!target) continue;
        for (const column of COLUMNS) {
            if ((row[column] ?? '') === (target[column] ?? '')) continue;
            changes.push({ id: row.id, name: row.name, column, from: row[column], to: target[column] });
        }
    }

    if (!changes.length) {
        console.log('[skip] description / headIcon 已与转表产物一致');
        return;
    }

    // 前置闸：换头像前先确认目标图真的存在。
    const missing = changes
        .filter((c) => c.column === 'headIcon')
        .map((c) => String(c.to ?? '').split('/').pop())
        .filter((art) => art && !fs.existsSync(path.join(CARD_HEAD_DIR, `${art}.png`)));
    if (missing.length) {
        throw new Error(`[fail] cardHead 目录缺图，拒绝写入：${missing.join('、')}`);
    }

    const byColumn = {};
    for (const c of changes) byColumn[c.column] = (byColumn[c.column] ?? 0) + 1;
    for (const c of changes) {
        if (c.column !== 'description') continue;
        console.log(`[patch] ${c.id} ${c.name} description\n   - ${c.from}\n   + ${c.to}`);
    }
    const icons = changes.filter((c) => c.column === 'headIcon');
    if (icons.length) {
        console.log(`[patch] headIcon ×${icons.length}：${icons.slice(0, 3).map((c) => `${c.id} ${c.from} → ${c.to}`).join('；')}${icons.length > 3 ? ' …' : ''}`);
    }

    for (const c of changes) {
        const row = remote.rows.find((item) => String(item.id) === String(c.id));
        row[c.column] = c.to;
    }
    writeTable(REMOTE, remote);
    console.log('[ok] 写入 ' + Object.entries(byColumn).map(([k, n]) => `${k}×${n}`).join('、'));

    // 复核：其余列差异原样打印（不修，只让人看见）。
    const other = {};
    for (const row of remote.rows) {
        const target = byId.get(String(row.id));
        if (!target) continue;
        for (const key of new Set([...Object.keys(row), ...Object.keys(target)])) {
            if (COLUMNS.includes(key)) continue;
            if ((row[key] ?? '') !== (target[key] ?? '')) other[key] = (other[key] ?? 0) + 1;
        }
    }
    const left = Object.entries(other);
    if (left.length) {
        console.log('[info] 其它列仍与转表产物不同（有线上手动调整，本脚本不动）：'
            + left.map(([k, n]) => `${k}×${n}`).join('、'));
    }
}

main();
