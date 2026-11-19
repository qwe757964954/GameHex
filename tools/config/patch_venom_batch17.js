// 第 17 批 · 101803 毒液喷吐（诅咒菇 68018，2026-11-18）—— 范围伤害 + 中毒 + III 级降治疗。
//
// 设计案拆解后的口径：四周 100 / 130 / 180%，中毒 4 / 5 / 6 秒、每秒 20 / 25 / 35%，
// III 级「中毒期间受到的治疗降低 50%」。
//
// 🔴 参数带 `venom` 前缀、CD 单独一个 `venomReadyAt`
//    `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，而 68018 这袋里已经住着
//    **菌核爆裂 101804**（`burstCooldown` / `burstDamageRate` / `burstRadius` / `burstKnockbackCells`）。
//    裸写 `burstRadius` 会让「毒液喷吐的 150」把菌核爆裂的半径改掉 —— 不报错，只是数值莫名变了。
//    所以 101803 整条走 `venom*`：触发侧按 lane 取前缀（`applyBurstSkill(..., 'venom')`），
//    `castBurstSkill` 一份实现两套前缀，CD 也各记各的（`venomReadyAt`）。
//
// 🔴 中毒不走动态注册，而是三行 `pvpStatus`
//    `pvpStatus` **没有源 xlsx**（`patch_pvp_status_numb.py` 核过：扫遍 PVP-*.xlsx 没有状态页签），
//    真源就是 `assets/remoteRef` + `doc/塔防数据配置/json/client` 两份手写产物。
//    按已有 `burn_ignite_l1~l3` 的形态补三行（periodic_damage + senderAttack + 1 秒一跳）：
//    数值留在表里，策划能直接改，不必回来改代码。
//
// 幂等：按 statusId / modifierId 原地重写，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 101803;
const UNIT_ID = '68018';
const PVP_SKILL_ID = 30667;
const MODIFIER_BASE = 94018030;
const COOLDOWN = 12;   // 设计案 J 列写「待定」⇒ 按同类范围技能取 12（菌核爆裂 14 / 菌毯爆发 16），待确认
const RADIUS = 150;    // 设计案没给半径 ⇒ 与同卡的菌核爆裂一致，待确认
const UNLOCKS = [9, 18, 27];

const POISON_TIERS = [
    { pct: 20, seconds: 4, name: 'I' },
    { pct: 25, seconds: 5, name: 'II' },
    { pct: 35, seconds: 6, name: 'III' },
];
const BURST_RATES = [1.0, 1.3, 1.8];

const STATUS_ROWS = POISON_TIERS.map((tier, index) => ({
    legacyBuffKey: '毒液喷吐' + tier.name,
    statusId: 'poison_venom_l' + (index + 1),
    name: '中毒' + tier.name,
    durationSeconds: tier.seconds,
    intervalSeconds: 1,
    maxStacks: 1,
    refreshPolicy: 'refresh',
    handlerKey: 'periodic_damage',
    //  III 级「中毒期间受到的治疗降低 50%」：与 `frostbite` 的 `moveSpeedPct` 同一写法。
    statJson: index === 2 ? '{"healTakenRate":-50}' : '{}',
    enabled: 1,
    periodicAmountPct: tier.pct,
    periodicBasis: 'senderAttack',
}));

function descOf(index) {
    const tier = POISON_TIERS[index];
    let text = `冷却 ${COOLDOWN} 秒：向四周喷吐毒液，对半径 ${RADIUS} 内敌人造成 `
        + `${Math.round(BURST_RATES[index] * 100)}% 伤害，并使其中毒 ${tier.seconds} 秒、`
        + `每秒 ${tier.pct}% 伤害`;
    if (index === 2) text += '；中毒期间目标受到的治疗降低 50%';
    return text;
}

const PLAN_CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statusId', 'statId', 'value',
];

