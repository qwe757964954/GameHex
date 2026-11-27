import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZC_EFFECT_PATHS, zcEffectDurationOf } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_EFFECT_SCALE, ZC_EFFECT_TUNING } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { zcCombatEffectLayerOf, zcCombatEffectLayerOfPath } from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import type { ZCGroundZoneState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 46 批 · 运动霸 68033「天外飞石」30853 换特效（2026-11-25）。
 *
 * 用户口径原文：
 *   「运动霸的天外飞石使用（截图）这个特效，并制作相关的预制体，特效大小需要和伤害判定范围
 *     保持一致，按照砸落爆炸（skill_1_34 图片实际有像素的区域）的特效大小去匹配范围」。
 *
 * 这一批有四个「照直觉写就会静默错」的点，正是本用例要钉住的：
 *
 *  1. **尺寸基准是「34 帧实际有像素的区域」，不是画布宽**。并集画布 379 源 px 里，
 *     34 帧只占 286；按画布宽对判定 → 爆点缩到 93 屏上 px（小 24%），
 *     而屏幕上「特效明明在那儿」，不会有任何报错。
 *  2. **锚点是冲击环圆心，不是画布中心**。环在画布垂直中心下方（277→290 源 px），
 *     锚错了整团特效会浮在地面上方。
 *  3. **`area` 事件寿命默认 = `zone.waveInterval`**，天外飞石的 `durationSeconds` 配的是 0
 *     ⇒ 波次间隔 0 ⇒ 事件当拍就被摘掉。1.375s 的演出必须靠目录登记的
 *     `durationSeconds` 抬起来，否则实机只闪一帧。
 *  4. **旧 prefab 不能就地覆盖**：驭兽师武将技 36401 也在用 `驭兽师_巨象践踏`。
 */

const ROOT = process.cwd();
const BUILDER = join(ROOT, 'tools/build_yundongba_meteor_fx.py');
const SET_NAME = '运动霸_砸落技能';

/** 读 remoteRef 的列存表（`{k,v}` ⇒ 行对象）。*/
function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const BUILDER_SOURCE = readFileSync(BUILDER, 'utf8');

/** 读生成脚本里的**字面量**常量（数值真源在这一份，测试不再抄第二遍）。*/
function builderNumber(name: string): number {
    //  `base.` 前缀的写法也要命中（生成脚本里 `SAMPLE` / `WRAP_LOOP` 是改基座常量）。
    const match = new RegExp(`^(?:base\\.)?${name}\\s*=\\s*([^#\\n]+)`, 'm').exec(BUILDER_SOURCE);
    assert.ok(match, `tools/build_yundongba_meteor_fx.py 里找不到常量 ${name}`);
    const expression = match![1].trim().replace(/\bround\(/g, 'Math.round(');
    const value = Number(new Function(`return ${expression};`)());
    assert.ok(Number.isFinite(value), `${name} 的表达式算不出数：${expression}`);
    return value;
}

/** 读元组常量（`UNION_BOX = (11, 0, 390, 363)`）。*/
function builderTuple(name: string): number[] {
    const match = new RegExp(`^${name}\\s*=\\s*\\(([^)]+)\\)`, 'm').exec(BUILDER_SOURCE);
    assert.ok(match, `tools/build_yundongba_meteor_fx.py 里找不到元组 ${name}`);
    return match![1].split(',').map((item) => {
        const value = Number(item.trim());
        assert.ok(Number.isFinite(value), `${name} 里有算不出的项：${item}`);
        return value;
    });
}

/** 脚本里派生出来的三个数（`CANVAS_H` / `PREFAB_SCALE` / `PREFAB_POS` 引用了别的常量，
 *  `new Function` 算不了 ⇒ 在测试里按同一套公式复算，再与 prefab 对账）。*/
function derived(): { canvasH: number; scale: number; posX: number; posY: number } {
    const union = builderTuple('UNION_BOX');
    const reference = builderTuple('REFERENCE_BOX');
    const ringCenter = builderTuple('RING_CENTER');
    const canvasW = builderNumber('CANVAS_W');
    const aoe = builderNumber('AOE_DIAMETER_SCREEN');
    const kx = canvasW / (union[2] - union[0]);
    const ky = Math.round((union[3] - union[1]) * canvasW / (union[2] - union[0])) / (union[3] - union[1]);
    const canvasH = Math.round((union[3] - union[1]) * canvasW / (union[2] - union[0]));
    const scale = Math.round(aoe / ((reference[2] - reference[0]) * kx) * 10000) / 10000;
    return {
        canvasH,
        scale,
        posX: Math.round((canvasW / 2 - (ringCenter[0] - union[0]) * kx) * scale * 100) / 100,
        posY: Math.round(((ringCenter[1] - union[1]) * ky - canvasH / 2) * scale * 100) / 100,
    };
}

interface IPrefabNode { __type__: string; _name?: string; _lpos?: { x: number; y: number }; _lscale?: { x: number } }
function readPrefab(): { root: IPrefabNode; offset: IPrefabNode; size: { width: number; height: number } } {
    const prefabPath = assetPath(`units/projectiles/${SET_NAME}/${SET_NAME}.prefab`);
    const raw = JSON.parse(readFileSync(prefabPath, 'utf8')) as Array<Record<string, unknown>>;
    const nodes = raw.filter((item) => item.__type__ === 'cc.Node') as unknown as IPrefabNode[];
    const transform = raw.find((item) => item.__type__ === 'cc.UITransform')!;
    return {
        root: nodes[0],
        offset: nodes[1],
        size: transform._contentSize as { width: number; height: number },
    };
}

/** PNG 的宽高（IHDR，偏移 16/20），不引第三方依赖。*/
function pngSize(path: string): { width: number; height: number } {
    const head = readFileSync(path).subarray(0, 24);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// ────────────────────────────────────────────── 一、尺寸：34 帧爆点宽 = 判定直径

test('天外飞石 prefab：34 帧实际像素宽 ↔ 判定直径 123 屏上 px', () => {
    const union = builderTuple('UNION_BOX');
    const reference = builderTuple('REFERENCE_BOX');
    const canvasW = builderNumber('CANVAS_W');
    const aoeDiameter = builderNumber('AOE_DIAMETER_SCREEN');
    const geometry = derived();
    const { offset, size } = readPrefab();

    //  判定直径 = areaRadius 80 逻辑 px × 2 × 0.76875（§1.11 的屏上换算）。
    assert.equal(aoeDiameter, 2 * 80 * ZC_EFFECT_SCALE.screenPxPerLogic);
    assert.equal(aoeDiameter, 123);

    //  34 帧 bbox 宽 286：它是全部帧里「落地爆开」那一瞬的紧致范围。
    const refWidth = reference[2] - reference[0];
    assert.equal(refWidth, 286, '用户指的 skill_1_34 实际像素宽应为 286 源 px');
    assert.ok(refWidth < union[2] - union[0], '34 帧必须窄于并集：否则说明量错了帧');

    const kx = canvasW / (union[2] - union[0]);
    const onScreen = refWidth * kx * offset._lscale!.x;
    assert.ok(Math.abs(onScreen - aoeDiameter) < 0.05,
        `34 帧爆点应铺满判定直径 ${aoeDiameter.toFixed(2)} 屏上 px，实际 ${onScreen.toFixed(2)}`);
    assert.equal(offset._lscale!.x, geometry.scale);

    //  🔴 反例守卫：拿**画布宽**（379）当基准会算出 0.4805，爆点只剩 93 屏上 px ——
    //  比判定小 24%，而画面上「有特效」，谁都不会报错。
    const naive = aoeDiameter / canvasW;
    assert.ok(Math.abs(offset._lscale!.x - naive) > 0.1,
        `缩放 ${offset._lscale!.x} 与「画布宽 = 判定直径」的错解 ${naive.toFixed(4)} 太接近，尺寸口径可能被改坏`);
    //  画布与生成脚本必须同口径。
    assert.equal(size.width, canvasW);
    assert.equal(size.height, geometry.canvasH);
});

test('天外飞石 prefab：锚点落在冲击环椭圆圆心，不是画布中心', () => {
    const union = builderTuple('UNION_BOX');
    const ringCenter = builderTuple('RING_CENTER');
    const geometry = derived();
    const { offset, root } = readPrefab();

    assert.equal(root._lpos!.x, 0, '根节点不位移，落点由子节点锚定（同 §42/§44）');
    assert.equal(root._lpos!.y, 0);
    assert.equal(offset._lpos!.x, geometry.posX);
    assert.equal(offset._lpos!.y, geometry.posY);

    //  🔴 环在画布垂直中心下方：`_lpos.y` 必须**为正**（把图往上抬，让环心落到节点原点）。
    //  写成 0（= 画布中心对准落点）时，整团特效会低 5.6 屏上 px，看起来「爆点浮在地面上」。
    assert.ok(offset._lpos!.y > 40, `锚点抬起量 ${offset._lpos!.y} 太小，环心落在落点下方了`);
    //  环心 y 落在画布下四分之一：跌到 0.5 就说明误用了 alpha bbox 的中心（被上方尘土带带偏）。
    const ratio = ringCenter[1] / union[3];
    assert.ok(ratio > 0.7 && ratio < 0.85, `环心 y=${ringCenter[1]} 不在画布下四分之一（比值 ${ratio.toFixed(3)}）`);
});

// ────────────────────────────────────────────── 二、序列帧：同框裁剪、一次性、时长对齐

test('天外飞石：33 帧同尺寸裁剪，逐帧对齐不抖', () => {
    const atlasDir = assetPath(`units/projectiles/${SET_NAME}/atlas`);
    const frames = readdirSync(atlasDir).filter((name) => name.endsWith('.png'));
    assert.equal(frames.length, 33, '33 张散图全部进图集（本批没有全透明帧，一张都不许剔）');
    const { size } = readPrefab();
    for (const name of frames) {
        //  逐帧尺寸必须一致：Sprite 是 `_sizeMode=0` + `_isTrimmedMode=false`，
        //  画布一变，播放时就会跟着新图变形（§1.5）。
        assert.deepEqual(pngSize(join(atlasDir, name)), { width: size.width, height: size.height },
            `${name} 与画布 ${size.width}x${size.height} 尺寸不一致`);
    }
});

test('天外飞石动画：一次性（-play / wrapMode 1），时长 = 33 帧 ÷ 24fps', () => {
    const animDir = assetPath(`units/projectiles/${SET_NAME}/anim`);
    const clips = readdirSync(animDir).filter((name) => name.endsWith('.anim'));
    assert.deepEqual(clips, [`${SET_NAME}-play.anim`], '一次性演出不该再叫 -loop');

    const clip = JSON.parse(readFileSync(join(animDir, clips[0]), 'utf8')) as
        { sample: number; wrapMode: number; _duration: number; _tracks: Array<{ _channel: { _curve: { _times: number[] } } }> };
    const sample = builderNumber('SAMPLE');
    assert.equal(clip.sample, sample, '采样率与生成脚本同源');
    assert.equal(sample, 24, '与第 42/44 批同节奏（24fps）');
    assert.equal(clip.wrapMode, 1, 'wrapMode=1（Normal）：循环播会变成一盏一直闪的灯');
    const times = clip._tracks[0]._channel._curve._times;
    assert.equal(times.length, 33);
    assert.ok(Math.abs(clip._duration - 33 / 24) < 1e-9, `clip 时长应为 1.375s，实际 ${clip._duration}`);
    assert.ok(Math.abs(clip._duration - ZC_EFFECT_TUNING.meteorSlamSeconds) < 1e-9,
        '事件寿命常量与 clip 时长必须同源，短了会把动画截断');
    //  最后一帧的 key 时间必须落在 clip 结束前（= 32/24），否则最后一帧播不到。
    assert.ok(Math.abs(times[times.length - 1] - 32 / 24) < 1e-9);
});

// ────────────────────────────────────────────── 三、目录登记

test('目录登记：置顶层 + 登记寿命，覆盖 area 的默认地面层', () => {
    const path = ZC_EFFECT_PATHS.yundongbaMeteor;
    assert.equal(path, `units/projectiles/${SET_NAME}/${SET_NAME}`);
    assert.equal(zcCombatEffectLayerOfPath('area', path), 'top',
        '货盘从天上砸下来，压在地面层会被站在落点上的角色挡住');
    //  没登记的路径必须仍是 area 默认地面层（存量区域一字不变）。
    assert.equal(zcCombatEffectLayerOf('area'), 'ground');
    assert.equal(zcCombatEffectLayerOfPath('area', 'units/projectiles/暴风雪/暴风雪'), 'ground');
    assert.equal(zcEffectDurationOf(path), ZC_EFFECT_TUNING.meteorSlamSeconds);
    //  未登记 ⇒ 0 = 沿用事件默认寿命。
    assert.equal(zcEffectDurationOf('units/projectiles/暴风雪/暴风雪'), 0);
});

test('波次表现事件：寿命取「波次间隔」与「目录登记」的较大值', () => {
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
    };
    const run = (waveInterval: number, effectPrefabPath: string | null) => {
        //  天外飞石的形状：durationSeconds = 0、waves = 1 ⇒ waveInterval = 0。
        const zone: ZCGroundZoneState = {
            x: 0, y: 0, radius: 24, owner: 'player', sourceUnitId: 1,
            skillId: 30853, skillName: '天外飞石', remainingSeconds: 0,
            wavesLeft: 1, nextWaveAt: 0, waveInterval,
            damage: 0, slowRatio: 0, effectPrefabPath,
        };
        const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
        ZCGroundZoneSystem.tick(state, 0.05, context as never);
        return state.combatEvents.map((event) => event.durationSeconds);
    };

    //  🔴 不加这条抬高，寿命就是 0 ⇒ 事件当拍被 `ZCGameModel` 摘掉，实机只闪一帧。
    assert.deepEqual(run(0, ZC_EFFECT_PATHS.yundongbaMeteor), [ZC_EFFECT_TUNING.meteorSlamSeconds]);
    //  存量区域（没登记寿命的一次性区域）逐字不变：仍然是波次间隔 0。
    assert.deepEqual(run(0, 'units/projectiles/暴风雪/暴风雪'), [0]);
    //  间隔更长时不能被缩短（`Math.max`，不是直接覆盖）。
    assert.deepEqual(run(2, ZC_EFFECT_PATHS.yundongbaMeteor), [2]);
    //  间隔比登记值短 ⇒ 取登记值（否则 1.375s 的 clip 又会被截断）。
    assert.deepEqual(run(0.2, ZC_EFFECT_PATHS.yundongbaMeteor), [ZC_EFFECT_TUNING.meteorSlamSeconds]);
});

// ────────────────────────────────────────────── 四、配表三写

test('pvpSkill 30853 指向新 prefab，驭兽师 36401 仍用旧 prefab', () => {
    const rows = readRows('pvpSkill');
    const pick = (skillId: number) => rows.filter((row) => Number(row.skillId) === skillId);
    const meteor = pick(30853);
    assert.equal(meteor.length, 1);
    assert.equal(meteor[0].name, '天外飞石');
    assert.equal(meteor[0].effectPrefabPath, ZC_EFFECT_PATHS.yundongbaMeteor);
    //  判定半径没被顺手改掉：prefab 的尺寸就是按 80 反算的，改了这里尺寸立刻脱钩。
    assert.equal(Number(meteor[0].areaRadius), 80);
    assert.equal(meteor[0].mode, 'area');

    //  🔴 旧 prefab 是共用的：就地覆盖会让驭兽师武将技也变成「砸花盆」。
    const beast = pick(36401);
    assert.equal(beast.length, 1);
    assert.equal(beast[0].effectPrefabPath, 'units/projectiles/驭兽师_巨象践踏/驭兽师_巨象践踏');
    //  且旧 prefab 必须还在磁盘上。
    assert.ok(readFileSync(assetPath('units/projectiles/驭兽师_巨象践踏/驭兽师_巨象践踏.prefab')).length > 0);
});

test('client 表同步（成包读的是 client 行对象）', () => {
    const rows = JSON.parse(readFileSync('../doc/塔防数据配置/json/client/pvpSkill.json', 'utf8')
        .replace(/^\uFEFF/, '')) as Array<Record<string, unknown>>;
    const pick = (skillId: number) => rows.filter((row) => Number(row.skillId) === skillId);
    const meteor = pick(30853);
    assert.equal(meteor.length, 1);
    assert.equal(meteor[0].effectPrefabPath, ZC_EFFECT_PATHS.yundongbaMeteor);
    assert.equal(Number(meteor[0].areaRadius), 80);
    assert.equal(pick(36401)[0].effectPrefabPath, 'units/projectiles/驭兽师_巨象践踏/驭兽师_巨象践踏');
});
