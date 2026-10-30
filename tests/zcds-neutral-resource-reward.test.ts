import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCGameModel, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { setCardCatalog } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { captureZCMatchConfig, ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { resolveZCMapResources } from '../assets/script/app/zcds/model/ZCSpawnSelection';
import type { ZCHexState } from '../assets/script/app/zcds/model/ZCGameTypes';
import {
    isZCNeutralResourceBuilding, neutralResourceItemOf,
} from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';
import { ZC_NEUTRAL_REWARD_TOTAL_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { assetPath } from './helpers/asset-paths';

//  `pvpUnit` 已于 2026-09-20 并入 `pvpCard`（单位列内联、加 `unit` 前缀），表已下线。
const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'neutralResourceGroup',
] as const;
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

/**
 * `standard_3` 是**固定主城**地图（`cityMode: fixed`）且带 9 个资源点，类型齐全
 * （6 宝箱 + 1 金币 + 2 金矿）—— 同一局里能覆盖多种发奖分支。
 *
 *⚠️ 不用 `select_river.json`：它是 `cityMode: select`，`captureZCMatchConfig` 直接抛
 * 「自选主城地图需要先完成开局选点」，测试里造不出可开发的现场。
 */
const riverLayout = JSON.parse(
    readFileSync(assetPath('config/maps/standard_3.json'), 'utf8'),
) as ZCMapLayout;

const fallbackLayout = JSON.parse(
    readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8'),
) as ZCMapLayout;

/**
 * ⚠️ 这张地图的**全部 9 个资源点，邻居也全是中立格**（实测：`贴非中立邻格 0`）。
 * 后果是开局时 `resourceUnlocked` 一格都不会触发（没有一格与主城相邻），
 * 资源点靠玩家从中立区一路「花钱买过来」才能碰到 —— 所以下面的夹具要先把邻格铺成本方。
 * 这一点是`standard_3` / `standard_4` 的地图事实，不是测试凑的。
 */
function withRiverMap(run: (match: ZCMatchConfig) => void, rules?: Partial<ZCMatchConfig['rules']>): void {
    configureZCMap(riverLayout);
    try {
        const base = captureZCMatchConfig();
        const match: ZCMatchConfig = {
            ...base,
            rules: { ...base.rules, enemyAiIntervalSeconds: 10_000, ...rules },
            // `cityMode: fixed` 的地图在 `captureZCMatchConfig` 里已经冻结过资源点；
            // 万一没有（换地图 / 配置变动）就补上，复用生产代码那条权重抽取链。
            map: {
                ...base.map,
                resolvedResources: base.map.resolvedResources
                    ?? resolveZCMapResources(base.map, () => 0.1),
            },
        };
        run(match);
    } finally {
        configureZCMap(fallbackLayout);
    }
}

/**
 * 把第一个资源点**直接改成指定的资源项**（`neutralResourceGroup.id`）。
 *
 *  ⚠️ 为什么要注入而不是等地图自然抽出来：`unit_cap` 只出现在 `select_river` 的资源点池里
 *  （`{gold:5, unit_cap:3, artifact_charge:2}`），而那张图是 **`cityMode: select` 自选主城局**，
 *  `captureZCMatchConfig` 会直接抛「需要先完成开局选点」；而 `standard_3` / `standard_4`
 *  的池只有 chest/gold/mine（探针实测 `含unit_cap: false`）⇒ **没有任何 fixed 地图能自然抽出兵力**。
 *
 *  注入改的是 `hex.neutralResourceId` 这条**真实链路**（发奖逻辑就认这个字段，
 *  由 `ZCSnapshotCodec.createInitialState` 写入），被替换的只有「资源类型怎么抽到」那一步 ——
 *  那本来就不是测产兵要关心的东西。
 */
function forceResourceItem(match: ZCMatchConfig, itemId: number): void {
    const resolved = match.map.resolvedResources ?? [];
    const target = resolved[0];
    assert.ok(target, '这张图应该有资源点');
    match.map = {
        ...match.map,
        resolvedResources: resolved.map((item) => (item.hexId === target.hexId ? { ...item, itemId } : item)),
    };
}

/**
 * 把某个资源点的**一圈邻居**铺成某方的已开发据点，让它变成可开发。
 *
 * 真实对局里这就是「从中立区一路花钱买过来」的终态；直接改快照是为了让用例只测发奖逻辑，
 * 不必把买地过程也重放一遍。
 *
 * ⚠️ 必须给其中一格安上**真建筑**（`building` + `hp>0`）：敌方 AI 的第一道门槛是
 * `developedCount(owner) === 0 → continue`（`runEnemyAI`），而 `developedCount` 只数
 * 「有建筑的格」。只把 `developmentResolved` 标 true 而 `building='none'` 的话，
 * AI 会一直跳过 —— 表现是「铺好了但敌方永远不来买」。
 */
function paveAround(
    snapshot: ZCSnapshotLike, match: ZCMatchConfig, hexId: number, owner: 'player' | 'enemy',
): void {
    const neighbors = match.map.hexes[hexId].neighbors;
    neighbors.forEach((id, index) => {
        snapshot.hexes[id].owner = owner;
        snapshot.hexes[id].state = 'developed';
        snapshot.hexes[id].developmentResolved = true;
        snapshot.hexes[id].cardId = null;
        if (index === 0) {
            // 一格真建筑当「已建成」的锚点。
            snapshot.hexes[id].building = 'barracks';
            snapshot.hexes[id].tier = 1;
            snapshot.hexes[id].hp = 100;
            snapshot.hexes[id].maxHp = 100;
        } else {
            snapshot.hexes[id].building = 'none';
        }
    });
}

interface ZCSnapshotLike {
    hexes: ZCHexState[];
    playerGold: number;
    enemyGold: number;
    goldByOwner?: Record<string, number>;
    artifactCharge: number;
    units: Array<{ id: number; owner: string; unitId: string; cardId: string; sourceHexId: number; battleState: string; hp: number; maxHp: number }>;
}

/**
 * 造一个「资源点四周已被某方铺开」的现场，返回模型与那一格。
 *
 *  @param wantResourceId 指定资源类型；省略时取第一个。`standard_3` 抽出来的是宝箱，
 *      要测兵力产兵必须显式要 `unit_cap`。
 */
function resourceScene(match: ZCMatchConfig, owner: 'player' | 'enemy', wantItemId?: number): {
    game: ZCGameModel; hexId: number; itemId: number;
} {
    const resolved = match.map.resolvedResources ?? [];
    assert.ok(resolved.length > 0, '这张图应该有资源点');
    const point = (wantItemId ? resolved.find((item) => item.itemId === wantItemId) : resolved[0])
    assert.ok(point, `这张图没有解析出 ${wantItemId ?? '任意'} 资源项`);
    const snapshot = ZCGameModel.createInitialState(() => 0.1, match) as unknown as ZCSnapshotLike;
    snapshot.playerGold = 100_000;
    snapshot.enemyGold = 100_000;
    snapshot.goldByOwner = { player: 100_000, enemy: 100_000, enemy2: 0, enemy3: 0 };
    paveAround(snapshot, match, point.hexId, owner);
    const game = new ZCGameModel(snapshot as never, () => 0.1, match);
    // 2026-10-08 新口径：**铺开即自动入袋**，不花钱开发、不点开。
    // `paveAround` 只改了快照，走一次 tick 让 refreshTileStates → claimAdjacentNeutralResources 结算。
    game.tick(0.1);
    return { game, hexId: point.hexId, itemId: point.itemId };
}

/**
 * 「未铺开」的裸快照。
 *
 *  返回**快照本身而不是已构造的模型** —— 因为 `new ZCGameModel(snapshot)` 会深拷贝，
 * 调用方必须在这之前就把邻居铺好，事后改 `game.snapshot` 是改副本、不生效。
 */
function bareScene(match: ZCMatchConfig, wantItemId?: number): {
    hexId: number; itemId: number; snapshot: ZCSnapshotLike;
} {
    const resolved = match.map.resolvedResources ?? [];
    assert.ok(resolved.length > 0, '这张图应该有资源点');
    const point = (wantItemId ? resolved.find((item) => item.itemId === wantItemId) : resolved[0]);
    assert.ok(point, `这张图没有解析出 ${wantItemId ?? '任意'} 资源项`);
    const snapshot = ZCGameModel.createInitialState(() => 0.1, match) as unknown as ZCSnapshotLike;
    snapshot.playerGold = 100_000;
    snapshot.enemyGold = 100_000;
    snapshot.goldByOwner = { player: 100_000, enemy: 100_000, enemy2: 0, enemy3: 0 };
    return { hexId: point.hexId, itemId: point.itemId, snapshot };
}

test('★资源项：按 resourceType 归一出奖励字段，未知 id 返回 null 而不是抛错', () => {
    // 宝箱（type1）：param 就是金币数。
    const gold = neutralResourceItemOf(ZC_TEST_ITEM.Gold);
    assert.equal(gold?.gold, 50);
    assert.equal(gold?.artifactCharge, 0);
    assert.equal(gold?.cardId, null);

    // 神器充能（type4）：只有充能点。
    const charge = neutralResourceItemOf(ZC_TEST_ITEM.MixedCharge);
    assert.equal(charge?.artifactCharge, 1);
    assert.equal(charge?.gold, 0);

    // 兵团（type3）：resId + value ⇒ 产 3 个 68001，金币 / 充能都是 0。
    const unit = neutralResourceItemOf(ZC_TEST_ITEM.Unit);
    assert.equal(unit?.gold, 0);
    assert.equal(unit?.artifactCharge, 0);
    assert.equal(unit?.cardId, '68001');
    assert.equal(unit?.unitCount, 3);
    assert.equal(isZCNeutralResourceBuilding(unit), false, '兵团不是建筑，不该立建筑');

    // 金矿（type2）/ 兵营（type5）：领取后要在该格立建筑。
    const mine = neutralResourceItemOf(ZC_TEST_ITEM.Mine);
    assert.equal(isZCNeutralResourceBuilding(mine), true);
    assert.equal(isZCNeutralResourceBuilding(neutralResourceItemOf(ZC_TEST_ITEM.Barracks)), true);

    // 未知 / 空 id：返回 null（调用方按「没资源」处理），不抛错。
    for (const bad of [null, undefined, 0, -1, 99999999, 1.5]) {
        assert.equal(neutralResourceItemOf(bad as number | null), null, `${String(bad)} 应当查不到`);
    }
});

test('相邻即自动领取：金币与神器充能都入袋，格子变成已占领且不重复领', () => {
    withRiverMap((match) => {
        // ⚠️ 必须**在构造模型之前**就把邻居铺好：`new ZCGameModel(snapshot)` 会深拷贝快照，
        // 事后改 `game.snapshot` 改的是副本、不影响模型内部状态（这条坑让本用例先红过一次）。
        const { hexId, itemId, snapshot } = bareScene(match);
        const item = neutralResourceItemOf(itemId);
        assert.ok(item, `本局抽到的 ${itemId} 必须查得到资源项，否则本用例是空断言`);

        // ① 不相邻时**不领**：格子仍是中立未消费。
        const bare = new ZCGameModel(snapshot as never, () => 0.1, match);
        bare.tick(0.1);
        assert.equal(bare.snapshot.hexes[hexId].owner, 'neutral', '不相邻时不该被判给任何一方');
        assert.equal(bare.snapshot.hexes[hexId].developmentResolved, false);
        assert.notEqual(bare.snapshot.hexes[hexId].neutralResourceId, null, '未被领取时资源标识必须还在（图标要显示）');

        // ② 铺开四周 → 构造后自动入袋（不花钱开发、不点开）。
        //
        // ⚠️ **基线必须在铺开前从snapshot 上取**：模型构造函数里就会跑一次
        // `refreshTileStates`（`ZCGameModel.ts:477`）⇒ 领取在 `newZCGameModel(...)` 那一刻就发生，
        // 构造完再取基线量到的已经是「领完之后」的金币（这条坑让本用例红过一次：100100 vs 100200）。
        const goldBefore = snapshot.playerGold;
        const chargeBefore = snapshot.artifactCharge;
        paveAround(snapshot, match, hexId, 'player');
        const game = new ZCGameModel(snapshot as never, () => 0.1, match);
        game.tick(0.1);

        // ③ 归属落定 + 已占领 + 资源标识清掉（这是「只发一次」的唯一判据）。
        assert.equal(game.snapshot.hexes[hexId].owner, 'player');
        assert.equal(game.snapshot.hexes[hexId].state, 'developed', '领取后应变成已占领');
        assert.equal(game.snapshot.hexes[hexId].developmentResolved, true);
        assert.equal(game.snapshot.hexes[hexId].neutralResourceId, null, '领完必须清标识，否则会重复发');
        assert.equal(game.canPlayerDevelop(hexId), false, '同一格不能重复领奖');

        // ④ 金币**只增不减**（不再扣开发成本）—— 精确值才能抓住「发奖那行被注释掉」。
        assert.equal(game.snapshot.playerGold, goldBefore + (item?.gold ?? 0));
        // 神器充能：奖励那部分必须到账，且不超满值上限。
        if ((item?.artifactCharge ?? 0) > 0) {
            assert.ok(
                game.snapshot.artifactCharge >= Math.min(
                    game.artifactChargeFull,
                    chargeBefore + (item?.artifactCharge ?? 0),
                ),
                `神器充能应至少拿到 ${item?.artifactCharge} 点`,
            );
        }
        assert.ok(game.snapshot.artifactCharge <= game.artifactChargeFull, '充能不得超过满值');
        assert.equal(ZCGameModel.isValidSnapshot(game.exportSnapshot()), true);
    });
});

test('资源点中立无归属：一方先拿到即锁定，双方都领不到第二次', () => {
    withRiverMap((match) => {
        const resolved = match.map.resolvedResources ?? [];
        assert.ok(resolved.length > 0, '这张图应该有资源点');
        const point = resolved[0];

        // ① 玩家先铺到 ⇒ **自动**归属玩家、奖励入袋（2026-10-08 新口径：不需要点、不花钱）。
        const playerScene = resourceScene(match, 'player');
        assert.equal(playerScene.game.snapshot.hexes[point.hexId].owner, 'player');
        assert.equal(playerScene.game.snapshot.hexes[point.hexId].developmentResolved, true);
        // 领奖只发生一次：领完标识清空，谁都拿不到第二份。
        assert.equal(playerScene.game.snapshot.hexes[point.hexId].neutralResourceId, null);
        assert.equal(playerScene.game.canPlayerDevelop(point.hexId), false);

        // ② 换到「资源点已被玩家吃掉」的现场：敌方铺满四周也不能再买。
        //
        // ⚠️ 这里**不用 AI 出手**来制造「敌方先到」：AI 的候选筛选是
        // `canDevelopFor && cost <= goldOf(owner)`，再从 affordableTop 里随机挑一项。
        // 要让它稳定选中某一格，得把全场 cost 与各方金币一起调平，夹具比被测逻辑还脆
        //（实测会出现「天价 9999 在十万金币面前照样买得起」⇒ AI 从 31 个候选里随机、
        //  根本不碰资源点）。「先到先得」这个不变量只需证明**一方拿到后另一方拿不到**。
        const snapshot = ZCGameModel.createInitialState(() => 0.1, match) as unknown as ZCSnapshotLike;
        snapshot.enemyGold = 100_000;
        snapshot.playerGold = 100_000;
        snapshot.goldByOwner = { player: 100_000, enemy: 100_000, enemy2: 0, enemy3: 0 };
        paveAround(snapshot, match, point.hexId, 'enemy');
        // 把这一格标成「已被玩家吃掉」：归属玩家 + 已消费 + 有建筑。
        //
        // ⚠️ `neutralResourceId` **必须一并置 null** —— 它就是「只发一次」的唯一判据
        // （`claimAdjacentNeutralResources` 靠它跳过已领的格）。留着它，敌方铺开邻格时
        // 会被自动领取**再发一次**（本用例就因为漏这一行红过：`'chest' !== null`）。
        snapshot.hexes[point.hexId].owner = 'player';
        snapshot.hexes[point.hexId].developmentResolved = true;
        snapshot.hexes[point.hexId].neutralResourceId = null;
        snapshot.hexes[point.hexId].building = 'barracks';
        snapshot.hexes[point.hexId].tier = 1;
        snapshot.hexes[point.hexId].hp = 100;
        snapshot.hexes[point.hexId].maxHp = 100;
        const game = new ZCGameModel(snapshot as never, () => 0.1, match);
        game.tick(0.1);

        // 敌方铺满四周也拿不到：这一格已被玩家领走（`neutralResourceId` 为空）。
        assert.equal(game.snapshot.hexes[point.hexId].owner, 'player');
        assert.equal(game.canDevelopFor('enemy', point.hexId), false, '归属玩家后敌方拿不了');
        assert.equal(game.canPlayerDevelop(point.hexId), false);
        // 关键：资源标识已清 ⇒ 敌方的邻接自动领取会跳过它，不会重复发奖。
        assert.equal(game.snapshot.hexes[point.hexId].neutralResourceId, null);
        assert.equal(ZCGameModel.isValidSnapshot(game.exportSnapshot()), true);
    });
});

test('口径隔离：普通地块开发不发资源奖励', () => {
    withRiverMap((match) => {
        const resourceHexes = new Set((match.map.resolvedResources ?? []).map((item) => item.hexId));
        const plain = match.map.hexes.find((hex) => hex.playable
            && match.map.owners[hex.id] === 'player'
            && !resourceHexes.has(hex.id));
        assert.ok(plain, '这张图应该有普通己方格');

        const snapshot = ZCGameModel.createInitialState(() => 0.1, match) as unknown as ZCSnapshotLike;
        snapshot.playerGold = 100_000;
        snapshot.goldByOwner = { player: 100_000, enemy: 100_000, enemy2: 0, enemy3: 0 };
        snapshot.hexes[plain.id].state = 'developable';
        snapshot.hexes[plain.id].developmentResolved = false;
        snapshot.hexes[plain.id].building = 'none';
        const game = new ZCGameModel(snapshot as never, () => 0.1, match);

        const goldBefore = game.snapshot.playerGold;
        const cost = game.snapshot.hexes[plain.id].developmentCost;
        assert.equal(game.developHex(plain.id).ok, true);
        // 只扣开发成本，没有任何额外金币（这格 neutralResourceId 为 null ⇒ 不发资源奖励）。
        assert.equal(game.snapshot.playerGold, goldBefore - cost);
    });
});

test('兵力资源点：开发后直接产出 3 个 68001 豌豆游侠，走born 流程', () => {
    withRiverMap((match) => {
        // 这张图没有兵力资源点（见 forceResourceType 的注释），把它改成兵力。
        forceResourceItem(match, ZC_TEST_ITEM.Unit);
        const item = neutralResourceItemOf(ZC_TEST_ITEM.Unit);
        assert.equal(item?.cardId, '68001');
        assert.equal(item?.unitCount, 3);

        // ⚠️ 产兵在`resourceScene` 的构造期就发生（模型构造函数会跑一次 refreshTileStates），
        // 所以**基线必须在铺开前取**：这里直接按「铺开后单位列表里多出 3 个」来断言。
        const { hexId, snapshot } = bareScene(match, ZC_TEST_ITEM.Unit);
        const before = snapshot.units.length;
        paveAround(snapshot, match, hexId, 'player');
        const game = new ZCGameModel(snapshot as never, () => 0.1, match);
        assert.equal(game.snapshot.hexes[hexId].owner, 'player', '铺开后应自动归属玩家');

        // ① 真的多了 3 个单位，且都是 68001。
        const spawned = game.snapshot.units.slice(before);
        assert.equal(spawned.length, 3, `应产出 3 个兵，实际 ${spawned.length}`);
        for (const unit of spawned) {
            assert.equal(unit.owner, 'player');
            assert.equal(unit.cardId, '68001');
            assert.equal(unit.unitId, '68001', 'unitId 取自卡表的 unitId');
            // ② 出生在资源点那一格（与兵营产兵同口径）。
            assert.equal(unit.sourceHexId, hexId);
            // ③ 走现有 born 流程 —— 后续由 ZCUnitSystem 推进，会自己索敌主动进攻。
            assert.equal(unit.battleState, 'born');
            assert.ok(unit.hp > 0 && unit.maxHp > 0, '新兵要有血量');
        }

        // ④ 不应超编（spawnUnit 自带 `unitCapPerSide` 守卫）。用快照自身计数，
        //    不去摸模型内部的 unitCount（那是 private，且加了访问器就得维护两份口径）。
        const mine = game.snapshot.units.filter((u) => u.owner === 'player' && u.hp > 0);
        assert.equal(mine.length, spawned.length, '场上只该有这 3 个新兵');
        assert.equal(ZCGameModel.isValidSnapshot(game.exportSnapshot()), true);
    });
});

test('兵力资源点：产出的兵会自己推进状态机（born → target/moveForward），即会主动进攻', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Unit);
        const { game } = resourceScene(match, 'player');
        const born = game.snapshot.units[game.snapshot.units.length - 1];
        assert.equal(born.battleState, 'born', '刚产出时是 born');

        // 推进若干秒：状态机必须把它带出 born —— 这就是「不是永远站着不动」的证据。
        for (let i = 0; i < 40; i += 1) game.tick(0.25);
        const after = game.snapshot.units.find((u) => u.id === born.id);
        assert.ok(after, '新兵不该凭空消失');
        assert.notEqual(after.battleState, 'born', `推进 10 秒后仍停在 born，状态机没接管它（实际 ${after.battleState}）`);
        assert.notEqual(after.battleState, 'dead', '不该一出生就死');
    });
});

