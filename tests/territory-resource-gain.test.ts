import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    isTerritoryWalletResId,
    splitTerritoryRewards,
    territoryGainFx,
    TERRITORY_GAIN_ENTRANCE_RATIO,
    TERRITORY_GAIN_FROM_SCALE,
    TERRITORY_GAIN_POP_SCALE,
    TERRITORY_GAIN_RISE_PX,
    TERRITORY_GAIN_SECONDS,
    TERRITORY_WALLET_RES_IDS,
} from '../assets/script/app/territory/model/TerritoryResourceGain';

const read = (path: string): string => readFileSync(path, 'utf8');

// ── 奖励分流：7 / 9 走飘字，其余走弹窗 ────────────────────────────────────

test('银币(7) 与体力(9) 判为钱包资源，其余不是', () => {
    assert.deepEqual([...TERRITORY_WALLET_RES_IDS], [7, 9]);
    assert.equal(isTerritoryWalletResId(7), true);
    assert.equal(isTerritoryWalletResId(9), true);
    assert.equal(isTerritoryWalletResId(10), false, '金币(10) 是道具口径，仍要弹窗');
    assert.equal(isTerritoryWalletResId(18003), false);
    assert.equal(isTerritoryWalletResId(0), false);
    assert.equal(isTerritoryWalletResId(undefined), false);
});

test('分流：一批奖励里钱包类进飘字、其余进弹窗，且各自保持原顺序', () => {
    const split = splitTerritoryRewards([
        { resId: 18003, amount: 2 },
        { resId: 7, amount: 120 },
        { resId: 9, amount: 3 },
        { resId: 1001, amount: 1 },
    ]);
    assert.deepEqual(split.gains.map((g) => g.resId), [7, 9]);
    assert.deepEqual(split.popup.map((g) => g.resId), [18003, 1001]);
    assert.deepEqual(split.gains, [{ resId: 7, amount: 120 }, { resId: 9, amount: 3 }]);
});

test('分流边界：全是钱包资源 ⇒ 弹窗为空（整批跳过奖励弹窗）', () => {
    const split = splitTerritoryRewards([{ resId: 7, amount: 50 }, { resId: 9, amount: 1 }]);
    assert.equal(split.popup.length, 0);
    assert.equal(split.gains.length, 2);
    assert.deepEqual(splitTerritoryRewards([]).gains, []);
    assert.deepEqual(splitTerritoryRewards([]).popup, []);
});

// ── 升起曲线 ────────────────────────────────────────────────────────────

test('升起：从 0 单调升到满程，末段收尾返回 null（可回收）', () => {
    const start = territoryGainFx(0);
    assert.ok(start, '第 0 帧必须有值');
    assert.equal(start?.offsetY, 0);
    assert.ok(Math.abs((start?.scale ?? 0) - TERRITORY_GAIN_FROM_SCALE) < 1e-9);
    assert.equal(start?.opacity, 1);

    let previous = -1;
    for (let t = 0; t < TERRITORY_GAIN_SECONDS; t += TERRITORY_GAIN_SECONDS / 24) {
        const fx = territoryGainFx(t);
        assert.ok(fx, `t=${t} 不该提前结束`);
        assert.ok(fx.offsetY >= previous - 1e-9, '位移必须单调不回退');
        previous = fx.offsetY;
    }
    const last = territoryGainFx(TERRITORY_GAIN_SECONDS - 1e-6);
    assert.ok((last?.offsetY ?? 0) > TERRITORY_GAIN_RISE_PX * 0.9);
    assert.equal(territoryGainFx(TERRITORY_GAIN_SECONDS), null, '整条时长到点即结束');
    assert.equal(territoryGainFx(TERRITORY_GAIN_SECONDS + 0.5), null);
    assert.equal(territoryGainFx(-1), null);
    assert.equal(territoryGainFx(Number.NaN), null);
});

