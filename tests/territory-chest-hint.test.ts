import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TERRITORY_CHEST_HINT_HEIGHT,
    TERRITORY_CHEST_HINT_HOPS,
    TERRITORY_CHEST_HINT_HOP_DECAY,
    TERRITORY_CHEST_HINT_SECONDS,
    territoryChestHintBounceOffset,
    territoryChestHintCell,
    territoryChestShowsHint,
    territoryChestUnlockId,
    territoryPrerequisiteChestCell,
} from '../assets/script/app/territory/model/TerritoryChestHint';
import type { TerritorySite } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { assetPath } from './helpers/asset-paths';

/**
 * 「固定奖励宝箱的气泡提示 / 同屏唯一 / 前置宝箱跳动」判据（2026-11-02 需求，三句话）：
 *   ① 固定奖励宝箱挂**气泡**（样式同章节），内容是**体力 icon + 消耗数**；
 *   ② 同屏多个宝箱**只留一只**，优先**解锁 id 最大**的那只；
 *   ③ 点地块时，若它前置的宝箱**已激活未领取**，那只宝箱**原地跳 1.5s**催玩家点，
 *      跳动期间**藏起它的气泡**。
 *
 * 三条判据全在 `model/TerritoryChestHint` 里（零 cc 纯函数），视图只负责把结果写进节点；
 * 所以这里既测模型（真模块，不抄数字），也测**接线**（源码守卫，防止"模型对、没人调"）。
 */

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** `TerritorySite` 的最小可用夹具（`unlock` 字段补齐，类型判定要它）。 */
function site(partial: {
    id: string;
    type?: TerritorySite['type'];
    cellId: number;
    footprint?: number[];
    requiredCells?: number[];
}): TerritorySite {
    return {
        id: partial.id,
        type: partial.type ?? 'fixedResource',
        cellId: partial.cellId,
        footprint: partial.footprint ?? [partial.cellId],
        unlock: {
            requiredCells: partial.requiredCells ?? [],
            combatPower: 0,
            silverCost: 0,
            staminaCost: 5,
        },
    } as TerritorySite;
}

/** 进度视图：`unlocked` = 已激活，`owned` = 已领取（`owned ⊆ unlocked` 由调用方保证）。 */
function progressOf(unlocked: readonly number[], owned: readonly number[] = []) {
    const unlockedSet = new Set(unlocked);
    const ownedSet = new Set(owned);
    return {
        isCellUnlocked: (cellId: number) => unlockedSet.has(cellId),
        isOwned: (cellId: number) => ownedSet.has(cellId),
    };
}

// ---------------------------------------------------------------------------
// 需求 1：该不该挂气泡
// ---------------------------------------------------------------------------

test('★只给「已激活未领取」的固定宝箱挂气泡', () => {
    const chest = site({ id: 'fixedResource_3', cellId: 30 });
    assert.equal(territoryChestShowsHint(chest, progressOf([], [])), false, '没激活（还没解锁）不许挂');
    assert.equal(territoryChestShowsHint(chest, progressOf([30], [])), true, '激活未领取 ⇒ 挂');
    assert.equal(territoryChestShowsHint(chest, progressOf([30], [30])), false, '已领取 ⇒ 不许挂');
});

test('★★非宝箱站点（关卡/首领/PVP/加成）一律不挂气泡', () => {
    for (const type of ['stage', 'boss', 'asyncPvp', 'bonus'] as const) {
        const other = site({ id: `site_${type}`, type, cellId: 10 });
        assert.equal(
            territoryChestShowsHint(other, progressOf([10], [])),
            false,
            `${type} 不该挂宝箱气泡`,
        );
    }
});

test('★★★气泡判据用**本格**解锁，不用区域通关（否则整片未解锁的宝箱都会被挂上）', () => {
    // 同一片里两只宝箱：一只激活了，一只没激活。两条都必须只看自己那一格。
    const hot = site({ id: 'fixedResource_1', cellId: 11 });
    const cold = site({ id: 'fixedResource_2', cellId: 12 });
    const progress = progressOf([11], []);
    assert.equal(territoryChestShowsHint(hot, progress), true);
    assert.equal(territoryChestShowsHint(cold, progress), false);
    assert.equal(territoryChestHintCell([hot, cold], progress, [11, 12]), 11, '只留激活的那只');
});

