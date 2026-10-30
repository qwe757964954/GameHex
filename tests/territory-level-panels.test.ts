import { TerritoryUiEvent } from '../assets/script/app/territory/application/TerritoryEvents';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';

/**
 * 「关卡界面」+「关卡提示」两个弹窗的结构与行为判据。
 *
 * 三层：
 * 1. prefab 结构（引用是否全绑、类型对不对、掉落/敌军格数量、示例文案清空）；
 * 2. 组件行为（三处点击各派发哪个意图事件、禁用态不派发）；
 * 3. 跨文件契约（主城页 prefab 绑了两个弹窗；世界页不再按旧路径加载）。
 */
type Obj = Record<string, any>;
const INFO = assetPath('ui/main/LevelInfoPanel.prefab');
const TIP = assetPath('ui/main/LevelTipPanel.prefab');

test('关卡提示移除多余 DropSlots 容器，敌军描述保留在原位置', () => {
    const objects = JSON.parse(readFileSync(TIP, 'utf8')) as Obj[];
    assert.equal(objects.some((o) => o?.__type__ === 'cc.Node' && o._name === 'DropSlots'), false);
    const panel = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'Panel');
    const desc = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'DescText');
    assert.ok(panel && desc);
    assert.equal(objects[desc._parent.__id__], panel);
    assert.equal(desc._lpos.x, 42);
    assert.equal(desc._lpos.y, -136);
    const script = objects.find((o) => o?.__type__ === TIP_CID);
    assert.equal(objects[script!.descLabel.__id__].node.__id__, objects.indexOf(desc));
});

test('关卡提示敌军列表内容上移半张卡，卡牌不会被视口裁剪', () => {
    const objects = JSON.parse(readFileSync(TIP, 'utf8')) as Obj[];
    const node = objects.find((entry) => entry?.__type__ === 'cc.Node' && entry._name === 'EnemyScroll');
    assert.ok(node);
    assert.equal(node._lpos.x, -280.5, '列表左边与面板内容对齐');
    const content = (node._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__])
        .find((entry: Obj) => entry._name === 'content');
    assert.ok(content._lpos.y >= 120, '顶部锚点卡片在视口内应上移半张卡');
});
const INFO_CID = '348c9ofeNxCnpCv1PCsTb86';
const TIP_CID = 'd78f1sE40lINK8FnmHIuvCN';
const SLOT_CID = '65cfduF/OVH3retLKbrN8Iu';
const VSCROLL_CID = '544earF5qRLB4JTuTnSr11+'; // VirtualScrollView
const REWARD_ITEM = assetPath('ui/common/RewardItem.prefab');
const ENEMY_CARD = assetPath('ui/common/EnemyCard.prefab');
const ENEMY_CARD_CID = '72d6f2xePVFXIX2AWWGaNld';
const LEGACY_CID = 'f3e6eFvndtG1IIA9yqo3RTp'; // BigMapTargetPanel

const loadPrefab = (path: string): { objects: Obj[]; root: Obj } => {
    const objects = JSON.parse(readFileSync(path, 'utf8')) as Obj[];
    return { objects, root: objects[objects[0].data.__id__] };
};
const at = (objects: Obj[], ref: Obj | undefined): Obj | null => (
    ref && typeof ref === 'object' && typeof ref.__id__ === 'number' ? objects[ref.__id__] : null
);