test('升起：入场段弹出到峰值缩放，淡出段回落并淡到全透明', () => {
    const entranceEnd = territoryGainFx(TERRITORY_GAIN_SECONDS * TERRITORY_GAIN_ENTRANCE_RATIO - 1e-6);
    assert.ok(Math.abs((entranceEnd?.scale ?? 0) - TERRITORY_GAIN_POP_SCALE) < 1e-3,
        '入场段末尾应到峰值');
    assert.equal(entranceEnd?.opacity, 1, '入场段不淡出');

    const fadeHalf = territoryGainFx(
        TERRITORY_GAIN_SECONDS * (TERRITORY_GAIN_ENTRANCE_RATIO + (1 - TERRITORY_GAIN_ENTRANCE_RATIO) / 2));
    assert.ok((fadeHalf?.opacity ?? 1) < 1 && (fadeHalf?.opacity ?? 0) > 0, '淡出段中间是半透明');
    assert.ok((fadeHalf?.scale ?? 0) < TERRITORY_GAIN_POP_SCALE, '淡出段缩放回落');

    const end = territoryGainFx(TERRITORY_GAIN_SECONDS - 1e-6);
    assert.ok((end?.opacity ?? 1) < 0.01, '末尾几乎全透明');
    assert.ok(Math.abs((end?.scale ?? 0) - 1) < 1e-2, '末尾回到原尺寸');
});

// ── prefab 结构（离线读盘，不需要引擎） ──────────────────────────────────

const GAIN_PREFAB = 'assets/resources/ui/territory/TerritoryResourceGain.prefab';
const PAGE_PREFAB = 'assets/resources/ui/territory/TerritoryPage.prefab';

interface IPrefabObject { __type__?: string; _name?: string; [key: string]: unknown }
const load = (path: string): IPrefabObject[] => JSON.parse(read(path)) as IPrefabObject[];

