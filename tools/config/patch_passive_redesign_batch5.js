// 被动重设计 V5 · 第五批：多弹 9 条（孢群弹幕 / 孢子弹幕 / 苔针双连 / 连发苔针）。
//
// 设计依据：`技能设计案2.xlsx / 技能设计案 (2)` 的 L1~L3 列 + P 列落地口径。
// 用户已裁定（研发档案 Q11 / Q12）：
//   · 逐档额外弹伤害没有消费点（`extraBulletDamage` 谁都不读），改用 `bulletFalloff`
//     0.4 / 0.35 / 0.3 逼近 —— 第 2 颗 = (1-falloff)，即 36% / 42% / 49%；
//   · 文案从「（第 1 发 60%，第 2 发 36%）」改成「（额外弹伤害约为第 1 发的 60%）」；
//   · 普攻裂弹的张角继续走 `bulletAngle`（unit 域），`projectileSpreadDeg` 只留给强化那一击
//     —— 普攻路径下 `spreadTable = (empowered ? … : 0) || patch.bulletAngleFlat`，
//     不强化时那个键**恒被当 0**，写了也等于没写。
//
// 🔴 两个载体不能写重（踩一次就是双倍）：
//   · `bulletNum` / `bulletAngle` 是 **statId**，所有行 fold 进同一个 `statPatch` ⇒ **相加**，
//     同一技能只能有一行写；
//   · `bulletFalloff` 是 **skillParamJson** 键，按 `unitId:pvpSkillId` **覆盖**合并
//     （`{...existing.parameters, ...params}`）⇒ 也只能有一行写，否则生效值取决于行序。
//   所以：子弹数与递减系数统一落**主链行**，尾巴落子链槽位（或 `mix.*`），子链的原
//   `bulletNum` / `bulletFalloff` 必须清掉。
//
// 幂等：全部按「链 + 档」定位改写，`mix.*` 整体重建为设计案口径（本批没有别的脚本写这 9 条的 mix）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261117';

/** 三档递减系数。文案百分比 = (1 - falloff) × 100 ⇒ 60 / 65 / 70。 */
const FALLOFF = [0.4, 0.35, 0.3];

/**
 * 每条技能：
 *   `kind`    —— `mage` 走「裂出 N 道」，`archer` 走「额外发射 N 发」；
 *   `bullets` —— `bulletNum` 三档（额外弹数，**不含**普攻本体）；
 *   `angle`   —— `bulletAngle` 总张角（度）；射手版设计案没给张角 ⇒ null（同一条直线连击）；
 *   `levels`  —— 三档解锁兵种等级（设计案每行 L1/L2/L3 括注）；
 *   `slots`   —— 子链槽位改写：`[子链, statId, operation, 三档值]`。子链行只能改写不能删；
 *   `mix`     —— 主链 statId 被 `bulletNum` 占走后，`bulletAngle` 与多余尾巴走这里。
 */
