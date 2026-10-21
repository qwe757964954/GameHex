import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTerritoryCampaign } from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import {
    applyTerritoryStageUnlocks,
    bindTerritoryBattleStages,
    bindTerritoryStages,
    expandBindingsToAreaSites,
    findCurrentTerritoryBoss,
    territoryChapterCompletion,
} from '../assets/script/app/territory/model/TerritoryStageBinding';

function rows(name: string): any[] {
    const payload = JSON.parse(readFileSync(new URL(`../assets/remoteRef/${name}.json`, import.meta.url), 'utf8'));
    if (Array.isArray(payload)) return payload;
    return payload.v.map((values: unknown[]) => Object.fromEntries(payload.k.map((key: string, index: number) => [key, values[index]])));
}

function campaign(chapterId: number) {
    return buildTerritoryCampaign(
        rows('levelInfo'),
        rows('monsterCard'),
        rows('npcTeam'),
        rows('pvpCard'),
        chapterId,
        rows('defenceModWave'),
        [...rows('item'), ...rows('roleProperty')],
    );
}

function chapter(number: number) {
    return configureTerritoryMap(JSON.parse(readFileSync(
        new URL(`../assets/resources/config/territory-maps/chapter_${String(number).padStart(2, '0')}.json`, import.meta.url),
        'utf8',
    )));
}

test('quick find follows unpassed Boss progression and locates the building in its shared area', () => {
    const map = chapter(1);
    const byCell = expandBindingsToAreaSites(map.sites, bindTerritoryBattleStages(map.sites, campaign(1).stages));
    const progress = new TerritoryProgress(map);
    const sites = [...map.sites].reverse();
    assert.equal(findCurrentTerritoryBoss(sites, byCell, progress)?.site.cellId, 213);
    progress.markCellPassed(193);
    assert.equal(findCurrentTerritoryBoss(sites, byCell, progress)?.site.cellId, 105,
        'passing any peer clears the entire Boss area');
    progress.markCellPassed(85);
    assert.equal(findCurrentTerritoryBoss(sites, byCell, progress), null);
    assert.equal(findCurrentTerritoryBoss(sites, new Map(), new TerritoryProgress(map)), null,
        'unbound Boss stations must not open an empty battle detail');
});

test('chapter one has exactly ten explicit playable level bindings', () => {
    const map = chapter(1);
    const numericIds = map.sites
        .filter((site) => site.type === 'stage' || site.type === 'boss')
        .map((site) => site.configId)
        .filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id))
        .map(Number)
        .sort((a, b) => a - b);
    assert.deepEqual([...new Set(numericIds)], [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010]);
    const asyncPvpSites = map.sites.filter((site) => [372, 373, 392].includes(site.cellId))
        .sort((a, b) => a.cellId - b.cellId);
    assert.deepEqual(asyncPvpSites.map((site) => [site.cellId, site.type, site.configId]), [
        [372, 'asyncPvp', '20001'],
        [373, 'asyncPvp', '20001'],
        [392, 'asyncPvp', '20001'],
    ], 'these three asyncPvp cells share battle configId 20001');
    const bindings = bindTerritoryStages(map.sites, campaign(1).stages);
    assert.equal(bindings.length, 10);
    assert.deepEqual(
        bindings.map(({ site, stage }) => [stage.levelId, site.cellId]).sort((a, b) => a[0] - b[0]),
        [[10001, 327], [10002, 288], [10003, 269], [10004, 252], [10005, 213],
            [10006, 155], [10007, 95], [10008, 70], [10009, 8], [10010, 105]],
    );
});

test('async PvP cells bind to shared levelInfo battles without joining campaign progression', () => {
    const map = chapter(1);
    const stages = campaign(1).stages;
    const configuredAsyncBattle = stages.find((stage) => stage.levelId === 20001);
    assert.ok(configuredAsyncBattle, 'levelInfo.json should provide battle 20001');
    assert.equal(configuredAsyncBattle.mode, 'match');
    assert.ok(configuredAsyncBattle.enemyTeamIds.length > 0, 'battle 20001 should include its configured NPC team');
    const progressionBindings = bindTerritoryStages(map.sites, stages);
    const battleBindings = bindTerritoryBattleStages(map.sites, stages);
    const byCell = expandBindingsToAreaSites(map.sites, battleBindings);

    assert.equal(progressionBindings.length, 10, 'async PvP must not inflate the chapter progression chain');
    assert.deepEqual(battleBindings.filter(({ stage }) => stage.levelId === 20001)
        .map(({ site }) => site.cellId), [373]);
    for (const cellId of [372, 373, 392]) {
        assert.equal(byCell.get(cellId)?.levelId, 20001, `cell ${cellId} should use the configured battle`);
    }
    assert.equal(territoryChapterCompletion(progressionBindings, []).total, 10);

    const progress = new TerritoryProgress(map);
    progress.markCellPassed(372);
    for (const cellId of [372, 373, 392]) {
        assert.equal(progress.isAreaPassed(cellId), true, `passing async cell 372 should clear area cell ${cellId}`);
    }
});

