import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('借用主导航后置底，关闭时还原父节点、顺序和布局且可重复还原', () => {
    class FakeNode {
        isValid = true;
        parent: FakeNode | null = null;
        children: FakeNode[] = [];
        position = { x: 12, y: 23, z: 0, clone() { return { ...this }; } };
        widget = { enabled: true, isValid: true };
        transform = { height: 150 };
        getComponent(component: unknown) { return component === Widget ? this.widget : this.transform; }
        getSiblingIndex() { return this.parent?.children.indexOf(this) ?? 0; }
        setSiblingIndex(index: number) {
            if (!this.parent) return;
            const siblings = this.parent.children;
            siblings.splice(siblings.indexOf(this), 1);
            siblings.splice(index, 0, this);
        }
        setParent(parent: FakeNode | null) {
            if (this.parent) this.parent.children.splice(this.getSiblingIndex(), 1);
            this.parent = parent;
            parent?.children.push(this);
        }
        setPosition(position: { x: number; y: number; z: number } | number, vertical?: number) {
            if (typeof position === 'number') Object.assign(this.position, { x: position, y: vertical, z: 0 });
            else Object.assign(this.position, position);
        }
    }
    class Widget {}
    class UITransform {}
    const source = readFileSync('assets/script/app/bigmap/view/BigMapNavigation.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports: Record<string, Function> = {};
    runInNewContext(code, { exports, require: () => ({ Widget, UITransform }) });
    const host = new FakeNode();
    const navigation = new FakeNode();
    navigation.setParent(host);
    new FakeNode().setParent(host);
    const page = new FakeNode();
    page.transform.height = 1466;
    const mounted = exports.mountBigMapNavigation(navigation, page);
    assert.equal(mounted.height, 150);
    assert.equal(navigation.parent, page);
    assert.equal(navigation.widget.enabled, false);
    assert.equal(navigation.position.y, -658);
    mounted.restore();
    mounted.restore();
    assert.equal(navigation.parent, host);
    assert.equal(navigation.getSiblingIndex(), 0);
    assert.equal(navigation.position.x, 12);
    assert.equal(navigation.position.y, 23);
    assert.equal(navigation.widget.enabled, true);
});
