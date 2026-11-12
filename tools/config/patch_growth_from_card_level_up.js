// 2026-11-10 用「卡牌升级表」反推 `pvpUnitGrowth`（35 卡 × 1~50 级 = 1750 行）。
//
// 为什么做
// ────────
// 卡牌等级上限已经开到 50，但 `pvpUnitGrowth` 只有 15 张卡 × 1~25 级（375 行），
// 26 级起 `ZCClientCombatConfig.growthSelectionOf` 查不到行会返回 `{}`（不传 level），
// 整块成长被跳过 —— 老卡升到 26 级反而掉属性，20 张新卡（68015~68035）一行都没有。
//
// 数值从哪来
// ──────────
// `cardLevelUp.json` 的 `attrList` 是**该等级属性的绝对值**，且 `L1` 的值与卡牌基础值
// （`pvpCard.unitAttack` / `unitMaxHp`）逐张相等 —— 脚本启动时先校验这 35 对，对不上就拒绝执行。
// 于是差值口径是干净的：
//
//     attackFlat(L) = attrList.attack(L) − attrList.attack(1)
//     maxHpFlat(L)  = attrList.maxHp(L)  − attrList.maxHp(1)
//
// L1 两边相减必为 0，正好对上「1 级 = 卡牌基础值」的既有约定。
//
// 口径（2026-11-10 用户拍板：**全量重算·去掉星级补偿**）
// ──────────────────────────────────────────────────────
// · 35 张卡一律重写 1~50 级，**不保留**原来按品质补的 `attackFlat` 45/55/65/75；
// · 所有比例列（`attackRate` / `maxHpRate` / `moveSpeedRate`）与 `attackRangeFlat` 归 0 ——
//   卡牌升级表只给绝对值，比例没有依据。附带效果：**68025 那条 `attackRate = 0.08 × L`
//   的设计案曲线（`技能设计案2 / 伤害参数 B3`）被本脚本作废**，它的成长改由 cardLevelUp 接管。
// · 于是「成长生效后单位属性 == cardLevelUp 的该级属性」是恒等式，可以直接写断言。
//
// 三处同改
// ────────
// · `assets/remoteRef/pvpUnitGrowth.json`（列存竖排，CRLF）
// · `doc/塔防数据配置/json/client/pvpUnitGrowth.json`（转表产物，单行 LF、无末尾换行）
// · `doc/塔防数据配置/PVP-修改器适配.xlsx / PVP成长`（源表，见同名 .py）
// 前两份走 `ref_table_io.js`（两套磁盘格式都认），漏掉任何一份都会被
// `tests/zcds-model.test.ts` 的「remoteRef 与转表产物逐格一致」抓住。

const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const GROWTH_TABLES = [
    'assets/remoteRef/pvpUnitGrowth.json',
    `${ROOT}/doc/塔防数据配置/json/client/pvpUnitGrowth.json`,
];
const CARD_LEVEL_UP = 'assets/remoteRef/cardLevelUp.json';
const PVP_CARD = 'assets/remoteRef/pvpCard.json';
const BACKUP_DIR = 'tmp/growth_backup';

const MAX_LEVEL = 50;
const EXPECT_CARDS = 35;
/** 动手前的现状：15 张老卡 × 1~25 级。不等于它就是已经跑过（或被人改过），拒绝覆盖。 */
const EXPECT_OLD_ROWS = 375;

// ── 1) 读卡牌升级表：cardId → level → { attack, maxHp } ──────────────────────
const levelTable = readTable(CARD_LEVEL_UP);
const curve = new Map();
for (const row of levelTable.rows) {
    const cardId = String(row.id);
    const level = Number(row.level);
    const attrs = {};
    for (const item of row.attrList ?? []) attrs[item.statId] = Number(item.value);
    if (!curve.has(cardId)) curve.set(cardId, new Map());
    curve.get(cardId).set(level, {
        attack: attrs.attack ?? 0,
        maxHp: attrs.maxHp ?? 0,
    });
}

// ── 2) 读 pvpCard：拿 35 张启用卡的基础值当守卫 ──────────────────────────────
const cardTable = readTable(PVP_CARD);
const cards = cardTable.rows
    .filter((row) => row.unitId != null && Number(row.enabled) === 1)
    .map((row) => ({
        id: String(row.id),
        unitId: String(row.unitId),
        name: String(row.name ?? ''),
        baseAttack: Number(row.unitAttack),
        baseMaxHp: Number(row.unitMaxHp),
    }))
    .sort((a, b) => Number(a.unitId) - Number(b.unitId));

if (cards.length !== EXPECT_CARDS) {
    throw new Error(`[fail] pvpCard 启用卡应是 ${EXPECT_CARDS} 张，实得 ${cards.length}`);
}

// ── 3) 守卫：曲线必须 0~50 齐全，且 L1 == 卡牌基础值 ─────────────────────────
for (const card of cards) {
    const levels = curve.get(card.id);
    if (!levels) throw new Error(`[fail] cardLevelUp 里没有卡 ${card.id}（${card.name}）`);
    for (let level = 0; level <= MAX_LEVEL; level += 1) {
        if (!levels.has(level)) throw new Error(`[fail] ${card.id} 缺 ${level} 级`);
    }
    const base = levels.get(1);
    if (base.attack !== card.baseAttack || base.maxHp !== card.baseMaxHp) {
        throw new Error(`[fail] ${card.id} 的 cardLevelUp L1（攻击 ${base.attack} / 生命 ${base.maxHp}）`
            + ` 与 pvpCard 基础值（攻击 ${card.baseAttack} / 生命 ${card.baseMaxHp}）不一致`);
    }
}

