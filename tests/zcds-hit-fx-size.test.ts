import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    getEnemyDeck, getPlayerDeck, resolveUnitDefinition,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    configureZCMap, ZC_HEX_CONFIG, ZC_PLAYER_HOME_ID, ZCGameModel, ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCBattlePresentationQueue } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import {
    ZC_HIT_FX_FALLBACK_SCALE, zcHitFxNodeScale, zcHitFxScale,
} from '../assets/script/app/zcds/view/ZCCombatEffectScale';

/**
 * 受击特效**尺寸跟着被打的体型走**（2026-10-31 需求：「各类受击特效需要匹配受击目标的模型大小」）。
 *
 * 口径（详见 `ZCCombatEffectScale` 的注释）：
 *  - 「模型有多大」在项目里只剩 `pvpCard.prefabSize` 一个旋钮 —— spine 单位都按骨架 canvas
 *    归一到可见高 67.27px，序列帧单位的画布也都压到 ~67px，各兵种的差别全在这个字段（0.8~1.2）；
 *  - 实际写入节点的缩放 = **prefab 根的烘焙值 × 该系数**。烘焙值是美术调的
 *    （射手 0.12418 / 战士 0.29333 / 法师 0.05593 / 坦克 & 中毒 0.07098），
 *    直接写 `setScale(系数)` 会把四类闪白抹成同一个尺寸；
 *  - 系数取**被打的那只**，不是攻击方：闪白是贴在被打的身体上的。
 */

