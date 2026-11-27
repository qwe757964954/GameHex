import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { GuideEvent, reportGuideComplete } from '../assets/script/app/guide/application/GuideEvents';
import { GUIDE_TEXTS } from '../assets/script/app/guide/GuideTexts';
import { TerritoryUiEvent } from '../assets/script/app/territory/application/TerritoryEvents';

const tick = () => new Promise(resolve => setImmediate(resolve));

/** `guideStep` 表里的步骤顺序（门控按它判「走到第几步」，不比字符串）。 */
const GUIDE_STEP_IDS = ['1-1', '1-2', '2-1', '2-2', '2-3', '3-1', '4-1',
    '5-1', '5-2', '5-3', '5-4', '6-1', '6-2', '6-3', '7-1', '8-1'] as const;

/** `MainTaskEntry` 的桩：只需要静态门控与 `refresh()` 两个副作用。 */
class FakeMainTaskEntry {
    static guideUnlocked = true;
}

const TOP_ENTRY_SIBLING_NAMES = [
    'EntryBar', 'Friend', 'Mail', 'Rank', 'Invite', 'Arrow',
    'FriendLabel', 'MailLabel', 'RankLabel', 'InviteLabel',
] as const;

interface FixtureOptions {
    withTopToggle?: boolean;
    withTopSiblings?: boolean;
    missingCanvas?: boolean;
    missingView?: boolean;
    startFails?: boolean;
    resolveInRender?: boolean;
    steps?: object[];
}

function loadMainTopHudToggle() {
    const exports: Record<string, any> = {};
    class FakeComponent {}
    class FakeNode {}
    class FakeButton {
        static EventType = { CLICK: 'click' };
    }
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/main/MainTopHudToggle.ts', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText, {
        exports,
        require: (path: string) => {
            assert.equal(path, 'cc');
            return {
                _decorator: {
                    ccclass: () => (target: unknown) => target,
                    property: () => () => {},
                },
                Button: FakeButton,
                Component: FakeComponent,
                Node: FakeNode,
            };
        },
    });
    return exports.MainTopHudToggle as new () => Record<string, any>;
}

const RealMainTopHudToggle = loadMainTopHudToggle();