test('chapter two stays display-only until its sites receive explicit level IDs', () => {
    const map = chapter(2);
    const bindings = bindTerritoryStages(map.sites, campaign(2).stages);
    assert.equal(bindings.length, 0);
});

test('chapter one can advance through ten levels from a fresh save without placeholder sites', () => {
    const sourceMap = chapter(1);
    const bindings = bindTerritoryStages(sourceMap.sites, campaign(1).stages)
        .sort((a, b) => a.stage.stage - b.stage.stage);
    const map = applyTerritoryStageUnlocks(sourceMap, bindings);
    const progress = new TerritoryProgress(map);
    assert.deepEqual(progress.ownedCells, [map.startCellId]);
    for (const [index, binding] of bindings.entries()) {
        assert.equal(progress.checkExplore(binding.site.cellId, 0).ok, true, `level ${binding.stage.levelId} is blocked`);
        if (index + 1 < bindings.length) {
            assert.equal(progress.checkExplore(bindings[index + 1].site.cellId, 0).ok, false);
        }
        const started = progress.startExplore(binding.site.cellId, 0, 1_000);
        assert.equal(started.ok, true);
        assert.deepEqual(progress.settle(1_000_000), [binding.site.cellId]);
    }
    assert.deepEqual(territoryChapterCompletion(bindings, progress.ownedCells), {
        occupied: 10, total: 10, complete: true,
    });
});

test('duplicate display stations stay unbound and keep their configured gates', () => {
    const sourceMap = chapter(1);
    const bindings = bindTerritoryStages(sourceMap.sites, campaign(1).stages);
    const map = applyTerritoryStageUnlocks(sourceMap, bindings);
    const activeCells = new Set(bindings.map(({ site }) => site.cellId));
    assert.equal(bindings.length, 10);
    assert.deepEqual(map.sites.find((site) => site.cellId === 155)?.unlock.requiredCells, [213]);
    for (const site of sourceMap.sites) {
        if (activeCells.has(site.cellId)) continue;
        assert.deepEqual(map.sites.find((candidate) => candidate.cellId === site.cellId)?.unlock, site.unlock);
    }
});

test('missing explicit level ID never assigns a battle to a decorative site', () => {
    const map = chapter(1);
    const stages = campaign(1).stages;
    const sites = map.sites.filter((site) => site.configId !== '10005');
    const bindings = bindTerritoryStages(sites, stages);
    assert.equal(bindings.length, 9);
    assert.equal(bindings.some(({ stage }) => stage.levelId === 10005), false);
});

test('chapter completion uses only stations present and bound in the current map JSON', () => {
    const bindings = bindTerritoryStages(chapter(1).sites, campaign(1).stages);
    const partial = territoryChapterCompletion(bindings, [bindings[0].site.cellId]);
    assert.deepEqual(partial, { occupied: 1, total: 10, complete: false });

    const completed = territoryChapterCompletion(bindings, bindings.map(({ site }) => site.cellId));
    assert.deepEqual(completed, { occupied: 10, total: 10, complete: true });
    assert.deepEqual(territoryChapterCompletion([], []), { occupied: 0, total: 0, complete: false });
});

// ============================================================
// 同区域格子的关卡扩散（2026-10-12）
// ============================================================

test('★★★cellId 328 必须绑到 10001 的关卡（配了 configId 就不该再弹「待补齐」）', () => {
    const map = chapter(1);
    const bindings = bindTerritoryStages(map.sites, campaign(1).stages);
    const byCell = expandBindingsToAreaSites(map.sites, bindings);

    // 复现山猫的截图：328 的 configId=10001、levelInfo 里确有 10001，
    // 但去重让它拿不到 stage ⇒ 误弹「站点配置待补齐 / 表中没有可绑定关卡」。
    const site328 = map.sites.find((site) => site.cellId === 328);
    assert.ok(site328, 'chapter_01 应有 cellId 328 的站点');
    assert.equal(site328.configId, '10001', '328 配的就是 10001');
    assert.ok(campaign(1).stages.some((stage) => stage.levelId === 10001),
        'levelInfo.json 里有 10001 这一行');
    assert.equal(byCell.get(328)?.levelId, 10001,
        '328 必须绑到 10001 —— 这是本次修复的正解');
});

