// 101704 改名 + 调参（2026-11-19）：穿甲爆矢 → 蘑菇爆炸，飞行速度 100、飞行时间 1.2 秒。
//
// 用户口径（2026-11-19 20:44）
// ─────────────
//   「技能设计案的毒箭蘑菇名字统一为毒箭菇，主动技改为蘑菇爆炸……
//     1. 卡牌朝着目标方向丢出子弹技能，子弹移动速度 70px、移动时间 2s，随后静止不动
//        （移动时间使用的特效：科学家_陷阱生成）
//     2. 技能静止后落在地上（使用 科学家_陷阱），静止时间按等级 6/8/10
//     3. 时间达到直接消失；敌人触碰消失并播放火法师的普攻爆炸特效，爆炸范围造成伤害」
//
// 本脚本只改**表里能表达的部分**：技能名、飞行速度、文案。
//   表现层（飞行段播「生成」、落地播「陷阱」、炸开播「普攻爆炸」）在代码里，见
//   `ZCTrapFx.zcTrapExpirePath` / `ZCGroundZoneSystem.settleFlight`。
//   `trapDuration` 6/8/10、`trapExpireOnTimeout: 0`（到期直接消失）本来就对，不动。
//
// 🔴 触碰不给独立伤害（不写 `trapDamageRate`）：设计只给了一份「爆炸伤害」，
//    踩响只是引爆。`castTrap` 只在投掷形态放行「触碰伤害 0」，不要好心补一个数。
//
// 幂等：按 modifierId 原地重写整行，重跑逐字节相同。
// 用法：node tools/config/patch_mushroom_explosion_101704.js
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');

const CHAIN = 101704;
const UNIT_ID = '68017';
const PVP_SKILL_ID = 30261;
const MODIFIER_BASE = 94017040;
const SKILL_NAME = '蘑菇爆炸';
const EVERY = 8;
const UNLOCKS = [9, 18, 27];

const FLIGHT_SPEED = 100;    // 逻辑 px / 秒（用户 2026-11-19 21:30 口径：70 → 100）
const FLIGHT_SECONDS = 1.2;   // 2026-11-19 21:18 用户口径：2 秒 → 1.2 秒（「生成」只有 0.4 秒，尾帧只多挂 0.8 秒）
const EXPLODE_RADIUS = 150;
const CONTACT_RADIUS = 50;
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

function descOf(tier) {
    return `累计普攻 ${EVERY} 次：朝目标丢出陷阱，飞行速度 ${FLIGHT_SPEED}px/s、飞行 ${FLIGHT_SECONDS} 秒；`
        + `途中触碰敌人立即爆炸，对半径 ${EXPLODE_RADIUS} 内敌人造成 `
        + `${Math.round(tier.explodeRate * 100)}% 伤害，并使其中毒 ${POISON_SECONDS} 秒、`
        + `每秒 ${tier.poisonPct}% 伤害；若 ${FLIGHT_SECONDS} 秒内没碰到敌人，则在落点停留 `
        + `${tier.stay} 秒，期间被敌人触碰同样爆炸，到期无人触碰直接消失`;
}

function paramJson(tier) {
    //  键序固定，方便逐字节比对；`trapDamageRate` 刻意不写（触碰只负责引爆）。
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

const PLAN_ROWS = TIERS.map((tier) => ({
    skillName: SKILL_NAME,
    skillLevel: tier.level,
    unlockHeroLevel: UNLOCKS[tier.level - 1],
    desc: descOf(tier),
    skillParamJson: paramJson(tier),
    modifierId: MODIFIER_BASE + tier.level,
}));

function patch(table, label, file) {
    let rewritten = 0;
    for (const want of PLAN_ROWS) {
        const index = table.rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) throw new Error(`[fail] ${label} 里找不到 modifierId=${want.modifierId}`);
        const row = table.rows[index];
        //  只碰这三格：其余列（unitId / behaviorKey / statusId / statId / unlockHeroLevel …）
        //  原样保留 —— 本批不是「重建这一行」，是「改名 + 调一个数」。
        let dirty = false;
        for (const key of ['skillName', 'desc', 'skillParamJson']) {
            if (row[key] !== want[key]) {
                row[key] = want[key];
                dirty = true;
            }
        }
        if (dirty) rewritten += 1;
    }
    if (rewritten) writeTable(file, table);
    console.log(`[ok] ${label}：重写 ${rewritten} 行`);
}

function main() {
    const clientFile = path.join(CLIENT_DIR, 'pvpSkillPlan.json');
    const client = readTable(clientFile);
    patch(client, 'pvpSkillPlan(client)', clientFile);

    const remoteFile = path.join(REMOTE_DIR, 'pvpSkillPlan.json');
    const remote = readTable(remoteFile);
    patch(remote, 'pvpSkillPlan(remoteRef)', remoteFile);

    //  回读守卫：三档必须同名声、飞行 70、停留 6/8/10、到期不炸、触碰不掉血。
    const rows = client.rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (rows.length !== 3) throw new Error(`[fail] 101704 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        const tier = TIERS[index];
        if (row.skillName !== SKILL_NAME) throw new Error(`[fail] 第 ${index + 1} 档技能名不对：${row.skillName}`);
        if (row.desc !== descOf(tier)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对`);
        if (Number(row.unitId) !== Number(UNIT_ID)) throw new Error(`[fail] 第 ${index + 1} 档 unitId 被改了`);
        if (row.behaviorKey !== 'trap_place') throw new Error('[fail] behaviorKey 必须是 trap_place');
        const bag = JSON.parse(row.skillParamJson);
        if (bag.trapFlightSpeed !== FLIGHT_SPEED) throw new Error(`[fail] 飞行速度必须是 ${FLIGHT_SPEED}`);
        if (bag.trapFlightSeconds !== FLIGHT_SECONDS) throw new Error('[fail] 飞行时间必须是 1.2 秒');
        if (bag.trapDuration !== tier.stay) throw new Error('[fail] 停留秒数不对');
        if (bag.trapExpireOnTimeout !== 0) throw new Error('[fail] 必须配「到期直接消失」');
        if (bag.trapDamageRate !== undefined) throw new Error('[fail] 触碰不该有独立伤害');
    });

    //  别把同卡的另外三条链带跑（一卡一袋：68017:30261 这袋里还住着 101701~101703）。
    for (const chain of [101701, 101702, 101703]) {
        const kin = client.rows.filter((row) => Number(row.skillChainId) === chain);
        if (kin.length !== 3) throw new Error(`[fail] ${chain} 原有 3 档被动被动了（现在 ${kin.length} 行）`);
    }
    //  103504 精密陷阱是同一套参数语义的另一张卡，必须一字不变。
    const scientist = client.rows.filter((row) => Number(row.skillChainId) === 103504);
    if (scientist.length !== 3) throw new Error('[fail] 103504 少了档位');
    for (const row of scientist) {
        const bag = JSON.parse(row.skillParamJson);
        if (bag.trapCooldown !== 10) throw new Error('[fail] 103504 的 trapCooldown 被改了');
        if (bag.trapFlightSpeed !== undefined) throw new Error('[fail] 103504 不该有投掷段');
    }
    console.log('[ok] 回读守卫通过');
}

main();