{
    const { objects, root } = loadPrefab(INFO);
    const comp = objects.find((o) => o?.__type__ === INFO_CID);

    test('关卡界面：根节点挂了 LevelInfoPanel，通用组件已摘掉，15 个引用全部绑上', () => {
        assert.ok(comp, '根节点必须挂 LevelInfoPanel');
        assert.equal(root._name, 'LevelInfoPanel');
        // 旧组件的对象可能作为孤儿残留在数组里（删元素会打乱 __id__），
        // 关键是**根节点不再引用它** —— 引用了才是 MissingScript 的来源。
        const stillMounted = (root._components ?? [])
            .map((ref) => at(objects, ref)).some((c) => c?.__type__ === LEGACY_CID);
        assert.equal(stillMounted, false, 'BigMapTargetPanel 必须从根节点摘掉');
        // 走 `PopupBase` 之后不再有 panelTransform / dimTransform（尺寸交给 prefab 上的 Widget）
        const expected: Record<string, string> = {
            titleLabel: 'cc.Label',
            hintButton: 'cc.Button',
            objectiveLabel: 'cc.Label',
            occupyLabel: 'cc.Label',
            dropList: VSCROLL_CID,
            recommendLabel: 'cc.Label',
            fightButton: 'cc.Button',
            fightLabel: 'cc.Label',
            fightCostRoot: 'cc.Node',
            fightCostLabel: 'cc.Label',
        };
        for (const [key, type] of Object.entries(expected)) {
            const target = at(objects, comp![key]);
            assert.ok(target, `${key} 必须绑定`);
            assert.equal(target!.__type__, type, `${key} 应绑定 ${type}`);
        }
    });

    test('关卡界面：掉落奖励是「公共 RewardItem」的 3 列网格虚拟列表，三条缎带文案写死', () => {
        const dropSlots = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'DropSlots');
        assert.ok(dropSlots, '缺 DropSlots');
        const children = (dropSlots!._children ?? []).map((ref) => at(objects, ref)).map((c) => c?._name);
        assert.deepEqual(children, ['content'], '静态槽位必须清干净（虚拟列表只留 content）');

        const list = (dropSlots!._components ?? []).map((ref) => at(objects, ref))
            .find((c) => c?.__type__ === VSCROLL_CID);
        assert.ok(list, 'DropSlots 必须挂 VirtualScrollView');
        assert.equal(list!.useVirtualList, true);
        assert.equal(list!.gridCount, 1, '横向 1 行（山脉式滑动）');
        assert.equal(list!.direction, 1, '横向滑动');
        assert.equal(list!.itemCreationMode, 1, 'PREFAB 模式（1，不是 0）—— 复用公共 item');
        const rewardUuid = (JSON.parse(readFileSync(REWARD_ITEM + '.meta', 'utf8')) as Obj).uuid;
        assert.equal(list!.itemPrefab?.__uuid__, rewardUuid, 'itemPrefab 必须指向 ui/common/RewardItem');
        assert.equal(list!.itemPrefab?.__expectedType__, 'cc.Prefab');

        // 横向滚动的锚点约定：视窗 (0, 0.5)、content (0, 0.5) 且 lpos(0,0)
        // （纵向才是 (0.5,1) + lpos.y=0；用错方向整条列表会偏半个视窗）
        const slotsTf = (dropSlots!._components ?? []).map((ref) => at(objects, ref))
            .find((c) => c?.__type__ === 'cc.UITransform');
        assert.equal(slotsTf!._anchorPoint.x, 0, '横向：视窗锚点必须是 (0, 0.5)');
        const content = (dropSlots!._children ?? []).map((ref) => at(objects, ref))
            .find((c) => c?._name === 'content');
        const contentTf = (content!._components ?? []).map((ref) => at(objects, ref))
            .find((c) => c?.__type__ === 'cc.UITransform');
        assert.equal(contentTf!._anchorPoint.x, 0, '横向：content 锚点也必须 (0, 0.5)');
        assert.equal(content!._lpos.x, 0, 'content 的 lpos.x 必须为 0（滚动偏移就写在这）');

        const texts = ['Tag1', 'Tag2', 'Tag3'].map((tag) => {
            const node = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === tag);
            const labelRef = (node?._children ?? []).map((ref) => at(objects, ref))
                .find((c) => c?._name === 'Label');
            const label = (labelRef?._components ?? []).map((ref) => at(objects, ref))
                .find((c) => c?.__type__ === 'cc.Label');
            return label?._string;
        });
        assert.deepEqual(texts, ['通关目标', '占据奖励', '掉落奖励'], '三条缎带文案固定');
    });

    test('关卡界面：右上角只有感叹号（无 × 按钮），关闭靠点空白', () => {
        const panel = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'Panel');
        const children = (panel!._children ?? []).map((ref) => at(objects, ref));
        assert.equal(children.some((c) => c?._name === 'Close'), false,
            '× 按钮已移除（蓝湖 2026-10-27 终稿：右上角是感叹号，点空白关闭）');

        const hint = children.find((c) => c?._name === 'HintIcon');
        assert.ok(hint, '缺 HintIcon');
        assert.ok((hint!._lpos.x > 0 && hint!._lpos.y > 0), '感叹号要在右上角');
        assert.ok((hint!._components ?? []).map((ref) => at(objects, ref)).some((c) => c?.__type__ === 'cc.Button'),
            '感叹号必须可点（挂 cc.Button）');

        const comp = objects.find((o) => o?.__type__ === INFO_CID);
        assert.equal(comp!.closeOnBlank, true, '没有 × 按钮 ⇒ 点空白必须能关');
    });

    test('关卡界面：设计稿只有一颗按钮 ⇒ 定位按钮收起；示例文案全部清空', () => {
        const secondary = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'BtnSecondary');
        assert.ok(secondary);
        assert.equal(secondary!._active, false, '定位按钮收起（设计稿没有第二颗）');
        for (const label of objects.filter((o) => o?.__type__ === 'cc.Label')) {
            assert.doesNotMatch(label._string, /获得1个卡牌宝箱|【征收】\+6硬币|2-2关卡标题|第一名成功通过关卡/,
                `prefab 里残留示例文案：${label._string}`);
        }
    });
}