const SKILLS = [
    {
        //  金卡法师。设计案「裂出 2 道额外弹」，尾巴攻击 28% / 范围 35%。
        chain: 101001, card: '68010', name: '孢群弹幕', kind: 'mage',
        bullets: [2, 2, 2], angle: 25, levels: [0, 14, 22],
        slots: [
            [281001, 'attack', 'addRate', [0.28, 0.28, 0.28]],
            [371001, 'bulletAngle', 'add', [25, 25, 25]],
            [191001, 'attackRange', 'addRate', [0.35, 0.35, 0.35]],
        ],
    },
    {
        //  紫卡射手。L 列写「额外发射 1 发」⇒ `bulletNum=1`（研发档案 Q1 已按 L 列为准）。
        //  P 列笼统写的 `=2` 是金卡口径，这里不跟。
        chain: 101301, card: '68013', name: '连发苔针', kind: 'archer',
        bullets: [1, 1, 1], angle: null, levels: [0, 14, 22],
        slots: [],
    },
    {
        chain: 101701, card: '68017', name: '苔针双连', kind: 'archer',
        bullets: [2, 2, 2], angle: null, levels: [0, 14, 22],
        slots: [
            [281701, 'attack', 'addRate', [0.28, 0.28, 0.28]],
            [191701, 'attackRange', 'addRate', [0.35, 0.35, 0.35]],
        ],
    },
    {
        //  紫卡法师。L 列「裂出 1 道额外弹」⇒ `bulletNum=1`，总弹数 = 本体 + 1 = **2 颗**。
        //  🔴 2 颗**不能给张角**：扇形分布是 `spread = (index / (count - 1)) * 2 - 1`，
        //  count=2 时只有 −1 / +1 两个位置，**没有 0° 中心位** ⇒ 两发都不对准目标。
        //  102601 就为此在 2026-11-11 把张角从 12° 收成 0°（实测 Lv1~Lv20 两发全脱靶、伤害 0）。
        //  设计案 P 列写的 `projectileSpreadDeg=25` 在这一档落不了地，按历史结论不配（= 全走 aim）。
        chain: 102201, card: '68022', name: '孢子弹幕', kind: 'mage',
        bullets: [1, 1, 1], angle: null, levels: [0, 14, 22],
        slots: [],
    },
    {
        chain: 102402, card: '68024', name: '孢群弹幕', kind: 'mage',
        bullets: [2, 2, 2], angle: 25, levels: [0, 16, 23],
        slots: [
            [192402, 'attack', 'addRate', [0.18, 0.18, 0.18]],
        ],
        mix: {
            'mix.bulletAngle': [25, 25, 25],
            'mix.damageRate.addRate': [0.15, 0.15, 0.15],
            'mix.attackRange.addRate': [0.25, 0.25, 0.25],
        },
    },
    {
        chain: 102601, card: '68026', name: '孢群弹幕', kind: 'mage',
        bullets: [2, 2, 2], angle: 25, levels: [0, 14, 22],
        slots: [
            [282601, 'attack', 'addRate', [0.28, 0.28, 0.28]],
            [372601, 'bulletAngle', 'add', [25, 25, 25]],
            [192601, 'attackRange', 'addRate', [0.35, 0.35, 0.35]],
        ],
    },
    {
        //  射手版「苔针双连」。原子链是攻击速度 / 移动速度（旧版机制），本批整段换掉。
        chain: 103201, card: '68032', name: '苔针双连', kind: 'archer',
        bullets: [2, 2, 2], angle: null, levels: [0, 14, 22],
        slots: [
            [193201, 'attack', 'addRate', [0.28, 0.28, 0.28]],
            [283201, 'attackRange', 'addRate', [0.35, 0.35, 0.35]],
        ],
    },
    {
        chain: 103401, card: '68034', name: '孢群弹幕', kind: 'mage',
        bullets: [2, 2, 2], angle: 25, levels: [0, 14, 22],
        slots: [
            [283401, 'attack', 'addRate', [0.28, 0.28, 0.28]],
            [373401, 'bulletAngle', 'add', [25, 25, 25]],
            [193401, 'attackRange', 'addRate', [0.35, 0.35, 0.35]],
        ],
    },
    {
        //  主链原是 `critRate add 20`（> 15% 上限），本批整段换成多弹。
        chain: 103502, card: '68035', name: '苔针双连', kind: 'archer',
        bullets: [2, 2, 2], angle: null, levels: [0, 16, 23],
        slots: [
            [193502, 'attack', 'addRate', [0.18, 0.18, 0.18]],
        ],
        mix: {
            'mix.damageRate.addRate': [0.15, 0.15, 0.15],
            'mix.attackRange.addRate': [0.25, 0.25, 0.25],
        },
    },
];

const TAIL_TEXT = {
    attack: '攻击提高', damageRate: '伤害提高', attackSpeed: '攻击速度提高',
    attackRange: '攻击范围提高', maxHp: '最大生命提高',
};

/** `0.4` → `60`（`bulletFalloff` 是「每颗再折掉多少」，文案说的是「剩多少」）。 */
function remainPct(falloff) {
    return Math.round((1 - falloff) * 100);
}

/**
 * 一句技能文案。
 *
 * 2 颗以上才写「约为第 1 发的 N%」—— 那是「第 2 颗 ÷ 第 1 颗」的比例（与 falloff 同值）；
 * 只有 1 颗额外弹时没有「第 1 发」可参照，直接说「额外弹伤害为 N%」（相对普攻本体）。
 *
 * 🔴 不写「同一爆点第 2 个目标起每次 ×0.7」：设计案 L 列有这句，但 P 列落地口径没有配
 * `splashDamageRate`，本批明确「不添加溅射机制」（2026-11-17 用户口径）。文案不能承诺
 * 一个不存在的机制。
 */
function descOf(spec, tier) {
    const count = spec.bullets[tier];
    const pct = remainPct(FALLOFF[tier]);
    const verb = spec.kind === 'mage' ? '同时裂出' : '额外发射';
    const unit = spec.kind === 'mage' ? '道额外弹' : '发';
    const ratio = count > 1 ? `额外弹伤害约为第 1 发的 ${pct}%` : `额外弹伤害为 ${pct}%`;
    let text = `普攻${verb} ${count} ${unit}（${ratio}）`;
    const tails = [];
    for (const [, statId, , values] of spec.slots) {
        //  `bulletAngle` 是张角不是加成，不写进文案（设计案文案里也没有「扇形角度」）。
        if (statId === 'bulletAngle') continue;
        tails.push(`${TAIL_TEXT[statId] ?? statId}${Math.round(values[tier] * 100)}%`);
    }
    for (const [key, values] of Object.entries(spec.mix ?? {})) {
        const statId = key.slice(4).split('.')[0];
        if (statId === 'bulletAngle') continue;
        tails.push(`${TAIL_TEXT[statId] ?? statId}${Math.round(values[tier] * 100)}%`);
    }
    if (tails.length) text += `；${tails.join('，')}`;
    return text;
}

