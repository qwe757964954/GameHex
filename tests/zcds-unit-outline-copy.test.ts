import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/** 可观测的骨架桩：记录每次 `setAnimation`，并让缩放 / 材质 / 预乘口径可读回。 */
class FakeSkeleton {
    /** 顶点色：视图写的是 `ZC_CLIENT_COLORS` 那些真 `cc.Color`，桩按 rgb 形状收下即可。 */
    color: { r: number; g: number; b: number } | null = null;
    premultipliedAlpha = false;
    customMaterial: unknown = null;
    sockets: unknown[] = [];
    readonly calls: string[] = [];
    readonly skeletonData = {
        getRuntimeData: () => ({ x: 0, y: 0, width: 800, height: 916,
            animations: [{ name: 'idle' }, { name: 'move' }, { name: 'attack' }] }),
    };
    setAnimation(_track: number, name: string) { this.calls.push(name); return {}; }
}

/** 每调一次 `make()` 就产出一份「美术实例 + 它的骨架」，便于区分主美术与轮廓副本。 */
function spinePrefab(cc: any, FakeNode: any, skeletons: FakeSkeleton[]) {
    return { make: () => {
        const node = new FakeNode('NutVisual');
        const skeleton = new FakeSkeleton();
        skeletons.push(skeleton);
        node.getComponent = ((type: unknown) => (type === cc.sp.Skeleton ? skeleton : null)) as typeof node.getComponent;
        return node;
    } };
}

function framePrefab(cc: any, FakeNode: any) {
    return { make: () => {
        const node = new FakeNode('NutVisual');
        const sprite = { color: null as unknown };
        const animation = { clips: [{ name: 'nut-idle' }], defaultClip: null, play() {}, stop() {} };
        node.getComponent = ((type: unknown) => (type === cc.Sprite ? sprite
            : type === cc.Animation ? animation : null)) as typeof node.getComponent;
        return node;
    } };
}

/** 把 ZCUnitView 的 prefab 绑定按 `ZCGameUnit.prefab` 的实际形态补满（缺一个就当场炸）。 */
function setupView(load: (name: string) => any, bar: any, FakeNode: any) {
    const view = new (load('./ZCUnitView').ZCUnitView)();
    view.rootTransform = { setContentSize() {} };
    view.visualRoot = new FakeNode('VisualRoot');
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: new FakeNode(), clear() {}, circle() {}, fill() {} };
    view.fallbackLabel = { node: new FakeNode(), enabled: true, string: '' };
    view.healthBar = bar();
    view.barFillPlayer = { name: 'player' };
    view.barFillEnemy = { name: 'enemy' };
    view.barFillEnemy2 = { name: 'enemy2' };
    view.barFillEnemy3 = { name: 'enemy3' };
    return { view };
}

