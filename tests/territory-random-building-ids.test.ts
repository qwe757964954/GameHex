// 随机据点的**逐格**建筑 ID：`randomSites.buildingIds`（cellId → 建筑 ID）。
//
// 背景（2026-10-10 山猫口径）：第一版把它做成了 `randomSites.buildingId` 单值 ——
// 那是**整张图**一个建筑 ID，等于「所有随机据点长同一栋楼」，与「建筑 ID 针对单个随机据点」
// 的实际口径不符。现改为 per-cell 映射，三侧（编辑器 JS / Python 校验器 / 客户端 TS）必须一致，
// 少改一侧就会产出不一致的地图 JSON。
//
//🔴 键是 JSON 对象的**字符串**形态（`"346"` 而不是 `346`），所以三侧都不能直接
//  `isInt(key)` / `Number.isInteger(key)`：Python 侧那样判会把所有合法键都当非法，
// JS 侧 `Number('')` 是 0、`Number(' 12 ')` 是 12 会放进越界或带空格的键。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerritoryMap } from '../tools/map-editor/formats/territory-format.js';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { assetUrl } from './helpers/asset-paths';

/** 最小可用地图：5×5、主城 12、两个候选格 7/8（都不与站点/主城重叠）。 */
function baseMap(): Record<string, unknown> {
    return {
        version: 1,
        mapKind: 'territoryChapter',
        id: 'chapter_99',
        name: '逐格建筑 ID 用例',
        chapterId: 99,
        rows: 5,
        columns: 5,
        startCellId: 12,
        background: '',
        defaults: { combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 },
        sites: [{
            id: 'stage_1', type: 'stage', cellId: 6, footprint: [6], configId: '1',
            unlock: { requiredCells: [12], unlockType: 'combatPower', unlockValue: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 },
        }],
        randomSites: {
            triggerSilver: 10, rewardPoolId: 'pool_1', candidateCells: [7, 8], maxActive: 1,
        },
    };
}

/** 三侧对同一份输入的判定：`js` / `client` 抛出的错误消息，`pythonIssues` 由 Python 侧给出。 */
function jsIssues(data: unknown): string[] {
    try {
        normalizeTerritoryMap(data);
        return [];
    } catch (error) {
        return (error as { issues?: string[] }).issues ?? [String(error)];
    }
}

function clientIssues(data: unknown): string[] {
    try {
        configureTerritoryMap(data);
        return [];
    } catch (error) {
        return [String((error as Error).message)];
    }
}

// ── 正常路径：两个候选格配不同建筑，逐格生效 ──────────────────────────────
test('两个候选格可以配不同建筑 ID（per-cell，不是整张图一个值）', () => {
    const data = baseMap();
    (data.randomSites as Record<string, unknown>).buildingIds = { '7': '69004', '8': '69005' };
    const js = normalizeTerritoryMap(data).map;
    assert.deepEqual((js.randomSites as { buildingIds: unknown }).buildingIds, { '7': '69004', '8': '69005' });
    const client = configureTerritoryMap(data);
    assert.deepEqual(client.randomSites?.buildingIds, { 7: '69004', 8: '69005' });
});

test('只配一格时另一格留空（未列出的候选格完全交给奖励池抽签）', () => {
    const data = baseMap();
    (data.randomSites as Record<string, unknown>).buildingIds = { '8': '69005' };
    const client = configureTerritoryMap(data);
    assert.deepEqual(client.randomSites?.buildingIds, { 8: '69005' });
    assert.equal(client.randomSites?.buildingIds?.[7], undefined);
});

// ── 空串 / 纯空格 =「这一格没指定」：三侧都不写进产物 ────────────────────
test('空串与纯空格按「没指定」处理，三侧产物都不含该键', () => {
    for (const blank of ['', '   ']) {
        const data = baseMap();
        (data.randomSites as Record<string, unknown>).buildingIds = { '7': blank, '8': '69005' };
        const js = normalizeTerritoryMap(data).map;
        assert.deepEqual((js.randomSites as { buildingIds: unknown }).buildingIds, { '8': '69005' });
        const client = configureTerritoryMap(data);
        assert.deepEqual(client.randomSites?.buildingIds, { 8: '69005' });
    }
});

test('全为空串时不写buildingIds 这个键本身', () => {
    const data = baseMap();
    (data.randomSites as Record<string, unknown>).buildingIds = { '7': '', '8': '  ' };
    assert.equal('buildingIds' in (normalizeTerritoryMap(data).map.randomSites as object), false);
    assert.equal(configureTerritoryMap(data).randomSites?.buildingIds, undefined);
});

