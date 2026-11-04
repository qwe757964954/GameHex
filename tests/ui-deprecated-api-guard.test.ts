import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * 已废弃引擎 API 的全局守卫（2026-11-03 真机警告来源：
 * ① `TerritoryChestView.ensureFlySlots` 运行时 `addComponent(LabelOutline)`；
 * ② `MatchingComposition.buildCover` 每帧 `director.getDeltaTime()`）。
 *
 * Cocos Creator 3.8 起：
 *  - `LabelOutline` 组件废弃，控制台刷「LabelOutline.color/width is deprecated.
 *    Please use Label.outlineColor/outlineWidth」；
 *  - `director.getDeltaTime()` 废弃（自 3.3），请用 `game.deltaTime`（3.8 每帧刷 deprecated 告警）。
 *
 * 处置口径（2026-11-03 用户：「这个放在预制体处理 不要在代码中」）：
 *  - 静态表现进 prefab —— `ui/territory/TerritoryChest.prefab` 的 `Fly/FlySlot` 模板节点，
 *    其 `Amount` 子节点的 Label 在预制体里开好 `_enableOutline/_outlineColor/_outlineWidth`；
 *  - 代码只实例化模板 + 动态布局，不再写任何描边属性。
 *
 * 守卫范围：`assets/script` 下全部 `.ts`（排除 `.d.ts`）；prefab 已核查无 `cc.LabelOutline`，
 * 编辑器侧新增该组件会被自身废弃标记拦截，故不纳入全量资源扫描。
 */

function collectSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) collectSources(path, out);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
    }
    return out;
}

/** 去掉行注释与块注释，避免命中说明性文字（本守卫文件自身就提到了该组件名）。 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

test('禁用已废弃的 director.getDeltaTime：一律用 game.deltaTime', () => {
    const offenders = collectSources('assets/script').filter((file) =>
        /director\.getDeltaTime\s*\(/.test(stripComments(readFileSync(file, 'utf8'))));
    assert.deepEqual(offenders, [],
        `director.getDeltaTime 已废弃（请用 game.deltaTime）：${offenders.join(', ')}`);
});

test('禁用已废弃的 LabelOutline：一律走 Label.enableOutline/outlineColor/outlineWidth', () => {
    const offenders = collectSources('assets/script').filter((file) =>
        /\bLabelOutline\b/.test(stripComments(readFileSync(file, 'utf8'))));
    assert.deepEqual(offenders, [],
        `LabelOutline 已废弃（请用 Label.outlineColor/outlineWidth）：${offenders.join(', ')}`);
});

test('描边配置不许回代码：TerritoryChestView 不再写 outline 属性', () => {
    const code = stripComments(readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8'));
    assert.doesNotMatch(code, /enableOutline|outlineColor|outlineWidth/,
        '飞向栏位粒子的描边必须在 prefab（Fly/FlySlot 模板）里配，代码只实例化 + 布局');
});

test('描边配置在预制体里：TerritoryChest.prefab 的 Fly/FlySlot/Amount Label 已开描边', () => {
    const prefab = JSON.parse(
        readFileSync('assets/resources/ui/territory/TerritoryChest.prefab', 'utf8')) as Array<{
            __type__: string;
            _name?: string;
            _children?: Array<{ __id__: number }>;
            _components?: Array<{ __id__: number }>;
        }>;
    const flySlot = prefab.find((item) => item.__type__ === 'cc.Node' && item._name === 'FlySlot');
    assert.ok(flySlot, 'prefab 里必须有 Fly/FlySlot 模板（描边要配在这里）');
    const amount = prefab[flySlot._children![0].__id__];
    assert.equal(amount._name, 'Amount');
    const labelIndex = amount._components!.find((ref) => prefab[ref.__id__].__type__ === 'cc.Label');
    assert.ok(labelIndex, 'Fly/FlySlot/Amount 上缺 cc.Label');
    const label = prefab[labelIndex.__id__] as Record<string, unknown>;
    assert.equal(label._enableOutline, true, '模板 Label 必须开描边');
    assert.deepEqual(
        [label._outlineColor as { r: number; g: number; b: number; a: number }].map(
            (c) => [c.r, c.g, c.b, c.a]),
        [[46, 32, 22, 255]], '描边色必须与设计稿一致（深棕 46,32,22）');
    assert.equal(label._outlineWidth, 2);
});
