// 被动重设计 V5 · 第七批：破阵投枪 5 条（100701 / 100901 / 101802 / 102702 / 103302）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 第 33 / 43 / 89 / 134 / 164 行。
// 其中 **100901 是 2026-11-17 用户改的**：68009 的原「蔓生三连」整条换成投枪，尾巴沿用该卡
// 原本的预算（攻 26% / 攻速 28%），正好落在 68009 现成的两条子链上。
//
// 机制口径
// ────────
//   · 节拍：`skillParamJson.lanceEvery` = 4 / 3 / 2（按档位缩短），按**累计普攻次数**取模；
//   · 形态：触发那一次普攻**整份换成弹道**（`mode` / 弹速 / 弹体特效），攻击距离不变；
//   · 伤害：首目标 `lanceDamageRate = 0.7`（面板 70%），之后每穿一人 ×(1 − 0.35)
//     ⇒ 70% / 45.5% / 29.6%，四舍五入就是设计案的 70% / 45% / 30%；
//   · `lancePierceCount = 3` 是**命中目标总数**（含首目标），所以剩余穿透次数 = 3 − 1 = 2。
//     与既有 `pierceCount`（额外穿透次数）语义不同，代码里是两个键，别混。
//
// 🔴 行本身只带参数：`statId / operation / value` 全空、`behaviorKey = 'skill_params'`。
//   为什么必须有 behaviorKey —— `ZCMatchRuntimeCompiler` 只在「参数合并进已有运行时」或
//   「行自己带 behaviorKey 能新编出运行时」时才把 `skillParamJson` 并进去。68018（30667）
//   整张卡一条 behaviorKey 行都没有 ⇒ 它的参数**根本进不了运行时**（本批实测：改前
//   `skillRuntime.get('68018:30667')` 是 undefined）。带 `skill_params` 就自建一个。
//
// 🔴 一卡只能有一条链写 `lanceEvery`：同卡两处会按拍各触发一次，看起来「投枪连发」。
//
// 幂等：全部按「链 + 档」定位改写；行参数整体重建（旧机制残留的 `normalPierceCount` /
// `damageRate` 必须清掉，否则「换了机制还在生效」）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V7-20261117';

/** 三档触发间隔：每 4 / 3 / 2 次普攻。 */
const LANCE_EVERY = [4, 3, 2];
/** 命中目标总数（含首目标）。 */
const LANCE_TARGETS = 3;
/** 穿透衰减：每往后一个 ×0.65。 */
const LANCE_FALLOFF = 0.35;
/** 首目标伤害倍率（相对面板）。 */
const LANCE_DAMAGE_RATE = 0.7;

/**
 * 每条技能：
 *   `levels` —— 三档解锁兵种等级（主链所在格位：第 1 格 3/10/22、第 2 格 6/16/26）；
 *   `slots`  —— 子链槽位改写：`[子链, statId, 三档值]`（`operation` 一律 `addRate`）；
 *   `mix`    —— 没有子链可挂的尾巴走这里（键是完整的 `mix.<statId>.addRate`）。
 */
