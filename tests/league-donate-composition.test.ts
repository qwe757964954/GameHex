import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { PopupCompositionHost, type IPopupComposition } from '../assets/script/framework/ui/PopupCompositionHost';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueDonateController } from '../assets/script/app/league/LeagueDonateController';
import { LeagueDonateModel } from '../assets/script/app/league/LeagueDonateModel';
import { LeagueDonateEvent, type ILeagueDonateViewState } from '../assets/script/app/league/LeagueDonateEvents';
import type { ILeagueDonateSnapshot, LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const PAGE_TS = 'assets/script/app/league/LeagueDonatePage.ts';
const COMPOSITION_TS = 'assets/script/app/bootstrap/LeagueDonatePopupComposition.ts';

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
    isValid = true;
    private readonly handlers = new Map<string, { callback: () => void; target: object }>();
    private readonly button = { interactable: true, node: this as NodeStub };
    on(event: string, callback: () => void, target: object): void {
        this.handlers.set(event, { callback, target });
    }
    getComponent(_type?: unknown): { interactable: boolean; node: NodeStub } { return this.button; }
    emit(event: string): void {
        const entry = this.handlers.get(event);
        if (entry) entry.callback.call(entry.target);
    }
}

class AdButtonStub {
    readonly node = new NodeStub();
    readonly calls: string[] = [];
    setPage(page: string): void { this.calls.push(`page:${page}`); }
    setFreeLabel(text: string): void { this.calls.push(`free:${text}`); }
    setCost(cost: number): void { this.calls.push(`cost:${cost}`); }
    setCostIcon(_icon: unknown): void { this.calls.push('costIcon'); }
    setRedDot(on: boolean): void { this.calls.push(`redDot:${on}`); }
}

class SlotStub {
    readonly calls: unknown[][] = [];
    render(...args: unknown[]): void { this.calls.push(args); }
}

interface IDonateViewHarness {
    closeButton: NodeStub;
    coinSlot: SlotStub;
    coinName: { string: string };
    expSlot: SlotStub;
    expName: { string: string };
    countLabel: { string: string };
    freeButton: AdButtonStub;
    buyButton: AdButtonStub;
    node: { isValid: boolean };
    closed: number;
    onInit(): void;
    render(state: ILeagueDonateViewState): void;
}

function pageImports(): Record<string, unknown> {
    return {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Button: { EventType: { CLICK: 'click' } }, Node: NodeStub, Label: class {},
        },
        EventMgr: { EventMgr },
        PopupBase: { PopupBase: class { closed = 0; closeByButton() { this.closed += 1; } } },
        LeagueAdButton: { LeagueAdButton: AdButtonStub },
        LeagueDonateEvents: { LeagueDonateEvent },
        LeagueRewardArt: {
            loadLeagueRewardArt: async () => ({
                framesOf: () => ({ frame: null, icon: null }),
                iconFrameOf: () => null,
            }),
        },
        LeagueRewardSlot: { LeagueRewardSlot: SlotStub },
        LeagueTexts: {
            fillLeagueText: (template: string, ...args: number[]) =>
                template.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])),
            LEAGUE_DONATE_FREE_COUNT_TEMPLATE: '{0}/{1}',
            LEAGUE_DONATE_TITLE: 'title',
        },
        LeagueTable: { LEAGUE_COIN_RES_ID: 10 },
    };
}

function snapshot(overrides: Partial<ILeagueDonateSnapshot> = {}): ILeagueDonateSnapshot {
    return {
        config: {
            donateCost: 10, donateGainCoin: 300, donateGainExp: 10,
            donateMaxCount: 3, donateAdvCount: 2, bargainBuyCount: 1,
        },
        todayDonateTimes: 0, todayDonateAdvTimes: 0, remain: 3,
        remainText: '剩余捐献次数：3/3', coinNameText: '联盟金币*300', expNameText: '联盟贡献*10',
        coinResId: 11, expResId: 13, enough: true, hasTimes: true,
        items: new Map(), resources: new Map(), ...overrides,
    } as ILeagueDonateSnapshot;
}

function makeView(Page: new () => IDonateViewHarness): IDonateViewHarness {
    const view = new Page();
    view.closeButton = new NodeStub();
    view.coinSlot = new SlotStub();
    view.coinName = { string: '' };
    view.expSlot = new SlotStub();
    view.expName = { string: '' };
    view.countLabel = { string: '' };
    view.freeButton = new AdButtonStub();
    view.buyButton = new AdButtonStub();
    view.node = { isValid: true };
    return view;
}

function harness() {
    const { LeagueDonatePage } = load<{ LeagueDonatePage: new () => IDonateViewHarness }>(PAGE_TS, pageImports());
    const tips: string[] = [], cancelled: object[] = [];
    const confirms: Array<{ content: string; onSure: () => void }> = [];
    const loadCalls: Array<{ resolve: (value: ILeagueDonateSnapshot) => void }> = [];
    const donateCalls: Array<{ adv: boolean; caller: object; resolve: (value: LeagueRequestResult) => void }> = [];
    let adPlayed = 0;
    const { createLeagueDonatePopupComposition } = load<{
        createLeagueDonatePopupComposition: (context: ReturnType<typeof createControllerContext>, view: object) => IPopupComposition | null;
    }>(COMPOSITION_TS, {
        FW: { FW: { showTip: (text: string) => tips.push(text) } },
        CommonTips: { CommonTips: { open: ({ userData }: { userData: { content: string; onSure: () => void } }) => {
            confirms.push(userData); return Promise.resolve();
        } } },
        LeagueAd: { playLeagueAd: async () => { adPlayed += 1; return true; } },
        LeagueDonateController: { LeagueDonateController },
        LeagueDonateModel: { LeagueDonateModel },
        LeagueDonatePage: { LeagueDonatePage },
        LeagueRepository: {
            leagueRepository: {
                loadDonate: () => new Promise<ILeagueDonateSnapshot>(resolve => loadCalls.push({ resolve })),
                requestDonate: (adv: boolean, caller: object) => new Promise<LeagueRequestResult>(resolve =>
                    donateCalls.push({ adv, caller, resolve })),
            },
        },
        GameNet: { GameNet: { instance: { removeCaller: (caller: object) => cancelled.push(caller) } } },
    });
    const context = createControllerContext();
    const host = new PopupCompositionHost<object>(view => createLeagueDonatePopupComposition(context, view));
    return {
        LeagueDonatePage, host, context, tips, cancelled, confirms, loadCalls, donateCalls,
        factory: createLeagueDonatePopupComposition,
        newView: () => makeView(LeagueDonatePage),
        get adPlayed() { return adPlayed; },
    };
}