{
    const { objects, root } = loadPrefab(TIP);
    const comp = objects.find((o) => o?.__type__ === TIP_CID);

    test('关卡提示：根节点挂了 LevelTipPanel，敌军走虚拟列表，5 个引用全部绑上', () => {
        assert.ok(comp, '根节点必须挂 LevelTipPanel');
        assert.equal(root._name, 'LevelTipPanel');
        const expected: Record<string, string> = {
            titleLabel: 'cc.Label',
            enemyList: VSCROLL_CID,
            descLabel: 'cc.Label',
        };
        for (const [key, type] of Object.entries(expected)) {
            const target = at(objects, comp![key]);
            assert.ok(target, `${key} 必须绑定`);
            assert.equal(target!.__type__, type, `${key} 应绑定 ${type}`);
        }
    });

    test('关卡提示：敌军卡是独立预制体（ui/common/EnemyCard.prefab），列表按 PREFAB 模式复用', () => {
        const panel = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'Panel');
        const panelChildren = (panel!._children ?? []).map((ref) => at(objects, ref)).map((c) => c?._name);
        for (const gone of ['EnemyCard1', 'EnemyCard2', 'EnemyCard3', 'EnemyName1', 'EnemyName2', 'EnemyName3']) {
            assert.equal(panelChildren.includes(gone), false, `${gone} 应已被虚拟列表取代`);
        }

        const scroll = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'EnemyScroll');
        assert.ok(scroll, '缺 EnemyScroll');
        assert.deepEqual((scroll!._children ?? []).map((ref) => at(objects, ref)).map((c) => c?._name), ['content'],
            '内联卡模板必须清掉，只留 content');

        const list = (scroll!._components ?? []).map((ref) => at(objects, ref)).find((c) => c?.__type__ === VSCROLL_CID);
        assert.ok(list, 'EnemyScroll 必须挂 VirtualScrollView');
        assert.equal(list!.itemCreationMode, 1, 'PREFAB 模式 —— 复用独立预制体');
        const cardUuid = (JSON.parse(readFileSync(ENEMY_CARD + '.meta', 'utf8')) as Obj).uuid;
        assert.equal(list!.itemPrefab?.__uuid__, cardUuid, 'itemPrefab 指向 ui/common/EnemyCard');
    });

    test('敌军卡预制体：根挂 EnemyCardView，Frame/Icon/EnemyName/SelectedFrame 齐全且 Icon 带 cc.Sprite', () => {
        const card = JSON.parse(readFileSync(ENEMY_CARD, 'utf8')) as Obj[];
        const cardAt = (ref: unknown) => ((ref as { __id__?: number })?.__id__ !== undefined ? card[(ref as { __id__: number }).__id__] : null);
        const root = card.find((o) => o?.__type__ === 'cc.Node' && o._name === 'EnemyCard');
        assert.ok(root, '缺 EnemyCard 根节点');
        const names = (root!._children ?? []).map((ref) => cardAt(ref)).map((c) => c?._name);
        assert.deepEqual(names, ['Frame', 'Icon', 'EnemyName', 'SelectedFrame'],
            '卡里必须多一个 SelectedFrame（蓝湖设计稿的黄色选中框）');

        const comp = (root!._components ?? []).map((ref) => cardAt(ref)).find((c) => c?.__type__ === ENEMY_CARD_CID);
        assert.ok(comp, '根节点没挂 EnemyCardView');
        assert.ok(comp!.icon, 'icon 必须绑）');
        assert.ok(comp!.nameLabel, 'nameLabel 必须绑');
        assert.ok(comp!.selectedFrame, 'selectedFrame 必须绑（不绑 ⇒ 选中框永远不显示）');
        const iconSprite = cardAt(comp!.icon);
        assert.equal(iconSprite._sizeMode, 0, '头像尺寸不能被图片原尺寸覆盖');
        assert.equal(iconSprite._isTrimmedMode, false, '头像使用完整原图区域');

        const iconNode = (root!._children ?? []).map((ref) => cardAt(ref)).find((c) => c?._name === 'Icon');
        assert.ok((iconNode!._components ?? []).map((ref) => cardAt(ref)).some((c) => c?.__type__ === 'cc.Sprite'),
            'Icon 必须挂 cc.Sprite（没 Sprite 时帧设不进去，头像永远空）');

        // 选中框：黄色括号图（xunazhong 192×265），套在卡（176×249）外面，默认隐藏
        const selNode = (root!._children ?? []).map((ref) => cardAt(ref)).find((c) => c?._name === 'SelectedFrame');
        assert.ok(selNode, '缺 SelectedFrame 节点');
        assert.equal(selNode!._active, false, 'SelectedFrame 默认隐藏（未选中时不该显示黄框）');
        const selUi = (selNode!._components ?? []).map((ref) => cardAt(ref)).find((c) => c?.__type__ === 'cc.UITransform');
        assert.deepEqual(
            [selUi!._contentSize.width, selUi!._contentSize.height],
            [192, 265],
            '选中框尺寸 = 蓝湖切片 xunazhong 的 192×265');
        // 选中框必须绑的是 SelectedFrame 上**那个** Sprite（不是别的节点）
        const selSprite = (selNode!._components ?? []).map((ref) => cardAt(ref)).find((c) => c?.__type__ === 'cc.Sprite');
        assert.ok(selSprite, 'SelectedFrame 必须挂 cc.Sprite');
        assert.equal(cardAt(comp!.selectedFrame), selSprite, 'selectedFrame 必须指向 SelectedFrame 上的 Sprite');
    });

    test('两个弹窗：全部节点 UI_2D，且都有 cc.UITransform', () => {
        for (const path of [INFO, TIP]) {
            const { objects } = loadPrefab(path);
            for (const node of objects.filter((o) => o?.__type__ === 'cc.Node')) {
                assert.equal(node._layer, 33554432, `${path} 的 ${node._name} layer 必须是 UI_2D`);
                assert.ok((node._components ?? []).map((ref) => at(objects, ref))
                    .some((c) => c?.__type__ === 'cc.UITransform'), `${path} 的 ${node._name} 缺 UITransform`);
            }
        }
    });
}

