// 镭射飞龙（68010）的普攻 / 镭射死光改用专属光束预制体（2026-10-31）。
//
// 改前：30719「镭射飞龙普攻」与 30845「镭射死光」都借 `units/projectiles/风法师_绿风/风法师_绿风`
//       （8 帧青色月牙），落地时是一条通用短线，与设计案「使用【镭射飞龙的普通攻击】，线的朝向目标」不符。
// 改后：两条都指向 `units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻`（19 帧横躺光束，
//       锚点在左端 = 发射口）。`ZCBeamEffect.ts` 按这个路径认出"这是光束"，
//       于是改成「发射口 → 弹头」的连线，长度靠拉伸同一份预制体实现（101004 的贯穿全场也是它）。
//
// 只改 `effectPrefabPath`，不动 `projectileSpeed`（设计案写死弹速 500）与任何数值。
const { readTable, writeTable } = require('./ref_table_io.js');

const BEAM_PATH = 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻';
const SKILL_IDS = [30719, 30845];   // 普攻 / 镭射死光（强化那一击）

const TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const changes = [];
    for (const skillId of SKILL_IDS) {
        const row = table.rows.find((item) => Number(item.skillId) === skillId);
        if (!row) throw new Error(`${path} 里找不到技能 ${skillId}`);
        if (row.effectPrefabPath === BEAM_PATH) continue;
        changes.push(`${skillId} ${row.name}：${row.effectPrefabPath} → ${BEAM_PATH}`);
        row.effectPrefabPath = BEAM_PATH;
    }

    // 守卫：这两条必须是 projectile，否则光束根本不会触发（视图只认 projectile 事件）。
    for (const skillId of SKILL_IDS) {
        const row = table.rows.find((item) => Number(item.skillId) === skillId);
        if (row.mode !== 'projectile') throw new Error(`${skillId} 不是 projectile：${row.mode}`);
        if (row.effectPrefabPath !== BEAM_PATH) throw new Error(`${skillId} 路径没写进去`);
    }

    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）改 ${changes.length} 行`);
    changes.forEach((line) => console.log('   ', line));
}
