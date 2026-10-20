import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { ZCStatusResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCStatusResolutionSystem';
import {
    calculateDeckBonuses,
    cardCounterMultiplier,
    getEnemyDeck,
    getPlayerDeck,
    hasUnitDefinition,
    luckTextOfTier,
    rarityNameOfTier,
    resolveUnitDefinition,
    ZCCardType,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import {
    configureZCMap,
    ZC_ENEMY_HOME_ID,
    ZC_HEX_CONFIG,
    ZC_INITIAL_TERRITORY,
    ZC_MAP_COLUMNS,
    ZC_MAP_HOMES,
    ZC_MAP_ID,
    ZC_MAP_ROWS,
    ZC_PLAYER_HOME_ID,
    ZC_SIMULATION_STEP_SECONDS,
    ZC_UNIT_CAP,
    ZCGameModel,
    ZCMapLayout,
    ZCSnapshot,
    ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { getZCMapOwner, ownersForPlayerCount } from '../assets/script/app/zcds/model/ZCMapConfig';
import {
    ZC_CARD_REVEAL_SECONDS, ZC_CARD_START_SECONDS, ZC_HEX_PULSE_SECONDS, ZC_HEX_SHRINK_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../assets/script/core/hex/HexGridLayout';
import { selectZCOpponent } from '../assets/script/app/zcds/model/ZCMatchmaking';
import {
    drawPvpTile,
    getAllRandomGoldPity,
    getPvpTileConfigs,
    getPvpTileTypeWeights,
    selectPvpTileType,
    ZCPvpTileType,
} from '../assets/script/app/zcds/model/ZCPvpTileRules';
import {
    findUnplayableDeckCards,
    getPvpRuntimeRules,
    loadPvpTables,
    ZCPvpTables,
} from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function readPvpRef(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`../doc/塔防数据配置/json/client/${name}.json`, 'utf8'));
}

/** 城墙耐久上限走配置表：2026-09-16 起是 `PVP-全局` 的 `wallMaxHp` 行（原「建筑生命」表已删）。 */
function wallMaxHp(): number {
    return getPvpRuntimeRules().wallMaxHp;
}

/**
 * 读 remoteRef 的 PVP 表 → 行对象数组。
 *
 *  2026-09 中转表链把 `assets/remoteRef/*.json` 统一成了**未压缩的行对象数组**，
 * 不再是列存 `{k, v}` 打包形态。两种都要认：只认打包形态会在 **import 期**就抛
 * `Cannot read properties of undefined (reading 'map')` —— 整个文件被算成 1 条失败，
 * 看着像「用例全挂」，其实是文件根本没起来（同 `zcds-state-consistency.test.ts` 的写法）。
 */
function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readPvpTables(): ZCPvpTables {
    return {
        pvpGlobal: readPvpRef('pvpGlobal') as ZCPvpTables['pvpGlobal'],
        pvpArtifact: readPvpRows('pvpArtifact'),
        pvpCard: readPvpRef('pvpCard'),
        //  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
        pvpSkill: readPvpRef('pvpSkill'),
        pvpCounter: readPvpRef('pvpCounter'),
        pvpBond: readPvpRef('pvpBond'),
        pvpTile: readPvpRef('pvpTile'),
        pvpPity: readPvpRef('pvpPity'),
        pvpTileGen: readPvpRef('pvpTileGen'),
        pvpTileGenParams: readPvpRef('pvpTileGenParams') as ZCPvpTables['pvpTileGenParams'],
        pvpBaseTeamWeight: readPvpRef('pvpBaseTeamWeight'),
    };
}

loadPvpTables(readPvpTables());

/** 地图目录只在 ZCGame.ts 里定义一次，这里读回来，避免路径在两处漂移。 */
const MAP_DIRECTORY_PATH = `assets/resources/${readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8')
    .match(/MAP_DIRECTORY = '([^']+)'/)![1]}`;

function readLayout(name: string): ZCMapLayout {
    return JSON.parse(readFileSync(`${MAP_DIRECTORY_PATH}/${name}.json`, 'utf8')) as ZCMapLayout;
}

const legacyLayout = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout;
configureZCMap(legacyLayout);

test('模型导出渲染帧投影，表现通知通过单独接口取走', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const internalPresentation = (game as unknown as {
        presentation: { pushBuildingShake(hexId: number): void };
    }).presentation;
    internalPresentation.pushBuildingShake(ZC_PLAYER_HOME_ID);
    const frame = game.createRenderFrame();

    assert.equal(frame.snapshot, game.snapshot, '渲染帧复用只读快照，不深拷贝整盘状态');
    assert.equal(frame.mapConfig, game.mapConfig);
    assert.deepEqual(frame.owners, game.owners);
    assert.equal(frame.hexesById.size, game.snapshot.hexes.length);
    for (const state of game.snapshot.hexes) {
        const projected = frame.hexesById.get(state.id);
        assert.ok(projected, `渲染帧包含地块 ${state.id}`);
        assert.equal(projected.canDevelop, game.canPlayerDevelop(state.id));
        assert.deepEqual(projected.cooldown, game.buildingCooldown(state.id));
        assert.equal(projected.activation, game.activationOf(state.id));
        assert.deepEqual(projected.connectedDevelopedHexIds, game.connectedDevelopedHexIds(state.id));
    }
    const nextFrame = game.createRenderFrame();
    assert.equal(
        nextFrame.hexesById.get(ZC_PLAYER_HOME_ID)?.connectedDevelopedHexIds,
        frame.hexesById.get(ZC_PLAYER_HOME_ID)?.connectedDevelopedHexIds,
        '不变地形复用连通区投影，避免每个渲染帧重复跑 BFS',
    );

    const firstDrain = game.drainPresentationEvents();
    const secondDrain = game.drainPresentationEvents();
    assert.deepEqual(firstDrain.buildingShakes, [{ id: 1, hexId: ZC_PLAYER_HOME_ID }]);
    assert.deepEqual(secondDrain.buildingShakes, [], '显式事件读取不会残留上一帧的通知');
});

function cloneSnapshot(game: ZCGameModel): ZCSnapshot {
    return JSON.parse(JSON.stringify(game.snapshot)) as ZCSnapshot;
}

function firstDevelopable(game: ZCGameModel): number {
    return game.snapshot.hexes.find((hex) => game.canPlayerDevelop(hex.id))!.id;
}

/** `tick` 单次最多接受 5 秒（内部 0.05 秒固定步长），这里按 2 秒一步推进。 */
function tickSeconds(game: ZCGameModel, seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 2) game.tick(2);
}

function makeUnit(id: number, owner: 'player' | 'enemy', sourceHexId: number): ZCUnitState {
    const player = owner === 'player';
    return {
        id,
        owner,
        // 真实 id（66014/60016 是旧夹具里的假 id，快照校验会因 config.units 查不到而拒收）
        unitId: player ? '68023' : '68001',
        cardId: player ? '68023' : '68001',
        tier: 1,
        sourceHexId,
        targetHexId: null,
        progress: 0,
        hp: player ? 95 : 100,
        maxHp: player ? 95 : 100,
        battleState: 'target',
        stateTime: 0,
        targetUnitId: null,
        targetWallHexId: null,
        targetBuildingHexId: null,
        nextAttackAt: 1.8,
        waitUntil: 0,
        attackHitDone: false,
        hatredUnitId: null,
        hatredUntil: 0,
        facingRadians: player ? Math.PI / 2 : -Math.PI / 2,
        deathRemoveAt: 0,
        marchAngle: null,
        freeX: ZC_HEX_CONFIG[sourceHexId].x,
        freeY: ZC_HEX_CONFIG[sourceHexId].y,
        completedAttackCount: 0,
    };
}

test('新对局使用测试地图 JSON，双方各占半场且没有中立地块', () => {
    const game = new ZCGameModel(null, () => 0.1);
    assert.equal(game.snapshot.hexes.length, ZC_MAP_COLUMNS * ZC_MAP_ROWS);
    assert.equal(game.playerTerritoryCount, ZC_INITIAL_TERRITORY);
    assert.equal(game.enemyTerritoryCount, ZC_INITIAL_TERRITORY);
    assert.equal(game.snapshot.hexes.some((hex) => hex.owner === 'neutral'), false);
    assert.equal(game.playerDevelopedCount, 1);
    assert.equal(game.enemyDevelopedCount, 1);
    assert.equal(game.snapshot.units.length, 0);
    assert.equal(ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].mirrorId, ZC_ENEMY_HOME_ID);
    for (const hex of ZC_HEX_CONFIG) {
        const mirror = ZC_HEX_CONFIG[hex.mirrorId];
        assert.ok(Math.abs(hex.y + mirror.y) <= 1);
        assert.ok(Math.abs(hex.x + mirror.x) <= 1);
        assert.equal(game.snapshot.hexes[hex.id].developmentCost, game.snapshot.hexes[hex.mirrorId].developmentCost);
        assert.equal(game.snapshot.hexes[hex.id].tileType, game.snapshot.hexes[hex.mirrorId].tileType);
    }
    const initial = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors.map((id) => game.snapshot.hexes[id]);
    // 主城邻格 = 逐席位保底金矿（每方 1 个，镜像图上一对格同时落到双方、不翻倍）+ 其余按权重抽。
    // 2 人镜像图的口径与改造前一致：玩家邻格恰好 1 个 mine。
    assert.equal(initial.filter((hex) => hex.tileType === ZCPvpTileType.Mine).length, 1);
    assert.equal(initial.filter((hex) => hex.tileType === ZCPvpTileType.AllRandom).length, 3);
    assert.equal(initial.filter((hex) => hex.tileType === ZCPvpTileType.BarracksCommon).length, 2);
});

