/**
 * 麻辣铁锅（68026）四条技能落地（2026-11-11）。
 *
 *   102601 孢子弹幕 —— 被动：张角 `bulletAngle` 从 20 收到 **0**（偶数弹的扇形没有一发对准目标）
 *   102602 吸养根须 —— 被动：已经配好（`splashDamageRate` + `splashRadius`），本文件只做守卫
 *   102603 喷射火焰 —— 主动：`self_aura` 复用自身光环车道 + 施法者悬空（`casterLiftPx = 30`）
 *   102604 凤凰降临 —— 主动：`30181.empoweredSkillId → 36182`，4 颗 90° 扇形弹 +
 *                        命中爆炸 + 爆炸后第 26 帧第二段范围伤害
 *
 * 用户 2026-11-11 拍板的四条口径，每一条都在下面钉住：
 *  1. 102603 的伤害区域 = **矩形，从脚点到身前 350px、宽 140**（2026-11-12 第八轮由
 *     「身前 350 处直径 100 的圆」改成矩形：圆判定 250~350 打不到贴脸的敌人）；
 *  2. 102604 = **固定 4 颗、4 个方向（相邻 90°）**（2026-11-11 第三轮从「90° 扇形」改成全向）；
 *  3. 102604 的「三段伤害」= 正文那三下，**不再加持续火海**；
 *  4. 102601 的扇形张角 = **20°**（2026-11-11 第四轮按实测改成 **0°**，见下面那条用例）。
 *
 * 另外两处按现值实现（设计案没写，沿用配表既有值 / 已向用户声明）：
 *  · 102602 的溅射半径 38 / 46 / 55；
 *  · 102604 的弹体是 `火法师_火船` 的派生副本（`麻辣铁锅_凤凰弹`，2026-11-11 第三轮缩到 0.65）。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { zcSelfAuraEffectPath, ZC_SELF_AURA_BEHAVIOR_KEY } from '../assets/script/app/zcds/model/ZCSelfAuraFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { zcGroundZoneBroadRadius, zcGroundZoneReaches } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';

// ────────────────────────────────────────────── 夹具

const ROOT = join(__dirname, '..');
const UNIT_ID = '68026';
const PVP_SKILL_ID = 30181;
const PHOENIX_SKILL_ID = 36182;

/** 屏上 px / 逻辑 px（docs §1.11）：0.3(combatDistanceScale) × 2.5625(view/logical)。 */
const SCREEN_PX_PER_LOGIC_PX = 0.3 * 2.5625;

//  102603 喷射火焰的三个数（2026-11-11 第五轮：用户原话「根据特效的最长像素作为触发该技能的实际距离」）。
//  特效**取自然尺寸**（缩放 1），所以「画布 px = 屏上 px」—— 量出来的长度就是屏上长度。
//
//  🔴 2026-11-12 修正：长度要用**稳态**可见长度，不是「全序列并集宽」。
//  这一套的并集最左缘 68 只由第 1~2 帧的起势火苗贡献（占 5% 时长），整段 clip 的中位左缘是 238 ——
//  按并集钉尾部，95% 的时间里火焰实体从 238 才开始，屏上就空出 (238−68)/2 = 85px，
//  正是用户截图里「目标在右侧时起始位置离角色很远」。
const SPRAY_TAIL_SRC_PX = 238;                            // 各帧可见左缘的中位数（源 px）
const SPRAY_TIP_SRC_PX = 659;                             // 最右缘（源 px）
const SPRAY_VISIBLE_SPAN_PX = (SPRAY_TIP_SRC_PX - SPRAY_TAIL_SRC_PX) / 2;   // 421 源 px ÷ DOWNSCALE 2 = 210.5 画布 px
//  🔴 2026-11-12 第七轮：距离反过来定长度 —— 用户口径「触发距离应该小于普通攻击的距离，
//  和特效的 350px 范围相匹配，只有敌人处于 350px 这个距离才会被攻击」。
//  普攻 `unitAttackRange` 550（折后 495），喷火只在 350 以内放 ⇒ 缩放 = 350×0.76875 ÷ 210.5。
const SPRAY_REACH_LOGIC_PX = 350;
const SPRAY_TRIGGER_RANGE_PX = 350;                        // `auraTriggerRange`：超出就待触发
const SPRAY_SCALE = SPRAY_REACH_LOGIC_PX * SCREEN_PX_PER_LOGIC_PX / SPRAY_VISIBLE_SPAN_PX; // 1.278207
//  🔴 2026-11-12 第八轮：判定改**矩形**，沿朝向覆盖「脚点 → 350」⇒
//  半长 `auraRadius = 175`（缺省跟随半径）、中心前移 `auraForward = 175`、半宽 70（宽 140）。
const SPRAY_RADIUS_LOGIC_PX = 175;
const SPRAY_RECT_HALF_HEIGHT_PX = 70;
const SPRAY_AURA_FORWARD = SPRAY_REACH_LOGIC_PX - SPRAY_RADIUS_LOGIC_PX;                 // 175
const SPRAY_VISUAL_LIFT_PX = 97;                           // 67(一个兵可见高) + 30(casterLiftPx)

