// 第九批 · 疑问清单裁定（Q1/Q2/Q3）+ 两条主动打样（102403 冰山陨落 / 102404 急冻光线）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)`，卡 68024「急冻瓜」第 120 / 121 行。
//
// ── Q1：多弹按设计案 L 列 ──
//   核对结论：**已经全对，本脚本不动**。紫卡 101301 / 102201 = `bulletNum add 1`，
//   其余 7 条金卡 = `add 2`，与 L 列「额外 1 发 / 2 发」逐条一致；
//   `armySkillLevelUp.desc` 也已经是「1 道 / 2 道」。所以 Q1 只落一条裁定记录，零改动。
//
// ── Q2：101702 噬血蔓延 整条按 L 列重建 ──
//   原落地是「爆囊扩散」的残留：主链 `attackSpeed addRate 0.3/0.38/0.46` + 溅射 12/16/20%，
//   与设计案 L 列（吸血 30/34/38% + 溅射 40/44/48%）完全不是一套。
//   重建后：
//     主链 940170xx  `lifestealRate add 0.30/0.34/0.38`（unit 域绝对值，不能写 addRate）
//     子链 949170xx  `damageRate addRate 0.12`（三档同值）
//     参数袋        `lifestealSpreadRate 0.5`（扩散段折算）+ `splashDamageRate 0.40/0.44/0.48`
//                   + `splashFalloff 0.3` + `splashRadius 38/46/55`（设计案没写半径，沿用已落地的）
//                   + `mix.attack.addRate 0.14` / `mix.attackRange.addRate 0.20`（混搭尾）
//
// ── Q3：102001 异种猎杀协议 文案「间接版本」 ──
//   机制不变（`counterCamp4` + `mix.counterRole2` 两条判据仍然各自结算、同时命中就是叠乘），
//   只把玩家可见的 desc 从「僵尸阵营 / 战士职业」改成「僵尸阵营、战士职业」的并列枚举，
//   不再用斜杠暗示「二选一」，也不写「两个条件同时满足会叠加」。
//
// ── 打样：102403 / 102404 ──
//   这两条在设计案里只有 `697` / `700` 两个数字（Q4 被覆盖），机制由本批补：
//
//   102403 冰山陨落（主动-冷却 14 秒）→ `self_aura` 车道（`auraReadyAt`）
//     在自身位置引爆冰山，张开半径 120 的冰域，持续 3 秒、每 0.5 秒一跳并减速 50%。
//     选这条车道的理由（而不是新建「定点区域」）：
//       · 设计案表现列要求「技能持续过程中有明确的蓝色光圈代表技能范围」——
//         `self_aura` 的区域本身就是一条 `holdVisual` 的持续表现，光圈与判定范围同源；
//       · `auraReadyAt` 在 `ZC_CD_REDUCE_READY_KEYS` 里 ⇒ 同卡 102401「裂变共鸣」的
//         「每次普攻命中回退其他主动冷却」**立刻点亮**，这正是本轮打样的目的。
//
//   102404 急冻光线（主动-累计普攻 9 次）→ `random_strike` 车道（`strikeEvery`）
//     累计 9 次普攻后，向最近的 3 个敌人各打一道急冻光线，命中麻痹 3 秒（软控）。
//     累计普攻型**不吃** 102401 的冷却回退 —— 它没有 `*ReadyAt`，与设计案
//     「不作用于普攻本身」的口径一致，属于刻意如此。
//
// 幂等：按「链 + 档」定位改写；新增行只在缺失时插入（已存在就整行重写），重跑结果逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V9-20261117';

/** 子链槽位统一用 `addRate`（比例尾巴）；主链用 `add`（绝对值）。*/
const SLOT_OPERATION = 'addRate';

// ── Q2：101702 噬血蔓延 ──────────────────────────────────────────────────────
const LIFESTEAL = [30, 34, 38];          // 吸血比例（%），主链 `lifestealRate add` 传 0.30/0.34/0.38
const SPLASH_RATE = [0.40, 0.44, 0.48];  // 溅射倍率（按 L 列，不是原来的 12/16/20%）
const SPLASH_RADIUS = [38, 46, 55];      // 半径设计案没写，沿用已落地值
const SPLASH_FALLOFF = 0.3;
const SPREAD_LIFESTEAL = 0.5;            // 扩散段按 50% 折算
//  尾巴按**百分点**存，写表时再 /100 —— 直接用 0.14*100 会打出 14.000000000000002。
const BLOOD_TAILS = { attack: 14, damage: 12, range: 20 };
const BLOOD_LEVELS = [6, 16, 26];
const BLOOD_SLOT_CHAIN = 191702;

