import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { bigMapMonsterUnlock } from '../assets/script/app/bigmap/model/BigMapUnlock';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig as loadFromService } from '../assets/script/app/bigmap/application/BigMapConfigLoader';
import { formatBigMapMonsterDetail } from '../assets/script/app/bigmap/view/BigMapPresentationText';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

function currentTables(): Record<string, unknown> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))]));
}

test('最新真实野怪表完整解析：占格、战斗、解锁、集结、掉落和美术字段均来自新表', () => {
    const tables = currentTables();
    const rows = decompressBigMapRows(tables[BIGMAP_TABLE.monster]);
    const config = parseBigMapConfig(tables);
    assert.equal(config.monsters.size, rows.length);
    for (const row of rows) {
        const monster = config.monsters.get(Number(row.monsterId));
        assert.ok(monster);
        assert.equal(monster.occupyHex, row.monsterSize);
        assert.equal(monster.staminaCost, row.staminaCost);
        assert.equal(monster.offlineBattle, null);
        assert.deepEqual(monster.battle, {
            battleId: row.monsterBattle,
            recommendAttack: row.recommendAttack,
            unlockType: row.unlockType,
            unlockValue: row.unlockValue,
            rallyOpen: row.rallyOpen !== 0,
            rallyNum: row.rallyNum,
            firstKillDrops: row.firstKillDropId,
            normalDrops: row.normalDropId,
            iconPath: row.monsterHeaIcon,
            modelPath: row.monsterModel,
        });
    }
});

test('最新表不要求旧字段；缺失或非法的新字段仍会报告配置错误', () => {
    const tables = currentTables();
    const rows = decompressBigMapRows(tables[BIGMAP_TABLE.monster]);
    assert.equal(rows[0].occupyHex, undefined);
    assert.equal(rows[0].defenseHp, undefined);
    assert.doesNotThrow(() => parseBigMapConfig(tables));
    for (const [field, value] of [['monsterSize', undefined], ['monsterBattle', 'broken'],
        ['normalDropId', [{ resId: 18501, number: 500, pro: 10001 }]]] as const) {
        assert.throws(() => parseBigMapConfig({ ...tables, [BIGMAP_TABLE.monster]: [{ ...rows[0], [field]: value }] }),
            new RegExp(field));
    }
});

test('新表 unlockType=0 不再沿用旧表逐级解锁；新版野怪不走旧血量模拟结算', () => {
    const config = loadBigMapConfig();
    const monster = config.monsters.get(8010);
    assert.ok(monster);
    assert.equal(bigMapMonsterUnlock(monster, makeUnlockContext()).unlocked, true);
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({ config, storage, saveKey: 'latest-monster',
        adventureChapter: () => 3, now: () => 957600 });
    const site = presenter.world.monsters.find((entry) => entry.monsterId === monster.id);
    assert.ok(site);
    const view = presenter.monsterView(site.instanceId);
    assert.equal(view?.battle?.battleId, 30010);
    assert.equal(view?.hpRatio, null);
    assert.equal(view?.staminaCost, monster.staminaCost);
    const original = storage.read('latest-monster');
    assert.equal(presenter.attackMonster(site.instanceId).ok, false);
    assert.equal(storage.read('latest-monster'), original);
    const text = formatBigMapMonsterDetail(view!);
    assert.match(text, new RegExp(`推荐战力：${monster.battle?.recommendAttack}`));
    assert.doesNotMatch(text, /血量|刷新|逐级通关/);
});

test('运行时 ConfigService 解压数据经过同一加载入口，保留新版战斗配置', async () => {
    const tables = currentTables();
    const requested: string[] = [];
    const config = await loadFromService({
        async initialize() {},
        async getTable<T>(name: string): Promise<readonly T[]> {
            requested.push(name);
            return decompressBigMapRows(tables[name]) as readonly T[];
        },
    });
    // 12 张 bigmap 表按 `BIGMAP_TABLE` 的顺序读完；资源表配了 `itemId` 时会再补读一张
    // `item`（拿背包图标，见 `attachBigMapResourceItemIcons`）—— 多读的只能是这一张。
    const tableOrder = Object.values(BIGMAP_TABLE);
    assert.deepEqual(requested.slice(0, tableOrder.length), tableOrder);
    assert.deepEqual(requested.slice(tableOrder.length), ['item']);
    assert.equal(config.monsters.get(8001)?.battle?.battleId, 30001);
    assert.equal(config.monsters.get(9001)?.occupyHex, 4);
});

test('新版多格野怪完整落位且整块不越过地图允许的环带，同种子可复现', () => {
    const config = loadBigMapConfig();
    for (const seed of [20261017, 12345, 20261022]) {
        const world = buildBigMapWorld(config, seed);
        assert.equal(world.monsters.length, config.monsters.size);
        assert.deepEqual(buildBigMapWorld(config, seed).monsters, world.monsters);
        for (const site of world.monsters) {
            assert.equal(site.hexIds.length, config.monsters.get(site.monsterId)?.occupyHex);
            assert.ok(site.hexIds.every((hexId) => world.tileById.get(hexId)!.ring <= config.world.monsterRingMax));
        }
    }
});

test('同一行存在旧字段时新版字段优先；未知解锁类型不被静默当成已解锁', () => {
    const tables = currentTables();
    const rows = decompressBigMapRows(tables[BIGMAP_TABLE.monster]);
    const config = parseBigMapConfig({ ...tables, [BIGMAP_TABLE.monster]: [
        { ...rows[0], occupyHex: 99, preLevel: 0, defenseHp: 999, unlockType: 99 },
    ] });
    const monster = config.monsters.get(8001)!;
    assert.equal(monster.occupyHex, 1);
    assert.equal(monster.offlineBattle, null);
    const unlock = bigMapMonsterUnlock(monster, makeUnlockContext({ maxClearedMonsterLevel: 999 }));
    assert.equal(unlock.unlocked, false);
    assert.match(unlock.reason, /解锁条件/);
});