function fixture(
    waitForDialogs = false,
    existingReward = false,
    page: 'battle' | 'card' | 'territory' = 'battle',
    existingGoal = false,
    tabsReady = true,
    mapReady = true,
    opts: FixtureOptions = {},
) {
    class ShowRewardPage {}
    class CardUpgradePage { guideCardId = ''; }
    // 领地宝箱演出链路上的两个全屏页 + 演出窗口事件（`GuideComposition` 靠它们判断「该让位」）。
    class TerritoryChestOpenPage {}
    class HeroObtainPage {}
    // 8-1 完成时的系统提示（「引导完成，获得奖励」）：只记文案，不建节点。
    const toasts: string[] = [];
    class Toast { static show(text: string) { toasts.push(text); } }
    // 组合层没有自己的调度器，8-1 的「等奖励演出」兜底是 `setTimeout`。
    // 沙箱里没有宿主计时器（`vm` 的新 context 不带 `setTimeout`）⇒ 注入一套可手动推进的。
    const timers = new Map<number, () => void>();
    let timerSeq = 0;
    const setTimeoutStub = (handler: () => void): number => { timerSeq += 1; timers.set(timerSeq, handler); return timerSeq; };
    const clearTimeoutStub = (id: number): void => { timers.delete(id); };
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
    // 卡库拖拽锁的调用轨迹：`CardList/*` 步锁上，切到详情 / 收引导时解开（第 16 条 ③）。
    const scrollLocks: boolean[] = [];
    class CardLineupPage {
        // 真实实现按 `guideCardIndex` 去重（同一个 index 不重复滚动），夹具照抄这个口径，
        // 否则「同一目标被解析多次」会被记成多次展示。
        private guideIndex = '';
        revealGuideCard(id: string) { if (this.guideIndex === id) return; this.guideIndex = id; revealedCards.push(id); }
        setGuideScrollLocked(locked: boolean) { scrollLocks.push(locked); }
    }
    const firstReward = new ShowRewardPage();
    const openedPopups = existingReward ? [firstReward] : [];
    if (existingGoal) openedPopups.push(goalPopup);
    let finishDialogs!: (value: object) => void;
    const dialogs = waitForDialogs ? new Promise(resolve => { finishDialogs = resolve; })
        : Promise.resolve({ groups: new Map() });
    let destroys = 0, starts = 0, stops = 0, hidden = 0, rendered = 0, taskRefreshes = 0;
    let renderedFocus = '';
    const notifications: string[] = [];
    let controllerRef: object | null = null;
    const render = (state: object, completedStepId?: string): void => {
        const output = completedStepId
            ? { kind: 'render', state, completedStepId }
            : { kind: 'render', state };
        EventMgr.instance.emit(GuideEvent.Output, output, controllerRef!);
    };
    let focus!: (key: string) => { node: object; shape: string } | null;
    const anchors = [
        { key: 'Battle/DrawnCard', shownAt: 2, node: { activeInHierarchy: true } },
        { key: 'Battle/DrawnCard', shownAt: 9, node: { activeInHierarchy: false } },
        { key: 'Battle/DrawnCard', shownAt: 4, node: { activeInHierarchy: true } },
        { key: 'CardList/Card_68001', shownAt: 0, node: { activeInHierarchy: true } },
        { key: 'CardDetail/BtnUpgrade', shownAt: 0, node: { activeInHierarchy: true } },
    ];
    const view = {
        node: {
            isValid: true,
            destroy() { destroys++; },
        },
        setFocusProvider(provider: typeof focus) { focus = provider; },
        initialize() {},
        hide() { hidden++; },
        render(state: { focusNode: string }) {
            rendered++;
            renderedFocus = state.focusNode;
            if (opts.resolveInRender && state.focusNode) focus(state.focusNode);
        },
    };
    class FakeGuideController {
        constructor() { controllerRef = this; }
        start() { starts++; return !opts.startFails; }
        notify(name: string, arg?: string) { notifications.push(arg === undefined ? name : `${name}:${arg}`); }
        dispose() { stops++; }
    }
    const instantiatedNode = {
        isValid: true,
        active: true,
        destroy() { destroys++; },
        getComponent: () => opts.missingView ? null : view,
    };
    const imports: Record<string, object> = {
        cc: { Prefab: class {}, instantiate: () => instantiatedNode },
        ControllerBase: { ControllerBase },
        GuideController: { GuideController: FakeGuideController },
        // 门控按**表序**判「走到第几步」，桩里必须是真实 stepId 序列（第 26 条）。
        GuideLoader: {
            loadGuideSteps: async () => opts.steps ?? GUIDE_STEP_IDS.map(stepId => ({ stepId })),
            loadGuideDialog: () => dialogs,
            loadGuidePortraits: async () => new Map(),
        },
        GuideStorageAdapter: { createGuidePersistence: () => ({ store: {}, outbox: {} }) },
        GuideGateway: { GameNetGuideGateway: class {} },
        GuideDialogView: { GuideDialogView: class {} }, GuideFocusAnchor: { GuideFocusAnchor: class {} },
        MainTabHost: { MainTabHost: class {}, MainTab: { Hero: 'hero', Territory: 'territory' } }, FW: { FW: {} },
        CardLineupPage: { CardLineupPage },
        CardUpgradePage: { CardUpgradePage }, GuideEvents: { GuideEvent },
        MainTopHudToggle: { MainTopHudToggle: RealMainTopHudToggle },
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
        MainTaskEntry: { MainTaskEntry: FakeMainTaskEntry },
        TerritoryChestOpenPage: { TerritoryChestOpenPage },
        HeroObtainPage: { HeroObtainPage },
        TerritoryEvents: { TerritoryUiEvent },
        // 8-1 完成时的系统提示（「新手引导完成，获得奖励」）：只记文案，不建节点。
        // 用真常量而不是抄一份字符串 —— 文案改在 `GuideTexts` 里，这里跟着走。
        GuideTexts: { GUIDE_TEXTS },
        Toast: { Toast },
    };
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/guide/GuideComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub, require: (path: string) => {
        const value = imports[path.split('/').pop()!];
        assert.ok(value, `unbound import: ${path}`);
        return value;
    } });
    const cardTab: { parent?: object } = {};
    const territoryTab: { parent?: object } = {};
    // 底栏与页签维持真实父子关系，引导不改变底栏自身的显隐。
    const navBar = { isValid: true, active: true, parent: null as object | null };
    cardTab.parent = navBar;
    territoryTab.parent = navBar;
    // `tabsReady=false` 模拟「刚切回主页、页签还没注册」那几帧（焦点解析必然为空）。
    const tabHost = { isValid: true, navBar,
        getGuideTabNode: (tab: string) => tabsReady ? (tab === 'territory' ? territoryTab : cardTab) : null };
    // 常驻 GM 入口挂在 `Canvas` 上（不在 tab 页里），也压在右上角那一片。
    const gmButton = { name: 'GMButton', isValid: true, active: true, children: [] as object[], parent: null as object | null };
    const procedureNode = { name: 'Procedure', isValid: true, active: true, children: [] as object[], parent: null as object | null };
    const popupNode = { name: 'Popup', isValid: true, active: true, children: [] as object[], parent: null as object | null };
    const canvasChildren: object[] = [procedureNode, popupNode, gmButton];
    const canvas = {
        isValid: true,
        children: canvasChildren,
        addChild(child: object) { canvasChildren.push(child); },
        insertChild(child: object, index: number) { canvasChildren.splice(index, 0, child); },
        getComponentsInChildren: () => anchors,
        getComponentInChildren: () => tabHost,
        getChildByName: (name: string) => name === 'GMButton' ? gmButton : null,
    };
    // 页面里的常驻 HUD：对话步要连它们一起收（顶栏 / 底部挂件 / 快速寻敌）。
    const hudNode = (name: string) => ({ name, isValid: true, active: true, children: [] as object[], parent: null as object | null });
    const topToggle: Record<string, any> | null = opts.withTopToggle ? new RealMainTopHudToggle() : null;
    const topHud = {
        ...hudNode('TopHud'),
        getComponent: (type: unknown) => type === RealMainTopHudToggle ? topToggle : null,
    };
    const bottomHud = hudNode('BottomHud');
    const beginGame = hudNode('BeginGame');
    // 右上入口排（好友 / 邮件 / 排行榜 / 邀请）：5-4 之前要收，但左上玩家卡与资源条要留着。
    const topEntries: Record<string, any> = {};
    const entryNames = (opts.withTopToggle || opts.withTopSiblings) ? TOP_ENTRY_SIBLING_NAMES : (['EntryBar'] as const);
    for (const name of entryNames) {
        const node: Record<string, any> = {
            ...hudNode(name),
            angle: 0,
            on() {},
            off() {},
        };
        topEntries[name] = node;
        topHud.children.push(node);
        node.parent = topHud;
    }
    const entryBar = topEntries.EntryBar;
    if (topToggle) {
        topToggle.entryBar = topEntries.EntryBar;
        topToggle.friend = topEntries.Friend;
        topToggle.mail = topEntries.Mail;
        topToggle.rank = topEntries.Rank;
        topToggle.invite = topEntries.Invite;
        topToggle.friendLabel = topEntries.FriendLabel;
        topToggle.mailLabel = topEntries.MailLabel;
        topToggle.rankLabel = topEntries.RankLabel;
        topToggle.inviteLabel = topEntries.InviteLabel;
        topToggle.arrow = { node: topEntries.Arrow };
        topToggle.onEnable();
    }
    // 任务入口：8-1 之前单独收着（它在 BottomHud 里，5-4 之后随父节点一起露出来）。
    // `refresh()` 照抄真实 `applySnapshot` 的显隐口径（`snapshot.visible && guideUnlocked`）：
    // `taskConfigured=false` 模拟「没配任务 / 已领完」⇒ 入口自己关回去，组合层据此走代开兜底。
    let taskConfigured = true;
    // `refresh()` 真实实现是 `async`（读表 + 读缓存）⇒ 落地前有几帧空窗。`taskRefreshPending`
    // 让夹具停在那一拍，验「解锁时先把入口立起来，不等快照」。
    let taskRefreshPending = false;
    let finishTaskRefresh: (() => void) | null = null;
    const mainTaskEntry = { ...hudNode('MainTaskEntry'),
        getComponent: () => ({ refresh() {
            taskRefreshes += 1;
            if (taskRefreshPending) {
                return new Promise<void>(resolve => {
                    finishTaskRefresh = () => {
                        mainTaskEntry.active = taskConfigured && FakeMainTaskEntry.guideUnlocked;
                        resolve();
                    };
                });
            }
            mainTaskEntry.active = taskConfigured && FakeMainTaskEntry.guideUnlocked;
        } }) };
    bottomHud.children.push(mainTaskEntry);
    // 父子关系要真：`syncDialogHud` 用 `isInsideNode` 判「焦点是不是在这块 HUD 里」，
    // 少了 `parent` 就会把装着焦点的底栏当普通挂件收掉（8-1 的入口在 BottomHud 里）。
    mainTaskEntry.parent = bottomHud;
    const cardPage = new CardLineupPage();
    const arena = {
        name: 'ArenaRoot', isValid: true, active: true, children: [topHud, bottomHud, beginGame],
        scene: { getChildByName: () => opts.missingCanvas ? null : canvas },
        getComponent: (type: unknown) => page === 'card' && type === CardLineupPage ? cardPage : null,
    };
    const mapTile = { activeInHierarchy: true };
    // 关卡格子上的「1-1」编号气泡：引导要把它和地块一起圈进光圈（第 17 条）。
    const levelBubble = { activeInHierarchy: true };
    let mapFocusQueries = 0;
    const territoryView = page === 'territory' ? {
        getGuideFocusNode: (key: string) => {
            mapFocusQueries += 1;
            return key.startsWith('Map/') ? mapTile : null;
        },
        getGuideFocusExtraNodes: (key: string) => key.startsWith('Map/Level_') ? [levelBubble] : [],
        // 「等地图首帧」的兜底计时（第 23 条）走领地页的 `Component.scheduleOnce`；夹具什么都不做 ——
        // 真实链路里它 8s 后才补画一次，用例靠显式 `presentMap()` 推动，不靠计时。
        scheduleOnce() {},
    } : null;
    const composition = new exports.GuideComposition(createControllerContext(), arena, page === 'battle' ? 'battle' : 'main', territoryView) as ControllerBase;
    // 真实链路里 `MainTerritoryMap` 首帧成功渲染时才发 `presented`；夹具默认照抄这一拍，
    // 否则领地页上的每条用例都得先「等地图」（第 23 条的新闸门）。
    // `mapReady=false` 用来复现「结算返回、地图还没出来」那一刻。
    if (page === 'territory' && mapReady) {
        setImmediate(() => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'presented' }, territoryView));
    }
    return { composition, anchors, notifications, revealedCards, scrollLocks, cardTab, territoryTab, mapTile, levelBubble, ShowRewardPage, HeroObtainPage, firstReward,
        navBar, topHud, bottomHud, beginGame, gmButton, entryBar, topEntries, topToggle, mainTaskEntry,
        canvasChildren, guideNode: instantiatedNode,
        taskRefreshes: () => taskRefreshes,
        taskGuideUnlocked: () => FakeMainTaskEntry.guideUnlocked,
        mapFocusQueries: () => mapFocusQueries,
        /** 模拟「没有可展示的主线任务」：`refresh()` 会把入口关回去。 */
        setTaskConfigured: (value: boolean) => { taskConfigured = value; },
        /** 让 `refresh()` 停在未决状态，模拟「快照还在路上」那几帧。 */
        setTaskRefreshPending: (value: boolean) => { taskRefreshPending = value; },
        finishTaskRefresh: () => {
            finishTaskRefresh?.();
            finishTaskRefresh = null;
        },
        presentMap: () => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'presented' }, territoryView),
        openCard(id: string) {
            const popup = new CardUpgradePage(); popup.guideCardId = id;
            openedPopups.push(popup);
            EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, popup);
            return popup;
        },
        closeCard(popup: CardUpgradePage) {
            openedPopups.splice(openedPopups.indexOf(popup), 1);
            EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, popup);
        },
        finishGoal: () => finishGoal(), goalCounts: () => ({ requests: goalRequests, cancels: goalCancels, opened: openedPopups.includes(goalPopup) }),
        reopenGoalManually: () => { openedPopups.splice(openedPopups.indexOf(goalPopup), 1, new MainTaskDetailPage()); },
        finishDialogs: () => finishDialogs({ groups: new Map() }),
        render: (state: object, completedStepId?: string) => render(state, completedStepId),
        focus: (key: string) => focus(key),
        renderedFocus: () => renderedFocus,
        navVisible: () => navBar.active,
        toasts: () => toasts,
        pendingTimers: () => timers.size,
        /** 推进沙箱里的 `setTimeout`（兜底计时）。只跑一次快照，按时序来。 */
        runTimers() {
            const due = [...timers.values()];
            timers.clear();
            for (const handler of due) handler();
        },
        counts: () => ({ destroys, starts, stops, hidden, rendered }) };
}

