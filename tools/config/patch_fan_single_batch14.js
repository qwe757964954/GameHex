// 第 14 批 · 菌丝绞杀 101503（机甲菇 68015）+ 菌丝突刺 101403（分裂菇 68014）。
//
// 用户口径（2026-11-17）：「继续开工」—— 接着第 13 批把待研发清单往下推。
// 这两条是「近身型主动」，各一套命中集合：
//   · `fan_slow`（101503）—— 身前扇形、最多 N 人、带减速；
//   · `single_strike`（101403）—— 贴到最近敌人身边打一发、附带硬控。
// 代码侧同一批新增两条车道（见 `ZCSkillRuntime` 的注册注释）。
//
// 🔴 参数前缀为什么是 `fan` / `single`：
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋。
//   ① 68015 的袋子里**已经有** 101501 的 `splashRadius` / `splashDamageRate`
//      （第 12 批踩过一次）和 101504 的 `burstRadius` / `burstDamageRate`（第 13 批）；
//      裸 `radius` / `damageRate` 会把普攻溅射与爆发半径一起改掉 —— 不报错。
//   ② 68014 的袋子里已经有 101401 的 `comboDamage` / `comboFalloff`；
//      `cooldown` 还与状态表、计划列同名，容易读串。
//
// 幂等：按 modifierId 定位，已存在就原地重写、缺的追加；重跑结果逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const VERSION = '技能设计案2 V11-20261117';

/** 三条链的共同骨架：主动技能、三档 replace、无 statId（机制全在参数袋里）。*/
function baseRow(overrides) {
    return Object.assign({
        enabled: 1,
        modifierId: 0,
        unitId: '',
        skillChainId: 0,
        skillName: '',
        skillLevel: 1,
        unlockHeroLevel: 0,
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: 0,
        stateMode: 'none',
        desc: '',
        sourceVersion: VERSION,
        publishStatus: '可发布',
        statId: null,
        operation: null,
        value: null,
        behaviorKey: 'skill_params',
        skillParamJson: '{}',
        cooldown: null,
        triggerEvent: null,
        targetSelector: null,
        durationSeconds: null,
        maxStacks: null,
        maxTriggers: null,
        statusId: null,
        statusStatJson: null,
    }, overrides);
}

/**
 * 菌丝绞杀（68015 / 101503）：身前 120° 扇形，最多 4/5/6 人，带减速。
 * 设计案 K~M：130% / 40%·2s → 160% / 45%·2s·5 人 → 200% / 50%·2s·6 人；冷却 14/13/12。
 * 解锁按项目规则「技能 3 = 9/18/27」。
 */
const FAN_SWEEP = {
    chain: 101503,
    unitId: '68015',
    pvpSkillId: 30241,
    name: '菌丝绞杀',
    ignite: '菌丝',
    behaviorKey: 'fan_slow',
    tiers: [
        { modifierId: 94015031, unlock: 9, level: 1, damage: 1.3, targets: 4, slow: 40, cooldown: 14 },
        { modifierId: 94015032, unlock: 18, level: 2, damage: 1.6, targets: 5, slow: 45, cooldown: 13 },
        { modifierId: 94015033, unlock: 27, level: 3, damage: 2.0, targets: 6, slow: 50, cooldown: 12 },
    ],
    radius: 150,
    angle: 120,
    slowSeconds: 2,
};

/**
 * 菌丝突刺（68014 / 101403）：扑向最近敌人、打一发、眩晕。
 * 设计案 K~M：150%·眩晕 1s → 180%·1.5s → 220%·2s + 命中后攻速 +30%·4s；冷却 12/12/11。
 * 解锁按「技能 3 = 9/18/27」。
 *
 * ⚠️ `singleSearchRadius` 设计案**没给**：取 300 表值（≈90 世界 px ≈ 2.5 格）。
 * 本卡普攻射程只有 45 表值（约 13 世界 px），所以 300 是实打实的「够不着才扑过去」。
 */