test('兵力奖励卡查不到时不产兵也不抛错（配置填错 id 的兜底）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Unit);
        const { game, hexId } = resourceScene(match, 'player');
        // 卡目录置空 ⇒ 模拟「奖励卡没下发」。发奖读的是常量表的 rewardCardId，
        // 取卡走 findCatalogCard ⇒ 查不到就必须静默不产兵，而不是把整局对局打挂。
        setCardCatalog(new Map());
        try {
            const before = game.snapshot.units.length;
            assert.doesNotThrow(() => game.developHex(hexId));
            assert.equal(game.snapshot.units.length, before, '卡查不到时不应凭空产兵');
        } finally {
            loadPvpTables(tables); // 重建 cardCatalog
        }
    });
});

/**
 * 回归：奖励卡**不在本局卡组里**时也必须产得出来。
 *
 * ⚠️ 这条专门盯「取卡走哪条路」：`cardById` 查的是本局四方卡组并集，而正式局卡组由后端
 * `CmdStartBattleRspMsg.unitInfos` 收窄（`ZCClientCombatConfig.buildBattleDeck`）。
 * 若取卡路径换成 `cardById`，在**卡组未收窄**的测试环境里照样能查到 68001 ⇒ 上面的用例照样绿，
 * 差异只在真机上暴露（奖励兵一个都不出、零报错）。所以这里把卡组**显式收窄**成不含 68001，
 * 让两条路径的行为差被测出来。
 */
