import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('challenge tab stays visible but cannot open the old adventure page', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 旧挑战入口仍保留在底栏，但不再绑定切页回调或章节地图 prefab。
    // 世界格 2026-10-21 起改为大地图入口（不再是锁定态），锁定只剩挑战。
    assert.match(source, /const isLocked = type === MainTab\.Challenge;/);
    assert.match(source, /button\.bindSelect\(isLocked \? null : \(\) => \{ void this\.switchTab\(type\); \}\);/);
    assert.doesNotMatch(source, /if \(index === MainTab\.Challenge\) return this\.adventurePage;/);
    assert.doesNotMatch(source, /adventurePage/, '旧章节地图 prefab 入口应移除');
    const mainRoot = readFileSync(new URL('../assets/resources/ui/main/MainRoot.prefab', import.meta.url), 'utf8');
    assert.doesNotMatch(mainRoot, /adventurePage|1a6ca85d-9a57-444a-abb7-0c7915f07dc0/,
        'MainRoot 不得残留失效的 TerritoryPage prefab 引用');
    assert.match(source, /getComponentInChildren\(MainTerritoryMap\)/);
    assert.doesNotMatch(source, /if \(index === MainTab\.Adventure\) return this\.roleMainPage;/);
});

test('领地格 = 主城页（内嵌领地图），章节 HUD 由主城顶栏替代', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 「领地之后就是主城」：领地格加载主城页 `ArenaRoot`（里面嵌了 MainTerritoryMap 实例）。
    assert.match(source, /if \(index === MainTab\.Territory\) return 'ui\/main\/ArenaRoot';/);
    // 主城嵌入 map-only 页面，并在激活前注入资源。
    assert.match(source, /getComponentInChildren\(MainTerritoryMap\)/);
    assert.match(source, /mainTerritoryMap\.initialize\(this\.assets, this\.configs\)/);
    // showPage：注入必须在该方法内 setParent 之前。
    const showPageBody = source.slice(source.indexOf('private showPage('));
    assert.ok(showPageBody.indexOf('mainTerritoryMap.initialize(this.assets, this.configs)')
        < showPageBody.indexOf('page.setParent(this.content)'),
        'AssetService 必须在页面激活前注入');
    assert.doesNotMatch(source, /setHudVisible/);
});

