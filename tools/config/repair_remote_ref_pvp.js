// 修复 `assets/remoteRef/pvpSkillPlan.json`（2026-11-18 17:04 被外部进程改写）。
//
// 现场：整文件只剩 2287 行、且 101803 / 101704 这几条**新追加行整排错位**
// （`skillKind` 列里躺着 `9`、`desc` 列里躺着版本号），101904 / 102704 的 6 行直接没了。
// 老的 2281 行是好的 —— 说明是「有人拿行对象按自己的列序塞进列存」，没跟 `k` 对齐。
//
// 修法：**以 client 那份（2293 行、行对象数组）为准整表重建**。列存只保留两样本该一致的东西，
// 所以重建完必须过三道闸：
//   1. 行数 = client 行数；
//   2. 重建后的老行（前 2281 行）与修复前逐格相同 —— 证明这次重建没有顺手改到别的字段；
//   3. 本批四条链的三档参数/状态/描述全部到位。
//
// 幂等：重建结果与现状一致时直接 `[skip]`（按渲染文本比对，不按对象比）。
const fs = require('fs');
const path = require('path');
const { readTable, writeTable, render } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');

/** 外部改写前的老行数（101904/102704 之前的状态）。 */
const SAFE_ROWS = 2281;

function main() {
    const client = readTable(CLIENT);
    const remote = readTable(REMOTE);
    if (client.mode !== 'rows') throw new Error('[fail] client 那份必须是行对象数组');
    if (remote.mode !== 'packed') throw new Error('[fail] remoteRef 那份必须是列存');

    const keys = remote.keys;
    const matrix = client.rows.map((row) => keys.map((name) => (name in row ? row[name] : null)));

    //  闸 2：前 SAFE_ROWS 行必须与现状逐格一致（现状里的老行是好的）。
    const before = remote.rows.map((row) => keys.map((name) => (name in row ? row[name] : null)));
    const shared = Math.min(before.length, SAFE_ROWS);
    for (let index = 0; index < shared; index += 1) {
        const a = JSON.stringify(before[index]);
        const b = JSON.stringify(matrix[index]);
        if (a !== b) {
            throw new Error(`[fail] 第 ${index} 行重建后会变（老行不该动）：\n  现在 ${a}\n  重建 ${b}`);
        }
    }

    const text = `{\r\n"k":${render(keys)},\r\n"v":${render(matrix)},\r\n"c":${remote.c}\r\n}`;
    if (fs.readFileSync(REMOTE, 'utf8') !== text) {
        writeTable(REMOTE, { mode: 'packed', keys, rows: matrix, c: remote.c });
        console.log('[ok] 已按 client 重建');
    } else {
        console.log('[skip] 磁盘内容已是重建结果');
    }

    //  闸 1 + 闸 3：回读（无论这次有没有真的写盘都要过一遍）
    const after = readTable(REMOTE);
    if (after.rows.length !== client.rows.length) {
        throw new Error(`[fail] 行数不一致：remoteRef ${after.rows.length} vs client ${client.rows.length}`);
    }
    const check = (chain, expect) => {
        const rows = after.rows.filter((row) => Number(row.skillChainId) === chain)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        if (rows.length !== 3) throw new Error(`[fail] ${chain} 应有 3 档，实际 ${rows.length}`);
        expect.forEach((item, index) => {
            const row = rows[index];
            if ((row.statusId ?? null) !== item.statusId) throw new Error(`[fail] ${chain} L${index + 1} statusId=${row.statusId}`);
            if (String(row.behaviorKey) !== item.behaviorKey) throw new Error(`[fail] ${chain} L${index + 1} behaviorKey`);
            if (Number(row.unlockHeroLevel) !== item.unlock) throw new Error(`[fail] ${chain} L${index + 1} 解锁等级`);
            if (Number(row.modifierId) !== item.modifierId) throw new Error(`[fail] ${chain} L${index + 1} modifierId`);
            if (!String(row.desc).startsWith(item.descHead)) throw new Error(`[fail] ${chain} L${index + 1} desc 不对`);
        });
    };
    check(101803, [
        { statusId: 'poison_venom_l1', behaviorKey: 'burst_aura', unlock: 9, modifierId: 94018031, descHead: '冷却 12 秒' },
        { statusId: 'poison_venom_l2', behaviorKey: 'burst_aura', unlock: 18, modifierId: 94018032, descHead: '冷却 12 秒' },
        { statusId: 'poison_venom_l3', behaviorKey: 'burst_aura', unlock: 27, modifierId: 94018033, descHead: '冷却 12 秒' },
    ]);
    check(101704, [
        { statusId: 'poison_bolt_l1', behaviorKey: 'trap_place', unlock: 9, modifierId: 94017041, descHead: '累计普攻 8 次' },
        { statusId: 'poison_bolt_l2', behaviorKey: 'trap_place', unlock: 18, modifierId: 94017042, descHead: '累计普攻 8 次' },
        { statusId: 'poison_bolt_l3', behaviorKey: 'trap_place', unlock: 27, modifierId: 94017043, descHead: '累计普攻 8 次' },
    ]);
    check(101904, [
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 12, modifierId: 94019041, descHead: '累计普攻 10 次' },
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 24, modifierId: 94019042, descHead: '累计普攻 10 次' },
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 36, modifierId: 94019043, descHead: '累计普攻 10 次' },
    ]);
    check(102704, [
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 12, modifierId: 94027041, descHead: '累计普攻 10 次' },
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 24, modifierId: 94027042, descHead: '累计普攻 10 次' },
        { statusId: null, behaviorKey: 'counter_self_buff', unlock: 36, modifierId: 94027043, descHead: '累计普攻 10 次' },
    ]);
    console.log(`[ok] remoteRef/pvpSkillPlan.json 已按 client 重建：${after.rows.length} 行，`
        + '老行逐格未变，四条本批链回读通过');
}

main();
