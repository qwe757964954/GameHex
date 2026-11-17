// 被动重设计 V5 · 第二批：溅射 / 裂变爆炸 / 共生信号（全队移速光环）+ 混搭尾。
//
// 依赖 2026-11-16 新增的 `skillParamJson` 混搭键（`mix.<statId>[.addRate]`，见 ZCStatSchema
// `readZCSkillMixStats`）：设计案的金卡被动是「主机制 + 1~3 条尾巴」，而一行计划只有一个
// statId 槽，尾巴统一写进参数里的保留前缀。
//
// 口径仍取设计案 L1~L3（「落地口径」列里 101702 的溅射 12/16/20 是旧值，已按 L 列 40/44/48 走）。
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const VERSION = '技能设计案2 V5-20261116';

/**
 * kind:
 *  · splash    —— `splashDamageRate` 三档递进，半径沿用表里已有的 `splashRadius`
 *  · blast     —— 落点正圆爆炸：`splashDamageRate` 三档 + `splashRadius=90`
 *  · teamAura  —— `team_aura` 移速光环（半径 190，同阵营含自身），三档只改移速
 * `mix` 是该技能三档不变的尾巴（写进 skillParamJson）。
*/
const SKILLS = [
    { chain: 100802, card: '68008', name: '爆囊扩散', kind: 'splash', rates: [0.50, 0.54, 0.58],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackRange.addRate': 0.23 },
        tails: '攻击提高16%，伤害提高13%，攻击范围提高23%' },
    { chain: 101501, card: '68015', name: '爆囊扩散', kind: 'splash', rates: [0.50, 0.54, 0.58],
        levels: [1, 14, 22], mix: { 'mix.attack.addRate': 0.09, 'mix.attackSpeed.addRate': 0.09 },
        tails: '攻击提高9%，攻击速度提高9%' },
    { chain: 100902, card: '68009', name: '爆囊扩散', kind: 'splash', rates: [0.50, 0.54, 0.58],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackSpeed.addRate': 0.17 },
        tails: '攻击提高16%，伤害提高13%，攻击速度提高17%' },
    { chain: 103202, card: '68032', name: '爆囊扩散', kind: 'splash', rates: [0.50, 0.54, 0.58],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackRange.addRate': 0.23 },
        tails: '攻击提高16%，伤害提高13%，攻击范围提高23%' },
    { chain: 101002, card: '68010', name: '裂变爆炸', kind: 'blast', rates: [0.50, 0.55, 0.60],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackRange.addRate': 0.23 },
        tails: '攻击提高16%，伤害提高13%，攻击范围提高23%' },
    { chain: 102602, card: '68026', name: '裂变爆炸', kind: 'blast', rates: [0.50, 0.55, 0.60],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackRange.addRate': 0.23 },
        tails: '攻击提高16%，伤害提高13%，攻击范围提高23%' },
    { chain: 103402, card: '68034', name: '裂变爆炸', kind: 'blast', rates: [0.50, 0.55, 0.60],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.16, 'mix.damageRate.addRate': 0.13, 'mix.attackRange.addRate': 0.23 },
        tails: '攻击提高16%，伤害提高13%，攻击范围提高23%' },
    { chain: 101601, card: '68016', name: '裂变爆炸', kind: 'blast', rates: [0.50, 0.55, 0.60],
        levels: [1, 14, 22], mix: { 'mix.attack.addRate': 0.24, 'mix.attackRange.addRate': 0.35 },
        tails: '攻击提高24%，攻击范围提高35%' },
    { chain: 100602, card: '68006', name: '共生信号·迅', kind: 'teamAura', rates: [40, 46, 52],
        levels: [1, 16, 23], mix: { 'mix.attack.addRate': 0.04, 'mix.damageRate.addRate': 0.03, 'mix.maxHp.addRate': 0.04 },
        tails: '攻击提高4%，伤害提高3%，最大生命提高4%' },
    { chain: 102301, card: '68023', name: '共生信号·迅', kind: 'teamAura', rates: [40, 46, 52],
        levels: [1, 14, 22], mix: { 'mix.attack.addRate': 0.06, 'mix.maxHp.addRate': 0.06 },
        tails: '攻击提高6%，最大生命提高6%' },
    { chain: 103101, card: '68031', name: '共生信号·迅', kind: 'teamAura', rates: [40, 46, 52],
        levels: [1, 14, 22], mix: { 'mix.attack.addRate': 0.06, 'mix.maxHp.addRate': 0.06 },
        tails: '攻击提高6%，最大生命提高6%' },
];

const AURA_RADIUS_PX = 190;

