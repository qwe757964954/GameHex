import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const mainTabHost = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
const mainPage = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
const chestBar = readFileSync('assets/script/app/main/ChestBar.ts', 'utf8');
const arenaPrefab = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8')) as unknown;

function findNodes(value: unknown, name: string): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.flatMap((item) => findNodes(item, name));
    if (!value || typeof value !== 'object') return [];
    const object = value as Record<string, unknown>;
    const matches = object._name === name ? [object] : [];
    return [...matches, ...Object.values(object).flatMap((item) => findNodes(item, name))];
}

test('主城顶栏玩家信息在 ArenaRoot 中默认显示', () => {
    const nodes = findNodes(arenaPrefab, 'PlayerInfo');
    assert.equal(nodes.length, 1, 'ArenaRoot 需要且只需要一个 PlayerInfo 节点');
    assert.equal(nodes[0]._active, true, '顶部玩家头像、名称与经验条不能被 prefab 默认隐藏');
});

test('挑战与世界页签都保持锁定且不接受切页点击', () => {
    assert.match(mainTabHost, /const isLocked = type === MainTab\.Challenge \|\| type === MainTab\.World/);
    assert.match(mainTabHost, /button\.setEnabled\(!isLocked\)/);
    assert.match(mainTabHost, /button\.bindSelect\(isLocked \? null/);
});

test('宝箱展开时左箭头收起侧栏，且主城接好收起回调', () => {
    assert.match(chestBar, /bindCollapse\(/);
    assert.match(chestBar, /private onPrev\(\): void\s*\{\s*if \(this\.isOpen\)\s*\{\s*this\.onCollapse\?\.\(\);/);
    assert.match(mainPage, /this\.chestBar\.bindCollapse\(\(\) => this\.setChestPanelOpen\(false\)\)/);
});

test('宝箱左箭头使用独立 96×180 点击区域，箭头图案保持原尺寸', () => {
    assert.match(chestBar, /CHEST_COLLAPSE_HIT_AREA_SIZE = \{ width: 96, height: 180 \}/);
    assert.match(chestBar, /new Node\('ChestCollapseHitArea'\)/);
    assert.match(chestBar, /hitArea\.addComponent\(UITransform\)/);
    assert.match(chestBar, /hitArea\.addComponent\(Button\)/);
    assert.match(chestBar, /hitArea\.setPosition\(this\.prevButton\.position\)/);
    assert.match(chestBar, /hitArea\.on\(Node\.EventType\.TOUCH_END, this\.onPrev, this\)/);
});
