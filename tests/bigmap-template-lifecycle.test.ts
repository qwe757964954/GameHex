import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function createViewHarness() {
    class Component { unschedule(): void {} }
    class Color {}
    class Templates {}
    const bindings = { groundTemplate: {}, decorTemplate: {}, markerTemplate: {} };
    let clones = 0;
    let destroyed = 0;
    const root = { parent: null, active: true, getComponent: () => bindings, destroy: () => { destroyed++; } };
    const exports: Record<string, unknown> = {};
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, { exports, require(name: string) {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value,
            property: () => () => undefined }, Component, Color, instantiate: () => { clones++; return root; } };
        if (name === './BigMapWorldLayout') return { buildBigMapWorldLayout: () => ({}) };
        if (name === './BigMapWorldTemplates') return { BigMapWorldTemplates: Templates };
        return {};
    } });
    const View = exports.BigMapWorldView as new () => {
        templatesPrefab: object | null; groundTemplate: object; decorTemplate: object; markerTemplate: object;
        ensureTemplates(): void; onDestroy(): void;
    };
    const view = new View();
    view.templatesPrefab = {};
    return { view, root, bindings, clones: () => clones, destroyed: () => destroyed };
}

test('模板实例不挂入页面，重复构建复用，销毁视图时释放', () => {
    const h = createViewHarness();
    h.view.ensureTemplates();
    h.view.ensureTemplates();
    assert.equal(h.clones(), 1);
    assert.equal(h.root.parent, null);
    assert.equal(h.root.active, false);
    assert.equal(h.view.groundTemplate, h.bindings.groundTemplate);
    assert.equal(h.view.decorTemplate, h.bindings.decorTemplate);
    assert.equal(h.view.markerTemplate, h.bindings.markerTemplate);
    h.view.onDestroy();
    assert.equal(h.destroyed(), 1);
});

test('切走世界页时子节点已销毁，onDestroy 不再访问其事件处理器', () => {
    const h = createViewHarness();
    const view = h.view as unknown as { viewport: object; onDestroy(): void };
    view.viewport = { off() { throw new Error('子节点事件处理器已被 Cocos 销毁'); } };
    assert.doesNotThrow(() => view.onDestroy());
});
