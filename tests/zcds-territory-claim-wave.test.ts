/**
 * 「开局归属扩散」波的护栏（2026-10-15）。
 *
 * 需求（row15）原话：「红色框，归属格子的颜色直接切换；绿色框，中立格子的颜色则是逐个替换，
 * 以玩家基地为圆心，圆形的扩散替换，替换的速度越来越快，范围越来越大」。
 *
 * 口径落在四处：
 *  - `ZCGameViewUtil.buildClaimWavePlan`（逐格时间表：只收**本半区的中立格**，BFS 距离分层
 *    + 环内极角排序 + 加速曲线；**归属格不入表**）
 *  - `ZCHexView.setClaimWave`（每格自己的「半区色 → 战斗底色」两段过渡色）
 *  - `ZCClaimWave`（每帧推进的纯表现层）
 *  - `ZCGameRenderWorld.startTerritoryClaimWave`（注入 ownerOf / sectionOwnerOf / tintOwnerOf）
 *
 * ⚠️ 归属**不是**这一层算的：模型在开局那一刻就已经把主城与邻格分配好了
 * （`ZCSnapshotCodec.createInitialState`）；半区则是选点阶段的既有概念
 * （`ZCSpawnSelection.regionOwnerOf`）。本动画只决定底色**何时**回到战斗态，
 * 不回写模型 —— 所以「快照 / 战报读到真实归属」这条不该被这组用例扰动。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    configureZCMap,
    defaultZCSectionAt,
    ownerForSection,
    ownersForPlayerCount,
    type ZCFaction,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCSpawnSelection, resolveZCSpawnMatchConfig } from '../assets/script/app/zcds/model/ZCSpawnSelection';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import {
    buildClaimWavePlan,
    claimWaveProgress,
    territoryTintOwner,
    ZC_CLAIM_WAVE_ACCEL_POWER,
    ZC_CLAIM_WAVE_FADE_SECONDS,
    ZC_CLAIM_WAVE_SECONDS,
} from '../assets/script/app/zcds/view/ZCGameViewUtil';
import { assetPath } from './helpers/asset-paths';

// ── 纯函数：时间表 ─────────────────────────────────────────────────────────

/**
 * 合成六边形。⚠️ `id` 必须与它在数组里的下标一致 —— `buildClaimWavePlan` 按 `map[hexId]`
 * 取格（与真地图同口径，`ZCSnapshotCodec` 也是这么用的），错位会取到错的邻接关系。
 */
function hex(id: number, x: number, y: number, neighbors: readonly number[], playable = true) {
    return { id, x, y, neighbors, playable };
}

/** 半区色 = 该格的半区归属（缺省 = 归属；中立格缺省归玩家半区）。 */
function callbacks(
    owner: Record<number, ZCFaction>,
    section: Record<number, ZCFaction> = {},
    tint: (hexId: number) => ZCFaction = (hexId) => owner[hexId] ?? 'neutral',
) {
    return {
        ownerOf: (hexId: number): ZCFaction => owner[hexId] ?? 'neutral',
        sectionOwnerOf: (hexId: number): ZCFaction => section[hexId] ?? 'player',
        tintOwnerOf: tint,
    };
}

test('buildClaimWavePlan：归属格不入表（红框「直接切换」），只收本半区的中立格', () => {
    // 0 = 主城，1 / 2 = 主城的邻格（开局就归属），3 = 本半区中立格，
    // 4 = 敌方半区的中立格，5 = 不属于任何半区的中立格，6 = 本半区的虚空格。
    const map = [
        hex(0, 0, 0, [1]), hex(1, 10, 0, [0, 2]), hex(2, 20, 0, [1, 3]),
        hex(3, 30, 0, [2, 4, 5, 6]), hex(4, 40, 0, [3]), hex(5, 30, 10, [3]),
        hex(6, 30, -10, [3], false),
    ];
    const plan = buildClaimWavePlan(map, [0], callbacks(
        { 0: 'player', 1: 'player', 2: 'player' },
        { 4: 'enemy', 5: 'neutral' },
    ));

    assert.deepEqual([...plan.entries.keys()], [3],
        '只有「本半区的中立格」进表：归属格（0/1/2）、别的半区（4）、无半区（5）、虚空格（6）都不许染');
    const entry = plan.entries.get(3)!;
    assert.equal(entry.fromOwner, 'player', '起点 = 这一格在选点阶段铺的半区色');
    assert.equal(entry.toOwner, 'neutral', '终点缺省 = 开局真实归属（中立格 ⇒ 中立观感）');
    assert.equal(entry.startSeconds, 0, '离主城最近的那一环（中立格第 0 名）恒为 0 秒');
    assert.equal(plan.durationSeconds, ZC_CLAIM_WAVE_SECONDS);
});

