import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueCreateController } from '../assets/script/app/league/LeagueCreateController';
import { LeagueCreateModel } from '../assets/script/app/league/LeagueCreateModel';
import { LeagueCreateEvent, type ILeagueCreateIntent, type ILeagueCreateViewState } from '../assets/script/app/league/LeagueCreateEvents';
import type { LeagueRequestResult } from '../assets/script/app/league/LeagueRepository';
import type { ILeagueCostView } from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_COST_NOT_ENOUGH_FALLBACK,
    LEAGUE_COST_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_TIP_UNION_NAME_EMPTY,
    fillLeagueText,
} from '../assets/script/app/league/LeagueTexts';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function cost(enough: boolean, overrides: Partial<ILeagueCostView> = {}): ILeagueCostView {
    return {
        resId: 10, need: 100, enough, hasText: '120/', needText: '100',
        iconRoot: 'icons/resource', iconName: '图标_幻灵玉',
        unenoughTips: '', name: '金币', ...overrides,
    };
}

interface ICostCall {
    resolve: (value: ILeagueCostView) => void;
    reject: (error: Error) => void;
}
interface ICreateCall {
    icon: number;
    name: string;
    quick: boolean;
    caller: object;
    resolve: (value: LeagueRequestResult) => void;
    reject: (error: Error) => void;
}

function fixture() {
    const owner = {}, joinedOwner = {};
    const states: ILeagueCreateViewState[] = [];
    const tips: string[] = [], cancelled: object[] = [], joined: Array<object | null> = [];
    const costCalls: ICostCall[] = [], createCalls: ICreateCall[] = [];
    let closed = 0;
    const model = new LeagueCreateModel();
    const controller = new LeagueCreateController(createControllerContext(), {
        owner, joinedOwner, model,
        repository: {
            createCost: () => new Promise<ILeagueCostView>((resolve, reject) => { costCalls.push({ resolve, reject }); }),
            requestCreat: (icon, name, quick, caller) => new Promise<LeagueRequestResult>((resolve, reject) => {
                createCalls.push({ icon, name, quick, caller: caller as object, resolve, reject });
            }),
        },
        view: { render: state => states.push({ ...state }), close: () => { closed += 1; } },
        feedback: {
            tip: text => tips.push(text),
            notifyJoined: target => joined.push(target),
        },
        requests: { removeCaller: caller => cancelled.push(caller) },
    });
    controller.start();
    const emit = (intent: ILeagueCreateIntent) => EventMgr.instance.emit(LeagueCreateEvent.Intent, intent);
    const submit = (name = '联盟名', quickJoin = true, target: object = owner) =>
        emit({ owner: target, kind: 'submit', name, quickJoin });
    return {
        owner, joinedOwner, model, controller, states, tips, cancelled, joined,
        costCalls, createCalls, emit, submit,
        get closed() { return closed; },
    };
}

test('创建 Model 只放业务状态与纯规则：空名 / `***` 拒、不 trim、默认已勾、旗帜夹取', () => {
    const model = new LeagueCreateModel();
    assert.equal(model.quickJoin, true, 'FGUI `checked=true` ⇒ 默认已勾');
    assert.equal(model.canSubmit, false);
    model.name = '***'; assert.equal(model.canSubmit, false);
    model.name = ''; assert.equal(model.canSubmit, false);
    model.name = ' 纯空格 '; assert.equal(model.canSubmit, true, '老端允许纯空格，不 trim');
    assert.equal(model.name, ' 纯空格 ');
    model.selectIndex = 999; assert.equal(model.banner, 7);
    model.selectIndex = -3; assert.equal(model.banner, 0);
    model.selectIndex = 3; assert.equal(model.banner, 3);
});