const SINGLE_STRIKE = {
    chain: 101403,
    unitId: '68014',
    pvpSkillId: 30216,
    name: '菌丝突刺',
    ignite: '菌丝',
    behaviorKey: 'single_strike',
    tiers: [
        { modifierId: 94014031, unlock: 9, level: 1, damage: 1.5, stun: 1, cooldown: 12 },
        { modifierId: 94014032, unlock: 18, level: 2, damage: 1.8, stun: 1.5, cooldown: 12 },
        { modifierId: 94014033, unlock: 27, level: 3, damage: 2.2, stun: 2, cooldown: 11, haste: 30 },
    ],
    searchRadius: 300,
    stopDistance: 30,
    hitRadius: 40,
    hasteSeconds: 4,
};

/** 百分比文案：1.3 → `130`；0.40 这种小数也走整数口径。*/
function pct(rate) {
    return String(Math.round(rate * 100));
}

function buildFanRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            fanCooldown: tier.cooldown,
            fanDamageRate: tier.damage,
            fanRadius: spec.radius,
            fanAngle: spec.angle,
            fanMaxTargets: tier.targets,
            fanSlowRatio: tier.slow,
            fanSlowSeconds: spec.slowSeconds,
        };
        const desc = `冷却 ${tier.cooldown} 秒：向身前 ${spec.angle}° 扇形甩出${spec.ignite}，`
            + `对范围内最多 ${tier.targets} 名敌人造成 ${pct(tier.damage)}% 伤害，`
            + `并使其移动速度降低 ${tier.slow}%，持续 ${spec.slowSeconds} 秒`;
        return baseRow({
            modifierId: tier.modifierId,
            unitId: spec.unitId,
            skillChainId: spec.chain,
            skillName: spec.name,
            skillLevel: tier.level,
            unlockHeroLevel: tier.unlock,
            pvpSkillId: spec.pvpSkillId,
            behaviorKey: spec.behaviorKey,
            desc,
            skillParamJson: JSON.stringify(params),
        });
    });
}

function buildSingleRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            singleCooldown: tier.cooldown,
            singleDamageRate: tier.damage,
            singleSearchRadius: spec.searchRadius,
            singleStopDistance: spec.stopDistance,
            singleHitRadius: spec.hitRadius,
            singleStunSeconds: tier.stun,
        };
        let desc = `冷却 ${tier.cooldown} 秒：扑向最近敌人，造成 ${pct(tier.damage)}% 伤害`
            + `并眩晕 ${tier.stun} 秒`;
        if (tier.haste) {
            params.singleHastePct = tier.haste;
            params.singleHasteSeconds = spec.hasteSeconds;
            desc += `；命中后自身攻击速度提高 ${tier.haste}%，持续 ${spec.hasteSeconds} 秒`;
        }
        return baseRow({
            modifierId: tier.modifierId,
            unitId: spec.unitId,
            skillChainId: spec.chain,
            skillName: spec.name,
            skillLevel: tier.level,
            unlockHeroLevel: tier.unlock,
            pvpSkillId: spec.pvpSkillId,
            behaviorKey: spec.behaviorKey,
            desc,
            skillParamJson: JSON.stringify(params),
        });
    });
}

const SPECS = [FAN_SWEEP, SINGLE_STRIKE];
const WANT = [...buildFanRows(FAN_SWEEP), ...buildSingleRows(SINGLE_STRIKE)];

/** 只比两边都有的键（client 产物会把 null 列整列省掉）。*/
function sameRow(left, right) {
    const keys = Object.keys(left).filter((key) => key in right);
    return keys.every((key) => {
        const a = left[key], b = right[key];
        return a === null || b === null || b === undefined ? (a ?? null) === (b ?? null) : String(a) === String(b);
    });
}

/**
 * client 产物的列是转表器裁过的（19 列、无 `operation` / `cooldown` 等整列为空的键）。
 * 追加行必须按同一套列写，否则这一份文件里会混进两种行形状 —— 转表器再跑一次就对不齐了。
 */
const CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus', 'skillParamJson',
    'statId', 'value',
];

function shapeForClient(row) {
    const out = {};
    for (const key of CLIENT_KEYS) out[key] = key in row ? row[key] : null;
    return out;
}