// ---------------------------------------------------------------------------
// 需求 2：同屏唯一 + 解锁 id 最大
// ---------------------------------------------------------------------------

test('★★★同屏多只候选时，留**解锁 id 最大**的那只', () => {
    const sites = [
        site({ id: 'fixedResource_3', cellId: 30 }),
        site({ id: 'fixedResource_7', cellId: 70 }),
        site({ id: 'fixedResource_5', cellId: 50 }),
    ];
    const progress = progressOf([30, 70, 50], []);
    assert.equal(territoryChestHintCell(sites, progress, [30, 70, 50]), 70, '7 最大 ⇒ 气泡在 70');
});

test('★★已领取的那只即使 id 更大也不参选', () => {
    const sites = [
        site({ id: 'fixedResource_3', cellId: 30 }),
        site({ id: 'fixedResource_9', cellId: 90 }),
    ];
    assert.equal(territoryChestHintCell(sites, progressOf([30, 90], [90]), [30, 90]), 30);
});

test('★★没露出的格子不参选（同屏 = 本轮渲染出来的格子）', () => {
    const sites = [
        site({ id: 'fixedResource_3', cellId: 30 }),
        site({ id: 'fixedResource_9', cellId: 90 }),
    ];
    assert.equal(territoryChestHintCell(sites, progressOf([30, 90], []), [30]), 30);
});

test('★★★结果与输入顺序无关（不许依赖 sites 的遍历顺序）', () => {
    const sites = [
        site({ id: 'fixedResource_2', cellId: 20 }),
        site({ id: 'fixedResource_8', cellId: 80 }),
        site({ id: 'fixedResource_4', cellId: 40 }),
    ];
    const progress = progressOf([20, 80, 40], []);
    const revealed = [20, 80, 40];
    const expected = territoryChestHintCell(sites, progress, revealed);
    assert.equal(expected, 80);
    for (const order of [[2, 0, 1], [1, 2, 0], [0, 2, 1]]) {
        const shuffled = order.map((index) => sites[index]);
        assert.equal(territoryChestHintCell(shuffled, progress, revealed), expected);
    }
    // 解锁序号相同（数据脏了）⇒ 取 cellId 小的那个，仍与顺序无关。
    const tie = [site({ id: 'fixedResource_4', cellId: 41 }), site({ id: 'fixedResource_4', cellId: 40 })];
    assert.equal(territoryChestHintCell(tie, progressOf([40, 41], []), [40, 41]), 40);
    assert.equal(territoryChestHintCell([...tie].reverse(), progressOf([40, 41], []), [40, 41]), 40);
});

test('一个候选都没有 ⇒ null（一只气泡都不画）', () => {
    assert.equal(territoryChestHintCell([], progressOf([]), []), null);
    assert.equal(
        territoryChestHintCell([site({ id: 'fixedResource_1', cellId: 1 })], progressOf([1], [1]), [1]),
        null,
    );
});

test('★★★解锁序号取的是 `fixedResource_<N>` 的 N，不是数组下标', () => {
    assert.equal(territoryChestUnlockId(site({ id: 'fixedResource_12', cellId: 3 })), 12);
    // 兜底：拿不到固定命名时用 cellId（保证「同屏唯一」始终有确定答案）。
    assert.equal(territoryChestUnlockId(site({ id: 'chest', cellId: 456 })), 456);
});

