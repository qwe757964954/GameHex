import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { PopupCompositionHost, type IPopupComposition } from '../assets/script/framework/ui/PopupCompositionHost';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueCreateController } from '../assets/script/app/league/LeagueCreateController';
import { LeagueCreateModel } from '../assets/script/app/league/LeagueCreateModel';
import { LeagueCreateEvent, type ILeagueCreateViewState } from '../assets/script/app/league/LeagueCreateEvents';
import { LeagueTabEvent } from '../assets/script/app/league/LeagueTabEvents';
import type { ILeagueCostView } from '../assets/script/app/league/LeagueTable';
import type { LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const PAGE_TS = 'assets/script/app/league/LeagueCreatePage.ts';
const COMPOSITION_TS = 'assets/script/app/bootstrap/LeagueCreatePopupComposition.ts';

function load<T>(file: string, imports: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, { exports, console, require: (name: string) => {
        const key = name.split('/').pop() as string;
        assert.ok(key in imports, `未提供的依赖：${name}`);
        return imports[key];
    } });
    return exports as T;
}

class NodeStub {
    active = true;
    isValid = true;
    private readonly handlers = new Map<string, { callback: (...args: unknown[]) => void; target: object }>();
    private readonly button = { interactable: true, node: this as NodeStub };
    on(event: string, callback: (...args: unknown[]) => void, target: object): void {
        this.handlers.set(event, { callback, target });
    }
    getComponent(_type?: unknown): { interactable: boolean; node: NodeStub } { return this.button; }
    getComponentInChildren(): null { return null; }
    getChildByName(): null { return null; }
    emit(event: string): void {
        const entry = this.handlers.get(event);
        if (entry) entry.callback.call(entry.target);
    }
}

interface ICreateViewHarness {
    closeButton: NodeStub;
    nameInput: { node: NodeStub; string: string };
    bannerList: {
        isValid: boolean;
        renderItemFn?: (node: unknown, index: number) => void;
        onItemClickFn?: (node: unknown, index: number) => void;
        refreshList(): void;
        getItemByIndex(i: number): null;
    };
    quickJoinBox: NodeStub;
    quickJoinCheck: NodeStub;
    costButton: NodeStub;
    costIcon: null;
    costHasLabel: null;
    costNeedLabel: null;
    node: { getChildByName(): null; isValid: boolean };
    closed: number;
    onInit(): void;
    render(state: ILeagueCreateViewState): void;
}

function pageImports(): Record<string, unknown> {
    return {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Button: { EventType: { CLICK: 'click' } },
            Node: NodeStub, EditBox: class {}, Label: class {}, Sprite: class {}, SpriteFrame: class {},
            Color: class { constructor(..._args: number[]) {} },
        },
        EventMgr: { EventMgr },
        PopupBase: { PopupBase: class { closed = 0; closeByButton() { this.closed += 1; } } },
        VScrollView: { VirtualScrollView: class {} },
        CardLineupIcons: { loadArt: async () => null },
        LeagueArt: {
            LEAGUE_ART_ROOT: '', LEAGUE_COST_ICON_ROOT: '',
            LEAGUE_COST_ENOUGH_COLOR: [0, 0, 0], LEAGUE_COST_ENOUGH_STROKE: [0, 0, 0],
            LEAGUE_COST_SHORT_COLOR: [0, 0, 0], LEAGUE_COST_SHORT_STROKE: [0, 0, 0],
            leagueBannerArt: () => '',
        },
        LeagueCreateEvents: { LeagueCreateEvent },
        LeagueTable: { leagueCreateBannerIndices: () => [0, 1, 2, 3, 4, 5, 6, 7] },
        LeagueTexts: {
            LEAGUE_CREATE_NAME_PROMPT: 'prompt', LEAGUE_CREATE_QUICK_JOIN: 'quick',
            LEAGUE_CREATE_SUBMIT: 'submit', LEAGUE_CREATE_TITLE: 'title',
        },
    };
}

