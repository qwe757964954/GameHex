import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guideMapFocusCells } from '../assets/script/app/territory/application/TerritoryViewState';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
type FocusState = Parameters<typeof guideMapFocusCells>[1];
const state: FocusState = {
    map: null,
    randomResourceOpenableCells: [5, 8], siteOpenableCells: [12], progress: null,
    stageByCell: new Map(),
};

test('翻地焦点消费模型的可翻集合：不扫描未拥有的锁定格或关卡格', () => {
    for (const key of ['Map/Tile_1', 'Map/Tile_2', 'Map/Tile_3', 'Map/TileNew_1']) {
        assert.equal(guideMapFocusCells(key, state), state.randomResourceOpenableCells);
        assert.deepEqual(guideMapFocusCells(key, { ...state, randomResourceOpenableCells: [] }), []);
    }
});

test('第一章新号没有相邻随机格时，仍能找到可开启的固定资源宝箱', () => {
    const map = read('assets/resources/config/territory-maps/chapter_01.json');
    const first: FocusState = { ...state, map, randomResourceOpenableCells: [],
        siteOpenableCells: [348, 327, 346, 366, 387, 368] };
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', first), [348]);
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', { ...first, siteOpenableCells: [] }), []);
});

test('纯对话和非地图控件不得退化成地图焦点', () => {
    for (const key of ['', 'Main/CardEntry', 'CardDetail/BtnUpgrade', 'Popup/GridReward', 'Map/Tile_99']) {
        assert.deepEqual(guideMapFocusCells(key, state), []);
    }
});

test('关卡入口按真实 levelId 匹配，只选可开启或已解锁的对应入口', () => {
    const data: FocusState = {
        ...state,
        stageByCell: new Map([[12, { levelId: 10001 }], [15, { levelId: 10002 }],
            [18, { levelId: 10001 }], [20, { levelId: 10001 }]]) as FocusState['stageByCell'],
        progress: { isCellUnlocked: (id: number) => id === 18 } as FocusState['progress'],
    };
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', data), [12, 18]);
    assert.deepEqual(guideMapFocusCells('Map/Level_10002', data), []);
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', state), []);
});

test('步骤表补齐关卡入口和卡牌入口，苏醒三步保持无焦点', () => {
    const table = read('assets/remoteRef/guideStep.json');
    const rows = table.v.map((row: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, row[i]])));
    for (const id of ['1-1', '1-2', '1-3']) assert.equal(rows.find(row => row.stepId === id).focusNode, '');
    assert.equal(rows.find(row => row.stepId === '5-1').focusNode, 'Map/Level_10001');
    assert.equal(rows.find(row => row.stepId === '6-1').focusNode, 'Main/CardEntry');
    assert.equal(rows.find(row => row.stepId === '5-2').completeCond, 'battleEntered');
    assert.equal(rows.find(row => row.stepId === '5-3').focusNode, 'Battle/DrawnCard');
    assert.equal(rows.find(row => row.stepId === '5-3').requireAction, '');
    assert.equal(rows.find(row => row.stepId === '5-3').completeCond, 'cardRevealFinished');
});

test('遮罩孔四边预挂 Sprite 和消费输入的 Button，引用完整且没有 Widget 覆盖坐标', () => {
    const data = read('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab');
    const view = data.find(item => item.dialogBox);
    assert.equal(view.focusMasks.length, 4);
    for (const ref of view.focusMasks) {
        const node = data[ref.__id__];
        const components = node._components.map(ref => data[ref.__id__]);
        assert.ok(components.some(component => component.__type__ === 'cc.Sprite'));
        assert.ok(components.some(component => component.__type__ === 'cc.UITransform'));
        assert.ok(!components.some(component => component.__type__ === 'cc.Widget'));
        const button = components.find(component => component.__type__ === 'cc.Button');
        assert.equal(button._transition, 0);
        assert.equal(button._target, null);
        assert.equal(node._layer, 33554432);
    }
    assert.equal(data[view.focusHintText.__id__].__type__, 'cc.Label');
});

test('弹窗焦点绑定各自的实际面板或按钮，不使用节点路径猜测', () => {
    for (const [path, key, name] of [
        ['assets/bundles/main-pages/ui/ShowReward/ShowReward.prefab', 'Popup/GridReward', 'PanelBg'],
        ['assets/resources/ui/MainTask/MainTaskDetail.prefab', 'Popup/MainGoal', 'CloseBtn'],
        ['assets/bundles/main-pages/ui/card/CardUpgrade.prefab', 'CardDetail/BtnUpgrade', 'BtnUpgrade'],
        ['assets/bundles/battle/ui/game/ZCSettlement.prefab', 'BattleResult/BtnOk', 'BtnConfirm'],
    ]) {
        const data = read(path);
        const anchor = data.find(item => item.key === key);
        assert.ok(anchor, path);
        assert.equal(data[anchor.node.__id__]._name, name);
    }
});