/**
 * 主链行的 `skillParamJson`：本批只放 `bulletFalloff`（每档一个值）与 `mix.*`。
 * 🔴 一律整体重建 —— 原数据里是别的机制的参数（`normalPierceCount` / `splashDamageRate`…），
 * 留着会变成「换了机制还在生效」。
 */
function paramsOf(spec, tier) {
    const out = { bulletFalloff: FALLOFF[tier] };
    for (const [key, values] of Object.entries(spec.mix ?? {})) out[key] = values[tier];
    return JSON.stringify(out);
}

function main() {
    const remotePath = path.join(REMOTE, 'pvpSkillPlan.json');
    const clientPath = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(remotePath);
    const client = readTable(clientPath);

    let mainRows = 0;
    let slotRows = 0;
    for (const table of [remote, client]) {
        for (const spec of SKILLS) {
            for (let tier = 0; tier < 3; tier += 1) {
                const level = tier + 1;
                const row = table.rows.find((item) => Number(item.skillChainId) === spec.chain
                    && Number(item.skillLevel) === level);
                if (!row) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
                if (String(row.unitId) !== spec.card) {
                    throw new Error(`${spec.chain} 归属 ${row.unitId}，与设计案 ${spec.card} 不符`);
                }
                //  🔴 守卫：总弹数（本体 1 + 额外弹）为偶数时不能配张角 —— 扇形分布没有 0° 中心位，
                //  两颗会分别偏 −half/+half，整轮普攻全部脱靶（102601 在 2026-11-11 踩过）。
                if (spec.angle && (spec.bullets[tier] + 1) % 2 === 0) {
                    throw new Error(`${spec.chain} 只有 ${spec.bullets[tier] + 1} 颗弹，配 ${spec.angle}° 扇形会全部脱靶`);
                }
                row.skillName = spec.name;
                row.unlockHeroLevel = spec.levels[tier];
                //  🔴 子弹数只能在这里写一次：`bulletNumFlat` 是 flat 加法，第二处会把颗数翻倍。
                row.statId = 'bulletNum';
                row.operation = 'add';
                row.value = spec.bullets[tier];
                row.skillParamJson = paramsOf(spec, tier);
                row.desc = descOf(spec, tier);
                row.sourceVersion = VERSION;
                mainRows += 1;

                for (const [slotChain, statId, operation, values] of spec.slots) {
                    const slot = table.rows.find((item) => Number(item.skillChainId) === slotChain
                        && Number(item.skillLevel) === level);
                    if (!slot) throw new Error(`pvpSkillPlan 缺少子链 ${slotChain} L${level}`);
                    slot.skillName = spec.name;
                    slot.statId = statId;
                    slot.operation = operation;
                    slot.value = values[tier];
                    //  子链不再带任何参数：原本的 `bulletFalloff` 会与主链重复（覆盖顺序不定）。
                    slot.skillParamJson = null;
                    slotRows += 1;
                }
            }
        }
    }

    for (const dir of [REMOTE, CLIENT]) {
        const file = path.join(dir, 'armySkillLevelUp.json');
        const table = readTable(file);
        for (const spec of SKILLS) {
            for (let tier = 0; tier < 3; tier += 1) {
                const hit = table.rows.find((row) => Number(row.id) === spec.chain
                    && Number(row.skilllevel) === tier + 1);
                if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${tier + 1}`);
                hit.name = spec.name;
                hit.desc = descOf(spec, tier);
                hit.unlockarmylevel = spec.levels[tier];
                //  1 = 数值被动 / 2 = 行为被动。这 9 条都是纯数值 + 普攻参数，无状态机。
                hit.armySkillType = 1;
            }
        }
        writeTable(file, table);
        console.log(`[ok] ${path.basename(dir)}/armySkillLevelUp.json：${SKILLS.length * 3} 行`);
    }

    void writeTable;
    writeTable(remotePath, remote);
    writeTable(clientPath, client);
    console.log(`[ok] 多弹 ${SKILLS.length} 条：主链 ${mainRows / 2} 行 ×2，子链槽位 ${slotRows / 2} 行 ×2`);
}

main();