/** `assets/remoteRef/*.json` 是列存 `{k, v}`，转表产物是行数组 —— 两种都认。 */
function readTable(name: string): Array<Record<string, unknown>> {
    const packed = JSON.parse(readFileSync(join(ROOT, 'assets', 'remoteRef', `${name}.json`), 'utf8'));
    if (Array.isArray(packed)) return packed as Array<Record<string, unknown>>;
    const keys = packed.k as string[];
    return (packed.v as unknown[][]).map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
}

function readClientTable(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

function planOf(rows: Array<Record<string, unknown>>, chainId: number): Array<Record<string, unknown>> {
    return rows
        .filter((row) => String(row.unitId) === UNIT_ID && Number(row.skillChainId) === chainId)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
}

function paramsOf(row: Record<string, unknown>): Record<string, number> {
    return JSON.parse(String(row.skillParamJson)) as Record<string, number>;
}

// ────────────────────────────────────────────── 一、配表守卫

/**
 * 🔴 张角必须是 **0**，不能再回到 20。
 *
 * `bulletNum` 在这张卡上是 +1 / +1 / +2（`282601`），普攻基数 1 发 ⇒ 弹数 **2 / 2 / 3**。
 * 扇形那套 `spread = (index / (count - 1)) * 2 - 1` 在 **偶数** 弹时只有 −1 和 +1，
 * 两发分别偏 −10° / +10°，**没有一发对准目标**。实测（`attackRange 550`、目标 68001
 * 命中圈 29 逻辑 px）：Lv1~Lv20 两发全脱靶、伤害 0；Lv25/30 三发只有 0° 那发命中，156（应 468）。
 * 这就是用户报的「普攻穿透目标不掉血、也没有法师受击特效」。
 *
 * 改成 0 后 `halfSpan = 0`，全部子弹走 `aim` ⇒ 任何距离必中，受击特效 2/2/3 条。
 */
test('102601 孢子弹幕：张角收到 0°，且弹数 / 攻速 / 伤害三组一行没动', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const angle = planOf(rows, 372601);
        assert.equal(angle.length, 3, '缺 bulletAngle 三行 ⇒ 张角会退回别的卡的默认值');
        assert.deepEqual(angle.map((row) => Number(row.value)), [0, 0, 0],
            '张角非 0 ⇒ 偶数弹的扇形没有一发对准目标，普攻全脱靶');
        for (const row of angle) {
            assert.equal(row.statId, 'bulletAngle');
            assert.equal(row.operation, 'add');
            assert.equal(Number(row.pvpSkillId), PVP_SKILL_ID);
        }
        assert.deepEqual(angle.map((row) => Number(row.unlockHeroLevel ?? 0)), [0, 14, 22],
            '解锁等级必须与 K 表 102601 一致');

        //  三组既有行不许被这次改动碰到
        assert.deepEqual(planOf(rows, 282601).map((row) => Number(row.value)), [1, 1, 2], 'bulletNum 增量');
        assert.deepEqual(planOf(rows, 102601).map((row) => Number(row.value)), [0.14, 0.2, 0.26], 'attackSpeed');
        assert.deepEqual(planOf(rows, 192601).map((row) => Number(row.value)), [0.08, 0.12, 0.16], 'damageRate');
    }
});

test('102602 吸养根须：字段名是 splashDamageRate（设计案写的 explosionDamageRate 是错的）', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const leech = planOf(rows, 102602);
        assert.equal(leech.length, 3);
        assert.deepEqual(leech.map((row) => Number(row.value)), [0.3, 0.4, 0.5], 'lifestealRate');
        assert.deepEqual(leech.map((row) => paramsOf(row).splashDamageRate), [0.2, 0.28, 0.36]);
        assert.deepEqual(leech.map((row) => paramsOf(row).splashRadius), [38, 46, 55],
            '设计案没写溅射半径，沿用配表既有值（同磁电菇 101601 档）');
        for (const row of leech) {
            assert.equal(paramsOf(row).explosionDamageRate, undefined,
                'explosionDamageRate 在 skillParamJson 里没有消费方，别写进去');
        }
        assert.deepEqual(planOf(rows, 192602).map((row) => Number(row.value)), [0.15, 0.2, 0.25], 'damageRate');
    }
});

