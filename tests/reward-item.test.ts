import { createControllerContext } from './helpers/controller-context';
import { componentControllerModule } from './helpers/controller-context';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import protobuf from 'protobufjs/light.js';
import { ProtoCoder } from '../assets/script/framework/net/ProtoCoder';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { AssetService, AssetLoadOptions } from '../assets/script/core/asset/AssetService';
import { assetPath } from './helpers/asset-paths';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { REWARD_ITEM_DETAIL_INTENT } from '../assets/script/app/common/RewardItemEvents';
import * as itemDetailTable from '../assets/script/app/itemdetail/ItemDetailTable';
import * as resTypes from '../assets/script/app/common/ResTypes';
import * as gemReward from '../assets/script/app/common/GemReward';

/**
 * **公共奖励格** `ui/common/RewardItem.prefab` 的判据。
 *
 * 它被领地页三个弹窗（关卡界面 / 玩家关卡 / 宝箱详情）共用 —— 格子只建一份，
 * 宿主拿它当 `VirtualScrollView.itemPrefab` 或直接摆。所以这里的每一条都是「要么全对、要么全错」。
 */
const PREFAB = assetPath('ui/common/RewardItem.prefab');
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
        '../../framework/event/EventMgr': { EventMgr },
        './RewardItemEvents': { REWARD_ITEM_DETAIL_INTENT },
        '../../core/asset/ResourceScope': { ResourceScope },
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async () => [] } } },
        '../ArtPaths': { spriteFramePathOf: (path: string) => path },
        '../itemdetail/ItemDetailArtLoader': { itemQualityFrameRelPath: () => 'image/common/cu_quality_01' },
        '../itemdetail/ItemDetailTable': itemDetailTable,
        './GemReward': gemReward,
        '../common/ResTypes': {
            ITEM_TABLE: 'item', ROLE_PROPERTY_TABLE: 'roleProperty', CARD_LEVEL_UP_TABLE: 'cardLevelUp',
            resBarCellOfRefId: () => null, resBarIconSpritePath: () => '',
        },
        ...overrides,
    };
    runInNewContext(code, { exports, require: (request: string) => {

        if (stubs[request]) return stubs[request];
        if (request.endsWith('/ComponentController')) return componentControllerModule();
        return {
            Component, Sprite, Label,
            Button: { EventType: { CLICK: 'click' } },
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        };
    } });
    return Object.values(exports)[0] as ReturnType<typeof loadClass>;
}

function createRewardLifecycleFixture(gate?: Promise<void>, overrides: Record<string, unknown> = {}) {
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
    const context = { ...createControllerContext(), assets };
    const ViewClass = loadClass({ ...overrides, '../../framework/controller/ComponentController': componentControllerModule(context) });
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

test('公共奖励格点击派发当前物品意图，复用后不打开旧物品，非法 ID 不派发', () => {
    const View = loadClass();
    const view = new View();
    const listeners = new Map<string, () => void>();
    view.node = { active: true, on: (event: string, handler: () => void, owner: object) => listeners.set(event, handler.bind(owner)) };
    view.num = { string: '' };
    view.rate = { string: '', node: { active: false } };
    view.frame = {}; view.icon = {};
    view.applyFrames = async () => {};
    const owner = {};
    const seen: number[] = [];
    EventMgr.instance.on(REWARD_ITEM_DETAIL_INTENT, intent => seen.push(intent.resId), owner);
    try {
        view.onLoad();
        const click = listeners.get('click');
        assert.ok(click);
        click();
        view.render({ resId: 16014, amount: 8 }); click();
        view.render({ resId: 18003, amount: 10 }); click();
        view.render({ resId: -1, amount: 10 }); click();
        assert.deepEqual(seen, [16014, 18003]);
        const button = (root._components ?? []).map(at).find(comp => comp?.__type__ === 'cc.Button');
        assert.ok(button, '公共 prefab 必须挂 Button');
        assert.equal(button._transition, 0);
        assert.equal(button._target, null);
    } finally { EventMgr.instance.offTarget(owner); view.onDestroy(); }
});

test('奖励详情由组合根响应，层级覆盖结算、预览不伪造背包数量，销毁后退订', async () => {
    const exports: Record<string, any> = {};
    const opened: Array<Record<string, any>> = [];
    const code = ts.transpileModule(readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === 'cc') return { Component: class {}, _decorator: { ccclass: () => value => value } };
        if (name.endsWith('/CardRepository')) return { cardRepository: { bindHeroSession() {} } };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/RewardItemEvents')) return { REWARD_ITEM_DETAIL_INTENT };
        if (name.endsWith('/PopupDef')) return { PopupLayer: { SYSTEM: 1 } };
        if (name.endsWith('/ItemInfoPage')) return { ItemInfoPage: { open: async options => { opened.push(options); } } };
        if (name.endsWith('/GameNet')) return { GameNet: { instance: { addEvent() {}, removeEvent() {} } } };
        if (name.endsWith('/FW')) return { FW: {} };
        return {};
    } });
    const bootstrap = new exports.ProcedureBootstrap();
    bootstrap.configurePresentation();
    try {
        EventMgr.instance.emit(REWARD_ITEM_DETAIL_INTENT, { resId: 16014 });
        EventMgr.instance.emit(REWARD_ITEM_DETAIL_INTENT, { resId: -1 });
        assert.equal(opened.length, 1);
        assert.equal(opened[0].userData.resId, 16014);
        assert.equal(opened[0].userData.number, 0);
        assert.equal(opened[0].layer, 1);
        assert.equal(opened[0].allowMultiple, true);
    } finally { bootstrap.onDestroy(); }
    EventMgr.instance.emit(REWARD_ITEM_DETAIL_INTENT, { resId: 18003 });
    assert.equal(opened.length, 1);
});

