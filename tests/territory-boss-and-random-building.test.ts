/**
 * 领地「关卡发战斗请求」+「随机格逐格建筑」两条口径的守卫（2026-10-10）。
 *
 * 山猫的原话：
 *  1. 「**Boss 关卡，不需要发通关请求，要发战斗请求，`CmdStartBattleReqMsg`，
 *      battleType 章节战斗类型用 1002，battleParams 传 cellid 之类的**」
 *  2. 「**随机格子只有有建筑 id 的才显示建筑，不然就是绿色的地块**」
 *  3. 「**cellId 328 和 cellId 327 的战斗/配置 ID 相同（10001），只显示有建筑 id 的才显示建筑**」
 *     （2026-10-12）—— 这条是 2 在**固定站点**上的对应口径：关卡/首领没配 `buildingId` 就不画建筑。
 *
 * ⚠️ 为什么全用源码文本断言：`TerritoryMapView` / `TerritoryPresenter` 顶部import `cc`
 * （经 `ArtPaths` / `JsonAsset` 等），Node 里 import 就 `Cannot find module 'cc'`
 * （MEMORY 规则 78）。纯源码断言看似弱，但它是**唯一**能在 Node 里钉住 cc 依赖代码
 * 的手段（同族见 `territory-cell-protocol.test.ts` / `formation-board.test.ts`）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// ⚠️ 本文件绝大多数用例是源码文本断言（因为 Presenter/View 顶部 import `cc`），
// 但 `BattleStartModel` 是**零引擎依赖**的纯函数层（Node 可直接 import，
// 同 `battle-start-protocol.test.ts` 的做法）⇒ 新加的参数构造在这儿跑真函数，不靠正则读字符串。
import {
    chapterCellBattleParams,
    chapterTreasureBattleParams,
    ZC_BATTLE_TYPE_CHAPTER,
    ZC_CHAPTER_BATTLE_SUB_CELL,
    ZC_CHAPTER_BATTLE_SUB_TREASURE,
} from '../assets/script/app/battle/BattleStartModel';

const PRESENTER_PATH = 'assets/script/app/territory/application/TerritoryPresenter.ts';
const VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const MODEL_PATH = 'assets/script/app/battle/BattleStartModel.ts';
const MAP_CONFIG_PATH = 'assets/script/app/territory/model/TerritoryMapConfig.ts';

/** 截取某个顶层成员（含其方法体），到下一个同缩进成员为止。 */
function memberOf(src: string, signature: string): string {
    const start = src.indexOf(signature);
    assert.ok(start >= 0, `要能定位：${signature}`);
    // 从这一行的缩进找到「同缩进的下一个定义」当终点 —— 比按函数名更稳（顺序会变）。
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start).match(/^\s*/)?.[0] ?? '';
    const rest = src.slice(start + signature.length);
    const next = rest.search(new RegExp(`\\n${indent}(?:private |public |async |readonly |\\w+\\()`));
    return next < 0 ? src.slice(start) : src.slice(start, start + signature.length + next);
}

/**
 * 剥注释再看源码。
 *
 * ⚠️ 形状/反向断言**必须**剥（规则 104）：被禁止的写法常常正大光明出现在
 *「不要这么写」的说明注释里（`selectSite` 上方就复述了旧的两步式名单），
 * 不剥 ⇒ 旧口径被注释复活，用例变成**假绿**。
 */
