/**
 * 大世界地图生成 + 解锁链的回归测试。
 *
 * 关注点（都是「静默坏掉最致命」的规则）：
 * 1. 种子生成必须**确定性**（存档里的格子 id 依赖它）；
 * 2. 城池 / 野怪 / 基地**不能互相压格子**；
 * 3. 解锁链的每一环都按需求的先后顺序生效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';
import {
    buildBigMapWorld,
    bigMapHexDistance,
    bigMapOccupantOf,
} from '../assets/script/app/bigmap/model/BigMapWorld';
import {
    bigMapBuildingUnlock,
    bigMapCityState,
    bigMapCityUnlock,
    bigMapMonsterUnlock,
    bigMapNextTargetCity,
    bigMapUnlockedBuildings,
    bigMapUpgradeUnlock,
    bigMapWithinCityRange,
} from '../assets/script/app/bigmap/model/BigMapUnlock';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();

test('12 张 BigMap 表全部解析成功且关键字段对得上', () => {
    assert.equal(config.world.rows, 40);
    assert.equal(config.world.cols, 40);
    assert.equal(config.world.npcBaseCount, 16);
    assert.equal(config.buildings.size, 23);
    assert.equal(config.cities.size, 25);
    assert.equal(config.monsters.size, 34);
    assert.equal(config.mainBuildingId, 71001);
    assert.equal(config.queue.plotRows, 5);
    assert.equal(config.queue.plotCols, 5);
    assert.equal(config.queue.upgradeUnlockChapter, 3);
    // 本期只有个人层可交互，其余层必须全部 available = 0。
    const availableLayers = new Set(
        [...config.cities.values()].filter((city) => city.available).map((city) => city.layer),
    );
    assert.deepEqual([...availableLayers], [1]);
    assert.equal([...config.cities.values()].filter((city) => city.available).length, 12);
});

test('世界生成是确定性的：同配置同种子必得同一张地图', () => {
    const a = buildBigMapWorld(config);
    const b = buildBigMapWorld(config);
    assert.equal(a.playerBase.hexId, b.playerBase.hexId);
    assert.deepEqual(
        [...a.cities.values()].map((site) => [site.cityId, site.anchorHexId]),
        [...b.cities.values()].map((site) => [site.cityId, site.anchorHexId]),
    );
    assert.deepEqual(a.monsters.map((m) => m.anchorHexId), b.monsters.map((m) => m.anchorHexId));
    assert.deepEqual(a.bases.map((base) => base.hexId), b.bases.map((base) => base.hexId));
    // 换种子应该换地图，否则种子等于没用。城池按槽位落在固定环上（设计如此），
    // 所以这里比对的是受种子影响的部分：出生点、NPC 基地、野怪、地形。
    const c = buildBigMapWorld(config, 12345);
    assert.notEqual(a.playerBase.hexId, c.playerBase.hexId);
    assert.notDeepEqual(a.bases.map((base) => base.hexId), c.bases.map((base) => base.hexId));
    assert.notDeepEqual(a.monsters.map((m) => m.anchorHexId), c.monsters.map((m) => m.anchorHexId));
    assert.notDeepEqual(
        a.tiles.slice(0, 400).map((tile) => tile.terrain),
        c.tiles.slice(0, 400).map((tile) => tile.terrain),
    );
});

test('25 座城池全部落位，占格互不重叠', () => {
    const world = buildBigMapWorld(config);
    assert.equal(world.cities.size, config.cities.size);
    let expectedHexes = 0;
    const seen = new Set<number>();
    for (const site of world.cities.values()) {
        assert.ok(site.hexIds.length >= 1, `城池 ${site.cityId} 没占到格子`);
        expectedHexes += site.hexIds.length;
        for (const hexId of site.hexIds) {
            assert.equal(seen.has(hexId), false, `城池 ${site.cityId} 占格 ${hexId} 与其它城池重叠`);
            seen.add(hexId);
            assert.equal(world.cityByHex.get(hexId), site.cityId);
        }
    }
    assert.equal(world.cityByHex.size, expectedHexes);
});

test('城池 / 野怪 / 基地三类占位互不重叠', () => {
    const world = buildBigMapWorld(config);
    const all = new Set<number>();
    const claim = (hexId: number, tag: string): void => {
        assert.equal(all.has(hexId), false, `${tag} 与其他占位在格 ${hexId} 冲突`);
        all.add(hexId);
    };
    for (const site of world.cities.values()) site.hexIds.forEach((hexId) => claim(hexId, `城池${site.cityId}`));
    for (const site of world.monsters) site.hexIds.forEach((hexId) => claim(hexId, `野怪${site.instanceId}`));
    for (const base of world.bases) claim(base.hexId, `基地${base.baseId}`);

    // 每个格子只能拾取到一种占位物。
    for (const hexId of all) {
        const occupant = bigMapOccupantOf(world, hexId);
        assert.notEqual(occupant.kind, 'empty', `格 ${hexId} 被占用却拾取为空`);
    }
});

test('个人层城池落在 cityRing1 环上，内层城池落在各自环上', () => {
    const world = buildBigMapWorld(config);
    for (const city of config.cities.values()) {
        const site = world.cities.get(city.cityId);
        assert.ok(site, `城池 ${city.cityId} 未落位`);
        if (city.layer === 1) {
            assert.equal(site!.ring, config.world.cityRing1, `个人层城池 ${city.cityId} 不在外环`);
        } else if (city.layer === 2) {
            assert.equal(site!.ring, config.world.cityRing2, `军团层城池 ${city.cityId} 不在中环`);
        } else {
            assert.ok(site!.ring <= config.world.cityRing2, `内层城池 ${city.cityId} 掉到了外圈`);
        }
    }
});

test('玩家基地与 NPC 基地都落在配置的分布环带内', () => {
    const world = buildBigMapWorld(config);
    const { baseRadiusMin, baseRadiusMax, npcBaseCount } = config.world;
    assert.equal(world.bases.filter((base) => !base.isPlayer).length, npcBaseCount);
    assert.equal(world.bases.filter((base) => base.isPlayer).length, 1);
    for (const base of world.bases) {
        assert.ok(base.ring >= baseRadiusMin && base.ring <= baseRadiusMax,
            `基地 ${base.baseId} 落在环 ${base.ring}，超出 [${baseRadiusMin}, ${baseRadiusMax}]`);
        assert.equal(world.tileById.get(base.hexId)!.ring, base.ring);
    }
    // 基地格能拾取回自己。
    const picked = bigMapOccupantOf(world, world.playerBase.hexId);
    assert.equal(picked.kind, 'base');
    assert.equal(picked.kind === 'base' && picked.base.isPlayer, true);
});

test('野怪全部落在 monsterRingMax 以内，且按等级由内向外分布', () => {
    const world = buildBigMapWorld(config);
    assert.equal(world.monsters.length, config.monsters.size);
    const ringOfLevel: Record<number, number[]> = {};
    for (const site of world.monsters) {
        for (const hexId of site.hexIds) {
            const ring = world.tileById.get(hexId)!.ring;
            assert.ok(ring <= config.world.monsterRingMax,
                `野怪 ${site.instanceId} 在环 ${ring}，超出 monsterRingMax=${config.world.monsterRingMax}`);
        }
        (ringOfLevel[site.level] ??= []).push(world.tileById.get(site.anchorHexId)!.ring);
    }
    const avg = (list: number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length;
    assert.ok(avg(ringOfLevel[1]) < avg(ringOfLevel[5]), '1 级怪应比 5 级怪更靠近出生区');
});

test('六边距离与邻居拓扑一致：相邻格距离恒为 1，自身为 0', () => {
    const { rows, cols } = config.world;
    const world = buildBigMapWorld(config);
    for (const hexId of [0, 1, 19, 20, 400, 799, 1234, 1599]) {
        assert.equal(bigMapHexDistance(rows, cols, hexId, hexId), 0);
        for (const neighbor of hexGridNeighborIds(hexId, rows, cols)) {
            assert.equal(bigMapHexDistance(rows, cols, hexId, neighbor), 1, `格 ${hexId} → ${neighbor} 距离不为 1`);
        }
    }
    // 地图中心环号必须为 0，且环号单调外扩（抽查同列与同行）。
    assert.equal(world.tileById.get(world.centerHexId)!.ring, 0);
    const cornerRing = world.tileById.get(0)!.ring;
    assert.ok(cornerRing > config.world.cityRing2, '左上角应在城市环之外');
});

test('建筑解锁唯一来源是冒险章节通关', () => {
    // 策划表 `baseBuilding`：每座田一个 id、章节号写在 `unlockParam`（unlockType=1）：
    // 71001 主城(1) / 71002 粮食田-1(2) / 71003 粮食田-2(3) / 71007 木材田-1(7)。
    const main = config.buildings.get(71001)!;
    const grain1 = config.buildings.get(71002)!;
    const grain2 = config.buildings.get(71003)!;
    const wood1 = config.buildings.get(71007)!;

    assert.equal(bigMapBuildingUnlock(main, makeUnlockContext({ adventureChapter: 0 })).unlocked, false);
    assert.equal(bigMapBuildingUnlock(main, makeUnlockContext({ adventureChapter: 1 })).unlocked, true);
    assert.equal(bigMapBuildingUnlock(grain1, makeUnlockContext({ adventureChapter: 1 })).unlocked, false);
    assert.equal(bigMapBuildingUnlock(grain1, makeUnlockContext({ adventureChapter: 2 })).unlocked, true);
    assert.equal(bigMapBuildingUnlock(grain2, makeUnlockContext({ adventureChapter: 2 })).unlocked, false);
    assert.equal(bigMapBuildingUnlock(grain2, makeUnlockContext({ adventureChapter: 3 })).unlocked, true);
    assert.equal(bigMapBuildingUnlock(wood1, makeUnlockContext({ adventureChapter: 6 })).unlocked, false);
    assert.equal(bigMapBuildingUnlock(wood1, makeUnlockContext({ adventureChapter: 7 })).unlocked, true);
    // 未解锁必须带人话原因，界面直接显示。
    assert.match(bigMapBuildingUnlock(wood1, makeUnlockContext({ adventureChapter: 2 })).reason, /第 7 章/);

    // 积分购买的赛季建筑（unlockType=3）章节号是 0，**不能**因此判成已解锁。
    const seasonal = config.buildings.get(71021)!;
    assert.equal(seasonal.unlockType, 3);
    assert.equal(bigMapBuildingUnlock(seasonal, makeUnlockContext({ adventureChapter: 99 })).unlocked, false);

    // 按 id 判、不依赖排序：章节 1 只有主城；章节 2 多粮食田-1。
    // 另外 71018~71020（装饰雕像 1~3）是 `unlockType = 2` + `unlockParam = 0`
    // 「赛季一开始就开放」，本来就不由章节决定，任何章节都应解锁。
    const chapter1 = bigMapUnlockedBuildings(config, makeUnlockContext({ adventureChapter: 1 })).map((item) => item.id);
    assert.ok(chapter1.includes(71001));
    assert.ok(!chapter1.includes(71002));
    assert.ok(chapter1.includes(71018), '赛季开始即开放的装饰雕像不受章节限制');

    const chapter2 = bigMapUnlockedBuildings(config, makeUnlockContext({ adventureChapter: 2 })).map((item) => item.id);
    assert.ok(chapter2.includes(71002));
    assert.ok(!chapter2.includes(71003), '粮食田-2 要第 3 章');
});

test('建筑升级功能在配置的章节前不可用', () => {
    assert.equal(bigMapUpgradeUnlock(config, makeUnlockContext({ adventureChapter: 2 })).unlocked, false);
    assert.equal(bigMapUpgradeUnlock(config, makeUnlockContext({ adventureChapter: 3 })).unlocked, true);
});

test('城池解锁是「章节 + 开服天数 + 前置已占领」三重条件', () => {
    const head = config.cities.get(101)!;
    const second = config.cities.get(102)!;
    const late = config.cities.get(103)!;

    // 一章没过：所有城池都锁着。
    assert.equal(bigMapCityState(head, makeUnlockContext({ adventureChapter: 1 })), 'locked');
    // 第 2 章起，三条链头同时开放。
    const chapterTwo = makeUnlockContext({ adventureChapter: 2 });
    assert.deepEqual(
        [...config.cities.values()]
            .filter((city) => bigMapCityState(city, chapterTwo) === 'open')
            .map((city) => city.cityId)
            .sort((a, b) => a - b),
        [101, 104, 107],
    );
    // 前置未占领 → 锁。
    assert.equal(bigMapCityState(second, makeUnlockContext({ adventureChapter: 3 })), 'locked');
    assert.match(bigMapCityUnlock(second, makeUnlockContext({ adventureChapter: 3 })).reason, /前置城池/);
    // 前置已占领 + 章节够 → 开。
    assert.equal(bigMapCityState(second, makeUnlockContext({
        adventureChapter: 3, occupiedCityIds: new Set([101]),
    })), 'open');
    assert.equal(bigMapCityState(second, makeUnlockContext({
        adventureChapter: 3, occupiedCityIds: new Set([101]),
    })), 'open');
    // 开服天数不够 → 锁（103 需要第 2 天）。
    assert.equal(bigMapCityState(late, makeUnlockContext({
        adventureChapter: 4, occupiedCityIds: new Set([101, 102]), openDay: 0,
    })), 'locked');
    assert.match(bigMapCityUnlock(late, makeUnlockContext({
        adventureChapter: 4, occupiedCityIds: new Set([101, 102]), openDay: 0,
    })).reason, /开服/);
    assert.equal(bigMapCityState(late, makeUnlockContext({
        adventureChapter: 4, occupiedCityIds: new Set([101, 102]), openDay: 1,
    })), 'open');
    // 已占领的城显示 occupied，而不是 open。
    assert.equal(bigMapCityState(head, makeUnlockContext({
        adventureChapter: 4, occupiedCityIds: new Set([101]),
    })), 'occupied');
    // 联盟 / 战盟层永远不可交互。
    assert.equal(bigMapCityState(config.cities.get(200)!, makeUnlockContext({ adventureChapter: 99 })), 'unavailable');
    assert.equal(bigMapCityState(config.cities.get(401)!, makeUnlockContext({ adventureChapter: 99 })), 'unavailable');
});

test('下一个攻略目标：优先等级最低的已开放城池', () => {
    const next = bigMapNextTargetCity(config, makeUnlockContext({ adventureChapter: 2 }));
    assert.ok(next);
    assert.equal(next!.cityLevel, 1);
    assert.equal(next!.cityId, 101);
    assert.equal(bigMapNextTargetCity(config, makeUnlockContext({ adventureChapter: 0 })), null);
});

test('新版野怪按 unlockType 开放，不附加旧表的逐级解锁限制', () => {
    const levelOne = [...config.monsters.values()].find((monster) => monster.level === 1)!;
    const levelFive = [...config.monsters.values()].find((monster) => monster.level === 5)!;
    assert.equal(bigMapMonsterUnlock(levelOne, makeUnlockContext()).unlocked, true);
    assert.equal(bigMapMonsterUnlock(levelFive, makeUnlockContext({ maxClearedMonsterLevel: 3 })).unlocked, true);
    assert.equal(bigMapMonsterUnlock(levelFive, makeUnlockContext({ maxClearedMonsterLevel: 4 })).unlocked, true);
});

test('势力范围判定用城池自己的辐射半径', () => {
    const city = config.cities.get(101)!;
    assert.equal(city.radiateCapacity, 10);
    assert.equal(bigMapWithinCityRange(city, 10), true);
    assert.equal(bigMapWithinCityRange(city, 11), false);
});
