import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import { configureZCMap, ZCGameModel, type ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { getPlayerDeck, getEnemyDeck } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function rows(name: string) {
    const value = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return Array.isArray(value) ? value : value.v.map((row: unknown[]) =>
        Object.fromEntries(value.k.map((key: string, i: number) => [key, row[i]])));
}
const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams'];
loadPvpTables(Object.fromEntries(names.map(name => [name, rows(name)])) as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);
const config = captureZCMatchConfig();
const baseCard = getPlayerDeck().find(card => card.unitId);
assert.ok(baseCard);
const forcedCard = { ...baseCard, id: '999001', name: 'GM测试卡' };
ZC_RUNTIME_CONFIG.updateCatalogs({ cardCatalog: new Map([...getPlayerDeck(), ...getEnemyDeck(), forcedCard].map(card => [card.id, card])) });

function fixture() {
    const game = new ZCGameModel(null, () => 0.1, config);
    const state = game.snapshot;
    state.playerGold = 100000;
    return new ZCGameModel(state, () => 0.1, config);
}
function flip(game: ZCGameModel) {
    const hex = game.snapshot.hexes.find(hex => game.canPlayerDevelop(hex.id));
    assert.ok(hex);
    assert.equal(game.developHex(hex.id).ok, true);
    return game.snapshot.hexes[hex.id];
}

test('GM 加金币只修改本局我方金币，拒绝非法数量、溢出与已结束对局', () => {
    const game = fixture();
    const before = { ...game.snapshot };
    assert.equal(game.addDebugGold(123).ok, true);
    assert.equal(game.snapshot.playerGold, before.playerGold + 123);
    assert.equal(game.snapshot.goldByOwner.player, before.playerGold + 123);
    assert.equal(game.snapshot.enemyGold, before.enemyGold);
    for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(game.addDebugGold(amount).ok, false);
        assert.equal(game.snapshot.playerGold, before.playerGold + 123);
    }
    const ended = game.snapshot;
    ended.status = 'victory';
    const finished = new ZCGameModel(ended, () => 0.1, config);
    assert.equal(finished.addDebugGold(1).ok, false);
    assert.equal(finished.snapshot.playerGold, ended.playerGold);
    game.reset();
    assert.equal(game.snapshot.playerGold, new ZCGameModel(null, () => 0.1, config).snapshot.playerGold);
});

test('本地指定卡跨地块类型生效，按次数消耗，耗尽恢复随机并保留已生成单位的卡定义', () => {
    const game = fixture();
    assert.equal(game.setDebugDrawCard(forcedCard.id, 2).ok, true);
    for (let i = 0; i < 2; i++) {
        const hex = flip(game);
        assert.equal(hex.cardId, forcedCard.id);
        assert.equal(hex.building, 'barracks');
        assert.ok(game.cardReveals.some(reveal => reveal.cardId === forcedCard.id && reveal.hexId === hex.id));
    }
    assert.notEqual(flip(game).cardId, forcedCard.id);
    game.tick(2);
    assert.ok(game.snapshot.units.some(unit => unit.cardId === forcedCard.id));
});

test('失败翻格和非法参数不消耗或覆盖有效设置，再次设置覆盖剩余次数', () => {
    const game = fixture();
    assert.equal(game.setDebugDrawCard(forcedCard.id, 2).ok, true);
    assert.equal(game.developHex(-1).ok, false);
    for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(game.setDebugDrawCard(forcedCard.id, count).ok, false);
    }
    assert.equal(game.setDebugDrawCard('missing', 3).ok, false);
    assert.equal(flip(game).cardId, forcedCard.id);
    assert.equal(game.setDebugDrawCard(baseCard.id, 1).ok, true);
    assert.equal(flip(game).cardId, baseCard.id);
    assert.notEqual(flip(game).cardId, forcedCard.id);
});

test('金币不足不消耗设置，重开与新实例清空，已结束的战斗拒绝设置', () => {
    const game = fixture();
    const poor = game.snapshot;
    poor.playerGold = 0;
    const poorGame = new ZCGameModel(poor, () => 0.1, config);
    assert.equal(poorGame.setDebugDrawCard(forcedCard.id, 1).ok, true);
    const target = poorGame.snapshot.hexes.find(hex => poorGame.canPlayerDevelop(hex.id));
    assert.ok(target);
    assert.equal(poorGame.developHex(target.id).ok, false);
    for (let i = 0; i < 10 && poorGame.snapshot.playerGold < target.developmentCost; i++) poorGame.tick(5);
    assert.equal(poorGame.developHex(target.id).ok, true);
    assert.equal(poorGame.snapshot.hexes[target.id].cardId, forcedCard.id);
    assert.equal(game.setDebugDrawCard(forcedCard.id, 5).ok, true);
    game.reset();
    assert.notEqual(flip(game).cardId, forcedCard.id);
    assert.notEqual(flip(fixture()).cardId, forcedCard.id);
    const ended = game.snapshot;
    ended.status = 'victory';
    assert.equal(new ZCGameModel(ended, () => 0.1, config).setDebugDrawCard(forcedCard.id, 1).ok, false);
});

