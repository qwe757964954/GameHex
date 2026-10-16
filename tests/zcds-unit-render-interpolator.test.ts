import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCUnitRenderInterpolator } from '../assets/script/app/zcds/view/ZCUnitRenderInterpolator';

test('单位插值只使用相邻逻辑帧，停顿和长帧直接定位', () => {
    const interpolator = new ZCUnitRenderInterpolator();
    const unit = { id: 7, freeX: 0, freeY: 2 };
    const frame = {
        simulationStepSeconds: 0.05,
        interpolationAlpha: 0,
        snapshot: { elapsedSeconds: 0, status: 'playing' },
    };
    assert.deepEqual(interpolator.positionOf(unit, frame), { x: 0, y: 2 });

    unit.freeX = 10;
    frame.snapshot.elapsedSeconds = 0.05;
    assert.deepEqual(interpolator.positionOf(unit, frame), { x: 0, y: 2 });
    frame.interpolationAlpha = 0.5;
    assert.deepEqual(interpolator.positionOf(unit, frame), { x: 5, y: 2 });

    unit.freeX = 20;
    frame.snapshot.elapsedSeconds = 0.2;
    assert.deepEqual(interpolator.positionOf(unit, frame), { x: 20, y: 2 }, '逻辑时间跳步后不跨长距离插值');
    interpolator.forget(unit.id);
    unit.freeX = 30;
    assert.deepEqual(interpolator.positionOf(unit, frame), { x: 30, y: 2 }, '实体移除后不保留旧采样点');
});
