// 2026-11-24 第 44 批：仙桃行者 68009 的「大地之力」改成「腾云驾雾」，机甲菇 101503 改名「三尖两刃」。
//
// 用户原话：
//   「仙桃行者 大地之力技能优化
//    1.名字改为腾云驾雾
//    2.技能机制修改：以150px速度突进到目标1身前 攻击1次，以目标1为圆心 200px为半径，
//      内索取额外3个目标（合计4人），依次突进到这些目标身前攻击1次（每个目标攻击1次），
//      再回到目标1的位置，给每个目标造成350%410%/480%(对应等级的伤害)，每次攻击都会释放
//      重击特效  这个技能的攻击不计入普攻的累计数
//    3.机甲菇的技能名字修改 三尖两刃」
//
// 四条落地口径（2026-11-24 逐项确认）：
//   · 「三尖两刃」改的是 **101503**（机甲菇 120° 扇形那条，第 43 批刚从「菌丝绞杀」改名「武器绞杀」）；
//   · 「腾云驾雾」**仍是强化那一击**（`pvpSkill 30718.empoweredEvery = 5`）；
//     「不计入普攻累计数」说的是那 4 段突进伤害（走 `strikeTargets`，天然不碰
//     `completedAttackCount`），触发它的那一次普攻照旧 +1；
//   · 350% / 410% / 480% = **每个目标各自**吃这个倍率（4 个人各挨 350%，不是 4 人分 350%）；
//   · 突进速度按表值 150 px/s，本体**真位移**（× `combatDistanceScale` 0.3 ⇒ 45 世界 px/s）。
//
// 三写（见 tools/config/ref_table_io.js 开头注释）：
//   `assets/remoteRef` 列存 + `doc/塔防数据配置/json/client` 行对象 + 源表 xlsx
//   （源表另跑 `sync_plan_rows_to_j_excel.py 100904 101503` 与 `patch_batch44_card_xlsx.py`）。
//
// 🔴 `pvpSkillPlan.modifierId`（94009041~43）**一个都不动**：那是属性词条位，
//    本批只换技能形态与文案。`pvpSkillId`（30718）更不能动 —— 它是 `skillParamJson`
//    那一个袋子的键（`${unitId}:${pvpSkillId}`），100901~100904 共用。
//
// 🔴 旧四个键（`damageRate` / `pierceCount` / `quakeFirstRate` / `quakeRadius`）整批删掉：
//    它们只服务旧机制（穿透冲击波 + 首目标重击圆）。四条读取点全部在
//    `empowered` 分支里（`prepareAttack` 现在拿到 `dashChainSpeed` 就 `return null`，
//    根本走不到 `createAttackProjectiles`），删掉不会波及本卡另外三条技能。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'assets/remoteRef',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client',
];

const UNIT_XIANTAO = '68009';
const UNIT_MECH = '68015';

const CHAIN_DASH = '100904';      // 大地之力 → 腾云驾雾
const CHAIN_FAN = '101503';       // 武器绞杀 → 三尖两刃

const DASH_NAME = '腾云驾雾';
const FAN_NAME = '三尖两刃';

/** 强化那一击的节拍：`pvpSkill 30718` 的 `empoweredEvery`。写进描述里才说得清「什么时候放」。*/
const EMPOWERED_EVERY = 5;

/** 三档倍率（用户口述「350%410%/480%」）。*/
const DASH_RATES = { 1: 3.5, 2: 4.1, 3: 4.8 };

const DASH_SPEED = 150;            // 表值 px/秒
const DASH_SPREAD_RADIUS = 200;    // 以目标 1 为圆心的搜索半径（表值 px）
const DASH_COUNT = 4;              // 含目标 1 共几人
const DASH_STOP_DISTANCE = 30;     // 落在目标身前多远（与突刺 / 闪现同一套几何，表值 px）
const DASH_HIT_RADIUS = 40;        // 那一击的挑人半径（表值 px）

const pct = (rate) => `${Math.round(rate * 100)}%`;

function dashParams(level) {
    const rate = DASH_RATES[level];
    if (!rate) throw new Error(`腾云驾雾没有 ${level} 档`);
    return JSON.stringify({
        dashChainSpeed: DASH_SPEED,
        dashChainSpreadRadius: DASH_SPREAD_RADIUS,
        dashChainCount: DASH_COUNT,
        dashChainStopDistance: DASH_STOP_DISTANCE,
        dashChainHitRadius: DASH_HIT_RADIUS,
        dashChainDamageRate: rate,
    });
}

function dashDesc(level) {
    const rate = DASH_RATES[level];
    if (!rate) throw new Error(`腾云驾雾没有 ${level} 档`);
    return `每${EMPOWERED_EVERY}次普攻，突进到目标身前攻击1次（${pct(rate)}伤害）；`
        + `以该目标为圆心${DASH_SPREAD_RADIUS}范围内另外${DASH_COUNT - 1}名敌人依次突进各攻击1次`
        + `（每个目标${pct(rate)}伤害），最后回到首个目标的位置；每次攻击都会释放重击特效`;
}

