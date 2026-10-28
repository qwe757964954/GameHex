import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * 异步据点「玩家关卡」弹窗（`ui/territory/BigMapPlayerLevelPanel.prefab`）的**结构与行为**判据。
 *
 * 分两层：
 * 1. **prefab 结构**（离线读 JSON）—— 3 个奖励格、双按钮各带费用、所有引用都指向正确类型；
 * 2. **组件行为**（转译 + 桩）—— 全量赋值幂等、三颗按钮各派发对应意图事件、开战禁用时不派发。
 *
 * 组件层只桩 `cc`，因为它自己 `import` 的两个模块（`TerritoryEvents` / `BigMapRewardSlot`）
 * 都是零引擎依赖的纯 TS —— 桩掉更省事，且能顺手断言「事件名就是契约里那几个」。
 */
const PREFAB = 'assets/resources/ui/territory/BigMapPlayerLevelPanel.prefab';
const PANEL_CID = 'bf856EjpalDq6B8iax9zQC3';
const SLOT_CID = '854a5dTnHtCB5BhgTSD4G22';
const VSCROLL_CID = '544earF5qRLB4JTuTnSr11+';
const REWARD_ITEM = 'assets/resources/ui/common/RewardItem.prefab';
const LEGACY_CID = 'f3e6eFvndtG1IIA9yqo3RTp'; // BigMapTargetPanel（通用关卡弹窗，换组件后必须彻底消失）

type Obj = Record<string, any>;
const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const at = (ref: Obj | null | undefined): Obj | null => (
    ref && typeof ref === 'object' && typeof ref.__id__ === 'number' ? objects[ref.__id__] : null
);
const nodeByName = (name: string): Obj | null => objects.find((o) => o?.__type__ === 'cc.Node' && o._name === name) ?? null;
const childrenOf = (node: Obj): Obj[] => (node._children ?? []).map(at).filter((child): child is Obj => !!child);
const childNamed = (node: Obj, name: string): Obj | null => childrenOf(node).find((c) => c._name === name) ?? null;
const compOf = (node: Obj | null, type: string): Obj | null => (
    node ? (node._components ?? []).map(at).find((c) => c?.__type__ === type) ?? null : null
);

test('玩家关卡弹窗：根节点换成专用组件，旧的通用关卡组件已彻底移除', () => {
    const root = objects[objects[0].data.__id__];
    assert.equal(root._name, 'BigMapPlayerLevelPanel');
    const panel = compOf(root, PANEL_CID);
    assert.ok(panel, '根节点必须挂 BigMapPlayerLevelPanel');
    assert.equal(objects.some((o) => o?.__type__ === LEGACY_CID), false, 'BigMapTargetPanel 必须已移除');

    // 18 个引用逐项对类型 —— 绑错类型在运行时只会静默变 null（铁律 6b）
    const expected: Record<string, string> = {
        panelTransform: 'cc.UITransform',
        dimTransform: 'cc.UITransform',
        titleLabel: 'cc.Label',
        chestLabel: 'cc.Label',
        dropList: VSCROLL_CID,
        scoutButton: 'cc.Button',
        scoutLabel: 'cc.Label',
        scoutCostRoot: 'cc.Node',
        scoutCostIcon: 'cc.Sprite',
        scoutCostLabel: 'cc.Label',
        fightButton: 'cc.Button',
        fightLabel: 'cc.Label',
        fightCostRoot: 'cc.Node',
        fightCostIcon: 'cc.Sprite',
        fightCostLabel: 'cc.Label',
        closeButton: 'cc.Button',
    };
    for (const [key, type] of Object.entries(expected)) {
        const target = at(panel[key]);
        assert.ok(target, `${key} 必须绑定`);
        assert.equal(target.__type__, type, `${key} 应绑定 ${type}`);
    }
});

test('玩家关卡弹窗：占领奖励是「公共 RewardItem」的 3 列网格虚拟列表', () => {
    const slots = nodeByName('RewardSlots');
    assert.ok(slots, '缺 RewardSlots 容器');
    assert.deepEqual(childrenOf(slots).map((c) => c._name), ['content'], '静态槽位必须清干净');

    const list = (slots!._components ?? []).map(at).find((c) => c?.__type__ === VSCROLL_CID);
    assert.ok(list, 'RewardSlots 必须挂 VirtualScrollView');
    assert.equal(list!.useVirtualList, true);
    assert.equal(list!.gridCount, 3, '3 列');
    assert.equal(list!.itemCreationMode, 1, 'PREFAB 模式 —— 复用公共 item');
    const rewardUuid = (JSON.parse(readFileSync(REWARD_ITEM + '.meta', 'utf8')) as Obj).uuid;
    assert.equal(list!.itemPrefab?.__uuid__, rewardUuid, 'itemPrefab 指向 ui/common/RewardItem');

    const tf = (slots!._components ?? []).map(at).find((c) => c?.__type__ === 'cc.UITransform');
    assert.equal(tf!._anchorPoint.y, 1, '视窗锚点必须 (0.5, 1)');
    const content = childrenOf(slots).find((c) => c?._name === 'content');
    assert.equal(content!._lpos.y, 0, 'content.lpos.y 必须为 0');
});

