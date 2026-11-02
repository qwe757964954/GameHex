// 运动霸（68033）的普攻按设计案第 162 行「203301 拳击冲撞」补齐三项（2026-10-31）。
//
// 设计案原文：
//   「挥拳冲撞当前目标，近战判定，命中结算 1 次伤害，距离敌人 120px 时开始冲刺，
//     冲刺阶段的移动速度 *4」
//   「【P1 沿用】消灭学霸_普攻(15帧) 拳套冲击；命中 受击(坦克) + 气浪，开始冲刺时播放循环的攻击动作」
//
// 改动只有三个字段，pvpSkill 30713「运动霸普攻」这一行：
//   chargeDistance         120                         距敌 120px（与 attackRange 同一套数）开始冲刺
//   chargeSpeedScale       4                           冲刺期移速 ×4
//   impactEffectPrefabPath units/projectiles/重骑兵_践踏/重骑兵_践踏
//                                                      命中「气浪」。项目里没有名为「气浪」的美术资源，
//                                                      按【表现资源映射】P6「地面·冲击环」复用践踏的环形冲击。
//
// 不动的东西：effectPrefabPath 仍是 `消灭学霸_普攻`（设计案写「P1 沿用」）、
// mode 仍是 melee、cooldown=14 / empoweredSkillId=30853 / secondarySkillId=30852 全部原样，
// 也不动任何数值（攻击 120 / 移速 25 / 射程 45 / 间隔 1.8）。
const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_ID = 30713;
const CHARGE_DISTANCE = 120;
const CHARGE_SPEED_SCALE = 4;
const IMPACT_FX = 'units/projectiles/重骑兵_践踏/重骑兵_践踏';

const TABLES = [
    'assets/remoteRef/pvpSkill.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
];
// 新增的列：按这个顺序追加到列存 k 尾部（行存不关心顺序，但会一起写 null 保持两边同形）。
const NEW_KEYS = ['chargeDistance', 'chargeSpeedScale', 'impactEffectPrefabPath'];

// 气浪预制必须真的在包里 —— 配了不存在的路径，运行时是「特效不出现，一条错都不报」。
if (!fs.existsSync(`assets/bundles/battle/${IMPACT_FX}.prefab`)) {
    throw new Error(`气浪预制不存在：assets/bundles/battle/${IMPACT_FX}.prefab`);
}

for (const path of TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row) throw new Error(`${path} 里找不到技能 ${SKILL_ID}`);

    // 守卫 1：必须是近战。冲刺 + 气浪这套只对「走到脸上挥拳」有意义，
    // 万一行号漂到远程行上，写进去就是「法师一边后撤一边冲锋」这种怪象。
    if (row.mode !== 'melee') throw new Error(`${SKILL_ID} 不是 melee：${row.mode}`);
    // 守卫 2：特效必须是拳套冲击（设计案写的 P1 沿用）。换成别的说明这行被别的卡借走了。
    if (!String(row.effectPrefabPath || '').includes('消灭学霸_普攻')) {
        throw new Error(`${SKILL_ID} 的出手特效不是 消灭学霸_普攻：${row.effectPrefabPath}`);
    }

    // 先把三列按 null 补齐（列存进 k、行存进每一行），再拍非目标行快照 ——
    // 顺序反了会把「补空列」本身算成改动，守卫就会误报。
    if (table.mode === 'packed') {
        for (const key of NEW_KEYS) if (!table.keys.includes(key)) table.keys.push(key);
    }
    // 行存也要把三列补成 null（不是省略），这样 remoteRef 与转表产物在
    // `tests/zcds-model.test.ts` 的逐格互校里是同一形状 —— 那边虽然做了 `?? null` 归一，
    // 但保持同形能少一次「为什么两份 json 长得不一样」的排查。
    for (const item of table.rows) {
        if (Number(item.skillId) !== SKILL_ID) {
            for (const key of NEW_KEYS) if (!(key in item)) item[key] = null;
        }
    }

    // 非目标行快照：写完逐字比对，确保只动了这一行。
    const before = JSON.stringify(table.rows.filter((item) => Number(item.skillId) !== SKILL_ID));

    const changed = row.chargeDistance !== CHARGE_DISTANCE
        || row.chargeSpeedScale !== CHARGE_SPEED_SCALE
        || row.impactEffectPrefabPath !== IMPACT_FX;
    row.chargeDistance = CHARGE_DISTANCE;
    row.chargeSpeedScale = CHARGE_SPEED_SCALE;
    row.impactEffectPrefabPath = IMPACT_FX;

    if (JSON.stringify(table.rows.filter((item) => Number(item.skillId) !== SKILL_ID)) !== before) {
        throw new Error(`${path}：除 ${SKILL_ID} 之外还有行被改动了，中止`);
    }

    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）${changed ? '已写入' : '已是目标值（幂等）'}：`
        + `chargeDistance=${CHARGE_DISTANCE} chargeSpeedScale=${CHARGE_SPEED_SCALE} impact=${IMPACT_FX}`);
}

// 回读自检：两份文件三个字段都得在。
for (const path of TABLES) {
    const row = readTable(path).rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row || row.chargeDistance !== CHARGE_DISTANCE
        || row.chargeSpeedScale !== CHARGE_SPEED_SCALE
        || row.impactEffectPrefabPath !== IMPACT_FX) {
        throw new Error(`${path} 回读不一致：${JSON.stringify(row)}`);
    }
}
console.log('[ok] 回读一致');
