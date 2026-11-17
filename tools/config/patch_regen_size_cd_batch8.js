// 被动重设计 V5 · 第八批：三条「新车道」被动（100601 / 101602 / 102401）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 第 28 / 79 / 118 行。
// 三条都是设计案 P 列标了「🔴 新字段」的，所以本批 = 代码加三个 statId + 配表落地：
//
//   · 100601 孢子回流（68006 波利奥）  → `hpRegenPct`     每秒回复最大生命的百分比
//   · 101602 巨囊弹体（68016 磁电菇）  → `bulletSizeScale` 普攻弹体体积倍率（视觉 + 判定同步）
//   · 102401 裂变共鸣（68024 急冻瓜）  → `cdReduceOnHit`   每次普攻命中回退其他主动的剩余 CD
//
// 🔴 三个 statId 都没有基础值，表里一律用 `add` 直接给绝对值，**不能写 `addRate`**
//   （`rate` 分支要乘 `baseValue`，没有基础值 ⇒ 恒 0，配了等于没配）。
//     `hpRegenPct`      1.5 = 每秒 1.5%
//     `bulletSizeScale` 1.6 = ×1.6（绝对倍率，不是增量）
//     `cdReduceOnHit`   0.4 = 0.4 秒
//
// 🔴 每条技能的**旧机制必须整条清掉**（都是「半改卡」遗留）：
//   · 100601 原来挂的是「黏液阻滞」的 `moveSpeed addRate 0.12/0.16/0.2`；
//   · 101602 原来挂的是「爆囊扩散」的 `attackSpeed addRate 0.26/0.34/0.42`，
//     与设计案 L1「体积 ×1.6 + 溅射 30% + 攻 10% / 伤 8% / 范围 14%」完全不是一套；
//   · 102401 原来挂的是「枯萎收割」的 `critRate add 20/28/36`（**越过 15% 上限**）
//     + 子链 `damageRate addRate 0.2/0.26/0.32`。
//
// 幂等：按「链 + 档」定位改写，主链的 `skillParamJson` 整体重建（不留旧键）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V8-20261117';

/**
 * 每条技能：
 *   `levels`  —— 三档解锁兵种等级（按卡上的技能格：第 1 格 3/10/22、第 2 格 6/16/26）；
 *   `main`    —— 主链那一格 statId 的取值（`operation` 一律 `add`）；
 *   `slots`   —— 子链槽位改写 `[子链, statId, 三档值]`（`operation` 由 `slotOperation` 决定）；
 *   `mix`     —— 没有槽位可占的尾巴（完整键 `mix.<statId>[.addRate]`）；
 *   `params`  —— 除 `mix.*` 之外的技能参数。
 */
