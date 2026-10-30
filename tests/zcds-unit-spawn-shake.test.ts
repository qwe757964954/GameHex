/**
 * 建筑生成单位时的「出生抖动」：原地 Y 拉 110% 回落、再 X 拉 110% 回落。
 *
 * 判据钉三件事：
 *  1. 脉冲曲线 `spawnShakePulse`：单段内 1 → 1.1 → 1，段外 clamp；
 *  2. `ZCUnitView.playSpawnShake` + `render` 按「先 Y 后 X」的时序把抖动叠到朝向之上；
 *  3. `ZCGameRenderWorld.renderUnitEntity` 在单位**首次出现**（isBirth）时触发它。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { spawnShakePulse, SPAWN_SHAKE_PHASE_SECONDS, SPAWN_SHAKE_STRETCH } from '../assets/script/app/zcds/view/ZCGameViewUtil';

test('spawnShakePulse：单段内 1 → 1.1 → 1，段外 clamp', () => {
    assert.ok(Math.abs(spawnShakePulse(0) - 1) < 1e-9);
    assert.ok(Math.abs(spawnShakePulse(0.5) - (1 + SPAWN_SHAKE_STRETCH)) < 1e-9, '中点必须到 1.1');
    assert.ok(Math.abs(spawnShakePulse(1) - 1) < 1e-9);
    assert.equal(spawnShakePulse(-1), 1, '负进度按边界处理');
    assert.equal(spawnShakePulse(2), 1, '越界按边界处理');
});

test('单位出生抖动：先 Y 拉 110% 回落、再 X 拉 110% 回落，结束回基准', () => {
    const { load, bar, cc, FakeNode, procedureGame } = loadViews();
    const view = new (load('./ZCUnitView').ZCUnitView)();
    // 组件宿主节点：attachVisual 里会 `visual.layer = this.node.layer`，缺了就是
    // 「Cannot set properties of undefined (setting 'layer')」。
    (view as unknown as { node: unknown }).node = new FakeNode();
    view.rootTransform = { setContentSize() {} };
    view.visualRoot = new FakeNode();
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: new FakeNode(), clear() {}, circle() {}, fill() {} };
    view.fallbackLabel = { node: new FakeNode(), enabled: true, string: '' };
    view.healthBar = bar();
    // 序列帧形态：Sprite + Animation（canvas 归一系数为 1 ⇒ 基准缩放 = 1）。
    const prefab = {
        make: () => {
            const node = new FakeNode();
            const animation = { clips: [{ name: 'unit-idle' }], defaultClip: null, play() {}, stop() {} };
            node.getComponent = ((type: unknown) => type === cc.Sprite ? { color: null }
                : type === cc.Animation ? animation : null) as typeof node.getComponent;
            return node;
        },
    };
    // ⚠️ `initialize` 签名变了（2026-10-16）：不再从入参收 prefab / prefabSize，
    //    改为 `ProcedureGame.current?.resolveUnitPrefab(definition.unitId)` 现取 + `definition.prefabSize`。
    //    继续传第二参会被忽略 ⇒ prefab 取不到 ⇒ `visualNode` 永远是 null ⇒ 读 `.scale` 直接崩。
    procedureGame.current = { resolveUnitPrefab: () => prefab };
    view.initialize({ unitId: 'test-unit', hero: false, attackRange: 20, prefabSize: 1 });
    const unit = { hp: 100, maxHp: 100, owner: 'player', battleState: 'idle', facingRadians: 0, completedAttackCount: 0 };
    const definition = { unitId: 'test-unit', hero: false, attackRange: 20, prefabSize: 1 };
    const render = (now: number) => view.render({ unit, definition, x: 0, y: 0, now });
    const scale = () => view.visualNode.scale;

    // 抖动前：基准缩放（1,1,1）。
    render(0);
    assert.ok(Math.abs(scale().x - 1) < 1e-9 && Math.abs(scale().y - 1) < 1e-9, '抖动前是基准缩放');

    view.playSpawnShake(0);

    // Y 段中点：Y 到 1.1、X 不动。
    render(SPAWN_SHAKE_PHASE_SECONDS / 2);
    assert.ok(Math.abs(scale().y - (1 + SPAWN_SHAKE_STRETCH)) < 1e-9, `Y 段中点应到 1.1，实际 ${scale().y}`);
    assert.ok(Math.abs(scale().x - 1) < 1e-9, 'Y 段 X 不动');

    // X 段中点：X 到 1.1、Y 已回落。
    render(SPAWN_SHAKE_PHASE_SECONDS * 1.5);
    assert.ok(Math.abs(scale().x - (1 + SPAWN_SHAKE_STRETCH)) < 1e-9, `X 段中点应到 1.1，实际 ${scale().x}`);
    assert.ok(Math.abs(scale().y - 1) < 1e-9, 'X 段 Y 已回落');

    // 抖动结束：回基准缩放。
    render(SPAWN_SHAKE_PHASE_SECONDS * 3);
    assert.ok(Math.abs(scale().x - 1) < 1e-9 && Math.abs(scale().y - 1) < 1e-9, '抖动结束后回基准缩放');
});

test('建筑生成单位时触发出生抖动（renderUnitEntity 的 isBirth 分支）', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const start = source.indexOf('private renderUnitEntity');
    const end = source.indexOf('private injectResourceUnits');
    assert.ok(start > 0 && end > start, 'renderUnitEntity 必须存在');
    const body = source.slice(start, end);
    // ⚠️ 条件已简化成 `if (isBirth)`（原先 `isBirth && model`）—— `model` 判空移到上游了，
    //    抖动语义没变：新生单位同一拍里 playSpawnShake。
    assert.match(body, /if \(isBirth\) \{[\s\S]*?playSpawnShake\(presentation\.now\)/,
        '单位首次出现（isBirth）必须触发出生抖动');
});
