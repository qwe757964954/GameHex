// 被动重设计 V5 · 第六批：连击 6 条（蔓生连打 / 蔓生三连）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 第 23 / 34 / 43 / 68 / 88 / 123 行的 L1~L3 列 + P 列落地口径。
//
// 机制口径（本批唯一写法）
// ────────────────────────
//   · 段数走 unit 域 `attackCount`（映射到 `multiHitFlat`）—— 1 = 多打 1 段（共 2 段），
//     2 = 多打 2 段（共 3 段）。它 fold 进 statPatch，是所有行**相加**的，所以一条技能只能有一行写。
//   · 段间递减走 `skillParamJson.comboDamage` + `comboFalloff`（2026-11-17 新增，见
//     `ZCAttackResolutionSystem.comboDamageMultiplierOf`）：`comboDamage=60` + `comboFalloff=0.4`
//     就是设计案的「第 2 段 60%、第 3 段 36%」（第 3 段 = 60% × 0.6）。
//   · 尾巴（攻击 / 伤害 / 攻速）优先落**子链槽位**（190702 / 280702 这类既有行，只能改写不能删），
//     没有子链的卡走 `mix.<statId>.addRate`。
//
// 🔴 名称规则：只有机制完全一样的才同名。金卡是 2 段（蔓生三连），紫卡是 1 段（蔓生连打）——
//   段数不同 ⇒ 机制不同 ⇒ 不能叫同一个名字。
//
// 🔴 段数只能写一处：`attackCount` 是 flat 加法，主链写一次、子链再写一次就会多打一段。
//
// 本批还要一并修掉的既有脏数据（都在同 6 条技能上）
// ──────────────────────────────────────────────
//   · `100501` 还是旧机制「高速移动」（`moveSpeed addRate 0.15`），本批整段换成连击；
//   · `101401` 在 `pvpSkillPlan` 里**一行都没有**（只有 K 表空壳行），本批补 94014011~13；
//   · `190702 / 280702 / 190901 / 280901` 四条子链的解锁等级是 1/16/23、1/14/22 之类的旧值，
//     统一到主链的 3 / 10 / 22（子链与主链必须同档解锁，否则尾巴会在主技能之前/之后出现）；
//   · K 表 `modfiy` 与 `pvpSkillPlan` 对不上：`100702 / 100901` 是空数组（子链有行却没人引用），
//     `101801 / 102501` 指向 `94925011 / 95825011` 这些**根本不存在的行**。本批按实际行重写。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V6-20261117';

/** 第 2 段占首段的百分比（三档），第 3 段 = 这个数 × 0.6。 */
const COMBO_DAMAGE = [60, 65, 70];
/** 每往后一段再折掉多少 ⇒ 0.4 表示「乘 0.6」。 */
const COMBO_FALLOFF = 0.4;
/** 三档解锁兵种等级：这 6 条都在这张卡的**第 1 格**（`pvpCard.skillList[0]`）⇒ 3 / 10 / 22。 */
const LEVELS = [3, 10, 22];

/**
 * 每条技能：
 *   `hits`  —— `attackCount` 的值（额外段数，不含首段）；
 *   `slots` —— 子链槽位改写：`[子链, statId, 三档值]`（operation 一律 `addRate`）；
 *   `mix`   —— 没有子链可挂时走这里（键是完整的 `mix.<statId>.addRate`）。
 */
const SKILLS = [
    {
        //  紫卡 1 段。原「高速移动」整段换掉（设计案 mech：「移速不在战士任何档位池」）。
        chain: 100501, card: '68005', name: '蔓生连打', hits: 1,
    },
    {
        //  金卡 2 段 + 攻击 18% / 伤害 15% / 攻速 18%。
        chain: 100702, card: '68007', name: '蔓生三连', hits: 2,
        slots: [
            [280702, 'attack', [0.18, 0.18, 0.18]],
            [190702, 'attackSpeed', [0.18, 0.18, 0.18]],
        ],
        mix: { 'mix.damageRate.addRate': [0.15, 0.15, 0.15] },
    },
    {
        //  金卡 2 段 + 攻击 26% / 攻速 28%。
        chain: 100901, card: '68009', name: '蔓生三连', hits: 2,
        slots: [
            [280901, 'attack', [0.26, 0.26, 0.26]],
            [190901, 'attackSpeed', [0.28, 0.28, 0.28]],
        ],
    },
    {
        //  紫卡 1 段，`pvpSkillPlan` 原本一行都没有 ⇒ 本批新建 94014011~13。
        chain: 101401, card: '68014', name: '蔓生连打', hits: 1, create: true,
    },
    {
        //  金卡 2 段 + 攻击 26% / 攻速 28%。没有子链 ⇒ 两条尾巴都走 mix。
        chain: 101801, card: '68018', name: '蔓生三连', hits: 2,
        mix: {
            'mix.attack.addRate': [0.26, 0.26, 0.26],
            'mix.attackSpeed.addRate': [0.28, 0.28, 0.28],
        },
    },
    {
        //  金卡 2 段 + 攻击 26% / 攻速 28%（同 100901，但 68025 没有子链行）。
        chain: 102501, card: '68025', name: '蔓生三连', hits: 2,
        mix: {
            'mix.attack.addRate': [0.26, 0.26, 0.26],
            'mix.attackSpeed.addRate': [0.28, 0.28, 0.28],
        },
    },
];

