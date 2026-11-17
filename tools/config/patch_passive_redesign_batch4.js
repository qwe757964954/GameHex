// 被动重设计 V5 · 第四批：克制条 20 条（异种猎杀 / 职业猎杀 / 抗性装甲 / 职业抗性协议）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 的 L1~L3 列（2026-11-17 用户裁定「直接开工」）。
//
// 机制：判据编进 statId（`ZCStatSchema.ZC_COUNTER_STAT_IDS`），因为结算点只拿得到双方的
// `statPatch`，而参数袋按 `unitId:pvpSkillId` 合并 —— 同一张卡两条克制条（68020/68021）
// 写同一个键会互相覆盖。所以：
//
//   · 攻方 `counterCamp<N>` / `counterRole<N>` = 对某阵营 / 某职业增伤；
//   · 守方 `counteredCamp<N>` / `counteredRole<N>` = 受到某阵营 / 某职业减伤；
//   · 序号 = `ZC_CAMP_TRAITS`（花果 蘑菇 盆栽 僵尸）/ `ZC_ATTACK_TRAITS`（射手 战士 法师 坦克）的下标 + 1；
//   · 值走 `add` + **百分点**（45 = +45%），与 `critRate` 同口径 —— 结算处再除 100。
//
// 一条技能两个属性有两个载体：主属性写 `statId/operation/value`，第二条起写
// `skillParamJson` 的 `mix.<statId>`；再往后的「混搭尾」交 `patch_passive_redesign_tails.js`。
//
// 幂等：`mix.*` 里属于尾巴的那几个键原样保留（尾巴归 tails 脚本），其余一律重建；
// 所以本脚本与 tails 脚本**先后顺序无关**，重复跑结果逐字相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261117';

/** 序号口径，必须与 `ZCCombatCatalog.ZC_CAMP_TRAITS` / `ZC_ATTACK_TRAITS` 同序。 */
const CAMPS = ['花果', '蘑菇', '盆栽', '僵尸'];
const ROLES = ['射手', '战士', '法师', '坦克'];

/** 混搭尾的 statId：这些键归 `patch_passive_redesign_tails.js`，本脚本只保留、不重建。 */
const TAIL_STATS = new Set(['attack', 'damageRate', 'attackSpeed', 'attackRange', 'maxHp']);

/**
 * 每条技能：
 *   `targets` 第一项是主属性（写 statId 三格），其余写 `mix.*`；
 *   `crit` 是暴击率百分点（上限 15%，不单占一条被动，挂克制条尾部）；null = 本条不带暴击率；
 *   `levels` 三档解锁兵种等级；`tails` 交 tails 脚本，描述里也要写出来。
 */