function apply(rows, label, shape) {
    let added = 0, rewritten = 0;
    for (const want of WANT) {
        const index = rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) {
            rows.push(shape(want));
            added += 1;
            continue;
        }
        const current = rows[index];
        if (sameRow(want, current)) continue;
        //  原地重写：既存行的键顺序不动，保证重跑后文件逐字节一致。
        for (const key of Object.keys(current)) {
            if (key in want) current[key] = want[key];
        }
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten} 行、追加 ${added} 行（共 ${rows.length} 行）`);
}

/**
 * 裸键黑名单：这几个键在本卡的其他车道里都有主了，写进来会串道（见文件头）。
 * 只拦「引号 + 键名 + 引号」这种真键，不误伤 `fanRadius` / `fanDamageRate` 这类带前缀的。
 */
const BANNED = [
    '"splashRadius"', '"splashDamageRate"', '"burstRadius"', '"burstDamageRate"',
    '"damageRate"', '"cooldown"', '"radius"',
];

function guard(table, label) {
    const ids = new Set();
    const chains = new Set(SPECS.map((spec) => spec.chain));
    for (const row of table.rows) {
        const id = Number(row.modifierId);
        if (ids.has(id)) throw new Error(`[fail] ${label} modifierId 重复：${id}`);
        ids.add(id);
        if (!chains.has(Number(row.skillChainId))) continue;
        const raw = String(row.skillParamJson ?? '');
        for (const banned of BANNED) {
            if (raw.includes(banned)) {
                throw new Error(`[fail] ${label} ${id} 的参数袋里出现裸键 ${banned}：${raw}`);
            }
        }
        const chain = Number(row.skillChainId);
        const need = chain === FAN_SWEEP.chain ? 'fanCooldown' : 'singleCooldown';
        if (!(need in JSON.parse(raw))) {
            throw new Error(`[fail] ${label} ${id} 缺 ${need}：${raw}`);
        }
    }
}

const remote = readTable(REMOTE);
const client = readTable(CLIENT);
apply(remote.rows, 'remoteRef', (row) => row);
apply(client.rows, 'client', shapeForClient);
guard(remote, 'remoteRef');
guard(client, 'client');
writeTable(REMOTE, remote);
writeTable(CLIENT, client);

//  回读：两条链各三档。
for (const spec of SPECS) {
    const rows = remote.rows.filter((row) => Number(row.skillChainId) === spec.chain)
        .sort((a, b) => a.modifierId - b.modifierId);
    if (rows.length !== 3) throw new Error(`[fail] ${spec.chain} 应有 3 档，实际 ${rows.length}`);
    for (const row of rows) {
        console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} ${row.behaviorKey} ${row.skillParamJson}`);
    }
}

//  串道复核：68015 这张卡上一批 / 上上批的两条车道必须原样还在。
//  裸键守卫只能证明「我没写进去」，这一段才能证明「我没把别人的改跑」。
const splashRows = remote.rows.filter((row) => Number(row.skillChainId) === 101501)
    .sort((a, b) => a.modifierId - b.modifierId);
for (const row of splashRows) {
    if (!String(row.skillParamJson).includes('"splashRadius"')) {
        throw new Error(`[fail] 68015 的普攻溅射键被带跑了：${row.modifierId} ${row.skillParamJson}`);
    }
}
const burstRows = remote.rows.filter((row) => Number(row.skillChainId) === 101504)
    .sort((a, b) => a.modifierId - b.modifierId);
for (const row of burstRows) {
    if (!String(row.skillParamJson).includes('"burstRadius"')) {
        throw new Error(`[fail] 68015 的爆发半径键被带跑了：${row.modifierId} ${row.skillParamJson}`);
    }
}
console.log(`[ok] 68015 既有两条车道完好：普攻溅射 ${splashRows.map((r) => JSON.parse(r.skillParamJson).splashRadius).join('/')}`
    + `、爆发半径 ${[...new Set(burstRows.map((r) => JSON.parse(r.skillParamJson).burstRadius))].join('/')}`);
