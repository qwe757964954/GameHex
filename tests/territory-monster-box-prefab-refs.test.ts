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
        chestSprite: 'cc.Sprite',
    };
    for (const panel of componentsOf(PANEL_TYPE)) {
        for (const [key, type] of Object.entries(expected)) {
            assert.equal(targetOf(panel, key).__type__, type, `${key} 必须绑定 ${type}`);
        }
    }
});

test('★旧进度条（2026-11-22 的摇奖方案）已整块从 prefab 移除', () => {
    // 2026-11-24 改版：摇奖改成「空星槽虚影 + 宝箱变白」，进度条那一行不再存在。
    // 留着死节点会让面板字段重新绑到它上面，动画两套并存。
    const names = objects.filter((object) => object.__type__ === 'cc.Node').map((object) => object._name);
    for (const dead of ['UpgradeProgress', 'BarBg', 'Bar', 'Percent', 'RollMarker', 'Arrow']) {
        assert.ok(!names.includes(dead), `prefab 里仍然留着进度条节点 ${dead}`);
    }
    const panel = componentsOf(PANEL_TYPE)[0];
    assert.ok(panel, '缺少面板组件');
    for (const key of ['progressRoot', 'progressBar', 'progressLabel', 'rollMarker']) {
        assert.equal(panel[key], undefined, `面板仍绑定已删除的进度条字段 ${key}`);
    }
});

test('★新动画要用的两个锚点仍在：宝箱本体与等级星容器', () => {
    const names = objects.filter((object) => object.__type__ === 'cc.Node').map((object) => object._name);
    assert.ok(names.includes('ChestModel'), '缺宝箱本体（白色叠层挂在它下面）');
    assert.ok(names.includes('LevelStars'), '缺等级星容器（虚影挂在它下面）');
    const stars = objects.find((object) => object.__type__ === 'cc.Node' && object._name === 'LevelStars');
    const childNames = (stars?._children || []).map((ref) => objects[ref.__id__]?._name);
    for (let index = 1; index <= 4; index += 1) {
        assert.ok(childNames.includes(`StarOn_${index}`) && childNames.includes(`StarOff_${index}`),
            `等级星 ${index} 的亮/暗两态都要在（虚影复用的是这两张图）`);
    }
});

test('守护格字段按组件类型绑定：icon 是 Sprite，卡底是 Node，文案是 Label', () => {
    const slots = componentsOf(SLOT_TYPE);
    assert.equal(slots.length, 3, '面板应有 3 个守护格');
    for (const slot of slots) {
        assert.equal(targetOf(slot, 'icon').__type__, 'cc.Sprite', 'icon 必须绑定 Sprite');
        assert.equal(targetOf(slot, 'cardBg').__type__, 'cc.Node', 'cardBg 必须绑定节点');
        assert.equal(targetOf(slot, 'lock').__type__, 'cc.Node', 'lock 必须绑定节点');
        assert.equal(targetOf(slot, 'unlockLabel').__type__, 'cc.Label', 'unlockLabel 必须绑定 Label');
        assert.equal(targetOf(slot, 'countLabel').__type__, 'cc.Label', 'countLabel 必须绑定 Label');
        // 2026-11-24：锁定态不再换深棕纯色底，`LockBg` 节点与字段都删了
        assert.equal(slot.lockBg, undefined, 'lockBg 字段应已移除（锁定态用米黄底 + 锁 + 提前披露的头像）');
    }
});

test('★未解锁样式：锁标居中压在头像上，解锁文案与「数量」同一行', () => {
    // 用户 2026-11-24：「4 级解锁文案写在 icon 下方（同数量 UI 对齐）；锁 icon 居中显示，
    // 提前披露出具体的怪物样式 icon，不用纯色的底」。
    const slots = componentsOf(SLOT_TYPE);
    assert.ok(slots.length > 0, '缺少守护格组件');
    for (const slot of slots) {
        // `lock` 直接绑 Node；两个文案绑的是 Label 组件，要从组件的 `node` 回到节点
        const lockNode = objects[(slot.lock as { __id__: number }).__id__];
        const unlock = objects[(slot.unlockLabel as { __id__: number }).__id__];
        const count = objects[(slot.countLabel as { __id__: number }).__id__];
        const unlockNode = objects[(unlock.node as { __id__: number }).__id__];
        const countNode = objects[(count.node as { __id__: number }).__id__];
        assert.equal((lockNode._lpos as { y?: number }).y, 0, '锁标必须居中（旧版在 +26 压着头顶）');
        assert.equal((unlockNode._lpos as { y?: number }).y, (countNode._lpos as { y?: number }).y,
            '「N 级解锁」必须与「数量：NN」同 y（两者互斥显示，共用头像下方那一行）');
        const unlockColor = unlock._color as { r: number; g: number; b: number };
        const countColor = count._color as { r: number; g: number; b: number };
        assert.deepEqual(unlockColor, countColor, '解锁文案与数量同色（米黄底上白字看不清）');
    }
    const names = objects.filter((object) => object.__type__ === 'cc.Node').map((object) => object._name);
    assert.ok(!names.includes('LockBg'), '深棕纯色锁底必须已删除');
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
