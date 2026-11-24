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
import { reportGuideComplete, reportBattleGuideSettled } from '../assets/script/app/guide/application/GuideEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { CardLineupEvent } from '../assets/script/app/card/CardLineupEvents';
import type { IGuideViewState } from '../assets/script/app/guide/application/GuideController';
import { GuideEvent, GuideDebugEvent } from '../assets/script/app/guide/application/GuideEvents';
import type { IGuideGateway } from '../assets/script/app/guide/application/GuideGateway';
import { GuideSyncOutbox } from '../assets/script/app/guide/model/GuideSyncOutbox';
import { parseGuideSteps } from '../assets/script/app/guide/model/GuideStepConfig';
import type { GuideStep } from '../assets/script/app/guide/model/GuideStepConfig';
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

/** 让 `then` / `await` 链与新开的 drain 循环跑完（微任务清空需要一次宏任务）。 */
const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

function makeController(roleId: string, overrides: {
    steps?: readonly GuideStep[];
    view?: (state: IGuideViewState) => void;
    failed?: (error: unknown) => void;
    now?: () => number;
    storage?: ReturnType<typeof createMemoryGuideStorage>;
    outbox?: GuideSyncOutbox;
    gateway?: IGuideGateway;
} = {}) {
    const store = new GuideSaveStore(
        { roleId, serverId: 's1' },
        overrides.storage ?? createMemoryGuideStorage(),
    );
    const states: IGuideViewState[] = [];
    const controller = new GuideController(CONTEXT, {
        store,
        steps: overrides.steps ?? STEPS,
        gateway: overrides.gateway,
        outbox: overrides.outbox,
        view: { owner: states, render: (state) => { states.push(state); overrides.view?.(state); } },
        failed: overrides.failed,
        now: overrides.now ?? (() => 1000),
    });
    return { controller, store, states };
}

test('章节战斗从进入、当前抽卡展示结束到结算返回，按实际事件续接', () => {
    const { controller } = makeController('battle-focus-flow');
    try {
        controller.start();
        for (const step of STEPS) {
            if (step.stepId === '5-2') break;
            const [name, arg] = step.completeCond.split(':');
            assert.equal(controller.notify(name, arg), true);
        }
        assert.equal(controller.currentStepId, '5-2');
        assert.equal(controller.notify('siteTap'), false);
        assert.equal(controller.notify('battleEntered'), true);
        assert.equal(controller.currentStepId, '5-3');
        assert.equal(controller.notify('deploy'), false);
        assert.equal(controller.notify('cardRevealFinished'), true);
        assert.equal(controller.currentStepId, '5-4');
        assert.equal(controller.notify('click'), false);
        assert.equal(controller.notify('backToMap'), true);
        assert.equal(controller.currentStepId, '6-1');
    } finally { controller.dispose(); }
});

test('战斗提前退出（跳过战斗）也要把战斗步了结：卡在 5-3 也能直接走到 6-1', () => {
    const { controller } = makeController('battle-skip-settle');
    try {
        controller.start();
        // 推进到 5-3 = 抽卡演出还没播完，玩家一秒就「跳过战斗」进结算。
        for (const step of STEPS) {
            if (step.stepId === '5-3') break;
            const [name, arg] = step.completeCond.split(':');
            assert.equal(controller.notify(name, arg), true);
        }
        assert.equal(controller.currentStepId, '5-3');
        // 现场就是这样：只报 backToMap 对不上当前步，引导永久停在 5-3，
        // 回主界面后焦点 `Battle/DrawnCard` 解析不出来 ⇒ 什么都不显示。
        assert.equal(controller.notify('backToMap'), false);
        assert.equal(controller.currentStepId, '5-3');
        // 离开对局统一报一遍 ⇒ 5-3 → 5-4 → 6-1。
        reportBattleGuideSettled();
        assert.equal(controller.currentStepId, '6-1');
    } finally { controller.dispose(); }
});

