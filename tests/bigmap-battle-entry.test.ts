import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ZCBattlePhaseController, ZCBattlePhase } from '../assets/script/app/zcds/application/ZCBattlePhaseController';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { BigMapCampRepository } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function tables(): Record<string, unknown> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))]));
}

test('据点战斗配置来自 bigMapCamp，严格保留 campId 与 campBattleId 两种身份', () => {
    const config = loadBigMapConfig();
    const rows = decompressBigMapRows(JSON.parse(readFileSync('assets/remoteRef/bigMapCamp.json', 'utf8')));
    assert.equal(config.camps.size, rows.length);
    assert.equal(config.camps.get(101)?.battleId, 50001);
    for (const row of rows) {
        assert.equal(config.camps.get(Number(row.campId))?.battleId, row.campBattleId);
    }
    for (const value of [0, -1, 1.5, '50001', undefined]) {
        assert.throws(() => parseBigMapConfig({ ...tables(), bigMapCamp: [{ ...rows[0], campBattleId: value }] }), /campBattleId/);
    }
    assert.throws(() => parseBigMapConfig({ ...tables(), bigMapCamp: [rows[0], rows[0]] }), /重复/);
});

function fixture(start?: (type: number, id: number, isCurrent: () => boolean) => Promise<{ ok: boolean; message: string }>,
    campResponse: unknown = { infos: [{ campId: 101, opType: 0, state: 1 }] }) {
    const repository = new BigMapCampRepository({
        fetchSimple: async () => campResponse,
        fetchDetail: async () => campResponse,
        // 角色列表是另一条协议，这里给「空据点」——这些用例只关心据点状态与开战。
        fetchRoles: async (campId: number) => ({ campId, infos: [] }),
        // 迁城是写操作，这批用例用不到；给「明确失败」避免误判成功。
        requestMove: async () => null,
    });
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({ config: loadBigMapConfig(), storage, saveKey: 'battle-entry',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository, startBattle: start });
    return { presenter, storage, setCampResponse(response: unknown) { campResponse = response; } };
}

test('服务端据点开放后用 1004 + campId 开战，不走本地伤害和存档结算', async () => {
    const calls: number[][] = [];
    const { presenter, storage } = fixture(async (type, id) => { calls.push([type, id]); return { ok: true, message: '' }; });
    assert.equal(presenter.cityView(101)?.canAttack, false, '查询未返回不能先开放');
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.canAttack, true, '服务端开放不能被离线章节和日程挡住');
    const original = storage.read('battle-entry');
    const stamina = presenter.base.stamina;
    assert.equal((await presenter.requestAttackCity(101)).ok, true);
    assert.deepEqual(calls, [[1004, 101]]);
    assert.equal(presenter.base.stamina, stamina);
    assert.equal(storage.read('battle-entry'), original);
    assert.deepEqual(presenter.battle.occupiedCityIds, []);
    presenter.dispose();
});

test('野怪用 1003 + monsterId 开战，不传 monsterBattle 或地图实例 ID', async () => {
    const calls: number[][] = [];
    const { presenter, storage } = fixture(async (type, id) => { calls.push([type, id]); return { ok: true, message: '' }; });
    const original = storage.read('battle-entry');
    for (const site of presenter.world.monsters) {
        assert.equal(presenter.monsterView(site.instanceId)?.canAttack, true);
        assert.equal((await presenter.requestAttackMonster(site.instanceId)).ok, true);
    }
    assert.deepEqual(calls, presenter.world.monsters.map((site) => [1003, site.monsterId]));
    assert.ok(calls.some(([, id]) => id === 8013), '原先传30013的野怪应发送怪物配置ID 8013');
    assert.equal(storage.read('battle-entry'), original);
    presenter.dispose();
});