test('玩家关卡弹窗：两处占据奖励标题显示礼物图标', () => {
    const panel = nodeByName('Panel');
    for (const tagName of ['Tag1', 'Tag2']) {
        const icon = childNamed(childNamed(panel, tagName), 'Icon');
        assert.ok(icon, `${tagName} 缺礼物图标`);
        assert.equal(icon._active, true, `${tagName} 的礼物图标必须显示`);
        const sprite = (icon._components ?? []).map(at).find((component) => component?.__type__ === 'cc.Sprite');
        assert.ok(sprite?._spriteFrame?.__uuid__, `${tagName} 的礼物图标必须绑定图片`);
    }
});

test('玩家关卡弹窗：两颗按钮各带一份货币费用，关闭按钮上那套费用节点必须收起', () => {
    const panel = nodeByName('Panel');
    assert.ok(panel);
    for (const name of ['BtnSecondary', 'BtnPrimary']) {
        const btn = childNamed(panel, name);
        assert.ok(btn, `缺 ${name}`);
        for (const costNode of ['CostBg', 'CostIcon', 'CostLabel']) {
            const child = childNamed(btn, costNode);
            assert.ok(child, `${name} 缺 ${costNode}`);
            assert.equal(child._active, true, `${name}/${costNode} 必须可见（设计稿两颗按钮都带价格）`);
        }
        // 文字在上、费用在下：与 primary 原有排版一致，不能一个居中一个有费用
        const label = childNamed(btn, 'Label');
        assert.ok(label);
        assert.ok(label._lpos.y > 0, `${name}/Label 要在上半区（费用角标在下半区）`);
    }
    const close = childNamed(panel, 'Close');
    assert.ok(close);
    for (const costNode of ['CostBg', 'CostIcon', 'CostLabel']) {
        const child = childNamed(close, costNode);
        if (child) assert.equal(child._active, false, `Close/${costNode} 必须收起（× 按钮不该带价格）`);
    }
});