test('buildClaimWavePlan：没有可染的中立格 ⇒ 空表，调用方不必等', () => {
    const map = [hex(0, 0, 0, [1]), hex(1, 10, 0, [0])];
    const all = callbacks({ 0: 'player', 1: 'player' });
    assert.equal(buildClaimWavePlan(map, [], all).entries.size, 0, '没有主城');
    assert.equal(buildClaimWavePlan(map, [0], callbacks({})).entries.size, 0, '主城自己中立 ⇒ 不排波');
    assert.equal(buildClaimWavePlan(map, [-1], all).entries.size, 0, 'select 图未配置的默认主城是 -1');
    assert.equal(buildClaimWavePlan(map, [0], callbacks({ 0: 'player' }, { 1: 'enemy' })).entries.size, 0,
        '半区对不上（这一方没有自己的半区）⇒ 不排波');
    assert.equal(buildClaimWavePlan(map, [0], callbacks({})).durationSeconds, 0);
});

test('buildClaimWavePlan：同一环内按极角排序 ⇒ 6 个等距中立格「逐个」而不是同时', () => {
    // 主城 + 一圈 6 个归属邻格（环 1）+ 一圈 6 个中立格（环 2，等距 ⇒ 光靠距离排不出先后，
    // 必须落到环内的极角次序上）。
    const angles = [0, 60, 120, 180, 240, 300];
    const owned: Record<number, ZCFaction> = { 0: 'player' };
    const ring1 = angles.map((deg, index) => {
        const rad = deg * Math.PI / 180;
        owned[index + 1] = 'player';
        return hex(index + 1, Math.cos(rad) * 10, Math.sin(rad) * 10, [0, index + 7]);
    });
    const ring2 = angles.map((deg, index) => {
        const rad = deg * Math.PI / 180;
        return hex(index + 7, Math.cos(rad) * 20, Math.sin(rad) * 20, [index + 1]);
    });
    const plan = buildClaimWavePlan([hex(0, 0, 0, [1, 2, 3, 4, 5, 6]), ...ring1, ...ring2],
        [0], callbacks(owned));
    assert.deepEqual([...plan.entries.keys()].sort((a, b) => a - b), [7, 8, 9, 10, 11, 12],
        '只收环 2 的 6 个中立格 —— 主城与环 1 是归属格，直接切换、不入波');
    assert.equal(new Set([...plan.entries.values()].map((entry) => entry.startSeconds)).size, 6,
        '6 格必须各占一个时刻（「颜色逐个替换」）');
    // `atan2` 值域是 (-π, π]：升序 = 240°(=-120°) → 300°(=-60°) → 0° → 60° → 120° → 180°(=π)。
    const at = (deg: number): number => plan.entries.get(7 + deg / 60)!.startSeconds;
    const sweep = [240, 300, 0, 60, 120, 180];
    assert.ok(sweep.every((deg, index) => index === 0 || at(sweep[index - 1]) < at(deg)),
        `环内必须按极角升序逐个点亮，实际 ${angles.map((d) => `${d}°=${at(d).toFixed(3)}`).join(', ')}`);
    // 环内也遵守加速曲线（每一格自己的到达时刻同样按 `rank^POWER` 排）。
    const sweepTimes = sweep.map(at);
    const sweepGaps = sweepTimes.slice(1).map((value, index) => value - sweepTimes[index]);
    assert.ok(sweepGaps.every((gap, index) => index === 0 || gap < sweepGaps[index - 1]),
        `环内相邻间隔也要递减，实际 ${sweepGaps.map((g) => g.toFixed(4)).join(', ')}`);
    assert.equal(at(sweep[0]), 0, '角序的第一格就是名次 0：主城那块刚切完，波立马从它边上开吃');
});

