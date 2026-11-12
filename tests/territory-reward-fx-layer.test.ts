import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 2026-11-11「飞舞的 icon 粒子要处在 UI 的上层，现在被聊天框挡住」。
 *
 * 三层判据：
 *  ① prefab 层级真值 —— 页面内 `TerritoryOverlay` 为什么盖不过聊天框 / 底栏；
 *  ② VM 行为 —— 宿主注入 / 回退 / 换宿主清池 / 坐标换算真的换了坐标系；
 *  ③ 源码守卫 —— 接线顺序与「其它表演不许被顺手迁层」的边界。
 */

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const MAIN_ROOT = 'assets/resources/ui/main/MainRoot.prefab';
const ARENA_ROOT = 'assets/resources/ui/main/ArenaRoot.prefab';
const TERRITORY_PREFAB = 'assets/resources/ui/main/MainTerritoryMap.prefab';

const src = (path: string): string => readFileSync(path, 'utf8');
/** 去掉注释只留真代码 —— 防止「注释里写了就算接线」的假绿。 */
const body = (path: string): string => src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** 按大括号配对切方法体，不用固定字符窗口（§3.39 的教训）。 */
function methodBody(code: string, signature: string): string {
    const at = code.indexOf(signature);
    assert.ok(at >= 0, `找不到方法：${signature}`);
    const open = code.indexOf('{', at);
    assert.ok(open > at, `${signature} 后面没有方法体`);
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') {
            depth -= 1;
            if (depth === 0) return code.slice(at, i + 1);
        }
    }
    throw new Error(`${signature} 方法体没有闭合`);
}

// ============================================================
// ① prefab 层级真值
// ============================================================

type PrefabJson = Record<string, any>[];

const prefabOf = (path: string): PrefabJson => JSON.parse(readFileSync(path, 'utf8'));

function rootIndexOf(data: PrefabJson, name: string): number {
    const index = data.findIndex((entry) => entry?.__type__ === 'cc.Node'
        && entry._name === name && entry._parent === null);
    assert.ok(index >= 0, `prefab 里找不到根节点 ${name}`);
    return index;
}

function childrenOf(data: PrefabJson, index: number): number[] {
    return (data[index]?._children ?? []).map((child: { __id__: number }) => child.__id__);
}

function namesOf(data: PrefabJson, indexes: number[]): string[] {
    return indexes.map((index) => data[index]?._name ?? '');
}

function childNamed(data: PrefabJson, index: number, name: string): number {
    const hit = childrenOf(data, index).find((child) => data[child]?._name === name);
    assert.ok(hit !== undefined, `节点 ${data[index]?._name} 下找不到 ${name}`);
    return hit;
}

test('★ MainRoot 只有 Bg / Content / BottomNav，且 BottomNav 排在 Content 之后', () => {
    const data = prefabOf(MAIN_ROOT);
    const names = namesOf(data, childrenOf(data, rootIndexOf(data, 'MainRoot')));
    assert.deepEqual(names, ['Bg', 'Content', 'BottomNav']);
    assert.ok(names.indexOf('BottomNav') > names.indexOf('Content'),
        '底栏画在 Content 之上 ⇒ 页面内任何节点都盖不过英雄按钮');
});

test('★ MainRoot 内没有弹窗层 ⇒ 顶层特效不会盖住 PopupManager 的模态弹窗', () => {
    const data = prefabOf(MAIN_ROOT);
    const names = namesOf(data, childrenOf(data, rootIndexOf(data, 'MainRoot')));
    assert.ok(!names.some((name) => /popup|dialog|modal/i.test(name)),
        '弹窗若被塞进 MainRoot，挂最后的特效层就会压住模态弹窗');
});

test('★ 聊天框在 ArenaRoot/BottomHud，且 BottomHud 排在 MapRoot 之后', () => {
    const data = prefabOf(ARENA_ROOT);
    const arena = rootIndexOf(data, 'ArenaRoot');
    const names = namesOf(data, childrenOf(data, arena));
    assert.ok(names.includes('TopHud') && names.includes('BottomHud') && names.includes('ChestBar'));
    assert.ok(names.indexOf('BottomHud') > names.indexOf('MapRoot'),
        '聊天框所在的 BottomHud 比领地页容器晚渲染 ⇒ 页面内 overlay 必然被压住');
    const bottomHud = childNamed(data, arena, 'BottomHud');
    assert.ok(childNamed(data, bottomHud, 'ChatBar') >= 0, '聊天条必须挂在 BottomHud 下');
});

