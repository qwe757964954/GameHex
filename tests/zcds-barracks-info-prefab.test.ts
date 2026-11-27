/**
 * 兵营信息面板的结构守卫：手动搭 prefab + JSON 注入字段很容易把某个引用写成节点、
 * 或把行内文字压到图标上。运行时不会报错，只会「看起来不对」，所以这里按
 * `territory-monster-box-prefab-refs.test.ts` 的口径核对类型与关键布局。
 */
import { readFileSync } from 'node:fs';
import * as assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

const PREFAB = 'assets/bundles/battle/ui/game/ZCBarracksInfo.prefab';
const VIEW_TYPE = 'd68ddmz25FHoIlC/YMT8UmH';
const SKILL_ITEM_TYPE = '4274efHzMdCgqWUmebhApR4';

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    _active?: boolean;
    _lpos?: { x?: number; y?: number };
    _contentSize?: { width?: number; height?: number };
    _components?: { __id__: number }[];
    _children?: { __id__: number }[];
    node?: { __id__: number };
    [key: string]: unknown;
}

const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as IPrefabObject[];

function viewComponent(): IPrefabObject {
    const view = objects.find((object) => object.__type__ === VIEW_TYPE && object.node);
    assert.ok(view, '缺少 ZCBarracksInfoView 组件');
    return view;
}

function targetOf(component: IPrefabObject, key: string): IPrefabObject {
    const ref = component[key] as { __id__?: number } | undefined;
    assert.ok(ref && ref.__id__ !== undefined, `${key} 没有绑定`);
    const target = objects[ref.__id__];
    assert.ok(target, `${key} 指向不存在的对象 ${ref.__id__}`);
    return target;
}

function targetList(component: IPrefabObject, key: string): IPrefabObject[] {
    const refs = component[key] as { __id__?: number }[] | undefined;
    assert.ok(Array.isArray(refs) && refs.length > 0, `${key} 没有绑定`);
    return refs.map((ref) => {
        assert.ok(ref.__id__ !== undefined, `${key} 含空引用`);
        const target = objects[ref.__id__];
        assert.ok(target, `${key} 指向不存在的对象 ${ref.__id__}`);
        return target;
    });
}

function uiOf(node: IPrefabObject): IPrefabObject {
    const component = (node._components ?? [])
        .map((ref) => objects[ref.__id__])
        .find((item) => item.__type__ === 'cc.UITransform');
    assert.ok(component, `${node._name} 缺少 UITransform`);
    return component;
}

function childrenNamed(node: IPrefabObject, name: string): IPrefabObject[] {
    return (node._children ?? [])
        .map((ref) => objects[ref.__id__])
        .filter((child) => child?._name === name);
}

function nodeOf(component: IPrefabObject): IPrefabObject {
    const ref = component.node as { __id__?: number } | undefined;
    assert.ok(ref && ref.__id__ !== undefined, '组件没有挂到节点上');
    return objects[ref.__id__];
}

test('面板字段按组件类型绑定，技能格四个 Button 都在', () => {
    const view = viewComponent();
    const portrait = targetOf(view, 'portraitSprite');
    assert.equal(portrait.__type__, 'cc.Sprite', 'portraitSprite 必须绑定 Sprite');
    // 立绘是 256×256 卡面图，CUSTOM 128×128 下若开 trim，会按「裁剪区」拉伸：
    // 豌豆游侠裁剪区 170×236 被拉成 128×128，角色变胖变矮（2026-11-26 截图）。必须关 trim。
    assert.equal(portrait._isTrimmedMode, false, 'portraitSprite 不能开启 trim，否则非方形卡面会被拉变形');
    assert.equal(targetOf(view, 'nameLabel').__type__, 'cc.Label', 'nameLabel 必须绑定 Label');
    assert.equal(targetList(view, 'statValues').length, 6);
    assert.equal(targetList(view, 'statGains').length, 6);
    const skillItems = targetList(view, 'skillItems');
    assert.equal(skillItems.length, 4);
    for (const value of targetList(view, 'statValues')) assert.equal(value.__type__, 'cc.Label');
    for (const gain of targetList(view, 'statGains')) assert.equal(gain.__type__, 'cc.Label');
    assert.equal(targetOf(view, 'tipNode').__type__, 'cc.Node', 'tipNode 必须绑定 Node');
    assert.equal(targetOf(view, 'tipTitle').__type__, 'cc.Label');
    assert.equal(targetOf(view, 'tipDesc').__type__, 'cc.Label');
    for (const item of skillItems) {
        assert.equal(item.__type__, SKILL_ITEM_TYPE, 'skillItems 必须绑定 ZCBarracksSkillItemView');
        assert.equal(targetOf(item, 'goldSprite').__type__, 'cc.Sprite');
        assert.equal(targetOf(item, 'emptyNode').__type__, 'cc.Node');
        assert.equal(targetOf(item, 'nameLabel').__type__, 'cc.Label');
        assert.equal(targetOf(item, 'lockNode').__type__, 'cc.Node');
        assert.equal(targetOf(item, 'passiveNode').__type__, 'cc.Node');
        const skill = nodeOf(item);
        const buttons = (skill._components ?? []).map((ref) => objects[ref.__id__]).filter((comp) => comp.__type__ === 'cc.Button');
        assert.equal(buttons.length, 1, `${skill._name} 必须且只能挂一个 cc.Button`);
    }
});

