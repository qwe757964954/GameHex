import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildTerritoryCampaign,
    readTerritoryIdleRewardMaxHours,
    readTerritoryLevelAutoStart,
    TERRITORY_LEVEL_AUTO_START_FALLBACK,
} from '../assets/script/app/territory/model/TerritoryCampaignConfig';

function rows(name: string): any[] {
    const payload = JSON.parse(readFileSync(new URL(`../assets/remoteRef/${name}.json`, import.meta.url), 'utf8'));
    if (Array.isArray(payload)) return payload;
    return payload.v.map((values: unknown[]) => Object.fromEntries(payload.k.map((key: string, index: number) => [key, values[index]])));
}

test('territory campaign joins chapter levels, NPC teams and monster cards', () => {
    const campaign = buildTerritoryCampaign(
        rows('levelInfo'),
        rows('monsterCard'),
        rows('npcTeam'),
        rows('pvpCard'),
        1,
        rows('defenceModWave'),
        [...rows('item'), ...rows('roleProperty')],
    );
    assert.equal(campaign.stages.length, 14);
    assert.deepEqual(campaign.stages.map((stage) => stage.levelId), [
        10001, 10002, 10003, 10004, 20001, 20002, 20003, 20004,
        10005, 10006, 10007, 10008, 10009, 10010,
    ]);
    assert.equal(campaign.stages[0].mode, 'match');
    assert.equal(campaign.stages[0].opponentCount, 1);
    assert.deepEqual(campaign.stages[0].enemyTeamIds, [2001]);
    assert.equal(campaign.stages[0].enemyTeamCardIds.length, 1);
    assert.ok(campaign.stages[0].enemyTeamCardIds.every((cards) => cards.length > 0));
    assert.ok(campaign.stages[0].enemies.length >= 8);
    assert.ok(campaign.stages[0].enemies.every((enemy) => Number.isInteger(enemy.pvpCardId)));
    const asyncBattle = campaign.stages.find((stage) => stage.levelId === 20001)!;
    assert.equal(asyncBattle.mode, 'match');
    assert.deepEqual(asyncBattle.enemyTeamIds, [3001]);
    assert.equal(asyncBattle.enemyTeamCardIds.length, 1);
    assert.ok(asyncBattle.enemyTeamCardIds[0].length > 0);
    assert.ok(asyncBattle.enemies.length >= 8);
    const firstBoss = campaign.stages.find((stage) => stage.levelId === 10005)!;
    assert.equal(firstBoss.isBoss, true);
    assert.equal(firstBoss.mode, 'defence');
    assert.equal(firstBoss.enemyTeamId, 1001);
    assert.equal(firstBoss.waves.length, 7);
    assert.equal(firstBoss.waves[0].monsterName, '豌豆游侠');
    assert.ok(firstBoss.enemies.length >= 4);
    assert.ok(firstBoss.enemies.every((enemy) => Number.isInteger(enemy.pvpCardId)));
    assert.equal(firstBoss.idleRewards[0].name, '银币');
    assert.equal(campaign.stages.find((stage) => stage.levelId === 10010)?.isBoss, true);
    for (const stage of campaign.stages) {
        assert.equal(stage.opponentCount, 1, `level ${stage.levelId} must be a two-player battle`);
        assert.ok(stage.enemies.some((enemy) => Number.isInteger(enemy.pvpCardId)), `level ${stage.levelId} has no battle card`);
        if (stage.mode === 'defence') {
            assert.ok(stage.waves.length > 0, `level ${stage.levelId} has no defence wave`);
            assert.ok(stage.waves.every((wave) => Number.isInteger(wave.pvpCardId)), `level ${stage.levelId} has an unmapped wave`);
        } else {
            assert.equal(stage.enemyTeamIds.length, stage.opponentCount, `level ${stage.levelId} has too few NPC teams`);
            assert.equal(stage.enemyTeamCardIds.length, stage.opponentCount, `level ${stage.levelId} has too few NPC decks`);
            assert.ok(stage.enemyTeamCardIds.every((cards) => cards.length > 0), `level ${stage.levelId} has an empty NPC deck`);
        }
    }
    assert.ok(campaign.playerCardCount > 0);
});

test('territory campaign builds chapter two with independent configured opponents', () => {
    const campaign = buildTerritoryCampaign(
        rows('levelInfo'), rows('monsterCard'), rows('npcTeam'), rows('pvpCard'), 2, rows('defenceModWave'),
    );
    assert.equal(campaign.stages.length, 10);
    assert.deepEqual(campaign.stages.map((stage) => stage.levelId), [
        10011, 10012, 10013, 10014, 10015, 10016, 10017, 10018, 10019, 10020,
    ]);
    assert.deepEqual(campaign.stages[0].enemyTeamIds, [2015]);
    assert.equal(campaign.stages[4].enemyTeamId, 1003);
});

