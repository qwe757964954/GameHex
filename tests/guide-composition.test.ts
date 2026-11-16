import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(waitForDialogs = false, existingReward = false, page: 'battle' | 'card' | 'territory' = 'battle', existingGoal = false) {
    class ShowRewardPage {}
    let goalRequests = 0, goalCancels = 0, goalCancelled = false;
    let finishGoal!: () => void;
    class MainTaskDetailPage {
        static open() {
            goalRequests++;
            return new Promise<MainTaskDetailPage | null>(resolve => {
                finishGoal = () => {
                    if (goalCancelled) { resolve(null); return; }
                    openedPopups.push(goalPopup);
                    resolve(goalPopup);
                };
            });
        }
    }
    const goalPopup = new MainTaskDetailPage();
    const revealedCards: string[] = [];
    class CardLineupPage { revealGuideCard(id: string) { revealedCards.push(id); } }
    const firstReward = new ShowRewardPage();
    const openedPopups = existingReward ? [firstReward] : [];
    if (existingGoal) openedPopups.push(goalPopup);
    let finishDialogs!: (value: object) => void;
    const dialogs = waitForDialogs ? new Promise(resolve => { finishDialogs = resolve; })
        : Promise.resolve({ groups: new Map() });
    let destroys = 0, starts = 0, stops = 0, hidden = 0, rendered = 0;
    let renderedFocus = '';
    const notifications: string[] = [];
    let render!: (state: object) => void;
    let focus!: (key: string) => { node: object; shape: string } | null;
    const anchors = [
        { key: 'Battle/DrawnCard', shownAt: 2, node: { activeInHierarchy: true } },
        { key: 'Battle/DrawnCard', shownAt: 9, node: { activeInHierarchy: false } },
        { key: 'Battle/DrawnCard', shownAt: 4, node: { activeInHierarchy: true } },
        { key: 'CardList/Card_68001', shownAt: 0, node: { activeInHierarchy: true } },
    ];
    const view = {
        node: { destroy() { destroys++; } },
        setFocusProvider(provider: typeof focus) { focus = provider; },
        initialize() {}, hide() { hidden++; }, render(state: { focusNode: string }) { rendered++; renderedFocus = state.focusNode; },
    };
    class FakeGuideController {
        constructor(_context: object, options: { view: { render: typeof render } }) { render = options.view.render; }
        start() { starts++; return true; }
        notify(name: string, arg?: string) { notifications.push(arg === undefined ? name : `${name}:${arg}`); }
        dispose() { stops++; }
    }
    const imports: Record<string, object> = {
        cc: { Prefab: class {}, instantiate: () => ({ ...view.node, getComponent: () => view }) },
        ControllerBase: { ControllerBase },
        GuideController: { GuideController: FakeGuideController },
        GuideLoader: { loadGuideSteps: async () => [{}], loadGuideDialog: () => dialogs, loadGuidePortraits: async () => new Map() },
        GuideStorageAdapter: { createGuideSaveStore: () => ({}) },
        GuideGateway: { GameNetGuideGateway: class {} },
        GuideDialogView: { GuideDialogView: class {} }, GuideFocusAnchor: { GuideFocusAnchor: class {} },
        MainTabHost: { MainTabHost: class {}, MainTab: { Hero: 'hero' } }, FW: { FW: {} },
        CardLineupPage: { CardLineupPage },
        ViewLifecycle: { VIEW_LIFECYCLE }, PopupManager: { PopupManager: { inst: {
            openedPopups,
            get: (type: new () => object) => openedPopups.find(popup => popup instanceof type) ?? null,
            closeByClass(type: new () => object) {
                assert.equal(type, MainTaskDetailPage);
                goalCancels++; goalCancelled = true;
                const index = openedPopups.indexOf(goalPopup);
                if (index >= 0) openedPopups.splice(index, 1);
            },
        } } },
        ShowRewardPage: { ShowRewardPage },
        MainTaskDetailPage: { MainTaskDetailPage },
    };
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/guide/GuideComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require: (path: string) => {
        const value = imports[path.split('/').pop()!];
        assert.ok(value, `unbound import: ${path}`);
        return value;
    } });
    const canvas = { addChild() {}, getComponentsInChildren: () => anchors };
    const composition = new exports.GuideComposition(createControllerContext(), {
        scene: { getChildByName: () => canvas },
        getComponent: (type: unknown) => page === 'card' && type === CardLineupPage ? new CardLineupPage() : null,
    }, page === 'battle' ? 'battle' : 'main') as ControllerBase;
    return { composition, anchors, notifications, revealedCards, ShowRewardPage, firstReward,
        finishGoal: () => finishGoal(), goalCounts: () => ({ requests: goalRequests, cancels: goalCancels, opened: openedPopups.includes(goalPopup) }),
        reopenGoalManually: () => { openedPopups.splice(openedPopups.indexOf(goalPopup), 1, new MainTaskDetailPage()); },
        finishDialogs: () => finishDialogs({ groups: new Map() }),
        render: (state: object) => render(state), focus: (key: string) => focus(key),
        renderedFocus: () => renderedFocus,
        counts: () => ({ destroys, starts, stops, hidden, rendered }) };
}

test('收尾步骤自动打开主线面板，重复渲染不重复请求，退出取消本会话打开的面板', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        const state = { finished: false, focusNode: 'Popup/MainGoal' };
        f.render(state); f.render(state);
        assert.equal(f.goalCounts().requests, 1);
        f.finishGoal(); await tick();
        f.render(state);
        assert.equal(f.goalCounts().opened, true);
        assert.equal(f.goalCounts().requests, 1);
        f.render({ finished: true, focusNode: '' });
    } finally { f.composition.dispose(); }
    assert.equal(f.goalCounts().cancels, 1);
    assert.equal(f.goalCounts().opened, false);
});

