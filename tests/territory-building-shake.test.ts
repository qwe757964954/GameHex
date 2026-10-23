/**
 * 冒险（领地）**建筑生成抖动 + 建筑展示滞后**（钉钉需求 row14，2026-10-16）：
 *
 *   > 冒险 / 建筑生成增加类似战斗系统的建筑抖动效果
 *   > 建筑展示的时间需要滞后，等待地块反转结束
 *
 * 判据钉四件事：
 *  1. **曲线只有一处真源**：`core/hex/ShakePresentation`（零 `cc`），
 *     `app/zcds/view/ZCGameViewUtil` 原样**转发**同一份 —— 领地不许为它反向依赖对局；
 *  2. 拉伸量 = **120%**（`BUILDING_SHAKE_STRETCH`），形状是需求要的「**先 Y 后 X**」两段，
 *     段外恒 1，播完显式复位；
 *  3. 抖动是乘进 `Icon` 的**归一化基准缩放**（`BUILDING_VISIBLE_WIDTH / 可见宽`），
 *     不是覆盖 —— 否则「抖完建筑尺寸变了」；
 *  4. `TerritoryMapView`：翻开成功才登记待办；翻转期间站点带 `hidden` 渲染；
 *     翻转播完的**同一帧**补上建筑并 `playBuildingShake`；换章清空待办。
 *
 * ⚠️ 为什么「建筑展示滞后」不能靠 `icon: null`：`TerritoryStationView.render` 里
 *    `hasBuilding = icon !== null`，`icon` 为空会让名称底条 / 名称 / 角标**三者全亮**
 *    （反而多出一条底条）。这正是宝箱「已领取」分支踩过的坑 —— 所以走独立的 `hidden`。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { makeStationView, STATION_ICON_BASE_SCALE, type StationView } from './helpers/territory-station-fixtures';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_PHASE_SECONDS,
    SPAWN_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../assets/script/core/hex/ShakePresentation';
// ⚠️ 两个都按**真模块** import（不是源码文本）：这一条要证明的是「对局侧转发的就是 core 那一份」。
import * as shakeCore from '../assets/script/core/hex/ShakePresentation';
import * as zcdsUtil from '../assets/script/app/zcds/view/ZCGameViewUtil';

const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');

const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-9;

/** 剥掉注释再判源码（反向断言必须剥 —— 说明注释里就写着被禁的写法）。 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 与 `TerritoryStation.prefab` 的 `Icon` 对齐的一张 128×128 无留白帧。 */
const ICON_FRAME = {
    originalSize: { width: 128, height: 128 },
    rect: { width: 128, height: 128 },
    offset: { x: 0, y: 0 },
};

// ============================================================
// 一、曲线真源：core 一份，对局转发
// ============================================================

