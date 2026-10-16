import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCEconomySystem, type ZCEconomyContext } from '../assets/script/app/zcds/model/systems/ZCEconomySystem';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCHexState, ZCSnapshot } from '../assets/script/app/zcds/model/ZCGameTypes';

function barracks(): ZCHexState {
    return {
        id: 2, owner: 'player', building: 'barracks', cardId: 'card', tier: 1,
        hp: 100, constructionRemainingSeconds: 0,
    } as ZCHexState;
}

function match(): { context: ZCEconomyContext; spawned: number[]; card: ZCDeckCard } {
    const card = { id: 'card', unitId: 'unit', cycleBaseValue: 2 } as ZCDeckCard;
    const spawned: number[] = [];
    const context: ZCEconomyContext = {
        rules: { unitCapPerSide: 20, spawnMinimumSeconds: 0.1 } as ZCEconomyContext['rules'],
        owners: ['player', 'enemy'],
        homeId: () => 0,
        bonuses: () => ({}) as ReturnType<ZCEconomyContext['bonuses']>,
        cardById: () => card,
        cycleSeconds: () => 4,
        grantGold: () => {},
        constructionComplete: () => {},
        unitCount: () => spawned.length,
        spawnUnit: () => { spawned.push(spawned.length + 1); },
        recruitPatch: () => ({
            recruitCdFlat: 1, recruitCdPct: -20, recruitMaxNumFlat: 3,
            singleRecruitNumFlat: 1, singleRecruitLegionCountFlat: 1,
        }),
    };
    return { context, spawned, card };
}

test('首批与周期产兵共用数量和人口限制，倒计时采用修正后的间隔', () => {
    const { context, spawned, card } = match();
    const hex = barracks();
    assert.equal(ZCEconomySystem.recruitIntervalSeconds(hex, card, context), 4);
    ZCEconomySystem.spawnFirstBarracksUnit(hex, context);
    assert.equal(spawned.length, 3);
    const state = { hexes: [hex], spawnClocks: { 'barracks:2': 0 } } as unknown as ZCSnapshot;
    ZCEconomySystem.tickBarracks(state, 4, context);
    assert.equal(spawned.length, 3);
    assert.equal(state.spawnClocks['barracks:2'], 0);
});

test('未配置 recruitPatch 时仍按卡表数量和原有间隔产兵', () => {
    const { context, spawned, card } = match();
    delete context.recruitPatch;
    const hex = barracks();
    assert.equal(ZCEconomySystem.recruitIntervalSeconds(hex, card, context), 4);
    ZCEconomySystem.spawnFirstBarracksUnit(hex, context);
    assert.equal(spawned.length, 2);
});