test('奖励卡不在本局卡组里也照样产兵（取卡不能走 cardById）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Unit);
        // 把四方卡组收窄成「不含 68001」的另一张卡 —— 模拟后端下发了我方阵容的情况。
        const narrowed = (match.playerDeck ?? []).filter((card) => card.id !== '68001');
        assert.ok(narrowed.length > 0, '收窄后卡组不该是空的');
        assert.equal(narrowed.some((card) => card.id === '68001'), false, '前置条件：卡组里不该有 68001');
        const narrowedMatch: ZCMatchConfig = {
            ...match,
            playerDeck: narrowed,
            enemyDeck: narrowed,
            ownerDecks: { player: narrowed, enemy: narrowed, enemy2: narrowed, enemy3: narrowed },
        };

        // ⚠️ 基线取自铺开前的快照：产兵在模型构造期就发生（同用例 5）。
        const { hexId, snapshot } = bareScene(narrowedMatch, ZC_TEST_ITEM.Unit);
        const before = snapshot.units.length;
        paveAround(snapshot, narrowedMatch, hexId, 'player');
        const game = new ZCGameModel(snapshot as never, () => 0.1, narrowedMatch);
        const spawned = game.snapshot.units.slice(before);
        assert.equal(game.snapshot.hexes[hexId].owner, 'player');
        assert.equal(spawned.length, 3, `卡组不含 68001 时也应产 3 个兵，实际 ${spawned.length}`);
        for (const unit of spawned) assert.equal(unit.cardId, '68001');
    });
});

