import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { normalizeTerritoryMap } from '../tools/map-editor/formats/territory-format.js';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import { territoryRevealedCells } from '../assets/script/app/territory/model/TerritoryCellReveal';
import { isTerritoryChestActionable } from '../assets/script/app/territory/application/TerritoryViewState';
import { bindTerritoryPatrolStages } from '../assets/script/app/territory/model/TerritoryStageBinding';
import { chapterCellBattleParams } from '../assets/script/app/battle/BattleStartModel';
import { territoryPatrolAnchorCell } from '../assets/script/app/territory/model/TerritoryMonsterPatrol';
import { TERRITORY_SITE_TYPE } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { territoryChestHintCell, territoryChestShowsHint } from '../assets/script/app/territory/model/TerritoryChestHint';
import { loadTerritoryMapViewClass, stationRenderWithProjection } from './helpers/territory-map-view-sandbox';

function patrolMap(battleId: unknown = 10002) {
    return {
        version: 1, mapKind: 'territoryChapter', id: 'patrol_test', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {},
        sites: [{ id: 'patrol_1', type: 'patrolChest', cellId: 1, battleId }],
    };
}

test('巡逻宝箱的战斗 ID 是单值：编辑器和客户端解析后都原样保留', () => {
    for (const battleId of [10001, 10002]) {
        const input = patrolMap(battleId);
        const normalized = normalizeTerritoryMap(input).map;
        assert.equal(normalized.sites[0].battleId, battleId);
        const config = configureTerritoryMap(normalized);
        assert.equal(config.sites[0].type, 'patrolChest');
        assert.equal(config.sites[0].battleId, battleId);
    }
});

test('巡逻宝箱保存边界拒绝缺失、非法值和旧数组字段', () => {
    // 注意别把 `undefined` 传进工厂：默认参数会替成 10002，测不到「缺失」——缺失由下面 `delete` 那条覆盖。
    for (const battleId of [null, 0, -1, 1.5, '10001', true, Number.MAX_SAFE_INTEGER + 1]) {
        const input = patrolMap(battleId);
        assert.throws(() => normalizeTerritoryMap(input), /battleId/);
        assert.throws(() => configureTerritoryMap(input), /battleId/);
    }
    const missing = patrolMap();
    delete missing.sites[0].battleId;
    assert.throws(() => normalizeTerritoryMap(missing), /battleId/);
    assert.throws(() => configureTerritoryMap(missing), /battleId/);
    // 旧的数组字段直接判错，别让它悄悄退回「按下标摊分」那套。
    const legacy = patrolMap();
    legacy.sites[0].battleIds = [10001];
    assert.throws(() => normalizeTerritoryMap(legacy), /deprecated/);
    assert.throws(() => configureTerritoryMap(legacy), /deprecated/);
});

test('普通站点不能误带巡逻战斗字段', () => {
    const input = patrolMap();
    input.sites[0].type = 'stage';
    assert.throws(() => normalizeTerritoryMap(input), /only valid for patrolChest/);
    assert.throws(() => configureTerritoryMap(input), /only valid for patrolChest/);
});

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');

test('野怪巡逻 ID 在编辑器和客户端解析中保留，旧地图仍可省略', () => {
    const input = patrolMap();
    Object.assign(input.sites[0], { patrolId: 60001 });
    const normalized = normalizeTerritoryMap(input).map;
    assert.equal(normalized.sites[0].patrolId, 60001);
    assert.equal(configureTerritoryMap(normalized).sites[0].patrolId, 60001);
    assert.equal(configureTerritoryMap(patrolMap()).sites[0].patrolId, undefined);
    for (const patrolId of [0, -1, 1.5, '60001', true, null, Number.MAX_SAFE_INTEGER + 1]) {
        Object.assign(input.sites[0], { patrolId });
        assert.throws(() => normalizeTerritoryMap(input), /patrolId/);
        assert.throws(() => configureTerritoryMap(input), /patrolId/);
    }
    Object.assign(input.sites[0], { type: 'stage', patrolId: 60001 });
    delete input.sites[0].battleId;
    assert.throws(() => normalizeTerritoryMap(input), /patrolId/);
    assert.throws(() => configureTerritoryMap(input), /patrolId/);
});