test('★★真实地图：所有固定宝箱的 id 都是 `fixedResource_<N>`，且**同章不重号**', () => {
    const files = [
        'chapter_01', 'chapter_02', 'chapter_03', 'chapter_04',
        'chapter_05', 'chapter_06', 'chapter_07', 'chapter_smile',
    ];
    let chestTotal = 0;
    for (const name of files) {
        const json = JSON.parse(readFileSync(assetPath(`config/territory-maps/${name}.json`), 'utf8'));
        const chests = (json.sites ?? []).filter((entry: TerritorySite) => entry.type === 'fixedResource');
        const used = new Set<number>();
        for (const chest of chests) {
            assert.match(String(chest.id), /^fixedResource_\d+$/, `${name} 的宝箱 id 不合规: ${chest.id}`);
            const unlockId = territoryChestUnlockId(chest);
            assert.equal(
                used.has(unlockId), false,
                `${name} 里解锁序号 ${unlockId} 重复（同屏唯一会退化成"看谁先遍历到"）`,
            );
            used.add(unlockId);
        }
        chestTotal += chests.length;
    }
    // 防呆：一条都没扫到 = 判据没生效（路径写错 / 字段改名），不能算过。
    assert.ok(chestTotal > 0, '一张图都没扫到宝箱 ⇒ 判据失效');
});

// ---------------------------------------------------------------------------
// 需求 3：该跳哪只宝箱
// ---------------------------------------------------------------------------

test('★★★点地块 ⇒ 跳「前置格里已激活未领取」的那只宝箱', () => {
    const chest = site({ id: 'fixedResource_4', cellId: 44 });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [44] });
    assert.equal(territoryPrerequisiteChestCell(target, [chest, target], progressOf([44], [])), 44);
});

test('★★前置宝箱已领取 ⇒ 不跳', () => {
    const chest = site({ id: 'fixedResource_4', cellId: 44 });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [44] });
    assert.equal(territoryPrerequisiteChestCell(target, [chest, target], progressOf([44], [44])), null, '领过了');
});

test('★★★前置宝箱**还没解锁**（没打开）⇒ 也要跳：提示写「前置宝箱未打开」时地图上得有反馈', () => {
    const chest = site({ id: 'fixedResource_4', cellId: 44 });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [44] });
    assert.equal(
        territoryPrerequisiteChestCell(target, [chest, target], progressOf([], [])), 44,
        '「宝箱还锁着」与「宝箱已激活没领」对玩家都是"没打开"，两种都要跳',
    );
});

test('★★前置格落在宝箱 footprint 上（不是 cellId）也要认出来', () => {
    // 宝箱占两格：44 与 45，站位在 44。前置格写的是 45。
    const chest = site({ id: 'fixedResource_4', cellId: 44, footprint: [44, 45] });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [45] });
    assert.equal(territoryPrerequisiteChestCell(target, [chest, target], progressOf([45], [])), 44, '返回宝箱自己的 cellId');
});

test('★★前置格不是宝箱（普通关卡）⇒ 不跳', () => {
    const gate = site({ id: 'stage_9', type: 'stage', cellId: 66 });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [66] });
    assert.equal(territoryPrerequisiteChestCell(target, [gate, target], progressOf([66], [])), null);
});

test('★★多个前置宝箱（罕见）⇒ 同样取解锁 id 最大的那只，与气泡口径一致', () => {
    const low = site({ id: 'fixedResource_2', cellId: 20 });
    const high = site({ id: 'fixedResource_6', cellId: 60 });
    const target = site({ id: 'stage_1', type: 'stage', cellId: 99, requiredCells: [20, 60] });
    const sites = [low, high, target];
    assert.equal(territoryPrerequisiteChestCell(target, sites, progressOf([20, 60], [])), 60);
    assert.equal(territoryPrerequisiteChestCell(target, [...sites].reverse(), progressOf([20, 60], [])), 60);
});

test('无前置格 / 空配置 ⇒ null（不跳）', () => {
    const target = site({ id: 'stage_1', type: 'stage', cellId: 55, requiredCells: [] });
    assert.equal(territoryPrerequisiteChestCell(target, [target], progressOf([], [])), null);
});

// ---------------------------------------------------------------------------
// 跳动曲线：1.5s、原地起落、逐跳衰减
// ---------------------------------------------------------------------------

