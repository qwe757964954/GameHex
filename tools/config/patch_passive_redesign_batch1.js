// 被动重设计 V5 · 第一批：纯数值被动落到 pvpSkillPlan + armySkillLevelUp。
//
// 口径来源 = `技能设计案2.xlsx / 技能设计案 (2)` 的 L1~L3 三列（不是「落地口径」列 ——
// 该列在多处仍是旧值，例如 101301 写 bulletNumFlat=2，而 L 列已按品级改成紫 1 发）。
//
// 本批只收「主机制 = 一个引擎已支持的 unit 域属性」且没有混搭尾的行：
// 攻击 / 攻击范围 / 攻击速度 / 最大生命。带「同条混搭尾」的金卡行要等 `mix.` 支持，留给下一批。
//
// 写两张表：
//   · pvpSkillPlan：三档 replace（三档不叠加，只取等级最高的那一行）
//   · armySkillLevelUp：name / desc（卡牌技能界面与升级页读这份）
// 源表由 `patch_magdi_skill_rows_excel.py <chains>` + `patch_passive_redesign_k.py` 回填。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261116';

/**
 * 每条：chain / card / 名称 / 三档解锁兵种等级 / statId / 三档数值 / 三档描述。
 * 数值单位与 pvpSkillPlan 一致：addRate 用小数（0.14 = 14%）。
*/
const SKILLS = [
    { chain: 100101, card: '68001', name: '超视孢子', levels: [3, 14, 22], stat: 'attackRange',
        values: [0.14, 0.18, 0.24], descs: ['攻击范围提高14%', '攻击范围提高18%', '攻击范围提高24%'] },
    { chain: 100201, card: '68002', name: '废土铁芽', levels: [3, 14, 22], stat: 'attack',
        values: [0.10, 0.12, 0.14], descs: ['攻击提高10%', '攻击提高12%', '攻击提高14%'] },
    { chain: 100301, card: '68003', name: '废土铁芽', levels: [1, 14, 22], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 100302, card: '68003', name: '超视孢子', levels: [6, 16, 23], stat: 'attackRange',
        values: [0.24, 0.28, 0.32], descs: ['攻击范围提高24%', '攻击范围提高28%', '攻击范围提高32%'] },
    { chain: 100402, card: '68004', name: '废土铁芽', levels: [6, 16, 23], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 100403, card: '68004', name: '超视孢子', levels: [9, 18, 24], stat: 'attackRange',
        values: [0.24, 0.28, 0.32], descs: ['攻击范围提高24%', '攻击范围提高28%', '攻击范围提高32%'] },
    { chain: 101901, card: '68019', name: '废土铁芽', levels: [3, 14, 22], stat: 'attack',
        values: [0.10, 0.12, 0.14], descs: ['攻击提高10%', '攻击提高12%', '攻击提高14%'] },
    { chain: 101902, card: '68019', name: '灵巧投掷', levels: [6, 16, 23], stat: 'attackSpeed',
        values: [0.11, 0.13, 0.15], descs: ['攻击速度提高11%', '攻击速度提高13%', '攻击速度提高15%'] },
    { chain: 102003, card: '68020', name: '废土铁芽', levels: [9, 18, 24], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 102103, card: '68021', name: '废土铁芽', levels: [9, 18, 24], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 102801, card: '68028', name: '废土铁芽', levels: [3, 14, 22], stat: 'attack',
        values: [0.10, 0.12, 0.14], descs: ['攻击提高10%', '攻击提高12%', '攻击提高14%'] },
    { chain: 102802, card: '68028', name: '灵巧投掷', levels: [6, 16, 23], stat: 'attackSpeed',
        values: [0.11, 0.13, 0.15], descs: ['攻击速度提高11%', '攻击速度提高13%', '攻击速度提高15%'] },
    { chain: 102901, card: '68029', name: '菌甲厚化', levels: [1, 14, 22], stat: 'maxHp',
        values: [0.17, 0.20, 0.23], descs: ['最大生命提高17%', '最大生命提高20%', '最大生命提高23%'] },
    { chain: 102902, card: '68029', name: '废土铁芽', levels: [6, 16, 23], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 103001, card: '68030', name: '废土铁芽', levels: [1, 14, 22], stat: 'attack',
        values: [0.17, 0.20, 0.23], descs: ['攻击提高17%', '攻击提高20%', '攻击提高23%'] },
    { chain: 103002, card: '68030', name: '超视孢子', levels: [6, 16, 23], stat: 'attackRange',
        values: [0.24, 0.28, 0.32], descs: ['攻击范围提高24%', '攻击范围提高28%', '攻击范围提高32%'] },
];

