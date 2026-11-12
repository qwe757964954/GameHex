#! /usr/bin/env node
/**
 * 「全队暴击伤害增幅」：给 35 张可上场卡各铺 1~25 级的 `pvpSkillPlan` 行。
 *
 * 口径（2026-11-10 用户指定）
 * ─────────────────────────────
 *   · statId = `critDamage`，operation = `add`，value 是「20 = +20%」的百分数口径
 *     （见 `ZCStatSchema.STAT_TO_PATCH.critDamage → critDamagePct`，
 *      消费点在 `ZCAttackResolutionSystem.criticalMultiplier: 1 + critDamagePct/100`）。
 *   · 每升 1 级给全队加：绿卡 0.5% / 蓝卡 1% / 紫卡 2% / 金卡 3%。
 *   · 卡牌等级 1~50（2026-11-10 用户口径：卡牌要能升到 50 级），所以每卡 50 行，
 *     `unlockHeroLevel = level`，`progressionMode = accumulate` ⇒ `selectZCSkillPlans`
 *     会把「unlockHeroLevel <= 当前等级」的行全部选中，`applyZCTypedUnitModifiers` 里 flat 相加
 *     ⇒ 当前等级 L 的总量 = Σ(1..L) 的 value。
 *   · 每行的 `value` 是**该级增量**，不是累计值：每一级独立成行，后期要改成梯度只改那几行
 *     的数字即可，不用连带改后面所有行。现在四个品质都是定额。
 *
 * 为什么不是 1 行
 * ───────────────
 * `pvpSkillPlan` 没有「按英雄等级线性缩放」的字段。要忠实表达「每级 +X%、且每级可单独调」
 * 只能逐级铺行；`accumulate` 的既有先例是豌豆快送（3 行各 +10%，累加成 30%）。
 * 换成 `replace` + 每行写累计值也能算对，但那样改某一级必须连带改后面全部行，不适合做梯度。
 *
 * pvpSkillId 取 `pvpCard.unitSkillId`
 * ────────────────────────────────────
 * 校验器 `validate_skill_pipeline.mjs` 有一条硬规则：计划行的 `pvpSkillId` 必须等于该卡
 * `pvpCard.unitSkillId`，否则报 error。68025 大威天芦是历史例外（unitSkillId=30171，
 * 但 21 条技能行都挂 30858，已产生 21 条既有 error）。本脚本一律按 unitSkillId 填，
 * 保证**不新增**任何校验 error；这些行没有 behaviorKey / skillParamJson，
 * 在 `mergeSkillPlanIntoRuntime` 里 `!params && !statusId` 直接返回 null，
 * 不会污染 `${unitId}:${pvpSkillId}` 那个参数袋。
 *
 * 双写
 * ────
 *   · `assets/remoteRef/pvpSkillPlan.json`（列存 k/v，逐元素换行）
 *   · `D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json`（单行行数组，null 键省略）
 * 另外导出 `tmp/lineup_crit_rows.json` 给 `patch_lineup_crit_damage_excel.py` 写源表，
 * 保证三处逐字段一致。
 *
 * 用法：node tools/config/patch_lineup_crit_damage.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const REMOTE = path.join(ROOT, 'assets/remoteRef/pvpSkillPlan.json');
const CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json';
const DUMP = path.join(ROOT, 'tmp/lineup_crit_rows.json');

const MAX_LEVEL = 50;
const CHAIN_ID = 109001;
const MOD_BASE = 96800000;
const SKILL_NAME = '全队暴击伤害增幅';
const SOURCE_VERSION = '全队暴击伤害v1';
const PVP_SKILL_TABLE = path.join(ROOT, 'assets/remoteRef/pvpSkill.json');

/**
 * 每级给全队加的暴击伤害（百分数口径：0.5 = +0.5%）。
 *
 * 现在四个品质都是「定额 / 级」，所以这里写单个数。**将来要改梯度，把某个品质换成
 * 50 个元素的数组即可**（`stepAt` 已经按「数组优先、单值兜底」取值）——表里每一级本来就是
 * 独立一行，`progressionMode = accumulate` 会把 1~当前等级的行相加，
 * 改其中几级的数字只影响那几级，不用连带改后面所有行。
 */