test('离开对局的战斗步了结：停在 5-2 / 5-4 都能到 6-1，已过 6-1 则是 no-op', () => {
    const pushTo = (controller: GuideController, stopAt: string) => {
        for (const step of STEPS) {
            if (step.stepId === stopAt) return;
            const [name, arg] = step.completeCond.split(':');
            assert.equal(controller.notify(name, arg), true);
        }
    };
    for (const stopAt of ['5-2', '5-4']) {
        const { controller } = makeController(`battle-settle-${stopAt}`);
        try {
            controller.start();
            pushTo(controller, stopAt);
            assert.equal(controller.currentStepId, stopAt);
            reportBattleGuideSettled();
            assert.equal(controller.currentStepId, '6-1', `停在 ${stopAt} 时离开对局也要接到 6-1`);
        } finally { controller.dispose(); }
    }
    const { controller } = makeController('battle-settle-past');
    try {
        controller.start();
        pushTo(controller, '6-2');
        assert.equal(controller.currentStepId, '6-2');
        reportBattleGuideSettled();
        assert.equal(controller.currentStepId, '6-2', '已经过了战斗步就不许往回带');
    } finally { controller.dispose(); }
});

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

test('完成带奖励配置的步骤只上报进度，不写已发奖标记', async () => {
    const updates: string[] = [];
    const { controller, store } = makeController('c-server-reward', {
        gateway: { load: async () => null, update: async id => { updates.push(id); return 'ok'; }, dispose() {} },
    });
    controller.start();
    // 1-1 → 1-2 → 2-1 都是无奖步（1-3 已随 D03 删掉，苏醒只剩两句）
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.currentStepId, '2-1');
    assert.equal(controller.notify('tileFlipped'), true);
    assert.equal(controller.currentStepId, '2-2');
    assert.deepEqual(store.load()?.grantedSteps, []);

    // 2-2 是「打开宝箱」：点箱子（`siteTap` 上报 tileFlipped）才推进，本身不带奖励。
    assert.equal(controller.notify('tileFlipped'), true);
    assert.equal(controller.currentStepId, '2-3');
    // 本地表有奖励配置，客户端仍只发送完成步骤，发奖由后端决定。
    assert.equal(controller.notify('click'), true);
    await tick();
    assert.equal(controller.currentStepId, '3-1');
    assert.ok(updates.includes('2-3'));
    assert.deepEqual(store.load()?.grantedSteps, []);
    controller.dispose();
});

test('落盘：每推进一步写入当前步，重启后从断点继续', () => {
    const storage = createMemoryGuideStorage();
    const first = makeController('c-persist', { storage });
    first.controller.start();
    first.controller.notify('click');
    first.controller.notify('click');
    assert.equal(first.controller.currentStepId, '2-1');
    first.controller.dispose();

    const saved = first.store.load();
    assert.ok(saved);
    assert.equal(saved.currentStepId, '2-1');
    assert.deepEqual(saved.completedSteps, ['1-1', '1-2']);

    // 模拟重进主界面
    const second = makeController('c-persist', { storage });
    second.controller.start();
    assert.equal(second.controller.currentStepId, '2-1');
    assert.equal(second.states[0].isFirstRun, false);
    second.controller.dispose();
});