test('连点误开的卡牌详情不会挡住选卡引导；关闭后恢复，正确卡就绪才显示升级引导', async () => {
    const f = fixture(false, false, 'card');
    try {
        await tick();
        const select = { finished: false, focusNode: 'CardList/Card_68001', completeCond: 'cardSelected:68001' };
        const upgrade = { finished: false, focusNode: 'CardDetail/BtnUpgrade', completeCond: 'cardLevelUp:68001' };
        f.render(select);
        assert.equal(f.scrollLocks.at(-1), true, '孔挖在某张卡上 ⇒ 卡库列表不许拖');
        const wrong = f.openCard('68012');
        const count = f.counts().rendered;
        reportGuideComplete('cardSelected', '68012');
        assert.equal(f.counts().rendered, count, '错误卡牌在前台时暂停引导，允许返回');
        f.closeCard(wrong);
        assert.equal(f.renderedFocus(), select.focusNode);
        const loading = f.openCard('');
        f.render(upgrade);
        assert.equal(f.scrollLocks.at(-1), false, '切到详情页后把拖拽还回去');
        const waiting = f.counts().rendered;
        loading.guideCardId = '68001';
        reportGuideComplete('cardSelected', '68001');
        assert.equal(f.counts().rendered, waiting + 1);
        assert.equal(f.focus(upgrade.focusNode)?.node, f.anchors[4].node);
        loading.guideCardId = '68012';
        reportGuideComplete('cardSelected', '68012');
        assert.equal(f.counts().rendered, waiting + 1, '详情变成另一张卡时不能继续指向它的升级按钮');
        f.closeCard(loading);
        assert.equal(f.focus(upgrade.focusNode)?.node, f.anchors[3].node, '旧进度或误关详情后可重新选目标卡');
        assert.deepEqual(f.revealedCards, ['68001']);
    } finally { f.composition.dispose(); }
});

test('快速打开的详情早于引导加载完成时，按已就绪的实际卡牌补报选中', async () => {
    const f = fixture(true, false, 'card');
    try {
        f.openCard('68001');
        await tick();
        assert.deepEqual(f.notifications, []);
        f.finishDialogs(); await tick();
        assert.deepEqual(f.notifications, ['pageOpened:card', 'cardSelected:68001']);
    } finally { f.composition.dispose(); }
});

