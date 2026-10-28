/**
 * 「战斗中，新格子的生成动画和地块脉冲动画同步播放」（需求 2026-10-26）的护栏。
 *
 * 口径取代 2026-10-15 row6 的「延迟 0.2s、等卡牌生成动画开始后再展示」：
 * 那一版把新点亮邻格的图标 / 价格按住 0.9s（`ZC_CARD_START_SECONDS + 0.2`），
 * 与点击那一拍的脉冲完全错开。新口径是——
 *   · 点击那一拍，邻格的**图标 / 价格 / 描边**就跟着脉冲一起出现（不再按住）；
 *   · 同时播一段**生成动画**（`buildingLayer` 由小到大 + 淡入），
 *     时长 `ZC_HEX_NEIGHBOR_SPAWN_SECONDS` = `HEX_PULSE_WAVE_SECONDS`（0.5s），与波同起同收；
 *   · 起点锚**脉冲起点**（`presentation.developPulseStartedAt`），不是「视图发现它变可开发」那一拍
 *     （地块走 0.15s 静态节流，锚 `now` 会整体滞后于脉冲）。
 *
 *  ⚠️ 只对 **`canDevelop` 由假变真的那一格**生效 —— 开局就可开发的购买位要是也长一遍，
 *  一进对局满屏价格牌都在蹦（第 4 个用例是这条反向守卫）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import {
    ZC_CARD_START_SECONDS,
    ZC_HEX_NEIGHBOR_SPAWN_SECONDS,
    ZC_HEX_PULSE_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { HEX_PULSE_WAVE_SECONDS } from '../assets/script/core/hex/HexFlipPresentation';
import { DEVELOPABLE_SPAWN_FROM_SCALE, elasticPopScale, territoryTintOwner } from '../assets/script/app/zcds/view/ZCGameViewUtil';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

const HEX_VIEW_SRC = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');

/** 与 `zcds-resource-unit-preview.test.ts` / `zcds-progress.test.ts` 同款：补齐 prefab 必填引用。 */
function stubHexView(load: (name: string) => unknown, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView') as any).ZCHexView();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.priceIcon.spriteFrame = { name: 'coin' };
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

/** 一格「中立 · 可开发」的地块：金矿类型，会画地块图标 + 价格数字。 */
function developableHexState(): never {
    return {
        id: 7, owner: 'neutral', state: 'developable', building: 'none', tier: 0,
        hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
        developmentCost: 25, tileType: ZCPvpTileType.Mine, developmentResolved: false,
        neutralResourceId: null, cardId: null,
    } as never;
}

function present(now: number, canDevelop: boolean, developPulseStartedAt: number | null = null) {
    return { state: developableHexState(), canDevelop, playerGold: 999, cooldown: null, now, developPulseStartedAt };
}

test('★常量：生成动画时长 = 脉冲波时长（0.5s），且不超出点击动画段（0.7s）', () => {
    assert.equal(ZC_HEX_NEIGHBOR_SPAWN_SECONDS, HEX_PULSE_WAVE_SECONDS,
        '要与那道波同起同收 ⇒ 时长取脉冲波（5 帧 × 10fps）');
    assert.equal(ZC_HEX_NEIGHBOR_SPAWN_SECONDS, 0.5);
    assert.ok(ZC_HEX_NEIGHBOR_SPAWN_SECONDS <= ZC_HEX_PULSE_SECONDS,
        '生成动画不能比点击动画长：0.7s 之后舞台已经交给卡牌');
    // 旧口径（row6 的 0.9s 按住窗）已退役：常量不该再存在，否则两套口径会并存。
    assert.ok(!/ZC_HEX_NEIGHBOR_HOLD_SECONDS/.test(HEX_VIEW_SRC), '视图里不该再引用按住窗常量');
});

test('★新点亮的格子：图标 / 价格立刻可见，并从小长到 1、由透明渐显', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const hit = 0.05;   // 视图第一次看到「这格变可开发」的时刻（0.15s 节流内的一拍）

    // 基线：还没点亮（不可开发）—— 首帧只记基线，不该凭空播生成动画。
    view.render(present(0, false));
    assert.equal(view.iconSprite.enabled, false, '不可开发时本来就没有地块图标');
    assert.equal(view.isDevelopableSpawning(), false, '没点亮时不该起生成动画');

    // 刚点亮：图标 + 价格**这一拍就出现**（不再有按住窗），同时起手在最小 + 全透明。
    view.render(present(hit, true));
    assert.equal(view.iconSprite.enabled, true, '点击那一拍就该显示地块图标（与脉冲同步）');
    assert.equal(view.priceIcon.enabled, true, '点击那一拍就该显示价格图标');
    assert.equal(view.iconLabel.string, '25', '点击那一拍就该显示价格数字');
    assert.equal(view.isDevelopableSpawning(), true, '点亮那一拍要起生成动画');
    assert.equal(view.buildingLayer.scale.x, DEVELOPABLE_SPAWN_FROM_SCALE, '起手缩放 = 生成动画基准');
    assert.equal(view.buildingLayer.getComponent(cc.UIOpacity)?.opacity, 0, '起手全透明');

    // 中段：过冲越过 1（弹性曲线峰值在正中），仍在播。
    assert.equal(view.advanceDevelopableSpawn(hit + ZC_HEX_NEIGHBOR_SPAWN_SECONDS * 0.5), true);
    assert.ok(view.buildingLayer.scale.x > 1, '中段要过冲越过 1（生成动画的弹性）');

    // 播完：落回 1 / 全不透明，并出队（渲染层据此把它从逐帧集合摘掉）。
    assert.equal(view.advanceDevelopableSpawn(hit + ZC_HEX_NEIGHBOR_SPAWN_SECONDS + 0.01), false);
    assert.equal(view.isDevelopableSpawning(), false);
    assert.equal(view.buildingLayer.scale.x, 1, '播完必须复位到 1');
    assert.equal(view.buildingLayer.getComponent(cc.UIOpacity)?.opacity, 255, '播完必须回到全不透明');
});

