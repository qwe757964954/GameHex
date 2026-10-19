/**
 * 建筑「生成动画：抖动」（需求 2026-10-15）：
 *  · **row5**（战斗系统）：兵营**每一次【生成单位倒计时】结束**时，建筑模型（根下的
 *    `BuildingIcon`）原地抖一次 —— 先 Y 轴拉 110% 回落、再 X 轴拉 110% 回落。
 *  · **row12 / row13**（经济 / 建筑动画）：「同时优化【建筑生成动画】，建筑模型放大比例
 *    从 110% 改成 120%」 + 「金币产出时建筑抖动」⇒ 主城 / 金矿产金也走同一条抖动，
 *    且**建筑**这一档的拉伸量抬到 120%（**单位**自己出生那一下仍是 110%）。
 *
 * 判据钉五件事：
 *  1. 两段曲线 `spawnShakeScaleY` / `spawnShakeScaleX`：先 Y 后 X、段外恒 1、
 *     缺省 = 单位档 110%、显式传 `BUILDING_SHAKE_STRETCH` = 建筑档 120%；
 *  2. `ZCHexView.playBuildingShake` + `advanceBuildingShake` 把抖动**乘进** `applyBuildingScale`
 *     （基准 0.72 × 因子），播完复位并返回 false；
 *  3. `ZCBattlePresentationQueue.push/drainBuildingShake`：**取走即空**（抖动不幂等）、
 *     超上限丢最旧、`reset` 清空（换局不许带出上一局的通知）；
 *  4. `ZCGameModel` 只在产金**真的发出去**时推通知（击杀 / 拆建筑奖励那条私有 `grantGold` 不抖）；
 *  5. `ZCGameRenderWorld.renderUnitEntity` 的 `isBirth` 分支在**兵营格**产兵时登记抖动，
 *     并与 `renderDynamic` 每帧推进（`renderHexSystem` 是 0.15s 节流，播不出 0.24s 的抖动）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_PHASE_SECONDS,
    SPAWN_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../assets/script/app/zcds/view/ZCGameViewUtil';
import { ZCBattlePresentationQueue } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

/** `ZCHexView.BUILDING_ICON_SCALE`（模块私有）：建筑外观的基准缩放。 */
const EXPECTED = 0.72;
const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-9;

function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

test('spawnShakeScaleX/Y：先 Y 后 X 的两段脉冲，段外恒 1，拉伸量参数化', () => {
    const half = SPAWN_SHAKE_PHASE_SECONDS / 2;
    const peak = 1 + SPAWN_SHAKE_STRETCH;
    // Y 段（前半）：Y 到 1.1，X 不动。
    assert.ok(near(spawnShakeScaleY(half), peak), `Y 段中点应到 1.1，实际 ${spawnShakeScaleY(half)}`);
    assert.equal(spawnShakeScaleX(half), 1, 'Y 阶段 X 不动');
    // X 段（后半）：X 到 1.1，Y 已回落。
    assert.ok(near(spawnShakeScaleX(SPAWN_SHAKE_PHASE_SECONDS * 1.5), peak), 'X 段中点应到 1.1');
    assert.equal(spawnShakeScaleY(SPAWN_SHAKE_PHASE_SECONDS * 1.5), 1, 'X 阶段 Y 已回落');
    // 边界 / 段外：一律 1。
    for (const t of [0, -1, SPAWN_SHAKE_TOTAL_SECONDS, SPAWN_SHAKE_TOTAL_SECONDS + 1]) {
        assert.equal(spawnShakeScaleY(t), 1, `Y 在 t=${t} 应为 1`);
        assert.equal(spawnShakeScaleX(t), 1, `X 在 t=${t} 应为 1`);
    }
});

