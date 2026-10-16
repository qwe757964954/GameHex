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

/** Presenter / View 两侧必须**逐字相同**的关卡分支条件。 */
const STAGE_BRANCH = "site.type === 'stage' || site.type === 'boss' || site.type === 'asyncPvp'";

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
    // 已解锁未通关：角标给「可通关」，颜色走 available（与 fixedResource「可领取」同口径）。
    assert.match(body, /stagePassClaimReady/, '解锁后要显示「可通关」角标');
    // 已通关：角标变「已通关」、颜色变 cleared（绿）、不可再点。
    assert.match(body, /stagePassClaimed/, '通关后要显示「已通关」角标');
    assert.match(body, /TERRITORY_COLORS\.cleared/, '通关后要用「已通关」绿');
    assert.match(body, /interactive: !claimed && !pending/, '已通关/请求中不可再点');
    // 解锁中（pendingFixedResourceCells）与 fixedResource 同一转圈通道。
    assert.match(body, /pendingFixedResourceCells\.includes\(site\.cellId\)/,
        '解锁请求进行中要复用 pending 转圈通道');
});

test('stationRenderOf 让 Boss 关（stage.isBoss）走两步式分支：可开战 / 已通关，不发通关角标', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('private stationRenderOf(');
    assert.ok(renderAt > 0, '找不到 stationRenderOf');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n    private ', renderAt + 10));
    // Boss 关（isBoss）与两步式关卡共用"先解锁展示建筑"分支，按 stage.isBoss 并入。
    assert.match(body, /stage\?\.isBoss/, '渲染层必须按 stage.isBoss 把首领关并入两步式分支');
    // 已解锁未通关：角标给「可开战」（Boss 关不发通关请求，改发 CmdStartBattleReqMsg）。
    assert.match(body, /bossBattleReady/, '解锁后要显示「可开战」角标');
    // 已通关：角标给「已通关」、颜色变 cleared（绿）。
    assert.match(body, /bossBattleClaimed/, '通关后要显示「已通关」角标');
    // 首领关文案：caption 显示「首领 N」（沿用普通首领关口径）。
    assert.match(body, /首领 \$\{stage\.stage\}/, 'Boss 关 caption 要显示首领序号');
});

test('stationRenderOf binds asyncPvp to the shared battle flow and turns unlocked cells red', () => {
    const renderAt = MAP_VIEW_SRC.indexOf('private stationRenderOf(');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf('\n    private ', renderAt + 10));
    assert.match(body, /const isAsyncPvp = site\.type === 'asyncPvp'/);
    assert.match(body, /isAsyncPvp && input\.progress\.isCellUnlocked\(site\.cellId\)[\s\S]*?territoryBossTint\(\)/,
        'unlocked async PvP station should use the danger tint');
    assert.match(body, /bossBattleReady/, 'async battle station should show the ready state');
    assert.match(body, /if \(isAsyncPvp && !stage\)[\s\S]*?TERRITORY_TEXTS\.pendingConfig/,
        'if a future table drops the binding, do not advertise an unstartable battle');
});

// ============================================================
// 已领取的宝箱格：彻底清空（2026-10-12）
// ============================================================

test('★★★已领取的 fixedResource 格必须同时清空 icon/caption/badge', () => {
    const renderAt = MAP_VIEW_SRC.indexOf("if (site.type === 'fixedResource')");
    assert.ok(renderAt > 0, '要能定位 fixedResource 渲染分支');
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));

    //🔴 三个必须**都**被 claimed 清掉，缺一个就不算「彻底」：
    assert.match(body, /icon:\s*claimed \? null :/,
        '已领取 ⇒ icon 必须为 null（宝箱图要藏掉）');
    assert.match(body, /caption:\s*pending \|\| claimed \? '' :/,
        '已领取 ⇒ caption 必须为空串');
    assert.match(body, /badge:\s*pending \|\| claimed \? '' :/,
        '已领取 ⇒ badge 必须为空串');
});

