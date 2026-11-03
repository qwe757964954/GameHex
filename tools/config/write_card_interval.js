// 运动霸（卡 68033）的普攻间隔 1.8 → 0.7（2026-11-03）。
//
// 为什么是 `unitAttackInterval` 而不是新加一列「冲刺冷却」：
// 用户口径是「冲刺就是运动霸的普通攻击，每次普通攻击都有 0.7 秒冷却，冷却期间站在原地播待机」。
// 也就是说 0.7s 不是冲刺的附加惩罚，它**就是这张卡的攻速** —— 冲锋段（≈0.51s）是这一拳的动作，
// 撞上 / 冲空那一刻起算 0.7s 原地待机，然后下一次冲锋。放进 `unitAttackInterval` 的好处：
//   ① 表源只有一处，策划调攻速就改这一格，不会出现「攻速 1.8 而冲刺冷却 0.7」这种自相矛盾；
//   ② `ZCUnitSystem` 只维护 `nextAttackAt` 一套时钟，冲刺和普通近战共用；
//   ③ 快照 / 回放不用为冲刺单独加字段。
//
// 三处同值（表源 + 导出产物 + 运行时打包态），少写一处下次重导就被冲回 1.8：
//   ① doc/塔防数据配置/PVP-卡牌.xlsx（Y 列，由 set_yundongba_attack_interval.py 负责）
//   ② doc/塔防数据配置/json/client/pvpCard.json（转表产物，紧凑行数组）
//   ③ assets/remoteRef/pvpCard.json（运行时，列存 {k,v,c}）
// ②③ 必须走 `ref_table_io.js` —— 两套磁盘格式的空白/换行是既定的，
// 用 JSON.stringify 直接覆写会把整张卡表变成 diff 炸弹（上一轮踩过）。
const { readTable, writeTable } = require('./ref_table_io.js');

const CARD_ID = 68033;
const FIELD = 'unitAttackInterval';
const OLD = 1.8;
const NEW = 0.7;

const TABLES = [
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json',
    'assets/remoteRef/pvpCard.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.id) === CARD_ID);
    if (!row) throw new Error(`${path} 里找不到卡 ${CARD_ID}`);

    const current = row[FIELD] === undefined ? null : Number(row[FIELD]);
    // 守卫：只认「还没改过」或「已经是新值」。别的值说明这一格被别人动过，
    // 直接改会把对方的调整悄悄吃掉。
    if (current !== OLD && current !== NEW) {
        throw new Error(`${path}：卡 ${CARD_ID} 的 ${FIELD} 既不是 ${OLD} 也不是 ${NEW}：${row[FIELD]}`);
    }

    const before = JSON.stringify(table.rows.filter((item) => Number(item.id) !== CARD_ID));
    const changed = current !== NEW;
    row[FIELD] = NEW;

    // 守卫：只有目标行允许变，别的行哪怕一个空格都不能动。
    if (JSON.stringify(table.rows.filter((item) => Number(item.id) !== CARD_ID)) !== before) {
        throw new Error(`${path}：除 ${CARD_ID} 之外还有行被改动了，中止`);
    }
    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）${changed ? `已写入 ${OLD} → ${NEW}` : '已是目标值（幂等）'}`);
}

for (const path of TABLES) {
    const row = readTable(path).rows.find((item) => Number(item.id) === CARD_ID);
    if (!row || Number(row[FIELD]) !== NEW) throw new Error(`${path} 回读不一致：${row && row[FIELD]}`);
}
console.log(`[ok] 两份 json 的卡 ${CARD_ID}.${FIELD} 已对齐 ${NEW}`);
