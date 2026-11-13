/**
 * `GuideController` 的行为判据：事件匹配、发奖、落盘、续跑。
 *
 * 不建引擎桩：Controller 只用到 `options`，`this.resources` 是懒加载且引导链路没碰它，
 * 所以 context 传空对象即可（`ResourceScope` 本身是纯 TS）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IControllerContext } from '../assets/script/framework/controller/ControllerBase';
import { GuideController } from '../assets/script/app/guide/application/GuideController';
import { reportGuideComplete } from '../assets/script/app/guide/application/GuideEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { CardLineupEvent } from '../assets/script/app/card/CardLineupEvents';
import type { IGuideViewState } from '../assets/script/app/guide/application/GuideController';
import { parseGuideSteps } from '../assets/script/app/guide/model/GuideStepConfig';
import type { GuideReward, GuideStep } from '../assets/script/app/guide/model/GuideStepConfig';
import {
    createMemoryGuideStorage,
    GUIDE_SAVE_KEY_PREFIX,
    GuideSaveStore,
} from '../assets/script/app/guide/model/GuideSaveStore';

const RAW = JSON.parse(
    readFileSync('assets/remoteRef/guideStep.json', 'utf8'),
) as { k: string[]; v: unknown[][] };

const STEPS: GuideStep[] = parseGuideSteps(RAW.v.map((row) => {
    const out: Record<string, unknown> = {};
    RAW.k.forEach((key, index) => { out[key] = row[index]; });
    return out;
}));

/** Controller 不碰 resources，空 context 足够；类型上照 IControllerContext 收。 */
const CONTEXT = {} as IControllerContext;

function makeController(roleId: string, overrides: {
    steps?: readonly GuideStep[];
    view?: (state: IGuideViewState) => void;
    grant?: (rewards: readonly GuideReward[], stepId: string) => void;
    failed?: (error: unknown) => void;
    now?: () => number;
    storage?: ReturnType<typeof createMemoryGuideStorage>;
} = {}) {
    const store = new GuideSaveStore(
        { roleId, serverId: 's1' },
        overrides.storage ?? createMemoryGuideStorage(),
    );
    const states: IGuideViewState[] = [];
    const granted: { stepId: string; rewards: readonly GuideReward[] }[] = [];
    const controller = new GuideController(CONTEXT, {
        store,
        steps: overrides.steps ?? STEPS,
        view: { render: (state) => { states.push(state); overrides.view?.(state); } },
        grant: (rewards, stepId) => {
            granted.push({ stepId, rewards });
            overrides.grant?.(rewards, stepId);
        },
        failed: overrides.failed,
        now: overrides.now ?? (() => 1000),
    });
    return { controller, store, states, granted };
}

test('启动：首次进入发布第 1 步，firstRun 为真', () => {
    const { controller, states } = makeController('c-start');
    assert.equal(controller.start(), true);
    assert.equal(controller.currentStepId, '1-1');
    assert.equal(states.length, 1);
    assert.equal(states[0].stepId, '1-1');
    assert.equal(states[0].isFirstRun, true);
    assert.equal(states[0].maskType, 'full');
    assert.equal(states[0].requireAction, 'click');
    assert.equal(states[0].finished, false);
    controller.dispose();
});

test('事件匹配：名字不符不推进，名字相符推进并发布下一步', () => {
    const { controller, states } = makeController('c-match');
    controller.start();

    assert.equal(controller.notify('tileFlipped'), false);   // 当前步要的是 click
    assert.equal(controller.currentStepId, '1-1');

    assert.equal(controller.notify('click'), true);
    assert.equal(controller.currentStepId, '1-2');
    assert.equal(states.length, 2);
    assert.equal(states[1].stepId, '1-2');
    controller.dispose();
});

test('带参事件：notify(name, arg) 匹配 completeCond 的 name:arg', () => {
    const { controller } = makeController('c-arg');
    controller.start();
    // 直接跳到 6-3（cardLevelUp:68001）：先手动推完前面所有步
    let guard = 0;
    while (controller.currentStepId !== '6-3' && guard++ < 32) {
        const state = controller.currentStepId;
        assert.ok(state);
        // 按当前步的 requireAction / completeCond 喂事件
        const step = STEPS.find((s) => s.stepId === state);
        assert.ok(step);
        const [name, arg] = step.completeCond.split(':');
        assert.equal(controller.notify(name, arg), true);
    }
    assert.equal(controller.currentStepId, '6-3');

    // 参数不对：不推进
    assert.equal(controller.notify('cardLevelUp', 99999), false);
    assert.equal(controller.currentStepId, '6-3');

    // 参数正确：推进
    assert.equal(controller.notify('cardLevelUp', 68001), true);
    assert.equal(controller.currentStepId, '7-1');
    controller.dispose();
});

test('发奖：完成带奖励的步时把清单交给 grant 出口', () => {
    const { controller, granted } = makeController('c-grant');
    controller.start();
    // 1-1 → 1-2 → 1-3 → 2-1 都是无奖步
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.notify('tileFlipped'), true);
    assert.equal(controller.currentStepId, '2-2');
    assert.equal(granted.length, 0);

    // 2-2 完成时发 3 条
    assert.equal(controller.notify('popupClosed'), true);
    assert.equal(granted.length, 1);
    assert.equal(granted[0].stepId, '2-2');
    assert.deepEqual(granted[0].rewards.map((r) => `${r.resId}x${r.number}`), ['7x10', '3x15', '18003x3']);
    controller.dispose();
});