test('★row12 建筑档拉伸量 = 120%，形状/相位与单位档完全一致', () => {
    // 需求原文「建筑模型放大比例从 110% 改成 120%」。
    assert.equal(BUILDING_SHAKE_STRETCH, 0.2, '建筑档应为 1 + 0.2 = 120%');
    assert.equal(SPAWN_SHAKE_STRETCH, 0.1, '单位档保持 110%（需求只点建筑模型）');
    assert.ok(BUILDING_SHAKE_STRETCH > SPAWN_SHAKE_STRETCH, '建筑档必须比单位档大');

    const half = SPAWN_SHAKE_PHASE_SECONDS / 2;
    assert.ok(near(spawnShakeScaleY(half, BUILDING_SHAKE_STRETCH), 1.2),
        `建筑 Y 段中点应到 1.2，实际 ${spawnShakeScaleY(half, BUILDING_SHAKE_STRETCH)}`);
    assert.ok(near(spawnShakeScaleX(SPAWN_SHAKE_PHASE_SECONDS * 1.5, BUILDING_SHAKE_STRETCH), 1.2),
        '建筑 X 段中点应到 1.2');
    // 相位不受 stretch 影响：同一时刻「谁在动」必须一致。
    for (const [y, x, label] of [
        [spawnShakeScaleY(half, BUILDING_SHAKE_STRETCH), spawnShakeScaleX(half, BUILDING_SHAKE_STRETCH), 'Y 段'],
        [spawnShakeScaleY(SPAWN_SHAKE_PHASE_SECONDS * 1.5, BUILDING_SHAKE_STRETCH),
            spawnShakeScaleX(SPAWN_SHAKE_PHASE_SECONDS * 1.5, BUILDING_SHAKE_STRETCH), 'X 段'],
    ] as const) {
        assert.equal(x === 1, label === 'Y 段', `${label}：只有一段在动`);
        assert.equal(y === 1, label === 'X 段', `${label}：另一端回落`);
    }
    // 段外仍恒 1（不能因为换了档位就忘了复位）。
    for (const t of [-1, 0, SPAWN_SHAKE_TOTAL_SECONDS, SPAWN_SHAKE_TOTAL_SECONDS + 1]) {
        assert.equal(spawnShakeScaleY(t, BUILDING_SHAKE_STRETCH), 1, `建筑 Y 在 t=${t} 应为 1`);
        assert.equal(spawnShakeScaleX(t, BUILDING_SHAKE_STRETCH), 1, `建筑 X 在 t=${t} 应为 1`);
    }
});

test('建筑生成抖动：playBuildingShake 后在基准 0.72 上叠「先 Y 后 X」的 120%，播完复位', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const node = view.buildingSprite.node;
    const peak = 1 + BUILDING_SHAKE_STRETCH;

    // 还没登记抖动时：直接返回 false，且**不写**缩放（早退分支）。
    assert.equal(view.advanceBuildingShake(0), false, '没登记抖动时 advanceBuildingShake 直接返回 false');

    view.playBuildingShake(0);

    // Y 段中点：Y = 0.72 × 1.2，X 仍 0.72。
    assert.equal(view.advanceBuildingShake(SPAWN_SHAKE_PHASE_SECONDS / 2), true, '抖动中应返回 true');
    assert.ok(near(node.scale.y, EXPECTED * peak),
        `Y 段中点应到 0.72 × 1.2，实际 ${node.scale.y}`);
    assert.ok(near(node.scale.x, EXPECTED), 'Y 段 X 保持基准');

    // X 段中点：X = 0.72 × 1.2，Y 回落 0.72。
    assert.equal(view.advanceBuildingShake(SPAWN_SHAKE_PHASE_SECONDS * 1.5), true);
    assert.ok(near(node.scale.x, EXPECTED * peak),
        `X 段中点应到 0.72 × 1.2，实际 ${node.scale.x}`);
    assert.ok(near(node.scale.y, EXPECTED), 'X 段 Y 已回落基准');

    // 播完：返回 false 且复位基准（不能停在被拉长的姿态）。
    assert.equal(view.advanceBuildingShake(SPAWN_SHAKE_PHASE_SECONDS * 3), false, '播完应返回 false');
    assert.ok(near(node.scale.x, EXPECTED) && near(node.scale.y, EXPECTED), '播完复位基准缩放');
    // 再推一次：没在抖就直接 false，且不改缩放。
    assert.equal(view.advanceBuildingShake(100), false);
    assert.ok(near(node.scale.x, EXPECTED) && near(node.scale.y, EXPECTED));
});

