// 第 17 批 · 101904 生命爆发 / 102704 战神附体（2026-11-18）——「累计普攻 N 次」自我增益。
//
// 车道 `counter_self_buff` 已经在本批落好（`ZCSkillTriggerService.applyCounterBuff`），
// 这两条**纯配表**：
//
//   101904 生命爆发（窝瓜人 68019，链 101904，累计普攻 10，6 秒）
//     L1 移速 +50% / 体型 ×2 / 最大生命 +15%
//     L2 移速 +80% / 体型 ×2 / 最大生命 +30%
//     L3 移速 +100% / 体型 ×2 / 最大生命 +50%
//   102704 战神附体（爆锤莲王 68027，链 102704，累计普攻 10，6 秒）
//     L1 体型 ×2 / 移速 −15% / 攻击 +50% + 释放回 15% 最大生命
//     L2 攻击 +70%   L3 攻击 +100%
//
// 🔴 `counterBodySizePct` 是**百分点**（100 = 体型 ×2），不是比例：
//    写成 1 就是「只大 1%」，写成 2 是「大 2%」—— 这类错表里看不出来，进游戏才发现「没变大」。
// 🔴 参数一律带 `counter*` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，
//    68027 那袋里还住着 102701 / 102702 / 102703 三条技能，裸写 `moveSpeedPct` 会串过去。
// 🔴 解锁等级照设计案 L1/L2/L3 的「兵种 12 / 24 / 36 级」。
//
// 幂等：按 modifierId 原地重写 / 追加，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const VERSION = '技能设计案2 V13-20261118';

/** 转表产物的列序（照 101504 那条 active_cd 行的真实顺序，null 整列省）。*/
const CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statId', 'value',
];

const SKILLS = [
    {
        chain: 101904, unitId: '68019', name: '生命爆发', pvpSkillId: 30191, base: 94019040,
        tiers: [
            { moveSpeedPct: 50, bodySizePct: 100, maxHpPct: 15 },
            { moveSpeedPct: 80, bodySizePct: 100, maxHpPct: 30 },
            { moveSpeedPct: 100, bodySizePct: 100, maxHpPct: 50 },
        ],
        descOf: (t) => `累计普攻 10 次：移动速度提高 ${t.moveSpeedPct}%、体型放大为 2 倍、`
            + `最大生命提高 ${t.maxHpPct}%，持续 6 秒`,
    },
    {
        chain: 102704, unitId: '68027', name: '战神附体', pvpSkillId: 30241, base: 94027040,
        tiers: [
            { attackPct: 50, bodySizePct: 100, moveSpeedPct: -15 },
            { attackPct: 70, bodySizePct: 100, moveSpeedPct: -15 },
            { attackPct: 100, bodySizePct: 100, moveSpeedPct: -15 },
        ],
        descOf: (t) => `累计普攻 10 次：体型放大为 2 倍、移动速度降低 15%、攻击力提高 ${t.attackPct}%，`
            + `持续 6 秒；释放瞬间回复 15% 最大生命`,
    },
];

const UNLOCKS = [12, 24, 36];

/** 参数袋：键序固定，方便逐字节比对。所有键都带 `counter` 前缀。*/
function paramJson(skill, tier) {
    const bag = { counterEvery: 10, counterSeconds: 6 };
    if (tier.bodySizePct) bag.counterBodySizePct = tier.bodySizePct;
    if (tier.moveSpeedPct) bag.counterMoveSpeedPct = tier.moveSpeedPct;
    if (tier.attackPct) bag.counterAttackPct = tier.attackPct;
    if (tier.maxHpPct) bag.counterMaxHpPct = tier.maxHpPct;
    //  102704 的「释放瞬间回 15% 最大生命」写在 own 参数上，两条技能共用同一口径。
    if (skill.chain === 102704) bag.counterHealMaxHpPct = 15;
    return JSON.stringify(bag);
}

const WANT = [];
for (const skill of SKILLS) {
    skill.tiers.forEach((tier, index) => {
        WANT.push({
            enabled: 1,
            modifierId: skill.base + index + 1,
            unitId: skill.unitId,
            skillChainId: skill.chain,
            skillName: skill.name,
            skillLevel: index + 1,
            unlockHeroLevel: UNLOCKS[index],
            skillKind: 'active_cd',
            passiveScope: 'battle',
            progressionMode: 'replace',
            pvpSkillId: skill.pvpSkillId,
            behaviorKey: 'counter_self_buff',
            stateMode: 'none',
            desc: skill.descOf(tier),
            sourceVersion: VERSION,
            publishStatus: '可发布',
            skillParamJson: paramJson(skill, tier),
            statId: null,
            value: null,
            tier,
        });
    });
}

const WANT_IDS = new Set(WANT.map((row) => row.modifierId));

