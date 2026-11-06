import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueEditController } from '../assets/script/app/league/LeagueEditController';
import { LeagueEditModel } from '../assets/script/app/league/LeagueEditModel';
import { LeagueEditEvent, type ILeagueEditViewState } from '../assets/script/app/league/LeagueEditEvents';
import { LEAGUE_TIP_FAILED, LEAGUE_TIP_OFFLINE } from '../assets/script/app/league/LeagueTexts';
import type { LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(type = 1, content = '初值') {
    const owner = {}, states: ILeagueEditViewState[] = [], tips: string[] = [], cancelled: object[] = [];
    const requests: Array<{ type: number; content: string; caller: object; resolve: (value: LeagueRequestResult) => void; reject: (error: Error) => void }> = [];
    let closed = 0;
    const model = new LeagueEditModel({ type, content });
    const controller = new LeagueEditController(createControllerContext(), {
        owner, model,
        repository: { edit: (type, content, caller) => new Promise((resolve, reject) => requests.push({ type, content, caller, resolve, reject })) },
        view: { render: state => states.push(state), close: () => { closed++; } },
        feedback: { tip: text => tips.push(text) },
        requests: { removeCaller: caller => cancelled.push(caller) },
    });
    controller.start();
    const intent = (kind: 'submit' | 'change', value = model.content, target = owner) =>
        EventMgr.instance.emit(LeagueEditEvent.Intent, { owner: target, kind, content: value });
    return { owner, model, controller, states, tips, requests, cancelled, intent, get closed() { return closed; } };
}

test('edit model preserves raw content and rejects empty, placeholder and invalid type', () => {
    for (const type of [0, -1, NaN, Infinity]) {
        assert.equal(new LeagueEditModel({ type, content: '名称' }).canSubmit, false);
    }
    for (const type of [1, 2, 3, 4]) {
        const model = new LeagueEditModel({ type, content: '' });
        assert.equal(model.canSubmit, false);
        model.setContent('***'); assert.equal(model.canSubmit, false);
        model.setContent(' 微信号: raw ');
        assert.equal(model.canSubmit, true);
        assert.equal(model.content, ' 微信号: raw ');
    }
    assert.equal(new LeagueEditModel().canSubmit, false);
});

test('edit controller isolates owners, rejects invalid submissions and gates duplicate requests', async () => {
    const h = fixture(2);
    try {
        h.controller.start();
        h.intent('submit', '陌生页面', {});
        h.intent('submit', ''); h.intent('submit', '***');
        assert.equal(h.requests.length, 0);
        h.intent('submit', 'wx-raw'); h.intent('submit', 'wx-raw');
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].type, 2);
        assert.equal(h.requests[0].content, 'wx-raw');
        assert.equal(h.requests[0].caller, h.controller);
        assert.equal(h.states[h.states.length - 1].submitting, true);
        h.requests[0].resolve('ok'); await flush();
        assert.equal(h.closed, 1);
    } finally { h.controller.dispose(); }
    const invalid = fixture(NaN);
    try { invalid.intent('submit'); assert.equal(invalid.requests.length, 0); }
    finally { invalid.controller.dispose(); }
});

test('changing input while editing keeps the current draft and drops the previous result', async () => {
    const h = fixture();
    try {
        h.intent('submit');
        h.intent('change', '新内容');
        h.requests[0].resolve('ok'); await flush();
        assert.equal(h.closed, 0);
        assert.equal(h.states[h.states.length - 1].content, '新内容');
        assert.equal(h.states[h.states.length - 1].submitting, false);
        h.intent('submit');
        assert.equal(h.requests[1].content, '新内容');
        h.requests[1].resolve('ok'); await flush();
        assert.equal(h.closed, 1);
    } finally { h.controller.dispose(); }
});

test('offline, failed and thrown requests retain draft and allow retry', async () => {
    const h = fixture();
    try {
        for (const result of ['offline', 'failed'] as const) {
            h.intent('submit'); h.requests[h.requests.length - 1].resolve(result); await flush();
            assert.equal(h.states[h.states.length - 1].submitting, false);
            assert.equal(h.model.content, '初值');
        }
        h.intent('submit'); h.requests[h.requests.length - 1].reject(new Error('network failed')); await flush();
        assert.deepEqual(h.tips, [LEAGUE_TIP_OFFLINE, LEAGUE_TIP_FAILED, LEAGUE_TIP_FAILED]);
        assert.equal(h.closed, 0);
        h.intent('submit'); assert.equal(h.requests.length, 4);
        h.requests[3].resolve('ok'); await flush();
        assert.equal(h.closed, 1);
    } finally { h.controller.dispose(); }
});

test('disposal cancels the actual request owner once and ignores late success, failure and intents', async () => {
    for (const outcome of ['ok', 'reject'] as const) {
        const h = fixture();
        h.intent('submit'); h.controller.dispose(); h.controller.dispose();
        const rendered = h.states.length;
        if (outcome === 'ok') h.requests[0].resolve('ok');
        else h.requests[0].reject(new Error('late failure'));
        await flush();
        h.intent('submit'); h.intent('change', '关闭后');
        assert.deepEqual(h.cancelled, [h.controller]);
        assert.equal(h.states.length, rendered);
        assert.equal(h.requests.length, 1);
        assert.equal(h.closed, 0);
        assert.deepEqual(h.tips, []);
    }
});