function rewritePlan(table, path) {
    const hits = [];
    let dash = 0;
    let fan = 0;
    for (const row of table.rows) {
        const unit = String(row.unitId);
        const chain = String(row.skillChainId);
        if (unit === UNIT_XIANTAO && chain === CHAIN_DASH) {
            const level = Number(row.skillLevel);
            //  幂等：首次跑是「大地之力」，重跑是「腾云驾雾」；都不是说明表被别人换过。
            if (!/大地之力|腾云驾雾/.test(String(row.skillName))) {
                throw new Error(`${path} 100904 的 skillName 是「${row.skillName}」，拒绝改`);
            }
            row.skillName = DASH_NAME;
            row.behaviorKey = 'dash_chain';
            row.skillParamJson = dashParams(level);
            row.desc = dashDesc(level);
            hits.push(`68009/100904 L${level}: ${DASH_NAME}｜${row.desc}`);
            dash += 1;
            continue;
        }
        if (unit === UNIT_MECH && chain === CHAIN_FAN) {
            if (!/武器绞杀|三尖两刃/.test(String(row.skillName))) {
                throw new Error(`${path} 101503 的 skillName 是「${row.skillName}」，拒绝改`);
            }
            //  只改名：参数与描述里没有一个字提到技能名（「甩出武器」说的是动作，不是名字）。
            row.skillName = FAN_NAME;
            hits.push(`68015/101503 L${row.skillLevel}: ${FAN_NAME}（参数不动）`);
            fan += 1;
        }
    }
    if (dash !== 3) throw new Error(`${path} 腾云驾雾只命中 ${dash}/3 行`);
    if (fan !== 3) throw new Error(`${path} 三尖两刃只命中 ${fan}/3 行`);
    return hits;
}

function rewriteLevelUp(table, path) {
    const hits = [];
    let dash = 0;
    let fan = 0;
    for (const row of table.rows) {
        const id = String(row.id);
        const level = Number(row.skilllevel);
        if (id === CHAIN_DASH) {
            if (!/大地之力|腾云驾雾/.test(String(row.name))) {
                throw new Error(`${path} armySkillLevelUp 100904 的 name 是「${row.name}」，拒绝改`);
            }
            row.name = DASH_NAME;
            row.desc = dashDesc(level);
            hits.push(`armySkillLevelUp 100904 L${level}: ${DASH_NAME}`);
            dash += 1;
            continue;
        }
        if (id === CHAIN_FAN) {
            if (!/武器绞杀|三尖两刃/.test(String(row.name))) {
                throw new Error(`${path} armySkillLevelUp 101503 的 name 是「${row.name}」，拒绝改`);
            }
            row.name = FAN_NAME;
            hits.push(`armySkillLevelUp 101503 L${level}: ${FAN_NAME}`);
            fan += 1;
        }
    }
    if (dash !== 3) throw new Error(`${path} armySkillLevelUp 腾云驾雾只命中 ${dash}/3 行`);
    if (fan !== 3) throw new Error(`${path} armySkillLevelUp 三尖两刃只命中 ${fan}/3 行`);
    return hits;
}

/**
 * 强化那一击的 profile（`pvpSkill 30844`）名字也要跟着换。
 *
 * 它是 `pvpSkill 30718.empoweredEvery = 5` 指过去的武将技行 —— `sendAttack` 里
 * `skillName: `${profile.name}·强化`` 读的就是这一格，旧名字会一直出现在战斗日志与技能诊断里。
 * 模式（`projectile`）**不动**：新机制在 `prepareAttack` 就 `return null` 了，
 * 那条弹道分支根本不会执行，改它反而会动到别的读 `empoweredProfile` 的地方。
 */
function rewriteSkill(table, path) {
    const hits = [];
    let touched = 0;
    for (const row of table.rows) {
        if (String(row.skillId) !== '30844') continue;
        if (!/大地之力|腾云驾雾/.test(String(row.name))) {
            throw new Error(`${path} pvpSkill 30844 的 name 是「${row.name}」，拒绝改`);
        }
        row.name = DASH_NAME;
        hits.push(`pvpSkill 30844: ${DASH_NAME}`);
        touched += 1;
    }
    if (touched !== 1) throw new Error(`${path} pvpSkill 30844 命中 ${touched}/1 行`);
    return hits;
}

/**
 * 卡面简介：`pvpCard.description` 是卡牌详情页真读的一行字。
 *
 * 68009 那句还写着「大地之力推出一道直线冲击波」—— 技能已经换成四段突进连击，
 * 不改就是「面板说推波、实际贴脸突进」。68015 那句只提了吸养根须 / 爆囊扩散 / 射线集束，
 * 没提 101503 ⇒ 不需要动。
 */
const CARD_REWRITES = [{
    unitId: UNIT_XIANTAO,
    from: '大地之力推出一道直线冲击波压住一路',
    to: '腾云驾雾四段突进逐个贴脸重击',
}];

function rewriteCard(table, path) {
    const hits = [];
    for (const spec of CARD_REWRITES) {
        let touched = 0;
        for (const row of table.rows) {
            if (String(row.id) !== spec.unitId) continue;
            const desc = String(row.description || '');
            if (!desc) throw new Error(`${path} ${spec.unitId} 的 description 是空的，拒绝改`);
            if (desc.includes(spec.to)) { hits.push(`${spec.unitId} 卡面已是新口径`); touched += 1; continue; }
            if (!desc.includes(spec.from)) {
                throw new Error(`${path} ${spec.unitId} 的 description 里没有「${spec.from}」，拒绝改（${desc}）`);
            }
            row.description = desc.replace(spec.from, spec.to);
            hits.push(`${spec.unitId} 卡面: ${row.description}`);
            touched += 1;
        }
        if (touched !== 1) throw new Error(`${path} pvpCard 的 ${spec.unitId} 命中 ${touched}/1 行`);
    }
    return hits;
}

for (const dir of TABLES) {
    for (const [name, rewrite] of [
        ['pvpSkillPlan.json', rewritePlan],
        ['armySkillLevelUp.json', rewriteLevelUp],
        ['pvpSkill.json', rewriteSkill],
        ['pvpCard.json', rewriteCard],
    ]) {
        const path = `${dir}/${name}`;
        const table = readTable(path);
        const hits = rewrite(table, path);
        writeTable(path, table);
        console.log(`[ok] ${path}（${hits.length} 处）`);
        for (const line of hits) console.log(`  ${line}`);
    }
}