test('★起点锚脉冲：脉冲已经走了 0.1s 时，生成动画从那一刻算起（不滞后于波）', () => {
    const { load, cc, bar } = loadViews();

    // ① 不给脉冲起点 ⇒ 只能从「视图看见的这一拍」起算，进度 0。
    const cold = stubHexView(load, cc, bar);
    cold.render(present(0, false));
    cold.render(present(0.1, true, null));
    assert.equal(cold.buildingLayer.scale.x, DEVELOPABLE_SPAWN_FROM_SCALE, '拿不到脉冲起点时退回 now');

    // ② 给了脉冲起点 0（点击那一拍）⇒ now = 0.1 时进度 = 0.2，尺寸随之前进。
    const warm = stubHexView(load, cc, bar);
    warm.render(present(0, false));
    warm.render(present(0.1, true, 0));
    const expected = elasticPopScale(0.1 / ZC_HEX_NEIGHBOR_SPAWN_SECONDS, DEVELOPABLE_SPAWN_FROM_SCALE);
    assert.ok(Math.abs(warm.buildingLayer.scale.x - expected) < 1e-9,
        '生成动画必须从脉冲起点起算（否则与波错开 0.15s 的静态节流）');
    assert.ok(warm.buildingLayer.scale.x > DEVELOPABLE_SPAWN_FROM_SCALE,
        '已经过去 0.1s ⇒ 不该还停在起手缩放');
});

test('★反向守卫：开局就可开发的格子不播生成动画（不蹦）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);

    // 首帧就是可开发（开局就亮的购买位）——基线只记状态，不起动画。
    view.render(present(0, true));
    assert.equal(view.iconSprite.enabled, true, '开局就可开发的格子必须立刻可见');
    assert.equal(view.isDevelopableSpawning(), false, '首帧不算「刚点亮」');
    assert.equal(view.buildingLayer.scale.x, 1, '开局就可开发的格子不许缩着出现');

    // 后续帧保持可开发：不得重起一次。
    view.render(present(ZC_CARD_START_SECONDS, true));
    assert.equal(view.isDevelopableSpawning(), false, '持续可开发的格子不得反复重播');
});