function makeView(Page: new () => ICreateViewHarness): ICreateViewHarness {
    const view = new Page();
    view.closeButton = new NodeStub();
    view.nameInput = { node: new NodeStub(), string: '' };
    view.bannerList = {
        isValid: true, refreshList() {}, getItemByIndex: () => null,
    };
    view.quickJoinBox = new NodeStub();
    view.quickJoinCheck = new NodeStub();
    view.costButton = new NodeStub();
    view.costIcon = null;
    view.costHasLabel = null;
    view.costNeedLabel = null;
    view.node = { getChildByName: () => null, isValid: true };
    return view;
}

/** 组装一套「真 Page + 真 Controller + 真 Host」的会话，repository 用内存桩。 */
function compositionHarness() {
    const { LeagueCreatePage } = load<{ LeagueCreatePage: new () => ICreateViewHarness }>(PAGE_TS, pageImports());
    const tips: string[] = [], cancelled: object[] = [], joined: object[] = [];
    const joinedTarget = {};
    EventMgr.instance.on(LeagueTabEvent.Joined, (event: { owner: object }) => joined.push(event.owner), joinedTarget);
    const costCalls: Array<{ resolve: (cost: ILeagueCostView) => void }> = [];
    const createCalls: Array<{
        icon: number; name: string; quick: boolean; caller: object;
        resolve: (result: LeagueRequestResult) => void;
    }> = [];
    const makeCost = (enough: boolean): ILeagueCostView => ({
        resId: 10, need: 100, enough, hasText: '120/', needText: '100',
        iconRoot: '', iconName: '', unenoughTips: '', name: '金币',
    });
    const { createLeagueCreatePopupComposition } = load<{
        createLeagueCreatePopupComposition: (context: ReturnType<typeof createControllerContext>, view: object) => IPopupComposition | null;
    }>(COMPOSITION_TS, {
        EventMgr: { EventMgr },
        FW: { FW: { showTip: (text: string) => tips.push(text) } },
        LeagueCreateController: { LeagueCreateController },
        LeagueCreateModel: { LeagueCreateModel },
        LeagueCreatePage: { LeagueCreatePage },
        LeagueRepository: {
            leagueRepository: {
                createCost: () => new Promise<ILeagueCostView>(resolve => costCalls.push({ resolve })),
                requestCreat: (icon: number, name: string, quick: boolean, caller: object) =>
                    new Promise<LeagueRequestResult>(resolve => createCalls.push({ icon, name, quick, caller, resolve })),
            },
        },
        LeagueTabEvents: { LeagueTabEvent },
        GameNet: { GameNet: { instance: { removeCaller: (caller: object) => cancelled.push(caller) } } },
    });
    const context = createControllerContext();
    const host = new PopupCompositionHost<object>(view => createLeagueCreatePopupComposition(context, view));
    return {
        LeagueCreatePage, host, tips, cancelled, joined, costCalls, createCalls, makeCost,
        factory: createLeagueCreatePopupComposition, context,
        newView: () => makeView(LeagueCreatePage),
        close: () => { host.dispose(); EventMgr.instance.offTarget(joinedTarget); },
    };
}

test('真创建页只派发 owner 意图，render 按状态绝对赋值，不持有回调', () => {
    const { LeagueCreatePage } = load<{ LeagueCreatePage: new () => ICreateViewHarness }>(PAGE_TS, pageImports());
    const view = makeView(LeagueCreatePage);
    const events: Array<{ owner: object; kind: string }> = [];
    const target = {};
    EventMgr.instance.on(LeagueCreateEvent.Intent, event => events.push(event), target);
    try {
        view.onInit();
        view.nameInput.string = '名字';
        view.nameInput.node.emit('text-changed');
        view.quickJoinCheck.active = true;
        view.quickJoinBox.emit('click');
        view.bannerList.onItemClickFn?.call(null, null, 3);
        view.costButton.emit('click');
        assert.deepEqual(events.map(event => event.kind), ['name', 'quickJoin', 'banner', 'submit']);
        assert.ok(events.every(event => event.owner === view));

        view.render({ name: '新值', selectIndex: 5, quickJoin: false, cost: null, submitting: true });
        assert.equal(view.nameInput.string, '新值');
        assert.equal(view.quickJoinCheck.active, false);
        assert.equal(view.costButton.getComponent().interactable, false);
        view.render({ name: '重开', selectIndex: 0, quickJoin: true, cost: null, submitting: false });
        assert.equal(view.nameInput.string, '重开');
        assert.equal(view.quickJoinCheck.active, true);
        assert.equal(view.costButton.getComponent().interactable, true);
        view.closeButton.emit('click');
        assert.equal(view.closed, 1);
    } finally { EventMgr.instance.offTarget(target); }
});

