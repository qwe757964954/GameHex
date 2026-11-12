// 2026-11-10 「裂变暴击」只留轻微暴击率：删掉单卡暴击伤害，暴击率 22/30/38 → 3/4/5。
//
// 用户口径
// ────────
// 「卡牌自身的技能伤害如果不是有给队友加成的机制，那么暴击伤害本来就该只归该张卡牌所有，
//   后续应该修改技能：卡牌本身的技能不能带有暴击伤害加成，只能轻微提高暴击率。」
//
// 现状（动手前）每张暴击卡有**成对的两条链**：
//
//   68016  chain 101601  critRate  22/30/38  + 溅射 32/40/48%    ← 表现层
//          chain 191601  critDamage 90/120/150                  ← 数值层（本次删除）
//   68025  chain 102502 / 192502、68033 chain 103301 / 193301、68034 chain 103402 / 193402 同构
//
// 于是 desc 那句「暴击率提高22%，暴击伤害提高90%，命中对周围造成32%溅射伤害」是两条链拼起来的。
//
// 改什么
// ──────
// 1. **删掉 4 条 19x0x 链的 12 行暴击伤害**（暴击伤害从此只有一个来源：卡牌等级的 109001 全队链）；
// 2. **把 10x0x 链的暴击率 22/30/38 改成 3/4/5** —— 用户选的是「轻微」，留着 22/30/38 再加上
//    3/4/5 会变成 25/34/43，与「轻微」直接冲突；3:4:5 也正好是原来 90:120:150 的等比缩放；
// 3. `desc` 同步：去掉「暴击伤害提高 N%」，只留暴击率 + 溅射（溅射来自 skillParamJson，真的生效）。
//
// 三处同改：两份 json（本脚本）+ 源表 `J-技能表.xlsx / PVP技能配置`（同名 `_excel.py`）。
//
// ⚠️ 只动「裂变暴击」这一对链；68016 的 `101602/191602 爆囊扩散` 是另一对，不碰。

const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const PLAN_TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];
const BACKUP_DIR = 'tmp/liebian_backup';

/** `19x0x` 暴伤链 → 同卡的 `10x0x` 暴击率链。 */
const PAIRS = [
    { unitId: '68016', damageChain: 191601, rateChain: 101601 },
    { unitId: '68025', damageChain: 192502, rateChain: 102502 },
    { unitId: '68033', damageChain: 193301, rateChain: 103301 },
    { unitId: '68034', damageChain: 193402, rateChain: 103402 },
];

/** 档位 → 新暴击率（百分数口径，3 = +3%）。 */
const NEW_CRIT_RATE = { 1: 3, 2: 4, 3: 5 };
/** 动手前的指纹：暴伤值按档位、暴击率按档位。 */
const OLD_CRIT_DAMAGE = { 1: 90, 2: 120, 3: 150 };
const OLD_CRIT_RATE = { 1: 22, 2: 30, 3: 38 };

function splashPercent(params) {
    const rate = params && Number(params.splashDamageRate);
    return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : null;
}

