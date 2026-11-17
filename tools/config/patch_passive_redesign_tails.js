// 被动重设计 V5 · 尾巴归位：把「旧子链」改写成设计案里的真实混搭尾。
//
// 背景
// ────
// 一个技能在 `pvpSkillPlan` 里只是**一个 statId 槽**，多属性靠两类载体：
//
//   1. 子链行：`19xxxx / 28xxxx / 37xxxx …`，与主链同 `pvpSkillId`、`modifierId` 独立。
//      🔴 它们被 `armySkillLevelUp.modfiy`（如 101002 → [94010021, 94910021]）与
//      `cardLevelUp.skillList` 引用，**不能删行**，只能改写；
//   2. `skillParamJson` 里的 `mix.<statId>[.addRate]`（新增，见 `ZCStatSchema.readZCSkillMixStats`）。
//
// 第二批把「爆囊扩散 / 裂变爆炸 / 共生信号」改成新设计时，只在主链写了新的 `mix.*`，
// 旧的子链还挂着上一版的属性（101002 的 191002 仍是攻速 14/20/26%），于是
// `statPatch.attackSpeedPct` 被 101001 + 191002 叠加成 52%。本脚本按「设计案 L1 的尾巴」
// 重写这些子链：**槽位能对上的属性就留在行里**（保住 modifierId 与引用），槽位不够的落进 `mix.*`。
//
// 分配规则（确定性，便于 review）
// ────────────────────────────
//   · 先按「原子链 statId 恰好就是某条尾巴」认领（101002 的 281002 本就 attackRange ⇒ 继续 attackRange）；
//   · 剩下的尾巴按顺序填进剩下的槽位；
//   · 还有剩余 ⇒ 写进主链 `skillParamJson` 的 `mix.<statId>.addRate`。
//
// 幂等：每次都按设计尾巴重建一遍，重复跑结果逐字相同。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261116';

