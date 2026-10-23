import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('locked sites show only the silver icon and amount, and random sites hide the caption after opening', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Component: class {},
                // `paintHexes` 把地皮色写回绝对白（状态不再靠染色）⇒ 桩要提供 `Color.WHITE`。
                Color: { WHITE: { r: 255, g: 255, b: 255, a: 255 } },
            };
            if (id.endsWith('/HexGridLayout')) return { HEX_GRID_IMAGE_SIZE: 128 };
            // 2026-10-15 起 MapView 不再 import `TerritoryMapConfig` 的运行时值
            // （两步式名单连同 `isTerritoryTwoStepCell` 已删除，关卡一律按站点类型判定）
            // ⇒ 这里不需要再给 TerritoryMapConfig 打桩。
            if (id === './TerritoryStationView') return { TerritoryStationView: class {} };
            if (id === './TerritoryResourceGainView') return { TerritoryResourceGainView: class {} };
            // 喷发粒子（2026-10-16 row17）：夹具只关心站点文案，给个空壳即可。
            if (id === './TerritoryGainBurst') return {
                TERRITORY_GAIN_BURST_NODE: 'GainBurst',
                TerritoryGainBurst: class {},
            };
            // 飘字分流常量（银币 7 / 体力 9）与落点间距：夹具只关心站点文案，给空壳即可。
            if (id.endsWith('/TerritoryResourceGain')) return {
                TERRITORY_GAIN_STACK_GAP_PX: 40,
                TERRITORY_GAIN_START_LIFT_PX: 40,
                TERRITORY_SILVER_RES_ID: 7,
                TERRITORY_STAMINA_RES_ID: 9,
            };
            // 翻格表现（与对局共用曲线）：夹具只关心站点文案，给一个空壳即可。
            if (id === './TerritoryHexFlip') return {
                TerritoryHexFlip: class {
                    setEffect() {}
                    step() { return false; }
                    play() { return false; }
                    reset() {}
                    isPlaying() { return false; }
                },
            };
            if (id === './TerritoryTheme') return {
                TERRITORY_COLORS: {
                    gold: 'gold', locked: 'locked', cleared: 'cleared', danger: 'danger', randomConditionText: 'red',
                    randomAvailableText: 'white',
                },
                TERRITORY_STATION_STATE: {
                    owned: 'owned', exploring: 'exploring', available: 'available', locked: 'locked',
                },
                territoryStationTint: () => 'gold',
                territoryBossTint: () => 'danger',
                territoryUnboundTint: () => 'async-brown',
            };
            if (id.endsWith('/TerritoryTexts')) return {
                TERRITORY_TEXTS: {
                    randomResource: '随机资源',
                    openCost: (silver: number, stamina: number) => `${silver}银 ${stamina}体`,
                },
                TERRITORY_UNBOUND_TYPE_NAMES: { fixedResource: '固定资源点' },
            };
            // 事件契约：纯常量表，给桩（与 `view/TerritoryEvents.ts` 同值）。
            if (id === './TerritoryEvents') return {
                TERRITORY_EVENTS: {
                    STATION_CLICK: 'territory:station-click',
                    PREVIOUS_CHAPTER: 'territory:previous-chapter',
                    NEXT_CHAPTER: 'territory:next-chapter',
                    DETAIL_CLOSE: 'territory:detail-close',
                    DETAIL_START: 'territory:detail-start',
                },
            };
            // MapView 按站点类型命名常量判定（2026-10-19 起），需运行时值桩。
            if (id === '../model/TerritoryMapConfig') return {
                TERRITORY_SITE_TYPE: {
                    stage: 'stage', boss: 'boss', asyncPvp: 'asyncPvp',
                    fixedResource: 'fixedResource', bonus: 'bonus',
                },
            };
            // 内容层留白（2026-10-21）：`syncContentSize` 现在把「地图包围盒 + 四周留白」写进
            // 内容层，留白归 `TerritoryMapLayout` 统一算。本用例不校验尺寸，桩只保证宽度高度可用。
            if (id.endsWith('/TerritoryMapLayout')) return {
                territoryMapContentSize: (layout: { width: number; height: number }) => ({
                    width: layout.width,
                    height: layout.height,
                }),
            };
            // 开箱表演 / 点击反馈（2026-10-22）：`TerritoryMapView` 新增的两个表现层，
            // 与本用例关注的渲染分支无关 ⇒ 给空壳（它们的曲线在 `territory-chest-animation`
            // / `territory-tap-feedback` 里单独测）。
            if (id === './TerritoryChestView') return { TerritoryChestView: class {} };
            if (id === './TerritoryTapFeedback') return { TerritoryTapFeedback: class {} };
            // 新地块生成（2026-10-22）：本用例只跑 `syncStations` 的「随机格用哪套图」分支，
            // 进场动画不参与判据 ⇒ 空壳（曲线在 `territory-hex-spawn` 里单独测）。
            if (id === './TerritoryHexSpawn') return {
                TerritoryHexSpawn: class {
                    isPlaying() { return false; }
                    play() { return false; }
                    opacityOf() { return null; }
                    stop() {}
                    reset() {}
                    step() { return false; }
                },
            };
            if (id === '../model/TerritoryHexSpawn') return {
                territoryHexSpawnDelays: () => new Map<number, number>(),
                territoryHexSpawnBatchSeconds: () => 0,
            };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    const MapView = moduleExports.TerritoryMapView as new () => {
        createStation: (target: unknown) => unknown;
        syncStations: (input: unknown) => void;
    };
    const mapView = new MapView();
    const rendered = new Map<number, Record<string, unknown>>();
    mapView.createStation = (target: { cellId: number }) => ({
        setMapPosition() {},
        render(content: Record<string, unknown>) { rendered.set(target.cellId, content); },
    });
    const silverIcon = { name: 'silver icon' };
    const randomBuilding = { name: 'random building' };
    let opened = false;
    mapView.syncStations({
        map: { startCellId: 0, sites: [], defaults: { staminaCost: 5 },
            randomSites: { candidateCells: [4, 5], triggerSilver: 399 } },
        layout: { points: new Map([[4, { x: 10, y: 20 }], [5, { x: 30, y: 40 }]]) },
        randomResourceOpenableCells: [4],
        revealedCells: [4],
        pendingRandomResourceCells: [],
        progress: { isCellUnlocked: () => opened },
        art: { randomSilverIcon: silverIcon, randomResource: randomBuilding },
    });
    assert.equal(rendered.size, 1);
    assert.equal(rendered.get(4)?.icon, null);
    assert.equal(rendered.get(4)?.conditionIcon, silverIcon);
    assert.equal(rendered.get(4)?.isCondition, true);
    assert.equal(rendered.get(4)?.conditionTextColor, 'white');
    assert.equal(rendered.get(4)?.caption, '399');
    assert.equal(rendered.get(4)?.interactive, true);
    mapView.syncStations({
        map: { startCellId: 0, sites: [], defaults: { staminaCost: 5 },
            randomSites: { candidateCells: [4, 5], triggerSilver: 399 } },
        layout: { points: new Map([[4, { x: 10, y: 20 }]]) },
        randomResourceOpenableCells: [4], revealedCells: [4], pendingRandomResourceCells: [4],
        progress: { isCellUnlocked: () => false },
        art: { randomSilverIcon: silverIcon, randomResource: randomBuilding },
    });
    assert.equal(rendered.get(4)?.isLoading, true);
    assert.equal(rendered.get(4)?.caption, '');
    assert.equal(rendered.get(4)?.interactive, false);
    opened = true;
    // ⚠️ 2026-10-10 口径：随机格建筑是**逐格**配的（`randomSites.buildingIds[cellId]`）——
    // 4 号格配了 69006、5 号格**没配** ⇒ 前者显示对应建筑、后者只显示绿色地块（icon = null）。
    // 早期断言的是「开启后一律显示那张固定建筑图」（`art.randomResource`），已作废。
    const perCellBuilding = { name: '69006 building' };
    mapView.syncStations({
        map: { startCellId: 0, sites: [], defaults: { staminaCost: 5 },
            randomSites: { candidateCells: [4, 5], triggerSilver: 399, buildingIds: { 4: '69006' } } },
        layout: { points: new Map([[4, { x: 10, y: 20 }], [5, { x: 30, y: 40 }]]) },
        randomResourceOpenableCells: [], revealedCells: [4, 5], pendingRandomResourceCells: [],
        progress: { isCellUnlocked: (cellId: number) => cellId === 4 },
        // ⚠️ 键必须是**数字**：表里 buildId 是数字、地图 JSON 里是字符串 `"69006"`，
        // 不Number 归一就是查不到 ⇒ 表现为「配了 id 但外观没变」，零报错。
        art: { randomSilverIcon: silverIcon, randomResource: randomBuilding,
            buildFrames: new Map([[69006, perCellBuilding]]) },
    });
    assert.equal(rendered.get(4)?.icon, perCellBuilding,
        '配了 buildingIds 的开启格显示该格自己的建筑（键经Number 归一后查表）');
    assert.equal(rendered.get(4)?.interactive, false);
    // 已开启（奖励已发、没有奖励可领取）：不再显示消耗条件，改用「已通关」绿。
    assert.equal(rendered.get(4)?.isCondition, false);
    assert.equal(rendered.get(4)?.caption, '');
    assert.equal(rendered.get(4)?.tint, 'cleared');
    assert.equal(rendered.get(5)?.conditionIcon, silverIcon);
    assert.equal(rendered.get(5)?.conditionTextColor, 'red');
    assert.equal(rendered.get(5)?.interactive, true);

    // 没配 buildingIds 的开启格 ⇒ **绿色地块、没有建筑图**（山猫 2026-10-10 口径）。
    opened = true;
    mapView.syncStations({
        map: { startCellId: 0, sites: [], defaults: { staminaCost: 5 },
            randomSites: { candidateCells: [4, 5], triggerSilver: 399 } },
        layout: { points: new Map([[4, { x: 10, y: 20 }], [5, { x: 30, y: 40 }]]) },
        randomResourceOpenableCells: [], revealedCells: [4, 5], pendingRandomResourceCells: [],
        // 两格都已开启（要验的是「没配 id 的**开启**格长什么样」）
        progress: { isCellUnlocked: () => true },
        art: { randomSilverIcon: silverIcon, randomResource: randomBuilding, buildFrames: new Map() },
    });
    assert.equal(rendered.get(5)?.icon, null, '没配建筑 id 的开启格不画建筑');
    assert.equal(rendered.get(5)?.tint, 'cleared', '它表现为绿色地块（已通关色调）');

    const fixedSite = { id: 'fixed', type: 'fixedResource', cellId: 1,
        unlock: { silverCost: 10, staminaCost: 1 } };
    const renderFixed = (mapView as unknown as {
        stationRenderOf: (site: unknown, input: unknown) => Record<string, unknown>;
    }).stationRenderOf.bind(mapView);
    const fixedArt = { fixedResource: { name: 'chest' }, randomSilverIcon: silverIcon };
    const locked = renderFixed(fixedSite, {
        stageByCell: new Map(), siteOpenableCells: [1], pendingFixedResourceCells: [], art: fixedArt,
        progress: { isCellUnlocked: () => false, isOwned: () => false },
    });
    assert.equal(locked.icon, null);
    assert.equal(locked.isCondition, true);
    assert.equal(locked.conditionIcon, silverIcon);
    assert.equal(locked.caption, '10');
    const unlocking = renderFixed(fixedSite, {
        stageByCell: new Map(), siteOpenableCells: [1], pendingFixedResourceCells: [1], art: fixedArt,
        progress: { isCellUnlocked: () => false, isOwned: () => false },
    });
    assert.equal(unlocking.interactive, false);
    assert.equal(unlocking.isLoading, true);
    assert.equal(unlocking.caption, '');
    const unlocked = renderFixed(fixedSite, {
        stageByCell: new Map(), siteOpenableCells: [], pendingFixedResourceCells: [], art: fixedArt,
        progress: { isCellUnlocked: () => true, isOwned: () => false },
    });
    assert.equal(unlocked.icon, fixedArt.fixedResource);
    assert.equal(unlocked.interactive, true);
    assert.equal(unlocked.isLoading, false);
    const claiming = renderFixed(fixedSite, {
        stageByCell: new Map(), siteOpenableCells: [], pendingFixedResourceCells: [1], art: fixedArt,
        progress: { isCellUnlocked: () => true, isOwned: () => false },
    });
    assert.equal(claiming.isLoading, true);
    assert.equal(claiming.badge, '');
    assert.equal(claiming.interactive, false);
    // 已解锁未领取：保持「可领取」绿（available）。
    assert.equal(unlocked.tint, 'gold');
    const passed = renderFixed(fixedSite, {
        stageByCell: new Map(), siteOpenableCells: [], pendingFixedResourceCells: [], art: fixedArt,
        progress: { isCellUnlocked: () => true, isOwned: () => true },
    });
    assert.equal(passed.interactive, false);
    // 已领取（已通关）：不再显示解锁消耗条件，改用「已通关」绿。
    assert.equal(passed.isCondition, undefined);
    assert.equal(passed.tint, 'cleared');
    // 🔴 2026-10-12 口径：已领取的宝箱格**彻底清空**（山猫「已经获得宝箱格子，隐藏宝箱」）——
    // icon / caption / badge 三者全空，只剩绿色地块。
    // ⚠️ 不能只清 icon：`TerritoryStationView.render` 里 `hasBuilding = icon !== null`，
    //icon 为 null 会让 captionSprite / captionLabel / badgeLabel 三者 active 全变 true
    //⇒ 反而多出「固定资源点」底条 + 「已领取」角标。守卫见 `territory-two-step-render.test.ts`。
    assert.equal(passed.icon, null, '已领取 ⇒ 宝箱图必须藏掉');
    assert.equal(passed.caption, '', '已领取 ⇒ 名称底条文字也要清空（只清 icon 会让它冒出来）');
    assert.equal(passed.badge, '', '已领取 ⇒ 不再有「已领取」角标');

    // 🔴 前置宝箱未领取 ⇒ 后继格银币数字用**红色**提示（山猫 2026-10-21：
    // 前置格没有通关状态 = 还没 passCell 领取）。服务端 completed 记在 unlockCells
    // （`isPrerequisiteComplete` 固定资源特例的镜像），所以这里**只改视觉、解锁照常可进行**；
    // 前置领取后（owned）数字回白。
    const dependentOnFixed = { id: 'bonus-2', type: 'bonus', cellId: 2, footprint: [2],
        unlock: { requiredCells: [1], silverCost: 20, staminaCost: 1 } };
    const prereqFixedMap = {
        startCellId: 0,
        sites: [{ ...fixedSite, footprint: [1] }],  // 前置宝箱格（真实配置 footprint 恒有）
        defaults: { staminaCost: 5 },
        randomSites: { candidateCells: [], triggerSilver: 0 },
    };
    const renderDependent = (mapView as unknown as {
        stationRenderOf: (site: unknown, input: unknown) => Record<string, unknown>;
    }).stationRenderOf.bind(mapView);
    const prereqInput = {
        map: prereqFixedMap, stageByCell: new Map(), siteOpenableCells: [2],
        pendingFixedResourceCells: [], art: fixedArt,
    };
    const beforeClaim = renderDependent(dependentOnFixed, {
        ...prereqInput,
        progress: { isCellUnlocked: (cell: number) => cell === 1, isOwned: () => false },
    });
    assert.equal(beforeClaim.conditionTextColor, 'red',
        '前置宝箱已解锁未领取 ⇒ 后继格数字红字（前置没有通关状态）');
    assert.equal(beforeClaim.interactive, true, '红字只是视觉提示，解锁照常可点');
    const afterClaim = renderDependent(dependentOnFixed, {
        ...prereqInput,
        progress: { isCellUnlocked: (cell: number) => cell === 1, isOwned: (cell: number) => cell === 1 },
    });
    assert.equal(afterClaim.conditionTextColor, 'white', '前置宝箱已领取 ⇒ 后继格数字回白');

    const asyncSite = { id: 'asyncPvp_372', type: 'asyncPvp', cellId: 372,
        configId: '20001', unlock: { silverCost: 10, staminaCost: 1 } };
    const asyncArt = { asyncPvp: { name: 'async pvp building' } };
    const asyncLocked = renderFixed(asyncSite, {
        stageByCell: new Map(), siteOpenableCells: [], pendingFixedResourceCells: [], art: asyncArt,
        progress: { isCellUnlocked: () => false, isOwned: () => false, isAreaPassed: () => false },
    });
    const asyncUnlocked = renderFixed(asyncSite, {
        stageByCell: new Map([[372, { isBoss: false, stage: 4 }]]),
        siteOpenableCells: [], pendingFixedResourceCells: [], art: asyncArt,
        progress: { isCellUnlocked: () => true, isOwned: () => false, isAreaPassed: () => false },
    });
    assert.equal(asyncLocked.tint, 'locked', '未解锁异步据点沿用现有条件红色');
    assert.equal(asyncUnlocked.tint, 'danger', '已解锁异步据点使用与 Boss 相同的红色');
    assert.equal(asyncUnlocked.interactive, true, '已解锁状态仍保留据点交互');
    for (const content of [unlocked, asyncUnlocked]) {
        assert.equal(content.caption, '', '已解锁站点不显示名称');
        assert.equal(content.badge, '', '已解锁站点不显示状态角标');
    }
    for (const type of ['stage', 'boss']) {
        const content = renderFixed({ ...asyncSite, type }, {
            stageByCell: new Map([[372, { isBoss: type === 'boss', stage: 5 }]]),
            pendingFixedResourceCells: [], art: asyncArt,
            progress: { isCellUnlocked: () => true, isOwned: () => false, isAreaPassed: () => false,
                explorationAt: () => 0, checkUnlock: () => ({ ok: true }) },
        });
        assert.equal(content.caption, '', `${type} 无建筑时不显示兜底名称`);
        assert.equal(content.badge, '', `${type} 无建筑时不显示状态角标`);
        assert.equal(content.interactive, true, `${type} 保留点击功能`);
    }

    // 🔴 2026-10-16 山猫「异步战点也要跟 Boss 一样，通关 / 解锁都是有建筑 id 才显示建筑」：
    // 没配 buildingId 的异步据点**不再画建筑**（此前会回退到 `art.asyncPvp` 那张 type 图，
    // 于是 chapter_01 里 12 个没配 id 的异步据点全都长成同一个「敌方主城」外观，零报错）。
    assert.equal(asyncUnlocked.icon, null,
        '异步据点没配 buildingId ⇒ 不画建筑（对齐 Boss 口径，只留格面框 + 文案）');

    // 配了 buildingId ⇒ 画 build 表里那一张（`69002` = territory_async_pvp_v1）。
    const asyncWithId = renderFixed({ ...asyncSite, buildingId: '69002' }, {
        stageByCell: new Map([[372, { isBoss: false, stage: 4 }]]),
        siteOpenableCells: [], pendingFixedResourceCells: [],
        art: { asyncPvp: asyncArt.asyncPvp, buildFrames: new Map([[69002, perCellBuilding]]) },
        progress: { isCellUnlocked: () => true, isOwned: () => false, isAreaPassed: () => false },
    });
    assert.equal(asyncWithId.icon, perCellBuilding,
        '配了 buildingId 的异步据点画 build 表那张（键经 Number 归一后查表）');
    // 表里查不到这个 id 时也不许回头吃 type 图 —— 与 Boss 同一条口径。
    const asyncUnknownId = renderFixed({ ...asyncSite, buildingId: '69999' }, {
        stageByCell: new Map([[372, { isBoss: false, stage: 4 }]]),
        siteOpenableCells: [], pendingFixedResourceCells: [],
        art: { asyncPvp: asyncArt.asyncPvp, buildFrames: new Map() },
        progress: { isCellUnlocked: () => true, isOwned: () => false, isAreaPassed: () => false },
    });
    assert.equal(asyncUnknownId.icon, null,
        'buildingId 在表里查不到 ⇒ 同样不画建筑，绝不回退 art.asyncPvp');

    // 🔴 2026-10-16：格子绘制从 `tintHexes`（一张灰图 + 三色染色）改成 `paintHexes`
    // （两张成品地皮二选一 + 格面框），桩跟着换名与新入参。
    const hexComponent = {
        spriteFrame: null, enabled: true, color: { equals: () => true },
        contentSize: { width: 0, height: 0 },
        setContentSize(this: { contentSize: { width: number; height: number } }, w: number, h: number) {
            this.contentSize = { width: w, height: h };
        },
    };
    const visibleHex = { active: false, getComponent: () => hexComponent };
    const hiddenHex = { active: true, getComponent: () => {
        throw new Error('hidden hex should not need visual updates');
    } };
    const grid = mapView as unknown as {
        hexNodes: Map<number, typeof visibleHex | typeof hiddenHex>;
        paintHexes: (input: unknown) => void;
    };
    grid.hexNodes = new Map([[4, visibleHex], [5, hiddenHex]]);
    grid.paintHexes({
        revealedCells: [4], map: { startCellId: 0, sites: [], randomSites: { candidateCells: [4, 5] } },
        progress: { isOwned: () => false, isCellUnlocked: () => false, isAreaPassed: () => false },
        art: {
            tileLocked: null, tileCleared: null,
            frameBoss: null, frameStage: null, frameAsyncPvp: null, frameChest: null,
        },
    });
    assert.equal(visibleHex.active, true);
    assert.equal(hiddenHex.active, false);
});

