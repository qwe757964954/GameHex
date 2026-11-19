import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ZC_IMPACT_ANCHOR_MIDPOINT, ZC_IMPACT_ANCHOR_TARGET, zcImpactEffectAnchor,
} from '../assets/script/app/zcds/model/ZCImpactEffectFx';

/**
 * 命中附加特效的落点（`pvpSkill.impactEffectAnchor`，0~1）。
 *
 * 2026-11-18 用户口径演进：
 *  ① 第一轮：「特效的播放位置在运动霸和受击目标的中心点坐标，不再是受击目标的坐标」；
 *  ② 第二轮追问：「美术换了会不会失效？位置可以登记在配置表中吗」——
 *     原来按 prefab 路径登记的常量表确实会静默失效，所以整体挪进配置表。
 *
 * 这里钉四件事：
 *  ✓ 0 / 留空 = 受击点（存量三条爆点类特效逐字不变）；
 *  ✓ 0.5 = 双方中点，其余比例线性插值（不是手调系数）；
 *  ✓ 配表：运动霸 30713 是 0.5，全表只有它是非 0（别把别人的特效也带偏）；
 *  ✓ 解析层：越界要抛，不许静默夹到 0/1。
*/

const FIELD = 'impactEffectAnchor';
const BOXER_SKILL_ID = 30713;

test('默认（0 / 留空）= 受击点：存量三条爆点类特效一个坐标都不动', () => {
    const target = { x: 12, y: -4 };
    for (const ratio of [undefined, ZC_IMPACT_ANCHOR_TARGET, 0]) {
        assert.deepEqual(
            zcImpactEffectAnchor(ratio, 0, 0, target.x, target.y),
            { x: target.x, y: target.y },
            String(ratio),
        );
    }
});

test('0.5 = 双方中点，其余比例线性插值（斜向也对）', () => {
    assert.deepEqual(zcImpactEffectAnchor(ZC_IMPACT_ANCHOR_MIDPOINT, 0, 0, 12, 0), { x: 6, y: 0 });
    assert.deepEqual(zcImpactEffectAnchor(ZC_IMPACT_ANCHOR_MIDPOINT, 100, 20, 0, 60), { x: 50, y: 40 });
    assert.deepEqual(zcImpactEffectAnchor(ZC_IMPACT_ANCHOR_MIDPOINT, -30, 40, 10, -20), { x: -10, y: 10 });
    //  1/4 处：从受击点往出手点走 1/4。
    assert.deepEqual(zcImpactEffectAnchor(0.25, 0, 0, 40, 0), { x: 30, y: 0 });
    //  1 = 出手点（美术以出手点为中心时才用得上）。
    assert.deepEqual(zcImpactEffectAnchor(1, 8, 9, 40, 0), { x: 8, y: 9 });
    //  贴脸 / 目标被推到同格 ⇒ 退化成那个点，不许出现 NaN。
    assert.deepEqual(zcImpactEffectAnchor(ZC_IMPACT_ANCHOR_MIDPOINT, 8, 8, 8, 8), { x: 8, y: 8 });
});

test('绕过解析层的越界比例也不会把特效甩到屏幕外', () => {
    assert.deepEqual(zcImpactEffectAnchor(-1, 0, 0, 12, 0), { x: 12, y: 0 }, '负数按受击点');
    assert.deepEqual(zcImpactEffectAnchor(1.7, 0, 0, 12, 0), { x: 0, y: 0 }, '大于 1 按出手点');
});

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('配表：30713 是 0.5，且全表只有它是非 0 / 非空', () => {
    const client = JSON.parse(readFileSync('../doc/塔防数据配置/json/client/pvpSkill.json', 'utf8')) as
        Array<Record<string, unknown>>;
    for (const rows of [readPvpRows('pvpSkill'), client]) {
        const boxer = rows.find((row) => Number(row.skillId) === BOXER_SKILL_ID);
        assert.ok(boxer, 'pvpSkill 里必须有运动霸普攻 30713');
        assert.equal(boxer![FIELD], ZC_IMPACT_ANCHOR_MIDPOINT, '气浪落点 = 双方中点');
        const others = rows.filter((row) => Number(row.skillId) !== BOXER_SKILL_ID)
            .filter((row) => row[FIELD] !== undefined && row[FIELD] !== null && row[FIELD] !== 0);
        assert.deepEqual(others.map((row) => row.skillId), [],
            '别的技能配了非 0 落点 ⇒ 它们的命中特效会被挪位，先确认是不是有意的');
        //  必须配在「有命中附加特效」的行上，否则这一格永远没人读。
        assert.ok(typeof boxer!.impactEffectPrefabPath === 'string' && boxer!.impactEffectPrefabPath.length > 0,
            '30713 必须先有 impactEffectPrefabPath，落点才有意义');
    }
});

test('加列脚本与列值不许漂移（源表改列名 / 改值时两处一起改）', () => {
    const source = readFileSync('tools/config/add_pvp_skill_anchor_column.py', 'utf8');
    assert.match(source, /FIELD = 'impactEffectAnchor'/, '脚本里的字段名必须与解析层一致');
    assert.match(source, /HEADER_NOTE/, '说明行必须写（不然策划不知道 0.5 是什么）');
    assert.match(source, /VALUES = \{30713: 0\.5\}/, '脚本里记的落点必须与表值一致');
});

test('解析层：越界比例直接抛错，不许静默夹住', () => {
    const parser = readFileSync('assets/script/app/zcds/model/ZCPvpTableParser.ts', 'utf8');
    assert.match(parser, /raw\.impactEffectAnchor/, '解析层必须读这一列');
    assert.match(parser, /parsed < 0 \|\| parsed > 1/, '越界必须抛错（夹到 0/1 等于把配错变成静默）');
});

test('源码守卫：pushImpactEffect 必须走 zcImpactEffectAnchor，且落点取自 profile', () => {
    const source = readFileSync('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts', 'utf8');
    const start = source.indexOf('private static pushImpactEffect');
    assert.ok(start > 0, 'pushImpactEffect 不见了（改名了就把这条守卫一起挪）');
    const body = source.slice(start, start + 1800);
    assert.match(body, /zcImpactEffectAnchor\(\s*profile\.impactEffectAnchor/, '落点比例必须从表里读');
    assert.match(body, /fromX: anchor\.x/, '起终点都要用算出来的落点');
    assert.doesNotMatch(body, /fromX:\s*event\.toX/, '不许再直接落在受击点');
});