test('回到主页面时先等章节地图首帧，再出卡牌升级引导（第 23 条）', async () => {
    // 结算页点「确定」= 先 `reportGuideComplete('backToMap')` 再 `navigate`（`BattleComposition.onReturnToMain`）
    // ⇒ 主页组合层比领地页早建好几拍，6-1 会浮在一片裸底上开口说话。
    // 现在首帧先压住，等 `MainTerritoryMap` 首次成功渲染的 `presented` 一到再补画一次。
    const f = fixture(false, false, 'territory', false, true, false);
    try {
        await tick();
        const state = { stepId: '6-1', finished: false, focusNode: 'Main/CardEntry', completeCond: 'pageOpened:card', dialogId: 'D07' };
        f.render(state);
        assert.equal(f.counts().rendered, 0, '地图还没画出来就不许出引导（会盖在裸底上开口）');
        f.presentMap();
        assert.equal(f.counts().rendered, 1, '领地页首帧一到必须立刻补画一次，不能等下一次状态变化');
        assert.equal(f.renderedFocus(), 'Main/CardEntry');
        // 幂等：同一个 `presented` 再来一次不许重复画。
        f.presentMap();
        assert.equal(f.counts().rendered, 1);
    } finally { f.composition.dispose(); }
});

test('重登落在领地页时，选卡或升级旧进度先指向英雄入口，不用空焦点封住页面', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        for (const focusNode of ['CardList/Card_68001', 'CardDetail/BtnUpgrade']) {
            f.render({ finished: false, focusNode, completeCond: 'cardLevelUp:68001' });
            assert.equal(f.focus(focusNode)?.node, f.cardTab);
        }
    } finally { f.composition.dispose(); }
});

test('8-1 只高亮底栏的任务入口，让玩家自己点开面板（不再代开弹窗）', async () => {
    // 用户 2026-11-18 第 27 条：收尾那一步改成「高亮任务 icon 的对话强制引导」，
    // 由玩家自己点入口才知道「任务在哪」。旧口径是组合层直接 `MainTaskDetailPage.open()`，
    // 玩家连入口长什么样都没见过。
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        const state = { stepId: '8-1', finished: false, focusNode: 'Main/TaskEntry',
            completeCond: 'pageOpened:task', dialogId: 'D11' };
        f.render(state);
        assert.equal(f.focus('Main/TaskEntry')?.node, f.mainTaskEntry, '焦点必须落在任务入口自己身上，手指才有地方指');
        assert.equal(f.mainTaskEntry.active, true, '入口是本步的目标，不许被当成普通 HUD 收掉');
        assert.equal(f.bottomHud.active, true, '入口在 BottomHud 里，整块底栏跟着留着');
        assert.equal(f.goalCounts().requests, 0, '只高亮入口，不许代开主线面板');
    } finally { f.composition.dispose(); }
});

test('任务入口立不起来时（没配任务）退回代开面板，8-1 才不会永久卡住', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        // 没配任务 ⇒ `refresh()` 按快照把入口关回去（真实链路是 `applySnapshot` 写的）。
        f.setTaskConfigured(false);
        f.mainTaskEntry.active = false;
        f.render({ stepId: '8-1', finished: false, focusNode: 'Main/TaskEntry',
            completeCond: 'pageOpened:task', dialogId: 'D11' });
        await tick();
        assert.equal(f.goalCounts().requests, 1, '玩家没有能点的图标 ⇒ 引导代开，面板一开同样算完成');
    } finally { f.composition.dispose(); }
});

test('8-1 的入口节点还没解析出来时，底栏同样不许被当普通 HUD 收掉', async () => {
    // 用户 2026-11-19：引导要求点主线任务时入口被隐藏。
    // 老判据只认「焦点解析出来、且落在这块 HUD 里才留」⇒ 入口 `refresh()` 还在路上 /
    // `findChildByName` 刚好返回 null 的那几帧，底栏被整块收掉 —— 玩家面前一个能点的图标都没有。
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        // 入口节点从底栏摘掉：`findChildByName` 找不到 ⇒ 焦点解析必然为空。
        f.bottomHud.children.length = 0;
        f.render({ stepId: '8-1', finished: false, focusNode: 'Main/TaskEntry', completeCond: 'pageOpened:task' });
        assert.equal(f.focus('Main/TaskEntry'), null, '这一步确实解析不出焦点');
        assert.equal(f.bottomHud.active, true, '8-1 的底栏无条件留着 —— 入口就在里面');
    } finally { f.composition.dispose(); }
});

test('8-1 解锁时先把入口立起来，不等快照落地', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render({ stepId: '6-1', finished: false, focusNode: '', completeCond: 'pageOpened:card' });
        assert.equal(f.mainTaskEntry.active, false, '8-1 之前收着');
        // 快照还在路上：真实链路 `MainTaskEntry.refresh()` 是 async（读表 + 读缓存）。
        f.setTaskRefreshPending(true);
        f.render({ stepId: '8-1', finished: false, focusNode: 'Main/TaskEntry', completeCond: 'pageOpened:task' });
        assert.equal(f.taskRefreshes(), 1, '解锁要重读一次快照');
        assert.equal(f.mainTaskEntry.active, true, '快照没回来也得先显示 —— 否则这几帧玩家没得点');
        // 引导结束：静态门控保持解锁，显隐交回快照（不再由引导压着）。
        f.render({ stepId: '', finished: true, focusNode: '', completeCond: '' });
        assert.equal(f.taskGuideUnlocked(), true);
        assert.equal(f.bottomHud.active, true, '结束时底栏还回去');
    } finally { f.composition.dispose(); }
});

// 第 27 条补丁 B：7-1 翻地后紧跟着就是 8-1，而那一格的奖励粒子（喷发 / 飘字 / 英雄飞）
// 是回包到了才开始演的。老口径一上报就把演出窗口关掉 ⇒ 8-1 的光圈、台词、手指整个压在粒子上。
const REWARD_HOLD_STATE = { stepId: '8-1', finished: false, focusNode: 'Main/TaskEntry',
    completeCond: 'pageOpened:task', dialogId: 'D11' };
const presenting = (playing: boolean) => EventMgr.instance.emit(TerritoryUiEvent.ChestPresentation, { playing });

