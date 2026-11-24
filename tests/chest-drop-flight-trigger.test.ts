import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { CHEST_EVENTS } from '../assets/script/app/main/ChestEvents';
import { TERRITORY_BATTLE_STATUS } from '../assets/script/app/territory/model/TerritoryBattleStatus';
import type { TerritoryChapterSave } from '../assets/script/app/territory/model/TerritorySaveStore';
import {
    asyncRepeatMap,
    asyncRepeatStage,
    bundle,
    createFakeGateway,
    createFakeLoader,
    createFakeStore,
    createHarness,
    flush,
} from './helpers/territory-presenter-fixture';

/**
 * §3.54 掉落宝箱飞行的**触发源**回归（2026-11-23）。
 *
 * 实机症状：异步 PVP 打完赢了，回城没有宝箱从 PVP 据点飞到底栏。
 * 真因：第一版把 `victoryClaimCells`（本地探索 `settle()` 收地）当「这局打赢了」的边沿，
 * 但异步 PVP 胜利是**服务端权威** —— `loadChapter()` 先 `mergeServerState()` 把
 * `passCells` 落成 `owned`，再 `applyStoredBattleResult()` 时 `startExplore()` 必被
 * `checkUnlock()` 的 `owned.has(cellId)` 挡掉 ⇒ `victoryPending` 恒 false ⇒
 * `victoryClaimCells` 恒空 ⇒ `emitChestDropFlight()` 静默 return。
 *
 * 修法：新增 `victoryBattleCells`，直接认「存档里那局战斗赢了」这条一次性边沿。
 */

const CELL = 372;
const MAP_PATH = 'assets/script/app/main/MainTerritoryMap.ts';

function victoryBattle(): NonNullable<TerritoryChapterSave['battle']> {
    return {
        chapterId: 1,
        cellId: CELL,
        levelId: 20001,
        status: TERRITORY_BATTLE_STATUS.victory,
        startedAt: Date.now() - 1000,
        resolvedAt: Date.now(),
    };
}

function presenterHarness(
    battle: TerritoryChapterSave['battle'],
    options: { ownedCells?: number[]; passCells?: number[] } = {},
) {
    const passCells = options.passCells ?? [367, CELL];
    const store = createFakeStore({ battle, ...(options.ownedCells ? { ownedCells: options.ownedCells } : {}) });
    const gateway = createFakeGateway({ fetch: {
        ok: true,
        state: { levelChapter: 1, rewardState: 0, unlockCells: [367, CELL], passCells },
    } });
    const loader = createFakeLoader({
        ...bundle,
        mapJson: asyncRepeatMap,
        campaign: {
            stages: [asyncRepeatStage], playerCardCount: 3,
            idleRewardMaxHours: 8, levelAutoStart: true,
        },
    });
    return createHarness({ loader, gateway, store });
}

// ── ① 真模型链路：服务端权威胜利 ⇒ 仍要发边沿 ─────────────────

test('★ 异步 PVP 胜利：服务端先把格标成 owned，依旧发出掉落宝箱边沿', async () => {
    const h = presenterHarness(victoryBattle());
    h.presenter.start();
    await flush(20);
    const state = h.presenter.state;
    assert.equal(state.progress?.isOwned(CELL), true, '服务端 passCells 必须已落 owned（这是真因的前提）');
    assert.deepEqual(Array.from(state.victoryClaimCells ?? []), [],
        '真因复现：owned 先落 ⇒ startExplore 被拒 ⇒ 本地探索零收地');
    assert.deepEqual(Array.from(state.victoryBattleCells ?? []), [CELL],
        '「这局打赢了」必须直接来自战斗结算存档，与有没有新收地无关');
    assert.equal(h.storeCalls.clearBattle, 1, '结算存档只消费一次 ⇒ 天然一局一次');
    h.presenter.dispose();
});

test('★ 重复挑战：本地档和服务端都早已 owned，也要发边沿', async () => {
    const h = presenterHarness(victoryBattle(), { ownedCells: [CELL] });
    h.presenter.start();
    await flush(20);
    assert.equal(h.presenter.state.progress?.isOwned(CELL), true);
    assert.deepEqual(Array.from(h.presenter.state.victoryBattleCells ?? []), [CELL],
        '已通关据点重复挑战（子类型 2）本来就永远没有新收地，不能因此丢动画');
    h.presenter.dispose();
});

test('失败 / 未结算 / 没有战斗记录 ⇒ 都不许误发胜利边沿', async () => {
    const cases: Array<[string, TerritoryChapterSave['battle']]> = [
        ['战败', { ...victoryBattle(), status: TERRITORY_BATTLE_STATUS.defeat }],
        ['结算未确认', { ...victoryBattle(), status: TERRITORY_BATTLE_STATUS.pending, resolvedAt: undefined }],
        ['回城但没有战斗存档', undefined],
    ];
    for (const [label, battle] of cases) {
        const h = presenterHarness(battle);
        h.presenter.start();
        await flush(20);
        assert.deepEqual(Array.from(h.presenter.state.victoryBattleCells ?? []), [], label);
        h.presenter.dispose();
    }
});

