import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeFixture } from './helpers/battle-runtime';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';

test('同阵营连通格共享成员数组，阵营边界与重开保持隔离', () => {
    const h = runtimeFixture();
    try {
        const snapshot = h.runtime.currentModel.exportSnapshot();
        for (const hex of snapshot.hexes) hex.developmentResolved = true;
        const model = new ZCGameModel(snapshot, () => .1, h.entry.matchConfig);
        const home = model.mapConfig.playerHomeId;
        const connected = model.connectedDevelopedHexIds(home);
        assert.ok(connected.length > 1);
        for (const id of connected) {
            assert.equal(model.snapshot.hexes[id].owner, 'player');
            assert.equal(model.connectedDevelopedHexIds(id), connected, '一个连通块只保存一份成员');
        }
        assert.notEqual(model.connectedDevelopedHexIds(model.mapConfig.enemyHomeId), connected);
        const isolated = model.exportSnapshot();
        const neighborIds = model.mapConfig.hexes[home].neighbors;
        for (const id of neighborIds) isolated.hexes[id].owner = 'enemy';
        const far = isolated.hexes.find(hex => hex.id !== home && !neighborIds.includes(hex.id));
        assert.ok(far);
        far.owner = 'player';
        const islands = new ZCGameModel(isolated, () => .1, h.entry.matchConfig);
        assert.deepEqual(islands.connectedDevelopedHexIds(home), [home]);
        assert.notEqual(islands.connectedDevelopedHexIds(home), islands.connectedDevelopedHexIds(far.id), '同阵营孤岛不能共享成员表');
        model.reset();
        assert.notEqual(model.connectedDevelopedHexIds(home), connected);
    } finally { h.dispose(); }
});

test('不足逻辑步复用地块投影与定义表，插值余量仍逐帧更新', () => {
    const h = runtimeFixture();
    try {
        const model = h.runtime.currentModel;
        const first = model.createRenderFrame();
        model.tick(.01);
        const interpolated = model.createRenderFrame();
        assert.equal(interpolated.hexesById, first.hexesById);
        assert.equal(interpolated.unitDefinitionsById, first.unitDefinitionsById);
        assert.ok(Math.abs(interpolated.interpolationAlpha - .2) < 1e-12);
        assert.equal(interpolated.snapshot.elapsedSeconds, 0);
        model.tick(.04);
        const advanced = model.createRenderFrame();
        assert.notEqual(advanced.hexesById, first.hexesById);
        assert.equal(advanced.unitDefinitionsById, first.unitDefinitionsById, '定义表来自本局编译结果，与在场单位数量无关');
        for (const [id, hex] of advanced.hexesById) {
            assert.equal(hex.canDevelop, model.canPlayerDevelop(id));
            assert.deepEqual(hex.cooldown, model.buildingCooldown(id));
        }
    } finally { h.dispose(); }
});

test('同步开发立即刷新投影及连通关系，重开不保留旧状态与事件', () => {
    const h = runtimeFixture();
    try {
        const model = h.runtime.currentModel;
        const first = model.createRenderFrame();
        const target = Array.from(first.hexesById.values()).find(hex => hex.canDevelop && hex.state.developmentCost <= first.snapshot.playerGold);
        assert.ok(target);
        const home = first.mapConfig.playerHomeId;
        const connected = model.connectedDevelopedHexIds(home);
        assert.equal(model.developHex(target.state.id).ok, true);
        const developed = model.createRenderFrame();
        assert.notEqual(developed.hexesById, first.hexesById);
        assert.equal(developed.hexesById.get(target.state.id).canDevelop, model.canPlayerDevelop(target.state.id));
        assert.notEqual(model.connectedDevelopedHexIds(home), connected);
        const drained = model.drainPresentationEvents();
        model.createRenderFrame();
        assert.deepEqual(model.drainPresentationEvents().buildingShakes, [], '投影读取不能重新发布已消费通知');
        assert.ok(drained);
        model.reset();
        const reset = model.createRenderFrame();
        assert.notEqual(reset.hexesById, developed.hexesById);
        assert.notEqual(reset.snapshot, developed.snapshot);
        assert.equal(reset.snapshot.elapsedSeconds, 0);
    } finally { h.dispose(); }
});

test('神器成功立即使投影失效，失败操作保留缓存，未推进逻辑步也能读取最新状态', () => {
    const h = runtimeFixture();
    try {
        const snapshot = h.runtime.currentModel.exportSnapshot();
        snapshot.artifactReadyUses = 1;
        snapshot.artifactCooldown = 0;
        const model = new ZCGameModel(snapshot, () => .1, h.entry.matchConfig);
        const before = model.createRenderFrame();
        assert.equal(model.useArtifact().ok, true);
        const after = model.createRenderFrame();
        assert.notEqual(after.hexesById, before.hexesById);
        assert.equal(after.unitDefinitionsById, before.unitDefinitionsById);
        assert.equal(after.snapshot.artifactReadyUses, 0);
        assert.ok(after.snapshot.artifactCooldown > 0);
        assert.equal(after.snapshot.elapsedSeconds, 0);
        assert.equal(model.useArtifact().ok, false);
        assert.equal(model.createRenderFrame().hexesById, after.hexesById);
    } finally { h.dispose(); }
});