test('territory stations open details and start a table-driven local PVE battle', () => {
    const page = readFileSync(new URL('../assets/script/app/main/MainTerritoryMap.ts', import.meta.url), 'utf8');
    // 2026-10-09 抽 Presenter 后：状态与编排（含开战、切章、开战导航组装）在纯 TS 的
    // TerritoryPresenter；存档调用在 SaveStoreAdapter；章节加载在 ChapterLoader；
    // Map host 只剩引擎接线（持有 Repository、弹窗、导航、定时器）。
    const presenter = readFileSync(new URL('../assets/script/app/territory/application/TerritoryPresenter.ts', import.meta.url), 'utf8');
    const adapter = readFileSync(new URL('../assets/script/app/territory/application/TerritorySaveStoreAdapter.ts', import.meta.url), 'utf8');
    const loader = readFileSync(new URL('../assets/script/app/territory/application/TerritoryChapterLoader.ts', import.meta.url), 'utf8');
    // 2026-09-30 拆分后：弹窗归 `LevelInfoPanel`，美术路径归 `TerritoryPageAssets`。
    const assets = readFileSync(new URL('../assets/script/app/territory/application/TerritoryPageAssets.ts', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../assets/script/app/procedure/ProcedureGame.ts', import.meta.url), 'utf8');
    // 章节战役由 ChapterLoader 加载（Page 不再直接调）。
    assert.match(loader, /loadTerritoryCampaign\(chapterId\)/);
    assert.match(page, /FALLBACK_CHAPTERS = \[1\]/);
    assert.match(presenter, /switchChapter/);
    assert.match(presenter, /territoryChapterCompletion/);
    // 按钮可用性改由 HUD 渲染数据表达（原来是直接写 `next.interactable`）。
    assert.match(presenter, /nextEnabled: hasNextChapter && completion\.complete/);
    // 「请先占领本章全部站点」字面文案在 TerritoryTexts（requireChapterComplete）。
    const texts = readFileSync(new URL('../assets/script/app/territory/application/TerritoryTexts.ts', import.meta.url), 'utf8');
    assert.match(texts, /请先占领本章全部站点/);
    // 章节记忆走 store 端口（委托断言读适配器）。
    assert.match(adapter, /this\.store\.loadLastChapter/);
    assert.match(adapter, /this\.store\.saveLastChapter/);
    // 站点详情面板已移除（2026-10-27）⇒ 关卡 / 首领改走 PopupBase 的「关卡界面」。
    assert.match(presenter, /selectSite\(site: TerritorySite\)/);
    assert.match(page, /LevelInfoPanel/);
    assert.equal(/this\.detailPanel/.test(page), false, '页面不该再有站点详情面板');
    // 真正的导航在 Page（outputs.navigateToBattle 由 Presenter 定义、Page 实现）。
    assert.match(page, /ProcedureManager\.navigate\(GameRoute\.Battle/);
    // 导航数据由 Presenter 组装。
    assert.match(presenter, /levelId: stage\.levelId/);
    assert.match(presenter, /enemyCardIds: stage\.enemies\.flatMap/);
    assert.match(presenter, /mode: stage\.mode/);
    assert.match(presenter, /waves: stage\.waves\.flatMap/);
    assert.match(presenter, /territoryCellId: site\.cellId/);
    assert.match(adapter, /this\.store\.beginBattle/);
    assert.match(presenter, /progress\.startExplore/);
    // 地图 JSON 背景缺省时（chapter_01~04 的background 都是空串）回落到默认图 zdbg1。
    // ⚠️ zdbg1 在 `image/` **根目录**、不在 `image/territory/` ⇒ 必须走 `ART_ROOT`；
    //    按 `TERRITORY_ART_ROOT` 拼会报 `Bundle resources doesn't contain image/territory/zdbg1`
    //    ——**不是 404**，极易误判成「美术没交图」（2026-10-10 换图时踩过）。
    assert.match(assets, /spriteFramePath\(ART_ROOT, DEFAULT_TERRITORY_BG_NAME\)/);
    assert.match(assets, /const DEFAULT_TERRITORY_BG_NAME = 'zdbg1'/);
    assert.ok(existsSync(new URL('../assets/resources/image/zdbg1.jpg', import.meta.url)),
        '★默认底图 zdbg1 必须在 image/ 根目录（ART_ROOT）下');
    assert.match(assets, /spriteFramePath\(BUILDING_ART_ROOT, 'img_land_02'\)/);
    assert.match(game, /requestedEnemyCards/);
    assert.match(game, /baseConfig\.enemyDeck\.filter/);
    assert.match(game, /maxHpPct: \(pve\.hpRate - 1\) \* 100/);
    assert.match(game, /attackPct: \(pve\.attackRate - 1\) \* 100/);
    assert.match(game, /sourceModifiers\?\.enemy/);
    assert.match(game, /captureZCMatchConfig\(\s*Object\.assign/);
    assert.match(game, /pve\?\.mode === 'defence'/);
    assert.match(game, /pveDefence\?\.waves\.length/);
    assert.match(presenter, /playerCount: TERRITORY_DEFAULT_PLAYER_COUNT/);
    assert.match(game, /params\?\.pve\?\.playerCount/);
    assert.ok(existsSync(new URL('../assets/bundles/battle/image/gameui/bg_03.png', import.meta.url)));
    assert.ok(existsSync(new URL('../assets/resources/image/buildings/hex_nor.png', import.meta.url)));
});

test('PVE settlement returns to the territory main tab', () => {
    const game = readFileSync(new URL('../assets/script/app/zcds/ZCGame.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../assets/script/app/procedure/ProcedureMain.ts', import.meta.url), 'utf8');
    assert.match(game, /ProcedureManager\.navigate\(GameRoute\.Main, \{ initialTab: 'territory' \}\)/);
    assert.match(main, /params\.initialTab === 'territory' \? MainTab\.Territory/);
});
