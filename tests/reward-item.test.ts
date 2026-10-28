import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { AssetService, AssetLoadOptions } from '../assets/script/core/asset/AssetService';

/**
 * **公共奖励格** `ui/common/RewardItem.prefab` 的判据。
 *
 * 它被领地页三个弹窗（关卡界面 / 玩家关卡 / 宝箱详情）共用 —— 格子只建一份，
 * 宿主拿它当 `VirtualScrollView.itemPrefab` 或直接摆。所以这里的每一条都是「要么全对、要么全错」。
 */
const PREFAB = 'assets/resources/ui/common/RewardItem.prefab';
const CID = '1cf9efGyXZBA61uKwFzx5LJ'; // RewardItemView

type Obj = Record<string, any>;
const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const at = (ref: Obj | undefined): Obj | null => (
    ref && typeof ref === 'object' && typeof ref.__id__ === 'number' ? objects[ref.__id__] : null
);
const root = objects[objects[0].data.__id__];
const findNode = (name: string) => objects.find((o) => o?.__type__ === 'cc.Node' && o._name === name);
const tfOf = (node: Obj) => (node._components ?? []).map(at).find((c) => c?.__type__ === 'cc.UITransform');
const labelOf = (node: Obj) => (node._components ?? []).map(at).find((c) => c?.__type__ === 'cc.Label');
const spriteOf = (node: Obj) => (node._components ?? []).map(at).find((c) => c?.__type__ === 'cc.Sprite');

test('公共奖励格：96×96，根节点挂 RewardItemView，四个引用按类型绑齐', () => {
    assert.equal(root._name, 'RewardItem');
    assert.deepEqual(tfOf(root)!._contentSize, { __type__: 'cc.Size', width: 96, height: 96 });
    const comp = objects.find((o) => o?.__type__ === CID);
    assert.ok(comp, '根节点必须挂 RewardItemView');
    const expected: Record<string, string> = {
        frame: 'cc.Sprite',
        icon: 'cc.Sprite',
        num: 'cc.Label',
        rate: 'cc.Label',
    };
    for (const [key, type] of Object.entries(expected)) {
        const target = at(comp![key]);
        assert.ok(target, `${key} 必须绑定`);
        assert.equal(target!.__type__, type, `${key} 应绑定 ${type}`);
    }
});

test('公共奖励格：四个子节点齐全、layer 全是 UI_2D（MCP 存盘最容易掉的就是它）', () => {
    for (const name of ['Frame', 'Icon', 'Num', 'Rate']) {
        const node = findNode(name);
        assert.ok(node, `缺 ${name}`);
        assert.equal(node!._layer, 33554432, `${name} layer 必须 UI_2D`);
    }
    assert.equal(root._layer, 33554432);
    assert.deepEqual(tfOf(findNode('Frame')!)!._contentSize, { __type__: 'cc.Size', width: 96, height: 96 });
    assert.deepEqual(tfOf(findNode('Icon')!)!._contentSize, { __type__: 'cc.Size', width: 76, height: 76 });
});

test('公共奖励格：数量右下白字描边、概率底部（默认隐藏），都用 CLAMP 固定框', () => {
    const num = findNode('Num')!;
    const numLabel = labelOf(num)!;
    assert.equal(numLabel._fontSize, 22);
    assert.equal(numLabel._horizontalAlign, 2, '数量右对齐');
    assert.equal(numLabel._enableOutline, true, '白字要深色描边（压在彩色图标上也看得清）');
    assert.equal(numLabel._overflow, 1, 'CLAMP：框固定、文字不撑开');
    assert.deepEqual(tfOf(num)!._contentSize, { __type__: 'cc.Size', width: 52, height: 26 });

    const rate = findNode('Rate')!;
    const rateLabel = labelOf(rate)!;
    assert.equal(rateLabel._fontSize, 20);
    assert.equal(rateLabel._horizontalAlign, 1, '概率居中');
    assert.equal(rateLabel._overflow, 1);
    assert.equal(rate!._active, false, '概率默认隐藏（只有宝箱详情会打开）');
    assert.deepEqual(tfOf(rate)!._contentSize, { __type__: 'cc.Size', width: 100, height: 20 });
});

