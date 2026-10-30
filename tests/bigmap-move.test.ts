import { createControllerContext } from './helpers/controller-context';
import { BigMapController } from '../assets/script/app/bigmap/application/BigMapController';
import { bigMapViewStateFixture } from './helpers/bigmap-view-state-fixture';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
/**
 * 建筑搬移 + 野怪击杀进度展示。
 *
 * 搬移是协议 `CmdSlgBuildMoveReqMsg` 唯一还差界面入口的能力：服务端只管
 * 「实例 + 目标格」，不收费、不占建造队列。所以 model 层不加任何额外门槛，
 * 这里钉死的就是这几条：
 *   1. 只换 `hexId`，等级 / 存量 / 上次结算时刻 / 资源一样不动；
 *   2. 目标格被建筑或「在建」占住就拒（在建格也算占位，见 `occupiedPlotCells`）；
 *   3. 越界、同格、实例不存在都拒，且**原状态原样返回**（调用方不必判空）。
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as BigMapPresentationText from '../assets/script/app/bigmap/view/BigMapPresentationText';
import assert from 'node:assert/strict';
import {
    bigMapCanMove,
    bigMapMove,
    bigMapPlotHexId,
    bigMapStartBuild,
    bigMapTick,
    createBigMapBaseState,
} from '../assets/script/app/bigmap/model/BigMapBase';
import type { IBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapTypes';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import type { IBigMapMonsterView } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { formatBigMapMonsterDetail } from '../assets/script/app/bigmap/view/BigMapPresentationText';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const NOW = 1_000_000;
const MAIN = 71001;
const GRAIN_FIELD = 71002;
const CENTER = bigMapPlotHexId(2, 2, config.queue.plotCols);

function newBase(): IBigMapBaseState {
    return createBigMapBaseState(config, NOW);
}

test('主城搬到空格：只换 hexId，等级 / 存量 / 资源一样不动', () => {
    const before = newBase();
    const main = before.buildings.find((item) => item.buildingId === MAIN)!;
    assert.equal(main.hexId, CENTER);

    const target = bigMapPlotHexId(0, 0, config.queue.plotCols);
    const moved = bigMapMove(config, before, main.instanceId, target);
    assert.equal(moved.ok, true, moved.reason);

    const after = moved.state!;
    const afterMain = after.buildings.find((item) => item.instanceId === main.instanceId)!;
    assert.equal(afterMain.hexId, target);
    assert.equal(afterMain.level, main.level);
    assert.equal(afterMain.stored, main.stored);
    assert.equal(afterMain.lastTickAt, main.lastTickAt);
    assert.equal(after.buildings.length, before.buildings.length);
    // 搬家不收费，也不写建造队列。
    assert.deepEqual(after.res, before.res);
    assert.deepEqual(after.queues, before.queues);
    // 纯函数：原状态没被原地改。
    assert.equal(before.buildings.find((item) => item.instanceId === main.instanceId)!.hexId, CENTER);
});

test('目标格被别的建筑占住：拒绝，且原状态原样返回', () => {
    const unlock = makeUnlockContext({ adventureChapter: 6 });
    let state = newBase();
    const fieldHex = bigMapPlotHexId(0, 4, config.queue.plotCols);
    state = bigMapStartBuild(config, state, unlock, GRAIN_FIELD, fieldHex, NOW).state!;
    state = bigMapTick(config, state, NOW + 20).state;
    const field = state.buildings.find((item) => item.buildingId === GRAIN_FIELD)!;
    assert.equal(field.hexId, fieldHex);

    const main = state.buildings.find((item) => item.buildingId === MAIN)!;
    const check = bigMapCanMove(config, state, main.instanceId, fieldHex);
    assert.equal(check.ok, false);
    assert.match(check.reason, /已有建筑/);

    const result = bigMapMove(config, state, main.instanceId, fieldHex);
    assert.equal(result.ok, false);
    // 失败时必须把原状态还回来（引用相等即可，说明没造半成品）。
    assert.equal(result.state, state);
});

test('「在建」的格子也算占位：不能把建筑搬进正在施工的格', () => {
    const unlock = makeUnlockContext({ adventureChapter: 6 });
    const fieldHex = bigMapPlotHexId(0, 4, config.queue.plotCols);
    const state = bigMapStartBuild(config, newBase(), unlock, GRAIN_FIELD, fieldHex, NOW).state!;
    // 20s 之前队列还在跑，建筑尚未落地。
    assert.equal(state.buildings.length, 1);

    const main = state.buildings.find((item) => item.buildingId === MAIN)!;
    const check = bigMapCanMove(config, state, main.instanceId, fieldHex);
    assert.equal(check.ok, false);
    assert.match(check.reason, /已有建筑/);
});

test('越界 / 同格 / 实例不存在：全部拒绝并给原因', () => {
    const state = newBase();
    const main = state.buildings.find((item) => item.buildingId === MAIN)!;
    const plotSize = config.queue.plotRows * config.queue.plotCols;

    const outOfRange = bigMapCanMove(config, state, main.instanceId, plotSize);
    assert.equal(outOfRange.ok, false);
    assert.match(outOfRange.reason, /超出建造区/);

    const negative = bigMapCanMove(config, state, main.instanceId, -1);
    assert.equal(negative.ok, false);
    assert.match(negative.reason, /超出建造区/);

    const same = bigMapCanMove(config, state, main.instanceId, CENTER);
    assert.equal(same.ok, false);
    assert.match(same.reason, /已经在这个位置/);

    const missing = bigMapCanMove(config, state, 9999, bigMapPlotHexId(1, 1, config.queue.plotCols));
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /不存在/);
});

test('Presenter 离线态：requestMove 走本地分支，换格后落盘', async () => {
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({
        config, storage, saveKey: 'move-offline', adventureChapter: () => 6, now: () => NOW,
    });
    const mainHexId = presenter.plotCells().find((cell) => cell.buildingId === MAIN)!.hexId;
    const target = bigMapPlotHexId(4, 4, config.queue.plotCols);

    const result = await presenter.requestMove(1, target);
    assert.equal(result.ok, true, result.message);
    assert.equal(presenter.plotCells().find((cell) => cell.buildingId === MAIN)!.hexId, target);
    assert.notEqual(mainHexId, target);

    // 存档也要跟上，否则重进页面又搬回去了。
    const again = new BigMapPresenter({
        config, storage, saveKey: 'move-offline', adventureChapter: () => 6, now: () => NOW,
    });
    assert.equal(again.plotCells().find((cell) => cell.buildingId === MAIN)!.hexId, target);
});

test('Presenter 离线态：非法目标格拒绝且不改存档', async () => {
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({
        config, storage, saveKey: 'move-invalid', adventureChapter: () => 6, now: () => NOW,
    });
    const before = storage.read('move-invalid');
    const result = await presenter.requestMove(1, config.queue.plotRows * config.queue.plotCols);
    assert.equal(result.ok, false);
    assert.match(result.message, /超出建造区/);
    assert.equal(storage.read('move-invalid'), before);
});

test('野怪详情显示已通关最高等级；没打过就不带这句', () => {
    const base: IBigMapMonsterView = {
        instanceId: 1, monsterId: 8001, name: '腐化幼苗', level: 1, clearedLevel: 3, hexId: 10,
        unlocked: true, reason: '', hpRatio: null, staminaCost: 10, respawnInSeconds: 0,
        battle: null, canAttack: false, attackReason: '',
    };
    const withProgress = formatBigMapMonsterDetail(base);
    assert.match(withProgress, /已通关最高 3 级/);
    // 进度并进第一行，不新增行 —— 详情面板按 sections 切块，多一行会把中间那块挤歪。
    assert.equal(withProgress.split('\n')[0].includes('已通关最高 3 级'), true);

    const fresh = formatBigMapMonsterDetail({ ...base, clearedLevel: 0 });
    assert.doesNotMatch(fresh, /已通关最高/);
    assert.equal(fresh.split('\n').length, withProgress.split('\n').length);
});

test('野怪详情带 battle 时同样显示进度，推荐战力等原有行不变', () => {
    const view: IBigMapMonsterView = {
        instanceId: 2, monsterId: 8010, name: '腐化巨花', level: 5, clearedLevel: 4, hexId: 11,
        unlocked: false, reason: '需先通关 4 级', staminaCost: 40, respawnInSeconds: 0,
        battle: {
            battleId: 30010, recommendAttack: 1200, unlockType: 1, unlockValue: 4,
            rallyOpen: false, rallyNum: 0, firstKillDrops: [], normalDrops: [], iconPath: '', modelPath: '',
        },
        canAttack: false, attackReason: '',
    };
    const lines = formatBigMapMonsterDetail(view).split('\n');
    assert.match(lines[0], /^条件：需先通关 4 级　已通关最高 4 级$/);
    assert.match(lines[1], /推荐战力：1200/);
    assert.equal(lines.length, 5);
});

/**
 * 页面级：搬移态的两个分支。
 *
 * model 层已经钉住「能不能搬」，这里只钉交互不会走反 —— 尤其是
 * `BigMapBaseView` 在回调前就把高亮切到被点的格，所以「点原格取消」必须
 * 比 `selectedPlotHexId` 更早判，否则第二次点原格会被当成搬去原格。
 */