/**
 * 模拟「奖励领取弹窗」（`FW.ShowReward` 的 `ShowRewardPage`）开 / 关。
 *
 * 组合层就是按 `VIEW_LIFECYCLE` 维护那几个集合的（`enabled` 加、`destroyed`/`disabled` 删），
 * 所以这里走真事件、不直接改集合 —— 顺带钉住「弹窗生命周期必须能驱动引导层的显隐」。
 */
const openRewardPopup = (f: ReturnType<typeof fixture>): object => {
    const popup = new f.ShowRewardPage();
    EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, popup as object);
    return popup;
};
const closeRewardPopup = (popup: object) => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, popup);

test('8-1 要等翻地的奖励粒子动画播完才出场（演出窗口开→关之后）', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 0, '粒子还在飞就不许出场 —— 光圈和台词会压在奖励上');
        // 奖励到账 ⇒ 领地页开演出窗口（喷发起播）
        presenting(true);
        assert.equal(f.counts().rendered, 0, '窗口开着 = 还在演');
        // 粒子演完 ⇒ 领地页按动画时长收窗
        presenting(false);
        assert.equal(f.counts().rendered, 1, '演完立刻出场，不用等兜底计时');
        assert.equal(f.renderedFocus(), 'Main/TaskEntry');
        assert.equal(f.pendingTimers(), 0, '正常放行之后兜底计时必须摘掉');
        // 放行是一次性的：后面再渲染同一步（含别的演出收窗）不许把它按回去。
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 2, '出场过就不再按住 —— 否则台词会从第一句重播');
    } finally { f.composition.dispose(); }
});

test('奖励比引导推进先到（8-1 出场时窗口已经开着）时，同样等它关', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        presenting(true);
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 0, '进场时窗口已开 ⇒ 当成已经见过，接着等它关');
        presenting(false);
        assert.equal(f.counts().rendered, 1);
    } finally { f.composition.dispose(); }
});

test('那一格没给奖励（演出窗口一直没开）时，兜底计时到点也要把 8-1 放出来', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 0);
        assert.equal(f.pendingTimers(), 1, '按住期间必须挂着一条兜底计时');
        f.runTimers();
        assert.equal(f.counts().rendered, 1, '不能为了等演出把最后一步永久按住');
    } finally { f.composition.dispose(); }
    assert.equal(f.pendingTimers(), 0, '销毁后不许留悬挂计时');
});

// 2026-11-19：翻地那一格除了粒子，还会弹「奖励领取」弹窗（固定格 / 随机格的第一格走
// `{ popup: true }` ⇒ `FW.ShowReward`；宝箱链路先过英雄页）。粒子演完 ≠ 奖励看完。
test('8-1 要等奖励领取弹窗关掉才出场（粒子演完、弹窗还开着 → 继续等）', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 0);
        presenting(true);
        const popup = openRewardPopup(f);
        assert.equal(f.counts().rendered, 0, '弹窗一开就接管画面，引导层让位');
        // 统一奖励弹窗 `enabled` 时领地页那一手 `ChestPresentation` 就收了（粒子那一段结束）。
        presenting(false);
        assert.equal(f.counts().rendered, 0, '还有弹窗开着 ⇒ 8-1 不许在弹窗底下开口');
        closeRewardPopup(popup);
        assert.equal(f.counts().rendered, 1, '弹窗关掉才出场');
        assert.equal(f.renderedFocus(), 'Main/TaskEntry');
        assert.equal(f.pendingTimers(), 0, '放行之后兜底计时必须摘掉');
    } finally { f.composition.dispose(); }
});

test('固定格宝箱那条链（粒子 → 获得英雄 → 统一奖励）全程按住，最后一个弹窗关掉才出场', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        presenting(true);
        // 开箱粒子演完 ⇒ 交组合层弹「获得英雄」，这一拍 `ChestPresentation` 仍是开着。
        const hero = new f.HeroObtainPage();
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, hero as object);
        assert.equal(f.counts().rendered, 0, '英雄页也是奖励页，同样要等');
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, hero as object);
        assert.equal(f.counts().rendered, 0, '英雄页关了不等于看完了 —— 后面还有统一奖励弹窗');
        // 统一奖励弹窗上台 ⇒ 领地页收窗；它关掉，整段才算走完。
        const reward = openRewardPopup(f);
        presenting(false);
        assert.equal(f.counts().rendered, 0);
        closeRewardPopup(reward);
        assert.equal(f.counts().rendered, 1, '最后一个弹窗关掉才出场');
        assert.equal(f.renderedFocus(), 'Main/TaskEntry');
    } finally { f.composition.dispose(); }
});

// 2026-11-24：底栏切到别的 tab 时 `MainTabHost.mountPage` 会把整页换掉、组合层重建，
// 新页上没有 `MainTaskEntry` ⇒ 8-1 硬画出来只有全屏 Blocker、没有孔（画面卡死）。
test('8-1 在别的 tab（不是领地页）上根本不弹：焦点节点不存在，弹出来就是一整块点不动的 Blocker', async () => {
    const f = fixture(false, false, 'card');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.counts().rendered, 0, '卡牌页上没有任务入口 ⇒ 不许硬画');
        assert.equal(f.pendingTimers(), 0, '也不许占住「等奖励」的兜底 —— 回到领地要重新武装');
        // 奖励照常在别的 tab 上弹（那是全局的），但它不该把引导层拉起来。
        const popup = openRewardPopup(f);
        presenting(true);
        presenting(false);
        assert.equal(f.counts().rendered, 0);
        closeRewardPopup(popup);
        assert.equal(f.counts().rendered, 0, '弹窗关掉也不许在非领地页触发收尾');
    } finally { f.composition.dispose(); }
});

test('同一份 8-1 状态：卡牌页让位、回到领地页才等奖励并出场', async () => {
    const card = fixture(false, false, 'card');
    const territory = fixture(false, false, 'territory');
    try {
        await tick();
        card.render(REWARD_HOLD_STATE);
        assert.equal(card.counts().rendered, 0);
        // 切回领地页 = 旧页销毁 + 新组合层（夹具里用另一个 fixture 表达）。
        territory.render(REWARD_HOLD_STATE);
        assert.equal(territory.counts().rendered, 0, '回来仍要先等奖励');
        assert.equal(territory.pendingTimers(), 1, '领地页才挂兜底');
        presenting(true);
        presenting(false);
        assert.equal(territory.counts().rendered, 1, '奖励看完就出场');
        assert.equal(territory.renderedFocus(), 'Main/TaskEntry');
    } finally {
        card.composition.dispose();
        territory.composition.dispose();
    }
});

