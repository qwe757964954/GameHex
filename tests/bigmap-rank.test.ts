/**
 * 城池榜单（`BigMapRank`）的回归测试。
 *
 * 这套东西存在的唯一理由是：战功公式里的 `rank` / `attackers` 两个参数一直没人传，
 * 恒等于 1 ⇒ 名次系数永远 100%、拥挤系数永远 1.0。所以这里主要钉三件事：
 *
 * 1. **确定性**：同一 `cityId` + 同一玩家战功，两次结果必须逐字相同（存档可复现）；
 * 2. **名次真的会影响战功**：排第 1 和排第 11 打出来的战功必须不同，否则接了个假榜单；
 * 3. **拥挤系数真的会生效**：人越多单次战功越低。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildBigMapCityRankBoard,
    buildSoloRankBoard,
} from '../assets/script/app/bigmap/model/BigMapRank';
import {
    bigMapCityAttackPreview,
    bigMapCrowdCoeff,
    bigMapRankCoeff,
} from '../assets/script/app/bigmap/model/BigMapBattle';
import type { IBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapTypes';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const CITY_ID = 101;

/** 空基地：榜单/战功计算只需要「攻击力」，与建造进度无关。 */
const EMPTY_BASE: IBigMapBaseState = {
    instanceSeq: 1,
    buildings: [],
    queues: [],
    queueUnlocked: 1,
    res: { grain: 0, wood: 0, iron: 0, coin: 0, stamina: 0 },
    stamina: 0,
    staminaAt: 0,
};

/** 该城的「最低占领战功」，当作「打得好不好」的基准线。 */
function baselineWarScore(): number {
    const city = config.cities.get(CITY_ID)!;
    return config.cityLevels.get(city.cityLevel)!.minOccupyWarScore;
}

test('榜单是确定性的：同参数两次结果完全一致', () => {
    const a = buildBigMapCityRankBoard(config, CITY_ID, 1234);
    const b = buildBigMapCityRankBoard(config, CITY_ID, 1234);
    assert.deepEqual(a, b);
    // 不同城要拿到不同的 NPC 分布（否则等于全服共用一个榜）。
    const other = buildBigMapCityRankBoard(config, 104, 1234);
    assert.notDeepEqual(
        a.entries.map((entry) => entry.warScore),
        other.entries.map((entry) => entry.warScore),
    );
});

test('玩家战功越高名次越前，0 分排在榜尾', () => {
    const zero = buildBigMapCityRankBoard(config, CITY_ID, 0);
    const high = buildBigMapCityRankBoard(config, CITY_ID, baselineWarScore() * 3);
    assert.equal(zero.playerRank, zero.entries.length, '0 分必须垫底');
    assert.equal(high.playerRank, 1, '远超基准战功必须第一');
    assert.ok(high.playerRank < zero.playerRank);
});

test('榜上条目自洽：名次连续、按战功降序、只有一个玩家', () => {
    const board = buildBigMapCityRankBoard(config, CITY_ID, 500);
    board.entries.forEach((entry, index) => {
        assert.equal(entry.rank, index + 1, '名次必须从 1 连续');
        if (index > 0) assert.ok(board.entries[index - 1].warScore >= entry.warScore, '必须降序');
    });
    assert.equal(board.entries.filter((entry) => entry.isPlayer).length, 1);
    assert.equal(board.topWarScore, board.entries[0].warScore);
    assert.equal(board.attackerCount, board.entries.filter((entry) => entry.warScore > 0).length);
});

test('名次系数真的接上了：第 1 名与第 11 名的战功不同', () => {
    assert.equal(bigMapRankCoeff(config, 1), 1);
    assert.ok(bigMapRankCoeff(config, 11) < bigMapRankCoeff(config, 10));
    assert.ok(bigMapRankCoeff(config, 40) >= config.scoreRule.rankExtendMinPct / 100, '有下限');

    const city = config.cities.get(CITY_ID)!;
    const asFirst = bigMapCityAttackPreview(config, EMPTY_BASE, city, 0, 1, 1);
    const asEleventh = bigMapCityAttackPreview(config, EMPTY_BASE, city, 0, 1, 11);
    assert.ok(asEleventh.warScore < asFirst.warScore, '名次靠后战功必须更低');
});

test('拥挤系数真的生效：同场人越多，单次战功越低', () => {
    assert.equal(bigMapCrowdCoeff(config, 1), 1);
    assert.ok(bigMapCrowdCoeff(config, 3) < bigMapCrowdCoeff(config, 1));
    assert.ok(bigMapCrowdCoeff(config, 10) < bigMapCrowdCoeff(config, 3));

    const city = config.cities.get(CITY_ID)!;
    const solo = bigMapCityAttackPreview(config, EMPTY_BASE, city, 0, 1, 1);
    const crowd = bigMapCityAttackPreview(config, EMPTY_BASE, city, 0, 10, 1);
    assert.ok(crowd.warScore < solo.warScore, '10 人围攻的单次战功必须低于独狼');
});

test('端口未注入时的兜底榜 = 接榜单之前的行为（单人第一名）', () => {
    const solo = buildSoloRankBoard(CITY_ID, 800);
    assert.equal(solo.playerRank, 1);
    assert.equal(solo.attackerCount, 1);
    assert.equal(solo.entries.length, 1);
    const idle = buildSoloRankBoard(CITY_ID, 0);
    assert.equal(idle.attackerCount, 0, '没战功就不算在场，拥挤系数自然为 1');
    assert.equal(bigMapCrowdCoeff(config, idle.attackerCount), 1);
});

test('城池不存在直接抛错，不返回空榜', () => {
    assert.throws(() => buildBigMapCityRankBoard(config, 999999, 0), /取不到城池配置/);
});
