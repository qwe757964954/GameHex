import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    getEnemyDeck, getPlayerDeck,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    configureZCMap, ZC_HEX_CONFIG, ZC_PLAYER_HOME_ID, ZCGameModel, ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameModel';

/**
 * 受击特效：**真跑一局**的端到端链路（2026-11-04 补）。
 *
 * 为什么需要这个文件：`tests/zcds-hit-fx.test.ts` 的 21 条全是**静态断言** ——
 * 读源码字符串（`assert.ok(model.includes('attackerTrait'))`）+ 校验盘上资源文件。
 * 那套写法能防「代码被删」，但防不住「代码在、资源在、一局打下来一条 fx 都没推」，
 * 因为整条链路里任何一个环节的**运行期**条件（卡表 traits、实例 id ↔ 卡牌 id 的映射、
 * `applied <= 0` 的闸门、坐标换算）都可以让事件静默不产生，而静态断言全绿。
 *
 * 这里只锁**模型层**（能进 Node 跑的那一半）：
 *   法师卡普攻命中 → `hitFxs` 里必须出现 `trait = '法师'` 的一条，
 *   坐标必须等于**被打目标**的坐标（＝需求里的「在目标中点播放」），
 *   存活时长必须是 0.15s（与 `ZCEffectPool.HIT_FX_TARGET_SECONDS` 同值）。
 *
 * 渲染层（选 prefab / 挂 mapLayer / 动画压到 0.15s）在 `zcds-hit-fx.test.ts` 里用桩节点验，
 * 两边合起来才是完整链路。
 */

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function tables(): ZCPvpTables {
    return {
        pvpGlobal: readRows('pvpGlobal') as unknown as ZCPvpTables['pvpGlobal'],
        pvpArtifact: readRows('pvpArtifact'),
        pvpCard: readRows('pvpCard'),
        pvpSkill: readRows('pvpSkill'),
        pvpCounter: readRows('pvpCounter'),
        pvpBond: readRows('pvpBond'),
        pvpTile: readRows('pvpTile'),
        pvpPity: readRows('pvpPity'),
        pvpTileGen: readRows('pvpTileGen'),
        pvpTileGenParams: readRows('pvpTileGenParams') as unknown as ZCPvpTables['pvpTileGenParams'],
        pvpBaseTeamWeight: readRows('pvpBaseTeamWeight'),
    };
}

loadPvpTables(tables());
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

interface ICombatHarness {
    spawnUnit(owner: ZCUnitState['owner'], card: unknown, tier: number, hexId: number): ZCUnitState | null;
}

/** 打一局「一个法师 vs 一个靶子」，返回期间观测到的受击事件。 */
function runMageDuel(trait: '法师' | '射手') {
    const game = new ZCGameModel(null, () => 0.5);
    const harness = game as unknown as ICombatHarness;
    const mage = getPlayerDeck().find((card) => card.traits?.attack === trait);
    const target = getEnemyDeck().find((card) => card.traits?.attack === '战士');
    assert.ok(mage, `卡组里必须有 ${trait}：受击特效就是按这个字段选图的`);
    assert.ok(target, '卡组里必须有战士靶子');

    const homeId = ZC_PLAYER_HOME_ID;
    const point = ZC_HEX_CONFIG[homeId];
    const attacker = harness.spawnUnit('player', mage, 1, homeId);
    const victim = harness.spawnUnit('enemy', target, 1, homeId);
    assert.ok(attacker && victim);
    // 贴在一起，保证第一下就进射程（法师改 550 射程后会站很远，等走位太慢）
    Object.assign(attacker, { freeX: point.x - 5, freeY: point.y });
    Object.assign(victim, { freeX: point.x + 5, freeY: point.y });

    const seen = new Map<number, { trait: string; x: number; y: number; durationSeconds: number }>();
    for (let step = 0; step < 200 && seen.size < 2; step += 1) {
        game.tick(0.05);
        for (const fx of game.hitFxs) {
            //  这一局是「法师 vs 战士靶子」，两边都站在**主城格**上 —— 2026-11-06 起
            //  建筑 / 城墙受击也会推特效（靶子那只战士会去打主城城墙），
            //  所以这里只挑打**单位**的那些；结构物那条由 `zcds-structure-hit-fx.test.ts` 单测。
            if (fx.surface !== 'unit') continue;
            if (!seen.has(fx.id)) {
                seen.set(fx.id, { trait: fx.trait, x: fx.x, y: fx.y, durationSeconds: fx.durationSeconds });
            }
        }
    }
    return { seen: [...seen.values()], attacker, victim, victimPos: { x: victim.freeX, y: victim.freeY } };
}

test('法师普攻命中：模型层必须推出 trait=法师 的受击事件，且坐标是目标所在点', () => {
    const { seen, victim, victimPos } = runMageDuel('法师');
    assert.ok(seen.length > 0, '法师普攻命中一次受击特效都没推 —— 渲染层再对也演不出来');
    for (const fx of seen) {
        assert.equal(fx.trait, '法师', '受击特效按攻击方职业选图，法师必须推法师');
        // 需求原话：「在目标的中点(心)播放」——坐标必须是被打目标，不是施法者
        assert.equal(fx.x, victimPos.x, '受击特效 x 必须落在目标身上');
        assert.equal(fx.y, victimPos.y, '受击特效 y 必须落在目标身上');
        assert.equal(fx.durationSeconds, 0.15, '存活时长要与 ZCEffectPool.HIT_FX_TARGET_SECONDS 同值');
    }
    assert.ok(victim.hp < victim.maxHp, '靶子必须真掉血了，否则说明根本没打中（测的是空转）');
});

test('射手普攻命中：同一套链路对别的职业也成立（不是法师特例）', () => {
    const { seen } = runMageDuel('射手');
    assert.ok(seen.length > 0, '射手也没推事件 —— 那问题不在单一职业的 prefab 上');
    for (const fx of seen) assert.equal(fx.trait, '射手');
});

test('卡表里四个职业的 traits.attack 都有人用 —— 少一个那组受击图就是死资源', () => {
    const traits = new Set(getPlayerDeck().map((card) => card.traits?.attack).filter(Boolean));
    for (const trait of ['射手', '战士', '法师', '坦克']) {
        assert.ok(traits.has(trait as never), `卡表里没有 ${trait}，那组受击特效永远演不出来`);
    }
});