const ROOT = join(__dirname, '..');
const HIT_FX_POOL = 'assets/script/app/zcds/view/ZCEffectPool.ts';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
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
configureZCMap(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/zcds-legacy-map.json'), 'utf8')));

test('① 系数：直接取目标体型，非法值退回 1（不把特效缩成 0）', () => {
    assert.equal(zcHitFxScale(1.2), 1.2, '体型 1.2 的兵，闪白就该 1.2 倍');
    assert.equal(zcHitFxScale(0.8), 0.8);
    assert.equal(zcHitFxScale(1), 1);
    // 旧存档 / 旧测试构造的 fx 没有这个字段，不能因此把闪白缩成 0 或 NaN。
    for (const bad of [undefined, null, Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
        assert.equal(zcHitFxScale(bad as never), ZC_HIT_FX_FALLBACK_SCALE,
            `${String(bad)} 必须退回 ${ZC_HIT_FX_FALLBACK_SCALE}`);
    }
});

test('② 写入值 = 烘焙基准 × 系数（四类受击各自的基准不能被抹平）', () => {
    // 四个 prefab 根 `_lscale` 的实测值（受击特效根目录，2026-10-15 接入时定的）。
    const BAKED = { 射手: 0.12418, 战士: 0.2933333333333333, 法师: 0.05593, 坦克: 0.07098 };
    const target = 1.2;
    for (const [trait, baked] of Object.entries(BAKED)) {
        const written = zcHitFxNodeScale(baked, target);
        assert.ok(Math.abs(written - baked * target) < 1e-9,
            `${trait} 受击写入 ${written} 必须是烘焙 ${baked} × ${target}`);
        // 反例守卫：不能变成「四类都写同一个数」——那是把美术意图抹掉。
        assert.notEqual(written, target, `${trait} 不能直接写系数，得乘烘焙值`);
    }
    // 基准本身坏掉（0 / NaN）时退回 1，别写出 0 缩放（节点会整个消失且不报错）。
    assert.equal(zcHitFxNodeScale(0, 1.2), 1.2);
    assert.equal(zcHitFxNodeScale(Number.NaN, 1.2), 1.2);
});

test('③ 队列：targetScale 原样透传，非法值归 1', () => {
    const queue = new ZCBattlePresentationQueue();
    const base = { now: 1, trait: '法师' as const, owner: 'enemy' as const, x: 0, y: 0, durationSeconds: 0.15 };

    const good = queue.pushHitFx({ ...base, targetScale: 1.2 })!;
    assert.equal(good.targetScale, 1.2);

    const missing = queue.pushHitFx(base)!;
    assert.equal(missing.targetScale, 1, '没传 = 保持 prefab 烘焙原样');

    // NaN 会被渲染层直接乘进 setScale ⇒ 节点缩放变 NaN ⇒ 特效静默消失。
    const nan = queue.pushHitFx({ ...base, targetScale: Number.NaN })!;
    assert.equal(nan.targetScale, 1, 'NaN 必须归 1，不能让它流到 setScale');
    const zero = queue.pushHitFx({ ...base, targetScale: 0 })!;
    assert.equal(zero.targetScale, 1, '0 缩放 = 看不见，必须归 1');
});

interface ICombatHarness {
    spawnUnit(owner: ZCUnitState['owner'], card: unknown, tier: number, hexId: number): ZCUnitState | null;
}

/**
 * 打一局「一只法师 vs 一只指定靶子」，返回受击事件里带出来的 targetScale。
 *
 * 靶子挑**体型不是 1** 的：全表 27 张卡都是 1，挑 1 的话「有没有读到 prefabSize」测不出来。
 */
function runDuelWith(victimCard: unknown): Array<{ trait: string; targetScale: number }> {
    const game = new ZCGameModel(null, () => 0.5);
    const harness = game as unknown as ICombatHarness;
    const mage = getPlayerDeck().find((card) => card.traits?.attack === '法师');
    assert.ok(mage, '卡组里必须有法师');
    const homeId = ZC_PLAYER_HOME_ID;
    const point = ZC_HEX_CONFIG[homeId];
    const attacker = harness.spawnUnit('player', mage, 1, homeId);
    const victim = harness.spawnUnit('enemy', victimCard, 1, homeId);
    assert.ok(attacker && victim, '双方都要真的摆上去');
    Object.assign(attacker, { freeX: point.x - 5, freeY: point.y });
    Object.assign(victim, { freeX: point.x + 5, freeY: point.y });

    const seen = new Map<number, { trait: string; targetScale: number }>();
    for (let step = 0; step < 200 && seen.size < 2; step += 1) {
        game.tick(0.05);
        for (const fx of game.hitFxs) {
            if (!seen.has(fx.id)) seen.set(fx.id, { trait: fx.trait, targetScale: fx.targetScale });
        }
    }
    assert.ok(victim.hp < victim.maxHp, '靶子必须真掉血，否则测的是空转');
    return [...seen.values()];
}

test('④ 端到端：fx.targetScale = 被打那只的 prefabSize（取受击方，不是攻击方）', () => {
    const victim = getEnemyDeck().find((card) => {
        if (card.unitId == null) return false;
        return resolveUnitDefinition(card.unitId).prefabSize !== 1;
    });
    assert.ok(victim, '敌方卡组里必须有体型不是 1 的兵，否则这条测不出东西');
    const expected = resolveUnitDefinition(victim.unitId!).prefabSize;

    const seen = runDuelWith(victim);
    assert.ok(seen.length > 0, '一条受击事件都没推');
    for (const fx of seen) {
        assert.equal(fx.targetScale, expected,
            `受击尺寸系数必须等于被打方 ${victim.name} 的 prefabSize ${expected}`);
    }

    // 反向守卫：攻击方（法师）自己的 prefabSize 若与靶子不同，绝不能串进来。
    const mage = getPlayerDeck().find((card) => card.traits?.attack === '法师')!;
    const attackerSize = resolveUnitDefinition(mage.unitId!).prefabSize;
    if (attackerSize !== expected) {
        assert.notEqual(seen[0].targetScale, attackerSize, '系数取了攻击方的体型');
    }
});

test('⑤ 源码守卫：每次从烘焙基准重算，不在节点当前 scale 上累乘', () => {
    const source = readFileSync(join(ROOT, HIT_FX_POOL), 'utf8');
    assert.match(source, /hitFxBakedScales/, '必须缓存"烘焙基准"，否则池化复用会越乘越小/越大');
    assert.match(source, /zcHitFxNodeScale\(baked\.x, fx\.targetScale\)/,
        '写入值必须走 zcHitFxNodeScale(基准, 系数)');
    // 累乘的写法（读 node.scale 再乘）会让第 N 次播放变成 基准 × 系数^N。
    assert.doesNotMatch(source, /node\.scale\.(x|y)\s*\*/, '不许在节点当前缩放上累乘');
});