const SKILLS = [
    {
        chain: 100103, card: '68001', name: '异种猎杀协议',
        targets: [['counter', 'camp', '蘑菇']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        chain: 100203, card: '68002', name: '抗性装甲协议',
        targets: [['countered', 'camp', '僵尸']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        chain: 100303, card: '68003', name: '职业猎杀协议',
        targets: [['counter', 'role', '坦克']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [9, 18, 24],
    },
    {
        chain: 100401, card: '68004', name: '职业猎杀协议',
        targets: [['counter', 'role', '战士']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [0, 14, 22],
    },
    {
        chain: 100503, card: '68005', name: '异种猎杀协议',
        targets: [['counter', 'camp', '蘑菇']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['attackSpeed', 0.07]],
    },
    {
        chain: 101103, card: '68011', name: '职业猎杀协议',
        targets: [['counter', 'role', '坦克']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        chain: 101203, card: '68012', name: '异种猎杀协议',
        targets: [['counter', 'camp', '盆栽']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        chain: 101302, card: '68013', name: '职业猎杀协议',
        targets: [['counter', 'role', '战士']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['attackRange', 0.10]],
    },
    {
        chain: 101402, card: '68014', name: '异种猎杀协议',
        targets: [['counter', 'camp', '盆栽']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['attackSpeed', 0.07]],
    },
    {
        chain: 101903, card: '68019', name: '职业猎杀协议',
        targets: [['counter', 'role', '法师']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        //  设计案原文「对僵尸阵营 / 战士职业」⇒ 两个判据各给一份同值增伤。
        //  🔴 僵尸·战士的目标两条都满足，会叠成 ×1.15²；设计案没写是否互斥，已记入研发档案。
        chain: 102001, card: '68020', name: '异种猎杀协议',
        targets: [['counter', 'camp', '僵尸'], ['counter', 'role', '战士']],
        tiers: [15, 20, 25], crit: null,
        levels: [0, 14, 22],
        tails: [['attack', 0.09]],
    },
    {
        chain: 102002, card: '68020', name: '职业猎杀协议',
        targets: [['counter', 'role', '战士']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [6, 16, 23],
    },
    {
        chain: 102101, card: '68021', name: '异种猎杀协议',
        targets: [['counter', 'camp', '僵尸']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [0, 14, 22],
    },
    {
        //  102102 是唯一一条「设计案明确不带暴击率」的蓝色克制条（L1/L2/L3 都只写增伤）。
        chain: 102102, card: '68021', name: '职业猎杀协议',
        targets: [['counter', 'role', '法师']], tiers: [25, 28, 32], crit: null,
        levels: [6, 16, 23],
    },
    {
        chain: 102202, card: '68022', name: '职业猎杀协议',
        targets: [['counter', 'role', '坦克']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['attackRange', 0.10]],
    },
    {
        chain: 102302, card: '68023', name: '职业抗性协议',
        targets: [['countered', 'role', '法师']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['maxHp', 0.07]],
    },
    {
        chain: 102803, card: '68028', name: '异种猎杀协议',
        targets: [['counter', 'camp', '花果']], tiers: [9, 11, 13], crit: [4, 5, 6],
        levels: [9, 18, 24],
    },
    {
        chain: 102904, card: '68029', name: '抗性装甲协议',
        targets: [['countered', 'camp', '盆栽']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [9, 18, 24],
    },
    {
        chain: 103003, card: '68030', name: '职业猎杀协议',
        targets: [['counter', 'role', '坦克']], tiers: [24, 27, 30], crit: [6, 8, 10],
        levels: [9, 18, 24],
    },
    {
        chain: 103102, card: '68031', name: '抗性装甲协议',
        targets: [['countered', 'camp', '盆栽']], tiers: [45, 50, 55], crit: [8, 10, 12],
        levels: [0, 16, 23],
        tails: [['attack', 0.07], ['damageRate', 0.06], ['maxHp', 0.07]],
    },
];

const TAIL_TEXT = {
    attack: '攻击提高', damageRate: '伤害提高', attackSpeed: '攻击速度提高',
    attackRange: '攻击范围提高', maxHp: '最大生命提高',
};

/** `['counter','camp','蘑菇']` → `counterCamp2`。 */
function statIdOf([direction, kind, name]) {
    const list = kind === 'camp' ? CAMPS : ROLES;
    const index = list.indexOf(name) + 1;
    if (index <= 0) throw new Error(`未知的${kind === 'camp' ? '阵营' : '职业'}：${name}`);
    return `${direction}${kind === 'camp' ? 'Camp' : 'Role'}${index}`;
}

function targetNameOf([, kind, name]) {
    return `${name}${kind === 'camp' ? '阵营' : '职业'}`;
}

/**
 * 一句判据文案。同向的多个判据合成一句（设计案原文「对僵尸阵营 / 战士职业的目标伤害提高15%」），
 * 不同向才拆成两句。
 */
function rulesTextOf(targets, pct) {
    const attacking = targets.filter(([direction]) => direction === 'counter');
    const defending = targets.filter(([direction]) => direction === 'countered');
    const parts = [];
    if (attacking.length) {
        parts.push(`对${attacking.map(targetNameOf).join(' / ')}的目标伤害提高${pct}%`);
    }
    if (defending.length) {
        parts.push(`受到${defending.map(targetNameOf).join(' / ')}目标的伤害降低${pct}%`);
    }
    return parts.join('；');
}

function tailText(tails) {
    return tails.map(([stat, value]) => `${TAIL_TEXT[stat] ?? stat}${Math.round(value * 100)}%`).join('，');
}

function descOf(spec, tier) {
    let text = rulesTextOf(spec.targets, spec.tiers[tier]);
    if (spec.crit) text += `，暴击率提高${spec.crit[tier]}%`;
    if (spec.tails) text += `；${tailText(spec.tails)}`;
    return text;
}

/** 主属性以外的键：其余判据 + 暴击率。 */
function mixOf(spec, tier) {
    const mix = {};
    for (const target of spec.targets.slice(1)) mix[`mix.${statIdOf(target)}`] = spec.tiers[tier];
    if (spec.crit) mix['mix.critRate'] = spec.crit[tier];
    return mix;
}

/** 尾巴的 `mix.*` 归 tails 脚本 —— 只保留、不重建，因此两个脚本先后顺序无关。 */
function paramsOf(existing, spec, tier) {
    const kept = {};
    if (existing) {
        for (const [key, value] of Object.entries(JSON.parse(existing))) {
            if (!key.startsWith('mix.')) continue;
            if (!TAIL_STATS.has(key.slice(4).split('.')[0])) continue;
            kept[key] = value;
        }
    }
    return JSON.stringify({ ...kept, ...mixOf(spec, tier) });
}

/** `94000000 + (链尾4位) * 10 + 档位`（与 102502 → 94025021 同一套规则）。 */
function modifierIdOf(chain, tier) {
    return 94000000 + (chain % 10000) * 10 + tier;
}

function main() {
    const remotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const clientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(remotePath);
    const client = readTable(clientPath);

    //  已有行的 modifierId 一律不动：`cardLevelUp.skillList` 引用的是它，
    //  换号等于把「升级到 N 级解锁这条技能」的接线剪断。只有整条链新建时才按规则生成。
    const existingModifierIds = new Map();
    for (const row of remote.rows) {
        const chain = Number(row.skillChainId);
        if (!existingModifierIds.has(chain) && Number(row.modifierId) > 0) {
            existingModifierIds.set(chain, Number(row.modifierId));
        }
    }

    //  两份磁盘格式的列序以 remoteRef 的 `k` 为准（client 是行对象，没有列序）。
    const COLUMNS = remote.keys ?? Object.keys(remote.rows[0]);

    let created = 0;
    let updated = 0;
    for (const table of [remote, client]) {
        for (const spec of SKILLS) {
            const occupied = new Set(
                table.rows.filter((row) => Number(row.skillChainId) !== spec.chain)
                    .map((row) => Number(row.modifierId)),
            );
            for (let tier = 0; tier < 3; tier += 1) {
                const level = tier + 1;
                const main = table.rows.find((row) => Number(row.skillChainId) === spec.chain
                    && Number(row.skillLevel) === level);
                const template = main ?? table.rows.find((row) => String(row.unitId) === spec.card);
                if (!template) throw new Error(`pvpSkillPlan 找不到 ${spec.card} 的任何行做模板`);
                const baseModifierId = existingModifierIds.get(spec.chain) ?? null;
                let modifierId;
                if (main) {
                    modifierId = Number(main.modifierId);
                } else if (baseModifierId != null) {
                    //  理论到不了这里（`existingModifierIds` 有值说明链上有行）；留着防半截数据。
                    modifierId = baseModifierId + tier;
                } else {
                    modifierId = modifierIdOf(spec.chain, level);
                    if (occupied.has(modifierId)) throw new Error(`${spec.chain} L${level} 的修改器号 ${modifierId} 已被占用`);
                }
                const [direction, kind, name] = spec.targets[0];
                const patch = {
                    enabled: 1,
                    modifierId,
                    unitId: spec.card,
                    skillChainId: spec.chain,
                    skillName: spec.name,
                    skillLevel: level,
                    unlockHeroLevel: spec.levels[tier],
                    skillKind: 'passive_stat',
                    passiveScope: 'deployed',
                    progressionMode: 'replace',
                    pvpSkillId: main ? main.pvpSkillId : template.pvpSkillId,
                    stateMode: 'none',
                    desc: descOf(spec, tier),
                    sourceVersion: VERSION,
                    publishStatus: '可发布',
                    statId: statIdOf([direction, kind, name]),
                    operation: 'add',
                    value: spec.tiers[tier],
                    behaviorKey: 'skill_params',
                    skillParamJson: paramsOf(main ? main.skillParamJson : null, spec, tier),
                    cooldown: null,
                    triggerEvent: 'build',
                    targetSelector: 'self',
                    durationSeconds: null,
                    maxStacks: null,
                    maxTriggers: null,
                    statusId: null,
                    statusStatJson: null,
                };
                if (main) {
                    //  旧机制的状态 / 参数必须一起清掉（100203 格挡、100303 点燃、103003 共生矩阵…），
                    //  否则「换了机制还留着旧 statusId」会让那张卡继续挂旧状态。
                    Object.assign(main, patch);
                    updated += 1;
                } else {
                    const row = {};
                    for (const key of COLUMNS) row[key] = key in patch ? patch[key] : null;
                    table.rows.push(row);
                    created += 1;
                }
            }
        }
    }

    const chains = new Set(SKILLS.map((spec) => spec.chain));
    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        for (const spec of SKILLS) {
            for (let tier = 0; tier < 3; tier += 1) {
                const hit = table.rows.find((row) => Number(row.id) === spec.chain
                    && Number(row.skilllevel) === tier + 1);
                if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
                hit.name = spec.name;
                hit.desc = descOf(spec, tier);
                hit.unlockarmylevel = spec.levels[tier];
                //  1 = 数值被动 / 2 = 行为被动。这 20 条现在全是纯数值被动。
                hit.armySkillType = 1;
            }
        }
        writeTable(file, table);
        console.log(`[ok] ${path.basename(dir)}/armySkillLevelUp.json：${SKILLS.length * 3} 行`);
    }

    writeTable(remotePath, remote);
    writeTable(clientPath, client);
    console.log(`[ok] 克制条 ${SKILLS.length} 条（链 ${[...chains].length}）：新建 ${created / 2} 行 ×2，改写 ${updated / 2} 行 ×2`);
}

main();
