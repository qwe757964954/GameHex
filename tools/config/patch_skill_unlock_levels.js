// 技能解锁等级统一：按「卡内第 N 个技能」套固定档位（2026-11-17 用户口径）。
//
//   技能1（`pvpCard.skillList[0]`）→ 3 / 10 / 22
//   技能2（[1]）                  → 6 / 16 / 26
//   技能3（[2]）                  → 9 / 18 / 27
//   技能4（[3]）                  → 12 / 24 / 36
//
// 「第几个技能」只认 `pvpCard.skillList` 的下标 —— 那就是卡面上四个技能格从左到右的顺序，
// 和 `pvpSkillPlan.skillChainId` 的数字大小无关（68034 的第 3 格是 103404、第 4 格是 103405，
// 跳过 103403，按数字排会错位）。
//
// 普攻（`pvpCard.unitSkillId`）不在这四格里，不动。
//
// 只改「配表里已经有行」的链：设计案里有些技能还没落表（`pvpSkillPlan` 无行），
// 那些既不该凭空造行、也没有等级可改 —— 统一列进 skipped 报告。
//
// 幂等：目标值算出来直接写，重复跑结果一致。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261117';

/** 技能 1~4 的三档解锁兵种等级。 */
const SLOT_LEVELS = [
    [3, 10, 22],
    [6, 16, 26],
    [9, 18, 27],
    [12, 24, 36],
];

function main() {
    const cardPath = path.join(REMOTE, 'pvpCard.json');
    const cards = readTable(cardPath);

    //  战斗卡 = `skillList` 非空的卡（主城 2002 之类没有技能格）。
    const battle = cards.rows.filter((row) => Array.isArray(row.skillList)
        && row.skillList.length > 0 && String(row.id).startsWith('68'));

    const planPath = path.join(REMOTE, 'pvpSkillPlan.json');
    const planClientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const planRemote = readTable(planPath);
    const planClient = readTable(planClientPath);

    let updated = 0;
    const skipped = [];
    for (const table of [planRemote, planClient]) {
        for (const card of battle) {
            card.skillList.forEach((chain, slot) => {
                const target = SLOT_LEVELS[slot];
                if (!target) {
                    skipped.push(`${card.id}#${slot + 1}:${chain}（超出 4 个技能格）`);
                    return;
                }
                const rows = table.rows.filter((row) => Number(row.skillChainId) === Number(chain));
                if (rows.length === 0) {
                    //  同一份表里两条产物都要报到，所以这里只记一次。
                    if (table === planRemote) skipped.push(`${card.id} 技能${slot + 1} ${chain}（配表无行）`);
                    return;
                }
                for (const row of rows) {
                    const tier = Number(row.skillLevel) - 1;
                    if (tier < 0 || tier > 2) continue;
                    row.unlockHeroLevel = target[tier];
                    row.sourceVersion = VERSION;
                    updated += 1;
                }
            });
        }
    }

    //  `armySkillLevelUp.unlockarmylevel` 必须同源（K 表 D 列读它）。
    let armyUpdated = 0;
    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        for (const card of battle) {
            card.skillList.forEach((chain, slot) => {
                const target = SLOT_LEVELS[slot];
                if (!target) return;
                for (const row of table.rows) {
                    if (Number(row.id) !== Number(chain)) continue;
                    const tier = Number(row.skilllevel) - 1;
                    if (tier < 0 || tier > 2) continue;
                    row.unlockarmylevel = target[tier];
                    armyUpdated += 1;
                }
            });
        }
        writeTable(file, table);
        console.log(`[ok] ${path.basename(dir)}/armySkillLevelUp.json`);
    }

    writeTable(planPath, planRemote);
    writeTable(planClientPath, planClient);
    console.log(`[ok] pvpSkillPlan：改 ${updated} 行（两份合计）`);
    console.log(`[ok] armySkillLevelUp：改 ${armyUpdated} 行（两份合计）`);
    if (skipped.length) {
        console.log(`[skip] ${skipped.length} 个技能格没有配表行（设计案有、表里没落）：`);
        for (const item of skipped.slice(0, 40)) console.log('   - ' + item);
        if (skipped.length > 40) console.log(`   …另有 ${skipped.length - 40} 条`);
    }
}

main();