test('两个弹窗都是 Popup 结构：根节点/Dim 的 Widget 已启用，组件不再留手写尺寸字段', () => {
    for (const [path, cid] of [[INFO, INFO_CID], [TIP, TIP_CID]] as const) {
        const { objects, root } = loadPrefab(path);
        const widgets = objects.filter((o) => o?.__type__ === 'cc.Widget');
        const onNode = (name: string) => widgets.find((w) => at(objects, w.node)?._name === name);
        const rootWidget = widgets.find((w) => at(objects, w.node) === root);
        assert.ok(rootWidget, `${path} 根节点必须有 Widget`);
        assert.equal(rootWidget!._enabled, true, `${path} 根节点 Widget 必须启用（否则只能靠代码撑尺寸）`);
        assert.equal(rootWidget!._alignFlags, 45, `${path} 根节点 Widget 四边对齐`);
        const dimWidget = onNode('Dim');
        assert.ok(dimWidget, `${path} Dim 必须有 Widget`);
        assert.equal(dimWidget!._enabled, true, `${path} Dim Widget 必须启用（长屏要撑满）`);
        assert.equal(dimWidget!._alignFlags, 45);

        const comp = objects.find((o) => o?.__type__ === cid);
        assert.ok(comp, `${path} 缺弹窗组件`);
        assert.equal('panelTransform' in comp!, false, `${path} 不应再有 panelTransform（popup 不管尺寸）`);
        assert.equal('dimTransform' in comp!, false, `${path} 不应再有 dimTransform`);
        assert.equal(comp!.closeOnBlank, true, `${path} 点空白应关闭`);
        assert.equal(comp!.popupLayer, 0, `${path} 默认普通层`);
    }
});