test('11 列河道配置进入对局：水域不可通行，双方各占 80 格', () => {
    configureZCMap(readLayout('river'));
    try {
        assert.equal(ZC_MAP_COLUMNS, 11);
        assert.equal(ZC_MAP_ROWS, 20);
        assert.equal(ZC_INITIAL_TERRITORY, 80);
        assert.equal(ZC_HEX_CONFIG.filter((hex) => !hex.playable).length, 60);
        assert.equal(ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].column, 5);
        assert.equal(ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].column, 5);
        for (const config of ZC_HEX_CONFIG) {
            if (!config.playable) continue;
            assert.equal(ZC_HEX_CONFIG[config.mirrorId].mirrorId, config.id);
            assert.ok(config.neighbors.every((id) => ZC_HEX_CONFIG[id].playable));
        }
        const game = new ZCGameModel(null, () => 0.1);
        assert.equal(game.playerTerritoryCount, 80);
        assert.equal(game.enemyTerritoryCount, 80);
        assert.equal(game.snapshot.hexes.filter((hex) => hex.owner === 'neutral').length, 60);
        assert.ok(game.snapshot.hexes.every((hex) => ZC_HEX_CONFIG[hex.id].playable || hex.tileType === null));
        assert.ok(game.snapshot.hexes.every((hex) => !ZC_HEX_CONFIG[hex.id].playable
            || hex.building === 'hq' || typeof hex.tileType === 'string'));
        assert.equal(ZCGameModel.isValidSnapshot(cloneSnapshot(game)), true);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('资源目录中的每张固定主城地图 JSON 都能直接创建对局', () => {
    const names = readdirSync(MAP_DIRECTORY_PATH)
        .filter((name) => name.endsWith('.json'));
    assert.ok(names.length > 0);
    try {
        for (const name of names) {
            const layout = readLayout(name.slice(0, -5));
            // 自选主城图必须先经过 ZCSpawnSelection；其落点解析与建模由专门用例覆盖。
            if (layout.cityMode === 'select') continue;
            configureZCMap(layout);
            const game = new ZCGameModel(null, () => 0.1);
            assert.equal(game.snapshot.mapId, layout.id, name);
            assert.equal(game.snapshot.hexes.length, layout.rows * layout.columns, name);
            assert.equal(game.snapshot.hexes[ZC_PLAYER_HOME_ID].building, 'hq', name);
            assert.equal(game.snapshot.hexes[ZC_ENEMY_HOME_ID].building, 'hq', name);
            const playerCount = layout.playerCount ?? 2;
            assert.equal(game.snapshot.hexes.filter((hex) => hex.building === 'hq').length, playerCount, name);
            assert.equal(ZC_MAP_HOMES.length, playerCount, name);
            for (const homeId of ZC_MAP_HOMES) assert.equal(game.snapshot.hexes[homeId].building, 'hq', name);
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('3 / 4 人地图创建独立席位，额外席位由本地 AI 各自开发', () => {
    try {
        for (const name of ['standard_3', 'standard_4']) {
            const layout = readLayout(name);
            configureZCMap(layout);
            const game = new ZCGameModel(null, () => 0.1);
            const owners = ownersForPlayerCount((layout.playerCount ?? 2) as 2 | 3 | 4);
            assert.equal(game.snapshot.hexes.filter((hex) => hex.building === 'hq').length, owners.length, name);
            assert.deepEqual(Object.keys(game.snapshot.goldByOwner ?? {}), owners, name);

            const before = Object.fromEntries(owners.slice(1).map((owner) => [owner,
                game.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length]));
            game.tick(getPvpRuntimeRules().enemyAiIntervalSeconds + 0.1);
            for (const owner of owners.slice(1)) {
                const developed = game.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length;
                assert.ok(developed > before[owner], `${name}:${owner} 应独立完成一次 AI 开发`);
            }
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('地块按占据、可占据、可开发、已开发、废墟五态流转', () => {
    const game = new ZCGameModel(null, () => 0.1);
    assert.equal(game.snapshot.hexes[ZC_PLAYER_HOME_ID].state, 'developed');
    for (const id of ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors) {
        assert.equal(game.snapshot.hexes[id].state, 'developable');
    }
    assert.ok(game.snapshot.hexes.some((hex) => hex.owner === 'player' && hex.state === 'occupied'));
    assert.equal(game.snapshot.hexes.some((hex) => hex.owner === 'neutral'), false);

    const snapshot = cloneSnapshot(game);
    const neighbor = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    snapshot.hexes[neighbor].state = 'ruins';
    const restored = new ZCGameModel(snapshot);
    assert.equal(restored.snapshot.hexes[neighbor].state, 'ruins');
    // 废墟是永久地形：自身不可重建，只作为相邻己方格的开发锚点（见下一条用例）。
    assert.equal(restored.canPlayerDevelop(neighbor), false);
});

test('城墙耐久上限来自配置表（PVP-全局 wallMaxHp），代码里没有硬编码兜底', () => {
    const rules = getPvpRuntimeRules();
    const wall = (readPvpRef('pvpGlobal') as Array<{ key: string; value: unknown }>)
        .find((row) => row.key === 'wallMaxHp');
    assert.ok(wall, 'PVP-全局必须有 wallMaxHp 行');
    // 运行时规则直接取全局表的值；城墙不是卡牌、也没有卡表行（耐久挂在「边」上）。
    assert.equal(rules.wallMaxHp, wall.value);

    // 开局：两个主城格带城墙，其余格没有。
    const game = new ZCGameModel(null, () => 0.1);
    for (const homeId of [ZC_PLAYER_HOME_ID, ZC_ENEMY_HOME_ID]) {
        assert.equal(game.snapshot.hexes[homeId].wallMaxHp, rules.wallMaxHp);
        assert.equal(game.snapshot.hexes[homeId].wallHp, rules.wallMaxHp);
    }
    const empty = game.snapshot.hexes.find((hex) => (
        hex.id !== ZC_PLAYER_HOME_ID && hex.id !== ZC_ENEMY_HOME_ID
    ))!;
    assert.equal(empty.wallMaxHp, 0);

    // 开发完成时取的是同一个值 —— 改表就能改数值，不用动代码。
    const snapshot = cloneSnapshot(game);
    snapshot.playerGold = 1000;
    const developId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    const devGame = new ZCGameModel(snapshot, () => 0.1);
    assert.equal(devGame.snapshot.hexes[developId].wallMaxHp, 0, '开发前该格还没有城墙');
    devGame.developHex(developId);
    assert.equal(devGame.snapshot.hexes[developId].wallMaxHp, rules.wallMaxHp);
    assert.equal(devGame.snapshot.hexes[developId].wallHp, rules.wallMaxHp);
});

test('建筑被打掉后废墟归摧毁方，并点亮相邻己方格的开发', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const enemyHexId = ZC_HEX_CONFIG[sourceId].neighbors.find((id) => snapshot.hexes[id].owner === 'enemy')!;
    const enemyHex = snapshot.hexes[enemyHexId];
    enemyHex.state = 'developed';
    enemyHex.developmentResolved = true;
    enemyHex.building = 'tower';
    enemyHex.tier = 1;
    enemyHex.cardId = '66011';
    enemyHex.hp = 1;
    enemyHex.maxHp = 1000;
    enemyHex.wallHp = 0;
    enemyHex.wallMaxHp = wallMaxHp();
    enemyHex.constructionRemainingSeconds = 0;
    enemyHex.constructionTotalSeconds = 0;

    // 预制条件：废墟周边要有仍未开发的己方格，且先压成"占据"。
    const anchoredIds = ZC_HEX_CONFIG[enemyHexId].neighbors.filter((id) => (
        snapshot.hexes[id].owner === 'player' && !snapshot.hexes[id].developmentResolved
    ));
    assert.ok(anchoredIds.length > 0, '预制条件：废墟至少有一个己方相邻格');
    for (const id of anchoredIds) snapshot.hexes[id].state = 'occupied';

    const attacker = makeUnit(1, 'player', sourceId);
    attacker.nextAttackAt = 0;
    snapshot.units = [attacker];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => 0);

    game.tick(1.5);
    const ruin = game.snapshot.hexes[enemyHexId];
    assert.equal(ruin.building, 'none');
    assert.equal(ruin.state, 'ruins');
    assert.equal(ruin.owner, 'player');
    assert.equal(game.canPlayerDevelop(enemyHexId), false);
    for (const id of anchoredIds) {
        assert.equal(game.snapshot.hexes[id].state, 'developable', `废墟相邻己方格 ${id} 应可开发`);
    }

    // 反向：敌方打掉我方建筑，废墟同样归摧毁方。
    const mirrorSnapshot = cloneSnapshot(seed);
    assert.equal(mirrorSnapshot.hexes[sourceId].owner, 'player');
    const playerHex = mirrorSnapshot.hexes[sourceId];
    playerHex.state = 'developed';
    playerHex.developmentResolved = true;
    playerHex.building = 'barracks';
    playerHex.tier = 1;
    playerHex.cardId = '66001';
    playerHex.hp = 1;
    playerHex.maxHp = 1000;
    playerHex.wallHp = 0;
    playerHex.wallMaxHp = wallMaxHp();
    const enemyUnit = makeUnit(1, 'enemy', enemyHexId);
    enemyUnit.nextAttackAt = 0;
    mirrorSnapshot.units = [enemyUnit];
    mirrorSnapshot.nextUnitId = 2;
    const mirrorGame = new ZCGameModel(mirrorSnapshot, () => 0);

    mirrorGame.tick(1.5);
    const mirrorRuin = mirrorGame.snapshot.hexes[sourceId];
    assert.equal(mirrorRuin.state, 'ruins');
    assert.equal(mirrorRuin.owner, 'enemy');
});

test('同阵营相邻已开发地块组成连通块，抽空格也参与连接', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const [adjacentId] = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors;
    const isolated = snapshot.hexes.find((hex) => hex.owner === 'player'
        && hex.id !== ZC_PLAYER_HOME_ID
        && !ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors.includes(hex.id))!;
    for (const id of [adjacentId, isolated.id]) {
        const hex = snapshot.hexes[id];
        hex.building = 'mine';
        hex.state = 'developed';
        hex.developmentResolved = true;
        hex.cardId = '2001';
        hex.tier = 1;
        hex.hp = 530;
        hex.maxHp = 530;
    }
    const emptyId = ZC_HEX_CONFIG[adjacentId].neighbors.find((id) => snapshot.hexes[id].owner === 'player'
        && id !== ZC_PLAYER_HOME_ID && id !== isolated.id)!;
    snapshot.hexes[emptyId].building = 'none';
    snapshot.hexes[emptyId].state = 'developed';
    snapshot.hexes[emptyId].developmentResolved = true;
    const game = new ZCGameModel(snapshot);
    assert.deepEqual(new Set(game.connectedDevelopedHexIds(ZC_PLAYER_HOME_ID)), new Set([ZC_PLAYER_HOME_ID, adjacentId, emptyId]));
    assert.deepEqual(game.connectedDevelopedHexIds(isolated.id), [isolated.id]);
});

test('开发格子直接扣除格上费用、抽八卡并按每次开发 12.5% 充能', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const id = firstDevelopable(game);
    const before = game.snapshot.playerGold;
    const cost = game.snapshot.hexes[id].developmentCost;
    const result = game.developHex(id);
    const tile = game.snapshot.hexes[id];
    assert.equal(result.ok, true);
    assert.equal(game.snapshot.playerGold, before - cost);
    assert.equal(game.snapshot.artifactCharge, 12.5);
    assert.equal(tile.state, 'developed');
    assert.notEqual(tile.building, 'none');
    assert.ok(getPlayerDeck().some((card) => card.id === tile.cardId));
});

test('PVP 五类地块价格与品级基础概率符合配置表', () => {
    assert.deepEqual(
        Object.values(getPvpTileConfigs()).map((config) => [config.name, config.price, ...Object.values(config.rarityWeights)]),
        [
            ['全类型随机', 25, 0.7, 0.1, 0, 0.15, 0.05],
            ['随机兵营-普通', 50, 0, 0.74, 0.2, 0.05, 0.01],
            ['随机兵营-中等', 100, 0, 0.5, 0.4, 0.08, 0.02],
            ['随机兵营-高级', 250, 0, 0, 0, 0.9, 0.1],
            ['金矿', 50, 0, 1, 0, 0, 0],
        ],
    );
});

test('品级概率不乘同品级卡牌数量，empty=0.7 始终保持七成抽空', () => {
    const barracks = getPlayerDeck().filter((card) => card.type === ZCCardType.Barracks);
    const green = barracks.find((card) => card.rarity === '绿');
    const purple = barracks.filter((card) => card.rarity === '紫').slice(0, 2);
    assert.ok(green);
    assert.equal(purple.length, 2);
    const quantityDeck = [green, ...purple];

    assert.equal(drawPvpTile(quantityDeck, ZCPvpTileType.AllRandom, 0, () => 0.69).rarity, '空');
    assert.equal(drawPvpTile(quantityDeck, ZCPvpTileType.AllRandom, 0, () => 0.75).rarity, '绿');

    // 兵营-高级（紫 0.9 / 金 0.1）先抽品级，再在该品级阵容卡中等概率选一张。
    const advanced = drawPvpTile(getPlayerDeck(), ZCPvpTileType.BarracksAdvanced, 0, () => 0.05);
    assert.equal(advanced.card?.type, ZCCardType.Barracks);
    assert.equal(advanced.rarity, '紫');

    // 金矿地块只抽 mine 卡，且金矿卡是绿品级
    const mine = drawPvpTile(getPlayerDeck(), ZCPvpTileType.Mine, 0, () => 0.5);
    assert.equal(mine.card?.type, ZCCardType.Mine);
    assert.equal(mine.rarity, '绿');
});

test('全类型随机连续 15 次未出金时触发金色保底并重置计数', () => {
    const result = drawPvpTile(getPlayerDeck(), ZCPvpTileType.AllRandom, getAllRandomGoldPity() - 1, () => 0);
    assert.equal(result.pityTriggered, true);
    assert.equal(result.rarity, '金');
    assert.equal(result.nextAllRandomNonGoldDraws, 0);
});

test('全部地块类型均达上限时按数量最少均摊，而非固定回退 all-random', () => {
    const weights = getPvpTileTypeWeights();
    const excluded = new Set(weights.map((entry) => entry.type));
    const counts = new Map<ZCPvpTileType, number>([
        [ZCPvpTileType.AllRandom, 9],
        [ZCPvpTileType.BarracksCommon, 8],
        [ZCPvpTileType.BarracksMedium, 9],
        [ZCPvpTileType.BarracksAdvanced, 9],
        ['mine', 9],
    ]);
    const result = selectPvpTileType(() => 0.99, weights, excluded, counts);
    assert.equal(result, ZCPvpTileType.BarracksCommon);
});

test('全类型随机抽空会扣费、消耗地块并累计保底', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const id = firstDevelopable(seed);
    snapshot.playerGold = 100;
    snapshot.hexes[id].tileType = ZCPvpTileType.AllRandom;
    snapshot.hexes[id].developmentCost = 25;
    const game = new ZCGameModel(snapshot, () => 0);
    const result = game.developHex(id);
    assert.equal(result.ok, true);
    assert.equal(game.snapshot.playerGold, 75);
    assert.equal(game.snapshot.hexes[id].building, 'none');
    assert.equal(game.snapshot.hexes[id].state, 'developed');
    assert.equal(game.snapshot.allRandomNonGoldDraws.player, 1);
    assert.equal(game.canPlayerDevelop(id), false);
    assert.ok(ZC_HEX_CONFIG[id].neighbors.some((neighborId) => game.canPlayerDevelop(neighborId)));
});

test('金矿提供持续收益，兵营自动生产且单方不超过 100 个单位', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    snapshot.playerGold = 10_000;
    const [mineId, barracksId] = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors;
    snapshot.hexes[mineId].tileType = ZCPvpTileType.Mine;
    snapshot.hexes[mineId].developmentCost = 50;
    snapshot.hexes[barracksId].tileType = ZCPvpTileType.BarracksCommon;
    snapshot.hexes[barracksId].developmentCost = 50;
    const game = new ZCGameModel(snapshot, () => 0.1);
    //  别写死数值门槛。主城固定收入自 2026-09-16 起也读卡表「主城」行
    // （现表 `buildDigGoldNum=2` / `goldDigTime=6` → 每秒 0.33 金，而旧口径是 `pvpGlobal`
    // 的 2 金/秒）。「金矿建成后每秒收益必须高于只有主城时」才是这条用例的真正主张。
    const hqOnlyIncome = game.playerIncomePerSecond;
    game.developHex(mineId);
    assert.ok(
        game.playerIncomePerSecond > hqOnlyIncome,
        `金矿要真的把每秒收益抬起来（只有主城 ${hqOnlyIncome}/秒）`,
    );
    // 金矿按表里的「金矿采金周期」离散结算（当前 6 秒 / 每次 10 金）——
    // 只有跑满**整数个周期**，「平均每秒收益 × 时长」才与实际入账相等。
    // 周期从卡表读，策划再调数值不用动这里。
    const mineCycle = getPlayerDeck().find((card) => card.id === '2001')!.cycleSeconds!;
    const beforeGold = game.snapshot.playerGold;
    const income = game.playerIncomePerSecond;
    tickSeconds(game, mineCycle * 2);
    assert.ok(
        Math.abs(game.snapshot.playerGold - (beforeGold + income * mineCycle * 2)) < 1e-6,
        `两个完整金矿周期的入账应等于平均收益，实际入账 ${game.snapshot.playerGold - beforeGold}`,
    );

    game.developHex(barracksId);
    game.tick(5);
    game.tick(5);
    assert.ok(game.snapshot.units.some((unit) => unit.owner === 'player'));

    const cappedSnapshot = cloneSnapshot(game);
    cappedSnapshot.units = Array.from({ length: ZC_UNIT_CAP }, (_, index) => makeUnit(index + 1, 'player', ZC_PLAYER_HOME_ID));
    cappedSnapshot.nextUnitId = ZC_UNIT_CAP + 1;
    for (const hex of cappedSnapshot.hexes) {
        if (hex.owner === 'player' && hex.building === 'barracks') cappedSnapshot.spawnClocks[String(hex.id)] = 999;
    }
    const capped = new ZCGameModel(cappedSnapshot, () => 0.1);
    capped.tick(1);
    assert.equal(capped.snapshot.units.filter((unit) => unit.owner === 'player').length, ZC_UNIT_CAP);
});

/** 造一个「已建成、马上要产兵」的兵营快照：`spawnClocks` 拉满，下一拍就出兵。 */
function barracksSnapshot(cardId: string, constructionRemainingSeconds = 0): { snapshot: ZCSnapshot; barracksId: number } {
    const snapshot = cloneSnapshot(new ZCGameModel());
    const barracksId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    const barracks = snapshot.hexes[barracksId];
    barracks.owner = 'player';
    barracks.state = 'developed';
    barracks.building = 'barracks';
    barracks.tier = 1;
    barracks.cardId = cardId;
    barracks.developmentResolved = true;
    barracks.hp = 620;
    barracks.maxHp = 620;
    barracks.constructionTotalSeconds = constructionRemainingSeconds;
    barracks.constructionRemainingSeconds = constructionRemainingSeconds;
    snapshot.spawnClocks[`barracks:${barracksId}`] = 0;
    return { snapshot, barracksId };
}

/** 测试地图的六边格几何，用来断言落点仍在本格内。 */
const geometry = new ZCMapGeometry({
    id: ZC_MAP_ID, rows: ZC_MAP_ROWS, columns: ZC_MAP_COLUMNS,
    playerHomeId: ZC_PLAYER_HOME_ID, enemyHomeId: ZC_ENEMY_HOME_ID,
    hexes: ZC_HEX_CONFIG, owners: ZC_HEX_CONFIG.map((hex) => getZCMapOwner(hex.id)),
});

test('兵营新兵在兵营格内出生：落点离建筑中心半个格距，方向随机', () => {
    const { snapshot, barracksId } = barracksSnapshot('68001');
    snapshot.spawnClocks[`barracks:${barracksId}`] = 999;
    const center = ZC_HEX_CONFIG[barracksId];

    const spawnAt = (randomValue: number): ZCUnitState => {
        const game = new ZCGameModel(JSON.parse(JSON.stringify(snapshot)) as ZCSnapshot, () => randomValue);
        // 只推进一个仿真步：出生那一拍兵还没开始行军，读到的就是落点本身。
        game.tick(0.05);
        return game.snapshot.units.find((unit) => unit.sourceHexId === barracksId)!;
    };

    const born = spawnAt(0);
    assert.ok(born, '兵营到达产兵周期后应产出新兵，而不是从地图原点瞬移过来');
    const offset = Math.hypot(born.freeX - center.x, born.freeY - center.y);
    assert.ok(offset > 0, '新兵不能和兵营图标叠在格中心');
    // 「稍微离半个格子」：不会明显小于半格，也绝不越过半格（越过就压到邻格边线上了）。
    assert.ok(offset >= HEX_GRID_LOGICAL_ROW_STEP / 2 - 2 && offset <= HEX_GRID_LOGICAL_ROW_STEP / 2,
        `新兵落点应在半格距（${HEX_GRID_LOGICAL_ROW_STEP / 2}）以内且接近它，实际 ${offset}`);

    // 任意角度都要严格落在兵营本格内 —— 踩到公共边会被 hexIdAt 判给邻格，出兵瞬间就误占邻格。
    for (let step = 0; step < 16; step += 1) {
        const unit = spawnAt(step / 16);
        assert.ok(unit, `随机源 ${step / 16} 也应产出新兵`);
        assert.equal(geometry.hexIdAt(unit.freeX, unit.freeY), barracksId,
            `随机源 ${step / 16} 的落点跑出了兵营格`);
    }

    // 方向随机：不同随机源给出不同角度；同一个随机源仍可复现。
    const angleAt = (value: number): number => {
        const unit = spawnAt(value);
        return Math.round(Math.atan2(unit.freeY - center.y, unit.freeX - center.x) * 1e6);
    };
    const angles = new Set([0, 0.13, 0.37, 0.51, 0.79, 0.94].map(angleAt));
    assert.ok(angles.size >= 5, `六个随机源应给出多个不同出兵方向，实际只有 ${angles.size} 个`);
    assert.equal(angleAt(0.37), angleAt(0.37), '同一个随机源下出兵方向可复现');
});

// 首批数量 = 卡表 `cycleBaseValue`（2026-09-30 起）：68001 豌豆游侠产 3、68002 巨力坚果产 1。
// **两条都要在** —— 缺省口径（cycleBaseValue = 1）不能因为引入批量而回退。
for (const [cardId, cycleBaseValue, cycleSeconds] of [['68001', 3, 8], ['68002', 1, 6]] as const) {
    test(`兵营建造完成即出首批 ${cycleBaseValue} 个兵（${cardId}），之后才按 cycleSeconds 进入产兵倒计时`, () => {
        const { snapshot, barracksId } = barracksSnapshot(cardId, 1);
        const game = new ZCGameModel(snapshot, () => 0);
        // 按 owner 数兵：`sourceHexId` 是「当前所在格」，行军时会逐格改写，不能当出生兵营用。
        const playerUnits = (): number => game.snapshot.units.filter((unit) => unit.owner === 'player').length;
        const spawnClock = (): number => game.snapshot.spawnClocks[`barracks:${barracksId}`];

        game.tick(0.5);
        assert.ok(game.snapshot.hexes[barracksId].constructionRemainingSeconds > 0, '半秒时仍在建造中');
        assert.equal(playerUnits(), 0, '建造没完成就不该出兵');

        game.tick(0.5);
        assert.equal(game.snapshot.hexes[barracksId].constructionRemainingSeconds, 0, '满 1 秒时建成');
        // 🔴 建成即出首批 —— **这一格没有水波纹可等**。
        // `barracksSnapshot` 是把「已开发的兵营」直接摆进快照的（没走 `developHex`）
        // ⇒ 本格压根没有激活事件 / 没有脉冲段，推迟到「脉冲段播完」在这儿是无意义的。
        // 真实开格那条路（有激活）才推迟，见下面「开格后兵营首批兵要等脉冲段播完才出」，
        // 以及 `ZCGameModel.scheduleFirstBarracksUnit`（两条回合一口径：只补剩余那一段）。
        assert.equal(playerUnits(), cycleBaseValue, `建成那拍就要出满首批 ${cycleBaseValue} 个兵`);
        // 产兵倒计时从首批出兵那一刻起跑（此刻刚出完第一批）。
        assert.ok(spawnClock() < 0.1, `产兵倒计时应从 0 起跑，实际 ${spawnClock()}`);

        // 再走 2 秒还没到下一个周期，所以不会冒出第二批。
        game.tick(2);
        assert.equal(playerUnits(), cycleBaseValue, '首批之后的间隔是 cycleSeconds，不是 0');
        assert.ok(spawnClock() > 2 && spawnClock() < cycleSeconds, `倒计时应走到 2 秒多而未满一个周期，实际 ${spawnClock()}`);
    });
}

test('问号地块抽到的卡弹一张小卡牌：入队、按 2.4 秒过期、不写进快照', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    assert.equal(seed.cardReveals.length, 0, '开局没有待展示的小卡牌');

    // ⚠️ 两个前提都得改，缺一个 `cardReveals` 就是空（2026-10-10 起只有问号格才弹卡）：
    //  ① `tileType` 必须改成 `all-random`（`firstDevelopable` 给的可能是确定地块）；
    //  ② **卡的类型也得放开** —— 问号地块 pvpTile 配的是 `eligibleCardTypes:[4]`（只出城墙卡，`ZCCardType.Wall = 4`），
    //     而城墙卡在 `developFor` 里提前 return（耐久挂边上、不落地为格子建筑），
    //     **压根到不了 pushCardReveal**。所以额外把兵营（`ZCCardType.Barracks = 2`）加进候选，
    //     让「问号 → 出兵营卡」这条路径真的能走到弹卡。
    // `snapshot` 是 readonly 的，走 clone + 重建 model（同 developOn 的写法）。
    const hexId = firstDevelopable(seed);
    const snapshot = cloneSnapshot(seed);
    snapshot.hexes[hexId].tileType = ZCPvpTileType.AllRandom;
    snapshot.playerGold = 1e6;
    // 非金抽数顶到保底线：保证这一抽出金卡，断言里的 tier/评语才确定（与下面 developOn 同口径）。
    snapshot.allRandomNonGoldDraws.player = getAllRandomGoldPity() - 1;
    const allRandom = getPvpTileConfigs()[ZCPvpTileType.AllRandom];
    assert.ok(allRandom, 'pvpTile 应配 all-random（问号地块）');
    allRandom.eligibleCardTypes = [...(allRandom.eligibleCardTypes ?? []), ZCCardType.Barracks];
    const game = new ZCGameModel(snapshot, () => 0.1);
    const result = game.developHex(hexId);
    assert.equal(result.ok, true, `问号地块应能开发：${result.message}`);
    assert.equal(game.cardReveals.length, 1, '问号地块每抽到一张落地成建筑的卡就弹一张小卡牌');

    const reveal = game.cardReveals[0];
    const hex = game.snapshot.hexes[hexId];
    assert.equal(reveal.hexId, hexId);
    assert.ok(reveal.cardId, '弹卡需保留卡牌 id，供视图按 buildIcon 取建筑图');
    assert.equal(reveal.owner, 'player');
    assert.equal(reveal.building, hex.building);
    assert.equal(reveal.tier, hex.tier);
    assert.equal(reveal.x, ZC_HEX_CONFIG[hexId].x, '锚点取格子中心，视图不必再回查地图配置');
    assert.equal(reveal.y, ZC_HEX_CONFIG[hexId].y);
    assert.equal(reveal.durationSeconds, ZC_CARD_REVEAL_SECONDS);
    assert.ok(result.message.includes(reveal.cardName), `日志里应出现卡名「${reveal.cardName}」`);
    assert.ok(rarityNameOfTier(reveal.tier).length > 0, '品级要能映射出展示名');
    assert.ok(reveal.unitId, '兵营卡要带上产出的兵种 id —— 卡面立绘（兵种 idle 图）按它取');
    assert.ok(hasUnitDefinition(reveal.unitId), `兵种 id「${reveal.unitId}」应当是 pvpCard 里能上场的兵`);
    // 只有问号地块才弹这张卡 ⇒ `luckText` 直接按品级取，不用再按 tileType 分支。
    // （问号地块当前抽不到蓝卡，蓝卡时 `luckTextOfTier` 返回空串、视图退回品级名 Label。）
    assert.equal(reveal.luckText, luckTextOfTier(reveal.tier), '运气评语应按品级取');

    // 纯表现：不进快照，否则会牵动 version 与存档兼容。
    assert.equal('cardReveals' in (game.snapshot as unknown as Record<string, unknown>), false);
    assert.equal(JSON.stringify(game.snapshot).includes('cardName'), false);

    // 瞬时表现：到点自动过期，视图不需要自己清理。
    // ⚠️ 卡牌起点被推后了一个**收场段**（`ZC_CARD_START_SECONDS` = 脉冲 0.7 + 缩没 0.384 = 1.084）：
    // 地块先播水波纹、再原地缩没，卡牌才弹。所以从开发那一刻算起，卡牌要存活
    // 「收场段 + 卡牌段」，只推 `ZC_CARD_REVEAL_SECONDS` 是不足以让它过期的。
    game.tick(ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS * 0.5);
    assert.equal(game.cardReveals.length, 1, '卡牌才弹到中段，不该已经过期');
    game.tick(ZC_CARD_REVEAL_SECONDS);
    assert.equal(game.cardReveals.length, 0, '小卡牌应当自动过期');
});

test('运气评语只给问号地块抽得到的绿/紫/金三档：小有收获 / 大吉大利 / 欧皇降临', () => {
    assert.equal(luckTextOfTier(1), '小有收获');
    assert.equal(luckTextOfTier(3), '大吉大利');
    assert.equal(luckTextOfTier(4), '欧皇降临');
    // 蓝品级刻意没有评语，依据是地块配置而不是拍脑袋：
    assert.equal(getPvpTileConfigs()[ZCPvpTileType.AllRandom].rarityWeights.蓝, 0,
        '问号地块的蓝品级权重应当是 0 —— 抽不到蓝卡，所以不需要它的文案');
    assert.equal(luckTextOfTier(2), '', '蓝品级没有评语');
    assert.equal(luckTextOfTier(0), '', '越界品级回退空串，调用方据此换回品级名');
    assert.equal(luckTextOfTier(5), '');
});

test('只有问号地块（25）才弹小卡牌；确定地块翻出高品级卡也不弹', () => {
    const goldPity = getAllRandomGoldPity();
    assert.ok(goldPity > 0, 'pvpPity 应给问号地块配了金色保底');

    /**
     * 在指定地块类型的可开发格上抽一次卡。
     *
     *  品级必须是**确定**的，否则这条用例就变成在赌 `pvpTile` 里的权重数值：
     * 把非金抽数顶到保底线，只要卡组里有金卡，问号地块的任何随机源都会出金卡。
     *
     *  ⚠️ 问号分支还要求**卡能落地成格子建筑**：pvpTile 给 `all-random` 配的是
     *  `eligibleCardTypes:[4]`（只出城墙卡，`ZCCardType.Wall = 4`），而城墙卡在 `developFor` 里提前 return，
     *  压根到不了 `pushCardReveal` ⇒ 得把兵营（`ZCCardType.Barracks = 2`）也放进候选，否则
     *  「问号应弹卡」这条断言会拿到 0 而看起来像代码坏了。
     */
    const developOn = (tileType: ZCPvpTileType): ZCGameModel => {
        const base = new ZCGameModel(null, () => 0.1);
        const hexId = firstDevelopable(base);
        const snapshot = cloneSnapshot(base);
        snapshot.hexes[hexId].tileType = tileType;
        snapshot.allRandomNonGoldDraws.player = goldPity - 1;
        // 高级兵营地块单价 250，开局金币不够会让 developHex 直接失败
        //（`success(msg, false)` 也走 ok=false）—— 这条用例考的是弹不弹卡，不是经济。
        snapshot.playerGold = 1e6;
        const tile = getPvpTileConfigs()[tileType];
        assert.ok(tile, `pvpTile 应配 ${tileType}`);
        tile.eligibleCardTypes = [...(tile.eligibleCardTypes ?? []), ZCCardType.Barracks];
        const game = new ZCGameModel(snapshot, () => 0.1);
        assert.equal(game.developHex(hexId).ok, true, `${tileType} 地块应能开发`);
        return game;
    };

    const mystery = developOn(ZCPvpTileType.AllRandom);
    const mysteryReveal = mystery.cardReveals[0];
    assert.ok(mysteryReveal, '点问号（25）翻出卡牌应弹一张小卡牌');
    assert.equal(mysteryReveal.tier, 4, '顶到保底线后问号地块必出金卡');
    assert.equal(mysteryReveal.luckText, '欧皇降临', '问号地块的金卡要带「欧皇降临」');

    // 确定地块（高级兵营只出紫/金）：照样翻得出高品级卡，但**根本不弹卡牌** ——
    // 判据是「这格翻出什么可不可预期」，不是品级高不高。确定地块的结果本就明摆着，
    // 弹卡只是噪音（2026-10-10 口径：旧版是「都弹、只有问号给评语」）。
    const certain = developOn(ZCPvpTileType.BarracksAdvanced);
    assert.equal(certain.cardReveals.length, 0, '确定地块不该弹小卡牌');
    const hexId = firstDevelopable(new ZCGameModel(null, () => 0.1));
    const certainHex = certain.snapshot.hexes[hexId];
    assert.ok(certainHex.tier > 0, '确定地块照样正常出卡、记录品级 —— 只是不弹卡');
});

test('buildSeconds = 0 的兵营：开格那拍不出兵，脉冲段播完才落首批（= cycleBaseValue）', () => {
    const game = new ZCGameModel(null, () => 0.1);
    let instantBarracks = 0;
    let sameCallSpawns = 0;
    let batchOk = 0;
    for (let step = 0; step < 40 && game.snapshot.status === 'playing'; step += 1) {
        const hexId = game.snapshot.hexes.find((hex) => game.canPlayerDevelop(hex.id))?.id;
        if (hexId == null) break;
        const playerUnits = (): number => game.snapshot.units.filter((unit) => unit.owner === 'player').length;
        const before = playerUnits();
        const result = game.developHex(hexId);
        const hex = game.snapshot.hexes[hexId];
        if (result.ok && hex.building === 'barracks' && hex.constructionRemainingSeconds <= 0 && before < ZC_UNIT_CAP) {
            instantBarracks += 1;
            // 开格那一拍地块才开始翻 ⇒ 兵不能已经站在格子上。
            if (playerUnits() !== before) sameCallSpawns += 1;
            // 首批数量 = 该卡的 cycleBaseValue（缺省 1），到人口上限会被截断。
            const card = getPlayerDeck().find((entry) => entry.id === hex.cardId);
            const amount = Math.max(1, Math.floor(card?.cycleBaseValue ?? 1));
            const expected = Math.min(amount, ZC_UNIT_CAP - before);
            // 点击动画（`ZC_CARD_START_SECONDS` = 脉冲 ∥ 缩没同起同收，2026-10-15 row13 起两段并发）走完才出首批。
            // ⚠️ 必须走满整个点击动画：开格即完工的兵营，首批兵是被**推迟**的实体，不是立即生成。
            // ⚠️ 再补 0.05 余量：`tick` 按 `ZC_SIMULATION_STEP_SECONDS = 0.05` 的定步长消化，
            // 只喂到点（0.7）会落在 14 步 = 0.70 …边界那一拍，剩下不足一步的量留在 pending 里、当拍不出兵。
            game.tick(ZC_CARD_START_SECONDS + ZC_SIMULATION_STEP_SECONDS);
            if (playerUnits() === before + expected) batchOk += 1;
        } else {
            game.tick(1);
        }
    }
    assert.ok(instantBarracks > 0, '这段固定随机序列里应当至少开发出一个即时建成的兵营');
    assert.equal(sameCallSpawns, 0, '开格那一拍不能出首批兵（地块还在播水波纹）');
    assert.equal(batchOk, instantBarracks, '每个即时建成的兵营都要在收场动画播完后出满首批兵');
});

test('两维卡牌形成循环克制时伤害倍率为 130%，金矿不参与', () => {
    const card = (id: string) => getPlayerDeck().find((entry) => entry.id === id)!;
    const archer = card('66001');   // 精灵弓箭手：射手 / 花果
    const tank = card('60016');      // 骷髅战士：坦克 / 花果
    const mage = card('66003');    // 火法师：法师 / 花果
    const mine = card('2001');             // 金矿：没有 traits

    // 攻击维成环：坦克 → 战士 → 射手 → 法师 → 坦克
    assert.equal(cardCounterMultiplier(archer, mage), 1.3, '射手克法师');
    assert.equal(cardCounterMultiplier(mage, tank), 1.3, '法师克坦克');
    assert.equal(cardCounterMultiplier(tank, archer), 1, '坦克克战士，不克射手');
    assert.equal(cardCounterMultiplier(archer, archer), 1, '同标签不互克');

    // 阵营维成环：花果 → 蘑菇 → 盆栽 → 僵尸 → 花果
    const mushroom = getEnemyDeck().find((entry) => entry.id === '66002')!; // 猎头者：战士 / 蘑菇
    assert.equal(cardCounterMultiplier(archer, mushroom), 1.3, '花果克蘑菇');

    // 金矿没有 traits，两个方向都不参与
    assert.equal(cardCounterMultiplier(mine, archer), 1);
    assert.equal(cardCounterMultiplier(archer, mine), 1);
});

test('阵容羁绊按 pvpBond 的两维六条计算，玩家 / 敌方各自生效', () => {
    assert.equal(getPlayerDeck().length, 8);
    assert.equal(getEnemyDeck().length, 8);
    const player = calculateDeckBonuses(getPlayerDeck());
    const enemy = calculateDeckBonuses(getEnemyDeck());

    // 玩家：七个兵营全是「花果」，攻击标签 射手2 / 坦克2 / 法师1 / 战士2
    assert.deepEqual([...player.activeBonds], ['花果同心', '破阵先锋']);
    assert.equal(player.unitHpMultiplier, 1.08, '花果同心：单位生命 +8%');
    assert.equal(player.moveSpeedMultiplier, 1.08, '破阵先锋：单位移动速度 +8%');
    assert.equal(player.unitAttackMultiplier, 1, '「蘑菇军团」不生效（阵容里没有蘑菇）');
    assert.equal(player.incomeBonus, 0, '「万箭齐发」要任一攻击标签满 3 张');

    // 敌方：花果 3 / 蘑菇 5，法系 4 张 → 四条生效
    assert.deepEqual([...enemy.activeBonds], ['花果同心', '蘑菇军团', '破阵先锋', '万箭齐发']);
    assert.equal(enemy.unitAttackMultiplier, 1.08, '蘑菇军团：单位攻击 +8%');
    assert.equal(enemy.incomeBonus, 1, '万箭齐发：基础金币收入 +1/秒');
    // 「僵尸狂潮」的 effectValue 在表里是 0（文案写的是「产兵间隔倍率 -10%」），
    // 所以倍率停在 1 而不是 0.9 —— 表数据问题，这里只钉住现状。
    assert.equal(enemy.spawnIntervalMultiplier, 1);
    assert.equal(enemy.activeBonds.includes('僵尸狂潮'), false);
});

test('神器充满后转换成可用次数，释放后扣除一次并进入 1 秒冷却', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    snapshot.artifactCharge = 100;
    snapshot.units.push(makeUnit(1, 'enemy', ZC_ENEMY_HOME_ID));
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot);
    assert.equal(game.snapshot.artifactReadyUses, 1);
    assert.equal(game.useArtifact().ok, true);
    assert.equal(game.snapshot.artifactReadyUses, 0);
    assert.equal(game.snapshot.artifactCharge, 0);
    assert.equal(game.snapshot.artifactCooldown, 1);
    assert.equal(game.snapshot.enemyFrozenSeconds, 3);
    assert.equal(game.snapshot.units[0].hp, 40);
    assert.equal(game.useArtifact().ok, false);
    game.tick(1.1);
    assert.equal(game.snapshot.artifactCooldown, 0);
});

