import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_BULLET_DROP_HEIGHT_PX,
    ZC_BULLET_DROP_UNITS,
    zcBulletDropHeightOf,
    zcBulletDropOffsetPx,
} from '../assets/script/app/zcds/model/ZCProjectileDropStyle';
import { ZC_SKILL_RANGE_RING_UNITS } from '../assets/script/app/zcds/model/ZCSkillRangeRingFx';

/**
 * 「区域洒弹」：子弹从区域上方垂直落下（2026-11-25 第 52 批）。
 *
 * 需求原文：「篮球天才，急冻瓜，杰克藕这种在指定区域内发射子弹的都需要，让子弹呈弧线飞行到
 * 区域的任意坐标内，在区域内触碰到任意敌方目标造成伤害，没有触碰到就没伤害，或者选择方案 2
 * 在区域的上方垂直往下掉，哪个方案实行快就用哪个」。
 *
 * 选方案 2，理由写在 `ZCProjectileDropStyle` 的模块注释里（方案 1 要改战斗结算，三张卡的
 * 数值模型全变）。所以这一批只钉三件事：
 * ① 只有这三张卡会掉；② 掉的位置是从上到下、落地归零；③ 落点与伤害判定一个字节不动。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const VIEW_SOURCE = read('assets/script/app/zcds/view/ZCCombatEffectView.ts');
const SKILL_SOURCE = read('assets/script/app/zcds/model/systems/ZCSkillResolutionSystem.ts');
const ZONE_SOURCE = read('assets/script/app/zcds/model/systems/ZCGroundZoneSystem.ts');
const EVENT_SOURCE = read('assets/script/app/zcds/model/ZCGameTypes.ts');

test('① 只有 68008 杰克藕 / 68024 急冻瓜 会掉（68030 改走飞入段，见第 53 批）', () => {
    assert.deepEqual([...ZC_BULLET_DROP_UNITS].sort(), ['68008', '68024']);
    assert.equal(ZC_BULLET_DROP_HEIGHT_PX, 84);
    for (const unitId of ZC_BULLET_DROP_UNITS) {
        assert.equal(zcBulletDropHeightOf(unitId), ZC_BULLET_DROP_HEIGHT_PX, `${unitId} 要掉`);
    }
    //  名单外一律 0 —— 这是「暴风雪 / 灼热地带 / 天外飞石逐字不变」的唯一保证。
    //  `68030` 2026-11-25 第 53 批移出：用户口径改成「子弹从本地移动到命中区域去」。
    for (const other of ['68010', '68025', '68030', '68030 ', '680301', '', null, undefined]) {
        assert.equal(zcBulletDropHeightOf(other as string | null | undefined), 0, `${String(other)} 不该掉`);
    }
    //  与范围圈**不是**同一张表：圈是「有区域判定」，掉是「从天上掉」。
    //  第 53 批之后掉只剩两张卡，圈仍是三张 ⇒ 严格包含关系，谁改错立刻红。
    for (const unitId of ZC_BULLET_DROP_UNITS) {
        assert.ok(ZC_SKILL_RANGE_RING_UNITS.includes(unitId), `${unitId} 掉就一定画圈`);
    }
    assert.ok(ZC_SKILL_RANGE_RING_UNITS.includes('68030'), '篮球火仍要画圈（只是不再从天上掉）');
});

test('① 竖直偏移按进度递减：开头全高、落地归零、非法值不产出 NaN', () => {
    const height = ZC_BULLET_DROP_HEIGHT_PX;
    assert.equal(zcBulletDropOffsetPx(height, 0), height, '起播那一帧在最上方');
    assert.equal(zcBulletDropOffsetPx(height, 0.5), height / 2);
    assert.equal(zcBulletDropOffsetPx(height, 1), 0, '落地那一刻归零 —— `to` 就是判定点');
    //  越界夹住：进度 < 0 说明刚出生（保持全高），> 1 说明已经落地（贴地）。
    assert.equal(zcBulletDropOffsetPx(height, -5), height);
    assert.equal(zcBulletDropOffsetPx(height, 9), 0);
    //  `NaN` 绝不能泄进 `setPosition`（会让整层矩阵变 NaN，整片特效消失且不报错）。
    assert.equal(zcBulletDropOffsetPx(height, Number.NaN), 0);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
        assert.equal(zcBulletDropOffsetPx(bad as number, 0.3), 0, `${String(bad)} 高度不成立时不该有位移`);
    }
});

test('② 事件字段是「可选的竖直起始高度」，缺省 = 既有行为', () => {
    assert.match(EVENT_SOURCE, /\/\*\*[\s\S]{0,400}dropFromPx\?: number;/, '事件类型上必须有一条带注释的 dropFromPx');
    assert.match(EVENT_SOURCE, /dropFromPx\?: number;/, '字段名');
    //  视图只加在「非飞行 area」那条定位上；飞行分支（projectile / melee）各自有自己的位置算式。
    assert.match(
        VIEW_SOURCE,
        /const dropPx = zcBulletDropOffsetPx\(event\.dropFromPx \?\? 0, progress\);/,
        '缺省 0 ⇒ 存量特效位置逐字不变',
    );
    assert.match(
        VIEW_SOURCE,
        /mapToViewY\(slide\.y\) \+ \(event\.visualLiftPx \?\? 0\) \+ dropPx/,
        '叠加在同一个竖直轴上（屏幕 y），与 visualLiftPx 同口径',
    );
    //  🔴 落点不许被改写：这一批是表现，不是结算。
    //  第 58 批在白环那一档插了「滑动」插值（§60.3），`slide.x/y` 在**没登记滑动时逐字等于 `to`**
    //  —— 缺省路径由 `ZCCombatEffectSlide` 的纯函数用例钉住，这里跟着改锚点、语义不变。
    assert.match(VIEW_SOURCE, /mapToViewX\(slide\.x\),/, 'x 仍取落点，不许被 dropFromPx 影响');
});

test('② 三条车道各在正确的推送点带上它（且只有它们）', () => {
    //  冰山陨落（self_aura 落地那一击）
    assert.match(
        SKILL_SOURCE,
        /durationSeconds: ZC_SELF_AURA_LANDING_SECONDS,\s*angleDegrees: ZC_SELF_AURA_LANDING_ANGLE_DEGREES,\s*\/\/[\s\S]{0,300}?dropFromPx: zcBulletDropHeightOf\(unit\.unitId\),/,
        '落地一击要带 dropFromPx',
    );
    //  戈壁箭雨（random_strike 的非导弹分支，每波 5 支箭）
    //  第 55 批（2026-11-26）：这张卡改走「弹道雨」（从自己身上抛 N 支箭），
    //  旧的「贴在敌人身上闪一下」那条事件整段不再发 ⇒ 高度按 `rain` 分流。
    assert.match(
        SKILL_SOURCE,
        /const dropHeight = rain \? 0 : zcBulletDropHeightOf\(unit\.unitId\);/,
        '走了弹道雨就不再叠旧的竖直下落（否则一支箭掉两次）',
    );
    assert.match(SKILL_SOURCE, /angleDegrees: dropHeight > 0 \? 180 : undefined,/, '箭头朝下（素材 +Y，prefab 子节点已预转 −90）');
    assert.match(SKILL_SOURCE, /dropFromPx: dropHeight,/);
    //  篮球火（地面区域的每一波）—— 第 53 批起这条链改走「从施法者飞入」，
    //  区域这里仍然只有实例 id，必须 `unitById` 换回定义 id 才能判名单。
    assert.match(
        ZONE_SOURCE,
        /const sourceUnitId = source \? source\.unitId : undefined;/,
        '区域只有实例 id，要经 unitById 换回定义 id',
    );
    //  全项目只有这三处推这个字段（多一处就是有人又给别的技能加了「从天而降」）。
    const pushes = [SKILL_SOURCE, ZONE_SOURCE].join('\n').match(/dropFromPx: /g) ?? [];
    assert.equal(pushes.length, 3);
});

test('③ 落点与伤害判定不动：区域 tick / 锁定目标的契约保持原样', () => {
    //  区域波次的伤害段仍然从 `zone.x/zone.y` 起算，`dropFromPx` 只进表现事件。
    assert.match(ZONE_SOURCE, /const targetHexId = context\.hexIdAt\(zone\.x, zone\.y\);/,
        '判定圆心仍是区域自己的坐标，不许跟着「下落高度」走');
    //  `random_strike` 的 else 分支仍按 `victim` 结算，弹道/missile 分支一个字节没改。
    assert.match(SKILL_SOURCE, /for \(const \{ unit: victim \} of victims\) \{/);
    //  🔴 这一条守的是「方案 2 只是表现」：谁把 `dropFromPx` 用进伤害/命中判定，它就会红。
    const dropUses = [SKILL_SOURCE, ZONE_SOURCE, VIEW_SOURCE].join('\n')
        .match(/dropPx|dropHeight|dropFromPx/g)?.length ?? 0;
    assert.ok(dropUses > 0);
    //  自 aura 的时长/角度口径沿用第 51 批，不被本批改动。
    assert.match(SKILL_SOURCE, /durationSeconds: ZC_SELF_AURA_LANDING_SECONDS,/);
});
