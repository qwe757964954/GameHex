import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    zcCombatEffectAnchorOf,
    zcCombatEffectAnchorPoint,
    zcCombatEffectLayerOf,
    zcCombatEffectLayerOfPath,
    zcCombatEffectSiblingIndex,
} from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';

/**
 * 巨力坚果普攻特效：**缩小到 30%** + 播在「巨力坚果 ↔ 受击目标」的连线中点
 * （需求 2026-10-30）。
 *
 * 改前：近战特效一律贴出手点（`ZCCombatEffectView.render` 的 melee 分支写死 `event.fromX/Y`），
 * 巨力坚果这一击看起来砸在自己身上 —— 技能行 `pvpSkill` 30802「坚果重砸」是 `mode: melee`。
 * 尺寸也不再由代码里写死，而是回到「prefab 根 `_lscale` 说了算」（§1.5）。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const codeOf = (relative: string): string => read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const NUT_EFFECT = 'units/projectiles/巨力坚果_普攻/巨力坚果_普攻';
const NUT_PREFAB = 'assets/bundles/battle/units/projectiles/巨力坚果_普攻/巨力坚果_普攻.prefab';
const EFFECT_VIEW = 'assets/script/app/zcds/view/ZCCombatEffectView.ts';
const RENDER_WORLD = 'assets/script/app/zcds/view/ZCGameRenderWorld.ts';

test('① 锚点表：只有巨力坚果走中点，其余近战特效保持出手点', () => {
    assert.equal(zcCombatEffectAnchorOf(NUT_EFFECT), 'midpoint');
    // 空路径 / 未登记的路径一律回落到既有口径（22 条近战特效不能跟着一起改）。
    for (const path of [null, undefined, '', 'units/projectiles/民兵普攻_刀光/民兵普攻_刀光',
        'units/projectiles/刀盾兵普攻_刀光/刀盾兵普攻_刀光', 'units/projectiles/普攻爆炸/普攻爆炸']) {
        assert.equal(zcCombatEffectAnchorOf(path), 'caster', `「${path}」不该被这张表命中`);
    }
});

test('② 中点口径：两端坐标的算术中点，caster 时完全忽略目标', () => {
    const span = { fromX: 100, fromY: 200, toX: 300, toY: 400 };
    assert.deepEqual(zcCombatEffectAnchorPoint(span, 'midpoint'), { x: 200, y: 300 });
    assert.deepEqual(zcCombatEffectAnchorPoint(span, 'caster'), { x: 100, y: 200 });

    // 负坐标 / 小数（连续坐标是浮点）不能出偏差。
    const negative = { fromX: -37.5, fromY: -12.25, toX: 12.5, toY: 8.25 };
    assert.deepEqual(zcCombatEffectAnchorPoint(negative, 'midpoint'), { x: -12.5, y: -2 });

    // 两端相同时中点退化成该点（不返回 NaN）。
    const same = { fromX: 42, fromY: 7, toX: 42, toY: 7 };
    assert.deepEqual(zcCombatEffectAnchorPoint(same, 'midpoint'), { x: 42, y: 7 });
});

test('③ 尺寸：改回「prefab 根 _lscale 说了算」，巨力坚果保留美术根缩放', () => {
    const data = JSON.parse(readFileSync(join(ROOT, NUT_PREFAB), 'utf8')) as Array<Record<string, any>>;
    const root = data.find((entry) => entry.__type__ === 'cc.Node' && entry._parent === null);
    assert.ok(root, 'prefab 要有根节点');
    // 屏上大小由当前 prefab 根缩放决定，视图不再额外乘尺寸常量。
    assert.deepEqual([root!._lscale.x, root!._lscale.y, root!._lscale.z], [0.75, 0.75, 1]);
    // 摆位偏移归零：`_lpos` 的 y=66.536 是「让特效抬到巨力坚果身上」的补偿，
    // 现在锚点换成两点中点，再抬 0.74 格就不在中点上了。
    assert.deepEqual([root!._lpos.x, root!._lpos.y, root!._lpos.z], [0, 0, 0]);
});

test('④ 源码守卫：视图每帧定位与创建时初值必须同源', () => {
    const view = codeOf(EFFECT_VIEW);
    const melee = view.slice(view.indexOf("if (event.type === 'melee')"));
    const meleeBody = melee.slice(0, melee.indexOf('\n        }'));
    assert.match(meleeBody, /zcCombatEffectAnchorOf\(event\.effectPrefabPath\)/,
        '近战分支必须按特效路径取锚点');
    assert.match(meleeBody, /zcCombatEffectAnchorPoint\(event, anchor\)/,
        '位置必须由 `zcCombatEffectAnchorPoint` 算（禁止在视图里再写一份中点算术）');
    assert.doesNotMatch(meleeBody, /mapToViewX\(event\.fromX\)/,
        '老写法（写死出手点）会让巨力坚果退回砸自己身上');
    // 创建时的初值走同一个函数：两边不同源 ⇒ 第一帧先闪在出手点。
    const world = codeOf(RENDER_WORLD);
    assert.match(world, /const anchorPoint = zcCombatEffectAnchorPoint\(event, zcCombatEffectAnchorOf\(event\.effectPrefabPath\)\);/,
        '创建特效节点时的初始位置必须与每帧定位同源');
});

/**
 * ⑤ 层序（2026-10-30）：「火焰树妖_灼热地带技能的特效层级应该在角色类的下层，当角色走过会遮挡该火焰，
 * 形成火焰在脚底的视角」。
 *
 * 难点不在「插到哪」，而在 `mapLayer` 里**没有单位层容器**：单位 / 飘字 / 卡牌 / 受击特效全是
 * 平铺的兄弟节点，规则是「新建就 `setSiblingIndex(children.length-1)`」= 谁后创建谁在上。
 * 所以地面特效只能**显式插队到棋盘之后**，否则角色晚一帧出生就把火盖回去了。
 */
