import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueDonateController } from '../assets/script/app/league/LeagueDonateController';
import { LeagueDonateModel } from '../assets/script/app/league/LeagueDonateModel';
import { LeagueDonateEvent, type ILeagueDonateIntent, type ILeagueDonateViewState } from '../assets/script/app/league/LeagueDonateEvents';
import type { ILeagueDonateSnapshot, LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import type { IActivityGoodsInfo } from '../assets/script/app/activity/LayerActivityTable';
import {
    fillLeagueText,
    LEAGUE_DONATE_CONFIRM,
    LEAGUE_TIP_AD_DONATE_LIMIT,
    LEAGUE_TIP_DONATE_LIMIT,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_OFFLINE,
} from '../assets/script/app/league/LeagueTexts';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function goods(name: string): IActivityGoodsInfo {
    return { name, quality: 1, icon: '', iconIsPath: false };
}

function snapshot(overrides: Partial<ILeagueDonateSnapshot> = {}): ILeagueDonateSnapshot {
    const config = {
        donateCost: 10, donateGainCoin: 300, donateGainExp: 10,
        donateMaxCount: 3, donateAdvCount: 2, bargainBuyCount: 1,
    };
    return {
        config,
        todayDonateTimes: 0, todayDonateAdvTimes: 0, remain: 3,
        remainText: '剩余捐献次数：3/3', coinNameText: '联盟金币*300', expNameText: '联盟贡献*10',
        coinResId: 11, expResId: 13, enough: true, hasTimes: true,
        items: new Map<number, IActivityGoodsInfo>(),
        resources: new Map<number, IActivityGoodsInfo>([[10, goods('金币')]]),
        ...overrides,
    } as ILeagueDonateSnapshot;
}

interface ILoadCall {
    resolve: (value: ILeagueDonateSnapshot) => void;
    reject: (error: Error) => void;
}
interface IDonateCall {
    adv: boolean;
    caller: object;
    resolve: (value: LeagueRequestResult) => void;
    reject: (error: Error) => void;
}

function fixture() {
    const owner = {};
    const states: ILeagueDonateViewState[] = [];
    const tips: string[] = [], cancelled: object[] = [];
    const confirms: Array<{ content: string; onSure: () => void }> = [];
    const loadCalls: ILoadCall[] = [], donateCalls: IDonateCall[] = [];
    const adPlays: Array<{ resolve: (watched: boolean) => void; reject: (error: Error) => void }> = [];
    const model = new LeagueDonateModel();
    const controller = new LeagueDonateController(createControllerContext(), {
        owner, model,
        repository: {
            loadDonate: () => new Promise<ILeagueDonateSnapshot>((resolve, reject) => loadCalls.push({ resolve, reject })),
            requestDonate: (adv, caller) => new Promise<LeagueRequestResult>((resolve, reject) => {
                donateCalls.push({ adv, caller: caller as object, resolve, reject });
            }),
        },
        view: { render: state => states.push({ ...state }) },
        feedback: {
            tip: text => tips.push(text),
            confirm: (content, onSure) => confirms.push({ content, onSure }),
        },
        ads: { play: () => new Promise<boolean>((resolve, reject) => adPlays.push({ resolve, reject })) },
        requests: { removeCaller: caller => cancelled.push(caller) },
    });
    controller.start();
    const emit = (kind: 'free' | 'coin', target: object = owner) =>
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: target, kind } as ILeagueDonateIntent);
    return {
        owner, model, controller, states, tips, cancelled, confirms,
        loadCalls, donateCalls, adPlays, emit,
        get busy() { return states[states.length - 1]?.busy ?? false; },
    };
}

test('捐献 Model 只放纯规则：次数 / 钱 / 广告上限 / 免费剩余 / 货币名', () => {
    const model = new LeagueDonateModel();
    assert.equal(model.hasTimes, false);
    assert.equal(model.enough, false);
    assert.equal(model.freeAvailable, false);
    assert.equal(model.freeRest, 0);
    assert.equal(model.coinName, '');

    model.snapshot = snapshot();
    assert.equal(model.hasTimes, true);
    assert.equal(model.enough, true);
    assert.equal(model.freeAvailable, true);
    assert.equal(model.freeRest, 2);
    assert.equal(model.coinName, '金币');

    model.snapshot = snapshot({ hasTimes: false, enough: false, todayDonateAdvTimes: 5, todayDonateTimes: 9 });
    assert.equal(model.hasTimes, false);
    assert.equal(model.enough, false);
    assert.equal(model.freeAvailable, false);
    assert.equal(model.freeRest, 0, '负数钳成 0，不上屏负号');
});