test('102603 喷射火焰：矩形 0~350（宽 140）+ 触发距离 350 + 持续 3 秒每秒 1 波 + 抬到头部 97px', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const spray = planOf(rows, 102603);
        assert.equal(spray.length, 3);
        assert.deepEqual(spray.map((row) => Number(row.unlockHeroLevel ?? 0)), [9, 18, 24]);
        assert.deepEqual(spray.map((row) => paramsOf(row).auraDamageRate), [1.2, 1.5, 2]);

        for (const row of spray) {
            assert.equal(row.behaviorKey, 'self_aura', '复用自身光环车道（不新开车道）');
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(Number(row.pvpSkillId), PVP_SKILL_ID);
            const params = paramsOf(row);
            assert.equal(params.auraCooldown, 12, '主动-冷却秒数 12');
            assert.equal(params.auraSeconds, 3, '技能持续 3 秒');
            assert.equal(params.auraInterval, 1, '每秒 1 波 ⇒ 3 波');
            //  🔴 2026-11-12 第八轮：圆形 → 矩形，半长跟随 `auraRadius` ⇒ 覆盖 `auraForward ± 175`。
            assert.equal(params.auraRadius, SPRAY_RADIUS_LOGIC_PX, '半长 175（缺省跟随半径）');
            assert.equal(params.auraForward, SPRAY_AURA_FORWARD, '中心前移 175（= 350 − 半长 175）');
            assert.equal(params.auraForward - params.auraRadius, 0, '矩形左边缘必须落在脚点（0）');
            assert.equal(params.auraForward + params.auraRadius, SPRAY_REACH_LOGIC_PX,
                '矩形右边缘必须正好压在火焰尖端（350）');
            assert.equal(params.auraRectHalfHeight, SPRAY_RECT_HALF_HEIGHT_PX, '半宽 70 ⇒ 宽 140');
            assert.equal(params.auraTriggerRange, SPRAY_TRIGGER_RANGE_PX,
                '释放闸门：最近目标还在 350 表值 px 之外 ⇒ 待触发、不消费 CD');
            assert.equal(params.auraFollow, 0, '站桩：火焰柱喷在身前那个点上，不跟本体跑');
            assert.equal(params.auraWaveMaxTargets ?? 0, 0, '「范围内的所有敌人」⇒ 不限人数');
            //  「播放攻击动画时，角色上移 30px」
            assert.equal(params.casterLiftPx, 30);
            //  🔴 「特效的起始位置在角色的头部」：竖直抬升只能走 `auraVisualLiftPx`
            //  （视图在 `mapToViewY` 之后加）。写进 prefab `_lpos.y` 会被宿主节点的
            //  `setRotationFromEuler` 转成「垂直于火焰的侧移」—— 只有正中朝右那次看着是对的。
            assert.equal(params.auraVisualLiftPx, SPRAY_VISUAL_LIFT_PX,
                '67(一个兵可见高) + 30(casterLiftPx) = 97 屏上 px');
            //  触发距离要写进描述：卡片 UI 读的是 `armySkillLevelUp.desc`，
            //  但 `pvpSkillPlan.desc` 是人看的那一份，两边口径必须一致。
            const desc = String(row.desc ?? '');
            assert.ok(desc.includes(`${SPRAY_REACH_LOGIC_PX}px`),
                `描述里必须写明触发距离 ${SPRAY_REACH_LOGIC_PX}px：${desc}`);
            assert.ok(desc.includes('矩形'), `描述里的判定形状必须是矩形：${desc}`);
            assert.ok(desc.includes(`宽 ${SPRAY_RECT_HALF_HEIGHT_PX * 2}`),
                `描述里的矩形宽度应为 ${SPRAY_RECT_HALF_HEIGHT_PX * 2}：${desc}`);
            assert.ok(desc.includes('头部'), '描述要点明起点在角色头部');
        }
    }
});

test('102604 凤凰降临：固定 4 颗 90° + 三段伤害（直击 / 爆炸 / 第 26 帧二段），不含火海', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const phoenix = planOf(rows, 102604);
        assert.equal(phoenix.length, 3);
        assert.deepEqual(phoenix.map((row) => Number(row.unlockHeroLevel ?? 0)), [0, 20, 25]);
        assert.deepEqual(phoenix.map((row) => paramsOf(row).damageRate), [2.2, 2.8, 3]);
        assert.deepEqual(phoenix.map((row) => paramsOf(row).impactBurstDamageRate), [1.5, 2, 2.5]);
        assert.deepEqual(phoenix.map((row) => paramsOf(row).impactBurstSecondRate), [1.5, 1.8, 2]);

        for (const row of phoenix) {
            const params = paramsOf(row);
            //  用户拍板「固定 4 颗、4 个方向（相邻 90°）」。`projectileCount` 一配，
            //  102601 的 `bulletNum (+1/+1/+2)` 就不再叠加（见 sendAttack 的 declaredProjectileCount）。
            assert.equal(params.projectileCount, 4);
            //  2026-11-11 第三轮：90（扇形）→ 360（全向均分 0/90/180/270）。
            //  90 那套实测四发全部脱靶（±15° 在 140px 处偏 37.5px > 身圈 27px）。
            assert.equal(params.projectileSpreadDeg, 360);
            assert.equal(params.projectileLifeSeconds, 4, '子弹持续 4 秒');
            assert.equal(params.impactBurstRadius, 100);
            //  「爆炸开始后第 26 帧」@30fps ⇒ 落在 [25/30, 26/30) 这个窗口里。
            //  ⚠️ 不能写 0.8333：`0.8333 × 30 = 24.999` 会被 floor 到 24（第 25 帧），早一帧。
            assert.equal(params.impactBurstSecondDelay, 0.8334);
            assert.equal(params.impactBurstEffectSeconds, 1.0667, '32 帧 @30fps，必须活够整段动画');
            //  用户拍板「就是正文那三下，不再加持续火海」⇒ 不写区域相关键
            assert.equal(params.zoneDuration, undefined);
            assert.equal(params.zoneWaves, undefined);
            assert.equal(Number(row.pvpSkillId), PVP_SKILL_ID, '参数袋按「unitId:普攻 skillId」合并');
            assert.equal(row.skillKind, 'active_cd');
        }
    }
});