test('发奖抛错不阻塞推进（记账在前，失败只上报）', () => {
    const errors: unknown[] = [];
    const { controller } = makeController('c-grant-fail', {
        grant: () => { throw new Error('钱包不可用'); },
        failed: (error) => errors.push(error),
    });
    controller.start();
    controller.notify('click');
    controller.notify('click');
    controller.notify('click');
    controller.notify('tileFlipped');
    assert.equal(controller.currentStepId, '2-2');

    assert.equal(controller.notify('popupClosed'), true);
    assert.equal(controller.currentStepId, '3-1');   // 进度照常前进
    assert.equal(errors.length, 1);
    controller.dispose();
});

test('落盘：每推进一步写入当前步，重启后从断点继续', () => {
    const storage = createMemoryGuideStorage();
    const first = makeController('c-persist', { storage });
    first.controller.start();
    first.controller.notify('click');
    first.controller.notify('click');
    assert.equal(first.controller.currentStepId, '1-3');
    first.controller.dispose();

    const saved = first.store.load();
    assert.ok(saved);
    assert.equal(saved.currentStepId, '1-3');
    assert.deepEqual(saved.completedSteps, ['1-1', '1-2']);

    // 模拟重进主界面
    const second = makeController('c-persist', { storage });
    second.controller.start();
    assert.equal(second.controller.currentStepId, '1-3');
    assert.equal(second.states[0].isFirstRun, false);
    second.controller.dispose();
});

test('跳过：非强制步才生效；跳过后一次性补发剩余奖励并结束', () => {
    const storage = createMemoryGuideStorage();
    const { controller, granted } = makeController('c-skip', { storage });
    controller.start();
    assert.equal(controller.skip(), false);   // 1-1 是强制步

    // 推到 8-1
    let guard = 0;
    while (controller.currentStepId !== '8-1' && guard++ < 32) {
        const id = controller.currentStepId;
        const step = STEPS.find((s) => s.stepId === id);
        assert.ok(step);
        const [name, arg] = step.completeCond.split(':');
        assert.equal(controller.notify(name, arg), true);
    }
    assert.equal(controller.currentStepId, '8-1');

    assert.equal(controller.skip(), true);
    assert.equal(controller.isFinished, true);
    const last = granted[granted.length - 1];
    assert.equal(last.stepId, 'skip');
    assert.deepEqual(last.rewards.map((r) => `${r.resId}x${r.number}`), ['10010x30']);
    assert.equal(storage.getItem(`${GUIDE_SAVE_KEY_PREFIX}.server:s1:role:c-skip`) !== null, true);
    assert.equal(controller.skip(), false);   // 已结束，再跳无效
    controller.dispose();
});

test('结束态：走完最后一步后发布 finished 状态', () => {
    const { controller, states } = makeController('c-finish');
    controller.start();
    let guard = 0;
    while (!controller.isFinished && guard++ < 32) {
        const id = controller.currentStepId;
        const step = STEPS.find((s) => s.stepId === id);
        assert.ok(step);
        const [name, arg] = step.completeCond.split(':');
        controller.notify(name, arg);
    }
    assert.equal(controller.isFinished, true);
    const last = states[states.length - 1];
    assert.equal(last.finished, true);
    assert.equal(last.stepId, '');
    assert.equal(last.skipped, false);
    controller.dispose();
});

test('配置不可用：空表时 start 返回 false，不抛', () => {
    const { controller } = makeController('c-empty', { steps: [] });
    assert.equal(controller.start(), false);
    assert.equal(controller.currentStepId, '');
    controller.dispose();
});

test('未启动时 notify / skip 安全返回 false', () => {
    const { controller } = makeController('c-idle');
    assert.equal(controller.notify('click'), false);
    assert.equal(controller.skip(), false);
    assert.equal(controller.isFinished, true);
    controller.dispose();
});

test('完成判定通道：业务侧 reportGuideComplete 命中当前步才推进', () => {
    const { controller } = makeController('c-report');
    controller.start();
    assert.equal(controller.currentStepId, '1-1');      // 要 click

    reportGuideComplete('tileFlipped');                  // 不匹配
    assert.equal(controller.currentStepId, '1-1');

    reportGuideComplete('click');                        // 命中
    assert.equal(controller.currentStepId, '1-2');

    reportGuideComplete('click');
    reportGuideComplete('click');                        // 1-3 完成 → 2-1
    assert.equal(controller.currentStepId, '2-1');       // 要 tileFlipped

    reportGuideComplete('tileFlipped');                  // 翻格上报
    assert.equal(controller.currentStepId, '2-2');
    controller.dispose();
});

test('完成判定通道：空 cond / 非法 payload 不炸', () => {
    const { controller } = makeController('c-report-bad');
    controller.start();
    EventMgr.instance.emit('guide:complete', null);
    EventMgr.instance.emit('guide:complete', { cond: '' });
    reportGuideComplete('click');
    assert.equal(controller.currentStepId, '1-2');
    controller.dispose();
});

test('卡牌升级：已有的 HeroUpgraded 自动转成 cardLevelUp:<heroId>', () => {
    const { controller } = makeController('c-hero');
    controller.start();
    // 直接推到 6-3（要 cardLevelUp:68001）
    let guard = 0;
    while (controller.currentStepId !== '6-3' && guard++ < 32) {
        const step = STEPS.find((s) => s.stepId === controller.currentStepId);
        assert.ok(step);
        const [name, arg] = step.completeCond.split(':');
        assert.equal(controller.notify(name, arg), true);
    }
    assert.equal(controller.currentStepId, '6-3');

    // heroId 不对：不推进
    EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: 99999, level: 1 });
    assert.equal(controller.currentStepId, '6-3');

    // heroId 正确：推进
    EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: 68001, level: 1 });
    assert.equal(controller.currentStepId, '7-1');
    controller.dispose();
});