test('首屏由 Controller 主动推（组合会话晚于 onOpen），快照回来再推一次；迟到读取作废', async () => {
    const h = fixture();
    try {
        assert.equal(h.states.length, 1);
        assert.equal(h.states[0].snapshot, null);
        assert.equal(h.states[0].busy, false);
        assert.equal(h.loadCalls.length, 1);
        const first = snapshot();
        h.loadCalls[0].resolve(first); await flush();
        assert.equal(h.states.length, 2);
        assert.equal(h.states[1].snapshot, first);
        assert.equal(h.model.snapshot, first);
        assert.equal(h.loadCalls.length, 1, '只读一次快照，不发列表请求');
        assert.deepEqual(h.donateCalls, []);
    } finally { h.controller.dispose(); }
});

test('意图按 owner 隔离：陌生页面的 free / coin 不播广告、不弹确认、不发包', async () => {
    const h = fixture();
    try {
        h.loadCalls[0].resolve(snapshot()); await flush();
        const stranger = {};
        h.emit('free', stranger);
        h.emit('coin', stranger);
        assert.equal(h.adPlays.length, 0);
        assert.equal(h.confirms.length, 0);
        assert.equal(h.donateCalls.length, 0);
        // 本 owner 的意图生效；coin 只弹确认不上锁，free 才开始播广告。
        h.emit('coin');
        assert.equal(h.confirms.length, 1);
        h.emit('free');
        assert.equal(h.adPlays.length, 1);
    } finally { h.controller.dispose(); }
});

test('免费路：次数闸 → 先播后发；没看完广告零发包；看完才发 adv=true', async () => {
    {
        const h = fixture();
        try {
            h.loadCalls[0].resolve(snapshot({ todayDonateAdvTimes: 2 })); await flush();
            h.emit('free');
            assert.deepEqual(h.tips, [LEAGUE_TIP_AD_DONATE_LIMIT]);
            assert.equal(h.adPlays.length, 0, '次数用完不播广告');
            assert.equal(h.donateCalls.length, 0);
        } finally { h.controller.dispose(); }
    }
    {
        const h = fixture();
        try {
            h.loadCalls[0].resolve(snapshot()); await flush();
            h.emit('free');
            assert.equal(h.adPlays.length, 1);
            assert.equal(h.donateCalls.length, 0, '⚠️ 广告没播完绝不裸发 adv=true');
            assert.equal(h.busy, true);
            h.emit('free'); h.emit('coin');
            assert.equal(h.adPlays.length, 1, '写锁防连点');
            h.adPlays[0].resolve(true); await flush();
            assert.equal(h.donateCalls.length, 1);
            assert.equal(h.donateCalls[0].adv, true);
            assert.equal(h.donateCalls[0].caller, h.controller);
        } finally { h.controller.dispose(); }
    }
    {
        const h = fixture();
        try {
            h.loadCalls[0].resolve(snapshot()); await flush();
            h.emit('free');
            h.adPlays[0].resolve(false); await flush();
            assert.deepEqual(h.tips, [LEAGUE_TIP_FAILED]);
            assert.equal(h.donateCalls.length, 0, '没看完广告一个包都不发');
            assert.equal(h.busy, false, '失败后解锁');
        } finally { h.controller.dispose(); }
    }
});

test('金币路三道关顺序：次数 → 钱 → 确认；确认后才发 adv=false，模板填现价', async () => {
    for (const [view, want] of [
        [snapshot({ hasTimes: false }), LEAGUE_TIP_DONATE_LIMIT],
        [snapshot({ enough: false }), fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, '金币')],
    ] as const) {
        const h = fixture();
        try {
            h.loadCalls[0].resolve(view); await flush();
            h.emit('coin');
            assert.deepEqual(h.tips, [want]);
            assert.equal(h.confirms.length, 0);
            assert.equal(h.donateCalls.length, 0);
        } finally { h.controller.dispose(); }
    }
    const h = fixture();
    try {
        h.loadCalls[0].resolve(snapshot()); await flush();
        h.emit('coin');
        assert.equal(h.confirms.length, 1);
        assert.equal(h.confirms[0].content, fillLeagueText(LEAGUE_DONATE_CONFIRM, 10));
        assert.equal(h.donateCalls.length, 0, '确认框没点确定前不发包');
        h.confirms[0].onSure(); await flush();
        assert.equal(h.donateCalls.length, 1);
        assert.equal(h.donateCalls[0].adv, false);
        assert.equal(h.donateCalls[0].caller, h.controller);
    } finally { h.controller.dispose(); }
});

