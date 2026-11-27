/**
 * 装备分解弹窗（蓝湖效果稿 `0dbb5bbb`）布局守卫。
 *
 * 钉住：
 * - 670×923 面板、木质标题牌 425×122、关闭 92×91；
 * - 「分解获得」奖励板 563×136、5 列 102 格网格、558×424 视口；
 * - 两条 273×65 筛选条、273 宽下拉列表、218×90 分解按钮；
 * - 脚本引用（面板、筛选、网格、模板、按钮）全部绑定，避免「预制体在、界面死」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assetPath } from './helpers/asset-paths';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import * as decomposeTable from '../assets/script/app/role/EquipDecomposeTable';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

type Obj = Record<string, any>;

const PREFAB = assetPath('ui/Role/EquipDecomposePopup.prefab');
const load = (): Obj[] => JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const res = (arr: Obj[], value: any): Obj | null =>
    value && typeof value === 'object' && '__id__' in value ? arr[value.__id__] ?? null : (value ?? null);

function findNode(arr: Obj[], root: Obj, name: string): Obj | null {
    if (root._name === name) return root;
    for (const child of root._children ?? []) {
        const node = res(arr, child);
        const hit = node ? findNode(arr, node, name) : null;
        if (hit) return hit;
    }
    return null;
}

const componentOf = (arr: Obj[], node: Obj, type: string): Obj | null =>
    (node._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component?.__type__ === type) ?? null;

const transformOf = (arr: Obj[], node: Obj): Obj => {
    const transform = componentOf(arr, node, 'cc.UITransform');
    assert.ok(transform, `${node._name} 缺 UITransform`);
    return transform!;
};

const rectOf = (arr: Obj[], node: Obj) => {
    const transform = transformOf(arr, node);
    return {
        x: node._lpos.x as number,
        y: node._lpos.y as number,
        w: transform._contentSize.width as number,
        h: transform._contentSize.height as number,
    };
};

test('★ 装备分解弹窗：面板 / 标题 / 奖励 / 网格 / 筛选 / 按钮几何与效果稿一致', () => {
    const arr = load();
    const root = res(arr, arr[0].data);
    assert.ok(root, 'EquipDecomposePopup.prefab 根节点缺失');
    assert.equal(findNode(arr, root!, 'EquipDecomposePopup')?._name, 'EquipDecomposePopup');

    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'Panel')!), { x: 0, y: 11, w: 670, h: 923 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'Title')!), { x: 0.5, y: 472.5, w: 425, h: 122 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'Close')!), { x: 299, y: 448, w: 92, h: 91 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'RewardPlate')!), { x: 2.5, y: 284.5, w: 563, h: 136 });

    const viewport = findNode(arr, root!, 'ScrollView')!;
    assert.deepEqual(rectOf(arr, viewport), { x: 0.5, y: 212.5, w: 558, h: 424 });
    assert.equal(transformOf(arr, viewport)._anchorPoint.y, 1);
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'ItemTemplate')!), { x: 0, y: 0, w: 102, h: 102 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'FilterRowTemplate')!), { x: 0, y: 0, w: 273, h: 44 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'RewardTemplate')!), { x: 0, y: 0, w: 100, h: 100 });

    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'RankFilter')!), { x: -146.5, y: -255, w: 273, h: 65 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'QualityFilter')!), { x: 146.5, y: -255, w: 273, h: 65 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'RankList')!), { x: -146.5, y: -222.5, w: 273, h: 280 });
    assert.deepEqual(rectOf(arr, findNode(arr, root!, 'BtnConfirm')!), { x: 0, y: -357.5, w: 218, h: 90 });

    const listBottom = -222.5;
    const filterTop = -255 + 65 / 2;
    assert.equal(listBottom, filterTop, '下拉列表底边应贴住筛选条顶边');
});

test('★ 装备分解弹窗：脚本引用全部绑定，入口走独立弹窗', () => {
    const arr = load();
    const script = arr.find(entry => entry && entry.grid && entry.btnConfirm);
    assert.ok(script, 'EquipDecomposePopup 组件序列化缺失');
    const root = res(arr, arr[0].data)!;
    const panel = findNode(arr, root, 'Panel');
    assert.ok(panel, '分解面板缺失');
    assert.equal(script.contentNodes.length, 1);
    assert.equal(res(arr, script.contentNodes[0]), panel, '弹窗内容区应绑定分解面板');

    for (const key of [
        'btnClose', 'btnRankFilter', 'rankArrow', 'btnQualityFilter', 'qualityArrow',
        'emptyLabel', 'rewardContent', 'rewardTemplate', 'btnConfirm',
    ]) {
        assert.ok(script[key] && script[key].__id__ >= 0, `${key} 未绑定`);
    }

    for (const [key, name] of Object.entries({
        rankList: 'RankList', qualityList: 'QualityList', filterRowTemplate: 'FilterRowTemplate',
    })) {
        const node = findNode(arr, root, name);
        assert.ok(node, `${name} 节点缺失`);
        assert.equal(res(arr, script[key]), transformOf(arr, node), `${key} 应绑定 ${name} 的 UITransform`);
    }

    for (const [key, name] of Object.entries({ rankFilterLabel: 'RankFilter', qualityFilterLabel: 'QualityFilter' })) {
        const filter = findNode(arr, root, name);
        assert.ok(filter, `${name} 节点缺失`);
        const title = findNode(arr, filter, 'Label');
        assert.ok(title, `${name} 标题节点缺失`);
        const label = componentOf(arr, title, 'cc.Label');
        assert.ok(label, `${name} 标题组件缺失`);
        assert.equal(res(arr, script[key]), label, `${key} 应绑定 ${name} 的标题`);
    }

    const row = findNode(arr, root, 'FilterRowTemplate');
    assert.ok(row, '筛选行模板缺失');
    const rowView = (row._components ?? []).map(ref => res(arr, ref)).find(component => component?.title && component.check);
    const rowTitle = findNode(arr, row, 'Label');
    const check = findNode(arr, row, 'Check');
    assert.ok(rowView && rowTitle && check, '筛选行组件或绑定节点缺失');
    const rowLabel = componentOf(arr, rowTitle, 'cc.Label');
    assert.ok(rowLabel, '筛选行标题组件缺失');
    assert.equal(res(arr, rowView.title), rowLabel);
    assert.equal(res(arr, rowView.check), check);
    assert.ok(componentOf(arr, row, 'cc.Button'), '筛选行按钮缺失');

    const item = findNode(arr, root, 'ItemTemplate');
    assert.ok(item, '装备格模板缺失');
    const itemView = (item._components ?? []).map(ref => res(arr, ref)).find(component => component?.rankLabel);
    assert.ok(itemView, '装备格组件缺失');
    for (const [key, name, type] of [
        ['quality', 'Quality', 'cc.Sprite'],
        ['icon', 'Icon', 'cc.Sprite'],
        ['rankLabel', 'Label', 'cc.Label'],
        ['levelLabel', 'Level', 'cc.Label'],
    ]) {
        const node = findNode(arr, item, name);
        assert.ok(node, `${name} 节点缺失`);
        const component = componentOf(arr, node, type);
        assert.ok(component, `${name} 缺少 ${type}`);
        assert.equal(res(arr, itemView[key]), component, `${key} 绑定错误`);
    }
    const itemCheck = findNode(arr, item, 'Check');
    assert.ok(itemCheck, '装备格勾选节点缺失');
    assert.equal(res(arr, itemView.check), itemCheck);
    assert.ok(componentOf(arr, item, 'cc.Button'), '装备格按钮缺失');

    const viewport = findNode(arr, root, 'ScrollView');
    assert.ok(viewport, '装备网格视口缺失');
    const list = res(arr, script.grid);
    assert.ok(list, '虚拟列表组件缺失');
    const native = componentOf(arr, viewport, 'cc.ScrollView');
    const content = findNode(arr, viewport, 'Content');
    assert.ok(native && content, '原生滚动驱动或容器缺失');
    assert.equal(res(arr, list.node), viewport);
    assert.equal(res(arr, list.nativeScrollView), native);
    assert.equal(res(arr, list.content), content);
    assert.equal(res(arr, native._content), content);
    assert.equal(content._lpos.y, 0);
    assert.equal(res(arr, list.itemNode), item);
    for (const [key, value] of Object.entries({
        useVirtualList: true, itemCreationMode: 0, gridCount: 5, gridSpacing: 12,
        spacing: 10, headerSpacing: 24, footerSpacing: 0,
    })) {
        assert.equal(list[key], value, `${key} 应由虚拟列表配置`);
    }

    for (const [key, value] of Object.entries({
        filterPaddingTop: 8, filterPaddingBottom: 8,
    })) {
        assert.equal(script[key], value, `${key} 应由 Prefab 配置`);
    }

    const page = readFileSync('assets/script/app/role/RolePage.ts', 'utf8');
    assert.match(page, /EquipDecomposePopup\.open\(\{\}\)/, '装备分解入口应打开独立弹窗');
});

function loadDecomposePopup(modules: Record<string, unknown>) {
    const { exports, unresolved } = loadTsModule<{ EquipDecomposePopup: new () => Obj }>(
        'assets/script/app/role/EquipDecomposePopup.ts',
        { modules: {
            cc: ccStub(),
            '/PopupBase': { PopupBase: class { isValid = true; onDestroy() {} } },
            '/EventMgr': { EventMgr: { instance: new EventMgr() } },
            '/FW': {},
            '/RoleRepository': {},
            '/RoleEvents': { RoleEvent },
            '/EquipDecomposeFilterRow': {},
            '/EquipDecomposeItem': {},
            '/VScrollView': {},
            '/EquipDecomposeTable': decomposeTable,
            '/RoleTexts': {},
            '/RoleTable': { bagRankText: () => '' },
            '/RoleArtLoader': {},
            ...modules,
        } },
    );
    assert.deepEqual(unresolved, []);
    return exports.EquipDecomposePopup;
}

test('装备分解弹窗只渲染最新加载，关闭后丢弃结果', async () => {
    const pendingIcons = new Map<string, () => void>();
    const rendered: string[][] = [];
    const context = { cancelled: false };
    let entries: Obj[] = [];
    const Popup = loadDecomposePopup({
        '/RoleRepository': { roleRepository: { decomposeCandidates: () => entries } },
        '/RoleArtLoader': {
            loadRoleBagIcon: (entry: Obj) => new Promise<null>(resolve => {
                pendingIcons.set(entry.uniqueId, () => resolve(null));
            }),
            loadRoleQualityFrame: async () => null,
        },
    });
    const popup = new Popup();
    popup.popupOpenContext = context;
    popup.syncFilterOptions = () => {};
    popup.renderGrid = (items: Obj[]) => rendered.push(Array.from(items, item => item.uniqueId));
    popup.renderSummary = () => {};

    const refresh = (uniqueId: string): Promise<void> => {
        entries = [{ uniqueId, rank: 1, quality: 1 }];
        return popup.refresh();
    };
    const first = refresh('first');
    const second = refresh('second');
    pendingIcons.get('second')!();
    await second;
    pendingIcons.get('first')!();
    await first;
    assert.deepEqual(rendered, [['second']]);

    const closing = refresh('closing');
    context.cancelled = true;
    popup.onClose();
    pendingIcons.get('closing')!();
    await closing;
    assert.deepEqual(rendered, [['second']]);
});

test('装备格经 EventMgr 只通知所属弹窗，关闭和销毁后解除订阅', async () => {
    const events = new EventMgr();
    const eventModule = { EventMgr: { instance: events } };
    const itemModule = loadTsModule<{ EquipDecomposeItem: new () => Obj }>(
        'assets/script/app/role/EquipDecomposeItem.ts',
        { modules: { cc: ccStub(), '/EventMgr': eventModule, '/RoleEvents': { RoleEvent } } },
    );
    assert.deepEqual(itemModule.unresolved, []);
    const Popup = loadDecomposePopup({ '/EventMgr': eventModule, '/EquipDecomposeItem': itemModule.exports });
    const first = new Popup();
    const second = new Popup();
    const firstItem = new itemModule.exports.EquipDecomposeItem();
    const secondItem = new itemModule.exports.EquipDecomposeItem();
    firstItem.itemId = 'same-id';
    secondItem.itemId = 'same-id';
    firstItem.node = { active: true };
    secondItem.node = { active: true };
    first.itemViews.set(firstItem.node, firstItem);
    second.itemViews.set(secondItem.node, secondItem);
    for (const popup of [first, second]) {
        popup.hideFilterLists = () => {};
        popup.renderControls = () => {};
        popup.refresh = async () => {};
        popup.renderChecks = () => {};
        popup.renderSummary = () => {};
        await popup.onOpen();
    }

    firstItem.onClick();
    assert.deepEqual(Array.from(first.selectedIds), ['same-id']);
    assert.equal(second.selectedIds.size, 0);
    first.onClose();
    firstItem.onClick();
    assert.deepEqual(Array.from(first.selectedIds), ['same-id']);
    secondItem.onClick();
    assert.deepEqual(Array.from(second.selectedIds), ['same-id']);
    second.onDestroy();
    secondItem.onClick();
    assert.deepEqual(Array.from(second.selectedIds), ['same-id']);
});

test('虚拟网格提交条数，复用装备格时按新装备 ID 重绘勾选', () => {
    const Popup = loadDecomposePopup({});
    const popup = new Popup();
    const counts: number[] = [];
    const rendered: Array<[string, boolean]> = [];
    let lookups = 0;
    const node = {
        getComponent() {
            lookups++;
            return { render: (data: Obj, selected: boolean) => rendered.push([data.uniqueId, selected]) };
        },
    };
    popup.grid = {
        node: { active: false },
        nativeScrollView: { stopAutoScroll() {}, scrollToTop() {} },
        setTotalCount: (count: number) => counts.push(count),
    };
    popup.emptyLabel = { active: false };
    popup.bindEvents = () => {};
    popup.onInit();
    popup.selectedIds.add('selected');

    popup.renderGrid([{ uniqueId: 'selected' }, { uniqueId: 'other' }]);
    assert.equal(popup.grid.node.active, true);
    popup.grid.renderItemFn(node, 0);
    popup.grid.renderItemFn(node, 1);
    popup.grid.renderItemFn(node, 0);
    assert.equal(lookups, 1);
    assert.deepEqual(rendered, [['selected', true], ['other', false], ['selected', true]]);

    popup.renderGrid([]);
    assert.deepEqual(counts, [2, 0]);
    assert.equal(popup.grid.node.active, false);
    assert.equal(popup.emptyLabel.active, true);
});