test('AI 翻格不使用也不消耗我方 GM 卡，GM 抽卡保持原保底进度', () => {
    const state = fixture().snapshot;
    state.enemyGold = 100000;
    const game = new ZCGameModel(state, () => 0.1, {
        ...config, rules: { ...config.rules, enemyAiIntervalSeconds: 0.1 },
    });
    const before = game.snapshot.hexes.filter(hex => hex.owner === 'enemy' && hex.developmentResolved).length;
    assert.equal(game.setDebugDrawCard(forcedCard.id, 1).ok, true);
    game.tick(5);
    assert.ok(game.snapshot.hexes.filter(hex => hex.owner === 'enemy' && hex.developmentResolved).length > before);
    assert.equal(game.snapshot.hexes.some(hex => hex.owner === 'enemy' && hex.cardId === forcedCard.id), false);
    const pity = game.snapshot.allRandomNonGoldDraws.player;
    assert.equal(flip(game).cardId, forcedCard.id);
    assert.equal(game.snapshot.allRandomNonGoldDraws.player, pity);
    assert.notEqual(flip(game).cardId, forcedCard.id);
});

test('GM 本地指令不联网，参数错误与无对局有反馈，结果监听随执行解除', async () => {
    const exports: Record<string, any> = {};
    const tips: string[] = [];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/gm/GMCommandTable.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/ZCGameHudEvents')) return { ZCGameUiEvent };
        if (name.endsWith('/GameNet')) return { GameNet: { get instance() { throw new Error('本地发卡不应联网'); } } };
        return {};
    } });
    const table = exports.GMCommandTable;
    table.onTip = (message: string) => tips.push(message);
    table.init();
    assert.ok(table.getCommandList().some((item: { gm: string }) => item.gm.startsWith('addBattleCard ')));
    assert.ok(table.getCommandList().some((item: { gm: string }) => item.gm === 'addBattleGold 100000'));
    await table.execute('addBattleGold 100');
    assert.match(tips.at(-1), /先进入战斗/);
    const goldOwner = {};
    let goldRequests = 0;
    EventMgr.instance.on(ZCGameUiEvent.DebugAddGold, (amount: number) => {
        goldRequests++;
        assert.equal(amount, 123);
        EventMgr.instance.emit(ZCGameUiEvent.DebugAddGoldResult, { message: '加金币成功' });
    }, goldOwner);
    try {
        for (const command of ['addBattleGold', 'addBattleGold abc', 'addBattleGold 0', 'addBattleGold -1',
            'addBattleGold 1.5', 'addBattleGold Infinity', 'addBattleGold 9007199254740992', 'addBattleGold 1 2']) {
            await table.execute(command);
            assert.match(tips.at(-1), /用法/);
        }
        assert.equal(goldRequests, 0);
        assert.equal(await table.execute('addBattleGold 123'), true);
        assert.equal(goldRequests, 1);
        assert.equal(tips.at(-1), '加金币成功');
    } finally {
        EventMgr.instance.offTarget(goldOwner);
    }
    const goldTips = tips.length;
    EventMgr.instance.emit(ZCGameUiEvent.DebugAddGoldResult, { message: '迟到金币结果' });
    assert.equal(tips.length, goldTips);
    assert.equal(await table.execute('addBattleCard 68001 1'), true);
    assert.match(tips.at(-1), /先进入战斗/);
    await table.execute('addBattleCard 68001 abc');
    assert.match(tips.at(-1), /用法/);
    const owner = {};
    EventMgr.instance.on(ZCGameUiEvent.DebugDrawCard, (intent) => {
        assert.equal(intent.cardId, '68001');
        assert.equal(intent.count, 2);
        EventMgr.instance.emit(ZCGameUiEvent.DebugDrawCardResult, { message: '设置成功' });
    }, owner);
    try {
        await table.execute('addBattleCard 68001 2');
        assert.equal(tips.at(-1), '设置成功');
    } finally {
        EventMgr.instance.offTarget(owner);
    }
    await table.execute('addBattleCard 68001 1');
    assert.match(tips.at(-1), /先进入战斗/);
    const before = tips.length;
    EventMgr.instance.emit(ZCGameUiEvent.DebugDrawCardResult, { message: '迟到结果' });
    assert.equal(tips.length, before);
});