test('收尾先等已有奖励窗关闭；复用其它入口已打开的主线面板并保留其归属', async () => {
    const reward = fixture(false, true, 'territory');
    const existing = fixture(false, false, 'territory', true);
    try {
        await tick();
        const state = { finished: false, focusNode: 'Popup/MainGoal' };
        reward.render(state); existing.render(state);
        assert.equal(reward.goalCounts().requests, 0);
        assert.equal(existing.goalCounts().requests, 0);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: reward.firstReward, phase: 'disabled' });
        assert.equal(reward.goalCounts().requests, 1);
    } finally { reward.composition.dispose(); existing.composition.dispose(); }
    assert.equal(existing.goalCounts().cancels, 0);
    assert.equal(existing.goalCounts().opened, true);
});

test('收尾面板加载中退出取消请求，迟到的加载不会弹回旧页面', async () => {
    const f = fixture(false, false, 'territory');
    await tick();
    f.render({ finished: false, focusNode: 'Popup/MainGoal' });
    f.composition.dispose();
    f.finishGoal(); await tick();
    assert.deepEqual(f.goalCounts(), { requests: 1, cancels: 1, opened: false });
});

test('收尾面板关闭后手动重开，退出引导不会关闭后一个面板', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render({ finished: false, focusNode: 'Popup/MainGoal' });
        f.finishGoal(); await tick();
        f.render({ finished: true, focusNode: '' });
        f.reopenGoalManually();
    } finally { f.composition.dispose(); }
    assert.equal(f.goalCounts().cancels, 0);
});

test('进入英雄卡牌页或从该页恢复时，在引导启动后推进进入卡牌页步骤', async () => {
    for (const delayed of [false, true]) {
        const f = fixture(delayed, false, 'card');
        try {
            await tick();
            if (delayed) {
                assert.deepEqual(f.notifications, []);
                f.finishDialogs();
                await tick();
            }
            assert.equal(f.counts().starts, 1);
            assert.deepEqual(f.notifications, ['pageOpened:card']);
            assert.equal(f.focus('CardList/Card_68001')?.node, f.anchors[3].node);
            assert.deepEqual(f.revealedCards, ['68001']);
        } finally { f.composition.dispose(); }
    }
});

test('领地页不误报进入卡牌页，卡牌页加载中退出也不上报', async () => {
    const territory = fixture(false, false, 'territory');
    const card = fixture(true, false, 'card');
    try {
        await tick();
        assert.deepEqual(territory.notifications, []);
        card.composition.dispose();
        card.finishDialogs();
        await tick();
        assert.deepEqual(card.notifications, []);
        assert.equal(card.counts().starts, 0);
    } finally { territory.composition.dispose(); card.composition.dispose(); }
});

test('战斗装配只显示战斗步骤，当前卡牌取最新的有效展示节点，退出释放控制器', async () => {
    const f = fixture();
    try {
        await tick();
        assert.deepEqual(f.notifications, ['battleEntered']);
        f.render({ finished: false, focusNode: 'Map/Tile_1' });
        f.render({ finished: false, focusNode: 'Battle/DrawnCard' });
        f.render({ finished: false, focusNode: 'BattleResult/BtnOk' });
        assert.equal(f.counts().hidden, 1);
        assert.equal(f.counts().rendered, 2);
        assert.equal(f.focus('Battle/DrawnCard')?.node, f.anchors[2].node);
        assert.equal(f.focus('Battle/Unknown'), null);
    } finally { f.composition.dispose(); }
    assert.equal(f.counts().stops, 1);
    assert.equal(f.counts().destroys, 1);
});

test('奖励窗打开时隐藏引导，多个奖励窗全部关闭后恢复最新步骤，退出解除订阅', async () => {
    const f = fixture();
    await tick();
    const lifecycle = (owner: object, phase: string) => EventMgr.instance.emit(VIEW_LIFECYCLE, { owner, phase });
    const second = new f.ShowRewardPage();
    try {
        f.render({ finished: false, focusNode: 'Battle/DrawnCard' });
        assert.equal(f.counts().rendered, 1);
        lifecycle(f.firstReward, 'enabled');
        f.render({ finished: false, focusNode: 'BattleResult/BtnOk' });
        lifecycle(second, 'enabled');
        lifecycle(f.firstReward, 'disabled');
        assert.equal(f.counts().rendered, 1);
        lifecycle({}, 'disabled');
        assert.equal(f.counts().rendered, 1);
        lifecycle(second, 'disabled');
        assert.equal(f.counts().rendered, 2);
        assert.equal(f.renderedFocus(), 'BattleResult/BtnOk');
    } finally { f.composition.dispose(); }
    const before = f.counts();
    lifecycle(second, 'enabled');
    lifecycle(second, 'disabled');
    assert.deepEqual(f.counts(), before);
});

test('引导加载完成时奖励窗已打开，也必须等其关闭再显示', async () => {
    const f = fixture(false, true);
    try {
        await tick();
        f.render({ finished: false, focusNode: 'Battle/DrawnCard' });
        assert.equal(f.counts().rendered, 0);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: f.firstReward, phase: 'disabled' });
        assert.equal(f.counts().rendered, 1);
    } finally { f.composition.dispose(); }
});

test('台词异步加载期间退出，不再启动引导或上报进入战斗', async () => {
    const f = fixture(true);
    await tick();
    f.composition.dispose();
    f.finishDialogs();
    await tick();
    assert.equal(f.counts().starts, 0);
    assert.deepEqual(f.notifications, []);
});
