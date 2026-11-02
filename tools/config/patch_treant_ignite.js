// 火焰树妖「点燃」三档状态：每 0.5 秒结算一次施法者攻击力百分比，持续 3 秒（6 跳）。
//
// 结构照抄已启用的 `frostbite`（唯一一条 enabled=1 的 periodic_damage），差别只在：
//   · basis 用 senderAttack —— 设计要的是「攻击力百分比」，不是目标最大生命；
//   · intervalSeconds 0.5（frostbite 是 1）；
//   · maxStacks 1 + refresh —— 重复命中只续时长，不叠层。
// 现有 burn / legacy_burn_* 全是 enabled=0 且 periodic 三件套为空，属占位行，不能复用。
const { readTable, writeTable } = require('./ref_table_io.js');

const ROWS = [
    { tier: 1, pct: 10, name: '点燃I' },
    { tier: 2, pct: 15, name: '点燃II' },
    { tier: 3, pct: 20, name: '点燃III' },
].map(({ tier, pct, name }) => ({
    legacyBuffKey: `火焰树妖点燃${tier}`,
    statusId: `burn_ignite_l${tier}`,
    name,
    durationSeconds: 3,
    intervalSeconds: 0.5,
    maxStacks: 1,
    refreshPolicy: 'refresh',
    handlerKey: 'periodic_damage',
    statJson: '{}',
    enabled: 1,
    control: null,
    periodicAmountPct: pct,
    periodicBasis: 'senderAttack',
    periodicCapMultiplier: null,
}));

const TABLES = [
    'assets/remoteRef/pvpStatus.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpStatus.json',
];

for (const path of TABLES) {
    const table = readTable(path);
    for (const row of ROWS) {
        const existing = table.rows.find((item) => item.statusId === row.statusId);
        if (existing) {
            Object.assign(existing, row);
            console.log(`[更新] ${path} ${row.statusId}`);
        } else {
            table.rows.push({ ...row });
            console.log(`[新增] ${path} ${row.statusId}（${row.periodicAmountPct}%/跳 × ${row.durationSeconds / row.intervalSeconds} 跳）`);
        }
    }
    writeTable(path, table);
    console.log(`[ok]   ${path} (${table.mode}) 共 ${table.rows.length} 行`);
}
