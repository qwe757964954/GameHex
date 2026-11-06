import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { PopupCompositionHost, type IPopupComposition } from '../assets/script/framework/ui/PopupCompositionHost';
import { LeagueEditController } from '../assets/script/app/league/LeagueEditController';
import { LeagueEditModel } from '../assets/script/app/league/LeagueEditModel';
import { LeagueEditEvent, type ILeagueEditViewState } from '../assets/script/app/league/LeagueEditEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import type { LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import { LEAGUE_EDIT_TITLE } from '../assets/script/app/league/LeagueTexts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function load<T>(file: string, imports: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, { exports, console, require: (name: string) => {
        const key = name.split('/').pop() as string;
        assert.ok(key in imports, name);
        return imports[key];
    } });
    return exports as T;
}

class NodeStub {
    readonly button = { interactable: true };
    private readonly handlers = new Map<string, { callback: () => void; target: object }>();
    on(event: string, callback: () => void, target: object): void { this.handlers.set(event, { callback, target }); }
    getComponent(): { interactable: boolean } { return this.button; }
    emit(event: string): void { const entry = this.handlers.get(event); if (entry) entry.callback.call(entry.target); }
}
interface IPageHarness {
    closeButton: NodeStub; cancelButton: NodeStub; sureButton: NodeStub;
    inputField: { node: NodeStub; string: string };
    closed: number;
    onInit(): void;
    render(state: ILeagueEditViewState): void;
}

test('real edit view binds CLICK and text change once, emits owner intents and renders reused state', () => {
    class Base { closed = 0; closeByButton() { this.closed++; } }
    const { LeagueEditPage } = load<{ LeagueEditPage: new () => IPageHarness }>('assets/script/app/league/LeagueEditPage.ts', {
        cc: { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Button: { EventType: { CLICK: 'click' } }, Node: NodeStub, EditBox: class {} },
        PopupBase: { PopupBase: Base }, EventMgr: { EventMgr },
        LeagueEditEvents: { LeagueEditEvent }, LeagueTexts: { LEAGUE_EDIT_TITLE },
    });
    const view = new LeagueEditPage();
    view.closeButton = new NodeStub(); view.cancelButton = new NodeStub(); view.sureButton = new NodeStub();
    view.inputField = { node: new NodeStub(), string: '' };
    const target = {}, events: Array<{ owner: object; kind: string; content: string }> = [];
    EventMgr.instance.on(LeagueEditEvent.Intent, event => events.push(event), target);
    try {
        view.onInit();
        view.render({ content: '原文', submitting: false });
        view.inputField.string = '新草稿'; view.inputField.node.emit('text-changed'); view.sureButton.emit('click');
        assert.equal(events.length, 2);
        assert.ok(events.every(event => event.owner === view && event.content === '新草稿'));
        assert.deepEqual(events.map(event => event.kind), ['change', 'submit']);
        view.render({ content: '新草稿', submitting: true });
        assert.equal(view.sureButton.button.interactable, false);
        view.render({ content: '重开初值', submitting: false });
        assert.equal(view.inputField.string, '重开初值');
        assert.equal(view.sureButton.button.interactable, true);
        view.cancelButton.emit('click'); view.closeButton.emit('click');
        assert.equal(view.closed, 2);
    } finally { EventMgr.instance.offTarget(target); }
});

test('real composition owns one controller per opening, cancels old caller and isolates cached reopening', async () => {
    class Page {
        states: ILeagueEditViewState[] = [];
        closed = 0;
        render(state: ILeagueEditViewState) { this.states.push(state); }
        closeByButton() { this.closed++; }
    }
    const cancelled: object[] = [], tips: string[] = [];
    const requests: Array<{ caller: object; type: number; content: string; resolve: (result: LeagueRequestResult) => void }> = [];
    const { createLeaguePopupComposition } = load<{
        createLeaguePopupComposition: (context: ReturnType<typeof createControllerContext>, view: object) => IPopupComposition | null;
    }>('assets/script/app/bootstrap/LeaguePopupComposition.ts', {
        LeagueEditPage: { LeagueEditPage: Page }, LeagueEditModel: { LeagueEditModel }, LeagueEditController: { LeagueEditController },
        FW: { FW: { showTip: (text: string) => tips.push(text) } },
        GameNet: { GameNet: { instance: { removeCaller: (caller: object) => cancelled.push(caller) } } },
        LeagueRepository: { leagueRepository: { edit: (type: number, content: string, caller: object) =>
            new Promise<LeagueRequestResult>(resolve => requests.push({ caller, type, content, resolve })) } },
    });
    const context = createControllerContext();
    assert.equal(createLeaguePopupComposition(context, {}), null);
    const host = new PopupCompositionHost<object>(view => createLeaguePopupComposition(context, view));
    const view = new Page();
    try {
        assert.equal(await host.open(view, { type: 1, content: '旧值' }), true);
        EventMgr.instance.emit(LeagueEditEvent.Intent, { owner: view, kind: 'submit', content: '旧值' });
        host.close(view); host.close(view);
        assert.equal(await host.open(view, { type: 4, content: '新值' }), true);
        const rendered = view.states.length;
        requests[0].resolve('ok'); await flush();
        assert.equal(view.states.length, rendered);
        assert.equal(view.closed, 0);
        EventMgr.instance.emit(LeagueEditEvent.Intent, { owner: view, kind: 'submit', content: '新值' });
        assert.equal(requests.length, 2);
        assert.equal(requests[1].type, 4);
        assert.notEqual(requests[0].caller, requests[1].caller);
        assert.deepEqual(cancelled, [requests[0].caller]);
        requests[1].resolve('ok'); await flush(); assert.equal(view.closed, 1);
        host.close(view); assert.deepEqual(cancelled, requests.map(request => request.caller));
        assert.deepEqual(tips, []);
        const broken = new Page(); broken.render = () => { throw new Error('render failed'); };
        await assert.rejects(host.open(broken, { type: 1, content: '值' }), /render failed/);
        assert.equal(cancelled.length, 3);
    } finally { host.dispose(); }
});

test('bootstrap dispatches both card and league sessions without introducing feature imports into framework', () => {
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    assert.match(bootstrap, /createCardPopupComposition\(manager.context, view\)\s*\?\? createLeaguePopupComposition\(manager.context, view\)/);
    const framework = readFileSync('assets/script/framework/ui/PopupManager.ts', 'utf8');
    assert.doesNotMatch(framework, /LeagueEdit|LeaguePopup|CardPopup/);
});

test('edit contracts and rules stay engine independent and new scripts have imported engine metadata', () => {
    const files = ['assets/script/app/bootstrap/LeaguePopupComposition.ts',
        ...['LeagueEditController', 'LeagueEditModel', 'LeagueEditEvents'].map(name => `assets/script/app/league/${name}.ts`)];
    const uuids = new Set<string>();
    for (const file of files) {
        const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8')) as { importer: string; imported: boolean; uuid: string };
        assert.equal(meta.importer, 'typescript');
        assert.equal(meta.imported, true);
        assert.match(meta.uuid, /^[0-9a-f-]{36}$/i);
        uuids.add(meta.uuid);
        if (!file.includes('Composition')) assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]cc['"]|resources\.load|fetch\(/);
    }
    assert.equal(uuids.size, files.length);
});
