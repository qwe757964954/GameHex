// 2026-11-23 第 43 批：机甲菇 68015 / 科学家 68035 的三条技能链改动。
//
// 三件事，两套磁盘格式（remoteRef 列存 + doc/client 行对象）必须同改
// （见 tools/config/ref_table_io.js 开头注释）：
//
//  1. 需求一 —— 科学家的「射线集束」整条搬给机甲菇，替换它的「菌毯爆发」：
//     `68015 / 101504` 三级从 `burst_aura` 改成 `ray_beam`，参数与描述**逐字抄**
//     `68035 / 103503` 改造前的快照（用户：「技能效果不变」）。
//     🔴 所以本脚本必须**先快照再改**：103503 在第 3 件事里会被整条改造成文明之火。
//  2. 需求二 —— 机甲菇的「菌丝绞杀」改名「武器绞杀」，描述里的「菌丝」全换成「武器」。
//     参数一个不动（用户：「主动技能改成 武器绞杀，技能描述的菌丝也改成 武器」）。
//  3. 需求三 —— 科学家的原「射线集束」103503 改成「文明之火」：
//     `ray_beam` → `fire_zone`，在目标点 200 半径内随机撒 3 块火焰区域，
//     每块半径 60（与灼热地带一致）、每秒 1 跳、持续 6/8/10 秒、每秒 100/110/120%。
//
// 触发方式沿用「累计普攻 8 次」（用户 2026-11-23 确认），所以 `fireEvery` 仍是 8。
//
// 🔴 `pvpSkillPlan.modifierId`（94015031~33 / 94015041~43 / 94035031~33）**一个都不动**：
// 那是属性词条（攻击 / 血量那些），本批只换技能形态与文案。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'assets/remoteRef',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client',
];

const MECH_ID = '68015';
const SCI_ID = '68035';

const CHAIN_FAN = '101503';       // 菌丝绞杀 → 武器绞杀
const CHAIN_BURST = '101504';     // 菌毯爆发 → 射线集束（搬到机甲菇身上）
const CHAIN_RAY = '103503';       // 射线集束 → 文明之火（科学家自己）

const FAN_NAME = '武器绞杀';
const RAY_NAME = '射线集束';
const FIRE_NAME = '文明之火';

//  文明之火三档：持续 6/8/10 秒、每秒 100/110/120%。
//  `fireRadius` = 60 与灼热地带（30811 的 areaRadius）逐字一致；
//  `fireSpreadRadius` = 200 是用户口述的「200px 半径的圆内」。
const FIRE_LEVELS = {
    1: { seconds: 6, rate: 1.0 },
    2: { seconds: 8, rate: 1.1 },
    3: { seconds: 10, rate: 1.2 },
};

const FIRE_EVERY = 8;
const FIRE_COUNT = 3;
const FIRE_SPREAD_RADIUS = 200;
const FIRE_RADIUS = 60;
const FIRE_INTERVAL = 1;

const pct = (rate) => `${Math.round(rate * 100)}%`;

function fireParams(level) {
    const spec = FIRE_LEVELS[level];
    if (!spec) throw new Error(`文明之火没有 ${level} 档`);
    return JSON.stringify({
        fireEvery: FIRE_EVERY,
        fireCount: FIRE_COUNT,
        fireSpreadRadius: FIRE_SPREAD_RADIUS,
        fireRadius: FIRE_RADIUS,
        fireSeconds: spec.seconds,
        fireInterval: FIRE_INTERVAL,
        fireDamageRate: spec.rate,
    });
}

function fireDesc(level) {
    const spec = FIRE_LEVELS[level];
    if (!spec) throw new Error(`文明之火没有 ${level} 档`);
    return `累计普攻 ${FIRE_EVERY} 次后，在目标位置中心点半径 ${FIRE_SPREAD_RADIUS} 的圆内随机生成 `
        + `${FIRE_COUNT} 个火焰区域，每个区域半径 ${FIRE_RADIUS}（与灼热地带一致），`
        + `持续 ${spec.seconds} 秒，每秒对范围内敌人造成 ${pct(spec.rate)} 伤害`;
}

/** 把「射线集束」那一组旧参数 / 旧描述在**改造之前**抄下来。
 *
 * 🔴 幂等：首次跑从 68035/103503 取（它还是射线集束）；重跑时它已经是文明之火，
 * 就反过来从 68015/101504 取 —— 那三行里存的正是首次跑抄过去的同一份参数。
 * 两处都不是射线集束才报错（说明脚本已跑过、表又被别人改过）。
 */
function snapshotRay(table, path) {
    const collect = (unitId, chain) => {
        const snaps = {};
        for (const row of table.rows) {
            if (String(row.unitId) !== unitId || String(row.skillChainId) !== chain) continue;
            if (!/射线集束/.test(String(row.skillName)) || row.behaviorKey !== 'ray_beam') continue;
            snaps[Number(row.skillLevel)] = { params: row.skillParamJson, desc: row.desc };
        }
        return Object.keys(snaps).length === 3 ? snaps : null;
    };
    const fromSci = collect(SCI_ID, CHAIN_RAY);
    if (fromSci) return fromSci;
    const fromMech = collect(MECH_ID, CHAIN_BURST);
    if (fromMech) {
        console.log('[snap] 103503 已是文明之火，改从 68015/101504 取（幂等重跑）');
        return fromMech;
    }
    throw new Error(`${path} 既没有「射线集束」的 103503、也没有它的 101504 副本 —— `
        + '说明表被外部覆盖过，先人工核对再跑');
}