test('buildClaimWavePlan：波前加速（缓入快出）—— 相邻间隔单调递减、越来越快', () => {
    // 一条 0..6 的直线：0 = 主城，1 / 2 = 归属邻格，3..6 = 本半区的中立格。
    // 中立格的距离 3…6 各一格，间隔序列就是波前的速度曲线。
    const map = Array.from({ length: 7 }, (_, index) =>
        hex(index, index * 10, 0, [index - 1, index + 1].filter((n) => n >= 0 && n <= 6)));
    const plan = buildClaimWavePlan(map, [0], callbacks({ 0: 'player', 1: 'player', 2: 'player' }));
    const times = [...plan.entries.values()].map((entry) => entry.startSeconds).sort((a, b) => a - b);
    assert.equal(times.length, 4, '只有中立格 3..6 进表');
    assert.ok(Math.abs(times[0]) < 1e-12);
    assert.ok(Math.abs(times[times.length - 1] - ZC_CLAIM_WAVE_SECONDS) < 1e-9);
    const gaps = times.slice(1).map((value, index) => value - times[index]);
    assert.ok(gaps.every((gap, index) => index === 0 || gap < gaps[index - 1]),
        `相邻间隔必须单调递减（越往外越快），实际 ${gaps.map((g) => g.toFixed(4)).join(', ')}`);
    assert.ok(gaps[0] > gaps[gaps.length - 1] * 2,
        `起手要明显慢于收尾（缓入快出），实际首 ${gaps[0].toFixed(3)} / 末 ${gaps[gaps.length - 1].toFixed(3)}`);
    assert.ok(ZC_CLAIM_WAVE_ACCEL_POWER > 0 && ZC_CLAIM_WAVE_ACCEL_POWER < 1,
        `加速指数必须落在 (0,1)（< 1 才是「缓入快出」，= 1 是匀速、> 1 会反过来），实际 ${ZC_CLAIM_WAVE_ACCEL_POWER}`);
});

test('claimWaveProgress：0.1s 过渡、两端 clamp', () => {
    assert.equal(claimWaveProgress(0, 0.3, 0), 0, '还没轮到它');
    assert.equal(claimWaveProgress(0.3, 0.3, 0), 0, '刚轮到那一拍仍是半区色');
    assert.ok(Math.abs(claimWaveProgress(0.3 + ZC_CLAIM_WAVE_FADE_SECONDS / 2, 0.3, 0) - 0.5) < 1e-9);
    assert.equal(claimWaveProgress(0.3 + ZC_CLAIM_WAVE_FADE_SECONDS, 0.3, 0), 1);
    assert.equal(claimWaveProgress(99, 0.3, 0), 1, '过期也不许超过 1');
});

// ── 终点色口径：全工程一处 ────────────────────────────────────────────────

test('territoryTintOwner：只有「中立 + 可开发」才改成可开发方的颜色', () => {
    assert.equal(territoryTintOwner('neutral', false), 'neutral', '中立格不可开发 ⇒ 中立观感');
    assert.equal(territoryTintOwner('neutral', true), 'player', '中立格可开发 ⇒ 按可开发方点亮（既有语义）');
    assert.equal(territoryTintOwner('enemy', true), 'enemy', '已经有主的格不受 canDevelop 影响');
    assert.equal(territoryTintOwner('player', false), 'player');
});

test('buildClaimWavePlan：终点色走 tintOwnerOf（中立可开发格落在可开发方的颜色上）', () => {
    const map = [hex(0, 0, 0, [1]), hex(1, 10, 0, [0, 2]), hex(2, 20, 0, [1])];
    const owner = { 0: 'player', 1: 'player' } as Record<number, ZCFaction>;
    const plan = buildClaimWavePlan(map, [0], callbacks(owner, {}, (hexId) => (
        territoryTintOwner(owner[hexId] ?? 'neutral', hexId === 2)
    )));
    assert.equal(plan.entries.get(2)!.toOwner, 'player',
        '若这一格在波播到它时已经可开发，终点色必须是可开发方的颜色 —— 否则收工那一帧会跳色');
});