test('通用奖励广播可由真实 ProtoCoder 按消息 ID 解码并识别为广播', async () => {
    const coder = new ProtoCoder();
    await coder.init();
    try {
        const schema = JSON.parse(readFileSync(assetPath('config/protoCompiled.json'), 'utf8'));
        const type = protobuf.Root.fromJSON(schema).lookupType('com.xkhy.tafang.cmd.CmdItemRewardBroMsg');
        const bytes = type.encode({ resType: 1, tlCmdGoods: [{ resId: 16014, number: '8589934593' }] }).finish();
        assert.equal(coder.isBro(283150558), true);
        assert.equal(coder.getRspNameById(283150558), 'CmdItemRewardBroMsg');
        const decoded = coder.decodeDataById(283150558, bytes);
        assert.equal(decoded.resType, 1);
        assert.equal(String(decoded.tlCmdGoods[0].resId), '16014');
        assert.equal(String(decoded.tlCmdGoods[0].number), '8589934593');
        assert.equal(coder.decodeDataById(283150558, type.encode({ resType: 2 }).finish()).tlCmdGoods.length, 0);
    } finally {
        coder.destroy();
    }
});

test('通用奖励广播转交原始奖励明细，缺省列表为空，宿主销毁后退订', () => {
    const exports: Record<string, any> = {};
    const rewards: unknown[] = [];
    const listeners = new Map<string, { owner: object; listener: (msg: unknown) => void }>();
    const net = {
        addEvent(name: string, owner: object, listener: (msg: unknown) => void) {
            listeners.set(name, { owner, listener });
        },
        removeEvent(name: string, owner: object, listener: (msg: unknown) => void) {
            const current = listeners.get(name);
            assert.equal(current?.owner, owner);
            assert.equal(current?.listener, listener);
            listeners.delete(name);
        },
    };
    const code = ts.transpileModule(readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === 'cc') return { Component: class {}, _decorator: { ccclass: () => value => value } };
        if (name.endsWith('/CardRepository')) return { cardRepository: { bindHeroSession() {} } };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/RewardItemEvents')) return { REWARD_ITEM_DETAIL_INTENT };
        if (name.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (name.endsWith('/FW')) return { FW: { ShowReward: goods => rewards.push(goods) } };
        return {};
    } });
    const bootstrap = new exports.ProcedureBootstrap();
    bootstrap.configurePresentation();
    try {
        const subscription = listeners.get('CmdItemRewardBroMsg');
        assert.ok(subscription);
        assert.equal(subscription.owner, bootstrap);
        const goods = [{ resId: 16014, number: { low: 8, high: 0, unsigned: true } }];
        subscription.listener({ resType: 1, tlCmdGoods: goods });
        assert.equal(rewards[0], goods, 'uint64 与奖励列表保持原样，交给现有奖励解析链路');
        subscription.listener({ resType: 2, tlCmdGoods: [] });
        subscription.listener({ resType: 3 });
        assert.equal(rewards.length, 3);
        assert.equal(Array.isArray(rewards[1]), true);
        assert.equal((rewards[1] as unknown[]).length, 0);
        assert.equal(Array.isArray(rewards[2]), true);
        assert.equal((rewards[2] as unknown[]).length, 0);
    } finally {
        bootstrap.onDestroy();
    }
    assert.equal(listeners.size, 0);
    bootstrap.configurePresentation();
    assert.equal(listeners.size, 2, '重新装配不会遗留上一宿主的监听');
    bootstrap.onDestroy();
    assert.equal(listeners.size, 0);
});