test('神器每开发一次固定充能 12.5%，充满归零并最多储存两次', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    snapshot.playerGold = 100_000;
    const game = new ZCGameModel(snapshot, () => 0.1);
    for (let index = 0; index < 16; index += 1) {
        const id = firstDevelopable(game);
        assert.equal(game.developHex(id).ok, true);
        const completedCharges = Math.floor((index + 1) / 8);
        assert.equal(game.snapshot.artifactReadyUses, Math.min(2, completedCharges));
        assert.equal(game.snapshot.artifactCharge, completedCharges >= 2 ? 0 : ((index + 1) % 8) * 12.5);
    }
    assert.equal(game.snapshot.artifactReadyUses, 2);
    assert.equal(game.snapshot.artifactCharge, 0);
});

test('相邻兵种按原版冷却、等待与攻击命中帧自动交战', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    const enemyPosition = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    snapshot.units = [makeUnit(1, 'player', ZC_PLAYER_HOME_ID), makeUnit(2, 'enemy', enemyPosition)];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0.1);
    const before = game.snapshot.units[1].hp;
    game.tick(1.9);
    assert.equal(game.snapshot.units.find((unit) => unit.id === 2)!.hp, before);
    assert.equal(game.snapshot.units.find((unit) => unit.id === 1)!.battleState, 'attack');
    game.tick(0.4);
    assert.ok(game.snapshot.units.find((unit) => unit.id === 2)!.hp < before);
    assert.ok(game.snapshot.combatEvents.some((event) => event.skillId === 30216 && event.type === 'melee'));
});