test('★曲线只有一处真源：core/hex/ShakePresentation 零依赖，对局侧原样转发', () => {
    const core = readFileSync('assets/script/core/hex/ShakePresentation.ts', 'utf8');
    // 零依赖 ⇒ 领地（不 import cc）能直接吃它。
    assert.doesNotMatch(stripComments(core), /from\s+'/, 'core 曲线模块不许 import 任何东西');
    // 对局侧只剩转发，不许再写一套曲线。
    const util = stripComments(readFileSync('assets/script/app/zcds/view/ZCGameViewUtil.ts', 'utf8'));
    assert.match(util, /from '\.\.\/\.\.\/\.\.\/core\/hex\/ShakePresentation'/,
        'ZCGameViewUtil 必须从 core 转发曲线');
    assert.doesNotMatch(util, /function spawnShakePulse/, 'ZCGameViewUtil 不许再自己实现一份脉冲');
    assert.doesNotMatch(util, /export const SPAWN_SHAKE_PHASE_SECONDS =/, '常量也不许自己定义一份');

    // 转发出来的**数值与函数**必须与 core 逐个相等（转发写漏一个键就会静默 undefined）。
    for (const key of [
        'SPAWN_SHAKE_STRETCH', 'BUILDING_SHAKE_STRETCH', 'SPAWN_SHAKE_PHASE_SECONDS',
        'SPAWN_SHAKE_TOTAL_SECONDS', 'spawnShakePulse', 'spawnShakeScaleX', 'spawnShakeScaleY',
    ] as const) {
        assert.equal((zcdsUtil as unknown as Record<string, unknown>)[key],
            (shakeCore as unknown as Record<string, unknown>)[key],
            `ZCGameViewUtil 必须原样转发 ${key}`);
    }

    // 领地侧：从 core 取（不是从 `app/zcds` 取），且整条领地链路都不许出现对局依赖。
    assert.match(stripComments(STATION_SRC), /from '\.\.\/\.\.\/\.\.\/core\/hex\/ShakePresentation'/,
        'TerritoryStationView 必须从 core 取抖动脉冲');
    assert.doesNotMatch(stripComments(STATION_SRC), /zcds/, '领地站点视图不许依赖对局');
    assert.doesNotMatch(stripComments(MAP_VIEW_SRC), /zcds/, '领地地图视图不许依赖对局');
});

test('★row14 建筑抖动 = 120% 拉伸、「先 Y 后 X」，段外恒 1（与对局同一条脉冲）', () => {
    assert.equal(BUILDING_SHAKE_STRETCH, 0.2, '需求原文「建筑模型放大比例改成 120%」⇒ 1 + 0.2');
    assert.equal(SPAWN_SHAKE_STRETCH, 0.1, '单位出生那一下仍是 110% 档（需求只点建筑）');
    assert.equal(SPAWN_SHAKE_TOTAL_SECONDS, SPAWN_SHAKE_PHASE_SECONDS * 2, '总时长 = Y 段 + X 段');

    const peak = 1 + BUILDING_SHAKE_STRETCH;
    // Y 段（前半段）：只有 Y 在动。
    assert.ok(near(spawnShakeScaleY(SPAWN_SHAKE_PHASE_SECONDS / 2, BUILDING_SHAKE_STRETCH), peak));
    assert.equal(spawnShakeScaleX(SPAWN_SHAKE_PHASE_SECONDS / 2, BUILDING_SHAKE_STRETCH), 1,
        'Y 段里 X 必须不动');
    // X 段（后半段）：Y 已回落，换成 X 在动。
    assert.equal(spawnShakeScaleY(SPAWN_SHAKE_PHASE_SECONDS * 1.5, BUILDING_SHAKE_STRETCH), 1,
        'X 段里 Y 必须已回落');
    assert.ok(near(spawnShakeScaleX(SPAWN_SHAKE_PHASE_SECONDS * 1.5, BUILDING_SHAKE_STRETCH), peak));
    // 段外（含负值 / 播完之后）：一律 1。
    for (const t of [-1, 0, SPAWN_SHAKE_TOTAL_SECONDS, SPAWN_SHAKE_TOTAL_SECONDS + 1]) {
        assert.equal(spawnShakeScaleY(t, BUILDING_SHAKE_STRETCH), 1, `Y 在 t=${t} 应为 1`);
        assert.equal(spawnShakeScaleX(t, BUILDING_SHAKE_STRETCH), 1, `X 在 t=${t} 应为 1`);
    }
});

// ============================================================
// 二、站点视图：抖动乘进归一化基准缩放
// ============================================================

test('★row14 抖动乘在归一化基准缩放上（不覆盖），播完复位，没在抖时 update 是空转', () => {
    const { view, iconSprite, icon } = makeStationView();
    // 先让 `applyIconPlacement` 算出一个**非 1** 的基准缩放：128×128 无留白帧 ⇒ 84 / 128。
    view.render({
        site: {}, icon: ICON_FRAME, caption: '', tint: iconSprite.color, badge: '', interactive: true,
    });
    const base = STATION_ICON_BASE_SCALE;
    assert.ok(near(icon.scale.x, base) && near(icon.scale.y, base),
        `128×128 帧应归一到 ${base}，实际 ${icon.scale.x}`);

    // 没登记抖动时推进：不改缩放（早退分支）。
    view.update(SPAWN_SHAKE_PHASE_SECONDS);
    assert.ok(near(icon.scale.x, base) && near(icon.scale.y, base), '没登记抖动时 update 不该动缩放');

    view.playBuildingShake();
    const peak = 1 + BUILDING_SHAKE_STRETCH;

    // Y 段中点：Y = 基准 × 1.2，X 仍是基准（**乘**进基准，不是直接把节点写成 1.2）。
    view.update(SPAWN_SHAKE_PHASE_SECONDS / 2);
    assert.ok(near(icon.scale.y, base * peak), `Y 段中点应为 ${base} × 1.2，实际 ${icon.scale.y}`);
    assert.ok(near(icon.scale.x, base), 'Y 段里 X 保持基准');

    // X 段中点：换成 X 拉满，Y 已回落。
    view.update(SPAWN_SHAKE_PHASE_SECONDS);
    assert.ok(near(icon.scale.x, base * peak), `X 段中点应为 ${base} × 1.2，实际 ${icon.scale.x}`);
    assert.ok(near(icon.scale.y, base), 'X 段里 Y 已回落基准');

    // 播完：显式复位（不能停在被拉长的姿态 —— 没有别的地方会把它改回来）。
    view.update(SPAWN_SHAKE_PHASE_SECONDS);
    assert.ok(near(icon.scale.x, base) && near(icon.scale.y, base), '播完必须回落到基准缩放');
    // 再推一次仍是空转。
    view.update(100);
    assert.ok(near(icon.scale.x, base) && near(icon.scale.y, base));

    // 池化口径：回收时必须停表并清因子（别把放大留给下一个借到本槽位的站点）。
    view.playBuildingShake();
    view.update(SPAWN_SHAKE_PHASE_SECONDS / 2);
    assert.ok(icon.scale.y > base, '回收前确实在抖（对照）');
    view.dispose();
    view.render({
        site: {}, icon: ICON_FRAME, caption: '', tint: iconSprite.color, badge: '', interactive: true,
    });
    view.update(SPAWN_SHAKE_PHASE_SECONDS / 2);
    assert.ok(near(icon.scale.x, base) && near(icon.scale.y, base), 'dispose 后不许接着抖');
});

// ============================================================
// 三、`hidden`：建筑展示滞后的载体
// ============================================================

test('★row14 hidden 只关四个视觉节点（站点根节点不承载视觉，关它没用）', () => {
    const { view, icon, caption, text, badge, iconSprite, root } = makeStationView();
    const tint = iconSprite.color;
    // 先按「已开启的随机资源格」画一次：有建筑图 ⇒ 名称底条 / 名称 / 角标全关。
    view.render({
        site: null, icon: ICON_FRAME, caption: '', tint, badge: '', interactive: false,
    });
    assert.equal(icon.active, true);
    assert.equal(caption.active, false);
    assert.equal(text.active, false);
    assert.equal(badge.active, false);

    // 翻转期间：整站不显示 —— 四个视觉节点都得灭，点击也得关掉。
    view.render({
        site: null, icon: ICON_FRAME, caption: '', tint, badge: '', interactive: false, hidden: true,
    });
    assert.equal(icon.active, false, '建筑图标要藏起来（这才是「滞后展示」）');
    assert.equal(caption.active, false);
    assert.equal(text.active, false);
    assert.equal(badge.active, false);
    assert.equal(view.button.interactable, false, '滞后期不许点');
    // ⚠️ 站点根节点上的 active 与视觉无关（视觉已 reparent 到共享 layer）——
    //    所以「关根节点」是错的写法，这里反向钉一下。
    assert.equal(root.active, true, '根节点保持 active：视觉不在它下面，关它只关命中区');

    // 翻转结束：`hidden` 一收，建筑立刻回来（且是同一个帧的 render）。
    view.render({
        site: null, icon: ICON_FRAME, caption: '', tint, badge: '', interactive: false,
    });
    assert.equal(icon.active, true, '解除滞后后建筑必须回来');
});

// ============================================================
// 四、地图视图：登记待办 → 翻转期间 hidden → 播完同一帧补偿
// ============================================================

/** 转译 `TerritoryMapView` 并塞入可控的翻格播放器 / 站点视图。 */
function makeMapView() {
    const code = ts.transpileModule(MAP_VIEW_SRC, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') {
                return {
                    _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                    Component: class {},
                    Color: { WHITE: { r: 255, g: 255, b: 255, a: 255 } },
                    Sprite: class {},
                };
            }
            if (id.endsWith('/HexGridLayout')) {
                return { HEX_GRID_CONTENT_LIFT: 12.5, HEX_GRID_IMAGE_WIDTH: 130, HEX_GRID_IMAGE_HEIGHT: 119 };
            }
            if (id === './TerritoryStationView') return { TerritoryStationView: class {} };
            if (id === './TerritoryResourceGainView') return { TerritoryResourceGainView: class {} };
            // 喷发粒子（2026-10-16 row17）：夹具只关心建筑抖动，给个空壳即可。
            if (id === './TerritoryGainBurst') return {
                TERRITORY_GAIN_BURST_NODE: 'GainBurst',
                TerritoryGainBurst: class {},
            };
            if (id.endsWith('/TerritoryResourceGain')) {
                return {
                    TERRITORY_GAIN_STACK_GAP_PX: 40, TERRITORY_GAIN_START_LIFT_PX: 40,
                    TERRITORY_SILVER_RES_ID: 7, TERRITORY_STAMINA_RES_ID: 9,
                };
            }
            if (id === './TerritoryHexFlip') {
                return {
                    TERRITORY_HEX_REVEAL_NODE: 'Reveal',
                    TerritoryHexFlip: class {
                        setEffect() {}
                        setGroundGlowFrames() {}
                        step() { return false; }
                        play() { return false; }
                        reset() {}
                        isPlaying() { return false; }
                    },
                };
            }
            if (id === './TerritoryTheme') {
                return {
                    TERRITORY_COLORS: {
                        gold: 'gold', locked: 'locked', cleared: 'cleared', owned: 'owned',
                        danger: 'danger', randomConditionText: 'red', randomAvailableText: 'white',
                    },
                    TERRITORY_STATION_STATE: {
                        owned: 'owned', exploring: 'exploring', available: 'available', locked: 'locked',
                    },
                    territoryStationTint: () => 'gold',
                    territoryBossTint: () => 'danger',
                    territoryUnboundTint: () => 'async-brown',
                };
            }
            if (id.endsWith('/TerritoryTexts')) {
                return {
                    TERRITORY_TEXTS: { pendingConfig: '待配置', lockBadge: '锁' },
                    TERRITORY_UNBOUND_TYPE_NAMES: {
                        stage: '关卡', boss: '首领', asyncPvp: '异步', fixedResource: '资源据点', bonus: '奖励据点',
                    },
                };
            }
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
            // 新地块生成（2026-10-22）：`TerritoryMapView` 又多了第三个表现层。本用例只跑
            // `syncStations` 的抖动分支，进场曲线与本例无关 ⇒ 空壳，且必须把 MapView 真正
            // 调到的六个成员都补齐（`step` / `reset` / `stop` / `isPlaying` / `play` / `opacityOf`）。
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
    const MapView = moduleExports.TerritoryMapView as new () => Record<string, any>;
    const mapView = new MapView();
    // 格子：只提供 `getComponent(Sprite)` 那个读取点。
    mapView.hexNodes = new Map([[4, { active: true, getComponent: () => ({}) }]]);
    const rendered: Record<string, unknown>[] = [];
    const shakes: number[] = [];
    let playing = false;
    mapView.hexFlip = {
        play: () => true,
        isPlaying: () => playing,
        step: () => playing,
        reset() {},
        setEffect() {},
        setGroundGlowFrames() {},
    };
    mapView.createStation = (target: { cellId: number }) => {
        const view: {
            cellId: number;
            setMapPosition: () => void;
            render: (content: Record<string, unknown>) => void;
            playBuildingShake: () => void;
            dispose: () => void;
            node: { destroy: () => void };
        } = {
            cellId: target.cellId,
            setMapPosition() {},
            render(content) { rendered.push({ cellId: target.cellId, ...content }); },
            playBuildingShake() { shakes.push(target.cellId); },
            dispose() {},
            node: { destroy() {} },
        };
        (mapView.stationViews as Map<number, unknown>).set(target.cellId, view);
        return view;
    };
    return {
        mapView,
        rendered,
        shakes,
        setPlaying: (value: boolean) => { playing = value; },
        syncFlip: (input: unknown) => (mapView as { syncFlip: (i: unknown) => void }).syncFlip(input),
        syncStations: (input: unknown) => (mapView as { syncStations: (i: unknown) => void }).syncStations(input),
    };
}

/** 随机资源格 4 号：一格候选、配了建筑图。 */
function flipInput(unlocked: boolean): unknown {
    return {
        map: { startCellId: 0, sites: [], randomSites: { candidateCells: [4], triggerSilver: 399, buildingIds: { 4: '69006' } } },
        layout: { points: new Map([[4, { x: 10, y: 20 }]]) },
        revealedCells: [4],
        randomResourceOpenableCells: [],
        pendingRandomResourceCells: [],
        progress: { isCellUnlocked: () => unlocked },
        art: { tileLocked: 'mud', tileCleared: 'grass', randomSilverIcon: 'silver', buildFrames: new Map([[69006, 'building']]) },
    };
}

test('★★row14 翻开那一帧登记待办、翻转期间 hidden、播完同一帧补建筑并抖一次', () => {
    const { mapView, rendered, shakes, setPlaying, syncFlip, syncStations } = makeMapView();
    // 首帧只做「已开启」快照（不播翻格），否则进页面会闪一串。
    syncFlip(flipInput(false));
    assert.equal(mapView.hexFlipBootstrapped, true, '首帧必须做快照');
    assert.equal(mapView.pendingBuildingReveal.size, 0, '首帧不该登记待办');

    // 点开：翻转开始 ⇒ 登记待办。
    setPlaying(true);
    syncFlip(flipInput(true));
    assert.deepEqual([...mapView.pendingBuildingReveal], [4], '翻开的格子要进待办');
    assert.equal(mapView.pendingBuildingRender.size, 0, '待办的站点数据要等 syncStations 填');

    // 同一帧渲染站点：建筑必须先藏起来（`hidden`），并把这份数据存下来。
    syncStations(flipInput(true));
    const hiddenFrame = rendered[rendered.length - 1];
    assert.equal(hiddenFrame.hidden, true, '翻转期间站点必须带 hidden');
    assert.equal(hiddenFrame.icon, 'building', '存的仍是「有建筑」那一份（解除时直接交回去）');
    assert.equal(mapView.pendingBuildingRender.size, 1, '待办期间要存下一份站点数据');

    // 翻转还没播完：update 不许提前解除。
    mapView.update(0.016);
    assert.equal(mapView.pendingBuildingReveal.size, 1, '还在翻就不许解除');
    assert.equal(shakes.length, 0, '还在翻就不许播抖动');

    // 翻转播完 ⇒ **同一帧**补建筑（不带 hidden）+ 播一次抖动。
    setPlaying(false);
    const before = rendered.length;
    mapView.update(0.016);
    assert.equal(mapView.pendingBuildingReveal.size, 0, '播完要解除待办');
    assert.equal(mapView.pendingBuildingRender.size, 0, '待办数据也要清掉（别涨成泄漏）');
    assert.equal(rendered.length, before + 1, '播完要补一次 render');
    const revealed = rendered[rendered.length - 1];
    assert.equal(revealed.hidden, undefined, '补偿那一帧不许再带 hidden');
    assert.equal(revealed.icon, 'building', '补偿的就是「建筑出现」那一帧');
    assert.deepEqual(shakes, [4], '播完要播一次建筑生成抖动');

    // 再推一帧：不许重复补偿（待办已清空）。
    const after = rendered.length;
    mapView.update(0.016);
    assert.equal(rendered.length, after, '解除后不许重复 render');
    assert.deepEqual(shakes, [4], '不许重复抖');
});

test('★row14 没翻格（没注入 effect）就不许登记待办：建筑照旧立刻出现', () => {
    const { mapView, rendered, syncFlip, syncStations } = makeMapView();
    // 播放器没 effect ⇒ `play` 返回 false（桩改成 false 复现）。
    mapView.hexFlip.play = () => false;
    syncFlip(flipInput(false));
    syncFlip(flipInput(true));
    assert.equal(mapView.pendingBuildingReveal.size, 0, '没真的翻起来就不许让建筑等');
    syncStations(flipInput(true));
    assert.equal(rendered[rendered.length - 1].hidden, undefined, '建筑直接出现（不能静默消失）');
});

test('★row14 换章 / 重建格子时必须清空待办（否则永远等一个不会播完的翻转）', () => {
    const { mapView, setPlaying, syncFlip, syncStations } = makeMapView();
    syncFlip(flipInput(false));
    setPlaying(true);
    syncFlip(flipInput(true));
    syncStations(flipInput(true));
    assert.equal(mapView.pendingBuildingReveal.size, 1);

    // 判据钉在代码里：`syncGrid` 的换图分支必须清两张表（顺序在 `hexFlip.reset()` 附近）。
    // 2026-10-22 改成「按分支切片比下标」而不是「400 字内」：新地块生成又往这个分支里插了
    // `hexSpawn.reset()` 等三行，距离判据会随无关语句的增长而假红；真正的不变量是
    // 「同一个换图分支内、`hexFlip.reset()` 之后、两张表都要清、且两张表仍相邻」。
    const branchSource = stripComments(MAP_VIEW_SRC);
    const branchStart = branchSource.indexOf('this.gridKey = key;');
    assert.ok(branchStart > 0, '没读到 syncGrid 的换图分支');
    const branchEnd = branchSource.indexOf('const seen = new Set<number>();', branchStart);
    assert.ok(branchEnd > branchStart, '没读到换图分支的结尾');
    const branch = branchSource.slice(branchStart, branchEnd);
    const flipResetAt = branch.indexOf('this.hexFlip.reset();');
    const revealClearAt = branch.indexOf('this.pendingBuildingReveal.clear();');
    const renderClearAt = branch.indexOf('this.pendingBuildingRender.clear();');
    assert.ok(flipResetAt > 0, '换图分支必须先复位在播的翻格');
    assert.ok(revealClearAt > flipResetAt, '待办建筑要在翻格复位之后清（同一个换图分支里）');
    assert.ok(renderClearAt > revealClearAt, '两张待办表都要清，且先清 reveal 再清 render');
    assert.ok(
        branch.slice(revealClearAt, renderClearAt).split('\n').filter((line) => line.trim()).length <= 2,
        '两张待办表要挨着清（中间插了别的语句说明有人把清表拆散了）',
    );
});

test('★row14 syncFlip 必须排在 syncStations 之前（否则建筑会闪一帧再消失）', () => {
    const body = /renderMap\(input: ITerritoryMapRenderInput\): void \{[\s\S]*?\n    \}/.exec(MAP_VIEW_SRC);
    assert.ok(body, '没读到 renderMap');
    const flipAt = body![0].indexOf('this.syncFlip(input);');
    const stationAt = body![0].indexOf('this.syncStations(input);');
    assert.ok(flipAt > 0 && stationAt > 0, 'renderMap 必须同时调 syncFlip 与 syncStations');
    assert.ok(flipAt < stationAt, 'syncFlip 必须在 syncStations 之前（决定权先于绘制）');
    // 每帧推进：`update` 第一句仍是 hexFlip.step（判据见 territory-hex-flip.test.ts），
    // 且紧接着要解除待办 —— 顺序反了会多等一帧才出现建筑。
    // 2026-10-22：`hexSpawn.step(dt)` 合法地夹在这两句之间（生成动画与翻格同帧序），
    // 所以判据从「两句紧邻」改成「第一句仍是 hexFlip、两个 step 之后**立刻**解除待办」。
    const updateBody = /update\(dt: number\): void \{([\s\S]*?)\n    \}/.exec(
        stripComments(MAP_VIEW_SRC),
    );
    assert.ok(updateBody, '没读到 update');
    const updateSource = updateBody![1];
    const flipStepAt = updateSource.indexOf('this.hexFlip.step(dt);');
    const spawnStepAt = updateSource.indexOf('this.hexSpawn.step(dt);');
    const revealAt = updateSource.indexOf('this.resolveBuildingReveal();');
    assert.ok(flipStepAt >= 0 && revealAt > 0, 'update 必须调 hexFlip.step 与 resolveBuildingReveal');
    assert.equal(updateSource.slice(0, flipStepAt).trim(), '',
        'update 的第一句必须是 hexFlip.step（先推进翻格再谈绘制）');
    assert.ok(spawnStepAt > flipStepAt, '生成动画的 step 排在翻格之后（同格撞车时翻格先写）');
    assert.ok(revealAt > spawnStepAt, '解除待办排在两个 step 之后');
    assert.equal(updateSource.slice(spawnStepAt + 'this.hexSpawn.step(dt);'.length, revealAt).trim(), '',
        'update 里 step 之后要立刻解除待办');
});

// ============================================================
// `buildSize`（表「模型大小」）的数据链路：build.json → buildScales → 渲染入参
// ============================================================

test('★★★buildSize 按 buildId 传到渲染入参（查不到一律 1，不能是 undefined）', () => {
    // 1) 表里配了倍率 ⇒ 原样传下去（乘不乘进缩放由 station view 的判据钉）。
    const withScale = flipInput(true) as { art: { buildScales?: Map<number, number> } };
    withScale.art.buildScales = new Map([[69006, 1.5]]);
    const a = makeMapView();
    a.syncFlip(withScale);
    a.syncStations(withScale);
    assert.equal(a.rendered[a.rendered.length - 1].iconScale, 1.5,
        'buildSize=1.5 必须传到站点的 iconScale');

    // 2) 旧数据没有 buildScales ⇒ 1。**不能留 undefined** —— 乘进缩放会得到 NaN，
    //    症状是建筑凭空消失，且控制台零报错。
    const b = makeMapView();
    const noScale = flipInput(true);
    b.syncFlip(noScale);
    b.syncStations(noScale);
    assert.equal(b.rendered[b.rendered.length - 1].iconScale, 1,
        '查不到倍率必须兜底成 1');
});