function rewrite(path) {
    const table = readTable(path);
    const rows = table.rows;

    // ── 守卫：成对的 24 行必须都在，且数值还是动手前那套 ──────────────────
    for (const pair of PAIRS) {
        for (const level of [1, 2, 3]) {
            const damage = rows.find((row) => String(row.unitId) === pair.unitId
                && Number(row.skillChainId) === pair.damageChain
                && Number(row.skillLevel) === level);
            const rate = rows.find((row) => String(row.unitId) === pair.unitId
                && Number(row.skillChainId) === pair.rateChain
                && Number(row.skillLevel) === level);
            if (!damage) throw new Error(`[fail] ${path} 缺 ${pair.unitId} 链 ${pair.damageChain} L${level}`);
            if (!rate) throw new Error(`[fail] ${path} 缺 ${pair.unitId} 链 ${pair.rateChain} L${level}`);
            if (damage.statId !== 'critDamage' || Number(damage.value) !== OLD_CRIT_DAMAGE[level]) {
                throw new Error(`[fail] ${pair.unitId} ${pair.damageChain} L${level} 不是 critDamage/${OLD_CRIT_DAMAGE[level]}`
                    + `（实为 ${damage.statId}/${damage.value}）—— 表被人改过，拒绝覆盖`);
            }
            if (rate.statId !== 'critRate' || Number(rate.value) !== OLD_CRIT_RATE[level]) {
                throw new Error(`[fail] ${pair.unitId} ${pair.rateChain} L${level} 不是 critRate/${OLD_CRIT_RATE[level]}`
                    + `（实为 ${rate.statId}/${rate.value}）—— 表被人改过，拒绝覆盖`);
            }
        }
    }

    // ── 1) 改暴击率 + 文案 ────────────────────────────────────────────────
    let rewritten = 0;
    for (const pair of PAIRS) {
        for (const level of [1, 2, 3]) {
            const row = rows.find((item) => String(item.unitId) === pair.unitId
                && Number(item.skillChainId) === pair.rateChain
                && Number(item.skillLevel) === level);
            const rate = NEW_CRIT_RATE[level];
            row.value = rate;
            const splash = splashPercent(row.skillParamJson);
            row.desc = splash
                ? `暴击率提高${rate}%，命中对周围造成${splash}%溅射伤害`
                : `暴击率提高${rate}%`;
            rewritten += 1;
        }
    }

    // ── 2) 删掉暴伤行 ──────────────────────────────────────────────────────
    const damageChains = new Set(PAIRS.map((pair) => pair.damageChain));
    const kept = rows.filter((row) => !damageChains.has(Number(row.skillChainId)));
    const removed = rows.length - kept.length;
    if (removed !== PAIRS.length * 3) {
        throw new Error(`[fail] ${path} 应删 ${PAIRS.length * 3} 行，实删 ${removed}`);
    }
    table.rows = kept;
    writeTable(path, table);

    // ── 回读校验 ──────────────────────────────────────────────────────────
    const check = readTable(path).rows;
    if (check.length !== kept.length) throw new Error(`[fail] ${path} 回读 ${check.length} 行，预期 ${kept.length}`);
    for (const pair of PAIRS) {
        const stray = check.filter((item) => Number(item.skillChainId) === pair.damageChain);
        if (stray.length) throw new Error(`[fail] ${pair.unitId} 的暴伤链还有 ${stray.length} 行`);
        for (const level of [1, 2, 3]) {
            const row = check.find((item) => String(item.unitId) === pair.unitId
                && Number(item.skillChainId) === pair.rateChain
                && Number(item.skillLevel) === level);
            if (Number(row.value) !== NEW_CRIT_RATE[level]) {
                throw new Error(`[fail] ${pair.unitId} ${pair.rateChain} L${level} = ${row.value}，预期 ${NEW_CRIT_RATE[level]}`);
            }
        }
    }
    //  反向守卫：全表 critDamage 只应剩 109001 这一条链。
    const critLeft = check.filter((item) => item.statId === 'critDamage');
    const chains = new Set(critLeft.map((item) => Number(item.skillChainId)));
    if (chains.size !== 1 || !chains.has(109001)) {
        throw new Error(`[fail] critDamage 残留了别的链：${[...chains].join(',')}`);
    }
    return { before: rows.length, after: kept.length, rewritten, critRows: critLeft.length };
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
PLAN_TABLES.forEach((path, index) => {
    const target = `${BACKUP_DIR}/pvpSkillPlan.${index === 0 ? 'remoteRef' : 'client'}.json`;
    if (!fs.existsSync(target)) fs.copyFileSync(path, target);
});

for (const path of PLAN_TABLES) {
    const result = rewrite(path);
    console.log(`[pvpSkillPlan] ${path}：${result.before} → ${result.after} 行`
        + `（删 12 行暴伤、改 ${result.rewritten} 行暴击率；critDamage 只剩 ${result.critRows} 行 / 109001）`);
}

console.log('\n[完成] 裂变暴击：暴击率 22/30/38 → 3/4/5，暴击伤害加成整条移除');
