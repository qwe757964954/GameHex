// 第 17 批 · 103103 舞王召唤（艺术家 68031，2026-11-18）—— 纯新增 `summon_unit` 车道。
//
// 设计案口径（设计案第 155 行，K/L/M 三档）：
//   · 冷却 12 秒（J 列）；
//   · 三档都是 **4 个**舞伴僵尸（半透明）；
//   · I  级（兵种 9 级）：继承本体 80% 生命 / 60% 攻击，持续 6 秒；
//   · II 级（兵种 18 级）：90% / 70%，持续 7 秒；
//   · III 级（兵种 27 级）：100% / 80%，持续 8 秒；
//   · N 列：「舞伴跟随本体移动（取消原圆形硬范围），并主动攻击离自己最近的敌人；
//     只做普攻与被动，不计入单位上限，到期一起消失」。
//
// 🔴 这不是「改个数」而是一次**整袋换车道**
//   表里这行原本是 `self_cast`（`selfCastDamagePct=240` 本体限时增伤），desc 却早就是
//   召唤口径 —— 名字与参数不是一件事。设计案 P 列明确要求「等 summon_unit 落地时把这
//   条参数整体换掉」，所以本脚本把 `behaviorKey` 和**整袋参数**一起换，并把旧
//   `selfCastCooldown / selfCastSeconds / selfCastDamagePct` 三个键显式断言「一个不许残留」。
//   留着它们不会报错，只会让下一个人以为「这技能还会给自己增伤」。
//
// 🔴 参数一律 `summon*` 前缀
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}`（68031:30706）合并成一袋，这袋里还住着
//   103101 共生信号·迅（`team_aura`）/ 103102 抗性装甲协议（`skill_params`）/
//   103104 迪斯科旋风（`skill_params` + `zoneSelfCentered`）。哪天再挂一条带 `count` /
//   `seconds` 的车道，裸键就会串到别人身上，而且**不报错**。
//
// 🔴 冷却另开槽位
//   同一个 `68031:30706` 袋里 103104 也要 `selfCastReadyAt`。召唤用自己的
//   `summonReadyAt`（见 `ZCGameTypes.ZCUnitState`），所以这里的 `summonCooldown`
//   不需要跟谁对齐，只按设计 J 列的 12 秒写。
//
// 🔴 设计没给、必须补的两个值（都在 P 列写明是补的）
//   1. **半透明度 `summonAlpha`**：N 列只说「半透明」。取 0.60（= 视图 153/255），
//      再淡就看不清是僵尸、再实就跟本体分不出来。三档同值 —— 设计没做档位区分。
//   2. **阵位半径 `summonSlotRadius`**：O 列写「半径约 60px」。60 是**逻辑 px**，
//      与 `auraRadius` / `splashRadius` 同一套表值口径，代码里再乘
//      `combatDistanceScale`，所以这里原样写 60。
//
// 幂等：按 modifierId 原地重写，重跑逐字节相同（行数恒 2299）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 103103;
const UNIT_ID = '68031';
const PVP_SKILL_ID = 30706;
const MODIFIER_BASE = 94031030;
const SKILL_NAME = '舞王召唤';
const COOLDOWN = 12;
const UNLOCKS = [9, 18, 27];
const COUNT = 4;
const FOLLOW = 1;
const SLOT_RADIUS = 60;
//  设计只写「半透明」，没给数 —— 见文件头第 4 条。
const ALPHA = 0.6;

const TIERS = [
    { level: 1, hp: 0.8, attack: 0.6, seconds: 6 },
    { level: 2, hp: 0.9, attack: 0.7, seconds: 7 },
    { level: 3, hp: 1.0, attack: 0.8, seconds: 8 },
];

const pct = (value) => Math.round(value * 100);

function descOf(tier) {
    return `冷却 ${COOLDOWN} 秒：召唤 ${COUNT} 个半透明舞伴僵尸跟随本体，`
        + `继承舞王 ${pct(tier.hp)}% 生命值和 ${pct(tier.attack)}% 攻击力，持续 ${tier.seconds} 秒；`
        + '舞伴只做普攻，主动攻击离自己最近的敌人，不计入单位上限，到期一起消失';
}

function paramJson(tier) {
    //  键序固定，方便逐字节比对。`summonSeconds` 三档都有值（101404 一人成军才是
    //  「不写 = 到战死」那条分支，这里不适用）。
    const bag = {
        summonCooldown: COOLDOWN,
        summonCount: COUNT,
        summonHpInherit: tier.hp,
        summonAttackInherit: tier.attack,
        summonSeconds: tier.seconds,
        summonFollow: FOLLOW,
        summonSlotRadius: SLOT_RADIUS,
        summonAlpha: ALPHA,
    };
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
    skillName: SKILL_NAME,
    skillLevel: tier.level,
    unlockHeroLevel: UNLOCKS[tier.level - 1],
    //  与 102203 / 101603 / 103504 一致：主动技能 kind 一律 active_cd，
    //  真正的起手条件在参数里（这里是 `summonCooldown`）。
    skillKind: 'active_cd',
    passiveScope: 'battle',
    progressionMode: 'replace',
    pvpSkillId: PVP_SKILL_ID,
    behaviorKey: 'summon_unit',
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
    const rowsBefore = planClient.rows.length;
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
    if (rows.length !== 3) throw new Error(`[fail] 103103 应有 3 档，实际 ${rows.length}`);
    rows.forEach((row, index) => {
        const tier = TIERS[index];
        if (row.skillName !== SKILL_NAME) throw new Error('[fail] 技能名不对');
        if (row.desc !== descOf(tier)) throw new Error(`[fail] 第 ${index + 1} 档 desc 不对：${row.desc}`);
        //  整袋换车道的第一条断言：behaviorKey 必须是新车道。
        if (row.behaviorKey !== 'summon_unit') throw new Error('[fail] behaviorKey 必须是 summon_unit');
        if (row.skillKind !== 'active_cd') throw new Error('[fail] skillKind 必须是 active_cd');
        if (row.stateMode !== 'none') throw new Error('[fail] stateMode 必须是 none');
        if (Number(row.unlockHeroLevel) !== UNLOCKS[index]) throw new Error('[fail] 解锁等级不对');
        if (Number(row.pvpSkillId) !== PVP_SKILL_ID) throw new Error('[fail] pvpSkillId 不对');
        //  客户端产物里「没有这个键」读出来是 `undefined`（不是 `null`）⇒ 用 `?? null` 归一。
        if ((row.statusId ?? null) !== null || (row.statId ?? null) !== null || (row.value ?? null) !== null) {
            throw new Error('[fail] 舞王召唤不该带 statusId / statId / value');
        }
        const bag = JSON.parse(row.skillParamJson);
        const bad = Object.keys(bag).filter((key) => !key.startsWith('summon'));
        if (bad.length) throw new Error('[fail] 参数少了 summon 前缀：' + bad);
        //  第二条断言：旧 self_cast 那套键一个都不许残留（留着不报错，只会误导人）。
        const stale = ['selfCastCooldown', 'selfCastSeconds', 'selfCastDamagePct']
            .filter((key) => key in bag);
        if (stale.length) throw new Error('[fail] 旧 self_cast 参数没清掉：' + stale);
        if (bag.summonCooldown !== COOLDOWN) throw new Error('[fail] 冷却必须是 12（设计 J 列）');
        if (bag.summonCount !== COUNT) throw new Error('[fail] 舞伴数量必须是 4（三档同值）');
        if (bag.summonHpInherit !== tier.hp) throw new Error('[fail] 生命继承不对');
        if (bag.summonAttackInherit !== tier.attack) throw new Error('[fail] 攻击继承不对');
        if (bag.summonSeconds !== tier.seconds) throw new Error('[fail] 持续时间不对');
        if (bag.summonFollow !== FOLLOW) throw new Error('[fail] 必须跟随本体（N 列取消硬范围）');
        if (bag.summonSlotRadius !== SLOT_RADIUS) throw new Error('[fail] 阵位半径必须是 60（O 列）');
        if (bag.summonAlpha !== ALPHA) throw new Error('[fail] 半透明度必须是补的 0.6');
        //  三个代码不读的键名，防止「照设计 P 列的字面名字」写进来（followOwner / duration / autoAttack）。
        for (const key of ['summonFollowOwner', 'summonDuration', 'summonAutoAttack', 'summonRadius']) {
            if (key in bag) throw new Error('[fail] 出现代码不读的键：' + key);
        }
    });
    //  同卡另三条链各 3 档不许被带动（这袋共用，写错前缀就会串过去）。
    for (const [chain, keys] of [
        [103101, ['teamAura0Radius', 'teamAura0MoveSpeedPct', 'mix.attack.addRate']],
        [103102, ['mix.critRate', 'mix.attack.addRate']],
        [103104, ['damageRate', 'zoneSelfCentered']],
    ]) {
        const kin = planClient.rows.filter((row) => Number(row.skillChainId) === chain);
        if (kin.length !== 3) throw new Error(`[fail] ${chain} 原有 3 档被动被动了（现在 ${kin.length} 行）`);
        if (kin.some((row) => String(row.unitId) !== UNIT_ID)) throw new Error(`[fail] ${chain} 的 unitId 被改了`);
        for (const row of kin) {
            const bag = JSON.parse(row.skillParamJson);
            for (const key of keys) {
                if (!(key in bag)) throw new Error(`[fail] ${chain} 第 ${row.skillLevel} 档丢了 ${key}`);
            }
            if (Object.keys(bag).some((key) => key.startsWith('summon'))) {
                throw new Error(`[fail] 召唤参数串进了 ${chain}`);
            }
        }
    }
    const global = planClient.rows.filter((row) => Number(row.skillChainId) === 109001 && String(row.unitId) === UNIT_ID);
    if (global.length !== 50) throw new Error(`[fail] 109001 全队增幅被动了（现在 ${global.length} 行）`);
    //  行数必须一字不变：这是「整袋换掉」不是「新加一条链」。
    if (planClient.rows.length !== rowsBefore) {
        throw new Error(`[fail] 行数变了 ${rowsBefore} → ${planClient.rows.length}（应为原地重写）`);
    }
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] pvpSkillPlan 两份行数不一致');

    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log(`[ok] 回读通过：103103 三档换成 summon_unit（${rowsBefore} 行原地重写）`
        + ' + 同卡 103101/103102/103104 完好 + 两份行数一致');
}

main();
