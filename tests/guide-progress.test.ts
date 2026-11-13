/**
 * 新手引导步骤机（`GuideProgress`）的行为判据。
 *
 * 夹具直接用 `assets/remoteRef/guideStep.json` 真表 —— 不复制算法、不另造一份假数据，
 * 表被改坏（断链 / 步数变化）这里会直接红。
 *
 * 覆盖四类风险：
 *   ① 乱序/重复完成导致重复发奖；② 断线续跑重放已完成的步；
 *   ③ 跳过时漏发剩余奖励；④ 表本身断链但没人发现。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_STEP_END, parseGuideSteps } from '../assets/script/app/guide/model/GuideStepConfig';
import type { GuideStep } from '../assets/script/app/guide/model/GuideStepConfig';
import { GuideProgress } from '../assets/script/app/guide/model/GuideProgress';

const RAW = JSON.parse(
    readFileSync('assets/remoteRef/guideStep.json', 'utf8'),
) as { k: string[]; v: unknown[][] };

/** 列存 `{k,v}` → 行对象数组（等价 `RefUtil.getRefAll` 的效果）。 */
function unflatten(raw: { k: string[]; v: unknown[][] }): Record<string, unknown>[] {
    return raw.v.map((row) => {
        const out: Record<string, unknown> = {};
        raw.k.forEach((key, index) => { out[key] = row[index]; });
        return out;
    });
}

const STEPS = parseGuideSteps(unflatten(RAW));

/** 一路点到指定步之前的最后一步；返回走到的步 id 序列。 */
function walkTo(progress: GuideProgress, stopAt: string): string[] {
    const walked: string[] = [];
    let guard = 0;
    while (progress.current && progress.current.stepId !== stopAt) {
        assert.ok(guard++ < 64, '推进次数超限，疑似链上有环');
        const done = progress.complete(progress.current.stepId);
        assert.ok(done, '当前步应当可以完成');
        walked.push(done.step.stepId);
    }
    return walked;
}

test('真实表：从首登入口走到 end，16 步全覆盖且顺序与行序一致', () => {
    const progress = new GuideProgress(STEPS);
    assert.equal(progress.current?.stepId, '1-1');

    const walked = walkTo(progress, '__never__');
    assert.deepEqual(walked, STEPS.map((step: GuideStep) => step.stepId));
    assert.equal(walked.length, 16);
    assert.equal(progress.isFinished, true);
    assert.equal(progress.current, null);
    assert.equal(progress.wasSkipped, false);
});

test('幂等：同一步重复完成返回 null，不产生第二批奖励', () => {
    const progress = new GuideProgress(STEPS);
    // 2-2 是第一个带奖励的步（银币10 + 经验15 + 碎片3）
    walkTo(progress, '2-2');
    const first = progress.complete('2-2');
    assert.ok(first);
    assert.equal(first.rewards.length, 3);
    assert.deepEqual(first.rewards.map((r) => r.resId), [7, 3, 18003]);

    const again = progress.complete('2-2');
    assert.equal(again, null);
    assert.equal(progress.current?.stepId, '3-1');
});

test('乱序回调拒绝：非当前步的完成事件不推进、不发奖', () => {
    const progress = new GuideProgress(STEPS);
    assert.equal(progress.complete('5-3'), null);
    assert.equal(progress.complete('8-1'), null);
    assert.equal(progress.current?.stepId, '1-1');
    assert.deepEqual(progress.completedSteps, []);
});

test('断线续跑：从存档步接着跑，不重放已完成的步，也不重复发奖', () => {
    const progress = new GuideProgress(STEPS, {
        currentStepId: '5-3',
        completedSteps: ['1-1', '1-2', '1-3', '2-1', '2-2', '3-1', '4-1', '5-1', '5-2'],
        grantedSteps: ['2-2', '3-1', '4-1'],
        skipped: false,
    });

    assert.equal(progress.current?.stepId, '5-3');
    // 已发过奖的步再问，应返回空（补偿逻辑的只读口）
    assert.deepEqual(progress.pendingRewards('2-2'), []);
    assert.equal(progress.pendingRewards('8-1').length, 1);

    const done = progress.complete('5-3');
    assert.equal(done?.next?.stepId, '5-4');
    assert.deepEqual(done?.rewards, []);
});

test('存档里的步已失效（策划删/改名）：回退到首个未完成步，不卡死', () => {
    const progress = new GuideProgress(STEPS, {
        currentStepId: '9-9',
        completedSteps: ['1-1', '1-2'],
        grantedSteps: [],
        skipped: false,
    });
    assert.equal(progress.current?.stepId, '1-3');
});

