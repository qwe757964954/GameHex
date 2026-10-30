import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    configureZCMap, ZC_HEX_CONFIG, ZC_PLAYER_HOME_ID, ZCGameModel, ZCMapLayout, ZCSnapshot,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { getPvpRuntimeRules, loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

/**
 * 变成废墟的建筑**不能再产金币**（2026-10-29 用户口径）。
 *
 * > 「形成废墟的建筑不会再生产金币，现在前段还有播放金币生成的动画」
 *
 * 金矿那条本来就有 `building !== 'mine'` 挡着，真正漏的是**主城**：
 * `ZCEconomySystem.tickIncome` 里主城收入是**无条件**给每一方发钱的，收款坐标固定是
 * `context.homeId(owner)` —— 主城被打成废墟之后，只要这一方还有别的建筑（对局没结束），
 * 那段循环照跑，于是废墟格上每一拍都飘一次「金币 + 数字」，还带着建筑抖动。
 *
 * 本用例同时钉住正向（废墟不产金）与反向（完好的建筑照常产金）——
 * 只钉正向的话，把整条产金删掉也能绿。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const codeOf = (relative: string): string => read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const ECONOMY = 'assets/script/app/zcds/model/systems/ZCEconomySystem.ts';

function readPvpRef(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`../doc/塔防数据配置/json/client/${name}.json`, 'utf8'));
}

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

loadPvpTables({
    pvpGlobal: readPvpRef('pvpGlobal') as ZCPvpTables['pvpGlobal'],
    pvpArtifact: readPvpRows('pvpArtifact'),
    pvpCard: readPvpRef('pvpCard'),
    pvpSkill: readPvpRef('pvpSkill'),
    pvpCounter: readPvpRef('pvpCounter'),
    pvpBond: readPvpRef('pvpBond'),
    pvpTile: readPvpRef('pvpTile'),
    pvpPity: readPvpRef('pvpPity'),
    pvpTileGen: readPvpRef('pvpTileGen'),
    pvpTileGenParams: readPvpRef('pvpTileGenParams') as ZCPvpTables['pvpTileGenParams'],
    pvpBaseTeamWeight: readPvpRef('pvpBaseTeamWeight'),
});

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

const MINE_CARD_ID = '2001';

function cloneSnapshot(model: ZCGameModel): ZCSnapshot {
    return JSON.parse(JSON.stringify(model.snapshot)) as ZCSnapshot;
}

interface ICollectedText {
    id: number;
    kind: string;
    value: number;
    x: number;
    y: number;
}

/**
 * 逐帧推进并**每帧**收集飘字 —— 飘字只活 0.9s，末尾一次性读会漏掉中间那些。
 *
 * 同一条飘字会在它存活的每一帧都被读到，所以出去前按 `id` 去重（否则"条数"是帧数、
 * "数值之和"会被乘上存活帧数）。
 */
function tickCollect(game: ZCGameModel, seconds: number): ICollectedText[] {
    const step = 1 / 30;
    let left = seconds;
    const byId = new Map<number, ICollectedText>();
    while (left > 1e-9) {
        const dt = Math.min(step, left);
        game.tick(dt);
        for (const text of game.floatTexts) {
            byId.set(text.id, { id: text.id, kind: text.kind, value: text.value, x: text.x, y: text.y });
        }
        left -= dt;
    }
    return [...byId.values()];
}

function atHex(texts: readonly ICollectedText[], hexId: number): ICollectedText[] {
    const center = ZC_HEX_CONFIG[hexId];
    return texts.filter((text) => text.x === center.x && text.y === center.y);
}

function goldIncomeAt(texts: readonly ICollectedText[], hexId: number): ICollectedText[] {
    return atHex(texts, hexId).filter((text) => text.kind === 'goldincome');
}

/** 造一座「我方金矿」并保证它已建成（不跑建造期）。 */
function plantMine(game: ZCGameModel, hexId: number): void {
    const hex = game.snapshot.hexes[hexId];
    hex.owner = 'player';
    hex.state = 'developed';
    hex.developmentResolved = true;
    hex.building = 'mine';
    hex.tileType = ZCPvpTileType.Mine;
    hex.cardId = MINE_CARD_ID;
    hex.tier = 1;
    hex.hp = 100;
    hex.maxHp = 100;
    hex.constructionRemainingSeconds = 0;
    hex.constructionTotalSeconds = 0;
}

/** 把一格改成废墟 —— 与 `ZCDamageResolutionSystem.damageBuilding` 落地的字段口径一致。 */
function ruin(game: ZCGameModel, hexId: number): void {
    const hex = game.snapshot.hexes[hexId];
    const center = ZC_HEX_CONFIG[hexId];
    hex.building = 'none';
    hex.state = 'ruins';
    hex.hp = 0;
    hex.maxHp = 0;
    hex.cardId = null;
    hex.constructionRemainingSeconds = 0;
    hex.constructionTotalSeconds = 0;
    delete game.snapshot.spawnClocks[`mine:${hexId}`];
    delete game.snapshot.spawnClocks[`barracks:${hexId}`];
    delete game.snapshot.spawnClocks[String(hexId)];
    // 废墟是「原来有建筑的那一格」，格心坐标与 `config.map.hexes[id]` 同一口径 —— 飘字就按它定位。
    assert.equal(typeof center.x, 'number');
}

test('① 主城变废墟后不再产金（旁边金矿照常产，证明这条不是把产金整个关掉）', () => {
    const rules = getPvpRuntimeRules();
    const seed = new ZCGameModel(null, () => 0.1);
    const mineId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];

    // 反向先跑一遍：主城完好时，主城那一格**必须**有产金飘字（否则下面的「没有」是假绿）。
    const healthy = new ZCGameModel(cloneSnapshot(seed), () => 0.1);
    plantMine(healthy, mineId);
    const healthyTexts = tickCollect(healthy, rules.hqIncomeIntervalSeconds * 2 + 0.1);
    assert.ok(goldIncomeAt(healthyTexts, ZC_PLAYER_HOME_ID).length > 0,
        '主城完好时必须照常产金 —— 这条守反例，防止"把整条产金删掉"也能绿');

    // 正式场景：我方主城已成废墟，但我方还有一座金矿 ⇒ 对局没结束、tick 照跑。
    const game = new ZCGameModel(cloneSnapshot(seed), () => 0.1);
    plantMine(game, mineId);
    ruin(game, ZC_PLAYER_HOME_ID);
    assert.equal(game.snapshot.status, 'playing', '还有已开发地块 ⇒ 不该判负（判负就 tick 不动，测不到东西）');
    const goldBefore = game.snapshot.playerGold;
    const texts = tickCollect(game, rules.hqIncomeIntervalSeconds * 2 + 0.1);

    assert.equal(goldIncomeAt(texts, ZC_PLAYER_HOME_ID).length, 0,
        '🔴 主城已成废墟，那一格不许再飘产金 —— 就是用户看到的「废墟还在播金币生成动画」');
    const mineTexts = goldIncomeAt(texts, mineId);
    assert.ok(mineTexts.length > 0, '同一时刻金矿必须照常产金（废墟不产 ≠ 全都不产）');
    // 增量必须**恰好**等于金矿飘出去的那几条 —— 主城那 2 拍收入（`hqIncomeAmount + 加成`）
    // 一旦偷偷加上去，这条立刻不等（只断"小于"会被金矿数量凑巧盖住）。
    const mineSum = mineTexts.reduce((total, text) => total + text.value, 0);
    assert.equal(game.snapshot.playerGold - goldBefore, mineSum,
        '金币增量只能来自还活着的金矿，主城那份不许再发');
});