test('★★扩散只补 stage，不动链：bindings 仍是 10 条，章节分母仍是 10', () => {
    const map = chapter(1);
    const bindings = bindTerritoryStages(map.sites, campaign(1).stages);
    const byCell = expandBindingsToAreaSites(map.sites, bindings);

    // 🔴 若有人把 `bindTerritoryStages` 的去重一并去掉，这里会变成 54 ⇒ 用例变红。
    assert.equal(bindings.length, 10, '绑定数必须仍是 10（一片区域只占关卡链一步）');
    assert.equal(territoryChapterCompletion(bindings, []).total, 10,
        '章节进度分母必须仍是 10（扩散只影响「能不能打」，不影响「要打几次」）');
    // 扩散后能打的格子变多，但链仍由 bindings 决定。
    assert.ok(byCell.size > bindings.length,
        `扩散后 stageByCell 应多于绑定数（实际 ${byCell.size} vs ${bindings.length}）`);

    // 链的前置关系不变：155 仍要求先打 213（10005 的区域代表格）。
    const unlocked = applyTerritoryStageUnlocks(map, bindings);
    assert.deepEqual(unlocked.sites.find((site) => site.cellId === 155)?.unlock.requiredCells, [213],
        '关卡链没被扩散污染');
});

test('★★扩散只给 stage/boss 且配了数字 configId 的格子补，装饰格不动', () => {
    const map = chapter(1);
    const bindings = bindTerritoryStages(map.sites, campaign(1).stages);
    const byCell = expandBindingsToAreaSites(map.sites, bindings);
    const stages = campaign(1).stages;
    const stageById = new Map(stages.map((stage) => [stage.levelId, stage]));

    for (const site of map.sites) {
        const got = byCell.get(site.cellId);
        if (!got) continue;
        if (site.type !== 'stage' && site.type !== 'boss') {
            assert.fail(`格子 ${site.cellId} 是 ${site.type}，不该被扩散到 stage`);
        }
        assert.equal(got.levelId, Number(site.configId),
            `格子 ${site.cellId} 绑到了别的关卡（应跟自己的 configId 一致）`);
    }
    // 反向：fixedResource / asyncPvp 一格都不该出现在扩散表里。
    for (const site of map.sites) {
        if (site.type === 'stage' || site.type === 'boss') continue;
        assert.equal(byCell.has(site.cellId), false,
            `${site.type} 格 ${site.cellId} 不该有 stage`);
    }
    // 配了表里没有的 id ⇒ 不补（保持「真的没配关卡」的原行为）。
    assert.equal(stageById.has(99999), false, '前提：99999 不在表里');
    const fake = [{ ...map.sites[0], cellId: 9999, configId: '99999' }];
    assert.equal(expandBindingsToAreaSites(fake, bindings).has(9999), false,
        'configId 在 levelInfo 里查不到 ⇒ 不补 stage');
});

test('★★★接线层：Presenter 用战斗绑定扩散 stageByCell，主线 stages 仍用去重表', () => {
    // 🔴 纯函数用例**盖不住接线**：上一轮实测把 Presenter 里那一行换回
    //   `new Map(bindings.map(...))`，9 条用例**依然全绿** —— 而真机上的
    //   cellId 328 会重新弹「站点配置待补齐」。所以这两行必须单独钉。
    const src = readFileSync(
        new URL('../assets/script/app/territory/application/TerritoryPresenter.ts', import.meta.url),
        'utf8');
    assert.match(src, /const battleBindings = bindTerritoryBattleStages\(sourceMap\.sites, campaign\.stages\);/,
        'stageByCell 的输入绑定必须包含 asyncPvp 战斗站点');
    assert.match(src, /const stageByCell = expandBindingsToAreaSites\(sourceMap\.sites, battleBindings\);/,
        'stageByCell 必须由战斗绑定扩散生成（同区域格子共用关卡）');
    // 反向：stages 是章节进度分母，绝不能拿扩散后的 54 格去算。
    assert.match(src, /this\.stages = bindings\.map\(\(\{ site, stage \}\) => \(\{ site, stage \}\)\);/,
        'stages 必须用去重后的 bindings（一片区域只算一步，分母保持 10）');
    assert.ok(!/this\.stages = this\.map\.sites\.flatMap/.test(src),
        '旧的 flatMap 写法会让分母随扩散膨胀，必须换掉');
});