test('强制步不可跳过：当前步 skipAble=0 时 skip 无效', () => {
    const progress = new GuideProgress(STEPS);
    assert.equal(progress.canSkip, false);
    assert.deepEqual(progress.skip(), []);
    assert.equal(progress.current?.stepId, '1-1');
    assert.equal(progress.wasSkipped, false);
});

test('跳过收尾步：剩余步骤一次性标记完成，并补发全部未发奖励', () => {
    const progress = new GuideProgress(STEPS);
    walkTo(progress, '8-1');
    assert.equal(progress.current?.stepId, '8-1');
    assert.equal(progress.canSkip, true);

    const rewards = progress.skip();
    // 8-1 的 rewardJson = 10010 × 30；前面 2-2 / 3-1 / 4-1 已随完成发过
    assert.deepEqual(rewards.map((r) => `${r.resId}x${r.number}`), ['10010x30']);
    assert.equal(progress.isFinished, true);
    assert.equal(progress.wasSkipped, true);
    assert.deepEqual(progress.skip(), []);
});

test('全流程奖励合计 6 条，且不重复计入', () => {
    const progress = new GuideProgress(STEPS);
    const all: string[] = [];
    let guard = 0;
    while (progress.current && guard++ < 64) {
        const done = progress.complete(progress.current.stepId);
        assert.ok(done);
        for (const reward of done.rewards) all.push(`${reward.resId}x${reward.number}`);
    }
    assert.deepEqual(all, ['7x10', '3x15', '18003x3', '18003x3', '18003x4', '10010x30']);
});

test('存档往返：toSave 再恢复，状态与奖励台账一致', () => {
    const progress = new GuideProgress(STEPS);
    walkTo(progress, '6-1');
    const saved = progress.toSave();
    assert.equal(saved.currentStepId, '6-1');

    const restored = new GuideProgress(STEPS, saved);
    assert.equal(restored.current?.stepId, '6-1');
    assert.deepEqual(restored.completedSteps.sort(), progress.completedSteps.sort());
    assert.deepEqual(restored.grantedSteps.sort(), progress.grantedSteps.sort());
    assert.deepEqual(restored.pendingRewards('2-2'), []);
});

test('表校验：空表直接抛（配置缺失不该静默走空流程）', () => {
    assert.throws(() => new GuideProgress([]), /表为空/);
});

test('表校验：nextStep 指向不存在的步要抛', () => {
    const broken = parseGuideSteps([
        { stepId: '1-1', triggerType: 'firstLogin', nextStep: '9-9' },
    ]);
    assert.throws(() => new GuideProgress(broken), /不存在的步骤：9-9/);
});

test('表校验：存在走不到的步要抛（多半是 nextStep 写错）', () => {
    const orphan = parseGuideSteps([
        { stepId: '1-1', triggerType: 'firstLogin', nextStep: GUIDE_STEP_END },
        { stepId: '1-2', triggerType: 'prevDone', nextStep: GUIDE_STEP_END },
    ]);
    assert.throws(() => new GuideProgress(orphan), /永远走不到）：1-2/);
});

test('表校验：firstLogin 入口必须唯一', () => {
    const twoEntries = parseGuideSteps([
        { stepId: '1-1', triggerType: 'firstLogin', nextStep: GUIDE_STEP_END },
        { stepId: '1-2', triggerType: 'firstLogin', nextStep: GUIDE_STEP_END },
    ]);
    assert.throws(() => new GuideProgress(twoEntries), /只能有 1 个 firstLogin/);
});

test('强制跳过：忽略 skipAble，剩余步一次性补发全部奖励', () => {
    const progress = new GuideProgress(STEPS);
    // 正常路径跳不动（1-1 是强制步）
    assert.equal(progress.canSkip, false);
    assert.deepEqual(progress.skip(), []);

    // 强推（调试 / 运营逃生口）：从 1-1 直接走完，奖励一次补齐
    const rewards = progress.skip(true);
    assert.equal(progress.isFinished, true);
    assert.equal(progress.wasSkipped, true);
    assert.deepEqual(
        rewards.map((r) => `${r.resId}x${r.number}`),
        ['7x10', '3x15', '18003x3', '18003x3', '18003x4', '10010x30'],
    );
    // 已经结束，再跳无效
    assert.deepEqual(progress.skip(true), []);
});