/**
 * row9 的**新形态**（2026-10-26）：不再有「按住窗」，描边与图标由同一处判据 + 同一次静态刷新
 * 产生 ⇒ 天然同帧。这条用例钉住「渲染世界不再去问视图要按住状态」。
 *
 * 直接调 `ownerForHex`（领地底图与共享轮廓共用的那一份判据）而不是探针缓冲：
 * 探针要走 `renderHexSystem`，那需要一整盘 `initialize` 过的地图，与本用例关注的
 * 「可开发 ⇒ 立刻染我方色」无关。
 */
test('★row9 新形态：可开发那一刻归属就是我方色（不再问视图要按住状态）', () => {
    const { load } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } } });

    // 视图桩：故意**不提供** `resolveDevelopableHold` —— 一旦有人把按住窗那段加回来，
    // 这里就会因为 "not a function" 直接炸，而不是悄悄回退成旧口径。
    world.hexEntityBySource.set(7, 1);
    world.hexViews.set(1, { render: () => {}, setSweepOwner: () => {} });
    world.territoryFrame = {
        hexesById: new Map([[7, { state: { owner: 'neutral' }, canDevelop: true }]]),
    };

    assert.equal(world.ownerForHex(7), territoryTintOwner('neutral', true),
        '可开发那一拍归属就该是我方色（与图标同帧，不再等 0.9s）');
    assert.equal(world.ownerForHex(99), 'neutral', '查不到的格子按中立兜底，不炸');
});

test('★接线：生成动画由 renderDynamic 每帧推，播完自动出队', () => {
    const { load } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } } });

    const advanced: number[] = [];
    world.hexEntityBySource.set(7, 1);
    world.hexViews.set(1, {
        render: () => {},
        setSweepOwner: () => {},
        isDevelopableSpawning: () => false,
        // 前两次仍返回 true（还在播），第三次开始 false（播完）⇒ 必须出队。
        advanceDevelopableSpawn: (now: number) => { advanced.push(now); return advanced.length < 3; },
    });
    const frame = { snapshot: { elapsedSeconds: 1.25, status: 'playing' }, hexActivations: [] };

    // 集合为空：一次调用都不该发生（平时就是这样，零开销）。
    world.renderDevelopableSpawns(frame);
    assert.deepEqual(advanced, [], '没有在播的格子时不许遍历 / 调用任何视图');

    world.developableSpawnHexes.add(7);
    world.renderDevelopableSpawns(frame);
    world.renderDevelopableSpawns(frame);
    assert.deepEqual(advanced, [1.25, 1.25], '每帧按视觉时间推进');
    assert.equal(world.developableSpawnHexes.has(7), true, '还在播 ⇒ 继续留在集合里');

    world.renderDevelopableSpawns(frame);
    assert.equal(world.developableSpawnHexes.has(7), false, '播完必须出队（否则每帧白推）');

    // 源码级兜底：这条通道必须挂在 `renderDynamic` 上，别有人顺手挪进 0.15s 的静态刷新。
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    assert.match(source, /this\.renderDevelopableSpawns\(frame\)/,
        '生成动画只有 0.5s，挂在 renderStatic 的 0.15s 节流里会变成"跳大"');
    assert.match(source, /developPulseStartedAt,/, '每格 presentation 必须带上脉冲起点（生成动画的锚点）');
});

test('★源码守卫：视图复用时生成动画的状态必须复位，且时长来自共享常量', () => {
    const initAt = HEX_VIEW_SRC.indexOf('initialize(');
    assert.ok(initAt > 0, '找不到 ZCHexView.initialize');
    // `initialize` 的下一段是 `setBuildingFrameResolver`：切到这里就是整个方法体。
    const body = HEX_VIEW_SRC.slice(initAt, HEX_VIEW_SRC.indexOf('setBuildingFrameResolver', initAt));
    for (const field of ['developableSpawnStartedAt', 'lastCanDevelop', 'developableBootstrapped']) {
        assert.match(body, new RegExp(`this\\.${field} =`),
            `initialize 必须复位 ${field}（对象池会把上一局的生成动画带过来）`);
    }
    assert.match(body, /this\.applyDevelopableSpawn\(0\);/,
        'initialize 必须把 buildingLayer 的缩放 / 透明度落回基准（否则新局第一帧是"隐形的小格子"）');
    assert.match(HEX_VIEW_SRC, /ZC_HEX_NEIGHBOR_SPAWN_SECONDS/, '时长必须来自共享常量，不许在视图里写死 0.5');
});