// ── 真实自选主城图：整盘规模与两侧对称 ──────────────────────────────────────

test('真实自选主城图（select_river）：波覆盖整片半场的中立格（14 格归属格不入波）', () => {
    const tableNames = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    ];
    const tables = Object.fromEntries(tableNames.map((name) => {
        const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
        return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
            Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
        ))];
    })) as unknown as ZCPvpTables;
    loadPvpTables(tables);

    const layout = JSON.parse(
        readFileSync(assetPath('config/maps/select_river.json'), 'utf8'),
    ) as ZCMapLayout;
    configureZCMap(layout);
    const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
    const homes = base.map.homes!;
    const config = resolveZCSpawnMatchConfig(base, {
        homes: { player: homes[0], enemy: homes[1] } as never,
        resolvedResources: [] as never,
    });
    const model = new ZCGameModel(null, Math.random, config);
    // 半区口径用**生产那一份**（`ZCSpawnSelection.regionOwnerOf`）—— 波只认它，不自己推分区。
    const selection = new ZCSpawnSelection(base.map);
    const ownerById = new Map(model.snapshot.hexes.map((state) => [state.id, state.owner] as const));
    const plan = buildClaimWavePlan(config.map.hexes, config.map.homes!, {
        ownerOf: (id) => ownerById.get(id) ?? 'neutral',
        sectionOwnerOf: (id) => selection.regionOwnerOf(id) ?? 'neutral',
    });

    // 开局真正归属的只有「主城 + 6 邻格」= 7 格/方，两侧合计 14 —— 它们**不该**在波里。
    const ownedIds = [...ownerById].filter(([, owner]) => owner !== 'neutral').map(([id]) => id);
    assert.equal(ownedIds.length, 14, '两座主城各 7 格（主城 + 周围 6 格）');
    for (const hexId of ownedIds) {
        assert.equal(plan.entries.has(hexId), false,
            `hex ${hexId} 是归属格，必须走「直接切换」这一条（不入波）`);
    }

    // 覆盖范围 = 每个半区里的中立可通行格。⚠️ 地图改了要一起改这个数。
    const expected = config.map.hexes.filter((hex) => (
        hex.playable
        && (ownerById.get(hex.id) ?? 'neutral') === 'neutral'
        && selection.regionOwnerOf(hex.id) !== null
    )).map((hex) => hex.id);
    assert.equal(expected.length, 152, '真实图上半区中立格总数（两侧各 76）');
    assert.equal(plan.entries.size, expected.length,
        '波要覆盖半场里**全部**中立格（范围越来越大那一条），一个都不许漏');
    assert.ok(plan.entries.size > 14, '波早就不该只是主城那 14 格了');

    const playerTimes = [...plan.entries.values()].filter((e) => e.fromOwner === 'player').map((e) => e.startSeconds).sort((a, b) => a - b);
    const enemyTimes = [...plan.entries.values()].filter((e) => e.fromOwner === 'enemy').map((e) => e.startSeconds).sort((a, b) => a - b);
    assert.equal(playerTimes.length, 76);
    assert.deepEqual(playerTimes, enemyTimes, '两侧必须同拍（对称的地图不该一边先亮完）');
    assert.equal(playerTimes[0], 0, '离主城最近的中立格是波心（0 秒）');
    assert.ok(Math.abs(playerTimes[playerTimes.length - 1] - ZC_CLAIM_WAVE_SECONDS) < 1e-9);

    // 每一格：起点色 = 它自己半区的颜色，终点色 = 开局真实底色（此刻全不可开发 ⇒ 中立观感）。
    for (const [hexId, entry] of plan.entries) {
        assert.equal(entry.fromOwner, selection.regionOwnerOf(hexId),
            `hex ${hexId} 的起点必须是它自己的半区色`);
        assert.notEqual(entry.fromOwner, 'neutral', `hex ${hexId} 没有半区，不该进波`);
        assert.equal(entry.toOwner, territoryTintOwner(ownerById.get(hexId) ?? 'neutral', model.canPlayerDevelop(hexId)));
    }
});

