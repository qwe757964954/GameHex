// 「校验错误 → 格子标签」的定位守卫。
//
// 背景（2026-09-29 山猫报）：面板里只写 `randomSites.candidateCells cannot use fixed cell 153`，
// 20×20 的图上根本不知道 153 在哪 ⇒ 要在格子上画 error 标签。
// 定位靠 formats/territory-issue-cells.js 按 issue 文本反解格号 —— 那是「解析文本」，
// 一旦校验器改了措辞就会静默失效。所以这里的用例**不手写 issue 字符串**：
// 每条都把独立的小地图夹具改坏，跑**真校验器** validateTerritoryMap()
// 拿到真实 issues，再断言反解出的格号。真实第一章地图另有格式测试。
//
// 零旗标命名导入（tests/ 没开 allowSyntheticDefaultImports，default 导入会加 TS1259 噪声）
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTerritoryMap } from '../tools/map-editor/formats/territory-format.js';
import { issueCells, issuesToCellMarkers } from '../tools/map-editor/formats/territory-issue-cells.js';

// 错误定位夹具：startCellId = 303，5 个站点
//   fixedResource_1 cell 264 required [303]
//   fixedResource_3 cell 265 required [264]
//   fixedResource_5 cell 284 required [303]
//   fixedResource_7 cell 283 required [303]
//   stage_5          cell 246 required [265]
const sample = (): any => ({
    version: 1,
    mapKind: 'territoryChapter',
    id: 'issue_cells_fixture',
    chapterId: 1,
    rows: 20,
    columns: 20,
    startCellId: 303,
    background: '',
    defaults: { combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 },
    sites: [
        { id: 'fixedResource_1', type: 'fixedResource', cellId: 264, footprint: [264], configId: 'fixedResource_264', unlock: { requiredCells: [303], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 } },
        { id: 'fixedResource_3', type: 'fixedResource', cellId: 265, footprint: [265], configId: 'fixedResource_265', unlock: { requiredCells: [264], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 } },
        { id: 'fixedResource_5', type: 'fixedResource', cellId: 284, footprint: [284], configId: 'fixedResource_284', unlock: { requiredCells: [303], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 } },
        { id: 'fixedResource_7', type: 'fixedResource', cellId: 283, footprint: [283], configId: 'fixedResource_283', unlock: { requiredCells: [303], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 } },
        { id: 'stage_5', type: 'stage', cellId: 246, footprint: [246], configId: 'stage_246', unlock: { requiredCells: [265], combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 } },
    ],
    randomSites: { triggerSilver: 10, rewardPoolId: 'fixture_pool', candidateCells: [153], maxActive: 1 },
});

function run(mutate: (map: any) => void) {
    const data = sample();
    mutate(data);
    let issues: string[] = [];
    try {
        validateTerritoryMap(JSON.parse(JSON.stringify(data)));
    } catch (error: any) {
        issues = Array.isArray(error.issues) ? error.issues : [String(error.message ?? error)];
    }
    const markers = issuesToCellMarkers(issues, data);
    const cells = [...new Set(markers.map((marker) => marker.cellId))].sort((a: number, b: number) => a - b);
    return { data, issues, markers, cells };
}

test('真存档本身没有 error（基线：反解器不会凭空标格）', () => {
    assert.deepEqual(run(() => { /* 不动 */ }).cells, []);
});

test('候选格撞固定格 → 标出那一格（山猫报的 `cannot use fixed cell 153`）', () => {
    // 把 153 变成固定格（它本来就在 candidateCells 里）⇒ 复现用户报的那条消息
    const result = run((map) => {
        map.sites.push({
            id: 'stage_x', type: 'stage', cellId: 153, footprint: [153], configId: 'stage_153',
            unlock: { requiredCells: [303], unlockType: 'combatPower', combatPower: 0, silverCost: 200, exploreSeconds: 180, staminaCost: 10 },
        });
    });
    assert.ok(result.issues.includes('randomSites.candidateCells cannot use fixed cell 153'), `真校验器应产出该 issue：${result.issues.join(' | ')}`);
    assert.deepEqual(result.cells, [153]);
    assert.equal(result.markers.length, 1);
    assert.equal(result.markers[0].text, 'randomSites.candidateCells cannot use fixed cell 153');
});

test('两站点 footprint 重叠 → 只标**重叠的那一格**（标两个站点会把范围放大）', () => {
    const result = run((map) => {
        map.sites[1].footprint = [264, 265];   // 265 本来只属于 fixedResource_3，264 已被 fixedResource_1 占
    });
    assert.ok(result.issues.some((issue) => issue === 'site fixedResource_3 overlaps site fixedResource_1'), result.issues.join(' | '));
    assert.deepEqual(result.cells, [264]);
});