test('雾隐堡详情获取失败后仍可请求 1004，使用 campId 并由开战回包确认资格', async () => {
    for (const response of [null, { infos: [] }]) {
        const calls: number[][] = [];
        const { presenter, storage } = fixture(async (type, id) => {
            calls.push([type, id]);
            return { ok: false, message: '服务器拒绝开战' };
        }, response);
        const original = storage.read('battle-entry');
        await presenter.refreshCampDetail(201);
        const view = presenter.cityView(201);
        assert.equal(view?.name, '雾隐堡');
        assert.equal(view?.campDetailStatus, 'failed');
        assert.equal(view?.campInfo, null, '不能把查询失败伪造成已开放');
        assert.equal(view?.canAttack, true, '查询失败不能锁死独立的开战入口');
        assert.equal(view?.attackReason, '');
        assert.equal((await presenter.requestAttackCity(201)).message, '服务器拒绝开战');
        assert.deepEqual(calls, [[1004, 201]]);
        assert.equal(storage.read('battle-entry'), original);
        presenter.dispose();
    }
});

test('雾隐堡 205 的 1004 参数使用城池配置 ID 205，不传关联战斗 50027', async () => {
    const calls: number[][] = [];
    const { presenter } = fixture(async (type, id) => {
        calls.push([type, id]);
        return { ok: true, message: '' };
    }, { infos: [{ campId: 205, opType: 0, state: 1 }] });
    assert.equal(loadBigMapConfig().camps.get(205)?.battleId, 50027);
    await presenter.refreshCampDetail(205);
    assert.equal((await presenter.requestAttackCity(205)).ok, true);
    assert.deepEqual(calls, [[1004, 205]]);
    presenter.dispose();
});

test('明确收到未开放、已占领、结算中状态时，详情查询后仍禁止开战', async () => {
    for (const info of [{ opType: 0, state: 0 }, { opType: 1, state: 1 }, { opType: 0, state: 3 }]) {
        let calls = 0;
        const { presenter, setCampResponse } = fixture(async () => { calls += 1; return { ok: true, message: '' }; },
            { infos: [{ campId: 101, ...info }] });
        await presenter.refreshCampDetail(101);
        assert.equal(presenter.cityView(101)?.canAttack, false);
        assert.equal((await presenter.requestAttackCity(101)).ok, false);
        assert.equal(calls, 0);
        setCampResponse(null);
        await presenter.refreshCampDetail(101);
        assert.equal(presenter.cityView(101)?.campDetailStatus, 'failed');
        assert.equal(presenter.cityView(101)?.canAttack, false, '查询失败不能绕过已知的禁止攻击状态');
        assert.equal((await presenter.requestAttackCity(101)).ok, false);
        assert.equal(calls, 0);
        presenter.dispose();
    }
});

test('开战拒绝重复点击；关页后校验失效，迟到结果不能报告开战成功', async () => {
    let complete: (value: { ok: boolean; message: string }) => void = () => {};
    let isCurrent: () => boolean = () => false;
    let calls = 0;
    const { presenter } = fixture(async (_type, _id, guard) => {
        calls += 1;
        isCurrent = guard;
        return new Promise((resolve) => { complete = resolve; });
    });
    await presenter.refreshCampDetail(101);
    const first = presenter.requestAttackCity(101);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 1);
    assert.equal(isCurrent(), true);
    presenter.dispose();
    assert.equal(isCurrent(), false);
    complete({ ok: true, message: '' });
    assert.equal((await first).ok, false);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
});

test('开战失败可重试，未配置入口的预览仍拒绝新版战斗', async () => {
    let calls = 0;
    const { presenter } = fixture(async () => { calls += 1; throw new Error('offline'); });
    await presenter.refreshCampDetail(101);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 2);
    presenter.dispose();
    const preview = fixture();
    const site = preview.presenter.world.monsters[0];
    assert.equal((await preview.presenter.requestAttackMonster(site.instanceId)).ok, false);
    preview.presenter.dispose();
});

