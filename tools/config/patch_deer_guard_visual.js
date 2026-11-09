// 鹿神守护（103405 / pvpSkill 30854）接上「小鹿 + 上层循环火特效」（2026-11-07）。
//
// 需求原话：
//   「小鹿模型本体使用【魔术师召唤鹿】的预制，在小鹿冲刺的整个阶段都需要循环播放
//     【火法师火船】特效，且该特效节点在小鹿的上层，小鹿冲刺结束后所有特效同步消失。」
//
// 两处配置 + 一个开关：
//   1. `pvpSkill 30854.effectPrefabPath` 指向新做的复合预制 `units/projectiles/鹿神守护/鹿神守护`
//      （小鹿 spine 在下、火法师_火船 loop 在上，见 tools/build_deer_guard_fx.py）；
//   2. `pvpSkillPlan 103405` 三档补 `zoneHoldVisual: 1` —— 让区域只推**一条**跟着自己走的长效
//      表现事件，而不是按 0.15s 一波在路径上闪成一串残影。
//
// 为什么用 `zoneHoldVisual` 而不是直接改区域系统的默认行为：
//   68005 椰蛋战士「暴风」也是移动区域（3 道 / 70px/s / 3~4s），它的「一串残影」是现役表现，
//   这次需求没提它。默认改成整段持有会顺带改掉暴风的手感，所以做成按技能开启的开关，
//   要同步改暴风只需给它的 `skillParamJson` 也加 `"zoneHoldVisual": 1`，不动代码。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const ULT_SKILL = 30854;
const DEER_CHAIN = 103405;
const OLD_FX = 'units/projectiles/火法师_火船/火法师_火船';
const NEW_FX = 'units/projectiles/鹿神守护/鹿神守护';

function patchBoth(table, mutate) {
    for (const path of [DOC + table + '.json', REF + table + '.json']) {
        const source = readTable(path);
        const before = JSON.stringify(source.rows);
        source.rows = mutate(source.rows);
        if (JSON.stringify(source.rows) === before) {
            console.log(`[skip] ${path}（无变化）`);
            continue;
        }
        writeTable(path, source);
        console.log(`[ok] ${path}（${source.mode}）${source.rows.length} 行`);
    }
}

// ── 1. pvpSkill：30854 换成复合预制
patchBoth('pvpSkill', (rows) => rows.map((row) => {
    if (Number(row.skillId) !== ULT_SKILL) return row;
    console.log(`  · 30854 effectPrefabPath: ${row.effectPrefabPath} → ${NEW_FX}`);
    return { ...row, effectPrefabPath: NEW_FX };
}));

// ── 2. pvpSkillPlan：103405 三档补 zoneHoldVisual
patchBoth('pvpSkillPlan', (rows) => rows.map((row) => {
    if (String(row.unitId) !== '68034' || Number(row.skillChainId) !== DEER_CHAIN) return row;
    const params = JSON.parse(row.skillParamJson || '{}');
    if (params.zoneHoldVisual === 1) return row;
    params.zoneHoldVisual = 1;
    console.log(`  · 103405 L${row.skillLevel} zoneHoldVisual=1`);
    return { ...row, skillParamJson: JSON.stringify(params) };
}));

// ── 3. 自查：旧路径不该再有技能引用（除了本脚本自己的注释）
const skill = readTable(DOC + 'pvpSkill.json').rows
    .filter((row) => row.effectPrefabPath === OLD_FX)
    .map((row) => row.skillId);
console.log(`\n[check] 仍指向 ${OLD_FX} 的技能：${skill.length ? skill.join(',') : '无'}`);
