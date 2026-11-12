// 磁电菇（68016）「磁电冲击」101604：跟随角色移动、固定在角色身前（2026-11-12）。
//
// 用户口径：「68016 的磁电冲击技能应该跟随角色一起移动，固定在角色身前，
//            将技能描述同步修改到源表，以及技能设计案」。
//
// 之前是**站桩**（`auraFollow = 0`）：光束按施法那一刻的位置与朝向定死，角色走开就错位
// （截图里角色已经走到光束右上方，光束还留在原地）。
//
// 改动：
//   `auraFollow` 0 → 1      开跟随；落点由 `ZCGroundZoneSystem.followCaster` 每帧算成
//                           「本体坐标 + 朝向前移 `auraForward`」，并同步刷新 `angleDegrees`
//   `auraForward` 不动       仍然 = `auraRadius`（160/180/200）⇒ 光束左缘永远压在本体脚下
//   其余参数不动             3 秒 / 每秒 1 波 / 每波最多 5 人 / 宽 108 / 抬升 30
//
// 描述两处都改（`pvpSkillPlan.desc` 是 PVP 技能案读的那份，`armySkillLevelUp.desc` 是
// 卡片升级面板读的那份），各表保留自己原有的用词与空格习惯，只插入「跟随」那半句。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const CHAIN = 101604;

/** 旧句 → 新句（两个表各一份，空格习惯不同）。必须真的命中，命中不了直接报错。 */
const DESC_EDITS = [
    ['持续 3 秒、每秒', '持续 3 秒，全程跟随角色移动、固定在角色身前，每秒'],
    ['持续3秒、每秒', '持续3秒，全程跟随角色移动、固定在角色身前，每秒'],
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

/** 只在「本行确实是磁电冲击、且旧句还在」时替换；已经换过的（重跑）原样返回。 */
function rewriteDesc(desc, level) {
    for (const [from, to] of DESC_EDITS) {
        if (desc.includes(from)) return desc.replace(from, to);
    }
    if (desc.includes('跟随角色移动')) return desc;
    throw new Error(`L${level} 描述里既没有旧句也没有新句，拒绝对它动刀：${desc}`);
}

patchBoth('pvpSkillPlan', (rows) => rows.map((row) => {
    if (String(row.unitId) !== '68016' || Number(row.skillChainId) !== CHAIN) return row;
    const params = JSON.parse(row.skillParamJson || '{}');
    if ((params.auraFollow ?? 1) === 1 && row.desc.includes('跟随角色移动')) return row;
    const next = { ...params, auraFollow: 1 };
    const desc = rewriteDesc(String(row.desc), row.skillLevel);
    console.log(`  · pvpSkillPlan 101604 L${row.skillLevel} auraFollow=1`);
    return { ...row, skillParamJson: JSON.stringify(next), desc };
}));

patchBoth('armySkillLevelUp', (rows) => rows.map((row) => {
    if (Number(row.id) !== CHAIN) return row;
    const desc = rewriteDesc(String(row.desc), row.skilllevel);
    if (desc === row.desc) return row;
    console.log(`  · armySkillLevelUp 101604 L${row.skilllevel} 描述已重写`);
    return { ...row, desc };
}));

// 自查：三档都必须 auraFollow=1、`auraForward` 仍等于 `auraRadius`、两份 JSON 逐字一致。
const refPlan = readTable(REF + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === '68016' && Number(row.skillChainId) === CHAIN);
const docPlan = readTable(DOC + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === '68016' && Number(row.skillChainId) === CHAIN);
const refArmy = readTable(REF + 'armySkillLevelUp.json').rows.filter((row) => Number(row.id) === CHAIN);
const docArmy = readTable(DOC + 'armySkillLevelUp.json').rows.filter((row) => Number(row.id) === CHAIN);
for (const row of refPlan) {
    const params = JSON.parse(row.skillParamJson);
    const docRow = docPlan.find((item) => Number(item.skillLevel) === Number(row.skillLevel));
    const army = refArmy.find((item) => Number(item.skilllevel) === Number(row.skillLevel));
    const docArmyRow = docArmy.find((item) => Number(item.skilllevel) === Number(row.skillLevel));
    console.log(`[check] L${row.skillLevel} auraFollow=${params.auraFollow}`
        + ` auraForward=${params.auraForward} auraRadius=${params.auraRadius}`
        + `（左缘 ${params.auraForward - params.auraRadius}）`
        + ` | 两份 pvpSkillPlan 一致：${docRow && docRow.skillParamJson === row.skillParamJson && docRow.desc === row.desc ? '是' : '否'}`
        + ` | 两份 army 一致：${army && docArmyRow && army.desc === docArmyRow.desc ? '是' : '否'}`);
    console.log(`         ${row.desc}`);
}