test('整体外轮廓 = 美术放大副本：子序在角色之下、同朝向同拍、只在非己方显示', () => {
    const { load, bar, cc, FakeNode } = loadViews();
    const { view } = setupView(load, bar, FakeNode);
    const copyMaterial = { name: 'outline-copy' };
    view.setOutlineCopyMaterial(copyMaterial);

    const skeletons: FakeSkeleton[] = [];
    const prefab = spinePrefab(cc, FakeNode, skeletons);
    view.initialize(prefab, 1);
    const [main, copy] = skeletons;
    assert.equal(skeletons.length, 2, 'spine 美术要再建一份放大副本');

    // 子序：副本必须画在美术**之下** —— 盖到美术身上整只兵会变成一个色块。
    assert.deepEqual(view.visualRoot.children.map((child: any) => child.name),
        ['NutVisual_OutlineCopy', 'NutVisual'],
        '子序必须是 [副本, 美术]');
    assert.equal(copy.customMaterial, copyMaterial, '副本要拿到整体轮廓材质');
    assert.equal(copy.premultipliedAlpha, true,
        'shader 按预乘口径输出（见 unit-outline-copy.effect），这里必须钉死');
    assert.equal(copy.calls.length, 0, '建副本时不动画：等第一帧 render 才会对齐');

    const unit: any = { hp: 100, maxHp: 100, owner: 'enemy', battleState: 'idle',
        facingRadians: 0, completedAttackCount: 0 };
    const definition = { hero: false, attackRange: 20 };
    const render = () => view.render({ unit, definition, x: 0, y: 0, now: 0 });
    render();

    const copyNode = view.outlineCopyNode;
    assert.equal(copyNode.active, true, '非己方要显示整体轮廓');
    assert.deepEqual(copy.calls, ['idle'], '副本要跟主美术同一拍起播');
    assert.deepEqual([copy.color.r, copy.color.g, copy.color.b], [251, 73, 105],
        '副本用阵营描边色（enemyEdge）');
    for (const axis of ['x', 'y'] as const) {
        assert.ok(Math.abs(copyNode.scale[axis] - view.visualNode.scale[axis] * 1.08) < 1e-9,
            `副本 ${axis} 缩放 = 美术 × 1.08（绕脚点放大，脚底不动、越往上外扩越多）`);
    }
    assert.equal(copyNode.scale.z, view.visualNode.scale.z, '2D 下 z 不参与放大');

    // 同一拍内反复 render 不许重复 setAnimation —— 那会让副本永远停在第 1 帧。
    for (let frame = 0; frame < 5; frame++) render();
    assert.deepEqual(copy.calls, ['idle'], '同一拍的 render 必须是幂等的');

    // 朝向翻转：副本必须跟着翻，否则描边会从角色另一侧长出来。
    unit.facingRadians = Math.PI;
    render();
    assert.ok(copyNode.scale.x < 0 && Math.abs(copyNode.scale.x - view.visualNode.scale.x * 1.08) < 1e-9,
        '副本与美术同朝向');

    // 攻击每起手一次都会重起动画 ⇒ 副本必须跟着重起（否则两份骨架相位错开）。
    unit.facingRadians = 0;
    unit.battleState = 'attack';
    render();
    assert.deepEqual(main.calls, ['idle', 'attack']);
    assert.deepEqual(copy.calls, ['idle', 'attack'], '副本跟着重起攻击（朝向翻转不该重起动画）');
    render();
    assert.deepEqual(copy.calls, ['idle', 'attack'], '攻击进行中不重复起播');
    unit.completedAttackCount = 1;
    render();
    assert.equal(copy.calls[copy.calls.length - 1], 'attack', '第二次起手要再对齐一次');

    // 我方 / 阵亡都不出整体轮廓（而副本停在原地，不是被销毁）。
    unit.owner = 'player';
    render();
    assert.equal(copyNode.active, false, '己方不出整体轮廓');
    unit.owner = 'enemy';
    unit.battleState = 'dead';
    render();
    assert.equal(copyNode.active, false, '阵亡不出整体轮廓');
});

test('对象池复用后副本跟着新体型/新阵营走；切到序列帧美术或不给材质时只关整体轮廓', () => {
    const { load, bar, cc, FakeNode } = loadViews();
    const { view } = setupView(load, bar, FakeNode);
    view.setOutlineCopyMaterial({ name: 'outline-copy' });
    const skeletons: FakeSkeleton[] = [];
    const prefab = spinePrefab(cc, FakeNode, skeletons);
    view.initialize(prefab, 1);
    const unit: any = { hp: 100, maxHp: 100, owner: 'enemy', battleState: 'idle',
        facingRadians: 0, completedAttackCount: 0 };
    const definition = { hero: false, attackRange: 20 };
    const render = () => view.render({ unit, definition, x: 0, y: 0, now: 0 });
    render();
    const copyNode = view.outlineCopyNode;
    const copy = skeletons[1];

    // 复用同一个 prefab（`initialize` 的早退分支）：副本不重建，但缩放要跟新体型、动画要重新对齐。
    view.initialize(prefab, 1.2);
    assert.equal(view.outlineCopyNode, copyNode, '复用同一份美术时副本也复用');
    assert.ok(Math.abs(copyNode.scale.y - view.visualNode.scale.y * 1.08) < 1e-9, '体型改了副本要跟');
    render();
    assert.equal(copy.calls.length, 2, '复用后重新起播 ⇒ 副本再对齐一次');

    // 材质被摘掉（effect 加载失败）：整层轮廓直接关掉。
    view.setOutlineCopyMaterial(null);
    render();
    assert.equal(copyNode.active, false, '没有整体轮廓材质就不出整体轮廓');
    assert.equal(copy.customMaterial, null, '材质要真的从副本上摘掉');

    // 换成分件序列帧美术：没有整体外形可描 ⇒ 副本销毁，不留半成品节点。
    view.initialize(framePrefab(cc, FakeNode), 1);
    assert.equal(view.outlineCopyNode, null, '序列帧美术不建整体轮廓');
    assert.equal(view.visualRoot.children.filter((child: any) => child.name.endsWith('_OutlineCopy')).length, 0,
        '副本节点必须被销毁（否则留在美术层里当幽灵）');
    assert.deepEqual(view.visualRoot.children.map((child: any) => child.name),
        ['NutVisual'], '只剩美术');

    // 切到无美术：同样要把副本清干净。
    view.initialize(null, 1);
    assert.equal(view.outlineCopyNode, null);
    assert.equal(view.visualRoot.children.filter((child: any) => child.name.endsWith('_OutlineCopy')).length, 0);
});
