// 第 13 批 · 菌毯爆发 101504（菌壶菇 68015）+ 菌核爆裂 101804（菌王菇 68018）。
//
// 用户口径（2026-11-17）：「继续做下一阶段的技能」—— 接着第 12 批把「新主动车道」往下推。
// 这两条是「以自身为圆心爆一次」，与第 12 批「射一枚会爆的弹」正好互补：
//   前者圆心恒等于自己、全向、不需要锁定目标；后者圆心由命中点决定、要先选中一个目标。
// 代码侧同一批新增了 `burst_aura` / `burst_knockback` 车道
// （见 `ZCSkillRuntime` 的注册注释与 `ZCAttackResolutionSystem.castBurstSkill`）。
//
// 🔴 参数前缀为什么是 `burst`：
//   ① `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，而 68015 的另一条技能
//      （爆囊扩散 101501）**已经在同一个袋子里写了 `splashRadius` / `splashDamageRate`**。
//      裸写这两个键会把这张卡的普攻溅射半径从 38 改成 150 —— 不报错、只是普攻莫名变成大范围溅射。
//   ② `cooldown` 同理（状态表 / 计划列上都有同名列，容易读串）。
//   ③ `damageRate` 是普攻链路的面板倍率键，写裸键等于把这张卡的每次普攻都改成 160%。
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
 * 菌毯爆发（68015 / 101504）：自心圆 150 引爆，爆完给自己套一段护盾；
 * III 级在整个护盾期内再叠「受到伤害降低 15%」。
 * 设计案 K~M：160% → 190% → 230%；护盾 12% → 15% → 18%；冷却 16。
 * 解锁按项目规则「技能 4 = 12/24/36」。
 */
const BURST_AURA = {
    chain: 101504,
    unitId: '68015',
    pvpSkillId: 30241,
    name: '菌毯爆发',
    //  文案里「引爆 X」的 X 与技能名不同：设计案 L 列写的是「引爆菌毯」，
    //  直接用技能名会拼成「引爆菌毯爆发」（重复）。
    ignite: '菌毯',
    behaviorKey: 'burst_aura',
    tiers: [
        { modifierId: 94015041, unlock: 12, level: 1, damage: 1.6, radius: 150, cooldown: 16, shield: 0.12, shieldSeconds: 4 },
        { modifierId: 94015042, unlock: 24, level: 2, damage: 1.9, radius: 150, cooldown: 16, shield: 0.15, shieldSeconds: 4 },
        { modifierId: 94015043, unlock: 36, level: 3, damage: 2.3, radius: 150, cooldown: 16, shield: 0.18, shieldSeconds: 4, shieldReduce: 15 },
    ],
};

/**
 * 菌核爆裂（68018 / 101804）：自心圆 120 引爆 + 把命中目标推开 1/1/2 格。
 * 设计案 K~M：140% → 170% → 210%；冷却 14。
 * 解锁按「技能 4 = 12/24/36」。
 */
const BURST_KNOCKBACK = {
    chain: 101804,
    unitId: '68018',
    pvpSkillId: 30667,
    name: '菌核爆裂',
    ignite: '菌核',
    behaviorKey: 'burst_knockback',
    tiers: [
        { modifierId: 94018041, unlock: 12, level: 1, damage: 1.4, radius: 120, cooldown: 14, knockback: 1 },
        { modifierId: 94018042, unlock: 24, level: 2, damage: 1.7, radius: 120, cooldown: 14, knockback: 1 },
        { modifierId: 94018043, unlock: 36, level: 3, damage: 2.1, radius: 120, cooldown: 14, knockback: 2 },
    ],
};

/** 百分比文案：1.6 → `160`；0.12 → `12`（不做浮点尾数）。*/
function pct(rate) {
    return String(Math.round(rate * 100));
}

function buildRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            burstCooldown: tier.cooldown,
            burstDamageRate: tier.damage,
            burstRadius: tier.radius,
        };
        let desc = `冷却 ${tier.cooldown} 秒：以自身为圆心半径 ${tier.radius} 引爆${spec.ignite}，`
            + `对范围内敌人造成 ${pct(tier.damage)}% 伤害`;
        if (tier.shield) {
            params.burstShieldRatio = tier.shield;
            params.burstShieldSeconds = tier.shieldSeconds;
            desc += `，并为自己附加 ${pct(tier.shield)}% 最大生命的护盾，持续 ${tier.shieldSeconds} 秒`;
            if (tier.shieldReduce) {
                params.burstShieldReducePct = tier.shieldReduce;
                desc += `；护盾存在期间受到的伤害降低 ${tier.shieldReduce}%`;
            }
        }
        if (tier.knockback) {
            params.burstKnockbackCells = tier.knockback;
            desc += `，并击退 ${tier.knockback} 格`;
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

const SPECS = [BURST_AURA, BURST_KNOCKBACK];
const WANT = SPECS.flatMap(buildRows);

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

const BANNED = ['"splashRadius"', '"splashDamageRate"', '"damageRate"', '"cooldown"'];

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
            //  裸键会串到普攻链路 / 别的车道（见文件头）。只拦「引号 + 键名 + 引号」这种真键。
            if (raw.includes(banned)) {
                throw new Error(`[fail] ${label} ${id} 的参数袋里出现裸键 ${banned}：${raw}`);
            }
        }
        if (!('burstCooldown' in JSON.parse(raw))) {
            throw new Error(`[fail] ${label} ${id} 缺 burstCooldown：${raw}`);
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

//  回读：两条链各三档；顺带确认 68015 的普攻溅射键**没有被本批带跑**。
for (const spec of SPECS) {
    const rows = remote.rows.filter((row) => Number(row.skillChainId) === spec.chain)
        .sort((a, b) => a.modifierId - b.modifierId);
    if (rows.length !== 3) throw new Error(`[fail] ${spec.chain} 应有 3 档，实际 ${rows.length}`);
    for (const row of rows) {
        console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} ${row.behaviorKey} ${row.skillParamJson}`);
    }
}
const splashRows = remote.rows.filter((row) => Number(row.skillChainId) === 101501)
    .sort((a, b) => a.modifierId - b.modifierId);
for (const row of splashRows) {
    if (!String(row.skillParamJson).includes('"splashRadius"')) {
        throw new Error(`[fail] 68015 的普攻溅射键被带跑了：${row.modifierId} ${row.skillParamJson}`);
    }
}
console.log(`[ok] 68015 普攻溅射 ${splashRows.length} 档完好（${splashRows.map(r => JSON.parse(r.skillParamJson).splashRadius).join('/')}）`);