test('跳过：非强制步才生效，只保存结束进度，不模拟补发奖励', () => {
    const storage = createMemoryGuideStorage();
    const { controller, store } = makeController('c-skip', { storage });
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
    assert.deepEqual(store.load()?.grantedSteps, []);
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

test('dispose 后事件总线不再把旧会话推进或强制跳过', () => {
    const { controller, store, states } = makeController('c-disposed');
    controller.start();
    assert.equal(controller.currentStepId, '1-1');
    const published = states.length;
    controller.dispose();

    // 生产路径经 EventMgr 订阅；dispose 必须由 offTarget 解除，而不是靠回调内再判一次。
    EventMgr.instance.emit(GuideEvent.Advance, { stepId: '1-1' }, states);
    EventMgr.instance.emit(GuideEvent.Complete, { cond: 'click' });
    EventMgr.instance.emit(GuideDebugEvent.ForceSkip);

    assert.equal(controller.currentStepId, '1-1');
    assert.equal(controller.isFinished, false);
    assert.equal(states.length, published);
    assert.equal(store.load(), null);
});

test('点击意图只接受当前展示实例和当前步骤，旧步骤与退出后的事件不能推进', () => {
    const { controller, states } = makeController('c-scoped-advance');
    controller.start();
    EventMgr.instance.emit(GuideEvent.Advance, { stepId: '1-1' }, {});
    assert.equal(controller.currentStepId, '1-1');
    EventMgr.instance.emit(GuideEvent.Advance, { stepId: '1-1' }, states);
    assert.equal(controller.currentStepId, '1-2');
    EventMgr.instance.emit(GuideEvent.Advance, { stepId: '1-1' }, states);
    assert.equal(controller.currentStepId, '1-2');
    controller.dispose();
    EventMgr.instance.emit(GuideEvent.Advance, { stepId: '1-2' }, states);
    assert.equal(controller.currentStepId, '1-2');
});

test('只有真实推进才上报已完成步骤，退出释放网关', async () => {
    const updates: string[] = [];
    let reads = 0;
    let disposed = false;
    const gateway: IGuideGateway = {
        load: async () => { reads++; return null; },
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => { disposed = true; },
    };
    const { controller } = makeController('c-sync', { gateway });
    controller.start();
    await Promise.resolve();
    assert.equal(reads, 1);
    assert.equal(controller.currentStepId, '1-1');
    controller.notify('tileFlipped');
    assert.deepEqual(updates, []);
    controller.notify('click');
    controller.notify('click');
    assert.deepEqual(updates, ['1-1', '1-2']);
    assert.equal(controller.currentStepId, '2-1');
    controller.skipAll();
    assert.equal(updates[updates.length - 1], STEPS[STEPS.length - 1].stepId);
    controller.dispose();
    assert.equal(disposed, true);
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

test('ViewState 带 completeCond：只有 click 步才允许「点对话条推进」', () => {
    const { controller, states } = makeController('c-cond');
    controller.start();
    assert.equal(states[0].stepId, '1-1');
    assert.equal(states[0].completeCond, 'click');       // 1-1 吃点击

    controller.notify('click');                          // 1-1 完成
    controller.notify('click');                          // 1-2 完成
    controller.notify('click');                          // 1-3 完成 → 2-1
    assert.equal(controller.currentStepId, '2-1');
    const last = states[states.length - 1];
    assert.equal(last.stepId, '2-1');
    // 2-1 要 tileFlipped：View 必须看到非 click 而**不接**推进，否则会被对话条误推
    assert.equal(last.completeCond, 'tileFlipped');
    assert.equal(last.requireAction, 'click');           // 注意：动作是点击，但判据不是
    controller.dispose();
});

test('2-3（翻地奖励对话）的判据是 click（工程没有翻地奖励弹窗的关闭信号）', () => {
    const { controller } = makeController('c-22');
    controller.start();
    let guard = 0;
    while (controller.currentStepId !== '2-3' && guard++ < 8) {
        const step = STEPS.find((s) => s.stepId === controller.currentStepId);
        assert.ok(step);
        const [name, arg] = step.completeCond.split(':');
        controller.notify(name, arg);
    }
    assert.equal(controller.currentStepId, '2-3');
    const step = STEPS.find((s) => s.stepId === '2-3');
    assert.ok(step);
    assert.equal(step.completeCond, 'click', '2-3 若是 popupClosed，View 点了也不会推进 → 卡死');
    assert.equal(controller.notify('click'), true);
    assert.equal(controller.currentStepId, '3-1');
    controller.dispose();
});

test('奖励对话之后的两步翻地是弱引导：无遮罩、无气泡，只留手指', () => {
    // 用户 2026-11-17 第 12 条：2-3 的奖励对话结束后，「翻第2/3块地」不压暗、不弹气泡文案，
    // 只用手指点在地块上。配置口径 = `maskType: none`，焦点必须还是地块。
    for (const stepId of ['3-1', '4-1']) {
        const step = STEPS.find((one) => one.stepId === stepId);
        assert.ok(step, `${stepId} 不存在`);
        assert.equal(step.maskType, 'none',
            `${stepId} 若是 hole，会有一层遮罩压在屏幕上（用户要的是弱引导）`);
        assert.match(step.focusNode, /^Map\/(Tile_\d|TileNew_1)$/, `${stepId} 必须指到地块上，手指才有地方落`);
        assert.equal(step.completeCond, 'tileFlipped', `${stepId} 仍要等玩家真的翻地`);
    }
});

test('5-1 点地图关卡格，5-2 必须实际进入战斗后才完成', () => {
    const s51 = STEPS.find((step) => step.stepId === '5-1');
    assert.ok(s51);
    // 关卡列表入口不存在 ⇒ 判据换成 siteTap（点地图上的关卡格）
    assert.equal(s51.completeCond, 'siteTap');
    // 用户 2026-11-17 第 21 条：5-1 要「全屏遮罩 + 高亮关卡地块与编号气泡 + 手指点击」。
    // `full` 与 `hole` 的差别只有两处：压暗 60% vs 40%、以及**立绘**（hole 一律藏立绘）。
    // 「全屏点击区把地图吃掉」那个旧顾虑已经不成立：`needsFullScreenBlock()` 要求
    // `completeCond === 'click'`，本步是 `siteTap` ⇒ Blocker 只盖对话条，点击照旧落到地块上。
    assert.equal(s51.maskType, 'full', '5-1 要全屏遮罩；点击区由 needsFullScreenBlock 收窄到对话条');

    const s52 = STEPS.find((step) => step.stepId === '5-2');
    assert.ok(s52);
    // 由战斗组合层在挂载引导后上报，重复点击关卡格不能误推进。
    assert.equal(s52.completeCond, 'battleEntered');
});

test('配置不可用时重复 start()：返回 false、不抛、不推进', () => {
    const { controller } = makeController('c-resub', { steps: [] });
    for (let i = 0; i < 3; i++) assert.equal(controller.start(), false);
    // 没有进度 ⇒ 任何上报都不该触发推进（订阅也不该被挂上）
    reportGuideComplete('click');
    EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: 68001, level: 1 });
    assert.equal(controller.currentStepId, '');
    assert.equal(controller.isFinished, true);
    controller.dispose();
});

test('远端领先：本地先出首帧，查询回来校正到远端游标', async () => {
    let resolveLoad: ((value: CmdFunctionGuideInfo | null) => void) | null = null;
    const gateway: IGuideGateway = {
        load: () => new Promise(resolve => { resolveLoad = resolve; }),
        update: async () => 'ok',
        dispose: () => {},
    };
    const { controller, states } = makeController('c-remote-ahead', { gateway });
    controller.start();
    assert.equal(states.length, 1);
    assert.equal(states[0].stepId, '1-1');

    resolveLoad({ funcId: 1, step1: 2, step2: 2 });
    await tick();
    assert.equal(controller.currentStepId, '2-3');
    assert.equal(states.length, 2);
    assert.equal(states[1].stepId, '2-3');
    assert.equal(states[1].isFirstRun, false);
    controller.dispose();
});

test('远端落后：本地已推进时回包不倒退', async () => {
    let resolveLoad: ((value: CmdFunctionGuideInfo | null) => void) | null = null;
    const gateway: IGuideGateway = {
        load: () => new Promise(resolve => { resolveLoad = resolve; }),
        update: async () => 'ok',
        dispose: () => {},
    };
    const { controller, states } = makeController('c-remote-behind', { gateway });
    controller.start();
    controller.notify('click');
    controller.notify('click');
    assert.equal(controller.currentStepId, '2-1');
    const published = states.length;

    resolveLoad({ funcId: 1, step1: 1, step2: 1 });
    await tick();
    assert.equal(controller.currentStepId, '2-1');
    assert.equal(states.length, published);
    controller.dispose();
});

test('远端 0/0 未开始：不校正，firstRun 仍为真，也不产生上报', async () => {
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        // 实测：全新账号首次查询就是 {funcId:1, step1:0, step2:0}。
        load: async () => ({ funcId: 1, step1: 0, step2: 0 }),
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, states } = makeController('c-remote-empty', { gateway });
    controller.start();
    await tick();
    assert.equal(controller.currentStepId, '1-1');
    assert.equal(states.length, 1);
    assert.equal(states[0].isFirstRun, true);
    // 本地也无档 ⇒ 没有可迁移的进度，不该凭空补推。
    assert.deepEqual(updates, []);
    controller.dispose();
});

test('查询等待期间 dispose：迟到回包不再校正、落盘或补发', async () => {
    let resolveLoad: ((value: CmdFunctionGuideInfo | null) => void) | null = null;
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-remote-dispose', serverId: 's1' }, storage);
    outbox.push('1-1', 900);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: () => new Promise(resolve => { resolveLoad = resolve; }),
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store, states } = makeController('c-remote-dispose', { storage, outbox, gateway });
    controller.start();
    const published = states.length;
    assert.equal(published, 1);

    controller.dispose();
    resolveLoad({ funcId: 1, step1: 2, step2: 2 });
    await tick();

    assert.equal(controller.currentStepId, '1-1');
    assert.equal(states.length, published);
    assert.equal(store.load(), null);
    assert.deepEqual(updates, []);
    assert.equal(outbox.head()?.stepId, '1-1', '释放后的 flush 入口不得再发请求或 ack');
});