test('面板尺寸与设计稿一致，技能行与气泡不互相压住', () => {
    const root = objects.find((object) => object.__type__ === 'cc.Node' && object._name === 'ZCBarracksInfo');
    assert.ok(root, '缺少面板根节点');
    const rootUi = uiOf(root!);
    assert.equal(rootUi._contentSize?.width, 664);
    assert.equal(rootUi._contentSize?.height, 256);

    const skills = (root!._children ?? []).map((ref) => objects[ref.__id__]).find((child) => child?._name === 'Skills');
    assert.ok(skills, '缺少 Skills 行');
    const skillCells = (skills!._children ?? []).map((ref) => objects[ref.__id__]);
    assert.equal(skillCells.length, 4);
    for (const cell of skillCells) {
        const name = childrenNamed(cell, 'Name')[0];
        assert.ok(name, `${cell._name} 缺少 Name 节点`);
        assert.equal(name!._active, false, '设计稿技能格只有图标，技能名不能叠在格子里');
        const lock = childrenNamed(cell, 'Lock')[0];
        assert.ok(lock, `${cell._name} 缺少 Lock 节点`);
        assert.equal(lock!._lpos?.x, 0, '锁定图标必须压在六边形横向中心');
        assert.equal(lock!._lpos?.y, 0, '锁定图标必须压在六边形纵向中心');
    }

    const tip = (root!._children ?? []).map((ref) => objects[ref.__id__]).find((child) => child?._name === 'Tip');
    assert.ok(tip, '缺少 Tip 气泡');
    const tipY = tip!._lpos?.y ?? 0;
    const skillBottom = (skillCells[0]._lpos?.y ?? 0) - (uiOf(skillCells[0])._contentSize?.height ?? 0) / 2;
    assert.ok(tipY <= -160, `气泡 y=${tipY} 仍在技能行里（技能底 ${skillBottom}）`);

    // 六行：文字起点必须在红心图标右侧，数值与绿色增量也不重叠。
    const stats = (root!._children ?? []).map((ref) => objects[ref.__id__]).find((child) => child?._name === 'Stats');
    assert.ok(stats, '缺少 Stats 容器');
    const rows = (stats!._children ?? []).map((ref) => objects[ref.__id__]);
    assert.equal(rows.length, 6);
    for (const row of rows) {
        const icon = childrenNamed(row, 'Icon')[0];
        const label = childrenNamed(row, 'Label')[0];
        const value = childrenNamed(row, 'Value')[0];
        const gain = childrenNamed(row, 'Gain')[0];
        assert.ok(icon && label && value && gain, `${row._name} 行结构不完整`);
        const iconRight = (icon!._lpos?.x ?? 0) + (uiOf(icon!)._contentSize?.width ?? 0) / 2;
        const labelLeft = (label!._lpos?.x ?? 0) - (uiOf(label!)._contentSize?.width ?? 0) / 2;
        const valueRight = (value!._lpos?.x ?? 0) + (uiOf(value!)._contentSize?.width ?? 0) / 2;
        const gainLeft = (gain!._lpos?.x ?? 0) - (uiOf(gain!)._contentSize?.width ?? 0) / 2;
        assert.ok(labelLeft > iconRight, `${row._name} 的文案压住了红心图标`);
        assert.ok(gainLeft >= valueRight, `${row._name} 的绿色增量与数值重叠`);
        // 五位数以上的血量（满级 14491 / 服务端倍率放大后 7 位）不能折行：42px 宽 + CLAMP + wrap
        // 会把 "5915044" 拆成 "5915"/"044" 两行（2026-11-26 线上截图），这里锁住不换行的配置。
        const valueLabel = (value!._components ?? [])
            .map((ref) => objects[ref.__id__])
            .find((item) => item.__type__ === 'cc.Label');
        assert.ok(valueLabel, `${row._name} 的 Value 缺少 Label`);
        assert.equal(valueLabel!._enableWrapText, false, `${row._name} 的数值不能换行`);
        assert.notEqual(valueLabel!._overflow, 1, `${row._name} 的数值不能用 CLAMP（超宽会被截断）`);
    }
});