test('factory 只认创建页；一次打开一个控制器，关闭取消 caller，缓存重开互相隔离', async () => {
    const h = compositionHarness();
    try {
        assert.equal(h.factory(h.context, {}), null);
        const view = h.newView();
        const owner = {};
        assert.equal(await h.host.open(view, { owner }), true);
        assert.equal(h.costCalls.length, 1, 'start() 主动读一次消耗');
        h.costCalls[0].resolve(h.makeCost(true)); await flush();

        EventMgr.instance.emit(LeagueCreateEvent.Intent, {
            owner: view, kind: 'submit', name: '旧名', quickJoin: true,
        });
        assert.equal(h.costCalls.length, 2);
        h.costCalls[1].resolve(h.makeCost(true)); await flush();
        assert.equal(h.createCalls.length, 1);
        const firstCaller = h.createCalls[0].caller;

        h.host.close(view); h.host.close(view);
        assert.deepEqual(h.cancelled, [firstCaller], '关闭立刻作废在飞请求');

        assert.equal(await h.host.open(view, { owner }), true);
        assert.equal(h.costCalls.length, 3);
        h.costCalls[2].resolve(h.makeCost(true)); await flush();
        const rendered = view.closed;
        h.createCalls[0].resolve('ok'); await flush();
        assert.equal(view.closed, rendered, '旧会话的迟到成功不许关掉重开的弹窗');
        assert.deepEqual(h.joined, [], '旧会话不许通知容器');

        EventMgr.instance.emit(LeagueCreateEvent.Intent, {
            owner: view, kind: 'submit', name: '新名', quickJoin: false,
        });
        h.costCalls[3].resolve(h.makeCost(true)); await flush();
        assert.equal(h.createCalls.length, 2);
        assert.equal(h.createCalls[1].name, '新名');
        assert.notEqual(h.createCalls[1].caller, firstCaller);
        h.createCalls[1].resolve('ok'); await flush();
        assert.equal(view.closed, rendered + 1);
        assert.deepEqual(h.joined, [owner], '成功按传入 owner 发 Joined 事件');
        h.host.close(view);
        assert.deepEqual(h.cancelled, h.createCalls.map(call => call.caller));
    } finally { h.close(); }
});

test('bootstrap 串联新 factory，framework 仍不反向依赖 app feature', () => {
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    assert.match(bootstrap, /createCardPopupComposition\(manager\.context, view\)\s*\?\? createLeaguePopupComposition\(manager\.context, view\)/);
    assert.match(bootstrap, /\?\? createLeagueCreatePopupComposition\(manager\.context, view\)/);
    const framework = readFileSync('assets/script/framework/ui/PopupManager.ts', 'utf8');
    assert.doesNotMatch(framework, /LeagueCreate|LeaguePopup|CardPopup/);
});

test('新增脚本都有独立 .meta，纯 TS 契约不引入引擎或 I/O', () => {
    const files = [
        'assets/script/app/league/LeagueCreateEvents.ts',
        'assets/script/app/league/LeagueCreateModel.ts',
        'assets/script/app/league/LeagueCreateController.ts',
        'assets/script/app/bootstrap/LeagueCreatePopupComposition.ts',
    ];
    const uuids = new Set<string>();
    for (const file of files) {
        const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8')) as { importer: string; imported: boolean; uuid: string };
        assert.equal(meta.importer, 'typescript');
        assert.equal(meta.imported, true);
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/i);
        uuids.add(meta.uuid);
        if (!file.includes('Composition')) {
            assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]cc['"]|resources\.load|fetch\(/);
        }
    }
    assert.equal(uuids.size, files.length);
});