test('★★★1.5s 三跳：起点/落点都是 0，最高点 = 抬起高度', () => {
    assert.equal(TERRITORY_CHEST_HINT_SECONDS, 1.5);
    assert.equal(TERRITORY_CHEST_HINT_HOPS, 3);
    const hop = TERRITORY_CHEST_HINT_SECONDS / TERRITORY_CHEST_HINT_HOPS;
    assert.equal(territoryChestHintBounceOffset(0), 0, '起跳点是 0（不能瞬移）');
    assert.ok(
        Math.abs(territoryChestHintBounceOffset(hop / 2) - TERRITORY_CHEST_HINT_HEIGHT) < 1e-9,
        '第一跳最高点 = 抬起高度',
    );
    assert.ok(Math.abs(territoryChestHintBounceOffset(hop)) < 1e-9, '每跳落地都回到 0');
    assert.equal(territoryChestHintBounceOffset(TERRITORY_CHEST_HINT_SECONDS), 0, '1.5s 到点正好落地');
});

test('★★退场：已经播完 / 非法入参一律 0（绝不把 NaN 写进节点坐标）', () => {
    for (const elapsed of [TERRITORY_CHEST_HINT_SECONDS, 1.6, 99, -1, -0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(territoryChestHintBounceOffset(elapsed), 0, `elapsed=${elapsed} 必须给 0`);
    }
});

test('★★逐跳衰减：后两跳比第一跳矮，且始终为正、不超过抬起高度', () => {
    const hop = TERRITORY_CHEST_HINT_SECONDS / TERRITORY_CHEST_HINT_HOPS;
    const peaks = [0, 1, 2].map((index) => territoryChestHintBounceOffset(hop * index + hop / 2));
    assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2], `逐跳递减: ${peaks.join(' / ')}`);
    assert.ok(Math.abs(peaks[1] - peaks[0] * (1 - TERRITORY_CHEST_HINT_HOP_DECAY)) < 1e-9, '第二跳 = 首跳 × 0.75');
    // 采样整段：不许为负（会陷进地里）也不许超过首跳高度。
    for (let i = 0; i <= 150; i += 1) {
        const offset = territoryChestHintBounceOffset((i / 100) * TERRITORY_CHEST_HINT_SECONDS);
        assert.ok(offset >= 0 && offset <= TERRITORY_CHEST_HINT_HEIGHT + 1e-9, `t=${i / 100} 偏移越界: ${offset}`);
    }
});

// ---------------------------------------------------------------------------
// 接线守卫（模型对但没人调 = 需求没做）
// ---------------------------------------------------------------------------

const mapViewSource = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const stationViewSource = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const pageAssetsSource = readFileSync('assets/script/app/territory/application/TerritoryPageAssets.ts', 'utf8');

test('★★★`update` 每帧推进跳动，且第一条语句仍是 `hexFlip.step`（顺序判据不许被挤）', () => {
    const signature = mapViewSource.slice(mapViewSource.indexOf('update(dt: number): void {'));
    const body = signature.slice(0, signature.indexOf('\n    }'));
    const statements = body
        .slice(body.indexOf('{') + 1)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
    assert.equal(statements[0], 'this.hexFlip.step(dt);', 'update 第一条必须还是翻格');
    assert.ok(mapViewSource.includes('this.stepChestHint(dt);'), 'update 里没推进宝箱跳动 ⇒ 宝箱不会动');
});

test('★★★点地块 ⇒ 起跳；换章 ⇒ 收掉（否则半空的偏移留在新图上）', () => {
    const clickBody = mapViewSource.slice(mapViewSource.indexOf('private readonly onStationClick'));
    assert.ok(
        clickBody.slice(0, clickBody.indexOf('\n    };')).includes('this.playChestHint(site.cellId);'),
        'onStationClick 没触发宝箱跳动',
    );
    const gridBody = mapViewSource.slice(mapViewSource.indexOf('private syncGrid('));
    assert.ok(
        gridBody.slice(0, gridBody.indexOf('\n    }')).includes('this.clearChestHint();'),
        'syncGrid 换章时没收掉宝箱跳动',
    );
});

