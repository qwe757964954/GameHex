import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import type { TerritoryCampaignStage } from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import {
    territoryPrerequisiteBlockText,
    territoryPrerequisiteText,
} from '../assets/script/app/territory/model/TerritoryPrerequisite';
import { territoryLevelBubbleText } from '../assets/script/app/territory/model/TerritoryLevelBubble';
import { assetPath } from './helpers/asset-paths';

/**
 * 「前置没满足」的提示文案（需求 2026-11-02，用户截图里那条「前置领地尚未占领」太笼统）：
 *   · **关卡地块**提示关卡的名字 —— 格式 `数字-数字 关卡通关后解锁`，**名字同气泡文案**；
 *   · **宝箱地块**提示 `前置宝箱未打开`，并让那只宝箱播跳动（视图侧 `playChestHint`）。
 *
 * 判据分三层：
 *  ① 拼装（纯函数，给定画像出那句话）；
 *  ② 取名（`1-1` / `PVP` 与气泡**同源**，不是各拼一份）；
 *  ③ 真表 + 真进度（`chapter_01` 全站点扫一遍，确认两类都能出出来、且不会拼出空话）。
 */

// ---------------------------------------------------------------------------
// ① 拼装
// ---------------------------------------------------------------------------

const chest = { cellId: 1, isChest: true, label: undefined } as const;
const stageLocked = (cellId: number, label: string) => ({ cellId, isChest: false, label });

test('★★★只有关卡没打 ⇒ 「1-1 关卡通关后解锁」', () => {
    assert.equal(territoryPrerequisiteBlockText([stageLocked(11, '1-1')]), '1-1 关卡通关后解锁');
});

test('★★★只有宝箱没打开 ⇒ 「前置宝箱未打开」', () => {
    assert.equal(territoryPrerequisiteBlockText([chest]), '前置宝箱未打开');
});

test('★★★只报**第一个**能命名的前置（混合时也只出一句）', () => {
    // 关卡在前 ⇒ 报关卡。
    assert.equal(
        territoryPrerequisiteBlockText([stageLocked(11, '1-1'), chest]),
        '1-1 关卡通关后解锁',
    );
    // 宝箱在前 ⇒ 报宝箱。顺序 = 配置里 `requiredCells` 的书写顺序，不排序、不挑"更重要"的。
    assert.equal(
        territoryPrerequisiteBlockText([chest, stageLocked(11, '1-1')]),
        '前置宝箱未打开',
    );
});

test('★★多个关卡也只报第一个，不再拼「1-1、1-2」', () => {
    assert.equal(
        territoryPrerequisiteBlockText([stageLocked(11, '1-1'), stageLocked(12, '1-2')]),
        '1-1 关卡通关后解锁',
    );
    // 同一关卡占两格（`footprint`）时同样只念一次。
    assert.equal(
        territoryPrerequisiteBlockText([stageLocked(11, '1-1'), stageLocked(12, '1-1')]),
        '1-1 关卡通关后解锁',
    );
});

test('★★念不出来的前置（普通地块）跳过，看下一个', () => {
    assert.equal(
        territoryPrerequisiteBlockText([{ cellId: 7, isChest: false, label: undefined }, stageLocked(11, '1-1')]),
        '1-1 关卡通关后解锁',
        '前置格不属于任何站点 ⇒ 念不出名字，跳到下一个能命名的',
    );
    assert.equal(
        territoryPrerequisiteBlockText([{ cellId: 7, isChest: false, label: undefined }, chest]),
        '前置宝箱未打开',
    );
});

test('★★叫不出名字（普通地块 / 装饰格）⇒ 空串，调用方退回通用文案', () => {
    assert.equal(territoryPrerequisiteBlockText([]), '');
    assert.equal(territoryPrerequisiteBlockText([{ cellId: 7, isChest: false, label: undefined }]), '');
});

// ---------------------------------------------------------------------------
// ② 取名：与气泡文案同源
// ---------------------------------------------------------------------------

test('★★★名字就是气泡上那几个字：主线 `章节-关卡`，异步据点 `PVP`', () => {
    const stage = { chapterId: 3, stage: 12 } as unknown as TerritoryCampaignStage;
    assert.equal(territoryLevelBubbleText({ type: 'stage' }, stage), '3-12');
    assert.equal(territoryLevelBubbleText({ type: 'boss' }, stage), '3-12');
    assert.equal(territoryLevelBubbleText({ type: 'asyncPvp' }, stage), 'PVP');
    // 没绑关卡 / 宝箱 / 装饰：气泡本来就不显示，提示里也不该硬编一个编号出来。
    assert.equal(territoryLevelBubbleText({ type: 'stage' }, null), undefined);
    assert.equal(territoryLevelBubbleText({ type: 'fixedResource' }, null), undefined);
    assert.equal(territoryLevelBubbleText(null, stage), '3-12');
});

// ---------------------------------------------------------------------------
// ③ 真表 + 真进度
// ---------------------------------------------------------------------------

const raw = JSON.parse(readFileSync(assetPath('config/territory-maps/chapter_01.json'), 'utf8'));
const map = configureTerritoryMap(raw);

/** 造一张"每一格战斗站点都绑了关卡"的表（关卡内容与文案无关，只要 `chapterId` / `stage`）。 */
function fakeStageByCell(): Map<number, TerritoryCampaignStage> {
    const stages = new Map<number, TerritoryCampaignStage>();
    let index = 0;
    for (const site of map.sites) {
        if (site.type !== 'stage' && site.type !== 'boss' && site.type !== 'asyncPvp') continue;
        index += 1;
        stages.set(site.cellId, { chapterId: 1, stage: index } as unknown as TerritoryCampaignStage);
    }
    return stages;
}

