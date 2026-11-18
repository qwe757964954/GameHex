// 第 15 批 · 菌盾冲锋 101204（菇八戒 68012）+ 冲锋 102303（南瓜战神 68023）
//          + 尖刺冲锋 102703（爆锤莲王 68027）。
//
// 用户口径（2026-11-17）：「开工的话先做 charge_shield + legacy_dash」。
// 三条都是「位移 + 沿路径撞人」，两条 behaviorKey：
//   · `charge_shield`（101204）—— 朝目标方向定长 1 格，撞到的敌人吃伤害，落地给自己护盾；
//   · `legacy_dash`（102303 / 102703）—— 一条朝最近敌人 + 眩晕、一条朝面朝 + 易伤/破甲。
// 代码侧同一批新增两条车道（见 `ZCSkillRuntime` 的注册注释）。
//
// 🔴 参数前缀为什么是 `charge` / `dash`：
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋。
//   ① `68027:30241` 的袋子里**已经有** 102701 的 `splashRadius` / `splashDamageRate`
//      / `splashFalloff`（普攻溅射）与 102702 的 `lancePierceCount` / `lanceDamageRate`（投枪）
//      ⇒ 裸 `radius` / `damageRate` 会把普攻溅射与投枪一起改掉，**不报错**。
//   ② `68012:30271` 有 101203 的 `mix.critRate`；`68023:30216` 有 102301 的
//      `teamAura0Radius` 与 102302 的 `mix.critRate`。
//   ③ `cooldown` 与 `pvpSkillPlan` 的列名、`pvpStatus` 的列名都撞车，读日志时最容易串。
//
// ⚠️ 设计案**没给**的两处（已记进 `docs/design/技能全量研发档案_20261116.md` 的疑问清单）：
//   · 冲锋格数：102303 取 3 格（朝最近敌人，要够得到人）、102703 取 2 格（朝面朝，定长短冲）；
//   · 102703 III 级护盾没有时长，取 4 秒（与 101204 III 级同档）。
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
 * 菌盾冲锋（68012 / 101204）：朝目标方向定长 1 格 + 落点自护盾。
 * 设计案 K~M：100% / 护盾 12%·3s → 120% / 15%·3s → 140% / 18%·4s；冷却恒 12。
 * 解锁按「技能 4 = 12/24/36」。
 */
const CHARGE_SHIELD = {
    chain: 101204,
    unitId: '68012',
    pvpSkillId: 30271,
    name: '菌盾冲锋',
    behaviorKey: 'charge_shield',
    tiers: [
        { modifierId: 94012041, unlock: 12, level: 1, damage: 1.0, shield: 0.12, shieldSeconds: 3 },
        { modifierId: 94012042, unlock: 24, level: 2, damage: 1.2, shield: 0.15, shieldSeconds: 3 },
        { modifierId: 94012043, unlock: 36, level: 3, damage: 1.4, shield: 0.18, shieldSeconds: 4 },
    ],
    cooldown: 12,
    cells: 1,
    hitRadius: 40,
};

/**
 * 冲锋（68023 / 102303）：朝**最近敌人**冲 + 眩晕，III 级落地减伤。
 * 设计案 K~M：100%·眩晕 1s → 140%·1.5s → 220%·2s + 受伤 −25%·3s；冷却恒 12。
 * 解锁按「技能 3 = 9/18/27」。
 */
const DASH_CHARGE = {
    chain: 102303,
    unitId: '68023',
    pvpSkillId: 30216,
    name: '冲锋',
    behaviorKey: 'legacy_dash',
    tiers: [
        { modifierId: 94023031, unlock: 9, level: 1, damage: 1.0, stun: 1 },
        { modifierId: 94023032, unlock: 18, level: 2, damage: 1.4, stun: 1.5 },
        { modifierId: 94023033, unlock: 27, level: 3, damage: 2.2, stun: 2, guard: 25, guardSeconds: 3 },
    ],
    cooldown: 12,
    cells: 3,
    hitRadius: 40,
    towardNearest: 1,
    searchRadius: 300,
};

/**
 * 尖刺冲锋（68027 / 102703）：朝**面朝方向**冲 + 易伤/破甲，III 级落地自护盾。
 * 设计案 K~M：120% → 160% + 受伤 +20%·4s → 220% + 破甲 35%·6s + 护盾 20% 最大生命。
 * 解锁按「技能 3 = 9/18/27」。
 */
const DASH_SPIKE = {
    chain: 102703,
    unitId: '68027',
    pvpSkillId: 30241,
    name: '尖刺冲锋',
    behaviorKey: 'legacy_dash',
    tiers: [
        { modifierId: 94027031, unlock: 9, level: 1, damage: 1.2 },
        { modifierId: 94027032, unlock: 18, level: 2, damage: 1.6, vuln: 20, vulnSeconds: 4 },
        { modifierId: 94027033, unlock: 27, level: 3, damage: 2.2, vuln: 35, vulnSeconds: 6, shield: 0.2, shieldSeconds: 4 },
    ],
    cooldown: 12,
    cells: 2,
    hitRadius: 40,
    towardNearest: 0,
};

/** 百分比文案：1.3 → `130`；0.12 这种比例也走整数口径。*/
function pct(rate) {
    return String(Math.round(rate * 100));
}

function buildChargeRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            chargeCooldown: spec.cooldown,
            chargeDamageRate: tier.damage,
            chargeCells: spec.cells,
            chargeHitRadius: spec.hitRadius,
            chargeShieldRatio: tier.shield,
            chargeShieldSeconds: tier.shieldSeconds,
        };
        const desc = `冷却 ${spec.cooldown} 秒：向目标方向冲撞 ${spec.cells} 格，`
            + `对撞到的敌人造成 ${pct(tier.damage)}% 伤害，`
            + `并为自己附加 ${pct(tier.shield)}% 最大生命的护盾，持续 ${tier.shieldSeconds} 秒`;
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

function buildDashRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            dashCooldown: spec.cooldown,
            dashDamageRate: tier.damage,
            dashCells: spec.cells,
            dashHitRadius: spec.hitRadius,
            dashTowardNearest: spec.towardNearest,
        };
        if (spec.towardNearest) params.dashSearchRadius = spec.searchRadius;
        let desc = spec.towardNearest
            ? `冷却 ${spec.cooldown} 秒：向最近敌人冲锋，对路径上的敌人造成 ${pct(tier.damage)}% 伤害`
            : `冷却 ${spec.cooldown} 秒：向前方冲锋，对路径上的敌人造成 ${pct(tier.damage)}% 伤害`;
        if (tier.stun) {
            params.dashStunSeconds = tier.stun;
            desc += `，并眩晕 ${tier.stun} 秒`;
        }
        if (tier.vuln) {
            params.dashVulnerablePct = tier.vuln;
            params.dashVulnerableSeconds = tier.vulnSeconds;
            //  II 级设计案写「受到伤害提高」，III 级写「破甲」—— 同一个机制的两档措辞，
            //  都在 `damageTakenPct` 上，所以文案跟着档位走、参数只留一条。
            desc += tier.level >= 3
                ? `，破甲 ${tier.vuln}%，持续 ${tier.vulnSeconds} 秒`
                : `，并使目标受到的伤害提高 ${tier.vuln}%，持续 ${tier.vulnSeconds} 秒`;
        }
        if (tier.guard) {
            params.dashGuardReducePct = tier.guard;
            params.dashGuardSeconds = tier.guardSeconds;
            desc += `；冲锋结束后自身受到伤害降低 ${tier.guard}%，持续 ${tier.guardSeconds} 秒`;
        }
        if (tier.shield) {
            params.dashShieldRatio = tier.shield;
            params.dashShieldSeconds = tier.shieldSeconds;
            desc += `；冲锋结束后自身获得 ${pct(tier.shield)}% 最大生命的护盾，持续 ${tier.shieldSeconds} 秒`;
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

const SPECS = [CHARGE_SHIELD, DASH_CHARGE, DASH_SPIKE];
const WANT = [
    ...buildChargeRows(CHARGE_SHIELD),
    ...buildDashRows(DASH_CHARGE),
    ...buildDashRows(DASH_SPIKE),
];

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
 * 只拦「引号 + 键名 + 引号」这种真键，不误伤 `chargeCells` / `dashCells` 这类带前缀的。
 */
const BANNED = [
    '"splashRadius"', '"splashDamageRate"', '"burstRadius"', '"burstDamageRate"',
    '"lanceDamageRate"', '"lancePierceCount"', '"damageRate"', '"cooldown"', '"radius"',
];

/** 每条链必须带自己那一条 CD 键 —— 少了它整条车道静默不跑（`applyXxx` 第一行就 return）。*/
const REQUIRED_KEY = { 101204: 'chargeCooldown', 102303: 'dashCooldown', 102703: 'dashCooldown' };

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
        const need = REQUIRED_KEY[Number(row.skillChainId)];
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

//  回读：三条链各三档。
for (const spec of SPECS) {
    const rows = remote.rows.filter((row) => Number(row.skillChainId) === spec.chain)
        .sort((a, b) => a.modifierId - b.modifierId);
    if (rows.length !== 3) throw new Error(`[fail] ${spec.chain} 应有 3 档，实际 ${rows.length}`);
    for (const row of rows) {
        console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} ${row.behaviorKey} ${row.skillParamJson}`);
    }
}

//  串道复核：68027 这张卡上两批的两条车道必须原样还在。
//  裸键守卫只能证明「我没写进去」，这一段才能证明「我没把别人的改跑」。
const splashRows = remote.rows.filter((row) => Number(row.skillChainId) === 102701)
    .sort((a, b) => a.modifierId - b.modifierId);
const splashRadii = splashRows.map((row) => JSON.parse(row.skillParamJson).splashRadius);
if (splashRadii.join('/') !== '38/46/55') {
    throw new Error(`[fail] 68027 的普攻溅射被带跑了：${splashRadii.join('/')}`);
}
const lanceRows = remote.rows.filter((row) => Number(row.skillChainId) === 102702)
    .sort((a, b) => a.modifierId - b.modifierId);
for (const row of lanceRows) {
    if (!String(row.skillParamJson).includes('"lanceEvery"')) {
        throw new Error(`[fail] 68027 的投枪键被带跑了：${row.modifierId} ${row.skillParamJson}`);
    }
}
console.log(`[ok] 68027 既有两条车道完好：普攻溅射 ${splashRadii.join('/')}、`
    + `投枪每 ${lanceRows.map((r) => JSON.parse(r.skillParamJson).lanceEvery).join('/')} 次`);