function codeOf(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ============================================================
// 一、battleType = 1002（固定章节战斗类型）
// ============================================================

test('★battleType 章节战斗类型固定 1002，且与 PVP(1001) 同段不同值', () => {
    const model = readFileSync(MODEL_PATH, 'utf8');
    assert.match(model, /export const ZC_BATTLE_TYPE_PVP = 1001;/, 'PVP 仍是 1001');
    assert.match(model, /export const ZC_BATTLE_TYPE_CHAPTER = 1002;/,
        '章节战斗类型必须是常量 1002（山猫 2026-10-10 给的口径）');
    // 同段不同值：撞值会让服务端把章节战斗当成 PVP 匹配局。
    const pvp = model.match(/ZC_BATTLE_TYPE_PVP\s*=\s*(\d+)/)?.[1];
    const chapter = model.match(/ZC_BATTLE_TYPE_CHAPTER\s*=\s*(\d+)/)?.[1];
    assert.notEqual(pvp, chapter, 'PVP 与章节战斗的 battleType 不能相同');
});

test('★★关卡开战发CmdStartBattleReqMsg：battleType 用常量、不是 site.configId', () => {
    const src = readFileSync(PRESENTER_PATH, 'utf8');
    const boss = memberOf(src, 'private async handleBattleStationStart');

    assert.match(boss, /gateway\.startBattle\(\s*ZC_BATTLE_TYPE_CHAPTER/,
        'boss 开战的 battleType 必须是 ZC_BATTLE_TYPE_CHAPTER');
    // 🔴 反向：绝不能再把 configId 当 battleType 发出去 ——
    // 实测症状：服务端把 10001 当未知类型，点关卡没反应。
    assert.ok(!/startBattle\(\s*(?:configId|Number\(site\.configId\))/.test(boss),
        'battleType 不能是 site.configId（关卡身份靠 battleParams 的 cellId，不是 battleType）');

    // battleParams 口径：[子类型, 章节id, cellId]（山猫 2026-10-15 定「1002 的战斗里嵌子类型：
    // 下标 0 = 子类型、1 = 格子战斗、2 = 宝箱战斗；子类型为 1 时下标 1 = 章节、下标 2 = 格子id」）
    // 🔴 必须走 chapterCellBattleParams 这个唯一构造入口，不能在 Presenter 里内联数组 ——
    //    内联就会漏掉下标 0 的子类型 ⇒ 服务端当未知子类型，症状是「点了没反应」且零报错。
    assert.match(boss, /chapterCellBattleParams\(map\.chapterId, site\.cellId\)/,
        'battleParams 必须由 chapterCellBattleParams 组（= [子类型, 章节id, cellId]）');
    assert.ok(!/\[\s*String\(map\.chapterId\)/.test(boss),
        'battleParams 不能在 Presenter 里内联（会漏掉下标 0 的子类型）');
});

// ============================================================
// 一之二、1002 内嵌子类型（2026-10-15）
// ============================================================

test('★★1002 子类型：格子战斗/宝箱战斗 battleParams = [子类型, 章节id, 格子id]，且全是字符串', () => {
    assert.equal(ZC_CHAPTER_BATTLE_SUB_CELL, 1, '子类型 1 = 格子战斗');
    assert.equal(ZC_CHAPTER_BATTLE_SUB_TREASURE, 2, '子类型 2 = 宝箱战斗');
    // 这两个值是**服务端约定**，改了要连后端一起改，且改错零报错（未知子类型被忽略）。
    assert.equal(ZC_CHAPTER_BATTLE_SUB_CELL, 1);
    assert.notEqual(ZC_BATTLE_TYPE_CHAPTER, ZC_CHAPTER_BATTLE_SUB_CELL,
        '子类型是 battleParams[0]，跟 battleType(1002) 是两回事，别混用同一个常量');

    assert.deepEqual(chapterCellBattleParams(1, 327), ['1', '1', '327'],
        '格子战斗 = [子类型(1), 章节id, 格子id]');
    assert.deepEqual(chapterCellBattleParams(3, 2), ['1', '3', '2'],
        '章节id 变了只是下标 1 跟着变，子类型恒在下标 0');
    // proto 里 battleParams 是 repeated string：塞数字会被 writer 静默写成空串 list。
    const params = chapterCellBattleParams(1, 327);
    for (const value of params) assert.equal(typeof value, 'string', '每个元素都必须是字符串');
    assert.equal(params[0], String(ZC_CHAPTER_BATTLE_SUB_CELL), '子类型占下标 0');
    assert.equal(params[2], '327', '格子id 占下标 2');

    // 宝箱战斗与格子战斗**同结构**（山猫 2026-10-15 定「对称」），只有下标 0 是 2。
    assert.deepEqual(chapterTreasureBattleParams(1, 327), ['2', '1', '327'],
        '宝箱战斗 = [子类型(2), 章节id, 格子id] —— 布局与格子战斗一致，只换子类型');
    // 🔴 两者必须只差下标 0：服务端按下标 0 分流之后，后面每个位置的语义要完全一致。
    assert.equal(chapterTreasureBattleParams(1, 327).length, params.length,
        '两种战斗的参数个数必须相同（布局对称）');
    assert.deepEqual(chapterTreasureBattleParams(1, 327).slice(1), params.slice(1),
        '两种战斗除下标 0 外逐项相同（章节id / 格子id 位置不能变）');
});

// ============================================================
// 一之二、关卡统一开战（2026-10-15）
// ============================================================

test('★★所有战斗站点（stage/boss/asyncPvp）都走开战流程，绝不能发通关请求', () => {
    const src = readFileSync(PRESENTER_PATH, 'utf8');
    const select = memberOf(src, 'selectSite(site: TerritorySite): void');
    // ⚠️ 必剥注释：`selectSite` 上方的说明会**复述旧写法**
    //    （「早前这里只有 bossStage?.isBoss || isTerritoryTwoStepCell(...)」），
    //    不剥 ⇒ 旧口径被注释复活成**假绿**（规则 104 的同款陷阱）。
    const code = codeOf(select);
    // 2026-10-27：stage / boss 也改成「点格子先弹关卡界面」，开战挪到面板的按钮上
    // （`requestBattle` → `handleBattleStationStart`）。`selectSite` 里只留选站点。
    // 2026-10-28：这组「战斗站点」类型判断原来在 `selectSite` 里逐处枚举了两遍
    //（再加 `requestBattle` 一遍）⇒ 收口到 `isBattleSite`。判据改成两段：
    // ① 分流入口认 `isBattleSite`；② 那个方法的类型集合必须**恰好**是 stage/boss/asyncPvp。
    assert.match(code, /if \(this\.isBattleSite\(site\)\)/,
        '战斗站点必须按类型分流，不再认 cellId 名单');
    const battleSite = codeOf(memberOf(src, 'private isBattleSite(site: TerritorySite): boolean'));
    for (const type of ['stage', 'boss', 'asyncPvp']) {
        assert.ok(battleSite.includes(`TERRITORY_SITE_TYPE.${type}`),
            `isBattleSite 必须涵盖 ${type}（漏一个就是「点了没反应」且零报错）`);
    }
    // 战斗站点分支里**不许**直接开战：开战只能由弹窗的「开始战斗」按钮调 requestBattle 发起。
    assert.ok(!/handleBattleStationStart/.test(code),
        '战斗站点分支不许直接开战 —— 先弹界面，按钮再走 requestBattle');
    assert.match(code, /this\.detailSite = site/, '战斗站点分支要选中站点给弹窗用');
    assert.ok(!/isTerritoryTwoStepCell/.test(code),
        '不许再按格子 id 名单判定（每加一关改一次代码，漏改的症状是「点了没反应」且零报错）');
    assert.ok(!/bossStage\?\.isBoss/.test(code),
        'isBoss 不再当准入条件（levelMod=1 的普通关卡照样要能打）');
    // 开战链路必须还在 `requestBattle` 里（弹窗按钮走的就是它），且要认 asyncPvp。
    const requestBattle = codeOf(memberOf(src, 'requestBattle(): void'));
    assert.match(requestBattle, /handleBattleStationStart/,
        'requestBattle 必须通向 handleBattleStationStart（走 CmdStartBattleReqMsg）');
    assert.match(requestBattle, /this\.isBattleSite\(site\)/,
        'requestBattle 必须把 asyncPvp 纳入开战分流（弹窗按钮走的就是它）');

    // ⚠️ 通关只留给资源点：fixedResource 走 `handleUnlockThenPass`，
    // 关卡一旦发通关，服务端回「章节格子非资源类型」（早期实机踩过）。
    const unlockOnly = memberOf(src, 'private async handleUnlockOnly');
    assert.ok(!/gateway\.passCell\(/.test(codeOf(unlockOnly)),
        '关卡分支里不能有 passCell —— 那是「章节格子非资源类型」被拒的来源');
});

test('★★bind不到 stage 的关卡只解锁、绝不发通关（防御性兜底）', () => {
    const src = readFileSync(PRESENTER_PATH, 'utf8');
    const unlockOnly = memberOf(src, 'private async handleUnlockOnly');
    assert.ok(unlockOnly.length > 0, 'handleUnlockOnly 要能定位');
    assert.match(unlockOnly, /gateway\.unlockCell\(/, '只解锁：必须发 unlockCell');
    assert.ok(!/gateway\.passCell\(/.test(unlockOnly),
        'handleUnlockOnly 里不能有 passCell —— 那是「章节格子非资源类型」被拒的来源');
    assert.ok(!/gateway\.startBattle\(/.test(unlockOnly),
        '绑不到 stage 就无从开战（battleParams 没关卡语义），此时只解锁');
});

// ============================================================
// 二、随机格：逐格建筑 id，没有就绿色地块
// ============================================================

test('★★★随机格按 randomSites.buildingIds[cellId] 逐格取建筑，键要Number 归一', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const start = src.indexOf('for (const cellId of input.map.randomSites?.candidateCells ?? [])');
    assert.ok(start > 0, '要能定位随机格渲染循环');
    // 边界：这个 for 循环到下一个同缩进的 `for` 为止。
    const next = src.indexOf('\n        for (const [cellId, view]', start);
    const loop = src.slice(start, next > start ? next : undefined);

    assert.match(loop, /randomSites\?\.buildingIds\?\.\[cellId\]/,
        '随机格必须读 randomSites.buildingIds[cellId]（逐格配的那个）');
    // ⚠️ buildId 在表里是数字、地图 JSON 里是字符串 —— 不Number 归一就是永远查不到、
    // 静默退回默认图，表现为「配了 id 但外观没变」，且零报错。
    assert.match(loop, /Number\(input\.map\.randomSites\?\.buildingIds\?\.\[cellId\]/,
        '查表键必须 Number(...) 归一（表里是数字、地图里是字符串）');
    assert.match(loop, /buildFrames\?\.get\(buildingId\)/,
        '建筑帧要经 buildFrames 查（buildId → 贴图）');
});

test('★★★随机格没配buildingId 时不给建筑图，只保留绿色地块', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const start = src.indexOf('for (const cellId of input.map.randomSites?.candidateCells ?? [])');
    const next = src.indexOf('\n        for (const [cellId, view]', start);
    const loop = src.slice(start, next > start ? next : undefined);

    // 图标来源必须是「查表结果」，可能为 null —— 不能是固定那张图。
    assert.ok(!/icon:\s*isOpened \? input\.art\.randomResource/.test(loop),
        '不能再一律用 art.randomResource（那张固定图）—— 没配 id 的格会错画成建筑');
    assert.match(loop, /icon:\s*openedFrame/,
        '图标必须是逐格查表的结果 openedFrame（没配 id 时为 null ⇒ 不画建筑）');
    // 绿色地块 = 已开启时的 cleared 色调。
    assert.match(loop, /tint:\s*isOpened \? TERRITORY_COLORS\.cleared/,
        '开启后一律用 cleared（绿）色调 —— 没配 id 的开启格就是绿色地块');
    // 开启前仍显示银币条件（不是绿色）。
    assert.match(loop, /conditionIcon:\s*input\.art\.randomSilverIcon/,
        '开启前显示消耗条件（银币），别被「绿色地块」口径带偏');
});

test('★★art.randomResource 已无渲染消费者 —— 留字段但要写明为什么没删', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    // 字段声明处的注释必须写清「已不是随机格外观来源」+「清理时要两处一起改」，
    // 否则下一个人看到「没人用」会直接删掉、把 build.json 的69006 贴图来源一起弄坏。
    const declAt = src.indexOf('readonly randomResource: SpriteFrame | null;');
    assert.ok(declAt > 0, 'randomResource 字段还在');
    const doc = src.slice(Math.max(0, src.lastIndexOf('/**', declAt)), declAt);
    assert.match(doc, /已不是随机格的外观来源/, '字段注释要写明它已不是随机格外观来源');
    assert.match(doc, /两处一起改/, '注释要写明清理时必须连loadTerritoryBattleArt 一起改');
});

// ============================================================
// 二之二、固定站点：关卡/首领只有配了 buildingId 才画建筑（2026-10-12）
// ============================================================

test('★★★★关卡/首领/异步据点没配buildingId 必须 return null，不许回退到 type 图', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const start = src.indexOf('private stationIconOf');
    const end = src.indexOf('private stateOf', start);
    assert.ok(start > 0 && end > start, 'stationIconOf 要能定位');
    const fn = src.slice(start, end);
    // 🔴 剥注释后再比位置 —— 注释里也出现了 `TERRITORY_SITE_ART` 字样，
    //    不剥就会命中注释而非代码，得出「早退在回退之后」的反向假结论（规则 104）。
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // 🔴 本条是 r534 那次修复的核心：注释改成新口径、却没删实现里的 type 回退，
    //    于是 327（buildingId=""）fallback 到 art.stage = territory_outpost_v1，
    //    而 328 的 69004 查表**恰好也是同一张** ⇒ 两格长得一模一样，
    //    视觉上仍是「一片区域到处是建筑」，且零报错。
    // 🔴 2026-10-16 山猫「异步战点也要跟 Boss 一样，通关 / 解锁都是有建筑 id 才显示建筑」
    //    ⇒ `asyncPvp` 并入本名单（chapter_01 的 16 个异步据点只有 4 个配了 69002）。
    assert.match(code, /if\s*\(site\.type === TERRITORY_SITE_TYPE\.stage \|\| site\.type === TERRITORY_SITE_TYPE\.boss \|\| site\.type === TERRITORY_SITE_TYPE\.asyncPvp\) return null;/,
        'stage/boss/asyncPvp 没配 buildingId 时必须直接 return null（不能落到 TERRITORY_SITE_ART 回退）');
    // 反向守卫：`asyncPvp` **不许**从这条早退里掉队 —— 掉了就是「异步据点又回到按 type 取图」，
    // 症状是没配 id 的 12 个异步据点全部长成同一个敌方主城外观（零报错）。
    assert.doesNotMatch(code, /site\.type === TERRITORY_SITE_TYPE\.stage \|\| site\.type === TERRITORY_SITE_TYPE\.boss\) return null;/,
        'asyncPvp 必须在这条早退里，别被"精简"回 stage/boss 两条');

    // 反向：type 回退仍保留，但只能服务于 fixedResource / bonus。
    //  宝箱（chapter_01 有 82 个）全部没配 buildingId，一刀切会让它们集体消失。
    assert.match(code, /TERRITORY_SITE_ART\[site\.type\]/,
        '非战斗类站点仍按 type 取图（fixedResource/bonus 没配 buildingId 也得有图）');
    // 🔴 早退必须**在** type 回退**之前**，否则等于没改。
    assert.ok(code.indexOf('site.type === TERRITORY_SITE_TYPE.stage') < code.indexOf('TERRITORY_SITE_ART'),
        '三类战斗站点的 null 早退必须排在 TERRITORY_SITE_ART 回退之前');
});

test('★★★同一 configId 区域内，配了 buildingId 的站点恰好一个且画的是它', () => {
    // 山猫 2026-10-12 的原话：cellId 328 与 327 战斗/配置 ID 相同（10001），
    // 但只有一个该显示建筑。用真实地图 JSON 钉住这条数据事实。
    const mapJson = JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const sites = mapJson.sites as { id: string; type: string; cellId: number; configId?: string; buildingId?: string }[];

    const byConfig = new Map<string, typeof sites>();
    for (const site of sites) {
        const cid = String(site.configId ?? '');
        if (!/^\d+$/.test(cid)) continue;
        if (!byConfig.has(cid)) byConfig.set(cid, []);
        byConfig.get(cid)!.push(site);
    }

    // 10001 = stage_4(327, 无建筑) + stage_5(328, buildingId=69004)
    const area = byConfig.get('10001');
    assert.ok(area && area.length === 2, 'configId=10001 应是两个站点（327/328）');
    const withBuilding = area!.filter((site) => site.buildingId);
    assert.equal(withBuilding.length, 1,
        '同一区域里配了 buildingId 的必须恰好 1 个（>1 会画出多栋建筑，语义乱）');
    assert.equal(withBuilding[0].cellId, 328, '10001 区域里配了建筑的是 328');
    assert.equal(area!.find((s) => s.cellId === 327)?.buildingId, '',
        '327 没配 buildingId ⇒ 新口径下它不再画建筑（这正是本次修复的现象）');

    // 泛化：所有「同一数字 configId 的多站点区域」都不得超过 1 个建筑。
    for (const [cid, group] of byConfig) {
        const count = group.filter((site) => site.buildingId).length;
        assert.ok(count <= 1, `configId=${cid} 有 ${count} 个站点配了 buildingId，最多 1 个`);
    }
});

test('★★关卡/首领的 type 建筑图在无 buildingId 时不再被使用（stage 图已被兜底路径覆盖）', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const start = src.indexOf('private stationIconOf');
    const end = src.indexOf('private stateOf', start);
    const fn = src.slice(start, end);
    // `stage?.isBoss` 分支仍留着：asyncPvp/fixedResource 理论上可绑到 isBoss 的 stage，
    // 它不受「关卡才严格」这条新口径影响（山猫 2026-10-12 只点了 stage + boss）。
    assert.match(fn, /stage\?\.isBoss/, 'isBoss 的 type 回退对非关卡类型仍有效，不能一并删掉');
});

// ============================================================
// 三、数据事实（配置侧）
// ============================================================

test('★★地图里逐格 buildingIds 只能是候选格（配置校验已拦，这里钉住数据现状）', () => {
    const mapJson = JSON.parse(readFileSync('assets/resources/config/territory-maps/chapter_01.json', 'utf8'));
    const random = mapJson.randomSites ?? {};
    const candidates: number[] = random.candidateCells ?? [];
    const buildingIds: Record<string, string> = random.buildingIds ?? {};
    assert.ok(candidates.length > 0, '第1 章应有随机候选格');
    for (const [cell, buildingId] of Object.entries(buildingIds)) {
        assert.ok(candidates.includes(Number(cell)),
            `buildingIds 的键 ${cell} 必须也是候选格（否则该格永远不会被渲染）`);
        assert.match(buildingId, /^\d+$/, `buildingId 必须是数字串（实际 ${buildingId}）`);
    }
    // ⚠️ 候选格远多于配了 id 的格 ⇒ 「没配 id 显示绿色地块」是**常态**，不是边角情况。
    assert.ok(Object.keys(buildingIds).length < candidates.length,
        `候选格 ${candidates.length} 个里只配了 ${Object.keys(buildingIds).length} 个建筑 id，`
        + '其余开启后应是绿色地块 —— 这条断言在数据反了（全部配满）时能逮住');
});

test('★★TerritoryMapConfig 解析 randomSites.buildingIds（逐格数字键）', () => {
    const src = readFileSync(MAP_CONFIG_PATH, 'utf8');
    assert.match(src, /buildingIds\?:\s*Readonly<Record<number, string>>/,
        '类型是逐格 Record<number, string>');
    assert.match(src, /buildingIds must be an object/,
        '非法形态必须报错（静默吞掉会让配了id 却读不出来）');
});

test('★★★开战后本地不变 owned：防连点靠 pending 判重；asyncPvp 已通关可重复挑战；切章节/结算清 battleId', () => {
    const src = readFileSync(PRESENTER_PATH, 'utf8');

    // ⚠️ 防连点**不能只靠** isOwned —— 开战期间本地根本不会 owned（通关等战斗结算回报），
    // 光有开头那个 `isOwned → return` 拦不住连点。原判据 `bossBattleStart` 是**全局单值**：
    // navigate 后不清则整章永久拒绝开战，且与「asyncPvp 已通关可重复挑战」（2026-10-21 口径）
    // 冲突 ⇒ 已改为**按格 pending 判重**（与第一步解锁同款）。
    const boss = codeOf(memberOf(src, 'private async handleBattleStationStart'));
    // 2026-10-28：两条路都收口到 `runCellWrite`（骨架不再各写一份）⇒ 判重不再靠"源码里出现两次
    // `pendingFixedResourceCells.has`"，改判「两条路都进骨架 + 骨架里确实按 pending 判重」。
    const skeleton = codeOf(memberOf(src, 'private async runCellWrite<T>('));
    assert.match(skeleton, /if \(pending\.has\(cellId\)\) return;/,
        '写请求骨架必须按 pending 判重防连点（同一格请求在飞 ⇒ 不重发）');
    assert.match(boss, /await this\.runCellWrite\(/,
        '第二步开战必须走 runCellWrite（防连点 / 在途帧 / 竞态校验同一份）');
    assert.match(boss, /await this\.handleUnlockOnly\(site, TERRITORY_TEXTS\.bossUnlocked\)/,
        '第一步解锁必须复用 handleUnlockOnly，不许再复制一份解锁骨架');
    // Boss / 首领 / asyncPvp 的重复挑战行为由 territory-presenter 的运行测试覆盖。

    // ⚠️ 清理点必须有两处，否则换章 / 打完再来一次会被「已经开过战」永久拒绝。
    //（`bossBattleStart` 只留作 `lastBossBattleStart` 的最近开战记录，不再参与防连点。）
    const loadChapter = memberOf(src, 'private async loadChapter');
    assert.match(loadChapter, /this\.bossBattleStart = null;/,
        '切章节必须清 bossBattleStart（它是 battleId 一次性记录，不清则换章后永远拒绝开战）');
    const stored = memberOf(src, 'private applyStoredBattleResult');
    assert.match(stored, /this\.bossBattleStart = null;/,
        '战斗有结果时必须清 bossBattleStart（打完一次后要能再开）');
});

