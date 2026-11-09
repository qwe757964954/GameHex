// 杰克藕（68008）普攻换成「带电箭」（2026-11-06）。
//
// 设计案 200801「射出 1 支箭矢」+【表现资源映射】第 45 行「弓兵_通用箭矢 + 雷法师_雷电 /
// 复用 / 静态箭矢叠电弧，做『带电箭』」。原来的 30717 直接挂 `弓兵_通用箭矢` —— 就是弓兵的
// 那支普通白箭，既没有「电」也没有本卡辨识度。
//
// 改两列：
//   · effectPrefabPath       → units/projectiles/杰克藕_普攻/杰克藕_普攻（箭身 + 电弧两层，
//                              预制由 tools/build_jiekeou_arrow_fx.py 生成）；
//   · impactEffectPrefabPath → units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中
//                              （带电箭命中时补一层电爆，与雷电系同一套命中美术）。
//
// 只改 30717 这一行；30843 疾风箭（强化那一击）保持 `弓兵_通用箭矢`——设计案 100803 明确写
// 「拉长 150% + 白色拖尾」，走的是另一套表现，不跟着换。
const { readTable, writeTable } = require('./ref_table_io.js');

const TABLES = [
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkill.json',
    'assets/remoteRef/pvpSkill.json',
];

const SKILL_ID = 30717;
const CHANGES = {
    effectPrefabPath: 'units/projectiles/杰克藕_普攻/杰克藕_普攻',
    impactEffectPrefabPath: 'units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中',
};

for (const path of TABLES) {
    const table = readTable(path);
    const row = table.rows.find((item) => Number(item.skillId) === SKILL_ID);
    if (!row) throw new Error(`${path} 里找不到技能 ${SKILL_ID}`);
    for (const [field, value] of Object.entries(CHANGES)) {
        // 转表产物是「稀疏行」：值为 null 的列整份不落盘，所以缺省即 null，直接补键。
        if (!(field in row) && table.mode !== 'rows') throw new Error(`${path} 里 ${SKILL_ID} 没有字段 ${field}`);
        row[field] = value;
    }
    writeTable(path, table);
    console.log(`[ok] ${path}（${table.mode}）30717 → ${CHANGES.effectPrefabPath}`);
}