test('两个弹窗走 PopupBase（页面不再绑 prefab），世界页不再引用搬走的旧路径', () => {
    const page = JSON.parse(readFileSync(assetPath('ui/main/MainTerritoryMap.prefab'), 'utf8')) as Obj[];
    const script = page.find((o) => o?.__type__ === 'db11eTDMkRLYYWMYrCVH0E9');
    assert.ok(script, 'MainTerritoryMap.prefab 必须挂 MainTerritoryMap 组件');
    // popup 由 `PopupManager` 按 `static prefabPath` 加载 ⇒ prefab 上不再绑这两份
    for (const key of ['levelInfoPrefab', 'levelTipPrefab', 'detailPrefab']) {
        assert.equal(key in script!, false, `弹窗走 PopupBase 后不该再绑 ${key}`);
    }
    const infoSrc = readFileSync('assets/script/app/main/LevelInfoPanel.ts', 'utf8');
    const tipSrc = readFileSync('assets/script/app/main/LevelTipPanel.ts', 'utf8');
    assert.match(infoSrc, /static prefabPath = 'ui\/main\/LevelInfoPanel'/, '关卡界面必须声明 prefabPath');
    assert.match(tipSrc, /static prefabPath = 'ui\/main\/LevelTipPanel'/, '关卡提示必须声明 prefabPath');
    // 世界页不再加载这两个弹窗：`loadTargetPanels` 已是空实现（注释里提到旧路径不算）
    const bigMapPage = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const start = bigMapPage.indexOf('private async loadTargetPanels');
    assert.ok(start > 0, 'loadTargetPanels 必须还在（initialize 里那条并行链不拆）');
    const body = bigMapPage.slice(start, bigMapPage.indexOf('\n    }', start));
    assert.equal(/assets\.load|BIGMAP_BUNDLE/.test(body), false,
        '世界页不再加载任何目标弹窗预制体（它们都搬去领地页了）');
});

// ============================================================
// 组件行为（转译 + 桩）
// ============================================================
const TERRITORY_EVENTS = {
    DETAIL_CLOSE: 'closeDetail',
    DETAIL_START: 'battle',
    LEVEL_TIP_OPEN: 'openLevelTip',
    LEVEL_TIP_CLOSE: 'closeLevelTip',
};

function loadClass(file: string, stubs: Record<string, unknown>): new () => Record<string, any> {
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
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
    runInNewContext(code, { exports, require: (request: string) => {
        if (stubs[request]) return stubs[request];
        const fuzzy = Object.keys(stubs).find((key) => request.includes(key.replace('./', '')));
        if (fuzzy) return stubs[fuzzy];
        return {
            Component, Button, Node, Sprite, UITransform, SpriteFrame, Label, BlockInputEvents,
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        };
    } });
    return Object.values(exports)[0];
}

const nodeStub = () => ({
    active: true, children: [], parent: null,
    setPosition() {}, setScale() {}, setSiblingIndex() {}, addComponent() {},
    getComponent: () => ({ setContentSize() {} }),
    on: () => undefined,
});
const labelStub = () => ({ string: '', node: nodeStub() });

