// 玉林好汉（68004）技能配表落地：pvpSkill 两行 + pvpSkillPlan 十二行 + pvpCard 换普攻。
//
// 依据 `D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx` 第 17~21 行：
//   200401 飞镖投掷（普攻，倒计时 1.8s，弹速 500）
//   100401 灵巧投掷 被动 攻速 +10%（三级同值）
//   100402 铁质飞镖 被动 伤害 +10%（三级同值）
//   100403 高速移动 被动 移速 +15%（三级同值）
//   100404 精英猎手 主动 CD 10s，伤害 60/70/80%、穿透 3/6/8 人、每次穿透 -20%
//
// 几个必须讲清楚的落法（都是「照设计案字面写会静默不生效」的地方）：
//
//  1. **普攻换行而不是改玉米射手那张**：68004 原来的 `unitSkillId = 30715`（玉米射手普攻），
//     特效是玉米。新建 30716 指向新做的飞镖三件套，30715 原封不动留给玉米射手。
//  2. **100404 走 `empoweredSkillId` 而不是独立触发**：`pvpSkill.empoweredEvery/empoweredSkillId`
//     的语义就是「第 N 次普攻 / 每 N 秒换成另一条技能行结算」。设计案写「主动-冷却 10 秒」，
//     所以 30716 用 `trigger = every_seconds` + `cooldown = 10`，`empoweredSkillId = 30821`。
//  3. **伤害倍率 / 穿透只挂在计划行的 `skillParamJson` 上**：`pvpSkill.damageRate` 是单值列，
//     分不了 L1/L2/L3 三档；计划行才是逐档的。
//  4. **「子弹大小 ×3」不写参数、走另一张 prefab**：尺寸真源只能是 prefab 根 `_lscale`
//     （`docs/zcds-表现层与领地规范.md` §1.10），所以 30821 的 `effectPrefabPath` 指向
//     `玉林好汉_飞镖普攻_强化`（`_lscale = 1.5 = 0.5 × 3`，共用同一批帧与 clip，不复制美术）。
//  5. **`unlockHeroLevel` 最小 1**：设计案写「兵种 0 级」，但 `ZCStatSchema:837` 硬校验
//     `>= 1`，所以 0 级档落成 1（与火焰树妖 100301 同口径）。
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];
const PLAN_TABLES = [
    'assets/remoteRef/pvpSkillPlan.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json',
];
const CARD_TABLES = [
    'assets/remoteRef/pvpCard.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
];

const UNIT_ID = '68004';
const ATTACK_SKILL_ID = 30716;
const ULTIMATE_SKILL_ID = 30821;
const SOURCE_VERSION = '技能设计案2 玉林好汉 v1.0';

const NEW_SKILLS = [
    {
        skillId: ATTACK_SKILL_ID,
        name: '玉林好汉普攻',
        mode: 'projectile',
        projectileKey: '',
        projectileSpeed: 500,
        areaRadius: 0,
        // 按秒触发时 empoweredEvery 无意义（`ZCCombatSystem.consumeEmpoweredAttack` 走 cooldown 分支）
        empoweredEvery: 0,
        empoweredSkillId: ULTIMATE_SKILL_ID,
        effectPrefabPath: 'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻',
        cooldown: 10,
        effectKey: '',
        trigger: 'every_seconds',
        damageRate: null,
        durationSeconds: null,
        waves: null,
        slowRatio: null,
        onHitStatusId: null,
    },
    {
        skillId: ULTIMATE_SKILL_ID,
        name: '精英猎手',
        mode: 'projectile',
        projectileKey: '',
        projectileSpeed: 500,
        areaRadius: 0,
        empoweredEvery: 0,
        empoweredSkillId: 0,
        effectPrefabPath: 'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化',
        cooldown: 0,
        effectKey: '',
        trigger: null,
        // 三档倍率在计划行，这一列恒留空
        damageRate: null,
        durationSeconds: null,
        waves: null,
        slowRatio: null,
        onHitStatusId: null,
    },
];

/** 被动三件套：三级同值，`progressionMode = replace`（与火焰树妖 100301 同款）。 */
function passiveRows(chainId, name, levelUnlocks, statId, value, desc) {
    return levelUnlocks.map((unlockHeroLevel, index) => ({
        enabled: 1,
        modifierId: 91004000 + chainId % 100 * 10 + index + 1,
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
        operation: 'addRate',
        value,
        durationSeconds: 0,
        maxStacks: 1,
        cooldown: 0,
        maxTriggers: 0,
        behaviorKey: null,
        statusId: null,
        statusStatJson: null,
        skillParamJson: null,
        desc,
        sourceVersion: SOURCE_VERSION,
        publishStatus: '可发布',
    }));
}

/** 100404 精英猎手：伤害 / 穿透人数 / 每次穿透衰减 三样都只在计划行的 skillParamJson 里。 */
function ultimateRows() {
    const tiers = [
        { level: 1, unlock: 12, damageRate: 0.6, pierceCount: 3 },
        { level: 2, unlock: 20, damageRate: 0.7, pierceCount: 6 },
        { level: 3, unlock: 25, damageRate: 0.8, pierceCount: 8 },
    ];
    return tiers.map((tier) => ({
        enabled: 1,
        modifierId: 91004040 + tier.level,
        unitId: UNIT_ID,
        skillChainId: 100404,
        skillName: '精英猎手',
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
        cooldown: 0,
        maxTriggers: 0,
        skillParamJson: JSON.stringify({
            damageRate: tier.damageRate,
            pierceCount: tier.pierceCount,
            pierceFalloff: 0.2,
        }),
        desc: `每10秒一次：本次飞镖伤害${Math.round(tier.damageRate * 100)}%、可穿透${tier.pierceCount}人，每穿透一次伤害降低20%`,
        sourceVersion: SOURCE_VERSION,
        publishStatus: '可发布',
    }));
}