test('奖励弹窗开着时兜底计时不许挂（2.6s 到点会把 8-1 放到弹窗底下）', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        assert.equal(f.pendingTimers(), 1, '还没动静 ⇒ 挂着兜底');
        const popup = openRewardPopup(f);
        assert.equal(f.pendingTimers(), 0, '弹窗一开就把兜底摘掉 —— 玩家可能看十几秒');
        f.runTimers();
        assert.equal(f.counts().rendered, 0, '摘掉的兜底不许还能把这一步放出来');
        closeRewardPopup(popup);
        assert.equal(f.counts().rendered, 1);
    } finally { f.composition.dispose(); }
    assert.equal(f.pendingTimers(), 0, '销毁后不许留悬挂计时');
});

test('8-1 真实完成那一下弹【新手引导完成，获得奖励】，重复播报或引导走完后再开面板不弹', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(REWARD_HOLD_STATE);
        const doneState = { stepId: '', finished: true, focusNode: '', completeCond: '' };
        // 非 8-1 完成事件不应触发完成提示。
        f.render(REWARD_HOLD_STATE, '7-1');
        assert.deepEqual(f.toasts(), []);
        // 8-1 真实完成时 Controller 通过 Output.completedStepId 通知。
        f.render(doneState, '8-1');
        assert.deepEqual(f.toasts(), [GUIDE_TEXTS.finishRewardTip]);
        assert.equal(GUIDE_TEXTS.finishRewardTip, '新手引导完成，获得奖励');
        // 重登续同步或重开任务面板都不许再次弹窗。
        f.render(doneState);
        reportGuideComplete('pageOpened', 'task');
        assert.deepEqual(f.toasts(), [GUIDE_TEXTS.finishRewardTip], '引导走完后再开任务面板或重渲染不许再弹');
    } finally { f.composition.dispose(); }
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

test('对话步收起页面挂件与底栏；唯一例外是焦点就落在底栏里（6-1 的英雄格）', async () => {
    const f = fixture(false, false, 'territory');
    // 第 5 位是 `Canvas/GMButton`：常驻调试入口，按 GMManager 的契约「所有界面都可见」，
    // 不参与任何 HUD 门控 ⇒ 这一位恒为 `true`。
    const hud = () => [f.topHud.active, f.bottomHud.active, f.beginGame.active, f.navBar.active, f.gmButton.active];
    try {
        await tick();
        const tile = { finished: false, focusNode: 'Map/Tile_1', completeCond: 'tileFlipped', dialogId: 'D04' };
        f.render(tile);
        // 引导期间只留引导 UI：底栏也一起收（用户第 1 条「从第一句台词开始就隐藏底部菜单栏」）。
        assert.deepEqual(hud(), [false, false, false, false, true],
            '地图焦点步骤同样收底栏（GM 入口不参与）');
        // 第 6-1 步的焦点就是英雄页签：底栏留着，其余照收 —— 否则手指导向一个点不到的地方。
        f.render({ finished: false, focusNode: 'Main/CardEntry', completeCond: 'pageOpened:card', dialogId: 'D10' });
        assert.deepEqual(hud(), [false, false, false, true, true], '焦点在底栏里时底栏不能收');
        // 纯引导步（没有台词、只出手指）：仍然是「只留引导 UI」，不把挂件放回去。
        f.render({ ...tile, dialogId: '' });
        assert.deepEqual(hud(), [false, false, false, false, true], '无台词但仍有焦点 ⇒ 照样收');
        f.render({ ...tile, dialogId: '', focusNode: '' });
        assert.deepEqual(hud(), [true, true, true, true, true], '既没台词也没焦点 ⇒ 不动 HUD');
        f.render(tile);
        assert.deepEqual(hud(), [false, false, false, false, true]);
    } finally { f.composition.dispose(); }
    assert.deepEqual(hud(), [true, true, true, true, true], '引导装配销毁后 HUD 必须还回来');
});

test('回到主页落在 6-1 时，底栏先正常露出：锚点还没注册也不收它', async () => {
    // 切回主页那几帧 `MainTabHost` 还没注册页签 ⇒ 焦点解析为空。
    // 老口径「焦点为空就把底栏当普通 HUD 收掉」会让玩家看不到底栏、也没得点；
    // 现在只要本步焦点是 `Main/*`，底栏一律留着，等锚点就位光圈自己挖出来。
    const f = fixture(false, false, 'card', false, false);
    try {
        await tick();
        f.render({ finished: false, focusNode: 'Main/CardEntry', completeCond: 'pageOpened:card', dialogId: 'D10' });
        assert.equal(f.navVisible(), true, '底栏不能被收起');
        assert.equal(f.focus('Main/CardEntry'), null, '此时确实还没有锚点');
    } finally { f.composition.dispose(); }
});

test('回地图翻地块：英雄页先高亮领地页签，回到领地后恢复原地块焦点', async () => {
    const state = { stepId: '7-1', finished: false, focusNode: 'Map/TileNew_1', completeCond: 'tileFlipped', dialogId: 'D15' };
    const card = fixture(false, false, 'card');
    try {
        await tick();
        card.render(state);
        assert.equal(card.renderedFocus(), 'Main/TerritoryEntry');
        assert.equal(card.focus(card.renderedFocus())?.node, card.territoryTab);
        assert.equal(card.focus(card.renderedFocus())?.shape, 'rect');
        assert.equal(card.navVisible(), true);
        assert.equal(state.focusNode, 'Map/TileNew_1', '展示转换不得改写原步骤');
    } finally {
        card.composition.dispose();
    }
    const territory = fixture(false, false, 'territory');
    try {
        await tick();
        territory.render(state);
        assert.equal(territory.renderedFocus(), state.focusNode);
        assert.equal(territory.focus(state.focusNode)?.node, territory.mapTile);
        assert.equal(territory.focus(state.focusNode)?.shape, 'hex');
    } finally {
        territory.composition.dispose();
    }
});

test('点击关卡（5-1）把 1-1 编号气泡一起交给引导层圈住', async () => {
    const state = { stepId: '5-1', finished: false, focusNode: 'Map/Level_10001', completeCond: 'siteTap', dialogId: '' };
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render(state);
        const target = f.focus(state.focusNode);
        assert.equal(target?.node, f.mapTile, '孔还是挖在地块上');
        assert.deepEqual(target?.extra, [f.levelBubble], '气泡必须一起圈：它在角标层，和地块不是父子');
        // 别的焦点不带附加节点（翻地 / 宝箱别顺手圈个气泡）。
        assert.deepEqual(f.focus('Map/Tile_1')?.extra, []);
    } finally {
        f.composition.dispose();
    }
});

