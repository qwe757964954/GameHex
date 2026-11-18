// 第 17 批 · 68011 水手菇 / 68012 菇八戒 的四条纯数值被动（2026-11-18）。
//
// 背景：设计案把这两张绿卡的被动池按「绿档 3 被动 + 1 主动」重排过，但 J 表里一直没有这 4 条，
// 实际只配了 101103 / 101203 两条协议被动 + 通用 `109001` ⇒ **每卡少 2 条被动**。
// 这 4 条设计文案齐全、机制就是一条 unit 域属性，纯配表即可（零代码）。
//
//   101101 废土铁芽   attack      addRate 10 / 12 / 14%   解锁 3 / 10 / 22（68011）
//   101102 超视孢子   attackRange addRate 14 / 18 / 24%   解锁 6 / 16 / 26（68011）
//   101201 废土铁芽   attack      addRate 10 / 12 / 14%   解锁 3 / 10 / 22（68012）
//   101202 灵巧投掷   attackSpeed addRate 11 / 13 / 15%   解锁 6 / 16 / 26（68012）
//
// 🔴 数值口径：`addRate` 存**小数**（0.14 = 14%），`add` 才存百分点数字（9 = 9%）。
//    这 4 条全是 addRate ⇒ 写成 10 就是「+1000%」，表里看不出来，进游戏直接数值爆炸。
//
// 🔴 修改器号段空余已核：94011011~13 / 94011021~23 / 94012011~13 / 94012021~23
//    全表无占用；号段规则沿用 `94 + 0 + 卡后三位 + 链序号两位 + 档位`。
//
// 幂等：按 modifierId 原地重写 / 追加，重跑逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const VERSION = '技能设计案2 V13-20261118';

/** 四条链的静态定义（数值直接抄设计案 L1/L2/L3 列）。*/
const PASSIVES = [
    {
        chain: 101101, unitId: '68011', name: '废土铁芽', pvpSkillId: 30261,
        statId: 'attack', label: '攻击提高',
        modifierIds: [94011011, 94011012, 94011013],
        unlocks: [3, 10, 22], values: [0.1, 0.12, 0.14],
    },
    {
        chain: 101102, unitId: '68011', name: '超视孢子', pvpSkillId: 30261,
        statId: 'attackRange', label: '攻击范围提高',
        modifierIds: [94011021, 94011022, 94011023],
        unlocks: [6, 16, 26], values: [0.14, 0.18, 0.24],
    },
    {
        chain: 101201, unitId: '68012', name: '废土铁芽', pvpSkillId: 30271,
        statId: 'attack', label: '攻击提高',
        modifierIds: [94012011, 94012012, 94012013],
        unlocks: [3, 10, 22], values: [0.1, 0.12, 0.14],
    },
    {
        chain: 101202, unitId: '68012', name: '灵巧投掷', pvpSkillId: 30271,
        statId: 'attackSpeed', label: '攻击速度提高',
        modifierIds: [94012021, 94012022, 94012023],
        unlocks: [6, 16, 26], values: [0.11, 0.13, 0.15],
    },
];

/** 百分比文字：0.1 → '10'（表里存小数，卡面写整数百分比）。*/
function pct(value) {
    const scaled = Math.round(value * 100 * 1000) / 1000;
    return Number.isInteger(scaled) ? String(scaled) : String(scaled);
}

function buildRows() {
    const rows = [];
    for (const skill of PASSIVES) {
        for (let tier = 0; tier < 3; tier++) {
            rows.push({
                enabled: 1,
                modifierId: skill.modifierIds[tier],
                unitId: skill.unitId,
                skillChainId: skill.chain,
                skillName: skill.name,
                skillLevel: tier + 1,
                unlockHeroLevel: skill.unlocks[tier],
                skillKind: 'passive_stat',
                passiveScope: 'deployed',
                progressionMode: 'replace',
                pvpSkillId: skill.pvpSkillId,
                stateMode: 'none',
                desc: `${skill.label}${pct(skill.values[tier])}%`,
                sourceVersion: VERSION,
                publishStatus: '可发布',
                statId: skill.statId,
                operation: 'addRate',
                value: skill.values[tier],
                behaviorKey: null,
                skillParamJson: null,
                cooldown: 0,
                triggerEvent: 'build',
                targetSelector: 'self',
                durationSeconds: 0,
                maxStacks: 1,
                maxTriggers: 0,
                statusId: null,
                statusStatJson: null,
            });
        }
    }
    return rows;
}