test('飘字 prefab：根节点挂视图脚本 + UIOpacity，三个节点全是 UI_2D', () => {
    const data = load(GAIN_PREFAB);
    const nodes = data.filter((o) => o.__type__ === 'cc.Node');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0]._name, 'TerritoryResourceGain');
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} 必须 UI_2D`);
    }
    const root = nodes[0];
    const rootComps = (root._components as { __id__: number }[]).map((c) => data[c.__id__].__type__);
    assert.ok(rootComps.includes('cc.UITransform'), '缺 UITransform');
    assert.ok(rootComps.includes('cc.UIOpacity'), '缺 UIOpacity（整条一起淡出靠它）');
    assert.ok(rootComps.some((t) => typeof t === 'string' && !t.startsWith('cc.')),
        '根节点必须挂视图脚本');
});

test('飘字 prefab：脚本三个引用分别指向 Icon 的 Sprite / Amount 的 Label / 根的 UIOpacity', () => {
    const data = load(GAIN_PREFAB);
    const script = data.find((o) => typeof o.__type__ === 'string'
        && !o.__type__.startsWith('cc.') && 'iconSprite' in o);
    assert.ok(script, '找不到视图脚本组件');
    const typeOf = (ref: unknown): string | undefined => {
        const id = (ref as { __id__?: number }).__id__;
        return typeof id === 'number' ? data[id].__type__ : undefined;
    };
    assert.equal(typeOf(script.iconSprite), 'cc.Sprite');
    assert.equal(typeOf(script.amountLabel), 'cc.Label');
    assert.equal(typeOf(script.opacity), 'cc.UIOpacity');
});

test('飘字 prefab：图标 Sprite 是 CUSTOM + 不裁剪（图标尺寸由 prefab 定），数字是金色且带 + 号', () => {
    const data = load(GAIN_PREFAB);
    const sprite = data.find((o) => o.__type__ === 'cc.Sprite');
    assert.equal(sprite?._sizeMode, 0, 'CUSTOM：贴图不该改写节点尺寸');
    assert.equal(sprite?._isTrimmedMode, false);
    assert.equal(sprite?._spriteFrame, null, '帧由代码注入，prefab 里不许写死');

    const label = data.find((o) => o.__type__ === 'cc.Label');
    assert.match(String(label?._string), /^\+/);
    assert.equal(label?._color?.r, 245);
    assert.equal(label?._color?.g, 201);
    assert.equal(label?._color?.b, 92);
});

test('飘字 prefab：icon + 数字整体居中（按中心摆，不能共用左边界 x）', () => {
    // 🔴 规则 4.3：一组宽度不同的子件（图标 40 / 数字按字数变宽）必须按**中心**摆。
    // 两个子节点共用同一个 `x` 会把整条飘字推到格子左边（图标偏 47px），
    // 而结构 / 尺寸 / 贴图全对，单看 prefab 看不出来 —— 只能靠这条算出来的中心值卡住。
    const data = load(GAIN_PREFAB);
    const nodeByName = (name: string): IPrefabObject =>
        data.find((o) => o.__type__ === 'cc.Node' && o._name === name)!;
    const transformOf = (node: IPrefabObject): IPrefabObject => {
        const ids = (node._components as { __id__: number }[]).map((c) => c.__id__);
        return data[ids.find((id) => data[id].__type__ === 'cc.UITransform')!];
    };
    const spanOf = (name: string): [number, number] => {
        const node = nodeByName(name);
        const transform = transformOf(node);
        const size = transform._contentSize as { width: number; height: number };
        const anchor = transform._anchorPoint as { x: number; y: number };
        const x = (node._lpos as { x: number }).x;
        return [x - size.width * anchor.x, x + size.width * (1 - anchor.x)];
    };
    const [iconLeft, iconRight] = spanOf('Icon');
    const [textLeft, textRight] = spanOf('Amount');
    assert.ok(iconRight <= textLeft, `图标右缘 ${iconRight} 不能压到数字左缘 ${textLeft}`);
    const center = (Math.min(iconLeft, textLeft) + Math.max(iconRight, textRight)) / 2;
    assert.ok(Math.abs(center) <= 1,
        `飘字内容没居中：整体中心 ${center.toFixed(2)}（root anchor 0.5 ⇒ 应 ≈ 0）`);
});

test('领地页 prefab：MapView 绑到 GainLayer，且 GainLayer 是 MapLayer 最后一个子节点', () => {
    const data = load(PAGE_PREFAB);
    const mapLayer = data.find((o) => o.__type__ === 'cc.Node' && o._name === 'MapLayer');
    assert.ok(mapLayer);
    const childNames = (mapLayer._children as { __id__: number }[]).map((c) => data[c.__id__]._name);
    assert.equal(childNames[childNames.length - 1], 'GainLayer',
        '飘字层必须排在最后（子节点顺序 = 渲染顺序，否则被站点盖住）');

    const view = data.find((o) => typeof o.__type__ === 'string'
        && !o.__type__.startsWith('cc.') && 'gainLayer' in o);
    assert.ok(view, 'TerritoryMapView 上没有 gainLayer 字段');
    const gainLayerId = (view.gainLayer as { __id__: number }).__id__;
    assert.equal(data[gainLayerId]._name, 'GainLayer');
    assert.equal(data[gainLayerId]._layer, 33554432);
    const prefabUuid = (view.gainPrefab as { __uuid__?: string }).__uuid__;
    assert.match(String(prefabUuid), /^[0-9a-f-]{36}$/, 'gainPrefab 必须是 prefab 资源 uuid');
});

// ── 页面接线：7 / 9 必须「跳过奖励弹窗」 ─────────────────────────────────

test('页面只对「非钱包类」奖励弹窗：全是 7/9 时整批跳过 ShowReward', () => {
    // 反例断言先剥注释（规则 104）—— 类注释里提到旧写法是合法的。
    const src = read('assets/script/app/territory/view/TerritoryPage.ts')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.match(src, /const \{ gains, popup \} = splitTerritoryRewards\(rewards\)/);
    assert.match(src, /playResourceGain\(/, '钱包类要走格子上方飘字');
    assert.match(src, /if \(!popup\.length\) return;/, '全是 7/9 ⇒ 一条都不该弹窗');
    assert.match(src, /FW\.ShowReward\(popup\.map/);
    assert.doesNotMatch(src, /FW\.ShowReward\(rewards/, '不能把未分流的整批奖励喂给弹窗');
});