// ============================================================
// 中立资源获取**表现事件**（2026-10-20 需求）：
//   · 金矿 = 只播「建筑被开发」激活（脉冲 ∥ 缩没），不播金币飞行；
//   · 金币堆 / 宝箱 = 入队金币飞行事件（飞向金币栏 + 上飘 +N）；
//   · 神器充能 = 入队神器飞行事件（飞向神器按钮）；
//   · 兵力 = 直接产兵、走出生表现，无飞行事件；
//   · 非玩家领取同样入队，由视图自行决定只对玩家播飞行。
// ============================================================

test('金币堆领取：入队一条金币飞行事件（金额 50、时长=飞行+错峰+上飘）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Gold);
        const { game, hexId } = resourceScene(match, 'player');
        const rewards = game.createRenderFrame().neutralRewards;
        assert.equal(rewards.length, 1, '金币堆只发一条事件');
        const reward = rewards[0];
        assert.equal(reward.hexId, hexId);
        assert.equal(reward.itemId, ZC_TEST_ITEM.Gold);
        assert.equal(reward.owner, 'player');
        assert.equal(reward.gold, 50);
        assert.equal(reward.artifactCharge, 0);
        assert.equal(reward.durationSeconds, ZC_NEUTRAL_REWARD_TOTAL_SECONDS);
        assert.equal(game.createRenderFrame().hexActivations.length, 0, '金币堆不播建筑激活');
    });
});