test('切章清空：上一章的胜利标记不许漏到新章', async () => {
    const h = presenterHarness(victoryBattle());
    h.presenter.start();
    await flush(20);
    assert.deepEqual(Array.from(h.presenter.state.victoryBattleCells ?? []), [CELL]);
    h.presenter.dispose();
    // dispose 后实例不再复用；这里只确认清场不抛错、且下一章会重新按存档判。
    const next = presenterHarness(undefined);
    next.presenter.start();
    await flush(20);
    assert.deepEqual(Array.from(next.presenter.state.victoryBattleCells ?? []), []);
    next.presenter.dispose();
});

// ── ② 页面侧：把边沿翻译成 DROP_FLIGHT 事件 ─────────────────────

interface IEmitted { name: string; payload: { origin: { x: number; y: number } | null; cellId: number } }

function createMapHarness() {
    const emitted: IEmitted[] = [];
    const exports: { MainTerritoryMap?: new () => Record<string, unknown> } = {};
    const imports: Record<string, unknown> = {
        cc: { Component: class {}, _decorator: {
            ccclass: () => (type: unknown) => type, property: () => () => {},
        } },
        '../../framework/event/EventMgr': { EventMgr: { instance: {
            on: () => undefined, offTarget: () => undefined,
            emit: (name: string, payload: IEmitted['payload']) => emitted.push({ name, payload }),
        } } },
        './ChestEvents': { CHEST_EVENTS },
        // 只给 emitChestDropFlight 会摸到的那个枚举；其余 import 落空对象即可。
        '../territory/model/TerritoryMapConfig': {
            TERRITORY_SITE_TYPE: { asyncPvp: 'asyncPvp' },
        },
    };
    const code = ts.transpileModule(readFileSync(MAP_PATH, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, {
        exports, console,
        require: (id: string) => imports[id] ?? {},
    });
    assert.ok(exports.MainTerritoryMap);
    const page = new exports.MainTerritoryMap!();
    const points = new Map<number, { x: number; y: number }>([
        [CELL, { x: -120, y: 260 }],
        [367, { x: 0, y: 0 }],
    ]);
    Object.assign(page, {
        mapView: { cellWorldPoint: (cellId: number) => points.get(cellId) ?? null },
    });
    const fire = (cells: readonly number[] | null | undefined, sites: unknown): void => {
        (page.emitChestDropFlight as (a: unknown, b: unknown) => void).call(page, cells, sites);
    };
    return { fire, emitted };
}

test('★ 页面：victoryBattleCells 有值就发 DROP_FLIGHT，优先 asyncPvp 格心', () => {
    const h = createMapHarness();
    const sites = [
        { cellId: 367, type: 'stage' },
        { cellId: CELL, type: 'asyncPvp' },
    ];
    h.fire([367, CELL], sites);
    assert.equal(h.emitted.length, 1);
    assert.equal(h.emitted[0].name, CHEST_EVENTS.DROP_FLIGHT);
    assert.equal(h.emitted[0].payload.cellId, CELL, '异步 PVP 格优先');
    // 沙箱跨 realm：deepStrictEqual 会因原型不同而假红，逐字段比。
    assert.equal(h.emitted[0].payload.origin?.x, -120);
    assert.equal(h.emitted[0].payload.origin?.y, 260);
});

test('页面：单格 / 非 asyncPvp / 取不到格心都退化而不静默消失', () => {
    const single = createMapHarness();
    single.fire([367], [{ cellId: 367, type: 'stage' }]);
    assert.equal(single.emitted.length, 1, '战斗掉落宝箱对任何据点胜利都成立');
    assert.equal(single.emitted[0].payload.cellId, 367);

    const missing = createMapHarness();
    missing.fire([999], []);
    assert.equal(missing.emitted.length, 1);
    assert.equal(missing.emitted[0].payload.origin, null, '格心拿不到 ⇒ 让 MainPage 退回默认起飞点');
});

test('页面：空边沿 / 老快照不带字段 / sites 缺失一律跳过且不抛错', () => {
    const empty = createMapHarness();
    empty.fire([], [{ cellId: CELL, type: 'asyncPvp' }]);
    assert.equal(empty.emitted.length, 0);

    const old = createMapHarness();
    old.fire(undefined, undefined);
    assert.equal(old.emitted.length, 0);

    const noSites = createMapHarness();
    noSites.fire([CELL], null);
    assert.equal(noSites.emitted.length, 1, 'sites 缺失仍照常起飞（只是挑不出 asyncPvp）');
    assert.equal(noSites.emitted[0].payload.cellId, CELL);
});