test('人物在格子之间进入攻击状态时保持连续坐标，不瞬移退回格子中心', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    const source = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID];
    const enemyHexId = source.neighbors[0];
    const player = makeUnit(1, 'player', ZC_PLAYER_HOME_ID);
    const enemy = makeUnit(2, 'enemy', enemyHexId);
    player.battleState = 'idle';
    player.targetUnitId = enemy.id;
    player.nextAttackAt = 0;
    const enemyPosition = ZC_HEX_CONFIG[enemyHexId];
    player.freeX = enemyPosition.x + (source.x - enemyPosition.x) * 0.2;
    player.freeY = enemyPosition.y + (source.y - enemyPosition.y) * 0.2;
    const expectedX = player.freeX;
    const expectedY = player.freeY;
    enemy.freeX = enemyPosition.x;
    enemy.freeY = enemyPosition.y;
    snapshot.units = [player, enemy];
    snapshot.nextUnitId = 3;

    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.1);
    const attacking = game.snapshot.units.find((unit) => unit.id === player.id)!;
    assert.equal(attacking.battleState, 'attack');
    assert.equal(attacking.freeX, expectedX);
    assert.equal(attacking.freeY, expectedY);
});

test('近战单位按 0.3 战斗距离换算，不能隔着一个六边格直接攻击', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    const source = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID];
    const enemyHexId = source.neighbors[0];
    const player = makeUnit(1, 'player', ZC_PLAYER_HOME_ID);
    const enemy = makeUnit(2, 'enemy', enemyHexId);
    player.freeX = source.x;
    player.freeY = source.y;
    player.nextAttackAt = 0;
    enemy.freeX = source.x + 45;
    enemy.freeY = source.y;
    snapshot.units = [player, enemy];
    snapshot.nextUnitId = 3;

    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.1);
    assert.notEqual(game.snapshot.units.find((unit) => unit.id === player.id)!.battleState, 'attack');
});

test('PVP 技能表驱动近战刀光、远程弹道、范围技与强化计数', () => {
    // ⚠️ 单位 id 口径：2026-09-17 起统一成「`pvpCard.id` 段」（68001..68035），
    //    旧的 army/general/monster 段（66014/66001/60016/60015）已废弃 —— 按**名字**逐一映射：
    //    民兵 66014→68023(乌瑞恩)、精灵弓箭手 66001→68001、骷髅战士 60016→68002、亡灵法师 60015→68024。
    //    （本用例原先就死在这一行 —— `resolveUnitDefinition` 对旧 id 直接抛错，4 条断言从未跑过。）
    const militia = resolveUnitDefinition('68023').attackProfile;
    const archer = resolveUnitDefinition('68001').attackProfile;
    // 68002 在 2026-09-27 起是**巨力坚果**（长枪兵普攻 30171 / melee），已不是骷髅战士；
    // 全表真正走 `area` 分支的是 68018 九头蛇（30667 怪物范围攻击）—— 按**卡表当前归属**重新对齐。
    const areaUnit = resolveUnitDefinition('68018').attackProfile;
    const necromancer = resolveUnitDefinition('68024').attackProfile;
    assert.deepEqual([militia.skillId, militia.effectKey, militia.empoweredEvery], [30216, '塔防_技能_民兵普攻_刀光', 6]);
    // 68001 豌豆游侠 2026-10-10 起走**自己的独立行 30701**（「植物占领世界」普攻特效接入时，
    // 三组「两张植物卡抢同一职业 skillId」各拆了独立行 —— 30151 留给希尔瓦娜斯等非植物卡）。
    // 独立行是**整行复制**源职业行的，所以 mode / projectileKey / empoweredEvery 必须与原来一致。
    assert.deepEqual([archer.skillId, archer.mode, archer.projectileKey, archer.empoweredEvery], [30701, 'projectile', '塔防_技能_弓兵普攻_子弹', 12]);
    const basketball = resolveUnitDefinition('68030').attackProfile;
    assert.equal(basketball.skillId, 30702, '68030 篮球天才用自己的独立行 30702（不再与 68001 共用）');
    assert.notEqual(basketball.skillId, archer.skillId, '同职业的两张植物卡必须各用各的 skillId');
    assert.deepEqual([basketball.mode, basketball.projectileKey, basketball.empoweredEvery],
        [archer.mode, archer.projectileKey, archer.empoweredEvery],
        '独立行的战斗参数必须与它复制自的职业行逐项一致');
    assert.deepEqual([areaUnit.skillId, areaUnit.mode, areaUnit.areaRadius], [30667, 'area', 60]);
    assert.deepEqual([necromancer.skillId, necromancer.mode, necromancer.projectileKey], [30671, 'projectile', '子弹_亡灵']);
});

test('remoteRef 与转表产物逐格一致：运行时读 remoteRef、用例读 doc 目录，两份必须互校', () => {
    //  ⚠️ 这个守卫是补出来的，不是一开始就有的。
    //  2026-09-21「14 职业普攻适配」把 14 张卡的 `unitSkillId` 改成了各自的普攻技能行
    //  （30181/30191/…/30401），改动落到了 `PVP-卡牌.xlsx` + `json/client` + `json/sever`，
    //  **漏了 `assets/remoteRef/pvpCard.json`** —— 而那份才是运行时真正加载的（`RefUtil` 读
    //  `remoteRef` bundle）。结果：24 个单位的普攻在真机 / 构建里一直播旧特效、14 个新技能行
    //  没有任何卡引用，**而全量用例全绿** —— 因为本文件的夹具读的是 doc 目录。
    //  两份数据从来没有互校过，这是那类「改了一半」缺陷唯一能自动拦住的地方。
    //  比对口径：按行取并集、逐格 `?? null` 归一（dense 列存写 `null`，行存形态省略空键）。
    for (const name of ['pvpCard', 'pvpSkill']) {
        const remote = new Map(readPvpRows(name).map((row) => [String(row.id ?? row.skillId), row]));
        const source = new Map(readPvpRef(name).map((row) => [String(row.id ?? row.skillId), row]));
        assert.deepEqual(Array.from(remote.keys()).sort(), Array.from(source.keys()).sort(),
            `${name}：remoteRef 与转表产物的行集合必须相同`);
        const drift: string[] = [];
        for (const [key, remoteRow] of remote) {
            const sourceRow = source.get(key)!;
            const fields = new Set([...Object.keys(remoteRow), ...Object.keys(sourceRow)]);
            for (const field of Array.from(fields)) {
                const a = remoteRow[field] ?? null;
                const b = sourceRow[field] ?? null;
                if (JSON.stringify(a) !== JSON.stringify(b)) {
                    drift.push(`${key}.${field}: remoteRef=${JSON.stringify(a)} doc=${JSON.stringify(b)}`);
                }
            }
        }
        assert.equal(drift.length, 0,
            `${name} 的 remoteRef 与转表产物不一致（运行时用的是 remoteRef）：${drift.slice(0, 6).join(' | ')}`);
    }
});

/**
 * 跑一段「某单位打一个打不死的精灵弓箭手(68001)」的对局，收集该单位打出的**全部**普攻事件。
 *
 * `combatEvents` 只保留很短的存活窗口（`tick` 里会按过期时间 filter），所以必须
 * **按模型内部步长（0.05s）轮询**、按 `event.id` 去重收集，否则一次 0.5s 的推进就会漏掉中间几拍。
 *
 * @param attackerUnitId 出手方的卡 id（真实 id，如 `'68023'` 民兵 / `'68003'` 火法师）。
 * @param seconds        推进时长（秒）。
 * @param completedAttackCount    开局时**已经打过**多少次普攻（用来验「按次数触发」的落点）。
 */
function collectAttacks(attackerUnitId: string, seconds: number, completedAttackCount: number) {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    const hero = makeUnit(1, 'player', ZC_PLAYER_HOME_ID);
    hero.unitId = attackerUnitId;   // 真实 id（旧夹具的 66014 会被快照校验拒收）
    hero.cardId = attackerUnitId;
    hero.completedAttackCount = completedAttackCount;
    //  ⚠️ 英雄自己也得加血：`makeUnit` 给的 95 点血会被对面弓箭手在 **~11 秒**打光，
    //  之后英雄阵亡、出手中止 —— 而 20 秒的窗口看不出「停了」，只会看到事件数少于预期。
    //  （旧版本只给敌人加了血，第 6 次普攻恰好落在 11.15s < 12s 窗口内，所以擦边通过；
    //   窗口或节拍任一变动就会翻成失败，且报错信息只会说「强化次数不够」。）
    hero.hp = 1_000_000;
    hero.maxHp = 1_000_000;
    const enemy = makeUnit(2, 'enemy', ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0]);
    enemy.unitId = '68001';         // 精灵弓箭手：只要 id 合法，别让快照校验拒收
    enemy.cardId = '68001';
    enemy.hp = 1_000_000;           // 别被打死，保证能连续打出多次普攻
    enemy.maxHp = 1_000_000;
    snapshot.units = [hero, enemy];
    snapshot.nextUnitId = 3;

    const game = new ZCGameModel(snapshot, () => 0.1);
    const seen = new Map<number, (typeof game.snapshot.combatEvents)[number]>();
    const firedAt = new Map<number, number>();
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
        game.tick(0.05);
        for (const event of game.snapshot.combatEvents) {
            if (event.sourceUnitId !== 1) continue;
            seen.set(event.id, event);
            if (!firedAt.has(event.id)) firedAt.set(event.id, game.snapshot.elapsedSeconds);
        }
    }
    return {
        /** 按出手先后排好的普攻事件（`event.id` 单调递增，插入序即时间序）。 */
        events: Array.from(seen.values()),
        /** 某次出手时的 `elapsedSeconds`。 */
        at: (id: number): number => firedAt.get(id) ?? -1,
    };
}

