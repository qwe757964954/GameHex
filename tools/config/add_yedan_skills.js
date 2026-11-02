// 椰蛋战士（68005）技能配表落地：pvpSkill 改 1 行 + 新增 2 行，pvpSkillPlan 新增 15 行。
//
// 依据 `D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx` 第 22~26 行：
//   200501 切割     普攻（近战，倒计时 1.8s，沿用椰蛋战士_普攻）
//   100501 高速移动 被动 移速 +15%（三级同值）
//   100502 横扫     主动-冷却 8s，扇形 120% / 150% / 180%，L3 击退 2 格
//   100503 生命汲取 被动 攻击范围 +30% 且 造成伤害 2% 转自身生命
//   100504 暴风     主动-累计 5 次普攻，3 道旋风、夹角 30°、持续 3/4/4s、最多打 3/4/5 人 80/100/120%
//
// 几个必须讲清楚的落法（都是「照设计案字面写会静默不生效」的地方）：
//
//  1. **一条普攻行只有一个强化槽**。68005 有两条主动，所以拆成两条链：
//     强化槽（`empoweredEvery` + `empoweredSkillId`）留给「累计 5 次普攻」的**暴风**，
//     冷却型的**横扫**挂到新增的 `secondarySkillId` 上，由 `ZCSkillTriggerSystem` 的副轨推进。
//     两条链互不干扰 —— 横扫不会推进 `completedAttackCount`，暴风也不会占横扫的 CD。
//  2. **旧的 36221（长戟兵武将技）被摘掉**：它是 68005 上一条遗留链路，与设计案的五条技能无关。
//     摘下后该行改指 30831（暴风），`trigger` 也从 `every_seconds` 改成 `every_n_attacks`。
//  3. **100503 一个技能两条数值**（攻击范围 +30%、吸血 2%），所以每个等级写**两行**计划；
//     `progressionMode = replace` 原本只留「最高档的最后一行」，会随机丢掉一条 ——
//     `selectZCSkillPlans` 已按「保留最高档的全部行」修正（见 ZCModifierRuntime.ts）。
//  4. **吸血用 `add`、值是比例**（0.02 = 2%），不是 `addRate`：`addRate` 分支要乘基础值，
//     而 `lifestealRate` 没有基础值 ⇒ 恒 0。
//  5. **物免/移速那两条写 `addRate`**（0.15 / 0.30），与 `damageRate` 同口径，落进 `xxxPct`。
//  6. **三档数值全部走计划行的 `skillParamJson`**：`pvpSkill.damageRate` 是单值列，分不了档。
//  7. **`unlockHeroLevel` 最小 1**：设计案写「兵种 0 级」，但 `ZCStatSchema` 硬校验 `>= 1`。
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];
const PLAN_TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];

const UNIT_ID = '68005';
const ATTACK_SKILL_ID = 30707;
const STORM_SKILL_ID = 30831;
const SWEEP_SKILL_ID = 30832;
/** 旧的 36221（长戟兵武将技）：本卡不再使用，脚本只做「已摘掉」校验。 */
const LEGACY_ULTIMATE_ID = 36221;
const SOURCE_VERSION = '技能设计案2 椰蛋战士 v1.0';

/** 30707 在原行上的改动（其余列原样保留，脚本会逐列校验）。 */
const ATTACK_PATCH = {
    // 每 5 次普攻 ⇒ 第 5 次换成 30831（暴风）。`empoweredEvery` 与 `trigger` 必须成对改，
    // 只改一个的话 `consumeEmpoweredAttack` 会走另一条分支（CD 分支读 `cooldown`）。
    empoweredEvery: 5,
    empoweredSkillId: STORM_SKILL_ID,
    secondarySkillId: SWEEP_SKILL_ID,
    trigger: 'every_n_attacks',
    // 设计案 200501 是「主动-普通攻击-倒计时 1.8」：1.8 是**攻击间隔**，落在 pvpCard
    // 的 `unitAttackInterval` 上，本行只定义形态与节拍，不重复表达。
};