const SKILLS = [
    {
        //  68007 第 1 格。原「穿甲苔刺」（攻速 10/16/22）+ 子链 190701（伤害 6/10/14）。
        chain: 100701, card: '68007', levels: [3, 10, 22],
        slots: [[190701, 'attack', [0.24, 0.24, 0.24]]],
        mix: { 'mix.attackSpeed.addRate': [0.26, 0.26, 0.26] },
    },
    {
        //  68009 第 1 格。2026-11-17 用户改：原「蔓生三连」（连击 2 段）整条换成投枪。
        //  现成两条子链正好装尾巴：280901 攻 26%、190901 攻速 28%。
        chain: 100901, card: '68009', levels: [3, 10, 22],
        slots: [[280901, 'attack', [0.26, 0.26, 0.26]], [190901, 'attackSpeed', [0.28, 0.28, 0.28]]],
    },
    {
        //  68018 第 2 格。原「裂变凿击」（伤害 50/64/78）。
        chain: 101802, card: '68018', levels: [6, 16, 26],
        slots: [
            [281802, 'attack', [0.16, 0.16, 0.16]],
            [191802, 'attackSpeed', [0.17, 0.17, 0.17]],
        ],
        mix: { 'mix.damageRate.addRate': [0.13, 0.13, 0.13] },
    },
    {
        //  68027 第 2 格。原「穿甲苔刺」（攻速 + 每次普攻穿透）。
        chain: 102702, card: '68027', levels: [6, 16, 26],
        slots: [[192702, 'attackSpeed', [0.11, 0.11, 0.11]]],
        mix: {
            'mix.attack.addRate': [0.11, 0.11, 0.11],
            'mix.damageRate.addRate': [0.09, 0.09, 0.09],
        },
    },
    {
        //  68033 第 2 格。原「裂变凿击」。
        chain: 103302, card: '68033', levels: [6, 16, 26],
        slots: [
            [283302, 'attack', [0.16, 0.16, 0.16]],
            [193302, 'attackSpeed', [0.17, 0.17, 0.17]],
        ],
        mix: { 'mix.damageRate.addRate': [0.13, 0.13, 0.13] },
    },
];

const TAIL_TEXT = {
    attack: '攻击提高', damageRate: '伤害提高', attackSpeed: '攻击速度提高',
    attackRange: '攻击范围提高', maxHp: '最大生命提高',
};
/** 文案里尾巴的书写顺序（设计案 L 列的语序）。 */
const TAIL_ORDER = ['attack', 'damageRate', 'attackSpeed', 'attackRange', 'maxHp'];

/** 该档所有尾巴的 `[statId, 值]`（子链槽位 + mix 合并），按 `TAIL_ORDER` 排。 */
function tailsOf(spec, tier) {
    const found = new Map();
    for (const [, statId, values] of spec.slots ?? []) found.set(statId, values[tier]);
    for (const [key, values] of Object.entries(spec.mix ?? {})) {
        found.set(key.slice(4).split('.')[0], values[tier]);
    }
    return TAIL_ORDER.filter((statId) => found.has(statId)).map((statId) => [statId, found.get(statId)]);
}

/** 一句技能文案：触发间隔 + 穿透链 + 尾巴。 */
function descOf(spec, tier) {
    let text = `每${LANCE_EVERY[tier]}次普攻，把本次攻击替换成一枚远程穿透弹`
        + `（穿透${LANCE_TARGETS}个目标，依次承受70%/45%/30%，飞行距离不变）`;
    const tails = tailsOf(spec, tier).map(([statId, value]) =>
        `${TAIL_TEXT[statId] ?? statId}${Math.round(value * 100)}%`);
    if (tails.length) text += `；${tails.join('，')}`;
    return text;
}

/** 主链行的 `skillParamJson`：整体重建（不留旧机制的键）。 */
function paramsOf(spec, tier) {
    const out = {
        lanceEvery: LANCE_EVERY[tier],
        lancePierceCount: LANCE_TARGETS,
        lancePierceFalloff: LANCE_FALLOFF,
        lanceDamageRate: LANCE_DAMAGE_RATE,
    };
    for (const [key, values] of Object.entries(spec.mix ?? {})) out[key] = values[tier];
    return JSON.stringify(out);
}