test('★ 领地页 prefab 只有 MapViewport，GainLayer 是 MapLayer 的最后一个子节点', () => {
    const data = prefabOf(TERRITORY_PREFAB);
    const page = rootIndexOf(data, 'MainTerritoryMap');
    assert.deepEqual(namesOf(data, childrenOf(data, page)), ['MapViewport']);
    const mapLayer = childNamed(data, childNamed(data, page, 'MapViewport'), 'MapLayer');
    const names = namesOf(data, childrenOf(data, mapLayer));
    assert.equal(names.at(-1), 'GainLayer',
        '格心喷发 / 读数仍走页面内坐标系，本轮不许顺手迁层');
});

test('★ TerritoryRewardFx 是运行时节点，三份 prefab 里都不许预先摆一份', () => {
    for (const path of [MAIN_ROOT, ARENA_ROOT, TERRITORY_PREFAB]) {
        const data = prefabOf(path);
        assert.ok(!data.some((entry) => entry?._name === 'TerritoryRewardFx'),
            `${path} 里已经有同名节点，运行时会叠出第二层`);
    }
});

// ============================================================
// ② VM 行为：宿主注入 / 回退 / 换层清池 / 坐标换算
// ============================================================

const MapViewClass = loadTerritoryMapViewClass();

function fakeLayer(name: string): any {
    return {
        name,
        isValid: true,
        layer: 1,
        destroyed: 0,
        destroy() { this.destroyed += 1; },
        getComponent() {
            return { convertToNodeSpaceAR: (_world: unknown) => ({ x: 321, y: -654 }) };
        },
    };
}

function fakeFlight(): any {
    return {
        stopped: 0,
        stop() { this.stopped += 1; },
        node: { isValid: true, destroyed: 0, destroy() { this.destroyed += 1; } },
    };
}

/** 绕过构造（cc 节点桩不完整），只测新增的宿主 / 换算方法。 */
function makeView(): any {
    const view = Object.create(MapViewClass.prototype);
    view.rewardFxHost = null;
    view.heroRewardTarget = null;
    view.activeHeroFlights = [];
    view.heroFlightPool = [];
    view.hexNodes = new Map();
    view.overlayHostStub = fakeLayer('overlay');
    view.ensureOverlayHost = () => view.overlayHostStub;
    return view;
}

test('★ 注入顶层宿主后 rewardFxLayer 返回它，重复注入同一引用不清池', () => {
    const view = makeView();
    const top = fakeLayer('MainRootFx');
    const pooled = fakeFlight();
    view.heroFlightPool.push(pooled);
    view.setRewardFxHost(top);
    assert.equal(view.rewardFxLayer(), top);
    assert.equal(pooled.node.destroyed, 1, '换宿主那一拍要把旧层上的图标丢掉');
    const another = fakeFlight();
    view.heroFlightPool.push(another);
    view.setRewardFxHost(top);
    assert.equal(another.node.destroyed, 0, '同一引用必须幂等早退');
});

test('★ 没注入 / 宿主失效时回退页面内覆盖层，不静默消失', () => {
    const view = makeView();
    assert.equal(view.rewardFxLayer(), view.overlayHostStub);
    const top = fakeLayer('MainRootFx');
    view.setRewardFxHost(top);
    top.isValid = false;
    assert.equal(view.rewardFxLayer(), view.overlayHostStub, '节点被销毁后必须回落旧行为');
    view.setRewardFxHost(null);
    assert.equal(view.rewardFxLayer(), view.overlayHostStub);
});

test('★ 换宿主会收掉在飞的图标、销毁池节点并作废旧落点', () => {
    const view = makeView();
    const top = fakeLayer('MainRootFx');
    const active = fakeFlight();
    const pooled = fakeFlight();
    view.activeHeroFlights.push(active);
    view.heroFlightPool.push(pooled);
    view.heroRewardTarget = { x: 11, y: 22 };
    view.setRewardFxHost(top);
    assert.equal(active.stopped, 1, '在飞的那一束要先收起');
    assert.equal(active.node.destroyed, 1);
    assert.equal(pooled.node.destroyed, 1);
    assert.equal(view.heroFlightPool.length, 0);
    assert.equal(view.activeHeroFlights.length, 0);
    assert.equal(view.heroRewardTarget, null, '旧宿主的局部坐标不能带到新层');
});

