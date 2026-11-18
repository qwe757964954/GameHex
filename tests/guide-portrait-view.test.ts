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
// 第 25 条起 `placePortrait` 把横竖公式拆成了 `portraitFoot` / `portraitDropX`（避让判据复用它们），
// 一起搬进沙箱，否则 `applyPortrait` 里那次摆放会打空。
const methods = view.members.filter(node => ts.isMethodDeclaration(node)
    && ['applyPortrait', 'hidePortrait', 'ensureNpc', 'fitNpc', 'setNodeSize', 'placePortrait',
        'portraitFoot', 'portraitDropX', 'portraitBoxWidth']
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
        fitGuidePortrait, PORTRAIT_MAX_WIDTH_RATIO: 0.4, PORTRAIT_BOX_WIDTH_RATIO: 149 / 720, PORTRAIT_SINK_RATIO: 0.25, PORTRAIT_RIGHT_INSET: 0,
        GUIDE_PORTRAIT_SPINE_NODE_NAME: 'spine',
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
        portraitSide: 1 as 1 | -1, portraitShown: false, portraitSuppressed: false,
        hostTransform: { width: 720, height: 1560 }, dialogWidget: { bottom: 168 }, dialogTransform: { width: 660, height: 184 },
    });
    return { host, node, sprite, frames, instances: () => instances };
}

test('静图与骨骼都贴着对话框右侧边框站，脚点沉入对话框 1/4 高度', () => {
    const f = fixture();
    for (const height of [1280, 1560]) {
        f.host.hostTransform.height = height;
        for (const bottom of [168, 392]) {
            f.host.dialogWidget.bottom = bottom;
            for (const speaker of ['埃莉斯', '豌豆游侠']) {
                f.host.applyPortrait(speaker);
                const dialogTop = -height / 2 + bottom + 184;
                // 脚点 = 对话框顶 − 立绘高的 1/4（`PORTRAIT_SINK_RATIO`）：只露出大半个身子。
                const foot = dialogTop - f.host.portraitDisplayHeight * 0.25;
                assert.ok(Math.abs(f.node.positionY - foot) < 1e-6, '脚点沉进对话框 1/4 高度');
                // 立绘右缘贴对话框右边框（第 3 条口径：角色形象右对齐）。
                const x = 660 / 2 - f.host.portraitDisplayWidth / 2;
                assert.ok(Math.abs(f.node.positionX - x) < 1e-6, '两位角色都贴右侧边框');
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
        // 立绘盒宽 = 宿主宽 × 149/720（绿框口径）⇒ 654×916 的骨骼按宽度钳。
        assert.ok(Math.abs((f.host.npcNode?.scale ?? 0) - 720 * (149 / 720) / 654) < 1e-9, '骨骼同样受宽度上限约束');
    }
    assert.equal(f.instances(), 1);
});

test('豌豆按实际骨骼显示框缩放，脚点不落入对话框，不借用外层预制体的空白尺寸', () => {
    const f = fixture();
    f.host.portraitHeight = 460;
    f.host.applyPortrait('豌豆游侠');
    const bone = f.host.npcNode;
    assert.ok(bone);
    // 盒宽 = 720 × 149/720 = 149 ⇒ 按宽度钳，脚点仍对齐在缩放后的显示框上。
    assert.ok(Math.abs(bone.scale - 720 * (149 / 720) / 654) < 1e-9);
    assert.ok(Math.abs(654 * bone.scale - 720 * (149 / 720)) < 1e-9, '显示宽正好等于上限');
    assert.ok(Math.abs(bone.positionY - 916 * 0.028 * bone.scale) < 1e-9);
    assert.equal(bone.activeInHierarchy, true);
});

test('hole 步也站着（挡不挡孔交给避让判据），缺资源仍不留空白框', () => {
    const f = fixture();
    f.host.applyPortrait('豌豆游侠');
    // 第 25 条：升级卡牌那两步（6-2 / 6-3）就是 hole 步，旧口径「hole 一律藏」把 NPC 形象整个丢了
    // （用户截图：立绘位置空着，只剩气泡和手指）。显隐改由 `syncPortraitSuppression` 按几何判。
    f.host.currentMaskType = 'hole';
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.host.npcNode?.activeInHierarchy, true, 'hole 步也要站起来，挡住孔才由 sync 收');
    // `full` 步同理不按「有没有焦点」藏立绘（用户第 16 条 ②）：早前那样做，
    // 几乎每一步都有焦点 ⇒ 整段引导里角色形象一次都没露过脸。
    f.host.currentMaskType = 'full';
    f.host.focusKey = 'Main/CardEntry';
    f.host.applyPortrait('豌豆游侠');
    assert.equal(f.host.npcNode?.activeInHierarchy, true);
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
    const bone = fitGuidePortrait(654, 916, 720 * (149 / 720), 700);
    const still = fitGuidePortrait(500, 800, 720 * (149 / 720), 700);
    f.host.applyPortrait('豌豆游侠');
    assert.ok(Math.abs(f.host.npcNode.scale * 916 - bone.height) < 1e-9);
    f.host.applyPortrait('埃莉斯');
    assert.equal(f.node.transform.width, Math.round(still.width));
    assert.equal(f.node.transform.height, Math.round(still.height), '静图用 round 后的整数高');
    f.host.hostTransform.width = 600;
    const resizedBone = fitGuidePortrait(654, 916, 600 * (149 / 720), 600);
    f.host.applyPortrait('豌豆游侠');
    assert.ok(Math.abs(f.host.npcNode.scale * 916 - resizedBone.height) < 1e-9,
        '骨骼节点只建一次，但切回来必须重新算尺寸');
});
