// 精密陷阱（103504，科学家 68035）从占位「轨道打击」换成设计案第 175 行的真技能（2026-11-12）。
//
// 设计案原文（技能设计案2.xlsx 第 175 行 N 列）：
//   「在原地坐标留下一个持续时间为15/18/23秒的陷阱，目标触碰到该陷阱会收到1次伤害
//     200%/250%/300%，陷阱会爆炸范围100px圆形，造成1次额外的伤害，爆炸范围内所有敌人
//     受到均等伤害 180%/220%/280%，陷阱达到指定的秒数后也会主动爆炸」
//
// 表里这三行原来是 **轨道打击** 的占位（`{"damageRate":2.0/2.8/4.0}` + `statusId=stun_*`），
// 与设计案逐条对不上：
//
//   字段                 旧（轨道打击）      新（精密陷阱）        说明
//   skillName            轨道打击            精密陷阱              卡面真读
//   behaviorKey          skill_params        trap_place            🔴 必须改：`ZCVisualResourcePlan`
//                                                                 按它筛出要加载的三个预制体，
//                                                                 留 skill_params ⇒ 资源不加载、
//                                                                 技能照常结算但屏幕上什么都没有
//   skillParamJson       damageRate          trap* 七个槽          见下
//   statusId             stun_1 / stun_1_5 / stun_2s   null       陷阱不眩晕（设计案没有这条）
//   triggerEvent         null                active                主动-冷却秒数
//
// 七个参数（距离一律**表值 px**，与 `pvpSkill.areaRadius` 同一套口径；代码里乘 0.3 落世界坐标）：
//
//   trapCooldown           10   设计案 J 列（触发参数）= 10，逐字照抄（下一行射线集束是 8）
//   trapDuration       15/18/23 设计案原值
//   trapRadius             50   **触碰**半径；与 idle 序列帧的屏上直径同源（76.9px ÷ 0.76875 ÷ 2）
//   trapDamageRate    2.0/2.5/3.0 设计案 200%/250%/300%
//   trapExplodeRadius     100   设计案「爆炸范围100px圆形」（逻辑 px ⇒ 屏上直径 153.75px）
//   trapExplodeDamageRate 1.8/2.2/2.8 设计案 180%/220%/280%，范围内**均等**（无递减）
//   trapForward             0   「原地坐标」⇒ 压在脚下；留这个槽是为了以后要「往前丢一格」只改表
//
// 三处描述一起改（否则卡片 / 升级面板 / 两人看到的文案不一致）：
//   · `pvpSkillPlan.skillName + desc`（PVP 技能案真读）
//   · `armySkillLevelUp.name + desc`（卡牌升级面板真读，`CardSkillDescMarkup`）
// 两份 JSON 产物（`assets/remoteRef` 与 `doc/塔防数据配置/json/client`）都要写。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const UNIT = '68035';
const CHAIN = 103504;
const SKILL_NAME = '精密陷阱';
const BEHAVIOR_KEY = 'trap_place';

/** 三档共用的槽位（设计案只给了「持续 / 两段倍率」随档走，其余逐档相同）。 */
const COMMON = {
    trapCooldown: 10,
    trapRadius: 50,
    trapExplodeRadius: 100,
    trapForward: 0,
};

/** 逐档：存活秒数 / 触碰倍率 / 爆炸倍率（设计案 N 列的 15/18/23、200/250/300、180/220/280）。 */
const TIERS = {
    1: { trapDuration: 15, trapDamageRate: 2.0, trapExplodeDamageRate: 1.8 },
    2: { trapDuration: 18, trapDamageRate: 2.5, trapExplodeDamageRate: 2.2 },
    3: { trapDuration: 23, trapDamageRate: 3.0, trapExplodeDamageRate: 2.8 },
};

/** 键序稳定：CD → 存活 → 两个半径 → 两段倍率 → 前抛偏移（读表时按这个顺序看最顺）。 */
function paramsOf(level) {
    const tier = TIERS[level];
    if (!tier) throw new Error(`[fail] 没有 L${level} 档的参数`);
    return JSON.stringify({
        trapCooldown: COMMON.trapCooldown,
        trapDuration: tier.trapDuration,
        trapRadius: COMMON.trapRadius,
        trapDamageRate: tier.trapDamageRate,
        trapExplodeRadius: COMMON.trapExplodeRadius,
        trapExplodeDamageRate: tier.trapExplodeDamageRate,
        trapForward: COMMON.trapForward,
    });
}