test('面板根与外溢 Tip 气泡均在 Prefab 挂好 BlockInputEvents，代码不动态补挂', () => {
    const root = objects.find((object) => object.__type__ === 'cc.Node' && object._name === 'ZCBarracksInfo');
    assert.ok(root, '缺少面板根节点');
    const tip = (root!._children ?? []).map((ref) => objects[ref.__id__]).find((child) => child?._name === 'Tip');
    assert.ok(tip, '缺少 Tip 气泡');
    for (const node of [root!, tip!]) {
        const blockers = (node._components ?? [])
            .map((ref) => objects[ref.__id__])
            .filter((item) => item?.__type__ === 'cc.BlockInputEvents');
        assert.equal(blockers.length, 1, `${node._name} 必须在 prefab 挂且只挂一个 cc.BlockInputEvents`);
        assert.equal(blockers[0]._enabled, true, `${node._name} 的 BlockInputEvents 必须启用`);
    }
    const viewSource = readFileSync('assets/script/app/zcds/view/ZCBarracksInfoView.ts', 'utf8');
    const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    assert.doesNotMatch(viewSource, /addComponent\(\s*BlockInputEvents\s*\)/);
    assert.doesNotMatch(gameSource, /addComponent\(\s*BlockInputEvents\s*\)/);
});

test('技能格由 ZCBarracksSkillItemView 独立渲染，onLoad 绑定 CLICK 后显隐不丢监听', () => {
    const { load, FakeNode, cc } = loadViews();
    const { ZCBarracksSkillItemView } = load('./ZCBarracksSkillItemView');
    const { ZCBarracksInfoView } = load('./ZCBarracksInfoView');

    const root = new FakeNode('ZCBarracksInfo');
    const view = new ZCBarracksInfoView();
    view.node = root;
    view.portraitSprite = { spriteFrame: null };
    view.nameLabel = { string: '' };
    view.statValues = Array.from({ length: 6 }, () => ({ string: '' }));
    view.statGains = Array.from({ length: 6 }, () => ({ string: '', node: new FakeNode() }));
    view.tipNode = new FakeNode('Tip');
    view.tipTitle = { string: '' };
    view.tipDesc = { string: '' };

    const clickListeners: Array<Array<() => void>> = [];
    view.skillItems = Array.from({ length: 4 }, (_, index) => {
        const listeners: Array<() => void> = [];
        clickListeners.push(listeners);
        const itemNode = new FakeNode(`Skill${index}`);
        itemNode.on = (type: string, cb: () => void) => {
            if (type === cc.Button.EventType.CLICK) listeners.push(cb);
        };
        const item = new ZCBarracksSkillItemView();
        item.node = itemNode;
        item.goldSprite = { enabled: false };
        item.emptyNode = new FakeNode('Empty');
        item.nameLabel = { node: new FakeNode('Name') };
        item.lockNode = new FakeNode('Lock');
        item.passiveNode = new FakeNode('Passive');
        return item;
    });

    view.onLoad();
    view.show({
        cardId: '68029',
        name: '金发老板',
        stats: [],
        skills: [
            { name: '菌甲厚化', description: '提升生命', passive: true, unlocked: true, unlockLevel: 1, empty: false },
            { name: '狂暴冲击', description: '待解锁', passive: false, unlocked: false, unlockLevel: 3, empty: false },
            { name: '', description: '', passive: false, unlocked: false, unlockLevel: 0, empty: true },
        ],
    }, null);

    assert.equal(view.skillItems[0].goldSprite.enabled, true);
    assert.equal(view.skillItems[0].emptyNode.active, false);
    assert.equal(view.skillItems[0].nameLabel.node.active, false);
    assert.equal(view.skillItems[0].lockNode.active, false);
    assert.equal(view.skillItems[0].passiveNode.active, true);

    assert.equal(view.skillItems[1].goldSprite.enabled, false);
    assert.equal(view.skillItems[1].emptyNode.active, true);
    assert.equal(view.skillItems[1].lockNode.active, true);
    assert.equal(view.skillItems[1].passiveNode.active, false);

    assert.equal(view.skillItems[2].goldSprite.enabled, false);
    assert.equal(view.skillItems[2].lockNode.active, false);
    assert.equal(view.skillItems[3].emptyNode.active, true);

    assert.equal(clickListeners[0].length, 1);
    clickListeners[0][0]();
    assert.equal(view.tipNode.active, true);
    assert.equal(view.tipTitle.string, '菌甲厚化');
    assert.equal(view.tipDesc.string, '提升生命');

    const secondData = {
        cardId: '68029',
        name: '金发老板',
        stats: [],
        skills: [
            { name: '菌甲厚化', description: '提升生命', passive: true, unlocked: true, unlockLevel: 1, empty: false },
            { name: '狂暴冲击', description: '待解锁', passive: false, unlocked: false, unlockLevel: 3, empty: false },
            { name: '', description: '', passive: false, unlocked: false, unlockLevel: 0, empty: true },
        ],
    };
    view.hide();
    assert.equal(view.tipNode.active, false);
    view.show(secondData, null);
    clickListeners[1][0]();
    assert.equal(view.tipTitle.string, '狂暴冲击');
    assert.equal(view.tipDesc.string, '英雄等级 3 级解锁');
});