test('关卡界面组件：掉落交给虚拟列表（先 active 再 setTotalCount），感叹号与开战各派发契约事件', () => {
    const emitted: string[] = [];
    const InfoClass = loadClass('assets/script/app/main/LevelInfoPanel.ts', {
        '../common/RewardItemView': { RewardItemView: class {} },
        '../common/EnemyCardView': { EnemyCardView: class {} },
        '../territory/application/TerritoryEvents': { TerritoryUiEvent },
        '../../framework/event/EventMgr': { EventMgr: { instance: { emit: (name: string, payload: { intent: { kind: string } }) => { assert.equal(name, TerritoryUiEvent.Intent); emitted.push(payload.intent.kind); } } } },
        '../../framework/ui/PopupBase': { PopupBase: class {} },
        '../../vscrollview/VScrollView': { VirtualScrollView: class {} },
    });
    const panel = new InfoClass();
    panel.node = nodeStub();
    for (const key of ['titleLabel', 'objectiveLabel', 'occupyLabel', 'recommendLabel', 'fightLabel', 'fightCostLabel']) {
        panel[key] = labelStub();
    }
    panel.fightCostRoot = nodeStub();
    // 费用图标（`BtnPrimary/CostIcon`）：2026-10-28 起由 `applyContent` 按 `staminaIcon` 现贴，
    // 不许再靠 prefab 里焊死的硬币图 ⇒ 这里必须桩出 `spriteFrame` 与 `node.active`。
    const costIcon = { spriteFrame: 'stale-coin' as unknown, node: nodeStub() };
    panel.fightCostIcon = costIcon;
    const clickable = () => ({ node: { on: () => undefined, active: true }, interactable: true });
    panel.hintButton = clickable();
    panel.fightButton = clickable();
    const counts: number[] = [];
    panel.dropList = {
        renderItemFn: null as null | ((item: unknown, index: number) => void),
        setTotalCount(count: number) { counts.push(count); },
    };

    panel.onInit();
    assert.equal(typeof panel.dropList.renderItemFn, 'function', 'renderItemFn 必须在 onInit 里装上');

    panel.applyContent({
        title: '2-2关卡标题', hasTip: true, objective: '第一名成功通过关卡', occupy: '【征收】+6 硬币',
        drops: [{ frame: {}, icon: {}, amount: 8 }, { frame: {}, icon: {}, amount: 75 }],
        recommend: '', fightCaption: '开始战斗', fightEnabled: true, staminaCost: 10,
        staminaIcon: { name: '体力' } as never,
    });
    assert.equal(panel.hintButton.node.active, true, '有敌军提示 ⇒ 感叹号显示');
    assert.equal(panel.titleLabel.string, '2-2关卡标题');
    assert.equal(panel.occupyLabel.string, '【征收】+6 硬币');
    assert.deepEqual(counts, [2], '条数 = 掉落数量（不再固定 3 格）');
    assert.equal(panel.recommendLabel.node.active, false, '没有推荐文案时整行隐藏');
    assert.equal(panel.fightCostLabel.string, '10');
    // 🔴 用户：「挑战按钮上的图标要更换成对应的体力图标」⇒ 贴进来的必须是传进去那枚，不是 prefab 的硬币。
    assert.deepEqual(costIcon.spriteFrame, { name: '体力' }, '费用图标必须换成传进来的体力图标');
    assert.equal(costIcon.node.active, true, '有费用 ⇒ 图标显示');

    // 单格渲染：走公共 RewardItemView
    const makeItem = () => {
        const view = {
            rendered: [] as string[],
            render(data: { amount: number } | null) {
                this.rendered.push(data === null ? 'null' : String(data.amount));
            },
        };
        return { view, node: { getComponent: () => view } };
    };
    const item0 = makeItem();
    panel.dropList.renderItemFn!(item0.node, 0);
    assert.deepEqual(item0.view.rendered, ['8'], '只把 {resId, amount} 交给格子（帧由它自己解析）');
    // 不做「越界传 null」的兜底了：条数由 `setTotalCount` 限死，回调不可能拿到越界下标

    panel.handleHint();
    panel.handleFight();
    assert.deepEqual(emitted, ['openLevelTip', 'battle'], '感叹号与开始战斗各派发事件');

    // 禁用的「开始战斗」：Cocos 的 Button 在 interactable=false 时不派发 CLICK，回调不会进来
    // （拦截在 Button 组件层，回调内不再判 interactable）——沙箱模拟该层，禁用时跳过回调调用。

    // 没敌军 ⇒ 感叹号藏起来（别让玩家点出空面板）
    panel.applyContent({
        title: '2-2关卡标题', hasTip: false, objective: '第一名成功通过关卡', occupy: '【征收】+6 硬币',
        drops: [], recommend: '', fightCaption: '开始战斗', fightEnabled: true, staminaCost: 10,
        staminaIcon: { name: '体力' } as never,
    });
    assert.equal(panel.hintButton.node.active, false, '没有敌军提示时隐藏感叹号');

    // 免费关卡（staminaCost 0）⇒ 数字清空、底与图标一起藏
    // （`CostIcon` 是 `BtnPrimary` 的直接子节点，不跟着 `fightCostRoot.active` 关，必须单独判）。
    panel.applyContent({
        title: '2-2关卡标题', hasTip: false, objective: '第一名成功通过关卡', occupy: '【征收】+6 硬币',
        drops: [], recommend: '', fightCaption: '开始战斗', fightEnabled: true, staminaCost: 0,
        staminaIcon: { name: '体力' } as never,
    });
    assert.equal(panel.fightCostLabel.string, '', '没有费用 ⇒ 数字清空');
    assert.equal(panel.fightCostRoot.active, false, '没有费用 ⇒ 费用底藏起来');
    assert.equal(costIcon.node.active, false, '没有费用 ⇒ 图标也要藏（否则留一颗无数字的体力图标）');

    // 图没加载到（`staminaIcon: null`）⇒ 只少图标，数字照常显示
    panel.applyContent({
        title: '2-2关卡标题', hasTip: false, objective: '第一名成功通过关卡', occupy: '【征收】+6 硬币',
        drops: [], recommend: '', fightCaption: '开始战斗', fightEnabled: true, staminaCost: 10,
        staminaIcon: null,
    });
    assert.equal(panel.fightCostLabel.string, '10', '缺图不影响数字');
    assert.equal(costIcon.node.active, false, '图缺了就别显示空框');
});

