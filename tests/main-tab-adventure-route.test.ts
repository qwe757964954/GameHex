import { MainTab, mainTabTarget } from '../assets/script/app/main/MainTabModel';
import { MAIN_PAGES_BUNDLE } from '../assets/script/core/asset/BundleCatalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { assetUrl } from './helpers/asset-paths';

test('challenge tab stays visible but cannot open the old adventure page', () => {
    const source = readFileSync(new URL('../assets/script/app/main/MainTabHost.ts', import.meta.url), 'utf8');
    // 旧挑战入口仍保留在底栏，但不再绑定切页回调或章节地图 prefab。
    // 世界格 2026-10-21 起改为大地图入口（不再是锁定态）。
    // 2026-11-05 起「角色 / 联盟」恢复开放，未开放名单只剩挑战（唯一真源 = `MainTabModel.LOCKED_TABS`）。
    assert.deepEqual(mainTabTarget(MainTab.Challenge), { kind: 'locked' });
    assert.deepEqual(mainTabTarget(MainTab.Role), { kind: 'page', path: 'ui/Role/Role', bundle: MAIN_PAGES_BUNDLE });
    assert.deepEqual(mainTabTarget(MainTab.Alliance), { kind: 'page', path: 'ui/League/LeagueTab', bundle: MAIN_PAGES_BUNDLE });
    assert.deepEqual(
        [MainTab.Shop, MainTab.Hero, MainTab.Role, MainTab.Territory, MainTab.Alliance].map(tab => mainTabTarget(tab)?.kind),
        ['page', 'page', 'page', 'page', 'page'],
        '商店 / 英雄 / 角色 / 领地 / 联盟必须仍可切',
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
    // TerritoryPresenter；**2026-11 再拆一层** —— 状态机与编排全在 `TerritoryModel`，
    // Presenter 只剩「模型 → 视图状态 / 输出事件」的翻译，所以下面这些断言读 model。
    const model = readFileSync(new URL('../assets/script/app/territory/application/TerritoryModel.ts', import.meta.url), 'utf8');
    const adapter = readFileSync(new URL('../assets/script/app/territory/application/TerritorySaveStoreAdapter.ts', import.meta.url), 'utf8');
    const loader = readFileSync(new URL('../assets/script/app/territory/application/TerritoryChapterLoader.ts', import.meta.url), 'utf8');
    // 2026-09-30 拆分后：弹窗归 `LevelInfoPanel`，美术路径归 `TerritoryPageAssets`。
    const assets = readFileSync(new URL('../assets/script/app/territory/application/TerritoryPageAssets.ts', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', import.meta.url), 'utf8');
    // 章节战役由 ChapterLoader 加载（Page 不再直接调）。
    assert.match(loader, /loadTerritoryCampaign\(chapterId\)/);
    // 兜底章节号搬进了仓库（页面不再硬编码）；页面里连这个名字都不该再出现。
    const chapterInfo = readFileSync(
        new URL('../assets/script/app/territory/application/TerritoryChapterInfoRepository.ts', import.meta.url), 'utf8');
    assert.match(chapterInfo, /FALLBACK_CHAPTERS[^=]*= \[1\]/, '兜底章节的唯一真源在仓库');
    assert.doesNotMatch(page, /FALLBACK_CHAPTERS/, '页面不许再自带一份兜底章节');
    assert.match(model, /switchChapter/);
    assert.match(model, /territoryChapterCompletion/);
    // 按钮可用性改由 HUD 渲染数据表达（原来是直接写 `next.interactable`）。
    assert.match(model, /nextEnabled: hasNextChapter && completion\.complete/);
    // 🔴 2026-11-04 用户口径：通关 = 通过本章最后一个首领关卡（异步据点不参与）。
    //   这两条必须同时在：判据由纯函数给（`chapterFinalBossCell`），模型拿它覆盖
    //   「占领率满 = 通关」的老结论 —— 少任何一半，HUD 的下一章按钮和切章闸门就会打架。
    assert.match(model, /chapterFinalBossCell\(this\.stages\)/);
    assert.match(model, /complete = bossCellId === null\s*\?\s*completion\.complete\s*:/);
    // 拦人提示不再报「已占领 x/y」（占领率与通关条件已经不是一回事）。
    const texts = readFileSync(new URL('../assets/script/app/territory/application/TerritoryTexts.ts', import.meta.url), 'utf8');
    assert.match(texts, /请先通关本章最后一个首领关卡/);
    assert.doesNotMatch(texts, /请先占领本章全部站点/, '占领率口径的旧文案必须删掉，否则提示与判据自相矛盾');
    // 章节记忆走 store 端口（委托断言读适配器）。
    assert.match(adapter, /this\.store\.loadLastChapter/);
    assert.match(adapter, /this\.store\.saveLastChapter/);
    // 站点详情面板已移除（2026-10-27）⇒ 关卡 / 首领改走 PopupBase 的「关卡界面」。
    assert.match(model, /selectSite\(site: TerritorySite\)/);
    assert.match(page, /LevelInfoPanel/);
    assert.equal(/this\.detailPanel/.test(page), false, '页面不该再有站点详情面板');
    // 真正的导航在 Page（outputs.navigateToBattle 由模型定义、Page 实现）。
    // 🔴 2026-11-02 起普通关（`mode = match`）交给**匹配页**发开战请求，目的地是
    //    `GameRoute.Matching`（塔防关仍走 Battle 分支）。全项目只留 `commitBattleNav` 一处导航。
    assert.match(page, /ProcedureManager\.navigate\(GameRoute\.Matching/);
    assert.match(page, /commitBattleNav/);
    assert.doesNotMatch(page, /next\.interactable = /, '按钮可用性只从 HUD 数据来');
    // 导航数据由模型组装。
    assert.match(model, /levelId: stage\.levelId/);
    assert.match(model, /enemyCardIds: stage\.enemies\.flatMap/);
    assert.match(model, /mode: stage\.mode/);
    assert.match(model, /waves: stage\.waves\.flatMap/);
    assert.match(model, /territoryCellId: site\.cellId/);
    assert.match(adapter, /this\.store\.beginBattle/);
    assert.match(model, /progress\.startExplore/);
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
    assert.match(model, /playerCount: TERRITORY_DEFAULT_PLAYER_COUNT/);
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
