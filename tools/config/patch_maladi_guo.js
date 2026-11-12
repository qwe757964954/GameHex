// 一次性配置补丁：麻辣铁锅（68026）四条技能落地（2026-11-11）。
//
//   102601 孢子弹幕   —— 缺 `bulletAngle`：补 3 行 unit 域修改器，普攻张角 **0°**（原 20°，2026-11-11 第四轮收回）
//   102602 吸养根须   —— 已经配好（`splashDamageRate` + `splashRadius` 38/46/55），本脚本只做幂等校正
//   102603 喷射火焰   —— `behaviorKey = 'self_aura'` 复用自身光环车道，冷却 12s / 持续 3s /
//                        每秒 1 波 / 触发距离 274px（身前 224px 处半径 50 的圆）/ 伤害 120-150-200%
//   102604 凤凰降临   —— 走 `30181.empoweredSkillId` → 新武将技 `36182`：4 颗子弹 90° 扇形、
//                        速度 150、寿命 4 秒；命中直伤 220-280-300%，命中爆炸 150-200-250%，
//                        爆炸后第 26 帧再补一段 150-180-200%（都是范围伤害）
//
// 同时写两处（两套格式都要认，见 `ref_table_io.js` 的头注释）：
//   · assets/remoteRef/*.json             —— 运行时真正加载的表（列存竖排 CRLF）
//   · doc/塔防数据配置/json/client/*.json —— 转表产物（紧凑行数组 / pretty print，逐行 LF）
//
// 用法：node patch_maladi_guo.js <assets/remoteRef 目录> <doc/.../json/client 目录>
const fs = require('fs');
const path = require('path');
const { readTable, writeTable } = require('./ref_table_io');

const dirs = process.argv.slice(2);
if (dirs.length < 2) throw new Error('用法：node patch_maladi_guo.js <remoteRef 目录> <client json 目录>');

const PARAM = 'skillParamJson';
const UNIT = '68026';
const PVP_SKILL_ID = 30181;      // == pvpCard.unitSkillId（守卫在 validate_skill_pipeline）
const PHOENIX_SKILL_ID = 36182;  // 新武将技行（36181 是「火法师武将技」火船，已被 102604 取代，保留不删）
const SOURCE_VERSION = '技能设计案2 麻辣铁锅 v1.2';

/**
 * 转表产物（行数组）的写法：**沿用它原来的排版**。
 *
 * 这几张表并不统一：`pvpSkill.json` 一行一条、`pvpSkillPlan.json` 整份压成一行、
 * `armySkillLevelUp.json` 是 2 空格缩进。硬套任何一种都会让整文件 diff 爆炸，
 * 所以按原文件的**开头**判断；同时 null 的键不写出（现有行就是这么省的，列存那边才补 null）。
 */
