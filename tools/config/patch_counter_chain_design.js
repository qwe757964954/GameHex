// 克制链条统一到设计案（2026-11-17 用户裁定）。
//
// 设计案原文在 `技能设计案2.xlsx / 技能设计案 (2)` 的 102001「异种猎杀协议」机制列：
//   「克制谱系（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师）」
// 即 **A→B 读作「A 克 B」**。把这个环从坦克起写就是 `坦克→射手→战士→法师→坦克`，
// 也就是用户口述的「射手--坦克--法师--战士--射手」（口述时按「被克者--克制者」念的）。
//
// 与 `pvpCounter` 原表的差异只在职业 4 条中的 3 条：
//
//   | 原型 | 设计案 |
//   | --- | --- |
//   | 坦克 → 战士 | 坦克 → **射手** |
//   | 战士 → 射手 | 战士 → **法师** |
//   | 射手 → 法师 | 射手 → **战士** |
//   | 法师 → 坦克 | 法师 → 坦克（不变） |
//
// 阵营 4 条本来就与设计案一致，不动。
//
// 🔴 为什么必须统一：克制条（`counter*` / `countered*` 那 20 条）落地时是按设计案**逐行字面**
// 取判据的，而全局规则 `pvpCounter` 是另一套（旧链）。两套链条不一致时，同一张射手卡
// 「打战士有克制条加成、打战士却没有全局克制」，玩家看到的克制关系自相矛盾。
// 统一后两套同源，结算处自然相乘（全局 ×1.3 × 技能级克制条），见
// `ZCAttackResolutionSystem.counterMultiplierFor`。
//
// 幂等：每次都按链条重建 8 行，重复跑结果逐字相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');

/**
 * 🔴 这两个数组是**克制环的遍历顺序**，不是 `ZC_CAMP_TRAITS` / `ZC_ATTACK_TRAITS` 的顺序。
 * 后者是「克制条 statId 的下标口径」（射手 1 / 战士 2 / 法师 3 / 坦克 4），两者用途不同，
 * 别为了「看起来一致」去调换 —— 换了下标就全错。
 */
const CAMP_CHAIN = ['花果', '蘑菇', '盆栽', '僵尸'];   // 花果→蘑菇→盆栽→僵尸→花果
const ROLE_CHAIN = ['坦克', '射手', '战士', '法师'];   // 坦克→射手→战士→法师→坦克

const DAMAGE_MULTIPLIER = 1.3;

function rowsOf(dimension, chain) {
    return chain.map((attacker, index) => ({
        dimension,
        attacker,
        defender: chain[(index + 1) % chain.length],
        damageMultiplier: DAMAGE_MULTIPLIER,
    }));
}

const EXPECTED = [...rowsOf('攻击', ROLE_CHAIN), ...rowsOf('阵营', CAMP_CHAIN)];

function keyOf(row) {
    return `${row.dimension}|${row.attacker}`;
}

function apply(table) {
    //  守卫：8 条「维度 + 攻击方标签」必须一一对上（defender 正是要改的那一列，不参与比对）。
    //  多一条少一条都说明表被别处动过，先停下来看清再改。
    const byKey = new Map();
    for (const row of table.rows) {
        if (byKey.has(keyOf(row))) throw new Error(`pvpCounter 出现重复行：${keyOf(row)}`);
        byKey.set(keyOf(row), row);
    }
    if (byKey.size !== EXPECTED.length) {
        throw new Error(`pvpCounter 行数变了：${byKey.size}（期望 ${EXPECTED.length}）`);
    }
    const missing = EXPECTED.filter((item) => !byKey.has(keyOf(item))).map(keyOf);
    if (missing.length) throw new Error(`pvpCounter 缺少这些行：${JSON.stringify(missing)}`);

    let changed = 0;
    for (const target of EXPECTED) {
        const row = byKey.get(keyOf(target));
        if (row.defender !== target.defender) changed += 1;
        row.defender = target.defender;
        row.damageMultiplier = target.damageMultiplier;
    }
    return changed;
}

function verify(table, label) {
    for (const target of EXPECTED) {
        const row = table.rows.find((item) => keyOf(item) === keyOf(target));
        if (!row || row.defender !== target.defender
            || Number(row.damageMultiplier) !== DAMAGE_MULTIPLIER) {
            throw new Error(`${label} 回读不一致：${JSON.stringify(row)}`);
        }
    }
}

function main() {
    for (const directory of [REMOTE, CLIENT]) {
        const file = path.join(directory, 'pvpCounter.json');
        const table = readTable(file);
        const changed = apply(table);
        writeTable(file, table);
        verify(readTable(file), path.basename(directory));
        console.log(`[ok] ${path.basename(directory)}/pvpCounter.json：8 条已对齐设计案链条（改 ${changed} 行）`);
    }
    console.log('  职业链：' + ROLE_CHAIN.map((a, i) => `${a}→${ROLE_CHAIN[(i + 1) % ROLE_CHAIN.length]}`).join('、'));
    console.log('  阵营链：' + CAMP_CHAIN.map((a, i) => `${a}→${CAMP_CHAIN[(i + 1) % CAMP_CHAIN.length]}`).join('、'));
}

main();
