// 101404 一人成军（分裂菇 68014）口径补全（2026-11-19 第 26 批）。
//
// 用户口径（2026-11-19 21:05）
// ─────────────
//   「分裂菇的 一人成军 可以简单理解为分身技能，触发技能，在本体位置召唤出 3/4/6 只新的分裂菇，
//     新的分裂菇 攻击力/生命值 只有本体的 30%/50%/80%，移动、攻击速度、攻击范围属性与本体一致，
//     也会去寻找敌人攻击，分身的数量不加入单位计算数量，场上最多同时存在 12 个技能召唤出来的分裂菇，
//     召唤出来的分裂菇血量为 0 才消失，当超过 12 个的个数限制时，分裂菇不释放该召唤技能（一人成军）」
//
// 本脚本只补表里能表达的两项新参数 + 文案（3/4/6 只、30/50/80% 本来就对，不动）：
//   · `summonMaxAlive: 12`      —— 场上同兵种召唤物同时存在上限（超限整批拒放）；
//   · `summonIndependent: 1`    —— 独立分身：自己寻路追人 / 本体阵亡不散 / 不占单位上限名额。
//   第三条「不加入单位计算数量」在 `ZCUnitRegistry.count`（代码），表里没有对应的数。
//
// 幂等：按 modifierId 原地重写整行，重跑逐字节相同。
// 用法：node tools/config/patch_split_shroom_summon.js
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');

const CHAIN = 101404;
const UNIT_ID = '68014';
const MODIFIER_BASE = 94014040;
const SKILL_NAME = '一人成军';
const EVERY = 8;
const UNLOCKS = [9, 18, 27];
const COUNTS = [3, 4, 6];
const INHERITS = [0.3, 0.5, 0.8];
const MAX_ALIVE = 12;

const TIERS = COUNTS.map((count, index) => ({
    level: index + 1,
    count,
    inherit: INHERITS[index],
}));

const pct = (value) => Math.round(value * 100);

function descOf(tier) {
    return `累计普攻 ${EVERY} 次后在本体位置召唤 ${tier.count} 只分裂菇分身：`
        + `每只继承本体 ${pct(tier.inherit)}% 攻击力与 ${pct(tier.inherit)}% 生命值，`
        + '移动速度、攻击速度、攻击范围与本体一致；分身自己寻找敌人攻击，不计入单位上限，'
        + '只有血量归零才消失（本体阵亡也不会散）；'
        + `场上最多同时存在 ${MAX_ALIVE} 只技能召唤的分裂菇，再召会超过上限时本次不释放该技能`;
}

function paramJson(tier) {
    //  键序固定，方便逐字节比对。`summonSeconds` 刻意不写 ⇒ 到战死为止（用户口径「血量为 0 才消失」）。
    return JSON.stringify({
        summonEvery: EVERY,
        summonCount: tier.count,
        summonHpInherit: tier.inherit,
        summonAttackInherit: tier.inherit,
        summonMaxAlive: MAX_ALIVE,
        summonIndependent: 1,
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
        //  只碰这三格：其余列（unitId / behaviorKey / statusId / triggerEvent …）原样保留。
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

    //  回读守卫：三档必须 3/4/6 只、30/50/80%、上限 12、独立分身、不写秒数、不跟随。
    const rows = client.rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (rows.length !== 3) throw new Error(`[fail] 101404 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        const tier = TIERS[index];
        if (row.skillName !== SKILL_NAME) throw new Error(`[fail] 第 ${tier.level} 档技能名不对：${row.skillName}`);
        if (row.desc !== descOf(tier)) throw new Error(`[fail] 第 ${tier.level} 档 desc 不对`);
        if (String(row.unitId) !== UNIT_ID) throw new Error(`[fail] 第 ${tier.level} 档 unitId 被改了`);
        if (row.behaviorKey !== 'summon_unit') throw new Error('[fail] behaviorKey 必须是 summon_unit');
        const bag = JSON.parse(row.skillParamJson);
        if (bag.summonEvery !== EVERY) throw new Error(`[fail] 触发阈值必须是累计普攻 ${EVERY} 次`);
        if (bag.summonCount !== tier.count) throw new Error(`[fail] 第 ${tier.level} 档数量不对`);
        if (bag.summonHpInherit !== tier.inherit) throw new Error(`[fail] 第 ${tier.level} 档生命继承不对`);
        if (bag.summonAttackInherit !== tier.inherit) throw new Error(`[fail] 第 ${tier.level} 档攻击继承不对`);
        if (bag.summonMaxAlive !== MAX_ALIVE) throw new Error(`[fail] 场上上限必须是 ${MAX_ALIVE}`);
        if (bag.summonIndependent !== 1) throw new Error('[fail] 必须是独立分身');
        if ('summonSeconds' in bag) throw new Error('[fail] 到战死为止，不许写秒数');
        if ('summonCooldown' in bag) throw new Error('[fail] 累计普攻制与冷却制互斥');
        if ('summonFollow' in bag) throw new Error('[fail] 独立分身不跟随');
    });

    //  一卡一袋：68014:30171 这袋里还住着 101401~101403 三条被动，一行都不许动。
    for (const chain of [101401, 101402, 101403]) {
        const kin = client.rows.filter((row) => Number(row.skillChainId) === chain);
        if (kin.length !== 3) throw new Error(`[fail] ${chain} 原有 3 档被动被动了（现在 ${kin.length} 行）`);
    }
    //  舞王 103103 是同一套 `summon_unit` 语义的另一张卡：没有上限、有到期秒数，必须一字不变。
    const dancer = client.rows.filter((row) => Number(row.skillChainId) === 103103);
    if (dancer.length !== 3) throw new Error('[fail] 103103 少了档位');
    for (const row of dancer) {
        const bag = JSON.parse(row.skillParamJson);
        if (bag.summonMaxAlive !== undefined) throw new Error('[fail] 103103 不该有场上上限');
        if (bag.summonIndependent !== undefined) throw new Error('[fail] 103103 不是独立分身');
        if (!(bag.summonSeconds > 0)) throw new Error('[fail] 103103 的到期秒数被改了');
    }
    console.log('[ok] 回读守卫通过');
}

main();