function bloodDesc(tier) {
    return `普攻造成伤害的${LIFESTEAL[tier]}%转化为自身生命（扩散段按${SPREAD_LIFESTEAL * 100}%折算）`
        + `；命中对周围造成${Math.round(SPLASH_RATE[tier] * 100)}%溅射伤害（同一爆点第2个目标起每次×0.7）`
        + `；攻击提高${BLOOD_TAILS.attack}%，伤害提高${BLOOD_TAILS.damage}%`
        + `，攻击范围提高${BLOOD_TAILS.range}%`;
}

// ── 打样：两条主动 ───────────────────────────────────────────────────────────
const ACTIVES = [
    {
        chain: 102403, card: '68024', name: '冰山陨落', levels: [9, 18, 27],
        modifierBase: 94024030, pvpSkillId: 30671,
        skillKind: 'active_cd', behaviorKey: 'self_aura',
        damage: [0.55, 0.65, 0.75],
        desc: (spec, tier) => `冷却 14 秒：在自身位置引爆冰山，张开半径 120 的冰域，`
            + `持续 3 秒、每 0.5 秒对范围内敌人造成 ${Math.round(spec.damage[tier] * 100)}% 伤害`
            + '并使其移速降低 50%',
        params: (spec, tier) => ({
            auraCooldown: 14,
            auraSeconds: 3,
            auraInterval: 0.5,
            auraRadius: 120,
            auraDamageRate: spec.damage[tier],
            auraSlowRatio: 0.5,
        }),
    },
    {
        chain: 102404, card: '68024', name: '急冻光线', levels: [12, 24, 36],
        modifierBase: 94024040, pvpSkillId: 30671,
        skillKind: 'active_attack', behaviorKey: 'random_strike',
        damage: [0.8, 0.95, 1.1],
        desc: (spec, tier) => `累计 9 次普攻：向最近的 3 个敌人各射出一道急冻光线，`
            + `造成 ${Math.round(spec.damage[tier] * 100)}% 伤害并使其麻痹 3 秒`
            + '（只禁攻击、移速 −50%）',
        params: (spec, tier) => ({
            strikeEvery: 9,
            strikeCount: 3,
            strikeRadius: 260,
            strikeDamageRate: spec.damage[tier],
            strikeNearest: 1,
            strikeAppliesStatus: 1,
        }),
    },
];

/** Q3：三条的玩家可见文案（数值与两条判据一手不动）。*/
const INDIRECT_COPY = [
    '对僵尸阵营、战士职业的目标伤害提高15%；攻击提高9%',
    '对僵尸阵营、战士职业的目标伤害提高20%；攻击提高9%',
    '对僵尸阵营、战士职业的目标伤害提高25%；攻击提高9%',
];

function modifierIdFor(chainId, level, planTable) {
    const row = planTable.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
    if (!row) throw new Error(`pvpSkillPlan 里查不到 ${chainId} L${level} 的修改器号`);
    return Number(row.modifierId);
}

function findRow(table, chainId, level) {
    return table.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
}

