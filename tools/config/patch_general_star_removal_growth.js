// ⚠️ 2026-11-10 已失效，不要再跑。成长表改由 `patch_growth_from_card_level_up.js`
//    按 `cardLevelUp` 全量重算 1~50 级，品质补偿 45/55/65/75 被那条曲线吸收（用户口径：
//    「全量重算·去掉补偿」）。本脚本的守卫（要求 26~50 级不存在）会直接报错，属预期。
//
// 2026-11-10 摘掉星级表后，把老卡少掉的那部分固定攻击补回 `pvpUnitGrowth`（只写两份 json，
// 源表由同名 `_excel.py` 改）。
//
// 背景
// ────
// 上游口径「星级表弃用、技能数值只用修改器表」，`ZCClientCombatConfig.compileOwnerLoadouts`
// 已经不再传 `generalStar`。但原来那里传的是 `{ star: 1 }`，而**1 星本身是有数值的**：
// 14 张老卡（68001~68014）的 1 星 `modify` 都是
//   [13xx001「征召 N 个兵」, 3680xxxx「XX 武将技能等级 1」]
// 前者就是一条**固定攻击加成**（征召出来的兵进队伍属性），摘掉星级后这条一并消失。
//
// 实测 1 星给出的攻击增量（探针 `tmp/_probe_star_delta.ts`，摘星级前后对比）：
//   68001 r1 +8     68002 r1 +50    68003 r2 +90.4   68004 r2 +80
//   68005 r3 +80    68006 r3 +80    68007 r4 +50     68008 r4 +50
//   68009 r4 +80    68010 r4 +80    68011 r1 +50     68012 r1 +50
//   68013 r3 +50    68014 r3 +30
// 这串数与品质**不成体系**：品质 1 的 68011 拿 50，品质 4 的 68007 也只拿 50；品质 1 的
// 68001 却只有 8。所以不能逐卡照抄，要按品质重定一条单调的档位。
//
// 新口径（本脚本写入 `attackFlat`，即「固定攻击，在比例加成前叠加」）
// ──────────────────────────────────────────────────────────
//   品质 1 → 45 / 品质 2 → 55 / 品质 3 → 65 / 品质 4 → 75
// 选这条的理由：
//   · 单调递增，符合「品质越高给得越多」；
//   · 整体量级落在旧增量的中位数（≈55）附近，PVP 的 TTK 不会被整体推翻；
//   · 全部落在旧增量实际出现过的区间 [8, 90.4] 之内，不引入新的极端值。
// 唯一明显偏离旧手感的是 68001（基础攻击 12，旧增量只有 8，新档 +45 相当于放大约 4 倍），
// 它是旧口径里唯一的异常点 —— 同为「征召 3 个兵」的 68002 拿 50，68001 却只拿 8。
//
// 等级覆盖
// ────────
// 动手前只有 68001 有 1~4 级、68025 有 1~25 级，其余 13 张老卡**一行都没有**
// （`growthSelectionOf` 查不到行就退化成「不传 level」，成长整块被跳过 →
//  `attackFlat` 写得再对也不会生效）。所以这里把 14 张老卡的 1~25 级补齐：
//   · 已存在的行：只改 `attackFlat`，比例列原样保留；
//   · 新补的行：`attackFlat` 同上，比例列**沿用该卡最后一级的值**（没有就 0）。
//     这条「沿用最后一级」是为了让 68001 的 0.05×(L-1) 曲线不在 5 级出现断崖
//     （L4 = 0.15 ，L5 若写 0 就等于升一级倒扣 15%），其它 13 张没有历史曲线，自然是 0。
//     之所以不给所有人套设计案的「每级 8%」：那会让老卡在高等级凭空长出一大截百分比成长，
//     而新卡（68015~68035）连成长行都没有，等于又是一轮不对等加强。
//
// 保持「旧卡全等级都有这条固定攻击」这一点很重要：星级 1 原本是**每个等级都生效**的，
// 补偿也必须每个等级都在，否则等于把 5 级以上的卡偷偷砍了一刀。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'assets/remoteRef/pvpUnitGrowth.json',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpUnitGrowth.json',
];

const MAX_LEVEL = 25;

