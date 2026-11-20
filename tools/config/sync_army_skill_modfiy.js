// 把 `armySkillLevelUp.modfiy` 修成「两份产物一致的数字数组」（2026-11-19）。
//
// 背景：这一列在两份产物里各走各的路，症状全是**静默**的：
//   · remoteRef 里 101404 / 102004 / 102203 / 102204 / 102304 被批量脚本写成了**逗号字符串**
//     （`"94014041"`）—— `ref_type_all.d.ts` 声明的是 `modfiy:any[]`，
//     `patch_army_skill_modfiy_debris.js` 这类下游脚本按 `Array.isArray` 判 ⇒ 整行被跳过；
//   · client 里 103103 / 101704 / 101803 / 101904 / 102104 / 102704 还是字符串，
//     另有 **321 行干脆是空数组**（引用丢了，remote 那边是有的）。
//   ⇒ 六条「卡面 / 两份产物逐格一致」用例长期红，`validate_skill_pipeline.mjs`
//     也一直报「modfiy 为空 / modifierId 尚未被引用」。
//
// 本脚本的口径（**不发明新数据，也不删任何一条还活着的引用**）：
//   1. 字符串 → 按 `,` 拆成数字数组；
//   2. 同一 (id, 档位) 取两份的**并集**（任一侧有就保留 —— 子链修改器只写在某一侧是历史常见情况）；
//   3. 并集里**只保留 `pvpSkillPlan.modifierId` 真实存在的 id**（这就是 debris 脚本的死引用规则，
//      只可能删掉已经不存在的号，不会删掉活引用）；
//   4. 排序去重后**两份写同一份值**。
//
// 幂等：第二次跑什么都不改。用法：node tools/config/sync_army_skill_modfiy.js
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/armySkillLevelUp.json');
const REMOTE = path.join(__dirname, '../../assets/remoteRef/armySkillLevelUp.json');
const PLAN_CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const PLAN_REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const BACKUP_DIR = path.join(__dirname, '../../tmp');

function toArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean)
            .map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    return [];
}

function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function modifierIdsOf(table) {
    const ids = new Set();
    for (const row of table.rows) {
        if (row.modifierId === undefined || row.modifierId === null) continue;
        const value = Number(row.modifierId);
        if (Number.isFinite(value)) ids.add(value);
    }
    return ids;
}

function main() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CLIENT, path.join(BACKUP_DIR, `armySkillLevelUp.client.bak-sync-${stamp}.json`));
    fs.copyFileSync(REMOTE, path.join(BACKUP_DIR, `armySkillLevelUp.remote.bak-sync-${stamp}.json`));

    //  合法修改器集合：两份 pvpSkillPlan 必须一致（刚修过 102001 / 103103 / 103503 的旧快照）。
    const valid = modifierIdsOf(readTable(PLAN_CLIENT));
    const validRemote = modifierIdsOf(readTable(PLAN_REMOTE));
    for (const id of validRemote) valid.add(id);

    const client = readTable(CLIENT);
    const remote = readTable(REMOTE);
    const keyOf = (row) => `${Number(row.id)}:${Number(row.skilllevel)}`;
    const clientByKey = new Map(client.rows.map((row) => [keyOf(row), row]));
    const remoteByKey = new Map(remote.rows.map((row) => [keyOf(row), row]));

    let changedRows = 0;
    let droppedIds = 0;
    const warnings = [];

    for (const [key, row] of clientByKey) {
        const peer = remoteByKey.get(key);
        if (!peer) { warnings.push(`${key} 只在 client 里`); continue; }
        const union = new Set([...toArray(row.modfiy), ...toArray(peer.modfiy)]);
        const kept = [];
        for (const id of union) {
            if (valid.has(id)) kept.push(id);
            else droppedIds += 1;
        }
        kept.sort((a, b) => a - b);
        if (!same(row.modfiy, kept)) { row.modfiy = kept; changedRows += 1; }
        if (!same(peer.modfiy, kept)) { peer.modfiy = kept; changedRows += 1; }
    }
    for (const key of remoteByKey.keys()) {
        if (!clientByKey.has(key)) warnings.push(`${key} 只在 remote 里`);
    }

    if (changedRows) {
        writeTable(CLIENT, client);
        writeTable(REMOTE, remote);
    }
    console.log(`[ok] armySkillLevelUp.modfiy：改 ${changedRows} 格，丢掉死引用 ${droppedIds} 个`);

    //  回读守卫：两份都必须全是数组、逐 (id, 档位) 相等、且不含 pvpSkillPlan 里不存在的号。
    const afterClient = readTable(CLIENT);
    const afterRemote = readTable(REMOTE);
    const afterClientByKey = new Map(afterClient.rows.map((row) => [keyOf(row), row]));
    const problems = [];
    for (const row of afterRemote.rows) {
        const key = keyOf(row);
        if (!Array.isArray(row.modfiy)) { problems.push(`${key} remote 不是数组`); continue; }
        if (row.modfiy.some((id) => !valid.has(Number(id)))) problems.push(`${key} remote 含死引用`);
        const peer = afterClientByKey.get(key);
        if (!peer) { problems.push(`${key} client 里没有`); continue; }
        if (!Array.isArray(peer.modfiy)) { problems.push(`${key} client 不是数组`); continue; }
        if (!same(row.modfiy, peer.modfiy)) {
            problems.push(`${key} 两份不一致：${JSON.stringify(peer.modfiy)} vs ${JSON.stringify(row.modfiy)}`);
        }
    }
    for (const row of afterClient.rows) {
        if (!Array.isArray(row.modfiy)) problems.push(`${keyOf(row)} client 不是数组`);
    }
    if (problems.length) throw new Error('[fail] 修完仍不一致：\n' + problems.slice(0, 20).join('\n'));
    if (warnings.length) console.log('[warn] ' + warnings.join('\n[warn] '));
    console.log(`[ok] 回读通过：${afterRemote.rows.length} 行两份逐格一致，全部是数字数组`);
}

main();
