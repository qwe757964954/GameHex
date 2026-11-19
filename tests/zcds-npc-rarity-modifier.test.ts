import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    applyPvpRarityModifier,
    drawPvpTile,
    ZC_PVP_RARITY_KEYS,
    ZCPvpTileType,
    type ZCPvpDrawRarity,
    type ZCPvpRarityModifier,
    type ZCPvpSeatDrawRules,
    type ZCPvpTileConfig,
} from '../assets/script/app/zcds/model/ZCPvpTileRules';
import { ZCCardType, type ZCCardRarity, type ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCHexState, ZCSnapshot } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCDevelopmentSystem } from '../assets/script/app/zcds/model/systems/ZCDevelopmentSystem';
import { TERRITORY_CARD_RARITY_KEYS } from '../assets/script/app/territory/model/TerritoryCampaignConfig';

/**
 * `levelInfo.gradeProModifier` 的落地测试（2026-11-09）。
 *
 * 背景：这一列在表里躺了很久（190 关是 `{ blue: 3, green: 2 }`），但全工程没有一处消费，
 * 属于「策划配了、客户端不认」。本次接进来的口径由用户钉死两条：
 *
 *  1. **只作用于 NPC**（玩家翻地块仍走 `pvpTile.rarityWeights` 原表）；
 *  2. **乘系数后在非空品级内部归一** —— 绿蓝抬升后，金卡（与紫卡）占比被动下降。
 *
 * 所以这里同时守三类东西：纯函数的数值口径、`drawPvpTile` 的抽样结果、
 * 以及 `develop` 里「同一个 random、玩家与 NPC 抽到不同品级」的席位作用域。
 */

/** 与 `pvpTile.json` 10003「随机兵营-中等」逐位一致的权重（绿 .5 / 蓝 .4 / 紫 .08 / 金 .02）。 */
const MEDIUM_WEIGHTS: Readonly<Record<ZCPvpDrawRarity, number>> = {
    empty: 0, green: 0.5, blue: 0.4, purple: 0.08, gold: 0.02,
};

/** `pvpTile.json` 10001「全类型随机」：七成空手，是验证「空手率不许被加权吃掉」的关键样本。 */
const ALL_RANDOM_WEIGHTS: Readonly<Record<ZCPvpDrawRarity, number>> = {
    empty: 0.7, green: 0.1, blue: 0, purple: 0.15, gold: 0.05,
};

/** 表里真实现值：190 关都是这一组（2026-11-09 起 green 由 2 提到 3）。 */
const REAL_MODIFIER: ZCPvpRarityModifier = { blue: 3, green: 3 };

/** 改表之前的旧值，只用来演示「系数低于门槛时占比反降」的算术。 */
const LEGACY_MODIFIER: ZCPvpRarityModifier = { blue: 3, green: 2 };

function nonEmptyTotal(weights: Readonly<Record<ZCPvpDrawRarity, number>>): number {
    return ZC_PVP_RARITY_KEYS.reduce((sum, rarity) => sum + weights[rarity], 0);
}

test('品质键词表两处一致：zcds 与 territory 不能各写一套', () => {
    assert.deepEqual([...ZC_PVP_RARITY_KEYS], [...TERRITORY_CARD_RARITY_KEYS]);
});

test('没有调整项时原样返回同一个对象（宁可少一次分配，也不制造新表）', () => {
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, null), MEDIUM_WEIGHTS);
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, undefined), MEDIUM_WEIGHTS);
    // 全 1 等于没调整；`0` 按表说明「没变化」也归 1。
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, { green: 1, blue: 1 }), MEDIUM_WEIGHTS);
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, { green: 0, blue: 1 }), MEDIUM_WEIGHTS);
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, { green: -2 }), MEDIUM_WEIGHTS);
    assert.equal(applyPvpRarityModifier(MEDIUM_WEIGHTS, { green: Number.NaN }), MEDIUM_WEIGHTS);
});