const NEW_SKILLS = [
    {
        skillId: STORM_SKILL_ID,
        name: '椰蛋战士·暴风',
        mode: 'area',
        projectileKey: '',
        projectileSpeed: 0,
        // 旋风的判定半径（60 表值 ≈ 18 世界单位）；三档相同，档位差异在计划行参数里。
        areaRadius: 30,
        empoweredEvery: 0,
        empoweredSkillId: 0,
        secondarySkillId: 0,
        effectPrefabPath: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
        cooldown: 0,
        effectKey: '',
        trigger: null,
        // 基础倍率；三档由 `skillParamJson.damageRate` 覆盖（skills 行只是兜底）。
        damageRate: 0.8,
        durationSeconds: 3,
        // 移动区域不走「持续秒数 / 波数」，这个值只保证进入 zone 分支且 `waves >= 1`。
        waves: 20,
        slowRatio: null,
        onHitStatusId: null,
    },
    {
        skillId: SWEEP_SKILL_ID,
        name: '椰蛋战士·横扫',
        // 扇形由 `ZCAttackResolutionSystem.castFanSkill` 自己算角度与半径，
        // 这里的 `areaRadius` 不参与判定，只给表现层一个名义尺寸。
        mode: 'area',
        projectileKey: '',
        projectileSpeed: 0,
        areaRadius: 60,
        empoweredEvery: 0,
        empoweredSkillId: 0,
        secondarySkillId: 0,
        effectPrefabPath: 'units/projectiles/椰蛋战士_横扫/椰蛋战士_横扫',
        cooldown: 0,
        effectKey: '',
        trigger: null,
        damageRate: 1.2,
        durationSeconds: 0,
        waves: 0,
        slowRatio: null,
        onHitStatusId: null,
    },
];

/**
 * 纯数值被动：三级同值，`progressionMode = replace`。
 *
 * `extraParams` 用来在**同一行**挂第二个数值（100503 的吸血）—— 见文件头第 3 条。
 */
function passiveRows(chainId, name, levelUnlocks, statId, operation, value, desc, modifierBase, extraParams) {
    return levelUnlocks.map((unlockHeroLevel, index) => ({
        enabled: 1,
        modifierId: modifierBase + index + 1,
        unitId: UNIT_ID,
        skillChainId: chainId,
        skillName: name,
        skillLevel: index + 1,
        unlockHeroLevel,
        skillKind: 'passive_stat',
        passiveScope: 'deployed',
        progressionMode: 'replace',
        pvpSkillId: ATTACK_SKILL_ID,
        triggerEvent: 'build',
        stateMode: 'none',
        targetSelector: 'self',
        statId,
        operation,
        value,
        durationSeconds: 0,
        maxStacks: 1,
        cooldown: 0,
        maxTriggers: 0,
        // 带参数就必须登记 behaviorKey，否则「没有 pvpSkillBinding 行」时
        // `ZCMatchRuntimeCompiler` 新建运行时那条分支拿不到参数（见文件头第 3 条）。
        behaviorKey: extraParams ? 'skill_params' : null,
        statusId: null,
        statusStatJson: null,
        skillParamJson: extraParams ? JSON.stringify(extraParams) : null,
        desc,
        sourceVersion: SOURCE_VERSION,
        publishStatus: '可发布',
    }));
}

/** 100502 横扫：冷却 8s，伤害与击退逐档不同，全部在 `skillParamJson`。 */
function sweepRows() {
    const tiers = [
        { level: 1, unlock: 6, damage: 1.2, knockback: 0 },
        { level: 2, unlock: 16, damage: 1.5, knockback: 0 },
        { level: 3, unlock: 23, damage: 1.8, knockback: 2 },
    ];
    return tiers.map((tier) => ({
        enabled: 1,
        modifierId: 91005110 + tier.level,
        unitId: UNIT_ID,
        skillChainId: 100502,
        skillName: '横扫',
        skillLevel: tier.level,
        unlockHeroLevel: tier.unlock,
        skillKind: 'active_cd',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: ATTACK_SKILL_ID,
        triggerEvent: 'active',
        stateMode: 'none',
        targetSelector: 'current_target',
        statId: null,
        operation: null,
        value: null,
        behaviorKey: 'skill_params',
        statusId: null,
        statusStatJson: null,
        durationSeconds: 0,
        maxStacks: 1,
        cooldown: 8,
        maxTriggers: 0,
        skillParamJson: JSON.stringify({
            // 冷却秒数：>0 才启用副轨（`ZCSkillTriggerSystem.advanceSecondary`）
            secondaryCooldown: 8,
            secondaryDamageRate: tier.damage,
            // 前方 120° 扇形；半径 = 当前攻击距离 × 1.4（生命汲取的 +30% 会一起吃到）
            secondaryFanDeg: 120,
            secondaryRadiusScale: 1.4,
            // 击退**格数**（0 = 不击退）；只有 L3 有
            secondaryKnockback: tier.knockback,
        }),
        desc: tier.knockback > 0
            ? `每8秒对前方120°扇形造成${Math.round(tier.damage * 100)}%伤害，并击退2格`
            : `每8秒对前方120°扇形造成${Math.round(tier.damage * 100)}%伤害`,
        sourceVersion: SOURCE_VERSION,
        publishStatus: '可发布',
    }));
}

