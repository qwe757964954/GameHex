// 第 10 批 · 102401 改机制 + 全表下线「普攻命中减少其他主动冷却」。
//
// 用户口径（2026-11-17）：
//   「102401 的技能机制修改，子弹穿过己方单位会回复生命值 3/4/5% 的生命值，
//     一颗子弹最多给 3/4/5 个己方单位回复；所有卡牌都移除普通攻击减少冷却时间的这个机制。」
//
// 所以本批是**一删一加**：
//   删 —— `cdReduceOnHit` 整条车道全卡下线（表里只有 102401 三行写过它，代码里四处登记一起拆）。
//   加 —— 新机制走 `skillParamJson` 两个键，主链的 `statId` 置空（与投枪主链同一形态）：
//           `allyPierceHealPct`  单次回复比例（0.03 = 该单位最大生命的 3%）
//           `allyPierceMaxCount` 每颗弹道的治疗名额（3 / 4 / 5）
//
// 🔴 主链为什么可以 `statId = null`：`passive_stat` 并不要求一定挂属性 ——
//   第 7 批投枪的主链（100701 等）就是 `statId/operation/value` 三空 + `behaviorKey='skill_params'`，
//   属性全走 `mix.*` 与子链槽位。本批沿用同一形态，尾巴一个都不动。
//
// 🔴 额度是「每颗弹道」的，不是每张卡的：多弹幕（102402 同卡）一次裂三颗，
//   每颗各自 3/4/5 次，不能共享同一个计数器 —— 所以额度在**出手时**从参数拷到弹道上。
//
// 改名：裂变共鸣 → 贯穿滋养（机制完全换了，按「只有机制一样的才同名 / 机制不同一律另名」）。
//
// 幂等：按「链 + 档」定位改写；重跑结果逐字节相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V10-20261117';

const CHAIN = 102401;
const SLOT_CHAIN = 192401;
const CARD = '68024';
const NAME = '贯穿滋养';
const LEVELS = [3, 10, 22];
const HEAL_PCT = [0.03, 0.04, 0.05];
const HEAL_COUNT = [3, 4, 5];
const SLOT_ATTACK_SPEED = [0.20, 0.22, 0.24];
const TAIL_ATTACK = 0.35;
const TAIL_RANGE = 0.35;

function descOf(tier) {
    return `普攻子弹穿过己方单位时，为其回复${HEAL_PCT[tier] * 100}%最大生命`
        + `（每颗子弹最多回复${HEAL_COUNT[tier]}个己方单位）`
        + `；攻击速度提高${SLOT_ATTACK_SPEED[tier] * 100}%`
        + `；攻击提高${TAIL_ATTACK * 100}%，攻击范围提高${TAIL_RANGE * 100}%`;
}

function findRow(table, chainId, level) {
    return table.rows.find((item) => Number(item.skillChainId) === chainId
        && Number(item.skillLevel) === level);
}

function rebuild(table) {
    let touched = 0;
    for (let tier = 0; tier < 3; tier += 1) {
        const level = tier + 1;
        const main = findRow(table, CHAIN, level);
        if (!main) throw new Error(`pvpSkillPlan 缺少 ${CHAIN} L${level}`);
        if (String(main.unitId) !== CARD) {
            throw new Error(`${CHAIN} 归属 ${main.unitId}，与设计案 ${CARD} 不符`);
        }
        main.skillName = NAME;
        main.unlockHeroLevel = LEVELS[tier];
        //  主链不再挂属性：机制全在参数里，属性走 `mix.*` 与子链槽位。
        main.statId = null;
        main.operation = null;
        main.value = null;
        main.behaviorKey = 'skill_params';
        main.skillKind = 'passive_stat';
        main.stateMode = 'none';
        main.statusId = null;
        main.statusStatJson = null;
        main.skillParamJson = JSON.stringify({
            allyPierceHealPct: HEAL_PCT[tier],
            allyPierceMaxCount: HEAL_COUNT[tier],
            'mix.attack.addRate': TAIL_ATTACK,
            'mix.attackRange.addRate': TAIL_RANGE,
        });
        main.desc = descOf(tier);
        main.sourceVersion = VERSION;
        touched += 1;

        const slot = findRow(table, SLOT_CHAIN, level);
        if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${SLOT_CHAIN} L${level}`);
        slot.skillName = NAME;
        slot.unlockHeroLevel = LEVELS[tier];
        slot.statId = 'attackSpeed';
        slot.operation = 'addRate';
        slot.value = SLOT_ATTACK_SPEED[tier];
        slot.skillParamJson = null;
        slot.desc = descOf(tier);
        slot.sourceVersion = VERSION;
        touched += 1;
    }
    return touched;
}

/** 全表守卫：`cdReduceOnHit` 必须一个字节都不剩。*/
function assertLaneGone(table, label) {
    const leftovers = table.rows.filter((row) => String(row.statId) === 'cdReduceOnHit'
        || String(row.skillParamJson ?? '').includes('cdReduceOnHit'));
    if (leftovers.length) {
        throw new Error(`${label} 里还有 ${leftovers.length} 行写着 cdReduceOnHit：`
            + leftovers.map((row) => row.modifierId).join(','));
    }
}

function syncSkillLevelUp(table, planRemote) {
    let touched = 0;
    const modifierIds = (level) => [CHAIN, SLOT_CHAIN].map((chainId) => {
        const row = planRemote.rows.find((item) => Number(item.skillChainId) === chainId
            && Number(item.skillLevel) === level);
        if (!row) throw new Error(`pvpSkillPlan 里查不到 ${chainId} L${level} 的修改器号`);
        return Number(row.modifierId);
    });
    for (let tier = 0; tier < 3; tier += 1) {
        const hit = table.rows.find((row) => Number(row.id) === CHAIN
            && Number(row.skilllevel) === tier + 1);
        if (!hit) throw new Error(`armySkillLevelUp 缺少 ${CHAIN} L${tier + 1}`);
        hit.name = NAME;
        hit.desc = descOf(tier);
        hit.unlockarmylevel = LEVELS[tier];
        hit.armySkillType = 1;
        hit.modfiy = modifierIds(tier + 1);
        touched += 1;
    }
    return touched;
}

function main() {
    const planRemotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const planClientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(planRemotePath);
    const client = readTable(planClientPath);

    const touched = rebuild(remote) + rebuild(client);
    assertLaneGone(remote, 'remoteRef');
    assertLaneGone(client, 'client');

    writeTable(planRemotePath, remote);
    writeTable(planClientPath, client);

    let levelRows = 0;
    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        levelRows += syncSkillLevelUp(table, remote);
        writeTable(file, table);
    }

    console.log(`[ok] ${CHAIN}「${NAME}」主链 + 子链 ${touched} 行（两份 pvpSkillPlan）`);
    console.log(`[ok] armySkillLevelUp ${levelRows} 行（名称 / 描述 / modfiy）`);
    console.log('[ok] 全表守卫：cdReduceOnHit 已无残留');
}

main();
