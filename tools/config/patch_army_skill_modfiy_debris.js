// 清掉 `armySkillLevelUp.modfiy` 里的**死引用**（指向 `pvpSkillPlan` 不存在的 modifierId）。
//
// 历史成因
// ────────
// 早期一条技能的「第二/第三属性」靠子链行承载，`modfiy` 里会同时列主链与子链修改器。
// 后来这些子链行被删/改（101601 由「暴击+攻速」改成「裂变爆炸」，102502 的 192502 从未落行），
// `modfiy` 却留在表里，于是 `tools/config/validate_skill_pipeline.mjs` 一直报
// `modfiy 引用不存在：94916011 …`，导表校验长期带红（MEMORY.md 里记的「常红两条」）。
//
// 2026-11-16 V5 起「同条多属性」改由 `skillParamJson` 的 `mix.<statId>.addRate` 承载
// （`ZCStatSchema.readZCSkillMixStats`），不再需要给尾巴造修改器行 ⇒ 这些死引用可以直接删，
// 运行时行为逐字不变（本来就解析不到任何行）。
//
// 幂等：只删集合里的 id，重复跑无副作用。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');

/** 101601 的旧攻速子链、102502 的旧攻速子链 —— 两边都没有对应计划行。 */
const DEAD = new Set([94916011, 94916012, 94916013, 94925021, 94925022, 94925023, 95817011, 95817012, 95817013]);

function strip(table) {
    let touched = 0;
    for (const row of table.rows) {
        if (!Array.isArray(row.modfiy)) continue;
        const kept = row.modfiy.filter((id) => !DEAD.has(Number(id)));
        if (kept.length === row.modfiy.length) continue;
        row.modfiy = kept;
        touched += 1;
    }
    return touched;
}

function main() {
    for (const directory of [REMOTE, CLIENT]) {
        const file = path.join(directory, 'armySkillLevelUp.json');
        const table = readTable(file);
        const touched = strip(table);
        if (touched) writeTable(file, table);
        console.log(`[ok] ${path.relative(ROOT, file)}：清理 ${touched} 行`);
    }
}

main();
