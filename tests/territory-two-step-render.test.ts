/**
 * 关卡型站点（`stage` / `boss`）的**判定与渲染**护栏。
 *
 * 🔴 **2026-10-15 口径升级**：所谓「两步式」原本是**按格子 id 硬编码**的
 * （`TERRITORY_TWO_STEP_CELL_IDS = [327, 328]`，只有 `configId=10001` 这一片），
 * 于是关卡 1 点建筑就开战、关卡 2（10002）却只能弹详情面板。
 * 现在统一为「**站点类型 = stage / boss / asyncPvp** ⇒ 点一下：未解锁先解锁，已解锁直接发
 * `CmdStartBattleReqMsg` 开战」，硬编码名单连同 `isTerritoryTwoStepCell()` 一起删除。
 * `Presenter.selectSite` 与 `MapView.stationRenderOf` 必须**同口径**（都是站点类型），
 * 否则会出现「外观说能打、点了没反应」。
 *
 *  - 渲染分支在 `TerritoryMapView.stationRenderOf`（private + cc 依赖，Node 里不能 import），
 *    按工程既有做法做源码文本断言（同族见 `territory-cell-protocol.test.ts` / `territory-page-split.test.ts`）。
 *
 * ⚠️ 更早的 2026-10-12 三条口径（无建筑格清文案 / 区域共享通关 / 有建筑格必须可点）
 *    仍然有效，**只是判定从 cellId 名单换成了站点类型**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 关卡分支的起点（fixedResource 那段源码截取到它为止）。 */
const STAGE_BRANCH_ANCHOR = '\n        if (site.type === ';

/** Presenter / View 两侧必须**逐字相同**的关卡分支条件（站点类型走命名常量，禁字面量）。 */
const STAGE_BRANCH = "site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp";

const MAP_VIEW_SRC = readFileSync(
    'assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const PRESENTER_SRC = readFileSync(
    'assets/script/app/territory/application/TerritoryPresenter.ts', 'utf8');
const CONFIG_SRC = readFileSync(
    'assets/script/app/territory/model/TerritoryMapConfig.ts', 'utf8');

/**
 * 剥注释再看源码。
 *
 * ⚠️ **反向断言必须剥**（规则 104）：「两步式名单已删除」这件事被写进
 * `TerritoryMapConfig` / `TerritoryPresenter` 的说明注释里，不剥注释 ⇒ 这条断言会被自己的
 * 文档绊倒（命中注释、误判「名单还在」）。
 */
function codeOf(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('★★★关卡由**站点类型**判定：Presenter 与 View 同口径，且不再有任何 cellId 名单', () => {
    assert.match(PRESENTER_SRC, new RegExp(`if \\(${STAGE_BRANCH}\\)`),
        'Presenter 的 selectSite 必须按站点类型分流（= 「点建筑就打」对所有关卡成立）');
    assert.match(MAP_VIEW_SRC, new RegExp(`if \\(${STAGE_BRANCH}\\)`),
        'View 的 stationRenderOf 必须用同一条件（否则「外观能打、点了没反应」）');
    // 🔴 反向：按格子 id 的硬编码名单已经删掉 —— 每加一关就要改代码，漏改零报错。
    const code = codeOf(MAP_VIEW_SRC + PRESENTER_SRC + CONFIG_SRC);
    assert.ok(!/TERRITORY_TWO_STEP_CELL_IDS/.test(code),
        '两步式格子名单必须已删除（判据是站点类型，不再认 cellId）');
    assert.ok(!/isTerritoryTwoStepCell/.test(code),
        'isTerritoryTwoStepCell 不再有生产消费者（删除后不许复活）');
    // isBoss 也不再是准入条件（levelMod=1 的普通关卡照样要能打）。
    assert.ok(!/bossStage\?\.isBoss \|\|/.test(code),
        'selectSite 里不能再用 bossStage?.isBoss 当准入（levelMod=1 的关卡会被漏掉）');
});

test('★★关卡型站点的 configId 必须都能在 levelInfo 里找到（否则只能解锁、打不了）', () => {
    // 2026-10-15 统一口径之后，「能不能打」只取决于绑不绑得上 campaign stage；
    // 绑不上 ⇒ `handleUnlockOnly`（只解锁，点了不进战斗）。这条把数据现状钉住。
    const levelInfo = JSON.parse(readFileSync('assets/remoteRef/levelInfo.json', 'utf8')) as {
        k: string[]; v: unknown[][];
    };
    const rows = levelInfo.v.map((v) => Object.fromEntries(
        levelInfo.k.map((key, i) => [key, v[i]]))) as { levelChapter: number; levelId: number }[];
    for (const chapter of [1]) {
        const map = JSON.parse(readFileSync(
            `assets/resources/config/territory-maps/chapter_0${chapter}.json`, 'utf8')) as {
                sites: { cellId: number; type: string; configId?: string }[];
            };
        const levelIds = new Set(rows.filter((r) => r.levelChapter === chapter).map((r) => r.levelId));
        for (const site of map.sites) {
            if (site.type !== 'stage' && site.type !== 'boss' && site.type !== 'asyncPvp') continue;
            const levelId = Number(site.configId);
            assert.ok(Number.isInteger(levelId) && levelIds.has(levelId),
                `chapter_0${chapter} 的 ${site.configId}（cellId ${site.cellId}）在 levelInfo 里查不到`
                + ' ⇒ 绑不到 stage ⇒ 点它只会解锁、不会进战斗');
        }
    }
});

test('stationRenderOf 为关卡保留"解锁后展示建筑、通关后变绿"的渲染分支', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('private stationRenderOf(');
    assert.ok(renderAt > 0, '找不到 stationRenderOf');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n    private ', renderAt + 10));
    // 分支本体：按**站点类型**命中，不是按 cellId 名单。
    assert.match(body, new RegExp(`if \\(${STAGE_BRANCH}\\)`),
        '渲染层必须按站点类型判定关卡分支');
    assert.doesNotMatch(body, /stagePassClaimReady|stagePassClaimed/, '地图不再叠加状态文字');
    assert.match(body, /TERRITORY_COLORS\.cleared/, '通关后要用「已通关」绿');
    // 🔴 2026-10-28 用户：「点击已通过的关卡也可以打开【领地关卡信息弹窗】」。
    // 这里原来钉的是 `interactive: (claimed ? isAsyncPvp : true) && !pending` ——
    // 打完的主线 stage/boss 直接不可点，弹窗打不开。现在**已通关也可点**，
    // 唯一不可点是请求在途（防连点）。
    assert.match(body, /interactive: !pending/,
        '已通关的关卡也要能点（打开信息弹窗）；只有请求在途时禁掉');
    // 解锁中（pendingFixedResourceCells）与 fixedResource 同一转圈通道。
    assert.match(body, /pendingFixedResourceCells\.includes\(site\.cellId\)/,
        '解锁请求进行中要复用 pending 转圈通道');
});

