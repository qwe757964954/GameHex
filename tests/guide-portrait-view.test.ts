import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { getGuidePortraitAsset } from '../assets/script/app/guide/model/GuideDialogConfig';

// 执行真实显隐与实例化方法，保留父节点失活会隐藏骨骼子节点的引擎语义。
const source = ts.createSourceFile('GuideDialogView.ts', readFileSync(
    'assets/script/app/guide/ui/GuideDialogView.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const methods = view.members.filter(node => ts.isMethodDeclaration(node)
    && ['applyPortrait', 'hidePortrait', 'ensureNpc', 'setNodeSize'].includes(node.name.getText(source)));

class PortraitNode {
    active = true;
    layer = 33554432;
    parent: PortraitNode | null = null;
    children: PortraitNode[] = [];
    scale = 1;
    transform = { height: 200, setContentSize() {} };
    get activeInHierarchy(): boolean { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(node: PortraitNode) { node.parent = this; this.children.push(node); }
    getComponent() { return this.transform; }
    setPosition() {}
    setScale(value: number) { this.scale = value; }
}

function fixture() {
    const exports: { PortraitView?: new () => {
        applyPortrait(speaker: string): void;
        hidePortrait(): void;
    } } = {};
    let instances = 0;
    runInNewContext(ts.transpileModule(`exports.PortraitView = class { ${methods.map(node => node.getText(source)).join('\n')} };`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, getGuidePortraitAsset,
        UITransform: class {}, Sprite: { SizeMode: { CUSTOM: 0 } },
        instantiate: () => { instances++; return new PortraitNode(); },
    });
    const node = new PortraitNode();
    const sprite = { node, enabled: true, spriteFrame: null, sizeMode: 0 };
    const frames = new Map<string, object>([
        ['image/guide/guide_elis', { originalSize: { width: 500, height: 800 } }],
        ['skel/豌豆射手/豌豆射手', { name: '豌豆射手' }],
    ]);
    const host = Object.assign(new exports.PortraitView(), {
        portraitNode: node, portraitSprite: sprite, frames, npcNode: null as PortraitNode | null,
        currentMaskType: 'full', focusKey: '', portraitHeight: 700,
    });
    return { host, node, sprite, frames, instances: () => instances };
}

test('豌豆骨骼的父节点保持激活，静图与骨骼反复切换都可见且不重复实例化', () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
        f.host.applyPortrait('埃莉斯');
        assert.equal(f.node.activeInHierarchy, true);
        assert.equal(f.sprite.enabled, true);
        assert.equal(f.sprite.spriteFrame, f.frames.get('image/guide/guide_elis'));
        if (f.host.npcNode) assert.equal(f.host.npcNode.activeInHierarchy, false);
        f.host.applyPortrait('豌豆游侠');
        assert.equal(f.host.npcNode?.activeInHierarchy, true, '不能关闭骨骼所在的父节点');
        assert.equal(f.sprite.enabled, false, '只关闭静图组件');
        assert.equal(f.host.npcNode?.scale, 3.5);
    }
    assert.equal(f.instances(), 1);
});

test('高亮步骤隐藏立绘，恢复普通对话后骨骼和静图均可重新显示；缺资源不留空白框', () => {
    const f = fixture();
    f.host.applyPortrait('豌豆游侠');
    f.host.currentMaskType = 'hole';
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.host.npcNode?.activeInHierarchy, false);
    f.host.currentMaskType = 'full';
    f.host.focusKey = 'Main/CardEntry';
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.host.npcNode?.activeInHierarchy, false);
    f.host.focusKey = '';
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.host.npcNode?.activeInHierarchy, true);
    f.host.applyPortrait('埃莉斯');
    assert.equal(f.sprite.enabled, true);
    f.frames.clear();
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.node.activeInHierarchy, false);
    assert.equal(f.host.npcNode?.activeInHierarchy, false);
});