test('待发补发：上次会话遗留的待发项在启动时发出并出队', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-outbox-start', serverId: 's1' }, storage);
    outbox.push('1-1', 900);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller } = makeController('c-outbox-start', { storage, outbox, gateway });
    controller.start();
    await tick();
    assert.deepEqual(updates, ['1-1']);
    assert.equal(outbox.head(), null);
    controller.dispose();
});

test('补发请求在途时 dispose：迟到结果不 ack，队列留给下次会话', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-outbox-dispose', serverId: 's1' }, storage);
    outbox.push('1-1', 900);
    const calls: string[] = [];
    let resolveUpdate: ((result: 'ok') => void) | null = null;
    const gateway: IGuideGateway = {
        load: async () => null,
        update: id => {
            calls.push(id);
            return new Promise<'ok'>(resolve => { resolveUpdate = resolve; });
        },
        dispose: () => {},
    };
    const { controller } = makeController('c-outbox-dispose', { storage, outbox, gateway });
    controller.start();
    await tick();
    assert.deepEqual(calls, ['1-1']);

    controller.dispose();
    resolveUpdate('ok');
    await tick();

    // await 之后旧会话已释放：结果不能再 ack，队列必须留给下一次会话。
    assert.equal(outbox.head()?.stepId, '1-1');
    assert.equal(outbox.size, 1);
});

