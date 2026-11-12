import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';

/**
 * 「宝箱详情」弹窗（`ui/main/ChestDetailPanel.prefab`）的结构与行为判据。
 *
 * 分两层：
 * 1. **prefab 结构**（离线读 JSON）—— 22 个引用逐项对类型、5 个奖励格几何、全部 UI_2D；
 * 2. **组件行为**（转译 + 桩）—— 全量赋值幂等、三颗按钮派发意图、倒计时只走轻量入口。
 *
 * 另外守两条**跨文件契约**：主城页 prefab 必须绑上这个弹窗，世界页不能再引用搬走的旧路径。
 */
const PREFAB = assetPath('ui/main/ChestDetailPanel.prefab');
const PANEL_CID = 'fba93mSlUVEQ4N0/mw7tcEZ';
const VSCROLL_CID = '544earF5qRLB4JTuTnSr11+';
const REWARD_ITEM = assetPath('ui/main/ChestDetailRewardItem.prefab');

type Obj = Record<string, any>;
const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const at = (ref: Obj | null | undefined): Obj | null => (
    ref && typeof ref === 'object' && typeof ref.__id__ === 'number' ? objects[ref.__id__] : null
);
const root = objects[objects[0].data.__id__];
const panelComp = objects.find((o) => o?.__type__ === PANEL_CID);
const nodeOf = (name: string): Obj | null => objects.find((o) => o?.__type__ === 'cc.Node' && o._name === name) ?? null;

test('宝箱详情弹窗：根节点挂专用组件，22 个引用全部绑上且类型正确', () => {
    assert.ok(panelComp, '根节点必须挂 ChestDetailPanel');
    // 走 `PopupBase` 之后不再有 panelTransform / dimTransform（尺寸交给 prefab 上的 Widget）
    const expected: Record<string, string> = {
        qualityFrame: 'cc.Sprite',
        chestIcon: 'cc.Sprite',
        nameLabel: 'cc.Label',
        qualityLabel: 'cc.Label',
        countLabel: 'cc.Label',
        dropList: VSCROLL_CID,
        fastButton: 'cc.Button',
        fastLabel: 'cc.Label',
        fastCostRoot: 'cc.Node',
        fastCostIcon: 'cc.Sprite',
        fastCostLabel: 'cc.Label',
        openButton: 'cc.Button',
        openLabel: 'cc.Label',
        openCostRoot: 'cc.Node',
        openCostLabel: 'cc.Label',
        // 2026-11-11 加速态：绿底 + 播放 icon（三处绑定，缺一个就只剩黄色「加速」）。
        openFrame: 'cc.Sprite',
        openSpeedUpIcon: 'cc.Node',
        closeButton: 'cc.Button',
    };
    for (const [key, type] of Object.entries(expected)) {
        const target = at(panelComp![key]);
        assert.ok(target, `${key} 必须绑定`);
        assert.equal(target.__type__, type, `${key} 应绑定 ${type}`);
    }
});

test('宝箱详情弹窗：奖励说明是详情卡片的 4 列网格虚拟列表（4+1 换行）', () => {
    const slots = objects.find((o) => o?.__type__ === 'cc.Node' && o._name === 'ItemSlots');
    assert.ok(slots, '缺 ItemSlots');
    assert.deepEqual((slots!._children ?? []).map((ref) => at(ref)).map((c) => c?._name), ['content'],
        '静态槽位必须清干净（虚拟列表只留 content）');

    const list = (slots!._components ?? []).map((ref) => at(ref)).find((c) => c?.__type__ === VSCROLL_CID);
    assert.ok(list, 'ItemSlots 必须挂 VirtualScrollView');
    assert.ok((slots!._components ?? []).map((ref) => at(ref)).some((c) => c?.__type__ === 'cc.Mask'),
        '滚动时奖励卡片必须裁剪在奖励说明框内');
    assert.equal(list!.useVirtualList, true);
    assert.equal(list!.gridCount, 4, '4 列（设计稿 4+1 换行）');
    assert.equal(list!.itemCreationMode, 1, 'PREFAB 模式 —— 复用公共 item');
    const rewardUuid = (JSON.parse(readFileSync(REWARD_ITEM + '.meta', 'utf8')) as Obj).uuid;
    assert.equal(list!.itemPrefab?.__uuid__, rewardUuid, 'itemPrefab 指向详情奖励卡片');

    const tf = (slots!._components ?? []).map((ref) => at(ref)).find((c) => c?.__type__ === 'cc.UITransform');
    assert.equal(tf!._anchorPoint.y, 1, '视窗锚点必须 (0.5, 1)');
    const content = (slots!._children ?? []).map((ref) => at(ref)).find((c) => c?._name === 'content');
    assert.equal(content!._lpos.y, 0, 'content.lpos.y 必须为 0');
});

