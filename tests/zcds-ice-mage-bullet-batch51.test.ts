import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_EFFECT_BEHAVIOR_KEYS,
    ZC_EFFECT_PATHS,
    zcEffectFacingOffsetOf,
    zcEffectFlightOf,
    zcEffectLayerOfPath,
    zcEffectMissileOf,
    zcEffectNodeScaleOf,
    zcSelfAuraLandingPath,
    zcWarmupEffectPaths,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_EFFECT_SCALE } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { zcCombatEffectFacingDegrees, zcCombatEffectFlightOf } from '../assets/script/app/zcds/model/ZCCombatEffectFlight';

/**
 * 冰法师通用子弹（2026-11-25 第 51 批）。
 *
 * 需求原文：「急冻瓜的【冰山陨落】【急冻光线】都使用新的冰法师通用子弹特效，制作格式一致的
 * 预制体，飞行中是循环的序列帧，普通子弹飞行时箭头的方向朝向目标，特殊技能垂直下落的子弹时
 * 是箭头方向直线下落，急冻光线使用特效不用拉长，直接当场急冻子弹使用，不用改技能名称」。
 *
 * 拆成四条硬口径：
 * ① 两个 prefab 与既有弹体**格式一致**（两级节点 + 循环序列帧 + CUSTOM/不裁切）；
 * ② 素材正前方是 **+Y** ⇒ 弹道要补 −90°、落地要转 180°，两者必须自洽（都是"箭头朝飞行方向"）；
 * ③ 【急冻光线】真的飞（登记 missile）而不是原地闪一下；【冰山陨落】沿用落地那一击；
 * ④ 尺寸只由 prefab 的 `_lscale` 定，**不按弹道距离拉长**；且 ~8MB 不进首包预热。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const PROJECTILES = 'assets/bundles/battle/units/projectiles';
const BULLET = `${PROJECTILES}/冰法师通用子弹`;
const IMPACT = `${PROJECTILES}/冰法师通用子弹命中`;
const VIEW_SOURCE = read('assets/script/app/zcds/view/ZCCombatEffectView.ts');

/**
 * 生成脚本的裁切口径（`tools/build_ice_mage_bullet_fx.py` 的 `SETS`）。
 *
 * 这些数不是随手写的：`union` 是逐帧 alpha>8 框的**并集**（逐帧裁会抖），
 * `canvas_h` 固定 256（长边），宽 = round(并集宽 × 256 / 并集高)。
 * 素材换图后重跑脚本，这几格和用例会一起红 —— 那正是要重新量的时候。
 */
const SPECS = [
    { dir: BULLET, name: '冰法师通用子弹', frames: 7, sample: 24, union: [280, 575], scale: 0.3 },
    { dir: IMPACT, name: '冰法师通用子弹命中', frames: 13, sample: 12, union: [461, 672], scale: 0.5 },
] as const;

/* ------------------------------------------------ ① 格式与既有弹体一致 */