const PLAN_ROWS = POISON_TIERS.map((_, index) => ({
    enabled: 1,
    modifierId: MODIFIER_BASE + index + 1,
    unitId: UNIT_ID,
    skillChainId: CHAIN,
    skillName: '毒液喷吐',
    skillLevel: index + 1,
    unlockHeroLevel: UNLOCKS[index],
    skillKind: 'active_cd',
    passiveScope: 'battle',
    progressionMode: 'replace',
    pvpSkillId: PVP_SKILL_ID,
    behaviorKey: 'burst_aura',
    stateMode: 'none',
    desc: descOf(index),
    sourceVersion: VERSION,
    publishStatus: '可发布',
    skillParamJson: JSON.stringify({
        venomCooldown: COOLDOWN,
        venomDamageRate: BURST_RATES[index],
        venomRadius: RADIUS,
    }),
    statusId: 'poison_venom_l' + (index + 1),
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

function apply(table, label, wants, look, shape) {
    let added = 0;
    let rewritten = 0;
    for (const want of wants) {
        const shaped = shape(want);
        const index = table.rows.findIndex((row) => row[look] === want[look]);
        if (index < 0) { table.rows.push(shaped); added += 1; continue; }
        if (sameRow(shaped, table.rows[index])) continue;
        table.rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten}、追加 ${added}（共 ${table.rows.length} 行）`);
}

function packedShape(table, row) {
    const shaped = {};
    for (const key of table.keys) shaped[key] = key in row ? row[key] : null;
    return shaped;
}

function main() {
    // ── 一、中毒状态（两份手写产物）
    const statusClient = readTable(path.join(CLIENT_DIR, 'pvpStatus.json'));
    const statusRemote = readTable(path.join(REMOTE_DIR, 'pvpStatus.json'));
    apply(statusClient, 'pvpStatus(client)', STATUS_ROWS, 'statusId',
        (row) => { const out = {}; for (const key of Object.keys(row)) if (row[key] !== null) out[key] = row[key]; return out; });
    apply(statusRemote, 'pvpStatus(remoteRef)', STATUS_ROWS, 'statusId',
        (row) => packedShape(statusRemote, row));

    // ── 二、技能计划行
    const planClient = readTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'));
    const planRemote = readTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'));
    const shapePlan = (row) => {
        const out = {};
        for (const key of PLAN_CLIENT_KEYS) if (row[key] !== null) out[key] = row[key];
        return out;
    };
    apply(planClient, 'pvpSkillPlan(client)', PLAN_ROWS, 'modifierId', shapePlan);
    apply(planRemote, 'pvpSkillPlan(remoteRef)', PLAN_ROWS, 'modifierId',
        (row) => packedShape(planRemote, row));

    // ── 三、回读守卫
    const rows = planClient.rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (rows.length !== 3) throw new Error(`[fail] 101803 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        if (row.desc !== descOf(index)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对：${row.desc}`);
        if (row.statusId !== 'poison_venom_l' + (index + 1)) throw new Error(`[fail] 第 ${index + 1} 档 statusId 不对`);
        const bag = JSON.parse(row.skillParamJson);
        const bad = Object.keys(bag).filter((key) => !key.startsWith('venom'));
        if (bad.length) throw new Error(`[fail] 第 ${index + 1} 档参数少了 venom 前缀：${bad}`);
        if (bag.venomRadius !== RADIUS || bag.venomCooldown !== COOLDOWN) throw new Error('[fail] 半径 / 冷却不对');
        if (Number(row.behaviorKey !== 'burst_aura')) throw new Error('[fail] behaviorKey 必须是 burst_aura');
    });
    const statusById = new Map(statusClient.rows.map((row) => [row.statusId, row]));
    for (let index = 0; index < POISON_TIERS.length; index += 1) {
        const tier = POISON_TIERS[index];
        const row = statusById.get('poison_venom_l' + (index + 1));
        if (!row) throw new Error('[fail] 缺少中毒状态 ' + index);
        if (row.periodicAmountPct !== tier.pct || row.durationSeconds !== tier.seconds) throw new Error('[fail] 中毒数值不对');
        if (row.intervalSeconds !== 1 || row.periodicBasis !== 'senderAttack') throw new Error('[fail] 中毒跳数口径不对');
    }
    if (statusById.get('poison_venom_l3').statJson !== '{"healTakenRate":-50}') throw new Error('[fail] III 级降治疗没写');
    if (statusById.get('poison_venom_l1').statJson !== '{}') throw new Error('[fail] I 级不该带减治疗');
    //  同卡的菌核爆裂不许被带动
    const burst = planClient.rows.filter((row) => Number(row.skillChainId) === 101804);
    if (burst.length !== 3 || burst.some((row) => !String(row.skillParamJson).includes('burstRadius'))) {
        throw new Error('[fail] 101804 菌核爆裂被改坏了');
    }
    //  两份产物的行数必须一致
    if (statusClient.rows.length !== statusRemote.rows.length) throw new Error('[fail] pvpStatus 两份行数不一致');
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] pvpSkillPlan 两份行数不一致');

    writeTable(path.join(CLIENT_DIR, 'pvpStatus.json'), statusClient);
    writeTable(path.join(REMOTE_DIR, 'pvpStatus.json'), statusRemote);
    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log('[ok] 回读通过：101803 三档 + 三条中毒状态；101804 完好；两份产物行数一致');
}

main();
