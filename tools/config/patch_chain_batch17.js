// 第 17 批 · 102203 闪电链（雷蕉 68022，2026-11-18）—— 纯新增 `chain_damage` 车道。
//
// 设计案口径（K/L/M 三档）：
//   · 冷却 12 秒（J 列）；
//   · I  级（兵种 9 级）：命中 3 个敌人，每个 90%；
//   · II 级（兵种 18 级）：命中 4 个，每个 100%，**每跳损耗 10%**；
//   · III 级（兵种 27 级）：命中 6 个，每个 120%，**最后一跳必定暴击 150%**；
//   · N 列：「连锁跳向最近的未命中敌人，除 II 级起引入的 10% 递减外不再衰减」。
//
// 🔴 三个「照字面配就会静默错」的点
//   1. **递减是复利**。10% 递减 = 第 k 跳 ×(1 − 0.1)^k ⇒ 100 / 90 / 81 / 72.9……，
//      与 `splashFalloff` / `bulletFalloff` / `pierceFalloff` 同一套；写成线性
//      `1 − 0.1k` 前两跳一样、第 6 跳差 10 个百分点，而且没人会去数。
//   2. **`chainFalloff` I 级必须写 0**，不能省。省了读到的也是 0（同一个结果），
//      但下一个人会以为「I 级漏配了递减」而去补一个 0.1，顺手把 I 级改弱。
//   3. **参数一律 `chain*` 前缀**。`skillParamJson` 按 `${unitId}:${pvpSkillId}`
//      （68022:30231）合并成一袋，这袋里还住着 102201 孢子弹幕 / 102202 职业猎杀协议，
//      以后还有 102204 嗜血术（`team_buff`）。裸写 `targetCount` / `falloff` 会串过去。
//
// 🔴 设计没给的唯一一个值：**跳距**（`chainJumpRadius`）。N 列只说「最近的未命中敌人」，
//    没给范围。不设上限时「最近」可能落在半张图之外，那不是闪电链。取 150 逻辑 px
//    （与 101803 毒液喷吐 / 101704 爆炸半径同档），在 P 列里写明这是补的值。
//
// 幂等：按 modifierId 原地重写，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 102203;
const UNIT_ID = '68022';
const PVP_SKILL_ID = 30231;
const MODIFIER_BASE = 94022030;
const COOLDOWN = 12;
const UNLOCKS = [9, 18, 27];
//  跳距（逻辑 px）：设计没给，见文件头第 4 条。
const JUMP_RADIUS = 150;

const TIERS = [
    { level: 1, count: 3, rate: 0.9, falloff: 0, finalCrit: 1 },
    { level: 2, count: 4, rate: 1.0, falloff: 0.1, finalCrit: 1 },
    { level: 3, count: 6, rate: 1.2, falloff: 0.1, finalCrit: 1.5 },
];

const ICONS = ['I', 'II', 'III'];

function descOf(tier) {
    const parts = [
        `冷却 ${COOLDOWN} 秒：朝锁定目标放出闪电链，连锁命中 ${tier.count} 个敌人，`
        + `每个造成 ${Math.round(tier.rate * 100)}% 攻击力伤害`,
    ];
    if (tier.falloff > 0) {
        parts.push(`每跳在上跳基础上再降 ${Math.round(tier.falloff * 100)}%`
            + `（${Math.round(tier.rate * 100)}% → ${Math.round(tier.rate * 100 * (1 - tier.falloff))}% → `
            + `${Math.round(tier.rate * 100 * (1 - tier.falloff) ** 2)}%…）`);
    }
    if (tier.finalCrit > 1) {
        parts.push(`最后一跳必定暴击，伤害 ×${Math.round(tier.finalCrit * 100)}%`);
    }
    return parts.join('；');
}