test('卡牌引导同样收底栏，结束时只还回本次收起的那一条，宿主自己隐藏的不碰', async () => {
    const f = fixture(false, false, 'card');
    try {
        await tick();
        const state = { finished: false, focusNode: 'CardList/Card_68001', completeCond: 'cardSelected:68001', dialogId: 'D13' };
        f.render(state);
        assert.equal(f.navVisible(), false, '引导期间只留引导 UI');
        f.render({ ...state, finished: true });
        assert.equal(f.navVisible(), true, '结束时还回本次收起的那一条');
        // 宿主本来就藏着的底栏：引导这一帧看到它已经是 inactive ⇒ 不进「本次收起」的账，
        // 退出时也就不会被翻出来。
        f.navBar.active = false;
        f.render(state);
    } finally {
        f.composition.dispose();
    }
    assert.equal(f.navVisible(), false, '宿主的显隐归宿主');
});

test('奖励窗打开时隐藏引导，多个奖励窗全部关闭后恢复最新步骤，退出解除订阅', async () => {
    const f = fixture();
    await tick();
    const lifecycle = (owner: object, phase: string) => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase }, owner);
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
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'disabled' }, f.firstReward);
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

// 第 26 条：主界面 HUD 的显隐要跟**引导进度**走，不能跟「引导层这一帧画不画」走。
// 旧口径只靠 `syncDialogHud` 收，一遇到全屏弹窗（领奖 / 宝箱 / 卡牌升级）就
// `view.hide()` + `restoreDialogHud()` 把它们全放回来 —— 玩家在引导第 2 关的领奖弹窗上
// 就看见了完整主界面（用户截图：顶栏入口排、宝箱、聊天条、底部七色导航全在）。
test('主界面 HUD 按引导进度解锁：5-4 之前一律不显示（领奖让位也不例外），任务入口要等 8-1', async () => {
    const f = fixture(false, false, 'territory');
    const lifecycle = (owner: object, phase: string) => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase }, owner);
    try {
        await tick();
        f.render({ finished: false, stepId: '2-3', focusNode: '' });
        assert.equal(f.entryBar.active, false, '5-4 之前右上入口排（好友/邮件/排行/邀请）不许显示');
        assert.equal(f.bottomHud.active, false, '宝箱 / 聊天条 / 挂机 / 任务入口一起收');
        assert.equal(f.beginGame.active, false, '快速寻敌同样收');
        assert.equal(f.navVisible(), false, '底部七格导航收');
        assert.equal(f.gmButton.active, true, 'GM 入口不参与门控：游标卡在 5-4 之前也得留着');
        assert.equal(f.topHud.active, true, '门控不碰整块 TopHud —— 左上玩家卡与资源条不在紫框里');

        // 领奖弹窗让位（`view.hide()` + `restoreDialogHud()`）—— 这就是现场那一刻，仍不许露。
        lifecycle(f.firstReward, 'enabled');
        assert.equal(f.entryBar.active, false, '让位不等于解锁');
        assert.equal(f.bottomHud.active, false);
        assert.equal(f.navVisible(), false);
        lifecycle(f.firstReward, 'disabled');

        // 5-4 打完回主页（stepId 已经是 6-1）⇒ 这批 HUD 放出来，但任务入口还压着。
        f.render({ finished: false, stepId: '6-1', focusNode: '' });
        assert.equal(f.entryBar.active, true, '5-4 之后入口排解锁');
        assert.equal(f.bottomHud.active, true, '底栏解锁');
        assert.equal(f.navVisible(), true, '导航解锁');
        assert.equal(f.mainTaskEntry.active, false, '任务入口要等 8-1');
        assert.equal(f.taskGuideUnlocked(), false, '静态门控同步（页面重建后也守得住）');
        assert.equal(f.taskRefreshes(), 0, '还没解锁就不该重读快照');

        // 8-1（主线任务那一步）⇒ 任务入口出现，并且让它按自己的快照重算一次。
        f.render({ finished: false, stepId: '8-1', focusNode: '' });
        assert.equal(f.taskGuideUnlocked(), true);
        assert.equal(f.taskRefreshes(), 1, '解锁时重读一次快照（入口可能没配任务，不能无脑打开）');

        // 引导全部结束 ⇒ 全部保持解锁。
        f.render({ finished: true, stepId: '', focusNode: '' });
        assert.equal(f.entryBar.active, true);
        assert.equal(f.taskGuideUnlocked(), true);
    } finally { f.composition.dispose(); }
});

test('5-4 之前即使 TopHud 带真实 MainTopHudToggle 并被恢复激活，9 个兄弟入口节点也全部保持隐藏；6-1 后一并恢复', async () => {
    const withToggle = fixture(false, false, 'territory', false, true, true, { withTopToggle: true });
    try {
        await tick();
        withToggle.render({ finished: false, stepId: '2-3', focusNode: '' });
        for (const name of TOP_ENTRY_SIBLING_NAMES) {
            assert.equal(withToggle.topEntries[name].active, false, `5-4 之前 ${name} 必须隐藏`);
        }
        // 领奖弹窗让位会把 TopHud 翻回可见，引擎随之触发 MainTopHudToggle.onEnable()；不得把兄弟节点翻回可见。
        const reward = openRewardPopup(withToggle);
        assert.equal(withToggle.topHud.active, true);
        withToggle.topToggle!.onEnable();
        for (const name of TOP_ENTRY_SIBLING_NAMES) {
            assert.equal(withToggle.topEntries[name].active, false, `TopHud 重激活后 ${name} 仍不得露出`);
        }
        closeRewardPopup(reward);
        withToggle.render({ finished: false, stepId: '6-1', focusNode: '' });
        for (const name of TOP_ENTRY_SIBLING_NAMES) {
            assert.equal(withToggle.topEntries[name].active, true, `6-1 解锁后 ${name} 应恢复可见`);
        }
    } finally { withToggle.composition.dispose(); }

    const fallback = fixture(false, false, 'territory', false, true, true, { withTopSiblings: true });
    try {
        await tick();
        fallback.render({ finished: false, stepId: '2-3', focusNode: '' });
        for (const name of TOP_ENTRY_SIBLING_NAMES) {
            assert.equal(fallback.topEntries[name].active, false, `无 Toggle 兜底也应隐藏 ${name}`);
        }
        fallback.render({ finished: false, stepId: '6-1', focusNode: '' });
        for (const name of TOP_ENTRY_SIBLING_NAMES) {
            assert.equal(fallback.topEntries[name].active, true, `无 Toggle 兜底在 6-1 后应恢复 ${name}`);
        }
    } finally { fallback.composition.dispose(); }
});