test('费用变化：写成功后重读快照，新次数 / 新钱数上屏', async () => {
    const h = fixture();
    try {
        h.loadCalls[0].resolve(snapshot()); await flush();
        h.emit('coin');
        h.confirms[0].onSure(); await flush();
        assert.equal(h.loadCalls.length, 1);
        h.donateCalls[0].resolve('ok'); await flush();
        assert.equal(h.loadCalls.length, 2, '成功后再读一次（老端靠推送刷新）');
        const next = snapshot({ todayDonateTimes: 1, remain: 2, remainText: '剩余捐献次数：2/3', enough: false });
        h.loadCalls[1].resolve(next); await flush();
        assert.equal(h.states[h.states.length - 1].snapshot, next);
        assert.equal(h.busy, false);
        assert.deepEqual(h.tips, []);
        // 新快照里钱不够 ⇒ 再点金币走第二道关
        h.emit('coin');
        assert.deepEqual(h.tips, [fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, '金币')]);
        assert.equal(h.donateCalls.length, 1);
    } finally { h.controller.dispose(); }
});

test('offline / failed / 抛错保留状态并可重试；确认回调在关闭后失效', async () => {
    const h = fixture();
    try {
        h.loadCalls[0].resolve(snapshot()); await flush();
        for (const result of ['offline', 'failed'] as const) {
            h.emit('coin');
            h.confirms[h.confirms.length - 1].onSure(); await flush();
            h.donateCalls[h.donateCalls.length - 1].resolve(result); await flush();
        }
        h.emit('coin');
        h.confirms[h.confirms.length - 1].onSure(); await flush();
        h.donateCalls[h.donateCalls.length - 1].reject(new Error('network failed')); await flush();
        assert.deepEqual(h.tips, [LEAGUE_TIP_OFFLINE, LEAGUE_TIP_FAILED, LEAGUE_TIP_FAILED]);
        assert.equal(h.busy, false);
        h.emit('coin');
        h.confirms[h.confirms.length - 1].onSure(); await flush();
        assert.equal(h.donateCalls.length, 4, '解锁后可重试');
        h.controller.dispose();
        const pending = h.confirms.length;
        for (const confirm of h.confirms.slice(0, pending)) confirm.onSure();
        h.emit('free'); h.emit('coin');
        assert.equal(h.donateCalls.length, 4, '关闭后确认回调与意图都不再发包');
        assert.equal(h.adPlays.length, 0);
        assert.deepEqual(h.cancelled, [h.controller]);
    } finally { h.controller.dispose(); }
});

test('dispose 取消真实 caller 一次，拦住迟到的成功 / 失败 / 广告完成', async () => {
    for (const outcome of ['ok', 'reject'] as const) {
        const h = fixture();
        h.loadCalls[0].resolve(snapshot()); await flush();
        h.emit('free');
        h.adPlays[0].resolve(true); await flush();
        h.controller.dispose(); h.controller.dispose();
        const rendered = h.states.length;
        if (outcome === 'ok') h.donateCalls[0].resolve('ok');
        else h.donateCalls[0].reject(new Error('late failure'));
        await flush();
        h.emit('free'); h.emit('coin');
        assert.deepEqual(h.cancelled, [h.controller]);
        assert.equal(h.states.length, rendered, '关闭后不再 render');
        assert.equal(h.donateCalls.length, 1);
        assert.equal(h.loadCalls.length, 1, '迟到成功不许触发 reload');
        assert.deepEqual(h.tips, []);
    }
    {
        const h = fixture();
        h.loadCalls[0].resolve(snapshot()); await flush();
        h.emit('free');
        h.controller.dispose();
        h.adPlays[0].resolve(true); await flush();
        assert.equal(h.donateCalls.length, 0, '广告迟到完成也不能再发包');
    }
});