/** 尾巴数值一律取设计案 L1（三档不变）。顺序 = 认领时的优先级。 */
const SKILLS = [
    { chain: 100802, name: '爆囊扩散', tails: [['attack', 0.16], ['damageRate', 0.13], ['attackRange', 0.23]] },
    { chain: 101501, name: '爆囊扩散', tails: [['attack', 0.09], ['attackSpeed', 0.09]] },
    { chain: 100902, name: '爆囊扩散', tails: [['attack', 0.16], ['damageRate', 0.13], ['attackSpeed', 0.17]] },
    { chain: 103202, name: '爆囊扩散', tails: [['attack', 0.16], ['damageRate', 0.13], ['attackRange', 0.23]] },
    { chain: 101002, name: '裂变爆炸', tails: [['attack', 0.16], ['damageRate', 0.13], ['attackRange', 0.23]] },
    { chain: 102602, name: '裂变爆炸', tails: [['attack', 0.16], ['damageRate', 0.13], ['attackRange', 0.23]] },
    //  第三批（裂变暴击）。两条都**没有**子链槽位 —— 子链按「技能链尾 4 位」归属（193302 → 103302
    //  破阵投枪，不是 103301 裂变暴击），所以尾巴全走 `mix.*`。
    { chain: 102502, name: '裂变暴击', tails: [['attack', 0.35], ['damageRate', 0.29], ['attackSpeed', 0.35]] },
    { chain: 103301, name: '裂变暴击', tails: [['attack', 0.35], ['attackSpeed', 0.35]] },
    //  第四批（克制条 20 条里带混搭尾的 7 条）。除 102302 有一个子链槽位（192302，原暴击率 20%
    //  —— 顺手把超上限的那格改掉）之外，其余都直接进 `mix.*`。
    { chain: 100503, name: '异种猎杀协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['attackSpeed', 0.07]] },
    { chain: 101302, name: '职业猎杀协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['attackRange', 0.10]] },
    { chain: 101402, name: '异种猎杀协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['attackSpeed', 0.07]] },
    { chain: 102001, name: '异种猎杀协议', tails: [['attack', 0.09]] },
    { chain: 102202, name: '职业猎杀协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['attackRange', 0.10]] },
    { chain: 102302, name: '职业抗性协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['maxHp', 0.07]] },
    { chain: 103102, name: '抗性装甲协议', tails: [['attack', 0.07], ['damageRate', 0.06], ['maxHp', 0.07]] },
];

const TAIL_TEXT = {
    attack: '攻击提高', damageRate: '伤害提高', attackSpeed: '攻击速度提高', attackRange: '攻击范围提高', maxHp: '最大生命提高',
};

/** 混搭尾能用的 statId —— 也是本脚本在 `mix.*` 里唯一拥有的一组键。 */
const TAIL_STATS = new Set(Object.keys(TAIL_TEXT));

const parentOf = (chainId) => (chainId < 190000 ? chainId : 100000 + (chainId % 10000));

function tailText(tails) {
    return tails.map(([stat, value]) => `${TAIL_TEXT[stat] ?? stat}${Math.round(value * 100)}%`).join('，');
}

function subSlotsOf(rows, chain) {
    const chains = new Set();
    for (const row of rows) {
        const chainId = Number(row.skillChainId);
        if (chainId >= 190000 && parentOf(chainId) === chain) chains.add(chainId);
    }
    return [...chains].sort((a, b) => a - b);
}

function applyPlan(rows) {
    let written = 0;
    for (const spec of SKILLS) {
        const mains = rows.filter((row) => Number(row.skillChainId) === spec.chain);
        if (mains.length !== 3) throw new Error(`pvpSkillPlan 的 ${spec.chain} 应有 3 档，实得 ${mains.length}`);
        const slots = subSlotsOf(rows, spec.chain);

        //  按「原子链 statId 命中尾巴」认领，剩下的按顺序填；没有槽位的链（102502）全走 mix。
        const remaining = spec.tails.slice();
        const assignment = new Map();
        for (const slot of slots) {
            const sample = rows.find((row) => Number(row.skillChainId) === slot && Number(row.skillLevel) === 1);
            const index = remaining.findIndex(([stat]) => stat === sample.statId);
            if (index >= 0) {
                assignment.set(slot, remaining[index]);
                remaining.splice(index, 1);
            }
        }
        for (const slot of slots) {
            if (assignment.has(slot)) continue;
            if (!remaining.length) throw new Error(`${spec.chain} 的槽位 ${slot} 没有尾巴可填`);
            assignment.set(slot, remaining.shift());
        }

        for (const slot of slots) {
            const [stat, value] = assignment.get(slot);
            for (const level of [1, 2, 3]) {
                const hit = rows.find((row) => Number(row.skillChainId) === slot && Number(row.skillLevel) === level);
                if (!hit) throw new Error(`子链 ${slot} 缺 L${level}`);
                Object.assign(hit, {
                    statId: stat, operation: 'addRate', value,
                    skillName: spec.name, progressionMode: 'replace',
                    skillKind: 'passive_stat', passiveScope: 'deployed',
                    sourceVersion: VERSION, publishStatus: '可发布',
                    desc: tailText(spec.tails),
                });
                written += 1;
            }
            console.log(`  ${spec.chain} 槽位 ${slot} → ${stat} ${Math.round(value * 100)}%`);
        }

        //  剩下的尾巴进主链参数。🔴 只清「本脚本拥有的那几个 statId」的 `mix.*`：
        //  克制条那批的主链还挂着 `mix.critRate` / `mix.counterRole2`（batch4 写的），
        //  整块清掉会把暴击率和第二条克制判据一起抹掉，且与 batch4 的先后顺序有关。
        for (const main of mains) {
            const params = main.skillParamJson ? JSON.parse(main.skillParamJson) : {};
            for (const key of Object.keys(params)) {
                if (!key.startsWith('mix.')) continue;
                if (TAIL_STATS.has(key.slice(4).split('.')[0])) delete params[key];
            }
            for (const [stat, value] of remaining) params[`mix.${stat}.addRate`] = value;
            main.skillParamJson = JSON.stringify(params);
            written += 1;
        }
        if (remaining.length) {
            console.log(`  ${spec.chain} 余下尾巴 → mix: ${remaining.map(([s, v]) => `${s}=${v}`).join(', ')}`);
        }
    }
    return written;
}

function main() {
    const remotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const clientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(remotePath);
    const client = readTable(clientPath);
    const written = applyPlan(remote.rows);
    applyPlan(client.rows);
    writeTable(remotePath, remote);
    writeTable(clientPath, client);
    console.log(`[ok] 尾巴归位：pvpSkillPlan ${written} 行 ×2（remoteRef + client）`);
}

main();