test('真捐献页只派发 owner 意图，render 绝对赋值且红点恒关', () => {
    const { LeagueDonatePage } = load<{ LeagueDonatePage: new () => IDonateViewHarness }>(PAGE_TS, pageImports());
    const view = makeView(LeagueDonatePage);
    const events: Array<{ owner: object; kind: string }> = [];
    const target = {};
    EventMgr.instance.on(LeagueDonateEvent.Intent, event => events.push(event), target);
    try {
        view.onInit();
        view.freeButton.node.emit('click');
        view.buyButton.node.emit('click');
        assert.deepEqual(events.map(event => event.kind), ['free', 'coin']);
        assert.ok(events.every(event => event.owner === view));

        const snap = snapshot({ remainText: '剩余捐献次数：1/3', todayDonateAdvTimes: 1 });
        view.render({ snapshot: snap, busy: false });
        assert.equal(view.coinName.string, '联盟金币*300');
        assert.equal(view.expName.string, '联盟贡献*10');
        assert.equal(view.countLabel.string, '剩余捐献次数：1/3');
        assert.ok(view.freeButton.calls.includes('redDot:false'), '免费按钮红点恒关');
        assert.ok(view.buyButton.calls.includes('cost:10'));
        assert.ok(view.freeButton.calls.some(call => call.startsWith('free:')));
        view.closeButton.emit('click');
        assert.equal(view.closed, 1);
    } finally { EventMgr.instance.offTarget(target); }
});

test('factory 只认捐献页；真实端口接线，关闭取消 caller，缓存重开隔离', async () => {
    const h = harness();
    try {
        assert.equal(h.factory(h.context, {}), null);
        const view = h.newView();
        assert.equal(await h.host.open(view, {}), true);
        assert.equal(h.loadCalls.length, 1);
        h.loadCalls[0].resolve(snapshot()); await flush();

        // 免费路：真 playLeagueAd 播完才发 adv=true
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: view, kind: 'free' });
        await flush(); await flush();
        assert.equal(h.adPlayed, 1);
        assert.equal(h.donateCalls.length, 1);
        assert.equal(h.donateCalls[0].adv, true);
        const firstCaller = h.donateCalls[0].caller;

        h.host.close(view); h.host.close(view);
        assert.deepEqual(h.cancelled, [firstCaller]);
        h.donateCalls[0].resolve('ok'); await flush();
        assert.equal(h.loadCalls.length, 1, '旧会话的迟到成功不许刷新重开的弹窗');

        assert.equal(await h.host.open(view, {}), true);
        assert.equal(h.loadCalls.length, 2);
        h.loadCalls[1].resolve(snapshot()); await flush();
        // 金币路：真 CommonTips 的 onSure 才触发 adv=false
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: view, kind: 'coin' });
        assert.equal(h.confirms.length, 1);
        assert.equal(h.donateCalls.length, 1);
        h.confirms[0].onSure(); await flush();
        assert.equal(h.donateCalls.length, 2);
        assert.equal(h.donateCalls[1].adv, false);
        assert.notEqual(h.donateCalls[1].caller, firstCaller);

        // 次数用完时只走 FW.showTip，不弹确认、不发包
        h.donateCalls[1].resolve('ok'); await flush();
        h.loadCalls[2].resolve(snapshot({ hasTimes: false })); await flush();
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: view, kind: 'coin' });
        assert.equal(h.confirms.length, 1);
        assert.equal(h.donateCalls.length, 2);
        assert.equal(h.tips.length, 1);
        h.host.close(view);
        assert.deepEqual(h.cancelled, h.donateCalls.map(call => call.caller));
    } finally { h.host.dispose(); }
});

test('bootstrap 串联捐献 factory，framework 仍不反向依赖 app feature', () => {
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    assert.match(bootstrap, /createCardPopupComposition\(manager\.context, view\)\s*\?\? createLeaguePopupComposition\(manager\.context, view\)/);
    assert.match(bootstrap, /\?\? createLeagueDonatePopupComposition\(manager\.context, view\)/);
    const framework = readFileSync('assets/script/framework/ui/PopupManager.ts', 'utf8');
    assert.doesNotMatch(framework, /LeagueDonate|LeagueCreate|LeaguePopup|CardPopup/);
});

test('捐献新增脚本都有独立 .meta，纯 TS 契约不引入引擎或 I/O', () => {
    const files = [
        'assets/script/app/league/LeagueDonateEvents.ts',
        'assets/script/app/league/LeagueDonateModel.ts',
        'assets/script/app/league/LeagueDonateController.ts',
        'assets/script/app/bootstrap/LeagueDonatePopupComposition.ts',
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