/** 百分比文案：2 → 「200%」，1.8 → 「180%」（避免 180.00000000000003 这种噪声）。 */
function pct(rate) {
    return `${Math.round(rate * 100)}%`;
}

/**
 * 卡面描述。三档只有四个数字不同，句式逐字相同 —— 与 101603 五雷轰顶同一套写法
 * （「冷却 12 秒：……」开头，玩家一眼能看到「多久放一次」）。
 */
function descOf(level) {
    const tier = TIERS[level];
    if (!tier) throw new Error(`[fail] 没有 L${level} 档的描述`);
    return `冷却 ${COMMON.trapCooldown} 秒：在脚下留下一个持续 ${tier.trapDuration} 秒的陷阱，`
        + `敌人踩中立刻受到 ${pct(tier.trapDamageRate)} 攻击力伤害并引爆；`
        + `爆炸半径 ${COMMON.trapExplodeRadius}px，范围内所有敌人均等受到 `
        + `${pct(tier.trapExplodeDamageRate)} 攻击力伤害（不递减）；`
        + `无人踩中则到时自动引爆`;
}

function patchBoth(table, mutate) {
    for (const path of [DOC + table + '.json', REF + table + '.json']) {
        const source = readTable(path);
        const before = JSON.stringify(source.rows);
        source.rows = mutate(source.rows);
        if (JSON.stringify(source.rows) === before) {
            console.log(`[skip] ${path}（无变化）`);
            continue;
        }
        writeTable(path, source);
        console.log(`[ok] ${path}（${source.mode}）${source.rows.length} 行`);
    }
}

patchBoth('pvpSkillPlan', (rows) => rows.map((row) => {
    if (String(row.unitId) !== UNIT || Number(row.skillChainId) !== CHAIN) return row;
    const level = Number(row.skillLevel);
    const next = {
        ...row,
        skillName: SKILL_NAME,
        behaviorKey: BEHAVIOR_KEY,
        triggerEvent: 'active',
        statusId: null,
        skillParamJson: paramsOf(level),
        desc: descOf(level),
    };
    if (JSON.stringify(next) === JSON.stringify(row)) return row;
    console.log(`  · pvpSkillPlan 103504 L${level} → ${SKILL_NAME}（${BEHAVIOR_KEY}）`);
    return next;
}));

patchBoth('armySkillLevelUp', (rows) => rows.map((row) => {
    if (Number(row.id) !== CHAIN) return row;
    const level = Number(row.skilllevel);
    const next = { ...row, name: SKILL_NAME, desc: descOf(level) };
    if (JSON.stringify(next) === JSON.stringify(row)) return row;
    console.log(`  · armySkillLevelUp 103504 L${level} 名称/描述已重写`);
    return next;
}));

// ── 自查 ────────────────────────────────────────────────────────────────
const refRows = readTable(REF + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN);
const docRows = readTable(DOC + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN);
if (refRows.length !== 3) throw new Error(`[fail] pvpSkillPlan 应有 3 档，实到 ${refRows.length}`);

for (const row of refRows) {
    const level = Number(row.skillLevel);
    const params = JSON.parse(row.skillParamJson);
    const want = { ...COMMON, ...TIERS[level] };
    const drift = Object.entries(want).filter(([key, value]) => params[key] !== value).map(([key]) => key);
    const extra = Object.keys(params).filter((key) => !(key in want));
    const docRow = docRows.find((item) => Number(item.skillLevel) === level);
    const same = docRow && docRow.skillParamJson === row.skillParamJson && docRow.desc === row.desc
        && docRow.behaviorKey === row.behaviorKey && docRow.skillName === row.skillName;
    if (drift.length) throw new Error(`[fail] L${level} 参数偏差：${drift.join(',')}`);
    if (extra.length) throw new Error(`[fail] L${level} 残留旧键：${extra.join(',')}（轨道打击的 damageRate？）`);
    if (!same) throw new Error(`[fail] L${level} 两份 JSON 不一致`);
    if (row.statusId !== null) throw new Error(`[fail] L${level} 还挂着眩晕状态 ${row.statusId}`);
    console.log(`[check] L${level} 参数齐 | 无旧键 | 两份 JSON 一致 | ${row.desc}`);
}
