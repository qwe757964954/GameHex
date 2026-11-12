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
    // 2026-11 关卡表重做后第一章扩到 129 关（新增 30001+ 普通关、50001+ 首领）。
    // 不再逐条钉 129 个 levelId，改钉「顺序口径」：主线按 chapterStage 排，
    // 异步据点紧跟在首批主线之后、10006~10010 殿后。
    assert.equal(campaign.stages.length, 129);
    const levelIds = campaign.stages.map((stage) => stage.levelId);
    assert.deepEqual(levelIds.slice(0, 8), [10001, 10002, 10003, 10004, 20001, 20002, 20003, 20004]);
    assert.deepEqual(levelIds.slice(-5), [10006, 10007, 10008, 10009, 10010]);
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
    // 🔴 真实缺口（2026-11-03 发现）：`pvpCard` 只补到 68001~68035 的 18 只，
    //    新怪（狼骑兵 50021 / 乌瑞恩 50025 / 冰霜巨龙 50012…）只进了 `monsterCard`，
    //    没有同名 pvpCard 可映射 ⇒ `projectCard` 落进 `monster:` 兜底分支，`pvpCardId` 缺失。
    //    这里**不放宽**：缺卡就是缺卡，报错点名到「哪只怪」。修法在服务端补 pvpCard 行。
    const unmapped = (enemies: typeof firstBoss.enemies): string => enemies
        .filter((enemy) => !Number.isInteger(enemy.pvpCardId))
        .map((enemy) => `${enemy.name}(${enemy.cardId})`)
        .join('、');
    assert.equal(unmapped(firstBoss.enemies), '', `首领 10005 有怪没映射到 pvpCard：${unmapped(firstBoss.enemies)}`);
    assert.equal(firstBoss.idleRewards[0].name, '银币');
    assert.equal(campaign.stages.find((stage) => stage.levelId === 10010)?.isBoss, true);
    const allUnmapped = new Set<string>();
    for (const stage of campaign.stages) {
        assert.equal(stage.opponentCount, 1, `level ${stage.levelId} must be a two-player battle`);
        assert.ok(stage.enemies.some((enemy) => Number.isInteger(enemy.pvpCardId)), `level ${stage.levelId} has no battle card`);
        for (const enemy of stage.enemies) {
            if (!Number.isInteger(enemy.pvpCardId)) allUnmapped.add(`${enemy.name}(${enemy.cardId})`);
        }
        if (stage.mode === 'defence') {
            assert.ok(stage.waves.length > 0, `level ${stage.levelId} has no defence wave`);
            assert.ok(stage.waves.every((wave) => Number.isInteger(wave.pvpCardId)), `level ${stage.levelId} has an unmapped wave`);
        } else {
            assert.equal(stage.enemyTeamIds.length, stage.opponentCount, `level ${stage.levelId} has too few NPC teams`);
            assert.equal(stage.enemyTeamCardIds.length, stage.opponentCount, `level ${stage.levelId} has too few NPC decks`);
            assert.ok(stage.enemyTeamCardIds.every((cards) => cards.length > 0), `level ${stage.levelId} has an empty NPC deck`);
        }
    }
    assert.equal(allUnmapped.size, 0, `这些怪在 monsterCard 里但没有同名 pvpCard：${[...allUnmapped].join('、')}`);
    assert.ok(campaign.playerCardCount > 0);
});