test('⑤ 层序：地面区域特效（type=area）压在所有角色之下，投射物/近战仍在最上层', () => {
    // 判据按**事件类型**，不按 prefab 路径：area 是「铺在地上的一片火」，
    // melee / projectile 是「打在空中的一下」，都不能被自己的身体挡住。
    assert.equal(zcCombatEffectLayerOf('area'), 'ground');
    assert.equal(zcCombatEffectLayerOf('projectile'), 'top');
    assert.equal(zcCombatEffectLayerOf('melee'), 'top');

    //  按路径登记的例外（2026-11-07 鹿神守护）：`area` 事件里也会出现**生物本体**，
    //  小鹿冲刺按地面层插队会被敌兵盖住，所以登记成 top。未登记路径一律回到事件类型口径。
    assert.equal(zcCombatEffectLayerOfPath('area', 'units/projectiles/鹿神守护/鹿神守护'), 'top');
    assert.equal(zcCombatEffectLayerOfPath('area', null), 'ground');
    assert.equal(zcCombatEffectLayerOfPath('area', 'units/projectiles/暴风雪/暴风雪'), 'ground',
        '没登记的 area 一律留在脚下，不能被这条例外带跑');
    assert.equal(zcCombatEffectLayerOfPath('melee', 'units/projectiles/鹿神守护/鹿神守护'), 'top');

    // `mapLayer` 实况：Background(0) → board(1) → 动态对象(2..)。
    // ground ⇒ 紧贴棋盘之后（2）；top ⇒ 永远末尾。
    assert.equal(zcCombatEffectSiblingIndex('ground', 1, 9), 2,
        '地面特效必须落在棋盘之后第一个位置（地块之上、所有动态对象之下）');
    assert.equal(zcCombatEffectSiblingIndex('top', 1, 9), 8);
    // 兜底：兄弟数极少时既不能返回负数，也不能插到棋盘之前。
    assert.equal(zcCombatEffectSiblingIndex('ground', 1, 2), 1);
    assert.equal(zcCombatEffectSiblingIndex('ground', 0, 1), 0);
    assert.equal(zcCombatEffectSiblingIndex('top', 0, 1), 0);

    // 源码守卫：层序必须由这个函数决定，且 `renderEffectSystem` 里不能再无条件置顶。
    const world = codeOf(RENDER_WORLD);
    const body = world.slice(world.indexOf('private renderEffectSystem'));
    assert.match(body, /zcCombatEffectLayerOfPath\(event\.type, event\.effectPrefabPath\)/,
        '层序判据必须来自事件类型（+ 按路径登记的例外），不能靠创建顺序');
    assert.match(body, /this\.options\.board\.getSiblingIndex\(\)/,
        '地面特效要贴棋盘之后 —— 靠「新建置顶」会让后出生的角色把火盖回去');
    assert.doesNotMatch(body, /setSiblingIndex\(this\.options\.mapLayer\.children\.length - 1\)/,
        '特效通道不能再无条件置顶（那正是「火焰盖住角色」的成因）');
});
