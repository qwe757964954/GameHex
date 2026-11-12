// 2026-11-10 「裂变暴击」暴击率回到 22/30/38（保留原设计值）。
//
// 上一轮（`patch_liebian_crit_rate_only.js`）按「只能轻微提高暴击率」把 4 张暴击卡的
// `critRate` 从 22/30/38 压到了 3/4/5。用户随后确认：**22/30/38 要保留**，只是暴击伤害
// （`critDamage` 90/120/150，链 191601/192502/193301/193402）不能留 —— 那 12 行已在上一轮删除，
// 本脚本只把暴击率数值与 desc 改回来，不恢复暴伤。
//
// 结果：裂变暴击 = 暴击率 22/30/38% + 溅射 32/40/48%，暴击伤害贡献为 0。
//
// 三处同改：两份 json（本脚本）+ 源表 `J-技能表.xlsx / PVP技能配置`（同名 `_excel.py`）。

const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const PLAN_TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];
const BACKUP_DIR = 'tmp/liebian_backup';

/** 每张暴击卡的 `10x0x` 暴击率链（`19x0x` 暴伤链上一轮已删）。 */
const RATE_CHAINS = [
    { unitId: '68016', rateChain: 101601 },
    { unitId: '68025', rateChain: 102502 },
    { unitId: '68033', rateChain: 103301 },
    { unitId: '68034', rateChain: 103402 },
];

/** 目标暴击率（百分数口径，22 = +22%）：回到原设计值。 */
const NEW_CRIT_RATE = { 1: 22, 2: 30, 3: 38 };
/** 上一轮压成的小值，作为「表还没被人动过」的指纹。 */
const OLD_CRIT_RATE = { 1: 3, 2: 4, 3: 5 };
const SPLASH = { 1: 32, 2: 40, 3: 48 };

function rewrite(path) {
    const table = readTable(path);
    const rows = table.rows;
    let rewritten = 0;

    for (const card of RATE_CHAINS) {
        for (const level of [1, 2, 3]) {
            const row = rows.find((item) => String(item.unitId) === card.unitId
                && Number(item.skillChainId) === card.rateChain
                && Number(item.skillLevel) === level);
            if (!row) throw new Error(`[fail] ${path} 缺 ${card.unitId} 链 ${card.rateChain} L${level}`);
            if (row.statId !== 'critRate') {
                throw new Error(`[fail] ${card.unitId} ${card.rateChain} L${level} 的 statId 是 ${row.statId}，预期 critRate`);
            }
            const value = Number(row.value);
            //  幂等：已经是目标值就跳过；只认「上一轮的 3/4/5」，其它值说明表被改过。
            if (value !== NEW_CRIT_RATE[level] && value !== OLD_CRIT_RATE[level]) {
                throw new Error(`[fail] ${card.unitId} ${card.rateChain} L${level} 是 ${value}，`
                    + `既不是上一轮的 ${OLD_CRIT_RATE[level]} 也不是目标 ${NEW_CRIT_RATE[level]} —— 表被人改过，拒绝覆盖`);
            }
            row.value = NEW_CRIT_RATE[level];
            //  暴伤那句已经在上一轮删掉，这里只调暴击率的数字，溅射照旧。
            row.desc = `暴击率提高${NEW_CRIT_RATE[level]}%，命中对周围造成${SPLASH[level]}%溅射伤害`;
            rewritten += 1;
        }
    }

    writeTable(path, table);

    // ── 回读校验 ──────────────────────────────────────────────────────────
    const check = readTable(path).rows;
    for (const card of RATE_CHAINS) {
        for (const level of [1, 2, 3]) {
            const row = check.find((item) => String(item.unitId) === card.unitId
                && Number(item.skillChainId) === card.rateChain
                && Number(item.skillLevel) === level);
            if (Number(row.value) !== NEW_CRIT_RATE[level]) {
                throw new Error(`[fail] ${card.unitId} ${card.rateChain} L${level} = ${row.value}，预期 ${NEW_CRIT_RATE[level]}`);
            }
            if (!String(row.desc).includes(`暴击率提高${NEW_CRIT_RATE[level]}%`)) {
                throw new Error(`[fail] ${card.unitId} ${card.rateChain} L${level} desc 没跟上：${row.desc}`);
            }
            if (String(row.desc).includes('暴击伤害')) {
                throw new Error(`[fail] ${card.unitId} ${card.rateChain} L${level} desc 还写着暴击伤害：${row.desc}`);
            }
        }
    }
    //  反向守卫：全表 critDamage 仍只允许 109001。
    const chains = new Set(check.filter((item) => item.statId === 'critDamage')
        .map((item) => Number(item.skillChainId)));
    if (chains.size !== 1 || !chains.has(109001)) {
        throw new Error(`[fail] critDamage 出现了别的链：${[...chains].join(',')}`);
    }
    return { rows: check.length, rewritten };
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
PLAN_TABLES.forEach((path, index) => {
    const target = `${BACKUP_DIR}/pvpSkillPlan.${index === 0 ? 'remoteRef' : 'client'}.json`;
    if (!fs.existsSync(target)) fs.copyFileSync(path, target);
});

for (const path of PLAN_TABLES) {
    const result = rewrite(path);
    console.log(`[pvpSkillPlan] ${path}：${result.rows} 行，改写 ${result.rewritten} 行暴击率 → 22/30/38`);
}

console.log('\n[完成] 裂变暴击 = 暴击率 22/30/38% + 溅射 32/40/48%，暴击伤害仍为 0（109001 之外无 critDamage）');