test('102604 的「每 8 次普攻」落在 pvpSkill 30181 的强化槽上，武将技指向新的 36182', () => {
    for (const rows of [readTable('pvpSkill'), readClientTable('pvpSkill')]) {
        const basic = rows.find((row) => Number(row.skillId) === PVP_SKILL_ID);
        assert.ok(basic, '缺 pvpSkill 30181');
        assert.equal(Number(basic.empoweredEvery), 8, '主动-累计普攻 8');
        assert.equal(Number(basic.empoweredSkillId), PHOENIX_SKILL_ID);

        const phoenix = rows.find((row) => Number(row.skillId) === PHOENIX_SKILL_ID);
        assert.ok(phoenix, '缺 pvpSkill 36182「凤凰降临」');
        assert.equal(phoenix.mode, 'projectile');
        assert.equal(Number(phoenix.projectileSpeed), 150, '子弹速度 150');
        assert.equal(phoenix.effectPrefabPath, 'units/projectiles/麻辣铁锅_凤凰弹/麻辣铁锅_凤凰弹');
        assert.equal(phoenix.impactEffectPrefabPath, 'units/projectiles/麻辣铁锅_爆炸龙卷/麻辣铁锅_爆炸龙卷');

        //  🔴 不能直接把「火法师_火船」登记进 `ZCCombatEffectScale` 挂 1.5 —— 那条路径
        //     同时被 36181（火法师武将技）使用，会顺手把别人的技能一起放大。
        const battleship = rows.find((row) => Number(row.skillId) === 36181);
        assert.equal(battleship?.effectPrefabPath, 'units/projectiles/火法师_火船/火法师_火船',
            '36181 保持原样，派生副本存在的理由就是不动它');
        const scaleSource = readFileSync(
            join(ROOT, 'assets', 'script', 'app', 'zcds', 'view', 'ZCCombatEffectScale.ts'), 'utf8');
        assert.doesNotMatch(scaleSource, /火法师_火船\/火法师_火船':/,
            '火船不许进倍率表（会连带动 36181）');
    }
});

test('K 表转表产物：102603 / 102604 六行的名字、描述、修改器指针都落地了', () => {
    for (const rows of [readTable('armySkillLevelUp'), readClientTable('armySkillLevelUp')]) {
        const six = rows.filter((row) => [102603, 102604].includes(Number(row.id)));
        assert.equal(six.length, 6);
        for (const row of six) {
            const chainId = Number(row.id);
            assert.equal(row.name, chainId === 102603 ? '喷射火焰' : '凤凰降临');
            assert.ok(String(row.desc).length > 20, `${chainId} L${row.skilllevel} 描述为空`);
            const expected = 94026000 + (chainId === 102603 ? 30 : 40) + Number(row.skilllevel);
            assert.deepEqual(row.modfiy, [expected]);
        }
        //  解锁等级以 K 表为唯一真源（102603 = 9/18/24、102604 = 0/20/25）
        assert.deepEqual(six.filter((row) => Number(row.id) === 102603)
            .map((row) => Number(row.unlockarmylevel)), [9, 18, 24]);
        assert.deepEqual(six.filter((row) => Number(row.id) === 102604)
            .map((row) => Number(row.unlockarmylevel)), [0, 20, 25]);
    }
});

// ────────────────────────────────────────────── 二、特效三件套
//
// 背景：`麻辣铁锅_喷射火焰/`（18 张 png）与 `麻辣铁锅_爆炸龙卷/`（32 张 png）原本**只有散帧**。
// 生成器 = `tools/build_maladi_guo_fx.py`。这一段钉住三件最容易静默失败的事：
//  ① 散图 meta 必须带 `f9941` sprite-frame 子资源（默认导成 `type: texture` 时只有 `@6c48a`，
//     `cc.Sprite._spriteFrame` 引不到 ⇒ **不报错、特效永远不出现**）；
//  ② 帧序 / sample / wrapMode 必须能对上设计案的时间轴；
//  ③ 尺寸要与判定对得上（「看着多大就打多大」）。

function readJsonFile<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function fxDir(name: string): string {
    return join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles', name);
}

interface IPrefabParts {
    readonly node: { _lpos: { x: number; y: number }; _lscale: { x: number } };
    readonly ui: { _contentSize: { width: number; height: number } };
    readonly sprite: { _sizeMode: number; _isTrimmedMode: boolean; _spriteFrame: { __uuid__: string } };
    readonly anim: { _clips: { __uuid__: string }[]; playOnLoad: boolean };
}

function prefabParts(dir: string, name: string): IPrefabParts {
    const doc = readJsonFile<Array<Record<string, any>>>(join(dir, `${name}.prefab`));
    const pick = (type: string): any => {
        const found = doc.find((item) => item.__type__ === type);
        assert.ok(found, `${name}.prefab 缺 ${type}`);
        return found;
    };
    return { node: pick('cc.Node'), ui: pick('cc.UITransform'), sprite: pick('cc.Sprite'), anim: pick('cc.Animation') };
}

interface IAnimParts {
    sample: number;
    wrapMode: number;
    _duration: number;
    _tracks: Array<{ _channel: { _curve: { _times: number[]; _values: Array<{ __uuid__: string }> } } }>;
}