/** modifierId = 域前缀(940) + 链尾 4 位 + 档位；与既有 94008011 等同一套编号。*/
function modifierIdOf(chain, level) {
    return 94000000 + (chain % 10000) * 10 + level;
}

const BASE_PLAN = {
    enabled: 1,
    stateMode: 'none',
    maxStacks: 1,
    maxTriggers: 0,
    statusId: null,
    statusStatJson: null,
    behaviorKey: null,
    skillParamJson: null,
    cooldown: 0,
    durationSeconds: 0,
    triggerEvent: 'build',
    targetSelector: 'self',
    skillKind: 'passive_stat',
    passiveScope: 'deployed',
    progressionMode: 'replace',
    sourceVersion: VERSION,
    publishStatus: '可发布',
};

/** 单位 id → 普攻技能行 id（计划行的 pvpSkillId 一律指向本卡普攻行）。*/
function attackSkillIdOf(cards, unitId) {
    const card = cards.find((row) => String(row.id) === unitId);
    if (!card || !card.unitSkillId) throw new Error(`找不到 ${unitId} 的 unitSkillId`);
    return Number(card.unitSkillId);
}

function applyPlan(rows, cards) {
    let written = 0;
    for (const spec of SKILLS) {
        const pvpSkillId = attackSkillIdOf(cards, spec.card);
        spec.levels.forEach((unlock, index) => {
            const level = index + 1;
            //  🔴 已有链必须沿用原 modifierId：68001/68002 那批是 910xxxxx，其余是 940xxxxx。
            //     按新前缀重算会「原地新增一行」，旧行留在表里 ⇒ 同一链同档两行，selectZCSkillPlans
            //     取最后一行，看上去生效、实际改的是另一行。
            const existed = rows.find((row) => Number(row.skillChainId) === spec.chain
                && Number(row.skillLevel) === level);
            const modifierId = existed ? Number(existed.modifierId) : modifierIdOf(spec.chain, level);
            const target = {
                ...BASE_PLAN,
                modifierId,
                unitId: spec.card,
                skillChainId: spec.chain,
                skillName: spec.name,
                skillLevel: level,
                unlockHeroLevel: Math.max(1, unlock),
                pvpSkillId,
                statId: spec.stat,
                operation: 'addRate',
                value: spec.values[index],
                desc: spec.descs[index],
            };
            const hit = rows.findIndex((row) => Number(row.skillChainId) === spec.chain
                && Number(row.skillLevel) === level);
            if (hit >= 0) {
                rows[hit] = { ...rows[hit], ...target };
            } else {
                rows.push(target);
            }
            written += 1;
        });
    }
    return written;
}

function applyArmy(table, cards) {
    let written = 0;
    for (const spec of SKILLS) {
        spec.levels.forEach((unlock, index) => {
            const level = index + 1;
            const hit = table.rows.find((row) => Number(row.id) === spec.chain && Number(row.skilllevel) === level);
            if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${level}（需先补行）`);
            hit.name = spec.name;
            hit.desc = spec.descs[index];
            hit.unlockarmylevel = Math.max(1, unlock);
            written += 1;
        });
    }
    return written;
}

function main() {
    const remotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const clientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const cards = readTable(path.join(REMOTE, 'pvpCard.json')).rows;

    const remote = readTable(remotePath);
    const client = readTable(clientPath);
    const planWritten = applyPlan(remote.rows, cards);
    applyPlan(client.rows, cards);
    writeTable(remotePath, remote);
    writeTable(clientPath, client);

    const armyRemotePath = path.join(REMOTE, 'armySkillLevelUp.json');
    const armyClientPath = path.join(CLIENT, 'armySkillLevelUp.json');
    const armyRemote = readTable(armyRemotePath);
    const armyClient = readTable(armyClientPath);
    const armyWritten = applyArmy(armyRemote, cards);
    applyArmy(armyClient, cards);
    writeTable(armyRemotePath, armyRemote);
    writeTable(armyClientPath, armyClient);

    console.log(`[ok] pvpSkillPlan 写入 ${planWritten} 行 × 2 份；armySkillLevelUp 更新 ${armyWritten} 行 × 2 份`);
}

main();
