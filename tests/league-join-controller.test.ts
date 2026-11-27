import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueJoinController } from '../assets/script/app/league/LeagueJoinController';
import { LeagueJoinEvent, type ILeagueJoinIntent, type LeagueJoinOutput } from '../assets/script/app/league/LeagueJoinEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
import { LeagueTabEvent, type LeagueTabOutput } from '../assets/script/app/league/LeagueTabEvents';
import type { ILeagueRepository } from '../assets/script/app/league/LeagueRepository';
import type { ILeagueUnionRow, ILeagueUnionView } from '../assets/script/app/league/LeagueTable';
import {
    LEAGUE_NO_JOINABLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_TIP_INPUT_UNION_ID,
} from '../assets/script/app/league/LeagueTexts';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function row(id: string, overrides: Partial<ILeagueUnionRow> = {}): ILeagueUnionRow {
    return {
        id,
        name: `盟${id}`,
        level: 3,
        icon: 1,
        count: 2,
        maxCount: 10,
        autoJoin: true,
        leaderId: '1',
        leaderName: '盟主',
        notice: '',
        declaration: '',
        wxChat: '',
        exp: 0,
        ...overrides,
    };
}

interface IPending<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    caller: object;
}

interface IJoinCall extends IPending<'ok' | 'offline' | 'failed'> {
    readonly ids: readonly string[];
}

function fixture() {
    const owner = {};
    const views: ILeagueUnionView[][] = [];
    const tips: string[] = [];
    const joined: boolean[] = [];
    const cancelled: object[] = [];
    const openedCreate: boolean[] = [];
    const openedUnion: ILeagueUnionView[] = [];
    let unions: ILeagueUnionRow[] = [row('11'), row('12'), row('13')];
    let cached: ILeagueUnionRow | null = null;
    let listCalls: IPending<'ok' | 'offline' | 'failed'>[] = [];
    let searchCalls: IPending<'ok' | 'offline' | 'failed'>[] = [];
    let joinCalls: IJoinCall[] = [];

    const repository = {
        load: async () => ({ unions, joined: false }),
        requestList: (caller: object) => new Promise<'ok' | 'offline' | 'failed'>((resolve, reject) => {
            listCalls.push({ resolve, reject, caller });
        }),
        search: (_key: string, caller: object) => new Promise<'ok' | 'offline' | 'failed'>((resolve, reject) => {
            searchCalls.push({ resolve, reject, caller });
        }),
        cachedSearch: (_key: string) => cached,
        join: (ids: readonly string[], caller: object) => new Promise<'ok' | 'offline' | 'failed'>((resolve, reject) => {
            joinCalls.push({ ids, resolve, reject, caller });
        }),
    } satisfies Pick<ILeagueRepository, 'load' | 'requestList' | 'search' | 'cachedSearch' | 'join'>;

    const controller = new LeagueJoinController(createControllerContext({
        callbackOwners: {
            addCallerCleanup: () => () => {},
            removeCallerListener: caller => cancelled.push(caller),
        },
    }), {
        repository,
    });
    const outputOwner = {};
    EventMgr.instance.on(LeagueJoinEvent.Output, (output: LeagueJoinOutput, source: object) => {
        if (source !== controller) return;
        switch (output.kind) {
            case 'render': views.push([...output.rows]); return;
            case 'tip': tips.push(output.text); return;
            case 'joined': joined.push(true); return;
            case 'openCreate': openedCreate.push(true); return;
            case 'openUnion': openedUnion.push(output.union); return;
        }
    }, outputOwner);
    const originalDispose = controller.dispose.bind(controller);
    controller.dispose = () => {
        EventMgr.instance.offTarget(outputOwner);
        originalDispose();
    };
    controller.start();

    const emit = (intent: ILeagueJoinIntent) => EventMgr.instance.emit(LeagueJoinEvent.Intent, intent);
    return {
        owner, controller, views, tips, joined, cancelled,
        openedCreate, openedUnion, listCalls, searchCalls, joinCalls,
        get cached() { return cached; },
        setUnions(next: ILeagueUnionRow[]) { unions = next; },
        setCached(next: ILeagueUnionRow | null) { cached = next; },
        emit,
    };
}

test('首屏由 Controller 拉列表并渲染，caller 是控制器本体', async () => {
    const h = fixture();
    try {
        assert.equal(h.listCalls.length, 1, 'start() 必须主动取数，页面 start 不再自己拉');
        assert.equal(h.listCalls[0].caller, h.controller, '请求归属是控制器，不是视图');
        h.listCalls[0].resolve('ok');
        await flush();
        assert.equal(h.views.length, 1);
        assert.deepEqual(h.views[0].map(view => view.id), ['11', '12', '13']);
    } finally {
        h.controller.dispose();
    }
});

