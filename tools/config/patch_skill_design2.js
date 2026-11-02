// 一次性配置补丁：豌豆游侠（68001）与巨力坚果（68002）技能实装（2026-10-29）。
//
// 同时写两处：
//   · assets/remoteRef/*.json            —— 运行时真正加载的表（列存竖排）
//   · doc/塔防数据配置/json/client/*.json —— 转表产物（紧凑行数组），用例与后端用这份
// 两处必须逐格一致（tests/zcds-model.test.ts 的互校守卫）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const targets = process.argv.slice(2);
if (!targets.length) throw new Error('用法：node patch_skill_design2.js <目录> [目录...]');

const PARAM = 'skillParamJson';

function applySkill(tables) {
    const t = tables.pvpSkill;
    const byId = new Map(t.rows.map((row) => [String(row.skillId), row]));

    const pea = byId.get('30701');
    pea.cooldown = 15;              // 100104「豌豆机关枪」主动 CD 15s
    pea.empoweredSkillId = 30801;   // 强化那一击换成豌豆自己的机关枪弹，不再借弓兵武将技

    const add = (row) => {
        if (byId.has(String(row.skillId))) return;
        t.rows.push(row);
        byId.set(String(row.skillId), row);
    };
    // 豌豆机关枪的强化弹：沿用豌豆游侠普攻美术；0.8 是 I 级基准，逐级值由 skillParamJson.damageRate 覆盖。
    add({
        skillId: 30801, name: '豌豆机关枪', mode: 'projectile', projectileKey: '', projectileSpeed: 500,
        areaRadius: 0, empoweredEvery: 0, empoweredSkillId: 0,
        effectPrefabPath: 'units/projectiles/豌豆游侠_普攻/豌豆游侠_普攻',
        cooldown: 0, effectKey: '', trigger: null, damageRate: 0.8,
        durationSeconds: null, waves: null, slowRatio: null, onHitStatusId: null,
    });
    // 巨力坚果普攻：与长枪兵（30171）解耦 —— 那条行同时被 68025 伊利丹使用，改它会串味。
    add({
        skillId: 30802, name: '坚果重砸', mode: 'melee', projectileKey: '', projectileSpeed: 0,
        areaRadius: 0, empoweredEvery: 0, empoweredSkillId: 30803,
        effectPrefabPath: 'units/projectiles/普攻爆炸/普攻爆炸',
        cooldown: 12, effectKey: '', trigger: 'every_seconds', damageRate: null,
        durationSeconds: null, waves: null, slowRatio: null, onHitStatusId: null,
    });
    // 亡者护盾：强化那一击的形态（伤害走 100%，护盾由 selfShieldRatio 参数附加）。
    add({
        skillId: 30803, name: '亡者护盾', mode: 'melee', projectileKey: '', projectileSpeed: 0,
        areaRadius: 0, empoweredEvery: 0, empoweredSkillId: 0,
        effectPrefabPath: 'units/projectiles/普攻爆炸/普攻爆炸',
        cooldown: 0, effectKey: '', trigger: null, damageRate: 1,
        durationSeconds: null, waves: null, slowRatio: null, onHitStatusId: null,
    });
}

function applyStatus(tables) {
    const t = tables.pvpStatus;
    const byId = new Map(t.rows.map((row) => [String(row.statusId), row]));
    //  饥饿豌豆：口径统一到设计案 L1/L2/L3 的「移动速度」三档。
    for (const [id, seconds, pct] of [
        ['hunger_slow_l1', 2, -5], ['hunger_slow_l2', 3, -15], ['hunger_slow_l3', 3, -25],
    ]) {
        const row = byId.get(id);
        row.durationSeconds = seconds;
        row.statJson = JSON.stringify({ moveSpeedPct: pct });
    }
    //  藤盾：常驻、只吃远程伤害的减伤。
    for (const [id, label, pct] of [
        ['walnut_thorn_l1', '藤盾I', 10], ['walnut_thorn_l2', '藤盾II', 11], ['walnut_thorn_l3', '藤盾III', 12],
    ]) {
        if (byId.has(id)) continue;
        t.rows.push({
            legacyBuffKey: label, statusId: id, name: label, durationSeconds: 0, intervalSeconds: 0,
            maxStacks: 1, refreshPolicy: 'refresh', handlerKey: 'none',
            statJson: JSON.stringify({ damageTakenRangedPct: -pct }),
            enabled: 1, control: null, periodicAmountPct: null, periodicBasis: null, periodicCapMultiplier: null,
        });
    }
}