test('宝箱奖励卡：浅色底在图标和概率之下，尺寸与四列布局一致', () => {
    const item = JSON.parse(readFileSync(REWARD_ITEM, 'utf8')) as Obj[];
    const card = item.find((o) => o?.__type__ === 'cc.Node' && o._name === 'ChestDetailRewardItem')!;
    const children = card._children.map((ref: Obj) => item[ref.__id__]);
    assert.deepEqual(children.map((n: Obj) => n._name), ['CardBackground', 'Frame', 'Icon', 'Num', 'Rate']);
    const tf = card._components.map((ref: Obj) => item[ref.__id__]).find((c: Obj) => c.__type__ === 'cc.UITransform');
    assert.deepEqual([tf._contentSize.width, tf._contentSize.height], [126, 151]);
    const rate = children.find((n: Obj) => n._name === 'Rate');
    const label = rate._components.map((ref: Obj) => item[ref.__id__]).find((c: Obj) => c.__type__ === 'cc.Label');
    assert.equal(label._enableOutline, false);
    assert.ok(rate._lpos.y < 0, '概率在图标下方');
});

test('宝箱详情弹窗：全部节点 UI_2D 且有 UITransform；示例文案必须清空', () => {
    for (const node of objects.filter((o) => o?.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, `${node._name} layer 必须是 UI_2D`);
        assert.ok((node._components ?? []).map(at).some((c) => c?.__type__ === 'cc.UITransform'),
            `${node._name} 缺 cc.UITransform`);
    }
    // 设计稿的示例文案（高级宝箱 / 品质：史诗 / 数量：12 / 01:35:25）不能留在 prefab 里 ——
    // 那会让"没数据"和"真有这箱"看起来一模一样（规则 347 的同款假数据陷阱）。
    // 标题「宝箱详情」是固定文案，不在拦截范围内。
    for (const label of objects.filter((o) => o?.__type__ === 'cc.Label')) {
        assert.doesNotMatch(label._string, /高级宝箱|品质：史诗|数量：12|01:35:25/,
            `prefab 里残留示例文案：${label._string}`);
    }
    // 标题必须留着（弹窗名字是设计稿的固定文案，不靠代码写）
    assert.ok(objects.some((o) => o?.__type__ === 'cc.Label' && o._string === '宝箱详情'),
        '标题「宝箱详情」应写在 prefab 里');
});

test('宝箱详情「打开」按钮：两行态坐标与按钮中线对齐，代码常量不许和 prefab 脱节', () => {
    const primary = nodeOf('BtnPrimary')!;
    const children = (primary._children ?? []).map(at);
    const label = children.find((c) => c?._name === 'Label')!;
    const costLabel = children.find((c) => c?._name === 'CostLabel')!;
    const tf = (primary._components ?? []).map(at).find((c) => c?.__type__ === 'cc.UITransform')!;
    assert.equal(tf._anchorPoint.y, 0.5, '按钮锚点居中 ⇒ Label y=0 就是按钮正中');
    assert.equal(tf._contentSize.height, 108);
    assert.equal(label._lpos.x, 4, '水平沿用设计稿偏移，别顺手改');
    assert.equal(label._lpos.y, 21.5, '两行态：文案在上半位');
    assert.ok(costLabel._lpos.y < 0, '两行态：倒计时胶囊在下半位');

    const src = readFileSync('assets/script/app/main/ChestDetailPanel.ts', 'utf8');
    assert.match(src, /const OPEN_LABEL_X = 4;/);
    assert.match(src, /const OPEN_LABEL_Y_TWO_LINE = 21\.5;/);
    assert.match(src, /const OPEN_LABEL_Y_CENTER = 0;/);
    assert.match(
        src,
        /this\.openLabel\.node\.setPosition\(OPEN_LABEL_X, hasCountdown \? OPEN_LABEL_Y_TWO_LINE : OPEN_LABEL_Y_CENTER\)/,
        '只切胶囊显隐、不把文案放回中线 = 下半截留白（截图那颗「打开」偏上）',
    );
});

