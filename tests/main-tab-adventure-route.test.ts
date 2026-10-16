import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('adventure tab opens the independent interactive territory page', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 冒险 tab = 独立 prefab（`ui/territory/TerritoryPage`），与角色页一样走整页替换；
    // 页面上的 `TerritoryPage` 组件由 prefab 自带，宿主只负责注入资源入口。
    assert.match(source, /adventurePage: Prefab = null!/);
    assert.match(source, /if \(index === MainTab\.Adventure\) return this\.adventurePage;/);
    assert.match(source, /getComponent\(TerritoryPage\)/);
    assert.doesNotMatch(source, /if \(index === MainTab\.Adventure\) return this\.roleMainPage;/);
});

test('territory stations open details and start a table-driven local PVE battle', () => {
    const page = readFileSync(new URL('../assets/script/app/territory/view/TerritoryPage.ts', import.meta.url), 'utf8');
    // 2026-10-09 抽 Presenter 后：状态与编排（含开战、切章、开战导航组装）在纯 TS 的
    // TerritoryPresenter；存档调用在 SaveStoreAdapter；章节加载在 ChapterLoader；
    // Page 只剩引擎接线（持有 Repository、弹窗、导航、定时器）。
    const presenter = readFileSync(new URL('../assets/script/app/territory/application/TerritoryPresenter.ts', import.meta.url), 'utf8');
    const adapter = readFileSync(new URL('../assets/script/app/territory/application/TerritorySaveStoreAdapter.ts', import.meta.url), 'utf8');
    const loader = readFileSync(new URL('../assets/script/app/territory/application/TerritoryChapterLoader.ts', import.meta.url), 'utf8');
    // 2026-09-30 拆分后：站点详情归 `TerritorySiteDetailPanel`，美术路径归 `TerritoryPageAssets`。
    const assets = readFileSync(new URL('../assets/script/app/territory/application/TerritoryPageAssets.ts', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../assets/script/app/procedure/ProcedureGame.ts', import.meta.url), 'utf8');
    // 章节战役由 ChapterLoader 加载（Page 不再直接调）。
    assert.match(loader, /loadTerritoryCampaign\(chapterId\)/);
    assert.match(page, /TERRITORY_CHAPTERS = \[1\]/);
    assert.match(presenter, /switchChapter/);
    assert.match(presenter, /territoryChapterCompletion/);
    // 按钮可用性改由 HUD 渲染数据表达（原来是直接写 `next.interactable`）。
    assert.match(presenter, /nextEnabled: hasNextChapter && completion\.complete/);
    // 「请先占领本章全部站点」字面文案在 TerritoryTexts（requireChapterComplete）。
    const texts = readFileSync(new URL('../assets/script/app/territory/application/TerritoryTexts.ts', import.meta.url), 'utf8');
    assert.match(texts, /请先占领本章全部站点/);
    // 章节记忆走 store 端口（委托断言读适配器）。
    assert.match(adapter, /TerritorySaveStore\.loadLastChapter/);
    assert.match(adapter, /TerritorySaveStore\.saveLastChapter/);
    // 站点详情改由独立弹窗承载（Presenter 的 intent 是 selectSite）。
    assert.match(presenter, /selectSite\(site: TerritorySite\)/);
    assert.match(page, /this\.detailPanel\.open\(/);
    // 真正的导航在 Page（outputs.navigateToBattle 由 Presenter 定义、Page 实现）。
    assert.match(page, /ProcedureManager\.navigate\(GameRoute\.Battle/);
    // 导航数据由 Presenter 组装。
    assert.match(presenter, /levelId: stage\.levelId/);
    assert.match(presenter, /enemyCardIds: stage\.enemies\.flatMap/);
    assert.match(presenter, /mode: stage\.mode/);
    assert.match(presenter, /waves: stage\.waves\.flatMap/);
    assert.match(presenter, /territoryCellId: site\.cellId/);
    assert.match(adapter, /TerritorySaveStore\.beginBattle/);
    assert.match(presenter, /progress\.startExplore/);
    // 地图 JSON 背景缺省时（chapter_01~04 的background 都是空串）回落到默认图 zdbg1。
    // ⚠️ zdbg1 在 `image/` **根目录**、不在 `image/territory/` ⇒ 必须走 `ART_ROOT`；
    //    按 `TERRITORY_ART_ROOT` 拼会报 `Bundle resources doesn't contain image/territory/zdbg1`
    //    ——**不是 404**，极易误判成「美术没交图」（2026-10-10 换图时踩过）。
    assert.match(assets, /spriteFramePath\(ART_ROOT, DEFAULT_TERRITORY_BG_NAME\)/);
    assert.match(assets, /const DEFAULT_TERRITORY_BG_NAME = 'zdbg1'/);
    assert.ok(existsSync(new URL('../assets/resources/image/zdbg1.jpg', import.meta.url)),
        '★默认底图 zdbg1 必须在 image/ 根目录（ART_ROOT）下');
    assert.match(assets, /spriteFramePath\(BUILDING_ART_ROOT, 'hex_nor'\)/);
    assert.match(game, /requestedEnemyCards/);
    assert.match(game, /baseConfig\.enemyDeck\.filter/);
    assert.match(game, /maxHpPct: \(pve\.hpRate - 1\) \* 100/);
    assert.match(game, /attackPct: \(pve\.attackRate - 1\) \* 100/);
    assert.match(game, /builtClientCombat\.config\.modifiers\?\.enemy/);
    assert.match(game, /captureZCMatchConfig\(\{/);
    assert.match(game, /pve\?\.mode === 'defence'/);
    assert.match(game, /pveDefence\?\.waves\.length/);
    assert.match(presenter, /playerCount: TERRITORY_DEFAULT_PLAYER_COUNT/);
    assert.match(game, /params\?\.pve\?\.playerCount/);
    assert.ok(existsSync(new URL('../assets/resources/image/gameui/bg_03.png', import.meta.url)));
    assert.ok(existsSync(new URL('../assets/resources/image/buildings/hex_nor.png', import.meta.url)));
});

test('PVE settlement records territory result and returns to adventure', () => {
    const game = readFileSync(new URL('../assets/script/app/zcds/ZCGame.ts', import.meta.url), 'utf8');
    const procedure = readFileSync(new URL('../assets/script/app/procedure/ProcedureGame.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../assets/script/app/procedure/ProcedureMain.ts', import.meta.url), 'utf8');
    assert.match(game, /this\.recordPveResult\(!retreated && state\.status === 'victory'\)/);
    assert.match(game, /if \(!retreated && !this\.pveContext\)/);
    assert.match(game, /pve\.onResult\(victory\)/);
    assert.match(game, /initialTab: 'adventure'/);
    assert.match(procedure, /TerritorySaveStore\.resolveBattle/);
    assert.match(main, /params\.initialTab === 'adventure' \? MainTab\.Adventure/);
});