test('真实自选主城图：半区划分与「上下半场二分」一致（波两侧各一半的由来）', () => {
    const layout = JSON.parse(
        readFileSync(assetPath('config/maps/select_river.json'), 'utf8'),
    ) as ZCMapLayout;
    configureZCMap(layout);
    const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
    const rows = base.map.rows;
    const columns = base.map.columns;
    const owners = ownersForPlayerCount(2);
    const selection = new ZCSpawnSelection(base.map);
    for (const hex of base.map.hexes) {
        const expected = ownerForSection(defaultZCSectionAt(2, rows, columns, hex.row, hex.column))!;
        assert.equal(selection.regionOwnerOf(hex.id), expected,
            `hex ${hex.id} 的半区归属必须与 defaultZCSectionAt 同口径`);
    }
    assert.deepEqual(owners, ['player', 'enemy']);
});

// ── 视图：每格自己的「半区色 → 战斗底色」过渡 ────────────────────────────────

/** 与 `zcds-hex-neighbor-spawn.test.ts` 同款：补齐 prefab 必填引用。 */
function stubHexView(load: (name: string) => unknown, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView') as any).ZCHexView();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.priceIcon.spriteFrame = { name: 'coin' };
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.tileSprite.color = null;
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

/** 一格「中立 · 未开发」的地块（波的绝大多数格都是这个样子）。 */
function neutralHexState() {
    return {
        id: 7, owner: 'neutral' as const, state: 'occupiable' as const, building: 'none' as const, tier: 0,
        hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
        developmentCost: 25, tileType: ZCPvpTileType.Mine, developmentResolved: false,
        neutralResourceId: null, cardId: null,
    } as never;
}

test('ZCHexView.setClaimWave：起手是半区色（不是中立色），收尾是战斗底色，中途线性过渡', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const presentation = { state: neutralHexState(), canDevelop: false, playerGold: 999, cooldown: null, now: 0 };
    view.render(presentation);
    const normal = { ...view.tileSprite.color };
    assert.ok(normal.r > 200 && normal.g > 200 && normal.b > 200, '常规渲染下中立格是中性灰白');
    assert.ok(normal.a <= 110, '中立填充的 alpha 上限是 NEUTRAL_FILL_ALPHA');

    // 进度 0：整格回到**选点阶段的半区色** —— 与选点界面逐位一致，起手那一帧才不会闪。
    view.setClaimWave({ from: 'player', to: 'neutral', progress: 0 });
    const waveStart = view.tileSprite.color;
    const faction = (load('./ZCTheme') as any).zcFactionColor('player');
    assert.deepEqual([waveStart.r, waveStart.g, waveStart.b], [faction.r, faction.g, faction.b],
        '波把这一格压到的是「半区色」，不是中立观感 —— 整盘底色此刻还停在选点观感上');
    assert.ok(waveStart.a > normal.a, '半区填充比中立填充更实（两次填充的 alpha 本来就不同）');

    // 中途：逐通道落在两端之间（线性过渡，不是硬切）。
    view.setClaimWave({ from: 'player', to: 'neutral', progress: 0.5 });
    const mid = view.tileSprite.color;
    for (const channel of ['r', 'g', 'b', 'a'] as const) {
        assert.ok(mid[channel] >= Math.min(waveStart[channel], normal[channel])
            && mid[channel] <= Math.max(waveStart[channel], normal[channel]),
            `${channel} 通道应落在两端之间，实际 ${mid[channel]}`);
    }
    assert.notDeepEqual([mid.r, mid.g, mid.b], [waveStart.r, waveStart.g, waveStart.b], '中途色必须真的在变');

    // 进度 1：与常规渲染同值 —— 收工那一帧不能跳色。
    view.setClaimWave({ from: 'player', to: 'neutral', progress: 1 });
    assert.deepEqual(
        [view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a],
        [normal.r, normal.g, normal.b, normal.a],
        '进度 1 必须与常规渲染逐位一致',
    );

    // 收工：先交还控制权（清掉静态指纹），下一拍 render 重算回真实底色。
    view.setClaimWave(null);
    view.render(presentation);
    assert.deepEqual(
        [view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a],
        [normal.r, normal.g, normal.b, normal.a],
        '收工后必须回到真实底色',
    );
});

