import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';

const prefab = JSON.parse(readFileSync(assetPath('ui/game/ZCGameHUD.prefab'), 'utf8')) as Array<Record<string, any>>;
const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((node) => node._name === name);
const components = (node: Record<string, any>) => node._components.map((ref: { __id__: number }) => prefab[ref.__id__]);

test('参与席位由顶栏居中的横向 Layout 排列', () => {
    const layout = nodeNamed('ScoreLayout');
    const top = nodeNamed('TopInfoPanel');
    assert.ok(layout && top);
    assert.equal(layout._parent.__id__, prefab.indexOf(top));
    assert.ok(components(layout).some((component: Record<string, any>) => component.__type__ === 'cc.Layout'));
    const widget = components(layout).find((component: Record<string, any>) => component.__type__ === 'cc.Widget');
    assert.ok(widget);
    assert.ok(widget._alignFlags & 16, 'Widget 水平居中');
    assert.deepEqual(layout._children.map((ref: { __id__: number }) => prefab[ref.__id__]._name),
        ['Score1', 'Score2', 'Score3', 'Score4']);
});

test('Score 自身绘制九宫格底图，并按领先状态改变真实尺寸', () => {
    for (const name of ['Score1', 'Score2', 'Score3', 'Score4']) {
        const node = nodeNamed(name);
        assert.ok(node);
        assert.ok(components(node).some((component: Record<string, any>) => component.__type__ === 'cc.Sprite' && component._type === 1));
        assert.deepEqual(node._children.map((ref: { __id__: number }) => prefab[ref.__id__]._name), ['Value', 'Cross']);
    }
    const source = readFileSync('assets/script/app/zcds/view/ZCGameHudScoreSlot.ts', 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const loaded = { exports: {} as Record<string, any> };
    class UITransformStub {}
    class Vec3 { constructor(public x = 1, public y = 1, public z = 1) {} }
    /** 同步补间桩：start 时按最终比例 ratio=1 跑 onUpdate、再执行 call，等价于引擎里补间自然结束。 */
    const fakeTween = (target: unknown) => {
        const steps: Array<{ opts?: { onUpdate?: (t: unknown, r: number) => void }; fn?: () => void }> = [];
        const chain = {
            to(_duration: number, _props: Record<string, unknown>, opts: { onUpdate?: (t: unknown, r: number) => void }) {
                steps.push({ opts });
                return chain;
            },
            call(fn: () => void) { steps.push({ fn }); return chain; },
            start() {
                for (const step of steps) {
                    if (step.opts) step.opts.onUpdate?.(target, 1);
                    else step.fn?.();
                }
                return chain;
            },
            stop() { return chain; },
        };
        return chain;
    };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        assert.equal(name, 'cc');
        return {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, Label: class {}, Sprite: class {}, UITransform: UITransformStub, Vec3,
            tween: fakeTween,
        };
    }, loaded, loaded.exports);
    const Slot = loaded.exports.ZCGameHudScoreSlot;
    const slot = new Slot();
    //  `render` 从 `this.node` 上取 UITransform（2026-10-13：去掉 `ownRect` 这个必填 @property，
    //  它在 prefab 里没绑、取值即 null，直接让整个 render 崩在 `ownRect.width`）。
    //  2026-10-14 起 render 还会读/写 `node.scale`（数字变化的弹跳），桩里必须给上。
    const rect = { width: 94, height: 66, setContentSize(width: number, height: number) {
        this.width = width; this.height = height;
    } };
    (slot as unknown as { node: unknown }).node = {
        scale: { x: 1, y: 1, z: 1 },
        setScale(x: number, y?: number, z?: number) { this.scale = { x, y: y ?? x, z: z ?? 1 }; },
        getComponent: (cid: unknown) => (cid === UITransformStub ? rect : null),
    };
    // `render` 现在还会读 `value.node.scale`（数字弹跳），给 Value 一个独立节点桩。
    slot.value = {
        enabled: true, string: '', fontSize: 28, lineHeight: 39, isBold: false,
        node: {
            scale: { x: 1, y: 1, z: 1 },
            setScale(x: number, y?: number, z?: number) { this.scale = { x, y: y ?? x, z: z ?? 1 }; },
        },
    };
    slot.cross = { enabled: false };
    //  render 无返回值；尺寸每次都重设（setContentSize 幂等）。
    slot.render({ value: 7, finished: false, leading: true });
    assert.deepEqual([rect.width, rect.height, slot.value.string], [110, 77, '7']);
    slot.render({ value: 7, finished: false, leading: true });
    assert.deepEqual([rect.width, rect.height], [110, 77]);
    slot.render({ value: 0, finished: true, leading: false });
    assert.deepEqual([rect.width, rect.height, slot.value.enabled, slot.cross.enabled], [94, 66, false, true]);
});