test('乘系数后归一：绿蓝都涨、紫金下降，非空合计不变', () => {
    const adjusted = applyPvpRarityModifier(MEDIUM_WEIGHTS, REAL_MODIFIER);
    // base = 1.0，scaled = .5*3 + .4*3 + .08 + .02 = 2.8 ⇒ normalize = 1/2.8
    assert.ok(Math.abs(adjusted.green - (0.5 * 3) / 2.8) < 1e-12);
    assert.ok(Math.abs(adjusted.blue - (0.4 * 3) / 2.8) < 1e-12);
    assert.ok(Math.abs(adjusted.purple - 0.08 / 2.8) < 1e-12);
    assert.ok(Math.abs(adjusted.gold - 0.02 / 2.8) < 1e-12);

    assert.ok(adjusted.green > MEDIUM_WEIGHTS.green, '绿卡要涨');
    assert.ok(adjusted.blue > MEDIUM_WEIGHTS.blue, '蓝卡要涨');
    assert.ok(adjusted.gold < MEDIUM_WEIGHTS.gold, '金卡要被挤下去');
    assert.ok(adjusted.purple < MEDIUM_WEIGHTS.purple, '紫卡也要被挤');
    // 归一的分母固定在「非空品级」，所以这一段概率质量总量必须守住。
    assert.ok(Math.abs(nonEmptyTotal(adjusted) - nonEmptyTotal(MEDIUM_WEIGHTS)) < 1e-12);
    assert.equal(adjusted.empty, MEDIUM_WEIGHTS.empty);
});

/**
 * ⚠️ 这条是**结论性**用例，不是实现细节：在「乘系数后归一」口径下，一个品级的占比是涨是跌，
 * 取决于**它的系数 vs 其余品级的加权平均系数**（而不是 vs 整体平均）。
 *
 * 推导：占比 = w·f / Σ(w·f)。要 `w·f/Σ > w` 只需 `f > Σ_{i≠自身}(w_i·f_i) / Σ_{i≠自身} w_i`。
 *
 * 10003 上：其余品级 = 蓝 .4×3 + 紫 .08×1 + 金 .02×1 = 1.30，权重和 .5
 * ⇒ 门槛 = 1.30 / .5 = **2.6**。旧表 green=2 < 2.6 ⇒ 绿卡 50% → 43.48% **反降**
 *（蓝卡 3 倍高于门槛，40% → 52.17% 反超）。**2026-11-09 把 green 提到 3 之后跨过门槛，绿蓝同时涨。**
 *
 * 留这条用例是为了钉住口径：以后有人调系数把某品级压到门槛以下、发现「配了 2 倍怎么还降了」，
 * 别去改公式，先看这里的门槛算法。
 */
test('门槛口径：系数低于「其余品级加权平均」时占比反降（不是 bug）', () => {
    const othersWeight = MEDIUM_WEIGHTS.blue + MEDIUM_WEIGHTS.purple + MEDIUM_WEIGHTS.gold;
    const othersScaled = 0.4 * 3 + 0.08 * 1 + 0.02 * 1;
    const threshold = othersScaled / othersWeight;
    assert.ok(Math.abs(threshold - 2.6) < 1e-12);

    // 旧值 green=2 低于门槛 ⇒ 反降。
    const legacy = applyPvpRarityModifier(MEDIUM_WEIGHTS, LEGACY_MODIFIER);
    assert.ok(legacy.green < MEDIUM_WEIGHTS.green, 'green 系数 2 < 门槛 2.6 ⇒ 占比反降');

    // 新值 green=3 跨过门槛 ⇒ 绿蓝同涨（这就是为什么要把 2 提到 3）。
    const raised = applyPvpRarityModifier(MEDIUM_WEIGHTS, REAL_MODIFIER);
    assert.ok(raised.green > MEDIUM_WEIGHTS.green, 'green 系数 3 > 门槛 ⇒ 绿卡涨');
    assert.ok(raised.blue > MEDIUM_WEIGHTS.blue, '蓝卡同时涨');
    assert.ok(raised.gold < MEDIUM_WEIGHTS.gold, '金卡仍然降');
    assert.ok(raised.purple < MEDIUM_WEIGHTS.purple, '紫卡仍然降');
});

test('空手率（empty）不被加权吃掉：全类型随机仍是 0.7', () => {
    const adjusted = applyPvpRarityModifier(ALL_RANDOM_WEIGHTS, REAL_MODIFIER);
    assert.equal(adjusted.empty, 0.7);
    assert.ok(Math.abs(nonEmptyTotal(adjusted) - nonEmptyTotal(ALL_RANDOM_WEIGHTS)) < 1e-12);
    assert.ok(adjusted.green > ALL_RANDOM_WEIGHTS.green);
    // 该地块蓝卡权重是 0，2/3 倍乘上去仍是 0 —— 乘数造不出一张池子里没有的品级。
    assert.equal(adjusted.blue, 0);
    assert.ok(adjusted.gold < ALL_RANDOM_WEIGHTS.gold);
});