test('ZCHexView.setClaimWave：两端同色时全程恒色（可开发中立格不许在波里被"洗"一次）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 这一格在选点阶段已经是玩家半区色，波播到它时可开发色也是玩家色 ⇒ 起点 = 终点。
    const faction = (load('./ZCTheme') as any).zcFactionColor('player');
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        view.setClaimWave({ from: 'player', to: 'player', progress });
        assert.deepEqual(
            [view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b],
            [faction.r, faction.g, faction.b],
            `两端同色时 progress=${progress} 也必须恒为该色`,
        );
    }
});

test('ZCHexView.setClaimWave：静态刷新也走同一条过渡色（两条写入路径不许打架）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 覆盖生效后再走一次完整 render（= 0.15s 一次的 `renderStatic` 路径）：
    // 它不能把覆盖色冲掉，否则波播到一半会闪回战斗底色。
    view.setClaimWave({ from: 'enemy', to: 'neutral', progress: 0.25 });
    const afterWave = { ...view.tileSprite.color };
    view.render({ state: neutralHexState(), canDevelop: false, playerGold: 999, cooldown: null, now: 1 });
    assert.deepEqual(
        [view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a],
        [afterWave.r, afterWave.g, afterWave.b, afterWave.a],
        'renderTerrain 必须认出扩散波覆盖、算出同一个颜色',
    );
});

// ── 表现模块：start / advance / clear 的生命周期 ───────────────────────────

test('ZCClaimWave：起手把所有中立格压到半区色，播完自动交还，clear 幂等', () => {
    const { load } = loadViews();
    const map = Array.from({ length: 4 }, (_, index) =>
        hex(index, index * 10, 0, [index - 1, index + 1].filter((n) => n >= 0 && n <= 3)));
    const writes: Array<{ id: number; wave: any }> = [];
    const views = new Map<number, unknown>();
    for (const entry of map) {
        views.set(entry.id, { setClaimWave: (wave: any) => writes.push({ id: entry.id, wave }) });
    }
    const wave = new (load('./ZCClaimWave') as any).ZCClaimWave({
        hexViewByEntity: (entityId: number) => views.get(entityId),
        entityIdByHex: (hexId: number) => hexId,
    });
    // 0 = 主城，1 = 主城邻格（开局就归属），2 / 3 = 本半区中立格。
    const options = {
        ownerOf: (hexId: number) => (hexId <= 1 ? 'player' : 'neutral'),
        sectionOwnerOf: () => 'player',
    };

    assert.equal(wave.active, false);
    assert.equal(wave.start(map, [0], options, 0), true);
    assert.equal(wave.active, true);
    assert.equal(writes.length, 2, '只写中立格 —— 归属格（主城 / 邻格）不入波');
    assert.ok(writes.every((write) => write.wave.progress === 0),
        '起手全部压到 0（半区色），否则第一帧就已经是战斗底色了');
    assert.ok(writes.every((write) => write.wave.from === 'player' && write.wave.to === 'neutral'),
        '每条覆盖都要带上两端色（视图不自己推终点色）');

    // 推进到 1 秒：名次 0 的那一格已经到位，排在后面的仍是半区色。
    writes.length = 0;
    assert.equal(wave.advance(ZC_CLAIM_WAVE_SECONDS * 0.5), true, '还有格没到 1，得继续播');
    assert.deepEqual(writes.map((write) => write.id), [2], '只有名次 0 的那一格在动');

    // 走完全程：全部到 1，并且自动交还控制权。
    writes.length = 0;
    assert.equal(wave.advance(ZC_CLAIM_WAVE_SECONDS + ZC_CLAIM_WAVE_FADE_SECONDS), false, '播完返回 false');
    assert.equal(wave.active, false, '播完必须自动收尾，不能把覆盖一直挂着');
    const finishes = writes.filter((write) => write.wave === null);
    assert.equal(finishes.length, 2, '收尾时每一格都要被交还给常规渲染');

    // 幂等：再 clear 一次不重复写视图。
    writes.length = 0;
    wave.clear();
    assert.equal(writes.length, 0, '已收工后再 clear 不该有多余写入');
});