test('② 金矿变废墟后不再产金（完好的金矿仍然产）', () => {
    const rules = getPvpRuntimeRules();
    const seed = new ZCGameModel(null, () => 0.1);
    const mineId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    const cycle = 6; // 金矿产金周期取卡表 `goldDigTime`，与 `tests/zcds-model.test.ts` 同口径。

    const healthy = new ZCGameModel(cloneSnapshot(seed), () => 0.1);
    plantMine(healthy, mineId);
    // 主城会同时产金，这里只关心**金矿那一格**，所以按位置筛。
    assert.ok(goldIncomeAt(tickCollect(healthy, cycle + 0.5), mineId).length > 0, '完好的金矿必须照常产金');

    const game = new ZCGameModel(cloneSnapshot(seed), () => 0.1);
    plantMine(game, mineId);
    ruin(game, mineId);
    const texts = tickCollect(game, cycle * 2 + 0.5);
    assert.equal(goldIncomeAt(texts, mineId).length, 0, '金矿变废墟后那一格不许再飘产金');
    assert.ok(rules.hqIncomeAmount > 0, '主城收入仍读配置表（与金矿这条路无关）');
});

test('③ 源码守卫：两条产金路都先判「建筑还在运转」再发钱', () => {
    const body = codeOf(ECONOMY);
    // 主城：必须先 `isIncomeSource(hexById(homeId), 'hq')` 再 `grantGold`，顺序反了等于没写。
    // 变量名不钉死（`homeId` 只是局部缓存），但「按 homeId 取格 + 判 hq + continue」这三件必须在。
    const hqLoop = body.slice(body.indexOf('for (const owner of context.owners)'));
    const guard = /if \(!this\.isIncomeSource\(this\.hexById\(state, [A-Za-z_$][\w$]*\), 'hq'\)\) continue;/.exec(hqLoop);
    assert.ok(guard, "主城收入必须用 `isIncomeSource(hexById(<homeId>), 'hq')` 判「主城还在」，判不过就 continue");
    const guardAt = guard.index;
    const grantAt = hqLoop.indexOf('context.grantGold(owner');
    assert.ok(guardAt >= 0, '主城收入必须用 `isIncomeSource(..., \'hq\')` 判「主城还在」');
    assert.ok(grantAt > guardAt, '闸必须在发钱之前（`continue` 之后才轮到 grantGold）');
    assert.match(hqLoop.slice(guardAt, guardAt + 140), /continue;/,
        '判不过必须 `continue` 跳过这一方，而不是继续发');
    // 金矿：同一条闸。
    assert.match(body, /if \(mine\.owner === 'neutral' \|\| !this\.isIncomeSource\(mine, 'mine'\)\) continue;/,
        '金矿必须走 `isIncomeSource(mine, \'mine\')`（`building` + `state` + `hp` 三个条件一起判）');
    // `isBuildingOperational` 必须把废墟两种写法都排掉。
    const operational = body.slice(body.indexOf('static isBuildingOperational('));
    const operationalBody = operational.slice(0, operational.indexOf('\n    }'));
    assert.match(operationalBody, /hex\.building !== 'none'/, '没有建筑 ⇒ 不运转');
    assert.match(operationalBody, /hex\.state !== 'ruins'/, '废墟态 ⇒ 不运转（存档/回放的脏数据也挡住）');
    assert.match(operationalBody, /hex\.hp > 0/, '耐久归零 ⇒ 不运转');
});
