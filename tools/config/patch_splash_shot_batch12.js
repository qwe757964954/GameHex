// 第 12 批 · 孢爆箭 101303（风炮菇 68013）+ 孢子凝珠 101104（水手菇 68011）。
//
// 用户口径（2026-11-17）：「继续实现任务」—— 接着第 11 批把「新主动车道」往下推。
// 本脚本只铺这两条「冷却到点射一枚会爆开的弹」的技能，代码侧同一批新增了
// `splash_shot` / `spore_burst` 车道（见 `ZCSkillRuntimeRegistry` 的注册注释）。
//
// 🔴 参数前缀为什么是 `shot`（设计案 P 列原来写的是裸 `damageRate` / `splashRadius` / `cooldown`）：
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，而 `splashRadius` /
//   `splashDamageRate` 这两个键**普攻链路也在读**（爆囊扩散那套）。写裸键的话
//   「给主动技能配的 90px 溅射」会顺带把这张卡的**每次普攻**也变成 90px 溅射 ——
//   不报错、只是数值莫名变大。`cooldown` 同理（状态/计划列上也有同名列，容易读串）。
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
 * 孢爆箭（68013 / 101303）：射一发，命中点半径内均等溅射。
 * 设计案 K~M：90% @半径 90 → 110% @110 → 130% @130；冷却 12 / 12 / 11。
 * 解锁按项目规则「技能 3 = 9/18/27」。
 */
const SPLASH_SHOT = {
    chain: 101303,
    unitId: '68013',
    pvpSkillId: 30401,
    name: '孢爆箭',
    behaviorKey: 'splash_shot',
    tiers: [
        { modifierId: 94013031, unlock: 9, level: 1, damage: 0.90, radius: 90, cooldown: 12 },
        { modifierId: 94013032, unlock: 18, level: 2, damage: 1.10, radius: 110, cooldown: 12 },
        { modifierId: 94013033, unlock: 27, level: 3, damage: 1.30, radius: 130, cooldown: 11 },
    ],
};

/**
 * 孢子凝珠（68011 / 101104）：射一发，命中点溅射 + 给命中目标挂减速。
 * 设计案 K~M：60%/15%·2s → 75%/20%·2s → 90%/25%·3s；半径恒定 90；冷却恒定 12。
 * 解锁按「技能 4 = 12/24/36」。
 */
const SPORE_BURST = {
    chain: 101104,
    unitId: '68011',
    pvpSkillId: 30261,
    name: '孢子凝珠',
    behaviorKey: 'spore_burst',
    tiers: [
        { modifierId: 94011041, unlock: 12, level: 1, damage: 0.60, radius: 90, slow: 15, slowSeconds: 2, cooldown: 12 },
        { modifierId: 94011042, unlock: 24, level: 2, damage: 0.75, radius: 90, slow: 20, slowSeconds: 2, cooldown: 12 },
        { modifierId: 94011043, unlock: 36, level: 3, damage: 0.90, radius: 90, slow: 25, slowSeconds: 3, cooldown: 12 },
    ],
};

/** 百分比文案：0.9 → `90`，1.1 → `110`（不做浮点尾数）。*/
function pct(rate) {
    return String(Math.round(rate * 100));
}

function buildRows(spec) {
    return spec.tiers.map((tier) => {
        const params = {
            shotCooldown: tier.cooldown,
            shotDamageRate: tier.damage,
            shotRadius: tier.radius,
        };
        let desc = `冷却 ${tier.cooldown} 秒：射出一枚${spec.name}，命中后对半径 ${tier.radius} 内`
            + `所有敌人造成 ${pct(tier.damage)}% 伤害`;
        if (tier.slow) {
            params.shotSlowRatio = tier.slow;
            params.shotSlowSeconds = tier.slowSeconds;
            desc += `，并使命中目标移动速度降低 ${tier.slow}%，持续 ${tier.slowSeconds} 秒`;
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

const WANT = [...buildRows(SPLASH_SHOT), ...buildRows(SPORE_BURST)];

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

function guard(table, label) {
    const ids = new Set();
    for (const row of table.rows) {
        const id = Number(row.modifierId);
        if (ids.has(id)) throw new Error(`[fail] ${label} modifierId 重复：${id}`);
        ids.add(id);
        if (Number(row.skillChainId) !== SPLASH_SHOT.chain && Number(row.skillChainId) !== SPORE_BURST.chain) continue;
        const raw = String(row.skillParamJson ?? '');
        for (const banned of ['"splashRadius"', '"splashDamageRate"', '"damageRate"', '"cooldown"']) {
            //  裸键会串到普攻链路（见文件头）。只拦「引号 + 键名 + 引号」这种真键，不误伤 shotXxx。
            if (raw.includes(banned)) {
                throw new Error(`[fail] ${label} ${id} 的参数袋里出现裸键 ${banned}：${raw}`);
            }
        }
        if (!("shotCooldown" in JSON.parse(raw))) {
            throw new Error(`[fail] ${label} ${id} 缺 shotCooldown：${raw}`);
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

//  回读：两条链各三档，数值与文案都对得上。
for (const spec of [SPLASH_SHOT, SPORE_BURST]) {
    const rows = remote.rows.filter((row) => Number(row.skillChainId) === spec.chain)
        .sort((a, b) => a.modifierId - b.modifierId);
    if (rows.length !== 3) throw new Error(`[fail] ${spec.chain} 应有 3 档，实际 ${rows.length}`);
    for (const row of rows) {
        console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} ${row.behaviorKey} ${row.skillParamJson}`);
    }
}