test('宝箱领取：沿用金币飞行（+N 按宝箱的金币数 100 播，不单独播神器）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.BigChest);
        const { game, hexId } = resourceScene(match, 'player');
        const rewards = game.createRenderFrame().neutralRewards;
        assert.equal(rewards.length, 1);
        const reward = rewards[0];
        assert.equal(reward.hexId, hexId);
        assert.equal(reward.itemId, ZC_TEST_ITEM.BigChest);
        assert.equal(reward.owner, 'player');
        // 「大金币宝箱」只配了 100 金币（神器充能那一条已随旧表下线，改由组合里的独立资源项承担）；
        // 表现走金币飞行（视图按资源项的表现键归类）。
        assert.equal(reward.gold, 100);
        assert.equal(reward.artifactCharge, 0);
    });
});

test('神器充能领取：入队一条神器飞行事件（充能 1，无金币）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.MixedCharge);
        const { game, hexId } = resourceScene(match, 'player');
        const rewards = game.createRenderFrame().neutralRewards;
        assert.equal(rewards.length, 1);
        const reward = rewards[0];
        assert.equal(reward.hexId, hexId);
        assert.equal(reward.itemId, ZC_TEST_ITEM.MixedCharge);
        assert.equal(reward.artifactCharge, 1);
        assert.equal(reward.gold, 0);
    });
});

