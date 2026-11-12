import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getEnemyDeck, getPlayerDeck } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { getPvpRuntimeRules, loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    configureZCMap, ZC_HEX_CONFIG, ZC_PLAYER_HOME_ID, ZCGameModel, type ZCSnapshot, type ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { zcHitFxSurfaceLiftY } from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import { ZCBattlePresentationQueue } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

/**
 * 建筑 / 城墙受击也要播**攻击方职业**的受击特效（2026-11-06 需求）。
 *
 * 原话：「建筑单位或城墙单位受到攻击时，也要播放对应的职业的受击特效，
 * 比如城墙被战士职业角色攻击，在城墙图片的中心坐标点播放战士受击」。
 *
 * 这一条钉四件事：
 *  ① 城墙被打 → 推一条 `surface = 'wall'` 的受击事件，职业 = **攻击方**的职业；
 *  ② 建筑被打 → `surface = 'building'`；
 *  ③ 锚点是**格心**（`hexCenter`，与飘字同源）；「建筑图比格心高 15.65px」由视图按 `surface`
 *    补 —— 所以那条补偿常量必须和 `ZCGameHex.prefab` 里 `BuildingIcon` 的 `_lpos.y` 一致，
 *    美术挪了图而代码没跟着改，这条守卫会红；
 *  ④ 老调用点（打单位）不传 `surface` 时仍然是 `'unit'`，行为逐字不变。
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
    };
}

loadPvpTables(tables());
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

interface ICombatHarness {
    spawnUnit(owner: ZCUnitState['owner'], card: unknown, tier: number, hexId: number): ZCUnitState | null;
}

/**
 * 摆一局「我方战士 vs 敌方一格有墙/有楼的建筑」，打到结构物掉血为止。
 *
 * @param wallHp `> 0` ⇒ 打城墙；`0` ⇒ 直接打建筑（建筑只有在墙破之后才吃伤害）。
 */
function runStructureDuel(wallHp: number): {
    fxs: Array<{ trait: string; surface: string; x: number; y: number; targetScale: number }>;
    center: { x: number; y: number };
    trait: string;
    damaged: boolean;
} {
    const warrior = getPlayerDeck().find((card) => card.traits?.attack === '战士');
    assert.ok(warrior, '卡组里必须有战士，需求原话就是「城墙被战士职业角色攻击」');
    assert.ok(getEnemyDeck().length > 0);

    const seed = new ZCGameModel(null, () => 0.5);
    //  JSON 深拷一份快照：`ZCGameModel` 接受现成快照，逐格改完再交给它跑。
    const snapshot = JSON.parse(JSON.stringify(seed.snapshot)) as ZCSnapshot;
    const homeId = ZC_PLAYER_HOME_ID;
    const enemyHexId = ZC_HEX_CONFIG[homeId].neighbors[0];
    const enemyHex = snapshot.hexes[enemyHexId];
    const wallMax = getPvpRuntimeRules().wallMaxHp;
    Object.assign(enemyHex, {
        owner: 'enemy', state: 'developed', developmentResolved: true,
        building: 'tower', tier: 1, hp: 1000, maxHp: 1000,
        wallHp, wallMaxHp: wallMax, constructionRemainingSeconds: 0, constructionTotalSeconds: 0,
    });

    const game = new ZCGameModel(snapshot, () => 0.5);
    const harness = game as unknown as ICombatHarness;
    const attacker = harness.spawnUnit('player', warrior, 1, homeId);
    assert.ok(attacker, '战士必须能摆上去');

    const center = { x: ZC_HEX_CONFIG[enemyHexId].x, y: ZC_HEX_CONFIG[enemyHexId].y };
    const fxs = new Map<number, { trait: string; surface: string; x: number; y: number; targetScale: number }>();
    //  ⚠️ 必须读 `game.snapshot` 上那一份：`ZCGameModel` 会把传进来的快照**深拷**一份自己用，
    //  手上这份 `snapshot` 从此不再变化（读它就永远是"没掉血"）。
    const live = game.snapshot.hexes[enemyHexId];
    const hpBefore = live.hp;
    const wallBefore = live.wallHp;
    for (let step = 0; step < 600; step += 1) {
        game.tick(0.05);
        for (const fx of game.hitFxs) {
            if (fxs.has(fx.id)) continue;
            fxs.set(fx.id, {
                trait: fx.trait, surface: fx.surface, x: fx.x, y: fx.y, targetScale: fx.targetScale,
            });
        }
        if (fxs.size > 0 && (live.hp < hpBefore || live.wallHp < wallBefore)) break;
    }
    return {
        fxs: [...fxs.values()],
        center,
        trait: warrior.traits!.attack,
        damaged: live.hp < hpBefore || live.wallHp < wallBefore,
    };
}

test('城墙挨打：推一条 surface=wall 的受击事件，职业是**攻击方**（战士）', () => {
    const result = runStructureDuel(getPvpRuntimeRules().wallMaxHp);
    assert.ok(result.damaged, '城墙必须真的掉血，否则测的是空转');
    const wallFx = result.fxs.filter((fx) => fx.surface === 'wall');
    assert.ok(wallFx.length > 0,
        `城墙被打却一条 wall 受击事件都没推（收到 ${result.fxs.map((fx) => fx.surface).join(',') || '空'}）`);
    for (const fx of wallFx) {
        assert.equal(fx.trait, result.trait, '城墙上的闪白必须选**攻击方**职业的图');
        //  需求原话「在城墙图片的中心坐标点播放」⇒ 锚点就是格心。
        assert.equal(fx.x, result.center.x, 'x 必须落在该格中心');
        assert.equal(fx.y, result.center.y, 'y 必须落在该格中心');
        //  结构物没有 `pvpCard.prefabSize` 意义上的体型，恒 1（视图按烘焙尺寸播）。
        assert.equal(fx.targetScale, 1);
    }
});

test('建筑挨打：推一条 surface=building 的受击事件，锚点仍是格心（视图再抬 15.65px）', () => {
    const result = runStructureDuel(0);
    assert.ok(result.damaged, '建筑必须真的掉血');
    const buildingFx = result.fxs.filter((fx) => fx.surface === 'building');
    assert.ok(buildingFx.length > 0,
        `建筑被打却一条 building 受击事件都没推（收到 ${result.fxs.map((fx) => fx.surface).join(',') || '空'}）`);
    for (const fx of buildingFx) {
        assert.equal(fx.trait, result.trait);
        assert.equal(fx.x, result.center.x);
        assert.equal(fx.y, result.center.y, '模型只给格心，抬到建筑图中心是视图的事');
    }
});

test('视图补偿：建筑 +15.651px、城墙与单位都是 0，且与 ZCGameHex.prefab 的 BuildingIcon 对齐', () => {
    assert.equal(zcHitFxSurfaceLiftY('unit'), 0);
    assert.equal(zcHitFxSurfaceLiftY('wall'), 0, '城墙铺在六条边上，整圈中心就是格心');
    const lift = zcHitFxSurfaceLiftY('building');
    assert.ok(lift > 0, '建筑图挂在格心上方，必须往上抬');

    //  防漂移守卫：这个数来自 prefab 的美术摆位，不是代码算出来的。
    const prefab = JSON.parse(
        readFileSync('assets/bundles/battle/ui/game/ZCGameHex.prefab', 'utf8'),
    ) as Array<Record<string, any>>;
    const root = prefab.find((node) => node.__type__ === 'cc.Node' && node._name === 'ZCGameHex');
    assert.ok(root, '找不到 ZCGameHex 根节点');
    const children = (root!._children ?? []).map((child: { __id__: number }) => prefab[child.__id__]);
    //  建成的建筑图是**根节点的直接子节点**（`BuildingLayer/BuildingIcon` 那个是开发图标，不是它）。
    const buildingIcon = children.find((node: Record<string, any>) => node?._name === 'BuildingIcon');
    assert.ok(buildingIcon, '根节点下必须有一个 BuildingIcon（建成建筑图）');
    assert.equal(buildingIcon!._lpos.y, lift,
        `建筑受击的纵向补偿 ${lift} 与 prefab 里 BuildingIcon 的 _lpos.y ${buildingIcon!._lpos.y} 不一致`
        + '（美术挪了图，`zcHitFxSurfaceLiftY` 要跟着改）');
});

test('打单位的既有调用点不传 surface 时仍是 unit（老行为不变）', () => {
    const queue = new ZCBattlePresentationQueue();
    const fx = queue.pushHitFx({
        now: 1, trait: '法师', owner: 'player', x: 10, y: 20, durationSeconds: 0.15,
    });
    assert.ok(fx);
    assert.equal(fx!.surface, 'unit', '缺省口径必须是打单位，否则老调用点会被当结构物抬高');
    const wall = queue.pushHitFx({
        now: 2, trait: '战士', owner: 'enemy', surface: 'wall', x: 10, y: 20, durationSeconds: 0.15,
    });
    assert.equal(wall!.surface, 'wall');
});
