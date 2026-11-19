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
    // `Tile_N` 的 N = 「第几块要翻的地」⇒ 候选池是同一份，但会把第 N 个排到最前
    // （顺序即语义，调用方取第一个可见格；不加这一步 3-1/4-1 会永远指向同一格）。
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', state), state.randomResourceOpenableCells);
    assert.deepEqual(guideMapFocusCells('Map/Tile_2', state), [...state.randomResourceOpenableCells].reverse());
    assert.deepEqual(guideMapFocusCells('Map/Tile_3', state), [...state.randomResourceOpenableCells].reverse());
    assert.equal(guideMapFocusCells('Map/TileNew_1', state), state.randomResourceOpenableCells);
    // 没有候选就从空集，别退化成「随便指一个」。
    const empty = { ...state, randomResourceOpenableCells: [] };
    for (const key of ['Map/Tile_1', 'Map/Tile_2', 'Map/Tile_3', 'Map/TileNew_1']) {
        assert.deepEqual(guideMapFocusCells(key, empty), []);
    }
});

test('第一章新号没有相邻随机格时，仍能找到可开启的固定资源宝箱', () => {
    const map = read('assets/resources/config/territory-maps/chapter_01.json');
    const first: FocusState = { ...state, map, randomResourceOpenableCells: [],
        siteOpenableCells: [348, 327, 346, 366, 387, 368] };
    // 2026-11-18 地图重导（`chapter_01.json`）后一章开局不止一只可翻的宝箱（多了野怪宝箱
    // `patrolChest`），候选从「只有 348」变成多只 ⇒ 期望值改成按地图数据自己算，别再硬写一只。
    // 钉的是两件事：**只收点了能翻出来的宝箱格**（野怪宝箱第一下也算翻地），
    // 且第一只必须是固定资源宝箱 348 —— 手指先指的永远是它。
    const chests = (map.sites as { readonly cellId: number; readonly type: string }[])
        .filter(site => site.type === 'fixedResource' || site.type === 'patrolChest')
        .filter(site => first.siteOpenableCells.includes(site.cellId))
        .map(site => site.cellId);
    assert.equal(chests[0], 348, '第一只候选必须是固定资源宝箱 348');
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', first), chests);
    assert.deepEqual(guideMapFocusCells('Map/Tile_1', { ...first, siteOpenableCells: [] }), []);
});

test('纯对话和非地图控件不得退化成地图焦点', () => {
    for (const key of ['', 'Main/CardEntry', 'CardDetail/BtnUpgrade', 'Popup/GridReward', 'Map/Tile_99']) {
        assert.deepEqual(guideMapFocusCells(key, state), []);
    }
});

test('关卡入口按真实 levelId 匹配：只认「点得动」的格，且优先「有建筑」的那一格', () => {
    // `stageByCell` 是**扩散后**的表：同一区域的多个站点共享同一个关卡号，
    // 所以光按 levelId 挑会指到「没有建筑的兄弟格」上（用户 2026-11-17 第 17 条：
    // 手指落在空地、关卡建筑在下面一格）。
    const site = (cellId: number, type: string, buildingId?: string) =>
        ({ cellId, type, buildingId, footprint: [] });
    const data = {
        ...state,
        map: {
            sites: [
                site(12, 'stage'),                  // 同区域兄弟格（没建筑）—— 旧口径会指它
                site(18, 'stage', 'building_1_1'),  // 真正的关卡建筑
                site(15, 'fixedResource'),          // 号相同但不是关卡站点，别混进来
                site(20, 'stage'),                  // 同样共享 10001，没解锁但前置满足
            ],
        } as unknown as FocusState['map'],
        stageByCell: new Map([[12, { levelId: 10001 }], [15, { levelId: 10002 }],
            [18, { levelId: 10001 }], [20, { levelId: 10001 }]]) as FocusState['stageByCell'],
        progress: {
            isCellUnlocked: (id: number) => id === 12 || id === 18,
            isDisabled: () => false,
            isPrerequisitePending: () => false,
        } as unknown as FocusState['progress'],
    };
    // 有建筑的排前（就算 cellId 更大），兄弟格留作兜底。
    //
    // 20 没解锁但**没锁标** ⇒ 仍在候选里（用户 2026-11-17 第 21 条）：那一格显示「银币 + 数字」，
    // 点一下就是「花银币解锁 + 直接开战」，正是 5-1 要让玩家做的那一下。
    // 只按 `isCellUnlocked` 筛会漏掉它 ⇒ 光圈不出现、只剩一句台词飘在屏幕底部。
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', data), [18, 12, 20]);
    // 关号只对得上资源点 ⇒ 没有可指的关卡入口。
    assert.deepEqual(guideMapFocusCells('Map/Level_10002', data), []);
    // 🔴 第 24 条：**关卡建筑那一格顶锁标**（前置关卡没打通 / 前置宝箱没点开）⇒ 整步不出引导。
    // 绝不能退到「同区域共享关卡号的兄弟格」上：兄弟格自己能开 ⇒ 光圈画到隔壁空地，
    // 而玩家认的是带 `1-1` 气泡的建筑格（现场：光圈套在左侧价格格上，绿框的建筑格还挂着锁）。
    const buildingLocked = {
        ...data,
        progress: {
            isCellUnlocked: (id: number) => id === 12,
            isDisabled: () => false,
            isPrerequisitePending: (id: number) => id === 18,
        } as unknown as FocusState['progress'],
    };
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', buildingLocked), []);
    // 兄弟格顶锁标不影响：建筑格可解锁 ⇒ 照样给（只是不带那一格）。
    const siblingLocked = {
        ...data,
        progress: {
            isCellUnlocked: () => false,
            isDisabled: () => false,
            isPrerequisitePending: (id: number) => id === 20,
        } as unknown as FocusState['progress'],
    };
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', siblingLocked), [18, 12]);
    // 没有地图 / 没有进度 ⇒ 空集，不退化成「随便指一个」。
    assert.deepEqual(guideMapFocusCells('Map/Level_10001', state), []);
});

