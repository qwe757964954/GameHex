import { isMainTabLocked, mainTabTarget, MainTab } from '../assets/script/app/main/MainTabModel';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assetPath } from './helpers/asset-paths';

const mainTabHost = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
const mainPage = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
const chestBar = readFileSync('assets/script/app/main/ChestBar.ts', 'utf8');
const arenaPrefab = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as unknown;

function findNodes(value: unknown, name: string): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.flatMap((item) => findNodes(item, name));
    if (!value || typeof value !== 'object') return [];
    const object = value as Record<string, unknown>;
    const matches = object._name === name ? [object] : [];
    return [...matches, ...Object.values(object).flatMap((item) => findNodes(item, name))];
}

test('主城顶栏玩家信息在 ArenaRoot 中默认显示', () => {
    const nodes = findNodes(arenaPrefab, 'PlayerCard');
    assert.equal(nodes.length, 1, 'ArenaRoot 需要且只需要一个 PlayerInfo 节点');
    assert.equal(nodes[0]._active, true, '顶部玩家头像、名称与经验条不能被 prefab 默认隐藏');
});

test("挑战页签保持锁定；世界页签解锁并改为大地图（大世界）入口", () => {
    for (const tab of [MainTab.Shop, MainTab.Hero, MainTab.Role, MainTab.Territory, MainTab.Alliance, MainTab.World]) assert.equal(isMainTabLocked(tab), false);
    assert.equal(isMainTabLocked(MainTab.Challenge), true);
    assert.deepEqual(mainTabTarget(MainTab.Challenge), { kind: 'locked' });
    assert.deepEqual(mainTabTarget(MainTab.World), { kind: 'overlay' });
    assert.match(mainTabHost, /button\.setEnabled\(!isMainTabLocked\(type\)\)/);
    assert.match(mainTabHost, /EventMgr\.instance\.emit\(MainTabEvent\.Select/);
    const controller = readFileSync('assets/script/app/main/MainTabController.ts', 'utf8');
    assert.match(controller, /mainTabTarget/);
    assert.match(controller, /openWorld/);
    assert.equal(existsSync('assets/script/app/bigmap/view/BigMapEntryButton.ts'), false);
});

test('宝箱展开时左箭头收起侧栏（意图走事件，主城只订阅一次）', () => {
    // 视图不再持有页面回调：收起 / 翻页都是 `EventMgr` 事件
    assert.match(chestBar, /CHEST_EVENTS\.COLLAPSE/);
    assert.match(chestBar, /private onPrev\(\): void\s*\{\s*if \(this\.isOpen\)\s*\{\s*EventMgr\.instance\.emit\(CHEST_EVENTS\.COLLAPSE\)/);
    assert.equal(/onCollapse\?\.\(\)/.test(chestBar), false, '不该再有 onCollapse 回调字段');
    assert.match(mainPage, /EventMgr\.instance\.on\(CHEST_EVENTS\.COLLAPSE/);
});

test('宝箱左箭头使用独立 96×180 点击区域，箭头图案保持原尺寸', () => {
    assert.match(chestBar, /CHEST_COLLAPSE_HIT_AREA_SIZE = \{ width: 96, height: 180 \}/);
    assert.match(chestBar, /new Node\('ChestCollapseHitArea'\)/);
    assert.match(chestBar, /hitArea\.addComponent\(UITransform\)/);
    assert.match(chestBar, /hitArea\.addComponent\(Button\)/);
    assert.match(chestBar, /hitArea\.setPosition\(this\.prevButton\.position\)/);
    assert.match(chestBar, /hitArea\.on\(Node\.EventType\.TOUCH_END, this\.onPrev, this\)/);
});