test('territory art loads the existing silver icon for random conditions', async () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryPageAssets.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') return { JsonAsset: class {}, SpriteFrame: class {} };
            // ⚠️ `loadTerritoryBattleArt` 内部会顺带加载建筑表（`loadBuildFrames`），
            // 而 build 表在**remoteRef bundle** ⇒ 必须走 `RefUtil`，不是 `AssetService`。
            // 这个 import 是 2026-10-10 加的（此前报 `Bundle resources doesn't contain build`）。
            //
            // 桩返回**真实形态**（`RefUtil.getRefAllAsync` 已把 `{c:1,k,v}` 列式还原成行对象数组），
            // 顺带让本用例顺带验到「build 表读得通、且读出来的贴图被 load 过」。
            if (id === '../../../framework/ref/RefUtil') return {
                RefUtil: {
                    instance: {
                        getRefAllAsync: async () => ([
                            { buildId: 69003, buildType: 3, buildresource: 'image/territory/buildings/territory_boss_v1' },
                        ]),
                    },
                },
            };
            if (id === '../../ArtPaths') return {
                BUILDING_ART_ROOT: 'image/buildings',
                COMMON_ART_ROOT: 'image/common',
                RESOURCE_ICON_ART_ROOT: 'icons/resource',
                TERRITORY_ART_ROOT: 'image/territory',
                TERRITORY_BUILDING_ART_ROOT: 'image/territory/buildings',
                spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`,
                spriteFramePathOf: (path: string) => `${path}/spriteFrame`,
            };
            // 开箱表演 / 点击反馈（2026-10-22）：`TerritoryMapView` 新增的两个表现层，
            // 与本用例关注的渲染分支无关 ⇒ 给空壳（它们的曲线在 `territory-chest-animation`
            // / `territory-tap-feedback` 里单独测）。
            if (id === './TerritoryChestView') return { TerritoryChestView: class {} };
            if (id === './TerritoryTapFeedback') return { TerritoryTapFeedback: class {} };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    const loadArt = moduleExports.loadTerritoryBattleArt as (
        assets: { load: (path: string) => Promise<{ path: string }>; has: () => Promise<boolean> },
        backgroundPath: string,
    ) => Promise<{ randomSilverIcon: { path: string } }>;
    const paths: string[] = [];
    const art = await loadArt({ load: async (path) => {
        paths.push(path);
        return { path };
    }, has: async () => true }, '');
    assert.equal(art.randomSilverIcon.path, 'icons/resource/图标_铜币/spriteFrame');
    assert.equal(paths.includes('image/territory/buildings/territory_random_resource_v1/spriteFrame'), true);
    // 顺带验 build 表那一路：RefUtil 桩给了 `69003` ⇒ 对应贴图必须真的被 load 过。
    // 否则「RefUtil 桩写了、但代码压根没走到查表那条路」也会绿。
    assert.equal(paths.includes('image/territory/buildings/territory_boss_v1/spriteFrame'), true,
        'build 表里的贴图路径应被 load（buildresource 是完整 resources 路径，只补 /spriteFrame）');
});