// ── 值类型：必须是字符串 ────────────────────────────────────────────────
test('建筑 ID 写成数字必须报错（JS 与客户端都拒绝）', () => {
    const data = baseMap();
    (data.randomSites as Record<string, unknown>).buildingIds = { '7': 69004 };
    assert.ok(jsIssues(data).some((issue) => issue.includes('randomSites.buildingIds.7 must be a string')),
        `JS 侧应报错：${jsIssues(data).join(' | ')}`);
    assert.ok(clientIssues(data).some((issue) => issue.includes('randomSites.buildingIds.7 must be a string')),
        `客户端应报错：${clientIssues(data).join(' | ')}`);
});

// ── 键：必须是十进制非负整数，且在范围内 ─────────────────────────────────
test('非法键必须报错：空串 / 带空格 / 小数 / 负数 / 越界 / 非候选格', () => {
    const cases: Array<[string, string]> = [
        ['', 'must be a cell in'],
        [' 12 ', 'must be a cell in'],
        ['1.5', 'must be a cell in'],
        ['-3', 'must be a cell in'],
        ['abc', 'must be a cell in'],
        ['9999', 'must be a cell in'],   // 5×5 只有 25格
        ['6', 'is not a candidate cell'], // 6 是固定站点格，不是候选格
        ['12', 'is not a candidate cell'], // 12 是主城
    ];
    for (const [key, expected] of cases) {
        const data = baseMap();
        (data.randomSites as Record<string, unknown>).buildingIds = { [key]: '69004' };
        const js = jsIssues(data);
        assert.ok(js.some((issue) => issue.includes(expected)),
            `JS 侧键 ${JSON.stringify(key)} 应报 ${expected}，实际：${js.join(' | ') || '（无错误）'}`);
        const client = clientIssues(data);
        assert.ok(client.some((issue) => issue.includes(expected)),
            `客户端键 ${JSON.stringify(key)} 应报 ${expected}，实际：${client.join(' | ') || '（无错误）'}`);
    }
});

// 🔴 这条是本文件最核心的一条：键若是数字字面量（`{7: 'x'}`）而不是字符串，
// `JSON.stringify` 出来还是 `'7'`，但**内存里的对象**是数字键 —— Python 侧用
// `_is_int(key)` 判会全部误杀。三侧必须按「字符串形态」这个唯一口径判。
test('键写成数字字面量（内存态）也要按字符串形态正常处理', () => {
    const data = baseMap();
    // 绕过 TS 的索引签名约束，直接构造数字键对象。
    const randomSites = data.randomSites as { buildingIds: unknown };
    randomSites.buildingIds = { 7: '69004' };
    const client = configureTerritoryMap(data);
    assert.deepEqual(client.randomSites?.buildingIds, { 7: '69004' });
    assert.deepEqual(jsIssues(data), [], `数字键不该报错：${jsIssues(data).join(' | ')}`);
});

test('buildingIds 不是对象时报错', () => {
    for (const bad of [[], 'x', 5]) {
        const data = baseMap();
        (data.randomSites as Record<string, unknown>).buildingIds = bad;
        assert.ok(jsIssues(data).some((issue) => issue.includes('randomSites.buildingIds must be an object')),
            `JS 侧 ${JSON.stringify(bad)} 应报 must be an object`);
        assert.ok(clientIssues(data).some((issue) => issue.includes('randomSites.buildingIds must be an object')),
            `客户端 ${JSON.stringify(bad)} 应报 must be an object`);
    }
});

// ── 确定性：同一份配置产物字节一致（key 按 cellId 升序）─────────────────
test('产物里的 buildingIds 按 cellId 升序，不受输入顺序影响', () => {
    const forward = baseMap();
    (forward.randomSites as Record<string, unknown>).buildingIds = { '7': 'a', '8': 'b' };
    const backward = baseMap();
    (backward.randomSites as Record<string, unknown>).buildingIds = { '8': 'b', '7': 'a' };
    assert.equal(
        JSON.stringify((normalizeTerritoryMap(forward).map.randomSites as { buildingIds: unknown }).buildingIds),
        JSON.stringify((normalizeTerritoryMap(backward).map.randomSites as { buildingIds: unknown }).buildingIds),
    );
});

// ── 真实地图：已发布的 chapter_01 没有这个键时不该凭空造出来 ──────────────
test('没有 buildingIds 的既有地图解析后不多出该键', async () => {
    const { readFileSync } = await import('node:fs');
    const sample = JSON.parse(readFileSync(
        assetUrl('config/territory-maps/chapter_01.json'), 'utf8'));
    assert.equal(sample.randomSites.buildingIds, undefined, '样本本身不该有这个键');
    const config = configureTerritoryMap(sample);
    assert.equal(config.randomSites?.buildingIds, undefined);
});