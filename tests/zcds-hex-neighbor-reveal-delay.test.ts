/**
 * 「开发后新点亮的邻格，其可开发外观（地块图标 + 价格 + 染色）延后到卡牌弹出后再显示」的护栏。
 *
 * 需求原话（2026-10-15）：「消耗金币点击方块后，三个新扩展的方块展示时间延迟0.2s，
 * 等待卡牌生成动画开始播放后再展示出来」。
 *
 *  口径落在 `ZCBattlePresentationQueue.ZC_HEX_NEIGHBOR_HOLD_SECONDS`
 *  （= 卡牌弹出时刻 `ZC_CARD_START_SECONDS`（脉冲 + 缩没）+ 0.2s）与 `ZCHexView.resolveDevelopableHold`。
 *
 *  ⚠️ 只对 **`canDevelop` 由假变真的那一格**生效 —— 本来就可开发的邻格要是也被藏一遍，
 *  玩家会看到价格牌「闪一下又回来」。这条是本用例的第 3 个断言。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import {
    ZC_CARD_START_SECONDS,
    ZC_HEX_NEIGHBOR_HOLD_SECONDS,
    ZC_HEX_NEIGHBOR_REVEAL_DELAY_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
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

function present(now: number, canDevelop: boolean) {
    return { state: developableHexState(), canDevelop, playerGold: 999, cooldown: null, now };
}

test('★常量：新点亮邻格的等待窗 = 卡牌弹出时刻 + 0.2s（两个分句都成立）', () => {
    assert.equal(ZC_HEX_NEIGHBOR_REVEAL_DELAY_SECONDS, 0.2, '需求写的是延迟 0.2s');
    // 卡牌真正的起点是**点击动画（脉冲 ∥ 缩没）播完**（`pushCardReveal` 推的就是 `now + ZC_CARD_START_SECONDS`），
    // 不是单看脉冲结束、更不是领地侧那个已不再参与对局分段的 `ZC_HEX_FLIP_SECONDS` —— 锚错了按住窗会比卡牌先结束。
    assert.equal(ZC_HEX_NEIGHBOR_HOLD_SECONDS, ZC_CARD_START_SECONDS + 0.2,
        '等待窗必须从「卡牌生成动画开始播放」那一刻起算');
    assert.ok(ZC_HEX_NEIGHBOR_HOLD_SECONDS > ZC_CARD_START_SECONDS,
        '等待窗必须晚于卡牌弹出，否则「等卡牌动画开始后再展示」不成立');
});

test('★新点亮的格子：图标 / 价格 / 数字按住不放，到点后才一起出现', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const hit = 0.05;   // 视图第一次看到「这格变可开发」的时刻（0.15s 节流内的一拍）
    const revealAt = hit + ZC_HEX_NEIGHBOR_HOLD_SECONDS;

    // 基线：还没点亮（不可开发）—— 首帧只记基线，不该凭空按住。
    view.render(present(0, false));
    assert.equal(view.iconSprite.enabled, false, '不可开发时本来就没有地块图标');

    // 刚点亮：整段按住（图标 / 价格 / 数字都不出现）。
    view.render(present(hit, true));
    assert.equal(view.iconSprite.enabled, false, '刚点亮时不得显示地块图标（要等卡牌弹出后）');
    assert.equal(view.priceIcon.enabled, false, '刚点亮时不得显示价格图标');
    assert.equal(view.iconLabel.string, '', '刚点亮时不得显示价格数字');

    // 等待窗内（差一点点到点）仍然是按住态。
    view.render(present(revealAt - 0.01, true));
    assert.equal(view.iconSprite.enabled, false, '等待窗内必须仍然按住');
    assert.equal(view.iconLabel.string, '', '等待窗内不得显示价格数字');

    // 到点后一起恢复：图标 + 价格 + 数字。
    view.render(present(revealAt + 0.01, true));
    assert.equal(view.iconSprite.enabled, true, '到点后地块图标要出现');
    assert.equal(view.priceIcon.enabled, true, '到点后价格图标要出现');
    assert.equal(view.iconLabel.string, '25', '到点后价格数字要出现');
});

test('★反向守卫：本来就可开发的格子不会被重新藏一遍（不闪）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);

    // 首帧就是可开发（开局就亮的购买位）——基线只记状态，不按住。
    view.render(present(0, true));
    assert.equal(view.iconSprite.enabled, true, '开局就可开发的格子必须立刻可见');
    assert.equal(view.iconLabel.string, '25', '开局就可开发的格子必须立刻显示价格');

    // 后续帧保持可开发：不得被重新按住。
    view.render(present(ZC_HEX_NEIGHBOR_HOLD_SECONDS * 0.5, true));
    assert.equal(view.iconSprite.enabled, true, '持续可开发的格子不得被藏起来（会闪）');
    assert.equal(view.iconLabel.string, '25', '持续可开发的格子价格不得消失');
});

/**
 * row9：「地块的描边部分的展示时间需要和新的地块图标出现同步展示，**不要先展示描边**」。
 *
 *  轮廓由 `ZCGameRenderWorld.redrawSharedOutline` 用共享的**整盘一张** `cc.Graphics` 画，
 *  它拿到的 `ownerForHex` 以前只看 `model.canPlayerDevelop()` —— 那一刻模型已经翻成 true，
 *  于是轮廓先变成我方色，而地块视图还要按 row6 的按住窗把图标 / 价格藏 0.2s ⇒ 视觉上
 *  「描边先冒出来、图标才跟上」。修法是让轮廓也去问**同一个按住状态**。
 *
 *  断言用的是 `redrawSharedOutline` 的探针缓冲 `outlineDrawn`（每格压 `id / 阵营序号 / mask /
 *  结算线条脉冲档位`），阵营序号 = `FACTION_ORDER.indexOf(owner) + 1` ⇒ 中立 1、我方 2。
 */
