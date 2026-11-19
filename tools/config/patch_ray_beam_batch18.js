/**
 * 第 18 批：103503「射线集束」（科学家 68035）—— 从 `skill_params` 换车道到 `ray_beam`。
 *
 * 为什么是「整袋换」而不是「改个数」
 * ─────────────────────────────
 * 表里这三行现在的 `behaviorKey` 是 `skill_params`，袋里装的是**副轨主动**的四键
 * （`secondaryCooldown / secondaryDamageRate / secondaryFanDeg / secondaryRadiusScale`），
 * 而 `desc` 早就是「向前方射出集束射线」的射线口径 —— 名字与参数对不上，实际放出来的是
 * 「身前扇形甩一下」，玩家看不出来、测试也测不到（第 17 批 103103 舞王召唤同一个病）。
 *
 * 按设计案 P 列的口径处理：`behaviorKey` 与整袋参数一起换，旧 `secondary*` 四键
 * **显式断言一个不剩**。行数不变（2311 原地重写，不是新加链）。
 *
 * 🔴 参数一律 `ray*` 前缀
 *   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，`68035:30709` 这一袋里
 *   还住着 103501 穿甲苔刺（`normalPierceCount`）、103502 苔针双连（`bulletFalloff` / `mix.*`）、
 *   103504 精密陷阱（`trap*`）。裸写 `radius` / `seconds` 会串到那三条，而且**不报错**。
 *
 * 设计没给的值（P 列里逐条写明是补的）
 * ─────────────────────────────────
 *   · 射线半长 120 / 半宽 36：设计只说「向前方射出」没给尺寸。长宽比取 120:36 = 3.33，
 *     与复用的美术（磁电菇「磁电冲击」横向雷电束，180:54）**同比例** —— 比例不一致会把
 *     一道光束拉成一块板子，而判定照旧、只有画面歪。
 *   · 起点前移 30：射线从身前一点点开始，不从脚底开始（101604 同一条口径）。
 *   · 破甲残留 0.3 秒：N 列要求「目标离开射线立即停止结算」，残留必须比一跳（0.2s）稍长、
 *     又远短于整段，才不会变成「射线走了人还虚着」。
 *   · 末端光斑半径 60：III 级「光斑」的范围没给，取比射线半宽（36）大一档，
 *     让「炸开」比光束本身更宽一点。
 *
 * 幂等：按 `modifierId` 原地重写，重跑逐字节相同。
 * 用法：node tools/config/patch_ray_beam_batch18.js
 */
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const CHAIN = 103503;

const SPEC = {
    unitId: '68035',
    pvpSkillId: 30709,
    name: '射线集束',
    unlocks: [9, 18, 27],
    behaviorKey: 'ray_beam',
    //  设计 I 列是「主动-累计普攻 8」⇒ 触发靠次数，`rayEvery` 三档同值。
    every: 8,
    interval: 0.2,
    halfLength: 120,
    halfWidth: 36,
    forward: 30,
    vulnSeconds: 0.3,
    spotRadius: 60,
    tiers: [
        { seconds: 2, rate: 0.2, vuln: 0, spotRate: 0 },
        { seconds: 3, rate: 0.25, vuln: 10, spotRate: 0 },
        { seconds: 4, rate: 0.35, vuln: 20, spotRate: 0.5 },
    ],
};

function bag(tier, index) {
    const out = {
        rayEvery: SPEC.every,
        rayHalfLength: SPEC.halfLength,
        rayHalfWidth: SPEC.halfWidth,
        rayForward: SPEC.forward,
        raySeconds: tier.seconds,
        rayInterval: SPEC.interval,
        rayDamageRate: tier.rate,
    };
    if (tier.vuln > 0) {
        //  I 级没有破甲：显式写 0 而不是省略 —— 省了读到的也是 0，但下一个人会以为漏配。
        out.rayVulnPct = tier.vuln;
        out.rayVulnSeconds = SPEC.vulnSeconds;
    } else {
        out.rayVulnPct = 0;
    }
    if (index === 2) {
        out.raySpotRadius = SPEC.spotRadius;
        out.raySpotDamageRate = tier.spotRate;
    }
    return out;
}

function desc(tier, index) {
    const parts = [`累计普攻 ${SPEC.every} 次后向前方射出集束射线（每秒 5 跳），`
        + `持续 ${tier.seconds} 秒，每 ${SPEC.interval} 秒对命中敌人造成 ${Math.round(tier.rate * 100)}% 伤害`];
    if (tier.vuln > 0) parts.push(`并使命中目标受到的伤害提高 ${tier.vuln}%`);
    if (index === 2) parts.push('射线末端光斑额外造成 50% 范围伤害');
    return parts.join('，');
}

const PLAN_CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statusId', 'statId', 'value',
];

/** `94000000 + (chain − 100000) × 10`，与既有各链同一套编码（103503 ⇒ 94035031~33）。*/
function modifierIdsOf(chain) {
    const base = 94000000 + (chain - 100000) * 10;
    return [base + 1, base + 2, base + 3];
}

function rowsOf() {
    const ids = modifierIdsOf(CHAIN);
    return SPEC.tiers.map((tier, index) => ({
        enabled: 1,
        modifierId: ids[index],
        unitId: SPEC.unitId,
        skillChainId: CHAIN,
        skillName: SPEC.name,
        skillLevel: index + 1,
        unlockHeroLevel: SPEC.unlocks[index],
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: SPEC.pvpSkillId,
        behaviorKey: SPEC.behaviorKey,
        stateMode: 'none',
        desc: desc(tier, index),
        sourceVersion: VERSION,
        publishStatus: '可发布',
        skillParamJson: JSON.stringify(bag(tier, index)),
        statusId: null,
        statId: null,
        value: null,
    }));
}