function loadPageClass(): new () => Record<string, unknown> {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} };
        // `BigMapPage` 的字段初始化器会 `new ResourceScope(...)`，桩成 `{}` 会当场炸。
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        // 详情正文/按钮文案都走它；桩成 `{}` 会在 `formatBigMapPlotDetail(...)` 上炸。
        if (name.endsWith('/BigMapPresentationText')) return BigMapPresentationText;
        return {};
    } });
    return exports.BigMapPage as new () => Record<string, unknown>;
}

for (const succeeds of [true, false]) test(`Controller 搬移：${succeeds ? '成功后退出，点原格取消' : '拒绝后保留搬移态供重试'}`, async () => {
    const model = new BigMapPresenter({ config, storage: createMemoryBigMapStorage(), saveKey: 'mvc-move', adventureChapter: () => 10, now: () => NOW });
    const calls: number[][] = [];
    model.plotDetail = () => ({ instanceId: 7, buildingId: 71001, hexId: 12, queueSlotIndex: -1, stored: 0 } as any);
    model.requestMove = async (id, hexId) => { calls.push([id, hexId]); return { ok: succeeds, message: '' }; };
    model.canCollectBuilding = () => false;
    const controller = new BigMapController(model, { context: createControllerContext(), schedule: () => () => {} });
    const intent = (value: mvcEvents.BigMapIntent) => EventMgr.instance.emit(mvcEvents.BigMapUiEvent.Intent, { intent: value });
    controller.start();
    try {
        intent({ kind: 'mode', mode: 'base' }); intent({ kind: 'plotTap', hexId: 12 }); intent({ kind: 'secondary' });
        assert.equal(controller.snapshot.ui.pendingMoveInstanceId, 7);
        intent({ kind: 'plotTap', hexId: 13 });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, [[7, 13]]);
        assert.equal(controller.snapshot.ui.pendingMoveInstanceId, succeeds ? 0 : 7);
        if (succeeds) intent({ kind: 'secondary' });
        intent({ kind: 'plotTap', hexId: 12 });
        assert.deepEqual(calls, [[7, 13]]);
        assert.equal(controller.snapshot.ui.pendingMoveInstanceId, 0);
    } finally { controller.dispose(); }
});