function animParts(dir: string, clip: string): IAnimParts {
    const clipPath = join(dir, 'anim', `${clip}.anim`);
    assert.ok(existsSync(clipPath), `缺动画：${clipPath}`);
    return readJsonFile<IAnimParts>(clipPath);
}

test('特效三件套：喷射火焰 / 爆炸龙卷 / 凤凰弹 都齐备，且路径就是代码与配表里写的那个', () => {
    for (const name of ['麻辣铁锅_喷射火焰', '麻辣铁锅_爆炸龙卷']) {
        const dir = fxDir(name);
        for (const relative of [`${name}.prefab`, `${name}.prefab.meta`, `atlas`, `atlas/${name}.pac`,
            `atlas/${name}.pac.meta`, `anim`]) {
            assert.ok(existsSync(join(dir, relative)), `缺 ${name}/${relative}`);
        }
        //  自动图集的三处开关必须 false：编辑器没重新 import 过手写 meta，
        //  取 true 会把散图从 bundle 摘掉，运行时贴图与图集两头都取不到。
        const pacMeta = readJsonFile<any>(join(dir, 'atlas', `${name}.pac.meta`));
        assert.equal(pacMeta.userData.filterUnused, false);
        assert.equal(pacMeta.userData.removeTextureInBundle, false);
        assert.equal(pacMeta.userData.removeImageInBundle, false);
    }

    //  凤凰弹是「只有 prefab、不含新图」的派生副本
    const phoenix = prefabParts(fxDir('麻辣铁锅_凤凰弹'), '麻辣铁锅_凤凰弹');
    assert.equal(existsSync(join(fxDir('麻辣铁锅_凤凰弹'), '麻辣铁锅_凤凰弹.prefab.meta')), true);
    assert.equal(phoenix.sprite._sizeMode, 0);
    assert.ok(phoenix.node._lscale.x > 0);
});

test('喷射火焰：39 帧 / sample 12 / 一次性播完 3.25s，350px 定长度、尾部钉在施法者脚下、尖端压在矩形最远缘', () => {
    const dir = fxDir('麻辣铁锅_喷射火焰');
    const clip = animParts(dir, '麻辣铁锅_喷射火焰');
    const prefab = prefabParts(dir, '麻辣铁锅_喷射火焰');
    const frames = clip._tracks[0]._channel._curve._values;

    //  帧序 = 原 18 帧 + 「循环帧 11~17」× 3 = 39 帧（设计案：「当需要延长时间时使用循环帧 11-17」）
    assert.equal(frames.length, 39);
    assert.equal(clip.sample, 12);
    assert.equal(clip.wrapMode, 1, '一次性播完，停在末帧（由区域到期整体摘掉）');
    assert.equal(clip._duration, 3.25);
    assert.ok(clip._duration > 3, '必须比光环的 3 秒略长，否则动画会「停在最后一帧上僵住」');
    //  第 19 帧起进入循环段：帧 11 的 uuid 与第 1 帧之后第一次出现的循环首帧相同
    assert.deepEqual(frames.slice(0, 18).map((item) => item.__uuid__).length, 18);
    assert.notEqual(frames[17].__uuid__, frames[18].__uuid__, '第 19 帧是循环段的第一帧（原第 11 帧）');
    assert.equal(frames[18].__uuid__, frames[25].__uuid__, '循环段 7 帧一圈');

    //  ── 尺寸与摆位（2026-11-12 第七轮重算：距离定长度）──
    //  画布 = 原图裁切后的一半（`sizeMode 0` 自定义尺寸、`trimType none` ⇒ 1 画布 px = 2 源图 px）。
    //  裁切左边跟着**稳态尾部**走（226 源 px），所以画布只剩 222 宽 —— 那 170 源 px 的透明空档不再打进图集。
    const canvas = prefab.ui._contentSize;
    assert.equal(canvas.width, 222);
    assert.equal(canvas.height, 168);

    //  ① 缩放**反算**：可见长度 210.5 画布 px 要变成 350 逻辑 px（= 屏上 269.06px）
    //     ⇒ 缩放 1.278207。不再是第五轮那个「自然尺寸 1」。
    const scale = prefab.node._lscale.x;
    assert.ok(Math.abs(scale - SPRAY_SCALE) < 1e-6,
        `缩放必须是 ${SPRAY_SCALE.toFixed(6)}（实际 ${scale.toFixed(6)}）`);
    assert.ok(Math.abs(SPRAY_VISIBLE_SPAN_PX - 210.5) < 1e-9);

    //  ② 触发距离 = 350 逻辑 px（用户口径），**必须小于普攻射程**（550 表值，折后 495）。
    assert.equal(SPRAY_REACH_LOGIC_PX, 350);
    assert.ok(SPRAY_REACH_LOGIC_PX < 550 * 0.9, '触发出手距离必须比普攻近');
    assert.equal(SPRAY_AURA_FORWARD, 175);

    //  ③ 锚点：宿主节点摆在**矩形中心**（= 身前 175 逻辑 px = 屏上 134.531px）上，
    //     `_lpos` 是**本地偏移**（跟着宿主旋转）。画布锚点 0.5 ⇒ 左边缘在本地 −111×scale。
    //     稳态尾部在源 x=238 → 裁切框左边 226 ⇒ 画布 x = (238−226)/2 = 6。
    const halfWidth = canvas.width / 2;
    const centerScreenX = SPRAY_AURA_FORWARD * SCREEN_PX_PER_LOGIC_PX;  // 判定圆心 = 宿主节点位置
    const tailLocalX = (6 - halfWidth) * scale;                          // 可见左缘 = 火焰尾部
    const tailScreenX = centerScreenX + prefab.node._lpos.x + tailLocalX;
    assert.ok(Math.abs(tailScreenX) < 1e-3,
        `火焰尾部必须精确落在施法者脚点 x=0（实际 ${tailScreenX.toFixed(3)}px）`);

    //  ④ 尾部 **本地 y 必须是 0**：宿主每帧 `setRotationFromEuler(朝向)`，本地 +y 会变成
    //     「垂直于火焰的侧移」—— 只有 0 才在任何朝向下都贴着施法者。
    //     竖直抬到头部由 `auraVisualLiftPx = 97` 在视图层 `mapToViewY` 之后补。
    //     尾部窗 alpha 重心在画布 y=73（自上而下），锚点 0.5 ⇒ 相对中心是本地 +11×scale，
    //     所以 `_lpos.y = −11×scale` 正好把它按回本地 y=0。
    const tailLocalY = (canvas.height / 2 - 73) * scale;
    assert.ok(Math.abs(tailLocalY - 11 * scale) < 1e-6);
    assert.ok(Math.abs(prefab.node._lpos.y + 11 * scale) < 1e-3,
        `根节点 _lpos.y 必须是 −${(11 * scale).toFixed(3)}（实际 ${prefab.node._lpos.y.toFixed(3)}）`);
    assert.ok(Math.abs(prefab.node._lpos.y + tailLocalY) < 1e-3,
        `尾部本地 y 必须为 0（实际 ${(prefab.node._lpos.y + tailLocalY).toFixed(3)}）`);

    //  ⑤ 尖端 = 稳态最右缘 ⇒ 正好铺到矩形最远缘 350 逻辑 px（矩形从脚点 0 一路覆盖到 350，
    //     所以火焰整条都落在判定里，不再有第七轮那种「圆在 250~350、前面 250 是摆设」）。
    const tipScreenX = centerScreenX + prefab.node._lpos.x + (SPRAY_VISIBLE_SPAN_PX + 6 - halfWidth) * scale;
    const reachScreen = SPRAY_REACH_LOGIC_PX * SCREEN_PX_PER_LOGIC_PX;
    assert.ok(Math.abs(tipScreenX - reachScreen) < 0.5,
        `火焰尖端要压在矩形最远缘（${reachScreen.toFixed(2)}px），实际 ${tipScreenX.toFixed(2)}px`);
});

