import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { getGuidePortraitAsset } from '../assets/script/app/guide/model/GuideDialogConfig';
import { fitGuidePortrait } from '../assets/script/app/guide/model/GuidePresentation';

// 执行真实显隐与实例化方法，保留父节点失活会隐藏骨骼子节点的引擎语义。
const source = ts.createSourceFile('GuideDialogView.ts', readFileSync(
    'assets/script/app/guide/ui/GuideDialogView.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const methods = view.members.filter(node => ts.isMethodDeclaration(node)
    && ['applyPortrait', 'hidePortrait', 'ensureNpc', 'fitNpc', 'setNodeSize', 'placePortrait']
        .includes(node.name.getText(source)));

class PortraitNode {
    active = true;
    name = '';
    layer = 33554432;
    parent: PortraitNode | null = null;
    children: PortraitNode[] = [];
    scale = 1;
    positionX = 0;
    positionY = 0;
    transform = {
        width: 200, height: 200, anchorY: 0.5,
        setContentSize(this: { width: number; height: number }, width: number, height: number) {
            this.width = width;
            this.height = height;
        },
    };
    get activeInHierarchy(): boolean { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(node: PortraitNode) { node.parent = this; this.children.push(node); }
    getChildByName(name: string) { return this.children.find((child) => child.name === name) ?? null; }
    getComponent() { return this.transform; }
    position = { x: 0, y: 0 };
    setPosition(x: number, y: number) { this.positionX = x; this.positionY = y; this.position = { x, y }; }
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
    }).outputText, { exports, console, getGuidePortraitAsset, PORTRAIT_DIALOG_GAP: 48,
        fitGuidePortrait, PORTRAIT_MAX_WIDTH_RATIO: 0.4, GUIDE_PORTRAIT_SPINE_NODE_NAME: 'spine',
        UITransform: class {}, Sprite: { SizeMode: { CUSTOM: 0 } },
        instantiate: () => {
            instances++;
            const node = new PortraitNode();
            node.transform.width = 942;
            node.transform.height = 769;
            // 真实骨骼：`skel/豌豆射手` 的根节点 + 固定子节点 spine（绑定框 654×916）。
            const visual = new PortraitNode();
            visual.name = 'spine';
            visual.transform.width = 654;
            visual.transform.height = 916;
            visual.transform.anchorY = 0.028;
            node.addChild(visual);
            return node;
        },
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
        hostTransform: { width: 720, height: 1560 }, dialogWidget: { bottom: 168 }, dialogTransform: { width: 660, height: 184 },
    });
    return { host, node, sprite, frames, instances: () => instances };
}

test('静图与骨骼均居中站在对话框上方，屏幕高度和对话框位置变化时仍完整露出', () => {
    const f = fixture();
    for (const height of [1280, 1560]) {
        f.host.hostTransform.height = height;
        for (const bottom of [168, 392]) {
            f.host.dialogWidget.bottom = bottom;
            for (const speaker of ['埃莉斯', '豌豆游侠']) {
                f.host.applyPortrait(speaker);
                assert.equal(f.node.positionY, -height / 2 + bottom + 184 + 48, '脚底在对话框和姓名牌上方');
                assert.equal(f.node.positionX, 0, '两位角色均居中');
            }
        }
    }
});

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
        // 骨骼绑定框 654×916 比静图胖，按 700 高会到 500 宽 ⇒ 被钳到 288 宽。
        assert.ok(Math.abs((f.host.npcNode?.scale ?? 0) - 720 * 0.4 / 654) < 1e-9, '骨骼同样受宽度上限约束');
    }
    assert.equal(f.instances(), 1);
});

test('豌豆按实际骨骼显示框缩放，脚点不落入对话框，不借用外层预制体的空白尺寸', () => {
    const f = fixture();
    f.host.portraitHeight = 460;
    f.host.applyPortrait('豌豆游侠');
    const bone = f.host.npcNode;
    assert.ok(bone);
    // 460 高会得到 328 宽 > 288 上限 ⇒ 按宽度钳，脚点仍对齐在缩放后的显示框上。
    assert.ok(Math.abs(bone.scale - 720 * 0.4 / 654) < 1e-9);
    assert.ok(Math.abs(654 * bone.scale - 720 * 0.4) < 1e-9, '显示宽正好等于上限');
    assert.ok(Math.abs(bone.positionY - 916 * 0.028 * bone.scale) < 1e-9);
    assert.equal(bone.activeInHierarchy, true);
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

test('骨骼与静图来回切时按当前宿主宽度重算实际节点尺寸', () => {
    const f = fixture();
    const bone = fitGuidePortrait(654, 916, 700, 720);
    const still = fitGuidePortrait(500, 800, 700, 720);
    f.host.applyPortrait('豌豆游侠');
    assert.ok(Math.abs(f.host.npcNode.scale * 916 - bone.height) < 1e-9);
    f.host.applyPortrait('埃莉斯');
    assert.equal(f.node.transform.width, Math.round(still.width));
    assert.equal(f.node.transform.height, Math.round(still.height), '静图用 round 后的整数高');
    f.host.hostTransform.width = 600;
    const resizedBone = fitGuidePortrait(654, 916, 700, 600);
    f.host.applyPortrait('豌豆游侠');
    assert.ok(Math.abs(f.host.npcNode.scale * 916 - resizedBone.height) < 1e-9,
        '骨骼节点只建一次，但切回来必须重新算尺寸');
});
