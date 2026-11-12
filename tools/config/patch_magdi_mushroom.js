// 一次性配置补丁：磁电菇（68016）新设定技能落地（2026-11-11）。
//
//   101603 五雷轰顶   —— 行为键 `bolt_strike`（新车道，`ZCSkillTriggerSystem.applyBoltStrike`）
//   101604 磁电冲击   —— 行为键 `self_aura`（复用自身光环车道，改成「累计 8 次普攻」触发 +
//                        身前 1px + 站桩 + 每波最多 5 人）
//   pvpStatus `numb` —— 新设定「麻痹」是**软控**（只禁攻击 + 移速 −50%），
//                        不能复用 `paralysis`（那是硬控，连移动都停）。
//
// 同时写两处（两套格式都要认，见 `ref_table_io.js` 的头注释）：
//   · assets/remoteRef/*.json             —— 运行时真正加载的表（列存竖排 CRLF）
//   · doc/塔防数据配置/json/client/*.json —— 转表产物（紧凑行数组，逐行 LF）
//
// 用法：node patch_magdi_mushroom.js <assets/remoteRef 目录> <doc/.../json/client 目录>
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io');

const dirs = process.argv.slice(2);
if (dirs.length < 2) throw new Error('用法：node patch_magdi_mushroom.js <remoteRef 目录> <client json 目录>');

const PARAM = 'skillParamJson';
const UNIT = '68016';
const PVP_SKILL_ID = 30231;   // == pvpCard.unitSkillId（守卫在 validate_skill_pipeline）
const SOURCE_VERSION = '技能设计案2 磁电菇 v1.2';

/**
 * 转表产物（行数组）的写法：**沿用它原来的排版**。
 *
 * 实测这几张表并不统一：`pvpStatus.json` 是「一行一条」，`pvpSkillPlan.json` 整份压成一行，
 * `armySkillLevelUp.json` 是 2 空格缩进的 pretty print。硬套任何一种都会让整文件 diff 爆炸，
 * 所以按原文件的**开头**判断；同时 null 的键不写出（现有行就是这么省的，列存那边才补 null）。
 */
