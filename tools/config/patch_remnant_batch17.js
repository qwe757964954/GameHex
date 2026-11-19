// 第 17 批尾段（2026-11-18）：四条「未实现主动」一次落地，各 3 档共 12 行。
//
//   101404 一人成军（分裂菇 68014）  → `summon_unit`（复用）+ 累计普攻 8 次触发
//   102204 嗜血术（雷蕉 68022）      → `team_buff`（新增车道）
//   102304 大吼大叫（南瓜战神 68023）→ `roar`（新增车道）
//   102004 飓风（三叶小丑 68020）    → `storm_zone`（新增车道，会走动 + 牵引）
//
// 这四条在 `pvpSkillPlan` 里**一行都没有**（不是「参数错了」），所以是**追加**不是重写；
// K 表 / `armySkillLevelUp` 里那 12 行占位早就在（`B/C/L/M` 全空、解锁 12/24/36），
// 由 `patch_batch17_k.py` 按这里写下的 name / desc / unlock 反填。
//
// 🔴 参数一律带各自车道前缀
//   `skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋：
//     · 68014:30216 还住着 101401 连击 / 101402 被动 / 101403 菌丝突刺；
//     · 68022:30231 还住着 102201 孢子弹幕 / 102202 职业猎杀 / 102203 闪电链；
//     · 68023:30216 还住着 102301 光环 / 102302 被动 / 102303 冲锋；
//     · 68020:30714 还住着 102001 / 102002 克制条。
//   裸写 `count` / `radius` / `seconds` 会串到别条车道，而且**不报错**。
//
// 🔴 三条新增车道的「设计没给的值」都在设计案 P 列写明是补的（本脚本注释里逐条标了原因）。
//
// 幂等：按 modifierId 原地重写 / 追加，重跑逐字节相同。
// 用法：node tools/config/patch_remnant_batch17.js [101404 102204 ...]（不带参数 = 四条都跑）
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const CLIENT_DIR = path.join(ROOT, 'doc/塔防数据配置/json/client');
const REMOTE_DIR = path.join(__dirname, '../../assets/remoteRef');
const VERSION = '技能设计案2 V13-20261118';

const pct = (value) => Math.round(value * 100);

/**
 * 每条链：unitId / pvpSkillId / 技能名 / 解锁等级 / behaviorKey / 三档参数 / 描述生成。
 * `modifierBase` 由链号推出来：`94000000 + (chain − 100000) × 10`，与既有 12 条链同一套编码。
 */