// ── 4) 守卫：现有成长表必须是「动手前的 375 行」或「已经跑过本脚本的 1750 行」 ──
//  两种都放过：前者是首次执行，后者是幂等重跑（生成结果确定，重写不会变）。
//  其它行数一律拒绝 —— 说明表被别人改过，不能盲目覆盖。
const current = readTable(GROWTH_TABLES[0]);
const EXPECT_ROWS = cards.length * MAX_LEVEL;
if (current.rows.length !== EXPECT_OLD_ROWS && current.rows.length !== EXPECT_ROWS) {
    throw new Error(`[fail] pvpUnitGrowth 现有 ${current.rows.length} 行，既不等于动手前的 ${EXPECT_OLD_ROWS} 行、`
        + `也不等于目标 ${EXPECT_ROWS} 行 —— 表被人动过，拒绝覆盖`);
}

// ── 5) 生成 1750 行 ─────────────────────────────────────────────────────────
const growth = [];
for (const card of cards) {
    const levels = curve.get(card.id);
    const base = levels.get(1);
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
        const attr = levels.get(level);
        growth.push({
            unitId: card.unitId,
            level,
            attackFlat: attr.attack - base.attack,
            attackRate: 0,
            maxHpFlat: attr.maxHp - base.maxHp,
            maxHpRate: 0,
            moveSpeedRate: 0,
            attackRangeFlat: 0,
            enabled: 1,
        });
    }
}

// ── 6) 备份 → 双写 → 回读 ────────────────────────────────────────────────────
//  两份 json 的 basename 相同，备份必须带序号，否则后一份会盖掉前一份。
fs.mkdirSync(BACKUP_DIR, { recursive: true });
GROWTH_TABLES.forEach((path, index) => {
    const target = `${BACKUP_DIR}/pvpUnitGrowth.${index === 0 ? 'remoteRef' : 'client'}.json`;
    if (!fs.existsSync(target)) fs.copyFileSync(path, target);
});

for (const path of GROWTH_TABLES) {
    const table = readTable(path);
    table.rows = growth;
    writeTable(path, table);
    const check = readTable(path).rows;
    if (check.length !== growth.length) {
        throw new Error(`[fail] ${path} 回读 ${check.length} 行，预期 ${growth.length}`);
    }
    console.log(`[pvpUnitGrowth] ${path}：${current.rows.length} → ${check.length} 行`);
}

// ── 7) 回读校验：唯一键 / L1 归零 / 属性恒等式 / 比例列全 0 ────────────────────
const reread = readTable(GROWTH_TABLES[0]).rows;
if (reread.length !== cards.length * MAX_LEVEL) {
    throw new Error(`[fail] 回读 ${reread.length} 行，预期 ${cards.length * MAX_LEVEL}`);
}
const seen = new Set();
for (const row of reread) {
    const key = `${row.unitId}:${row.level}`;
    if (seen.has(key)) throw new Error(`[fail] 重复键 ${key}`);
    seen.add(key);
    for (const column of ['attackRate', 'maxHpRate', 'moveSpeedRate', 'attackRangeFlat']) {
        if (Number(row[column]) !== 0) throw new Error(`[fail] ${key} 的 ${column} 应为 0，实得 ${row[column]}`);
    }
}
const byKey = new Map(reread.map((row) => [`${row.unitId}:${row.level}`, row]));
for (const card of cards) {
    const levels = curve.get(card.id);
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
        const row = byKey.get(`${card.unitId}:${level}`);
        const attr = levels.get(level);
        // 成长生效后：基础值 + flat == cardLevelUp 的该级属性（比例列全 0，所以直接相加）。
        if (card.baseAttack + Number(row.attackFlat) !== attr.attack) {
            throw new Error(`[fail] ${card.unitId} L${level} 攻击 ${card.baseAttack}+${row.attackFlat} != ${attr.attack}`);
        }
        if (card.baseMaxHp + Number(row.maxHpFlat) !== attr.maxHp) {
            throw new Error(`[fail] ${card.unitId} L${level} 生命 ${card.baseMaxHp}+${row.maxHpFlat} != ${attr.maxHp}`);
        }
        if (level === 1 && (Number(row.attackFlat) !== 0 || Number(row.maxHpFlat) !== 0)) {
            throw new Error(`[fail] ${card.unitId} L1 应全是 0`);
        }
    }
}

// ── 8) 汇总 ────────────────────────────────────────────────────────────────
const sample = (unitId, level) => {
    const row = byKey.get(`${unitId}:${level}`);
    return `L${level} atk+${row.attackFlat} hp+${row.maxHpFlat}`;
};
console.log(`\n[完成] ${cards.length} 卡 × ${MAX_LEVEL} 级 = ${reread.length} 行`);
for (const unitId of ['68001', '68007', '68020', '68025']) {
    console.log(`  ${unitId}: ${sample(unitId, 1)} / ${sample(unitId, 25)} / ${sample(unitId, 50)}`);
}