test('territory campaign builds chapter two with independent configured opponents', () => {
    const campaign = buildTerritoryCampaign(
        rows('levelInfo'), rows('monsterCard'), rows('npcTeam'), rows('pvpCard'), 2, rows('defenceModWave'),
    );
    // 🔴 2026-11-06：第二章的关卡数从 10 变 **13** —— 关卡表里补了 3 个副本（异步据点）
    //    20005 / 20006 / 20007（`levelType 2`，`chapterStage 4`，对应地图上的 asyncPvp_1~3），
    //    与第一章「主线 + 20001~20004」同构：副本按 `chapterStage` 插在 10014 之后、10015 之前。
    //    原来这里钉死 10，是因为当时还没这批行；而「16 ≠ 10」那次红是**另一回事**：
    //    这 18 行（20005~20022）被整批贴了两遍，其中 6 行落在第二章 ⇒ 10 + 6 重复。
    //    重复行已在 `assets/remoteRef/levelInfo.json` 与策划源表 `PVP-关卡.xlsx` 里清掉。
    assert.equal(campaign.stages.length, 13);
    assert.deepEqual(campaign.stages.map((stage) => stage.levelId), [
        10011, 10012, 10013, 10014, 20005, 20006, 20007, 10015, 10016, 10017, 10018, 10019, 10020,
    ]);
    assert.deepEqual(campaign.stages[0].enemyTeamIds, [2015]);
    // ⚠️ 按 levelId 取，别用下标：上面插进 3 个副本之后 `stages[4]` 已经不是 10015 了。
    assert.equal(campaign.stages.find((stage) => stage.levelId === 10015)?.enemyTeamId, 1003);
});

test('territory idle accumulation cap comes from the current gameConfig JSON shape', () => {
    assert.equal(readTerritoryIdleRewardMaxHours(rows('gameConfig')), 8);
    assert.equal(readTerritoryIdleRewardMaxHours([]), 8);
});

// ============================================================
// 塔防 BOSS 波标记 + 关卡翻地块频率（2026-11-07 关卡功能检查）
// ============================================================

const levelRow = (over: Record<string, unknown>) => ({
    levelId: 1, levelChapter: 9, chapterStage: 1, levelMod: 2, levelModValue: 9001,
    levelHp: 1, levelAttack: 1, levelCost: 1, openGrideTime: 18, ...over,
});
const waveRow = (over: Record<string, unknown>) => ({
    startId: 9001, waveId: 1, waveShowTime: 3, monsterId: 50003, monsterSize: 1,
    monsterNum: 5, hpRate: 1, atkRate: 1, restMonsterNum: 1, ...over,
});

test('塔防每组只有最后一波是 BOSS：带 monsterType 时认 3，缺列时按最后一波兜底', () => {
    const build = (waves: Array<Record<string, unknown>>, levelOver: Record<string, unknown> = {}) => buildTerritoryCampaign(
        [levelRow(levelOver)] as never, [] as never, [] as never, [] as never, 9, waves as never,
    ).stages[0];

    // ① 表里带 monsterType（1 普通 / 3 BOSS）：只有 3 那波算 BOSS
    const declared = build([
        waveRow({ waveId: 1, monsterType: 1 }),
        waveRow({ waveId: 2, monsterType: 1 }),
        waveRow({ waveId: 3, monsterType: 3, monsterSize: 2, monsterNum: 1 }),
    ]);
    assert.deepEqual(declared.waves.map((wave) => wave.isBoss), [false, false, true]);
    // 怪物体型也要原样带到投影（对局拿它当模型缩放倍率，BOSS 那行填 2）。
    assert.deepEqual(declared.waves.map((wave) => wave.monsterSize), [1, 1, 2]);

    // ② 客户端 JSON 还没有这一列 ⇒ 按「每组最后一波」兜底（口径与策划表一致）
    const fallback = build([waveRow({ waveId: 1 }), waveRow({ waveId: 2 })]);
    assert.deepEqual(fallback.waves.map((wave) => wave.isBoss), [false, true]);

    // ③ 一组里一个 3 都没有（忘填 / 脏数据）也必须是最后一波当 BOSS，
    //    否则「击败 BOSS 才算胜利」会变成永远打不赢。
    const dirty = build([waveRow({ waveId: 1, monsterType: 1 }), waveRow({ waveId: 2, monsterType: 1 })]);
    assert.deepEqual(dirty.waves.map((wave) => wave.isBoss), [false, true]);
});

