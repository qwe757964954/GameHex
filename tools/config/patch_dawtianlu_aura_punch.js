// 2026-11-10 68025「大威天芦」两处技能参数（只写两份 json，源表由同名 `_excel.py` 改）：
//
//  1. 「无尘禁土」（plan 94025051~53，`self_aura`）的 `auraRadius` 60 → **200**。
//     需求：「技能判定范围和特效大小统一放大成 200px」。
//     `auraRadius` 是**逻辑 px**（世界半径 = 值 × `combatDistanceScale` 0.3），
//     与 30831 / 36251 的 `areaRadius`、导弹的 `strikeSplashRadius` 同一套数。
//     三档原本都是 60（1/2/3 级只差持续时间与每秒伤害），所以三档一起改成 200。
//     视觉侧配套：`ZCCombatEffectScale.NODE_SCALE_BY_PREFAB_PATH` 里
//     `持续光环伤害效果` = 1.2（256 × 1.2 = 307.2 屏上 ≈ 200 逻辑 px 的直径 307.5）。
//
//  2. 「天降神拳」（plan 94025041~43，`active_attack`）的 `projectileLifeSeconds` 4 → **3**。
//     需求：「子弹大小改大 2.5 倍，持续时间缩短 1 秒」。
//     前半句是纯视觉（`ZCCombatEffectScale` 里 `大拳飞冲子弹类特效` = 2.5），
//     后半句就是这个固定寿命：`ZCAttackResolutionSystem` 里
//     `projectileLifeSeconds` 有值时子弹不按射程算飞行时间，而是**活满这个秒数**
//     （穿透 4/6/8 次全靠它撑），所以 4 → 3 会让同一发拳打到的纵深少一截，属数值改动。
//
// 两份磁盘格式都要写（`ref_table_io.js` 的约定）：
//   · `assets/remoteRef/*.json` —— 列存竖排；
//   · `doc/塔防数据配置/json/client/*.json` —— 转表产物（紧凑行数组）。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];

/** modifierId → 要覆盖的 `skillParamJson` 字段与「改前」值（对不上就拒绝覆盖）。 */
const EDITS = {
    94025051: [{ field: 'auraRadius', before: 60, after: 200 }],
    94025052: [{ field: 'auraRadius', before: 60, after: 200 }],
    94025053: [{ field: 'auraRadius', before: 60, after: 200 }],
    94025041: [{ field: 'projectileLifeSeconds', before: 4, after: 3 }],
    94025042: [{ field: 'projectileLifeSeconds', before: 4, after: 3 }],
    94025043: [{ field: 'projectileLifeSeconds', before: 4, after: 3 }],
};

/**
 * 在 `skillParamJson` 的**原文**里定点替换一个数值，其余字节原样保留。
 *
 * ⚠️ 不能 `JSON.parse` 再 `stringify`：那会把 `3.0` 写成 `3`、`0.30` 写成 `0.3`
 *    —— 数值等价，但源表是给人看的，`damageRate` 一列突然全变成整型很像被脚本刷过，
 *    而且 diff 会从一个键扩成整串。这里只动要改的那一个 token。
 */
function replaceNumber(raw, field, before, after) {
    const pattern = new RegExp(`("${field}"\\s*:\\s*)${String(before).replace('.', '\\.')}(?=\\s*[,}])`);
    const hit = raw.match(pattern);
    if (!hit) {
        throw new Error(`[fail] skillParamJson 里找不到 ${field}=${before}：${raw}`);
    }
    //  重复出现（同一串里两遍）说明表里有脏数据，宁可报错也不猜哪个是要改的。
    if (raw.match(new RegExp(pattern.source, 'g')).length !== 1) {
        throw new Error(`[fail] skillParamJson 里 ${field}=${before} 出现不止一次：${raw}`);
    }
    return raw.replace(pattern, `$1${after}`);
}

for (const path of TABLES) {
    const table = readTable(path);
    const touched = [];
    for (const row of table.rows) {
        const edits = EDITS[Number(row.modifierId)];
        if (!edits) continue;
        const raw = row.skillParamJson;
        if (!raw) throw new Error(`[fail] ${path} 里 ${row.modifierId} 的 skillParamJson 是空的`);
        //  改前先整体核一遍：任何一个字段对不上就整行不改（避免半改）。
        const parsed = JSON.parse(raw);
        for (const edit of edits) {
            if (Number(parsed[edit.field]) !== edit.before) {
                throw new Error(`[fail] ${path} ${row.modifierId}.${edit.field} 现在是 ${parsed[edit.field]}，`
                    + `与预期 ${edit.before} 不符，拒绝覆盖`);
            }
        }
        let next = raw;
        for (const edit of edits) next = replaceNumber(next, edit.field, edit.before, edit.after);
        row.skillParamJson = next;
        touched.push(`${row.modifierId}(${row.skillName} L${row.skillLevel})`);
    }
    if (touched.length !== Object.keys(EDITS).length) {
        throw new Error(`[fail] ${path} 只改到 ${touched.length} 行，预期 ${Object.keys(EDITS).length} 行`);
    }
    writeTable(path, table);

    // 回读校验
    const back = readTable(path);
    for (const [id, edits] of Object.entries(EDITS)) {
        const row = back.rows.find((item) => Number(item.modifierId) === Number(id));
        const params = JSON.parse(row.skillParamJson);
        for (const edit of edits) {
            if (Number(params[edit.field]) !== edit.after) {
                throw new Error(`[fail] 回读 ${path} ${id}.${edit.field} 是 ${params[edit.field]}，预期 ${edit.after}`);
            }
        }
    }
    console.log(`[pvpSkillPlan] ${path}：${touched.join(' / ')}`);
}
