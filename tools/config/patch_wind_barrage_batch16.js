// 第 16 批 · 孢爆箭 101303（风炮菇 68013，改口径）+ 连射导弹 101304（同卡，新落地）。
//
// 用户口径（2026-11-18）：「技能设计案中风炮菇的技能已经修改了描述，查看描述，
// 没有疑问按照新的描述去研发技能」+ 两个裁定：
//   · 飓风那 1 次伤害 = 风弹的 60%（90% / 108% / 132%）；
//   · 「蓝色的风弹」暂无资源 ⇒ 先复用 `三叶小丑_普攻`。
//
// 101303 与上一版（第 12 批 `splash_shot`：命中点周围 90/110/130 均等溅射）完全不同：
// 现在是「慢速风弹（70 逻辑 px/s、4 秒寿命）命中单体 150/180/220% + 原地留半径 30 的飓风
// 3 秒、每个接触到的敌人只挨一次」。所以 behaviorKey 换成 `wind_bolt`，参数整袋重写。
//
// 101304 是新增（此前只有 K 表占位行、J 表一行都没有）：累计 10 次普攻 → 1.2 秒内 3 颗
// 抛物线炸弹，落点只炸、途中不碰人，半径 180 一次性 160/200/220%。
//
// 🔴 参数前缀为什么是 `wind` / `barrage`：
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，而 68013 这一张卡的
//   **四条**技能行共用 `68013:30401` 一个袋子：
//     · 101301 连发苔针 —— `bulletFalloff`（0.4/0.35/0.3，普攻裂弹递减）
//     · 101302 职业猎杀协议 —— `mix.critRate` / `mix.attack.addRate` / `mix.damageRate.addRate`
//       / `mix.attackRange.addRate`
//     · 101303 孢爆箭 —— 本批 `wind*`
//     · 101304 连射导弹 —— 本批 `barrage*`
//   ⇒ 裸 `cooldown` / `damageRate` / `radius` 会直接把别条车道改掉，而且**不报错**。
//   旧的 `shot*` 三键（101303 上一版）本批必须消失 —— 留着就是「同一袋里两套口径」。
//
// 幂等：101303 按 modifierId 原地重写（94013031~33 已存在），101304 按 modifierId 追加
// （94013041~43）。重跑结果逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef/pvpSkillPlan.json');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json');
const VERSION = '技能设计案2 V12-20261118';

