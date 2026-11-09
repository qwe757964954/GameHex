// 魔术师（68034）技能按新版设计案重做（2026-11-06）。
//
// 设计案（技能设计案2.xlsx）里 68034 有四条技能，其中第三条「帽子戏法」被删掉、
// 第四条「空间置换」改名为「移形换影」，并新增一条「鹿神守护」——
// 但设计案把「移形换影」和「鹿神守护」都写成了 skillId 103404（重复 ID）。
//
// 本次采用的编号（选择依据见交付说明）：
//   · 103404 保持「移形换影」——K-卡牌升级 表里 103404 的三行描述**本来就是**
//     移形换影 L1/L2/L3 的原文（闪现 120% / 往返 100% + 分身 60% / 往返 140% + 分身 100%），
//     说明设计案这一格不是笔误，是「沿用原 103404 的行、改名字改机制」；
//   · 「鹿神守护」新取 103405 —— 它是真正的新技能，必须有自己的成长链；
//   · 103403「帽子戏法」整链下线（设计案已无此技能），腾出来的 9/18/24 级解锁档给 103405。
//
// 落地方式：
//   · 移形换影 → behaviorKey `blink_strike`（本次新增，见 ZCSkillTriggerSystem.applyBlinkStrike）；
//   · 鹿神守护 → behaviorKey `skill_params` + 强化槽（pvpSkill 30710 改成「累计 8 次普攻」触发），
//     小鹿冲刺复用既有的**移动区域**（`zoneMoveSpeed` / `zoneMaxHits` / `zoneDamageFalloff`）。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const UNIT = '68034';
const ATTACK_SKILL = 30710;   // 魔术师普攻
const ULT_SKILL = 30854;      // 原帽子戏法行 → 鹿神守护
const RETIRED_SKILL = 30855;  // 原空间置换行 → 下线

/** 移形换影：三档参数。半径一律「表值 px」，运行时再乘 combatDistanceScale。 */
const BLINK_LV = [
    {
        modifierId: 94034041,
        unlockHeroLevel: 1,
        params: {
            blinkCooldown: 12, blinkSearchRadius: 600, blinkDamageRate: 1.2,
            blinkRoundTrip: 0, blinkStopDistance: 30, blinkHitRadius: 40,
            blinkCloneRadius: 0, blinkCloneDamageRate: 0, blinkCloneSeconds: 0,
        },
    },
    {
        modifierId: 94034042,
        unlockHeroLevel: 20,
        params: {
            blinkCooldown: 12, blinkSearchRadius: 600, blinkDamageRate: 1.0,
            blinkRoundTrip: 1, blinkStopDistance: 30, blinkHitRadius: 40,
            blinkCloneRadius: 40, blinkCloneDamageRate: 0.6, blinkCloneSeconds: 0.05,
        },
    },
    {
        modifierId: 94034043,
        unlockHeroLevel: 25,
        params: {
            blinkCooldown: 12, blinkSearchRadius: 600, blinkDamageRate: 1.4,
            blinkRoundTrip: 1, blinkStopDistance: 30, blinkHitRadius: 40,
            blinkCloneRadius: 50, blinkCloneDamageRate: 1.0, blinkCloneSeconds: 2,
        },
    },
];

/**
 * 鹿神守护：小鹿冲刺。
 *
 * damageRate 由「设计案最高伤害 600/700/800 ÷ 本卡 unitAttack 120」反算，
 * 这样它和其它伤害一样吃卡组加成 / 兵种等级 / 克制倍率，而不是一个写在表里的绝对值。
 */
const DEER_LV = [
    { level: 1, modifierId: 94034051, unlockHeroLevel: 9, total: 600 },
    { level: 2, modifierId: 94034052, unlockHeroLevel: 18, total: 700 },
    { level: 3, modifierId: 94034053, unlockHeroLevel: 24, total: 800 },
];
const DEER_UNIT_ATTACK = 120;

