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

function fixture(waitForDialogs = false, existingReward = false) {
    class ShowRewardPage {}
    const firstReward = new ShowRewardPage();
    const openedPopups = existingReward ? [firstReward] : [];
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
    ];
    const view = {
        node: { destroy() { destroys++; } },
        setFocusProvider(provider: typeof focus) { focus = provider; },
        initialize() {}, hide() { hidden++; }, render(state: { focusNode: string }) { rendered++; renderedFocus = state.focusNode; },
    };
    class FakeGuideController {
        constructor(_context: object, options: { view: { render: typeof render } }) { render = options.view.render; }
        start() { starts++; return true; }
        notify(name: string) { notifications.push(name); }
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
        ViewLifecycle: { VIEW_LIFECYCLE }, PopupManager: { PopupManager: { inst: { openedPopups } } },
        ShowRewardPage: { ShowRewardPage },
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
    }, 'battle') as ControllerBase;
    return { composition, anchors, notifications, ShowRewardPage, firstReward,
        finishDialogs: () => finishDialogs({ groups: new Map() }),
        render: (state: object) => render(state), focus: (key: string) => focus(key),
        renderedFocus: () => renderedFocus,
        counts: () => ({ destroys, starts, stops, hidden, rendered }) };
}

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