test('普攻 / 技能双链：every_seconds 触发 —— 首击不强化，满一个冷却后的那一击改用技能行 prefab', () => {
    // 老客户端（D:/City1001/client）里武将的普攻与技能是**两套独立表现**：
    //   ConquestSkillBase:        `_isGeneral ? this._skillView.exHurt : this._skillView.hurt`
    //   TF_SubStateConquest 节拍:  `isGeneral && ref.exSkillNeedTimes && newTimes % ref.exSkillNeedTimes == 0`
    // 本工程 2026-09-21 前只接了「普攻」那一半 —— `empoweredSkillId` 只进了 `event.skillId`，
    // `effectPrefabPath` 恒取普攻行，于是第 N 次普攻仍然播普攻特效（不报错，只是永远看不到技能）。
    //
    // 2026-09-21 接「42 张卡设计规格表」时先给这 14 条普攻行**统一**填了
    // `trigger='every_seconds' / cooldown=15`（设计表把大招写成「每 15 秒」）；
    // 随后山猫定的名单是**两种并存**（火法师走次数、其余走时间），民兵落在「秒」这一侧。
    // ⚠️ `cooldown` 的**秒数是策划调参**（2026-09-21 12:33 被改成 5，山猫定「先保留 5」），
    //    不是本链路的契约 —— 所以下面**不写死秒数**：读真表 + 只断言机制（冷却真的被扣、
    //    真的在下一击兑现、不拖过一整个攻击节拍）。写死数字只会让策划每次调参都红一片。
    // 触发方式两种并列（`ZCSkillTrigger`，**与 `pvpSkillBinding.trigger` 同值域**）：
    //   `every_n_attacks` → 每 `empoweredEvery` 次普攻；`every_seconds` → 距上次触发满 `cooldown` 秒。
    // 「按次数」那条分支由下面两条用例守住：一条注入表验「民兵 + 精确落点」，
    // 一条直接读真表验「火法师走次数 / 冰法师走时间」的**并存名单**。
    // ⚠️ `empoweredProfile` 挂在 **ZCUnitDefinition** 上（与 `attackProfile` 平级），不在它里面。
    const definition = resolveUnitDefinition('68023'); // 乌瑞恩 → 民兵
    const militia = definition.attackProfile;
    assert.equal(militia.skillId, 30216);
    assert.equal(militia.empoweredEvery, 6);        // 老节拍列**原值保留**，只是不再参与判定
    assert.equal(militia.empoweredSkillId, 36216);
    assert.equal(militia.trigger, 'every_seconds');
    const cooldown = militia.cooldown!;             // 策划定值，不锁死数字（见上方说明）
    assert.ok(cooldown > 0, `every_seconds 必须配一个正的冷却秒数，实际 ${militia.cooldown}`);
    assert.equal(militia.effectPrefabPath, 'units/projectiles/民兵普攻_刀光/民兵普攻_刀光');
    assert.equal(definition.empoweredProfile?.effectPrefabPath, 'units/projectiles/民兵_武将技能/民兵_武将技能');
    assert.notEqual(definition.empoweredProfile?.effectPrefabPath, militia.effectPrefabPath,
        '普攻与技能必须是两个不同的 prefab，否则等于没接技能');

    // 开局就记 `completedAttackCount = 5`（按次数语义下这一击正是第 6 次，本该强化）——
    // 故意留着，用来证明 CD 口径**完全不吃**这个计数。
    const { events, at } = collectAttacks('68023', 20, 5);
    assert.ok(events.length >= 6, `20 秒内至少该打出 6 次普攻（间隔 ${definition.attackInterval}s），实际 ${events.length}`);
    assert.equal(events[0].empowered, false, '开局第一击只记「下次可强化时刻」，不立刻强化');
    assert.equal(events[0].skillId, 30216);
    assert.equal(events[0].effectPrefabPath, 'units/projectiles/民兵普攻_刀光/民兵普攻_刀光');

    const empowered = events.filter((event) => event.empowered);
    assert.ok(empowered.length >= 1, `满 ${cooldown}s 后的那一击必须触发强化`);
    assert.deepEqual(Array.from(new Set(empowered.map((event) => event.skillId))), [36216]);
    assert.deepEqual(Array.from(new Set(empowered.map((event) => event.effectPrefabPath))),
        ['units/projectiles/民兵_武将技能/民兵_武将技能']);
    const normal = events.filter((event) => !event.empowered);
    assert.ok(normal.length >= 1, '强化之前应当先有普通普攻');
    assert.deepEqual(Array.from(new Set(normal.map((event) => event.effectPrefabPath))),
        ['units/projectiles/民兵普攻_刀光/民兵普攻_刀光']);

    // 冷却必须**真的**被扣：首击 → 首次强化 ≥ 一个冷却，且不拖过一整个攻击节拍。
    const gap = at(empowered[0].id) - at(events[0].id);
    assert.ok(gap >= cooldown, `首次强化距首击 ${gap.toFixed(2)}s，必须 ≥ ${cooldown}s 冷却`);
    assert.ok(gap < cooldown + definition.attackInterval + definition.attackDuration + 0.5,
        `首次强化距首击 ${gap.toFixed(2)}s，超过「${cooldown}s + 一个攻击节拍」—— 冷却没在下一击兑现`);
    // ⚠️ 只验「首击 → 首次强化」不够：把重置写成 `empoweredReadyAt = now`（只在第一轮扣、
    //    之后每次都强化）也能让上面两条通过。必须**逐对**验相邻强化的间隔。
    //    （2026-09-21 负向验证时正是这个缺口：破坏 `now + cooldown` → `now + 0` 用例照样绿。）
    const empowerGaps = empowered.slice(1).map((event, i) => at(event.id) - at(empowered[i].id));
    assert.ok(empowerGaps.every((g) => g >= cooldown),
        `相邻两次强化的间隔必须每次都 ≥ ${cooldown}s，实际 ${empowerGaps.map((g) => `${g.toFixed(2)}s`).join(', ')}`
        + ' —— 冷却只在第一轮生效');
});

test('普攻 / 技能双链：every_n_attacks 触发 —— 第 N 次普攻改用技能行 prefab', () => {
    // 「每 N 次普攻」是**老项目原本的节拍**（`exSkillNeedTimes`），必须继续可用。
    // 民兵（68023）在真表里被分到的是 `every_seconds`，所以这条**注入一张把 trigger 抹掉的表**
    // 把「次数」分支 + `empoweredEvery=6` 的精确落点单独钉住（跑完在 finally 里还原）。
    // 真表里那唯一的次数型（火法师）由下一条用例直接读表守。
    const oldTables = readPvpTables();
    try {
        loadPvpTables({
            ...oldTables,
            pvpSkill: (oldTables.pvpSkill ?? []).map((row) => (
                String(row.skillId) === '30216' ? { ...row, trigger: null, cooldown: 0 } : row)),
        });
        const definition = resolveUnitDefinition('68023');
        const militia = definition.attackProfile;
        // `trigger` 留空 = 按次数（消费方的默认口径）；`optionalPositiveNumber` 把 `cooldown=0` 当「未填」→ undefined。
        assert.equal(militia.trigger, undefined);
        assert.equal(militia.cooldown, undefined);
        assert.equal(militia.empoweredEvery, 6);
        assert.equal(definition.empoweredProfile?.effectPrefabPath, 'units/projectiles/民兵_武将技能/民兵_武将技能');

        const { events } = collectAttacks('68023', 20, 0);
        assert.ok(events.length >= 7, `20 秒内至少该打出 7 次普攻，实际 ${events.length}`);
        // 强化精确落在第 6 / 12 / 18… 次普攻上 —— 逐击对表，不用「≥ 1 次」糊过去。
        assert.deepEqual(events.map((event) => event.empowered),
            events.map((_, index) => (index + 1) % 6 === 0), '第 N 次普攻的强化落点不对');
        assert.deepEqual(Array.from(new Set(events.filter((event) => event.empowered)
            .map((event) => event.effectPrefabPath))), ['units/projectiles/民兵_武将技能/民兵_武将技能']);
        assert.deepEqual(Array.from(new Set(events.filter((event) => !event.empowered)
            .map((event) => event.effectPrefabPath))), ['units/projectiles/民兵普攻_刀光/民兵普攻_刀光']);
    } finally {
        loadPvpTables(oldTables);
    }
});

test('普攻 / 技能双链：真表名单 —— 火法师走次数、冰法师走时间（同表并存）', () => {
    // 2026-09-21 山猫给的名单：**每个英雄都有大招，触发分「每 N 次攻击」和「多少秒」两种**，
    // 由 `pvpSkill.trigger` 单列分流。这是真实表里**第一次**出现两套并存的分配，
    // 所以这条直接读**真表**来守（不像上一条那样注入桩）——
    // 只要有人把表再改回「一刀切」，这条就会红。
    const fire = resolveUnitDefinition('68003').attackProfile;   // 火法师
    assert.equal(fire.skillId, 30181);
    assert.equal(fire.trigger, 'every_n_attacks');
    assert.equal(fire.empoweredEvery, 10);          // 走次数 → 第 10 次普攻
    assert.equal(fire.empoweredSkillId, 36181);

    const ice = resolveUnitDefinition('68011').attackProfile;    // 冰法师
    assert.equal(ice.skillId, 30201);
    assert.equal(ice.trigger, 'every_seconds');
    // ⚠️ 秒数同上是**策划调参**（2026-09-21 12:33 改成 5）→ 只断言「配了正的冷却值」，不锁死数字。
    assert.ok(typeof ice.cooldown === 'number' && ice.cooldown > 0,
        `冰法师走时间，必须配正的 cooldown，实际 ${ice.cooldown}`);
    assert.equal(ice.empoweredEvery, 7);            // 老节拍列**保留但不参与**判定
    assert.equal(ice.empoweredSkillId, 36201);

    // 火法师（远程 projectile，攻击间隔 1.8s）：40 秒 ≈ 22 击 → 强化精确落在第 10 / 20 击。
    const { events } = collectAttacks('68003', 40, 0);
    assert.ok(events.length >= 20, `40 秒内至少该打出 20 次普攻（间隔 1.8s），实际 ${events.length}`);
    assert.deepEqual(events.map((event) => event.empowered),
        events.map((_, index) => (index + 1) % 10 === 0), '第 10 / 20 次普攻的强化落点不对');
    assert.deepEqual(Array.from(new Set(events.filter((event) => event.empowered).map((event) => event.skillId))),
        [36181], '强化那一击必须换用武将技行的 skillId');
    assert.deepEqual(Array.from(new Set(events.filter((event) => !event.empowered).map((event) => event.skillId))),
        [30181], '非强化击必须仍用普攻行的 skillId');
});

test('普攻 / 技能双链：trigger 只认两个枚举值，拼错当场抛错', () => {
    // `trigger` 决定战斗节拍，是**最不该静默回落**的一列 —— 写错拼写（`every_n_attack` 少个 s）
    // 若被当成「按次数」吞下去，表现完全正常、只是节拍不对，属于最难查的一类 bug。
    // 所以 `optionalTrigger` 选择**抛错**而不是回落，这条用例把这个契约钉住。
    const oldTables = readPvpTables();
    try {
        assert.throws(() => loadPvpTables({
            ...oldTables,
            pvpSkill: (oldTables.pvpSkill ?? []).map((row) => (
                String(row.skillId) === '30216' ? { ...row, trigger: 'every_n_attack' } : row)),
        }), /every_n_attacks \/ every_seconds/, '拼错的 trigger 必须抛错');
    } finally {
        loadPvpTables(oldTables);
    }
});

test('技能伤害倍率：武将技那一击按 pvpSkill.damageRate 放大伤害，改表立刻改伤害', () => {
    // 老客户端把伤害系数**按技能 key** 配在 `skillEffect.json` 的「基础伤害」公式里：
    //   长枪兵_普攻     = (角色攻击力+枪戟系攻击)*(长枪兵普攻伤害系数*0.01)
    //   长枪兵_武将普攻 = (角色攻击力+枪戟系攻击)*(长枪兵普攻伤害系数*0.01*2.4)
    // 2026-09-21 之前本工程只接了「什么时候放大招 / 放什么特效 / 放几发」——`unitDamage`
    // 里**没有任何 skill 输入**，所以强化击打出的伤害恒等于普攻，一分不多。
    //
    // 本用例刻意只加载 PVP 表、不加载 legacy 四表，因此验证的是兼容回退口径：
    //   `PVP-技能.damageRate` 一列，**普攻行留空（= 1）、武将技行填值**。
    //   `pvpCard.unitSkillId` → 普攻行、`attackProfile.empoweredSkillId` → 武将技行，
    //   两行各自携带自己的倍率 → 消费方按 `empowered` 二选一。
    // 正式加载器会额外加载 skillView/skillEffect/skillAttr/skillBuff，届时旧公式优先；
    // 公式路径的真实表和快照回归见 zcds-legacy-skill-effect.test.ts。
    // 倍率真源 = 老 `skillView.hurt/exHurt` → `skillEffect.json`「基础伤害」公式的**独有因子**
    // （提取脚本 `tmp/extract_old_skill_rates.py`）。⚠️ 老表 skillId 与 Demo **id 空间不一致**
    // （老 30181 = 冰法师，Demo 30181 = 火法师），必须按中文名匹配 —— 按 id 对齐会 13 组全错。
    //
    // 断言用**区间**而不是比例容差：普通击 `round(C)`、强化击 `round(C × rate)`，同一个 C。
    // 由 `normal ∈ [C-0.5, C+0.5]` 反推强化击的整数取值区间，比「比例 ≈ 2.4」紧得多
    // （对 0.5 倍那种用例，比例法连「倍率根本没生效」都分不出来）。
    const checkRate = (events: ReturnType<typeof collectAttacks>['events'], rate: number, label: string): void => {
        const normal = events.find((event) => !event.empowered);
        const strong = events.find((event) => event.empowered);
        assert.ok(normal && strong,
            `${label}：必须同时有普攻击与强化击，实际 ${events.length} 次（其中强化 ${events.filter((e) => e.empowered).length}）`);
        const lo = Math.floor((normal!.damage - 0.5) * rate) - 1;
        const hi = Math.ceil((normal!.damage + 0.5) * rate) + 1;
        assert.ok(strong!.damage >= lo && strong!.damage <= hi,
            `${label}：普攻 ${normal!.damage} × ${rate} 应落在 [${lo}, ${hi}]，实际强化击 ${strong!.damage}`);
    };

    // ① 表侧口径：普攻行留空、武将技行有值（两行各自携带）
    const militia = resolveUnitDefinition('68023');          // 乌瑞恩 → 民兵（近战 melee）
    assert.equal(militia.attackProfile.damageRate, undefined, '普攻行必须留空（= 1 倍）');
    assert.equal(militia.empoweredProfile?.damageRate, 2.4, '民兵武将技应为 2.4 倍');

    const fire = resolveUnitDefinition('68003');             // 火法师（远程 projectile）
    assert.equal(fire.attackProfile.damageRate, undefined, '普攻行必须留空（= 1 倍）');
    assert.equal(fire.empoweredProfile?.damageRate, 0.8, '火法师武将技应为 0.8 倍');

    // ② 近战路径：`unitDamage` 直接算最终伤害，倍率乘在最后
    checkRate(collectAttacks('68023', 20, 5).events, 2.4, '近战（民兵）');

    // ③ 远程路径：倍率必须落在**出手时的 `baseDamage`** 上。
    //    ⚠️ projectile 的伤害在命中时才结算（`resolveProjectileHit`：`baseDamage × 克制系数`），
    //    倍率若只加在事件的 `damage` 字段上、没进 `baseDamage`，远程职业会**静默全额失效**
    //    （事件里看着有倍率、真扣血没有）。这条专门钉住那条路。
    checkRate(collectAttacks('68003', 40, 0).events, 0.8, '远程（火法师）');

    // ④ 必须是**表驱动**：把武将技行的倍率改成 0.5，伤害立刻跟着变。
    //    没有这条，「代码里写死 2.4 / 写死 0.8」也能让 ②③ 通过。
    const oldTables = readPvpTables();
    try {
        loadPvpTables({
            ...oldTables,
            pvpSkill: (oldTables.pvpSkill ?? []).map((row) => (
                String(row.skillId) === '36216' ? { ...row, damageRate: 0.5 } : row)),
        });
        assert.equal(resolveUnitDefinition('68023').empoweredProfile?.damageRate, 0.5, '注入没生效');
        checkRate(collectAttacks('68023', 20, 5).events, 0.5, '近战（注入 0.5 倍）');
    } finally {
        loadPvpTables(oldTables);
    }
});

test('人物行走经过空地时逐格染成己方颜色', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    const borderHexId = 10 * ZC_MAP_COLUMNS + 4;
    const expected = ZC_HEX_CONFIG[borderHexId].neighbors.find((id) => snapshot.hexes[id].owner === 'enemy')!;
    snapshot.units = [makeUnit(1, 'player', borderHexId)];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(3);
    assert.equal(game.snapshot.hexes[expected].owner, 'player');
    assert.ok(['moveForward', 'move', 'target', 'idle'].includes(game.snapshot.units[0].battleState));
});

test('任一方已开发格子归零立即判负', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    snapshot.hexes.forEach((hex) => {
        if (hex.owner !== 'enemy') return;
        hex.building = 'none';
        hex.state = 'ruins';
        hex.hp = 0;
        hex.maxHp = 0;
        hex.cardId = null;
    });
    const game = new ZCGameModel(snapshot);
    assert.equal(game.snapshot.status, 'victory');
    assert.match(game.snapshot.resultReason, /已开发地块归零/);
});

