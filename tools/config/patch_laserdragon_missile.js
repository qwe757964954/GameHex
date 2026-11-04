// 需求 2026-11-03（第 2 条）：「追踪导弹…爆炸范围约 80px，范围伤害只有 50% 的伤害」。
//
// 只动 `pvpSkillPlan.skillParamJson` 里两个键（三档 101003「追踪导弹」，modifierId
// 94010031 / 94010032 / 94010033）：
//
//   1. `strikeSplashRadius` 100 → 80（爆炸范围从 100px 收到 80px；
//      视觉侧 `ZCCombatEffectScale.ts` 里爆炸 prefab 乘 80/225，同一个数）；
//   2. `strikeSplashDamageRate` 0.3333 / 0.4 / 0.375 → 0.5（三档统一「50% 伤害」）。
//
// 弹体/爆炸特效路径不在配表里 —— 那是**表现配置**，由 `ZCCombatEffectFlight.ts` 的
// `MISSILE_FX_BY_UNIT[68010]` 登记（与光束 `BEAM_BY_PREFAB_PATH` 同一口径），
// 所以这份脚本只改两个数值键，其它键与顺序原样保留。
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

const MISSILE_MODIFIER_IDS = [94010031, 94010032, 94010033];
const OLD_RADIUS = 100;
const NEW_RADIUS = 80;
const NEW_RATE = 0.5;

function fail(message) {
    console.error(`✖ ${message}`);
    process.exit(1);
}

/** 只改两个键，其余原样。 */
function patchParams(paramJson, modifierId) {
    if (typeof paramJson !== 'string' || !paramJson.trim()) {
        fail(`modifierId ${modifierId} 的 skillParamJson 不是字符串：${JSON.stringify(paramJson)}`);
    }
    const params = JSON.parse(paramJson);
    const radius = params.strikeSplashRadius;
    if (radius === NEW_RADIUS && params.strikeSplashDamageRate === NEW_RATE) {
        return { json: paramJson, changed: false };
    }
    if (radius !== OLD_RADIUS) {
        fail(`modifierId ${modifierId} 的 strikeSplashRadius 期望 ${OLD_RADIUS}，实际 ${JSON.stringify(radius)}`
            + ' —— 表被别处改过了，先确认现值再改这份脚本');
    }
    params.strikeSplashRadius = NEW_RADIUS;
    params.strikeSplashDamageRate = NEW_RATE;
    return { json: JSON.stringify(params), changed: true };
}

function patchPlanFile(file) {
    const table = readTable(file);
    const seen = new Set();
    let changed = 0;
    table.rows = table.rows.map((row) => {
        if (!MISSILE_MODIFIER_IDS.includes(row.modifierId)) return row;
        seen.add(row.modifierId);
        const result = patchParams(row.skillParamJson, row.modifierId);
        if (result.changed) changed += 1;
        return result.changed ? { ...row, skillParamJson: result.json } : row;
    });
    if (seen.size !== MISSILE_MODIFIER_IDS.length) {
        fail(`${file} 只找到 ${seen.size} 档追踪导弹（${[...seen].join(',')}），预期 ${MISSILE_MODIFIER_IDS.length} 档`);
    }
    if (!changed) {
        console.log(`= ${file} 已是 80px / 0.5，跳过`);
        return;
    }
    writeTable(file, table);

    const after = readTable(file);
    for (const id of MISSILE_MODIFIER_IDS) {
        const row = after.rows.find((item) => item.modifierId === id);
        const params = JSON.parse(row.skillParamJson);
        if (params.strikeSplashRadius !== NEW_RADIUS) fail(`${file} 回读 ${id} 半径仍是 ${params.strikeSplashRadius}`);
        if (params.strikeSplashDamageRate !== NEW_RATE) fail(`${file} 回读 ${id} 溅射倍率仍是 ${params.strikeSplashDamageRate}`);
        if (!(params.strikeCount >= 1)) fail(`${file} 回读 ${id} strikeCount 被改坏`);
    }
    console.log(`✔ ${file} 三档 splashRadius ${OLD_RADIUS}→${NEW_RADIUS}、splashDamageRate→${NEW_RATE}（改动 ${changed} 行）`);
}

for (const file of PLAN_FILES) patchPlanFile(file);
console.log('完成。');