test('基地详情次按钮：收不了的角色给「移动」，施工中的直接隐藏', () => {
    const Page = loadPageClass();
    const makeButton = () => ({
        node: { active: true },
        text: '',
        setText(value: string) { this.text = value; },
        setEnabled() { /* 桩 */ },
    });
    const build = (queueSlotIndex: number) => {
        const page = new (Page)() as any;
        page.mode = 'base';
        page.selectedPlotHexId = 12;
        page.selectedCityId = 0;
        page.selectedMonsterId = 0;
        page.art = null;
        page.infoTitle = { string: '' };
        page.infoBody = { string: '', fontSize: 0, lineHeight: 0 };
        page.infoThumbnail = { node: { active: true } };
        page.primaryButton = makeButton();
        page.secondaryButton = makeButton();
        page.setInfoVisible = () => undefined;
        page.setInfoIcon = () => undefined;
        page.data = bigMapViewStateFixture({
            plotDetails: new Map([[12, {
                name: '主城', buildingId: 71001, instanceId: 1, level: 1, targetLevel: 2, stored: 0,
                costGrain: 0, costWood: 0, costIron: 0, buildTime: 0, canUpgrade: true,
                reason: '', queueSlotIndex, remainSeconds: 0, progress: 0,
            }]]),
            isServerBase: false,
        });
        page.refreshInfoContent();
        return page;
    };

    const idle = build(-1);
    assert.equal(idle.secondaryButton.node.active, true);
    assert.equal(idle.secondaryButton.text, '移动');

    // 施工中的格子既收不了也搬不了 —— 宁可藏掉，也别给一颗点了就报错的钮。
    const busy = build(0);
    assert.equal(busy.secondaryButton.node.active, false);
});