test('步骤表补齐关卡入口和卡牌入口，苏醒两步保持无焦点', () => {
    const table = read('assets/remoteRef/guideStep.json');
    const rows = table.v.map((row: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, row[i]])));
    for (const id of ['1-1', '1-2']) assert.equal(rows.find(row => row.stepId === id).focusNode, '');
    assert.equal(rows.find(row => row.stepId === '5-1').focusNode, 'Map/Level_10001');
    assert.equal(rows.find(row => row.stepId === '6-1').focusNode, 'Main/CardEntry');
    assert.equal(rows.find(row => row.stepId === '5-2').completeCond, 'battleEntered');
    assert.equal(rows.find(row => row.stepId === '5-3').focusNode, 'Battle/DrawnCard');
    assert.equal(rows.find(row => row.stepId === '5-3').requireAction, '');
    assert.equal(rows.find(row => row.stepId === '5-3').completeCond, 'cardRevealFinished');
    // 8-1 收尾步：焦点必须是**底栏的任务入口**，不是弹窗内部。
    // 表还指着 `Popup/MainGoal` 那阵子（代码早已改成点入口）⇒ 组合层解析不出焦点 ⇒
    // 底栏被当普通 HUD 收掉，玩家连入口都看不见、光圈手指也没地方挖（用户 2026-11-19）。
    const last = rows.find(row => row.stepId === '8-1');
    assert.equal(last.focusNode, 'Main/TaskEntry', '8-1 要高亮主线任务入口');
    assert.equal(last.completeCond, 'pageOpened:task', '面板一开就算完成（玩家自己点开）');
    assert.equal(last.maskType, 'hole', '挖孔高亮：圈住入口，并让立绘按孔让位');
});

test('光圈与手指画在遮罩之上：孔外的压暗不许盖住高亮和手指', () => {
    // 需求（2026-11-19）：主线任务入口的「圈圈 + 手指」不能被遮罩遮挡。
    // 渲染顺序 = `Canvas` 子节点顺序，所以这条只能在 prefab 上钉死：
    // Dim → 四块 FocusMask → Portrait → FocusRing → FocusHand → MapHint → DialogBox → Blocker。
    const data = read('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab');
    const root = data.find((item: { _name?: string }) => item.__type__ === 'cc.Node' && item._name === 'GuideDialog');
    const order = (root._children as { __id__: number }[]).map(ref => data[ref.__id__]._name as string);
    const at = (name: string) => {
        const index = order.indexOf(name);
        assert.ok(index >= 0, `GuideDialog 缺子节点 ${name}`);
        return index;
    };
    const maskTop = Math.max(...order.filter(name => name.startsWith('FocusMask')).map(at));
    assert.ok(order.some(name => name.startsWith('FocusMask')), '四块遮罩必须还在（孔靠它们挖）');
    assert.ok(at('FocusRing') > maskTop, 'FocusRing 必须排在四块遮罩之后，否则圈被压暗盖住');
    assert.ok(at('FocusHand') > at('FocusRing'), 'FocusHand 必须排在 FocusRing 之后（手指压在圈上）');
    assert.ok(at('Dim') < maskTop, 'Dim 在最底层');
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