test('玩家关卡弹窗：全部节点 UI_2D，且有 cc.UITransform（手写/生成 prefab 的两条静默坑）', () => {
    const nodes = objects.filter((o) => o?.__type__ === 'cc.Node');
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} layer 必须是 UI_2D`);
        assert.ok((node._components ?? []).map(at).some((c) => c?.__type__ === 'cc.UITransform'),
            `${node._name} 缺 cc.UITransform`);
    }
});

test('领地页 prefab 绑定了玩家关卡弹窗，世界页已不再引用搬走的旧路径', () => {
    // ② 领地页：`playerStagePrefab` 必须指向这张 prefab（指错 = onLoad 里 instantiate(null) 直接崩）
    const pageObjects = JSON.parse(readFileSync('assets/resources/ui/main/MainTerritoryMap.prefab', 'utf8')) as Obj[];
    const pageScript = pageObjects.find((o) => o?.__type__ === 'db11eTDMkRLYYWMYrCVH0E9');
    assert.ok(pageScript, 'MainTerritoryMap.prefab 必须挂 MainTerritoryMap 组件');
    const prefabUuid = (JSON.parse(readFileSync(`${PREFAB}.meta`, 'utf8')) as Obj).uuid;
    assert.equal(pageScript.playerStagePrefab?.__uuid__, prefabUuid,
        'playerStagePrefab 必须指向 ui/territory/BigMapPlayerLevelPanel');
    assert.equal(pageScript.playerStagePrefab?.__expectedType__, 'cc.Prefab');

    // ③ 世界页：搬走之后不能再按 `ui/bigmap/BigMapPlayerLevelPanel` 加载（那条路径已不存在，
    //    留着会让整个大世界界面在打开时抛「弹窗预制体加载失败」）
    const bigMapPage = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.equal(/ui\/bigmap\/BigMapPlayerLevelPanel/.test(bigMapPage), false,
        'BigMapPage 不能再按旧路径加载 BigMapPlayerLevelPanel（它已改由领地页使用）');
});


function loadPanelClass(emitted: string[]): new () => Record<string, any> {
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/territory/view/BigMapPlayerLevelPanel.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Component {}
    class Button { static EventType = { CLICK: 'click' }; interactable = true; }
    class Node { static EventType = { TOUCH_END: 'end' }; }
    class Sprite {}
    class UITransform {}
    class SpriteFrame {}
    class Label {}
    class BlockInputEvents {}
    const TERRITORY_EVENTS = {
        DETAIL_CLOSE: 'territory:detail-close',
        DETAIL_START: 'territory:detail-start',
        DETAIL_SCOUT: 'territory:detail-scout',
    };
    class RewardItemView { render() {} clear() {} }
    //  事件走 `EventMgr` 全局中控：这里记下所有 emit 的事件名，供断言「派发了哪个意图」。
    const EventMgr = { instance: { emit: (event: string) => emitted.push(event), on() {}, offTarget() {} } };
    const stub = (request: string) => {
        if (request === './TerritoryEvents') return { TERRITORY_EVENTS };
        if (request.includes('event/EventMgr')) return { EventMgr };
        if (request === '../../common/RewardItemView') return { RewardItemView };
        if (request === '../../../vscrollview/VScrollView') return { VirtualScrollView: class {} };
        return {
            Component, Button, Node, Sprite, UITransform, SpriteFrame, Label, BlockInputEvents,
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        };
    };
    runInNewContext(code, { exports, require: stub });
    return exports.BigMapPlayerLevelPanel;
}

test('玩家关卡弹窗组件：全量赋值、两颗按钮与关闭各自派发意图事件，开战禁用时不派发', () => {
    const emitted: string[] = [];
    const PanelClass = loadPanelClass(emitted);
    const panel = new PanelClass();
    const listeners = new Map<string, () => void>();
    const node = () => ({
        active: true, children: [], parent: null,
        setPosition() {}, setScale() {}, setSiblingIndex() {},
        getComponent: () => ({ setContentSize() {} }), addComponent() {},
        on: (event: string, fn: () => void) => listeners.set(event, fn),
    });
    const label = () => ({ string: '', node: node(), color: null });
    panel.node = { ...node(), emit: (event: string) => emitted.push(event) };
    panel.panelTransform = { node: node(), width: 651, height: 717 };
    panel.dimTransform = { node: node(), setContentSize() {} };
    panel.titleLabel = label();
    panel.chestLabel = label();
    const counts: number[] = [];
    panel.dropList = {
        renderItemFn: null as null | ((item: unknown, index: number) => void),
        setTotalCount(count: number) { counts.push(count); },
    };
    for (const key of ['scoutLabel', 'scoutCostLabel', 'fightLabel', 'fightCostLabel']) panel[key] = label();
    for (const key of ['scoutCostRoot', 'fightCostRoot']) panel[key] = node();
    for (const key of ['scoutCostIcon', 'fightCostIcon']) panel[key] = { spriteFrame: null, node: node() };
    for (const key of ['scoutButton', 'fightButton', 'closeButton']) panel[key] = { node: node(), interactable: true };

    panel.initialize(720, 1280, {});
    panel.open({
        title: '玩家甲',
        chestText: '获得 1 个卡牌宝箱',
        rewards: [{ frame: {}, icon: {}, amount: 8 }, { frame: {}, icon: {}, amount: 75 }],
        scoutCost: 10,
        fightCost: 100,
        fightCaption: '开始战斗',
        fightEnabled: true,
    });
    assert.equal(panel.titleLabel.string, '玩家甲');
    assert.equal(panel.chestLabel.string, '获得 1 个卡牌宝箱');
    assert.deepEqual(counts, [2], '条数 = 奖励数量（不再固定 3 格）');
    assert.equal(panel.scoutCostLabel.string, '10');
    assert.equal(panel.fightCostLabel.string, '100');
    assert.equal(panel.fightLabel.string, '开始战斗');
    assert.equal(panel.node.active, true);

    // 直接调私有 handler（事件从 node.emit 记录；桩里三颗按钮共用同一个 node 桩）
    panel.handleScout();
    panel.handleFight();
    panel.handleClose();
    assert.deepEqual(emitted,
        ['territory:detail-scout', 'territory:detail-start', 'territory:detail-close'],
        '三颗按钮各派发契约里的事件，不回调穿透');

    // 开战禁用：点击不派发（否则未绑关卡的据点会发空请求）
    emitted.length = 0;
    panel.fightButton.interactable = false;
    panel.handleFight();
    assert.deepEqual(emitted, [], '禁用的开战按钮不派发事件');

    // 无费用：角标整块收起
    panel.open({
        title: '玩家乙', chestText: '', rewards: [], scoutCost: 0, fightCost: 0,
        fightCaption: '开始战斗', fightEnabled: false,
    });
    assert.equal(panel.scoutCostRoot.active, false);
    assert.equal(panel.fightCostRoot.active, false);
    assert.equal(panel.chestLabel.node.active, false, '没有第一条奖励时整行隐藏');
    assert.equal(panel.node.active, true, 'open 幂等：重复打开仍可见');
});
