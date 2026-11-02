// 火焰树妖（68003）四个技能写进 pvpSkillPlan：4 技能 × 3 档 = 12 行。
//
// 全部 progressionMode=replace —— `selectZCSkillPlans` 对 replace 只取「当前等级最高的那一档」，
// 所以三档不会互相覆盖；若误填 accumulate，三档会全部推入并叠加（魔力塑能会变成 +30%）。
//
// pvpSkillId 一律填 30711（树妖普攻行）：计划行的参数与状态最终都合并到 `68003:30711` 这个
// 技能运行时的 key 上（见 ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime）。
//
// 触发节拍（用户 2026-10-30 定）：
//   · 灼热地带：累计 6 次普攻释放 1 次 —— 由 pvpSkill 30711 的 empoweredEvery=6 驱动，
//     这里的 cooldown 不参与（trigger 不是 every_seconds）；
//   · 点燃：每 3 次普攻的第 3 次附带 —— 由 skillParamJson.statusEveryNAttacks=3 驱动，
//     由 ZCAttackResolutionSystem 在挂状态前判 `completedAttackCount % N`。
const { readTable, writeTable } = require('./ref_table_io.js');

const UNIT = '68003';
const PVP_SKILL = 30711;
const VERSION = '技能设计案2 v1.0';

const base = {
    enabled: 1,
    unitId: UNIT,
    stateMode: 'none',
    maxStacks: 1,
    maxTriggers: 0,
    sourceVersion: VERSION,
    publishStatus: '可发布',
    statusStatJson: null,
    statId: null,
    operation: null,
    value: null,
    behaviorKey: null,
    statusId: null,
    skillParamJson: null,
    cooldown: 0,
    durationSeconds: 0,
};

const STAT_ROWS = [
    // 魔力塑能：纯攻击 +10%，三级同值。
    // ⚠ 设计案写的「兵种 0 级」在表里必须落成 1 —— ZCStatSchema 硬校验
    //   `[skillChainId, skillLevel, unlockHeroLevel] 每项 >= 1`，填 0 直接抛错；
    //   而 selectZCSkillPlans 的最小英雄等级也是 1，所以 1 与 0 等效（都是开局解锁）。
    { chain: 100301, name: '魔力塑能', idBase: 91003010, statId: 'attack',
      levels: [1, 14, 22], values: [0.1, 0.1, 0.1],
      desc: (v) => `攻击提高${v * 100}%（三级同值，不叠加）` },
    // 魔力回路：纯射程 +10%，三级同值
    { chain: 100302, name: '魔力回路', idBase: 91003020, statId: 'attackRange',
      levels: [6, 16, 23], values: [0.1, 0.1, 0.1],
      desc: (v) => `射程提高${v * 100}%（三级同值，不叠加）` },
];

const IGNITE = {
    chain: 100303, name: '点燃', idBase: 91003030,
    // 设计案未标兵种等级，按 100302(6/16/23) 与 100304(12/20/25) 之间插值
    levels: [9, 18, 24], pcts: [10, 15, 20], everyNAttacks: 3,
};

const SCORCH = {
    chain: 100304, name: '灼热地带', idBase: 91003040,
    levels: [12, 20, 25], rates: [0.35, 0.55, 0.75],
    radius: 60, seconds: 5, waves: 5, everyNAttacks: 6,
};

const rows = [];

for (const spec of STAT_ROWS) {
    spec.levels.forEach((level, index) => {
        const value = spec.values[index];
        rows.push({
            ...base,
            modifierId: spec.idBase + index + 1,
            skillChainId: spec.chain,
            skillName: spec.name,
            skillLevel: index + 1,
            unlockHeroLevel: level,
            skillKind: 'passive_stat',
            passiveScope: 'deployed',
            progressionMode: 'replace',
            pvpSkillId: PVP_SKILL,
            triggerEvent: 'build',
            targetSelector: 'self',
            desc: spec.desc(value),
            statId: spec.statId,
            operation: 'addRate',
            value,
        });
    });
}

IGNITE.levels.forEach((level, index) => {
    const tier = index + 1;
    const pct = IGNITE.pcts[index];
    rows.push({
        ...base,
        modifierId: IGNITE.idBase + tier,
        skillChainId: IGNITE.chain,
        skillName: IGNITE.name,
        skillLevel: tier,
        unlockHeroLevel: level,
        skillKind: 'event_passive',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: PVP_SKILL,
        triggerEvent: 'hit',
        targetSelector: 'current_target',
        durationSeconds: 3,
        desc: `每3次普攻，第3次普攻附带点燃：每0.5秒造成${pct}%攻击力伤害，持续3秒`,
        behaviorKey: 'on_hit_status',
        statusId: `burn_ignite_l${tier}`,
        statusStatJson: '{}',
        skillParamJson: JSON.stringify({ statusEveryNAttacks: IGNITE.everyNAttacks }),
    });
});

SCORCH.levels.forEach((level, index) => {
    const tier = index + 1;
    const rate = SCORCH.rates[index];
    rows.push({
        ...base,
        modifierId: SCORCH.idBase + tier,
        skillChainId: SCORCH.chain,
        skillName: SCORCH.name,
        skillLevel: tier,
        unlockHeroLevel: level,
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: PVP_SKILL,
        triggerEvent: 'active',
        targetSelector: 'current_target',
        durationSeconds: SCORCH.seconds,
        desc: `每6次普攻释放一次：目标点生成半径${SCORCH.radius}的灼热地带，`
            //  Math.round 不能省：0.55 * 100 在浮点下是 55.00000000000001，会直接写进 desc 文案。
            + `持续${SCORCH.seconds}秒、每秒${Math.round(rate * 100)}%攻击力`,
        behaviorKey: 'skill_params',
        skillParamJson: JSON.stringify({ damageRate: rate }),
    });
});

const TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    // 幂等：先摘掉本脚本负责的 4 条技能链，再整体重写，避免半新半旧
    const chains = new Set([...STAT_ROWS.map((s) => s.chain), IGNITE.chain, SCORCH.chain]);
    table.rows = table.rows.filter((row) => !(row.unitId === UNIT && chains.has(row.skillChainId)));
    table.rows.push(...rows.map((row) => ({ ...row })));
    writeTable(path, table);
    console.log(`[ok] ${path} (${table.mode}) 共 ${table.rows.length} 行（本角色 ${rows.length} 行）`);
}

for (const row of rows) {
    console.log(`  ${row.skillChainId} ${row.skillName} L${row.skillLevel} @${row.unlockHeroLevel}级`
        + ` | ${row.statId ? `${row.statId}.${row.operation}=${row.value}` : row.statusId || row.skillParamJson}`);
}
