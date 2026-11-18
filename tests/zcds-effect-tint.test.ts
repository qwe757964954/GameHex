import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    zcBlendCombatEffectTint, zcCombatEffectTintOf,
} from '../assets/script/app/zcds/view/ZCCombatEffectTint';
import { ZC_WIND_HURRICANE_PREFAB_PATH } from '../assets/script/app/zcds/model/ZCWindBarrageFx';

/**
 * 第 17 批 · 飓风染色（2026-11-18）。
 *
 * 用户口径：「飓风的颜色可以修改成绿色（叠加颜色的方式）」。
 * 这一批要钉住四点：
 *  1. 只有登记过的路径才染色（同一张池里的其它特效必须保持原色）；
 *  2. 叠加 = **乘算**，不是覆盖 —— 白底乘任何色得到该色、原色乘白保持原色；
 *  3. 视图必须**先快照原始色再乘**，否则池化复用会「绿 × 绿」越乘越黑；
 *  4. 没登记就复位，否则同一条池里借出来的下一个特效会「绿着出场」。
 */

const ROOT = process.cwd();

test('只有登记过的 prefab 才叠色，其它一律原色', () => {
    const tint = zcCombatEffectTintOf(ZC_WIND_HURRICANE_PREFAB_PATH);
    assert.ok(tint, '飓风这份 prefab 必须登记，否则「绿色」这条需求没人落地');
    //  绿色系判据：绿通道拉满、红蓝都压下来（乘算后偏青绿）。
    assert.equal(tint[1], 255, '绿通道拉满：乘算不会把绿色压暗');
    assert.ok(tint[0] < tint[1], '红必须低于绿');
    assert.ok(tint[2] < tint[1], '蓝必须低于绿');
    assert.equal(zcCombatEffectTintOf(null), null);
    assert.equal(zcCombatEffectTintOf(''), null);
    assert.equal(zcCombatEffectTintOf('units/projectiles/三叶小丑_普攻/三叶小丑_普攻'), null,
        '风弹用的是三叶小丑那份弹体，设计只要求飓风变绿 ⇒ 弹体不许被顺带染色');
    assert.equal(zcCombatEffectTintOf('units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中'), null);
});

test('叠加是乘算：白底出表色、原色乘白不变、逐通道钳在 0~255', () => {
    const tint = zcCombatEffectTintOf(ZC_WIND_HURRICANE_PREFAB_PATH)!;
    //  白底 × 表色 = 表色本身（乘算的定义）。
    assert.deepEqual(zcBlendCombatEffectTint([255, 255, 255], tint), [tint[0], tint[1], tint[2]]);
    //  原色 × 白 = 原色（表里出现 255 的通道必须不变）。
    assert.deepEqual(zcBlendCombatEffectTint([200, 200, 200], [255, 255, 255]), [200, 200, 200]);
    //  逐通道四舍五入：200 × 96 ÷ 255 = 75.29 → 75；200 × 128 ÷ 255 = 100.39 → 100。
    assert.deepEqual(zcBlendCombatEffectTint([200, 200, 200], [96, 255, 128]), [75, 200, 100]);
    //  黑底乘任何色仍是黑（不发光）。
    assert.deepEqual(zcBlendCombatEffectTint([0, 0, 0], tint), [0, 0, 0]);
    //  非法表值不会溢出。
    assert.deepEqual(zcBlendCombatEffectTint([255, 255, 255], [300, 255, 128]), [255, 255, 128]);
});

test('视图接线：先快照原始色再乘，没登记就复位', () => {
    const source = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCCombatEffectView.ts'), 'utf8');
    assert.match(source, /this\.applyTint\(\);/, 'mountVisual 末尾必须真的调染色');
    assert.match(source, /renderer\.color\.clone\(\)/, '原始色必须 clone 一份再存，不能存引用（否则乘的是自己）');
    assert.match(source, /if \(!tint\) \{\s*\/\/[\s\S]{0,200}this\.restoreTint\(\);/, '没登记的 prefab 必须把颜色复位');
    assert.match(source, /private restoreTint\(\): void \{[\s\S]{0,200}renderer\.color = base;/, '复位的落点是 restoreTint');
    //  无引擎的视图夹具（假节点）没有 `getComponentsInChildren` ⇒ 必须先判 tint、再判方法存在，
    //  否则 `zcds-progressive-art` / `zcds-render-performance` 直接炸成 TypeError。
    assert.match(source, /typeof probe\.getComponentsInChildren !== 'function'/, '夹具路径要能整段跳过');
    assert.match(source, /this\.tintBaseColor\.clear\(\);/, '换 prefab 时原始色快照要作废');
    assert.match(source, /zcCombatEffectTintOf\(this\.diagEffectPath\)/, '按路径查表，不按技能 id');
});