test('本来没有绿/蓝的地块（兵营-高级）结果与不调整完全一致', () => {
    const advanced: Readonly<Record<ZCPvpDrawRarity, number>> = {
        empty: 0, green: 0, blue: 0, purple: 0.9, gold: 0.1,
    };
    const adjusted = applyPvpRarityModifier(advanced, REAL_MODIFIER);
    for (const rarity of ['empty', 'green', 'blue', 'purple', 'gold'] as const) {
        assert.ok(Math.abs(adjusted[rarity] - advanced[rarity]) < 1e-12, `${rarity} 不该变`);
    }
});

/** 确定性 LCG：同一颗种子两次跑必须逐位一样，避免概率断言偶发飘。 */
function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function deckOfAllRarities(): ZCDeckCard[] {
    return (['green', 'blue', 'purple', 'gold'] as ZCCardRarity[]).map((rarity) => ({
        id: `card-${rarity}`,
        name: rarity,
        type: ZCCardType.Barracks,
        rarity,
    }));
}

/** 只在「随机兵营-中等」这一种地块上跑 N 次抽卡，统计品级分布。 */
function sampleRarities(seatRules: ZCPvpSeatDrawRules | null, draws: number): Record<string, number> {
    const tiles = {
        [ZCPvpTileType.BarracksMedium]: {
            type: ZCPvpTileType.BarracksMedium,
            name: '随机兵营-中等',
            price: 100,
            rarityWeights: MEDIUM_WEIGHTS,
            eligibleCardTypes: [ZCCardType.Barracks],
        },
    } as unknown as Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;
    const random = createRandom(20261109);
    const deck = deckOfAllRarities();
    const counts: Record<string, number> = { empty: 0, green: 0, blue: 0, purple: 0, gold: 0 };
    for (let index = 0; index < draws; index += 1) {
        // goldPity 给一个极大值：保底会绕过权重，样本必须只反映 `rarityWeights`。
        const result = drawPvpTile(deck, ZCPvpTileType.BarracksMedium, 0, random, tiles, 1e9, seatRules);
        counts[result.rarity] += 1;
    }
    return counts;
}

test('drawPvpTile 抽样：NPC 带上乘数后绿蓝变多、紫金变少', () => {
    const draws = 6000;
    const base = sampleRarities(null, draws);
    const adjusted = sampleRarities({ rarityModifier: REAL_MODIFIER, goldPity: false }, draws);
    // 期望值：绿 .5→.5357、蓝 .4→.4286、紫 .08→.0286、金 .02→.0071。
    // 6000 次的采样误差远小于这些差距，用方向断言即可，不用绑具体条数。
    assert.ok(adjusted.green > base.green, `绿卡应上升：${base.green} → ${adjusted.green}`);
    assert.ok(adjusted.blue > base.blue, `蓝卡应上升：${base.blue} → ${adjusted.blue}`);
    assert.ok(adjusted.gold < base.gold, `金卡应下降：${base.gold} → ${adjusted.gold}`);
    assert.ok(adjusted.purple < base.purple, `紫卡应下降：${base.purple} → ${adjusted.purple}`);
    assert.equal(adjusted.empty, 0);
    assert.equal(base.green + base.blue + base.purple + base.gold, draws);
    assert.equal(adjusted.green + adjusted.blue + adjusted.purple + adjusted.gold, draws);
});

/** 只有「全类型随机」一张地块：金色保底只在这张地块上生效。 */
function allRandomTiles(): Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> {
    return {
        [ZCPvpTileType.AllRandom]: {
            type: ZCPvpTileType.AllRandom,
            name: '全类型随机',
            price: 25,
            rarityWeights: ALL_RANDOM_WEIGHTS,
            eligibleCardTypes: [ZCCardType.Barracks],
        },
    } as unknown as Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;
}

test('金色保底对玩家照常兑现（乘数压金也不影响）', () => {
    const result = drawPvpTile(deckOfAllRarities(), ZCPvpTileType.AllRandom, 99, () => 0.999, allRandomTiles(), 100,
        { rarityModifier: { gold: 0.001 } });
    assert.equal(result.pityTriggered, true);
    assert.equal(result.rarity, 'gold');
    assert.equal(result.nextAllRandomNonGoldDraws, 0);
});