test('发送失败保留待发项，下次推进按 FIFO 重试', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-outbox-retry', serverId: 's1' }, storage);
    let fail = true;
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => { updates.push(id); return fail ? 'retry' : 'ok'; },
        dispose: () => {},
    };
    const { controller } = makeController('c-outbox-retry', { storage, outbox, gateway });
    controller.start();
    await tick();
    controller.notify('click');
    await tick();
    assert.deepEqual(updates, ['1-1']);
    assert.equal(outbox.head()?.stepId, '1-1');

    fail = false;
    controller.notify('click');
    await tick();
    assert.deepEqual(updates, ['1-1', '1-1', '1-2']);
    assert.equal(outbox.head(), null);
    controller.dispose();
});

test('远端校正后裁掉已完成的待发项，避免重复补发', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-outbox-prune', serverId: 's1' }, storage);
    outbox.push('1-1', 900);
    outbox.push('1-2', 950);
    let resolveLoad: ((value: CmdFunctionGuideInfo | null) => void) | null = null;
    const gateway: IGuideGateway = {
        load: () => new Promise(resolve => { resolveLoad = resolve; }),
        update: async () => 'ok',
        dispose: () => {},
    };
    const { controller } = makeController('c-outbox-prune', { storage, outbox, gateway });
    controller.start();

    resolveLoad({ funcId: 1, step1: 2, step2: 2 });
    await tick();
    assert.equal(controller.currentStepId, '2-3');
    assert.equal(outbox.size, 0);
    controller.dispose();
});