const SPECS = {
    // ── 101404 一人成军（分裂菇 68014，紫 3，蘑菇·战士）
    //   设计 K/L/M：累计普攻 8 次后召唤 3/4/6 只分身，每只继承本体 30%/50%/80% 属性，
    //   只做普攻与被动、不计入单位上限。N 列没说跟随 ⇒ **不配 `summonFollow`**（放出去自己走）。
    //   持续：用户 2026-11-18 裁定「分身持续到战死为止」⇒ **不配 `summonSeconds`**。
    101404: {
        unitId: '68014',
        pvpSkillId: 30216,
        name: '一人成军',
        unlocks: [9, 18, 27],
        behaviorKey: 'summon_unit',
        tiers: [
            { count: 3, inherit: 0.3 },
            { count: 4, inherit: 0.5 },
            { count: 6, inherit: 0.8 },
        ],
        bag: (tier) => ({
            summonEvery: 8,
            summonCount: tier.count,
            summonHpInherit: tier.inherit,
            summonAttackInherit: tier.inherit,
        }),
        desc: (tier) => `累计普攻 8 次后召唤 ${tier.count} 只分裂菇分身，`
            + `每只继承本体 ${pct(tier.inherit)}% 生命值和攻击力；`
            + '分身只做普通攻击与被动，不计入单位上限，持续到战死为止',
        //  两条触发互斥：这条链只许出现 `summonEvery`。
        forbid: ['summonCooldown', 'summonSeconds', 'summonFollow', 'summonSlotRadius'],
    },

    // ── 102204 嗜血术（雷蕉 68022，紫 3，盆栽·法师）
    //   设计 K/L/M：周围友军伤害 +15/25/40%、攻速 +0/15/30%，持续 5/6/8 秒；
    //   III 级友军击杀敌人额外延长 1 秒（最多 4 秒）。N 列：离开范围即失去、延长各算各的。
    //   ⚠ 设计没给「周围」多大 ⇒ 取 190，与同批 68031 / 68023 的共生信号光环同档。
    102204: {
        unitId: '68022',
        pvpSkillId: 30231,
        name: '嗜血术',
        unlocks: [12, 24, 36],
        behaviorKey: 'team_buff',
        tiers: [
            { damage: 15, speed: 0, seconds: 5 },
            { damage: 25, speed: 15, seconds: 6 },
            { damage: 40, speed: 30, seconds: 8 },
        ],
        bag: (tier, index) => {
            const out = {
                teamBuffCooldown: 8,
                teamBuffRadius: 190,
                teamBuffSeconds: tier.seconds,
                teamBuffDamagePct: tier.damage,
            };
            //  I 级没有攻速加成：显式写 0 而不是省略 —— 省了读到的也是 0（同一个结果），
            //  但下一个人会以为「I 级漏配了攻速」而去补一个 15，顺手把 I 级改强。
            out.teamBuffAttackSpeedPct = tier.speed;
            if (index === 2) {
                out.teamBuffKillExtendSeconds = 1;
                out.teamBuffKillExtendMaxSeconds = 4;
            }
            return out;
        },
        desc: (tier, index) => {
            const parts = [`冷却 8 秒：使半径 190 内的友军造成伤害提高 ${tier.damage}%`];
            if (tier.speed > 0) parts.push(`攻击速度提高 ${tier.speed}%`);
            parts.push(`持续 ${tier.seconds} 秒，离开范围即失去`);
            if (index === 2) parts.push('期间友军击杀敌人使该增益延长 1 秒（最多延长 4 秒）');
            return parts.join('、');
        },
        forbid: [],
    },

    // ── 102304 大吼大叫（南瓜战神 68023，紫 3，盆栽·坦克）
    //   设计 K/L/M：对周围敌人造成 80/110/150% 伤害并降低其攻击 20/30/40%，持续 3/4/5 秒；
    //   III 级同时给周围友军套「自身 15% 最大生命」的护盾。N 列：护盾一次性吸收、不回复、到期失效。
    //   ⚠ 设计没给半径 ⇒ 取 150（与 101803 毒液喷吐 / 101704 爆炸同档）。
    102304: {
        unitId: '68023',
        pvpSkillId: 30216,
        name: '大吼大叫',
        unlocks: [12, 24, 36],
        behaviorKey: 'roar',
        tiers: [
            { rate: 0.8, attackPct: -20, seconds: 3 },
            { rate: 1.1, attackPct: -30, seconds: 4 },
            { rate: 1.5, attackPct: -40, seconds: 5 },
        ],
        bag: (tier, index) => {
            const out = {
                roarCooldown: 8,
                roarRadius: 150,
                roarDamageRate: tier.rate,
                roarAttackPct: tier.attackPct,
                roarSeconds: tier.seconds,
            };
            if (index === 2) out.roarAllyShieldRatio = 0.15;
            return out;
        },
        desc: (tier, index) => {
            const parts = [
                `冷却 8 秒：对半径 150 内的敌人造成 ${pct(tier.rate)}% 伤害，`
                + `并使其攻击力降低 ${Math.abs(tier.attackPct)}%，持续 ${tier.seconds} 秒`,
            ];
            if (index === 2) parts.push('同时为半径内的友军提供自身 15% 最大生命的护盾');
            return parts.join('；');
        },
        forbid: [],
    },

    // ── 102004 飓风（三叶小丑 68020，蓝 2，盆栽·射手）
    //   设计 K/L/M：生成一个飓风，牵引敌人并每 0.5 秒造成 10% 伤害，持续 6/7/8 秒；
    //   N 列：移动速度 10px、方向随机变化、触碰到敌人每 0.5 秒 10%。
    //   ⚠ 设计没给的三个值（P 列里写明是补的）：
    //     · 牵引速度：`stormPullSpeed = 60` 逻辑 px/s（`legacy_traction` 那套 speed 口径，
    //       世界 18 px/s —— 够把敌人拽进风眼，又不至于像瞬移）；
    //     · 牵引范围：`stormPullRadius = 150`（= 伤害半径 90 的 1.67 倍，风先吸进来再打）；
    //     · 伤害半径：`stormRadius = 90`（区域本体大小，与设计 O 列那张 25 帧龙卷风贴图量级一致）。
    //   方向随机变化没有「多久换一次」⇒ `stormTurnSeconds = 1`（每 1 秒换一个方向）。
    102004: {
        unitId: '68020',
        pvpSkillId: 30714,
        name: '飓风',
        unlocks: [12, 24, 36],
        behaviorKey: 'storm_zone',
        tiers: [
            { seconds: 6 },
            { seconds: 7 },
            { seconds: 8 },
        ],
        bag: (tier) => ({
            stormCooldown: 12,
            stormRadius: 90,
            stormSeconds: tier.seconds,
            stormInterval: 0.5,
            stormDamageRate: 0.1,
            stormWanderSpeed: 10,
            stormTurnSeconds: 1,
            stormPullSpeed: 60,
            stormPullRadius: 150,
        }),
        desc: (tier) => `冷却 12 秒：在场上生成一个飓风，飓风以每秒 10px 随机飘移并牵引周围敌人，`
            + `每 0.5 秒对触碰到的敌人造成 10% 伤害，持续 ${tier.seconds} 秒`,
        forbid: [],
    },
};