test('时间结束严格按领地、主城血量、兵数、兵总血量顺序结算', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    snapshot.elapsedSeconds = 179.9;
    snapshot.hexes[ZC_ENEMY_HOME_ID].hp = 1000;
    const game = new ZCGameModel(snapshot, () => 0.1);
    game.tick(0.2);
    assert.equal(game.snapshot.status, 'victory');
    assert.match(game.snapshot.resultReason, /主城血量/);

    const territorySnapshot = cloneSnapshot(seed);
    territorySnapshot.elapsedSeconds = 179.9;
    const captured = territorySnapshot.hexes.find((hex) => hex.owner === 'enemy' && hex.building === 'none')!;
    captured.owner = 'player';
    captured.state = 'occupied';
    const territoryGame = new ZCGameModel(territorySnapshot, () => 0.1);
    territoryGame.tick(0.2);
    assert.match(territoryGame.snapshot.resultReason, /占领地块/);
});

test('真人按战力与胜负场差匹配，PVE 使用固定机器人配置', () => {
    const player = { id: 'me', power: 1000, wins: 12, losses: 7 };
    const candidates = [
        { id: 'far', power: 1400, wins: 12, losses: 7 },
        { id: 'record-far', power: 1010, wins: 30, losses: 2 },
        { id: 'best', power: 1010, wins: 13, losses: 8 },
        { id: 'pve-2', power: 900, wins: 0, losses: 0, isBot: true, fixedPriority: 2 },
        { id: 'pve-1', power: 900, wins: 0, losses: 0, isBot: true, fixedPriority: 1 },
    ];
    assert.equal(selectZCOpponent(player, candidates, 'ranked')?.id, 'best');
    assert.equal(selectZCOpponent(player, candidates, 'pve')?.id, 'pve-1');
});

test('预加载能吃下当前 pvpCard（单位列已内联）：卡牌引用的单位全部可解析', () => {
    // 回归：兵种池曾用「数字 id + 独立 pvpUnit 表」，解析层一度仍要求 id 是旧语义兵种名，
    // 预加载直接抛旧运行时 id 不支持，整个对局进不去。这条用例锁住源表 id 口径。
    const loaded = loadPvpTables(readPvpTables());
    assert.ok(loaded.unitCount > 0, 'pvpCard 必须解析出至少一个可上场单位');

    const referenced = [...getPlayerDeck(), ...getEnemyDeck()]
        .map((card) => card.unitId)
        .filter((unitId): unitId is string => typeof unitId === 'string');
    assert.ok(referenced.length > 0, '至少有一张兵营卡引用单位');

    // 卡表引用的单位必须能上场。合表后「能上场」= 该卡行配齐了「单位预设 unitPrefabPath + 普攻技能 unitSkillId」；
    // 建筑卡（主城/金矿）不带单位列是合法的。
    // 列出缺哪些单位，供补表时对照（不再在预加载期抛错）。
    const missing = findUnplayableDeckCards();
    if (missing.length) {
        assert.deepEqual(
            missing.map((entry) => entry.unitId),
            [...new Set(referenced)].filter((unitId) => !hasUnitDefinition(unitId)),
        );
        return;
    }
    for (const unitId of new Set(referenced)) {
        const definition = resolveUnitDefinition(unitId);
        assert.ok(definition.prefabPath, `单位 ${unitId} 缺父 Prefab`);
        assert.ok(definition.attackProfile, `单位 ${unitId} 缺普攻技能`);
    }
});

test('pvpCard 里配了单位预设的兵种卡都有可加载的父 Prefab 和普攻技能', () => {
    // 合表（2026-09-20）后单位列内联在卡行上：`unitPrefabPath`（父 Prefab）与
    // `unitSkillId`（普攻技能）是「这张卡能不能上场」的充要条件，**缺一即运行时抛错**，
    // 所以两列必须成对出现 —— 加新卡时最容易犯的就是只填了一列。
    const rows = readPvpRef('pvpCard');
    let checked = 0;
    for (const row of rows) {
        if (!row.unitPrefabPath && row.unitSkillId == null) continue;
        const label = `${row.id} 「${row.name}」`;
        assert.equal(typeof row.unitPrefabPath, 'string', `兵种卡 ${label} 缺 unitPrefabPath`);
        assert.equal(typeof row.unitSkillId, 'number', `兵种卡 ${label} 缺 unitSkillId`);
        assert.ok(
            existsSync(`assets/resources/${row.unitPrefabPath}.prefab`),
            `兵种卡 ${label} 的 Prefab 不存在：${row.unitPrefabPath}`,
        );
        checked += 1;
    }
    // 交叉核对：带单位列的卡行数必须等于解析层认定的「可上场单位数」。
    // 少一个就说明有卡行的单位列没被识别（列名漂了会静默变 0，本用例就会红），
    // 避免上面那个循环在表结构再变一次之后变成空转。
    assert.equal(
        checked,
        loadPvpTables(readPvpTables()).unitCount,
        '带单位列的卡行数与解析出的可上场单位数不一致',
    );
});

test('运行时 JSON 驱动卡组、单位数值、建筑建造及产金倒计时', () => {
    const loaded = loadPvpTables(readPvpTables());
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(loaded.cardCount, 16);
    assert.equal(resolveUnitDefinition('66001').attackInterval, 2);
    assert.equal(getPvpRuntimeRules().combatDamageMultiplier, 1.2);
    assert.equal(getPvpRuntimeRules().combatDistanceScale, 0.3);
    assert.equal(getPvpRuntimeRules().towerAttackInterval, 0.8);
    assert.equal(getPlayerDeck().find((card) => card.id === '2001')?.buildSeconds, 0);

    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const mineId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
    snapshot.playerGold = 1000;
    snapshot.hexes[mineId].tileType = ZCPvpTileType.Mine;
    snapshot.hexes[mineId].developmentCost = 50;
    const game = new ZCGameModel(snapshot, () => 0);
    game.developHex(mineId);
    // buildSeconds=0：立即建成，无建造阶段，直接进入产金周期。
    assert.equal(game.snapshot.hexes[mineId].constructionRemainingSeconds, 0);
    assert.equal(game.buildingCooldown(mineId)?.phase, 'income');

    const afterPayment = game.snapshot.playerGold;
    const hqIncomePerSecond = game.playerIncomePerSecond;
    game.tick(1);
    assert.ok(game.snapshot.playerGold >= afterPayment, '立即建成的金矿与主城按各自周期产金');
    assert.equal(game.buildingCooldown(mineId)?.phase, 'income');
});

test('pvpCard.json 数字 rarity 1/2/3/4 对应绿/蓝/紫/金', () => {
    const rows = readPvpRows('pvpCard');
    // 卡表是「卡池 + 出战 + 1 行主城」混排：卡池行没 `deck`，主城行有 `deck` 但不进卡组
    const deckRows = rows.filter((row) => typeof row.deck === 'string' && (row.deck as string).trim().length > 0);
    // 主城挂在「玩家默认」slot=0 只是为了过转表器（首列 `deck` 空的行不导出）；
    // 它不在卡组里，所以这里要摘掉才是「玩家默认 8 + PVE敌方 8」。
    const lineupRows = deckRows.filter((row) => Number(row.type) !== ZCCardType.Hq);
    assert.equal(deckRows.length, 17, '16 张出战 + 1 行主城');
    assert.equal(lineupRows.length, 16, '玩家默认 8 + PVE敌方 8');
    const oldTables = readPvpTables();
    try {
        assert.equal(loadPvpTables({ ...oldTables, pvpCard: rows }).cardCount, 16, 'cardCount 只数出战卡，不含主城');
        const rarityNames = ['', '绿', '蓝', '紫', '金'];
        for (const row of lineupRows) {
            const deck = row.deck === '玩家默认' ? getPlayerDeck() : getEnemyDeck();
            //  表里 `id` 是**整数**（2026-09-20 起，`PVP-卡牌.xlsx` 的 id 列改成了 int），
            // 而解析出来的 `card.id` 一律是字符串 —— 比较前必须先归一。直接 `card.id === row.id`
            // 在类型不同的时候严格相等恒为 false，`find` 会**静默**返回 undefined，
            // 症状是断言里 rarity 变成 undefined（报错信息只写 `2001 / undefined !== '绿'`）。
            assert.equal(deck.find((card) => card.id === String(row.id))?.rarity, rarityNames[row.rarity as number], String(row.id));
        }
        assert.throws(() => loadPvpTables({ ...oldTables, pvpCard: rows.map((row, index) =>
            index === 0 ? { ...row, rarity: 5 } : row) }), /cards\[\]\.rarity/);
    } finally {
        loadPvpTables(oldTables);
    }
});

test('索敌按敌方单位、城墙、建筑分级，并在每一级选择最近目标', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const enemyHexId = ZC_HEX_CONFIG[sourceId].neighbors.find((id) => seed.snapshot.hexes[id].owner === 'enemy')!;

    const createSnapshot = (): ZCSnapshot => {
        const snapshot = cloneSnapshot(seed);
        const enemyHex = snapshot.hexes[enemyHexId];
        enemyHex.owner = 'enemy';
        enemyHex.state = 'developed';
        enemyHex.developmentResolved = true;
        enemyHex.building = 'tower';
        enemyHex.tier = 1;
        enemyHex.cardId = '66011';
        enemyHex.hp = 1000;
        enemyHex.maxHp = 1000;
        enemyHex.wallHp = wallMaxHp();
        enemyHex.wallMaxHp = wallMaxHp();
        enemyHex.constructionRemainingSeconds = 999;
        enemyHex.constructionTotalSeconds = 999;
        return snapshot;
    };

    const unitSnapshot = createSnapshot();
    unitSnapshot.units = [makeUnit(1, 'player', sourceId), makeUnit(2, 'enemy', enemyHexId)];
    unitSnapshot.nextUnitId = 3;
    const unitGame = new ZCGameModel(unitSnapshot, () => 0);
    unitGame.tick(0.2);
    assert.equal(unitGame.snapshot.units[0].targetUnitId, 2);
    assert.equal(unitGame.snapshot.units[0].targetWallHexId, null);
    assert.equal(unitGame.snapshot.units[0].targetBuildingHexId, null);

    const wallSnapshot = createSnapshot();
    wallSnapshot.units = [makeUnit(1, 'player', sourceId)];
    wallSnapshot.nextUnitId = 2;
    const wallGame = new ZCGameModel(wallSnapshot, () => 0);
    wallGame.tick(0.2);
    assert.equal(wallGame.snapshot.units[0].targetWallHexId, enemyHexId);
    assert.equal(wallGame.snapshot.units[0].targetBuildingHexId, null);

    const buildingSnapshot = createSnapshot();
    buildingSnapshot.hexes[enemyHexId].wallHp = 0;
    buildingSnapshot.units = [makeUnit(1, 'player', sourceId)];
    buildingSnapshot.nextUnitId = 2;
    const buildingGame = new ZCGameModel(buildingSnapshot, () => 0);
    buildingGame.tick(0.2);
    assert.equal(buildingGame.snapshot.units[0].targetWallHexId, null);
    assert.equal(buildingGame.snapshot.units[0].targetBuildingHexId, enemyHexId);
});

test('建筑前方的抽空地块仍有城墙时，优先攻击前置城墙', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const bareWallId = ZC_HEX_CONFIG[sourceId].neighbors
        .find((id) => seed.snapshot.hexes[id].owner === 'enemy')!;
    const buildingWallId = ZC_HEX_CONFIG[bareWallId].neighbors
        .filter((id) => seed.snapshot.hexes[id].owner === 'enemy' && id !== sourceId)
        .sort((a, b) => {
            const source = ZC_HEX_CONFIG[sourceId];
            const distance = (id: number) => (ZC_HEX_CONFIG[id].x - source.x) ** 2 + (ZC_HEX_CONFIG[id].y - source.y) ** 2;
            return distance(b) - distance(a);
        })[0];

    const snapshot = cloneSnapshot(seed);
    // 抽空地块：没有建筑，但开发后留下的城墙正好挡在单位和后方建筑之间。
    const bareWallHex = snapshot.hexes[bareWallId];
    bareWallHex.owner = 'enemy';
    bareWallHex.state = 'developed';
    bareWallHex.developmentResolved = true;
    bareWallHex.building = 'none';
    bareWallHex.wallHp = wallMaxHp();
    bareWallHex.wallMaxHp = wallMaxHp();
    // 后方建筑也有自己的城墙，单位仍不能越过更近的前置空城墙去打它。
    const buildingHex = snapshot.hexes[buildingWallId];
    buildingHex.owner = 'enemy';
    buildingHex.state = 'developed';
    buildingHex.developmentResolved = true;
    buildingHex.building = 'tower';
    buildingHex.tier = 1;
    buildingHex.cardId = '66011';
    buildingHex.hp = 1000;
    buildingHex.maxHp = 1000;
    buildingHex.wallHp = wallMaxHp();
    buildingHex.wallMaxHp = wallMaxHp();

    snapshot.units = [makeUnit(1, 'player', sourceId)];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.2);
    assert.equal(game.snapshot.units[0].targetWallHexId, bareWallId);
    assert.equal(game.snapshot.units[0].targetBuildingHexId, null);
});

test('全图最近索敌：更近的敌方单位优先于较远的仇恨单位', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const enemyHexId = ZC_HEX_CONFIG[sourceId].neighbors
        .find((id) => seed.snapshot.hexes[id].owner === 'enemy')!;

    const snapshot = cloneSnapshot(seed);
    const me = makeUnit(1, 'player', sourceId);
    me.hatredUnitId = 2; // 仇恨单位：被它攻击过
    me.hatredUntil = 5; // 5 秒仇恨窗口内
    const hater = makeUnit(2, 'enemy', enemyHexId);
    const closer = makeUnit(3, 'enemy', sourceId); // 更近（同格距离 0），但不是仇恨单位
    snapshot.units = [me, hater, closer];
    snapshot.nextUnitId = 4;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.2);
    assert.equal(game.snapshot.units[0].targetUnitId, 3);
});

test('全图最近索敌：推进中的单位仍追击身后最近的敌方单位', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4; // row10：朝 row<10（敌方主城）推进
    const behindId = 11 * ZC_MAP_COLUMNS + 4; // row11：身后（玩家主城方向）

    const snapshot = cloneSnapshot(seed);
    const me = makeUnit(1, 'player', sourceId);
    me.battleState = 'moveForward';
    me.marchAngle = null;
    const behind = makeUnit(2, 'enemy', behindId);
    // 放到身后（y 减小方向）斜侧约 48.7px：在索敌范围（54px）内、但超出"身后 1 格（42px）紧急拦截"边界
    const mePos = ZC_HEX_CONFIG[sourceId];
    behind.freeX = mePos.x + 8;
    behind.freeY = mePos.y - 48;
    snapshot.units = [me, behind];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.2);
    assert.equal(game.snapshot.units[0].targetUnitId, 2);
    assert.equal(game.snapshot.units[0].battleState, 'move');
});

test('近战单位追击同格内格心射程外的敌人', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const snapshot = cloneSnapshot(seed);
    const pursuer = makeUnit(1, 'player', sourceId);
    pursuer.unitId = '68002';
    pursuer.cardId = '68002';
    pursuer.battleState = 'move';
    pursuer.targetUnitId = 2;
    const target = makeUnit(2, 'enemy', sourceId);
    target.unitId = '68007';
    target.cardId = '68007';
    target.battleState = 'attack';
    target.freeX += 11;
    target.freeY += 20;
    assert.equal(geometry.hexIdAt(target.freeX, target.freeY), sourceId);
    const reach = (resolveUnitDefinition('68002').attackRange + resolveUnitDefinition('68007').bodyRadius)
        * getPvpRuntimeRules().combatDistanceScale;
    assert.ok(Math.hypot(target.freeX - pursuer.freeX, target.freeY - pursuer.freeY) > reach);
    snapshot.units = [pursuer, target];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0.1);

    game.tick(0.05);

    assert.equal(game.snapshot.units[0].battleState, 'move');
    assert.ok(game.snapshot.units[0].freeX > pursuer.freeX);
    assert.ok(game.snapshot.units[0].freeY > pursuer.freeY);
    game.tick(0.2);
    assert.ok(Math.hypot(game.snapshot.units[0].freeX - target.freeX,
        game.snapshot.units[0].freeY - target.freeY) <= reach);
});

