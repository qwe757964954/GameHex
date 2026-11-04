import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadViews } from './helpers/zcds-view-fixtures';

test('unit art queries use their injected match and missing art emits the actual owner once', () => {
    const { load } = loadViews();
    const events = load('../../../framework/event/EventMgr').EventMgr.instance;
    const intents = load('./ZCGameHudEvents').ZCGameUiEvent;
    const View = load('./ZCUnitView').ZCUnitView;
    const a = new View(), b = new View();
    const first = {}, second = {}, ownerA = {}, ownerB = {}, listener = {};
    const artA = { unitVisualPrefabs: new Map([['probe', first]]) };
    const artB = { unitVisualPrefabs: new Map([['probe', second]]) };
    a.setPresentationArt(artA, ownerA);
    b.setPresentationArt(artB, ownerB);
    const definition = { unitId: 'probe', prefabPath: 'units/probe' };
    assert.equal(a.resolveVisual(definition), first);
    assert.equal(b.resolveVisual(definition), second);
    const received: unknown[] = [];
    events.on(intents.RequestUnitArt, (intent: unknown) => received.push(intent), listener);
    try {
        artA.unitVisualPrefabs.clear();
        a.resolveVisual(definition);
        a.resolveVisual(definition);
        assert.equal(received.length, 1);
        assert.equal((received[0] as { owner: object }).owner, ownerA);
        artA.unitVisualPrefabs.set('probe', first);
        assert.equal(a.resolveVisual(definition), first, '迟到资源通过同局只读表可见');
        assert.equal(b.resolveVisual(definition), second, '不能串到另一局');
    } finally { events.offTarget(listener); }
});

test('card and building art retain match-local priority and late card updates', () => {
    const { load, presentationArt } = loadViews();
    const card = {}, custom = {}, hq = {}, barracks = {}, fallback = {};
    presentationArt.buildingFramesByCardId.set('probe', custom);
    presentationArt.buildingFrames.set('hq-base', hq);
    presentationArt.buildingFrames.set('barracks-default', barracks);
    const buildingArt = load('./ZCGameViewUtil').zcBuildingArt;
    assert.equal(buildingArt(presentationArt, 'probe', 'barracks'), custom);
    assert.equal(buildingArt(presentationArt, 'other', 'hq'), hq);
    assert.equal(buildingArt(presentationArt, null, 'barracks'), barracks);
    assert.equal(buildingArt(presentationArt, null, 'mine'), null);
    const view = new (load('./ZCCardRevealView').ZCCardRevealView)();
    view.frameForBuilding = () => fallback;
    const reveal = { cardId: 'probe', building: 'barracks', owner: 'player' };
    assert.equal(view.frameForArt(reveal), custom);
    presentationArt.cardArtFrames.set('probe', card);
    assert.equal(view.frameForArt(reveal), card, '异步补齐的卡面优先于建筑图');
    presentationArt.cardArtFrames.clear();
    presentationArt.buildingFramesByCardId.clear();
    presentationArt.buildingFrames.clear();
    assert.equal(view.frameForArt(reveal), fallback, '缺图仍用 prefab 的类型回退');
});

test('unit/card/world presentation cannot reach the current procedure or load assets directly', () => {
    for (const file of ['ZCUnitView', 'ZCCardRevealView', 'ZCGameRenderWorld']) {
        const source = readFileSync(`assets/script/app/zcds/view/${file}.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
        assert.doesNotMatch(source, /ProcedureGame|resources\.load|\.assets\.load|requestUnitPrefab/);
    }
});