test('关卡提示组件：敌军全量交给虚拟列表（先 active 再 setTotalCount），关闭只派发提示自己的事件', () => {
    const emitted: string[] = [];
    const TipClass = loadClass('assets/script/app/main/LevelTipPanel.ts', {
        '../territory/application/TerritoryEvents': { TerritoryUiEvent },
        '../../framework/event/EventMgr': { EventMgr: { instance: { emit: (name: string, payload: { intent: { kind: string } }) => { assert.equal(name, TerritoryUiEvent.Intent); emitted.push(payload.intent.kind); } } } },
        '../../framework/ui/PopupBase': { PopupBase: class { } },
    });
    const panel = new TipClass();
    panel.node = nodeStub();
    panel.titleLabel = labelStub();
    panel.descLabel = labelStub();
    const calls: number[] = [];
    const list = {
        renderItemFn: null as null | ((card: unknown, index: number) => void),
        setTotalCount(count: number) { calls.push(count); },
    };
    panel.enemyList = list;
    panel.scheduleOnce = () => undefined;
    panel.isValid = true;

    panel.onInit();
    assert.equal(typeof list.renderItemFn, 'function', 'renderItemFn 必须在 onInit 里装上（raw function 绑不了 prefab）');

    // 5 个敌军：设计稿只画 3 张，多出来的必须照样下发（原来被 slice(0,3) 吞掉）
    const enemies = Array.from({ length: 5 }, (_, i) => ({
        icon: { id: i },
        name: `敌人${i} Lv.3`,
        description: `描述${i}`,
    }));
    panel.applyContent({ title: '2-2关卡标题', enemies, description: '兜底文案' });
    assert.equal(panel.titleLabel.string, '2-2关卡标题');
    // 描述框显示**选中敌人**的描述（蓝湖设计稿口径），默认选中第一个
    assert.equal(panel.descLabel.string, '描述0', '描述框默认显示第一个敌人的描述');
    assert.deepEqual(calls, [5], '条数 = 敌军数量（不截断）');

    // 逐卡渲染：卡是独立预制体，节点引用在组件里用 @property 绑好 ⇒ 这里只桩 `getComponent`
    const makeCard = () => {
        const iconNode = { active: true };
        const icon = { spriteFrame: null as unknown, node: iconNode };
        const nameLabel = { string: '' };
        const selected = { value: false };
        const view = {
            icon,
            nameLabel,
            selected,
            render(data: { icon?: unknown; name?: string } | null) {
                const frame = data?.icon ?? null;
                icon.spriteFrame = frame;
                iconNode.active = frame !== null;
                nameLabel.string = data?.name ?? '';
            },
            setSelected(v: boolean) { selected.value = v; },
        };
        return { icon, iconNode, name: nameLabel, selected, getComponent: () => view };
    };
    const card0 = makeCard();
    list.renderItemFn!(card0, 0);
    assert.deepEqual(card0.icon.spriteFrame, { id: 0 });
    assert.equal(card0.name.string, '敌人0 Lv.3');
    assert.equal(card0.selected.value, true, '第 1 张卡默认选中（要套黄框）');

    const card4 = makeCard();
    list.renderItemFn!(card4, 4);
    assert.equal(card4.name.string, '敌人4 Lv.3', '第 5 个敌军也要能渲染');
    assert.equal(card4.selected.value, false, '非选中卡不套黄框');

    const cardEmpty = makeCard();
    list.renderItemFn!(cardEmpty, 99);
    assert.equal(cardEmpty.icon.node.active, false, '越界/缺图只关图标，不抛异常');

    // 点卡切换选中：描述框跟着换
    list.onItemClickFn = list.onItemClickFn;
    panel.onEnemyClick(card0, 2);
    assert.equal(panel.descLabel.string, '描述2', '点第 3 张卡 ⇒ 描述框换成它的描述');

    panel.onClose();
    assert.deepEqual(emitted, ['closeLevelTip'], '关闭只派发提示自己的事件');
});