const PER_LEVEL = {
    1: 0.5,   // 绿
    2: 1,     // 蓝
    3: 2,     // 紫
    4: 3,     // 金
};
const COLOR_BY_RARITY = { 1: '绿', 2: '蓝', 3: '紫', 4: '金' };

function stepAt(rarity, level) {
    const spec = PER_LEVEL[rarity];
    if (Array.isArray(spec)) {
        const value = spec[level - 1];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`品质 ${rarity} 的第 ${level} 级没有配数值（数组长度应 >= ${MAX_LEVEL}）`);
        }
        return value;
    }
    if (typeof spec !== 'number') throw new Error(`品质 ${rarity} 没有每级增幅`);
    return spec;
}

/** xlsx A..AC 的列序（`PVP技能配置` 第 5 行字段名）。客户端转表产物按这个顺序输出。 */
const SHEET_COLUMNS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
    'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
    'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
    'publishStatus', 'skillParamJson',
];

function readRows(file) {
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function round4(value) {
    return Math.round(value * 10000) / 10000;
}

function buildRows() {
    const cards = readRows(path.join(ROOT, 'assets/remoteRef/pvpCard.json'))
        .filter((card) => card.unitId != null && Number(card.enabled) === 1)
        .sort((left, right) => Number(left.id) - Number(right.id));
    if (cards.length !== 35) {
        throw new Error(`可上场卡应为 35 张，实际 ${cards.length} 张 —— 表被人动过，先确认`);
    }
    const skillIds = new Set(readRows(PVP_SKILL_TABLE).map((row) => String(row.skillId)));

    const rows = [];
    cards.forEach((card, cardIndex) => {
        const rarity = Number(card.rarity);
        if (!PER_LEVEL[rarity]) throw new Error(`${card.id} 品质 ${rarity} 不在 1~4，无法定每级增幅`);
        const unitSkillId = Number(card.unitSkillId);
        if (!skillIds.has(String(unitSkillId))) {
            throw new Error(`${card.id}.unitSkillId=${unitSkillId} 不在 pvpSkill，不能引用`);
        }
        for (let level = 1; level <= MAX_LEVEL; level += 1) {
            const step = stepAt(rarity, level);
            rows.push({
                enabled: 1,
                modifierId: MOD_BASE + (cardIndex + 1) * 100 + level,
                unitId: String(card.id),
                skillChainId: CHAIN_ID,
                skillName: SKILL_NAME,
                skillLevel: level,
                unlockHeroLevel: level,
                skillKind: 'passive_stat',
                //  全队共享：拥有即计入，不要求这张卡本局上场。代码当前不读该列，只作配置说明。
                passiveScope: 'owned',
                //  accumulate：1~当前等级的行全部相加。每一级在表里是独立一行，
                //  改某几级只影响那几级，是「后期改梯度」的落点。
                progressionMode: 'accumulate',
                pvpSkillId: unitSkillId,
                triggerEvent: null,
                behaviorKey: null,
                stateMode: 'none',
                targetSelector: null,
                statId: 'critDamage',
                operation: 'add',
                //  value 是**该级增量**（不是累计值）——累计由 accumulate 相加得到。
                value: round4(step),
                statusId: null,
                statusStatJson: null,
                durationSeconds: null,
                maxStacks: null,
                replacementSkillId: null,
                cooldown: null,
                maxTriggers: null,
                desc: `每升 1 级 +${step}% 全队暴击伤害（${COLOR_BY_RARITY[rarity]}卡）`,
                sourceVersion: SOURCE_VERSION,
                publishStatus: '可发布',
                skillParamJson: null,
            });
        }
    });
    return rows;
}

function insertIntoPacked(file, rows) {
    const raw = fs.readFileSync(file, 'utf8');
    //  这份列存 json 是 CRLF（`assets/remoteRef/` 下多数 json 都是），行尾必须原样跟住，
    //  否则整文件的换行会被脚本改成 LF，产生一份「只是换行变了」的巨大 diff。
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const packed = JSON.parse(raw);
    const keys = packed.k;
    const existing = new Set(packed.v.map((values) => {
        const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
        return `${row.unitId}:${row.skillChainId}:${row.skillLevel}`;
    }));
    for (const row of rows) {
        const rowKey = `${row.unitId}:${row.skillChainId}:${row.skillLevel}`;
        if (existing.has(rowKey)) throw new Error(`pvpSkillPlan 已有 ${rowKey}，重复跑会产生重复键`);
    }
    const blocks = rows.map((row) => `[${eol}`
        + keys.map((key) => JSON.stringify(row[key] ?? null)).join(`,${eol}`)
        + `${eol}]`);
    const tail = `${eol}],${eol}"c":1${eol}}`;
    if (!raw.endsWith(tail)) throw new Error('列存 json 结构变了（尾部不是 ],"c":1}），拒绝写入');
    const next = raw.slice(0, -tail.length) + `,${eol}` + blocks.join(`,${eol}`) + tail;
    fs.writeFileSync(file, next, 'utf8');
    return packed.v.length + rows.length;
}

function insertIntoClient(file, rows) {
    const raw = fs.readFileSync(file, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('转表产物不是数组');
    const compact = rows.map((row) => JSON.stringify(Object.fromEntries(
        SHEET_COLUMNS.filter((column) => row[column] != null).map((column) => [column, row[column]]),
    )));
    const trimmed = raw.replace(/\s*$/, '');
    if (!trimmed.endsWith(']')) throw new Error('转表产物结构变了（结尾不是 ]），拒绝写入');
    //  这份文件是单行 LF、且原本就没有末尾换行，写入后保持原样。
    const next = `${trimmed.slice(0, -1)},${compact.join(',')}]`;
    fs.writeFileSync(file, next, 'utf8');
    return list.length + rows.length;
}

function main() {
    const rows = buildRows();
    const before = JSON.parse(fs.readFileSync(REMOTE, 'utf8')).v.length;
    const hasChain = readRows(REMOTE).some((row) => Number(row.skillChainId) === CHAIN_ID);
    if (hasChain) throw new Error(`pvpSkillPlan 已有 skillChainId=${CHAIN_ID}，本脚本只跑一次`);

    const remoteCount = insertIntoPacked(REMOTE, rows);
    const clientCount = insertIntoClient(CLIENT, rows);
    fs.mkdirSync(path.dirname(DUMP), { recursive: true });
    fs.writeFileSync(DUMP, `${JSON.stringify(rows, null, 1)}\n`, 'utf8');

    console.log(`[ok] pvpSkillPlan：${before} → ${remoteCount} 行（remoteRef）`);
    console.log(`[ok] pvpSkillPlan：${clientCount} 行（转表产物）`);
    console.log(`[ok] 中间产物 → ${path.relative(ROOT, DUMP)}`);
    const steps = {};
    rows.forEach((row) => { steps[row.value] = (steps[row.value] ?? 0) + 1; });
    console.log('  每级增量分布：' + Object.entries(steps)
        .map(([step, count]) => `+${step}% × ${count} 行`).join('，'));
    console.log(`  modifierId 段：${rows[0].modifierId} ~ ${rows[rows.length - 1].modifierId}`);
    //  满级累计（accumulate）：每卡 = Σ 该卡 1~50 级。
    const totals = {};
    rows.forEach((row) => {
        totals[row.unitId] = (totals[row.unitId] ?? 0) + row.value;
    });
    const sample = ['68001', '68003', '68005', '68007'];
    console.log('  单卡满 50 级累计：' + sample
        .map((id) => `${id} +${round4(totals[id])}%`).join('，'));
    const allTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
    console.log(`  35 张卡全部满级（= 全队共享的极限）：+${round4(allTotal)}%`);
}

main();