test('★row12 抖动通知队列：取走即空、超上限丢最旧、reset 清空', () => {
    const queue = new ZCBattlePresentationQueue();

    // 空队列：返回共享空数组（渲染层常态零分配），且**不换**数组。
    const empty = queue.drainBuildingShakes();
    assert.equal(empty.length, 0, '空队列取走应为空');
    assert.equal(queue.drainBuildingShakes(), empty, '空队列应复用同一个共享数组');

    queue.pushBuildingShake(11);
    queue.pushBuildingShake(12);
    const first = queue.drainBuildingShakes();
    assert.deepEqual(first.map((event) => event.hexId), [11, 12], '按推入顺序取走');
    assert.ok(first.every((event) => Number.isFinite(event.id) && event.id > 0), '每条都要有正 id');
    // ★ 取走即空：抖动不幂等，同一 tick 再读一次必须什么都拿不到（否则会重头再抖）。
    assert.equal(queue.drainBuildingShakes().length, 0, '取出后队列必须已空');

    // 交出去的数组是**原来那条**、内部换了新的接手 ⇒ 调用方可以安全遍历。
    assert.equal(first.length, 2, '调用方手上的数组内容不被后续 push 影响');
    queue.pushBuildingShake(13);
    assert.equal(first.length, 2, '后续 push 不得改到已交出的数组');

    // id 单调递增（即便中间被取空也要继续走），换局后才从头。
    const ids = [queue.drainBuildingShakes()[0].id];
    queue.pushBuildingShake(14);
    ids.push(queue.drainBuildingShakes()[0].id);
    assert.ok(ids[1] > ids[0], `id 必须递增，实际 ${ids.join(' -> ')}`);

    // 非法 hexId（NaN / Infinity）不登记。
    queue.pushBuildingShake(Number.NaN);
    queue.pushBuildingShake(Number.POSITIVE_INFINITY);
    assert.equal(queue.drainBuildingShakes().length, 0, '非法 hexId 不该入队');

    // 上限：丢最旧的，不许涨成内存泄漏。
    for (let i = 0; i < 40; i += 1) queue.pushBuildingShake(100 + i);
    const capped = queue.drainBuildingShakes();
    assert.equal(capped.length, 32, '上限应为 32');
    assert.equal(capped[0].hexId, 108, '超出部分丢最旧');
    assert.equal(capped[capped.length - 1].hexId, 139, '保留最新的');

    // reset（换局）：队列清空、id 从头。
    queue.pushBuildingShake(7);
    queue.reset();
    assert.equal(queue.drainBuildingShakes().length, 0, 'reset 必须清空抖动通知');
    queue.pushBuildingShake(8);
    assert.equal(queue.drainBuildingShakes()[0].id, 1, 'reset 后 id 从头计');
});

test('★row12/row13 ZCGameModel：产金真的发出去才推通知，且 takeBuildingShakes 取走即空', () => {
    const source = readFileSync('assets/script/app/zcds/model/ZCGameModel.ts', 'utf8');

    // ① 产金回调里推通知，并且**与 grantGold 内部那道闸同口径**（金额非法 / <= 0 不抖）。
    assert.match(source,
        /grantGold: \(owner, amount, hexId\) => \{[\s\S]{0,900}?if \(Number\.isFinite\(amount\) && amount > 0\) this\.presentation\.pushBuildingShake\(hexId\)/,
        'economyContext.grantGold 必须把「建筑该抖了」推给表现队列');
    // ② 挂的位置必须是 economyContext（产金），不是私有 grantGold（击杀 / 拆建筑奖励也在走它）。
    assert.match(source,
        /pushBuildingShake\(hexId\);[\s\S]{0,200}?constructionComplete:/,
        '推通知必须在 economyContext 内、且紧邻其它经济回调');
    assert.match(source, /killReward|击杀/, '文件应仍有击杀奖励那条私有路径（对照，确认两者分开）');
    // ③ 出口转发给队列。
    assert.match(source,
        /takeBuildingShakes\(\): readonly Readonly<ZCBuildingShake>\[\] \{[\s\S]{0,120}?return this\.presentation\.drainBuildingShakes\(\);/,
        'takeBuildingShakes 必须转发到 drainBuildingShakes（取走即空）');
});

test('ZCGameRenderWorld：兵营产兵时登记建筑抖动，并在 renderDynamic 每帧推进', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');

    // ① isBirth 分支：出生单位来自兵营格时登记抖动。
    const start = source.indexOf('private renderUnitEntity');
    const end = source.indexOf('private injectResourceUnits');
    assert.ok(start > 0 && end > start, 'renderUnitEntity 必须存在');
    const body = source.slice(start, end);
    assert.match(body,
        /if \(isBirth && model\) \{[\s\S]*?triggerBuildingShake\(unit\.sourceHexId, presentation\.now\)/,
        '单位首次出现（isBirth）时必须登记建筑抖动');

    // ② 只对兵营触发（主城 / 金矿的抖动走产金那条通知，两者别混）。
    assert.match(body,
        /building === 'barracks'\)[\s\S]{0,160}?triggerBuildingShake\(unit\.sourceHexId, presentation\.now\)/,
        '只对兵营格触发产兵抖动');

    // ③ renderDynamic 必须每帧推进（renderStatic 是 0.15s 节流，播不出 0.24s 的抖动），
    //    并且推进前先取走模型攒下的产金通知。
    assert.match(source, /renderHexActivations\(model\);[\s\S]*?renderBuildingShakes\(model\);/,
        'renderDynamic 必须每帧推进建筑抖动');
    assert.match(source,
        /private renderBuildingShakes\(model: ZCGameModel\): void \{[\s\S]{0,200}?model\.takeBuildingShakes\(\)/,
        'renderBuildingShakes 必须先取走产金通知（抖动不幂等）');
});