function writeRowsLikeOriginal(file, rows, originalRaw) {
    const clean = rows.map((row) => Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== null && value !== undefined)));
    if (originalRaw.startsWith('[\n')) {
        const trailing = originalRaw.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}${trailing}`, 'utf8');
        return;
    }
    const separator = originalRaw.includes('\n') ? ',\n' : ',';
    fs.writeFileSync(file, `[${clean.map((row) => JSON.stringify(row)).join(separator)}]`, 'utf8');
}

// ── 1. pvpStatus：软控「麻痹」numb ───────────────────────────────────────────

const NUMB_ROW = {
    legacyBuffKey: '磁电麻痹',
    statusId: 'numb',
    name: '麻痹',
    durationSeconds: 3,
    intervalSeconds: 0,
    maxStacks: 1,
    refreshPolicy: 'refresh',
    handlerKey: 'none',
    statJson: JSON.stringify({ moveSpeedPct: -50, attackDisabled: 1 }),
    enabled: 1,
};

function applyStatus(tables) {
    const t = tables.pvpStatus;
    const rows = t.rows;
    const byId = new Map(rows.map((row) => [String(row.statusId), row]));
    if (byId.has(NUMB_ROW.statusId)) return;
    //  `control` 故意留空：硬控会把单位机在最前置闸门整段 return（连移动都停），
    //  那是 `paralysis`；软控只挡普攻，移速由 `statJson.moveSpeedPct` 走属性链。
    //  行模式（转表产物）里 null 的键**不写出**，与现有行一致；列存模式交给 writeTable 补 null。
    rows.push(t.mode === 'rows' ? { ...NUMB_ROW } : {
        ...NUMB_ROW, control: null, periodicAmountPct: null, periodicBasis: null, periodicCapMultiplier: null,
    });
}

// ── 2. pvpSkillPlan：两条技能 × 三档 ────────────────────────────────────────

function planRow(overrides) {
    return {
        enabled: 1, modifierId: null, unitId: null, skillChainId: null, skillName: null, skillLevel: null,
        unlockHeroLevel: null, skillKind: null, passiveScope: 'deployed', progressionMode: 'replace',
        pvpSkillId: null, stateMode: 'none', desc: null, sourceVersion: SOURCE_VERSION, publishStatus: '可发布',
        statId: null, operation: null, value: null, behaviorKey: null,
        [PARAM]: null, cooldown: null, triggerEvent: null, targetSelector: null,
        durationSeconds: null, maxStacks: null, maxTriggers: null, statusId: null, statusStatJson: null,
        ...overrides,
    };
}

//  五雷轰顶：12s CD，1 道落在目标身上 + 2/3/4 道沿「目标背朝向」排开（每道间隔 60 表值 px）。
//  「160%/200%/250%」按**每道独立计**（用户 2026-11-11 拍板），所以三档总伤 = 3×160% / 4×200% / 5×250%。
const BOLT = [
    { level: 1, unlock: 9, count: 3, rate: 1.6, text: '160%' },
    { level: 2, unlock: 18, count: 4, rate: 2.0, text: '200%' },
    { level: 3, unlock: 24, count: 5, rate: 2.5, text: '250%' },
];

//  磁电冲击：累计 8 次普攻，在身前 1px 放一片站桩冲击波，持续 3 秒、每秒 1 波、每波最多 5 人。
//  三档只抬「每波伤害」与「半径」，触发门槛（8 次）/ 时长 / 人数上限不变 —— 那三个是设计给的常量。
//  ⚠️ 解锁等级以 K 表（`K-卡牌升级.xlsx / 卡牌技能升级表` 193~198 行）为准：101603 = 9/18/24、101604 = 0/20/25。
const SHOCK = [
    { level: 1, unlock: 0, rate: 2.5, radius: 160 },
    { level: 2, unlock: 20, rate: 3.0, radius: 180 },
    { level: 3, unlock: 25, rate: 3.5, radius: 200 },
];

/** K 表面板文案（与 `armySkillLevelUp.desc` / K 表 C 列同一份）。 */
const PANEL_DESC = {
    101603: [
        '冷却12秒：对目标释放1道雷电并沿其背朝向再落2道（每道间隔60px、出现间隔0.15秒），每道造成160%伤害，30%概率使目标麻痹3秒',
        '冷却12秒：对目标释放1道雷电并沿其背朝向再落3道（每道间隔60px、出现间隔0.15秒），每道造成200%伤害，30%概率使目标麻痹3秒',
        '冷却12秒：对目标释放1道雷电并沿其背朝向再落4道（每道间隔60px、出现间隔0.15秒），每道造成250%伤害，30%概率使目标麻痹3秒',
    ],
    101604: [
        '累计8次普攻：朝目标方向喷出一道长320、宽108的雷电束（起点在自身中心），持续3秒、每秒造成250%伤害，每波最多命中5个敌人',
        '累计8次普攻：朝目标方向喷出一道长360、宽108的雷电束（起点在自身中心），持续3秒、每秒造成300%伤害，每波最多命中5个敌人',
        '累计8次普攻：朝目标方向喷出一道长400、宽108的雷电束（起点在自身中心），持续3秒、每秒造成350%伤害，每波最多命中5个敌人',
    ],
};
const SKILL_NAME = { 101603: '五雷轰顶', 101604: '磁电冲击' };

function applyPlan(tables) {
    const t = tables.pvpSkillPlan;
    if (t.keys && !t.keys.includes(PARAM)) t.keys.push(PARAM);
    const existing = new Set(t.rows.map((row) => `${row.unitId}:${row.skillChainId}:${row.skillLevel}`));
    const push = (row) => {
        const key = `${row.unitId}:${row.skillChainId}:${row.skillLevel}`;
        if (existing.has(key)) return;
        t.rows.push(row);
        existing.add(key);
    };
    //  幂等校正：K 表的解锁等级是唯一真源，重复跑脚本时把已存在的行也对齐回去。
    const align = (row, unlock) => { row.unlockHeroLevel = unlock; };

    for (const item of BOLT) {
        push(planRow({
            modifierId: 94016030 + item.level,
            unitId: UNIT, pvpSkillId: PVP_SKILL_ID, skillChainId: 101603, skillName: '五雷轰顶',
            skillLevel: item.level, unlockHeroLevel: item.unlock,
            skillKind: 'active_cd', passiveScope: 'battle', triggerEvent: 'active',
            behaviorKey: 'bolt_strike',
            desc: `冷却 12 秒：对锁定目标释放 1 道雷电，并沿其背朝向再落 ${item.count - 1} 道`
                + `（每道间隔 60px、逐道间隔 0.15 秒），每道造成 ${item.text} 攻击力伤害，`
                + '每道独立判定 30% 概率使目标麻痹 3 秒（只禁攻击、移速 −50%）',
            [PARAM]: JSON.stringify({
                boltCooldown: 12,
                boltCount: item.count,
                boltSpacing: 60,
                boltInterval: 0.15,
                boltDelay: 0.15,          // 特效第 5 帧判伤 ≈ 0.15s
                boltDamageRate: item.rate,
                boltRadius: 90,
                boltNumbChance: 0.3,
                boltNumbSeconds: 3,
            }),
        }));
    }

    for (const item of SHOCK) {
        push(planRow({
            modifierId: 94016040 + item.level,
            unitId: UNIT, pvpSkillId: PVP_SKILL_ID, skillChainId: 101604, skillName: '磁电冲击',
            skillLevel: item.level, unlockHeroLevel: item.unlock,
            skillKind: 'active_cd', passiveScope: 'battle', triggerEvent: 'active',
            behaviorKey: 'self_aura',
            desc: '累计 8 次普攻：在身前 1 像素处释放 1 道雷电冲击波，持续 3 秒、每秒造成'
                + ` ${Math.round(item.rate * 100)}% 攻击力伤害，每波最多命中 5 个敌人`,
            [PARAM]: JSON.stringify({
                auraEvery: 8,
                auraSeconds: 3,
                auraInterval: 1,
                auraRadius: item.radius,
                auraDamageRate: item.rate,
                auraForward: 1,            // 「身前 1px」
                auraFollow: 0,             // 冲击波站桩，不跟着本体跑
                auraWaveMaxTargets: 5,
            }),
        }));
    }

    //  幂等校正：K 表的解锁等级是唯一真源（101603 = 9/18/24，101604 = 0/20/25），
    //  重复跑脚本时把已经存在的行也对齐回去，避免「第二次跑就不改」。
    const unlocks = new Map();
    for (const item of BOLT) unlocks.set(`101603:${item.level}`, item.unlock);
    for (const item of SHOCK) unlocks.set(`101604:${item.level}`, item.unlock);
    for (const row of t.rows) {
        if (String(row.unitId) !== UNIT) continue;
        const wanted = unlocks.get(`${row.skillChainId}:${row.skillLevel}`);
        if (wanted !== undefined) row.unlockHeroLevel = wanted;
    }
}

// ── 3. armySkillLevelUp（K 表转表产物）：名字 / 描述 / 修改器指针 ───────────
//
//  K 表（`K-卡牌升级.xlsx / 卡牌技能升级表`）里面向 101603 / 101604 的 6 行**早就存在**
//  （193~198 行），只是 name / desc 空着、`modfiy` 是 `[]`。出口径：
//  · `name` / `desc` 与 K 表 B/C 列同一份文案；
//  · `modfiy` 只写**本次的** PVP 计划行（`project_skill_plan.mjs` 也是这么回填的），
//    老的 94916xxx 修改器这两条技能没有，不要凭空造。
function applyArmy(tables) {
    const t = tables.armySkillLevelUp;
    const byKey = new Map(t.rows.map((row) => [`${row.id}:${row.skilllevel}`, row]));
    for (const chainId of [101603, 101604]) {
        for (const level of [1, 2, 3]) {
            const row = byKey.get(`${chainId}:${level}`);
            if (!row) { console.warn(`  ⚠ K 表缺 ${chainId} L${level}，跳过`); continue; }
            row.name = SKILL_NAME[chainId];
            row.desc = PANEL_DESC[chainId][level - 1];
            row.modfiy = [94016000 + (chainId === 101603 ? 30 : 40) + level];
        }
    }
}

// ── 执行 ────────────────────────────────────────────────────────────────────

const APPLY = { pvpStatus: applyStatus, pvpSkillPlan: applyPlan, armySkillLevelUp: applyArmy };

for (const dir of dirs) {
    for (const name of Object.keys(APPLY)) {
        const file = path.join(dir, `${name}.json`);
        if (!fs.existsSync(file)) throw new Error(`缺表：${file}`);
        const table = readTable(file);
        const originalRaw = table.raw;
        APPLY[name]({ [name]: table });
        if (table.mode === 'rows') writeRowsLikeOriginal(file, table.rows, originalRaw);
        else writeTable(file, table);
        console.log(`✓ ${file}（${table.rows.length} 行，${table.mode}）`);
    }
}
