// 2026-11-10 两份 PVP 配表的数值改动（只写 json 的两份副本，源表由同名 .py 脚本改）：
//
//  1. `pvpSkill` 30831「椰蛋战士·暴风」的 `areaRadius` 30 → 26。
//     上一轮把特效宿主倍率从 0.8 收到 0.7 时只改了视觉，判定半径没跟 ——
//     这一轮按 30 × 0.7 / 0.8 = 26 同步，让「看着多大就打多大」。
//  2. `pvpUnitGrowth` 补 68025「大威天芦」1~25 级。
//     ⚠️ 2026-11-10 已失效，不要再跑：成长表改由 `patch_growth_from_card_level_up.js`
//        按 `cardLevelUp` 全量重算 1~50 级，比例列一律归 0 —— 下面这条 8%/级 的
//        `attackRate` 曲线被取代（守卫会因「已有 50 级」直接报错，属预期）。
//     曲线口径来自 `技能设计案2.xlsx / 伤害参数`：B3 = 每级成长率 8%，
//     A21:B45 = 兵种等级 L 的攻击系数 1 + 8% × L（L1 = 1.08 … L25 = 3.00）。
//     `pvpUnitGrowth.attackRate` 就是那个「加成部分」⇒ 0.08 × L。
//     生命沿用同一比例（与表里已有的 68001 四行「攻守同率」一致），
//     因为设计案只给了伤害成长，生命成长没有任何依据可查 —— 这是本表唯一的推断项。
//
// 两份磁盘格式都要写（`ref_table_io.js` 的约定）：
//   · `assets/remoteRef/*.json` —— 列存竖排；
//   · `doc/塔防数据配置/json/client/*.json` —— 转表产物（紧凑行数组）。
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];
const GROWTH_TABLES = [
    'assets/remoteRef/pvpUnitGrowth.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpUnitGrowth.json',
];

const STORM_SKILL_ID = 30831;
const STORM_RADIUS_BEFORE = 30;
const STORM_RADIUS_AFTER = 26;

const UNIT_ID = '68025';
const MAX_LEVEL = 25;
/** 每级成长率：`技能设计案2 / 伤害参数!B3 = 0.08`（= 8%）。 */
const GROWTH_RATE_PER_LEVEL = 0.08;

function round2(value) {
    return Math.round(value * 100) / 100;
}

// ── 1) pvpSkill：只动 30831 的 areaRadius ────────────────────────────────────
for (const path of SKILL_TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.skillId) === STORM_SKILL_ID);
    if (!row) throw new Error(`[fail] ${path} 里找不到 skillId=${STORM_SKILL_ID}`);
    const before = Number(row.areaRadius);
    if (before !== STORM_RADIUS_BEFORE) {
        throw new Error(`[fail] ${path} 现半径是 ${before}，与预期 ${STORM_RADIUS_BEFORE} 不符，拒绝覆盖`);
    }
    row.areaRadius = STORM_RADIUS_AFTER;
    writeTable(path, table);
    const check = readTable(path).rows.find((item) => Number(item.skillId) === STORM_SKILL_ID);
    if (Number(check.areaRadius) !== STORM_RADIUS_AFTER) {
        throw new Error(`[fail] ${path} 回读校验失败：${check.areaRadius}`);
    }
    console.log(`[pvpSkill] ${path}：30831 areaRadius ${before} → ${check.areaRadius}`);
}

// ── 2) pvpUnitGrowth：补 68025 的 1~25 级 ───────────────────────────────────
const growthRows = [];
for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const rate = round2(GROWTH_RATE_PER_LEVEL * level);
    growthRows.push({
        unitId: UNIT_ID,
        level,
        attackFlat: 0,
        attackRate: rate,
        maxHpFlat: 0,
        maxHpRate: rate,
        moveSpeedRate: 0,
        attackRangeFlat: 0,
        enabled: 1,
    });
}

for (const path of GROWTH_TABLES) {
    const table = readTable(path);
    const existing = table.rows.filter((row) => String(row.unitId) === UNIT_ID);
    if (existing.length) {
        throw new Error(`[fail] ${path} 已经有 ${UNIT_ID} 的 ${existing.length} 行，拒绝重复追加`);
    }
    table.rows.push(...growthRows);
    writeTable(path, table);
    const rows = readTable(path).rows.filter((row) => String(row.unitId) === UNIT_ID);
    if (rows.length !== MAX_LEVEL) throw new Error(`[fail] ${path} 回读只有 ${rows.length} 行`);
    const top = rows.find((row) => Number(row.level) === MAX_LEVEL);
    if (Number(top.attackRate) !== 2) throw new Error(`[fail] ${path} 25 级加成 ${top.attackRate}，预期 2`);
    console.log(`[pvpUnitGrowth] ${path}：追加 ${UNIT_ID} ${rows.length} 行（L1 +8% … L25 +200%）`);
}
