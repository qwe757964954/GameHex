// 按「真实攻击动画时长」重配 pvpCard 的动画时长与命中时点（2026-11-06）。
//
// 背景：卡表里 34 张卡一律是 `0.667 / 0.345`（占位值，命中帧 51.7%），而实际骨架/序列帧
// 的攻击动作大多在 0.8~1.9s —— 表现层是「状态机到点就切回 idle」，于是动作被砍掉后半段
// （用户反馈「部分角色攻击动作没播放完」）。
//
// 口径：
//   ① `unitAttackDuration` = 该单位 attack 动作的**实际总时长**（spine 取 attack 动画 duration，
//      序列帧取 `<名>-attack.anim` 的 `_duration`，见 tools/spine_dur2.py 的实测输出）；
//   ② `unitAttackHitTime` = 总时长 × 40%（用户口径「伤害帧取攻击动画总时长的 40% 位置」）；
//   ③ 攻击间隔 `unitAttackInterval` 不动 —— 那是平衡值，改它等于改 DPS。
//
// 两个刻意不动的例外：
//   · 68033 运动霸：冲刺就是它的普攻，节拍由 0.7s（冲锋 + 原地待机）决定，
//     攻击动作在冲刺期循环播放，不存在被砍断的问题，改时长反而会把冲锋节奏拉长；
//   · 68030 篮球天才：动作 1.933s 比间隔 1.8s 长，改完后实际出手间隔会被动作长度顶到 1.933s
//     （−7% 输出）。要完全对上 1.8s 只能把动作砍回 1.8s，与本次目标冲突，先按「动作播完整」优先。
//
// 三处同值（表源 + 导出产物 + 运行时打包态）：
//   ① doc/塔防数据配置/PVP-卡牌.xlsx（Z / AA 列，由 patch_attack_anim_excel.py 负责）
//   ② doc/塔防数据配置/json/client/pvpCard.json（转表产物，紧凑行数组）
//   ③ assets/remoteRef/pvpCard.json（运行时，列存 {k,v,c}）
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
    'assets/remoteRef/pvpCard.json',
];

// 卡 id → 实测 attack 动作总时长（秒）。来源：spine .skel 的 attack 动画 duration
// / `<单位>-attack.anim` 的 _duration，实测脚本 tools/spine_dur2.py。
const MEASURED = {
    68001: 0.7333333, // 豌豆射手(9帧+骨架) attack
    68002: 1.0, // 坚果
    68003: 1.3333333, // 火焰树妖
    68004: 1.5666667, // 玉林好汉
    68005: 1.3333333, // 椰蛋战士
    68006: 1.3333333, // 波利奥
    68007: 1.2333333, // 吞噬大嘴花
    68008: 1.3333333, // 杰克藕
    68009: 1.5, // 仙桃行者
    68010: 1.3333333, // 火龙果(镭射飞龙)
    68011: 1.0, // 冰法师-攻击anim
    68012: 1.0, // 猎头者
    68013: 1.0, // 玛法
    68014: 1.0, // 驭兽师
    68015: 1.0, // 阿尔萨斯
    68016: 1.0, // 萨满(萨尔)
    68017: 1.0, // 女猎手(毒箭蘑菇)
    68018: 1.75, // 九头蛇(诅咒蘑菇)
    68019: 0.6666667, // 窝瓜人
    68020: 1.1, // 三叶小丑
    68021: 0.8, // 仙人侍卫
    68022: 1.0, // 萨满(雷蕉)
    68023: 0.6666667, // 南瓜战神
    68024: 0.8666667, // 急冻瓜
    68025: 0.6, // 大威天芦
    68026: 0.6666667, // 麻辣铁锅
    68027: 0.5333333, // 爆锤莲王
    68028: 1.3, // 饥饿战士
    68029: 1.2333333, // 金发统领
    68030: 1.9333333, // 篮球天才（见文件头例外②）
    68031: 1.3, // 艺术家
    68032: 1.5, // 吉他手
    68034: 1.3333333, // 哈利波特(魔术师)
    68035: 1.1666667, // 科学家
};

const HIT_RATIO = 0.4;
const round = (value) => Math.round(value * 1000) / 1000;

const targets = new Map(Object.entries(MEASURED).map(([id, seconds]) => [Number(id), {
    duration: round(seconds),
    hitTime: round(seconds * HIT_RATIO),
}]));

for (const path of TABLES) {
    const table = readTable(path);
    const before = table.rows.map((row) => ({ ...row }));
    const hit = new Set();

    for (const row of table.rows) {
        const plan = targets.get(Number(row.id));
        if (!plan) continue;
        if (!('unitAttackDuration' in row)) throw new Error(`${path} 里没有 unitAttackDuration 列`);
        row.unitAttackDuration = plan.duration;
        row.unitAttackHitTime = plan.hitTime;
        hit.add(Number(row.id));
    }
    const missing = [...targets.keys()].filter((id) => !hit.has(id));
    if (missing.length) throw new Error(`${path} 里找不到卡牌：${missing.join(', ')}`);

    // 守卫：只有目标行的两列允许变，其余格逐字不动。
    table.rows.forEach((row, index) => {
        const old = before[index];
        for (const key of Object.keys(row)) {
            if (Number(row.id) === Number(old.id) && !targets.has(Number(row.id))
                && JSON.stringify(row[key]) !== JSON.stringify(old[key])) {
                throw new Error(`${path}：无关行 ${row.id} 的 ${key} 被改动了，中止`);
            }
            if (targets.has(Number(row.id)) && key !== 'unitAttackDuration' && key !== 'unitAttackHitTime'
                && JSON.stringify(row[key]) !== JSON.stringify(old[key])) {
                throw new Error(`${path}：目标行 ${row.id} 的 ${key} 不该变，中止`);
            }
        }
    });

    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）写入 ${targets.size} 张卡的动画时长 / 命中时点`);
}
