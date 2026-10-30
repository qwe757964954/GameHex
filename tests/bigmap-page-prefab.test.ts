import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const path = 'assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab';
test('页面、基地与公共样式不再运行时搭建 UI', () => {
    for (const file of readdirSync('assets/script/app/bigmap/view').filter((name) => name.endsWith('.ts'))) {
        const source = readFileSync(`assets/script/app/bigmap/view/${file}`, 'utf8');
        assert.doesNotMatch(source, /new Node\(|\.addComponent\(|createUiNode|createLabel|createButton|createBigMapSprite|destroyAllChildren/);
    }
    assert.ok(existsSync(path), '固定界面必须落为可编辑 Prefab');
});

test('页面模板引用完整，所有 UI 节点都有尺寸组件，CUSTOM Sprite 禁止裁剪回写', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8'));
    const bindings = objects.find((o: object) => 'resourceLabels' in o && 'buildRowTemplate' in o);
    assert.ok(bindings);
    assert.equal(bindings.resourceLabels.length, 5);
    assert.equal(bindings.resourceIcons.length, 5);
    for (const [name, ref] of Object.entries(bindings)) {
        if (ref && typeof ref === 'object' && '__id__' in ref) assert.ok(objects[ref.__id__ as number], name);
    }
    for (const node of objects.filter((o: { __type__: string }) => o.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, node._name);
        assert.ok(node._components.some((r: { __id__: number }) => objects[r.__id__].__type__ === 'cc.UITransform'), node._name);
    }
    for (const sprite of objects.filter((o: { __type__: string; _sizeMode: number }) => o.__type__ === 'cc.Sprite' && o._sizeMode === 0)) {
        assert.equal(sprite._isTrimmedMode, false);
    }
    assert.ok(objects.some((o: object) => 'plotTemplate' in o && 'viewport' in o));
    assert.ok(objects.some((o: object) => 'selection' in o && 'resource' in o && 'badgeTransform' in o));
});