test('首屏由 Controller 主动推（组合会话晚于 onOpen），费用回来再推一次', async () => {
    const h = fixture();
    try {
        assert.equal(h.states.length, 1, 'start() 必须立刻 publish，否则视图拿不到首屏');
        assert.equal(h.states[0].cost, null);
        assert.equal(h.states[0].quickJoin, true);
        assert.equal(h.states[0].submitting, false);
        assert.equal(h.costCalls.length, 1);
        h.costCalls[0].resolve(cost(true)); await flush();
        assert.equal(h.states.length, 2);
        assert.equal(h.states[1].cost?.hasText, '120/');
    } finally { h.controller.dispose(); }
});

test('意图按 owner 隔离；名字 / 旗帜 / 勾选同步并只派发原文，视图不持有回调', async () => {
    const h = fixture();
    try {
        h.costCalls[0].resolve(cost(true)); await flush();
        const stranger = {};
        h.emit({ owner: stranger, kind: 'banner', index: 5 });
        h.emit({ owner: stranger, kind: 'quickJoin', quickJoin: false });
        h.submit('陌生名', false, stranger);
        assert.equal(h.model.selectIndex, 0);
        assert.equal(h.model.quickJoin, true);
        assert.equal(h.createCalls.length, 0);

        h.emit({ owner: h.owner, kind: 'name', name: '名字' });
        assert.equal(h.model.name, '名字');
        h.emit({ owner: h.owner, kind: 'banner', index: 4 });
        h.emit({ owner: h.owner, kind: 'quickJoin', quickJoin: false });
        assert.equal(h.model.banner, 4);
        assert.equal(h.model.quickJoin, false);
        assert.equal(h.states[h.states.length - 1].selectIndex, 4);
        assert.equal(h.states[h.states.length - 1].quickJoin, false);
    } finally { h.controller.dispose(); }
});

test('防连点 + 空名守卫：重复提交只发一次空名提示，caller 是控制器本体', async () => {
    const h = fixture();
    try {
        h.costCalls[0].resolve(cost(true)); await flush();
        h.submit(''); h.submit('');
        // 空名守卫在提交锁之前：每次点击都给一条提示（点「创建」毫无反应会让玩家以为卡了），
        // 但绝不进入 createCost / 发包链路。
        assert.deepEqual(h.tips, [LEAGUE_TIP_UNION_NAME_EMPTY, LEAGUE_TIP_UNION_NAME_EMPTY]);
        assert.equal(h.costCalls.length, 1, '空名不该再读消耗或发包');
        assert.equal(h.createCalls.length, 0);

        h.submit('联盟名'); h.submit('联盟名');
        assert.equal(h.costCalls.length, 2, '只准有一次提交复读');
        assert.equal(h.createCalls.length, 0, 'createCost 未回来前不许发包');
        h.costCalls[1].resolve(cost(true)); await flush();
        assert.equal(h.createCalls.length, 1, '防连点：第二次点击被挡掉');
        assert.equal(h.createCalls[0].caller, h.controller);
        assert.equal(h.createCalls[0].name, '联盟名');
        assert.equal(h.createCalls[0].icon, 0);
        assert.equal(h.createCalls[0].quick, true);
        assert.equal(h.states[h.states.length - 1].submitting, true);
    } finally { h.controller.dispose(); }
});

test('费用变化：提交时现读，`enough=false` 不发包；三级兜底提示逐条对老端', async () => {
    for (const [view, want] of [
        [cost(false, { unenoughTips: '金币不足' }), '金币不足'],
        [cost(false), fillLeagueText(LEAGUE_COST_NOT_ENOUGH_TEMPLATE, '金币')],
        [cost(false, { name: '' }), LEAGUE_COST_NOT_ENOUGH_FALLBACK],
    ] as const) {
        const h = fixture();
        try {
            h.costCalls[0].resolve(cost(true)); await flush();
            h.submit('联盟名');
            h.costCalls[1].resolve(view); await flush();
            assert.equal(h.createCalls.length, 0, '钱不够绝不发包');
            assert.deepEqual(h.tips, [want]);
            assert.equal(h.model.cost, view, '最新消耗要上屏');
            assert.equal(h.states[h.states.length - 1].submitting, false, '失败后解锁可重试');
        } finally { h.controller.dispose(); }
    }
});