test('老玩家迁移：服务端无游标而本地有进度时，启动把最后完成步补推上去', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-migrate', serverId: 's1' }, storage);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        // 0/0 与查询失败都表现为 null；这两种情况都该把本地进度补推，服务端取更大即可。
        load: async () => null,
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store } = makeController('c-migrate', { storage, outbox, gateway });
    const lastDone = STEPS.findIndex((step) => step.stepId === '6-3');
    assert.ok(lastDone >= 0);
    store.save({
        currentStepId: '7-1',
        completedSteps: STEPS.slice(0, lastDone + 1).map((step) => step.stepId),
        grantedSteps: [],
        skipped: false,
    }, 900);
    controller.start();
    await tick();
    assert.deepEqual(updates, ['6-3']);
    assert.equal(outbox.size, 0);
    controller.dispose();
});

test('远端落后于本地：启动时补推最后完成步，服务端不会永久卡在旧游标', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-remote-behind-sync', serverId: 's1' }, storage);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        // 服务端只收到 2-1，本地已走到 5-1（完成到 4-1）。
        load: async () => ({ funcId: 1, step1: 2, step2: 1 }),
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store } = makeController('c-remote-behind-sync', { storage, outbox, gateway });
    const done4 = STEPS.findIndex((step) => step.stepId === '4-1');
    assert.ok(done4 >= 0);
    store.save({
        currentStepId: '5-1',
        completedSteps: STEPS.slice(0, done4 + 1).map((step) => step.stepId),
        grantedSteps: [],
        skipped: false,
    }, 900);
    controller.start();
    await tick();
    // 不倒退、只补推：一步 4-1 在「最后已完成」语义下等价整条前缀。
    assert.equal(controller.currentStepId, '5-1');
    assert.deepEqual(updates, ['4-1']);
    controller.dispose();
});

test('远端校正裁剪只删除远端已确认的步，未确认的本地完成项保留', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-prune-unconfirmed', serverId: 's1' }, storage);
    outbox.push('2-1', 900);
    let resolveLoad: ((value: CmdFunctionGuideInfo | null) => void) | null = null;
    const gateway: IGuideGateway = {
        load: () => new Promise(resolve => { resolveLoad = resolve; }),
        // 队头永远失败，保证本项留在队列里，能观察 prune 是否误删。
        update: async () => 'retry',
        dispose: () => {},
    };
    const { controller, store } = makeController('c-prune-unconfirmed', { storage, outbox, gateway });
    // 本地非前缀完成集：完成了 2-1 却没有 1-2；服务端只确认到 1-2。
    store.save({ currentStepId: '2-2', completedSteps: ['1-1', '2-1'], grantedSteps: [], skipped: false }, 900);
    controller.start();
    resolveLoad({ funcId: 1, step1: 1, step2: 2 });
    await tick();
    assert.equal(controller.currentStepId, '2-2');
    assert.equal(outbox.head()?.stepId, '2-1', '2-1 尚未被服务端确认，不能随远端校正被裁掉');
    controller.dispose();
});