test('搜索空值提示；乱序搜索只落最新一趟', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('ok');
        await flush();
        h.emit({ kind: 'search' });
        assert.deepEqual(h.tips, [LEAGUE_TIP_INPUT_UNION_ID], '空输入不发包');

        h.emit({ kind: 'input', text: '12' });
        h.emit({ kind: 'search' });
        h.emit({ kind: 'input', text: '11' });
        h.emit({ kind: 'search' });
        assert.equal(h.searchCalls.length, 2);

        h.setCached(row('11'));
        h.searchCalls[1].resolve('ok');
        await flush();
        assert.deepEqual(h.views.at(-1)?.map(view => view.id), ['11']);

        h.setCached(row('12'));
        h.searchCalls[0].resolve('ok');
        await flush();
        assert.deepEqual(h.views.at(-1)?.map(view => view.id), ['11'], '旧搜索不许覆盖新结果');
    } finally {
        h.controller.dispose();
    }
});

test('快速加入防连点；成功后重新拉列表并发 Joined', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('ok');
        await flush();
        h.emit({ kind: 'quickJoin' });
        h.emit({ kind: 'quickJoin' });
        await flush();
        assert.equal(h.joinCalls.length, 1, '写操作在飞时第二次点击被挡掉');
        assert.equal(h.joinCalls[0].caller, h.controller);
        assert.deepEqual(h.joinCalls[0].ids, ['11', '12', '13']);

        h.joinCalls[0].resolve('ok');
        await flush();
        assert.equal(h.listCalls.length, 2, '成功后重新拉一次列表');
        h.listCalls[1].resolve('ok');
        await flush();
        assert.deepEqual(h.joined, [true]);
    } finally {
        h.controller.dispose();
    }
});

test('无快速加入目标只提示，不发包', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('ok');
        await flush();
        h.setUnions([row('21', { autoJoin: false })]);
        h.emit({ kind: 'quickJoin' });
        await flush();
        assert.equal(h.joinCalls.length, 0);
        assert.deepEqual(h.tips, [LEAGUE_NO_JOINABLE]);
    } finally {
        h.controller.dispose();
    }
});

test('dispose 后迟到列表 / 搜索 / 加入结果不上屏，removeCaller 只调一次', async () => {
    const h = fixture();
    h.listCalls[0].resolve('ok');
    await flush();
    const rendered = h.views.length;
    h.controller.dispose();
    h.controller.dispose();
    h.listCalls[0].resolve('ok');
    await flush();
    assert.equal(h.views.length, rendered);
    assert.deepEqual(h.cancelled, [h.controller]);
    assert.deepEqual(h.tips, []);
    assert.deepEqual(h.joined, []);
});

test('create / openUnion 走组合注入的路由', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('ok');
        await flush();
        h.emit({ kind: 'create' });
        assert.deepEqual(h.openedCreate, [true]);
        const union = h.views[0][0];
        h.emit({ kind: 'openUnion', union });
        assert.deepEqual(h.openedUnion, [union]);
    } finally {
        h.controller.dispose();
    }
});

test('离线结果保留缓存列表并提示；不把页面打空', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('offline');
        await flush();
        assert.deepEqual(h.views[0].map(view => view.id), ['11', '12', '13']);
        assert.deepEqual(h.tips, [LEAGUE_TIP_OFFLINE]);
    } finally {
        h.controller.dispose();
    }
});

test('失败结果同样保留缓存列表并提示失败', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('failed');
        await flush();
        assert.deepEqual(h.views[0].map(view => view.id), ['11', '12', '13']);
        assert.deepEqual(h.tips, [LEAGUE_TIP_FAILED]);
    } finally {
        h.controller.dispose();
    }
});

test('容器控制器按入盟变化输出页面切换事件并过滤重复刷新与销毁后结果', async () => {
    let joined = false;
    const pages: boolean[] = [];
    const outputOwner = {};
    const controller = new LeagueTabController(createControllerContext(), {
        repository: { load: async () => ({ joined }) },
    });
    EventMgr.instance.on(LeagueTabEvent.Output, (output: LeagueTabOutput, source: object) => {
        if (source !== controller) return;
        if (output.kind === 'failed') throw output.error;
        pages.push(output.joined);
    }, outputOwner);
    try {
        controller.start();
        await flush();
        assert.deepEqual(pages, [false], '首屏发射入盟状态');

        await controller.refresh(false);
        assert.deepEqual(pages, [false], '未入盟状态未变化时跳过重复重铺');

        await controller.refresh(true);
        assert.deepEqual(pages, [false, false], '强制刷新重新输出当前页');

        joined = true;
        await controller.refresh(false);
        assert.deepEqual(pages, [false, false, true], '入盟变化时切换到已入盟页');

        controller.dispose();
        await controller.refresh(true);
        assert.deepEqual(pages, [false, false, true], '销毁后不再输出切换事件');
    } finally {
        EventMgr.instance.offTarget(outputOwner);
        controller.dispose();
    }
});

