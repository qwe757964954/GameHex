import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueJoinController } from '../assets/script/app/league/LeagueJoinController';
import { LeagueJoinEvent, type ILeagueJoinIntent, type ILeagueJoinView } from '../assets/script/app/league/LeagueJoinEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
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

    const controller = new LeagueJoinController(createControllerContext(), {
        owner,
        repository,
        view: { render: rows => views.push([...rows]) },
        feedback: {
            tip: text => tips.push(text),
            notifyJoined: () => joined.push(true),
        },
        popups: {
            openCreate: () => openedCreate.push(true),
            openUnion: view => openedUnion.push(view),
        },
        requests: { removeCaller: caller => cancelled.push(caller) },
    });
    controller.start();

    const emit = (intent: ILeagueJoinIntent, source: object) => EventMgr.instance.emit(LeagueJoinEvent.Intent, intent, source);
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
        h.emit({ kind: 'search' }, h.owner);
        assert.deepEqual(h.tips, [LEAGUE_TIP_INPUT_UNION_ID], '空输入不发包');

        h.emit({ kind: 'input', text: '12' }, h.owner);
        h.emit({ kind: 'search' }, h.owner);
        h.emit({ kind: 'input', text: '11' }, h.owner);
        h.emit({ kind: 'search' }, h.owner);
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
        h.emit({ kind: 'quickJoin' }, h.owner);
        h.emit({ kind: 'quickJoin' }, h.owner);
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
        h.emit({ kind: 'quickJoin' }, h.owner);
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

test('意图按 owner 隔离；create / openUnion 走组合注入的路由', async () => {
    const h = fixture();
    try {
        h.listCalls[0].resolve('ok');
        await flush();
        const stranger = {};
        h.emit({ kind: 'quickJoin' }, stranger);
        h.emit({ kind: 'create' }, stranger);
        assert.equal(h.joinCalls.length, 0);
        assert.deepEqual(h.openedCreate, []);

        h.emit({ kind: 'create' }, h.owner);
        assert.deepEqual(h.openedCreate, [true]);
        const union = h.views[0][0];
        h.emit({ kind: 'openUnion', union }, h.owner);
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

test('容器控制器重铺 / 关闭时先释放旧的加入页控制器', async () => {
    const view: ILeagueJoinView = { render() {} };
    const disposed: object[] = [];
    let creates = 0;
    let page: ILeagueJoinView | null = view;
    const controller = new LeagueTabController(createControllerContext(), {
        owner: {},
        failed: error => { throw error; },
        repository: { load: async () => ({ joined: false }) },
        view: { showPage: () => page },
        join: {
            create: () => {
                creates += 1;
                return {
                    start() {},
                    dispose() { disposed.push(view); },
                } as unknown as LeagueJoinController;
            },
        },
    });
    controller.start();
    await flush();
    assert.equal(creates, 1, '铺出加入页后创建一个 Join 控制器');

    await controller.refresh(true);
    assert.equal(disposed.length, 1, '重铺前先释放旧控制器');
    assert.equal(creates, 2, '重铺后按新页创建新控制器');

    page = null;
    await controller.refresh(true);
    assert.equal(disposed.length, 2, '切到已入盟页时释放加入页控制器');
    assert.equal(creates, 2, '没有加入页就不创建控制器');

    controller.dispose();
    assert.equal(disposed.length, 2, '已释放过的控制器不重复释放');
});

