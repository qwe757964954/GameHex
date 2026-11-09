// 雷电系普攻换「新雷弹」两件套（2026-11-06）。
//
// 背景：美术 11-06 把 `雷弹攻击`（120×81 单帧电池弹体）与 `雷弹命中`（9 帧金色电弧爆发）
// 的散帧丢进了 assets/bundles/battle/units/projectiles/ 下，只有 PNG、没有 prefab。
// 预制由 tools/build_leidan_fx.py 补齐。
//
// 只改一行：pvpSkill 30231「雷法师普攻」——
//   · effectPrefabPath       → units/projectiles/雷弹攻击/雷弹攻击
//   · impactEffectPrefabPath → units/projectiles/雷弹命中/雷弹命中
//
// 为什么只改 30231：它是 68016 萨尔 / 68022 雷蕉 两张卡共用的普攻行（pvpCard.unitSkillId = 30231），
// 也是全表唯一一个「用雷电美术出弹」的普攻行。改成这一行 = 两张卡的普攻同时换新弹体，不用动卡表。
//
// 刻意不改的两行：
//   · 36231「雷法师武将技」用 `雷法师_武将闪电`——设计案【表现资源映射】P9 明确写「沿用」；
//   · 30717「杰克藕普攻」的命中仍是 `磁电菇_子弹命中`（蓝色电爆）——杰克藕是「带电箭」，
//     雷弹命中是金色电弧，颜色对不上；蓝色电爆才和箭身的雷法师_雷电同色系。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
    'assets/remoteRef/pvpSkill.json',
];

const SKILL_ID = 30231;
const CHANGES = {
    effectPrefabPath: 'units/projectiles/雷弹攻击/雷弹攻击',
    impactEffectPrefabPath: 'units/projectiles/雷弹命中/雷弹命中',
};

for (const path of TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row) throw new Error(`${path} 里找不到技能 ${SKILL_ID}`);
    for (const [field, value] of Object.entries(CHANGES)) {
        if (!(field in row) && table.mode !== 'rows') throw new Error(`${path} 里 ${SKILL_ID} 没有字段 ${field}`);
        row[field] = value;
    }
    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）30231 → ${CHANGES.effectPrefabPath} + ${CHANGES.impactEffectPrefabPath}`);
}