/** 鹿神守护的共用参数（三档相同部分）。 */
const DEER_SHARED = {
    //  设计案：接近到 200px 起以 140px/s 直线冲刺、持续 2s。
    //  移动区域只有**一个**速度，所以取冲刺段的 140（真正造成伤害的那一段），
    //  70px/s 的「接近段」被折进这一步 —— 详见交付说明。
    zoneMoveSpeed: 140,
    zoneDuration: 2,
    //  冲刺路径上最多打几个：`zoneMaxHits > 0` 才会给区域挂 `hitUnitIds`，
    //  保证同一个敌人只被同一只小鹿撞一次。
    zoneMaxHits: 5,
    zoneWaveInterval: 0.15,
    //  「每多一个目标减少 50% 伤害」。
    zoneDamageFalloff: 0.5,
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

/** 同步一套表：docClient（行对象数组）与 remoteRef（列存）。 */
function patchBoth(table, mutate) {
    let touched = 0;
    for (const path of [DOC + table + '.json', REF + table + '.json']) {
        const source = readTable(path);
        const before = JSON.stringify(source.rows);
        const rows = mutate(source.rows, source);
        if (JSON.stringify(rows) === before) {
            console.log(`[skip] ${path}（无变化）`);
            continue;
        }
        source.rows = rows;
        writeTable(path, source);
        touched += 1;
        console.log(`[ok] ${path}（${source.mode}）${before === JSON.stringify(rows) ? '' : rows.length + ' 行'}`);
    }
    return touched;
}

// ────────────────────────────── 1. pvpSkill
patchBoth('pvpSkill', (rows) => {
    const out = [];
    for (const row of rows) {
        const id = Number(row.skillId);
        if (id === RETIRED_SKILL) continue;   // 空间置换整行下线
        if (id === ATTACK_SKILL) {
            //  改「累计 8 次普攻」触发：`ZCCombatSystem.consumeEmpoweredAttack` 只在
            //  `trigger !== 'every_seconds'` 时才看 empoweredEvery，所以 trigger 必须一起改。
            row.trigger = 'every_n_attacks';
            row.empoweredEvery = 8;
            row.empoweredSkillId = ULT_SKILL;
            //  空间置换已下线，副轨槽位不再指向任何人（留着会让副轨每 8 秒打一次已删技能）。
            delete row.secondarySkillId;
        }
        if (id === ULT_SKILL) {
            row.name = '鹿神守护';
            row.mode = 'area';
            //  判定半径：小鹿身体大小。设计案没给，取 50px（≈15 世界 px，比 unitBodyRadius 略大）。
            row.areaRadius = 50;
            row.durationSeconds = 2;
            row.waves = 1;
            row.damageRate = 1;
            row.effectPrefabPath = 'units/projectiles/火法师_火船/火法师_火船';
        }
        out.push(row);
    }
    return out;
});

// ────────────────────────────── 2. pvpSkillPlan
patchBoth('pvpSkillPlan', (rows) => {
    const out = [];
    for (const row of rows) {
        if (String(row.unitId) !== UNIT) { out.push(row); continue; }
        const chain = Number(row.skillChainId);
        if (chain === 103403) continue;   // 帽子戏法整链下线
        if (chain === 103404) {
            const level = Number(row.skillLevel);
            const spec = BLINK_LV[level - 1];
            row.skillName = '移形换影';
            row.behaviorKey = 'blink_strike';
            row.stateMode = 'none';
            row.unlockHeroLevel = spec.unlockHeroLevel;
            row.modifierId = spec.modifierId;
            //  移形换影不带命中减益：原 103403 那三行挂着 stun_1 / stun_1_5 / stun_2s，
            //  而计划行是按 `unitId:pvpSkillId` 合参数的 —— 留着会让**每一次普攻**都带眩晕。
            delete row.statusId;
            row.skillParamJson = JSON.stringify(spec.params);
        }
        out.push(row);
    }

    //  鹿神守护：三行全新建。
    for (const spec of DEER_LV) {
        out.push({
            enabled: 1,
            modifierId: spec.modifierId,
            unitId: UNIT,
            skillChainId: 103405,
            skillName: '鹿神守护',
            skillLevel: spec.level,
            unlockHeroLevel: spec.unlockHeroLevel,
            skillKind: 'active_cd',
            passiveScope: 'battle',
            progressionMode: 'replace',
            pvpSkillId: ATTACK_SKILL,
            behaviorKey: 'skill_params',
            stateMode: 'none',
            sourceVersion: '2026-11-06',
            publishStatus: '1',
            skillParamJson: JSON.stringify({
                damageRate: Math.round(spec.total / DEER_UNIT_ATTACK * 10000) / 10000,
                ...DEER_SHARED,
            }),
        });
    }
    return out;
});

// ────────────────────────────── 3. armySkillLevelUp（成长链 / 升级消耗）
const DEER_DESC = [
    '累计8次普攻召唤小鹿：冲刺接触敌人造成600点伤害，每多命中一个目标伤害降低50%',
    '累计8次普攻召唤小鹿：冲刺接触敌人造成700点伤害，每多命中一个目标伤害降低50%',
    '累计8次普攻召唤小鹿：冲刺接触敌人造成800点伤害，每多命中一个目标伤害降低50%',
];
const BLINK_DESC = [
    '向最近敌人闪现并造成120%伤害',
    '闪现到最近敌人身前再回到原位，往返各造成100%伤害，并在原地留下一个爆炸的分身，造成60%范围伤害',
    '往返各造成140%伤害；并在原位留下分身持续2秒，结束时分身爆炸造成100%范围伤害',
];

patchBoth('armySkillLevelUp', (rows) => {
    const out = [];
    let template = null;
    for (const row of rows) {
        const chain = Number(row.id);
        if (chain === 103403) continue;   // 帽子戏法整链下线
        if (chain === 103404) {
            template = template ?? clone(row);
            row.name = '移形换影';
            row.desc = BLINK_DESC[Number(row.skilllevel) - 1];
        }
        out.push(row);
    }
    if (!template) throw new Error('找不到 103404 的成长行，无法为新技能取模板');
    for (const spec of DEER_LV) {
        out.push({
            ...clone(template),
            id: 103405,
            name: '鹿神守护',
            desc: DEER_DESC[spec.level - 1],
            unlockarmylevel: spec.unlockHeroLevel,
            skilllevel: spec.level,
            costCoinNum: [1000, 3000, 6000][spec.level - 1],
            costArmySkillLevelNum: [3, 10, 20][spec.level - 1],
            modfiy: [spec.modifierId],
        });
    }
    return out;
});

// ────────────────────────────── 4. pvpCard.skillList
patchBoth('pvpCard', (rows) => rows.map((row) => {
    if (String(row.unitId) !== UNIT) return row;
    row.skillList = [103401, 103402, 103404, 103405];
    return row;
}));

console.log('\n[完成] 魔术师技能链已按设计案重排：103401 / 103402 / 103404 移形换影 / 103405 鹿神守护');