const TAIL_TEXT = {
    attack: '攻击提高', damageRate: '伤害提高', attackSpeed: '攻击速度提高',
    attackRange: '攻击范围提高', maxHp: '最大生命提高',
};
/** 文案里尾巴的书写顺序（设计案 L 列的语序）。 */
const TAIL_ORDER = ['attack', 'damageRate', 'attackSpeed', 'attackRange', 'maxHp'];

/** 第 3 段百分比：60 → 36、65 → 39、70 → 42。 */
function thirdPct(tier) {
    return Math.round(COMBO_DAMAGE[tier] * (1 - COMBO_FALLOFF));
}

/** 该档所有尾巴的 `[statId, 值]`（子链槽位 + mix 合并），按 `TAIL_ORDER` 排。 */
function tailsOf(spec, tier) {
    const found = new Map();
    for (const [, statId, values] of spec.slots ?? []) found.set(statId, values[tier]);
    for (const [key, values] of Object.entries(spec.mix ?? {})) {
        found.set(key.slice(4).split('.')[0], values[tier]);
    }
    return TAIL_ORDER.filter((statId) => found.has(statId))
        .map((statId) => [statId, found.get(statId)]);
}

/** 一句技能文案：段数 + 各档递减百分比 + 尾巴。 */
function descOf(spec, tier) {
    const second = COMBO_DAMAGE[tier];
    let text = spec.hits === 1
        ? `普攻追加1段连击（第2段伤害${second}%）`
        : `普攻追加2段连击（第2段伤害${second}%，第3段伤害${thirdPct(tier)}%）`;
    const tails = tailsOf(spec, tier).map(([statId, value]) =>
        `${TAIL_TEXT[statId] ?? statId}${Math.round(value * 100)}%`);
    if (tails.length) text += `；${tails.join('，')}`;
    return text;
}

/**
 * 主链行的 `skillParamJson`：整体重建（原数据是别的机制的参数，留着会「换了机制还在生效」）。
 * `comboFalloff` 一律写 —— 1 段的卡虽然用不上第 3 段，写上去是为了让「本技能走连击递减」这件事可见。
 */
function paramsOf(spec, tier) {
    const out = { comboDamage: COMBO_DAMAGE[tier], comboFalloff: COMBO_FALLOFF };
    for (const [key, values] of Object.entries(spec.mix ?? {})) out[key] = values[tier];
    return JSON.stringify(out);
}

/** 新建行时用的全字段模板（照 94014021 那行的键集，值是「本批这 6 条」的公共部分）。 */
function newRowOf(spec, tier, chainId) {
    return {
        enabled: 1, modifierId: chainId, unitId: spec.card, skillChainId: spec.chain,
        skillName: spec.name, skillLevel: tier + 1, unlockHeroLevel: LEVELS[tier],
        skillKind: 'passive_stat', passiveScope: 'deployed', progressionMode: 'replace',
        pvpSkillId: null, stateMode: 'none', desc: descOf(spec, tier), sourceVersion: VERSION,
        publishStatus: '1', statId: 'attackCount', operation: 'add', value: spec.hits,
        behaviorKey: null, skillParamJson: paramsOf(spec, tier), cooldown: null,
        triggerEvent: null, targetSelector: null, durationSeconds: null, maxStacks: null,
        maxTriggers: null, statusId: null, statusStatJson: null,
    };
}

/**
 * 新建行的修改器号：`940` + 链尾四位 + 档位。
 * 102501 → 94025011、100702 → 94007021 都是这套算法（链尾 `2501` / `0702` 补足四位）。
 * ⚠️ 只有「表里没有行、必须新建」时才算号；子链的号一律从表里反查（见 `modifierIdFor`）。
 */
function modifierIdOf(chain, level) {
    return Number(`940${String(chain % 100000).padStart(4, '0')}${level}`);
}

