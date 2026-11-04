// 需求 2026-11-03（第 2 条）：「椰蛋战士的龙卷风技能的初始生成夹角要增加大 20°，更扩散一点，
// 特效的范围和预制大小整体缩小成 80%，同时碰撞范围要匹配」。
//
// 这份脚本只动**配表里能表达的那两件事**：
//
//   1. `pvpSkillPlan.skillParamJson.zoneSpreadDeg` 30 → 50
//      （L1/L2/L3 三档，modifierId 91005141 / 91005142 / 91005143）
//      `zoneSpreadDeg` 是**首尾两道的总夹角**：3 道时 30° ⇒ −15°/0°/+15°，
//      改成 50° ⇒ −25°/0°/+25°。需求里「增加约 20°」按总夹角口径 → +20。
//
//   2. `pvpSkill.areaRadius` 30 → 24（skillId 30831「椰蛋战士·暴风」）
//      半径 = `areaRadius × combatDistanceScale(0.3)` ⇒ 9 → 7.2 世界 px，正好 ×0.8，
//      与「预制大小缩到 80%」同步（视觉侧的 0.8 在 `ZCCombatEffectScale.ts` 里登记）。
//
// 两份磁盘格式都要写（口径见 `ref_table_io.js`）：列存 `assets/remoteRef/` + 行存转表产物。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const DEMO = path.resolve(__dirname, '../..');
const POW = path.resolve(DEMO, '..');

const PLAN_FILES = [
    path.join(DEMO, 'assets/remoteRef/pvpSkillPlan.json'),
    path.join(POW, 'doc/塔防数据配置/json/client/pvpSkillPlan.json'),
];
const SKILL_FILES = [
    path.join(DEMO, 'assets/remoteRef/pvpSkill.json'),
    path.join(POW, 'doc/塔防数据配置/json/client/pvpSkill.json'),
];

const STORM_MODIFIER_IDS = [91005141, 91005142, 91005143];
const OLD_SPREAD = 30;
const NEW_SPREAD = 50;

const STORM_SKILL_ID = 30831;
const OLD_RADIUS = 30;
const NEW_RADIUS = 24;

function fail(message) {
    console.error(`✖ ${message}`);
    process.exit(1);
}

/** 只改 `zoneSpreadDeg` 一个键，其余键与顺序原样保留。 */
function patchSpread(paramJson, modifierId) {
    if (typeof paramJson !== 'string' || !paramJson.trim()) {
        fail(`modifierId ${modifierId} 的 skillParamJson 不是字符串：${JSON.stringify(paramJson)}`);
    }
    const params = JSON.parse(paramJson);
    const current = params.zoneSpreadDeg;
    if (current === NEW_SPREAD) return { json: paramJson, changed: false };
    if (current !== OLD_SPREAD) {
        fail(`modifierId ${modifierId} 的 zoneSpreadDeg 期望 ${OLD_SPREAD}，实际 ${JSON.stringify(current)}`
            + ' —— 表被别处改过了，先确认现值再改这份脚本');
    }
    params.zoneSpreadDeg = NEW_SPREAD;
    return { json: JSON.stringify(params), changed: true };
}

function patchPlanFile(file) {
    const table = readTable(file);
    const seen = new Set();
    let changed = 0;
    table.rows = table.rows.map((row) => {
        if (!STORM_MODIFIER_IDS.includes(row.modifierId)) return row;
        seen.add(row.modifierId);
        const result = patchSpread(row.skillParamJson, row.modifierId);
        if (result.changed) changed += 1;
        return result.changed ? { ...row, skillParamJson: result.json } : row;
    });
    if (seen.size !== STORM_MODIFIER_IDS.length) {
        fail(`${file} 只找到 ${seen.size} 档暴风（${[...seen].join(',')}），预期 ${STORM_MODIFIER_IDS.length} 档`);
    }
    if (!changed) {
        console.log(`= ${file} 已是 ${NEW_SPREAD}°，跳过`);
        return;
    }
    writeTable(file, table);

    // 回读断言：三档必须是新值，且别的行一格没动。
    const after = readTable(file);
    for (const id of STORM_MODIFIER_IDS) {
        const row = after.rows.find((item) => item.modifierId === id);
        const params = JSON.parse(row.skillParamJson);
        if (params.zoneSpreadDeg !== NEW_SPREAD) fail(`${file} 回读 ${id} 仍是 ${params.zoneSpreadDeg}`);
        if (params.zoneCount !== 3) fail(`${file} 回读 ${id} zoneCount 被改坏：${params.zoneCount}`);
    }
    console.log(`✔ ${file} 三档 zoneSpreadDeg ${OLD_SPREAD} → ${NEW_SPREAD}（改动 ${changed} 行）`);
}

function patchSkillFile(file) {
    const table = readTable(file);
    const row = table.rows.find((item) => item.skillId === STORM_SKILL_ID);
    if (!row) fail(`${file} 里没有 skillId ${STORM_SKILL_ID}`);
    if (row.areaRadius === NEW_RADIUS) {
        console.log(`= ${file} areaRadius 已是 ${NEW_RADIUS}，跳过`);
        return;
    }
    if (row.areaRadius !== OLD_RADIUS) {
        fail(`${file} 的 areaRadius 期望 ${OLD_RADIUS}，实际 ${JSON.stringify(row.areaRadius)}`);
    }
    row.areaRadius = NEW_RADIUS;
    writeTable(file, table);
    const after = readTable(file).rows.find((item) => item.skillId === STORM_SKILL_ID);
    if (after.areaRadius !== NEW_RADIUS) fail(`${file} 回读 areaRadius 失败`);
    // 同行的其它字段不许被顺手改动。
    for (const key of ['name', 'mode', 'damageRate', 'durationSeconds', 'waves', 'effectPrefabPath']) {
        if (after[key] !== row[key] && key !== 'areaRadius') fail(`${file} ${key} 被改坏：${after[key]}`);
    }
    console.log(`✔ ${file} skillId ${STORM_SKILL_ID} areaRadius ${OLD_RADIUS} → ${NEW_RADIUS}`);
}

for (const file of PLAN_FILES) patchPlanFile(file);
for (const file of SKILL_FILES) patchSkillFile(file);
console.log('完成。');