function main() {
    const planRemote = path.join(REMOTE, 'pvpSkillPlan.json');
    const planClient = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(planRemote);
    const client = readTable(planClient);

    let mainRows = 0;
    let slotRows = 0;

    for (const table of [remote, client]) {
        //  🔴 一卡只能有一条链写 lanceEvery（同卡两处会各触发一次）。
        const lanceCarriers = new Map();
        for (const row of table.rows) {
            if (!/lanceEvery/.test(String(row.skillParamJson ?? ''))) continue;
            const unitId = String(row.unitId);
            const chains = lanceCarriers.get(unitId) ?? new Set();
            chains.add(Number(row.skillChainId));
            lanceCarriers.set(unitId, chains);
        }
        for (const [unitId, chains] of lanceCarriers) {
            if (chains.size <= 1) continue;
            const allowed = SKILLS.some((spec) => spec.card === unitId && chains.has(spec.chain));
            if (allowed) throw new Error(`${unitId} 有 ${chains.size} 条链在写 lanceEvery：${[...chains]}`);
        }

        for (const spec of SKILLS) {
            for (let tier = 0; tier < 3; tier += 1) {
                const level = tier + 1;
                const row = table.rows.find((item) => Number(item.skillChainId) === spec.chain
                    && Number(item.skillLevel) === level);
                if (!row) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
                if (String(row.unitId) !== spec.card) {
                    throw new Error(`${spec.chain} 归属 ${row.unitId}，与设计案 ${spec.card} 不符`);
                }
                row.skillName = '破阵投枪';
                row.unlockHeroLevel = spec.levels[tier];
                //  纯参数技能：数值全在 `skillParamJson` 里，`statId` 三格必须是空的，
                //  否则还会往 statPatch 里塞一条没人想要的常驻属性。
                row.statId = null;
                row.operation = null;
                row.value = null;
                //  `skill_params` 是「本行只提供参数」的登记 type：只有带了它，
                //  编译器才会为这张卡新编一条运行时（没有 binding 行时这是唯一的路）。
                row.behaviorKey = 'skill_params';
                row.skillKind = 'passive_stat';
                row.stateMode = 'none';
                row.skillParamJson = paramsOf(spec, tier);
                row.desc = descOf(spec, tier);
                row.sourceVersion = VERSION;
                mainRows += 1;

                for (const [slotChain, statId, values] of spec.slots ?? []) {
                    const slot = table.rows.find((item) => Number(item.skillChainId) === slotChain
                        && Number(item.skillLevel) === level);
                    if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${slotChain} L${level}`);
                    slot.skillName = '破阵投枪';
                    slot.statId = statId;
                    slot.operation = 'addRate';
                    slot.value = values[tier];
                    slot.unlockHeroLevel = spec.levels[tier];
                    slot.sourceVersion = VERSION;
                    slot.desc = descOf(spec, tier);
                    //  子链不重复带 lance 参数：参数袋按 `unitId:pvpSkillId` 覆盖合并，
                    //  两处写同一个键时生效值取决于行序。
                    slot.skillParamJson = null;
                    slotRows += 1;
                }
            }
        }
    }

    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        for (const spec of SKILLS) {
            const chains = [spec.chain, ...(spec.slots ?? []).map(([slotChain]) => slotChain)];
            for (let tier = 0; tier < 3; tier += 1) {
                const hit = table.rows.find((row) => Number(row.id) === spec.chain
                    && Number(row.skilllevel) === tier + 1);
                if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
                hit.name = '破阵投枪';
                hit.desc = descOf(spec, tier);
                hit.unlockarmylevel = spec.levels[tier];
                hit.armySkillType = 1;
                hit.modfiy = chains.map((chainId) => modifierIdFor(chainId, tier + 1, remote));
            }
        }
        writeTable(file, table);
        console.log(`[ok] ${path.basename(dir)}/armySkillLevelUp.json：${SKILLS.length * 3} 行`);
    }

    writeTable(planRemote, remote);
    writeTable(planClient, client);
    console.log(`[ok] 投枪 ${SKILLS.length} 条：主链 ${mainRows / 2} 行 ×2，子链槽位 ${slotRows / 2} 行 ×2`);
}

/** 按「技能链 + 档位」从 `pvpSkillPlan` 反查修改器号（子链的号不是算出来的，是表里既有的）。 */
function modifierIdFor(chainId, level, planTable) {
    const row = planTable.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
    if (!row) throw new Error(`pvpSkillPlan 里查不到 ${chainId} L${level} 的修改器号`);
    return Number(row.modifierId);
}

main();
