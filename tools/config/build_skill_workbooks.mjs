import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const artifactRoot = process.env.ARTIFACT_TOOL_ROOT
    || 'C:/Users/hedao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool';
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(join(artifactRoot, 'dist', 'artifact_tool.mjs')).href);

const cityRoot = resolve(process.cwd(), '..');
const docRoot = join(cityRoot, 'doc', '塔防数据配置');
const outputRoot = resolve(process.cwd(), 'outputs', 'skill_pipeline_20260926');
await fs.mkdir(outputRoot, { recursive: true });

const columns = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel', 'unlockHeroLevel',
    'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId', 'triggerEvent', 'behaviorKey', 'stateMode',
    'targetSelector', 'statId', 'operation', 'value', 'statusId', 'statusStatJson', 'durationSeconds',
    'maxStacks', 'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion', 'publishStatus',
];
const chineseHeaders = [
    '启用', '修改器ID', '单位ID', '成长技能ID', '技能名称', '技能等级', '英雄解锁等级', '技能类型',
    '生效范围', '成长模式', 'PVP技能ID', '触发事件', '行为处理器', '状态模式', '目标选择', '标准属性',
    '运算方式', '数值', '状态ID', '状态属性JSON', '持续秒数', '最大层数', '替换技能ID', '内部冷却',
    '每局上限', '策划描述', '来源版本', '发布状态',
];
const types = [
    'int', 'int', 'string', 'int', 'string', 'int', 'int', 'string', 'string', 'string', 'int', 'string',
    'string', 'string', 'string', 'string', 'string', 'float', 'string', 'string', 'float', 'int', 'int',
    'float', 'int', 'string', 'string', 'string',
];
const plans = [
    [1, 91001011, '68001', 100101, '豌豆快送', 1, 3, 'passive_stat', 'deployed', 'accumulate', 30701, 'build', null, 'none', 'self', 'attackRange', 'addRate', 0.10, null, null, 0, 1, null, 0, 0, '射程提高10%', 'J技能表闭环1.1', '可发布'],
    [1, 91001012, '68001', 100101, '豌豆快送', 2, 14, 'passive_stat', 'deployed', 'accumulate', 30701, 'build', null, 'none', 'self', 'attackRange', 'addRate', 0.10, null, null, 0, 1, null, 0, 0, '射程再提高10%，累计20%', 'J技能表闭环1.1', '可发布'],
    [1, 91001013, '68001', 100101, '豌豆快送', 3, 22, 'passive_stat', 'deployed', 'accumulate', 30701, 'build', null, 'none', 'self', 'attackRange', 'addRate', 0.10, null, null, 0, 1, null, 0, 0, '射程再提高10%，累计30%', 'J技能表闭环1.1', '可发布'],
    [1, 91001021, '68001', 100102, '强化豌豆', 1, 6, 'passive_stat', 'deployed', 'replace', 30701, 'build', null, 'none', 'self', 'attack', 'addRate', 0.10, null, null, 0, 1, null, 0, 0, '攻击提高10%', 'J技能表闭环1.1', '可发布'],
    [1, 91001022, '68001', 100102, '强化豌豆', 2, 16, 'passive_stat', 'deployed', 'replace', 30701, 'build', null, 'none', 'self', 'attack', 'addRate', 0.11, null, null, 0, 1, null, 0, 0, '攻击提高11%，替换I级', 'J技能表闭环1.1', '可发布'],
    [1, 91001023, '68001', 100102, '强化豌豆', 3, 23, 'passive_stat', 'deployed', 'replace', 30701, 'build', null, 'none', 'self', 'attack', 'addRate', 0.12, null, null, 0, 1, null, 0, 0, '攻击提高12%，替换II级', 'J技能表闭环1.1', '可发布'],
    [1, 91001031, '68001', 100103, '饥饿缠身', 1, 9, 'event_passive', 'battle', 'replace', 30701, 'hit', 'on_hit_status', 'none', 'current_target', 'attack', 'addRate', 0.30, 'hunger_slow_l1', '{"attackIntervalPct":-15}', 2, 1, null, 0, 0, '伤害提高30%，命中使目标攻速降低15%持续2秒', 'J技能表闭环1.1', '可发布'],
    [1, 91001032, '68001', 100103, '饥饿缠身', 2, 18, 'event_passive', 'battle', 'replace', 30701, 'hit', 'on_hit_status', 'none', 'current_target', 'attack', 'addRate', 0.30, 'hunger_slow_l2', '{"attackIntervalPct":-20}', 3, 1, null, 0, 0, '伤害提高30%，命中使目标攻速降低20%持续3秒', 'J技能表闭环1.1', '可发布'],
    [1, 91001033, '68001', 100103, '饥饿缠身', 3, 24, 'event_passive', 'battle', 'replace', 30701, 'hit', 'on_hit_status', 'none', 'current_target', 'attack', 'addRate', 0.30, 'hunger_slow_l3', '{"attackIntervalPct":-25}', 4, 1, null, 0, 0, '伤害提高30%，命中使目标攻速降低25%持续4秒', 'J技能表闭环1.1', '可发布'],
    [0, 91001041, '68001', 100104, '黄袍加身', 1, 12, 'shape_passive', 'deployed', 'replace', 30701, 'build', 'replace_skill_profile', 'none', 'self', null, null, null, null, null, 0, 1, null, 0, 0, '替换为豌豆雨范围攻击；目标技能完成后再启用', 'J技能表闭环1.1', '未启用'],
    [0, 91001042, '68001', 100104, '黄袍加身', 2, 20, 'shape_passive', 'deployed', 'replace', 30701, 'build', 'replace_skill_profile', 'none', 'self', null, null, null, null, null, 0, 1, null, 0, 0, '替换为豌豆雨范围攻击；目标技能完成后再启用', 'J技能表闭环1.1', '未启用'],
    [0, 91001043, '68001', 100104, '黄袍加身', 3, 25, 'shape_passive', 'deployed', 'replace', 30701, 'build', 'replace_skill_profile', 'none', 'self', null, null, null, null, null, 0, 1, null, 0, 0, '替换为豌豆雨范围攻击；目标技能完成后再启用', 'J技能表闭环1.1', '未启用'],
];

