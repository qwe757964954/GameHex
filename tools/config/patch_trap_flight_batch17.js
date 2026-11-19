// 第 17 批 · 101704 穿甲爆矢（毒箭蘑菇 68017，2026-11-18）—— 投掷型陷阱 + 爆炸中毒。
//
// 设计案口径（K/L/M 三档）：
//   · 触发 = **累计普攻 8 次**（不是冷却，J 列写的就是 8）；
//   · 朝目标丢陷阱，飞行速度 100（**逻辑 px / 秒**，用户 2026-11-18 裁定）× 2 秒；
//   · 途中触碰敌人立即爆炸：半径 150、180 / 220 / 270%，并中毒 6 秒、每秒 15 / 25 / 35%；
//   · 2 秒内没碰到 ⇒ 落点停留 6 / 8 / 10 秒，期间被触碰同样爆炸，**到期无人触碰直接消失**。
//
// 🔴 三个「照字面配就会静默错」的点
//   1. **不是冷却制**。`trap_place` 原来是 `trapCooldown` 驱动（103504 精密陷阱），
//      101704 是「累计普攻 8 次」⇒ 走 `trapEvery`，用 `unit.trapFiredCount` 单独计数
//      （不复用 `counterFiredCount`：同卡若还有自我增益，共用会互相吃次数）。
//   2. **到期不炸**。既有语义 `expireDamage > 0` 恒等于「到时自爆」（103504 靠它收尾），
//      101704 的「没人踩直接消失」只能靠 `trapExpireOnTimeout: 0` 表达，
//      不能把伤害配成 0（那样踩响了也不掉血）。
//   3. **触碰不掉血**。设计只给了一份伤害（爆炸那一份）⇒ `trapDamageRate` 整个不写；
//      `castTrap` 只在「投掷形态」放行触碰伤害为 0，原地陷阱漏配仍然会拒放。
//
// 🔴 参数一律带 `trap*` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}`（68017:30261）
//    合并成一袋，这袋里还住着 101701 苔针双连 / 101702 噬血蔓延 / 101703 群星坠落。
//
// 🔴 中毒走三行 `pvpStatus`（与 101803 毒液喷吐同一形态：periodic_damage + senderAttack
//    + 1 秒一跳），不写 `__poison:..:..` 动态 id —— 数值留在表里，策划能直接改。
//
// 幂等：按 statusId / modifierId 原地重写，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 101704;
const UNIT_ID = '68017';
const PVP_SKILL_ID = 30261;
const MODIFIER_BASE = 94017040;
const EVERY = 8;
const UNLOCKS = [9, 18, 27];

const FLIGHT_SPEED = 100;   // 逻辑 px / 秒（用户裁定「100px 是每秒」）
const FLIGHT_SECONDS = 2;
const EXPLODE_RADIUS = 150;
const CONTACT_RADIUS = 50;  // 触碰半径：与 103504 精密陷阱同一个口径（表里是 50 逻辑 px）
const EXPLODE_RATES = [1.8, 2.2, 2.7];
const STAY_SECONDS = [6, 8, 10];
const POISON_PCT = [15, 25, 35];
const POISON_SECONDS = 6;

const TIERS = STAY_SECONDS.map((stay, index) => ({
    stay,
    explodeRate: EXPLODE_RATES[index],
    poisonPct: POISON_PCT[index],
    level: index + 1,
}));

const STATUS_ROWS = TIERS.map((tier) => ({
    legacyBuffKey: '穿甲爆矢' + ['I', 'II', 'III'][tier.level - 1],
    statusId: 'poison_bolt_l' + tier.level,
    name: '中毒' + ['I', 'II', 'III'][tier.level - 1],
    durationSeconds: POISON_SECONDS,
    intervalSeconds: 1,
    maxStacks: 1,
    refreshPolicy: 'refresh',
    handlerKey: 'periodic_damage',
    statJson: '{}',
    enabled: 1,
    periodicAmountPct: tier.poisonPct,
    periodicBasis: 'senderAttack',
}));

function descOf(tier) {
    return `累计普攻 ${EVERY} 次：朝目标丢出陷阱，飞行速度 ${FLIGHT_SPEED}px/s、飞行 ${FLIGHT_SECONDS} 秒；`
        + `途中触碰敌人立即爆炸，对半径 ${EXPLODE_RADIUS} 内敌人造成 `
        + `${Math.round(tier.explodeRate * 100)}% 伤害，并使其中毒 ${POISON_SECONDS} 秒、`
        + `每秒 ${tier.poisonPct}% 伤害；若 ${FLIGHT_SECONDS} 秒内没碰到敌人，则在落点停留 `
        + `${tier.stay} 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失`;
}

function paramJson(tier) {
    //  键序固定，方便逐字节比对；`trapDamageRate` 刻意不写（触碰不掉血），
    //  `trapExpireOnTimeout: 0` 就是「到期直接消失」。
    return JSON.stringify({
        trapEvery: EVERY,
        trapFlightSpeed: FLIGHT_SPEED,
        trapFlightSeconds: FLIGHT_SECONDS,
        trapDuration: tier.stay,
        trapRadius: CONTACT_RADIUS,
        trapExplodeRadius: EXPLODE_RADIUS,
        trapExplodeDamageRate: tier.explodeRate,
        trapStatusSeconds: POISON_SECONDS,
        trapExpireOnTimeout: 0,
    });
}