test('金矿领取：只播「建筑被开发」激活，不播金币飞行', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Mine);
        const { game, hexId } = resourceScene(match, 'player');
        assert.equal(game.createRenderFrame().neutralRewards.length, 0, '金矿不进飞行队列');
        const activations = game.createRenderFrame().hexActivations;
        assert.equal(activations.length, 1, '金矿应推一条激活动画');
        assert.equal(activations[0].hexId, hexId);
        assert.equal(activations[0].hasCardReveal, false, '金矿不弹卡牌，只有点击动画');
    });
});

test('兵力资源点领取：直接产兵、无飞行事件（也不播激活）', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Unit);
        const { game } = resourceScene(match, 'player');
        assert.equal(game.createRenderFrame().neutralRewards.length, 0, '兵力不走飞行队列');
        assert.equal(game.createRenderFrame().hexActivations.length, 0, '兵力不播激活动画');
    });
});

test('非玩家领取：事件照常入队（owner=领取方），视图再决定只对玩家播飞行', () => {
    withRiverMap((match) => {
        forceResourceItem(match, ZC_TEST_ITEM.Gold);
        const { game } = resourceScene(match, 'enemy');
        const rewards = game.createRenderFrame().neutralRewards;
        assert.equal(rewards.length, 1);
        assert.equal(rewards[0].owner, 'enemy');
        assert.equal(rewards[0].gold, 50);
    });
});