test('爆炸龙卷：32 帧 / sample 30 / 第 26 帧就是二段伤害的落点（0.8333s）', () => {
    const dir = fxDir('麻辣铁锅_爆炸龙卷');
    const clip = animParts(dir, '麻辣铁锅_爆炸龙卷');
    const prefab = prefabParts(dir, '麻辣铁锅_爆炸龙卷');
    assert.equal(clip._tracks[0]._channel._curve._values.length, 32);
    //  sample 取 30（不是项目常见的 12）：这样「第 26 帧」与配表秒数才是同一条时间轴，
    //  与 `磁电菇_劈雷技能` 取 30 完全同一个理由。
    assert.equal(clip.sample, 30);
    assert.equal(clip.wrapMode, 1, '一次性，停在余烬那几帧');
    assert.ok(Math.abs(clip._duration - 32 / 30) < 1e-6);

    //  「第 N 帧」= 下标 N-1（与五雷「第 5 帧 ⇒ 4/30」同一条换算）。
    const secondDelay = 0.8334;
    assert.equal(Math.floor(secondDelay * clip.sample), 25, '配表的二段延迟必须落在下标 25（第 26 帧）');
    assert.ok(secondDelay >= 25 / clip.sample && secondDelay < 26 / clip.sample,
        '二段延迟必须落在「第 26 帧」的显示窗口 [25/30, 26/30) 内');
    //  爆炸表现必须活够整段动画，否则动画会被 `ZCGameModel` 提前摘掉
    const phoenixParam = readTable('pvpSkillPlan')
        .filter((row) => String(row.unitId) === UNIT_ID && Number(row.skillChainId) === 102604)
        .map(paramsOf);
    for (const params of phoenixParam) {
        assert.ok(params.impactBurstEffectSeconds + 1e-6 >= clip._duration,
            'impactBurstEffectSeconds 短于动画总长 ⇒ 爆炸会被截断');
    }

    //  尺寸：判定半径 100 逻辑 px ⇒ 屏上直径 153.75px
    assert.equal(prefab.ui._contentSize.width, 449);
    assert.equal(prefab.ui._contentSize.height, 412);
    const scale = prefab.node._lscale.x;
    assert.ok(Math.abs(437 * scale - 100 * 2 * SCREEN_PX_PER_LOGIC_PX) < 0.5);
});