function writeRowsLikeOriginal(file, rows, originalRaw) {
    const clean = rows.map((row) => Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== null && value !== undefined)));
    if (originalRaw.startsWith('[\n')) {
        const trailing = originalRaw.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}${trailing}`, 'utf8');
        return;
    }
    const separator = originalRaw.includes('\n') ? ',\n' : ',';
    fs.writeFileSync(file, `[${clean.map((row) => JSON.stringify(row)).join(separator)}]`, 'utf8');
}

// ── 1. pvpSkill：30181 的强化槽换成「凤凰降临」+ 新增 36182 行 ──────────────

const PHOENIX_SKILL_ROW = {
    skillId: PHOENIX_SKILL_ID,
    name: '凤凰降临',
    mode: 'projectile',
    //  设计案「子弹速度 150px」。与 `pvpSkill 30859`（天降神拳「弹速 100」）同一条口径：
    //  这一列直接当**世界坐标单位/秒**用，不再乘 `combatDistanceScale`。
    projectileSpeed: 150,
    empoweredEvery: 0,
    empoweredSkillId: 0,
    cooldown: 0,
    //  弹体：`火法师_火船` 的 1.5 倍派生副本（`tools/build_maladi_guo_fx.py` 的 DERIVED）。
    //  🔴 不能直接把 `火法师_火船` 登记进 `ZCCombatEffectScale` 挂 1.5 ——
    //     那条路径同时被 36181 使用，会顺手放大「火法师武将技」。
    effectPrefabPath: 'units/projectiles/麻辣铁锅_凤凰弹/麻辣铁锅_凤凰弹',
    projectileKey: null,
    areaRadius: null,
    effectKey: null,
    trigger: '',
    damageRate: null,
    durationSeconds: null,
    waves: null,
    slowRatio: null,
    secondarySkillId: null,
    onHitStatusId: null,
    //  命中爆炸：32 帧 @30fps 的「爆炸龙卷」。
    impactEffectPrefabPath: 'units/projectiles/麻辣铁锅_爆炸龙卷/麻辣铁锅_爆炸龙卷',
    chargeDistance: null,
    chargeSpeedScale: null,
};

function applySkill(tables) {
    const t = tables.pvpSkill;
    const byId = new Map(t.rows.map((row) => [String(row.skillId), row]));
    if (!byId.has(String(PHOENIX_SKILL_ID))) {
        t.rows.push({ ...PHOENIX_SKILL_ROW });
    }
    //  普攻行：把「每 10 次普攻放一发火船」换成「每 8 次普攻放 4 颗凤凰弹」。
    //  30181 在 `pvpCard` 里**只有 68026 用**（全表 grep 唯一命中），改它不影响任何别的卡。
    const basic = byId.get(String(PVP_SKILL_ID));
    if (!basic) throw new Error(`pvpSkill 缺 ${PVP_SKILL_ID}`);
    basic.empoweredEvery = 8;
    basic.empoweredSkillId = PHOENIX_SKILL_ID;
}

// ── 2. pvpSkillPlan：102601 补张角 + 102603 / 102604 六行 ───────────────────

function planRow(overrides) {
    return {
        enabled: 1, modifierId: null, unitId: null, skillChainId: null, skillName: null, skillLevel: null,
        unlockHeroLevel: null, skillKind: null, passiveScope: 'deployed', progressionMode: 'replace',
        pvpSkillId: null, stateMode: 'none', desc: null, sourceVersion: SOURCE_VERSION, publishStatus: '可发布',
        statId: null, operation: null, value: null, behaviorKey: null,
        [PARAM]: null, cooldown: null, triggerEvent: null, targetSelector: null,
        durationSeconds: null, maxStacks: null, maxTriggers: null, statusId: null, statusStatJson: null,
        ...overrides,
    };
}

//  102603 喷射火焰（2026-11-12 第八轮：判定改**矩形**，覆盖「脚点 → 350」）。
//  矩形沿朝向覆盖 `auraForward ± auraRadius` ⇒ 要让左边缘落在脚点、右边缘落在 350：
//  半长 = auraRadius = **175**（缺省跟随半径）、中心前移 = **175**、半宽 = **70**（宽 140）。
//  三档只抬每波倍率（120/150/200%），冷却 / 时长 / 位置 / 形状都是设计给的常量。
const SPRAY_RADIUS = 175;
//  触发距离（2026-11-12 第七轮，用户口径「应该小于普通攻击的距离，和特效的 350px 范围相匹配，
//  只有敌人处于 350px 这个距离才会被攻击」）：普攻 `unitAttackRange` 550（折后 495），这里 350。
//  特效按它反算缩放（`build_maladi_guo_fx.py` 的 `reach_logic_px`）⇒ 视觉长度也是 350。
const SPRAY_REACH = 350;
//  闸门：最近目标还在 350 表值 px 之外 ⇒ 待触发、不消费 CD（`auraTriggerRange`）。
const SPRAY_TRIGGER_RANGE = 350;
//  半宽（表值 px）：量出来火焰垂直于朝向的可见厚度约 145 ⇒ 取 70（宽 140，略窄于视觉，判定不出圈）。
const SPRAY_RECT_HALF_HEIGHT = 70;
const SPRAY_FORWARD = SPRAY_REACH - SPRAY_RADIUS;   // 175
const SPRAY_VISUAL_LIFT = 97;   // 67(一个兵可见高) + 30(casterLiftPx) ⇒ 起点在角色头部
const SPRAY = [
    { level: 1, unlock: 9, rate: 1.2, text: '120%' },
    { level: 2, unlock: 18, rate: 1.5, text: '150%' },
    { level: 3, unlock: 24, rate: 2.0, text: '200%' },
];

//  102604 凤凰降临：用户 2026-11-11 拍板「固定 4 颗、4 个方向（相邻 90°）」「就是正文那三下，不加持续火海」。
//  第三轮把张角从 90° 改成 360°（全向均分）—— 扇形算不出十字，首尾两颗 −180 与 +180 同向。
//  第 26 帧 @ sample 30 = (26-1)/30 = 0.8333s（第 N 帧 = 下标 N-1，与五雷「第 5 帧 ⇒ 4/30」同一条换算）。
//  爆炸表现 32 帧 @30fps = 1.0667s，`impactBurstEffectSeconds` 必须给足，否则动画被提前摘掉。
const PHOENIX = [
    { level: 1, unlock: 0, direct: 2.2, burst: 1.5, second: 1.5 },
    { level: 2, unlock: 20, direct: 2.8, burst: 2.0, second: 1.8 },
    { level: 3, unlock: 25, direct: 3.0, burst: 2.5, second: 2.0 },
];

//  🔴 张角必须是 **0**（2026-11-11 第四轮从 20 收回）。弹数是 2/2/3，扇形那套
//  `spread = (i / (n - 1)) * 2 - 1` 在**偶数**弹时只有 −1 和 +1 ⇒ 两发偏 ±10°、
//  **没有一发对准目标**；射程 550 逻辑 px 处横偏 97 > 命中圈 29 ⇒ 普攻全脱靶
//  （实测 Lv1~20 伤害 0、Lv25/30 只中 1 发）。改回 20 之前先看 docs §15.7。
const SPREAD_DEG = 0;
const SPREAD_DESC = SPREAD_DEG === 0
    ? '普攻多发的子弹同线飞出（张角 0°：偶数弹的扇形没有一发对准目标，实测全脱靶）'
    : `普攻多发的子弹按 ${SPREAD_DEG}° 扇形均分`;
const BURST_RADIUS = 100;        // 爆炸判定半径（表值 px）
//  第 26 帧的**时间窗**是 [25/30, 26/30) = [0.833333, 0.866667)。取 0.8334 而不是 0.8333：
//  `0.8333 × 30 = 24.999` 会 floor 到 24（第 25 帧），差之毫厘就早了一帧。
//  判据与五雷轰顶一致：`floor(t × sample)` = 当时正在播的帧下标，第 N 帧 ⇔ 下标 N-1。
const SECOND_DELAY = 0.8334;
const EXPLOSION_SECONDS = 1.0667; // 32 帧 @30fps

function applyPlan(tables) {
    const t = tables.pvpSkillPlan;
    if (t.keys && !t.keys.includes(PARAM)) t.keys.push(PARAM);
    const existing = new Set(t.rows.map((row) => `${row.unitId}:${row.skillChainId}:${row.skillLevel}`));
    const push = (row) => {
        const key = `${row.unitId}:${row.skillChainId}:${row.skillLevel}`;
        if (existing.has(key)) {
            //  幂等：已存在就只把数值/文案对齐回来（K 表解锁等级是唯一真源）。
            const current = t.rows.find((item) => `${item.unitId}:${item.skillChainId}:${item.skillLevel}` === key);
            Object.assign(current, row);
            return;
        }
        t.rows.push(row);
        existing.add(key);
    };

    //  ① 102601 的扇形张角。`bulletNum` / `attackSpeed` / `damageRate` 三组早就配好了
    //  （chainId 282601 / 102601 / 192601），只缺这一列 —— 不配的话 2~3 发子弹全打在一条直线上，
    //  「弹幕」看着像一发。
    for (const item of [1, 2, 3]) {
        const unlock = item === 1 ? null : (item === 2 ? 14 : 22);
        push(planRow({
            modifierId: 97026010 + item,
            unitId: UNIT, pvpSkillId: PVP_SKILL_ID, skillChainId: 372601, skillName: '孢子弹幕',
            skillLevel: item, unlockHeroLevel: unlock,
            skillKind: 'passive_stat', passiveScope: 'deployed',
            statId: 'bulletAngle', operation: 'add', value: SPREAD_DEG,
            desc: SPREAD_DESC,
        }));
    }

    //  ② 102603 喷射火焰
    for (const item of SPRAY) {
        push(planRow({
            modifierId: 94026030 + item.level,
            unitId: UNIT, pvpSkillId: PVP_SKILL_ID, skillChainId: 102603, skillName: '喷射火焰',
            skillLevel: item.level, unlockHeroLevel: item.unlock,
            skillKind: 'active_cd', passiveScope: 'battle', triggerEvent: 'active',
            behaviorKey: 'self_aura',
            //  2026-11-12 第八轮：用户原话「改矩形：加 auraRectHalfHeight（半长跟随 auraRadius），
            //  像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」⇒ 覆盖 0~350、宽 140。
            desc: `冷却 12 秒：跳起朝目标方向喷出火焰柱（起点在角色头部），持续 3 秒、每秒对身前 0~${SPRAY_REACH}px 的矩形`
                + `（宽 ${SPRAY_RECT_HALF_HEIGHT * 2}）内所有敌人造成 ${item.text} 攻击力伤害`
                + `（触发距离 ${SPRAY_REACH}px：敌人进入 ${SPRAY_TRIGGER_RANGE}px 内才会释放，与火焰特效等长）`,
            [PARAM]: JSON.stringify({
                auraCooldown: 12,
                auraSeconds: 3,
                auraInterval: 1,
                //  🔴 矩形判定的「半长」缺省跟随半径 ⇒ 175 = 覆盖 175±175 = 0~350。
                //  2026-11-11 用户曾拍板「圆形直径 100」，2026-11-12 第八轮改成矩形
                //  （圆形判定在 250~350，贴脸 <250 打不到；矩形从脚点一路覆盖到 350）。
                auraRadius: SPRAY_RADIUS,
                auraDamageRate: item.rate,
                //  「身前 N px」：区域出生点沿朝向前移 N 表值 px（= 触发距离 − 半长）。
                auraForward: SPRAY_FORWARD,
                //  释放闸门（2026-11-12）：最近目标还在这个表值 px 之外 ⇒ 待触发、不消费 CD。
                //  只压不抬：叠在那道「普攻射程内有目标」的闸门之后，把 550 收到 350。
                auraTriggerRange: SPRAY_TRIGGER_RANGE,
                //  半宽（表值 px）：`> 0` 才启用矩形判定（`zcGroundZoneReaches` 的开关），
                //  与磁电冲击 101604 同一套口径（那边是 54）。
                auraRectHalfHeight: SPRAY_RECT_HALF_HEIGHT,
                //  🔴 竖直抬到角色头部只能走这里：视图在 `mapToViewY` 之后加，
                //  写进 prefab `_lpos.y` 会被宿主节点的 `setRotationFromEuler` 转成侧移。
                //  97 = 一个兵可见高 67（`ZCCombatEffectPlacement` 既有口径）+ 30（施法抬升）。
                auraVisualLiftPx: SPRAY_VISUAL_LIFT,
                //  站桩：火焰柱是喷在身前那个位置上的，不跟着本体跑（跳跃动作期间本体不动）。
                auraFollow: 0,
                //  `auraWaveMaxTargets` 缺省 0 = 不限人数（设计案：「范围内的所有敌人都会造成伤害」）。
                //  「播放攻击动画时，角色上移 30px」：抬的是**美术根节点**，单位坐标不动。
                //  挂在区域上 ⇒ 与光环同生共死（区域到期就落回地面），不需要另设收尾。
                casterLiftPx: 30,
                //  🔴 方向只能由模型给：`area` 事件 `from === to`，视图的
                //  `zcCombatEffectHeadingDegrees` 零位移直接返回 null、美术本身不转，
                //  所以必须显式 `auraFaceTarget: 1` 让区域朝目标。无目标回落 `facingRadians`。
                auraFaceTarget: 1,
            }),
        }));
    }

    //  ③ 102604 凤凰降临
    for (const item of PHOENIX) {
        push(planRow({
            modifierId: 94026040 + item.level,
            unitId: UNIT, pvpSkillId: PVP_SKILL_ID, skillChainId: 102604, skillName: '凤凰降临',
            skillLevel: item.level, unlockHeroLevel: item.unlock,
            skillKind: 'active_cd', passiveScope: 'battle', triggerEvent: 'active',
            behaviorKey: 'skill_params',
            desc: `累计 8 次普攻：向四周各发射 1 颗凤凰弹（4 个方向、相邻 90°，速度 150、持续 4 秒），命中造成`
                + ` ${Math.round(item.direct * 100)}% 攻击力伤害并爆炸，爆炸造成`
                + ` ${Math.round(item.burst * 100)}% 范围伤害，0.83 秒后再造成`
                + ` ${Math.round(item.second * 100)}% 范围伤害`,
            [PARAM]: JSON.stringify({
                //  固定 4 颗：`projectileCount` 一配，`bulletNum`（102601 的 +1/+1/+2）就不再叠加，
                //  见 `ZCAttackResolutionSystem.sendAttack` 里 `declaredProjectileCount` 的注释。
                projectileCount: 4,
                //  🔴 **360 = 全向均分**（相邻两颗差 360/count，第 0 颗对准目标）。
                //  别写回 90：扇形那套 spread=(i/(n-1))*2-1 在 count=4 时是 −1/−⅓/+⅓/+1，
                //  四发落在 −45/−15/+15/+45，实测**四发全部脱靶**（±15° 在 140px 偏 37.5 > 身圈 27）。
                projectileSpreadDeg: 360,
                projectileLifeSeconds: 4,
                damageRate: item.direct,
                //  命中爆炸（不是溅射）：以命中点为圆心，把**包括主打目标**的所有人各打一次。
                impactBurstRadius: BURST_RADIUS,
                impactBurstDamageRate: item.burst,
                impactBurstSecondRate: item.second,
                impactBurstSecondDelay: SECOND_DELAY,
                impactBurstEffectSeconds: EXPLOSION_SECONDS,
            }),
        }));
    }
}

// ── 3. armySkillLevelUp（K 表转表产物）：名字 / 描述 / 修改器指针 ───────────

const SKILL_NAME = { 102603: '喷射火焰', 102604: '凤凰降临' };
//  🔴 K 表描述是卡片 UI 真正读的那份（`CardSkillDescMarkup`）⇒ 与 `pvpSkillPlan.desc` 同步口径。
const PANEL_DESC = {
    102603: [
        `冷却12秒：跳起向前喷出火焰柱（起点在角色头部），持续3秒、每秒对身前0~${SPRAY_REACH}px的矩形（宽${SPRAY_RECT_HALF_HEIGHT * 2}）内所有敌人造成120%伤害（触发距离${SPRAY_REACH}px：敌人进入${SPRAY_TRIGGER_RANGE}px内才会释放，与火焰特效等长）`,
        `冷却12秒：跳起向前喷出火焰柱（起点在角色头部），持续3秒、每秒对身前0~${SPRAY_REACH}px的矩形（宽${SPRAY_RECT_HALF_HEIGHT * 2}）内所有敌人造成150%伤害（触发距离${SPRAY_REACH}px：敌人进入${SPRAY_TRIGGER_RANGE}px内才会释放，与火焰特效等长）`,
        `冷却12秒：跳起向前喷出火焰柱（起点在角色头部），持续3秒、每秒对身前0~${SPRAY_REACH}px的矩形（宽${SPRAY_RECT_HALF_HEIGHT * 2}）内所有敌人造成200%伤害（触发距离${SPRAY_REACH}px：敌人进入${SPRAY_TRIGGER_RANGE}px内才会释放，与火焰特效等长）`,
    ],
    102604: [
        '累计8次普攻：发射4颗夹角90°的凤凰弹（速度150、持续4秒），命中造成220%伤害并爆炸，爆炸造成150%范围伤害，0.83秒后再造成150%范围伤害',
        '累计8次普攻：发射4颗夹角90°的凤凰弹（速度150、持续4秒），命中造成280%伤害并爆炸，爆炸造成200%范围伤害，0.83秒后再造成180%范围伤害',
        '累计8次普攻：发射4颗夹角90°的凤凰弹（速度150、持续4秒），命中造成300%伤害并爆炸，爆炸造成250%范围伤害，0.83秒后再造成200%范围伤害',
    ],
};

function applyArmy(tables) {
    const t = tables.armySkillLevelUp;
    const byKey = new Map(t.rows.map((row) => [`${row.id}:${row.skilllevel}`, row]));
    for (const chainId of [102603, 102604]) {
        for (const level of [1, 2, 3]) {
            const row = byKey.get(`${chainId}:${level}`);
            if (!row) { console.warn(`  ⚠ K 表缺 ${chainId} L${level}，跳过`); continue; }
            row.name = SKILL_NAME[chainId];
            row.desc = PANEL_DESC[chainId][level - 1];
            //  `modfiy` 只写本次的 PVP 计划行（`project_skill_plan.mjs` 也是这么回填的）。
            row.modfiy = [94026000 + (chainId === 102603 ? 30 : 40) + level];
        }
    }
}

// ── 执行 ────────────────────────────────────────────────────────────────────

const APPLY = {
    pvpSkill: applySkill,
    pvpSkillPlan: applyPlan,
    armySkillLevelUp: applyArmy,
};

const failures = [];
for (const dir of dirs) {
    for (const name of Object.keys(APPLY)) {
        const file = path.join(dir, `${name}.json`);
        if (!fs.existsSync(file)) throw new Error(`缺表：${file}`);
        //  单表失败不中断其余表：`doc/.../client` 是 SVN 工作副本，可能正被外部 update
        //  改出冲突标记（`<<<<<<< .mine`）—— 那时 JSON.parse 会直接抛，但另外两张表还是好的。
        try {
            const table = readTable(file);
            const originalRaw = table.raw;
            APPLY[name]({ [name]: table });
            if (table.mode === 'rows') writeRowsLikeOriginal(file, table.rows, originalRaw);
            else writeTable(file, table);
            console.log(`✓ ${file}（${table.rows.length} 行，${table.mode}）`);
        } catch (error) {
            failures.push({ file, message: error.message });
            console.warn(`✗ ${file}：${error.message}`);
        }
    }
}
if (failures.length) {
    console.log(`\n有 ${failures.length} 张表没写成：`);
    for (const item of failures) console.log(`  · ${item.file}\n    ${item.message}`);
    process.exitCode = 1;
}
