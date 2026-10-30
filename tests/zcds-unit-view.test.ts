import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

/**
 * 单位视图（`ZCUnitView` + `ZCGameUnit.prefab`）的结构守卫。
 *
 * 这个视图曾经在 `initialize()` 里做三件事：`getChildByName('HealthBar')` 找血条、
 * `getChildByName('VisualRoot')` 找美术容器、**找不到就 `new Node('VisualRoot')` 现搭一个**。
 * 现在六个引用（含 `VisualRoot` / `HealthBar` 两个容器）全部由 prefab 绑定 ——
 * 这一组用例锁的就是「别再退回运行时兜底」。
 *
 * 判据三层：① 源码里不许有 `new Node` / `getChildByName` / `addComponent`；
 * ② 六个 `@property` 声明为 `null!` 且代码里不再判空 / 带 `?.`；
 * ③ prefab 上这六个引用都能反解到正确类型的对象（漏绑 = 运行时空指针）。
 */
const source = readFileSync('assets/script/app/zcds/view/ZCUnitView.ts', 'utf8');
const objects: any[] = JSON.parse(readFileSync(assetPath('ui/game/ZCGameUnit.prefab'), 'utf8'));

/** 反向断言前先剥注释（本文件的注释里就写着 `new Node`）。 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `@property` 名 → 期望类型（`cc.Node` 表示直接绑节点）。 */
const REFS: Record<string, string> = {
    rootTransform: 'cc.UITransform',
    visualRoot: 'cc.Node',
    sprite: 'cc.Sprite',
    fallback: 'cc.Graphics',
    fallbackLabel: 'cc.Label',
    healthBar: 'cc.ProgressBar',
};

test('单位视图不再自己建节点、也不再运行时找子节点', () => {
    const code = stripComments(source);
    assert.doesNotMatch(code, /new Node\(/, 'VisualRoot 必须由 prefab 提供');
    assert.doesNotMatch(code, /getChildByName\(/, 'HealthBar / VisualRoot 都由 prefab 绑定');
    assert.doesNotMatch(code, /\.addComponent\(/, '组件必须挂在 prefab 上');
});

test('六个 @property 声明为必填，且代码里不再判空或带 ?.', () => {
    const code = stripComments(source);
    for (const key of Object.keys(REFS)) {
        assert.match(code, new RegExp(`\\b${key}: \\w+ = null!;`), `${key} 应声明为 null!`);
        assert.doesNotMatch(code, new RegExp(`if \\(!this\\.${key}\\)`), `${key} 不应判空`);
        // ⚠️ 只禁「引用本身」的可选链：`this.healthBar.barSprite?.` 是引擎字段，允许。
        assert.doesNotMatch(code, new RegExp(`this\\.${key}\\?\\.`), `${key} 不应带 ?.`);
    }
});

test('ZCGameUnit.prefab 上六个引用都绑到正确类型的对象', () => {
    const script = objects.find((entry) => entry.rootTransform && entry.healthBar && entry.visualRoot);
    assert.ok(script, 'prefab 上应当挂着单位视图脚本');
    for (const [prop, type] of Object.entries(REFS)) {
        const ref = script[prop];
        assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 未绑定`);
        assert.equal(objects[ref.__id__].__type__, type, `${prop} 应指向 ${type}`);
    }
    // 两个容器节点必须是 prefab 里真实存在的固定节点（而不是运行时新建的）。
    const nodeOf = (prop: string) => {
        const target = objects[script[prop].__id__];
        return objects[target.__type__ === 'cc.Node' ? script[prop].__id__ : target.node.__id__];
    };
    assert.equal(nodeOf('visualRoot')._name, 'VisualRoot');
    assert.equal(nodeOf('healthBar')._name, 'HealthBar');
    assert.equal(nodeOf('fallbackLabel')._name, 'FallbackLabel');
    // 根节点就是 `rootTransform` 所属的那个节点（脚点尺寸写在它身上）。
    const rootIndex = objects.findIndex((entry) => entry.__type__ === 'cc.Node');
    assert.equal(objects[script.rootTransform.__id__].node.__id__, rootIndex);
});
