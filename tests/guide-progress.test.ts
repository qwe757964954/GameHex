/**
 * 新手引导步骤机（`GuideProgress`）的行为判据。
 *
 * 夹具直接用 `assets/remoteRef/guideStep.json` 真表 —— 不复制算法、不另造一份假数据，
 * 表被改坏（断链 / 步数变化）这里会直接红。
 *
 * 覆盖四类风险：
 *   ① 乱序/重复完成；② 断线续跑重放已完成的步；
 *   ③ 客户端错误地生成已发奖标记；④ 表本身断链但没人发现。
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

test('行序与 nextStep 链不一致时构造期拒绝，避免恢复和远端游标把行前缀当链前缀', () => {
    const swapped = [...STEPS];
    const first = swapped[0];
    swapped[0] = swapped[1];
    swapped[1] = first;
    assert.throws(
        () => new GuideProgress(swapped),
        /行序与 nextStep 链不一致/,
    );
});

test('幂等：同一步重复完成返回 null，完成不等于服务端已发奖', () => {
    const progress = new GuideProgress(STEPS);
    // 2-3 是第一个带奖励的步（银币10 + 经验15 + 碎片3）；2-2 是「打开宝箱」，不带奖励
    walkTo(progress, '2-3');
    const first = progress.complete('2-3');
    assert.ok(first);
    assert.equal('rewards' in first, false);
    assert.deepEqual(progress.grantedSteps, []);

    const again = progress.complete('2-3');
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
        completedSteps: ['1-1', '1-2', '2-1', '2-2', '3-1', '4-1', '5-1', '5-2'],
        grantedSteps: ['2-2', '3-1', '4-1'],
        skipped: false,
    });

    assert.equal(progress.current?.stepId, '5-3');

    const done = progress.complete('5-3');
    assert.equal(done?.next?.stepId, '5-4');
    assert.deepEqual(progress.grantedSteps, ['2-2', '3-1', '4-1'], '旧标记只兼容读取，不增加到账记录');
});

test('存档里的步已失效（策划删/改名）：回退到首个未完成步，不卡死', () => {
    const progress = new GuideProgress(STEPS, {
        currentStepId: '9-9',
        completedSteps: ['1-1', '1-2'],
        grantedSteps: [],
        skipped: false,
    });
    assert.equal(progress.current?.stepId, '2-1');
});

test('热更插入中间步：旧档已完成其后全部步骤时，完成插入步直接越过已完成后继', () => {
    const completed = STEPS
        .map((step: GuideStep) => step.stepId)
        .filter((stepId) => stepId !== '2-2');
    const progress = new GuideProgress(STEPS, {
        currentStepId: '',
        completedSteps: completed,
        grantedSteps: [],
        skipped: false,
    });
    assert.equal(progress.current?.stepId, '2-2');

    const done = progress.complete('2-2');
    assert.ok(done);
    assert.equal(done.next, null);
    assert.equal(progress.current, null);
    assert.equal(progress.isFinished, true);
});

test('强制步不可跳过：当前步 skipAble=0 时 skip 无效', () => {
    const progress = new GuideProgress(STEPS);
    assert.equal(progress.canSkip, false);
    progress.skip();
    assert.equal(progress.current?.stepId, '1-1');
    assert.equal(progress.wasSkipped, false);
});

test('跳过收尾步只标记完成，不在客户端生成奖励', () => {
    const progress = new GuideProgress(STEPS);
    walkTo(progress, '8-1');
    assert.equal(progress.current?.stepId, '8-1');
    assert.equal(progress.canSkip, true);

    progress.skip();
    assert.deepEqual(progress.grantedSteps, []);
    assert.equal(progress.isFinished, true);
    assert.equal(progress.wasSkipped, true);
    progress.skip();
    assert.deepEqual(progress.grantedSteps, []);
});

test('走完整条引导也不计算奖励或写入本地已发奖标记', () => {
    const progress = new GuideProgress(STEPS);
    let guard = 0;
    while (progress.current && guard++ < 64) {
        const done = progress.complete(progress.current.stepId);
        assert.ok(done);
        assert.equal('rewards' in done, false);
    }
    assert.deepEqual(progress.toSave().grantedSteps, []);
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

test('强制跳过忽略 skipAble，但不模拟发奖或新增奖励标记', () => {
    const progress = new GuideProgress(STEPS);
    // 正常路径跳不动（1-1 是强制步）
    assert.equal(progress.canSkip, false);
    progress.skip();

    progress.skip(true);
    assert.equal(progress.isFinished, true);
    assert.equal(progress.wasSkipped, true);
    assert.deepEqual(progress.toSave().grantedSteps, []);
    // 已经结束，再跳无效
    progress.skip(true);
    assert.deepEqual(progress.toSave().grantedSteps, []);
});

test('2-2「打开宝箱」是纯引导步：弱引导（不压暗）、不带台词、不发奖，推进判据与翻地同源', () => {
    const byId = new Map(STEPS.map((step: GuideStep) => [step.stepId, step]));
    const flip = byId.get('2-1');
    const chest = byId.get('2-2');
    const reward = byId.get('2-3');
    assert.ok(flip && chest && reward);

    // 链：翻第 1 块地 → 打开宝箱 → 奖励对话，三段首尾相接。
    assert.equal(flip.nextStep, '2-2');
    assert.equal(chest.nextStep, '2-3');
    assert.equal(reward.nextStep, '3-1');
    // 第一次点宝箱就不压暗（用户 2026-11-17 第 13 条 ③）：只留手指 + 光圈，
    // 后面开箱粒子动画自己会接管画面，遮罩留着反而挡视线。
    assert.equal(chest.maskType, 'none');
    assert.equal(chest.focusNode, 'Map/Chest_1');
    assert.equal(chest.requireAction, 'click');
    // 这一步只有手指 + 气泡，没有台词；推进复用翻地事件，不另开事件名。
    assert.equal(chest.dialogId, '');
    // 2-1 原来那句「看到那个亮起来的地块没」随改版删掉了 ⇒ 现在它也不带台词，
    // 别跟着顺位到 D03（那会让奖励对话在翻地时就先播一遍）。
    assert.equal(flip.dialogId, '');
    assert.equal(chest.completeCond, 'tileFlipped');
    assert.deepEqual(chest.rewards, [], '奖励不走引导表：宝箱产出是服务端按格子发的');
    assert.equal(reward.dialogId, 'D03');
    // 奖励对话在宝箱页关掉之后才播 ⇒ 这一步不再指向弹窗（也就不会把立绘挡掉）。
    assert.equal(reward.focusNode, '');
    // 2026-11-17 表改版：卡牌碎片奖励挪到 5-4（通关结算那一步），2-3 只播台词。
    assert.deepEqual(reward.rewards, []);
});

/**
 * 8-1 收尾：**挖孔高亮不变，孔外点击穿透**（用户 2026-11-25）。
 *
 * 表里写的是 `holeThrough`。`parseStep` 对**不认识的值一律回落 `full`**
 * （宁可多压一层也不能静默变成不挡点击）⇒ 解析器漏接这个新值的话，8-1 会变成
 * 「全屏压暗 + 点哪都推不动台词」，玩家永远点不到任务入口。这条守的就是那个回落。
 */
test('8-1 的遮罩解析成 holeThrough（新值没被解析器接住就会回落 full）', () => {
    const step = STEPS.find((item: GuideStep) => item.stepId === '8-1');
    assert.ok(step, '表里必须有 8-1');
    assert.equal(step.maskType, 'holeThrough');
    assert.equal(step.nextStep, GUIDE_STEP_END, '8-1 是最后一步');
});