async function load(name) {
    return SpreadsheetFile.importXlsx(await FileBlob.load(join(docRoot, name)));
}

async function save(workbook, name) {
    const output = await SpreadsheetFile.exportXlsx(workbook);
    const path = join(outputRoot, name);
    await output.save(path);
    return path;
}

// J：只新增一张严格遵循 eSon 6 行表头约定的源表，避免预览/公式辅助表参与导出。
const jWorkbook = await load('J-技能表.xlsx');
const planSheet = jWorkbook.worksheets.add('PVP技能配置');
planSheet.getRange('A1:AB18').values = [
    ['pvpSkillPlan.json', ...Array(27).fill(null)],
    // eSon 旧约定：1 = 客户端与服务端共同导出，3 = 仅客户端。
    // 技能成长必须由后端裁决，因此整张契约表使用 1。
    Array(28).fill(1),
    chineseHeaders,
    ['1参与导出，0保留草稿', '全局唯一', '引用pvpCard.unitId', '对应K表id', '策划显示名', '同技能链递增', '英雄达到后解锁', 'passive_stat/event_passive/shape_passive/active', 'owned/equipped/deployed/battle', 'replace/accumulate/branch', '引用pvpSkill.skillId', 'build/hit/kill/damage_taken', '代码已注册行为；纯属性留空', 'none/counter/cast-fsm', 'self/current_target/nearest_enemy/allies_in_radius', '稳定statId', 'add/addRate/multiply/override', '比例用小数', '稳定状态ID', '数字对象JSON', '状态持续时间', '状态层数', '形态替换目标技能', '秒', '0=不限', '界面与评审说明', '配置来源版本', '可发布/未启用'],
    columns,
    types,
    ...plans,
];
planSheet.freezePanes.freezeRows(6);
planSheet.getRange('A1:AB1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' } };
planSheet.getRange('A2:AB2').format = { fill: '#D9EAF7', font: { bold: true } };
planSheet.getRange('A3:AB3').format = { fill: '#2F75B5', font: { bold: true, color: '#FFFFFF' }, wrapText: true };
planSheet.getRange('A4:AB6').format = { fill: '#DDEBF7', wrapText: true };
planSheet.getRange('A7:AB18').format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
planSheet.getRange('A1:AB18').format.font = { name: 'Microsoft YaHei', size: 10 };
planSheet.getRange('A1:AB18').format.autofitColumns();
planSheet.getRange('E:E').format.columnWidth = 16;
planSheet.getRange('T:T').format.columnWidth = 26;
planSheet.getRange('Z:Z').format.columnWidth = 36;
const jPath = await save(jWorkbook, 'J-技能表_PVP技能升级闭环版.xlsx');