function applyCard(tables) {
    const nut = tables.pvpCard.rows.find((row) => String(row.unitId) === '68002');
    nut.unitSkillId = 30802;
}

function applyBinding(tables) {
    for (const row of tables.pvpSkillBinding.rows) {
        if (String(row.targetUnitId) === '68002' && String(row.pvpSkillId) === '30171') row.pvpSkillId = 30802;
    }
}

function applyPlan(tables) {
    const t = tables.pvpSkillPlan;
    if (t.keys && !t.keys.includes(PARAM)) t.keys.push(PARAM);

    const planRow = (overrides) => ({
        enabled: 1, modifierId: null, unitId: null, skillChainId: null, skillName: null, skillLevel: null,
        unlockHeroLevel: null, skillKind: null, passiveScope: 'deployed', progressionMode: 'replace',
        pvpSkillId: null, triggerEvent: null, stateMode: 'none', targetSelector: 'self',
        durationSeconds: 0, maxStacks: 1, cooldown: 0, maxTriggers: 0, desc: null,
        sourceVersion: '技能设计案2 v1.0', publishStatus: '可发布',
        statId: null, operation: null, value: null, behaviorKey: null, statusId: null, statusStatJson: null,
        [PARAM]: null,
        ...overrides,
    });

    //  5.1 豌豆游侠 100103 饥饿豌豆：三档移速，与 statusStatJson / pvpStatus 对齐。
    for (const [modifierId, unlock, seconds, pct, statusId, desc] of [
        [91001031, 9, 2, -5, 'hunger_slow_l1', '普攻命中使目标饥饿缠身：移动速度降低5%，持续2秒'],
        [91001032, 18, 3, -15, 'hunger_slow_l2', '移动速度降低15%，持续3秒'],
        [91001033, 24, 3, -25, 'hunger_slow_l3', '移动速度降低25%，持续3秒'],
    ]) {
        const row = t.rows.find((item) => item.modifierId === modifierId);
        row.unlockHeroLevel = unlock;
        row.durationSeconds = seconds;
        row.statusId = statusId;
        row.statusStatJson = JSON.stringify({ moveSpeedPct: pct });
        row.desc = desc;
        row[PARAM] = null;
    }

    //  5.2 豌豆游侠 100104 豌豆机关枪：启用，参数走 skillParamJson。
    for (const [modifierId, level, unlock, count, seconds, rate, desc] of [
        [91001041, 1, 12, 3, 1.2, 0.8, '1.2秒内连发3颗豌豆，每颗80%攻击力'],
        [91001042, 2, 20, 5, 1.2, 0.8, '1.2秒内连发5颗豌豆，每颗80%攻击力'],
        [91001043, 3, 25, 7, 1.5, 0.9, '1.5秒内连发7颗豌豆，每颗90%攻击力'],
    ]) {
        const row = t.rows.find((item) => item.modifierId === modifierId);
        Object.assign(row, {
            enabled: 1, skillName: '豌豆机关枪', skillLevel: level, unlockHeroLevel: unlock,
            skillKind: 'active_cd', passiveScope: 'battle', progressionMode: 'replace',
            triggerEvent: 'active', stateMode: 'none', targetSelector: 'self',
            durationSeconds: seconds, cooldown: 15, desc, publishStatus: '可发布',
            behaviorKey: 'skill_params',
        });
        row[PARAM] = JSON.stringify({ burstCount: count, burstSeconds: seconds, damageRate: rate });
    }

    //  5.3 巨力坚果：四条链全部新建（原表没有 68002 计划行）。
    const nut = [];
    for (const [level, unlock, statusId, pct] of [
        [1, 3, 'walnut_thorn_l1', 10], [2, 14, 'walnut_thorn_l2', 11], [3, 22, 'walnut_thorn_l3', 12],
    ]) {
        nut.push(planRow({
            modifierId: 91002010 + level, unitId: '68002', pvpSkillId: 30802, skillChainId: 100201, skillName: '藤盾',
            skillLevel: level, unlockHeroLevel: unlock, skillKind: 'passive_stat',
            triggerEvent: 'damage_taken', behaviorKey: 'passive_status', statusId,
            statusStatJson: JSON.stringify({ damageTakenRangedPct: -pct }),
            desc: `受到远程伤害降低${pct}%`,
        }));
    }
    for (const [level, unlock, rate] of [[1, 6, 0.10], [2, 16, 0.11], [3, 23, 0.12]]) {
        nut.push(planRow({
            modifierId: 91002020 + level, unitId: '68002', pvpSkillId: 30802, skillChainId: 100202, skillName: '坚骨',
            skillLevel: level, unlockHeroLevel: unlock, skillKind: 'passive_stat',
            triggerEvent: 'build', statId: 'maxHp', operation: 'addRate', value: rate,
            desc: `最大生命提高${Math.round(rate * 100)}%`,
        }));
    }
    for (const [level, unlock, reduce, seconds, retaliate] of [
        [1, 9, 20, 10, 0], [2, 18, 22, 11, 0], [3, 24, 25, 12, 10],
    ]) {
        const params = { lowHpThreshold: 0.6, lowHpReducePct: reduce, lowHpSeconds: seconds, lowHpCooldown: 20 };
        if (retaliate > 0) params.lowHpRetaliatePct = retaliate;
        nut.push(planRow({
            modifierId: 91002030 + level, unitId: '68002', pvpSkillId: 30802, skillChainId: 100203, skillName: '格挡',
            skillLevel: level, unlockHeroLevel: unlock, skillKind: 'event_passive',
            passiveScope: 'battle', triggerEvent: 'damage_taken', behaviorKey: 'skill_params',
            durationSeconds: seconds, cooldown: 20,
            desc: retaliate > 0
                ? `生命低于60%时获得${reduce}%减伤，持续${seconds}秒（内置冷却20秒），并使攻击者攻速降低${retaliate}%`
                : `生命低于60%时获得${reduce}%减伤，持续${seconds}秒（内置冷却20秒）`,
            [PARAM]: JSON.stringify(params),
        }));
    }
    for (const [level, unlock, seconds] of [[1, 12, 10], [2, 20, 11], [3, 25, 12]]) {
        nut.push(planRow({
            modifierId: 91002040 + level, unitId: '68002', pvpSkillId: 30802, skillChainId: 100204, skillName: '亡者护盾',
            skillLevel: level, unlockHeroLevel: unlock, skillKind: 'active_cd',
            passiveScope: 'battle', triggerEvent: 'active', behaviorKey: 'skill_params',
            durationSeconds: seconds, cooldown: 12,
            desc: `主动开启：获得等同于自身30%最大生命的护盾，持续${seconds}秒`,
            [PARAM]: JSON.stringify({ selfShieldRatio: 0.30, shieldSeconds: seconds }),
        }));
    }

    const existing = new Set(t.rows.map((row) => `${row.unitId}:${row.skillChainId}:${row.skillLevel}`));
    for (const row of nut) {
        const key = `${row.unitId}:${row.skillChainId}:${row.skillLevel}`;
        if (!existing.has(key)) t.rows.push(row);
    }
}

const FILES = ['pvpSkill', 'pvpStatus', 'pvpCard', 'pvpSkillBinding', 'pvpSkillPlan'];
const APPLY = {
    pvpSkill: applySkill, pvpStatus: applyStatus, pvpCard: applyCard,
    pvpSkillBinding: applyBinding, pvpSkillPlan: applyPlan,
};

for (const directory of targets) {
    const tables = {};
    for (const name of FILES) tables[name] = readTable(path.join(directory, `${name}.json`));
    for (const name of FILES) APPLY[name](tables);
    for (const name of FILES) writeTable(path.join(directory, `${name}.json`), tables[name]);
    console.log(`配置补丁已写入：${directory}`);
}
