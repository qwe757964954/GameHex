// 火焰树妖（68003）灼热地带落地：
//   1) pvpSkill 新增 30811「树妖·灼热地带」—— mode=area，命中在目标坐标建持续区域；
//   2) 30711（火焰树妖普攻）的 empoweredEvery 10 → 6，empoweredSkillId 36181 → 30811。
//
// 36181 是「火法师武将技」（火船），树妖原先每 10 次普攻都在放火法师的技能 —— 这一步把它摘掉。
// trigger 保持 every_n_attacks：`consumeEmpoweredAttack` 只在 trigger!=='every_seconds' 时读
// empoweredEvery，改 cooldown 是无效的。
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_ID = 30811;
const NEW_ROW = {
    skillId: SKILL_ID,
    name: '树妖·灼热地带',
    mode: 'area',
    projectileKey: '',
    projectileSpeed: 0,
    areaRadius: 60,             // 表值 × combatDistanceScale(0.3) = 世界半径；沿用冰雕/龙卷风口径
    empoweredEvery: 0,
    empoweredSkillId: 0,
    effectPrefabPath: 'units/projectiles/火法师_火船/火法师_火船', // 复用火船，橙红调天然契合
    cooldown: 0,
    effectKey: '',
    trigger: null,
    damageRate: 0.35,           // L1 基准；L2/L3 由 pvpSkillPlan.skillParamJson.damageRate 覆盖
    durationSeconds: 5,         // 三级统一 5 秒（L3 不再拉长）
    waves: 5,                   // 每秒 1 波
    slowRatio: null,
    onHitStatusId: null,
};

const TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const base = table.rows.find((row) => row.skillId === 30711);
    if (!base) throw new Error(`${path} 找不到 30711`);

    const before = `${base.empoweredEvery} -> ${base.empoweredSkillId}`;
    base.empoweredEvery = 6;
    base.empoweredSkillId = SKILL_ID;

    const existing = table.rows.find((row) => row.skillId === SKILL_ID);
    if (existing) {
        Object.assign(existing, NEW_ROW);
        console.log(`[更新] ${path} 30811 已存在，已覆盖为最新值`);
    } else {
        table.rows.push({ ...NEW_ROW });
        console.log(`[新增] ${path} 30811 树妖·灼热地带`);
    }
    console.log(`[改]   30711 empoweredEvery/empoweredSkillId: (${before}) -> (6 -> ${SKILL_ID})`);

    writeTable(path, table);
    console.log(`[ok]   ${path} (${table.mode}) 共 ${table.rows.length} 行`);
}