test('近战单位在没有射程内格心时仍前往目标所在格', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const targetHexId = 10 * ZC_MAP_COLUMNS + 4;
    const sourceId = ZC_HEX_CONFIG[targetHexId].neighbors.find((id) =>
        seed.snapshot.hexes[id].building === 'none')!;
    const snapshot = cloneSnapshot(seed);
    const pursuer = makeUnit(1, 'player', sourceId);
    pursuer.unitId = '68002';
    pursuer.cardId = '68002';
    pursuer.battleState = 'move';
    pursuer.targetUnitId = 2;
    const target = makeUnit(2, 'enemy', targetHexId);
    target.unitId = '68007';
    target.cardId = '68007';
    target.battleState = 'attack';
    target.freeX += 11;
    target.freeY += 20;
    assert.equal(geometry.hexIdAt(target.freeX, target.freeY), targetHexId);
    const reach = (resolveUnitDefinition('68002').attackRange + resolveUnitDefinition('68007').bodyRadius)
        * getPvpRuntimeRules().combatDistanceScale;
    assert.ok(ZC_HEX_CONFIG.every((hex) => Math.hypot(target.freeX - hex.x, target.freeY - hex.y) > reach));
    snapshot.units = [pursuer, target];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0.1);

    game.tick(0.05);

    assert.equal(game.snapshot.units[0].battleState, 'move');
    assert.equal(game.snapshot.units[0].targetHexId, targetHexId);
    assert.notDeepEqual([game.snapshot.units[0].freeX, game.snapshot.units[0].freeY],
        [pursuer.freeX, pursuer.freeY]);
});

test('推进中的单位紧急拦截身后 1 格内的敌方单位，防止漏怪贴脸', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4; // row10
    const hugId = 11 * ZC_MAP_COLUMNS + 4; // row11 同列 = 身后相邻格（42px）

    const snapshot = cloneSnapshot(seed);
    const me = makeUnit(1, 'player', sourceId);
    me.battleState = 'moveForward';
    me.marchAngle = null;
    const hugger = makeUnit(2, 'enemy', hugId);
    snapshot.units = [me, hugger];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.2);
    assert.equal(game.snapshot.units[0].targetUnitId, 2);
});

test('推进中的单位正常锁定前进方向上的敌方单位', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4; // row10
    const frontId = 9 * ZC_MAP_COLUMNS + 4; // row9：前进方向

    const snapshot = cloneSnapshot(seed);
    const me = makeUnit(1, 'player', sourceId);
    me.battleState = 'moveForward';
    me.marchAngle = null;
    const front = makeUnit(2, 'enemy', frontId);
    snapshot.units = [me, front];
    snapshot.nextUnitId = 3;
    const game = new ZCGameModel(snapshot, () => 0);
    game.tick(0.2);
    assert.equal(game.snapshot.units[0].targetUnitId, 2);
});

test('单位先摧毁城墙，再对城墙后的建筑造成伤害', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const enemyHexId = ZC_HEX_CONFIG[sourceId].neighbors.find((id) => snapshot.hexes[id].owner === 'enemy')!;
    const enemyHex = snapshot.hexes[enemyHexId];
    enemyHex.state = 'developed';
    enemyHex.developmentResolved = true;
    enemyHex.building = 'tower';
    enemyHex.tier = 1;
    enemyHex.cardId = '66011';
    enemyHex.hp = 1000;
    enemyHex.maxHp = 1000;
    enemyHex.wallHp = 1;
    enemyHex.wallMaxHp = wallMaxHp();
    enemyHex.constructionRemainingSeconds = 999;
    enemyHex.constructionTotalSeconds = 999;

    const attacker = makeUnit(1, 'player', sourceId);
    attacker.nextAttackAt = 0;
    snapshot.units = [attacker];
    snapshot.nextUnitId = 2;
    const game = new ZCGameModel(snapshot, () => 0);

    let wallFloatId = 0;
    for (let step = 0; step < 30 && game.snapshot.hexes[enemyHexId].wallHp > 0; step += 1) {
        game.tick(0.1);
        wallFloatId = [...game.floatTexts].reverse().find((text) => text.kind === 'damage')?.id ?? wallFloatId;
    }
    assert.equal(game.snapshot.hexes[enemyHexId].wallHp, 0);
    const wallFloat = game.floatTexts.find((text) => text.id === wallFloatId);
    assert.ok(wallFloat, '命中城墙必须产生伤害飘字');
    assert.equal(wallFloat.value, 1, '城墙只剩 1 点耐久时显示实际扣除值');
    assert.equal(wallFloat.x, ZC_HEX_CONFIG[enemyHexId].x);
    assert.equal(wallFloat.y, ZC_HEX_CONFIG[enemyHexId].y);
    assert.ok(Number.isInteger(game.snapshot.hexes[enemyHexId].wallBreachedEdge));
    assert.ok(game.snapshot.hexes[enemyHexId].wallBreachedEdge! >= 0 && game.snapshot.hexes[enemyHexId].wallBreachedEdge! <= 5);
    assert.equal(game.snapshot.hexes[enemyHexId].hp, 1000);

    let buildingFloatId = 0;
    for (let step = 0; step < 50 && game.snapshot.hexes[enemyHexId].hp === 1000; step += 1) {
        game.tick(0.1);
        buildingFloatId = [...game.floatTexts].reverse()
            .find((text) => text.kind === 'damage' && text.id > wallFloatId)?.id ?? buildingFloatId;
    }
    assert.ok(game.snapshot.hexes[enemyHexId].hp < 1000);
    const buildingFloat = game.floatTexts.find((text) => text.id === buildingFloatId);
    assert.ok(buildingFloat, '破墙后命中建筑必须再次产生伤害飘字');
    assert.ok(buildingFloat.value > 0);
    assert.equal(buildingFloat.x, ZC_HEX_CONFIG[enemyHexId].x);
    assert.equal(buildingFloat.y, ZC_HEX_CONFIG[enemyHexId].y);
});

test('命中产生伤害飘字：数值取实际扣血，归属取攻击方', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const enemyUnit = makeUnit(7, 'enemy', ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].neighbors[0]);
    enemyUnit.hp = 20;
    enemyUnit.maxHp = 20;
    enemyUnit.battleState = 'idle';
    snapshot.units = [enemyUnit];
    snapshot.nextUnitId = 8;
    snapshot.artifactCharge = 100;
    const game = new ZCGameModel(snapshot, () => 0.1);

    const rules = getPvpRuntimeRules();
    game.useArtifact();

    // 神器伤害来源为空，按我方记功：飘字归属应为 player，数值是这一击实际打掉的血。
    const damage = game.floatTexts.filter((text) => text.kind === 'damage');
    assert.equal(damage.length, 1);
    assert.equal(damage[0].owner, 'player');
    assert.equal(damage[0].value, 20);
    assert.equal(damage[0].x, enemyUnit.freeX);
    assert.equal(damage[0].y, enemyUnit.freeY);
    assert.ok(damage[0].durationSeconds > 0);

    // 满血目标只掉血不死：仍然出伤害飘字，但不出击杀奖励。
    const survivorSnapshot = cloneSnapshot(seed);
    const survivor = makeUnit(7, 'enemy', ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].neighbors[0]);
    survivor.hp = 500;
    survivor.maxHp = 500;
    survivorSnapshot.units = [survivor];
    survivorSnapshot.nextUnitId = 8;
    survivorSnapshot.artifactCharge = 100;
    const survivorGame = new ZCGameModel(survivorSnapshot, () => 0.1);
    survivorGame.useArtifact();
    assert.deepEqual(survivorGame.floatTexts.map((text) => [text.kind, text.value]),
        [['damage', rules.artifactDamage]]);
});

test('Old Client 技能飘字：暴击与秒杀沿命中链透传，治疗显示实际回复量', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const target = makeUnit(7, 'enemy', ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].neighbors[0]);
    target.unitId = [...(game as any).definitions.keys()][0];
    target.hp = 100;
    target.maxHp = 100;
    (game as any).state.units = [target];
    (game as any).state.nextUnitId = 8;
    (game as any).units.register(target);

    const hitText = (game as any).damageUnit(target, 10, {
        owner: 'player', kind: 'unit', unitId: 99, floatTextKind: 'critical',
    });
    assert.equal(hitText.kind, 'critical');
    assert.equal(hitText.value, 10);

    (game as any).tryExecuteUnit(target, 1, 'player', 99, hitText);
    const combatTexts = game.floatTexts.filter((text) => text.kind !== 'gold');
    assert.deepEqual(combatTexts.map((text) => [text.kind, text.value]), [['execute', 100]],
        '秒杀应合并前一段伤害，避免同一击重复飘两条数字');

    const healGame = new ZCGameModel(null, () => 0.1);
    const ally = makeUnit(7, 'player', ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0]);
    ally.unitId = [...(healGame as any).definitions.keys()][0];
    ally.hp = 70;
    ally.maxHp = 100;
    ZCStatusResolutionSystem.healUnit(ally, 50, (healGame as any).statusResolutionContext);
    const heal = healGame.floatTexts.find((text) => text.kind === 'heal');
    assert.deepEqual(heal && [heal.owner, heal.value], ['player', 30], '治疗飘字只显示没有溢出的实际回复量');
});

test('金矿产金与击杀、摧毁奖励都飘金币数值，数值全部来自配置表', () => {
    const rules = getPvpRuntimeRules();
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    snapshot.playerGold = 10_000;
    const [mineId] = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors;
    snapshot.hexes[mineId].tileType = ZCPvpTileType.Mine;
    snapshot.hexes[mineId].developmentCost = 50;
    const game = new ZCGameModel(snapshot, () => 0.1);
    game.developHex(mineId);

    // 刚开发完还没到产出周期：此时连主城的按秒产金都还没走到，一条飘字都不该有。
    assert.equal(game.floatTexts.length, 0, '刚开发完还没有产出周期');
    const beforeGold = game.snapshot.playerGold;
    // 金矿采金周期从卡表读（当前 6 秒）；跑满一个周期才会结算一次金币飘字。
    tickSeconds(game, getPlayerDeck().find((card) => card.id === '2001')!.cycleSeconds!);
    const income = game.floatTexts.filter((text) => text.kind === 'gold');
    const mineHex = ZC_HEX_CONFIG[mineId];
    const homeHex = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID];
    const atMine = income.filter((text) => text.x === mineHex.x && text.y === mineHex.y);
    const atHome = income.filter((text) => text.x === homeHex.x && text.y === homeHex.y);
    assert.ok(atMine.length > 0, '金矿（金币建筑）产金应产生金币飘字');
    assert.ok(atHome.length > 0, '主城的固定收入也要飘在自家主城那一格');
    for (const text of atMine) {
        assert.equal(text.owner, 'player');
        assert.ok(text.value > 0);
    }
    assert.ok(income.some((text) => text.owner === 'enemy'), '敌方主城收入同样上屏（双方都飘）');
    const incomeTotal = income.filter((text) => text.owner === 'player')
        .reduce((total, text) => total + text.value, 0);
    assert.ok(game.snapshot.playerGold >= beforeGold + incomeTotal, '我方飘字数值之和必须真的加进了金币');
});

test('击杀敌方单位与摧毁敌方建筑都给击杀方加金币，并飘出对应数值', () => {
    const rules = getPvpRuntimeRules();
    assert.ok(rules.killUnitGoldReward > 0 && rules.destroyBuildingGoldReward > 0, '两项奖励都要在 pvpGlobal 里配成正数');

    // ① 击杀：神器打死 hp=20 的敌方单位。
    const seed = new ZCGameModel(null, () => 0.1);
    const killSnapshot = cloneSnapshot(seed);
    const victimHexId = ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].neighbors[0];
    const victim = makeUnit(7, 'enemy', victimHexId);
    victim.hp = 20;
    victim.maxHp = 20;
    killSnapshot.units = [victim];
    killSnapshot.nextUnitId = 8;
    killSnapshot.artifactCharge = 100;
    killSnapshot.playerGold = 1000;
    const killGame = new ZCGameModel(killSnapshot, () => 0.1);
    killGame.useArtifact();
    // 主城同期也在按秒产金，所以金币总量只校验「不少于基础值 + 奖励」；
    // 击杀那一条靠位置锁定（飘在被击杀单位身上），避免混进周期性收入。
    assert.ok(killGame.snapshot.playerGold >= 1000 + rules.killUnitGoldReward);
    assert.deepEqual(
        killGame.floatTexts
            .filter((text) => text.kind === 'gold' && text.x === victim.freeX && text.y === victim.freeY)
            .map((text) => [text.owner, text.value]),
        [['player', rules.killUnitGoldReward]],
    );

    // ② 摧毁建筑：我军单位打掉敌方建筑。用「无金矿 + 主城固定收入」把金币增量的干扰降到只可能来自奖励。
    const destroySnapshot = cloneSnapshot(seed);
    const sourceId = 10 * ZC_MAP_COLUMNS + 4;
    const enemyHexId = ZC_HEX_CONFIG[sourceId].neighbors.find((id) => destroySnapshot.hexes[id].owner === 'enemy')!;
    const enemyHex = destroySnapshot.hexes[enemyHexId];
    enemyHex.state = 'developed';
    enemyHex.developmentResolved = true;
    enemyHex.building = 'barracks';
    enemyHex.tier = 1;
    enemyHex.cardId = '66001';
    enemyHex.hp = 1;
    enemyHex.maxHp = 1000;
    enemyHex.wallHp = 0;
    enemyHex.wallMaxHp = wallMaxHp();
    enemyHex.constructionRemainingSeconds = 0;
    enemyHex.constructionTotalSeconds = 0;
    const attacker = makeUnit(1, 'player', sourceId);
    attacker.nextAttackAt = 0;
    attacker.hp = 5;
    attacker.maxHp = 5;
    destroySnapshot.units = [attacker];
    destroySnapshot.nextUnitId = 2;
    const destroyGame = new ZCGameModel(destroySnapshot, () => 0.1);
    const goldBefore = destroyGame.snapshot.playerGold;

    destroyGame.tick(1.5);
    assert.equal(destroyGame.snapshot.hexes[enemyHexId].state, 'ruins');
    // 摧毁奖励同样按位置锁定在被摧毁的格子上（主城收入也在这个时段飘）。
    const rewardHex = ZC_HEX_CONFIG[enemyHexId];
    const reward = destroyGame.floatTexts.filter((text) => text.kind === 'gold'
        && text.x === rewardHex.x && text.y === rewardHex.y);
    assert.ok(reward.length > 0, '摧毁建筑应产生金币飘字');
    const rewardValue = reward.reduce((total, text) => total + text.value, 0);
    assert.equal(rewardValue, rules.destroyBuildingGoldReward);
    assert.ok(reward.every((text) => text.owner === 'player'));
    assert.ok(destroyGame.snapshot.playerGold >= goldBefore + rules.destroyBuildingGoldReward);

    // ③ 反向：敌方打掉我方建筑，金币与飘字归敌方。
    const mirrorSnapshot = cloneSnapshot(seed);
    const playerHex = mirrorSnapshot.hexes[sourceId];
    playerHex.state = 'developed';
    playerHex.developmentResolved = true;
    playerHex.building = 'barracks';
    playerHex.tier = 1;
    playerHex.cardId = '66001';
    playerHex.hp = 1;
    playerHex.maxHp = 1000;
    playerHex.wallHp = 0;
    playerHex.wallMaxHp = wallMaxHp();
    const enemyUnit = makeUnit(1, 'enemy', enemyHexId);
    enemyUnit.nextAttackAt = 0;
    mirrorSnapshot.units = [enemyUnit];
    mirrorSnapshot.nextUnitId = 2;
    mirrorSnapshot.enemyGold = 1000;
    const mirrorGame = new ZCGameModel(mirrorSnapshot, () => 0.1);
    mirrorGame.tick(1.5);
    const mirrorHex = ZC_HEX_CONFIG[sourceId];
    const mirrorReward = mirrorGame.floatTexts.filter((text) => text.kind === 'gold'
        && text.x === mirrorHex.x && text.y === mirrorHex.y);
    assert.ok(mirrorReward.length > 0);
    assert.ok(mirrorReward.every((text) => text.owner === 'enemy'));
    assert.ok(mirrorGame.snapshot.enemyGold >= 1000 + rules.destroyBuildingGoldReward);
});

