// 仙桃行者（68009）2026-11-23 续：**普通攻击**借「长枪兵普攻_刀光」。
//
// 需求原话：「仙桃行者，普通攻击也要播放 长枪兵的武将技能特效」
//          → 2026-11-23 11:34 用户纠正：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」。
//
// 只改一格：`pvpSkill 30718 仙桃行者普攻` 的 `effectPrefabPath`
//   空 → `units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光`
// 两份磁盘格式（remoteRef 列存 + doc/client 行对象）同改，见 tools/config/ref_table_io.js。
//
// 🔴 为什么不改 36171 / 30171：那两行分别是长枪兵的武将技与普攻，属于另一张卡；
//    仙桃行者要的是「借这张图」，不是把长枪兵的技能挪过来。改 30718 才是「这张卡的普攻长这样」。
// 🔴 刀光这份美术**不需要在 `ZCEffectCatalog` 登记**：64×42 的小刀光贴在出手点，
//    锚点 `caster`、层按事件类型（melee ⇒ top）、尺寸 1 全是兜底默认值 —— 与长枪兵 30171
//    自己的播法逐字一致（同样受 0.32s 事件寿命截断，8 帧里只演前 ~5 帧，这是既有观感）。
// 🔴 30844（大地之力）**不动**：它在 `ZCQuakeFx.ZC_EMPOWERED_FX_OVERRIDES` 里登记为 `null`
//    （强化那一击不拖普攻贴图），表现由落点重击柱负责。
// 🔴 填上这一格之后，2026-11-19 定案 A 的「强化那一击借普攻行」对 68009 依然成立，
//    所以代码侧必须同时有那条 `null` 名单，否则会出现「地面枪阵拖着飞」。
const { readTable, writeTable } = require('./ref_table_io.js');

const SPEAR_FX = 'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光';
//  上一版误写成 `长枪兵_武将技能`（那张 16 帧地面枪阵），用户已纠正。这里一并列出，
//  允许从它改回来 —— 否则本次修正会被「已有别的特效」守卫挡住。
const PREVIOUS_FX = 'units/projectiles/长枪兵_武将技能/长枪兵_武将技能';
const TARGET_SKILL = 30718;

const TABLES = [
    'assets/remoteRef',
    'D:/Alan/Project/POW/doc/塔防数据配置/json/client',
];

function rewriteSkill(table, path) {
    const hits = [];
    for (const row of table.rows) {
        if (row.skillId !== TARGET_SKILL) continue;
        if (row.name !== '仙桃行者普攻') {
            throw new Error(`${path} ${TARGET_SKILL} 的名字是「${row.name}」，不是仙桃行者普攻，拒绝改`);
        }
        const before = row.effectPrefabPath;
        if (before === SPEAR_FX) {
            hits.push(`${TARGET_SKILL} ${row.name}: 已是 ${SPEAR_FX}（无改动）`);
            continue;
        }
        //  只允许从「空」或上一版误配的枪阵改成这张图：以后若有人给它配了别的美术，停下来别覆盖。
        //  ⚠️ 两份产物「空」的写法不同：`remoteRef` 列存是 `null`，`doc/client` 行对象直接**没这个键**
        //  （`undefined`）。不认 `undefined` 就会在 client 那一份上误判成「已有别的特效」。
        if (before !== null && before !== '' && before !== undefined && before !== PREVIOUS_FX) {
            throw new Error(`${path} ${TARGET_SKILL} 已有别的特效「${before}」，先人工核对`);
        }
        row.effectPrefabPath = SPEAR_FX;
        hits.push(`${TARGET_SKILL} ${row.name}: ${before} -> ${SPEAR_FX}`);
    }
    if (hits.length !== 1) throw new Error(`${path} pvpSkill 只命中 ${hits.length}/1 行，拒绝写入`);
    return hits;
}

const JOBS = [
    ['pvpSkill.json', rewriteSkill],
];

for (const dir of TABLES) {
    for (const [name, rewrite] of JOBS) {
        const path = `${dir}/${name}`;
        const table = readTable(path);
        const hits = rewrite(table, path);
        writeTable(path, table);
        console.log(`[ok] ${path}`);
        hits.forEach((line) => console.log('     ' + line));
    }
}