function shapeForClient(row) {
    const out = {};
    for (const key of CLIENT_KEYS) {
        if (!(key in row)) continue;
        const value = row[key];
        if (value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}

function sameRow(left, right) {
    for (const key of Object.keys(left)) {
        const a = left[key] ?? null;
        const b = key in right ? (right[key] ?? null) : null;
        if (a !== b) return false;
    }
    for (const key of Object.keys(right)) {
        if (key in left) continue;
        if ((right[key] ?? null) !== null) return false;
    }
    return true;
}

function apply(table, label, shape) {
    let added = 0;
    let rewritten = 0;
    for (const want of WANT) {
        const shaped = shape(want);
        const index = table.rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) {
            table.rows.push(shaped);
            added += 1;
            continue;
        }
        if (sameRow(shaped, table.rows[index])) continue;
        table.rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten} 行、追加 ${added} 行（共 ${table.rows.length} 行）`);
}

/** 守卫：号段没被占、既有三条技能不被带跑、体型的量级正确。*/
function guard(table, label) {
    for (const row of table.rows) {
        const id = Number(row.modifierId);
        if (!WANT_IDS.has(id)) continue;
        if (String(row.skillKind) !== 'active_cd') throw new Error(`[fail] ${label} ${id} 必须是 active_cd`);
        if (String(row.behaviorKey) !== 'counter_self_buff') throw new Error(`[fail] ${label} ${id} behaviorKey 不对`);
        const bag = JSON.parse(row.skillParamJson || '{}');
        for (const key of Object.keys(bag)) {
            if (!key.startsWith('counter')) throw new Error(`[fail] ${label} ${id} 参数 ${key} 少了 counter 前缀（会串到同卡其他技能）`);
        }
        //  🔴 体型是百分点：100 = ×2。落在 (0, 300] 之外一律判错。
        const size = bag.counterBodySizePct;
        if (size === undefined || !(size > 0 && size <= 300)) {
            throw new Error(`[fail] ${label} ${id} 的 counterBodySizePct=${size} 不像百分点（100 = ×2）`);
        }
        if (bag.counterEvery !== 10) throw new Error(`[fail] ${label} ${id} 的 counterEvery 必须是 10`);
        if (bag.counterSeconds !== 6) throw new Error(`[fail] ${label} ${id} 的 counterSeconds 必须是 6`);
    }
    //  同卡既有技能必须原样：68027 的 102701~102703、68019 的 101901~101903。
    const keep = [[101901, '68019'], [101902, '68019'], [101903, '68019'],
        [102701, '68027'], [102702, '68027'], [102703, '68027']];
    for (const [chain, unitId] of keep) {
        const rows = table.rows.filter((row) => Number(row.skillChainId) === chain);
        if (rows.length !== 3) throw new Error(`[fail] ${label} ${chain} 原有 3 档被动被动了（现在 ${rows.length} 行）`);
        if (rows.some((row) => String(row.unitId) !== unitId)) {
            throw new Error(`[fail] ${label} ${chain} 的 unitId 被改了`);
        }
    }
}

function verify(table, label) {
    for (const skill of SKILLS) {
        const rows = table.rows.filter((row) => Number(row.skillChainId) === skill.chain)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        if (rows.length !== 3) throw new Error(`[fail] ${label} ${skill.chain} 应有 3 档，实际 ${rows.length}`);
        const descs = rows.map((row) => row.desc);
        rows.forEach((row, index) => {
            const want = skill.descOf(skill.tiers[index]);
            if (row.desc !== want) throw new Error(`[fail] ${label} ${skill.chain} 第 ${index + 1} 档 desc 不对：${row.desc}`);
            if (Number(row.unlockHeroLevel) !== UNLOCKS[index]) {
                throw new Error(`[fail] ${label} ${skill.chain} 第 ${index + 1} 档解锁等级应为 ${UNLOCKS[index]}`);
            }
            if (Number(row.pvpSkillId) !== skill.pvpSkillId) {
                throw new Error(`[fail] ${label} ${skill.chain} 第 ${index + 1} 档 pvpSkillId 应为 ${skill.pvpSkillId}`);
            }
        });
        if (new Set(descs).size !== 3) throw new Error(`[fail] ${label} ${skill.chain} 三档文案不该重复`);
    }
    console.log(`[ok] ${label} 回读通过：2 条链 × 3 档，同卡既有被动完好`);
}

function main() {
    const remote = readTable(REMOTE);
    const client = readTable(CLIENT);
    guard(remote, 'remoteRef');
    guard(client, 'client');
    apply(remote, 'remoteRef', (row) => {
        const shaped = {};
        for (const key of remote.keys) {
            shaped[key] = key in row ? row[key] : null;
        }
        return shaped;
    });
    apply(client, 'client', shapeForClient);
    verify(remote, 'remoteRef');
    verify(client, 'client');
    writeTable(REMOTE, remote);
    writeTable(CLIENT, client);
}

main();