test('网关 update 拒绝：上报错误、保留队头并复位补发状态', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-outbox-reject', serverId: 's1' }, storage);
    const calls: string[] = [];
    const errors: unknown[] = [];
    let failing = true;
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => {
            calls.push(id);
            if (failing) throw new Error('boom');
            return 'ok';
        },
        dispose: () => {},
    };
    const { controller } = makeController('c-outbox-reject', {
        storage, outbox, gateway, failed: error => errors.push(error),
    });
    controller.start();
    await tick();
    assert.equal(controller.notify('click'), true);
    await tick();
    assert.deepEqual(calls, ['1-1']);
    assert.equal(outbox.head()?.stepId, '1-1');
    assert.ok(errors.length > 0, '网关拒绝必须通过 failed 上报，而不是变成未处理拒绝');

    failing = false;
    assert.equal(controller.notify('click'), true);
    await tick();
    assert.deepEqual(calls, ['1-1', '1-1', '1-2']);
    assert.equal(outbox.head(), null, 'flushing 复位后下一次推进能继续补发');
    controller.dispose();
});

test('补发在途时再次推进：本轮结束后接着重试，不把新项拖到下次启动', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-flush-race', serverId: 's1' }, storage);
    const calls: string[] = [];
    const pending: Array<(result: 'ok' | 'retry') => void> = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => {
            calls.push(id);
            return await new Promise<'ok' | 'retry'>(resolve => { pending.push(resolve); });
        },
        dispose: () => {},
    };
    const { controller } = makeController('c-flush-race', { storage, outbox, gateway });
    controller.start();
    await tick();
    assert.equal(controller.notify('click'), true);
    await tick();
    assert.deepEqual(calls, ['1-1']);
    // 第一次上报还没回来时又推进一步：不能只在 flushing 标记上 return 而丢掉这次唤醒。
    assert.equal(controller.notify('click'), true);
    await tick();
    assert.deepEqual(calls, ['1-1']);

    pending.shift()?.('retry');
    await tick();
    assert.deepEqual(calls, ['1-1', '1-1'], '新推进应触发下一轮补发');
    pending.shift()?.('ok');
    await tick();
    assert.deepEqual(calls, ['1-1', '1-1', '1-2'], '队头成功后按 FIFO 继续');
    pending.shift()?.('ok');
    await tick();
    assert.equal(outbox.head(), null);
    controller.dispose();
});

test('老玩家迁移只推当前表内的最后完成步，旧表残留 stepId 不发给服务端', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-migrate-stale', serverId: 's1' }, storage);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store } = makeController('c-migrate-stale', { storage, outbox, gateway });
    store.save({
        currentStepId: '',
        completedSteps: ['1-1', '1-2', '2-1', '2-2', '2-3', '9-9'],
        grantedSteps: [],
        skipped: false,
    }, 900);
    controller.start();
    await tick();
    assert.equal(controller.currentStepId, '3-1');
    assert.deepEqual(updates, ['2-3'], '9-9 已不在当前表内，不能拿它当服务端游标');
    controller.dispose();
});

test('合并存档的完成集顺序打乱时，仍按链序补推最靠后的完成步', async () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox({ roleId: 'c-migrate-order', serverId: 's1' }, storage);
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store } = makeController('c-migrate-order', { storage, outbox, gateway });
    // 合并后的数组末项是 2-2，但链上更靠后的是 2-3。
    store.save({
        currentStepId: '3-1',
        completedSteps: ['1-1', '1-2', '2-1', '2-3', '2-2'],
        grantedSteps: [],
        skipped: false,
    }, 900);
    controller.start();
    await tick();
    assert.deepEqual(updates, ['2-3']);
    controller.dispose();
});

test('无 outbox 直连模式也补推本地进度', async () => {
    const updates: string[] = [];
    const gateway: IGuideGateway = {
        load: async () => null,
        update: async id => { updates.push(id); return 'ok'; },
        dispose: () => {},
    };
    const { controller, store } = makeController('c-migrate-direct', { gateway });
    store.save({
        currentStepId: '7-1',
        completedSteps: ['1-1', '1-2', '2-1', '2-2', '2-3', '3-1', '4-1', '5-1', '5-2', '5-3', '5-4', '6-1', '6-2', '6-3'],
        grantedSteps: [],
        skipped: false,
    }, 900);
    controller.start();
    await tick();
    assert.deepEqual(updates, ['6-3']);
    controller.dispose();
});
