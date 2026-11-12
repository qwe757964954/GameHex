import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { ZC_PORTAL_FLIGHT_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

test('传送抛物线按绝对时间计算，起终点贴地、中点抬高，重复渲染不累加', () => {
    const { load } = loadViews();
    const { portalFlightProgress, portalFlightLift } = load('./ZCGameViewUtil');
    assert.equal(portalFlightProgress(10, 9), 0);
    assert.equal(portalFlightProgress(10, 10), 0);
    assert.ok(Math.abs(portalFlightProgress(10, 10 + ZC_PORTAL_FLIGHT_SECONDS / 2) - 0.5) < 1e-9);
    assert.equal(portalFlightProgress(10, 20), 1);
    assert.equal(portalFlightLift(0), 0);
    assert.ok(portalFlightLift(0.5) > 0);
    assert.equal(portalFlightLift(1), 0);
    assert.equal(portalFlightLift(-1), 0);
    assert.ok(Math.abs(portalFlightLift(0.25) - portalFlightLift(0.75)) < 1e-9);
});

test('传送开合独立于地块圆环，按批次复用并回收，退出不残留', () => {
    const { makeEffectPool } = loadViews();
    const { effectPool, mapLayer } = makeEffectPool();
    const frame = { name: 'portal' };
    effectPool.playPortalFx(1, 10, 20, 0, frame);
    effectPool.playPortalFx(1, 10, 20, 0, frame);
    effectPool.playPortalFx(2, 30, 40, 0, frame);
    assert.equal(mapLayer.children.length, 2, '同一入口的同批多个单位只播一次');
    effectPool.recyclePortalFx(ZC_PORTAL_FLIGHT_SECONDS / 2);
    assert.ok(mapLayer.children[0].scale.x > 0);
    assert.equal(mapLayer.children[0].position.x, 10);
    effectPool.recyclePortalFx(ZC_PORTAL_FLIGHT_SECONDS);
    assert.equal(mapLayer.children.length, 0);
    effectPool.playPortalFx(1, 50, 60, 1, frame);
    assert.equal(mapLayer.children.length, 1);
    assert.equal(mapLayer.children[0].position.x, 50);
    effectPool.destroy();
    assert.equal(mapLayer.children.length, 0);
});

test('单位渲染从传送入口抛至出口，落地和后续行军恢复正常坐标', () => {
    const { load } = loadViews();
    const { mapToViewX, mapToViewY, portalFlightLift } = load('./ZCGameViewUtil');
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
    let rendered: { x: number; y: number };
    world.unitEntityBySource.set(1, 1);
    world.unitViews.set(1, { render: (value: { x: number; y: number }) => { rendered = { x: value.x, y: value.y }; } });
    const unit = { id: 1, unitId: 'test', sourceHexId: 1, freeX: 100, freeY: 50,
        battleState: 'born', portalFlight: { fromHexId: 0, barracksHexId: 2, startedAt: 0 } };
    const frame = { unitDefinitionsById: new Map([['test', {}]]), interpolationAlpha: 1, simulationStepSeconds: 0.05,
        mapConfig: { hexes: [{ x: 0, y: 0 }] }, snapshot: { elapsedSeconds: 0, status: 'playing' } };
    world.renderUnitEntity(unit, frame);
    assert.deepEqual(rendered, { x: 0, y: 0 });
    frame.snapshot.elapsedSeconds = ZC_PORTAL_FLIGHT_SECONDS / 2;
    world.renderUnitEntity(unit, frame);
    assert.ok(Math.abs(rendered.x - mapToViewX(50)) < 1e-9);
    assert.ok(Math.abs(rendered.y - mapToViewY(25) - portalFlightLift(0.5)) < 1e-9);
    frame.snapshot.elapsedSeconds = ZC_PORTAL_FLIGHT_SECONDS;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.x, mapToViewX(100));
    assert.equal(rendered.y, mapToViewY(50));
    unit.battleState = 'move'; unit.freeX = 120;
    frame.snapshot.elapsedSeconds += 1;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.x, mapToViewX(120));
});

test('棋盘在入口和出口同时播放开合，次数圆环保持原值，跳过动画末帧也回收', () => {
    const { load, FakeNode } = loadViews();
    const mapLayer = new FakeNode('MapLayer');
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer,
        neutralResourceFrames: new Map([['portal', { name: 'portal' }]]) });
    const cooldownBar = { progress: 2 / 3 };
    world.hexEntityBySource.set(0, 1);
    world.hexViews.set(1, { cooldownBar });
    const frame = { mapConfig: { hexes: [{ id: 0, x: 0, y: 0 }, { id: 1, x: 100, y: 0 }] },
        snapshot: { hexes: [{ id: 0, neutralFeature: { claimed: true, portalAt: 0, portalExitId: 1 } }],
            elapsedSeconds: ZC_PORTAL_FLIGHT_SECONDS / 2, status: 'playing' } };
    world.renderNeutralFeatures(frame);
    assert.equal(mapLayer.children.length, 2);
    assert.equal(cooldownBar.progress, 2 / 3);
    frame.snapshot.elapsedSeconds = ZC_PORTAL_FLIGHT_SECONDS * 2;
    world.renderNeutralFeatures(frame);
    assert.equal(mapLayer.children.length, 0);
    assert.equal(cooldownBar.progress, 2 / 3);
});