/** 100504 暴风：累计 5 次普攻放一次，3 道旋风沿路径各打一口。 */
function stormRows() {
    const tiers = [
        { level: 1, unlock: 12, duration: 3, maxHits: 3, damage: 0.8 },
        { level: 2, unlock: 20, duration: 4, maxHits: 4, damage: 1.0 },
        { level: 3, unlock: 25, duration: 4, maxHits: 5, damage: 1.2 },
    ];
    return tiers.map((tier) => ({
        enabled: 1,
        modifierId: 91005140 + tier.level,
        unitId: UNIT_ID,
        skillChainId: 100504,
        skillName: '暴风',
        skillLevel: tier.level,
        unlockHeroLevel: tier.unlock,
        skillKind: 'active_attack',
        passiveScope: 'battle',
        progressionMode: 'replace',
        pvpSkillId: ATTACK_SKILL_ID,
        triggerEvent: 'active',
        stateMode: 'none',
        targetSelector: 'current_target',
        statId: null,
        operation: null,
        value: null,
        // 登记成专用行为键：语义是「收招阶段从施法者抛出移动区域」，
        // 与 `skill_params`（只带数值）区分开，表里一眼能看出这条不是纯参数行。
        behaviorKey: 'on_cast_end_spawn_zone',
        statusId: null,
        statusStatJson: null,
        durationSeconds: tier.duration,
        maxStacks: 1,
        cooldown: 0,
        maxTriggers: 0,
        skillParamJson: JSON.stringify({
            // 3 道旋风、初始夹角 30°、从角色朝目标移动、速度 70（屏上 px/秒）
            zoneCount: 3,
            zoneSpreadDeg: 30,
            zoneMoveSpeed: 70,
            zoneDuration: tier.duration,
            // 探路间隔：0.15s 走一步，走过敌人就结算一次
            zoneWaveInterval: 0.15,
            // 每道风最多打这么多个敌人，打满提前消失
            zoneMaxHits: tier.maxHits,
            damageRate: tier.damage,
        }),
        desc: `每5次普攻放出3道旋风，持续${tier.duration}秒，沿路径最多对${tier.maxHits}个敌人造成${Math.round(tier.damage * 100)}%伤害`,
        sourceVersion: SOURCE_VERSION,
        publishStatus: '可发布',
    }));
}

const NEW_PLANS = [
    // 100501 高速移动：移速 +15%（三级同值）
    ...passiveRows(100501, '高速移动', [1, 14, 22], 'moveSpeed', 'addRate', 0.15,
        '移动速度提高15%（三级同值，不叠加）', 91005100),
    ...sweepRows(),
    // 100503 生命汲取：一行两个数值 —— 攻击范围占 statId，吸血占 skillParamJson。
    // 吸血的 0.02 是**比例**（2%），不要写成 2。
    ...passiveRows(100503, '生命汲取', [9, 18, 24], 'attackRange', 'addRate', 0.30,
        '攻击范围扩大30%，并把造成伤害的2%转化为自身生命值', 91005120, { lifestealRate: 0.02 }),
    ...stormRows(),
];

function upsert(targetRows, row, keyOf, label) {
    const key = keyOf(row);
    const index = targetRows.findIndex((item) => keyOf(item) === key);
    if (index >= 0) targetRows[index] = { ...targetRows[index], ...row };
    else targetRows.push(row);
    console.log(`  [${index >= 0 ? '更新' : '新增'}] ${label} ${key}`);
}