function loadClass(overrides: Record<string, unknown> = {}): {
    new (): Record<string, any>;
    useAssets(assets: AssetService): void;
} {
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Component {}
    class Sprite {}
    class Label {}
    // 组件内部会读表 + 拼路径：这些纯函数在单测里给最小桩（帧加载走 `assets`，没注入就是 null）
    const stubs: Record<string, unknown> = {
        '../../core/asset/ResourceScope': { ResourceScope },
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async () => [] } } },
        '../ArtPaths': { spriteFramePathOf: (path: string) => path },
        '../itemdetail/ItemDetailArt': { qualityFrameArtPath: () => 'common/cu_quality_01' },
        '../itemdetail/ItemDetailTable': { qualityFrameSuffixOf: () => 'green' },
        '../common/ResTypes': {
            ITEM_TABLE: 'item', ROLE_PROPERTY_TABLE: 'roleProperty',
            resBarCellOfRefId: () => null, resBarIconSpritePath: () => '',
        },
        ...overrides,
    };
    runInNewContext(code, { exports, require: (request: string) => {
        if (stubs[request]) return stubs[request];
        return {
            Component, Sprite, Label,
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        };
    } });
    return Object.values(exports)[0] as ReturnType<typeof loadClass>;
}

function createRewardLifecycleFixture(gate?: Promise<void>) {
    class Frame {
        refs = 0;
        isValid = true;
        uv: number[] | null = [0, 0, 1, 1];
        retain(): void { this.refs++; }
        release(): void {
            if (--this.refs === 0) { this.isValid = false; this.uv = null; }
        }
    }
    const frames = new Map<string, Frame>();
    const loads: string[] = [];
    const ViewClass = loadClass();
    const assets: AssetService = {
        async load<T>(path: string, _type: unknown, options?: AssetLoadOptions): Promise<T> {
            loads.push(path);
            if (gate) await gate;
            let frame = frames.get(path);
            if (!frame?.isValid) { frame = new Frame(); frames.set(path, frame); }
            if (options?.scope) {
                const retained = frame;
                retained.retain();
                options.scope.defer(() => retained.release());
            }
            return frame as T;
        },
        loadDir: async () => [], has: async () => true,
    };
    ViewClass.useAssets(assets);
    const createView = () => {
        const view = new ViewClass();
        Object.assign(view, { isValid: true, node: { active: true },
            frame: { spriteFrame: null }, icon: { spriteFrame: null, node: { active: true } },
            num: { string: '' }, rate: { string: '', node: { active: false } } });
        return view;
    };
    return { assets, createView, loads, frames };
}

async function flushFrames(): Promise<void> {
    for (let i = 0; i < 16; i++) await Promise.resolve();
}

test('奖励格持有图帧引用，其他流程释放共用图后仍能渲染；关窗重建重新取得有效帧', async () => {
    const h = createRewardLifecycleFixture();
    const battle = new ResourceScope('battle');
    const path = 'image/common/cu_quality_01';
    const shared = await h.assets.load(path, class {}, { scope: battle }) as { isValid: boolean; uv: unknown; refs: number };
    const first = h.createView();
    first.render({ resId: 7, amount: 1 });
    await flushFrames();
    assert.equal(first.frame.spriteFrame, shared);
    battle.dispose();
    assert.equal(shared.isValid, true, '奖励格仍显示时不能被对局作用域释放成 uv=null');
    first.render({ resId: 7, amount: 2 });
    await flushFrames();
    assert.equal(shared.refs, 1, '重复 render 共用本格租约，不能反复加引用');
    first.onDestroy();
    assert.equal(shared.refs, 0, '关窗销毁必须释放动态帧');
    const second = h.createView();
    second.render({ resId: 7, amount: 1 });
    await flushFrames();
    assert.equal(second.frame.spriteFrame.isValid, true);
    assert.ok(second.frame.spriteFrame.uv);
    assert.notEqual(second.frame.spriteFrame, shared, '重建不能拿到上一趟已销毁的静态缓存');
    second.onDestroy();
});