test('★ 飞行终点按顶层宿主的矩阵换算（不是页面内覆盖层）', () => {
    const view = makeView();
    const top = fakeLayer('MainRootFx');
    let asked = 0;
    top.getComponent = () => ({
        convertToNodeSpaceAR: () => { asked += 1; return { x: 77, y: -88 }; },
    });
    view.overlayHostStub.getComponent = () => ({
        convertToNodeSpaceAR: () => { assert.fail('不许再问页面内覆盖层'); },
    });
    view.setRewardFxHost(top);
    view.setHeroRewardTargetWorld({ x: 1, y: 2, z: 0 } as any);
    assert.equal(asked, 1);
    // VM 沙箱里的对象与本文件不同 realm，`deepStrictEqual` 会因原型不同而假红 ⇒ 逐字段比。
    assert.equal(view.heroRewardTarget.x, 77);
    assert.equal(view.heroRewardTarget.y, -88);
    view.setHeroRewardTargetWorld(null);
    assert.equal(view.heroRewardTarget, null);
});

test('★ 飞行起播把「同一个顶层宿主」同时交给起点换算与粒子父层', () => {
    const view = makeView();
    const top = fakeLayer('MainRootFx');
    view.setRewardFxHost(top);
    view.heroRewardTarget = { x: 5, y: 6 };
    const seen: any[] = [];
    view.cellPointInNode = (cellId: number, host: any) => {
        seen.push({ kind: 'origin', cellId, host });
        return { x: 10, y: 20, z: 0 };
    };
    view.acquireHeroFlight = (layer: any) => ({
        play(origin: any, target: any, entries: any) {
            seen.push({ kind: 'play', layer, origin, target, entries });
            return true;
        },
    });
    const entries = [{ frame: null, resId: 16001 }];
    assert.equal(view.playHeroRewardFlight(42, entries), true);
    assert.equal(seen[0].host, top);
    assert.equal(seen[0].cellId, 42);
    assert.equal(seen[1].layer, top);
    // `playHeroRewardFlight` 把 Vec3 起点压成 `{x,y}` 平面点再交给飞行时间轴；
    // 这个平面点是在 VM realm 里新建的 ⇒ 逐字段比，别用 deepStrictEqual。
    assert.equal(seen[1].origin.x, 10);
    assert.equal(seen[1].origin.y, 20);
    assert.equal(seen[1].target.x, 5);
    assert.equal(seen[1].target.y, 6);
});

test('★ cellPointInNode 用指定宿主的 convertToNodeSpaceAR（格心 → 任意宿主）', () => {
    const view = makeView();
    let worldSeen: unknown = null;
    view.hexNodes.set(7, {
        isValid: true,
        getComponent: () => ({ convertToWorldSpaceAR: () => ({ x: 100, y: 200, z: 0 }) }),
    });
    const host = {
        getComponent: () => ({
            convertToNodeSpaceAR: (world: unknown) => { worldSeen = world; return { x: -9, y: -8, z: 0 }; },
        }),
    };
    const point = view.cellPointInNode(7, host as any);
    assert.deepEqual({ x: point.x, y: point.y }, { x: -9, y: -8 });
    assert.ok(worldSeen !== null, '必须走引擎矩阵，不许自己算偏移');
});

test('★ 视图把特效层建在 MainRoot 最后一位，幂等且可收', () => {
    const view = makeView();
    const root: any = {
        isValid: true, layer: 7, children: [{}, {}, {}], getComponent: () => undefined,
    };
    const host = view.mountRewardFxLayer(root);
    assert.ok(host);
    assert.equal(host.name, 'TerritoryRewardFx');
    assert.equal(host.parent, root);
    assert.equal(host.layer, 7, 'layer 不跟宿主会整层不渲染');
    assert.equal(host.siblingIndex, root.children.length - 1,
        '子节点顺序 = 渲染顺序，排最后才盖得过 BottomNav');
    assert.equal(view.rewardFxLayer(), host);
    assert.equal(view.mountRewardFxLayer(root), host, '重复挂载不许叠第二层');
    assert.equal(root.children.filter((child: any) => child?.name === 'TerritoryRewardFx').length, 1);
    view.disposeRewardFxLayer();
    assert.equal(host.destroyed, 1, '页面销毁时顶层节点要被收掉');
    assert.equal(view.rewardFxLayer(), view.overlayHostStub, '收掉后回落覆盖层');
});

test('★ 页面找不到 MainRoot 时视图不建层，动画回落旧行为而不是消失', () => {
    const view = makeView();
    assert.equal(view.mountRewardFxLayer(null), null);
    assert.equal(view.rewardFxLayer(), view.overlayHostStub);
});

// ============================================================
// ③ 源码守卫：接线顺序与「不许顺手迁层」的边界
// ============================================================

