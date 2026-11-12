import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as resTypes from '../assets/script/app/common/ResTypes';
import * as mainResBar from '../assets/script/app/main/MainResBarTypes';

function fixture(enabled: boolean) {
    const source = readFileSync('assets/script/app/common/ResBar.ts', 'utf8');
    const dependencies: Record<string, unknown> = {};
    for (const match of source.matchAll(/from '([^']+)'/g)) dependencies[match[1]] = {};
    class Value { constructor(..._values: unknown[]) {} }
    class TestNode {
        parent: any; children: TestNode[] = []; layer = 0; active = false;
        constructor(readonly name: string) {}
        setParent(parent: any) { this.parent = parent; parent.children.push(this); }
        addComponent() { return { node: this }; }
        setSiblingIndex() {}
    }
    Object.assign(dependencies, {
        cc: { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} }, Component: class { isValid = true; },
            Color: Value, Vec3: Value, Layout: class {}, Widget: class {}, UITransform: class {}, Node: TestNode, Graphics: class {} },
        './ResTypes': resTypes,
        '../main/MainResBarTypes': mainResBar,
        '../main/MainRoleRow': { readRoleRow: () => ({ gold: 943, coin: 20, gem: 30 }) },
    });
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText,
        { exports, require: (name: string) => dependencies[name], console });
    const bar = new exports.ResBar();
    const slots = [0,1,2].map(() => ({ node: { active: true, children: [] }, value: '', spendDeltaOf: () => 0,
        render(cell: { valueText: string } | null) { this.node.active = !!cell; this.value = cell?.valueText ?? ''; } }));
    [bar.slot0,bar.slot1,bar.slot2] = slots;
    bar.node = { layer: 0, children: [], getComponent: () => ({}) };
    let keys = ['gold'];
    const activeCounts: number[] = [];
    let aligned = 0;
    bar.barTransform = { height: 106 };
    bar.slotsLayout = { enabled, cellSize: { width:132,height:40 }, updateLayout: () => activeCounts.push(slots.filter(slot => slot.node.active).length) };
    bar.barWidget = { updateAlignment: () => { aligned++; } };
    bar.readTables = async () => [[],[],[]];
    bar.resolveCells = () => ({ keys, iconByKey: new Map() });
    return { bar, slots, activeCounts, keys(value: string[]) { keys = value; }, get aligned() { return aligned; } };
}

test('ResBar 根据 1/2/3 个实际资源格重排，再对齐右上角，重填时清理旧格', async () => {
    const f = fixture(true);
    for (const keys of [['gold'], ['gold','coin'], ['gold','coin','gem'], ['gold']]) {
        f.keys(keys); await f.bar.reload();
        assert.equal(f.activeCounts.at(-1), keys.length, '先更新显隐，再让 Layout 计算宽度');
        assert.equal(f.bar.barTransform.height, 40);
        assert.equal(f.slots[0].value, '943');
    }
    assert.equal(f.aligned, 4);
    assert.equal(f.slots[1].node.active, false); assert.equal(f.slots[2].node.active, false);
});

test('已有固定布局的 ResBar 保留宿主位置和尺寸', async () => {
    const f = fixture(false); await f.bar.reload();
    assert.equal(f.activeCounts.length, 0); assert.equal(f.aligned, 0);
    assert.equal(f.bar.barTransform.height, 106);
});

test('资源反馈逐帧推进所有已绑槽位，空槽跳过且不生成槽位数组', () => {
    const { bar } = fixture(false);
    const calls: string[] = [];
    let active = true;
    bar.slot0 = { step: () => { calls.push('0'); return active; } };
    bar.slot1 = null;
    bar.slot2 = { step: () => { calls.push('2'); return false; } };
    bar.stepFlash = () => { calls.push('flash'); return false; };
    bar.hostSlots = () => { throw new Error('update 不应分配槽位数组'); };
    bar.feedbackActive = true;
    bar.update(1 / 60);
    assert.deepEqual(calls, ['0', '2', 'flash'], '前槽在播也不能短路掉后槽');
    assert.equal(bar.feedbackActive, true);
    active = false;
    bar.update(1 / 60);
    assert.equal(bar.feedbackActive, false);
    const count = calls.length;
    bar.update(1 / 60);
    assert.equal(calls.length, count, '空闲不继续推进');
});

test('共享 ResBar 预挂 Layout 与 Widget，技能弹窗直接使用实例，不再带偏移补偿容器', () => {
    const shared = JSON.parse(readFileSync('assets/resources/ui/common/ResBar.prefab', 'utf8'));
    const bar = shared.find(c => 'slotsLayout' in c);
    assert.equal(shared[bar.slotsLayout.__id__].__type__, 'cc.Layout');
    assert.equal(shared[bar.slotsLayout.__id__]._resizeMode, 1);
    assert.equal(shared[bar.slotsLayout.__id__]._layoutType, 1);
    assert.equal(shared[bar.barWidget.__id__].__type__, 'cc.Widget');
    const skill = JSON.parse(readFileSync('assets/bundles/main-pages/ui/card/CardSkill.prefab', 'utf8'));
    const root = skill[skill[0].data.__id__];
    assert.equal(root._children.map(ref => skill[ref.__id__]._name).includes('Currency'), false);
    assert.equal(skill[root._children[0].__id__]._name, 'Dim');
});


test('ResBar 自适应布局不会把扣费闪光算成第四个资源格', () => {
    const f = fixture(true);
    const glow = f.bar.ensureGlow();
    assert.equal(glow.node.parent, f.slots[0].node);
    assert.equal(f.bar.node.children.length, 0);
});
