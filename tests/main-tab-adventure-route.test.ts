import { MainTab, mainTabTarget } from '../assets/script/app/main/MainTabModel';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { assetUrl } from './helpers/asset-paths';

test('challenge tab stays visible but cannot open the old adventure page', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 旧挑战入口仍保留在底栏，但不再绑定切页回调或章节地图 prefab。
    // 世界格 2026-10-21 起改为大地图入口（不再是锁定态）。
    // 2026-11-04 起「角色 / 联盟」与挑战一起进未开放名单（名单唯一真源 = `MainTabModel.LOCKED_TABS`）。
    assert.deepEqual(mainTabTarget(MainTab.Challenge), { kind: 'locked' });
    assert.deepEqual(mainTabTarget(MainTab.Role), { kind: 'locked' });
    assert.deepEqual(mainTabTarget(MainTab.Alliance), { kind: 'locked' });
    assert.deepEqual(
        [MainTab.Shop, MainTab.Hero, MainTab.Territory].map(tab => mainTabTarget(tab)?.kind),
        ['page', 'page', 'page'],
        '商店 / 英雄 / 领地必须仍可切',
    );
    assert.match(source, /button\.setEnabled\(!isMainTabLocked\(type\)\)/);
    assert.doesNotMatch(source, /button\.setEnabled\(type !== MainTab\.Challenge\)/,
        '锁定判定必须读名单，不许在宿主里单独判挑战');
    assert.doesNotMatch(source, /if \(index === MainTab\.Challenge\) return this\.adventurePage;/);
    assert.doesNotMatch(source, /adventurePage/, '旧章节地图 prefab 入口应移除');
    const mainRoot = readFileSync(assetUrl('ui/main/MainRoot.prefab'), 'utf8');
    assert.doesNotMatch(mainRoot, /adventurePage|1a6ca85d-9a57-444a-abb7-0c7915f07dc0/,
        'MainRoot 不得残留失效的 TerritoryPage prefab 引用');
    const composition = readFileSync('assets/script/app/bootstrap/main/MainPageComposition.ts', 'utf8');
    assert.match(composition, /getComponentInChildren\(MainTerritoryMap\)/);
    assert.doesNotMatch(source, /if \(index === MainTab\.Adventure\) return this\.roleMainPage;/);
});

test('领地格 = 主城页（内嵌领地图），章节 HUD 由主城顶栏替代', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 「领地之后就是主城」：领地格加载主城页 `ArenaRoot`（里面嵌了 MainTerritoryMap 实例）。
    assert.deepEqual(mainTabTarget(MainTab.Territory), { kind: 'page', path: 'ui/main/ArenaRoot' });
    // 主城嵌入 map-only 页面，并在激活前注入资源。
    const composition = readFileSync('assets/script/app/bootstrap/main/MainPageComposition.ts', 'utf8');
    assert.match(composition, /getComponentInChildren\(MainTerritoryMap\)/);
    assert.match(composition, /territory\.initialize\(entry\.controller\.resources, entry\.saveOwner\)/);
    const tabs = readFileSync('assets/script/app/bootstrap/main/MainTabsComposition.ts', 'utf8');
    assert.ok(tabs.indexOf('new MainPageComposition') < tabs.indexOf('this.host.mountPage(node)'),
        '展示资源和业务控制器必须在页面激活前组装');
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
    const game = readFileSync(new URL('../assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', import.meta.url), 'utf8');
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
    assert.ok(existsSync(assetUrl('image/zdbg1.jpg')),
        '★默认底图 zdbg1 必须在 image/ 根目录（ART_ROOT）下');
    assert.match(assets, /spriteFramePath\(BUILDING_ART_ROOT, 'img_land_02'\)/);
    assert.match(game, /requestedEnemyCards/);
    assert.match(game, /baseConfig\.enemyDeck\.filter/);
    assert.match(game, /buildZCClientCombatConfig/);
    assert.doesNotMatch(game, /pve\.hpRate|pve\.attackRate/, '正式战斗倍率由服务端构筑，不叠加本地关卡倍率');
    assert.match(game, /pve\?\.mode === 'defence'/);
    assert.match(game, /pveDefence\?\.waves\.length/);
    assert.match(presenter, /playerCount: TERRITORY_DEFAULT_PLAYER_COUNT/);
    assert.match(game, /params\?\.pve\?\.playerCount/);
    assert.ok(existsSync(new URL('../assets/bundles/battle/image/gameui/bg_03.png', import.meta.url)));
    assert.ok(existsSync(assetUrl('image/buildings/hex_nor.png')));
});

test('PVE settlement returns to the territory main tab', () => {
    const builder = readFileSync(new URL('../assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', import.meta.url), 'utf8');
    const composition = readFileSync(new URL('../assets/script/app/bootstrap/battle/BattleComposition.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../assets/script/app/procedure/ProcedureMain.ts', import.meta.url), 'utf8');
    assert.match(builder, /initialTab: 'territory'/);
    assert.match(builder, /focusCellId: pve\.territoryCellId/);
    assert.match(composition, /this\.returnParams = buildZCBattleReturnParams\(entry\)/);
    assert.match(composition, /ProcedureManager\.navigate\(GameRoute\.Main, this\.returnParams\)/);
    assert.match(main, /params\.initialTab === 'territory' \? MainTab\.Territory/);
});