// ── Q2 重建 101702 ──────────────────────────────────────────────────────────
function rebuildBlood(table) {
    let touched = 0;
    for (let tier = 0; tier < 3; tier += 1) {
        const level = tier + 1;
        const main = findRow(table, 101702, level);
        if (!main) throw new Error(`pvpSkillPlan 缺少 101702 L${level}`);
        if (String(main.unitId) !== '68017') {
            throw new Error(`101702 归属 ${main.unitId}，与设计案 68017 不符`);
        }
        main.skillName = '噬血蔓延';
        main.unlockHeroLevel = BLOOD_LEVELS[tier];
        main.statId = 'lifestealRate';
        main.operation = 'add';
        main.value = LIFESTEAL[tier] / 100;
        main.behaviorKey = 'skill_params';
        main.skillKind = 'passive_stat';
        main.stateMode = 'none';
        main.cooldown = null;
        main.triggerEvent = null;
        main.statusId = null;
        main.statusStatJson = null;
        main.skillParamJson = JSON.stringify({
            lifestealSpreadRate: SPREAD_LIFESTEAL,
            splashDamageRate: SPLASH_RATE[tier],
            splashFalloff: SPLASH_FALLOFF,
            splashRadius: SPLASH_RADIUS[tier],
            'mix.attack.addRate': BLOOD_TAILS.attack / 100,
            'mix.attackRange.addRate': BLOOD_TAILS.range / 100,
        });
        main.desc = bloodDesc(tier);
        main.sourceVersion = VERSION;
        touched += 1;

        const slot = findRow(table, BLOOD_SLOT_CHAIN, level);
        if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${BLOOD_SLOT_CHAIN} L${level}`);
        slot.skillName = '噬血蔓延';
        slot.unlockHeroLevel = BLOOD_LEVELS[tier];
        slot.statId = 'damageRate';
        slot.operation = SLOT_OPERATION;
        slot.value = BLOOD_TAILS.damage / 100;
        slot.skillParamJson = null;
        slot.desc = bloodDesc(tier);
        slot.sourceVersion = VERSION;
        touched += 1;
    }
    return touched;
}

// ── Q3 文案 ────────────────────────────────────────────────────────────────
function rewriteIndirectCopy(table) {
    let touched = 0;
    for (let tier = 0; tier < 3; tier += 1) {
        const row = findRow(table, 102001, tier + 1);
        if (!row) throw new Error(`pvpSkillPlan 缺少 102001 L${tier + 1}`);
        if (String(row.unitId) !== '68020') {
            throw new Error(`102001 归属 ${row.unitId}，与设计案 68020 不符`);
        }
        //  数值与两条判据一手不动，只换玩家可见的那句话。
        row.desc = INDIRECT_COPY[tier];
        row.sourceVersion = VERSION;
        touched += 1;
    }
    return touched;
}

// ── 打样：两条主动的计划行 ──────────────────────────────────────────────────
function ensureActives(table, added) {
    let touched = 0;
    for (const spec of ACTIVES) {
        for (let tier = 0; tier < 3; tier += 1) {
            const level = tier + 1;
            const modifierId = spec.modifierBase + level;
            const desc = spec.desc(spec, tier);
            const skillParamJson = JSON.stringify(spec.params(spec, tier));
            let row = findRow(table, spec.chain, level);
            if (!row) {
                row = {
                    enabled: 1,
                    modifierId,
                    unitId: spec.card,
                    skillChainId: spec.chain,
                    skillName: spec.name,
                    skillLevel: level,
                    unlockHeroLevel: spec.levels[tier],
                    skillKind: spec.skillKind,
                    passiveScope: 'battle',
                    progressionMode: 'replace',
                    pvpSkillId: spec.pvpSkillId,
                    stateMode: 'none',
                    desc,
                    sourceVersion: VERSION,
                    publishStatus: '可发布',
                    statId: null,
                    operation: null,
                    value: null,
                    behaviorKey: spec.behaviorKey,
                    skillParamJson,
                    cooldown: null,
                    triggerEvent: 'active',
                    targetSelector: null,
                    durationSeconds: null,
                    maxStacks: null,
                    maxTriggers: null,
                    statusId: null,
                    statusStatJson: null,
                };
                //  插在 102402 那一组后面，保持「同卡同链挨着」的排版；
                //  找不到锚点就退到 102401 之后，再找不到才 push 到表尾。
                const anchor = lastIndexOfChain(table, 102402) ?? lastIndexOfChain(table, 102401);
                if (anchor === null || anchor < 0) table.rows.push(row);
                else table.rows.splice(anchor + 1, 0, row);
                added.push(`${spec.chain} L${level}`);
            } else {
                row.skillName = spec.name;
                row.unlockHeroLevel = spec.levels[tier];
                row.skillKind = spec.skillKind;
                row.behaviorKey = spec.behaviorKey;
                row.desc = desc;
                row.skillParamJson = skillParamJson;
                row.publishStatus = '可发布';
                row.sourceVersion = VERSION;
            }
            //  🔴 两条主动都**不能**写 `statusId`：那是整卡共用的一个槽
            //  （102401~102404 全挂在 `68024:30671` 上），写了会让这张卡的普攻每一发都挂状态。
            row.statusId = null;
            row.statusStatJson = null;
            touched += 1;
        }
    }
    return touched;
}

function lastIndexOfChain(table, chainId) {
    let found = null;
    table.rows.forEach((row, index) => {
        if (Number(row.skillChainId) === chainId) found = index;
    });
    return found;
}

function paramsUnchanged(a, b, columns) {
    return stableJson(a, columns) === stableJson(b, columns);
}

/**
 * 键序无关的比较：两份产物一份按列序列化、一份按对象字面量序，值相同就够了。
 *
 * 列集合必须取**表头全列**而不是 `Object.keys(row)` —— client 那份里没写过的列
 * （比如 `statusStatJson`）根本不出现在对象上，用行自己的键会比出假差异。
*/
function stableJson(row, columns) {
    return JSON.stringify([...columns].sort().map((key) => [key, row[key] ?? null]));
}

// ── armySkillLevelUp：名称 / 描述 / 修改器引用 ─────────────────────────────
function syncSkillLevelUp(table, planRemote) {
    let touched = 0;

    const bloodChains = [101702, BLOOD_SLOT_CHAIN];
    for (let tier = 0; tier < 3; tier += 1) {
        const hit = table.rows.find((row) => Number(row.id) === 101702
            && Number(row.skilllevel) === tier + 1);
        if (!hit) throw new Error(`armySkillLevelUp 缺少 101702 L${tier + 1}`);
        hit.name = '噬血蔓延';
        hit.desc = bloodDesc(tier);
        hit.unlockarmylevel = BLOOD_LEVELS[tier];
        hit.armySkillType = 1;
        hit.modfiy = bloodChains.map((chainId) => modifierIdFor(chainId, tier + 1, planRemote));
        touched += 1;
    }

    for (const spec of ACTIVES) {
        for (let tier = 0; tier < 3; tier += 1) {
            const hit = table.rows.find((row) => Number(row.id) === spec.chain
                && Number(row.skilllevel) === tier + 1);
            if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
            hit.name = spec.name;
            hit.desc = spec.desc(spec, tier);
            hit.unlockarmylevel = spec.levels[tier];
            //  主动技能（armySkillType 2）在 K 表里早就建好行了，这里只补名/描述/引用。
            hit.armySkillType = 2;
            hit.modfiy = [modifierIdFor(spec.chain, tier + 1, planRemote)];
            touched += 1;
        }
    }

    for (let tier = 0; tier < 3; tier += 1) {
        const hit = table.rows.find((row) => Number(row.id) === 102001
            && Number(row.skilllevel) === tier + 1);
        if (!hit) throw new Error(`armySkillLevelUp 缺少 102001 L${tier + 1}`);
        hit.desc = INDIRECT_COPY[tier];
        touched += 1;
    }

    return touched;
}

function main() {
    const planRemotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const planClientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(planRemotePath);
    const client = readTable(planClientPath);

    if (remote.rows.length !== client.rows.length) {
        throw new Error(`两份 pvpSkillPlan 行数不一致：remoteRef ${remote.rows.length} / client ${client.rows.length}`);
    }

    const report = { blood: 0, indirect: 0, actives: 0, added: [] };
    report.blood = rebuildBlood(remote) + rebuildBlood(client);
    report.indirect = rewriteIndirectCopy(remote) + rewriteIndirectCopy(client);
    report.actives = ensureActives(remote, report.added) + ensureActives(client, report.added);

    //  新增行的键序对齐 remoteRef 的列序（client 那份是对象字面量序，会与邻行不一致）。
    //  只重排本批新增的行，其余行一个字节都不碰。
    for (const table of [remote, client]) {
        for (const spec of ACTIVES) {
            for (let level = 1; level <= 3; level += 1) {
                const row = findRow(table, spec.chain, level);
                if (!row) continue;
                if (remote.keys.every((key) => Object.keys(row)[0] === key)) continue;
                if (Object.keys(row).join() === remote.keys.join()) continue;
                const ordered = {};
                for (const key of remote.keys) ordered[key] = row[key] ?? null;
                const index = table.rows.indexOf(row);
                table.rows[index] = ordered;
            }
        }
    }

    if (remote.rows.length !== client.rows.length) {
        throw new Error(`写完两份 pvpSkillPlan 行数不一致：${remote.rows.length} / ${client.rows.length}`);
    }

    //  逐格互校：两份产物必须一字不差（除格式），否则运行时读哪份都可能对不上。
    for (let index = 0; index < remote.rows.length; index += 1) {
        if (!paramsUnchanged(remote.rows[index], client.rows[index], remote.keys)) {
            throw new Error(`第 ${index} 行两份 pvpSkillPlan 不一致：${JSON.stringify(remote.rows[index])}`
                + ` vs ${JSON.stringify(client.rows[index])}`);
        }
    }

    writeTable(planRemotePath, remote);
    writeTable(planClientPath, client);

    let levelRows = 0;
    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        levelRows += syncSkillLevelUp(table, remote);
        writeTable(file, table);
    }

    console.log(`[ok] 101702 噬血蔓延 重建 ${report.blood} 行（主链 + 子链 191702 各 3 档）`);
    console.log(`[ok] 102001 文案间接版 ${report.indirect} 行（数值与两条判据未动）`);
    console.log(`[ok] 102403 / 102404 计划行 ${report.actives} 行（新增 ${report.added.length} 行）`);
    console.log(`[ok] armySkillLevelUp ${levelRows} 行（名称 / 描述 / modfiy）`);
    console.log(`[ok] 两份 pvpSkillPlan 行数 ${remote.rows.length}，逐格一致`);
}

main();
