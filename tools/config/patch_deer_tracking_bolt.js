// 鹿神守护（103405，魔术师 68034）改成「会追踪的子弹」（2026-11-12）。
//
// 需求原话：
//   「68034 魔术师的召唤物 小鹿 应该是类似子弹一样的效果，只是一个会追踪目标的子弹，
//     从角色朝向的 15px 处生成，移动时小鹿播放 walk 动画，前半段移速慢（70px），
//     贴近目标后的移速快（140PX，同步在小鹿身上覆盖火船特效），当原目标死亡后，
//     小鹿会转向新目标，接触到任意目标后造成伤害，子弹消失」
//
// 相对 2026-11-07 那版「冲刺区域」的口径差异，逐条落到参数上：
//
//   zoneSpawnForward   30 → 15   出生点从身前 30px 收到 15px（「从枪口出来」，不再隔一截）
//   zoneMaxHits         5 → 1    「接触到任意目标后子弹消失」⇒ 命中名额只有 1 个
//   zoneDamageFalloff  删        「每多命中一个目标伤害降低 50%」作废 —— 只打一个目标，
//                               没有第二个可递减；槽位仍留在代码里给后续技能用
//   zoneApproachSpeed  70  不变  慢档 70px/s
//   zoneMoveSpeed     140  不变  快档 140px/s（代码里叫 `sprintSpeed`）
//   zoneSprintRange   200  不变  距目标 ≤ 200 表值 px 切快档（此时火船才点亮）
//   zoneDuration        2  不变  快档最长存活 2s（兜底：追不上就自己散场）
//   zoneHoldVisual      1  不变  整段持有一条跟随视觉（小鹿本体 + 火船）
//   zoneWaveInterval 0.15  不变  快档每 0.15s 探一次接触
//
// 「目标阵亡转向新目标」不是参数，是 `ZCGroundZoneSystem.advanceChase` 的行为（本轮改代码）。
// 「快档才覆盖火船」也不是参数：`overlayFx` 由 `sprinting` 派生，视图按登记表开关 `fx_火船`。
//
// 三处描述一起改（否则卡片 / 升级面板 / 两人看到的文案不一致）：
//   · `pvpSkillPlan.desc`（PVP 技能案真读）
//   · `armySkillLevelUp.desc`（卡牌升级面板真读）
// 两份 JSON 产物（`assets/remoteRef` 与 `doc/塔防数据配置/json/client`）都要写。
const { readTable, writeTable } = require('./ref_table_io.js');

const DOC = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/';
const REF = 'assets/remoteRef/';

const UNIT = '68034';
const CHAIN = 103405;

/** 三档共用的位移口径；`damageRate` 随等级走，本脚本不碰。 */
const ZONE = {
    zoneSpawnForward: 15,
    zoneApproachSpeed: 70,
    zoneSprintRange: 200,
};
/** 必须被抹掉的旧键（追猎口径作废）。 */
const DROP_KEYS = ['zoneDamageFalloff'];
/** 必须被改成 1 的键（接触即消失）。 */
const PATCH_KEYS = { zoneMaxHits: 1 };

/** 三档描述：只有伤害数字不同，其余口径逐字相同。 */
function descOf(level, damage) {
    return `累计8次普攻召唤小鹿：从身前15px生成并追踪最近的敌人，`
        + `前段70px/s行走、贴近后140px/s加速并燃起火焰，`
        + `接触敌人造成${damage}点伤害后消失；目标阵亡会自动转向最近的敌人`;
}

const DAMAGE_BY_LEVEL = { 1: 600, 2: 700, 3: 800 };

function patchBoth(table, mutate) {
    for (const path of [DOC + table + '.json', REF + table + '.json']) {
        const source = readTable(path);
        const before = JSON.stringify(source.rows);
        source.rows = mutate(source.rows);
        if (JSON.stringify(source.rows) === before) {
            console.log(`[skip] ${path}（无变化）`);
            continue;
        }
        writeTable(path, source);
        console.log(`[ok] ${path}（${source.mode}）${source.rows.length} 行`);
    }
}

/** 键序稳定：老键原样在前，新增键追加在后面，被删的键直接跳过 ⇒ diff 只落在真改动上。 */
function rewriteParams(raw) {
    const params = JSON.parse(raw || '{}');
    const next = {};
    for (const [key, value] of Object.entries(params)) {
        if (DROP_KEYS.includes(key)) continue;
        next[key] = key in PATCH_KEYS ? PATCH_KEYS[key] : value;
    }
    for (const [key, value] of Object.entries(ZONE)) {
        next[key] = value;
    }
    for (const [key, value] of Object.entries(PATCH_KEYS)) {
        next[key] = value;
    }
    return JSON.stringify(next);
}

patchBoth('pvpSkillPlan', (rows) => rows.map((row) => {
    if (String(row.unitId) !== UNIT || Number(row.skillChainId) !== CHAIN) return row;
    const skillParamJson = rewriteParams(row.skillParamJson);
    const desc = descOf(Number(row.skillLevel), DAMAGE_BY_LEVEL[Number(row.skillLevel)] ?? 600);
    if (skillParamJson === row.skillParamJson && desc === row.desc) return row;
    console.log(`  · pvpSkillPlan 103405 L${row.skillLevel} 参数/描述已重写`);
    return { ...row, skillParamJson, desc };
}));

patchBoth('armySkillLevelUp', (rows) => rows.map((row) => {
    if (Number(row.id) !== CHAIN) return row;
    const desc = descOf(Number(row.skilllevel), DAMAGE_BY_LEVEL[Number(row.skilllevel)] ?? 600);
    if (desc === row.desc) return row;
    console.log(`  · armySkillLevelUp 103405 L${row.skilllevel} 描述已重写`);
    return { ...row, desc };
}));

// 自查：三档参数必须齐、旧键必须没了、两份 JSON 必须逐字一致。
const fs = require('fs');
const refRows = readTable(REF + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN);
const docRows = readTable(DOC + 'pvpSkillPlan.json').rows
    .filter((row) => String(row.unitId) === UNIT && Number(row.skillChainId) === CHAIN);
for (const row of refRows) {
    const params = JSON.parse(row.skillParamJson);
    const drift = Object.entries({ ...ZONE, ...PATCH_KEYS })
        .filter(([key, value]) => params[key] !== value).map(([key]) => key);
    const leftover = DROP_KEYS.filter((key) => key in params);
    const docRow = docRows.find((item) => Number(item.skillLevel) === Number(row.skillLevel));
    const same = docRow && docRow.skillParamJson === row.skillParamJson && docRow.desc === row.desc;
    console.log(`[check] L${row.skillLevel} 偏差：${drift.length ? drift.join(',') : '无'}`
        + ` | 残留旧键：${leftover.length ? leftover.join(',') : '无'}`
        + ` | 两份 JSON 一致：${same ? '是' : '否'}`
        + ` | ${row.desc}`);
}
void fs;