test('奖励资源详情支持 roleProperty 名称、说明和图标，item 配置优先，未知 ID 保持空态', async () => {
    const exports: Record<string, any> = {};
    const tables = {
        item: [{ resId: 18003, name: '卡牌碎片', desc: '碎片说明', icon: 'icons/item/card', quality: 2 }],
        roleProperty: [
            { resId: 7, name: '银币', describe: '通用货币', icon: '图标_铜币', quality: 3, access: [22], useJump: 8 },
            { resId: 18003, name: '不应覆盖物品' },
        ],
        viewtype: [], itemCraft: [],
    };
    const code = ts.transpileModule(readFileSync('assets/script/app/itemdetail/ItemDetailRepository.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name.endsWith('/RefUtil')) return { RefUtil: { instance: {
            getRefAllAsync: async table => tables[table] ?? [], getRefAsync: async () => null,
        } } };
        if (name.endsWith('/TableRead')) return {
            readRefRowsSafe: async (ref, table) => ref.getRefAllAsync(table) ?? [],
        };
        if (name.endsWith('/TableNames')) return { ITEM_TABLE: 'item', ROLE_PROPERTY_TABLE: 'roleProperty' };
        if (name.endsWith('/ResTypes')) return resTypes;
        if (name === './ItemDetailTable') return itemDetailTable;
        return {};
    } });
    const repository = exports.itemDetailRepository;
    const silver = await repository.load(7, 0);
    assert.equal(silver.row.name, '银币');
    assert.equal(silver.row.desc, '通用货币');
    assert.equal(silver.row.quality, 3);
    assert.equal(silver.row.icon, 'icons/resource/图标_铜币/spriteFrame');
    assert.equal(silver.row.useJump, 0, '资源详情不开放物品使用操作');
    assert.equal(silver.numberText, '');
    assert.deepEqual(silver.accessRefs, []);
    assert.equal((await repository.load(18003, 0)).row.name, '卡牌碎片');
    assert.equal((await repository.load(1042537, 0)).row, null);
});

test('任务详情按当前奖励渲染公共框，复用清理多余格，旧请求和关窗后的结果不能覆盖', async () => {
    const exports: Record<string, any> = {};
    const renders: Array<{ resId: number; amount: number } | null> = Array(8).fill(null);
    const slots = renders.map((_, index) => ({
        node: { active: true, setPosition() {} },
        render(data) { renders[index] = data; },
    }));
    const pending: Array<(snapshot: unknown) => void> = [];
    const code = ts.transpileModule(readFileSync('assets/script/app/maintask/MainTaskDetailPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === 'cc') return { Button: { EventType: { CLICK: 'click' } },
            _decorator: { ccclass: () => value => value, property: () => () => {} } };
        if (name.endsWith('/PopupBase')) return { PopupBase: class {} };
        if (name.endsWith('/GuideEvents')) return { reportGuideComplete() {} };
        return {};
    } });
    const page = new exports.MainTaskDetailPage();
    page.node = { isValid: true }; page.isPopupOpen = true;
    page.taskTitle = { string: '' }; page.closeButton = { on() {} }; page.btnGo = { on() {} };
    page.rewardList = { children: slots.map(slot => ({ getComponent: () => slot })) };
    page.setRepository({ loadFirst: () => new Promise(resolve => pending.push(resolve)) });
    page.onInit();
    const first = page.refresh();
    const latest = page.refresh();
    pending[1]({ configured: true, detailTitle: '新任务', rewards: [{ resId: 7, number: 10 }, { resId: 18003, number: 2 }] });
    await latest;
    assert.equal(renders[0].resId, 7); assert.equal(renders[0].amount, 10);
    assert.equal(renders[1].resId, 18003);
    assert.equal(slots[2].node.active, false);
    pending[0]({ configured: true, detailTitle: '旧任务', rewards: [] }); await first;
    assert.equal(page.taskTitle.string, '新任务');
    const reused = page.refresh();
    pending[2]({ configured: true, detailTitle: '另一任务', rewards: [{ resId: 10, number: 3 }] }); await reused;
    assert.equal(renders[0].resId, 10); assert.equal(slots[1].node.active, false);
    const closed = page.refresh(); page.isPopupOpen = false; page.onClose();
    pending[3]({ configured: true, detailTitle: '迟到任务', rewards: [] }); await closed;
    assert.equal(page.taskTitle.string, '另一任务');
});