test('★★★跳动期间藏气泡走的是**开关**，不是直接关节点（站点每秒会被重画）', () => {
    assert.ok(
        mapViewSource.includes('view.setHintBubbleSuppressed(true);'),
        'playChestHint 没抑制气泡',
    );
    assert.ok(
        mapViewSource.includes('view.setHintBubbleSuppressed(false);'),
        '收尾没解禁气泡 ⇒ 跳完气泡再也回不来',
    );
    // 判据必须落在 `renderLevelBubble` 的 visible 表达式里：直接 `node.active = false`
    // 会在下一轮 `syncStations` 刷新时被重新打开。
    assert.match(
        stationViewSource,
        /&&\s*!this\.hintBubbleSuppressed/,
        'renderLevelBubble 的 visible 判据里没有 hintBubbleSuppressed',
    );
});

test('★★★跳动偏移必须走唯一的坐标出口 `writeIconPosition`（否则被每秒重排按回地面）', () => {
    assert.ok(stationViewSource.includes('private writeIconPosition(): void {'));
    assert.ok(
        stationViewSource.includes('this.iconBaseY + this.chestHintOffsetY'),
        'writeIconPosition 没把跳动偏移加进 y',
    );
    // Icon 的 `setPosition` 只该出现在 `writeIconPosition` 里。
    const iconWrites = stationViewSource.match(/this\.icon\s*[!?]?\.setPosition\(/g) ?? [];
    assert.equal(iconWrites.length, 0, 'Icon 还有别处直接 setPosition ⇒ 与跳动抢同一个属性');
});

test('★★体力图标接进了资源加载（拿不到只是退化成纯数字，不许整体失败）', () => {
    assert.ok(pageAssetsSource.includes("'图标_体力'"), 'TerritoryPageAssets 没加载体力图标');
    assert.ok(pageAssetsSource.includes('staminaIcon'), 'TerritoryPageAssets 没把 staminaIcon 交出去');
    assert.ok(mapViewSource.includes('staminaIcon'), 'MapView 的 art 里没有 staminaIcon');
    assert.ok(
        mapViewSource.includes('levelBubbleIcon: showHintBubble ? input.art.staminaIcon ?? null : undefined'),
        '宝箱气泡没把体力图标传下去',
    );
    assert.ok(
        mapViewSource.includes('levelBubble: showHintBubble ? String(site.unlock.staminaCost) : undefined'),
        '宝箱气泡的内容不是体力消耗数',
    );
});

test('★★★唯一气泡的选择**一轮只算一次**，再透传给每一格（不是每格自己挑一次）', () => {
    const syncBody = mapViewSource.slice(mapViewSource.indexOf('private syncStations('));
    const body = syncBody.slice(0, syncBody.indexOf('\n    }\n'));
    assert.ok(
        body.includes('const chestHintCell = territoryChestHintCell('),
        'syncStations 没算唯一气泡格',
    );
    assert.match(
        body,
        /this\.stationRenderOf\(site, input, chestHintCell[,)]/,
        'chestHintCell 没透传给 stationRenderOf ⇒ 每格都会觉得"该我挂"或"都不挂"',
    );
    const calls = body.match(/territoryChestHintCell\(/g) ?? [];
    assert.equal(calls.length, 1, `一轮渲染里算了 ${calls.length} 次唯一气泡格（每格算一次会让结果依赖遍历顺序）`);
});

test('★★点击时能拿到「整张 sites + progress」：`renderMap` 必须留一份入参快照', () => {
    const renderBody = mapViewSource.slice(mapViewSource.indexOf('renderMap(input: ITerritoryMapRenderInput): void {'));
    const firstLine = renderBody
        .slice(renderBody.indexOf('{') + 1)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))[0];
    assert.equal(firstLine, 'this.lastRenderInput = input;', 'renderMap 第一句必须是入参快照');
});