function gameFixture(battleType: 1003 | 1004) {
    const events: string[] = [];
    const popups: { userData: { victory: boolean; rewards: unknown[]; rankName?: string; scoreText?: string } }[] = [];
    const routes: { route: string; params: { initialTab: string } }[] = [];
    let complete: (result: object) => void = () => {};
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class { node = {}; isValid = true; } };
        if (name.endsWith('/ZCBattlePhaseController')) return { ZCBattlePhaseController, ZCBattlePhase };
        if (name.endsWith('/BattleResultService')) return { BattleResultService: {
            ensureListening() {},
            waitForBattleResult(type: number) { events.push(`wait:${type}`); return new Promise(resolve => { complete = resolve; }); },
        } };
        if (name.endsWith('/BattleStartService')) return { BATTLE_RESULT_WIN: 1, BATTLE_RESULT_LOSE: 2,
            finishBattle() { events.push('finish'); return Promise.resolve({ code: 1 }); },
        };
        if (name.endsWith('/RewardFrames')) return { resolveCmdGoodsFrames: async () => [] };
        if (name.endsWith('/ZCSettlementPage')) return { ZCSettlementPage: { open: async (options: typeof popups[number]) => { popups.push(options); return null; } } };
        if (name.endsWith('/PopupDef')) return { PopupLayer: { SYSTEM: 1 } };
        if (name.endsWith('/GameRoute')) return { GameRoute: { Main: 'main' } };
        if (name.endsWith('/ProcedureManager')) return { ProcedureManager: { navigate: (route: string, params: { initialTab: string }) => routes.push({ route, params }) } };
        return {};
    } });
    interface IGame {
        phase: ZCBattlePhaseController;
        model: object;
        createGame(): void;
        buildStatistics(): unknown[];
        initialize(entry: object): void;
        openSettlement(retreated?: boolean): void;
        returnToMain(): void;
    }
    const Game = exports.ZCGame as new () => IGame;
    const game = new Game();
    game.createGame = () => {
        game.model = { snapshot: { status: 'victory', elapsedSeconds: 10 }, frameEvents: [] };
        game.phase.startPlaying();
    };
    game.buildStatistics = () => [];
    game.initialize({ resources: {}, pveContext: null, slgBattleType: battleType, seatProfiles: [] });
    return { game, events, popups, routes, complete: (result: object) => complete(result) };
}

test('SLG 对局先建立对应结算等待器再上报结束，采用服务端胜负与战功并返回世界页', async () => {
    for (const battleType of [1003, 1004] as const) {
        const h = gameFixture(battleType);
        h.game.openSettlement();
        h.game.openSettlement();
        assert.deepEqual(h.events, [`wait:${battleType}`, 'finish']);
        assert.equal(h.popups.length, 0);
        h.complete({ code: 2, goods: [], treasureId: 0, ...(battleType === 1004 ? { warScore: 27 } : {}) });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.popups.length, 1);
        assert.equal(h.popups[0].userData.victory, false, '本地模拟胜利不能覆盖服务器失败');
        assert.equal(h.popups[0].userData.rankName, battleType === 1004 ? '战功' : undefined);
        assert.equal(h.popups[0].userData.scoreText, battleType === 1004 ? '27' : undefined);
        h.game.returnToMain();
        assert.equal(h.routes[0].route, 'main');
        assert.equal(h.routes[0].params.initialTab, 'world');
    }
});

test('SLG 等待结算期间已离场，迟到结果不再打开结算弹窗', async () => {
    const h = gameFixture(1004);
    h.game.openSettlement();
    h.game.phase.leave();
    h.complete({ code: 1, goods: [], treasureId: 0, warScore: 100 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.popups.length, 0);
});

test('SLG 预加载按服务端参战人数挑选地图，缺失战斗或非法人数拒绝进入本地假局', async () => {
    const counts: unknown[] = [];
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, require(name: string) {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name.endsWith('/ProcedureBase')) return { ProcedureBase: class { sessionAssets = {}; log() {} } };
        if (name.endsWith('/ZCGame')) return { MAP_DIRECTORY: 'config/maps' };
        if (name.endsWith('/ZCGameLoader')) return { ZCGameLoader: class {
            constructor(_resources: unknown, _dir: string, _random: unknown, playerCount: unknown) { counts.push(playerCount); }
            async prepare() { return {}; }
        } };
        return {};
    } });
    const Procedure = exports.ProcedureGame as new () => { onPreload(params: object, context: object): Promise<void> };
    for (const count of [2, 3, 4]) {
        await new Procedure().onPreload({ slgBattleType: 1004, battle: { units: Array.from({ length: count }, () => ({})) } }, { resources: new ResourceScope('test-battle'), cancelled: false });
    }
    assert.deepEqual(counts, [2, 3, 4]);
    await assert.rejects(new Procedure().onPreload({ slgBattleType: 1004 }, {}), /SLG/);
    assert.equal(counts.length, 3);
});
