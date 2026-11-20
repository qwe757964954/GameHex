// 补回 `assets/remoteRef/pvpSkillPlan.json` 里被外部回滚掉的 15 行（2026-11-19）。
//
// 现场：17:58 有一次批量还原（整棵工作区），`remoteRef/pvpSkillPlan.json` 被换回旧快照，
// 行数从 2311 掉到 2296，丢的正好是最近五批新技能的三档计划行：
//   101404（68014）/ 102004（68020）/ 102203（68022 闪电链）/ 102204（68022）/ 102304（68023）
// ⇒ 游戏里这五张卡**没有技能可学**（`pvpSkillPlan` 没有行 = 永远不进技能书）。
//
// 只补这 15 行，**不碰任何既有行**：整表重建属于 `repair_remote_ref_pvp.js` 的活，而那张表
// 现在还有别人的漂移（如 103503 的描述停在 V5-20261117），整表覆盖会把别人的改动冲掉。
//
// 幂等：15 行齐全就先 `[skip]`，重跑不会重复插入。
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');

/** 行身份：一条链的一档。*/
function identity(row) {
    return `${row.skillChainId}#${row.skillLevel}`;
}

/** 这次事故丢掉的行（写死便于核对，多一行少一行都报错）。*/
const LOST = [
    '101404#1', '101404#2', '101404#3',
    '102004#1', '102004#2', '102004#3',
    '102203#1', '102203#2', '102203#3',
    '102204#1', '102204#2', '102204#3',
    '102304#1', '102304#2', '102304#3',
];

function main() {
    const client = readTable(CLIENT);
    const remote = readTable(REMOTE);
    if (client.mode !== 'rows') throw new Error('[fail] client 那份必须是行对象数组');
    if (remote.mode !== 'packed') throw new Error('[fail] remoteRef 那份必须是列存');

    const clientByKey = new Map();
    client.rows.forEach((row, index) => clientByKey.set(identity(row), { row, index }));
    const haveKeys = new Set(remote.rows.map(identity));

    const missing = LOST.filter((key) => !haveKeys.has(key));
    if (!missing.length) {
        console.log(`[skip] ${LOST.length} 行齐全（${remote.rows.length} 行），无需改动`);
        return;
    }

    //  先把「丢了但不在名单里」和「名单里但其实没丢」都拦下来 —— 命中的不是这次事故。
    const unexpected = client.rows
        .map(identity)
        .filter((key) => !haveKeys.has(key) && !LOST.includes(key));
    if (unexpected.length) {
        throw new Error(`[fail] 除名单外还差了 ${unexpected.length} 行：${unexpected.slice(0, 8).join(', ')}…`);
    }
    const absent = LOST.filter((key) => !clientByKey.has(key));
    if (absent.length) throw new Error(`[fail] 名单里的行 client 也没有：${absent.join(', ')}`);

    //  插入点 = client 里它前面最近一条**两边都有**的行之后；保持 remote 既有顺序不动。
    const order = client.rows.map(identity);
    const inserted = [];
    for (const key of missing) {
        const clientIndex = clientByKey.get(key).index;
        let anchor = -1;
        for (let back = clientIndex - 1; back >= 0; back -= 1) {
            const candidate = remote.rows.findIndex((row) => identity(row) === order[back]);
            if (candidate >= 0) { anchor = candidate; break; }
        }
        const at = anchor < 0 ? 0 : anchor + 1;
        remote.rows.splice(at, 0, clientByKey.get(key).row);
        inserted.push({ key, at });
    }

    writeTable(REMOTE, remote);
    console.log(`[ok] 补回 ${inserted.length} 行 → ${remote.rows.length} 行`);
    for (const item of inserted) console.log(`     ${item.key} 插在第 ${item.at} 行前`);
    console.log(`[backup] 原文件备份到 tmp/config_backup/`);
}

function backup() {
    const dir = path.join(__dirname, '../../tmp/config_backup');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(REMOTE, path.join(dir, `pvpSkillPlan.${stamp}.json`));
}

backup();
main();