test('飘字是瞬时表现：会过期清理，也不写进快照', () => {
    const seed = new ZCGameModel(null, () => 0.1);
    const snapshot = cloneSnapshot(seed);
    const victim = makeUnit(7, 'enemy', ZC_HEX_CONFIG[ZC_ENEMY_HOME_ID].neighbors[0]);
    victim.hp = 20;
    victim.maxHp = 20;
    snapshot.units = [victim];
    snapshot.nextUnitId = 8;
    snapshot.artifactCharge = 100;
    const game = new ZCGameModel(snapshot, () => 0.1);
    game.useArtifact();
    assert.ok(game.floatTexts.length > 0);
    assert.equal(Object.prototype.hasOwnProperty.call(game.snapshot, 'floatTexts'), false, '飘字不进快照，避免牵动 version 与存档兼容');

    game.tick(2);
    assert.equal(game.floatTexts.filter((text) => text.startedAt === 0).length, 0, '超过存活时长的飘字必须被清掉');
    game.reset();
    assert.deepEqual([...game.floatTexts], []);
});

test('圆形进度数据覆盖主城和金矿产金、兵营出兵、箭塔攻击 CD', () => {
    const seed = new ZCGameModel();
    const snapshot = cloneSnapshot(seed);
    snapshot.incomeClock = 0.5;
    const [mineId, barracksId, towerId] = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors;
    const setups = [
        { id: mineId, building: 'mine' as const, cardId: '2001', clock: 1 },
        { id: barracksId, building: 'barracks' as const, cardId: '66001', clock: 3.45 },
        { id: towerId, building: 'tower' as const, cardId: '66011', clock: 0.4 },
    ];
    for (const setup of setups) {
        const hex = snapshot.hexes[setup.id];
        hex.owner = 'player';
        hex.state = 'developed';
        hex.building = setup.building;
        hex.tier = 1;
        hex.cardId = setup.cardId;
        hex.developmentResolved = true;
        hex.hp = 100;
        hex.maxHp = 100;
        hex.constructionRemainingSeconds = 0;
        snapshot.spawnClocks[`${setup.building}:${setup.id}`] = setup.clock;
    }
    const game = new ZCGameModel(snapshot, () => 0);
    assert.deepEqual(
        [ZC_PLAYER_HOME_ID, mineId, barracksId, towerId].map((id) => game.buildingCooldown(id)?.phase),
        ['income', 'income', 'spawn', 'attack'],
    );
    for (const id of [ZC_PLAYER_HOME_ID, mineId, barracksId, towerId]) {
        const cooldown = game.buildingCooldown(id)!;
        assert.ok(cooldown.progress > 0 && cooldown.progress < 1);
        assert.ok(cooldown.totalSeconds > 0);
    }
});

test('建筑耐久与金币产出都走卡表：baseHp + 品级×cyclePerTierValue，产金读 buildDigGoldNum', () => {
    // 覆盖 2026-09-16 定的口径：卡表 type 数字化（1金矿/2兵营/5主城）；
    // 建筑耐久 = 卡自身 `baseHp + 品级 × cyclePerTierValue`（「建筑生命」表已删，
    // 合表后单位列也只在兵种卡上出现，建筑行不带单位列）；产金数量 = 卡 `buildDigGoldNum`（固定值，不随品级）。
    // 这里给金矿/主城塞合成数值（999/111、3300），证明取数确实来自卡表。
    const base = readPvpTables();
    const tables: ZCPvpTables = {
        ...base,
        pvpCard: [
            ...base.pvpCard.map((row) => (row.name === '金矿'
                ? { ...row, type: 1, baseHp: 999, cyclePerTierValue: 111, buildDigGoldNum: 7 }
                : row.name === '主城'
                    ? { ...row, baseHp: 3300, cyclePerTierValue: 0, buildDigGoldNum: 3, goldDigTime: 1 }
                    : { ...row, type: 2 })),
        ],
    };
    try {
        loadPvpTables(tables);
        const rules = getPvpRuntimeRules();

        // ① 主城收入读卡表主城行的 buildDigGoldNum / goldDigTime
        assert.equal(rules.hqIncomeAmount, 3, '每次产金取卡表 buildDigGoldNum');
        assert.equal(rules.hqIncomeIntervalSeconds, 1, '产金周期取卡表 goldDigTime');

        // ② 主城开局耐久 = 主城卡 baseHp（3300），与品级无关（cyclePerTierValue=0）
        assert.equal(rules.hqMaxHp, 3300);
        const game = new ZCGameModel(null, () => 0.1);
        assert.equal(game.snapshot.hexes[ZC_PLAYER_HOME_ID].maxHp, 3300);

        // ③ 金矿建成后耐久 = 999 + 绿品级(1) × 111
        const snapshot = cloneSnapshot(game);
        const mineId = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors[0];
        snapshot.playerGold = 1000;
        snapshot.hexes[mineId].tileType = ZCPvpTileType.Mine;
        snapshot.hexes[mineId].developmentCost = 50;
        const devGame = new ZCGameModel(snapshot, () => 0);
        devGame.developHex(mineId);
        assert.equal(devGame.snapshot.hexes[mineId].building, 'mine');
        assert.equal(devGame.snapshot.hexes[mineId].maxHp, 1110, '999 + 1×111，证明走的是卡表 baseHp');
    } finally {
        loadPvpTables(base);
    }
});

test('战斗帧上报只按协议 op 口径采集：翻格带格子 id、单位生死不上报', () => {
    // 协议 `CmdBattleFrameInfo.op`：1=翻格（params=[格子 id]）、2=释放技能（params=[位置]，无则不传）、3=聊天。
    // 曾把「单位出生」报成 op=1、「单位阵亡」报成 op=2 —— 语义完全对不上，服务端会按翻格 / 技能去解析。
    const game = new ZCGameModel(null, () => 0.1);
    assert.equal(game.frameEvents.length, 0, '开局不该有任何帧事件');

    const hexId = firstDevelopable(game);
    assert.equal(game.developHex(hexId).ok, true);
    assert.equal(game.frameEvents.length, 1, '一次翻格 = 恰好一条');
    assert.deepEqual({ ...game.frameEvents[0] }, { frameId: 0, unitId: 0, op: 1, params: [hexId] },
        'op=1 的 params 必须是格子 id');

    // 推进一段时间：兵营会出兵、单位会移动 / 交战甚至阵亡 —— 这些都不是协议里的「操作」。
    const before = game.frameEvents.length;
    tickSeconds(game, 10);
    assert.ok(game.snapshot.units.length > 0, '这 10 秒里确实出过兵（否则下面两条断言没有意义）');
    // 推进期间**敌方 AI 也会翻格**，那是 legit 的上报 ⇒ 要守的是「每一条都符合协议 op 口径」，不是「数量不变」。
    assert.ok(game.frameEvents.length > before, 'AI 的开发操作同样要上报');
    assert.ok(game.frameEvents.every((event) => event.op === 1 || event.op === 2), 'op 只有 1=翻格 / 2=释放技能');
    assert.ok(game.frameEvents.every((event) => event.unitId === 0), '操作类事件不对应单位，unitId 恒 0');

    // 结构守卫：append 只允许出现在 pushFrameEvent 一处，且两类采集都用命名常量。
    const source = readFileSync('assets/script/app/zcds/model/ZCGameModel.ts', 'utf8');
    assert.equal((source.match(/frameEvents\.push\(/g) ?? []).length, 1, 'frameEvents 只能在 pushFrameEvent 里 push');
    assert.match(source, /this\.pushFrameEvent\(FRAME_OP_DEVELOP, \[hex\.id\]\)/);
    assert.match(source, /this\.pushFrameEvent\(FRAME_OP_SKILL, \[\]\)/);
});

test('卡类型只有一份清单：英文 key + 集合判定 + 无 legacy 别名', () => {
    const CATALOG = readFileSync('assets/script/app/zcds/model/ZCCombatCatalog.ts', 'utf8');
    const CONFIG = readFileSync('assets/script/app/zcds/model/ZCGameRuntimeConfig.ts', 'utf8');
    // 能量名用英文，中文只留在文案表里。
    for (const cn of ['金矿', '兵营', '防御塔', '城墙', '主城']) {
        // 两种形态：引用处 `ZCCardType.中文`、声明处 `中文: 1,`
        assert.ok(!(CATALOG + CONFIG).includes(`ZCCardType.${cn}`), `不应有 ZCCardType.${cn} 中文引用`);
        assert.ok(!new RegExp(`^\\s*${cn}:`, 'm').test(CATALOG), `不应有中文 key 声明行：${cn}: 1,`);
    }
    for (const en of ['Mine', 'Barracks', 'Tower', 'Wall', 'Hq']) {
        assert.ok(CATALOG.includes(`${en}:`), `ZCCardType 应有英文成员 ${en}`);
    }
    // 判定走集合，不走区间（区间判定在加/删类型时会漏、且不报错）。
    assert.ok(/Object\.values\(ZCCardType\)/.test(CATALOG), 'isZCCardType 应走集合判定');
    assert.ok(!/value >= ZCCardType/.test(CATALOG), '不应再有区间判定');
    // 旧表的英文别名与硬编码区间正则都应消失（都是第二份清单）。
    assert.ok(!/LEGACY_CARD_TYPES/.test(CONFIG), '不应再有 LEGACY_CARD_TYPES');
    assert.ok(!/\[1-5\]/.test(CONFIG), '不应再有硬编码的 /^[1-5]$/');
    assert.ok(/CARD_TYPE_DIGITS/.test(CONFIG), '数字校验应从枚举派生');
    // 中间表只剩一份（中文名，两处运行期文案在用）；建筑映射收进 `cardTypeToBuilding`。
    assert.ok(!/ZC_CARD_TYPE_BUILDING/.test(CATALOG), '建筑映射表不应导出（收进 cardTypeToBuilding 即可）');
    assert.ok(!/ZCCardTypeName/.test(CATALOG), 'ZCCardTypeName 应内联到 ZC_CARD_TYPE_NAMES，不单独导出');
    assert.ok(/function cardTypeToBuilding/.test(CATALOG), 'cardTypeToBuilding 应仍存在且自带映射表');
});

/**
 * 开格那拍兵营若已完工，首批兵不能跟「地块收场动画」抢镜 —— 要等脉冲 + 缩没都播完才出。
 *
 * 卡牌靠把 `startedAt` 推到收场段之后就能「先不可见」（起点在未来 ⇒ 进度被 clamp 到 0）；
 * 单位是实体、没有这种态，所以由 `ZCGameModel` 把**生成本身**推迟一个 `ZC_CARD_START_SECONDS`
 * （= 脉冲 + 缩没）。🔴 单位是**独立节点**、不随格子的「整格隐藏」一起藏 —— 唯一能盖住它的是
 * 随后弹出的卡牌 ⇒ 必须等到卡牌弹出的那一刻再出兵（缩没途中出兵会在正在缩小的地块上「浮空」）。
 */
test('开格后兵营首批兵要等「点击动画（脉冲 ∥ 缩没）」播完才出，不跟水波纹 / 缩没同拍冒出来', () => {
    const snapshot = cloneSnapshot(new ZCGameModel(null, () => 0.1));
    snapshot.playerGold = 10_000;
    const [, barracksId] = ZC_HEX_CONFIG[ZC_PLAYER_HOME_ID].neighbors;
    snapshot.hexes[barracksId].tileType = ZCPvpTileType.BarracksCommon;
    snapshot.hexes[barracksId].developmentCost = 50;
    const game = new ZCGameModel(snapshot, () => 0.1);
    assert.equal(game.developHex(barracksId).ok, true);
    const built = game.snapshot.hexes[barracksId];
    // 这条用例依赖「抽到立即可用的兵营」（construction = 0 才走延迟生成那条路）；
    // 种子或卡表一变、这里先红，说明前提没了，不是实现退步。
    assert.equal(built.building, 'barracks');
    assert.equal(built.constructionRemainingSeconds, 0, '开格即完工，首批兵才会走延迟路径');

    // 开格那一拍：地块刚开始播水波纹，兵不能已经站在格子上。
    assert.equal(game.snapshot.units.length, 0, '首批兵不能跟水波纹同拍冒出来');
    // 🔴 row13「同步播放」：缩没跨度 = 脉冲跨度 = 点击动画跨度 ⇒ 首批兵的锚点只有一个（0.7s）。
    assert.equal(ZC_HEX_SHRINK_SECONDS, ZC_HEX_PULSE_SECONDS, '缩没与脉冲同起同收');
    assert.equal(ZC_CARD_START_SECONDS, ZC_HEX_PULSE_SECONDS, '点击动画 = 一个脉冲周期');
    // 点击动画（脉冲 ∥ 缩没，同起同收，共 0.7s）还没走完。
    game.tick(ZC_HEX_PULSE_SECONDS / 2);
    assert.equal(game.snapshot.units.length, 0, '点击动画没播完，兵不该出');
    // 🔴 点击动画末段：地块正被缩没收成一丁点，此刻出兵会看着像浮在半空 ⇒ 仍然不许出。
    game.tick(ZC_HEX_PULSE_SECONDS * 0.4);
    assert.equal(game.snapshot.units.length, 0, '点击动画还没播完，兵不该出');
    // 点击动画播完 = 卡牌弹出那一刻 ⇒ 首批兵出现（卡牌正好盖住这块区域）。
    // ⚠️ 再补 0.1 余量：`tick` 按 0.05 的定步长消化，余量不足会留在 pending 里、当拍不出兵。
    game.tick(ZC_CARD_START_SECONDS + 0.1);
    assert.ok(game.snapshot.units.length > 0, '点击动画播完（卡牌弹出），兵营首批兵必须出来');
});

test('金币不足时 developHex 失败并带结构化原因，供 HUD 金币栏做反馈', () => {
    const base = new ZCGameModel(null, () => 0.1);
    const hexId = firstDevelopable(base);

    const snapshot = cloneSnapshot(base);
    snapshot.playerGold = 0;
    const broke = new ZCGameModel(snapshot, () => 0.1);
    // 判据前提：这一格**点得动**（`canPlayerDevelop` 只管归属 / 相邻，不判钱）——
    // 所以「点了没反应」的原因只可能是钱不够，这正是需求要金币栏表达的那一下。
    assert.equal(broke.canPlayerDevelop(hexId), true, '判据前提：这一格是可开发的');
    const failed = broke.developHex(hexId);
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'insufficientGold',
        '金币不足要带机器可读原因，表现层不该去解析中文文案');
    assert.ok(failed.message.includes('金币不足'), `中文仍要能直接给玩家看：${failed.message}`);

    // 反向判据 1：钱够时成功，且**不带**失败原因 —— 否则 HUD 会在开格成功那一下也抖金币栏。
    const richSnapshot = cloneSnapshot(base);
    richSnapshot.playerGold = 1e6;
    const rich = new ZCGameModel(richSnapshot, () => 0.1);
    const ok = rich.developHex(hexId);
    assert.equal(ok.ok, true, `钱够就该开格成功：${ok.message}`);
    assert.equal(ok.reason, undefined, '成功的返回不能带失败原因');

    // 反向判据 2：另一类失败（地块不可开发）不能被误标成金币不足。
    const other = new ZCGameModel(cloneSnapshot(base), () => 0.1);
    const blockedId = other.snapshot.hexes.find((hex) => !other.canPlayerDevelop(hex.id))!.id;
    const blocked = other.developHex(blockedId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, undefined, '只有金币不足这一条才带该原因');
});