test('宝箱详情走 PopupBase：页面不再绑 prefab，组件声明 prefabPath，Widget 已启用', () => {
    const page = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as Obj[];
    const mainPage = page.find((o) => o?.__type__ === '2395fnYYflA25GtoK/UxJXu');
    assert.ok(mainPage, 'ArenaRoot 必须挂 MainPage');
    assert.equal('chestDetailPrefab' in mainPage!, false, '走 PopupBase 后不该再绑 prefab');

    const src = readFileSync('assets/script/app/main/ChestDetailPanel.ts', 'utf8');
    assert.match(src, /extends PopupBase/, '必须是 PopupBase 子类');
    assert.match(src, /static prefabPath = 'ui\/main\/ChestDetailPanel'/, '必须声明 prefabPath');
    assert.equal(/initialize\(width/.test(src), false, '不该再有手写尺寸的 initialize');

    const widgets = objects.filter((o) => o?.__type__ === 'cc.Widget');
    const rootWidget = widgets.find((w) => at(w.node) === root);
    assert.ok(rootWidget, '根节点必须有 Widget');
    assert.equal(rootWidget!._enabled, true, '根节点 Widget 必须启用');
    assert.equal(rootWidget!._alignFlags, 45);
    const dimWidget = widgets.find((w) => at(w.node)?._name === 'Dim');
    assert.equal(dimWidget!._enabled, true, 'Dim Widget 必须启用');
    assert.equal(panelComp!.closeOnBlank, true, '点空白能关');
    assert.equal('panelTransform' in panelComp!, false);
});

function loadClass(file: string, moduleStubs: Record<string, unknown>): new () => Record<string, any> {
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
        if (moduleStubs[request]) return moduleStubs[request];
        return {
            Component, Button, Node, Sprite, UITransform, SpriteFrame, Label, BlockInputEvents,
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
        };
    } });
    return Object.values(exports)[0];
}

const CHEST_EVENTS = {
    CLOSE: 'chest-detail:close',
    FAST_OPEN: 'chest-detail:fast-open',
    OPEN: 'chest-detail:open',
};
const EVENTS_STUB = { CHEST_EVENTS };
const POPUP_STUB = {
    '../../framework/ui/PopupBase': { PopupBase: class { closeByButton(): void { /* 子类会覆盖 */ } } },
    '../../framework/event/EventMgr': { EventMgr: { instance: { emit: () => undefined } } },
};

function loadPanelClass(emitted: string[] = []): new () => Record<string, any> {
    return loadClass('assets/script/app/main/ChestDetailPanel.ts', {
        './ChestEvents': EVENTS_STUB,
        '../common/RewardItemView': { RewardItemView: class {} },
        '../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        ...POPUP_STUB,
        '../../framework/event/EventMgr': { EventMgr: { instance: { emit: (name: string) => emitted.push(name) } } },
        './ChestTypes': { formatChestCountdown: (seconds: number) => {
            const total = Math.max(0, Math.floor(seconds));
            const pad = (v: number) => String(v).padStart(2, '0');
            return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        } },
    });
}

