/**
 * territory-presenter 关卡开战、快速寻敌与弹窗交互 专项单测
 * 从 territory-presenter.test.ts 按业务域解耦拆分，脚手架抽至 helpers/territory-presenter-fixture.ts
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import {
    createBattlePageProbe,
    createBossFindLoader,
    createFakeGateway,
    createFakeLoader,
    createFakeStore,
    createHarness,
    createOutputSpy,
    flush,
    fakeBattleStart,
    bundle,
    mapJson,
    stage,
    nullArt,
    bossMap,
    bossStage,
    asyncRepeatStage,
    asyncRepeatMap,
    createAsyncRepeatHarness,
    FINAL_BOSS_CELL,
    MID_BOSS_CELL,
    configureTerritoryMap,
    territoryNeighbors,
    TerritorySaveStore,
    assetPath,
    readFileSync,
    TERRITORY_REQUEST_STATUS,
    TerritoryUiEvent,
    TerritoryViewEvent,
} from './helpers/territory-presenter-fixture';
import { readTerritoryMonsterBoxGroups } from '../assets/script/app/territory/model/TerritoryMonsterBoxConfig';
import { emptyCellState } from '../assets/script/app/territory/model/TerritoryCellBitSet';
import type { TerritoryStartBattleResult } from '../assets/script/app/territory/application/TerritoryCellRepository';
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';

test('关卡按钮等有效开战回包后才收弹窗，关闭事件不能取消刚发出的请求', async () => {
    const gateway = createFakeGateway({ fetch: {
        // passCells 必须含 252：2026-10-31 起快速寻敌的目标是「推进到的那一关」，
        // 不把 1-4 记为已通过的话它会停在 252（第 4 关），而不是 213（第 5 关 Boss）。
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367, 252] },
    } });
    let reply: (result: TerritoryStartBattleResult) => void = () => {};
    gateway.gateway.startBattle = () => new Promise((resolve) => { reply = resolve; });
    const h = createHarness({ loader: createBossFindLoader(), gateway });
    const probe = createBattlePageProbe(h.presenter);
    try {
        await flush();
        assert.equal(h.presenter.focusCurrentLevel(), 213);
        probe.page.onDetailStart();
        assert.equal(probe.closes(), 0, '请求在途不能触发 DETAIL_CLOSE 并作废 requestId');
        reply({ ok: true, battle: fakeBattleStart });
        await flush();
        assert.equal(h.nav.length, 1, '有效回包必须交接到战斗流程');
        assert.equal(probe.routes.length, 1);
        assert.equal(probe.closes(), 1, '流程接手时收掉挂在全局弹窗栈上的关卡界面');
    } finally {
        probe.dispose();
        h.presenter.dispose();
    }
});

test('关卡开战被拒绝时保留详情可重试，玩家主动关闭仍取消迟到回包', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367, 252] },
    } });
    let reply: (result: TerritoryStartBattleResult) => void = () => {};
    let requests = 0;
    gateway.gateway.startBattle = () => { requests++; return new Promise((resolve) => { reply = resolve; }); };
    const h = createHarness({ loader: createBossFindLoader(), gateway });
    const probe = createBattlePageProbe(h.presenter);
    try {
        await flush();
        h.presenter.focusCurrentLevel();
        probe.page.onDetailStart();
        reply({ ok: false, reason: 'failed' });
        await flush();
        assert.equal(probe.closes(), 0);
        assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true);
        probe.page.onDetailStart();
        assert.equal(requests, 2);
        probe.page.onDetailClose();
        reply({ ok: true, battle: fakeBattleStart });
        await flush();
        assert.equal(h.nav.length, 0, '真正关闭详情后仍必须丢弃迟到回包');
    } finally {
        probe.dispose();
        h.presenter.dispose();
    }
});

test('★★★过场接手的关详情不许作废在途开战请求（否则回包到了也没人接）', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367, 252] },
    } });
    let reply: (result: TerritoryStartBattleResult) => void = () => {};
    let requests = 0;
    gateway.gateway.startBattle = () => { requests++; return new Promise((resolve) => { reply = resolve; }); };
    const h = createHarness({ loader: createBossFindLoader(), gateway });
    const probe = createBattlePageProbe(h.presenter);
    try {
        await flush();
        h.presenter.focusCurrentLevel();
        probe.page.onDetailStart();
        assert.equal(requests, 1);
        // 页面起演整页过场：先声明「这一下是程序关的」，再关掉挡路的关卡界面。
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'keepBattleRequest' } });
        probe.page.onDetailClose();
        assert.equal(h.presenter.state.detail.levelInfo, null, '弹窗该关还是要关（要演过场）');
        assert.equal(h.presenter.state.detail.siteId ?? null, null, '详情状态也要收掉');
        reply({ ok: true, battle: fakeBattleStart });
        await flush();
        assert.equal(h.nav.length, 1, '★回包到达后必须交接到战斗流程');
        assert.equal(probe.routes.length, 1, '★页面要真的发出跳转');
    } finally {
        probe.dispose();
        h.presenter.dispose();
    }
});

test('首次点击巡逻宝箱，解锁成功后自动弹出可升级的详情，只由挑战按钮开战', async () => {
    const monsterBoxGroups = readTerritoryMonsterBoxGroups([
        { monsterBoxId: 1001, monsterBoxGrade: 1, monsterBoxLevel: 1001 },
        { monsterBoxId: 1001, monsterBoxGrade: 2, monsterBoxLevel: 1001, monsterBoxUpCostCoins: 20 },
    ]);
    const loader = createFakeLoader({
        ...bundle,
        mapJson: {
            ...mapJson,
            sites: [
                { id: 'patrolChest_1', type: 'patrolChest', cellId: 1, battleId: 1001, patrolLevelId: 1001 },
                { id: 'patrolChest_1', type: 'patrolChest', cellId: 2, battleId: 1001, patrolId: 2501, patrolLevelId: 1001 },
                { id: 'patrolChest_2', type: 'patrolChest', cellId: 3, battleId: 1002 },
            ],
        },
        campaign: { ...bundle.campaign, stages: [{ ...stage, mode: 'defence' }], monsterBoxGroups },
    });
    const gateway = createFakeGateway();
    const initialFetch = gateway.gateway.fetchChapterCells;
    let finishSnapshot: () => void = () => {};
    const snapshotReady = new Promise<void>(resolve => { finishSnapshot = resolve; });
    gateway.gateway.fetchChapterCells = async (chapterId, maxCell) => {
        const result = await initialFetch(chapterId, maxCell);
        if ('reason' in result || gateway.calls.fetch === 1) return result;
        await snapshotReady;
        return { ok: true, state: { ...result.state, unlockCells: [1], monsterBoxes: [{ cellId: 2, lv: 1 }] } };
    };
    const upgradeCells: number[] = [];
    gateway.gateway.upMonsterBoxLv = async (_chapterId, cellId) => {
        upgradeCells.push(cellId);
        return { ok: true, monsterBox: { cellId, lv: 2 } };
    };
    const h = createHarness({ loader, gateway });
    let rendered: ITerritoryViewState['detail']['monsterBox'] = null;
    h.presenter.onOutput(output => {
        if (output.kind === 'changed') rendered = h.presenter.state.detail.monsterBox;
    });
    try {
        h.presenter.start();
        await flush();
        const [patrol, anchor, unbound] = h.presenter.state.map!.sites;

        assert.equal(h.presenter.selectSite(patrol), true);
        assert.equal(h.presenter.state.detail.monsterBox, null, '等待解锁确认');
        await flush();
        assert.equal(h.gatewayCalls.unlock, 1);
        assert.equal(h.gatewayCalls.startBattle, 0);

        assert.equal(rendered?.lv, 0, '快照未到时，不能猜等级');
        finishSnapshot();
        await flush();
        assert.equal(rendered?.lv, 1, '只收到宝箱等级变化也要刷新已打开的详情');
        assert.equal(rendered?.cellId, anchor.cellId);
        assert.equal(rendered?.battleEnabled, true);
        assert.equal(rendered?.upgradeCost, 20);
        assert.equal(h.gatewayCalls.fetch, 2, '首次解锁后补拉缺失的宝箱等级');
        assert.equal(h.gatewayCalls.startBattle, 0);
        await h.presenter.upgradeMonsterBox(rendered.cellId);
        await flush();
        assert.deepEqual(upgradeCells, [anchor.cellId]);
        assert.equal(rendered?.lv, 2, '升级回包应继续刷新同一个巡逻区');
        assert.equal(rendered?.upgradeCost, 0, '满级时收起升级入口');

        h.presenter.state.progress!.markCellUnlocked(unbound.cellId);
        assert.equal(h.presenter.selectSite(unbound), true);
        assert.equal(h.presenter.state.detail.monsterBox?.cellId, unbound.cellId);
        assert.equal(h.presenter.state.detail.monsterBox?.battleEnabled, false);
        h.presenter.requestBattle();
        assert.equal(h.gatewayCalls.startBattle, 0);

        assert.equal(h.presenter.selectSite(patrol), true);
        h.presenter.requestBattle();
        await flush();
        assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '2']]);
        assert.equal(h.gatewayCalls.pass, 0);
        assert.equal(h.nav.length, 1);
    } finally {
        h.presenter.dispose();
    }
});

test('quick find opens current Boss detail without unlocking, charging, or starting battle', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        // 1-4 已通关 ⇒ 目标推进到第 5 关（Boss 213）
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 213], passCells: [367, 252] },
    } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.focusCurrentLevel(), 213);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
    assert.equal(h.presenter.state.detail.levelInfo?.title, '首领关卡  5');
    assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true, 'server-unlocked Boss remains challengeable');
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.storeCalls.beginBattle, 0);
    assert.equal(h.nav.length, 0);
    h.presenter.requestBattle();
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, 'only the detail button starts a single server battle');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '213']]);
    assert.equal(h.nav.length, 1);
    h.presenter.dispose();
});

test('quick find stops at the unpassed ordinary level instead of skipping ahead to the Boss', async () => {
    // 2026-10-31 用户：「跳到当前章节地图上最新一个未通过的关卡，如果没有未通过的关卡，
    // 就打开已通过的关卡」。夹具里有第 4 关（普通关 252）和第 5 关（Boss 213）——
    // 只通过起点时，目标必须是**第 4 关**，而不是老逻辑那样一步跳到第 5 关 Boss。
    //
    // 🔴 「只挑已解锁的」（同日追加）：`unlockCells` 必须真的把第 4 关解锁掉，否则 252 会被
    //    `isLevelUnlocked` 过滤、一个候选都不剩（返回 `null`）。这不是夹具凑数——服务端解锁
    //    `/ 通关后的邻格放行` 就是这个字段，测试里不给事实，就等于测「服务端什么都没解锁」。
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 252], passCells: [367] },
    } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.focusCurrentLevel(), 252, '目标是推进到的那一关（第 4 关），不是后面的 Boss');
    assert.equal(h.presenter.state.detail.levelInfo?.title, '领地关卡  4', '普通关同样要弹关卡界面');
    assert.equal(h.gatewayCalls.unlock, 0, '快速寻敌只开详情，不代玩家解锁');
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.nav.length, 0);
    h.presenter.dispose();
});

test('解锁状态没拉回来时快速寻敌照样敢选：详情「解锁后开战」，点头先解锁再开战', async () => {
    // 「只挑已解锁的」用的是 `isUnlockable` 而**不是** `isCellUnlocked`（见
    // `TerritoryProgress.isUnlockable`：服务端状态没确认过就一律放行）。
    // 这条用例守的就是那个「不知道 ≠ 没解锁」的兜底 —— 弱网下如果直接按"没解锁"过滤，
    // 快速寻敌会一个候选都没有、返回 `null`，按钮变死。
    //
    // 也正因为有这条兜底，「解锁后开战」这个文案不是死代码：拉不到解锁状态时，
    // 快速寻敌仍可能选中一个实际锁着的关卡，详情就该老老实实写「解锁后开战」，
    // 由「开始战斗」按钮先补一次解锁（`handleBattleStationStart` 第一步）。
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch:
        { ok: false, reason: 'offline', state: emptyCellState(1) } }) });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.progress?.serverStateKnown, false, '夹具前提：解锁状态确实没拉到');
    // 夹具里只绑了第 4 / 5 / 10 关，所以「最前沿的未通关关卡」就是第 4 关 252。
    assert.equal(h.presenter.focusCurrentLevel(), 252, '状态未知 ⇒ 照样给出最前沿的关卡，不许返回 null');
    assert.equal(h.presenter.state.detail.levelInfo?.fightCaption, '解锁后开战');
    h.presenter.requestBattle();
    assert.equal(h.presenter.focusCurrentLevel(), null, 'quick find must not invalidate a pending write');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '第一步只解锁');
    assert.equal(h.gatewayCalls.startBattle, 0, '解锁回包不会顺手把战斗发出去');
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须还开着');
    assert.equal(h.presenter.state.detail.levelInfo?.fightCaption, '开始战斗');
    h.presenter.requestBattle();
    await flush();
    // 🔴 普通关（`mode = match`）不再由领地发开战请求 —— 用户 2026-11-02 口径：交给匹配页发。
    assert.equal(h.gatewayCalls.startBattle, 0, '普通关的请求交给匹配页');
    assert.equal(h.nav.length, 1);
    assert.deepEqual(h.battleParams[0], ['1', '1', '252'], 'battleParams 要原样交给匹配页');
    assert.equal(h.battles[0], undefined, '没有 battleId —— 由匹配页自己发请求拿');
    h.presenter.dispose();
});

test('已通关的普通关卡：弹窗照常打开，「开始战斗」可点、照常扣体力、真能再打一局', async () => {
    // 用**单格**夹具（不借 `chapter_01.json` 那张大地图）：地图上第一个 `stage` 站点未绑定关卡，
    // `staminaCost` 就是 0，会把「照常扣体力」这条断言测成假绿/假红。这里显式绑 `stage`（体力 5）。
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: { ...mapJson, sites: [{ id: 'replay', type: 'stage', cellId: 1, configId: '1001' }] },
            campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss: false, mode: 'match' }] },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0, 1] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    assert.equal(h.presenter.state.progress?.isAreaPassed(site.cellId), true, '夹具前提：这一格已通关');
    h.presenter.selectSite(site);
    const info = h.presenter.state.detail.levelInfo;
    // 🔴 2026-10-28 用户两条口径：
    //   ①「点击已通过的关卡也可以打开【领地关卡信息弹窗】」——图上已放开 `interactive`；
    //   ②「已通过的关卡重复挑战仍需要消耗体力」——弹窗按钮**不许**退化成「已通关 + 禁用」，
    //     否则 ② 就成了空话（按钮根本点不动，也就没有"重复挑战扣体力"这回事）。
    assert.ok(info, '已通关的关卡必须也能打开这个弹窗（以前点在建筑上毫无反应）');
    assert.equal(info!.fightCaption, '开始战斗', '已通关 ≠ 不能打，按钮文案不能改');
    assert.equal(info!.fightEnabled, true, '重复挑战要能点得动');
    assert.equal(info!.staminaCost, 5, '重复挑战照常扣体力 ⇒ 费用必须是关卡配的 5（不能归零）');
    // 真按下去要真的发开战请求（`handleBattleStationStart` 对已通关的普通关卡不再提前 return）。
    h.presenter.requestBattle();
    await flush();
    // 普通关（`mode = match`）的请求交给匹配页 ⇒ 领地这一侧**一次都不发**。
    assert.equal(h.gatewayCalls.startBattle, 0, '已通关的普通关卡也不再由领地请求服务端');
    assert.equal(h.battleParams[0]?.[0], '1',
        '主线 stage/boss 恒为格子战斗子类型 1（宝箱战斗子类型 2 只属于已通关的 asyncPvp）');
    assert.equal(h.gatewayCalls.unlock, 0, '已通关 ⇒ 不再重复解锁');
    assert.equal(h.nav.length, 1, '仍然要进匹配界面');
    h.presenter.dispose();
});

test('已通关的首领同样可重复挑战，弹窗按钮保持「开始战斗」', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
    } }) });
    h.presenter.start();
    await flush();
    const map = h.presenter.state.map!;
    const site = map.sites.find((candidate) => candidate.type === 'boss')!;
    h.presenter.state.progress!.markCellPassed(site.cellId);
    h.presenter.selectSite(site);
    const info = h.presenter.state.detail.levelInfo;
    assert.ok(info, '已通关的首领同样要能打开弹窗');
    assert.equal(info!.fightCaption, '开始战斗', '首领可重复挑战，按钮不能跟着改成「已通关」');
    assert.equal(info!.fightEnabled, true);
    assert.ok(info!.staminaCost > 0, '可再战 ⇒ 体力费用照旧显示');
    h.presenter.dispose();
});

test('quick find falls back to the latest cleared Boss and starts a server battle without unlocking again', async () => {
    const h = createHarness({ loader: createBossFindLoader(), gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367, 252, 193] },
    } }) });
    h.presenter.start();
    await flush();
    // 「没有未通过的关卡」= 整条关卡链都通了。夹具只回几个 passCells 表示不了这件事，
    // 而剩下没通关的格子又都还锁着（`isLevelUnlocked` 会过滤）—— 所以这里像
    // `territory-stage-binding` 的全通用例一样，直接把整张图的格子记成已通关。
    const map = h.presenter.state.map!;
    for (const site of map.sites) h.presenter.state.progress!.markCellPassed(site.cellId);
    assert.equal(h.presenter.focusCurrentLevel(), 105);
    assert.equal(h.presenter.state.detail.levelInfo?.title, '首领关卡  10');
    h.presenter.state.progress!.markCellPassed(85);
    assert.equal(h.presenter.focusCurrentLevel(), 105);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面必须弹');
    assert.equal(h.presenter.state.detail.levelInfo?.fightEnabled, true);
    h.presenter.requestBattle();
    h.presenter.requestBattle();
    await flush();
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '105']]);
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.gatewayCalls.pass, 0);
    assert.equal(h.nav.length, 1);
    h.presenter.dispose();
});

test('quick find handles loading without requests or navigation', () => {
    const h = createHarness({ loader: createBossFindLoader() });
    assert.equal(h.presenter.focusCurrentLevel(), null);
    assert.equal(h.tips.at(-1), '领地数据加载中，请稍候');
    h.presenter.dispose();
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.nav.length, 0);
});

test('an initially locked stage unlocks and starts the battle on the first click', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    // 弹窗不能开：这一下最终是直接进战斗。
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '未解锁 ⇒ 先发解锁');
    assert.deepEqual(h.gatewayCalls.unlockedCells, [site.cellId]);
    // 🔴 普通关（`mode = match`）：解锁成功 ⇒ 同一交互内直接交给匹配页，**领地不发**开战请求。
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页发（用户 2026-11-02 口径）');
    assert.deepEqual(h.battleParams[0], ['1', '1', String(site.cellId)],
        'battleParams = [子类型(1=格子战斗), 章节id, cellId]，必须原样交给匹配页');
    assert.equal(h.gatewayCalls.pass, 0, '关卡绝不发通关请求');
    assert.equal(h.storeCalls.beginBattle, 1, '开战回包成功后进战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁要记账');
    // 已解锁之后再点 ⇒ 只弹关卡界面，**不再**自动开战（这正是「只有解锁那一次」的判据）。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 点一下打开关卡界面');
    await flush();
    assert.equal(h.nav.length, 1, '第二次点击不许再自动开战（要等弹窗按钮）');
    // 弹窗里的「开始战斗」照旧可用。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 2, '窗里的按钮照样能把人送进匹配');
    assert.equal(h.gatewayCalls.unlock, 1, '开战不再重复解锁');
});

test('★首次解锁直开被拒（首领关）：只提示不进战斗，格子已解锁，再点回到关卡界面', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss: true, mode: 'defence' }] },
        }),
        gateway: createFakeGateway({
            fetch: { ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] } },
            start: { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected },
        }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.nav.length, 0, '开战被拒 ⇒ 不进战斗');
    assert.equal(h.storeCalls.beginBattle, 0, '不进战斗就不扣本地资源');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁已确认照常记账');
    assert.equal(h.tips.at(-1), '开战失败，请稍后重试');
    // 解锁过了 ⇒ 下一次点击是「弹关卡界面」，玩家可以在窗里重试。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '再点 ⇒ 打开关卡界面');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2, '窗里的「开始战斗」照常可用');
});

test('chapterLevelAutoStartConfig = 0：锁着的关卡点一下只解锁，不弹窗也不开战', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            campaign: { ...bundle.campaign, levelAutoStart: false },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1);
    assert.equal(h.gatewayCalls.startBattle, 0, '开关关掉 ⇒ 不发开战请求（退回老的两步）');
    assert.equal(h.nav.length, 0, '不进战斗');
    assert.equal(h.presenter.state.detail.levelInfo, null, '锁态那一下仍然不弹窗');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true, '解锁照常记账');
    assert.equal(h.tips.at(-1), '已解锁，点击查看关卡', '关掉后回到旧的解锁提示（不是直开那条）');
    // 开关只管「首次解锁那一下」：解锁之后再点照旧弹关卡界面、窗里按钮照常开战。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo);
    h.presenter.requestBattle();
    await flush();
    // 普通关：窗里「开始战斗」照常可用，只是请求由匹配页发。
    assert.equal(h.nav.length, 1, '窗里「开始战斗」照常把人送进匹配');
    assert.equal(h.gatewayCalls.startBattle, 0, '领地不发开战请求');
});

test('an already unlocked stage starts without sending a duplicate unlock', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0);
    assert.equal(h.nav.length, 1);
});

test('random pending blocks other cell writes and quick find without invalidating the first response', async () => {
    const randomBundle: ITerritoryChapterBundle = {
        ...bundle, mapJson: { ...mapJson, randomSites: {
            triggerSilver: 10, rewardPoolId: '2001', candidateCells: [4, 5], maxActive: 1,
        } },
    };
    let finish: (result: TerritoryWriteResult) => void = () => {};
    let requests = 0;
    const gateway = createFakeGateway();
    gateway.gateway.unlockCell = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
    const h = createHarness({ loader: createFakeLoader(randomBundle), gateway });
    h.presenter.start();
    await flush();
    h.presenter.selectRandomResource(4);
    h.presenter.selectRandomResource(5);
    h.presenter.selectSite(h.presenter.state.map.sites[0]);
    assert.equal(h.presenter.focusCurrentLevel(), null);
    h.presenter.closeDetail();
    assert.equal(requests, 1);
    assert.equal(h.presenter.state.progress.isCellUnlocked(4), false);
    assert.deepEqual(h.rewards, []);
    finish({ ok: true, unlockedCellIds: [4], rewards: [{ resId: 7, amount: 15 }] });
    await flush();
    assert.equal(h.presenter.state.progress.isOwned(4), true);
    assert.deepEqual(h.presenter.state.pendingRandomResourceCells, []);
    assert.deepEqual(h.rewards, [[{ resId: 7, amount: 15 }]]);
    assert.deepEqual(h.busy, []);
    h.presenter.dispose();
});

test('selectSite on a bound stage opens the level panel first, battle starts from its button', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
            },
        }),
    });
    h.presenter.start();
    await flush();
    const { detail } = h.presenter.state;
    assert.equal(detail.open, false, '没点之前不弹面板');
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();
    // 2026-10-27（蓝湖「关卡界面」）：点关卡先弹面板，**不发**开战请求。
    assert.ok(h.presenter.state.detail.levelInfo, '关卡点击后弹关卡界面');
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面内容必须给出');
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不开战');
    // 面板上的「开始战斗」= 原来的开战入口（普通关 → 进匹配，请求由匹配页发）。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 1, '点开始战斗才进匹配');
    assert.equal(h.gatewayCalls.startBattle, 0, '普通关的开战请求交给匹配页');
});

test('selectSite on an unbound site opens nothing (站点详情面板已移除)', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 2], passCells: [0] },
    } }) });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[1]);
    const { detail } = h.presenter.state;
    assert.equal(detail.open, true, '有站点被选中');
    // 详情面板已删（2026-10-27）⇒ 绑不到关卡的格子什么面板都不弹，信息留在左侧 info 区
    assert.equal(detail.levelInfo, null);
    assert.equal(detail.playerStage, null);
    assert.equal(h.gatewayCalls.startBattle, 0);
});

test('two-step stage 327 unlocks and starts the battle on the first click, later clicks open the panel', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    // ⚠️ 必须给 327 配一个**对得上 `configId`** 的 campaign stage：
    // `bindTerritoryStages` 按 `Number(site.configId)` 去匹配 `stage.levelId`，
    // 而共享夹具里的 `stage.levelId = 1001`、327 的 `configId = 10001` ⇒ 绑不上
    // ⇒ `bossStage` 为 null ⇒ 走「只解锁」兜底分支，永远不会发开战请求。
    // （这不是代码问题，是夹具数据与真实地图对不上。）
    const stageFor327: TerritoryCampaignStage = { ...stage, levelId: 10001, stage: 1 };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: publishedMap,
            campaign: { stages: [stageFor327], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 327)!;
    assert.equal(site.type, 'stage', 'chapter_01.json 的 stage_4 应为 stage 类型');
    assert.deepEqual(site.unlock.requiredCells, [367], 'stage_4 前置为主城 367');
    // 第一步：未解锁 → **解锁 + 立刻开战**（2026-10-29 口径：只有解锁那一次直开）。
    //
    // 🔴 2026-10-10 口径：第二步开战必须是 `CmdStartBattleReqMsg` 而不是通关 ——
    // 327 是**关卡**不是资源点，battleType 固定 1002（章节战斗类型，不是 configId 10001），
    // battleParams = [子类型, 章节id, cellId]（子类型 1 = 格子战斗，由 chapterCellBattleParams 组）。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [327]);
    assert.deepEqual(h.gatewayCalls.passedCells, [],
        '关卡绝不发通关请求（服务端会回「章节格子非资源类型」）');
    // 🔴 普通关（`mode = match`）：解锁成功 ⇒ 立刻交给匹配页；**领地不发**开战请求。
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页发（用户 2026-11-02 口径）');
    assert.deepEqual(h.battleParams[0], ['1', '1', '327'],
        'battleParams = [子类型(1=格子战斗), 章节id, cellId]');
    assert.equal(h.storeCalls.beginBattle, 1, '开战回包成功后进战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(327), true);
    assert.equal(h.presenter.state.progress?.isOwned(327), false);
    // 第二步：已解锁（建筑已展示）→ 点一下只弹关卡界面，窗里的「开始战斗」才发请求。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 点一下打开关卡界面');
    await flush();
    assert.equal(h.nav.length, 1, '★第二次点击不许再自动开战');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    assert.equal(h.nav.length, 2, '已解锁的关卡再按一次照旧进匹配');
    assert.deepEqual([...h.battleParams], [['1', '1', '327'], ['1', '1', '327']]);
    // 第三步：战斗已发起（fake 不真切场景）⇒ 再点 = 战斗未结算返回重打。
    // 🔴 2026-10-21 口径：`bossBattleStart` 不再参与防连点（防连点 = pending 判重 + loading），
    // 未通关格允许再次开战（打输 / 未打完可重打）。
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 1, '重打不夹带解锁请求');
    assert.equal(h.nav.length, 3, '开战后未通关可重打（再进一次匹配）');
});

test('two-step stage 327 skips the battle flow entirely (no detail, no start battle)', async () => {
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const h = createHarness({
        loader: createFakeLoader({ ...bundle, mapJson: publishedMap }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 327)!;
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.content?.startEnabled, undefined,
        '327 不进入详情面板，不存在开战按钮');
    // 请求开始战斗对 327 无效（detailSite/detailStage 均未设置）。
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.storeCalls.beginBattle, 0);
    assert.equal(h.nav.length, 0);
});

test('closeDetail closes the open panel', async () => {
    const h = createHarness();
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.closeDetail();
    assert.equal(h.presenter.state.detail.open, false);
});

test('a stage click hands the battle over to the matching page with the bound level', async () => {
    const h = createHarness({ gateway: createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [] },
    } }) });
    h.presenter.start();
    await flush();
    // 默认网关返回 unlockCells 已含 1 ⇒ 关卡处于已解锁态，点一下就是开战。
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    // 🔴 2026-11-02：普通关（`mode = match`）不再由领地发 `CmdStartBattleReqMsg` ——
    // 它先进匹配界面，请求由 `MatchingController` 带着 `battleParams` 发。
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页发');
    assert.equal(h.storeCalls.beginBattle, 1, '本地钱包照扣（银币 / 体力在领地里就扣）');
    assert.equal(h.nav.length, 1);
    assert.deepEqual(h.battleParams[0], ['1', '1', '1']);
    assert.equal(h.nav[0].levelId, 1001);
    assert.deepEqual(h.nav[0].enemyTeamCardIds, [[11]]);
    assert.equal(h.nav[0].enemyCardIds[0], 11);
});

test('server unlock rejection stops the stage unlock and shows a tip', async () => {
    const h = createHarness({
        gateway: createFakeGateway({
            fetch: {
                ok: true,
                state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
            },
            unlock: { ok: false, reason: 'rejected' },
        }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 0);
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.presenter.state.progress?.isCellUnlocked(h.presenter.state.map!.sites[0].cellId), false,
        '服务端拒绝 ⇒ 本地不记账');
    assert.equal(h.tips.length, 1);
    assert.equal(h.tips[0], '解锁失败，请稍后重试');
});

test('stage unlock network failure stops before battle (no local fail-open)', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        }, unlock: { ok: false, reason: 'offline' } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 0, '解锁没确认 ⇒ 不进战斗');
    assert.equal(h.gatewayCalls.startBattle, 0, '没解锁就不该发开战请求');
    assert.equal(h.tips.length, 1);
    assert.equal(h.tips[0], '解锁失败，请稍后重试');
});

test('local resource shortage blocks the stage before any request', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0], passCells: [0] },
        } }),
        store: createFakeStore({ silver: 0 }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 0, '银币不足 ⇒ 不该先发解锁白试一趟');
    assert.equal(h.gatewayCalls.startBattle, 0);
    assert.equal(h.nav.length, 0);
    assert.equal(h.tips[0], '银币不足');
});

test('★★★异步据点全没通也算通关（它根本不进关卡链）', async () => {
    const loader = createFakeLoader();
    const stages = [
        { ...stage, levelId: 1001, stage: 1 },
        { ...stage, levelId: 1002, stage: 2, isBoss: true, mode: 'defence' as const },
    ];
    loader.loader.load = async (chapterId) => ({
        ...bundle,
        campaign: { ...bundle.campaign, stages },
        mapJson: { ...mapJson, chapterId, sites: [
            { id: 'stage_1', type: 'stage', cellId: 1, footprint: [1], configId: '1001' },
            { id: 'boss_2', type: 'boss', cellId: 3, footprint: [3], configId: '1002' },
            // 异步据点：解锁都没解，`unlockCells` 与 `passCells` 里都没有它。
            { id: 'async_3', type: 'asyncPvp', cellId: 4, footprint: [4], configId: '20001' },
        ] },
    });
    const h = createHarness({ loader, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.hud?.nextEnabled, false);
    h.presenter.applyPassCellsBro(1, [3]);
    await flush();
    assert.equal(h.presenter.state.chapterId, 2,
        '异步据点没通不该拦住通关 —— 拿打不了的格子当门槛会把这一章锁死');
    h.presenter.dispose();
});

test('battle return advances a newly completed chapter but manual review stays in that chapter', async () => {
    const loader = createFakeLoader();
    loader.loader.load = async (chapterId) => ({ ...bundle, mapJson: { ...mapJson, chapterId } });
    const gateway = createFakeGateway();
    gateway.gateway.fetchChapterCells = async (chapterId) => ({ ok: true, state: {
        levelChapter: chapterId, rewardState: 0, unlockCells: [1], passCells: chapterId === 1 ? [1] : [],
    } });
    const h = createHarness({ loader, gateway, chapters: [1, 2] });
    h.presenter.start();
    await flush();
    assert.equal(h.presenter.state.chapterId, 2, 'fresh return snapshot should advance automatically');
    h.presenter.switchChapter(-1);
    await flush();
    assert.equal(h.presenter.state.chapterId, 1, 'manual review must not immediately advance');
    h.presenter.applyPassCellsBro(1, [1]);
    await flush();
    assert.equal(h.presenter.state.chapterId, 1, 'duplicate completion must not advance');
    h.presenter.dispose();
});

test('boss site unlocks and starts the battle on the first click, later clicks send CmdStartBattleReqMsg from the panel', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0, 1] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    assert.equal(site.type, 'boss');
    // 第一步：未解锁 → **解锁 + 立刻开战**（2026-10-29 口径：只有解锁那一次直开）。
    h.presenter.selectSite(site);
    assert.equal(h.presenter.state.detail.levelInfo, null, '首次解锁直开 ⇒ 不弹「关卡界面」');
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [2]);
    assert.deepEqual(h.gatewayCalls.passedCells, [], 'Boss 关不再发 CmdCityChapterPassCellReqMsg');
    assert.equal(h.gatewayCalls.startBattle, 1, '解锁成功 ⇒ 立刻发 CmdStartBattleReqMsg');
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType = 章节战斗类型 1002（2026-10-10 口径）—— 不是 site.configId（这里是 10005），'
        + '关卡身份由 battleParams 的格子id 定位（battleParams = [子类型, 章节id, 格子id]）');
    assert.deepEqual(h.gatewayCalls.battleParamsList, [['1', '1', '2']],
        'battleParams = [子类型(1=格子战斗), 章节id, cellid] —— 子类型占下标 0');
    assert.equal(h.storeCalls.beginBattle, 1, '战斗信息成功后进入战斗');
    assert.equal(h.nav.length, 1);
    assert.equal(h.nav[0].levelId, 10005);
    assert.equal(h.nav[0].territoryCellId, 2);
    assert.equal(h.nav[0].mode, 'defence');
    assert.equal(h.presenter.lastBossBattleStart?.battleId, 'b-10005');
    assert.equal(h.presenter.lastBossBattleStart?.seed, '42');
    assert.equal(h.presenter.state.progress?.isOwned(2), false, '开战不改变占领态');
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    // 第二步：已解锁 → 点一下弹界面，窗里「开始战斗」发 CmdStartBattleReqMsg。
    h.presenter.selectSite(site);
    assert.ok(h.presenter.state.detail.levelInfo, '已解锁 ⇒ 打开「关卡界面」');
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1, '★第二次点击不许再自动开战');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 2);
    assert.equal(h.gatewayCalls.unlock, 1, '开战阶段不再重复解锁');
    // 第三步：已通关仍可重复挑战，不重新解锁。
    h.presenter.state.progress?.markCellPassed(2);
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 3);
    assert.equal(h.gatewayCalls.unlock, 1);
});

test('asyncPvp sites sharing configId unlock independently then start their configured battle', async () => {
    const asyncStage: TerritoryCampaignStage = { ...stage, levelId: 20001, stage: 4 };
    const asyncPvpMap = {
        ...mapJson,
        rows: 20,
        columns: 20,
        startCellId: 367,
        sites: [372, 373, 392].map((cellId) => ({
            id: `asyncPvp_${cellId}`,
            type: 'asyncPvp',
            cellId,
            footprint: [cellId],
            configId: '20001',
            unlock: { requiredCells: [367], silverCost: 10, staminaCost: 1 },
        })),
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncPvpMap,
            campaign: { stages: [stage, asyncStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    const sites = h.presenter.state.map!.sites;
    assert.deepEqual(sites.map((site) => site.configId), ['20001', '20001', '20001']);

    for (const site of sites) {
        h.presenter.selectSite(site);
        await flush();
        assert.equal(h.presenter.state.detail.playerStage, null, '首次点击只解锁，不弹详情');
        assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡弹窗不用关卡界面内容');
        assert.equal(h.presenter.state.progress?.isCellUnlocked(site.cellId), true,
            `cellId ${site.cellId} 应独立记为已解锁`);
    }

    assert.deepEqual(h.gatewayCalls.unlockedCells, [372, 373, 392]);
    assert.deepEqual(h.gatewayCalls.passedCells, [], '异步关卡解锁不走资源点通关接口');
    // 2026-11-11 用户「触发异步据点也是直接进入战斗」：解锁那一次就 `beginBattle`
    // （mode = match ⇒ 请求交给匹配页，领地侧 `startBattle` 仍为 0），不再弹「已解锁」提示。
    assert.equal(h.gatewayCalls.startBattle, 0, 'mode = match：请求交给匹配页，领地侧不发');
    assert.deepEqual(h.tips, [], '解锁即直开，不再提示「已解锁，点击查看关卡」');
    assert.equal(h.storeCalls.beginBattle, 3, '三格各自解锁即开战（2026-11-11 口径）');

    h.presenter.selectSite(sites[0]);
    await flush();
    assert.ok(h.presenter.state.detail.playerStage, '已解锁后再次点击仍弹玩家关卡详情（侦查面板保留）');
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.unlock, 3, '已解锁的异步格再次点击不重复请求解锁');
    // asyncPvp 也是走匹配（`mode = match`）⇒ 请求交给匹配页，领地这一侧不发。
    assert.equal(h.gatewayCalls.startBattle, 0, '请求交给匹配页发');
    // 🔴 asyncPvp 子类型按**通关状态**分流（山猫 2026-10-21 细化）：未通关首次挑战 = 格子
    // 战斗子类型 1（`chapterCellBattleParams`）；已通关重复挑战才切宝箱战斗子类型 2。
    // 372 在这里只解锁没通关 ⇒ 子类型 1（服务端按 0 位分流，打过的格传 2 会回「配置错误」）。
    assert.deepEqual(h.battleParams[0], ['1', '1', '372']);
    assert.equal(h.storeCalls.beginBattle, 4, '三格解锁直开 + 372 面板按钮再开一次');
    assert.equal(h.nav[0]?.levelId, 20001, '开战应使用 levelInfo.json 中的 20001');
    assert.equal(h.nav[0]?.territoryCellId, 372);
    assert.deepEqual(h.gatewayCalls.passedCells, [], '异步战斗不走资源点通关接口');
});

test('boss site already unlocked starts battle on click without unlock', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    assert.equal(h.presenter.state.progress?.isCellUnlocked(2), true);
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.gatewayCalls.unlock, 0, '已解锁不再请求解锁');
    assert.equal(h.storeCalls.beginBattle, 1);
    assert.deepEqual(h.gatewayCalls.battleTypes, [1002],
        'battleType = 章节战斗类型 1002（2026-10-10 口径），不是 site.configId');
});

test('boss start battle failure shows a tip and does not enter battle', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [stage, bossStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({
            fetch: {
                ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
            },
            start: { ok: false, reason: 'failed' },
        }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.cellId === 2)!;
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.gatewayCalls.startBattle, 1);
    assert.equal(h.storeCalls.beginBattle, 0, '请求失败不进战斗');
    assert.equal(h.nav.length, 0);
    assert.match(h.tips[h.tips.length - 1], /开战失败/);
    assert.equal(h.presenter.lastBossBattleStart, null);
});

test('chapter start forwards the complete server battle to navigation', async () => {
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss: true, mode: 'defence' }] },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    h.presenter.requestBattle();
    await flush();
    assert.equal(h.nav.length, 1);
    assert.deepEqual(h.battles[0], fakeBattleStart);
});

test('territory page sends entry intent while composition supplies battle and captured account', () => {
    const page = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    const entry = readFileSync('assets/script/app/territory/application/TerritoryEntry.ts', 'utf8');
    assert.match(page, /kind: 'enterBattle', payload: nav.payload/);
    assert.doesNotMatch(page, /ProcedureManager\.navigate\(GameRoute\.Battle/);
    assert.match(entry, /battle: payload.battle/);
    assert.match(entry, /selfRoleId: this\.saveOwner\?\.roleId/);
});

test('chapter start takes one write at a time: repeat taps and other sites are ignored', async () => {
    const gateway = createFakeGateway({ fetch: {
        ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
    } });
    const pending: Array<(value: TerritoryStartBattleResult) => void> = [];
    gateway.gateway.startBattle = () => {
        gateway.calls.startBattle++;
        return new Promise(resolve => pending.push(resolve));
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            campaign: { ...bundle.campaign, stages: [{ ...stage, isBoss: true, mode: 'defence' }] },
        }),
        gateway,
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites[0];
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    h.presenter.selectSite(site);
    h.presenter.requestBattle();
    assert.equal(gateway.calls.startBattle, 1, '★重复点击只发一次开战');
    // 🔴 2026-11-19 入口单飞：开战在途期间**换格也不受理**。换格会换交互号 ⇒
    // 这条开战回包被当成过期丢掉 ⇒ 过场干等 3 秒再退回领地。
    assert.equal(h.presenter.selectSite(h.presenter.state.map!.sites[1]), false,
        '★开战在途 ⇒ 别的格不受理');
    h.presenter.requestBattle();
    assert.equal(gateway.calls.startBattle, 1, '不受理 ⇒ 不会插第二条开战');
    pending[0]({ ok: true, battle: fakeBattleStart });
    await flush();
    assert.equal(h.nav.length, 1, '★回包没被作废 ⇒ 这一格的开战照常落地');
    assert.equal(h.storeCalls.beginBattle, 1);
});

test('unconfirmed chapter battle remains pending after returning to territory', async () => {
    const h = createHarness({
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1], passCells: [0] },
        } }),
        store: createFakeStore({ battle: {
            chapterId: 1, cellId: 1, levelId: 1001, status: 'pending', startedAt: Date.now(),
        } }),
    });
    h.presenter.start();
    await flush();
    assert.equal(h.storeCalls.clearBattle, 0);
    assert.equal(h.presenter.state.progress?.isOwned(1), false);
});

test('★★★★真机口径：只打通 328，点 309 解锁后必须立刻发开战协议', async () => {
    // 山猫 2026-10-15 真机：cellId 309（关卡 2、有建筑 69004）点下去**一个协议都不发**，
    // 只弹「前置领地尚未占领」。根因见 `territory-progress.test.ts` 同名主题那条：
    // 309 的前置要求 327/328（同 configId=10001）**各通关一次**，而 327 无建筑永远 owned 不了。
    const publishedMap = JSON.parse(readFileSync(
        assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
    const stages: TerritoryCampaignStage[] = [
        { ...stage, levelId: 10001, stage: 1 },
        { ...stage, levelId: 10002, stage: 2 },
    ];
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: publishedMap,
            campaign: { stages, playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0,
                unlockCells: [347, 348, 327, 328, 308, 329], passCells: [367, 328] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((s) => s.cellId === 309)!;
    assert.equal(site.type, 'stage');
    assert.equal(site.buildingId, '69004', '309 就是真机点的那格（有建筑）');
    assert.ok(h.presenter.state.revealedCells.includes(309), '309 已揭示（玩家看得见）');
    // 2026-10-29 口径：未解锁点一下 = 解锁 → **立刻开战**（不再停在「已解锁，点击查看关卡」）。
    h.presenter.selectSite(site);
    await flush();
    assert.deepEqual(h.gatewayCalls.unlockedCells, [309],
        '★必须发 CmdCityChapterPassCellReqMsg 类解锁请求 —— 曾经这里是 0 次请求');
    assert.ok(!h.tips.includes('前置领地尚未占领'), '不能再被前置判定挡住');
    // 普通关（`mode = match`）⇒ 解锁成功立刻交出去，但**请求由匹配页发**。
    assert.equal(h.gatewayCalls.startBattle, 0, '★请求交给匹配页（领地这一侧一个开战协议都不发）');
    assert.deepEqual(h.battleParams[0], ['1', '1', '309'], '★但要立刻交出去 —— 以前这里是 0 次 navigate');
    assert.equal(h.nav.length, 1, '★解锁即开战 ⇒ 直接进匹配');
    assert.equal(h.presenter.state.detail.levelInfo, null, '中途不弹关卡界面');
    assert.ok(!h.tips.includes('已解锁，点击查看关卡'), '直开路径没有「已解锁」这一步提示');
});

test('★异步据点点击弹「玩家关卡」弹窗：标题/占领奖励/双按钮费用全部来自配置，只弹窗不发请求', async () => {
    const rewardStage: TerritoryCampaignStage = {
        ...asyncRepeatStage,
        idleRewards: [
            { resId: 7, name: '银币', amount: 75, probability: 10000 },
            { resId: 16014, name: '天赋石', amount: 8, probability: 10000 },
            { resId: 16015, name: '抽不到的占位', amount: 0, probability: 0 },
            { resId: 12, name: '卷轴', amount: 8, probability: 600 },
        ],
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: asyncRepeatMap,
            campaign: { stages: [stage, rewardStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [367, 372], passCells: [367] },
        } }),
    });
    h.presenter.start();
    await flush();
    h.presenter.selectSite(h.presenter.state.map!.sites[0]);
    await flush();

    const content = h.presenter.state.detail.playerStage;
    assert.ok(content, '异步据点必须产出玩家关卡弹窗内容');
    assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡不走关卡界面');
    assert.equal(h.presenter.state.detail.levelInfo, null, '玩家关卡不走关卡界面');
    assert.equal(content.title, '异步据点', '服务端不下发对手昵称，标题先写据点类型');
    assert.equal(content.chestText, '获得 1 个卡牌宝箱');
    // 概率 0 的空位必须被过滤掉 —— 展示出来等于骗玩家「可能拿到」
    assert.deepEqual(content.rewards,
        [{ resId: 7, amount: 75 }, { resId: 16014, amount: 8 }, { resId: 12, amount: 8 }],
        '按概率过滤空位、最多 3 格、顺序照配置表');
    assert.equal(content.scoutCost, 10, '侦查 = 设计稿 10 体力（服务端暂无配置）');
    assert.equal(content.fightCost, 5, '开战 = 关卡配置的体力（levelInfo.levelCost），不再读解锁银币价');
    assert.equal(content.fightCaption, '开始战斗');
    assert.equal(content.fightEnabled, true);
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不发开战请求');
    assert.equal(h.gatewayCalls.unlock, 0, '只弹窗，也不发解锁请求');

    h.presenter.closeDetail();
    await flush();
    assert.equal(h.presenter.state.detail.playerStage, null, '关掉弹窗后内容清空');
    assert.equal(h.presenter.state.detail.open, false);
});

test('★点关卡/首领弹「关卡界面」：占据奖励取硬币、掉落取其余道具、推荐留空；感叹号开关关卡提示', async () => {
    const levelStage: TerritoryCampaignStage = {
        ...stage,
        levelId: 10005, // 与 bossMap 的 boss 站点 configId 对齐（否则绑不到 stage ⇒ 退回未绑定分支）
        stage: 2,
        isBoss: true,
        staminaCost: 10,
        enemies: [
            { cardId: 101, pvpCardId: 11, name: '食人花', level: 3, headIcon: 'icons/card/a', description: '无法阻拦' },
            { cardId: 102, pvpCardId: 12, name: '金发老板', level: 3, headIcon: 'icons/card/b', description: '' },
        ],
        idleRewards: [
            // 硬币（resId 7）= 占据奖励，不进掉落
            { resId: 7, name: '硬币', amount: 6, probability: 10000 },
            { resId: 10012, name: '卷轴', amount: 8, probability: 10000 },
            { resId: 10011, name: '项圈', amount: 8, probability: 600 },
            // 概率 0 的空位不该出现在掉落里
            { resId: 16014, name: '天赋石', amount: 1, probability: 0 },
        ],
    };
    const h = createHarness({
        loader: createFakeLoader({
            ...bundle,
            mapJson: bossMap,
            campaign: { stages: [levelStage], playerCardCount: 3, idleRewardMaxHours: 8, levelAutoStart: true },
        }),
        gateway: createFakeGateway({ fetch: {
            ok: true, state: { levelChapter: 1, rewardState: 0, unlockCells: [0, 1, 2], passCells: [0] },
        } }),
    });
    h.presenter.start();
    await flush();
    const site = h.presenter.state.map!.sites.find((entry) => entry.type === 'boss')!;
    h.presenter.selectSite(site);
    await flush();

    const info = h.presenter.state.detail.levelInfo;
    assert.ok(info, '关卡/首领点击后必须产出关卡界面内容');
    assert.equal(h.presenter.state.detail.levelTip, null, '关卡提示默认不开');
    assert.equal(info!.title, '首领关卡  2');
    assert.equal(info!.hasTip, true, '有敌军 ⇒ 显示感叹号入口');
    assert.equal(info!.objective, '第一名成功通过关卡');
    assert.equal(info!.occupy, '【征收】+6 硬币', '占据奖励只取硬币那条');
    assert.deepEqual(info!.drops.map((d) => [d.resId, d.amount]), [[10012, 8], [10011, 8]],
        '掉落 = 其余带概率的奖励（硬币剔除、概率 0 的空位剔除）');
    assert.equal(info!.recommend, '', '推荐卡牌没有数据源 ⇒ 空串（视图整行隐藏）');
    assert.equal(info!.fightCaption.length > 0, true);
    assert.equal(info!.staminaCost, 10);
    assert.equal(h.gatewayCalls.startBattle, 0, '只弹窗，不开战');

    // 感叹号 → 关卡提示（标题与关卡界面一致，敌军前 3 张，描述拼非空项）
    h.presenter.openLevelTip();
    await flush();
    const tip = h.presenter.state.detail.levelTip;
    assert.ok(tip, '感叹号必须能打开关卡提示');
    assert.equal(tip!.title, '首领关卡  2');
    assert.deepEqual(tip!.enemies.map((e) => e.name), ['食人花 Lv.3', '金发老板 Lv.3']);
    assert.equal(tip!.description, '无法阻拦', '空描述不参与拼接');

    // 关提示只收提示，关卡界面还在
    h.presenter.closeLevelTip();
    await flush();
    assert.equal(h.presenter.state.detail.levelTip, null);
    assert.ok(h.presenter.state.detail.levelInfo, '关卡界面不受影响');

    // 关详情把两层一起收掉
    h.presenter.openLevelTip();
    await flush();
    h.presenter.closeDetail();
    await flush();
    assert.equal(h.presenter.state.detail.levelInfo, null);
    assert.equal(h.presenter.state.detail.levelTip, null);
});
