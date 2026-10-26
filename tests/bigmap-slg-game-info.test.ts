/**
 * 服务器 `SlgGameInfo`（所处城池 `toCampId` / 最大击杀野怪等级 `maxMonsterLevel`）的落点回归。
 *
 * 关键判据：**势力范围改由 `toCampId` 决定**（2026-10-23 后端口径），
 * 距离只在 `toCampId = 0`（未收到包 / 未归属）时兜底 —— 这两条必须各测一遍，
 * 否则「改完看起来能用」可能是距离判据还在偷偷生效。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { BigMapSlgRepository, type IBigMapSlgGateway, type IBigMapSlgRequestName } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { bigMapCityAttackPreview } from '../assets/script/app/bigmap/model/BigMapBattle';
import { createBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapBase';
import { normalizeBigMapGameInfo } from '../assets/script/app/bigmap/model/BigMapServerState';
import { bigMapPlayerBaseColorSlot } from '../assets/script/app/bigmap/model/BigMapTerritoryColor';
import { bigMapWithinCityRange } from '../assets/script/app/bigmap/model/BigMapUnlock';
import { bigMapOccupantOf } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const NOW = 1_000_000;
const CITY = config.cities.get(101)!;

function freshBase() {
    return createBigMapBaseState(config, NOW);
}

class Gateway implements IBigMapSlgGateway {
    readonly calls: IBigMapSlgRequestName[] = [];
    listener: ((kind: 'game' | 'build') => void) | null = null;
    game: unknown = { info: { maxMonsterLevel: 5, toCampId: 101 } };
    request(name: IBigMapSlgRequestName): Promise<unknown> {
        this.calls.push(name);
        if (name === 'CmdSlgGameInfoReqMsg') return Promise.resolve(this.game);
        if (name === 'CmdSlgBuildInfoReqMsg') return Promise.resolve({ info: { builds: [], queues: [], unlockQueue: 1 } });
        if (name === 'CmdSlgActionUpdateReqMsg') return Promise.resolve({ info: { nextRevertTime: 20 } });
        return Promise.resolve({});
    }
    subscribe(listener: (kind: 'game' | 'build') => void): () => void {
        this.listener = listener;
        return () => { this.listener = null; };
    }
}

function harness() {
    const gateway = new Gateway();
    const repo = new BigMapSlgRepository(gateway, config, () => NOW, 100);
    const presenter = new BigMapPresenter({
        config, storage: { read: () => { throw new Error('联机不能读取离线基地'); }, write: () => {} },
        saveKey: 'slg-game-info', adventureChapter: () => 10, now: () => NOW, slgRepository: repo,
    });
    return { gateway, repo, presenter };
}

test('game 信息边界：两个 required uint32 缺一个就整包作废', () => {
    assert.deepEqual(normalizeBigMapGameInfo({ maxMonsterLevel: 3, toCampId: 101 }), { maxMonsterLevel: 3, campId: 101 });
    // toCampId = 0 是合法值（未归属），不能当成缺失。
    assert.deepEqual(normalizeBigMapGameInfo({ maxMonsterLevel: 0, toCampId: 0 }), { maxMonsterLevel: 0, campId: 0 });
    for (const value of [null, {}, { toCampId: 1 }, { maxMonsterLevel: 1 },
        { maxMonsterLevel: -1, toCampId: 1 }, { maxMonsterLevel: 1, toCampId: 0x1_0000_0000 },
        { maxMonsterLevel: 1.5, toCampId: 1 }, { maxMonsterLevel: '1', toCampId: 1 }]) {
        assert.equal(normalizeBigMapGameInfo(value), null, JSON.stringify(value));
    }
});

test('势力范围：有 toCampId 时只认同城，距离再近也不算', () => {
    assert.equal(bigMapWithinCityRange(CITY, 999, CITY.cityId), true);
    assert.equal(bigMapWithinCityRange(CITY, 0, CITY.cityId + 1), false);
    assert.equal(bigMapWithinCityRange(CITY, 0, CITY.cityId + 1), false);
});

test('势力范围：toCampId = 0 时回退距离，行为与改前一致', () => {
    assert.equal(bigMapWithinCityRange(CITY, CITY.radiateCapacity, 0), true);
    assert.equal(bigMapWithinCityRange(CITY, CITY.radiateCapacity + 1, 0), false);
    assert.equal(bigMapWithinCityRange(CITY, CITY.radiateCapacity, undefined as unknown as number), true);
});

test('攻城预览吃 toCampId：同城不衰减，异城固定 −20%（与距离无关）', () => {
    const base = freshBase();
    const same = bigMapCityAttackPreview(config, base, CITY, 999, 1, 1, CITY.cityId);
    assert.equal(same.inRange, true);
    assert.equal(same.damageCutPct, 0);
    assert.equal(same.damage, 420);

    const other = bigMapCityAttackPreview(config, base, CITY, 0, 1, 1, CITY.cityId + 1);
    assert.equal(other.inRange, false);
    assert.equal(other.damageCutPct, config.scoreRule.offRangeDamageCutPct);
    assert.equal(other.damage, Math.round(420 * (1 - config.scoreRule.offRangeDamageCutPct / 100)));

    // 不传 campId（离线档）= 老口径，距离在范围内就不减伤。
    const legacy = bigMapCityAttackPreview(config, base, CITY, CITY.radiateCapacity);
    assert.equal(legacy.inRange, true);
});

test('Repository：初始化拉到 toCampId 与 maxMonsterLevel，坏回包不清空已有值', async () => {
    const gateway = new Gateway();
    const repo = new BigMapSlgRepository(gateway, config, () => NOW, 100);
    assert.equal(repo.campId, 0, '收到包之前必须是 0（未知）');
    assert.equal(await repo.initialize(), true);
    assert.equal(repo.campId, 101);
    assert.equal(repo.maxClearedMonsterLevel, 5);

    gateway.game = { info: { toCampId: 202 } };
    assert.equal(await repo.refreshGame(), false, '缺字段的包必须被拒');
    assert.equal(repo.campId, 101, '坏包不能把已展示的所处城池抹成 0');

    gateway.game = { info: { maxMonsterLevel: 7, toCampId: 0 } };
    assert.equal(await repo.refreshGame(), true);
    assert.equal(repo.campId, 0, '0 = 服务端明确说未归属，允许覆盖');
    assert.equal(repo.maxClearedMonsterLevel, 7);
    repo.dispose();
});

test('Repository：game 广播同时刷新所处城池，不只刷行动力', async () => {
    const { gateway, repo } = harness();
    await repo.initialize();
    const before = gateway.calls.length;
    gateway.game = { info: { maxMonsterLevel: 5, toCampId: 303 } };
    gateway.listener?.('game');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(gateway.calls.slice(before).includes('CmdSlgGameInfoReqMsg'));
    assert.equal(repo.campId, 303);
    repo.dispose();
});

test('Presenter：联机版野怪解锁吃服务器的 maxMonsterLevel，不读空存档', async () => {
    const { repo, presenter } = harness();
    await presenter.initializeSlg();
    assert.equal(presenter.playerCampId, 101);
    assert.equal(presenter.unlockContext.maxClearedMonsterLevel, 5);
    assert.equal(presenter.cityView(CITY.cityId)?.isPlayerCamp, true);
    const other = [...config.cities.keys()].find((id) => id !== CITY.cityId)!;
    assert.equal(presenter.cityView(other)?.isPlayerCamp, false);
    presenter.dispose();
    repo.dispose();
});

test('Presenter：离线档没有 toCampId，playerCampId 恒 0 且没有城池被标成本城', () => {
    const presenter = new BigMapPresenter({
        config, storage: { read: () => null, write: () => {} },
        saveKey: 'offline-game-info', adventureChapter: () => 10, now: () => NOW,
    });
    assert.equal(presenter.playerCampId, 0);
    assert.equal(presenter.cityView(CITY.cityId)?.isPlayerCamp, false);
    presenter.dispose();
});

test('基地染色：只拿 toCampId 去色槽表里查，查不到就回退（不猜最近城）', () => {
    const slots = new Map<number, number>([[101, 2], [202, 5]]);
    assert.equal(bigMapPlayerBaseColorSlot(101, slots), 2);
    assert.equal(bigMapPlayerBaseColorSlot(202, slots), 5);
    // 0 = 未收到包 / 未归属；不在地图上的城（配置里有、布局没放）同样回退。
    assert.equal(bigMapPlayerBaseColorSlot(0, slots), null);
    assert.equal(bigMapPlayerBaseColorSlot(303, slots), null);
    // 脏数据不许穿到色板上。
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(bigMapPlayerBaseColorSlot(value, slots), null, String(value));
    }
});

test('世界页：玩家基地的势力色与 contentKey 都接上了 playerCampId', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapWorldView.ts', 'utf8');
    // 染色必须查 toCampId 对应的城，而不是沿用固定绿或「最近的城」。
    assert.match(source, /bigMapPlayerBaseColorSlot\(presenter\.playerCampId, this\.territorySlots\)/);
    // key 漏了它，game 包到达后染色不会重画（早退）。
    assert.match(source, /\$\{this\.selectedHexId\}\|\$\{presenter\.playerCampId\}\|/);
    // 基地位置也要认 toCampId（位置变了必须重建标记），否则图标停在布局档那一格。
    assert.match(source, /const anchorHexId = presenter\.playerBaseHexId;\s*\n\s*if \(anchorHexId !== this\.markerAnchorHexId\)/);
    assert.match(source, /this\.addMarker\('base', presenter\.world\.playerBase\.baseId, presenter\.playerBaseHexId\)/);
});

test('玩家基地钉在 toCampId 那座城的锚点上，没归属才回布局档的格', async () => {
    const { repo, presenter } = harness();
    // 锚点在**世界**里（`IBigMapCitySite`），配置项 `IBigMapCityConfig` 没有这个字段。
    const cityAnchor = presenter.world.cities.get(CITY.cityId)!.anchorHexId;
    const layoutHex = presenter.world.playerBase.hexId;
    assert.notEqual(layoutHex, cityAnchor, '夹具前提：布局档的基地格与城锚点本来就不同');
    // 包还没到 = 未归属 ⇒ 回退布局档，不能用「最近城」猜。
    assert.equal(presenter.playerBaseHexId, layoutHex);
    assert.equal(await presenter.initializeSlg(), true);
    assert.equal(presenter.playerBaseHexId, cityAnchor);
    // 基地与城占格重叠时，这一格必须按「基地」响应，否则「点自己的基地回基地」永远走不到。
    const occupant = bigMapOccupantOf(presenter.world, cityAnchor, presenter.playerBaseHexId);
    assert.equal(occupant.kind, 'base');
    assert.equal(occupant.kind === 'base' && occupant.base.isPlayer, true);
    presenter.dispose();
    repo.dispose();
});

test('toCampId 指向不在地图上的城：基地位置与颜色都回退，不抛错', async () => {
    const { gateway, repo, presenter } = harness();
    gateway.game = { info: { maxMonsterLevel: 0, toCampId: 99999 } };
    assert.equal(await presenter.initializeSlg(), true);
    assert.equal(presenter.playerCampId, 99999);
    assert.equal(presenter.playerBaseHexId, presenter.world.playerBase.hexId);
    assert.equal(bigMapPlayerBaseColorSlot(presenter.playerCampId,
        new Map([...presenter.world.cities.keys()].map((id) => [id, 0] as const))), null);
    presenter.dispose();
    repo.dispose();
});