const WANT = buildRows();
const WANT_IDS = new Set(WANT.map((row) => row.modifierId));

/** client 产物的列序与形态（照 `100101` 那种纯数值被动的实际写法）。*/
const CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'durationSeconds',
    'maxStacks', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion', 'publishStatus',
    'statId', 'operation', 'value', 'skillParamJson', 'statusId', 'statusStatJson',
];

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
    return true;
}

function apply(rows, label, shape) {
    let added = 0;
    let rewritten = 0;
    for (const want of WANT) {
        const shaped = shape(want);
        const index = rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) {
            rows.push(shaped);
            added += 1;
            continue;
        }
        if (sameRow(shaped, rows[index])) continue;
        rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten} 行、追加 ${added} 行（共 ${rows.length} 行）`);
}

/** 这 4 条不许带任何 `mix.*` / 参数键 —— 纯数值被动，袋子必须是空的。*/
function guard(table, label) {
    const ids = new Set();
    for (const row of table.rows) {
        const id = Number(row.modifierId);
        if (ids.has(id)) throw new Error(`[fail] ${label} modifierId 重复：${id}`);
        ids.add(id);
        if (!WANT_IDS.has(id)) continue;
        if (String(row.skillKind) !== 'passive_stat') throw new Error(`[fail] ${label} ${id} 不是 passive_stat`);
        if (String(row.operation) !== 'addRate') throw new Error(`[fail] ${label} ${id} 的 operation 必须是 addRate`);
        const value = Number(row.value);
        if (!(value > 0) || value >= 1) {
            throw new Error(`[fail] ${label} ${id} 的 value=${row.value} 明显不是 0~1 的小数（写成 10 就是 +1000%）`);
        }
        if (row.skillParamJson) throw new Error(`[fail] ${label} ${id} 不该带参数袋：${row.skillParamJson}`);
        if (row.behaviorKey) throw new Error(`[fail] ${label} ${id} 不该带 behaviorKey：${row.behaviorKey}`);
    }
}

/** 回读：每张卡的被动条数 + 既有两条车道完好。*/
function verify(table, label) {
    for (const skill of PASSIVES) {
        const rows = table.rows.filter((row) => Number(row.skillChainId) === skill.chain)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        if (rows.length !== 3) throw new Error(`[fail] ${label} ${skill.chain} 应有 3 档，实际 ${rows.length}`);
        const values = rows.map((row) => Number(row.value));
        const unlocks = rows.map((row) => Number(row.unlockHeroLevel));
        if (values.join(',') !== skill.values.join(',')) {
            throw new Error(`[fail] ${label} ${skill.chain} 三档数值不对：${values}`);
        }
        if (unlocks.join(',') !== skill.unlocks.join(',')) {
            throw new Error(`[fail] ${label} ${skill.chain} 解锁等级不对：${unlocks}`);
        }
    }
    //  这两张卡原有的两条协议被动不许被带跑。
    for (const [chain, statId] of [[101103, 'counterRole4'], [101203, 'counterCamp3']]) {
        const row = table.rows.find((item) => Number(item.skillChainId) === chain);
        if (!row || row.statId !== statId) throw new Error(`[fail] ${label} ${chain} 的 ${statId} 被动被改坏了`);
    }
    console.log(`[ok] ${label} 回读通过：4 条链 × 3 档，协议被动 101103 / 101203 完好`);
}

const remote = readTable(REMOTE);
const client = readTable(CLIENT);
apply(remote.rows, 'remoteRef', (row) => row);
apply(client.rows, 'client', shapeForClient);
guard(remote, 'remoteRef');
guard(client, 'client');
writeTable(REMOTE, remote);
writeTable(CLIENT, client);
verify(remote, 'remoteRef');
verify(client, 'client');

for (const row of WANT) {
    console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} ${row.skillName}`
        + ` ${row.statId} addRate ${row.value}（${row.desc}）`);
}
