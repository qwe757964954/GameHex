// 运动霸（30713）的冲刺从「移速倍率」改成「真·撞击」之后，把 `chargeDistance` 120 → 220
// （2026-11-02）。
//
// 为什么这个值要变：
//   改之前它是「距敌多近开始加速」，改之后它是**冲锋的起手距离** —— 起冲后一路直线跑到
//   终点快照，撞到才结算伤害。所以它直接决定「冲锋看起来有多长」：
//     220 × combatDistanceScale(0.3) = 66 世界单位起点
//     近战 reach = (45 + 6) × 0.3 ≈ 15.3 世界单位终点
//     冲刺速度 = moveSpeed 25 × chargeSpeedScale 4 = 100 世界单位/秒
//     ⇒ 冲锋段约 (66 − 15.3) / 100 ≈ 0.51s ≈ 15 帧（30fps）才读得出「先蓄力、再撞上」。
//
// 三处同值（表源 + 导出产物 + 运行时打包态），少写一处下次重导就会被冲回 120：
//   ① doc/塔防数据配置/PVP-技能.xlsx（S 列）
//   ② doc/塔防数据配置/json/client/pvpSkill.json（转表产物，紧凑行数组）
//   ③ assets/remoteRef/pvpSkill.json（运行时，列存 {k,v,c}）
// ②③ 走 `ref_table_io.js`，不要用 JSON.stringify 直接覆写 —— 两套磁盘格式的空白/换行
// 是既定的（行存压成一行、列存按 \r\n 竖排），随手重排会把整张表变成 diff 炸弹。
const fs = require('fs');
const { readTable, writeTable } = require('./ref_table_io.js');

const SKILL_ID = 30713;
const FIELD = 'chargeDistance';
const OLD = 120;
const NEW = 220;

const TABLES = [
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
    'assets/remoteRef/pvpSkill.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row) throw new Error(`${path} 里找不到技能 ${SKILL_ID}`);
    // 守卫：只认「还没改过」或「已经是新值」，别的值说明这行被别人动过。
    if (row[FIELD] !== OLD && row[FIELD] !== NEW) {
        throw new Error(`${path}：${FIELD} 既不是 ${OLD} 也不是 ${NEW}：${row[FIELD]}`);
    }
    if (row.mode !== 'melee') throw new Error(`${SKILL_ID} 不是 melee：${row.mode}`);

    const before = JSON.stringify(table.rows.filter((item) => Number(item.skillId) !== SKILL_ID));
    const changed = row[FIELD] !== NEW;
    row[FIELD] = NEW;

    if (JSON.stringify(table.rows.filter((item) => Number(item.skillId) !== SKILL_ID)) !== before) {
        throw new Error(`${path}：除 ${SKILL_ID} 之外还有行被改动了，中止`);
    }
    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）${changed ? `已写入 ${OLD} → ${NEW}` : '已是目标值（幂等）'}`);
}

for (const path of TABLES) {
    const row = readTable(path).rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row || row[FIELD] !== NEW) throw new Error(`${path} 回读不一致：${row && row[FIELD]}`);
}
console.log(`[ok] 两份 json 的 ${FIELD} 已对齐 ${NEW}`);