test('★row9 按住窗内轮廓不得先变我方色，到点后才和图标一起换', () => {
    const { load, cc } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    // `redrawSharedOutline` 会把棋盘缩放并进探针（格子观感随缩放变），所以层得给出来。
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } } });
    world.outlineGraphics = new cc.Graphics();

    // 挑一格有可玩邻格的格：这样它的边界掩码非 0，探针才会记下它。
    const target = world.map.find((hex: any) => hex.playable
        && hex.neighbors.some((id: number) => world.map[id]?.playable));
    assert.ok(target, '夹具地图里找不到有邻格的可玩格');

    const entityId = 1;
    world.hexEntityBySource.set(target.id, entityId);
    let held = true;
    world.hexViews.set(entityId, {
        render: () => {},
        setSweepOwner: () => {},
        // 按住状态的**唯一真源**在地块视图上；这里替身返回什么，轮廓就该跟着用什么。
        resolveDevelopableHold: () => held,
    });
    const model: any = {
        snapshot: { hexes: [{ id: target.id, owner: 'neutral' }], playerGold: 0, elapsedSeconds: 0 },
        mapConfig: { cityMode: 'battle' },
        canPlayerDevelop: (id: number) => id === target.id,
        activationOf: () => null,
        buildingCooldown: () => null,
    };
    const ownerIndexInOutline = (): number => {
        const drawn: number[] = world.outlineDrawn;
        // 每格压 **4** 个数：id / 阵营序号 / mask / 结算线条脉冲档位（2026-10-16 加的第 4 个）。
        for (let cursor = 3; cursor + 3 < drawn.length; cursor += 4) {
            if (drawn[cursor] === target.id) return drawn[cursor + 1];
        }
        return 0;
    };

    world.renderHexSystem(model);
    assert.equal(ownerIndexInOutline(), 1,
        '按住窗内轮廓必须按真实归属（中立）画 —— 先变我方色就是需求要修的「先展示描边」');

    held = false;
    world.renderHexSystem(model);
    assert.equal(ownerIndexInOutline(), 2, '按住窗结束后轮廓才跟着图标一起变成我方色');
});

test('★源码守卫：视图复用时三个等待态字段必须复位', () => {
    const initAt = HEX_VIEW_SRC.indexOf('initialize(');
    assert.ok(initAt > 0, '找不到 ZCHexView.initialize');
    const body = HEX_VIEW_SRC.slice(initAt, HEX_VIEW_SRC.indexOf('\n    ', HEX_VIEW_SRC.indexOf('applyGroundGlow(0, 1);', initAt)));
    for (const field of ['developableHoldUntil', 'lastCanDevelop', 'developableBootstrapped']) {
        assert.match(body, new RegExp(`this\\.${field} =`),
            `initialize 必须复位 ${field}（对象池会把上一局的等待窗带过来）`);
    }
    assert.match(HEX_VIEW_SRC, /ZC_HEX_NEIGHBOR_HOLD_SECONDS/, '按住时长必须来自共享常量，不许在视图里写死 0.2');
});