test('NPC 取消金色保底：同样「已连续未出金」也不再送金卡', () => {
    // 计数（99）与门槛（100）都满足，只有 `goldPity: false` 这一个差别。
    const player = drawPvpTile(deckOfAllRarities(), ZCPvpTileType.AllRandom, 99, () => 0.85,
        allRandomTiles(), 100, null);
    assert.equal(player.pityTriggered, true, '对照组：玩家这一拍被保底兜成金卡');

    const npc = drawPvpTile(deckOfAllRarities(), ZCPvpTileType.AllRandom, 99, () => 0.85,
        allRandomTiles(), 100, { rarityModifier: REAL_MODIFIER, goldPity: false });
    assert.equal(npc.pityTriggered, false, 'NPC 不许触发保底');
    // 同一拍 NPC 走权重：green 归一后阈值 .18/… ⇒ 抽到绿，并把「连续未出金」计数推到 100。
    assert.equal(npc.rarity, 'green');
    assert.equal(npc.nextAllRandomNonGoldDraws, 100, '没触发保底 ⇒ 连续未出金计数照常累加');

    // 反过来：即使权重把 NPC 送到金卡，也必须是**权重抽到的**，不能记成保底。
    const npcGold = drawPvpTile(deckOfAllRarities(), ZCPvpTileType.AllRandom, 99, () => 0.999,
        allRandomTiles(), 100, { rarityModifier: REAL_MODIFIER, goldPity: false });
    assert.equal(npcGold.rarity, 'gold');
    assert.equal(npcGold.pityTriggered, false, '金卡来自权重尾部，不是保底');
});

test('NPC 关掉保底后，金卡概率只剩权重本身（长期不出现「必出金」）', () => {
    const tiles = allRandomTiles();
    const deck = deckOfAllRarities();
    const random = createRandom(777);
    let pityHits = 0;
    // 连续 3000 抽：门槛 5 抽一次，玩家会稳定吃满保底；NPC 一次都不该有。
    for (let index = 0; index < 3000; index += 1) {
        const npc = drawPvpTile(deck, ZCPvpTileType.AllRandom, index % 50, random, tiles, 5,
            { rarityModifier: REAL_MODIFIER, goldPity: false });
        if (npc.pityTriggered) pityHits += 1;
    }
    assert.equal(pityHits, 0);
});

/**
 * `develop` 的席位作用域：**同一个 random、同一张地块表**，玩家与 NPC 抽出不同品级。
 *
 * 取 r = 0.52：原表 green 阈值 .50 ⇒ 玩家落到蓝（.52 − .50 = .02 < 蓝的 .40）；
 * NPC 归一后 green 阈值被抬到 .5357 ⇒ 同一拍抽到绿。这条同时覆盖「乘数真的进了抽卡」
 * 和「玩家没被乘数影响」—— 少了任何一半，两边都会抽到同一个品级。
 */
function createDevelopFixture() {
    const hex = {
        id: 0, owner: 'neutral', building: 'none',
        tileType: ZCPvpTileType.BarracksMedium,
        state: 'occupied', tier: 0, hp: 0, maxHp: 0,
        wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
        developmentResolved: false, neutralResourceId: null,
        captureOwner: null, captureSeconds: 0,
        constructionTotalSeconds: 0, constructionRemainingSeconds: 0,
    } as unknown as ZCHexState;
    const emptyCounts = { [ZCCardType.Barracks]: 0 } as Record<number, number>;
    const state = {
        hexes: [hex],
        allRandomNonGoldDraws: { player: 0, enemy: 0, enemy2: 0, enemy3: 0 },
        spawnClocks: {} as Record<string, number>,
        builtTypeCounts: {
            player: { ...emptyCounts }, enemy: { ...emptyCounts },
            enemy2: { ...emptyCounts }, enemy3: { ...emptyCounts },
        },
    } as unknown as ZCSnapshot;
    const config = {
        tiles: {
            [ZCPvpTileType.BarracksMedium]: {
                type: ZCPvpTileType.BarracksMedium,
                name: '随机兵营-中等',
                price: 100,
                rarityWeights: MEDIUM_WEIGHTS,
                eligibleCardTypes: [ZCCardType.Barracks],
            },
        },
        goldPity: 1e9,
    } as unknown as ZCMatchConfig;
    const context = {
        rules: { wallMaxHp: 100 } as never,
        goldOf: () => 0,
        setGold: () => undefined,
        unitCount: () => 0,
        spawnUnit: () => undefined,
        // 与 `ZCGameModel.buildDevelopmentContext` 同构：玩家 null，NPC 带乘数且关掉保底。
        drawRulesOf: (owner: ZCOwner) => (owner === ZCOwner.Player
            ? null
            : { rarityModifier: REAL_MODIFIER, goldPity: false }),
    };
    return { hex, state, config, context };
}
test('develop：同一 random 下玩家抽蓝、NPC 抽绿（乘数只对 NPC 生效）', () => {
    const deck = deckOfAllRarities();
    const playerFixture = createDevelopFixture();
    const player = ZCDevelopmentSystem.develop(
        playerFixture.state, ZCOwner.Player, playerFixture.hex, deck,
        playerFixture.config, () => 0.52, playerFixture.context);
    assert.equal(player.card?.rarity, 'blue');

    const enemyFixture = createDevelopFixture();
    const enemy = ZCDevelopmentSystem.develop(
        enemyFixture.state, ZCOwner.Enemy, enemyFixture.hex, deck,
        enemyFixture.config, () => 0.52, enemyFixture.context);
    assert.equal(enemy.card?.rarity, 'green');

    // 再验一次「NPC 不传规则时与玩家一致」：说明差异确实来自乘数，不是随机序列差异。
    const plainFixture = createDevelopFixture();
    const plain = ZCDevelopmentSystem.develop(
        plainFixture.state, ZCOwner.Enemy, plainFixture.hex, deck,
        plainFixture.config, () => 0.52, { ...plainFixture.context, drawRulesOf: () => null });
    assert.equal(plain.card?.rarity, 'blue');
});

