/**
 * 巡逻宝箱面板的结构守卫：Inspector 里按组件类型绑定的字段，序列化后必须仍指向**组件**，
 * 不能指向同名节点。
 *
 * 背景（2026-11-24）：面板重排后 `battleButton / battleLabel / costIcon / rateLabel / failLabel`
 * 以及守护格 `icon` 被写成节点引用，运行期打开面板直接抛
 * `Cannot read properties of undefined (reading 'position')` / `Cannot set properties of undefined`。
 * 这类错误静态类型和普通渲染用例都看不出来，只能在 prefab 里核对 `__type__`。
 */
import { readFileSync } from 'node:fs';
import * as assert from 'node:assert/strict';
import test from 'node:test';

const PREFAB = 'assets/resources/ui/territory/TerritoryMonsterBoxPanel.prefab';
const PANEL_TYPE = 'c4e8aH3K5NNbo9Rmnw7Dl0k';
const SLOT_TYPE = '50e89CmHRZIW6RyeMsSWaq5';

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    node?: { __id__: number };
    _components?: { __id__: number }[];
    [key: string]: unknown;
}

const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as IPrefabObject[];

function componentsOf(type: string): IPrefabObject[] {
    return objects.filter((object) => object && object.__type__ === type && object.node);
}

function targetOf(component: IPrefabObject, key: string): IPrefabObject {
    const ref = component[key] as { __id__?: number } | undefined;
    assert.ok(ref && ref.__id__ !== undefined, `${key} 没有绑定`);
    const target = objects[ref.__id__];
    assert.ok(target, `${key} 指向不存在的对象 ${ref.__id__}`);
    return target;
}

test('面板字段按组件类型绑定：Button / Label / Sprite 不能退化成 Node', () => {
    const expected: Record<string, string> = {
        battleButton: 'cc.Button',
        battleLabel: 'cc.Label',
        upgradeButton: 'cc.Button',
        upgradeLabel: 'cc.Label',
        costIcon: 'cc.Sprite',
        costLabel: 'cc.Label',
        rateLabel: 'cc.Label',
        failLabel: 'cc.Label',
        closeButton: 'cc.Button',
        titleLabel: 'cc.Label',
        levelLabel: 'cc.Label',
        progressLabel: 'cc.Label',
        progressBar: 'cc.Sprite',
        chestSprite: 'cc.Sprite',
    };
    for (const panel of componentsOf(PANEL_TYPE)) {
        for (const [key, type] of Object.entries(expected)) {
            assert.equal(targetOf(panel, key).__type__, type, `${key} 必须绑定 ${type}`);
        }
    }
});

test('守护格字段按组件类型绑定：icon 是 Sprite，卡底/锁底是 Node，文案是 Label', () => {
    const slots = componentsOf(SLOT_TYPE);
    assert.equal(slots.length, 3, '面板应有 3 个守护格');
    for (const slot of slots) {
        assert.equal(targetOf(slot, 'icon').__type__, 'cc.Sprite', 'icon 必须绑定 Sprite');
        assert.equal(targetOf(slot, 'cardBg').__type__, 'cc.Node', 'cardBg 必须绑定节点');
        assert.equal(targetOf(slot, 'lockBg').__type__, 'cc.Node', 'lockBg 必须绑定节点');
        assert.equal(targetOf(slot, 'lock').__type__, 'cc.Node', 'lock 必须绑定节点');
        assert.equal(targetOf(slot, 'unlockLabel').__type__, 'cc.Label', 'unlockLabel 必须绑定 Label');
        assert.equal(targetOf(slot, 'countLabel').__type__, 'cc.Label', 'countLabel 必须绑定 Label');
    }
});

test('奖励列表按顶部锚点定位：RewardRow 的 y 必须落在奖励框内，不能压住失败次数与按钮', () => {
    const row = objects.find((object) => object.__type__ === 'cc.Node' && object._name === 'RewardRow');
    assert.ok(row, '缺少 RewardRow');
    const transform = (row!._components || [])
        .map((ref) => objects[ref.__id__])
        .find((component) => component.__type__ === 'cc.UITransform');
    assert.equal(transform?._anchorPoint && (transform._anchorPoint as { y?: number }).y, 1,
        'RewardRow 是顶部锚点，position.y 表示列表上边缘');
    assert.equal((row!._lpos as { y?: number }).y, -119.5,
        '顶部锚点 -119.5 ⇒ 列表中心 -195，和奖励框同中心');
});
