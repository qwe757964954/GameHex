/**
 * 已建建筑外观图（`barracks-*` / `hq-base`）在对局里太大，要按 0.8 缩。
 *
 * 判据钉三件事，缺一件就会退回「改一半格子」的静默偏差：
 *  1. 基准缩放 = prefab 的 `_lscale(0.9) × 0.8 = 0.72`，且**由代码写**（prefab 不是运行时真源）；
 *  2. 激活表现弹入 / 复位后仍落回 0.72（这里最容易漏 —— 旧代码激活结束会写回 1.0）；
 *  3. 选点阶段的主城与正式对局同缩放（那条路径不调 `applyActivationFx`）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import {
    ZC_CARD_FADE_START_PROGRESS,
    ZC_CARD_REVEAL_SECONDS,
    ZC_CARD_START_SECONDS,
    ZC_HEX_ACTIVATION_SECONDS,
    ZC_HEX_BUILDING_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

/** prefab 里 `ZCGameHex/BuildingIcon` 的 `_lscale`；改动它必须同步改代码里的 `BUILDING_ICON_SCALE`。 */
const PREFAB_BUILDING_SCALE = 0.9;
/** 需求：在此基础上再乘 0.8。 */
const REQUESTED_FACTOR = 0.8;
const EXPECTED = 0.72;
/** ⚠️ 必须带容差：`0.9 * 0.8` 在 IEEE754 下是 `0.7200000000000001`，与字面量 `0.72` 差 1 ULP。 */
const EPS = 1e-9;
const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= EPS;

function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
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

const DEVELOPED_BARRACKS = {
    id: 7, owner: 'player', state: 'developed', building: 'barracks', tier: 1,
    hp: 100, maxHp: 100, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
    developmentCost: 25, tileType: null, developmentResolved: true,
    neutralResourceId: null, cardId: null,
} as never;

function presentationOf(over: Record<string, unknown>): any {
    return {
        state: DEVELOPED_BARRACKS,
        canDevelop: false,
        playerGold: 999,
        cooldown: null,
        now: 0,
        ...over,
    };
}

test('建筑外观缩放：prefab 的 0.9 再乘 0.8 = 0.72，由代码写而不是只改 prefab', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const barracksFrame = { name: 'barracks-peashooter' };
    view.setBuildingFrameResolver(() => barracksFrame);

    view.render(presentationOf({}));
    const node = view.buildingSprite.node;
    assert.equal(view.buildingSprite.spriteFrame, barracksFrame, '判据前提：这格确实画了兵营外观');
    assert.ok(near(node.scale.x, EXPECTED), `常规渲染下建筑缩放必须是 0.72，实际 ${node.scale.x}`);
    assert.equal(node.scale.y, node.scale.x, '两轴同值，等比不变形');
    assert.equal(node.scale.z, 1);
    // 反向判据：prefab 的 0.9 是**运行时无意义**的值（激活表现会覆写它），
    // 只改 prefab 会出现「0.9 / 0.72 混杂」，所以断言里必须出现 0.72 而不是 0.9。
    assert.ok(!near(node.scale.x, PREFAB_BUILDING_SCALE), '不能停在 prefab 的 0.9');
});

test('建筑外观缩放：激活表现的生成动画按 0.72 叠加、结束复位回 0.72（不是 1.0）', () => {
    const { load, cc, bar } = loadViews();
    const util = load('./ZCGameViewUtil');
    const view = stubHexView(load, cc, bar);
    view.setBuildingFrameResolver(() => ({ name: 'barracks-wallnut' }));
    const node = view.buildingSprite.node;
    const activation = { startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    // 激活时间轴（2026-10-15 row13 起两段并发）：**点击动画 = 脉冲 ∥ 缩没（0.7s，同起同收）**
    // → 卡牌段（前 62% 整格隐藏 → 后 38% 卡牌淡出时**建筑与淡出同拍由小变大**）。
    // 卡牌还在独占视线（还没开始淡出）时长建筑 ⇒ 整个生成动画被一张不透明的卡挡掉，等于没播。
    // ⚠️ 锚点必须用 `ZC_CARD_START_SECONDS`（卡牌起点 = 点击动画结束）—— `pushCardReveal` 推的就是
    // `now + ZC_CARD_START_SECONDS`，`hexActivationFx` 也按它切段。单拿 `ZC_HEX_PULSE_SECONDS`（= 同一个
    // 值也行）或领地侧的 `ZC_HEX_FLIP_SECONDS`（0.384，对局已不用它切段）去算会落到真实淡出窗
    // **之前**，「建筑必须显出来」那条必然假红。
    view.render(presentationOf({ activation, now: ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS * 0.5 }));
    assert.equal(node.active, false, '卡牌还没开始淡出之前，建筑不该出现');

    // 卡牌淡出段里的过冲峰值（建筑段起点 = 淡出起点，`POP_PEAK_AT` 处）：倍率 1.2 ⇒ 0.72 × 1.2。
    const fadeStartSeconds = ZC_CARD_REVEAL_SECONDS * ZC_CARD_FADE_START_PROGRESS;
    view.render(presentationOf({
        activation,
        now: ZC_CARD_START_SECONDS + fadeStartSeconds + ZC_HEX_BUILDING_SECONDS * util.POP_PEAK_AT,
    }));
    assert.equal(node.active, true, '卡牌淡出段建筑必须显出来');
    const popped = node.scale.x;
    assert.ok(popped > EXPECTED, `生成动画的过冲段应大于基准缩放，实际 ${popped}`);
    assert.ok(popped <= EXPECTED * util.POP_PEAK_SCALE + 1e-9,
        `过冲倍率不超过 ${util.POP_PEAK_SCALE}，实际 ${popped / EXPECTED}`);

    // 激活结束后必须复位到基准值 —— 这条是旧代码的真缺陷（写回 1.0 ⇒ 建筑又变大一号）。
    view.render(presentationOf({ activation: { ...activation }, now: 9 }));
    assert.ok(near(node.scale.x, EXPECTED), `激活结束后建筑缩放要复位到 0.72，不能停在 1.0（实际 ${node.scale.x}）`);
    assert.equal(node.active, true, '复位后建筑必须回到可见态（池化复用不留隐藏态）');
});

test('建筑外观缩放：选点阶段的主城与正式对局同缩放', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setBuildingFrameResolver(() => ({ name: 'hq-base' }));

    view.renderSpawnSelection({
        sectionOwner: 'player',
        // 基地邻格高亮（深蓝 #1D24C8）与建筑缩放无关，这里给 false 走普通路径。
        homeHighlight: false,
        blocked: false,
        selectedBy: 'player',
        confirmed: true,
        resourcePoint: false,
        resourceId: null,
    } as never);
    assert.ok(near(view.buildingSprite.node.scale.x, EXPECTED),
        `选点阶段走的是另一条路径，不设缩放就会停在 prefab 的 0.9（实际 ${view.buildingSprite.node.scale.x}）`);
});