test('① 两个 prefab 都是两级节点（根 + offset），尺寸与循环序列帧烘焙在 prefab 上', () => {
    for (const spec of SPECS) {
        const prefab = JSON.parse(read(`${spec.dir}/${spec.name}.prefab`)) as Record<string, unknown>[];
        const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
        assert.equal(nodes.length, 2, `${spec.name} 必须是「根 Node + offset」两级，与既有弹体同构`);
        const [root, offset] = nodes as Record<string, unknown>[];
        assert.equal((root._lscale as { x: number }).x, 1, '根节点只做分组，尺寸在子节点');
        assert.equal((offset._lscale as { x: number }).x, spec.scale, '尺寸唯一出口 = offset._lscale');
        assert.equal((root._lpos as { y: number }).y, 0, '弹体不抬高（抬升只走事件级 visualLiftPx）');

        //  画布 = 并集框按长边 256 等比。逐帧裁会抖，所以两个 Set 都按并集。
        const width = Math.round(spec.union[0] * 256 / spec.union[1]);
        const transform = prefab.find((item) => item.__type__ === 'cc.UITransform') as Record<string, any>;
        assert.deepEqual(
            [transform._contentSize.width, transform._contentSize.height],
            [width, 256],
            `${spec.name} 的 UITransform 必须等于裁切后的画布`,
        );
        //  🔴 `_sizeMode = 0 (CUSTOM)` + `_isTrimmedMode = false`：逐帧换图不跟着新图变形（§1.5）。
        const sprite = prefab.find((item) => item.__type__ === 'cc.Sprite') as Record<string, any>;
        assert.equal(sprite._sizeMode, 0);
        assert.equal(sprite._isTrimmedMode, false);

        const anim = JSON.parse(read(`${spec.dir}/anim/${spec.name}-loop.anim`)) as Record<string, any>;
        assert.equal(anim.wrapMode, 2, '飞行中是**循环**的序列帧（用户口径）');
        assert.equal(anim.sample, spec.sample);
        const values = anim._tracks[0]._channel._curve._values;
        assert.equal(values.length, spec.frames, `${spec.name} 帧数`);
        assert.ok(Math.abs(anim._duration - spec.frames / spec.sample) < 1e-6, '时长 = 帧数 / 采样');

        const animation = prefab.find((item) => item.__type__ === 'cc.Animation') as Record<string, any>;
        assert.equal(animation.playOnLoad, false, '由 ZCCombatEffectView 起播，不许 onLoad 自动播');
        assert.equal(animation._defaultClip.__uuid__, animation._clips[0].__uuid__);
        //  图集是自动图集（散图不进包），与 `战士通用剑气` 同一套设置。
        assert.match(read(`${spec.dir}/atlas/${spec.name}.pac`), /cc\.SpriteAtlas/);
        assert.equal(read(`${spec.dir}/atlas/${spec.name}.pac.meta`).includes('"removeImageInBundle": true'), true);
    }
});

/* ------------------------------------------- ② 朝向：素材正前方是 +Y */

test('② 素材正前方 +Y ⇒ 弹道补 −90°、落地转 180°，两者自洽（都指向飞行方向）', () => {
    //  逐帧量 alpha>8 的框可证：第 0 帧是 200×200 的冰爆贴上方（y=46），
    //  之后内容只往下长（y 到 581）⇒ 冰爆头在上、尾迹在下 ⇒ 正前方 = +Y（屏幕向上）。
    const offset = zcEffectFacingOffsetOf(ZC_EFFECT_PATHS.iceMageBullet);
    assert.equal(offset, -90, '素材 90° 对齐到弹道 θ 要减 90');

    //  水平飞：弹道朝右（0°）⇒ 转 −90 ⇒ 素材的「上」转到右边 = 冰爆头朝目标。
    const flight = zcCombatEffectFlightOf(ZC_EFFECT_PATHS.iceMageBullet);
    assert.equal(zcCombatEffectFacingDegrees(0, flight), -90);
    //  弹道朝上（90°）⇒ 0°，即素材原样朝上；朝左下（−135°）⇒ −225 ≡ 135°。
    assert.equal(zcCombatEffectFacingDegrees(90, flight), 0);
    assert.equal(zcCombatEffectFacingDegrees(-135, flight), -225);

    //  垂直下落：事件级角度（不查表）⇒ 必须单独给 180°。
    assert.equal(ZC_EFFECT_SCALE.selfAuraLandingAngleDegrees, 180, '旧值 −90 是给「正前方 +X」的冰锥用的');

    //  🔴 自洽性：两条路算出的「箭头最终朝向」必须都是 180°（= 屏幕向下）。
    //  弹道朝下（−90）+ offset（−90）= −180 ≡ 180 ⇒ 与落地那条完全一致。
    const downward = ((zcCombatEffectFacingDegrees(-90, flight) % 360) + 360) % 360;
    const landing = ((ZC_EFFECT_SCALE.selfAuraLandingAngleDegrees % 360) + 360) % 360;
    assert.equal(downward, 180, '水平体系算出来的「朝下」是 180°');
    assert.equal(landing, 180, '落地那条也必须是 180° —— 两者指的是同一个朝向');
});

