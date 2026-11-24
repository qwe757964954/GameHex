// 仙桃行者（68009）2026-11-23：大地之力首目标重击 + 重骑兵武将技换图。
//
// 三件事，两套磁盘格式（remoteRef 列存 + doc/client 行对象）必须同改
// （见 tools/config/ref_table_io.js 开头注释）：
//
//  1. pvpSkillPlan 94009041/42/43（大地之力三档）加两个键：
//     `quakeFirstRate`（首个命中目标改按 300/370/450% 结算）
//     `quakeRadius`（落点圆半径，逻辑 px = 54 ≈ 1.5 格）
//     —— 与既有的 `damageRate`（120/150/180%，穿透目标仍按它）`pierceCount: 99` 并存。
//  2. armySkillLevelUp 100904 三档 desc 补上重击口径（卡牌 UI 真读这一份）。
//  3. pvpSkill 36241「重骑兵武将技」的 effectPrefabPath 换成仙桃行者_重击技能
//     —— 全表只有它一处在用【重骑兵_武将技能】。
//
// 🔴 30844（大地之力那一行的 pvpSkill）**不动**：它的 `重骑兵_践踏` 是「波动」的表现，
// 需求写的是「其他的效果保持不变」；而且强化那一击的表现本来就取普攻行（定案 A），
// 这一格现在并不参与播放，改它只会让后人误以为改这个能换图。
const { readTable, writeTable } = require('./ref_table_io.js');

const QUAKE_FX = 'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能';

//  档位 → 首目标倍率 / 描述尾句。倍率写进 skillParamJson，尾句进两份 desc。
const PLAN_LEVELS = {
    94009041: { rate: 3, tail: '120%伤害；首个命中的敌人改为300%重击，落点范围内的敌人受到同等伤害', base: '120%伤害' },
    94009042: { rate: 3.7, tail: '150%伤害，波动宽度提高20%；首个命中的敌人改为370%重击，落点范围内的敌人受到同等伤害', base: '150%伤害，波动宽度提高20%' },
    94009043: { rate: 4.5, tail: '180%伤害，波动宽度提高30%；首个命中的敌人改为450%重击，落点范围内的敌人受到同等伤害', base: '180%伤害，波动宽度提高30%' },
};
const QUAKE_RADIUS = 54;
//  `armySkillLevelUp` 用 `skilllevel` 1/2/3 分档，与 `pvpSkillPlan.modifierId` 末位一一对应。
const LEVEL_SPECS = [PLAN_LEVELS[94009041], PLAN_LEVELS[94009042], PLAN_LEVELS[94009043]];

const TABLES = [
    'assets/remoteRef',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client',
];

function rewritePlan(table, path) {
    const hits = [];
    for (const row of table.rows) {
        const spec = PLAN_LEVELS[row.modifierId];
        if (!spec) continue;
        const params = JSON.parse(row.skillParamJson);
        if (params.damageRate == null) throw new Error(`${path} ${row.modifierId} 缺 damageRate，拒绝改`);
        params.quakeFirstRate = spec.rate;
        params.quakeRadius = QUAKE_RADIUS;
        row.skillParamJson = JSON.stringify(params);
        const desc = `重踏地面，大地向前波动，对击中敌人造成${spec.tail}`;
        hits.push(`${row.modifierId} L${row.skillLevel}: ${row.desc} -> ${desc}`);
        row.desc = desc;
    }
    if (hits.length !== Object.keys(PLAN_LEVELS).length) {
        throw new Error(`${path} 计划行只命中 ${hits.length}/${Object.keys(PLAN_LEVELS).length} 行，拒绝写入`);
    }
    return hits;
}

function rewriteLevelUp(table, path) {
    const hits = [];
    for (const row of table.rows) {
        if (String(row.id) !== '100904') continue;
        const spec = LEVEL_SPECS[Number(row.skilllevel) - 1];
        if (!spec) throw new Error(`${path} 100904 出现非法 skilllevel=${row.skilllevel}`);
        if (!/重踏地面/.test(String(row.desc))) throw new Error(`${path} 100904 的 desc 不是大地之力，拒绝改`);
        const desc = `重踏地面，大地向前波动，对击中敌人造成${spec.tail}`;
        hits.push(`100904 L${row.skilllevel}: ${row.desc} -> ${desc}`);
        row.desc = desc;
    }
    if (hits.length !== 3) throw new Error(`${path} armySkillLevelUp 只命中 ${hits.length}/3 行，拒绝写入`);
    return hits;
}

function rewriteSkill(table, path) {
    const hits = [];
    for (const row of table.rows) {
        if (row.skillId !== 36241) continue;
        hits.push(`36241 ${row.name}: ${row.effectPrefabPath} -> ${QUAKE_FX}`);
        row.effectPrefabPath = QUAKE_FX;
    }
    if (hits.length !== 1) throw new Error(`${path} pvpSkill 只命中 ${hits.length}/1 行，拒绝写入`);
    return hits;
}

const JOBS = [
    ['pvpSkillPlan.json', rewritePlan],
    ['armySkillLevelUp.json', rewriteLevelUp],
    ['pvpSkill.json', rewriteSkill],
];

for (const dir of TABLES) {
    for (const [name, rewrite] of JOBS) {
        const path = `${dir}/${name}`;
        const table = readTable(path);
        const hits = rewrite(table, path);
        writeTable(path, table);
        console.log(`[ok] ${path}`);
        hits.forEach((line) => console.log('     ' + line));
    }
}