test('公共奖励格：品质框路径必须走统一前缀入口（`ItemDetailArtLoader`）', () => {
    const src = readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8');
    // 2026-10-28 真机踩过：漏了前缀 ⇒ 图标正常、品质框整片空白（不报错）
    assert.match(src, /itemQualityFrameRelPath\(/, '品质框路径必须走 ItemDetailArtLoader 的统一入口');
});

/**
 * 卡牌道具（碎片 / 民兵 / 金矿）的 `item.quality` 是**卡牌品阶**（1..4），
 * 而 `cu_quality_0N` 是**道具品质 8 档**（1 灰 / 2 绿 / 3 蓝 / 4 紫 / 5 金）。
 * 2026-11-23 用户口径：「卡牌碎片的底框颜色没有对应上卡牌的品阶，绿蓝紫金」+「民兵/金矿也跟普通卡一样显绿框」。
 */
test('卡牌道具底框按卡牌品阶取（绿/蓝/紫/金），普通材料仍按道具品质', async () => {
    const requested: number[] = [];
    const rows: Record<string, unknown[]> = {
        roleProperty: [],
        item: [
            { resId: 18001, name: '民兵', quality: 1 },
            { resId: 18002, name: '金矿', quality: 1 },
            { resId: 18003, name: '豌豆游侠碎片', quality: 1 },
            { resId: 18009, name: '吞噬大嘴花碎片', quality: 4 },
            { resId: 18022, name: '三叶小丑碎片', quality: 2 },
            //  升星材料，quality 5 是道具品质档（金），不在卡牌口径里。
            { resId: 18000, name: '英雄·通用', quality: 5 },
            //  脏数据/特殊卡：品阶填到 5、7 也只能是金，不许串到 06 红 / 07 蓝紫。
            { resId: 18004, name: '巨力坚果碎片', quality: 5 },
            { resId: 18005, name: '火焰树妖碎片', quality: 7 },
            { resId: 16014, name: '强化石', quality: 1 },
        ],
        //  只有「可升级卡牌的碎片」在表里；民兵/金矿没有升级曲线，靠 `BASE_CARD_ITEM_IDS` 认。
        cardLevelUp: [
            { id: 68001, costCardID: 18003 },
            { id: 68002, costCardID: 18004 },
            { id: 68003, costCardID: 18005 },
            { id: 68007, costCardID: 18009 },
            { id: 68020, costCardID: 18022 },
        ],
    };
    const ViewClass = loadClass({
        '../../framework/ref/RefUtil': {
            RefUtil: { instance: { getRefAllAsync: async (table: string) => rows[table] ?? [] } },
        },
        '../itemdetail/ItemDetailArtLoader': {
            itemQualityFrameRelPath: (quality: number) => {
                requested.push(quality);
                return `image/common/cu_quality_0${quality}`;
            },
        },
    });
    const cases: ReadonlyArray<readonly [number, number]> = [
        [18003, 2], // 普通卡碎片：品阶 1 → 02 绿
        [18022, 3], // 稀有卡碎片：品阶 2 → 03 蓝
        [18009, 5], // 传说卡碎片：品阶 4 → 05 金（不是 04 紫）
        [18004, 5], // 品阶 5（脏数据）：封顶在 05 金，不许变 06 红
        [18005, 5], // 品阶 7：同样封顶在 05 金
        [18001, 2], // 民兵：基础卡，同样显绿框
        [18002, 2], // 金矿：基础卡，同样显绿框
        [18000, 5], // 英雄·通用：升星材料，quality 5 原样（不抬成 06 红）
        [16014, 1], // 普通材料保持 01
    ];
    for (const [resId, expected] of cases) {
        const view = new ViewClass();
        Object.assign(view, {
            isValid: true, node: { active: true },
            frame: { spriteFrame: null }, icon: { spriteFrame: null, node: { active: true } },
            num: { string: '' }, rate: { string: '', node: { active: false } },
        });
        view.render({ resId, amount: 1 });
        await flushFrames();
        assert.equal(requested[requested.length - 1], expected, `resId=${resId} 的底框档位`);
        view.onDestroy();
    }
});

test('奖励格读不到 cardLevelUp 时不炸，底框退回道具品质口径', async () => {
    const requested: number[] = [];
    const ViewClass = loadClass({
        '../../framework/ref/RefUtil': {
            RefUtil: { instance: { getRefAllAsync: async (table: string) => {
                if (table === 'cardLevelUp') throw new Error('表缺失');
                if (table === 'item') return [{ resId: 18009, quality: 4 }];
                return [];
            } } },
        },
        '../itemdetail/ItemDetailArtLoader': {
            itemQualityFrameRelPath: (quality: number) => { requested.push(quality); return `image/common/cu_quality_0${quality}`; },
        },
    });
    const view = new ViewClass();
    Object.assign(view, {
        isValid: true, node: { active: true },
        frame: { spriteFrame: null }, icon: { spriteFrame: null, node: { active: true } },
        num: { string: '' }, rate: { string: '', node: { active: false } },
    });
    view.render({ resId: 18009, amount: 1 });
    await flushFrames();
    assert.equal(requested[0], 4, '缺表只降级配色，不能让奖励格空着');
    view.onDestroy();
});

test('公共奖励格使用控制器资源，无需主界面或组合根单独注入', () => {
    const source = readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8');
    assert.match(source, /new ComponentController\('ui:reward-item'\)/);
    assert.doesNotMatch(source, /static assets|useAssets/);
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    assert.doesNotMatch(bootstrap, /RewardItemView/);
});

test('公共奖励格：帧加载失败必须出声（不许静默吞成空框）', () => {
    const src = readFileSync('assets/script/app/common/RewardItemView.ts', 'utf8');
    // 🔴 静默 `() => null` ⇒ 奖励格渲染成空框、零报错（看不出是"图没加载"还是"没数据"）
    assert.match(src, /奖励格资源加载失败/, '加载失败必须 warn 出声');
    assert.doesNotMatch(src, /\)\s*,\s*\(\)\s*=>\s*null\s*\)/, '不许再把失败静默吞掉');
});