test('★★★「光把 icon 置 null」达不到彻底清空 —— render 会把底条/文字/角标全点亮', () => {
    // 这是本条最容易踩的坑：`TerritoryStationView.render` 里
    //   hasBuilding = !isCondition && content.icon !== null
    // icon 一旦为 null，hasBuilding=false ⇒下面三行 active 全部变 true：
    //   captionSprite.node.active = !isLoading && !hasBuilding && captionFrame !== null
    //   captionLabel.node.active  = !isLoading && !hasBuilding
    //   badgeLabel.node.active    = !isLoading && !hasBuilding && content.badge !== ''
    // ⇒ 图是没了，却**多出**「资源据点」底条 + 「已领取」角标 —— 比改之前更糟。
    const view = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    assert.match(view, /const hasBuilding = !isCondition && content\.icon !== null;/,
        'render 的显隐判据是 icon 是否为 null（改动后仍须是这条，MapView 才能靠传空串控制）');

    // 三个节点都挂了 !hasBuilding ⇒ 所以 MapView 侧必须三处一起清。
    const dependents = [
        /captionSprite\.node\.active = !isLoading && !hasBuilding/,
        /captionLabel\.node\.active = !isLoading && !hasBuilding/,
        /badgeLabel\.node\.active = !isLoading && !hasBuilding/,
    ];
    for (const re of dependents) {
        assert.match(view, re, '底条/文字/角标三者的 active 都受 hasBuilding 反向控制');
    }

    // 反向：claimed 分支不许再回落到 fixedResourceClaimed 文案。
    const renderAt = MAP_VIEW_SRC.indexOf("if (site.type === 'fixedResource')");
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));
    assert.ok(!/TERRITORY_TEXTS\.fixedResourceClaimed/.test(body),
        '地图上不该再出现「已领取」角标（那是领取成功提示条用的，不在这条路径）');
});

test('★★未领取的宝箱格不受影响：仍有图、仍有「可领取」角标、仍可点', () => {
    const renderAt = MAP_VIEW_SRC.indexOf("if (site.type === 'fixedResource')");
    const body = MAP_VIEW_SRC.slice(renderAt, MAP_VIEW_SRC.indexOf(STAGE_BRANCH_ANCHOR, renderAt));
    assert.match(body, /icon:\s*claimed \? null : this\.stationIconOf\(/,
        '未领取必须照常走 stationIconOf 取宝箱图');
    assert.match(body, /badge:\s*pending \|\| claimed \? '' : TERRITORY_TEXTS\.fixedResourceClaimReady/,
        '未领取要给「可领取」角标');
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

    // 判据 = 「这一格最终有没有图」，不是 type、不是 configId。
    assert.match(body, /const isPlainTwoStep = !boss && !isAsyncPvp && !this\.hasBuildingArt\(/,
        '必须按「最终有没有图」判定（与 stationIconOf 同一判据），不能按 type 硬判');
    assert.match(body, /caption:\s*pending \|\| isPlainTwoStep \? '' :/,
        '无建筑格必须清空 caption（「关卡」底条要消失）');
    assert.match(body, /badge:\s*pending \|\| isPlainTwoStep \? '' :/,
        '无建筑格必须清空 badge（「可通关」角标要消失）');
    // 🔴 图照画：有建筑的（328）不受这条影响。
    assert.match(body, /icon:\s*this\.stationIconOf\(site, stage, input\.art\),/,
        'icon 仍走 stationIconOf —— 有建筑的两步式格要保留建筑图');
});

test('★★★hasBuildingArt 必须是 stationIconOf 的薄转发（单一判据源）', () => {
    const src = MAP_VIEW_SRC;
    const helperAt = src.indexOf('private hasBuildingArt(');
    assert.ok(helperAt > 0, '要有 hasBuildingArt');
    const helper = src.slice(helperAt, src.indexOf('\n    private ', helperAt + 10));
    assert.match(helper, /return this\.stationIconOf\(site, stage, art\) !== null;/,
        '必须转发 stationIconOf —— 两处各判一次会漂移出「判有图、实际画 null」的错位');
    // 单一真源：stationIconOf 里没有第二个「返回 null」的早退。
    const iconAt = src.indexOf('private stationIconOf(');
    const iconFn = src.slice(iconAt, src.indexOf('private hasBuildingArt(', iconAt));
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
    assert.match(peers, /peer\.type === 'stage' \|\| peer\.type === 'boss' \|\| peer\.type === 'asyncPvp'/,
        '只有战斗类站点参与同区域（fixedResource 同 configId 有 3 格，绝不能算一起）');
    assert.match(peers, /typeof configId !== 'string' \|\| !\/\^\\d\+\$\/\.test\(configId\)/,
        'configId 必须是非空数字串才算同一片区域');
});