const PLAN_CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statusId', 'statId', 'value',
];

const PLAN_ROWS = TIERS.map((tier) => ({
    enabled: 1,
    modifierId: MODIFIER_BASE + tier.level,
    unitId: UNIT_ID,
    skillChainId: CHAIN,
    skillName: '穿甲爆矢',
    skillLevel: tier.level,
    unlockHeroLevel: UNLOCKS[tier.level - 1],
    //  与 103504 / 101803 一致：主动技能的 kind 一律 active_cd，真正的起手条件在参数里
    //  （这里是 `trapEvery`，不是 `trapCooldown`）。
    skillKind: 'active_cd',
    passiveScope: 'battle',
    progressionMode: 'replace',
    pvpSkillId: PVP_SKILL_ID,
    behaviorKey: 'trap_place',
    stateMode: 'none',
    desc: descOf(tier),
    sourceVersion: VERSION,
    publishStatus: '可发布',
    skillParamJson: paramJson(tier),
    statusId: 'poison_bolt_l' + tier.level,
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
    // ── 一、中毒状态（两份手写产物，pvpStatus 没有源 xlsx）
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
    if (rows.length !== 3) throw new Error(`[fail] 101704 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        const tier = TIERS[index];
        if (row.desc !== descOf(tier)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对：${row.desc}`);
        if (row.statusId !== 'poison_bolt_l' + tier.level) throw new Error('[fail] 第 ' + (index + 1) + ' 档 statusId 不对');
        if (Number(row.unlockHeroLevel) !== UNLOCKS[index]) throw new Error('[fail] 解锁等级不对');
        if (row.behaviorKey !== 'trap_place') throw new Error('[fail] behaviorKey 必须是 trap_place');
        const bag = JSON.parse(row.skillParamJson);
        const bad = Object.keys(bag).filter((key) => !key.startsWith('trap'));
        if (bad.length) throw new Error('[fail] 参数少了 trap 前缀：' + bad);
        if (bag.trapEvery !== EVERY) throw new Error('[fail] trapEvery 必须是 8（设计 J 列）');
        if (bag.trapCooldown !== undefined) throw new Error('[fail] 101704 是累计普攻制，不该有 trapCooldown');
        if (bag.trapFlightSpeed !== FLIGHT_SPEED || bag.trapFlightSeconds !== FLIGHT_SECONDS) {
            throw new Error('[fail] 飞行段参数不对');
        }
        if (bag.trapDuration !== tier.stay) throw new Error('[fail] 停留秒数不对');
        if (bag.trapExplodeRadius !== EXPLODE_RADIUS) throw new Error('[fail] 爆炸半径不对');
        if (bag.trapExpireOnTimeout !== 0) throw new Error('[fail] 必须配「到期直接消失」');
        if (bag.trapDamageRate !== undefined) throw new Error('[fail] 触碰不该有独立伤害（设计只给一份）');
    });
    const statusById = new Map(statusClient.rows.map((row) => [row.statusId, row]));
    for (const tier of TIERS) {
        const row = statusById.get('poison_bolt_l' + tier.level);
        if (!row) throw new Error('[fail] 缺少中毒状态 l' + tier.level);
        if (row.periodicAmountPct !== tier.poisonPct) throw new Error('[fail] 中毒每秒数值不对');
        if (row.durationSeconds !== POISON_SECONDS) throw new Error('[fail] 中毒时长必须是 6 秒');
        if (row.intervalSeconds !== 1 || row.periodicBasis !== 'senderAttack') throw new Error('[fail] 中毒跳数口径不对');
    }
    //  同卡三条既有技能不许被带动
    for (const chain of [101701, 101702, 101703]) {
        const kin = planClient.rows.filter((row) => Number(row.skillChainId) === chain);
        if (kin.length !== 3) throw new Error(`[fail] ${chain} 原有 3 档被动被动了（现在 ${kin.length} 行）`);
        if (kin.some((row) => String(row.unitId) !== UNIT_ID)) throw new Error(`[fail] ${chain} 的 unitId 被改了`);
    }
    //  103504 精密陷阱必须一字不变（同一套参数语义的另一张卡）
    const trap = planClient.rows.filter((row) => Number(row.skillChainId) === 103504);
    if (trap.length !== 3) throw new Error('[fail] 103504 少了档位');
    for (const row of trap) {
        const bag = JSON.parse(row.skillParamJson);
        if (bag.trapCooldown !== 10) throw new Error('[fail] 103504 的 trapCooldown 被改了');
        if (bag.trapFlightSpeed !== undefined) throw new Error('[fail] 103504 不该有飞行段');
        if (bag.trapExpireOnTimeout !== undefined) throw new Error('[fail] 103504 到期要自爆，不该配 0');
    }
    if (statusClient.rows.length !== statusRemote.rows.length) throw new Error('[fail] pvpStatus 两份行数不一致');
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] pvpSkillPlan 两份行数不一致');

    writeTable(path.join(CLIENT_DIR, 'pvpStatus.json'), statusClient);
    writeTable(path.join(REMOTE_DIR, 'pvpStatus.json'), statusRemote);
    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log('[ok] 回读通过：101704 三档 + 三条中毒状态；103504 完好；两份产物行数一致');
}

main();