// ── 1) pvpSkill：改 30707 + 新增 30831 / 30832 ────────────────────────────────
for (const path of SKILL_TABLES) {
    const table = readTable(path);
    console.log(`[pvpSkill] ${path}（${table.mode}，${table.rows.length} 行）`);
    const attack = table.rows.find((row) => row.skillId === ATTACK_SKILL_ID);
    if (!attack) throw new Error(`${path} 找不到 ${ATTACK_SKILL_ID}（椰蛋战士普攻）`);
    if (attack.effectPrefabPath !== 'units/projectiles/椰蛋战士_普攻/椰蛋战士_普攻') {
        throw new Error(`${path} ${ATTACK_SKILL_ID} 的特效路径被改动过：${attack.effectPrefabPath}`);
    }
    const beforeAttack = { ...attack };
    Object.assign(attack, ATTACK_PATCH);
    console.log(`  [更新] 技能 ${ATTACK_SKILL_ID} `
        + `empowered ${beforeAttack.empoweredEvery}×/${beforeAttack.empoweredSkillId}(${beforeAttack.trigger})`
        + ` → ${attack.empoweredEvery}×/${attack.empoweredSkillId}(${attack.trigger})`
        + `，副技能 ${attack.secondarySkillId}`);
    for (const skill of NEW_SKILLS) {
        upsert(table.rows, skill, (row) => row.skillId, '技能');
    }
    // 写后校验：30707 的每一列都要真的落盘
    const written = table.rows.find((row) => row.skillId === ATTACK_SKILL_ID);
    for (const [key, value] of Object.entries(ATTACK_PATCH)) {
        if (written[key] !== value) {
            throw new Error(`${path} ${ATTACK_SKILL_ID}.${key} 写后校验失败：${written[key]} !== ${value}`);
        }
    }
    for (const skill of NEW_SKILLS) {
        const hit = table.rows.find((row) => row.skillId === skill.skillId);
        for (const [key, value] of Object.entries(skill)) {
            if ((hit[key] ?? null) !== value) {
                throw new Error(`${path} ${skill.skillId}.${key} 写后校验失败：${hit[key]} !== ${value}`);
            }
        }
    }
    if (table.rows.some((row) => row.skillId === ATTACK_SKILL_ID && row.empoweredSkillId === LEGACY_ULTIMATE_ID)) {
        throw new Error(`${path} ${ATTACK_SKILL_ID} 仍指向旧的 ${LEGACY_ULTIMATE_ID}`);
    }
    // 新列必须进 `k`（列存），否则 `writeTable` 会把这一列静默写丢。
    if (table.mode === 'packed' && !table.keys.includes('secondarySkillId')) {
        const at = table.keys.indexOf('empoweredSkillId');
        if (at < 0) throw new Error(`${path} 的列里没有 empoweredSkillId，无处插入 secondarySkillId`);
        table.keys.splice(at + 1, 0, 'secondarySkillId');
        console.log(`  [列] 插入 secondarySkillId @${at + 1}`);
    }
    writeTable(path, table);
    console.log(`  → ${table.rows.length} 行`);
}

// ── 2) pvpSkillPlan：68005 的 15 行 ───────────────────────────────────────────
for (const path of PLAN_TABLES) {
    const table = readTable(path);
    const beforeOtherUnits = table.rows.filter((row) => String(row.unitId) !== UNIT_ID).length;
    console.log(`[pvpSkillPlan] ${path}（${table.mode}，${table.rows.length} 行）`);
    for (const plan of NEW_PLANS) {
        upsert(table.rows, plan, (row) => `${row.unitId}:${row.modifierId}`, '计划');
    }
    //  清掉本卡上一版脚本写过、这一版不再需要的行（例如「100503 拆两行」的旧写法）。
    //  只动 68005 自己的行，别的卡一行都不碰。
    const keep = new Set(NEW_PLANS.map((plan) => plan.modifierId));
    const stale = table.rows.filter((row) => String(row.unitId) === UNIT_ID && !keep.has(row.modifierId));
    if (stale.length) {
        table.rows = table.rows.filter((row) => String(row.unitId) !== UNIT_ID || keep.has(row.modifierId));
        console.log(`  [删除] 过期计划 ${stale.map((row) => row.modifierId).join(', ')}`);
    }
    const afterOtherUnits = table.rows.filter((row) => String(row.unitId) !== UNIT_ID).length;
    if (beforeOtherUnits !== afterOtherUnits) throw new Error(`${path} 的其他卡牌计划行数变了`);
    const mine = table.rows.filter((row) => String(row.unitId) === UNIT_ID);
    if (mine.length !== NEW_PLANS.length) {
        throw new Error(`${path} 里 ${UNIT_ID} 应有 ${NEW_PLANS.length} 行，实得 ${mine.length}`);
    }
    const ids = new Set(mine.map((row) => row.modifierId));
    if (ids.size !== mine.length) throw new Error(`${path} 里 ${UNIT_ID} 的 modifierId 有重复`);
    for (const plan of NEW_PLANS) {
        const hit = mine.find((row) => row.modifierId === plan.modifierId);
        for (const [key, value] of Object.entries(plan)) {
            if ((hit[key] ?? null) !== value) {
                throw new Error(`${path} ${plan.modifierId}.${key} 校验失败：${hit[key]} !== ${value}`);
            }
        }
    }
    writeTable(path, table);
    console.log(`  → ${table.rows.length} 行（${UNIT_ID} 共 ${mine.length} 行）`);
}

console.log('\n完成。');