const NEW_PLANS = [
    ...passiveRows(100401, '灵巧投掷', [1, 14, 22], 'attackSpeed', 0.1, '攻击速度提高10%（三级同值，不叠加）'),
    ...passiveRows(100402, '铁质飞镖', [6, 16, 23], 'damageRate', 0.1, '伤害提高10%（三级同值，不叠加）'),
    ...passiveRows(100403, '高速移动', [1, 14, 22], 'moveSpeed', 0.15, '移动速度提高15%（三级同值，不叠加）'),
    ...ultimateRows(),
];

function upsert(targetRows, row, keyOf, label) {
    const key = keyOf(row);
    const index = targetRows.findIndex((item) => keyOf(item) === key);
    if (index >= 0) targetRows[index] = { ...targetRows[index], ...row };
    else targetRows.push(row);
    if (index >= 0) console.log(`  [更新] ${label} ${key}`);
    else console.log(`  [新增] ${label} ${key}`);
}

// ── 1) pvpSkill ────────────────────────────────────────────────────────────────
for (const path of SKILL_TABLES) {
    const table = readTable(path);
    const beforeOthers = table.rows.filter((row) => row.skillId !== ATTACK_SKILL_ID
        && row.skillId !== ULTIMATE_SKILL_ID).map((row) => JSON.stringify(row));
    console.log(`[pvpSkill] ${path}（${table.mode}，${table.rows.length} 行）`);
    for (const skill of NEW_SKILLS) {
        upsert(table.rows, skill, (row) => row.skillId, '技能');
    }
    const afterOthers = table.rows.filter((row) => row.skillId !== ATTACK_SKILL_ID
        && row.skillId !== ULTIMATE_SKILL_ID).map((row) => JSON.stringify(row));
    if (JSON.stringify(beforeOthers) !== JSON.stringify(afterOthers)) {
        throw new Error(`${path} 的非目标技能行被改动了`);
    }
    for (const skill of NEW_SKILLS) {
        const hit = table.rows.find((row) => row.skillId === skill.skillId);
        for (const [key, value] of Object.entries(skill)) {
            if (hit[key] !== value) throw new Error(`${path} ${skill.skillId}.${key} 写后校验失败：${hit[key]} !== ${value}`);
        }
    }
    writeTable(path, table);
    console.log(`  → ${table.rows.length} 行`);
}

// 30715（玉米射手普攻）必须原样留着：它仍是玉米射手自己的普攻行。
for (const path of SKILL_TABLES) {
    const table = readTable(path);
    const corn = table.rows.find((row) => row.skillId === 30715);
    if (!corn) throw new Error(`${path} 丢了 30715（玉米射手普攻）`);
    if (corn.effectPrefabPath !== 'units/projectiles/玉米射手_普攻/玉米射手_普攻') {
        throw new Error(`${path} 30715 的特效路径被改动了：${corn.effectPrefabPath}`);
    }
}

// ── 2) pvpSkillPlan ────────────────────────────────────────────────────────────
for (const path of PLAN_TABLES) {
    const table = readTable(path);
    const beforeOtherUnits = table.rows.filter((row) => String(row.unitId) !== UNIT_ID).length;
    console.log(`[pvpSkillPlan] ${path}（${table.mode}，${table.rows.length} 行）`);
    for (const plan of NEW_PLANS) {
        upsert(table.rows, plan, (row) => `${row.unitId}:${row.skillChainId}:${row.skillLevel}`, '计划');
    }
    const afterOtherUnits = table.rows.filter((row) => String(row.unitId) !== UNIT_ID).length;
    if (beforeOtherUnits !== afterOtherUnits) throw new Error(`${path} 的其他卡牌计划行数变了`);
    const mine = table.rows.filter((row) => String(row.unitId) === UNIT_ID);
    if (mine.length !== NEW_PLANS.length) throw new Error(`${path} 里 ${UNIT_ID} 应有 ${NEW_PLANS.length} 行，实得 ${mine.length}`);
    for (const plan of NEW_PLANS) {
        const hit = mine.find((row) => row.skillChainId === plan.skillChainId && row.skillLevel === plan.skillLevel);
        for (const [key, value] of Object.entries(plan)) {
            if (hit[key] !== value) throw new Error(`${path} ${plan.skillChainId}/${plan.skillLevel}.${key} 校验失败：${hit[key]} !== ${value}`);
        }
    }
    writeTable(path, table);
    console.log(`  → ${table.rows.length} 行（${UNIT_ID} 共 ${mine.length} 行）`);
}

// ── 3) pvpCard：68004 换上新的普攻行 ──────────────────────────────────────────
for (const path of CARD_TABLES) {
    const table = readTable(path);
    const card = table.rows.find((row) => row.id === 68004);
    if (!card) throw new Error(`${path} 找不到 68004`);
    if (!('unitSkillId' in card)) throw new Error(`${path} 68004 没有 unitSkillId 字段`);
    const before = card.unitSkillId;
    card.unitSkillId = ATTACK_SKILL_ID;
    for (const row of table.rows) {
        if (row.id !== 68004 && row.unitSkillId === ATTACK_SKILL_ID) {
            throw new Error(`${path} 有别的卡也指向 ${ATTACK_SKILL_ID}：${row.id}`);
        }
    }
    writeTable(path, table);
    console.log(`[pvpCard] ${path} unitSkillId 68004: ${before} → ${ATTACK_SKILL_ID}`);
}

console.log('\n完成。');