/** 读 `assets/remoteRef` 的列存表，转成行对象（与 `territory-campaign-config.test.ts` 同一读法）。 */
function refRows(name: string): Record<string, any>[] {
    const payload = JSON.parse(readFileSync(new URL(`../assets/remoteRef/${name}.json`, import.meta.url), 'utf8'));
    if (Array.isArray(payload)) return payload;
    return payload.v.map((values: unknown[]) => Object.fromEntries(
        payload.k.map((key: string, index: number) => [key, values[index]]),
    ));
}

/**
 * ★ 真表回归（2026-11-18）：**卡池驱动再归一** —— 配置写了也可能不算数。
 *
 * 事故现场：`pvpTile.10004` 配的是「紫 0.9 / 金 0.1」，但有 11 关的 NPC 队伍卡池里
 * 一张紫品级兵营卡都没有。`drawPvpTile` 的 `availableRarities` 只保留「本席位卡池里
 * 真有卡」的品级，`availableTotal` 在剩余品级内重新归一 ⇒ 紫被剔掉后金独吞 100%，
 * 表里那 10% 形同废纸。补卡后必须回到 90/10。
 *
 * 断在「真表 + 真函数」上，不钉队伍里有什么卡（补卡会换 id，那是实现细节）：
 * 每关用**有效 NPC 队伍**的卡组（`npcTeamType ∈ {1,3}`、`npcTeamMatch` 含该关、
 * 按 `npcTeamId` 升序取第一支 —— 与 `TerritoryCampaignConfig` 的 `.sort().slice(0,1)` 同口径）
 * 加本关 `gradeProModifier`，抽「随机兵营-高级」2000 次，金卡占比必须仍是 10%。
 *
 * 另外守一条**数据**口径：只要地块配了某品级权重，该关队伍卡池里就必须真有这一档
 * （同一天补的第二处：队伍 2015 缺蓝 ⇒ 10004 不受影响，但「随机兵营-中等」的蓝 40%
 * 被绿接管，`10003` 变成 B0 / G94.6）。缺蓝不会让 10004 出问题，所以只靠抽样查不出来。
 *
 * 紫/金系数相等是这条能过的前提（见 `ANCHORS` 注释）：乘同一个数，90:10 才不变。
 */