test('奖励格加载期间销毁不再写 Sprite，也不留下资源引用', async () => {
    let complete: () => void = () => {};
    const h = createRewardLifecycleFixture(new Promise(resolve => { complete = resolve; }));
    const view = h.createView();
    view.render({ resId: 7, amount: 1 });
    await flushFrames();
    assert.ok(h.loads.length > 0, '模拟资源加载尚未完成时关闭');
    view.onDestroy();
    complete();
    await flushFrames();
    assert.equal(view.frame.spriteFrame, null);
    assert.equal(view.icon.spriteFrame, null);
    for (const frame of h.frames.values()) assert.equal(frame.refs, 0);
});

test('RewardItemView：只喂 {resId, amount} —— 数量/概率同步写，帧由组件自己解析', () => {
    const ViewClass = loadClass();
    const view = new ViewClass();
    const node = () => ({ active: true, setSiblingIndex() {} });
    view.node = node();
    view.frame = { spriteFrame: 'stale' };
    view.icon = { spriteFrame: 'stale', node: node() };
    view.num = { string: '' };
    view.rate = { string: '', node: node() };

    // 概率是百分比（70 ⇒ 70%），数量取整；帧先被清掉再异步填（避免回收复用串图）
    view.render({ resId: 16014, amount: 8, ratePercent: 70 });
    assert.equal(view.num.string, '8');
    assert.equal(view.rate.string, '70%');
    assert.equal(view.rate.node.active, true);
    assert.equal(view.frame.spriteFrame, null, '上一趟的帧必须先清掉');
    assert.equal(view.icon.spriteFrame, null);
    assert.equal(view.node.active, true);

    view.render({ resId: 16014, amount: 0 });
    assert.equal(view.num.string, '', '数量 0 不显示');
    assert.equal(view.rate.node.active, false, '不传概率就整行隐藏');

    // 条数由 `setTotalCount` 限死 ⇒ 不再需要「空位 clear」那条路径
});

test('公共奖励格：品质框路径必须带 `image/` 前缀（`qualityFrameArtPath` 只给相对片段）', () => {
    const src = readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8');
    // 2026-10-28 真机踩过：漏了前缀 ⇒ 图标正常、品质框整片空白（不报错）
    assert.match(src, /`image\/\$\{qualityFrameArtPath/, '品质框路径必须补 image/ 前缀');
});

test('公共奖励格：资源入口必须在**组合根**注入（不能只靠主界面顺带）', () => {
    // 🔴 结算弹窗走**对局流程**，不经过 `MainTabHost.showPage` ⇒ 注入点必须在组合根
    //    （`ProcedureBootstrap`），否则奖励格静默渲染成空框、零报错。
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    assert.match(bootstrap, /RewardItemView\.useAssets\(assets\)/, '组合根必须注入资源入口');

    // 主界面那份已被组合根取代 ⇒ 不许再有第二个注入点（重复真源 ⇒ 迟早漂移）
    const tabHost = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    assert.doesNotMatch(tabHost, /RewardItemView\.useAssets/, 'MainTabHost 不再重复注入（组合根已统一）');
    assert.doesNotMatch(tabHost, /import \{ RewardItemView \}/, 'MainTabHost 不再依赖 RewardItemView');
});

test('公共奖励格：帧加载失败必须出声（不许静默吞成空框）', () => {
    const src = readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8');
    // 🔴 静默 `() => null` ⇒ 奖励格渲染成空框、零报错（看不出是"图没加载"还是"没数据"）
    assert.match(src, /奖励格资源加载失败/, '加载失败必须 warn 出声');
    assert.doesNotMatch(src, /\)\s*,\s*\(\)\s*=>\s*null\s*\)/, '不许再把失败静默吞掉');
});