test('冷启动 finished=true 且无任务配置时不强制点亮 MainTaskEntry，也不自动弹出 MainTaskDetailPage', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.setTaskConfigured(false);
        f.mainTaskEntry.active = false;
        f.render({ finished: true, stepId: '', focusNode: '', completeCond: '' });
        await tick();
        assert.equal(f.taskGuideUnlocked(), true);
        assert.equal(f.taskRefreshes(), 1);
        assert.equal(f.mainTaskEntry.active, false);
        assert.equal(f.goalCounts().requests, 0);
    } finally { f.composition.dispose(); }
});

test('8-1 无任务配置且奖励弹窗或异步快照切换态未落定时，不越权弹出 MainTaskDetailPage', async () => {
    const deferred = fixture(false, true, 'territory');
    try {
        await tick();
        deferred.setTaskConfigured(false);
        deferred.render(REWARD_HOLD_STATE);
        await tick();
        assert.equal(deferred.goalCounts().requests, 0, '奖励弹窗未关前禁止自动弹出主线任务面板');
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, deferred.firstReward);
        await tick();
        assert.equal(deferred.goalCounts().requests, 1, '奖励弹窗关闭后才允许代开兜底');
    } finally { deferred.composition.dispose(); }

    const stale = fixture(false, false, 'territory');
    try {
        await tick();
        stale.setTaskConfigured(false);
        stale.setTaskRefreshPending(true);
        stale.render(REWARD_HOLD_STATE);
        stale.render({ finished: true, stepId: '', focusNode: '', completeCond: '' });
        stale.finishTaskRefresh();
        await tick();
        assert.equal(stale.goalCounts().requests, 0, 'refresh 期间已离开 8-1，不再代开面板');
    } finally { stale.composition.dispose(); }
});

test('syncDialogHud 过渡步恢复 BottomNav 且源码不使用 [...this.hiddenHud]', async () => {
    const source = readFileSync('assets/script/app/bootstrap/guide/GuideComposition.ts', 'utf8');
    assert.equal(source.includes('[...this.hiddenHud]'), false);
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.render({ stepId: '6-1', finished: false, focusNode: 'Map/Level_1', completeCond: 'tileFlipped:1' });
        assert.equal(f.navVisible(), false);
        f.render({ stepId: '6-2', finished: false, focusNode: 'Main/CardEntry', completeCond: 'pageOpened:card' });
        assert.equal(f.navVisible(), true);
    } finally { f.composition.dispose(); }
});

test('6-1 门控解锁时保留本来就是隐藏态的 BeginGame，不强行设为可见', async () => {
    const f = fixture(false, false, 'territory');
    try {
        await tick();
        f.beginGame.active = false;
        f.render({ stepId: '2-3', finished: false, focusNode: '' });
        f.render({ stepId: '6-1', finished: false, focusNode: '' });
        assert.equal(f.beginGame.active, false);
    } finally { f.composition.dispose(); }
});

test('启动中止（空步骤表 / 缺少 Canvas / 缺少 GuideDialogView / start 失败）清理节点并放行 MainTaskEntry', async () => {
    const emptySteps = fixture(false, false, 'territory', false, true, true, { steps: [] });
    try {
        FakeMainTaskEntry.guideUnlocked = false;
        await tick();
        assert.equal(emptySteps.counts().starts, 0);
        assert.equal(emptySteps.counts().stops, 0);
        assert.equal(emptySteps.taskGuideUnlocked(), true);
        emptySteps.render({ stepId: '1-1', finished: false, focusNode: '' });
        assert.equal(emptySteps.counts().rendered, 0, '中止销毁后不再响应 Output 事件');
    } finally { emptySteps.composition.dispose(); }

    const noCanvas = fixture(false, false, 'territory', false, true, true, { missingCanvas: true });
    try {
        await tick();
        assert.equal(noCanvas.counts().starts, 0);
        assert.equal(noCanvas.counts().stops, 0);
        assert.equal(noCanvas.taskGuideUnlocked(), true);
    } finally { noCanvas.composition.dispose(); }

    const noView = fixture(false, false, 'territory', false, true, true, { missingView: true });
    try {
        await tick();
        assert.equal(noView.counts().starts, 0);
        assert.equal(noView.counts().destroys, 1);
        assert.equal(noView.counts().stops, 0);
        assert.equal(noView.taskGuideUnlocked(), true);
    } finally { noView.composition.dispose(); }

    const startFail = fixture(false, false, 'territory', false, true, true, { startFails: true });
    try {
        FakeMainTaskEntry.guideUnlocked = false;
        await tick();
        assert.equal(startFail.counts().starts, 1);
        assert.equal(startFail.counts().stops, 1);
        assert.equal(startFail.counts().destroys, 1);
        assert.equal(startFail.taskGuideUnlocked(), true);
    } finally { startFail.composition.dispose(); }
});

test('GuideDialog 挂载在 Canvas 时插入 GMButton 之前，且单次渲染只查一次地图焦点并锁定 6-3 回退列表拖拽', async () => {
    const territory = fixture(false, false, 'territory', false, true, true, { resolveInRender: true });
    try {
        await tick();
        const guideIndex = territory.canvasChildren.indexOf(territory.guideNode);
        const gmIndex = territory.canvasChildren.indexOf(territory.gmButton);
        assert.ok(guideIndex >= 0);
        assert.ok(guideIndex < gmIndex, 'GuideDialog 必须排在 GMButton 之前');
        territory.render({ stepId: '6-1', finished: false, focusNode: 'Map/Level_1', completeCond: 'tileFlipped:1' });
        assert.equal(territory.mapFocusQueries(), 1, 'view.render 与 syncDialogHud 不得重复查地图焦点');
    } finally { territory.composition.dispose(); }

    const card = fixture(false, false, 'card', false, true, true, { resolveInRender: true });
    try {
        await tick();
        card.render({ stepId: '6-3', finished: false, focusNode: 'CardDetail/BtnUpgrade', completeCond: 'cardLevelUp:68001' });
        assert.equal(card.renderedFocus(), 'CardList/Card_68001');
        assert.equal(card.scrollLocks.at(-1), true, '6-3 详情页未开回退到目标卡时必须锁定卡库拖拽');
    } finally { card.composition.dispose(); }
});