function main() {
    const planRemote = path.join(REMOTE, 'pvpSkillPlan.json');
    const planClient = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(planRemote);
    const client = readTable(planClient);

    //  该卡的 `unitSkillId`（新建行要填 `pvpSkillId`，它必须等于普攻行的 id，否则参数进不去 runtime）。
    const cards = readTable(path.join(REMOTE, 'pvpCard.json')).rows;
    const unitSkillOf = new Map(cards.map((card) => [String(card.id), card.unitSkillId]));

    let created = 0;
    let mainRows = 0;
    let slotRows = 0;

    for (const table of [remote, client]) {
        for (const spec of SKILLS) {
            for (let tier = 0; tier < 3; tier += 1) {
                const level = tier + 1;
                let row = table.rows.find((item) => Number(item.skillChainId) === spec.chain
                    && Number(item.skillLevel) === level);
                if (!row) {
                    if (!spec.create) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
                    const modifierId = modifierIdOf(spec.chain, level);
                    if (table.rows.some((item) => Number(item.modifierId) === modifierId)) {
                        throw new Error(`${spec.chain} L${level} 的修改器号 ${modifierId} 已被占用`);
                    }
                    row = newRowOf(spec, tier, modifierId);
                    row.pvpSkillId = Number(unitSkillOf.get(spec.card) ?? 0);
                    //  插在同卡第一条链之前，保持「同卡的行挨在一起」的既有排布。
                    const anchor = table.rows.findIndex((item) => String(item.unitId) === spec.card);
                    if (anchor < 0) throw new Error(`表里找不到 ${spec.card} 的任何行，无法定位插入点`);
                    table.rows.splice(anchor, 0, row);
                    created += 1;
                }
                if (String(row.unitId) !== spec.card) {
                    throw new Error(`${spec.chain} 归属 ${row.unitId}，与设计案 ${spec.card} 不符`);
                }
                //  🔴 段数只写这里：`attackCount` 是 flat 加法，第二处会把段数翻倍。
                row.skillName = spec.name;
                row.unlockHeroLevel = LEVELS[tier];
                row.statId = 'attackCount';
                row.operation = 'add';
                row.value = spec.hits;
                row.skillParamJson = paramsOf(spec, tier);
                row.desc = descOf(spec, tier);
                row.sourceVersion = VERSION;
                mainRows += 1;

                for (const [slotChain, statId, values] of spec.slots ?? []) {
                    const slot = table.rows.find((item) => Number(item.skillChainId) === slotChain
                        && Number(item.skillLevel) === level);
                    if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${slotChain} L${level}`);
                    slot.skillName = spec.name;
                    slot.statId = statId;
                    slot.operation = 'addRate';
                    slot.value = values[tier];
                    //  子链与主链同档解锁，否则尾巴会比主技能早出现 / 晚消失。
                    slot.unlockHeroLevel = LEVELS[tier];
                    slot.sourceVersion = VERSION;
                    //  子链的 desc 也要跟着换：它的旧文案还写着「移动速度提高 12%」这种
                    //  已经被本批删掉的尾巴，留着就是对着玩家承诺一个不存在的加成。
                    slot.desc = descOf(spec, tier);
                    //  子链不再带参数：`comboDamage` 是「一次出手多打几段」的口径，
                    //  挂到尾巴行上会与主链重复（按 `unitId:pvpSkillId` 覆盖合并，谁赢看行序）。
                    slot.skillParamJson = null;
                    slotRows += 1;
                }
            }
        }
    }

    //  K 表：名字 / 描述 / 解锁等级 / 修改器引用。
    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        for (const spec of SKILLS) {
            //  这一条技能点下去要生效的全部修改器：主链 + 子链尾巴（没有子链的卡只有主链）。
            const chains = [spec.chain, ...(spec.slots ?? []).map(([slotChain]) => slotChain)];
            for (let tier = 0; tier < 3; tier += 1) {
                const hit = table.rows.find((row) => Number(row.id) === spec.chain
                    && Number(row.skilllevel) === tier + 1);
                if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
                hit.name = spec.name;
                hit.desc = descOf(spec, tier);
                hit.unlockarmylevel = LEVELS[tier];
                //  1 = 数值被动 / 2 = 行为被动。连击是纯数值 + 普攻参数，无状态机。
                hit.armySkillType = 1;
                //  `modfiy` = 这一级点下去要生效的**全部**修改器号（主链 + 子链尾巴）。
                //  卡片详情页的「升级提升」按这个列表逐条回读，指到不存在的行就是空白。
                hit.modfiy = chains.map((chainId) => modifierIdFor(chainId, tier + 1, remote));
            }
        }
        writeTable(file, table);
        console.log(`[ok] ${path.basename(dir)}/armySkillLevelUp.json：${SKILLS.length * 3} 行`);
    }

    writeTable(planRemote, remote);
    writeTable(planClient, client);
    console.log(`[ok] 连击 ${SKILLS.length} 条：主链 ${mainRows / 2} 行 ×2，子链槽位 ${slotRows / 2} 行 ×2，`
        + `新建 ${created / 2} 行 ×2`);
}

/**
 * 按「技能链 + 档位」从 `pvpSkillPlan` 反查修改器号。
 * 子链的号直接从表里取（`94007021` 这类号不是算出来的，是表里既有的 —— 2026-11-17 踩过：
 * 自行推导 `97026011` 的域前缀，结果 J 表 upsert 匹配不到、追加出重复行）。
 */
function modifierIdFor(chainId, level, planTable) {
    const row = planTable.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
    if (!row) throw new Error(`pvpSkillPlan 里查不到 ${chainId} L${level} 的修改器号`);
    return Number(row.modifierId);
}

main();