function rewritePlan(table, path, raySnaps) {
    const hits = [];
    let fan = 0;
    let burst = 0;
    let fire = 0;
    for (const row of table.rows) {
        const unit = String(row.unitId);
        const chain = String(row.skillChainId);
        if (unit === MECH_ID && chain === CHAIN_FAN) {
            const desc = String(row.desc);
            //  幂等：首次跑是「菌丝」、重跑是「武器」；两者都不含说明表被换过。
            if (!/菌丝|武器/.test(desc)) throw new Error(`${path} 101503 的 desc 既无「菌丝」也无「武器」，拒绝改（${desc}）`);
            row.skillName = FAN_NAME;
            row.desc = desc.replace(/菌丝/g, '武器');
            hits.push(`68015/101503 L${row.skillLevel}: ${FAN_NAME}｜${row.desc}`);
            fan += 1;
            continue;
        }
        if (unit === MECH_ID && chain === CHAIN_BURST) {
            const snap = raySnaps[Number(row.skillLevel)];
            if (!snap) throw new Error(`${path} 101504 出现越界 skillLevel=${row.skillLevel}`);
            row.skillName = RAY_NAME;
            row.behaviorKey = 'ray_beam';
            row.skillParamJson = snap.params;
            row.desc = snap.desc;
            hits.push(`68015/101504 L${row.skillLevel}: ${RAY_NAME}｜${snap.desc}`);
            burst += 1;
            continue;
        }
        if (unit === SCI_ID && chain === CHAIN_RAY) {
            const level = Number(row.skillLevel);
            row.skillName = FIRE_NAME;
            row.behaviorKey = 'fire_zone';
            row.skillParamJson = fireParams(level);
            row.desc = fireDesc(level);
            hits.push(`68035/103503 L${level}: ${FIRE_NAME}｜${row.desc}`);
            fire += 1;
        }
    }
    if (fan !== 3) throw new Error(`${path} 武器绞杀只命中 ${fan}/3 行`);
    if (burst !== 3) throw new Error(`${path} 射线集束只命中 ${burst}/3 行`);
    if (fire !== 3) throw new Error(`${path} 文明之火只命中 ${fire}/3 行`);
    return hits;
}

function rewriteLevelUp(table, path, raySnaps) {
    const hits = [];
    let fan = 0;
    let burst = 0;
    let fire = 0;
    for (const row of table.rows) {
        const id = String(row.id);
        const level = Number(row.skilllevel);
        if (id === CHAIN_FAN) {
            const desc = String(row.desc);
            if (!/菌丝|武器/.test(desc)) throw new Error(`${path} armySkillLevelUp 101503 的 desc 既无「菌丝」也无「武器」`);
            row.name = FAN_NAME;
            row.desc = desc.replace(/菌丝/g, '武器');
            hits.push(`armySkillLevelUp 101503 L${level}: ${FAN_NAME}`);
            fan += 1;
            continue;
        }
        if (id === CHAIN_BURST) {
            const snap = raySnaps[level];
            if (!snap) throw new Error(`${path} armySkillLevelUp 101504 越界 skilllevel=${level}`);
            row.name = RAY_NAME;
            row.desc = snap.desc;
            hits.push(`armySkillLevelUp 101504 L${level}: ${RAY_NAME}`);
            burst += 1;
            continue;
        }
        if (id === CHAIN_RAY) {
            row.name = FIRE_NAME;
            row.desc = fireDesc(level);
            hits.push(`armySkillLevelUp 103503 L${level}: ${FIRE_NAME}`);
            fire += 1;
        }
    }
    if (fan !== 3) throw new Error(`${path} armySkillLevelUp 武器绞杀只命中 ${fan}/3 行`);
    if (burst !== 3) throw new Error(`${path} armySkillLevelUp 射线集束只命中 ${burst}/3 行`);
    if (fire !== 3) throw new Error(`${path} armySkillLevelUp 文明之火只命中 ${fire}/3 行`);
    return hits;
}

//  先拿一份快照（用 remoteRef，它是最原始的导出物）。
const seedPath = `${TABLES[0]}/pvpSkillPlan.json`;
const raySnaps = snapshotRay(readTable(seedPath), seedPath);
console.log('[snap] 103503 射线集束改前快照：');
for (const level of [1, 2, 3]) console.log(`  L${level} ${raySnaps[level].params}`);

/**
 * 第四件事：两张卡的卡面简介也要跟着换。
 *
 * `pvpCard.description` 是卡牌详情页真读的一行字，技能槽位复用之后它还写着旧技能，
 * 就是在骗玩家 —— 机甲菇那个「菌毯爆发」已经弃用、科学家那条「射线集束」已经搬走了。
 */
const CARD_DESCS = [
    //  机甲菇：菌毯爆发（弃用）⇒ 射线集束（搬进来的那条）。
    { unitId: MECH_ID, from: '菌毯爆发站桩输出', to: '射线集束向前贯穿' },
    //  科学家：射线集束（搬去机甲菇）⇒ 文明之火（原地改的这条）。
    { unitId: SCI_ID, from: '射线集束持续灼烧一条线', to: '文明之火在目标处撒三片火雨' },
];

function rewriteCard(table, path) {
    const hits = [];
    for (const spec of CARD_DESCS) {
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
        ['pvpCard.json', rewriteCard],
    ]) {
        const path = `${dir}/${name}`;
        const table = readTable(path);
        const hits = rewrite(table, path, raySnaps);
        writeTable(path, table);
        console.log(`[ok] ${path}（${hits.length} 处）`);
    }
}
