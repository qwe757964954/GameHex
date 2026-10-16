import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';

const raw = JSON.parse(readFileSync(new URL('../assets/resources/config/territory-maps/chapter_01.json', import.meta.url), 'utf8'));
const map = configureTerritoryMap(raw);

test('territory progress starts from the chapter foothold and follows map-defined site gates', () => {
    const progress = new TerritoryProgress(map);
    assert.deepEqual(progress.ownedCells, [map.startCellId]);

    const stage = progress.checkExplore(327, 1000);
    assert.equal(stage.ok, true);
    if (stage.ok) assert.deepEqual(stage.quote.cells, [327]);
});

test('★地图数据：requiredCells 不得把同区域（configId）的多个关卡格全列进前置', () => {
    // 2026-10-15 真机问题（cellId 248）：它前置 [269,270,291]，而这三个**同属 configId=10003
    // 一个区域**。判定侧走 isAreaPassed 区域共享所以能放行，但清单摆着三格 ⇒ 玩家以为要打三遍。
    // 本条把「数据侧收敛」钉成判据，防止有人又把同区域多格塞回 requiredCells。
    const byCell = new Map<number, (typeof map.sites)[number]>();
    for (const site of map.sites) for (const c of site.footprint) byCell.set(c, site);
    const offenders: string[] = [];
    for (const site of map.sites) {
        const reqs = site.unlock?.requiredCells ?? [];
        if (reqs.length < 2) continue;
        // 只对战斗区域分组：fixedResource / bonus 各是各的据点；asyncPvp 与关卡一样共享 battle 区域。
        const groups = new Map<string, number[]>();
        for (const r of reqs) {
            const rs = byCell.get(r);
            if (!rs || (rs.type !== 'stage' && rs.type !== 'boss')) continue;
            const key = String(rs.configId);
            groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        for (const [cid, cells] of groups) {
            if (cells.length > 1) {
                offenders.push(`site ${site.cellId}(${site.type}) 前置里的 configId=${cid} 有 ${cells.length} 格: [${cells.join(',')}]`);
            }
        }
    }
    assert.deepEqual(offenders, [],
        `${offenders.length} 个站点把同区域的多个关卡格列进了 requiredCells（应只留一个代表格）:\n  ${offenders.join('\n  ')}`);
});

test('★真机口径：只打通 10003 区域一格（269），cellId 248 就能解锁', () => {
    // 248 = fixedResource_45，前置收敛为 [269]（同区域 270/291 不再重复列）。
    // 再叠上上一轮的区域口径（A 修）：战斗区域前置走 isAreaPassed ⇒ 打一格即整片算完成。
    const progress = new TerritoryProgress(map);
    for (const c of [288, 309, 310]) progress.markCellPassed(c);
    for (const c of [308, 329, 268, 292]) progress.markCellUnlocked(c);
    progress.markCellPassed(269);
    const result = progress.checkUnlock(248, 0);
    assert.equal(result.ok, true, `只打269 一格就应能开 248，实际：${result.ok ? '' : result.reason}`);
});

test('territory progress enforces site gates, settles time, and produces a save-safe payload', () => {
    const progress = new TerritoryProgress(map);
    assert.deepEqual(progress.checkExplore(327, -1), { ok: false, reason: '战力不足' });
    const started = progress.startExplore(327, 1000, 1_000);
    assert.equal(started.ok, true);
    assert.equal(progress.explorationAt(327)?.finishesAt, 3_000);
    assert.deepEqual(progress.settle(2_999), []);
    assert.deepEqual(progress.settle(3_000), [327]);
    assert.equal(progress.isOwned(327), true);
    assert.deepEqual(progress.checkExplore(288, 1200).ok, true);
    assert.deepEqual(progress.checkExplore(269, 99999), { ok: false, reason: '前置领地尚未占领' });

    const restored = new TerritoryProgress(map, progress.toJSON());
    assert.deepEqual(restored.ownedCells, [327, map.startCellId].sort((a, b) => a - b));
});

test('territory progress keeps disabled and exploration state out of the static map', () => {
    const progress = new TerritoryProgress(map);
    assert.equal(progress.setDisabled(327, true), true);
    assert.deepEqual(progress.checkExplore(327, 1000), { ok: false, reason: '该格暂不可探索' });
    assert.equal(progress.setDisabled(map.startCellId, true), false);
    assert.equal('ownedCells' in map, false);
});

test('claimed fixed resources satisfy later site gates but unlocked battle cells do not', () => {
    const progress = new TerritoryProgress(map);
    assert.equal(progress.checkUnlock(235, 99999).ok, false);
    progress.applyServerState({ unlockCells: [234, 327], passCells: [367] });
    assert.equal(progress.checkUnlock(235, 99999).ok, true, '235 requires claimed fixed resource 234');
    assert.equal(progress.checkUnlock(288, 99999).ok, false, '288 requires battle cell 327 to be passed');
    progress.markCellPassed(327);
    assert.equal(progress.checkUnlock(288, 99999).ok, true);
});

test('server-confirmed random unlock survives a local progress reload', () => {
    const progress = new TerritoryProgress(map);
    progress.markCellUnlocked(346);
    const restored = new TerritoryProgress(map, progress.toJSON());
    assert.equal(restored.isCellUnlocked(346), true);
});

test('random cells unlocked-and-passed become owned without pending pass reports', () => {
    const progress = new TerritoryProgress(map);
    progress.markCellsUnlocked([346, 349]);
    const added = progress.markCellsPassed([346, 349, 99999]);
    assert.deepEqual(added, [346, 349]);
    assert.equal(progress.isOwned(346), true);
    assert.equal(progress.isOwned(349), true);
    // 随机格仍在解锁集合里（服务端 unlockCells 口径），与已领取 fixedResource 一致。
    assert.equal(progress.isCellUnlocked(349), true);
    // 随机格不发通关请求 ⇒ 不得进入 pendingPasses。
    assert.deepEqual(progress.pendingPassCells, []);
    // 重复记账幂等。
    assert.deepEqual(progress.markCellsPassed([346]), []);
});

// ============================================================
// 关卡前置按「区域」判定（2026-10-15 真机修复）
// ============================================================

test('★★★★关卡前置走区域口径：只打通 328（无建筑的 327 永远 owned 不了）也能开 309', () => {
    // 真机症状：cellId 309（关卡 2、有建筑 69004）点击**一个协议都不发**，只弹
    // 「前置领地尚未占领」。根因：309 的前置里同时列了 327 与 328，而这两格是**同一关卡**
    // （configId=10001）的两格，而判定走严格 `owned` ⇒ 要各打一遍；
    // 但 327 没有建筑、玩家只会点 328 ⇒ 327 永远拿不到 owned ⇒ 死锁。
    // 现在前置对战斗区域改走 `isAreaPassed`（同 configId 任一格 owned 即算完成），
    // 与显示侧（整片绿「已通关」）同一口径。
    const progress = new TerritoryProgress(map);
    progress.applyServerState({
        unlockCells: [347, 348, 327, 328, 308, 329],
        passCells: [map.startCellId, 328],   // 只打通了有建筑的那一格
    });
    assert.equal(progress.checkUnlock(309, 99999).ok, true,
        '★只占领 328 就必须能开 309 —— 这正是真机上点不动的那个格子');
    assert.equal(progress.checkUnlock(310, 99999).ok, true, '310 是同一条前置，同样该开');
    assert.equal(progress.checkUnlock(308, 99999).ok, true, '308 是 fixedResource，按解锁即完成');
});

test('★★反向：区域没打穿仍要挡住 309（别把前置口径改得太宽）', () => {
    const progress = new TerritoryProgress(map);
    progress.applyServerState({
        unlockCells: [347, 348, 327, 328, 308, 329],
        passCells: [map.startCellId],          // 327/328 都只是「解锁」，没通关
    });
    assert.equal(progress.checkUnlock(309, 99999).ok, false,
        '区域一格都没通关 ⇒ 仍要挡（否则关卡2 会白送解锁）');
});