test('站点落初始格 → 初始格和那个站点都标出来', () => {
    const result = run((map) => {
        map.sites.push({
            id: 'stage_y', type: 'stage', cellId: 303, footprint: [303], configId: 'stage_303',
            unlock: { requiredCells: [264], unlockType: 'combatPower', combatPower: 0, silverCost: 200, exploreSeconds: 180, staminaCost: 10 },
        });
    });
    assert.ok(result.issues.some((issue) => issue === 'site stage_y cannot occupy startCellId'), result.issues.join(' | '));
    assert.ok(result.cells.includes(303));
});

test('悬空依赖（把初始格搬走）→ 断链的格 + 报错的站点都标出来', () => {
    // 这就是编辑器里「初始格笔刷换个格子」的真实后果：3 个站点还指着旧 start 303
    const result = run((map) => { map.startCellId = 0; });
    assert.equal(result.issues.filter((issue) => issue.includes('no fixed site owns it')).length, 3);
    assert.deepEqual(result.cells, [264, 283, 284, 303]);
});

test('依赖环 → 标出被点名的那个站点（环的其它成员文本里没有，标不出来）', () => {
    const result = run((map) => {
        map.sites[0].unlock.requiredCells = [265];   // 264 → 265
        map.sites[1].unlock.requiredCells = [264];   // 265 → 264
    });
    assert.ok(result.issues.some((issue) => /^unlock dependency cycle at \w+$/.test(issue)), result.issues.join(' | '));
    assert.deepEqual(result.cells, [264]);
});

test('requiredCells 含自身 → 标那一格', () => {
    const result = run((map) => { map.sites[0].unlock.requiredCells = [264]; });
    assert.ok(result.issues.includes('sites[0].unlock.requiredCells cannot contain its own cellId'), result.issues.join(' | '));
    assert.deepEqual(result.cells, [264]);
});

test('重复站点 id → 两个同名的都标出来（否则只知道重名、不知道改哪一个）', () => {
    const result = run((map) => {
        // 复制 fixedResource_1 到空格 1，避免碰上候选格。
        map.sites.push({ ...map.sites[0], cellId: 1, footprint: [1], configId: 'dup' });
    });
    assert.ok(result.issues.includes('duplicate site id fixedResource_1'), result.issues.join(' | '));
    assert.deepEqual(result.cells, [1, 264]);
});

test('footprint 不连续 → 整块 footprint 都标（只标 cellId 会漏掉离群那格）', () => {
    const result = run((map) => {
        // 265 与 0 相隔太远；cellId 留在 footprint 里，免得再触发「must include cellId」
        map.sites[1].footprint = [265, 0];
    });
    assert.ok(result.issues.includes('sites[1].footprint must be contiguous'), result.issues.join(' | '));
    assert.deepEqual(result.cells, [0, 265]);
});

test('decorations 的 issue 定位到它那一格', () => {
    const result = run((map) => { map.decorations = [{ cellId: 89, artId: '' }]; });
    assert.ok(result.issues.includes('decorations[0].artId must be a non-empty string'), result.issues.join(' | '));
    assert.deepEqual(result.cells, [89]);
});

test('越界的格号没有六边形可标（返回空数组，别硬画一个不存在的格）', () => {
    const outOfBounds = run((map) => { map.randomSites.candidateCells.push(9999); });
    assert.ok(outOfBounds.issues.includes('randomSites.candidateCells contains an out-of-bounds cell'), outOfBounds.issues.join(' | '));
    assert.deepEqual(outOfBounds.cells, []);

    // startCellId 越界时，出错的是「初始格」这个概念本身 —— 没有格可以圈
    const badStart = run((map) => { map.startCellId = 9999; });
    assert.ok(badStart.issues.includes('startCellId must be an integer in [0, 399]'), badStart.issues.join(' | '));
    assert.deepEqual(badStart.cells, [264, 283, 284, 303]);   // 只剩悬空依赖那几条
});

test('issueCells 只认格号，不把别的数字当格（rows/columns 之类）', () => {
    const data = sample();
    assert.deepEqual(issueCells('rows must be an integer in [4, 60]', data), []);
    assert.deepEqual(issueCells('randomSites.maxActive must be an integer in [1, 999]', data), []);
    assert.deepEqual(issueCells('sites[0].unlock.combatPower must be a non-negative integer', data), [264]);
});