test('首领站点保留建筑渲染及共享战斗流程，不生成首领序号和状态文字', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('private stationRenderOf(');
    assert.ok(renderAt > 0, '找不到 stationRenderOf');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n    private ', renderAt + 10));
    assert.match(body, new RegExp(`if \\(${STAGE_BRANCH}\\)`));
    assert.match(body, /icon: this\.stationIconOf\(site, stage, input\.art\)/);
    assert.doesNotMatch(body, /bossBattleReady|bossBattleClaimed|首领 \$\{stage\.stage\}/);
});

test('stationRenderOf binds asyncPvp to the shared battle flow and turns unlocked cells red', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('private stationRenderOf(');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n    private ', renderAt + 10));
    assert.match(body, /const isAsyncPvp = site\.type === TERRITORY_SITE_TYPE\.asyncPvp/);
    assert.match(body, /isAsyncPvp && input\.progress\.isCellUnlocked\(site\.cellId\)[\s\S]*?territoryBossTint\(\)/,
        'unlocked async PvP station should use the danger tint');
    assert.match(body, /if \(isAsyncPvp && !stage\)[\s\S]*?interactive: !isUnlocked && !isOwned/,
        '缺失战斗配置时仍保留交互限制');
});

// ============================================================
// 已领取的宝箱格：彻底清空（2026-10-12）
// ============================================================

test('★★★已领取的 fixedResource 格必须同时清空 icon/caption/badge', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('if (site.type === TERRITORY_SITE_TYPE.fixedResource)');
    assert.ok(renderAt > 0, '要能定位 fixedResource 渲染分支');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));

    //🔴 三个必须**都**被 claimed 清掉，缺一个就不算「彻底」：
    assert.match(body, /icon:\s*claimed \? null :/,
        '已领取 ⇒ icon 必须为 null（宝箱图要藏掉）');
    assert.match(body, /caption:\s*''/,
        '已领取 ⇒ caption 必须为空串');
    assert.match(body, /badge:\s*''/,
        '已领取 ⇒ badge 必须为空串');
});

test('无建筑图标时不再启用兜底文字，只有未解锁条件可以显示银币图标与数值', () => {
    const view = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    const dependents = [
        /captionSprite\.node\.active = !isHidden && !isLoading && isCondition/,
        /captionLabel\.node\.active = !isHidden && !isLoading && isCondition/,
        // 2026-10-28 起角标不再「恒 false」：文字被收进新建的 `LevelBubble` 根里，
        // `badgeLabel` / 气泡根都跟着同一个 `visible` 开关 —— 没有文案时两者都关，
        // 所以这里钉的是「跟 `visible` 走」，不是写死的 false。
        /this\.badgeLabel\.node\.active = visible/,
        /bubble\.node\.active = visible/,
    ];
    for (const re of dependents) {
        assert.match(view, re);
    }

    // 反向：claimed 分支不许再回落到 fixedResourceClaimed 文案。
    const renderAt = MAP_VIEW_SRC.indexOf('if (site.type === TERRITORY_SITE_TYPE.fixedResource)');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));
    assert.ok(!/TERRITORY_TEXTS\.fixedResourceClaimed/.test(body),
        '地图上不该再出现「已领取」角标（那是领取成功提示条用的，不在这条路径）');
});