test('★ 真表：匹配关的 NPC 队伍四品级齐全，高级兵营按表走 90/10', () => {
    const cardById = new Map(refRows('pvpCard').map((row) => [Number(row.id), row]));
    const advancedRow = refRows('pvpTile').find((row) => Number(row.id) === ZCPvpTileType.BarracksAdvanced);
    assert.ok(advancedRow, 'remoteRef/pvpTile 必须有 10004「随机兵营-高级」');
    const tiles = {
        [ZCPvpTileType.BarracksAdvanced]: {
            type: ZCPvpTileType.BarracksAdvanced,
            name: String(advancedRow.name),
            price: Number(advancedRow.price),
            rarityWeights: advancedRow.rarityWeights as Record<ZCPvpDrawRarity, number>,
            eligibleCardTypes: [ZCCardType.Barracks],
        },
    } as unknown as Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>>;

    const teamByLevel = new Map<number, Record<string, any>>();
    for (const team of refRows('npcTeam')) {
        const teamType = Number(team.npcTeamType);
        if (teamType !== 1 && teamType !== 3) continue;
        for (const levelId of new Set((team.npcTeamMatch ?? []).map(Number))) {
            const old = teamByLevel.get(levelId);
            if (!old || Number(team.npcTeamId) < Number(old.npcTeamId)) teamByLevel.set(levelId, team);
        }
    }

    const draws = 2000;
    const failures: string[] = [];
    const gaps: string[] = [];
    let checked = 0;
    for (const level of refRows('levelInfo')) {
        if (Number(level.levelMod) !== 1) continue;
        const levelId = Number(level.levelId);
        const team = teamByLevel.get(levelId);
        if (!team) continue;
        checked += 1;
        const deck: ZCDeckCard[] = (team.npcCard ?? []).flatMap((entry: any) => {
            const cardId = Number(typeof entry === 'number' ? entry : entry?.cardID);
            const card = cardById.get(cardId);
            const rarity = ZC_PVP_RARITY_KEYS[Number(card?.rarity) - 1];
            // 金矿/主城这类非兵营卡不参与 10004（`eligibleCardTypes = [2]`），缺配置就跳过。
            return rarity ? [{ id: String(cardId), name: String(card?.name ?? cardId), type: ZCCardType.Barracks, rarity }] : [];
        });
        // `10002/10003/10004` 四种品级都配了非零权重，缺任何一档都会让归一失真。
        const missing = ZC_PVP_RARITY_KEYS.filter((rarity) => !deck.some((card) => card.rarity === rarity));
        if (missing.length) gaps.push(`${levelId}（队伍 ${team.npcTeamId}）缺 ${missing.join('/')}`);
        const random = createRandom(20261118);
        let gold = 0;
        for (let index = 0; index < draws; index += 1) {
            const result = drawPvpTile(deck, ZCPvpTileType.BarracksAdvanced, 0, random, tiles, 1e9,
                { rarityModifier: level.gradeProModifier ?? null, goldPity: false });
            if (result.rarity === 'gold') gold += 1;
        }
        const share = gold / draws;
        if (Math.abs(share - 0.1) > 0.02) failures.push(`${levelId}（队伍 ${team.npcTeamId}）金卡 ${(share * 100).toFixed(1)}%`);
    }
    assert.ok(checked >= 100, `至少要覆盖 100 个带 NPC 队伍的匹配关，实际 ${checked}`);
    assert.deepEqual(gaps, [], `这些关的 NPC 卡池缺品级（权重会被重新归一）：\n${gaps.join('\n')}`);
    assert.deepEqual(failures, [], `这些关的高级兵营没按表走 90/10：\n${failures.join('\n')}`);
});

test('接线守卫：逐关字段 6 跳都在，且玩家席位被显式拦掉', () => {
    const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

    // 1) 表行 → 关卡；2) 关卡 → 导航参数
    const campaign = read('assets/script/app/territory/model/TerritoryCampaignConfig.ts');
    assert.match(campaign, /gradeProModifier\?: TerritoryGradeProModifier;/);
    assert.match(campaign, /gradeProModifier: asGradeProModifier\(row\.gradeProModifier\)/);

    const model = read('assets/script/app/territory/application/TerritoryModel.ts');
    assert.match(model, /gradeProModifier: stage\.gradeProModifier/);

    // 3) 导航参数 → 对局入口 → 对局配置
    const entry = read('assets/script/app/zcds/application/ZCGameEntry.ts');
    assert.match(entry, /gradeProModifier\?: ZCPvpRarityModifier;/);

    const builder = read('assets/script/app/zcds/application/ZCBattleEntryBuilder.ts');
    assert.match(builder, /if \(pve\.gradeProModifier\) matchConfig\.gradeProModifier = pve\.gradeProModifier;/);

    // 4) 配置 → 抽卡；玩家拿 null（原表 + 保底），NPC 拿乘数且关掉保底
    const gameModel = read('assets/script/app/zcds/model/ZCGameModel.ts');
    assert.match(gameModel, /drawRulesOf: \(owner\) => \(owner === ZCOwner\.Player/);
    assert.match(gameModel, /: \{ rarityModifier: this\.npcRarityModifier, goldPity: false \}\)/);

    const development = read('assets/script/app/zcds/model/systems/ZCDevelopmentSystem.ts');
    assert.match(development, /context\.drawRulesOf\?\.\(owner\) \?\? null/);
});