function paramJson(tier) {
    //  键序固定，方便逐字节比对。`chainFalloff` I 级也显式写 0（理由见文件头第 2 条）；
    //  `chainFinalCritMultiplier` 只在 III 级出现 —— 把它写成 1 会让人以为「I/II 级也有这条路，只是没开」。
    const bag = {
        chainCooldown: COOLDOWN,
        chainTargetCount: tier.count,
        chainDamageRate: tier.rate,
        chainFalloff: tier.falloff,
        chainJumpRadius: JUMP_RADIUS,
    };
    if (tier.finalCrit > 1) bag.chainFinalCritMultiplier = tier.finalCrit;
    return JSON.stringify(bag);
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
    skillName: '闪电链',
    skillLevel: tier.level,
    unlockHeroLevel: UNLOCKS[tier.level - 1],
    //  与 101603 / 103504 / 101803 一致：主动技能 kind 一律 active_cd，
    //  真正的起手条件在参数里（这里是 `chainCooldown`）。
    skillKind: 'active_cd',
    passiveScope: 'battle',
    progressionMode: 'replace',
    pvpSkillId: PVP_SKILL_ID,
    behaviorKey: 'chain_damage',
    stateMode: 'none',
    desc: descOf(tier),
    sourceVersion: VERSION,
    publishStatus: '可发布',
    skillParamJson: paramJson(tier),
    statusId: null,
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

    // ── 回读守卫
    const rows = planClient.rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (rows.length !== 3) throw new Error(`[fail] 102203 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        const tier = TIERS[index];
        if (row.skillName !== '闪电链') throw new Error('[fail] 技能名不对');
        if (row.desc !== descOf(tier)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对：${row.desc}`);
        if (row.behaviorKey !== 'chain_damage') throw new Error('[fail] behaviorKey 必须是 chain_damage');
        if (row.stateMode !== 'none') throw new Error('[fail] stateMode 必须是 none');
        if (Number(row.unlockHeroLevel) !== UNLOCKS[index]) throw new Error('[fail] 解锁等级不对');
        if (Number(row.pvpSkillId) !== PVP_SKILL_ID) throw new Error('[fail] pvpSkillId 不对');
        //  客户端产物里「没有这个键」读出来是 `undefined`（不是 `null`）⇒ 用 `?? null` 归一。
        if ((row.statusId ?? null) !== null || (row.statId ?? null) !== null || (row.value ?? null) !== null) {
            throw new Error('[fail] 闪电链不该带 statusId / statId / value');
        }
        const bag = JSON.parse(row.skillParamJson);
        const bad = Object.keys(bag).filter((key) => !key.startsWith('chain'));
        if (bad.length) throw new Error('[fail] 参数少了 chain 前缀：' + bad);
        if (bag.chainCooldown !== COOLDOWN) throw new Error('[fail] 冷却必须是 12（设计 J 列）');
        if (bag.chainTargetCount !== tier.count) throw new Error('[fail] 跳数不对');
        if (bag.chainDamageRate !== tier.rate) throw new Error('[fail] 每跳倍率不对');
        if (bag.chainFalloff !== tier.falloff) {
            throw new Error('[fail] 递减不对（I 级必须显式 0，II/III 级 0.1）');
        }
        if (bag.chainJumpRadius !== JUMP_RADIUS) throw new Error('[fail] 跳距不对');
        const hasFinalCrit = bag.chainFinalCritMultiplier !== undefined;
        if (hasFinalCrit !== tier.finalCrit > 1) throw new Error('[fail] 终跳强制暴击只在 III 级出现');
        if (hasFinalCrit && bag.chainFinalCritMultiplier !== tier.finalCrit) {
            throw new Error('[fail] 终跳暴击倍率不对');
        }
        if (bag.chainRadius !== undefined || bag.chainTargets !== undefined) {
            throw new Error('[fail] 出现了没被代码读的键（chainRadius / chainTargets）');
        }
    });
    //  同卡三条既有链不许被带动：102201 孢子弹幕 / 102202 职业猎杀协议各 3 档 + 109001 全队增幅 50 档。
    for (const chain of [102201, 102202]) {
        const kin = planClient.rows.filter((row) => Number(row.skillChainId) === chain);
        if (kin.length !== 3) throw new Error(`[fail] ${chain} 原有 3 档被动被动了（现在 ${kin.length} 行）`);
        if (kin.some((row) => String(row.unitId) !== UNIT_ID)) throw new Error(`[fail] ${chain} 的 unitId 被改了`);
    }
    const global = planClient.rows.filter((row) => Number(row.skillChainId) === 109001 && String(row.unitId) === UNIT_ID);
    if (global.length !== 50) throw new Error(`[fail] 109001 全队暴击增幅被动了（现在 ${global.length} 行）`);
    //  101603 五雷轰顶用的是同一个 prefab、同一条「雷」语义，但车道不同（`bolt_strike`），一字不许动。
    const bolt = planClient.rows.filter((row) => Number(row.skillChainId) === 101603);
    if (bolt.length !== 3) throw new Error('[fail] 101603 少了档位');
    for (const row of bolt) {
        if (row.behaviorKey !== 'bolt_strike') throw new Error('[fail] 101603 的 behaviorKey 被改了');
        if (JSON.parse(row.skillParamJson).boltCooldown !== 12) throw new Error('[fail] 101603 的冷却被改了');
    }
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] pvpSkillPlan 两份行数不一致');

    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log('[ok] 回读通过：102203 三档 + 同卡三条既有链完好 + 101603 完好 + 两份行数一致');
}

main();
