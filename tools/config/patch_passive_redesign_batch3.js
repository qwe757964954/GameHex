// 被动重设计 V5 · 第三批：裂变暴击（暴击率 + 命中溅射 + 混搭尾）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 的 L1~L3 列。
//
//   · 102502 大威天芦（68025）：暴击率 11/13/15%，命中溅射 20/26/32%，尾巴 攻击 35% / 伤害 29% / 攻速 35%
//   · 103301 运动霸（68033）： 暴击率 11/13/15%，命中溅射 32/40/48%，尾巴 攻击 35% / 攻速 35%
//
// 🔴 V5 口径：暴击伤害从卡牌被动里**整条移除**（暴伤只留 109001 全队链），暴击率上限 15%，
// 所以这里只写 `critRate`（operation=add，值是百分点），不再有 critDamage。
//
// 尾巴的落法交给 `patch_passive_redesign_tails.js`（先跑本脚本、再跑它）：
// 103301 有两个现成子链槽位（193302 攻速 / 283302 范围），102502 一个都没有 ⇒ 全走 `mix.*`。
//
// 幂等：只改自己的那几个键，`mix.*` 原样保留（尾巴脚本负责读写它）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261116';

/** splashRadius 沿用与 102502 同一套「38 / 46 / 55」档位（设计案没写半径，属调参量）。 */
const SKILLS = [
    {
        chain: 102502, card: '68025', name: '裂变暴击',
        crit: [11, 13, 15], splash: [0.20, 0.26, 0.32], levels: [0, 16, 23],
        tails: '攻击提高35%，伤害提高29%，攻击速度提高35%',
    },
    {
        chain: 103301, card: '68033', name: '裂变暴击',
        crit: [11, 13, 15], splash: [0.32, 0.40, 0.48], levels: [0, 14, 22],
        tails: '攻击提高35%，攻击速度提高35%',
    },
];

const RADIUS = [38, 46, 55];

function descOf(spec, tier) {
    const crit = tier === 0 ? `暴击率提高${spec.crit[tier]}%` : `暴击率提高到${spec.crit[tier]}%`;
    const rate = Math.round(spec.splash[tier] * 100);
    const splash = tier === 0
        ? `命中对周围造成${rate}%溅射伤害（同一爆点第2个目标起每次×0.7）`
        : `命中溅射提高到${rate}%（逐目标×0.7）`;
    return `${crit}，${splash}；${spec.tails}`;
}

function applyPlan(rows) {
    let written = 0;
    for (const spec of SKILLS) {
        for (let tier = 0; tier < 3; tier += 1) {
            const level = tier + 1;
            const hit = rows.find((row) => Number(row.skillChainId) === spec.chain && Number(row.skillLevel) === level);
            if (!hit) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
            const params = hit.skillParamJson ? JSON.parse(hit.skillParamJson) : {};
            Object.assign(hit, {
                enabled: 1,
                unitId: spec.card,
                skillName: spec.name,
                statId: 'critRate', operation: 'add', value: spec.crit[tier],
                skillKind: 'passive_stat', passiveScope: 'deployed',
                progressionMode: 'replace', stateMode: 'none',
                triggerEvent: 'build', targetSelector: 'self',
                unlockHeroLevel: spec.levels[tier],
                sourceVersion: VERSION, publishStatus: '可发布',
                desc: descOf(spec, tier),
                skillParamJson: JSON.stringify({
                    ...params,
                    splashDamageRate: spec.splash[tier],
                    splashFalloff: 0.3,
                    splashRadius: RADIUS[tier],
                }),
            });
            written += 1;
        }
    }
    return written;
}

function applyArmy(table) {
    let written = 0;
    for (const spec of SKILLS) {
        for (let tier = 0; tier < 3; tier += 1) {
            const hit = table.rows.find((row) => Number(row.id) === spec.chain && Number(row.skilllevel) === tier + 1);
            if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
            hit.name = spec.name;
            hit.desc = descOf(spec, tier);
            hit.unlockarmylevel = spec.levels[tier];
            written += 1;
        }
    }
    return written;
}

function main() {
    const planFiles = [path.join(REMOTE, 'pvpSkillPlan.json'), path.join(CLIENT, 'pvpSkillPlan.json')];
    for (const file of planFiles) {
        const table = readTable(file);
        const written = applyPlan(table.rows);
        writeTable(file, table);
        console.log(`[ok] ${path.basename(path.dirname(file))}/pvpSkillPlan.json：${written} 行`);
    }
    for (const directory of [REMOTE, CLIENT]) {
        const file = path.join(directory, 'armySkillLevelUp.json');
        const table = readTable(file);
        const written = applyArmy(table);
        writeTable(file, table);
        console.log(`[ok] ${path.basename(path.dirname(file))}/armySkillLevelUp.json：${written} 行`);
    }
}

main();
