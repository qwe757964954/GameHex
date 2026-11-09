// 椰蛋战士（68005）「暴风」100504 逻辑调整（2026-11-07）。
//
// 需求原话：
//   1. 三个飓风生成位置是从椰蛋战士的坐标
//   2. 生成后由小变大到当前的大小，以椰蛋战士的攻击朝向为法线，3 个飓风夹角为 50°，
//      飓风以 100px 的速度移动 3s，每个飓风根据技能 1/2/3 等级最多分别对 3/4/5 个敌人造成伤害，
//      伤害次数达到上限后对应的飓风提前消失
//   3. 修改完成要同步相关的配置
//
// 逐条落点：
//   ① 生成位置 —— **已经是**椰蛋战士坐标（`strideTargets → sendAttack` 里
//      `from = context.unitPosition(unit)`，moving 分支 `x/y = from.x/from.y`）。不需要改代码，
//      本次只补一条用例把它钉住。
//   ② 由小变大 —— 新增 `zoneGrowSeconds`：区域的首拍推一条长效表现事件（`zoneHoldVisual`），
//      视图按 `growSeconds` 把缩放从 0 缓出到 1。最终大小仍由 prefab 烘焙缩放决定。
//      夹角基准改成 `unit.facingRadians`（攻击朝向），`zoneSpreadDeg` 50（总夹角）。
//   ③ 100px / 3s / 3-4-5 个 —— 全部是表值：`zoneMoveSpeed: 100`、`zoneDuration: 3`、
//      `zoneMaxHits: 3/4/5`（后两项原本就是 3/4/5，不改）。
//      「打满上限后这个飓风提前消失」是 `ZCGroundZoneSystem.tick` 里逐 zone 判定的既有行为
//      （`hitUnitIds.length >= maxHits → remainingSeconds = 0`），三条互不影响。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const UNIT = '68005';
const CHAIN = 100504;

/** 三档：只有 `zoneMaxHits` / `damageRate` 随等级变，其余完全一致。 */
const LEVELS = [
    { level: 1, maxHits: 3, damageRate: 0.8 },
    { level: 2, maxHits: 4, damageRate: 1 },
    { level: 3, maxHits: 5, damageRate: 1.2 },
];

//  键序固定：老的在前、这次新增的两个在后 —— 与旧 JSON 的插值顺序一致，diff 只落在真改动的值上。
function paramsFor(entry) {
    return JSON.stringify({
        zoneCount: 3,
        zoneSpreadDeg: 50,        // 改：30 → 50（总夹角）
        zoneMoveSpeed: 100,       // 改：70 → 100（表值 px/s，运行时 × combatDistanceScale）
        zoneDuration: 3,          // 改：L2/L3 由 4 → 3（三档统一 3 秒）
        zoneWaveInterval: 0.15,
        zoneMaxHits: entry.maxHits,   // 3 / 4 / 5（原本就是这个口径）
        damageRate: entry.damageRate, // 0.8 / 1 / 1.2（不变）
        zoneHoldVisual: 1,        // 新：整段一条长效视觉，才有可能「由小变大」
        zoneGrowSeconds: 0.3,     // 新：入场生长时长
    });
}

const DESC = [
    '每5次普攻向攻击朝向放出3道旋风（夹角50°），持续3秒，沿路径最多对3个敌人造成80%伤害',
    '每5次普攻向攻击朝向放出3道旋风（夹角50°），持续3秒，沿路径最多对4个敌人造成100%伤害',
    '每5次普攻向攻击朝向放出3道旋风（夹角50°），持续3秒，沿路径最多对5个敌人造成120%伤害',
];

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
    const level = Number(row.skillLevel);
    const entry = LEVELS.find((item) => item.level === level);
    if (!entry) return row;
    const next = {
        ...row,
        skillParamJson: paramsFor(entry),
        //  行级 `durationSeconds` 是描述用的时长列，L2/L3 原为 4，与新区间 3 秒对齐。
        durationSeconds: 3,
        desc: DESC[level - 1],
    };
    console.log(`  · 100504 L${level}: 夹角 30→50 / 速度 70→100 / 时长 ${row.durationSeconds}→3 / 名额 ${entry.maxHits}（不变）`);
    return next;
}));

//  自查：三档读回来是不是期望值。
const rows = readTable(DOC + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN)
    .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
for (const row of rows) {
    const params = JSON.parse(row.skillParamJson);
    console.log(`[check] L${row.skillLevel} 夹角=${params.zoneSpreadDeg} 速度=${params.zoneMoveSpeed} `
        + `时长=${params.zoneDuration} 名额=${params.zoneMaxHits} 伤害=${params.damageRate} `
        + `持有=${params.zoneHoldVisual} 生长=${params.zoneGrowSeconds}`);
}
