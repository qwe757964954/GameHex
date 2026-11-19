// 第 17 批 · 102104 巨型仙人掌（仙人侍卫 68021，2026-11-18）—— 变身型光环：每秒伤害 + 变大 + 反弹。
//
// 设计案 K/L/M 三档：
//   「体积变大 30%，身周出现尖刺风暴，每秒对附近的敌人造成 50% 伤害，持续 6 秒，期间反弹 50/51/52% 伤害」
//
// 三档只差「反弹百分比」一个数，其余（30% 体型、50% 每秒、6 秒）三档同值 —— 照设计案写。
//
// 🔴 车道是 `self_aura`（已有），本批只多两个参数
//   · `auraBodySizePct` = 30（**百分点**：100 = ×2，所以 30 就是 +30% ⇒ 缩放 1.3；
//     写成 0.3 会变成「大 0.3%」，表里看不出来、进游戏才发现没变大）；
//   · `auraReflectPct` = 50/51/52（百分点，消费点 `ZCDamageResolutionSystem.applyReflect`）。
//   两项与既有的 `auraSelfDamagePct` 并进**同一条**状态（`selfCastStatusId` 词缀签名），
//   生命周期都是「光环开着才成立」，分开挂会在 6 秒里出现三个图标。
//
// ⚠ 两个设计没给的值（P 列已标注待确认）
//   · 冷却：设计 J 列写「待定」⇒ 取 12（与同批 101803 / 同量级光环 102603 一致）；
//   · 半径：设计只说「附近/身周」⇒ 取 120（与近战型光环 102403 冰山陨落同档）。
//
// 幂等：按 modifierId 原地重写，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 102104;
const UNIT_ID = '68021';
const PVP_SKILL_ID = 30221;
const MODIFIER_BASE = 94021040;
const COOLDOWN = 12;
const RADIUS = 120;
const SECONDS = 6;
const INTERVAL = 1;
const DAMAGE_RATE = 0.5;
const BODY_SIZE_PCT = 30;
const REFLECT_PCT = [50, 51, 52];
const UNLOCKS = [12, 24, 36];

const CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statId', 'value',
];

function descOf(index) {
    return `冷却 ${COOLDOWN} 秒：体积变大 30%，身周出现尖刺风暴，每秒对半径 ${RADIUS} 内的敌人造成 `
        + `${Math.round(DAMAGE_RATE * 100)}% 伤害，持续 ${SECONDS} 秒，期间反弹 ${REFLECT_PCT[index]}% 伤害`;
}

const ROWS = REFLECT_PCT.map((reflect, index) => ({
    enabled: 1,
    modifierId: MODIFIER_BASE + index + 1,
    unitId: UNIT_ID,
    skillChainId: CHAIN,
    skillName: '巨型仙人掌',
    skillLevel: index + 1,
    unlockHeroLevel: UNLOCKS[index],
    skillKind: 'active_cd',
    passiveScope: 'battle',
    progressionMode: 'replace',
    pvpSkillId: PVP_SKILL_ID,
    behaviorKey: 'self_aura',
    stateMode: 'none',
    desc: descOf(index),
    sourceVersion: VERSION,
    publishStatus: '可发布',
    skillParamJson: JSON.stringify({
        auraCooldown: COOLDOWN,
        auraSeconds: SECONDS,
        auraInterval: INTERVAL,
        auraRadius: RADIUS,
        auraDamageRate: DAMAGE_RATE,
        auraBodySizePct: BODY_SIZE_PCT,
        auraReflectPct: reflect,
    }),
    statId: null,
    value: null,
}));

function sameRow(left, right) {
    for (const key of Object.keys(left)) {
        const a = left[key] ?? null;
        const b = key in right ? (right[key] ?? null) : null;
        if (a !== b) return false;
    }
    return true;
}

function apply(table, label, shape) {
    let added = 0;
    let rewritten = 0;
    for (const want of ROWS) {
        const shaped = shape(want);
        const index = table.rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) { table.rows.push(shaped); added += 1; continue; }
        if (sameRow(shaped, table.rows[index])) continue;
        table.rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten}、追加 ${added}（共 ${table.rows.length} 行）`);
}

function main() {
    const client = readTable(CLIENT);
    const remote = readTable(REMOTE);
    apply(client, 'pvpSkillPlan(client)', (row) => {
        const out = {};
        for (const key of CLIENT_KEYS) if (row[key] !== null) out[key] = row[key];
        return out;
    });
    apply(remote, 'pvpSkillPlan(remoteRef)', (row) => {
        const out = {};
        for (const key of remote.keys) out[key] = key in row ? row[key] : null;
        return out;
    });

    //  回读守卫
    const rows = client.rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (rows.length !== 3) throw new Error(`[fail] 102104 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        if (row.desc !== descOf(index)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对`);
        if (Number(row.unlockHeroLevel) !== UNLOCKS[index]) throw new Error('[fail] 解锁等级不对');
        if (row.behaviorKey !== 'self_aura') throw new Error('[fail] behaviorKey 必须是 self_aura');
        const bag = JSON.parse(row.skillParamJson);
        const bad = Object.keys(bag).filter((key) => !key.startsWith('aura'));
        if (bad.length) throw new Error('[fail] 参数少了 aura 前缀：' + bad);
        if (bag.auraBodySizePct !== BODY_SIZE_PCT) throw new Error('[fail] 体型必须是百分点 30（= ×1.3）');
        if (bag.auraReflectPct !== REFLECT_PCT[index]) throw new Error('[fail] 反弹百分比不对');
        if (bag.auraSeconds !== SECONDS || bag.auraInterval !== INTERVAL) throw new Error('[fail] 时长/间隔不对');
        if (bag.auraDamageRate !== DAMAGE_RATE) throw new Error('[fail] 每秒倍率必须是 0.5');
        if (bag.auraCooldown !== COOLDOWN) throw new Error('[fail] 冷却不对');
    });
    //  同卡既有三条被动不许被带动
    const kin = client.rows.filter((row) => Number(row.skillChainId) === 102103);
    if (kin.length !== 3 || kin.some((row) => String(row.unitId) !== UNIT_ID)) {
        throw new Error('[fail] 102103 废土铁芽被改坏了');
    }
    if (client.rows.length !== remote.rows.length) {
        throw new Error(`[fail] 两份产物行数不一致：${client.rows.length} vs ${remote.rows.length}`);
    }

    writeTable(CLIENT, client);
    writeTable(REMOTE, remote);
    console.log('[ok] 回读通过：102104 三档（反弹 50/51/52）+ 102103 完好 + 两份行数一致');
}

main();