test('未领取的宝箱格保留图标和交互，地图上不显示「可领取」文字', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('if (site.type === TERRITORY_SITE_TYPE.fixedResource)');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));
    assert.match(body, /icon:\s*claimed \? null : this\.stationIconOf\(/,
        '未领取必须照常走 stationIconOf 取宝箱图');
    assert.match(body, /badge:\s*''/, '不再生成状态角标');
    assert.match(body, /interactive:\s*!claimed && !pending/,
        '已领取不可点（否则会重复发通关请求）');
    assert.match(body, /tint:\s*claimed \? TERRITORY_COLORS\.cleared/,
        '已领取仍用「已通关」绿色地块表达 —— 这是清空后唯一的视觉标记');
});

// ============================================================
// 关卡（含无建筑格 327）：无建筑 ⇒ 不挂文案；同区域共享通关状态（2026-10-12）
// ============================================================

test('★★★无建筑的关卡格（327）必须清空 caption 与 badge', () => {
    // 山猫原话：「关卡 可 通关去掉」——截图上 327 那个黄块挂着「关卡」底条 + 「可通关」角标。
    const renderAt = MAP_VIEW_SRC.indexOf(`if (${STAGE_BRANCH})`);
    assert.ok(renderAt > 0, '要能定位关卡渲染分支');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n        if (!stage)', renderAt));

    assert.match(body, /caption:\s*''/,
        '无建筑格必须清空 caption（「关卡」底条要消失）');
    assert.match(body, /badge:\s*''/,
        '无建筑格必须清空 badge（「可通关」角标要消失）');
    // 🔴 图照画：有建筑的（328）不受这条影响。
    assert.match(body, /icon:\s*this\.stationIconOf\(site, stage, input\.art\),/,
        'icon 仍走 stationIconOf —— 有建筑的两步式格要保留建筑图');
});

test('建筑图仍由 stationIconOf 决定，移除仅为兜底文字使用的判断方法', () => {
    const src = MAP_VIEW_SRC;
    assert.doesNotMatch(src, /hasBuildingArt|isPlainTwoStep/);
    // 单一真源：stationIconOf 里没有第二个「返回 null」的早退。
    const iconAt = src.indexOf('private stationIconOf(');
    const iconFn = src.slice(iconAt, src.indexOf('private stateOf(', iconAt));
    assert.equal((iconFn.match(/return null;/g) ?? []).length, 1,
        'stationIconOf 只应有一个「不画图」的早退（stage/boss 无 buildingId）');
});

test('★★★同区域共享通关：claimed 走 isAreaPassed，不是 isOwned', () => {
    // 山猫原话：「327 与 328 configId 一样，都是打同一关卡，327 328 就算一起的」。
    const renderAt = MAP_VIEW_SRC.indexOf(`if (${STAGE_BRANCH})`);
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n        if (!stage)', renderAt));
    assert.match(body, /const claimed = input\.progress\.isAreaPassed\(site\.cellId\);/,
        '关卡分支的已通关判定必须走区域口径（否则打 327 后 328 还显示「可通关」）');
    assert.ok(!/const claimed = input\.progress\.isOwned\(site\.cellId\);/.test(body),
        '不能退回单格 isOwned —— 那正是本次要修的现象');
});

test('★★isAreaPassed 只在查询态扩散，绝不把同区域格子写进 owned', () => {
    const progress = readFileSync('assets/script/app/territory/model/TerritoryProgress.ts', 'utf8');
    const at = progress.indexOf('isAreaPassed(cellId: number)');
    assert.ok(at > 0, 'TerritoryProgress 要有 isAreaPassed');
    const body = progress.slice(at, progress.indexOf('isOwned(cellId: number)', at));
    assert.match(body, /if \(this\.owned\.has\(cellId\)\) return true;/,
        '已占领自身格也必须显示为已通关');
    assert.match(body, /return area\.some\(\(peer\) => this\.owned\.has\(peer\)\);/,
        'isAreaPassed 只能读 owned 做查询，绝不能 add（同区域一旦写进 owned ⇒ 存档多出没打过的格子、'
        + '服务端快照回来会被当成待确认而反复重报通关）');
    assert.ok(!/this\.owned\.add/.test(body),
        '🔴 isAreaPassed 里出现 owned.add 就是致命 bug：存档与通关上报都会错');
    // areaPeers 的范围：stage/boss/asyncPvp 且 configId 相同的才算同区域。
    const peersAt = progress.indexOf('areaPeers(cellId: number)');
    const peers = progress.slice(peersAt, progress.indexOf('isAreaPassed(cellId: number)', peersAt));
    assert.match(peers, /peer\.type === TERRITORY_SITE_TYPE\.stage \|\| peer\.type === TERRITORY_SITE_TYPE\.boss \|\| peer\.type === TERRITORY_SITE_TYPE\.asyncPvp/,
        '只有战斗类站点参与同区域（fixedResource 同 configId 有 3 格，绝不能算一起）');
    assert.match(peers, /typeof configId !== 'string' \|\| !\/\^\\d\+\$\/\.test\(configId\)/,
        'configId 必须是非空数字串才算同一片区域');
});