// K：回填 J 表稳定 modifierId；策划仍只维护 Excel，命令行投影会做同样的引用补全。
const kWorkbook = await load('K-卡牌升级.xlsx');
const kSheet = kWorkbook.worksheets.getItem('卡牌技能升级表');
const kUsed = kSheet.getUsedRange();
const kValues = kUsed.values;
const kHeaders = kValues[4];
const idCol = kHeaders.indexOf('id');
const levelCol = kHeaders.indexOf('skilllevel');
const modifierCol = kHeaders.indexOf('modfiy');
const planModifier = new Map(plans.filter((row) => row[0] === 1).map((row) => [`${row[3]}:${row[5]}`, row[1]]));
for (let row = 6; row < kValues.length; row += 1) {
    const modifierId = planModifier.get(`${kValues[row][idCol]}:${kValues[row][levelCol]}`);
    if (modifierId) kSheet.getCell(row, modifierCol).values = [[[modifierId]]];
}
const kPath = await save(kWorkbook, 'K-卡牌升级_PVP技能引用闭环版.xlsx');

// PVP 修改器：把事件被动的三档状态显式列入状态表，后端/客户端都能直接检查引用。
const pvpWorkbook = await load('PVP-修改器适配.xlsx');
const statusSheet = pvpWorkbook.worksheets.getItem('状态映射');
statusSheet.getRange('A39:N41').values = [
    ['饥饿缠身I', 'hunger_slow_l1', '饥饿缠身I', 2, 0, 1, 'refresh', 'none', '{"attackIntervalPct":-15}', 1, null, null, null, null],
    ['饥饿缠身II', 'hunger_slow_l2', '饥饿缠身II', 3, 0, 1, 'refresh', 'none', '{"attackIntervalPct":-20}', 1, null, null, null, null],
    ['饥饿缠身III', 'hunger_slow_l3', '饥饿缠身III', 4, 0, 1, 'refresh', 'none', '{"attackIntervalPct":-25}', 1, null, null, null, null],
];
statusSheet.getRange('A39:N41').format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
const pvpPath = await save(pvpWorkbook, 'PVP-修改器适配_技能状态闭环版.xlsx');

// 渲染改动区域，作为可视验收证据。
for (const [workbook, sheetName, range, fileName] of [
    [jWorkbook, 'PVP技能配置', 'A1:AB18', 'J-PVP技能配置.png'],
    [kWorkbook, '卡牌技能升级表', 'A1:N40', 'K-卡牌技能升级.png'],
    [pvpWorkbook, '状态映射', 'A1:N41', 'PVP-状态映射.png'],
]) {
    const image = await workbook.render({ sheetName, range, format: 'png', scale: 1 });
    await fs.writeFile(join(outputRoot, fileName), new Uint8Array(await image.arrayBuffer()));
}

console.log(JSON.stringify({ outputRoot, files: [jPath, kPath, pvpPath] }, null, 2));