test('ZCClaimWave：没有可染的格时 start 返回 false（调用方不必等）', () => {
    const { load } = loadViews();
    const map = [hex(0, 0, 0, [1]), hex(1, 10, 0, [0])];
    const wave = new (load('./ZCClaimWave') as any).ZCClaimWave({
        hexViewByEntity: () => undefined,
        entityIdByHex: () => undefined,
    });
    const options = { ownerOf: (hexId: number) => (hexId === 0 ? 'player' : 'neutral'), sectionOwnerOf: () => 'player' };
    assert.equal(wave.start(map, [], options, 0), false);
    assert.equal(wave.active, false);
    assert.equal(wave.start(map, [5], options, 0), false, '主城越界（select 图的 -1 / 越界 id）也不排波');
});

// ── 接线守卫：动效必须每帧推进，且只在自选主城局起波 ─────────────────────────

test('接线：扩散波挂在 renderDynamic（每帧），不跟地块系统的 0.15s 节流', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const start = source.indexOf('renderDynamic(model: ZCGameModel): void {');
    assert.ok(start > 0, 'renderDynamic 必须存在');
    const body = source.slice(start, source.indexOf('\n    }', start));
    assert.match(body, /this\.renderTerritoryClaimWave\(model\)/,
        '扩散波必须挂在 renderDynamic 上 —— 每格只有 0.1s 的过渡，0.15s 的静态节流会把它压成硬切');
    const staticStart = source.indexOf('renderStatic(model: ZCGameModel): void {');
    const staticBody = source.slice(staticStart, source.indexOf('\n    }', staticStart));
    assert.doesNotMatch(staticBody, /renderTerritoryClaimWave/,
        '静态刷新那条路径不许再推一遍（两处都推会让波前走两倍速）');
});

test('接线：只在自选主城局（选点确认）起波，且先渲染真实归属再压回半区色', () => {
    const source = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const at = source.indexOf('private finishSpawnSelection(): void {');
    assert.ok(at > 0, '找不到 finishSpawnSelection');
    const body = source.slice(at, source.indexOf('\n    }', at));
    assert.match(body, /startTerritoryClaimWave\(this\.model, selection\)/,
        '波只由选点确认那条路径起，且必须把选点对象（半区口径的出处）一起传进去');
    const renderAt = body.indexOf('this.renderWorld.render(this.model)');
    const waveAt = body.indexOf('startTerritoryClaimWave');
    assert.ok(renderAt > 0 && renderAt < waveAt,
        '必须先渲染再起波：归属格不入波，它们的底色只由这次 render 画出来，反了会停在选点的深蓝高亮上');
    assert.match(source, /clearTerritoryClaimWave/,
        '退出对局要还原地块覆盖色，否则下一局带着上一局中途的过渡色出场');
});

test('接线：半区口径只有一处、终点色三处同源', () => {
    const world = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const at = world.indexOf('startTerritoryClaimWave(model: ZCGameModel, selection: ZCSpawnSelection)');
    assert.ok(at > 0, '渲染层起波必须收下选点对象');
    const body = world.slice(at, world.indexOf('\n    }', at));
    assert.match(body, /selection\.regionOwnerOf\(hexId\)/,
        '半区口径只能来自 `ZCSpawnSelection`（地图画的分区 / 按布局推导），不许在这里再拼一份');
    assert.match(body, /territoryTintOwner\(/, '终点色与底图 / 轮廓同源');

    const hexSystem = world.slice(world.indexOf('private renderHexSystem'), world.indexOf('private redrawSharedOutline'));
    assert.match(hexSystem, /territoryTintOwner\(/,
        '领地轮廓也走同一处口径，否则「底图一个色、轮廓另一个色」');

    const hexView = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
    assert.match(hexView, /territoryFill\(territoryTintOwner\(state\.owner, canDevelop\)\)/,
        '地块底图必须走同一处口径');
    assert.doesNotMatch(hexView, /state\.owner === 'neutral' && canDevelop \? 'player'/,
        '旧的手写判据不许复活');
    assert.doesNotMatch(hexView, /claimWaveTint\('neutral'/,
        '扩散波的起点不再是写死的中立色 —— 起点由 `ZCClaimWaveEntry.fromOwner` 给');
});