test('关卡 openGrideTime 原样带到战役投影（NPC 翻地块限速用）', () => {
    const stage = buildTerritoryCampaign(
        [levelRow({ openGrideTime: 18 })] as never, [] as never, [] as never, [] as never, 9, [] as never,
    ).stages[0];
    assert.equal(stage.openGrideTime, 18);
    // 🔴 2026-11-11：`openGrideTime` **只**管战斗内 NPC 点地块的频率，不再兼任格子的「探索中」时长。
    // 后者的真源是地图配置的 `site.unlock.exploreSeconds`（`TerritoryMapConfig`，缺省 2 秒）。
    assert.equal('exploreSeconds' in stage, false, '关卡表不许再往阶段上投影 exploreSeconds');
});

test('真表：每个塔防组都恰好有一波 BOSS，且必定是最后一波', () => {
    const campaign = buildTerritoryCampaign(
        rows('levelInfo'), rows('monsterCard'), rows('npcTeam'), rows('pvpCard'), 1,
        rows('defenceModWave'), [...rows('item'), ...rows('roleProperty')],
    );
    const defence = campaign.stages.filter((stage) => stage.waves.length > 0);
    assert.ok(defence.length > 0);
    for (const stage of defence) {
        const bossFlags = stage.waves.map((wave) => wave.isBoss);
        assert.deepEqual(bossFlags.slice(0, -1), bossFlags.slice(0, -1).map(() => false),
            `关卡 ${stage.levelId} 的中间波次里出现了 BOSS`);
        assert.equal(bossFlags[bossFlags.length - 1], true, `关卡 ${stage.levelId} 的最后一波不是 BOSS`);
        // 真表的「怪物体型」：BOSS 行必须是 2（对局按它放大模型），中间波是 1（原尺寸）。
        const sizes = stage.waves.map((wave) => wave.monsterSize);
        assert.equal(sizes[sizes.length - 1], 2, `关卡 ${stage.levelId} 的 BOSS 波 monsterSize 不是 2`);
        assert.deepEqual(sizes.slice(0, -1), sizes.slice(0, -1).map(() => 1),
            `关卡 ${stage.levelId} 的普通波 monsterSize 不是 1`);
    }
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

/**
 * `levelInfo.gradeProModifier` 的真表投影（2026-11-09 接线）。
 *
 * 207 关里 190 关配了 `{ blue: 3, green: 3 }`（`green` 于 2026-11-09 由 2 提到 3，
 * 目的是跨过 10003 的 2.6 门槛让绿卡也跟着涨）；17 关是空对象 `{}`（10001~10003 的开局三关、
 * 10006、以及 10010 起每 5 关一档到 10070）。这一列此前全工程无消费，现在经
 * `TerritoryCampaignStage` → 导航参数 → 对局配置，只作用于 NPC 抽卡。
 */
test('★ gradeProModifier：真表投影成乘数，空对象归一成 undefined', () => {
    const campaign = buildTerritoryCampaign(
        rows('levelInfo'), rows('monsterCard'), rows('npcTeam'), rows('pvpCard'),
        1, rows('defenceModWave'), [...rows('item'), ...rows('roleProperty')],
    );
    const filled = campaign.stages.find((stage) => stage.levelId === 10004);
    assert.ok(filled, '10004 必须在章节里');
    assert.deepEqual({ ...filled.gradeProModifier }, { blue: 3, green: 3 });

    // 开局三关（10001/10002/10003）该列留空 ⇒ 必须不是 `{}`，而是 undefined
    //（`{}` 会被下游当成「配了但系数全是默认」而多跑一轮乘算）。
    for (const levelId of [10001, 10002, 10003, 10006]) {
        const stage = campaign.stages.find((item) => item.levelId === levelId);
        assert.ok(stage, `${levelId} 必须在章节里`);
        assert.equal(stage.gradeProModifier, undefined, `${levelId} 该列留空 ⇒ undefined`);
    }
    // 塔防关也吃这份配置（10005 是首领关），NPC 出怪前的翻格子同样受限。
    const defence = campaign.stages.find((stage) => stage.levelId === 10005);
    assert.equal(defence?.mode, 'defence');
    assert.deepEqual({ ...defence?.gradeProModifier }, { blue: 3, green: 3 });
});

/**
 * 脏数据边界：0 / 负数 / 字符串 / 写错的大小写都不能悄悄变成乘数。
 * 0 按表说明是「没变化」，归一成 undefined；写错的键（`Green`）直接丢。
 */
test('★ gradeProModifier：0 / 负数 / 未知键一律不生效', () => {
    const [stage] = (() => {
        const levelRows = [{
            levelId: 90001, levelChapter: 99, chapterStage: 1, levelMod: 1, levelModValue: 1,
            levelHp: 1, levelAttack: 1, levelCost: 1, openGrideTime: 0,
            gradeProModifier: { green: 0, blue: -3, Green: 2, purple: 'abc' },
        }];
        const campaign = buildTerritoryCampaign(
            levelRows as any, [], [], [], 99, [], [],
        );
        return campaign.stages.filter((item) => item.levelId === 90001);
    })();
    assert.ok(stage, '构造的关卡应进入结果');
    assert.equal(stage.gradeProModifier, undefined, '全是脏值 ⇒ 等同于没配');
});

/**
 * 塔防关的 NPC 卡组必须能抽出**金矿卡**（`pvpCard.type === 1`）。
 *
 * 真实漏配（2026-11-11 定案）：`pvpTile.10005 金矿` 的 `eligibleCardTypes = [1]`，
 * 而全表只有一张金矿卡 `2001`；塔防关走 `ZCBattleEntryBuilder.clipToLevelCards` 把敌方卡组
 * 裁成 `enemyCardIds`，队伍里没配金矿卡时裁完就一张 type=1 都不剩 ⇒ `drawPvpTile` 的
 * `eligibleCards` 为空 ⇒ **金矿格 100% 空手**（实测 17/17）。
 * 雪上加霜的是 `pvpTileGenParams.initialGuaranteedMine = 1` 保证每个主城六邻格里必有一格金矿，
 * 所以每局 NPC 至少白扔一次开发。
 *
 * 口径：`npcTeam.npcCard`（塔防队伍）填的是**怪物卡牌** id，金矿是 `50002`，
 * 经 `projectCard` 的同名映射落到 `pvpCardId = 2001`。别再往这里写 `2001`（那是 pvpCard id 空间）。
 */
test('★ 塔防关的 NPC 卡组必须含金矿卡（type=1），否则保底金矿格必定空手', () => {
    const levelInfo = rows('levelInfo');
    const pvpCards = rows('pvpCard');
    const cardTypeOf = new Map(pvpCards.map((card) => [Number(card.id), String(card.type)]));
    const chapters = [...new Set(levelInfo.map((row) => Number(row.levelChapter)))];
    let checked = 0;
    for (const chapterId of chapters) {
        const campaign = buildTerritoryCampaign(
            levelInfo, rows('monsterCard'), rows('npcTeam'), pvpCards,
            chapterId, rows('defenceModWave'), [...rows('item'), ...rows('roleProperty')],
        );
        for (const stage of campaign.stages) {
            // 没有 `extraCards.enemy` 的塔防关不裁卡组（`requestedEnemyCards.size === 0`），
            // 用的是整份 36 张池子，天生带 2001，不在本守卫范围。
            if (stage.mode !== 'defence' || stage.enemyTeamIds.length === 0) continue;
            checked += 1;
            const mines = stage.enemies.filter((enemy) => cardTypeOf.get(Number(enemy.pvpCardId)) === '1');
            assert.ok(mines.length > 0,
                `塔防关 ${stage.levelId}（队伍 ${stage.enemyTeamIds[0]}）的 NPC 卡组缺金矿卡 type=1`);
        }
    }
    assert.ok(checked >= 14, `至少要检查到 14 个带 NPC 队伍的塔防关，实际 ${checked}`);
});