function sameRow(left, right) {
    for (const key of Object.keys(left)) {
        const a = left[key] ?? null;
        const b = key in right ? (right[key] ?? null) : null;
        if (a !== b) return false;
    }
    return true;
}

function apply(table, label, wants, shape) {
    let rewritten = 0;
    for (const want of wants) {
        const shaped = shape(want);
        const index = table.rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) {
            //  这条链**必须**已经存在三行（第 17 批之前就建好了占位）。
            //  追加等于「多出三条没有 modifier 的链」，说明表被人动过 ⇒ 直接报错。
            throw new Error(`[fail] ${label} 找不到 modifierId ${want.modifierId}，这条链应已存在三行`);
        }
        if (sameRow(shaped, table.rows[index])) continue;
        table.rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten}（共 ${table.rows.length} 行）`);
}

/** 旧袋子里的四键一个都不许剩 —— 剩下的表现是「射线放出来，实际还是扇形」。*/
const LEGACY_KEYS = [
    'secondaryCooldown', 'secondaryDamageRate', 'secondaryFanDeg', 'secondaryRadiusScale',
];

function verify(rows, kind) {
    const ids = modifierIdsOf(CHAIN);
    const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (plan.length !== 3) throw new Error(`[fail] ${kind} 应有 3 档，实际 ${plan.length}`);
    plan.forEach((row, index) => {
        const tier = SPEC.tiers[index];
        const label = `${kind} 第 ${index + 1} 档`;
        if (row.behaviorKey !== SPEC.behaviorKey) throw new Error(`[fail] ${label} behaviorKey 不对：${row.behaviorKey}`);
        if (Number(row.modifierId) !== ids[index]) throw new Error(`[fail] ${label} 修改器号不对`);
        if (row.skillName !== SPEC.name) throw new Error(`[fail] ${label} 技能名不对：${row.skillName}`);
        if (row.desc !== desc(tier, index)) throw new Error(`[fail] ${label} desc 不对：${row.desc}`);
        if (row.skillKind !== 'active_cd') throw new Error(`[fail] ${label} skillKind 必须是 active_cd`);
        if (Number(row.unitId) !== Number(SPEC.unitId)) throw new Error(`[fail] ${label} unitId 不对`);
        if (Number(row.pvpSkillId) !== SPEC.pvpSkillId) throw new Error(`[fail] ${label} pvpSkillId 不对`);
        if (Number(row.unlockHeroLevel) !== SPEC.unlocks[index]) throw new Error(`[fail] ${label} 解锁等级不对`);
        if ((row.statusId ?? null) !== null || (row.statId ?? null) !== null || (row.value ?? null) !== null) {
            throw new Error(`[fail] ${label} 不该带 statusId / statId / value`);
        }
        const got = JSON.parse(row.skillParamJson);
        const want = bag(tier, index);
        const bad = Object.keys(got).filter((key) => !key.startsWith('ray'));
        if (bad.length) throw new Error(`[fail] ${label} 参数少了 ray 前缀：${bad}`);
        for (const key of LEGACY_KEYS) {
            if (key in got) throw new Error(`[fail] ${label} 旧袋子没清干净：${key}`);
        }
        for (const key of Object.keys(want)) {
            if (got[key] !== want[key]) throw new Error(`[fail] ${label} 参数 ${key} 不对：${got[key]} ≠ ${want[key]}`);
        }
        if (Object.keys(got).length !== Object.keys(want).length) {
            throw new Error(`[fail] ${label} 参数键数量不对：${Object.keys(got)}`);
        }
    });
}

function main() {
    const planClient = readTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'));
    const planRemote = readTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'));
    const before = planClient.rows.length;
    const shapePlan = (row) => {
        const out = {};
        for (const key of PLAN_CLIENT_KEYS) if (row[key] !== null) out[key] = row[key];
        return out;
    };
    const shapePacked = (row) => {
        const out = {};
        for (const key of planRemote.keys) out[key] = key in row ? row[key] : null;
        return out;
    };

    const wants = rowsOf();
    apply(planClient, 'pvpSkillPlan(client) 103503', wants, shapePlan);
    apply(planRemote, 'pvpSkillPlan(remoteRef) 103503', wants, shapePacked);

    verify(planClient.rows, 'client');
    verify(planRemote.rows, 'remoteRef');

    if (planClient.rows.length !== before) throw new Error('[fail] 行数变了（这条链应原地改写，不追加）');
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] 两份行数不一致');

    //  同卡邻居不许被带动：这四条链挤在 `68035:30709` 同一袋参数上。
    for (const kin of [103501, 103502, 103504]) {
        const rows = planClient.rows.filter((row) => Number(row.skillChainId) === kin);
        if (rows.length !== 3) throw new Error(`[fail] ${kin} 原有 3 档被动了（现在 ${rows.length}）`);
        for (const row of rows) {
            const got = JSON.parse(row.skillParamJson ?? '{}');
            if (Object.keys(got).some((key) => key.startsWith('ray'))) {
                throw new Error(`[fail] ray 参数串进了同卡 ${kin}`);
            }
        }
    }

    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log(`[ok] 回读通过：103503 三档换车道 ${SPEC.behaviorKey}（共 ${planClient.rows.length} 行）`
        + ' + 旧 secondary* 四键已清 + 同卡邻居完好 + 两份行数一致');
}

main();