test('野怪巡逻 ID 输入可按格修改及清空，非法值不覆盖原配置', () => {
    const sites = [{ type: 'patrolChest', cellId: 1, patrolId: 60001 }, { type: 'patrolChest', cellId: 2 }];
    const field = { value: '60002', focus() {} };
    const context = {
        map: { sites }, selectedCell: 1, $: () => field,
        commits: 0, commit() { context.commits += 1; }, markErrorsStale() {}, message() {},
    };
    const functions = ['siteAtCell', 'readPatrolId', 'applyPatrolIdFromForm'].map((name) => {
        const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    });
    const apply = runInNewContext(`${functions.join('\n')}; applyPatrolIdFromForm`, context) as () => boolean;
    assert.equal(apply(), true);
    assert.equal(sites[0].patrolId, 60002);
    apply();
    assert.equal(context.commits, 1);
    for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
        field.value = value;
        assert.equal(apply(), false);
        assert.equal(sites[0].patrolId, 60002);
    }
    context.selectedCell = 2;
    field.value = '60003';
    assert.equal(apply(), true);
    assert.equal(sites[1].patrolId, 60003);
    context.selectedCell = 1;
    field.value = '';
    assert.equal(apply(), true);
    assert.equal('patrolId' in sites[0], false);
    assert.equal(sites[1].patrolId, 60003);
});

function patrolEditor() {
    const sites = [
        { id: 'patrol_1', type: 'patrolChest', cellId: 1, battleId: 10001 },
        { id: 'patrol_2', type: 'patrolChest', cellId: 2 },
        { id: 'stage_3', type: 'stage', cellId: 3 },
    ];
    const field = { value: '', focused: false, focus() { this.focused = true; } };
    const context = {
        map: { sites }, selectedCell: 1, $: () => field,
        commits: 0, commit() { context.commits += 1; }, markErrorsStale() {}, message() {},
    };
    const functions = ['siteAtCell', 'readPatrolBattleId', 'applyPatrolBattleIdFromForm'].map((name) => {
        const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    });
    const apply = runInNewContext(`${functions.join('\n')}; applyPatrolBattleIdFromForm`, context) as () => boolean;
    return { sites, field, context, apply };
}

test('巡逻战斗 ID 按格独立提交单值，非法值不覆盖已有配置，相同值不新增撤销', () => {
    const editor = patrolEditor();
    editor.field.value = '10002';
    assert.equal(editor.apply(), true);
    assert.equal(editor.sites[0].battleId, 10002);
    assert.equal(editor.context.commits, 1);
    editor.apply();
    assert.equal(editor.context.commits, 1);
    for (const input of ['0', '-1', '2.5', 'abc', '10001,10002']) {
        editor.field.value = input;
        assert.equal(editor.apply(), false, input);
        assert.equal(editor.sites[0].battleId, 10002);
    }
    editor.context.selectedCell = 2;
    editor.field.value = '20001';
    assert.equal(editor.apply(), true);
    assert.equal(editor.sites[1].battleId, 20001);
    editor.context.selectedCell = 3;
    editor.field.value = 'invalid';
    assert.equal(editor.apply(), true);
    assert.equal('battleId' in editor.sites[2], false);
});


test('新绘制的巡逻宝箱可以留空继续编辑，保存由格式校验拦截', () => {
    const editor = patrolEditor();
    editor.context.selectedCell = 2;
    assert.equal(editor.apply(), true);
    assert.equal(editor.context.commits, 0);
});