/** 四条链的共同骨架：主动技能、三档 replace、无 statId（机制全在参数袋里）。*/
function baseRow(overrides) {
    return Object.assign({
        enabled: 1,
        modifierId: 0,
        unitId: '68013',
        skillChainId: 0,
        skillName: '',
        skillLevel: 1,
        unlockHeroLevel: 0,
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: 30401,
        stateMode: 'none',
        desc: '',
        sourceVersion: VERSION,
        publishStatus: '可发布',
        statId: null,
        operation: null,
        value: null,
        behaviorKey: 'wind_bolt',
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
 * 孢爆箭（101303）：慢速风弹 + 命中点留飓风。
 * 设计案 N 列：「发出蓝色的风弹，70px 的移动速度，4s 的生命周期，命中敌人产生
 * 150%/180/220% 的伤害，会在原地产生 1 个飓风【大小和三叶小丑的飓风一致】，
 * 飓风持续 3 秒，对接触飓风的敌人造成 1 次伤害，同个敌人持续接触也只是 1 次伤害」。
 * 三叶小丑的飓风 = `pvpSkill` 36251 的 `areaRadius = 30`（逻辑 px），直接沿用。
 */
const WIND_BOLT = {
    chain: 101303,
    name: '孢爆箭',
    behaviorKey: 'wind_bolt',
    skillKind: 'active_cd',
    tiers: [
        { modifierId: 94013031, unlock: 9, level: 1, damage: 1.5, zone: 0.9, text: '150% / 90%' },
        { modifierId: 94013032, unlock: 18, level: 2, damage: 1.8, zone: 1.08, text: '180% / 108%' },
        { modifierId: 94013033, unlock: 27, level: 3, damage: 2.2, zone: 1.32, text: '220% / 132%' },
    ],
    cooldown: 12,
    speed: 70,
    lifeSeconds: 4,
    zoneRadius: 30,
    zoneSeconds: 3,
};

/**
 * 连射导弹（101304）：累计 10 次普攻 → 一轮 3 颗抛物线炸弹，只走落点引爆。
 * 设计案 N 列：「1.2s 内发射 3 个抛物线的炸弹（每次只发射 1 个），落点在以目标为圆形
 * 30px 为直径的区域内的任意点位上，炸弹只有达到落点才会爆炸，行径过程不会提前触碰其他目标，
 * 爆炸产 180px 的圆形范围伤害，一次性伤害，范围内所有敌人都受到 160%/200%/220% 的伤害」。
 * I/J 列：「主动-累计普攻 / 10」⇒ `active_attack` + `triggerEvent = active`。
 */
const BARRAGE = {
    chain: 101304,
    name: '连射导弹',
    behaviorKey: 'missile_barrage',
    skillKind: 'active_attack',
    tiers: [
        { modifierId: 94013041, unlock: 12, level: 1, damage: 1.6 },
        { modifierId: 94013042, unlock: 24, level: 2, damage: 2.0 },
        { modifierId: 94013043, unlock: 36, level: 3, damage: 2.2 },
    ],
    radius: 180,
    count: 3,
    interval: 0.4,
    every: 10,
};

function windDesc(tier) {
    return `每 ${WIND_BOLT.cooldown} 秒：射出一枚风弹，命中敌人造成 ${tier.text.split(' / ')[0]} 伤害，`
        + `并在原地留下一个半径 ${WIND_BOLT.zoneRadius} 的飓风，持续 ${WIND_BOLT.zoneSeconds} 秒；`
        + `接触飓风的敌人受到 ${tier.text.split(' / ')[1]} 伤害（同一敌人只结算一次）`;
}

function windParams(tier) {
    return {
        windCooldown: WIND_BOLT.cooldown,
        windDamageRate: tier.damage,
        windSpeed: WIND_BOLT.speed,
        windLifeSeconds: WIND_BOLT.lifeSeconds,
        windZoneRadius: WIND_BOLT.zoneRadius,
        windZoneSeconds: WIND_BOLT.zoneSeconds,
        windZoneDamageRate: tier.zone,
    };
}

function barrageDesc(tier) {
    return `每累计 ${BARRAGE.every} 次普攻：1.2 秒内发射 ${BARRAGE.count} 枚抛物线炸弹，`
        + `落点在目标周围随机；炸弹到达落点才爆炸（途中不碰目标），`
        + `对半径 ${BARRAGE.radius} 内所有敌人一次性造成 ${Math.round(tier.damage * 100)}% 伤害`;
}

function barrageParams(tier) {
    return {
        barrageEvery: BARRAGE.every,
        barrageCount: BARRAGE.count,
        barrageInterval: BARRAGE.interval,
        barrageDamageRate: tier.damage,
        barrageRadius: BARRAGE.radius,
    };
}

function buildRows() {
    const rows = [];
    for (const tier of WIND_BOLT.tiers) {
        rows.push(baseRow({
            modifierId: tier.modifierId,
            skillChainId: WIND_BOLT.chain,
            skillName: WIND_BOLT.name,
            skillLevel: tier.level,
            unlockHeroLevel: tier.unlock,
            skillKind: WIND_BOLT.skillKind,
            behaviorKey: WIND_BOLT.behaviorKey,
            desc: windDesc(tier),
            skillParamJson: JSON.stringify(windParams(tier)),
        }));
    }
    for (const tier of BARRAGE.tiers) {
        rows.push(baseRow({
            modifierId: tier.modifierId,
            skillChainId: BARRAGE.chain,
            skillName: BARRAGE.name,
            skillLevel: tier.level,
            unlockHeroLevel: tier.unlock,
            skillKind: BARRAGE.skillKind,
            behaviorKey: BARRAGE.behaviorKey,
            desc: barrageDesc(tier),
            skillParamJson: JSON.stringify(barrageParams(tier)),
            //  累计普攻触发的行，与「暴风 / 戈壁狂箭 / 急冻光线」同一套三列。
            cooldown: 0,
            triggerEvent: 'active',
            targetSelector: 'current_target',
            maxStacks: 1,
            maxTriggers: 0,
            durationSeconds: 1.2,
        }));
    }
    return rows;
}

const WANT = buildRows();
const CHAINS = new Set(WANT.map((row) => row.skillChainId));

/**
 * 逐键比（以 `left` 为基准，`right` 缺的键按 null 归一）。
 *
 * ⚠️ 这里曾经写成「只比两边都有的键」，结果 client 侧少写 6 列也照样判「一样」——
 * `tests/zcds-model.test.ts` 的两份产物互校守卫当场红了 18 格（3 行 × 6 列）。
 * 现在的口径：**以权威行（本脚本构造的 want）为准**，对面缺键就是不一致。
 */
function sameRow(left, right) {
    for (const key of Object.keys(left)) {
        const a = left[key] ?? null;
        const b = key in right ? (right[key] ?? null) : null;
        if (a !== b) return false;
    }
    return true;
}

/**
 * client 产物的列序（照抄既有 `active_attack` 行的实际形态，2026-11-18 实测）。
 *
 * 转表产物的规则：**值为 null 的列整列省掉**，只有 `statId` / `value` 恒保留。
 * 之前这里被钉成 19 列（那是 `active_cd` 行的形态，没有触发那 6 列）⇒
 * 101304 追加进 client 时 `cooldown / triggerEvent / targetSelector /
 * durationSeconds / maxStacks / maxTriggers` 全被裁掉，运行时读 remoteRef 有值、
 * 导表产物是 null。
 */
const CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'durationSeconds',
    'maxStacks', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statId', 'value', 'statusId', 'statusStatJson', 'operation',
];

function shapeForClient(row) {
    const out = {};
    for (const key of CLIENT_KEYS) {
        if (!(key in row)) continue;
        const value = row[key];
        if (value === null || value === undefined) {
            if (key !== 'statId' && key !== 'value') continue;
        }
        out[key] = value ?? null;
    }
    return out;
}

function apply(rows, label, shape) {
    let added = 0, rewritten = 0;
    for (const want of WANT) {
        const shaped = shape(want);
        const index = rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) {
            rows.push(shaped);
            added += 1;
            continue;
        }
        if (sameRow(shaped, rows[index])) continue;
        //  整行替换：本批这两条链的行完全由本脚本拥有（没有别人往里写别的列），
        //  而「逐键覆盖」做不到「按 client 列序补回被裁掉的列」⇒ 只有整行替换才能
        //  保证两份产物逐格一致，且重跑后文件逐字节相同。
        rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten} 行、追加 ${added} 行（共 ${rows.length} 行）`);
}

/**
 * 裸键黑名单：这几个键在本卡的其他车道里都有主了（见文件头），写进来会串道。
 * `shot*` 是本批要淘汰的旧口径 —— 它出现在 68013 的任何一行都说明 101303 没改干净。
 */
const BANNED = [
    '"damageRate"', '"cooldown"', '"radius"', '"bulletFalloff"',
    '"shotCooldown"', '"shotDamageRate"', '"shotRadius"',
];

/** 每条链必须带自己那一条触发键 —— 少了它整条车道静默不跑（`applyXxx` 第一行就 return）。*/
const REQUIRED_KEY = { 101303: 'windCooldown', 101304: 'barrageEvery' };

/** 每档必须带的其余键（少一个就是「看着配了、结算少一段」）。*/
const REQUIRED_ALL = {
    101303: ['windDamageRate', 'windSpeed', 'windLifeSeconds', 'windZoneRadius', 'windZoneSeconds', 'windZoneDamageRate'],
    101304: ['barrageCount', 'barrageInterval', 'barrageDamageRate', 'barrageRadius'],
};

function guard(table, label) {
    const ids = new Set();
    for (const row of table.rows) {
        const id = Number(row.modifierId);
        if (ids.has(id)) throw new Error(`[fail] ${label} modifierId 重复：${id}`);
        ids.add(id);
        const chain = Number(row.skillChainId);
        if (!CHAINS.has(chain)) continue;
        const raw = String(row.skillParamJson ?? '');
        for (const banned of BANNED) {
            if (raw.includes(banned)) {
                throw new Error(`[fail] ${label} ${id} 的参数袋里出现禁用键 ${banned}：${raw}`);
            }
        }
        const params = JSON.parse(raw);
        if (!(REQUIRED_KEY[chain] in params)) {
            throw new Error(`[fail] ${label} ${id} 缺 ${REQUIRED_KEY[chain]}：${raw}`);
        }
        for (const key of REQUIRED_ALL[chain]) {
            if (!(key in params)) throw new Error(`[fail] ${label} ${id} 缺 ${key}：${raw}`);
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
for (const chain of [WIND_BOLT, BARRAGE]) {
    const rows = remote.rows.filter((row) => Number(row.skillChainId) === chain.chain)
        .sort((a, b) => a.modifierId - b.modifierId);
    if (rows.length !== 3) throw new Error(`[fail] ${chain.chain} 应有 3 档，实际 ${rows.length}`);
    for (const row of rows) {
        console.log(`  ${row.modifierId} L${row.skillLevel} 解锁${row.unlockHeroLevel} `
            + `${row.behaviorKey} ${row.skillParamJson}`);
    }
}

//  串道复核：同一张卡上另外两条技能必须原样还在。
//  裸键守卫只能证明「我没写进去」，这一段才能证明「我没把别人的改跑」。
const extraRows = remote.rows.filter((row) => Number(row.skillChainId) === 101301)
    .sort((a, b) => a.modifierId - b.modifierId);
if (extraRows.length !== 3) throw new Error(`[fail] 101301 应有 3 档，实际 ${extraRows.length}`);
const falloffs = extraRows.map((row) => JSON.parse(row.skillParamJson).bulletFalloff);
if (falloffs.join('/') !== '0.4/0.35/0.3') {
    throw new Error(`[fail] 68013 的普攻裂弹递减被带跑了：${falloffs.join('/')}`);
}
const counterRows = remote.rows.filter((row) => Number(row.skillChainId) === 101302)
    .sort((a, b) => a.modifierId - b.modifierId);
if (counterRows.length !== 3) throw new Error(`[fail] 101302 应有 3 档，实际 ${counterRows.length}`);
for (const row of counterRows) {
    if (!String(row.skillParamJson).includes('"mix.critRate"')) {
        throw new Error(`[fail] 68013 的克制条混搭被带跑了：${row.modifierId} ${row.skillParamJson}`);
    }
}
console.log(`[ok] 68013 既有两条车道完好：普攻裂弹递减 ${falloffs.join('/')}、`
    + `克制条暴击 ${counterRows.map((r) => JSON.parse(r.skillParamJson)['mix.critRate']).join('/')}`);