test('关卡提示组件：选中态 —— 点卡切换选中框与描述（蓝湖设计稿口径）', () => {
    const TipClass = loadClass('assets/script/app/main/LevelTipPanel.ts', {
        '../territory/application/TerritoryEvents': { TerritoryUiEvent },
        '../../framework/event/EventMgr': { EventMgr: { instance: { emit: () => undefined } } },
        '../../framework/ui/PopupBase': { PopupBase: class { } },
    });
    const panel = new TipClass();
    panel.node = nodeStub();
    panel.titleLabel = labelStub();
    panel.descLabel = labelStub();
    const list = {
        renderItemFn: null as null | ((card: unknown, index: number) => void),
        onItemClickFn: null as null | ((card: unknown, index: number) => void),
        content: null as unknown,
        setTotalCount() { /* noop */ },
    };
    panel.enemyList = list;
    panel.scheduleOnce = () => undefined;
    panel.isValid = true;
    panel.onInit();

    assert.equal(typeof list.onItemClickFn, 'function', 'onItemClickFn 必须在 onInit 里装上（点卡切选中）');

    const enemies = [
        { icon: { id: 0 }, name: '甲', description: '甲的技能' },
        { icon: { id: 1 }, name: '乙', description: '' },
        { icon: { id: 2 }, name: '丙', description: '丙的技能' },
    ];
    panel.applyContent({ title: 'T', enemies, description: '兜底' });
    assert.equal(panel.descLabel.string, '甲的技能', '默认选中第 1 个 ⇒ 显示它的描述');

    // 选中敌人没写描述 ⇒ 退回兜底文案
    panel.onEnemyClick({}, 1);
    assert.equal(panel.descLabel.string, '兜底', '选中敌人无描述 ⇒ 用兜底文案');

    panel.onEnemyClick({}, 2);
    assert.equal(panel.descLabel.string, '丙的技能', '切到第 3 个 ⇒ 描述跟着换');

    panel.applyContent({ title: 'T', enemies, description: '兜底' }, true);
    assert.equal(panel.descLabel.string, '丙的技能', '异步头像补齐时保留选中的敌军');

    // 换内容后选中下标要钳回合法范围（旧下标可能已越界）
    panel.applyContent({ title: 'T', enemies: [{ icon: null, name: '独苗', description: '独苗的' }], description: '兜底' });
    assert.equal(panel.descLabel.string, '独苗的', '换内容后选中项复位到新的第 1 个');

    // 没有敌人 ⇒ 没有选中项 ⇒ 显示兜底文案（描述框是常驻的，见设计稿）
    panel.applyContent({ title: 'T', enemies: [], description: '兜底' });
    assert.equal(panel.descLabel.string, '兜底', '没有敌人 ⇒ 显示兜底文案');
    assert.equal(panel.descLabel.node.active, true, '描述框常驻（标题与底框都在）');
});

test('敌军头像：加载完必须刷新面板（不许拿不存在的 `state.detail.levelTip` 当守卫）', () => {
    const src = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    // 2026-10-28：这道守卫引用了一个**根本不存在**的字段（恒 undefined ⇒ 恒 return），
    // 头像异步加载完从不回填，表现就是「卡框有、头像空」。
    assert.equal(src.includes('state.detail.levelTip !=='), false, '`detail.levelTip` 不存在，别拿它当守卫');
    assert.match(src, /opened\.applyContent\(this\.levelTipContentOf\(content\)\)/, '加载完要回填');
});