test('② 冰山陨落换的是弹体本身，落地那一击的时长仍是手填的事件寿命', () => {
    assert.equal(zcSelfAuraLandingPath(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, '68024'), ZC_EFFECT_PATHS.iceMageBullet,
        '两条技能共用同一颗子弹才叫「都用新的冰法师通用子弹」');
    //  别的自身光环单位不受影响（火焰光环 / 雷电冲击 / 喷射火焰都不该有落地一击）。
    for (const other of ['68025', '68016', '68026', undefined]) {
        assert.equal(zcSelfAuraLandingPath(ZC_EFFECT_BEHAVIOR_KEYS.selfAura, other), null);
    }
    //  非 self_aura 车道一律没有。
    assert.equal(zcSelfAuraLandingPath('random_strike', '68024'), null);
    //  0.5s 是事件寿命（决定什么时候摘节点），不是 clip 时长（7 帧 @24 只有 0.292s/轮）。
    assert.equal(ZC_EFFECT_SCALE.selfAuraLandingSeconds, 0.5);
});

/* ------------------------------------- ③ 急冻光线真的飞 + 落地一击被加载 */

test('③ 急冻光线登记成 missile：直线、不配 count、复用普攻弹速', () => {
    const fx = zcEffectMissileOf('68024');
    assert.ok(fx, '不登记 missile 就会退回「目标原地闪一下 + 立刻结算」，读不出「朝目标飞」');
    assert.equal(fx!.missilePrefabPath, ZC_EFFECT_PATHS.iceMageBullet);
    assert.equal(fx!.impactPrefabPath, ZC_EFFECT_PATHS.iceMageBulletImpact);
    assert.equal(fx!.arcOffset, 0, '直线飞（弧线是镭射飞龙 68010 的口径）');
    //  🔴 不配 `count`：`strikeCount = 3` 要「三个目标各一发」。配了 count 会从候选里重复取，
    //  3 发砸在同几个人身上（见 `ZCSkillResolutionSystem` 的 volley 切片）。
    assert.equal(fx!.count, undefined);
    //  不配 `speed` ⇒ 复用 `attackProfile.projectileSpeed`，与普攻弹速一致。
    assert.equal(fx!.speed, undefined);
    //  既有镭射飞龙那条不许被顺手改掉。
    assert.equal(zcEffectMissileOf('68010')?.arcOffset, 36);
    assert.equal(zcEffectMissileOf('68010')?.count, 3);
});

test('③ 落地一击的路径必须进本局清单（漏收 = 区域照常结算、天上什么都没砸下来）', () => {
    const plan = buildZCVisualResourcePlan(
        [{ unitId: '68024', prefabPath: 'unit/68024', attackProfile: { effectPrefabPath: 'normal' } }],
        { skillPlans: [{ enabled: true, unitId: '68024', behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfAura }], textOverrides: new Map() },
        [68024],
    );
    assert.ok(plan.effectPaths.includes(ZC_EFFECT_PATHS.iceMageBullet), '弹体 + 落地一击都要在清单里');
    assert.ok(plan.effectPaths.includes(ZC_EFFECT_PATHS.iceMageBulletImpact), '命中爆炸同样按阵容收');
    //  同一张卡不在这局时一条都不下。
    const other = buildZCVisualResourcePlan(
        [{ unitId: '68010', prefabPath: 'unit/68010', attackProfile: { effectPrefabPath: 'normal' } }],
        { skillPlans: [], textOverrides: new Map() },
        [68010],
    );
    assert.ok(!other.effectPaths.includes(ZC_EFFECT_PATHS.iceMageBullet));
});

/* ------------------------------------------------ ④ 不拉长 / 不进首包 */

test('④ 尺寸只由 prefab 决定：目录不登记 nodeScale，也不按判定半径算', () => {
    assert.equal(zcEffectNodeScaleOf(ZC_EFFECT_PATHS.iceMageBullet), 1, '改大小重跑生成脚本的 scale');
    assert.equal(zcEffectLayerOfPath(ZC_EFFECT_PATHS.iceMageBullet), 'top');
    assert.equal(zcEffectLayerOfPath(ZC_EFFECT_PATHS.iceMageBulletImpact), 'top');
    assert.equal(zcEffectFlightOf(ZC_EFFECT_PATHS.iceMageBulletImpact), null, '命中是原地一次性演出，没有飞行方向');
    //  屏上尺寸自检：画布 × prefab 缩放必须落在「一颗弹体」的量级（0.3~0.5 格宽、<1 格长），
    //  而不是「一条拉长到判定半径的射线」。格面 123×90。
    for (const spec of SPECS) {
        const width = Math.round(spec.union[0] * 256 / spec.union[1]) * spec.scale;
        const height = 256 * spec.scale;
        assert.ok(width > 20 && width < 100, `${spec.name} 屏上宽 ${width.toFixed(0)} 不是一颗弹体`);
        assert.ok(height > 40 && height < 140, `${spec.name} 屏上长 ${height.toFixed(0)} 不该是「拉长」的样子`);
    }
});