test('★ 页面只交出 MainRoot 引用，绝不自己搭 UI（架构守卫）', () => {
    const code = body(PAGE);
    const fn = methodBody(code, 'private rewardFxRoot()');
    assert.match(fn, /const navBar = this\.findHeroTabHost\(\)\?\.navBar \?\? null;/);
    assert.match(fn, /return navBar\?\.parent \?\? this\.hostPageRoot\(\);/,
        '拿不到 MainTabHost 时至少要退回 ArenaRoot 盖住聊天框');
    assert.equal(code.includes('new Node('), false,
        'territory-page-split / territory-battle-intro 两条守卫都禁页面 new Node');
    assert.equal(code.includes('addComponent('), false,
        '建节点的活必须留在视图层');
});

test('★ 视图负责建层：排最后 / layer 跟随 / 幂等 / 销毁回收', () => {
    const code = body(VIEW);
    const mount = methodBody(code, 'mountRewardFxLayer(');
    assert.match(mount, /if \(this\.rewardFxHost\?\.isValid\) return this\.rewardFxHost;/, '挂载幂等');
    assert.match(mount, /new Node\(TERRITORY_REWARD_FX_NODE\)/);
    assert.match(mount, /host\.layer = root\.layer;/);
    assert.match(mount, /host\.addComponent\(UITransform\)/);
    assert.match(mount, /host\.setParent\(root\);/);
    assert.match(mount, /host\.setSiblingIndex\(root\.children\.length - 1\);/,
        '子节点顺序 = 渲染顺序，排最后才盖得过 BottomNav');
    assert.match(methodBody(code, 'disposeRewardFxLayer()'),
        /if \(owned\?\.isValid\) owned\.destroy\(\);/);
});

test('★ 注入发生在登记终点之前：否则这次飞行还在旧坐标系里', () => {
    const code = body(PAGE);
    const fn = methodBody(code, 'private async playCellGains(');
    const inject = fn.indexOf('this.mapView.mountRewardFxLayer(');
    const target = fn.indexOf('this.mapView.setHeroRewardTargetWorld(');
    const flight = fn.indexOf('this.mapView.playHeroRewardFlight(');
    assert.ok(inject >= 0 && target > inject && flight > target,
        '顺序必须是「注入宿主 → 登记终点 → 起播飞行」');
    assert.match(fn, /this\.mapView\.mountRewardFxLayer\(this\.rewardFxRoot\(\)\);/);
});

test('★ 页面销毁时通知视图收掉顶层宿主（它不随本页子节点销毁）', () => {
    const fn = methodBody(body(PAGE), 'onDestroy()');
    assert.match(fn, /this\.mapView\?\.disposeRewardFxLayer\(\);/);
    assert.doesNotMatch(fn, /rewardFxHost/,
        '页面不持有 / 不销毁节点，所有权全在视图');
});

test('★ 视图：飞行链路四处都走 rewardFxLayer / 指定宿主', () => {
    const code = body(VIEW);
    assert.match(methodBody(code, 'private rewardFxLayer()'),
        /return this\.rewardFxHost\?\.isValid \? this\.rewardFxHost : this\.ensureOverlayHost\(\);/);
    assert.match(methodBody(code, 'setHeroRewardTargetWorld('),
        /const host = this\.rewardFxLayer\(\);/);
    const play = methodBody(code, 'playHeroRewardFlight(');
    assert.match(play, /const host = this\.rewardFxLayer\(\);/);
    assert.match(play, /const origin = this\.cellPointInNode\(cellId, host\);/);
    assert.match(play, /this\.acquireHeroFlight\(host\)\.play\(/);
    const acquire = methodBody(code, 'private acquireHeroFlight(');
    assert.match(acquire, /private acquireHeroFlight\(layer: Node\)/);
    assert.match(acquire, /new TerritoryHeroFlight\(layer\)/);
    assert.doesNotMatch(acquire, /ensureOverlayHost/, '粒子父层不许再落回页面内覆盖层');
});

test('★ 其它表演一个都没迁层：开箱 / 点击反馈 / 格心喷发保持原层', () => {
    const code = body(VIEW);
    assert.match(methodBody(code, 'private cellPointInOverlay('),
        /return this\.cellPointInNode\(cellId, this\.ensureOverlayHost\(\)\);/,
        '覆盖层仍由 ensureOverlayHost 提供，只是换算被抽成共用函数');
    assert.match(methodBody(code, 'private ensureBurstRoot()'),
        /root\.setParent\(this\.gainLayer\);/,
        '格心喷发仍挂 GainLayer：粒子必须继续画在读数之下');
    assert.match(methodBody(code, 'setRewardCatchWorldPoint('),
        /this\.ensureOverlayHost\(\)/, '固定格飞向资源栏的落点不在这次改动范围内');
});