const PLAN_CLIENT_KEYS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'behaviorKey', 'stateMode', 'desc', 'sourceVersion', 'publishStatus',
    'skillParamJson', 'statusId', 'statId', 'value',
];

function modifierIdsOf(chain) {
    const base = 94000000 + (chain - 100000) * 10;
    return [base + 1, base + 2, base + 3];
}

function rowsOf(chain, spec) {
    const ids = modifierIdsOf(chain);
    return spec.tiers.map((tier, index) => ({
        enabled: 1,
        modifierId: ids[index],
        unitId: spec.unitId,
        skillChainId: chain,
        skillName: spec.name,
        skillLevel: index + 1,
        unlockHeroLevel: spec.unlocks[index],
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: spec.pvpSkillId,
        behaviorKey: spec.behaviorKey,
        stateMode: 'none',
        desc: spec.desc(tier, index),
        sourceVersion: VERSION,
        publishStatus: '可发布',
        skillParamJson: JSON.stringify(spec.bag(tier, index)),
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
    let added = 0;
    let rewritten = 0;
    for (const want of wants) {
        const shaped = shape(want);
        const index = table.rows.findIndex((row) => Number(row.modifierId) === want.modifierId);
        if (index < 0) { table.rows.push(shaped); added += 1; continue; }
        if (sameRow(shaped, table.rows[index])) continue;
        table.rows[index] = shaped;
        rewritten += 1;
    }
    console.log(`[ok] ${label}：重写 ${rewritten}、追加 ${added}（共 ${table.rows.length} 行）`);
    return added;
}

function verify(chain, spec, rows, kind) {
    const ids = modifierIdsOf(chain);
    const plan = rows.filter((row) => Number(row.skillChainId) === chain)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    if (plan.length !== 3) throw new Error(`[fail] ${chain}（${kind}）应有 3 档，实际 ${plan.length}`);
    plan.forEach((row, index) => {
        const tier = spec.tiers[index];
        const label = `${chain} 第 ${index + 1} 档`;
        if (row.skillName !== spec.name) throw new Error(`[fail] ${label} 技能名不对：${row.skillName}`);
        if (row.desc !== spec.desc(tier, index)) throw new Error(`[fail] ${label} desc 不对：${row.desc}`);
        if (Number(row.modifierId) !== ids[index]) throw new Error(`[fail] ${label} 修改器号不对`);
        if (row.behaviorKey !== spec.behaviorKey) throw new Error(`[fail] ${label} behaviorKey 不对`);
        if (row.skillKind !== 'active_cd') throw new Error(`[fail] ${label} skillKind 必须是 active_cd`);
        if (row.stateMode !== 'none') throw new Error(`[fail] ${label} stateMode 必须是 none`);
        if (Number(row.unitId) !== Number(spec.unitId)) throw new Error(`[fail] ${label} unitId 不对`);
        if (Number(row.pvpSkillId) !== spec.pvpSkillId) throw new Error(`[fail] ${label} pvpSkillId 不对`);
        if (Number(row.unlockHeroLevel) !== spec.unlocks[index]) throw new Error(`[fail] ${label} 解锁等级不对`);
        if ((row.statusId ?? null) !== null || (row.statId ?? null) !== null || (row.value ?? null) !== null) {
            throw new Error(`[fail] ${label} 不该带 statusId / statId / value`);
        }
        const bag = JSON.parse(row.skillParamJson);
        const prefix = Object.keys(spec.bag(tier, index))[0].replace(/[A-Z].*$/, '');
        const bad = Object.keys(bag).filter((key) => !key.startsWith(prefix));
        if (bad.length) throw new Error(`[fail] ${label} 参数少了 ${prefix} 前缀：${bad}`);
        for (const key of spec.forbid) {
            if (key in bag) throw new Error(`[fail] ${label} 出现了不该有的键：${key}`);
        }
        const wantBag = spec.bag(tier, index);
        for (const key of Object.keys(wantBag)) {
            if (bag[key] !== wantBag[key]) {
                throw new Error(`[fail] ${label} 参数 ${key} 不对：${bag[key]} ≠ ${wantBag[key]}`);
            }
        }
        if (Object.keys(bag).length !== Object.keys(wantBag).length) {
            throw new Error(`[fail] ${label} 参数键数量不对：${Object.keys(bag)}`);
        }
    });
}

function main() {
    const only = process.argv.slice(2).map(Number).filter((chain) => !!SPECS[chain]);
    const chains = only.length ? only : Object.keys(SPECS).map(Number);
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

    const wants = chains.flatMap((chain) => rowsOf(chain, SPECS[chain]));
    const addedClient = apply(planClient, `pvpSkillPlan(client) ${chains.join('/')}`, wants, shapePlan);
    const addedRemote = apply(planRemote, `pvpSkillPlan(remoteRef) ${chains.join('/')}`, wants, shapePacked);

    for (const chain of chains) verify(chain, SPECS[chain], planClient.rows, 'client');
    //  只允许「一条链都没写」或「本轮所有链都写完」两种状态：写一半说明上一轮中途失败，
    //  而 `pvpSkillPlan` 只该有一份完整快照。行数与之同步（重跑时 `added = 0` 是最常见的情况）。
    if (addedClient !== addedRemote) throw new Error('[fail] 两份追加行数不一致');
    if (addedClient !== 0 && addedClient !== chains.length * 3) {
        throw new Error(`[fail] 只追加了 ${addedClient} 行（应为 ${chains.length * 3}）`);
    }
    if (planClient.rows.length !== before + addedClient) throw new Error('[fail] 行数对不上');
    if (planClient.rows.length !== planRemote.rows.length) throw new Error('[fail] 两份行数不一致');

    //  同卡邻居不许被带动（这几袋都是共用的）。
    const KIN = {
        101404: [101401, 101402, 101403],
        102204: [102201, 102202, 102203],
        102304: [102301, 102302, 102303],
        102004: [102001, 102002, 102003],
    };
    for (const chain of chains) {
        for (const kin of KIN[chain]) {
            const rows = planClient.rows.filter((row) => Number(row.skillChainId) === kin);
            if (rows.length !== 3) throw new Error(`[fail] ${kin} 原有 3 档被动了（现在 ${rows.length}）`);
            for (const row of rows) {
                const bag = JSON.parse(row.skillParamJson ?? '{}');
                const prefix = Object.keys(SPECS[chain].bag(SPECS[chain].tiers[0], 0))[0].replace(/[A-Z].*$/, '');
                if (Object.keys(bag).some((key) => key.startsWith(prefix))) {
                    throw new Error(`[fail] ${prefix} 参数串进了同卡 ${kin}`);
                }
            }
        }
    }

    writeTable(path.join(CLIENT_DIR, 'pvpSkillPlan.json'), planClient);
    writeTable(path.join(REMOTE_DIR, 'pvpSkillPlan.json'), planRemote);
    console.log(`[ok] 回读通过：${chains.join(' / ')} 各 3 档（共 ${planClient.rows.length} 行）`
        + ' + 同卡邻居完好 + 两份行数一致');
}

main();