/**
 * 宝石奖励：服务端奖池/合成返回的 `CmdGoods.resId` 是**宝石实例 id**（gemId），
 * 两张道具表（`item` / `roleProperty`）都查不到 —— 不接 `gem` + `gemQuality` 就是
 * 「品质 1 灰框 + 没有图标」，也就是截图里那 10 个空格子。
 */
test('宝石奖励：gemId 不带 quality 也能按末四位推品质，并从 gemQuality 取图标', async () => {
    const requested: number[] = [];
    const h = createRewardLifecycleFixture(undefined, {
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async (table: string) => {
            if (table === 'gem') return [{ resId: 1000000, desc: '头盔宝石' }];
            if (table === 'gemQuality') return [
                { quality: 1, desc: '白色', icon: '图标_宝石_白色' },
                { quality: 5, desc: '橙色', icon: '图标_宝石_橙色' },
                { quality: 7, desc: '粉色', icon: '图标_宝石_粉色' },
            ];
            return [];
        } } } },
        '../itemdetail/ItemDetailArtLoader': {
            itemQualityFrameRelPath: (quality: number) => { requested.push(quality); return `image/common/cu_quality_0${quality}`; },
        },
    });
    const view = h.createView();
    // gemId = 部位 1000000 × 10000 前段 + attrId 6001 ⇒ 品质 7（粉色）
    view.render({ resId: 1006001, amount: 1 });
    await flushFrames();
    assert.deepEqual(requested, [7], '宝石底框必须按品质换档，不能再统一灰框');
    assert.ok(h.loads.includes('icons/gem/图标_宝石_粉色'), '图标必须走 gemQuality.icon（icons/gem）');
    assert.equal(view.icon.node.active, true);
    view.onDestroy();
});

test('宝石奖励：CmdGoods.quality 优先于末四位推导，resId 只给部位也认', async () => {
    const requested: number[] = [];
    const h = createRewardLifecycleFixture(undefined, {
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async (table: string) => {
            if (table === 'gem') return [{ resId: 1000000, desc: '头盔宝石' }];
            if (table === 'gemQuality') return [
                { quality: 1, desc: '白色', icon: '图标_宝石_白色' },
                { quality: 5, desc: '橙色', icon: '图标_宝石_橙色' },
            ];
            return [];
        } } } },
        '../itemdetail/ItemDetailArtLoader': {
            itemQualityFrameRelPath: (quality: number) => { requested.push(quality); return `image/common/cu_quality_0${quality}`; },
        },
    });
    const view = h.createView();
    // 部位 resId + 服务端品质：宝石的 quality 不在表里，必须吃 payload
    view.render({ resId: 1000000, amount: 1, quality: 5 });
    await flushFrames();
    assert.deepEqual(requested, [5]);
    assert.ok(h.loads.includes('icons/gem/图标_宝石_橙色'));
    // 宿主已解析好的 iconPath 直通（「获得奖励」弹窗就是这条路径）
    view.render({ resId: 1000002, amount: 1, quality: 5, iconPath: 'icons/gem/图标_宝石_橙色' });
    await flushFrames();
    assert.equal(h.loads.filter((path) => path === 'icons/gem/图标_宝石_橙色').length >= 1, true);
    view.onDestroy();
});