test('成功：关窗 + 按 owner 发 Joined；输入/旗帜/勾选原样进协议', async () => {
    const h = fixture();
    try {
        h.costCalls[0].resolve(cost(true)); await flush();
        h.emit({ owner: h.owner, kind: 'banner', index: 6 });
        h.submit('新盟', false);
        h.costCalls[1].resolve(cost(true)); await flush();
        h.createCalls[0].resolve('ok'); await flush();
        assert.equal(h.closed, 1);
        assert.deepEqual(h.joined, [h.joinedOwner]);
        assert.equal(h.createCalls[0].icon, 6);
        assert.equal(h.createCalls[0].quick, false);
        assert.deepEqual(h.tips, []);
    } finally { h.controller.dispose(); }
});

test('迟到回包：提交后改名字，成功 / 失败 / 抛错都不许上屏或通知容器', async () => {
    for (const outcome of ['ok', 'offline', 'reject'] as const) {
        const h = fixture();
        try {
            h.costCalls[0].resolve(cost(true)); await flush();
            h.submit('旧名');
            h.costCalls[1].resolve(cost(true)); await flush();
            h.emit({ owner: h.owner, kind: 'name', name: '新名' });
            if (outcome === 'reject') h.createCalls[0].reject(new Error('late'));
            else h.createCalls[0].resolve(outcome);
            await flush();
            assert.equal(h.closed, 0);
            assert.deepEqual(h.joined, []);
            assert.deepEqual(h.tips, []);
            assert.equal(h.model.name, '新名');
            assert.equal(h.states[h.states.length - 1].submitting, false);
        } finally { h.controller.dispose(); }
    }
});

test('offline / failed / 抛错保留状态并可重试', async () => {
    const h = fixture();
    try {
        h.costCalls[0].resolve(cost(true)); await flush();
        for (const result of ['offline', 'failed'] as const) {
            h.submit('联盟名');
            const at = h.costCalls.length - 1;
            h.costCalls[at].resolve(cost(true)); await flush();
            h.createCalls[h.createCalls.length - 1].resolve(result); await flush();
        }
        h.submit('联盟名');
        h.costCalls[h.costCalls.length - 1].resolve(cost(true)); await flush();
        h.createCalls[h.createCalls.length - 1].reject(new Error('network failed')); await flush();
        assert.deepEqual(h.tips, [LEAGUE_TIP_OFFLINE, LEAGUE_TIP_FAILED, LEAGUE_TIP_FAILED]);
        assert.equal(h.closed, 0);
        assert.equal(h.model.name, '联盟名', '失败不丢草稿');
        h.submit('联盟名');
        h.costCalls[h.costCalls.length - 1].resolve(cost(true)); await flush();
        assert.equal(h.createCalls.length, 4, '解锁后可重试');
        h.createCalls[3].resolve('ok'); await flush();
        assert.equal(h.closed, 1);
    } finally { h.controller.dispose(); }
});

test('dispose 取消真实 caller 一次，并拦住迟到的成功 / 失败 / 意图', async () => {
    for (const outcome of ['ok', 'reject'] as const) {
        const h = fixture();
        h.costCalls[0].resolve(cost(true)); await flush();
        h.submit('联盟名');
        h.costCalls[1].resolve(cost(true)); await flush();
        h.controller.dispose(); h.controller.dispose();
        const rendered = h.states.length;
        if (outcome === 'ok') h.createCalls[0].resolve('ok');
        else h.createCalls[0].reject(new Error('late failure'));
        await flush();
        h.submit('联盟名');
        h.emit({ owner: h.owner, kind: 'banner', index: 2 });
        h.emit({ owner: h.owner, kind: 'quickJoin', quickJoin: false });
        assert.deepEqual(h.cancelled, [h.controller]);
        assert.equal(h.states.length, rendered, '关闭后不再 render');
        assert.equal(h.createCalls.length, 1);
        assert.equal(h.closed, 0);
        assert.deepEqual(h.joined, []);
        assert.deepEqual(h.tips, []);
    }
});