test('territory idle accumulation cap comes from the current gameConfig JSON shape', () => {
    assert.equal(readTerritoryIdleRewardMaxHours(rows('gameConfig')), 8);
    assert.equal(readTerritoryIdleRewardMaxHours([]), 8);
});

/**
 * 「`x ?? []` 顶不住空对象」这条守卫（2026-10-12）。
 *
 * 现象：整章领地数据加载失败，报
 * `TypeError: (...).flatMap is not a function @ TerritoryCampaignConfig.ts:237`，
 * 栈顶是 `TerritoryPresenter.loadChapter`。
 *
 * 🔴 根因是**数据脏值**不是逻辑错：转表器把「空列表」写成 **`{}`**，
 * 而 `{}` **不是 nullish** ⇒ `??` **不生效** ⇒ `{}.flatMap` 直接抛。
 * `levelInfo` 表 `idleReward` 列里 `levelId` 20001/20002/20003 三行是 `{}`。
 *
 * 本条钉住「脏值必须被边界归一吃掉」，而不是钉某个具体 levelId
 * —— 策划哪天把 `{}` 换成 `null` 或真填上奖励，用例都不该变红。
 */
test('★ levelInfo.idleReward 是 {} 时必须归一成空奖励，不能让整章加载崩掉', () => {
    const levelRows = rows('levelInfo');
    const dirtyRow = levelRows.find((row) => row.levelId === 20001);
    assert.ok(dirtyRow, 'levelInfo should include async battle 20001');
    dirtyRow.idleReward = {};

    const campaign = buildTerritoryCampaign(
        levelRows, rows('monsterCard'), rows('npcTeam'), rows('pvpCard'), 1,
        rows('defenceModWave'), [...rows('item'), ...rows('roleProperty')],
    );
    assert.ok(Array.isArray(campaign.stages));
    const dirtyStage = campaign.stages.find((stage) => stage.levelId === 20001);
    assert.deepEqual(dirtyStage?.idleRewards, []);
});

test('★★ 脏列表列必须走 asArray 边界，不能用 ?? []', () => {
    const src = readFileSync(
        new URL('../assets/script/app/territory/model/TerritoryCampaignConfig.ts', import.meta.url),
        'utf8',
    );
    assert.match(src, /function asArray/, '必须有 asArray 边界归一（{} ?? [] 不生效）');
    // 反向：idleReward / npcTeamMatch 两处都不许再写 `?? []`。
    //（其余 `?? []` 走的是工程自有类型 `TerritorySite[]` 等，不是转表产物，不在管辖范围。）
    assert.ok(!/idleReward \?\? \[\]/.test(src), 'idleReward 不能用 ?? []');
    assert.ok(!/npcTeamMatch \?\? \[\]/.test(src), 'npcTeamMatch 不能用 ?? []');
});

test('chapterLevelAutoStartConfig：1 开 / 0 关；缺行或脏值退回缺省（开）', () => {
    // 真表当前是 1 —— 策划表 `S-数据配置`：「章节地图【首次】激活关卡地块，自动进入战斗（1开 0关」。
    assert.equal(readTerritoryLevelAutoStart(rows('gameConfig')), true, '真表里这行必须是 1（改了这里的断言等于改需求）');
    assert.equal(readTerritoryLevelAutoStart([{ key: 'chapterLevelAutoStartConfig', value: 1 }]), true);
    assert.equal(readTerritoryLevelAutoStart([{ key: 'chapterLevelAutoStartConfig', value: 0 }]), false, '0 = 关');
    assert.equal(readTerritoryLevelAutoStart([{ key: 'chapterLevelAutoStartConfig', value: '0' }]), false,
        '表里下发成字符串 "0" 也必须认（不能 Number 之后又当字符串比）');
    assert.equal(readTerritoryLevelAutoStart([]), TERRITORY_LEVEL_AUTO_START_FALLBACK, '缺行 ⇒ 缺省');
    assert.equal(readTerritoryLevelAutoStart([{ key: 'chapterLevelAutoStartConfig', value: '' }]),
        TERRITORY_LEVEL_AUTO_START_FALLBACK, '脏值不许被当成「关」（静默关功能是最难查的一类 bug）');
    assert.equal(TERRITORY_LEVEL_AUTO_START_FALLBACK, true,
        '缺省必须是开：读不到配置就静默退回两步的话，没人会发现开关没生效');
});