test('凤凰弹：火船的 1.5 倍派生副本，复用同一份 clip 与散图 uuid', () => {
    const phoenix = prefabParts(fxDir('麻辣铁锅_凤凰弹'), '麻辣铁锅_凤凰弹');
    const battleship = prefabParts(fxDir('火法师_火船'), '火法师_火船');
    //  原 1.733333 × 1.5 = 2.6；2026-11-11 第三轮用户口径「体型缩小成 25%」⇒ 2.6 × 0.25 = 0.65
    assert.ok(Math.abs(phoenix.node._lscale.x - battleship.node._lscale.x * 1.5 * 0.25) < 1e-6,
        '派生倍率 = 火船 × 1.5（派生）× 0.25（第三轮缩小）');
    assert.ok(Math.abs(phoenix.node._lscale.x - 0.65) < 1e-6, '凤凰弹体型 = 原来的 25%');
    //  复用同一份动画（不复制图集）
    assert.deepEqual(phoenix.anim._clips[0].__uuid__, battleship.anim._clips[0].__uuid__);
    assert.deepEqual(phoenix.sprite._spriteFrame.__uuid__, battleship.sprite._spriteFrame.__uuid__);
    //  派生副本目录里不该有图片
    const pngs = readdirSync(fxDir('麻辣铁锅_凤凰弹')).filter((entry) => entry.endsWith('.png'));
    assert.deepEqual(pngs, [], '派生副本只该有 prefab + meta，图集复用火船那份');
});

test('🔴 每个散图 meta 都要有 f9941 子资源（type 必须是 sprite-frame）', () => {
    for (const name of ['麻辣铁锅_喷射火焰', '麻辣铁锅_爆炸龙卷']) {
        const atlas = join(fxDir(name), 'atlas');
        const pngs = readdirSync(atlas).filter((entry) => entry.endsWith('.png'));
        assert.ok(pngs.length > 0, `${name} 没有散图`);
        const uuids = new Set<string>();
        for (const png of pngs) {
            const meta = readJsonFile<any>(join(atlas, `${png}.meta`));
            assert.equal(meta.userData.type, 'sprite-frame', `${png} 不是 sprite-frame`);
            assert.ok(meta.subMetas.f9941, `${png} 缺 f9941 子资源 ⇒ 特效永远不出现`);
            const frame = meta.subMetas.f9941.userData;
            assert.equal(frame.rawWidth, frame.width, '必须整帧不裁剪（trimType: none）');
            assert.equal(frame.trimType, 'none');
            uuids.add(meta.uuid);
        }
        //  动画里引用的每一帧都必须在这批 uuid 里
        const clip = animParts(fxDir(name), name);
        for (const value of clip._tracks[0]._channel._curve._values) {
            assert.ok(uuids.has(value.__uuid__.split('@')[0]), `${name} 动画引用了不存在的帧 ${value.__uuid__}`);
            assert.ok(value.__uuid__.endsWith('@f9941'), '引用必须带 @f9941（spriteFrame 子资源）');
        }
    }
});

// ────────────────────────────────────────────── 三、资源计划与代码接线

test('喷射火焰按单位覆盖自身光环造型，且被收进本局特效清单', () => {
    const sprayPath = zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, UNIT_ID);
    assert.equal(sprayPath, 'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰');
    //  68016 的磁电冲击不受影响
    assert.equal(zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, '68016'),
        'units/projectiles/雷电冲击/雷电冲击');
    //  缺省单位仍走老光柱
    assert.equal(zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, '68025'),
        'units/projectiles/持续光环伤害效果/持续光环伤害效果');
    assert.equal(zcSelfAuraEffectPath('bolt_strike', UNIT_ID), null);

    const unitOf = (path: string) => ({
        unitId: UNIT_ID,
        prefabPath: 'skel/麻辣铁锅/麻辣铁锅',
        attackProfile: { effectPrefabPath: 'units/projectiles/火法师_新子弹/火法师_新子弹', impactEffectPrefabPath: null },
        empoweredProfile: {
            effectPrefabPath: 'units/projectiles/麻辣铁锅_凤凰弹/麻辣铁锅_凤凰弹',
            impactEffectPrefabPath: 'units/projectiles/麻辣铁锅_爆炸龙卷/麻辣铁锅_爆炸龙卷',
        },
    });
    const plan = buildZCVisualResourcePlan([unitOf(UNIT_ID) as any], {
        skillPlans: [{ enabled: true, unitId: UNIT_ID, behaviorKey: 'self_aura' }],
        textOverrides: new Map(),
    });
    const paths = plan.effectPaths;
    //  三条新特效全都得进清单：漏收 ⇒ `ZCGameLoader` 不加载 ⇒ 技能照常结算、屏幕上一片空白且不报错
    assert.ok(paths.includes('units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰'), '漏收喷射火焰');
    assert.ok(paths.includes('units/projectiles/麻辣铁锅_凤凰弹/麻辣铁锅_凤凰弹'), '漏收凤凰弹');
    assert.ok(paths.includes('units/projectiles/麻辣铁锅_爆炸龙卷/麻辣铁锅_爆炸龙卷'),
        '漏收爆炸龙卷（它挂在武将技行的 impactEffectPrefabPath 上，只收普攻行会漏）');
});