/** 品质 → 固定攻击档位。品质取自 `pvpCard.rarity`。 */
const FLAT_BY_QUALITY = { 1: 45, 2: 55, 3: 65, 4: 75 };

/** 老卡清单：unitId + 实际品质（对齐 `pvpCard.rarity`）。 */
const OLD_CARDS = [
    { unitId: '68001', name: '豌豆游侠', quality: 1 },
    { unitId: '68002', name: '巨力坚果', quality: 1 },
    { unitId: '68003', name: '火焰树妖', quality: 2 },
    { unitId: '68004', name: '玉林好汉', quality: 2 },
    { unitId: '68005', name: '椰蛋战士', quality: 3 },
    { unitId: '68006', name: '波利奥', quality: 3 },
    { unitId: '68007', name: '吞噬大嘴花', quality: 4 },
    { unitId: '68008', name: '杰克藕', quality: 4 },
    { unitId: '68009', name: '仙桃行者', quality: 4 },
    { unitId: '68010', name: '镭射飞龙', quality: 4 },
    { unitId: '68011', name: '水手菇', quality: 1 },
    { unitId: '68012', name: '菇八戒', quality: 1 },
    { unitId: '68013', name: '玛法', quality: 3 },
    { unitId: '68014', name: '分裂菇', quality: 3 },
];

function plan(table) {
    const report = [];
    for (const card of OLD_CARDS) {
        const flat = FLAT_BY_QUALITY[card.quality];
        if (flat === undefined) throw new Error(`[fail] ${card.unitId} 品质 ${card.quality} 没有档位`);

        const own = table.rows
            .filter((row) => String(row.unitId) === card.unitId)
            .sort((a, b) => Number(a.level) - Number(b.level));
        const byLevel = new Map(own.map((row) => [Number(row.level), row]));
        const last = own.length ? own[own.length - 1] : null;
        //  比例列的锚点：已有行取最后一级；没有历史行就是 0。
        const holdRate = last ? Number(last.attackRate) || 0 : 0;
        const holdHpRate = last ? Number(last.maxHpRate) || 0 : 0;

        let changed = 0;
        let added = 0;
        for (let level = 1; level <= MAX_LEVEL; level += 1) {
            const row = byLevel.get(level);
            if (row) {
                if (Number(row.attackFlat) !== flat) {
                    row.attackFlat = flat;
                    changed += 1;
                }
                continue;
            }
            table.rows.push({
                unitId: card.unitId,
                level,
                attackFlat: flat,
                attackRate: holdRate,
                maxHpFlat: 0,
                maxHpRate: holdHpRate,
                moveSpeedRate: 0,
                attackRangeFlat: 0,
                enabled: 1,
            });
            added += 1;
        }
        report.push({ ...card, flat, holdRate, changed, added });
    }
    //  行顺序按 unitId 排序、同卡按 level 升序，让两份 json 的 diff 读起来一致。
    table.rows.sort((a, b) => {
        const byUnit = String(a.unitId).localeCompare(String(b.unitId));
        return byUnit !== 0 ? byUnit : Number(a.level) - Number(b.level);
    });
    return report;
}

for (const path of TABLES) {
    const table = readTable(path);
    const before = table.rows.length;
    const report = plan(table);
    writeTable(path, table);

    const readBack = readTable(path);
    for (const item of report) {
        const rows = readBack.rows.filter((row) => String(row.unitId) === item.unitId);
        if (rows.length !== MAX_LEVEL) {
            throw new Error(`[fail] ${path} 回读 ${item.unitId} 只有 ${rows.length} 行，预期 ${MAX_LEVEL}`);
        }
        const bad = rows.filter((row) => Number(row.attackFlat) !== item.flat);
        if (bad.length) {
            throw new Error(`[fail] ${path} 回读 ${item.unitId} 有 ${bad.length} 行 attackFlat 不是 ${item.flat}`);
        }
    }
    console.log(`[pvpUnitGrowth] ${path}`);
    console.log(`  行数 ${before} → ${readBack.rows.length}`);
    for (const item of report) {
        console.log(
            `  ${item.unitId} ${item.name} 品质${item.quality} → attackFlat ${item.flat}`
            + `（改 ${item.changed} 行 / 补 ${item.added} 行 / 比例列锚点 ${item.holdRate}）`,
        );
    }
}