const SKILLS = [
    {
        //  68006 第 1 格。坦克中级被动：每秒回血 + 暴击率混搭 + 攻/生命尾巴。
        //  该卡两条被动都没有克制行，暴击率只能挂在这里（紫档 8/10/12%，整卡 ≤15%）。
        chain: 100601, card: '68006', name: '孢子回流', levels: [3, 10, 22],
        main: ['hpRegenPct', [1.5, 1.8, 2.1]],
        slots: [],
        mix: {
            'mix.critRate': [8, 10, 12],
            'mix.attack.addRate': [0.13, 0.13, 0.13],
            'mix.maxHp.addRate': [0.13, 0.13, 0.13],
        },
        params: () => ({}),
        desc: (tier) => `每秒回复自身最大生命${[1.5, 1.8, 2.1][tier]}%，暴击率提高${[8, 10, 12][tier]}%`
            + '；攻击提高13%，最大生命提高13%',
    },
    {
        //  68016 第 2 格。法师高级被动：弹体体积 + 命中溅射 + 攻/伤/范围尾巴。
        //  `splashRadius` 设计案没写，沿用已落地的 38/46/55（逻辑 px，与攻击距离同一套数）。
        chain: 101602, card: '68016', name: '巨囊弹体', levels: [6, 16, 26],
        main: ['bulletSizeScale', [1.6, 1.75, 1.9]],
        slots: [[191602, 'damageRate', [0.08, 0.08, 0.08]]],
        mix: {
            'mix.attack.addRate': [0.10, 0.10, 0.10],
            'mix.attackRange.addRate': [0.14, 0.14, 0.14],
        },
        params: (tier) => ({
            splashDamageRate: [0.30, 0.34, 0.38][tier],
            splashFalloff: 0.3,
            splashRadius: [38, 46, 55][tier],
        }),
        desc: (tier) => `普攻弹体体积×${[1.6, 1.75, 1.9][tier]}，命中判定半径同比放大`
            + `；命中对周围造成${[30, 34, 38][tier]}%溅射伤害（同一爆点第2个目标起每次×0.7）`
            + '；攻击提高10%，伤害提高8%，攻击范围提高14%',
    },
    {
        //  68024 第 1 格。法师高级被动：命中回退其他主动 CD + 攻速 + 攻/范围尾巴。
        //  ⚠️ 该卡真正的「其他主动」是 102403 冰山陨落 / 102404 急冻光线，两条都还在「待规划」
        //  ⇒ 本机制眼下是**待生效**状态，等那两条落地就自动吃上，不用再动配表。
        chain: 102401, card: '68024', name: '裂变共鸣', levels: [3, 10, 22],
        main: ['cdReduceOnHit', [0.4, 0.5, 0.6]],
        slots: [[192401, 'attackSpeed', [0.20, 0.22, 0.24]]],
        mix: {
            'mix.attack.addRate': [0.35, 0.35, 0.35],
            'mix.attackRange.addRate': [0.35, 0.35, 0.35],
        },
        params: () => ({}),
        desc: (tier) => `每次普攻命中使其他主动技能剩余冷却减少${[0.4, 0.5, 0.6][tier]}秒`
            + `；攻击速度提高${[20, 22, 24][tier]}%；攻击提高35%，攻击范围提高35%`,
    },
];

/** 子链槽位统一用 `addRate`（比例尾巴）；主链用 `add`（绝对值）。 */
const SLOT_OPERATION = 'addRate';

function modifierIdFor(chainId, level, planTable) {
    const row = planTable.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
    if (!row) throw new Error(`pvpSkillPlan 里查不到 ${chainId} L${level} 的修改器号`);
    return Number(row.modifierId);
}

function paramsOf(spec, tier) {
    const out = { ...spec.params(tier) };
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
        for (const spec of SKILLS) {
            const [mainStatId, mainValues] = spec.main;
            for (let tier = 0; tier < 3; tier += 1) {
                const level = tier + 1;
                const row = table.rows.find((item) => Number(item.skillChainId) === spec.chain
                    && Number(item.skillLevel) === level);
                if (!row) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
                if (String(row.unitId) !== spec.card) {
                    throw new Error(`${spec.chain} 归属 ${row.unitId}，与设计案 ${spec.card} 不符`);
                }
                row.skillName = spec.name;
                row.unlockHeroLevel = spec.levels[tier];
                row.statId = mainStatId;
                row.operation = 'add';
                row.value = mainValues[tier];
                row.behaviorKey = 'skill_params';
                row.skillKind = 'passive_stat';
                row.stateMode = 'none';
                row.skillParamJson = paramsOf(spec, tier);
                row.desc = spec.desc(tier);
                row.sourceVersion = VERSION;
                mainRows += 1;

                for (const [slotChain, statId, values] of spec.slots ?? []) {
                    const slot = table.rows.find((item) => Number(item.skillChainId) === slotChain
                        && Number(item.skillLevel) === level);
                    if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${slotChain} L${level}`);
                    slot.skillName = spec.name;
                    slot.statId = statId;
                    slot.operation = SLOT_OPERATION;
                    slot.value = values[tier];
                    slot.unlockHeroLevel = spec.levels[tier];
                    slot.sourceVersion = VERSION;
                    slot.desc = spec.desc(tier);
                    //  子链不重复带参数：参数袋按 `unitId:pvpSkillId` 覆盖合并，两处写同一个键
                    //  生效值取决于行序。
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
                hit.name = spec.name;
                hit.desc = spec.desc(tier);
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
    console.log(`[ok] 第 8 批 ${SKILLS.length} 条：主链 ${mainRows / 2} 行 ×2，子链槽位 ${slotRows / 2} 行 ×2`);
}

main();