test('巡逻宝箱的工具、表单及保存入口接通', () => {
    const html = readFileSync('tools/map-editor/territory.html', 'utf8');
    assert.match(html, /data-mode="patrolChest"/);
    assert.match(html, /option value="patrolChest"/);
    assert.match(html, /id="battleId"/);
    assert.match(html, /id="patrolId"/);
    assert.match(source, /if \(!applyPatrolIdFromForm\(\)\) return;/);
    assert.match(source, /if \(!applyPatrolIdFromForm\(\)\) throw/);
    assert.match(source, /\$\('patrolId'\)\.addEventListener\('change', applyPatrolIdFromForm\)/);
    assert.match(source, /function paint\([^\n]+\{[\s\S]*?if \(!applyPatrolBattleIdFromForm\(\)\) return;/);
    assert.match(source, /function buildJSON\(\) \{[\s\S]*?if \(!applyPatrolBattleIdFromForm\(\)\) throw/);
    assert.match(source, /\$\('battleId'\)\.addEventListener\('change', applyPatrolBattleIdFromForm\)/);
});

// ============================================================
// 运行时：巡逻宝箱与固定据点同一条「解锁 → 领取」（2026-11-18）
//
// 山猫实机报「章节 1 这几个格子点不动，理论上是配置的巡逻宝箱」：
// 编辑器里能画成 `patrolChest`，但 `selectSite` / `stationRenderOf` 只认
// `fixedResource` ⇒ 巡逻格既不解锁也不领取，也没有宝箱外观。
// 口径（2026-11-17 定）：**巡逻宝箱仍走「解锁 → 探索 → 占点领奖」**，
// `battleId` 只决定巡逻野怪的生灭，不发开战。
// ============================================================

function chestMap() {
    return configureTerritoryMap({
        version: 1, mapKind: 'territoryChapter', id: 'patrol_runtime', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {},
        sites: [
            { id: 'fixedResource_1', type: 'fixedResource', cellId: 1, rewardId: 1016 },
            { id: 'patrolChest_2', type: 'patrolChest', cellId: 2, battleId: 60001 },
        ],
    });
}

test('巡逻宝箱点下去要能推进 tileFlipped：可翻地、可点开、领取后不可点', () => {
    const map = chestMap();
    const locked = { isCellUnlocked: () => false, isOwned: () => false };
    assert.equal(isTerritoryChestActionable({ map, progress: locked, siteOpenableCells: [2] }, 2), true,
        '还没翻出来 ⇒ 第一下算「翻一格」');
    assert.equal(isTerritoryChestActionable({
        map,
        progress: { isCellUnlocked: (cellId: number) => cellId === 2, isOwned: () => false },
        siteOpenableCells: [],
    }, 2), false, '巡逻宝箱详情点击不算翻格');
    assert.equal(isTerritoryChestActionable({
        map,
        progress: { isCellUnlocked: (cellId: number) => cellId === 1, isOwned: () => false },
        siteOpenableCells: [],
    }, 1), true, '普通宝箱第二下仍是「打开宝箱」（口径不变）');
    assert.equal(isTerritoryChestActionable({
        map,
        progress: { isCellUnlocked: () => true, isOwned: (cellId: number) => cellId === 2 },
        siteOpenableCells: [],
    }, 2), false, '已领取不再可操作（否则会重复发通关请求）');
    assert.equal(isTerritoryChestActionable({ map, progress: locked, siteOpenableCells: [1, 2] }, 1), true,
        '固定据点口径不变');
});

test('野怪宝箱不画宝箱外观：只留地块状态色 + 未解锁价格，普通宝箱照旧', () => {
    const map = chestMap();
    const view = new (loadTerritoryMapViewClass())();
    const render = stationRenderWithProjection(view);
    const patrol = map.sites.find(one => one.type === 'patrolChest');
    const fixed = map.sites.find(one => one.type === 'fixedResource');
    assert.ok(patrol && fixed, '夹具要同时有野怪宝箱与普通宝箱');
    const base = {
        map,
        stageByCell: new Map(),
        siteOpenableCells: [patrol.cellId, fixed.cellId],
        pendingFixedResourceCells: [],
        wallet: { silver: 100, stamina: 100 },
        progress: {
            isCellUnlocked: () => false, isOwned: () => false, isAreaPassed: () => false,
            isDisabled: () => false, explorationAt: () => null, checkUnlock: () => ({ ok: true }),
        },
        art: { chestIcon: 'chest-icon', randomSilverIcon: 'silver-icon', fixedResource: 'chest-frame' },
    };

    // ① 未解锁：只留银币价，价格行上方**不长**宝箱小图标。
    const locked = render(patrol, base);
    assert.equal(locked.isCondition, true, '前置满足 ⇒ 走「可激活」条件分支');
    assert.equal(locked.conditionChestIcon, null, '野怪宝箱不许长宝箱小图标');
    assert.equal(locked.caption, '10', '未解锁仍显示银币价（地块状态之外的唯一数字）');
    assert.equal(locked.icon, null, '未解锁不画建筑');

    // ② 已解锁未占点：不画宝箱模型、不挂体力气泡 —— 露出野怪在那巡逻。
    const opened = render(patrol, {
        ...base,
        siteOpenableCells: [],
        progress: { ...base.progress, isCellUnlocked: (cellId: number) => cellId === patrol.cellId },
    });
    assert.equal(opened.icon, null, '野怪宝箱不许展示宝箱模型/图标');
    assert.equal(opened.levelBubble, undefined, '也不挂体力气泡（第二下是开战，不是开箱）');
    assert.equal(opened.caption, '', '已解锁不再显示价格');
    assert.equal(opened.interactive, true, '已解锁仍要能点（点下去开战）');

    // ③ 已占点：不画宝箱，靠「已通关」绿色地块 + 不可点表达。
    const owned = render(patrol, {
        ...base,
        siteOpenableCells: [],
        progress: { ...base.progress, isCellUnlocked: (cellId: number) => cellId === patrol.cellId,
            isOwned: (cellId: number) => cellId === patrol.cellId },
    });
    assert.equal(owned.icon, null, '占点后同样没有宝箱图');
    assert.equal(owned.interactive, false, '已占点不再开战');

    // ④ 对照组：普通宝箱的外观一个字没变。
    const fixedLocked = render(fixed, base);
    assert.equal(fixedLocked.conditionChestIcon, 'chest-icon', '普通宝箱仍要宝箱小图标');
    const fixedOpened = render(fixed, {
        ...base,
        siteOpenableCells: [],
        progress: { ...base.progress, isCellUnlocked: (cellId: number) => cellId === fixed.cellId },
    }, fixed.cellId);
    assert.equal(fixedOpened.icon, 'chest-frame', '普通宝箱已翻出仍是宝箱图');
    assert.equal(fixedOpened.levelBubble, String(fixed.unlock.staminaCost),
        '普通宝箱仍挂体力气泡（同屏唯一那只就是它）');
});

test('章节 1 起始格旁那 4 格巡逻宝箱，前置 347 一解锁就算可操作', () => {
    const source = JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const map = configureTerritoryMap(source);
    const progress = new TerritoryProgress(map);
    // 起始格 367 → 348 → 347：巡逻组 `patrolChest_155` 的前置就是 347。
    progress.markCellsUnlocked([367, 348, 347]);
    const revealed = territoryRevealedCells(map, progress);
    const patrolCells = map.sites
        .filter(site => site.type === 'patrolChest' && site.unlock.requiredCells.includes(347))
        .map(site => site.cellId);
    assert.deepEqual(patrolCells.slice().sort((a, b) => a - b), [346, 366, 368, 387],
        '配置真源：这一片就是 346/366/368/387（截图里围着起始格的 4 个「10」）');
    for (const cellId of patrolCells) {
        assert.ok(revealed.includes(cellId), `cell ${cellId} 应随前置 347 一起揭示`);
    }
    assert.equal(isTerritoryChestActionable({ map, progress, siteOpenableCells: patrolCells }, 346), true,
        '前置满足后点下去要能翻地，而不是静默 return');
});

test('固定据点点击仍走 unlock → passCell', () => {
    const model = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    assert.match(model,
        /if \(isTerritoryChestSite\(site\)\) \{[\s\S]{0,300}?handleUnlockThenPass\(site, FIXED_RESOURCE_TWO_STEP_TEXTS\)/,
        '固定资源据点仍是「解锁 → 探索 → 领奖」');
    assert.doesNotMatch(model, /site\.type === TERRITORY_SITE_TYPE\.fixedResource/,
        '宝箱判定不许退回「只认 fixedResource」—— 那正是这几个格子点不动的根因');
});

test('巡逻宝箱按 battleId 绑关卡行，同片每格共享同一个 stage', () => {
    const map = configureTerritoryMap(JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8')));
    const battleIds = Array.from(new Set(map.sites
        .filter((site) => site.type === 'patrolChest')
        .map((site) => site.battleId as number)));
    assert.deepEqual(battleIds.slice().sort((a, b) => a - b), [1001, 1002, 1003, 1004, 1005],
        '五片巡逻区各一个战斗 ID');
    // 这里只验「battleId → 关卡行」的映射，不读真实 levelInfo：battleId 指向哪张表由策划配，
    // 只要同片每格都绑到同一行即可（真实表里有没有这一行由发布前校验兜）。
    const stages = battleIds.map((levelId) => ({
        levelId, stage: 0, mode: 'defence', staminaCost: 1,
    }));
    const bindings = bindTerritoryPatrolStages(map.sites, stages as never);
    const byCell = new Map(bindings.map((binding) => [binding.site.cellId, binding.stage.levelId]));
    assert.deepEqual([346, 366, 368, 387].map((cellId) => byCell.get(cellId)),
        [1001, 1001, 1001, 1001],
        '同片共用一个 battleId，每格都要有绑定（不能只绑锚点格）');
    assert.equal(bindings.every((binding) => binding.site.type === 'patrolChest'), true,
        '本函数只绑巡逻宝箱，不混主线关卡');
    assert.equal(bindings.length, map.sites.filter((site) => site.type === 'patrolChest').length,
        '每个巡逻格都要绑上（否则那格点了只会提示配置待补齐）');
});

test('同屏唯一的宝箱气泡只给普通宝箱，野怪宝箱不抢', () => {
    const map = chestMap();
    const patrol = map.sites.find(one => one.type === 'patrolChest');
    const fixed = map.sites.find(one => one.type === 'fixedResource');
    assert.ok(patrol && fixed);
    const unlocked = { isCellUnlocked: () => true, isOwned: () => false };
    assert.equal(territoryChestShowsHint(patrol, unlocked), false, '野怪宝箱不挂体力气泡');
    assert.equal(territoryChestShowsHint(fixed, unlocked), true, '普通宝箱仍要挂');
    assert.equal(territoryChestHintCell(map.sites, unlocked, map.sites.map(one => one.cellId)),
        fixed.cellId, '同屏唯一那只必须落在普通宝箱上');
});

// ============================================================
// 编辑器：按「一片巡逻区」分组 / 批量同步战斗 ID（2026-11-18）
// ============================================================

function editorSandbox(sites: readonly Record<string, unknown>[], selectedCell: number,
    fields: Record<string, string>) {
    const context = {
        map: { rows: 4, columns: 4, sites },
        selectedCell,
        $: (id: string) => ({ value: fields[id] ?? '', focus() {} }),
        commits: 0,
        commit() { context.commits += 1; },
        markErrorsStale() {},
        messages: [] as string[],
        message(text: string) { context.messages.push(text); },
    };
    const functions = ['siteAtCell', 'readPatrolBattleId', 'applyPatrolBattleIdFromForm',
        'readPatrolId', 'applyPatrolIdFromForm', 'patrolGroupKey', 'siteGroupCells',
        'applyPatrolRegionSync'].map((name) => {
        const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    });
    // 末尾必须带括号：裸 `{ … }` 会被当成块语句，`runInNewContext` 的完成值就不是这个对象。
    return { context, module: `${functions.join('\n')}; ({ siteGroupCells, applyPatrolRegionSync })` };
}

test('编辑器分组：巡逻宝箱只按「巡逻宝箱 ID」整片框出，普通站点仍按 configId', () => {
    const sites = [
        { id: 'patrolChest_1', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 1001, unlock: { requiredCells: [10] } },
        { id: 'patrolChest_1', type: 'patrolChest', cellId: 2, footprint: [2], battleId: 1001, unlock: { requiredCells: [10] } },
        // 同 id 但 battleId 写歪：分组只看 id ⇒ 仍在同一片（编辑器要能看出这格配错了）
        { id: 'patrolChest_1', type: 'patrolChest', cellId: 3, footprint: [3], battleId: 1009, unlock: { requiredCells: [10] } },
        { id: 'patrolChest_9', type: 'patrolChest', cellId: 4, footprint: [4], battleId: 1009, unlock: { requiredCells: [10] } },
        { id: 'stage_1', type: 'stage', cellId: 5, footprint: [5], configId: '10001', unlock: { requiredCells: [] } },
        { id: 'stage_2', type: 'stage', cellId: 6, footprint: [6], configId: '10001', unlock: { requiredCells: [] } },
    ];
    const sandbox = editorSandbox(sites, 1, {});
    const group = runInNewContext(sandbox.module, sandbox.context) as {
        siteGroupCells: (cell: number) => number[];
    };
    // 沙箱里造出来的数组原型与宿主不同，`deepStrictEqual` 会判不等 ⇒ 先 `Array.from` 拷回宿主。
    assert.deepEqual(Array.from(group.siteGroupCells(1)).sort((a, b) => a - b), [1, 2, 3],
        '同一个 patrolChest_1 整片框出（哪怕其中一格 battleId 写歪）');
    assert.deepEqual(Array.from(group.siteGroupCells(4)), [4], '另一个 id 是另一片');
    assert.deepEqual(Array.from(group.siteGroupCells(5)).sort((a, b) => a - b), [5, 6], '普通站点仍按 configId 分组');
});

test('编辑器「同步到同巡逻区」只写同一个巡逻宝箱 ID 的格子，patrolId 与别的片不动', () => {
    const sites = [
        { id: 'patrolChest_1', type: 'patrolChest', cellId: 1, footprint: [1], battleId: 1001, patrolId: 50021, unlock: { requiredCells: [0] } },
        { id: 'patrolChest_1', type: 'patrolChest', cellId: 2, footprint: [2], unlock: { requiredCells: [0] } },
        // 另一个 id：不许被同步
        { id: 'patrolChest_9', type: 'patrolChest', cellId: 9, footprint: [9], battleId: 7001, unlock: { requiredCells: [0] } },
    ];
    const sandbox = editorSandbox(sites, 1, { battleId: '1001', patrolId: '50021' });
    const module = runInNewContext(sandbox.module, sandbox.context) as {
        applyPatrolRegionSync: () => boolean;
    };
    assert.equal(module.applyPatrolRegionSync(), true);
    const byCell = new Map(sites.map((site) => [site.cellId, site]));
    assert.equal(byCell.get(2)!.battleId, 1001, '同 id 缺的格补上');
    assert.equal(byCell.get(9)!.battleId, 7001, '另一个 id 的片不动');
    assert.equal('patrolId' in (byCell.get(2) as object), false, 'patrolId 不同步（一片只在一格出怪）');
    assert.equal(sandbox.context.commits, 1, '有变化才提交一次撤销点');
    // 再点一次：已经是同一份配置 ⇒ 不再 commit
    assert.equal(module.applyPatrolRegionSync(), true);
    assert.equal(sandbox.context.commits, 1, '没有变化不产生新的撤销点');
});

test('编辑器校验：同一个巡逻宝箱 ID 下战斗 ID 不一致会给出警告（否则表现错乱）', () => {
    const base = (secondBattleId: number) => ({
        version: 1, mapKind: 'territoryChapter', id: 'patrol_block', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {}, sites: [
            { id: 'patrol_1', type: 'patrolChest', cellId: 1, battleId: 1001 },
            { id: 'patrol_1', type: 'patrolChest', cellId: 2, battleId: secondBattleId },
        ],
    });
    const mixed = normalizeTerritoryMap(base(1009));
    assert.ok(mixed.warnings.some((text: string) => /mixes 2 battleId values/.test(text)),
        '同片战斗 ID 不一致要报警告');
    const same = normalizeTerritoryMap(base(1001));
    assert.ok(!same.warnings.some((text: string) => /battleId values/.test(text)), '一致时不该有这条警告');
});

test('巡逻宝箱开战与解锁都用「带 patrolId 的那一格」上报后端', () => {
    // 直接抽真实方法体（class 里两段 private 方法），避免再造一份口径。
    const model = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    const pick = (name: string): string => {
        const match = model.match(new RegExp(`    private ${name}\\([^\\n]*\\)[^{]*\\{[\\s\\S]*?\\n    \\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    };
    // 方法体带 TS 类型注解，直接进沙箱会 `Unexpected token ':'` ⇒ 先 transpile 成 JS。
    const probeCode = ts.transpileModule(
        ['class Probe {', pick('patrolReportCell'), pick('battleParamsFor'), '}', '({ Probe })'].join('\n'),
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const Probe = (runInNewContext(probeCode, {
        chapterCellBattleParams,
        TERRITORY_SITE_TYPE,
        territoryPatrolAnchorCell,
    }) as { Probe: new () => {
        map: unknown;
        patrolReportCell: (site: unknown) => number;
        battleParamsFor: (site: unknown, chapterId: number) => readonly string[];
    } }).Probe;
    const sites = [
        { id: 'patrolChest_155', type: 'patrolChest', cellId: 346, battleId: 1001 },
        { id: 'patrolChest_155', type: 'patrolChest', cellId: 366, battleId: 1001 },
        { id: 'patrolChest_155', type: 'patrolChest', cellId: 387, battleId: 1001, patrolId: 50021 },
    ];
    const probe = new Probe();
    probe.map = { sites };
    const anchor = sites[2];
    assert.equal(probe.patrolReportCell(sites[0]), 387, '同片任意一格都指向带 patrolId 的锚点格');
    assert.equal(probe.patrolReportCell(anchor), 387, '锚点格自己还是自己');
    assert.deepEqual(Array.from(probe.battleParamsFor(sites[0], 1)), ['1', '1', '387'],
        '开战参数用锚点格（服务端按 cellId 找怪物配置）');
    assert.deepEqual(Array.from(probe.battleParamsFor(anchor, 1)), ['1', '1', '387']);
    // 没有 patrolId 的旧图退回自己，不能返回 0 / undefined。
    assert.equal(probe.patrolReportCell({ id: 'x', type: 'patrolChest', cellId: 366, battleId: 1 }), 366);
    // 非巡逻宝箱不受影响。
    assert.equal(probe.patrolReportCell({ id: 's', type: 'stage', cellId: 12 }), 12);
});