function descOf(spec, tier) {
    const rate = spec.rates[tier];
    if (spec.kind === 'teamAura') {
        return `以本体为圆心${AURA_RADIUS_PX}px内的同阵营友军（含自身）移动速度提高${rate}%，光环随本体移动；${spec.tails}`;
    }
    const percent = Math.round(rate * 100);
    if (spec.kind === 'blast') {
        return `命中在落点生成半径90的圆形爆炸，范围内目标承受${percent}%溅射伤害（逐目标×0.7）；${spec.tails}`;
    }
    return `命中对周围造成${percent}%溅射伤害（同一爆点第2个目标起每次×0.7）；${spec.tails}`;
}

function paramsOf(spec, tier, current) {
    const params = { ...(current || {}) };
    //  🔴 尾巴（`mix.*`）归 `patch_passive_redesign_tails.js` 唯一拥有 —— 本脚本只写机制参数。
    //  之前这里「整块重建 + 写 spec.mix」，重跑一次就会把 tails 已经挪到子链里的尾巴又写回 mix，
    //  变成「同一属性两份」（101002 的伤害被 192602 与 mix 各加一次）。保留 mix 键 = 重跑幂等。
    const mix = {};
    for (const [key, value] of Object.entries(params)) {
        if (!key.startsWith('mix.')) continue;
        mix[key] = value;
        delete params[key];
    }
    for (const key of Object.keys(params)) delete params[key];
    if (spec.kind === 'teamAura') {
        params[`teamAura0Radius`] = AURA_RADIUS_PX;
        params[`teamAura0MoveSpeedPct`] = spec.rates[tier];
    } else {
        params.splashDamageRate = spec.rates[tier];
        params.splashFalloff = 0.3;
        params.splashRadius = spec.kind === 'blast' ? 90 : (current?.splashRadius ?? 38);
    }
    return { ...params, ...mix };
}

const BASE = {
    enabled: 1, stateMode: 'none', maxStacks: 1, maxTriggers: 0,
    statusId: null, statusStatJson: null, cooldown: 0, durationSeconds: 0,
    triggerEvent: 'build', targetSelector: 'self', skillKind: 'passive_stat',
    passiveScope: 'deployed', progressionMode: 'replace',
    sourceVersion: VERSION, publishStatus: '可发布',
    statId: null, operation: null, value: null,
};

function applyPlan(rows) {
    let written = 0;
    for (const spec of SKILLS) {
        for (let index = 0; index < 3; index += 1) {
            const level = index + 1;
            const hit = rows.find((row) => Number(row.skillChainId) === spec.chain && Number(row.skillLevel) === level);
            if (!hit) throw new Error(`pvpSkillPlan 缺少 ${spec.chain} L${level}`);
            const current = hit.skillParamJson ? JSON.parse(hit.skillParamJson) : {};
            const params = paramsOf(spec, index, current);
            Object.assign(hit, {
                ...BASE,
                modifierId: hit.modifierId,
                unitId: spec.card,
                skillChainId: spec.chain,
                skillName: spec.name,
                skillLevel: level,
                unlockHeroLevel: Math.max(1, spec.levels[index]),
                pvpSkillId: hit.pvpSkillId,
                behaviorKey: spec.kind === 'teamAura' ? 'team_aura' : 'skill_params',
                skillParamJson: JSON.stringify(params),
                desc: descOf(spec, index),
            });
            written += 1;
        }
    }
    return written;
}

function applyArmy(table) {
    let written = 0;
    for (const spec of SKILLS) {
        for (let index = 0; index < 3; index += 1) {
            const level = index + 1;
            const hit = table.rows.find((row) => Number(row.id) === spec.chain && Number(row.skilllevel) === level);
            if (!hit) throw new Error(`armySkillLevelUp 缺少 ${spec.chain} L${level}`);
            hit.name = spec.name;
            hit.desc = descOf(spec, index);
            hit.unlockarmylevel = Math.max(1, spec.levels[index]);
            written += 1;
        }
    }
    return written;
}

function main() {
    const remotePlan = path.join(REMOTE, 'pvpSkillPlan.json');
    const clientPlan = path.join(CLIENT, 'pvpSkillPlan.json');
    const remote = readTable(remotePlan);
    const client = readTable(clientPlan);
    const planWritten = applyPlan(remote.rows);
    applyPlan(client.rows);
    writeTable(remotePlan, remote);
    writeTable(clientPlan, client);

    const armyRemote = readTable(path.join(REMOTE, 'armySkillLevelUp.json'));
    const armyClient = readTable(path.join(CLIENT, 'armySkillLevelUp.json'));
    const armyWritten = applyArmy(armyRemote);
    applyArmy(armyClient);
    writeTable(path.join(REMOTE, 'armySkillLevelUp.json'), armyRemote);
    writeTable(path.join(CLIENT, 'armySkillLevelUp.json'), armyClient);

    console.log(`[ok] 第二批：pvpSkillPlan ${planWritten} 行 ×2；armySkillLevelUp ${armyWritten} 行 ×2`);
}

main();