test('代码接线：悬空高度 / 二段爆炸 / 帧序常量都在正确的地方被读', () => {
    const attack = readFileSync(
        join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'systems', 'ZCAttackResolutionSystem.ts'), 'utf8');
    //  施法者悬空：从区域参数读，写进区域状态
    assert.match(attack, /casterLiftPx/, 'castSelfAura 没读 casterLiftPx ⇒ 102603 不会跳起来');
    //  命中爆炸：四个新键都要被读
    for (const key of ['impactBurstRadius', 'impactBurstDamageRate', 'impactBurstSecondRate', 'impactBurstSecondDelay']) {
        assert.match(attack, new RegExp(key), `sendAttack 没读 ${key}`);
    }
    //  固定颗数不许被 bulletNum 叠加（102601 的 +2 不能把 102604 的 4 颗变成 6 颗）
    assert.match(attack, /declaredProjectileCount/);
    assert.match(attack, /patch\.bulletNumFlat && declaredProjectileCount <= 0/);

    const view = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'view', 'ZCUnitView.ts'), 'utf8');
    assert.match(view, /castLiftPx/, 'ZCUnitView 没读 castLiftPx');
    assert.match(view, /visualBaseOffsetY/, '悬空高度必须叠加在基准偏移上，不能直接覆盖 visualRoot 的 y');

    const world = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'view', 'ZCGameRenderWorld.ts'), 'utf8');
    assert.match(world, /castLiftByUnit/, '渲染层没把区域的 casterLiftPx 传给单位视图');

    //  快照校验要认新字段（这几项决定伤害，退不出快照 = 联机两端结算不一致）
    const codec = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['burstRadius', 'burstDamage', 'burstSecondDamage', 'burstSecondDelay', 'casterLiftPx']) {
        assert.match(codec, new RegExp(`${key}`), `ZCSnapshotCodec 没校验 ${key}`);
    }
});

// ────────────────────────────────────────────── 三、矩形判定：从脚点到 350（2026-11-12 第八轮）
//
// 第七轮的圆形（`auraForward 300 ± 半径 50`）只覆盖 250~350，敌人贴脸时技能会放、却打不到。
// 用户口径「改矩形：加 auraRectHalfHeight（半长跟随 auraRadius），像磁电冲击 101604 那样
// 做成从脚点到 350 的锥/矩形」⇒ 半长 175 + 中心前移 175，沿朝向覆盖 0~350。

test('喷射火焰的矩形判定：沿朝向覆盖 0~350、横向 ±70，贴脸也打得到', () => {
    //  `zcGroundZoneReaches` 收的是**世界 px**（表值 × combatDistanceScale 0.3）。
    const scale = 0.3;
    const forward = SPRAY_AURA_FORWARD * scale;          // 52.5
    const halfLength = SPRAY_RADIUS_LOGIC_PX * scale;    // 52.5（半长缺省跟随 radius）
    const halfHeight = SPRAY_RECT_HALF_HEIGHT_PX * scale; // 21
    const zone = {
        x: forward, y: 0, radius: halfLength,
        rectHalfHeight: halfHeight,
        rectHalfLength: undefined,
        angleDegrees: 0,
    };

    //  ① 贴脸（脚点）：第七轮的圆在这里判 false，矩形必须是 true。
    assert.equal(zcGroundZoneReaches(zone, 0, 0), true, '脚点（距离 0）必须被覆盖');
    assert.equal(zcGroundZoneReaches(zone, forward - halfLength, 0), true, '矩形左边缘 = 0');
    //  ② 尖端：正好 350 表值 = 105 世界，含等于。
    assert.equal(zcGroundZoneReaches(zone, forward + halfLength, 0), true, '右边缘 = 350');
    assert.equal(zcGroundZoneReaches(zone, forward + halfLength + 0.01, 0), false, '超过 350 打不到');
    //  ③ 横向：±70 表值 = ±21 世界，含等于，多 0.01 就出圈。
    assert.equal(zcGroundZoneReaches(zone, forward, halfHeight), true, '横向到边');
    assert.equal(zcGroundZoneReaches(zone, forward, halfHeight + 0.01), false, '横向出圈');
    //  ④ 粗筛半径必须是外接圆：hypot(52.5, 21) ≈ 56.55 > 半长 52.5，否则尖端附近的人会被漏掉。
    assert.ok(Math.abs(zcGroundZoneBroadRadius(zone) - Math.hypot(halfLength, halfHeight)) < 1e-9);
    assert.ok(zcGroundZoneBroadRadius(zone) > halfLength);

    //  ⑤ 旋转：朝上（-90°）时「脚点 → 350」沿 -y 展开，横向沿 ±x。
    const up = { ...zone, y: -forward, x: 0, angleDegrees: -90 };
    assert.equal(zcGroundZoneReaches(up, 0, 0), true, '-90° 时脚点仍被覆盖');
    assert.equal(zcGroundZoneReaches(up, 0, -(forward + halfLength)), true, '-90° 时尖端仍在 350');
    assert.equal(zcGroundZoneReaches(up, halfHeight, -forward), true, '横向 ±21 世界');
    assert.equal(zcGroundZoneReaches(up, halfHeight + 0.01, -forward), false, '横向出圈');
});
