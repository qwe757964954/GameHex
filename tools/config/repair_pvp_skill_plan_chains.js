// 以 client 为准，修 **指定链号** 在 remoteRef 里的旧快照（2026-11-19）。
//
// 背景：`assets/remoteRef/pvpSkillPlan.json` 被外部进程整棵还原过一次，102001 / 103103 /
// 103503 三条链停在更早的快照上（`behaviorKey` 还是 `self_cast` / `skill_params`），
// 而 client 早已是 `summon_unit` / `ray_beam`。症状不是报错，而是：
//   · 舞王 103103 召不出舞伴（`self_castCooldown` 那段参数在召唤车道里读不到）⇒ 8 条用例红；
//   · 科学家 103503 的射线段整条不生效；
//   · `remoteRef 与转表产物逐格一致` 这条守卫红。
//
// 只覆盖传入链号的行、**只覆盖 remote 里存在的列**（client 多一列 `statusStatJson`，
// 往列存里加列要动 schema / 每行补格，不属于本脚本职责）。其余行一个字节都不碰。
//
// 幂等：内容没变就不写盘；写完回读全表逐格比对，非本链的差异直接报错退出。
// 用法：node tools/config/repair_pvp_skill_plan_chains.js [链号 ...]
//       （缺省 = 102001 103103 103503）
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const BACKUP_DIR = path.join(__dirname, '../../tmp');

const CHAINS = process.argv.slice(2).map(Number).filter((value) => Number.isFinite(value));
const TARGETS = CHAINS.length ? CHAINS : [102001, 103103, 103503];

function rowsOfChain(table, chain) {
    return table.rows
        .filter((row) => Number(row.skillChainId) === chain)
        .sort((a, b) => Number(a.modifierId) - Number(b.modifierId));
}

function diffKeys(ledger, client, remoteKeys) {
    const changed = [];
    for (const key of remoteKeys) {
        if (JSON.stringify(ledger[key] ?? null) !== JSON.stringify(client[key] ?? null)) changed.push(key);
    }
    return changed;
}

function main() {
    const client = readTable(CLIENT);
    const remote = readTable(REMOTE);
    const remoteKeys = remote.keys;
    if (remote.mode !== 'packed') throw new Error('[fail] remoteRef 必须是列存格式');

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(REMOTE, path.join(BACKUP_DIR, `pvpSkillPlan.bak-repair-${stamp}.json`));

    let touched = 0;
    for (const chain of TARGETS) {
        const clientRows = rowsOfChain(client, chain);
        const remoteRows = rowsOfChain(remote, chain);
        if (!clientRows.length) throw new Error(`[fail] client 里没有链 ${chain}`);
        if (clientRows.length !== remoteRows.length) {
            throw new Error(`[fail] 链 ${chain} 行数不一致：client ${clientRows.length} / remote ${remoteRows.length}`);
        }
        clientRows.forEach((ledger, index) => {
            const target = remoteRows[index];
            if (Number(ledger.modifierId) !== Number(target.modifierId)) {
                throw new Error(`[fail] 链 ${chain} 第 ${index} 行对不上：`
                    + `client ${ledger.modifierId} / remote ${target.modifierId}`);
            }
            const changed = diffKeys(ledger, target, remoteKeys);
            if (!changed.length) return;
            const index2 = remote.rows.indexOf(target);
            const row = remote.rows[index2];
            for (const key of changed) row[key] = ledger[key] ?? null;
            touched += 1;
            console.log(`[fix] #${target.modifierId}（链 ${chain}）：${changed.join(', ')}`);
        });
    }

    if (!touched) {
        console.log('[skip] remoteRef 这三条链已是 client 的值');
    } else {
        writeTable(REMOTE, remote);
        console.log(`[ok] pvpSkillPlan(remoteRef)：修 ${touched} 行`);
    }

    //  回读守卫：全表逐格比，一格都不许再差（本次扫描时全表只有这三条链有差异，
    //  修完就该是 0 —— 若别处又冒出差异，说明外部进程又动过，必须人工看）。
    const after = readTable(REMOTE);
    const clientById = new Map(client.rows.map((row) => [Number(row.modifierId), row]));
    const residual = [];
    for (const row of after.rows) {
        const ledger = clientById.get(Number(row.modifierId));
        if (!ledger) { residual.push(`#${row.modifierId} client 里没有`); continue; }
        const changed = diffKeys(ledger, row, remoteKeys);
        if (!changed.length) continue;
        residual.push(`#${row.modifierId}（链 ${row.skillChainId}）：${changed.join(', ')}`);
    }
    if (residual.length) throw new Error('[fail] 修完仍有差异：\n' + residual.join('\n'));
    if (after.rows.length !== client.rows.length) {
        throw new Error(`[fail] 行数不一致：remote ${after.rows.length} / client ${client.rows.length}`);
    }
    console.log(`[ok] 回读通过：${after.rows.length} 行全表逐格一致（只改了 ${TARGETS.join(' / ')}）`);
}

main();