test('④ ~8MB 素材不进首包预热，只按阵容随对局加载', () => {
    assert.equal(zcEffectMissileOf('68024')?.warmup, false);
    const warmup = zcWarmupEffectPaths();
    for (const path of [ZC_EFFECT_PATHS.iceMageBullet, ZC_EFFECT_PATHS.iceMageBulletImpact]) {
        assert.ok(!warmup.includes(path), `${path} 不该进开战预热`);
    }
    //  既有镭射飞龙的导弹仍在预热里（`warmup` 缺省 true）—— 别把这条也顺手关掉。
    assert.ok(warmup.includes(ZC_EFFECT_PATHS.missileBody));
    assert.ok(warmup.includes(ZC_EFFECT_PATHS.missileImpact));
});

/* --------------------------------------------------- ⑤ 弹道分支的接线 */

test('⑤ 弹道分支也吃朝向偏移：否则「正前方不是 +X」的弹体一律横着飞', () => {
    //  2026-11-25 第 51 批补的：`ZCCombatEffectView` 的 projectile 分支原来只给纯弹道角度。
    assert.match(
        VIEW_SOURCE,
        /const angle = zcCombatEffectFacingDegrees\(\s*Math\.atan2\(mapToViewY\(event\.toY - event\.fromY\), mapToViewX\(event\.toX - event\.fromX\)\) \* 180 \/ Math\.PI,\s*zcCombatEffectFlightOf\(event\.effectPrefabPath\),\s*\);/,
        'projectile 与 melee 飞行分支必须是同一套「弹道 + 偏移」算式',
    );
    //  幂等：这三行在文件里只出现三次（别处不许再写一份）。
    //  第 55 批（2026-11-26）从 2 变 3：飞入段改成二次贝塞尔后，朝向要走**切线角**，
    //  但外层仍然是同一个 `zcCombatEffectFacingDegrees(弹道角, 素材偏移)` —— 三处共用一套。
    assert.equal(VIEW_SOURCE.match(/zcCombatEffectFacingDegrees\(/g)?.length, 3,
        '一处 melee 飞行分支 + 一处 projectile 分支 + 一处弹道雨飞入段，多出来就是有人又抄了一份');
});

test('⑤ 存量 projectile 特效零变化：登记过朝向的路径都不走弹道', () => {
    //  这条守的是「加偏移会不会把老特效转反」。目前登记过 `facingDegrees` / `flight` 的四条
    //  （斧盾兵反击气刃 / 消灭学霸普攻 / 机甲菇扇形 / 战士通用剑气）全是 melee 或 area。
    //  🔴 以后若有人把其中一条改成 projectile，这条会红 —— 那正是要重新确认朝向的时候。
    const registered = [
        ZC_EFFECT_PATHS.axeBlade,
        ZC_EFFECT_PATHS.boxerStrike,
        ZC_EFFECT_PATHS.jiajiguFan,
        ZC_EFFECT_PATHS.warriorQi,
    ];
    for (const path of registered) {
        assert.notEqual(zcEffectFlightOf(path)?.facingOffsetDegrees, -90, `${path} 不该跟冰弹用同一个偏移`);
    }
    //  未登记的路径仍返回 null ⇒ 弹道分支拿到的 flight 是 null ⇒ 偏移 0。
    assert.equal(zcCombatEffectFlightOf('units/projectiles/未登记/未登记'), null);
    assert.equal(zcCombatEffectFacingDegrees(37, null), 37, '没登记就是纯弹道角度，与改前逐字一致');
});