test('★★★前置清单只认「还没满足」的那几格，且与 checkUnlock 的拦截同源', () => {
    const progress = new TerritoryProgress(map);
    let blockedSites = 0;
    for (const site of map.sites) {
        const blockers = progress.prerequisiteBlockers(site.cellId);
        const check = progress.checkUnlock(site.cellId, Number.MAX_SAFE_INTEGER);
        if (!blockers.length) continue;
        blockedSites += 1;
        assert.equal(check.ok, false, `${site.id} 有 ${blockers.length} 个前置没满足却没被拦住`);
        if (!check.ok) {
            assert.equal(check.reason, '前置领地尚未占领', '拦截原因必须是前置那条（文案由上层改写）');
        }
    }
    assert.ok(blockedSites > 0, '一条都没被拦住 ⇒ 判据失效（起始格之外不可能全都满足）');
    // 起始格自己：开局就属于玩家，前置清单必须是空的。
    assert.deepEqual(progress.prerequisiteBlockers(map.startCellId), []);
});

test('★★★真表扫一遍：宝箱前置出「前置宝箱未打开」，关卡前置出「N-N 关卡通关后解锁」', () => {
    const progress = new TerritoryProgress(map);
    const stageByCell = fakeStageByCell();
    // 名字只有两种形态：主线/首领的 `章节-关卡`，异步据点的 `PVP`（与气泡一致）。
    const NAME = String.raw`(?:\d+-\d+|PVP)`;
    const stageText = new RegExp(String.raw`^${NAME} 关卡通关后解锁$`);
    let chestOnly = 0;
    let stageOnly = 0;
    for (const site of map.sites) {
        const blockers = progress.prerequisiteBlockers(site.cellId);
        if (!blockers.length) continue;
        const text = territoryPrerequisiteText(blockers, map.sites, stageByCell);
        if (text === '前置宝箱未打开') { chestOnly += 1; continue; }
        if (stageText.test(text)) { stageOnly += 1; continue; }
        // 只剩一种合法形态：叫不出名字的空串（前置全是不属于站点的普通地块）。
        assert.equal(text, '', `${site.id} 拼出了没人认识的句子：${text}`);
    }
    assert.ok(chestOnly > 0, '真表里一定有"前置是宝箱"的格子（chapter_01 有 222 处引用）');
    assert.ok(stageOnly > 0, '真表里一定有"前置是关卡"的格子');
});

test('★★★真表扫一遍：每句都不超过一个名字，也没有拼接痕迹', () => {
    const progress = new TerritoryProgress(map);
    const stageByCell = fakeStageByCell();
    for (const site of map.sites) {
        const blockers = progress.prerequisiteBlockers(site.cellId);
        if (!blockers.length) continue;
        const text = territoryPrerequisiteText(blockers, map.sites, stageByCell);
        assert.ok(!text.includes('、'), `${site.id} 还是拼了多个名字：${text}`);
        assert.ok(!text.includes('，'), `${site.id} 还是拼了两句话：${text}`);
        assert.ok(!text.includes('等'), `${site.id} 出现了「等」的兜底：${text}`);
    }
});

test('★★空串只出现在"一个都叫不出名字"的时候（普通地块前置）', () => {
    const progress = new TerritoryProgress(map);
    const stageByCell = fakeStageByCell();
    const siteByCell = new Map<number, string>();
    for (const site of map.sites) for (const cell of site.footprint) siteByCell.set(cell, site.id);
    for (const site of map.sites) {
        const blockers = progress.prerequisiteBlockers(site.cellId);
        if (!blockers.length) continue;
        const text = territoryPrerequisiteText(blockers, map.sites, stageByCell);
        if (text !== '') continue;
        assert.ok(
            blockers.some((cell) => !siteByCell.has(cell)) || stageByCell.size === 0,
            `${site.id} 的前置 [${blockers.join(',')}] 全都属于站点，不该拼出空串`,
        );
    }
});

// ---------------------------------------------------------------------------
// 接线守卫（拼好了但没人用 = 需求没做）
// ---------------------------------------------------------------------------

const modelSource = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');

test('★★★点击被前置挡住时必须走改写后的文案，而不是再弹那句通用的', () => {
    assert.ok(
        modelSource.includes('this.showTip(this.unlockBlockTip(check.reason, site));'),
        'canAffordUnlock 没走 unlockBlockTip ⇒ 玩家还是只看到「前置领地尚未占领」',
    );
    // 只改「前置没满足」这一条，其余 reason 原样透出（战力不足 / 在探索 / 已占领…）。
    assert.ok(modelSource.includes('if (reason !== TERRITORY_TEXTS.prerequisiteNotOwned) return reason;'));
});

test('★★★取名走气泡文案真源，本地不再拼一份 `chapterId-stage`', () => {
    const prerequisiteSource = readFileSync('assets/script/app/territory/model/TerritoryPrerequisite.ts', 'utf8');
    assert.ok(prerequisiteSource.includes('territoryLevelBubbleText(site, stage)'),
        '提示里的名字必须来自气泡文案真源');
    assert.ok(!prerequisiteSource.includes('chapterId}-'),
        '又在提示里自己拼编号了 ⇒ 异步据点会变成 `2-4`，与地图上的 `PVP` 对不上');
    assert.ok(modelSource.includes('progress.prerequisiteBlockers(target.cellId)'),
        '未满足的前置格必须问进度（与拦截判据同源），不能自己扫 requiredCells');
});
