// 鹿神守护（103405）「先走近、再冲刺」（2026-11-07）。
//
// 需求原话：
//   1. 魔术师召唤的小鹿初始位置需要在魔术师前进方向距离魔术师 30px 的位置；
//   2. 小鹿生成后先以 70px 速度移动，并播放对应的移动动画，接近攻击目标 200px 再播放冲刺，
//      现在是直接在目标处生成。
//
// 三个新参数（**全部是表值 px，运行时乘 `combatDistanceScale` 换世界坐标**，
// 与 `attackRange` / `areaRadius` / `zoneMoveSpeed` 同一套口径）：
//
//   `zoneSpawnForward`  30  出生点沿施法者朝向（`unit.facingRadians`）前移多少
//   `zoneApproachSpeed` 70  「接近段」速度；给了它才进两段式移动
//   `zoneSprintRange`  200  与目标的距离 ≤ 它就转冲刺（冲刺速度仍用既有的 `zoneMoveSpeed` 140）
//
// 为什么这三件事不做成代码常量：数字是策划口径，后面调手感只会改表；代码只负责
// 「有没有 `zoneApproachSpeed`」这一个开关 —— 缺省 0 ⇒ 一出生就冲（暴风 / 既有移动区域逐字不变）。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const UNIT = '68034';
const CHAIN = 103405;

/** 三档共用同一套位移口径，只有 `damageRate` 随等级变（保持不变）。 */
const APPROACH = { zoneSpawnForward: 30, zoneApproachSpeed: 70, zoneSprintRange: 200 };

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

patchBoth('pvpSkillPlan', (rows) => rows.map((row) => {
    if (String(row.unitId) !== UNIT || Number(row.skillChainId) !== CHAIN) return row;
    const params = JSON.parse(row.skillParamJson || '{}');
    //  键序：老键原样在前，三个新键按「出生 → 接近 → 转段」的顺序追加在后面，
    //  这样 diff 只落在真改动的值上（与 patch_yedan_storm_zone.js 同一习惯）。
    const next = { ...params, ...APPROACH };
    if (JSON.stringify(next) === JSON.stringify(params)) return row;
    console.log(`  · 103405 L${row.skillLevel} 补 ${JSON.stringify(APPROACH)}`);
    return { ...row, skillParamJson: JSON.stringify(next) };
}));

// 自查：三档都得带齐三个键，且冲刺速度没被顺手改掉。
const rows = readTable(REF + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN);
for (const row of rows) {
    const params = JSON.parse(row.skillParamJson);
    const missing = Object.keys(APPROACH).filter((key) => params[key] !== APPROACH[key]);
    console.log(`[check] L${row.skillLevel} 缺/错：${missing.length ? missing.join(',') : '无'}`
        + ` | 冲刺 zoneMoveSpeed=${params.zoneMoveSpeed} zoneDuration=${params.zoneDuration}`);
}