test('弹窗组件：全量赋值、三颗按钮派发意图事件、倒计时走轻量入口且到点才可点', () => {
    const emitted: string[] = [];
    const PanelClass = loadPanelClass(emitted);
    const panel = new PanelClass();
    let closedByButton = 0;
    const positions: number[][] = [];
    const node = () => ({
        active: true, children: [], parent: null,
        setPosition(x: number, y: number) { positions.push([x, y]); },
        setScale() {}, setSiblingIndex() {}, addComponent() {},
        getComponent: () => ({ setContentSize() {} }),
        on: () => undefined,
    });
    const label = () => ({ string: '', node: node() });
    panel.node = node();
    for (const key of ['nameLabel', 'qualityLabel', 'countLabel', 'fastLabel', 'fastCostLabel', 'openLabel', 'openCostLabel']) {
        panel[key] = label();
    }
    panel.qualityFrame = { spriteFrame: null };
    const fallbackIcon = { id: 'default-chest' };
    panel.chestIcon = { spriteFrame: fallbackIcon };
    for (const key of ['fastCostRoot', 'openCostRoot']) panel[key] = node();
    panel.fastCostIcon = { spriteFrame: null };
    for (const key of ['fastButton', 'openButton', 'closeButton']) panel[key] = { node: node(), interactable: true };
    panel.closeByButton = () => { closedByButton += 1; };
    const counts: number[] = [];
    panel.dropList = {
        renderItemFn: null as null | ((item: unknown, index: number) => void),
        setTotalCount(count: number) { counts.push(count); },
    };

    panel.onInit();
    panel.applyContent({
        name: '青铜宝箱',
        qualityText: '品质：普通',
        countText: '数量：1',
        icon: { id: 'box' },
        qualityFrame: { id: 'frame' },
        rewards: [
            { frame: {}, icon: {}, amount: 2, rate: 70 },
            { frame: {}, icon: {}, amount: 2, rate: 25 },
        ],
        fastOpenCost: 10,
        fastOpenEnabled: true,
        openCaption: '打开',
        openCountdown: '01:35:25',
        openEnabled: false,
        costIcon: null,
    });
    assert.equal(panel.nameLabel.string, '青铜宝箱');
    assert.equal(panel.qualityLabel.string, '品质：普通');
    assert.equal(panel.countLabel.string, '数量：1');
    assert.equal(panel.chestIcon.spriteFrame.id, 'box');
    assert.deepEqual(counts, [2], '条数 = 奖励数量（不再固定 5 格）');
    assert.equal(panel.fastCostLabel.string, '10');
    assert.equal(panel.openCostLabel.string, '01:35:25');
    assert.equal(panel.openButton.interactable, false, '倒计时中不能点「打开」');
    assert.deepEqual(positions[positions.length - 1], [4, 21.5], '带倒计时：文案留在两行态的上半位');

    panel.applyContent({ name: '宝箱', qualityText: '', countText: '', icon: null, qualityFrame: null,
        rewards: [], fastOpenCost: 0, fastOpenEnabled: true, openCaption: '打开', openCountdown: '',
        openEnabled: true, costIcon: null });
    assert.equal(panel.chestIcon.spriteFrame, fallbackIcon, '缺少配置图时还原预制体宝箱图');
    assert.deepEqual(positions[positions.length - 1], [4, 0], '无倒计时：胶囊隐藏后「打开」必须回到按钮正中');
    // 禁用的「打开」：Cocos 的 Button 在 interactable=false 时不派发 CLICK，回调不会进来
    // （拦截在 Button 组件层，回调内不再判 interactable）——沙箱模拟该层，禁用时跳过回调调用。
    panel.openButton.interactable = false;

    panel.handleFastOpen();
    panel.handleClose();
    assert.deepEqual(emitted, ['chest-detail:fast-open'], '「立即打开」派发事件');
    assert.equal(closedByButton, 1, '「×」走 PopupBase.closeByButton');

    panel.updateCountdown(0);
    assert.equal(panel.openCostRoot.active, false);
    assert.equal(panel.openButton.interactable, true);
    assert.deepEqual(positions[positions.length - 1], [4, 0], '每秒刷新是幂等全量赋值，不累加偏移');
    panel.updateCountdown(3600, false);
    assert.equal(panel.openCostLabel.string, '01:00:00');
    assert.equal(panel.openButton.interactable, true, '未激活时展示所需时长但仍可启动');
    assert.deepEqual(positions[positions.length - 1], [4, 21.5], '倒计时重新出现时回到两行态');
    panel.updateCountdown(3599, true);
    assert.equal(panel.openCostLabel.string, '00:59:59');
    assert.equal(panel.openButton.interactable, false, '计时中不能提前打开');
    panel.updateCountdown(0);
    panel.handleOpen();
    assert.deepEqual(emitted, ['chest-detail:fast-open', 'chest-detail:open'], '「打开」派发事件（emitted 为累积记录）');
});
