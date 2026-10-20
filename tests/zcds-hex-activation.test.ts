// 收场表现的共用参数真源（core 无 cc，用例可直连）；以前是从 ZCHexView 的别名读的。
import {
    HEX_PULSE_FRAME_COUNT,
    HEX_PULSE_FRAME_HIDDEN,
    HEX_PULSE_FRAME_SECONDS,
    HEX_PULSE_WAVE_SECONDS,
    HEX_SHRINK_MIN_SCALE,
    hexPulseFx,
} from '../assets/script/core/hex/HexFlipPresentation';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    configureZCMap,
    ZCGameModel,
    ZCMapLayout,
    ZCSnapshot,
} from '../assets/script/app/zcds/model/ZCGameModel';
import {
    getPvpRuntimeRules,
    loadPvpTables,
    ZCPvpTables,
} from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    ZC_CARD_AXIS_RATIO,
    ZC_CARD_FADE_START_PROGRESS,
    ZC_CARD_REVEAL_SECONDS,
    ZC_CARD_START_RATIO,
    ZC_CARD_START_SECONDS,
    ZC_HEX_ACTIVATION_SECONDS,
    ZC_HEX_BUILDING_SECONDS,
    ZC_HEX_PULSE_SECONDS,
    ZC_HEX_SHRINK_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { BUILDING_POP_FROM_SCALE, POP_PEAK_SCALE, ZC_LAND_TOP_CENTER_LIFT } from '../assets/script/app/zcds/view/ZCGameViewUtil';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

// ── 模型部分：开发成功 → 入队「地块激活表现」，过期清理，reset 清空 ─────────────
// 与 `zcds-model.test.ts` 同款加载骨架：remoteRef 的 PVP 表 + legacy 地图夹具。

function readPvpRef(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`../doc/塔防数据配置/json/client/${name}.json`, 'utf8'));
}

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
configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

function firstDevelopable(game: ZCGameModel): number {
    return game.snapshot.hexes.find((hex) => game.canPlayerDevelop(hex.id))!.id;
}

/** `tick` 单次最多接受 5 秒（内部 0.05 秒固定步长），这里按 2 秒一步推进。 */
function tickSeconds(game: ZCGameModel, seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 2) game.tick(2);
}

test('开发成功（落地建筑）→ 入队一条地块激活事件，时长 = 点击动画 + 卡牌段', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const id = firstDevelopable(game);
    const result = game.developHex(id);
    assert.equal(result.ok, true);
    const tile = game.snapshot.hexes[id];
    assert.notEqual(tile.building, 'none', '开发成功的格必须落地建筑，才会触发激活表现');

    const activations = game.hexActivations;
    assert.equal(activations.length, 1);
    assert.equal(activations[0].hexId, id);
    // 落地建筑 ⇒ 有卡牌揭示接棒，视图才允许走「整格隐藏」段。
    assert.equal(activations[0].hasCardReveal, true, '有建筑就有卡牌揭示，脉冲段后可隐藏等卡牌');
    // 激活总长 = 脉冲 + 卡牌（建筑在卡牌淡出窗内长完，不单开一段）。
    assert.equal(activations[0].durationSeconds, ZC_HEX_ACTIVATION_SECONDS);
    // 🔴 需求（2026-10-15 row13）：「② 缩没段和 ① 脉冲段 **同步播放**，点击动画即将结束时，
    // 衔接卡牌段」⇒ 点击动画 = max(脉冲, 缩没) = 0.7s，总长 = 0.7 + 卡牌 1.156 = **1.856s**
    // （由 2.24 缩短：串行时点击动画多吃掉缩没那 0.384s，用户 2026-10-15 选的就是这个口径）。
    assert.ok(Math.abs(ZC_HEX_ACTIVATION_SECONDS - 1.856) <= 1e-9,
        `卡牌淡出结束 = 点击动画 0.7 + 卡牌 1.156 = 1.856s，实际 ${ZC_HEX_ACTIVATION_SECONDS}`);
    // 两段并发 ⇒ 缩没的跨度必须等于脉冲的跨度（同起同收），否则会剩一段
    // 「格子已经没了、波还在原地扩」的空窗。
    assert.equal(ZC_HEX_SHRINK_SECONDS, ZC_HEX_PULSE_SECONDS, '缩没与脉冲必须同起同收');
    assert.equal(ZC_CARD_START_SECONDS, ZC_HEX_PULSE_SECONDS,
        '卡牌弹出时刻 = 点击动画结束 = 脉冲段长（缩没是并发的，不加时长）');
    assert.ok(Math.abs(ZC_CARD_REVEAL_SECONDS - 1.156) <= 1e-9,
        `卡牌段固定 1.156s、不随总长走，实际 ${ZC_CARD_REVEAL_SECONDS}`);
    // 总长恒等于两段之和（口径已由「钉死总长、反推卡牌段」改成「卡牌段固定、总长由它推」）。
    assert.ok(Math.abs(ZC_HEX_ACTIVATION_SECONDS - (ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS)) <= 1e-9,
        '总长 = 点击动画 + 卡牌段');
    assert.ok(ZC_HEX_BUILDING_SECONDS > 0, '建筑生成有自己的一段生长时长（落在卡牌淡出窗内）');
    // 淡出窗 = 卡牌段 × (1 − fadeStart) 仍要长过建筑生长时长 ⇒「卡牌淡完时建筑已长齐」不变。
    assert.ok(ZC_CARD_REVEAL_SECONDS * (1 - ZC_CARD_FADE_START_PROGRESS) > ZC_HEX_BUILDING_SECONDS,
        '建筑生长必须能在卡牌淡出窗内完成，否则总长改短后建筑会被腰斩');
    assert.equal(activations[0].startedAt, game.snapshot.elapsedSeconds);
    assert.equal(game.activationOf(id)?.id, activations[0].id);
    assert.equal(game.activationOf(999999), null, '未激活的格查询返回 null');
});

test('开发成功 → 卡牌延后到「点击动画（脉冲 ∥ 缩没）播完」才起跑（收完格就弹）', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const id = firstDevelopable(game);
    const startedAt = game.snapshot.elapsedSeconds;
    assert.equal(game.developHex(id).ok, true);
    const reveal = game.cardReveals[0];
    assert.ok(reveal, '开发成功必须入队一条卡牌 reveal');
    assert.equal(reveal.startedAt, startedAt + ZC_CARD_START_SECONDS,
        '卡牌起点必须推后「点击动画」（= 脉冲 ∥ 缩没同起同收、地块收干净那一刻）');
    assert.equal(reveal.durationSeconds, ZC_CARD_REVEAL_SECONDS, '卡牌自身时长不变');
    // 地块那边从这一刻就起（点击动画是它的前置段），两者的轴是串起来的、不重叠。
    assert.equal(game.hexActivations[0].startedAt, startedAt);
});

test('开发失败（金币不足）不入队激活事件', () => {
    const game = new ZCGameModel(null, () => 0.1);
    // 开局金币清零：任何开发都付不起（legacy 图最便宜的地块也要 25 金币）。
    (game.snapshot as ZCSnapshot).playerGold = 0;
    const id = firstDevelopable(game);
    const result = game.developHex(id);
    assert.equal(result.ok, false);
    assert.equal(game.hexActivations.length, 0);
    assert.equal(game.activationOf(id), null);
});

/**
 * 🔴 回归（2026-10-14）：「收场」属于**开发这件事本身**，不属于「抽到了什么」。
 *
 * 全类型随机格（问号，25 费）的 `empty` 权重是 0.7 ⇒ 七成是空手。
 * `pushHexActivation` 原先被放在 `!result.card` / `!result.building` 两个 return
 * **之后**，于是这些格子点下去既不收场也不出卡，观感就是「花了 25 金币没反应」。
 */
test('全类型随机格（问号）抽空也要入队激活事件', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const allRandom = game.snapshot.hexes.filter((hex) => (
        game.canPlayerDevelop(hex.id) && hex.tileType === ZCPvpTileType.AllRandom
    ));
    assert.ok(allRandom.length > 0, '夹具地图里应有可开发的全类型随机格');
    const id = allRandom[0].id;
    assert.equal(game.developHex(id).ok, true);
    assert.equal(game.snapshot.hexes[id].building, 'none',
        'random 恒 0.1 < empty 权重 0.7 ⇒ 本次抽空（不落地建筑）');
    assert.equal(game.hexActivations.length, 1, '抽空也必须入队地块激活（脉冲呼吸）');
    assert.equal(game.hexActivations[0].hexId, id);
    assert.equal(game.hexActivations[0].hasCardReveal, false,
        '抽空没有卡牌接棒 ⇒ 视图脉冲播完直接回常规定格，不能整格隐藏（那会露出棋盘底）');
    assert.equal(game.cardReveals.filter((reveal) => reveal.hexId === id).length, 0,
        '抽空没有卡牌，只有地块脉冲');
    assert.equal(game.snapshot.hexes[id].developmentResolved, true, '抽空也算「开发已落地」');
});

test('激活事件过期即清理（超过总时长后查不到该格）', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const id = firstDevelopable(game);
    assert.equal(game.developHex(id).ok, true);
    assert.ok(game.activationOf(id), '开发后该格应在激活表现期');
    tickSeconds(game, Math.ceil(ZC_HEX_ACTIVATION_SECONDS) + 2);
    assert.equal(game.activationOf(id), null, '超过时长后过期清理');
    assert.ok(game.hexActivations.every((activation) => activation.hexId !== id));
});

test('reset 清空激活队列，重开一局不带旧表现', () => {
    const game = new ZCGameModel(null, () => 0.1);
    const id = firstDevelopable(game);
    game.developHex(id);
    assert.ok(game.hexActivations.length > 0);
    game.reset();
    assert.equal(game.hexActivations.length, 0);
    assert.equal(game.activationOf(id), null);
});

// ── 视图纯函数：hexActivationFx 三段表现参数 ─────────────────────────────────

/** vm 桩跨 realm 的对象不能用 `deepStrictEqual`（原型不同），逐字段断言。 */
function assertIdleFx(value: any): void {
    assert.equal(value.hidden, false);
    assert.equal(value.tileLift, 0);
    assert.equal(value.tileFlip, 1);
    assert.equal(value.tileScale, 1);
    assert.equal(value.buildingPopScale, 1);
    assert.equal(value.glowRadius, 0);
    assert.equal(value.glowAlpha, 0);
}

/**
 * **点击动画段**内的 `seconds`（0 = 起手）→ 激活轴进度。
 *
 * 2026-10-15 row13 起，脉冲段与缩没段是**并发**的（同起同收），合起来就是这一段，
 * 宽度 = `ZC_CARD_START_SECONDS`。所以这里只需要一个换算 —— 旧版那套
 * `atAfterPulse` / `atAfterShrink`（串行分段）已经没有对应物，别再补回来。
 */
const atClick = (seconds: number): number => seconds / ZC_HEX_ACTIVATION_SECONDS;
/** 「卡牌进度」→ 激活轴进度（卡牌轴在**点击动画之后**，占 `ZC_CARD_AXIS_RATIO`）。 */
const atCard = (card: number): number =>
    ZC_CARD_START_RATIO + card * ZC_CARD_AXIS_RATIO;
/**
 * 采样**卡牌进度分界点**（起点 / 淡出起点）并稍往里挪一点。
 *
 * 🔴 为什么要挪：`atCard` 得做一次「进度 → 秒」反推，正好落在分界上时 1e-16 级尾差
 * 会把它甩到**前一拍**（还在点击动画里 / 还在隐藏），表现为「明明该回场却仍隐藏」的假红。
 * `+1e-9` 进度 ≈ 3ns，只为压过尾差，不改变任何肉眼可见的量。
 */
const atCardBoundary = (card: number): number => atCard(card) + 1e-9;

test('hexActivationFx：点击动画段「阶段 1 只脉冲（格子带 UI 不动）→ 阶段 2 才缩没」——5 帧按 10fps 推进、播完退场，不抬起、不再有圆环', () => {
    const mod = loadViews().load('./ZCHexView');
    const fx = mod.hexActivationFx as (progress: number) => any;
    // 波必须装得进点击动画段（段长 0.7s、波 0.5s）；装不下就会被段末硬切（一道波没播完就没了）。
    assert.ok(HEX_PULSE_WAVE_SECONDS > 0 && HEX_PULSE_WAVE_SECONDS <= ZC_HEX_PULSE_SECONDS,
        `一道波（${HEX_PULSE_WAVE_SECONDS}s）必须装得进点击动画段（${ZC_HEX_PULSE_SECONDS}s）`);
    // 负进度（= 无激活 / 未开始 / 已过期）：常规定格，建筑可见。
    assertIdleFx(fx(-1));
    // 起拍：第 0 帧（波贴在本体边缘），建筑还没长出来。
    const start = fx(0);
    assert.equal(start.hidden, false);
    assert.equal(start.tileLift, 0, '点击动画不抬起');
    assert.equal(start.tileFlip, 1);
    assert.equal(start.tileScale, 1);
    assert.equal(start.buildingPopScale, 0, '刚起拍建筑还没长出来');
    assert.equal(start.pulsePhase, 0, '起拍进度 0');
    assert.equal(start.pulseFrame, 0, '起拍 = 序列帧第一张');
    // 🔴 2026-10-19 新美术口径：放大与淡出**烘焙在图里**，曲线层不许再算一遍
    // （算两遍就是二次放大、二次虚化）。这两个字段已从 `IZCHexFlipFx` 删掉。
    assert.equal('pulseScale' in start, false, '扩散已烘焙进图，曲线层不再产出 pulseScale');
    assert.equal('pulseFade' in start, false, '虚化已烘焙进图，曲线层不再产出 pulseFade');
    // 🔴 山猫「中间有个圆圆的圈圈影响视觉」（2026-10-15）：脉冲段**不许再产出圆环**。
    assert.equal(start.glowRadius, 0, '脉冲段不再有 glow 圆环');
    assert.equal(start.glowAlpha, 0);

    // 逐帧推进：0.1s/帧，帧号严格按拍走（不是按进度连续插值 —— 图只有 5 张）。
    for (let index = 0; index < HEX_PULSE_FRAME_COUNT; index += 1) {
        const seconds = index * HEX_PULSE_FRAME_SECONDS + HEX_PULSE_FRAME_SECONDS / 2;
        const sample = fx(atClick(seconds));
        assert.equal(sample.pulseFrame, index,
            `t=${seconds.toFixed(2)}s 应播第 ${index} 帧（10fps），实际 ${sample.pulseFrame}`);
        // 整格全程在缩（缩没与脉冲并发），但**只缩不抬**。
        assert.equal(sample.tileLift, 0, '点击动画全程不抬起');
        assert.equal(sample.hidden, false);
    }

    // 第五帧之后（0.5s 起）波**直接消失**：不是继续举着末帧当静止波（需求 §七.3）。
    const afterWave = fx(atClick(HEX_PULSE_WAVE_SECONDS));
    assert.equal(afterWave.pulseFrame, HEX_PULSE_FRAME_HIDDEN, '波走完就该退场，不许停在末帧');
    assert.equal(afterWave.pulsePhase, 1, '退场后进度钉在 1（这一段仍归脉冲管，视图据此不再走开口光）');
    // 退场只关「波」，格子还在缩 —— 点击动画段要到 `ZC_HEX_PULSE_SECONDS` 才收干净。
    assert.ok(afterWave.tileScale < 1 && afterWave.tileScale > HEX_SHRINK_MIN_SCALE,
        `波退场时缩没还没走完，应落在 (${HEX_SHRINK_MIN_SCALE}, 1)，实际 ${afterWave.tileScale}`);

    // 🔴 两阶段的判据（2026-10-19 用户口径）：
    //   阶段 1 `[0, 阶段 2 起点)` —— 格子连 UI **原样不动**（`tileScale` 恒 1），只有波在长；
    //   阶段 2 起点之后 —— 才开始缩。起点 = 脉冲**中间帧**（第 2 帧）的开始时刻 0.2s。
    const shrinkStart = 0.2;
    for (const seconds of [0, 0.05, 0.1, 0.15, shrinkStart - 1e-6]) {
        assert.equal(fx(atClick(seconds)).tileScale, 1,
            `阶段 1（t=${seconds}s）格子必须原尺寸不动 —— 带 UI 的格子要留给玩家看清楚`);
    }
    // 刚进阶段 2 那一刻还基本是原尺寸（easeInCubic 起手很慢），随后明显缩下去。
    assert.ok(fx(atClick(shrinkStart)).tileScale > 0.995,
        '阶段 2 起点应几乎还没缩（曲线起手慢），实际 ' + fx(atClick(shrinkStart)).tileScale);
    // ⚠️ 别用 0.1s 就要求「明显缩」：`hexShrinkFx` 是 easeInCubic（前半几乎不动），
    // 跨度 0.5s 时 t=0.1s 才收到 0.9928。0.15s 才看得出（0.9757）。
    assert.ok(fx(atClick(shrinkStart + 0.15)).tileScale < 0.99,
        `阶段 2 开始 0.15s 后必须看得见在缩，实际 ${fx(atClick(shrinkStart + 0.15)).tileScale}`);

    // 🔴 整段**格根**缩放**单调不增**；若哪天退回「两段并发」，阶段 1 那截就会从头开始缩，
    // 上面那组「恒 1」立刻红。
    let previous = Infinity;
    for (const ratio of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999]) {
        const scale = fx(atClick(ZC_HEX_PULSE_SECONDS * ratio)).tileScale;
        assert.ok(scale <= previous + 1e-9,
            `点击动画内缩放必须单调不增（t = 段长的 ${ratio} 倍），实际 ${scale} > ${previous}`);
        previous = scale;
    }

    // 段末：缩没走完了 ⇒ 整格收到 `HEX_SHRINK_MIN_SCALE`（两段同起同收的落点），波早已退场；
    // 但**格子仍是可见的** —— 进入隐藏段要等卡牌段（见下一条用例）。
    const end = fx(atClick(ZC_HEX_PULSE_SECONDS * 0.999));
    assert.equal(end.hidden, false, '段末还不隐藏，隐藏要等卡牌段');
    assert.ok(Math.abs(end.tileScale - HEX_SHRINK_MIN_SCALE) < 0.02,
        `段末应已收到 ${HEX_SHRINK_MIN_SCALE}（缩没与脉冲同时收干净），实际 ${end.tileScale}`);
    assert.equal(end.pulseFrame, HEX_PULSE_FRAME_HIDDEN, '段末波一直保持退场（不退回去举着末帧）');
});

/**
 * 曲线层：**5 帧等宽推进**（每帧 0.1s），走完就退场，且**永不写格根缩放**。
 *
 * 三条都是「换美术之后最容易悄悄改坏」的地方：
 *   · 帧宽写成非等宽（比如按 `round` 取帧）⇒ 第 0 帧只占半拍，起波那一下会读成闪一下；
 *   · 播完不回退场 ⇒ 段内剩下 0.2s 举着一张 15% 的末帧当「静止波」；
 *   · 曲线顺手把 `tileScale` 写成 0.92 之类的「呼吸」⇒ 格根缩放和缩没段打架（row16 明令禁止）。
 */
test('hexPulseFx：5 帧按帧宽等宽推进、0.5s 后波退场，且永不写格根缩放', () => {
    const fx = hexPulseFx as (seconds: number) => any;
    assert.equal(fx(0).pulseFrame, 0, '起点 = 第 0 帧');
    // 每帧正中与每帧边界各验一次（边界取「刚好进去」，用 1e-6 避开浮点尾差）。
    for (let index = 0; index < HEX_PULSE_FRAME_COUNT; index += 1) {
        const middle = (index + 0.5) * HEX_PULSE_FRAME_SECONDS;
        assert.equal(fx(middle).pulseFrame, index,
            `t=${middle.toFixed(3)}s 应落在第 ${index} 帧，实际 ${fx(middle).pulseFrame}`);
        const edge = index * HEX_PULSE_FRAME_SECONDS + 1e-6;
        assert.equal(fx(edge).pulseFrame, index,
            `帧边界 t=${edge.toFixed(6)}s 应已进入第 ${index} 帧，实际 ${fx(edge).pulseFrame}`);
    }
    // 一道波 = 帧数 × 帧宽（需求 §六：5 × 0.1s）。
    assert.ok(Math.abs(HEX_PULSE_WAVE_SECONDS - HEX_PULSE_FRAME_COUNT * HEX_PULSE_FRAME_SECONDS) < 1e-9,
        `一道波必须等于 帧数 × 帧宽，实际 ${HEX_PULSE_WAVE_SECONDS}`);
    // 帧宽落在需求给的微调区间内（0.08~0.12s；10fps = 0.1）。
    assert.ok(HEX_PULSE_FRAME_SECONDS >= 0.08 && HEX_PULSE_FRAME_SECONDS <= 0.12,
        `帧宽必须落在 0.08~0.12s（美术按 10fps 出的图），实际 ${HEX_PULSE_FRAME_SECONDS}`);

    // 走完就退场，且**不回到第 0 帧**（回去就是「循环」而不是「点击反馈播一次」）。
    assert.equal(fx(HEX_PULSE_WAVE_SECONDS).pulseFrame, HEX_PULSE_FRAME_HIDDEN, '波走完必须退场');
    assert.equal(fx(HEX_PULSE_WAVE_SECONDS * 3).pulseFrame, HEX_PULSE_FRAME_HIDDEN,
        '段内剩下的时间里不许再把波放出来（一次性，不是循环）');

    // 全程：格根缩放恒 1、不产出圆环、帧号只允许单调不增地走到退场。
    let lastFrame = 0;
    for (let seconds = 0; seconds < ZC_HEX_PULSE_SECONDS; seconds += 0.01) {
        const sample = fx(seconds);
        assert.equal(sample.tileScale, 1,
            `脉冲曲线不许缩格根（t=${seconds.toFixed(3)}s 得到 ${sample.tileScale}）—— 收小由缩没段负责`);
        assert.equal(sample.glowRadius, 0, '脉冲段不画圆环');
        const frame = sample.pulseFrame;
        assert.ok(frame === HEX_PULSE_FRAME_HIDDEN || frame >= lastFrame,
            `帧号只能往前走（t=${seconds.toFixed(3)}s 得到 ${frame}，上一拍 ${lastFrame}）`);
        if (frame !== HEX_PULSE_FRAME_HIDDEN) lastFrame = frame;
    }
});

/**
 * 🔴 口径（2026-10-15 row13「脉冲 ∥ 缩没 同步播放」+ 2026-10-19「换 5 帧美术」）：
 * 点击动画段长 **0.7s 不变** —— 它决定卡牌什么时候弹、首批兵什么时候站上来，是时间轴的锚；
 * 换美术只换「段里那道波」（0.5s / 5 帧 / 10fps），不改段长。
 * ⇒ 卡牌段 1.156s 接在 0.7s 后，总长仍是 **1.856s**。
 */
test('hexActivationFx：点击动画段长恒 0.7s（波 0.5s 装在里面），总长仍是 1.856s', () => {
    assert.ok(Math.abs(ZC_HEX_PULSE_SECONDS - 0.7) < 1e-9,
        `点击动画段长必须保持 0.7s（卡牌的锚），实际 ${ZC_HEX_PULSE_SECONDS}`);
    assert.ok(HEX_PULSE_WAVE_SECONDS < ZC_HEX_PULSE_SECONDS,
        `波（${HEX_PULSE_WAVE_SECONDS}s）比段短 ⇒ 段尾那截只剩缩没，不许把段改短`);
    // 🔴 row13「同步播放」：缩没跨度必须跟着**段长**走（不是跟波走）—— 否则会长出「格子没了、波还在扩」的空窗。
    assert.equal(ZC_HEX_SHRINK_SECONDS, ZC_HEX_PULSE_SECONDS, '缩没与脉冲段同起同收');
    assert.equal(ZC_CARD_START_SECONDS, ZC_HEX_PULSE_SECONDS, '卡牌在点击动画结束那一刻接棒');
    assert.ok(Math.abs(ZC_HEX_ACTIVATION_SECONDS - 1.856) <= 1e-9,
        `需求口径：卡牌淡出结束 = 点击动画 0.7 + 卡牌 1.156 = 1.856s，实际 ${ZC_HEX_ACTIVATION_SECONDS}`);
});

test('hexActivationFx：点击动画（脉冲 ∥ 缩没）收干净后才换「卡牌轴」进入整格隐藏段', () => {
    const { load } = loadViews();
    const fx = load('./ZCHexView').hexActivationFx as (progress: number) => any;
    // 点击动画中段：脉冲还在扩、缩没也收了一半 ⇒ 整格**可见且已明显缩小**（绝不隐藏）。
    const mid = fx(atClick(ZC_HEX_PULSE_SECONDS * 0.5));
    assert.equal(mid.hidden, false, '点击动画全程看得见格子，不能提前隐藏');
    assert.equal(mid.tileLift, 0, '点击动画零位移（不抬起）');
    assert.equal(mid.tileFlip, 1, '点击动画不压扁（只缩）');
    assert.ok(mid.tileScale < 1 && mid.tileScale > HEX_SHRINK_MIN_SCALE,
        `点击动画中段缩放应落在 (${HEX_SHRINK_MIN_SCALE}, 1)，实际 ${mid.tileScale}`);
    assert.equal(mid.buildingPopScale, 0, '点击动画里建筑还没换上来');
    // 点击动画末拍（卡牌起点前一刻）：脉冲与缩没同起同收 ⇒ 已收到 `HEX_SHRINK_MIN_SCALE`，但仍可见。
    const beforeCard = fx(atCard(0) - 1e-9);
    assert.equal(beforeCard.hidden, false, '点击动画末拍还不隐藏，隐藏要等卡牌段');
    assert.equal(beforeCard.tileLift, 0, '点击动画零位移');
    assert.ok(Math.abs(beforeCard.tileScale - HEX_SHRINK_MIN_SCALE) < 0.02,
        `段末应已收到 ${HEX_SHRINK_MIN_SCALE}（缩没与脉冲同时收干净），实际 ${beforeCard.tileScale}`);
    // 卡牌轴刚起（= 点击动画结束那一刻）：整格隐藏 —— 卡牌就是从这一刻起弹的。
    const hiddenAtCard = fx(atCardBoundary(0));
    assert.equal(hiddenAtCard.hidden, true);
    assert.equal(hiddenAtCard.tileLift, 0);
    assert.equal(hiddenAtCard.tileScale, 1);
    // 卡牌轴中段仍在隐藏（`atCard` 把卡牌进度换算回激活轴）。
    const hidden = fx(atCard(0.3));
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.tileLift, 0);
    assert.equal(hidden.tileFlip, 1);
    assert.equal(hidden.buildingPopScale, 0, '卡牌独占视线那段建筑也还没长出来');
    assert.equal(hidden.glowRadius, 0);
});

/**
 * 🔴 回归（2026-10-14，三段口径下同样成立）：**没有卡牌接棒时不能进「整格隐藏」段**。
 *
 * 隐藏段是给卡牌独占视线用的；抽空（问号格 `empty` 0.7，七成撞上）或抽到不能落的卡时
 * 没有卡牌 ⇒ 那段就是纯空窗：格子凭空消失、直接露出棋盘底
 * （山猫截图：「中间地块是空的，看到了背景图」）⇒ 无卡时缩没播完**直接回常规定格**。
 * ⚠️ 但**缩没段本身照播**（用户口径「脉冲 + 缩没两段都要」）—— 有卡没卡都要先把点了的那格收掉。
 */
test('hexActivationFx：没有卡牌时点击动画播完直接回常规定格，绝不进隐藏段', () => {
    const { load } = loadViews();
    const mod = load('./ZCHexView');
    const fx = mod.hexActivationFx as (progress: number, hasCardReveal?: boolean) => any;

    // 点击动画中段：仍然可见（脉冲 ∥ 缩没都在跑），建筑未长出。
    const mid = fx(atClick(HEX_PULSE_WAVE_SECONDS / 2), false);
    assert.equal(mid.hidden, false);
    assert.ok(mid.tileScale < 1, '无卡时点击动画照样要缩（两段都要）');
    assert.equal(mid.buildingPopScale, 0, '点击动画里建筑还没长出来');

    // 点击动画播完那一拍起：常规定格，之后全程可见（卡牌轴整段都不许隐藏）。
    assertIdleFx(fx(atCardBoundary(0), false));
    for (const card of [0, 0.1, 0.3, 0.5, ZC_CARD_FADE_START_PROGRESS, 0.99, 1]) {
        assert.equal(fx(atCard(card), false).hidden, false,
            `无卡时卡牌进度 ${card} 不许隐藏整格`);
    }
});

test('hexActivationFx：卡牌淡出时地块回场、建筑同拍由小变大（初始 0.15）', () => {
    const { load } = loadViews();
    const fx = load('./ZCHexView').hexActivationFx as (progress: number) => any;

    // 卡牌开始淡出之前：整格仍然隐藏（卡牌独占视线）。
    assert.equal(fx(atCard(ZC_CARD_FADE_START_PROGRESS - 0.01)).hidden, true);

    // 卡牌开始淡出那一刻：地块**原尺寸回场**、建筑起手 0.15（与淡出同拍，不是等卡牌消失）。
    const back = fx(atCardBoundary(ZC_CARD_FADE_START_PROGRESS));
    assert.equal(back.hidden, false);
    assert.equal(back.tileScale, 1, '回场即原尺寸，不缩着等');
    assert.equal(back.tileFlip, 1);
    assert.ok(Math.abs(back.buildingPopScale - BUILDING_POP_FROM_SCALE) < 1e-5,
        `建筑应从 ${BUILDING_POP_FROM_SCALE} 起步（由小变大），实际 ${back.buildingPopScale}`);
    // 🔴 2026-10-15：光圈圆环已删 ⇒ 卡牌段靠 `buildingPopScale` 说话，不再有「光圈起点 20」。
    assert.equal(back.pulsePhase, undefined, '回场那一刻波纹已经退场（脉冲段只有前面那一道）');

    // 建筑生长段正中（卡牌淡出窗内）：过冲到峰值 1.2（节奏与卡牌生成一致）。
    // ⚠️ 这里的秒数是**从卡牌起点**起算的，而 `atCard` 只收卡牌进度 ⇒ 先换算一下。
    const atCardSeconds = (afterCardSeconds: number): number => atCard(afterCardSeconds / ZC_CARD_REVEAL_SECONDS);
    const fadeStartSeconds = ZC_CARD_REVEAL_SECONDS * ZC_CARD_FADE_START_PROGRESS;
    const mid = fx(atCardSeconds(fadeStartSeconds + ZC_HEX_BUILDING_SECONDS / 2));
    assert.ok(Math.abs(mid.buildingPopScale - POP_PEAK_SCALE) < 1e-9,
        `建筑生成也要过冲到 ${POP_PEAK_SCALE}，实际 ${mid.buildingPopScale}`);
    assert.equal(mid.pulsePhase, undefined, '建筑生长段不该再有波纹相位');

    // 建筑长完（卡牌还在淡出的余量里）：常规定格、光效归零。
    // ⚠️ 这条同时钉住「末帧必须收口成 idle」：按秒反推会留 1e-16 尾差，
    // 裸 `>=` 会让 `progress` 恰好 clamp 到 1 的那一帧停在半路上。
    assertIdleFx(fx(atCardSeconds(fadeStartSeconds + ZC_HEX_BUILDING_SECONDS)));
});

test('hexActivationFx：跑完全程恢复正常渲染，光效归零', () => {
    const { load } = loadViews();
    const fx = load('./ZCHexView').hexActivationFx as (progress: number) => any;
    // 卡牌淡出尾段（还没消失）：地块已回场，建筑也已经长齐（buildingPopScale 1）。
    assert.equal(fx(atCard(0.99)).buildingPopScale, 1);
    // 超时（progress > 1）按 clamp 到 1 处理：常规定格。
    assertIdleFx(fx(1.5));
    assertIdleFx(fx(2));
});

// ── 视图实例：把 fx 真正写到地块节点上（位置 / 缩放），并能在事件结束后复位 ────

test('renderActivation：点击动画位置恒在布局原位、只有缩放在收；事件过期即复位', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    // 地块节点位置由渲染层在建视图时落好（这里模拟 (300, 500)）。
    view.node.setPosition(300, 500, 0);
    // `applyBuildingScale` 每帧都会写建筑节点，给它一个桩免得走空引用。
    view.buildingSprite = { node: new FakeNode() };
    const activation = { id: 1, hexId: 7, startedAt: 10, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    // 点击动画中段：位置完全不动（不抬起），只有缩放在收（脉冲 ∥ 缩没两条曲线的乘积）。
    view.renderActivation(activation, 10 + HEX_PULSE_WAVE_SECONDS / 2);
    assert.equal(view.node.position.y, 500, '点击动画不抬起，y 必须留在布局位置');
    assert.equal(view.node.position.x, 300, '点击动画也不动 x');
    assert.ok(view.node.scale.x < 1 && view.node.scale.x > HEX_SHRINK_MIN_SCALE,
        `中段缩放应落在 (${HEX_SHRINK_MIN_SCALE}, 1)，实际 ${view.node.scale.x}`);
    assert.equal(view.node.scale.x, view.node.scale.y, '整格缩放必须等比（写在格根上）');
    assert.equal(view.node.scale.z, 1);

    // 点击动画起拍：原尺寸（两条曲线都还没走）。
    view.renderActivation(activation, 10);
    assert.ok(Math.abs(view.node.scale.x - 1) < 1e-6, `起拍应回到 1，实际 ${view.node.scale.x}`);
    assert.ok(Math.abs(view.node.scale.y - 1) < 1e-6);

    // 事件从队列过期后（渲染层不再找到它）→ 复位回布局原位、原尺寸。
    view.renderActivation(null, 10 + 5);
    assert.equal(view.node.position.y, 500);
    assert.equal(view.node.scale.x, 1);
    assert.equal(view.node.scale.y, 1);
});

// ── 轴心：点击动画必须「原地」进行（位置零位移），格根只有缩没在收 ─────────────

test('点击动画在原地进行：位置全程钉在布局原位，格根缩放随缩没单调收下去', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.node.setPosition(0, 0, 0);
    const activation = { id: 1, hexId: 3, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    const at = (seconds: number): { y: number; scale: number } => {
        view.renderActivation(activation, seconds);
        return { y: view.node.position.y, scale: view.node.scale.x };
    };

    // 点击动画段内取多点（2026-10-15 row13 起脉冲 ∥ 缩没并发，同起同收，共 0.7s）：
    // 位置必须**完全一致**（原地，不抬起）；格根缩放只剩缩没那一份（row16 起脉冲不再缩格）
    // ⇒ 单调收下去、绝不超过 1。
    let previous = Infinity;
    for (const ratio of [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.699, 0.999]) {
        const sample = at(ZC_HEX_PULSE_SECONDS * ratio);
        assert.equal(sample.y, 0, `t=${ratio}×段长 不位移（y 必须钉在布局原位）`);
        assert.ok(sample.scale <= 1 + 1e-9 && sample.scale > HEX_SHRINK_MIN_SCALE,
            `格根缩放必须落在 (${HEX_SHRINK_MIN_SCALE}, 1]，实际 ${sample.scale}`);
        assert.ok(sample.scale <= previous + 1e-9,
            `点击动画内格根缩放必须单调不增（t = 段长的 ${ratio} 倍），实际 ${sample.scale} > ${previous}`);
        previous = sample.scale;
    }
    // 起拍 = 原尺寸；段末 = 缩没走完，收到 `HEX_SHRINK_MIN_SCALE`。
    assert.equal(at(0).scale, 1);
    assert.ok(Math.abs(at(ZC_HEX_PULSE_SECONDS * 0.999).scale - HEX_SHRINK_MIN_SCALE) < 0.02,
        `点击动画末拍应收到 ${HEX_SHRINK_MIN_SCALE}，实际 ${at(ZC_HEX_PULSE_SECONDS * 0.999).scale}`);

    // 复位要精确回到布局基准与原始尺寸。
    view.renderActivation(null, 99);
    assert.equal(view.node.position.y, 0);
    assert.equal(view.node.scale.x, 1);
});

// ── 对局不再压扁：整场都不挂 hex-flip 的透视材质（挂着会永久退出合批） ──────────

test('对局全程不挂翻转材质：底图 customMaterial 恒为 null，视图也没有 setFlipEffect 入口', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.node.setPosition(300, 500, 0);
    const tileSprite: any = { node: new FakeNode(), enabled: true, spriteFrame: null, color: null, customMaterial: null };
    view.tileSprite = tileSprite;
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    const moments = [
        0,
        HEX_PULSE_WAVE_SECONDS / 2,
        ZC_HEX_PULSE_SECONDS * 0.999,
        ZC_HEX_PULSE_SECONDS + ZC_CARD_REVEAL_SECONDS,
        ZC_HEX_ACTIVATION_SECONDS,
    ];
    for (const seconds of moments) {
        view.renderActivation(activation, seconds);
        assert.equal(tileSprite.customMaterial, null,
            `t=${seconds}s 时不该挂翻转材质（挂着这一格就永久退出静态合批）`);
    }
    view.renderActivation(null, 99);
    assert.equal(tileSprite.customMaterial, null);
    // 对局既然不再压扁，视图侧就不该再留注入入口（领地地图自带一份）。
    assert.equal((view as unknown as { setFlipEffect?: unknown }).setFlipEffect, undefined,
        'ZCHexView 不该再有 setFlipEffect：对局没有压扁路径了');
    // 底图又回到内置材质 ⇒ 这一格能继续参与合批。
    assert.equal(view.node.scale.x, 1);
    assert.equal(view.node.scale.y, 1);
});

// ── 地面光斑：抬起时点亮并钉在原格，复位即熄灭 + 摘材质 ───────────────────────

test('GroundGlow 在底图之上绘制，开口边的半透明光不会被底图遮住', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8')) as
        Array<{ __type__?: string; _name?: string; _children?: Array<{ __id__: number }> }>;
    const root = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'ZCGameHex');
    const children = root?._children?.map(({ __id__ }) => prefab[__id__]._name);
    assert.ok(children, 'ZCGameHex 根节点应声明子节点');
    assert.ok(children.indexOf('GroundGlow') > children.indexOf('TileBackground'),
        '贴边光必须画在底图前墙之上');
    // 🔴 2026-10-15：脉冲水波纹复用这同一个节点 ⇒ 它必须正好落在「中间层」：
    // 在底图（覆素材 / 底色）之上、在 `BuildingLayer`（类型图标）之下。
    assert.ok(children.indexOf('GroundGlow') < children.indexOf('BuildingLayer'),
        '中间层必须排在类型图标之下（否则波纹会盖住兵营 / 金矿图标）');
});

test('底部发光改用序列帧：不再加载 hex-ground-glow.effect，视图也不再写它的 uniform', () => {
    // ⚠️ 先剥注释（rule 104）：注释里会写「已由 xx 换成序列帧」，那是文档不是接线。
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(loader, /shaders\/hex-ground-glow/,
        'shader 方案已由 image/effects/hex_ground_glow 的序列帧取代，别再把它加载回来');
    assert.match(loader, /HEX_GROUND_GLOW_ART_ROOT/, '加载器应经 ArtPaths 的唯一真源取序列帧目录');
    // 目录真源在 ArtPaths（对局与领地共用同一份，两边都不许自己拼路径）。
    const artPaths = readFileSync('assets/script/app/ArtPaths.ts', 'utf8');
    assert.match(artPaths, /HEX_GROUND_GLOW_ART_ROOT = `\$\{ART_ROOT\}\/effects\/hex_ground_glow`/,
        '序列帧目录的真源应在 ArtPaths');
    const view = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // ⚠️ 别把 glowStrength 算进来：翻转材质（hex-flip）也有同名的开口补光参数。
    for (const uniform of ['glowCenter', 'glowWorldScale', 'glowRadius', 'tilePerspective']) {
        assert.ok(!view.includes(`'${uniform}'`), `视图侧不该再写地面光的 shader 参数 ${uniform}`);
    }
    assert.match(view, /setGroundGlowFrames/, '视图应提供序列帧的注入入口');
});

/**
 * ⚠️ 2026-10-16 口径变更：用户拍板领地翻格**只保留「原地快碎裂」**那套 ⇒ `hex-flip.effect` 里
 * 服务另一套（翻整圈）的顶点 3D 旋转 / 透视除法 / 体积明暗 / 侧视淡出 / 正面开口补光已全部
 * 删除，补光用的 `rim`（贴图轮廓亮边）随之消失。这条不变量本身还在，只是换了落点：
 * **按贴图原始 alpha 算透明度** —— 阵营染色的 alpha 约 0.6，用它会把半透明的整张格子
 * 误判成亮边 / 把亮度溢出到格形之外。现在的现役落点是碎裂的裂缝。
 */
test('碎裂裂缝的透明度按贴图轮廓给，不能用阵营染色的 alpha（否则整张格子都亮）', () => {
    const effect = readFileSync('assets/resources/shaders/hex-flip.effect', 'utf8');
    assert.match(effect, /result\.a = min\(1\.0, result\.a \+ seam \* texel\.a \* 0\.6\);/,
        '裂缝要乘 texel.a（贴图原始 alpha）；用 color.a 会把格外的透明区一起提亮');
    // 顶点 3D 段已删，`vEdge`（转轴亮带）不该被写回来 —— 它会在格子正面形成整条横向白纹。
    assert.doesNotMatch(effect, /exp\(-abs\(vEdge\)/,
        '转轴亮带会在格子正面形成整条横向白纹');
});

/**
 * 🔴 口径（2026-10-15）：脉冲段**不抬起、不缩没**（`tileLift = 0`、最低缩到 0.92），
 * 而 `hexFlipGroundGlowStrength` 只随抬升量亮起 ⇒ 只有「底部开口光」这条老路径才永不亮起。
 *
 * ⚠️ 同一个中间层节点在脉冲段会被**水波纹序列帧**接管（`applyPulseRipple`），
 * 那条路径的 cases 在上面「脉冲水波纹」那组里；本用例只验「没注入波纹帧时老路径不误亮」。
 * 抬升那条路径只剩领地翻格在用。
 */
test('底部发光：脉冲段全程熄灭（不抬起 ⇒ 光带永不点亮），复位路径不受影响', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.node.setPosition(300, 500, 0);
    const glowNode = new FakeNode('GroundGlow');
    glowNode.active = false;
    const glowSprite: any = {
        node: glowNode, enabled: true, spriteFrame: null,
        color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null,
    };
    view.groundGlow = glowSprite;
    // 8 帧、自带淡入淡出（末帧全透明）；序列帧注入入口保持可用（领地共用同一套参数真源）。
    const frames = Array.from({ length: 8 }, (_, index) => ({ name: `hex_ground_glow_0${index + 1}` }));
    view.setGroundGlowFrames(frames);
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    // 点击动画段（脉冲 ∥ 缩没，同起同收）取多点（含呼吸峰值）：整段都不抬起 ⇒ 底部光必须全程熄灭。
    const moments = [0, HEX_PULSE_WAVE_SECONDS * 0.25, HEX_PULSE_WAVE_SECONDS / 2,
        HEX_PULSE_WAVE_SECONDS * 0.75, ZC_HEX_PULSE_SECONDS * 0.999];
    for (const seconds of moments) {
        view.renderActivation(activation, seconds);
        assert.equal(glowNode.active, false, `t=${seconds}s 不抬起，底部光不许点亮`);
    }

    // 复位路径：熄灭 + 位置归零（池化复用不留上一格的状态）。
    view.renderActivation(null, 99);
    assert.equal(glowNode.active, false, '复位后底部光必须熄灭');
    assert.equal(glowNode.position.y, 24);

    // 没拿到序列帧时整块关掉（注入入口还在，防御路径不回退）。
    view.setGroundGlowFrames([]);
    view.renderActivation(activation, HEX_PULSE_WAVE_SECONDS / 2);
    assert.equal(glowNode.active, false, '没拿到序列帧时整块关掉，不能露出一张半截的图');
});

// ── 脉冲段的序列帧（2026-10-19 换 5 帧美术）：中间层换帧 + 按类型染色 + 一次性播完退场 ──

/** 脉冲美术图里「本体六边形」的像素宽高（美术口径 §三），用来算「摊到格面上」的对齐缩放。 */
const PULSE_ART_BODY_WIDTH = 164;
const PULSE_ART_BODY_HEIGHT = 142;
/** 脉冲画布边长（5 帧都是 320×320）。 */
const PULSE_CANVAS = 320;

test('脉冲序列帧：按 pulseFrame 选帧、播完退场，没帧时降级为只剩缩没（不报错、不残留）', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.node.setPosition(300, 500, 0);
    // 中间层节点 = prefab 里的 `GroundGlow`（抬升开口光与它互斥，见 `applyPulseRipple`）。
    const rippleNode = new FakeNode('GroundGlow');
    rippleNode.active = false;
    const rippleSprite: any = {
        node: rippleNode, enabled: true, spriteFrame: null,
        color: { r: 255, g: 255, b: 255, a: 255 },
    };
    view.groundGlow = rippleSprite;
    // 美术帧 `hex_pulse_0..4`，loader 已按文件名排好序。
    const frames = Array.from({ length: HEX_PULSE_FRAME_COUNT }, (_, index) => ({ name: `hex_pulse_${index}` }));
    view.setHexPulseFrames(frames);
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    view.renderActivation(activation, 0);
    assert.equal(rippleNode.active, true, '脉冲段必须点亮中间层');
    assert.equal(rippleSprite.spriteFrame, frames[0], '第 0 拍 = 第一帧');

    // 逐拍推进：帧号严格跟着 10fps 走（0/0.1/0.2/0.3/0.4 各一张），且全程只有**一张**在显示。
    for (let index = 0; index < HEX_PULSE_FRAME_COUNT; index += 1) {
        view.renderActivation(activation, (index + 0.5) * HEX_PULSE_FRAME_SECONDS);
        assert.equal(rippleSprite.spriteFrame, frames[index],
            `t=${((index + 0.5) * HEX_PULSE_FRAME_SECONDS).toFixed(2)}s 应显示第 ${index} 帧`);
        assert.equal(rippleNode.active, true, '波还在播时中间层必须亮着');
    }

    // 波落点钉在**可见台面中心**：写 0 会整道偏到格底（台面中心不在格节点原点）。
    // 🔴 波挂在**格根**上、而格根正被缩没收小 ⇒ 局部 y 要按格根缩放**反补**，
    // 世界落点才恒等于台面中心（判据用「局部 y × 格根缩放」而不是裸的局部 y）。
    assert.ok(Math.abs(rippleNode.position.y * view.node.scale.x - ZC_LAND_TOP_CENTER_LIFT) < 1e-6,
        `波的落点必须钉在台面中心，实际 ${rippleNode.position.y * view.node.scale.x}`);

    // 🔴 对齐缩放：把图上 164×142 的本体摊成格面 123×90，x / y 分开算（本项目格面比正六边形扁）。
    // 判据取「有效缩放（局部 × 格根）」—— 这样即使缩没在收，读出来的仍是图到格面的固定换算。
    const effectiveX = (): number => rippleNode.scale.x * view.node.scale.x;
    const effectiveY = (): number => rippleNode.scale.y * view.node.scale.y;
    assert.ok(Math.abs(effectiveX() - 123 / PULSE_ART_BODY_WIDTH) < 1e-6,
        `x 向必须把 164px 的本体摊成格面宽 123，实际 ${effectiveX()}`);
    assert.ok(Math.abs(effectiveY() - 90 / PULSE_ART_BODY_HEIGHT) < 1e-6,
        `y 向必须把 142px 的本体摊成格面高 90，实际 ${effectiveY()}`);
    // 需求 §七.7：节点上不额外叠 scale 动画 ⇒ 5 帧全程同一个缩放（图里已经放大了）。
    const sx = effectiveX();
    const sy = effectiveY();
    view.renderActivation(activation, HEX_PULSE_WAVE_SECONDS * 0.7);
    assert.ok(Math.abs(effectiveX() - sx) < 1e-6 && Math.abs(effectiveY() - sy) < 1e-6,
        '对齐缩放必须恒定，不许随帧再放大一次（放大了两遍）');

    // 节点 contentSize 按整张 320 画布给：只给格面尺寸会把波挤扁。
    assert.equal(rippleNode.size.width, PULSE_CANVAS, '脉冲层画布宽 = 320');
    assert.equal(rippleNode.size.height, PULSE_CANVAS, '脉冲层画布高 = 320');

    // 🔴 波走完（0.5s）就退场：中间层关掉，但**格子还在缩**（缩没要到 0.7s 才收干净）。
    view.renderActivation(activation, HEX_PULSE_WAVE_SECONDS);
    assert.equal(rippleNode.active, false, '波走完必须直接消失（不举着末帧当静止波）');
    assert.ok(view.node.scale.x < 1, `缩没与脉冲并发 ⇒ 此刻整格已在缩，实际 ${view.node.scale.x}`);

    // 点击动画播完 → 卡牌段：整格隐藏，脉冲层保持关；离开脉冲段后尺寸 / 缩放归位。
    view.groundGlowBaseSize = { width: 130, height: 239 };
    view.renderActivation(activation, ZC_CARD_START_SECONDS + 0.01);
    assert.equal(rippleNode.active, false, '卡牌段脉冲层保持关闭');
    assert.equal(rippleNode.scale.x, 1, '离开脉冲段缩放必须归 1（池化复用不留残影）');
    assert.equal(rippleNode.scale.y, 1);
    assert.equal(rippleNode.size.width, 130, '离开脉冲段 contentSize 要写回开口光的画布');
    assert.equal(rippleNode.size.height, 239);
    assert.equal(view.node.active, false, '点击动画结束即切卡牌段：整格隐藏');

    // 没拿到帧：中间层不显示，但缩没照旧（降级不能把整段带走）。
    view.setHexPulseFrames([]);
    view.renderActivation(activation, HEX_PULSE_WAVE_SECONDS / 2);
    assert.equal(rippleNode.active, false, '没帧时中间层熄灭');
    assert.ok(view.node.scale.x < 1, '没帧也要继续缩没');

    // 事件过期：中间层交还给「抬升开口光」那条老路径（熄灭 + 落点回到开口基准 24）。
    view.renderActivation(null, 99);
    assert.equal(rippleNode.active, false);
    assert.equal(rippleNode.position.y, 24);
});

test('脉冲按卡牌品阶染色：1 绿 / 2 蓝 / 3 紫 / 4 金，没抽到卡（0）也走绿', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const tintFor = mod.pulseTintForRarity as (rarity: number) => any;
    const green = tintFor(1);
    const blue = tintFor(2);
    const purple = tintFor(3);
    const gold = tintFor(4);
    // 四档必须**两两可分**（否则「按品阶染色」等于没做）。
    const colors = [green, blue, purple, gold].map((c) => `${c.r},${c.g},${c.b}`);
    assert.equal(new Set(colors).size, 4, `四档颜色必须互不相同，实际 ${colors.join(' | ')}`);
    // 色相方向逐个钉：绿要 G 最大、蓝要 B 最大、紫要 R/B 大于 G、金要 R 最大且 G 次之。
    assert.ok(green.g > green.r && green.g > green.b, `1 档要走绿，实际 ${JSON.stringify(green)}`);
    assert.ok(blue.b > blue.r && blue.b > blue.g, `2 档要走蓝，实际 ${JSON.stringify(blue)}`);
    assert.ok(purple.b > purple.g && purple.r > purple.g, `3 档要走紫，实际 ${JSON.stringify(purple)}`);
    assert.ok(gold.r > gold.g && gold.g > gold.b, `4 档要走金，实际 ${JSON.stringify(gold)}`);
    // 🔴 用户口径「没有获得卡牌 - 绿色」：0 档与 1 档**同色**（不是另给一套灰）。
    assert.equal(tintFor(0), green, '没抽到卡必须落绿，且与 1 档是同一份色');
    // 防御：非数字 / 越界都落绿，不许把 Sprite 染成 NaN 黑。
    assert.equal(tintFor(Number.NaN), green, 'NaN 落绿');
    assert.equal(tintFor(99), green, '越界落绿');

    // 真正写到 Sprite 上：品阶色必须**压过** `renderActivation` 里先写的阵营色。
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    const node = new FakeNode('GroundGlow');
    const sprite: any = { node, enabled: true, spriteFrame: null, color: { r: 255, g: 255, b: 255, a: 255 } };
    view.groundGlow = sprite;
    // 注入满 5 帧：`pulseFrame` 越界会被当成「波已退场」，只给 1 帧的话半轮就查不到第 2 帧了。
    view.setHexPulseFrames(Array.from({ length: HEX_PULSE_FRAME_COUNT }, (_, index) => ({ name: `hex_pulse_${index}` })));
    const base = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS, hasCardReveal: true };
    view.renderActivation({ ...base, cardRarity: 4 }, HEX_PULSE_WAVE_SECONDS / 2, 'player');
    assert.deepEqual([sprite.color.r, sprite.color.g, sprite.color.b], [gold.r, gold.g, gold.b],
        '脉冲 Sprite 必须按**抽到的卡牌品阶**上色，而不是被阵营 tint 覆写');
    // 换个品阶再点一次：颜色要跟着变（缓存不许把它粘住）。
    view.renderActivation({ ...base, cardRarity: 2, id: 2 }, HEX_PULSE_WAVE_SECONDS / 2, 'player');
    assert.deepEqual([sprite.color.r, sprite.color.g, sprite.color.b], [blue.r, blue.g, blue.b],
        '同一格换品阶必须换色');
    // 没抽到卡（0 / 字段缺省）⇒ 绿。
    view.renderActivation(base, HEX_PULSE_WAVE_SECONDS / 2, 'player');
    assert.deepEqual([sprite.color.r, sprite.color.g, sprite.color.b], [green.r, green.g, green.b],
        '没有 cardRarity 的激活事件按「没抽到卡」走绿');
});

test('脉冲段不再画 Graphics 圆环（圆圈影响视觉），改走中间层序列帧', () => {
    // ⚠️ 先剥注释（rule 104）：注释里会写「圆环已删」，那是文档不是代码。
    const strip = (path: string): string => readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const view = strip('assets/script/app/zcds/view/ZCHexView.ts');
    assert.doesNotMatch(view, /glow\.circle\(/, '格心那个圆圆的圈圈必须删掉');
    assert.doesNotMatch(view, /ensureActivationGlow/, '不再为画圆环往格根上挂 Graphics 组件');
    // 取代它的是序列帧：注入入口 / 选帧 / 染色三步都得在。
    assert.match(view, /setHexPulseFrames/, '视图应提供水波纹序列帧的注入入口');
    assert.match(view, /applyPulseRipple/, '要有按相位播波纹的出口');
    assert.match(view, /pulseTintForRarity/, '要有按卡牌品阶染色的出口');
    // 加载器 → ArtPaths 真源 → 渲染层注入，三步都得接通。
    const loader = strip('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /HEX_FLIP_PULSE_ART_ROOT/, '序列帧目录必须走 ArtPaths 的唯一真源');
    assert.match(readFileSync('assets/script/app/ArtPaths.ts', 'utf8'),
        /HEX_FLIP_PULSE_ART_ROOT = `\$\{ART_ROOT\}\/effects\/hex_pulse_seq`/);
    assert.match(strip('assets/script/app/zcds/view/ZCGameRenderWorld.ts'),
        /setHexPulseFrames\(this\.options\.hexPulseFrames/, '渲染层要真的把帧喂给每个地块视图');
});

// ── 旧脉冲着色器已退役：新美术把虚化烘焙进图，不许再把 `hex-pulse.effect` 接回来 ──────

test('旧脉冲着色器退役：视图不再有材质入口，加载器也不再加载 hex-pulse.effect', () => {
    const stripJs = (path: string): string => readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const view = stripJs('assets/script/app/zcds/view/ZCHexView.ts');
    // 2026-10-19：5 帧新美术自带「放大 + 淡出」，再叠一层径向虚化就是虚两次。
    assert.doesNotMatch(view, /setHexPulseMaterial/, '视图不许再有脉冲材质入口');
    assert.doesNotMatch(view, /applyPulseMaterial|applyPulseFade|ensurePulseMaterial/,
        '脉冲材质那条链（挂材质 / 写 pulseFade uniform / 克隆）应整条删除');
    // 视图侧只剩「换帧」这一件事。
    assert.match(view, /sprite\.spriteFrame = next/, '脉冲段只换 SpriteFrame，不写 scale / opacity 动画');

    const loader = stripJs('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.doesNotMatch(loader, /HEX_PULSE_EFFECT_URL|loadHexPulseMaterial/,
        '加载器不该再加载 hex-pulse.effect（旧 30 帧那套专用）');
    assert.doesNotMatch(stripJs('assets/script/app/zcds/ZCGame.ts'), /hexPulseMaterial/,
        'ZCGame 不该再透传脉冲材质');
    assert.doesNotMatch(stripJs('assets/script/app/zcds/view/ZCGameRenderWorld.ts'), /hexPulseMaterial/,
        '渲染层不该再注入脉冲材质');
});

// ── 层级：脉冲段不抬起 ⇒ 不置顶、不换父（置顶机制只服务 tileLift > 0 的路径） ────

test('脉冲段不置顶：地块始终留在 HexLayer 原索引，事件过期后照常渲染', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const board = new FakeNode('ZCGameBoard');
    const hexLayer = new FakeNode('HexLayer');
    hexLayer.setParent(board);
    // 模拟 HexLayer 之上还有几层（轮廓 / 装饰 / 建筑）。
    const overlays = ['OutlineLayer', 'DecorLayer', 'BuildingOverlay'].map((name) => {
        const node = new FakeNode(name);
        node.setParent(board);
        return node;
    });

    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    const sibling = new FakeNode('Hex_other');
    sibling.setParent(hexLayer);
    hexLayer.addChild(view.node); // view.node 在 HexLayer 里的索引 = 1
    view.setActivationLayer(board);
    view.node.setPosition(300, 500, 0);

    const activation = { id: 1, hexId: 7, startedAt: 10, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };
    // 点击动画段（脉冲 ∥ 缩没）内取多点：两段都不抬起 ⇒ 全程留在 HexLayer 原位
    // （置顶只随 tileLift > 0 触发）。
    const moments = [
        10,
        10 + HEX_PULSE_WAVE_SECONDS / 2,
        10 + HEX_PULSE_WAVE_SECONDS * 0.75,
        10 + ZC_HEX_PULSE_SECONDS * 0.999,
    ];
    for (const now of moments) {
        view.renderActivation(activation, now);
        assert.equal(view.node.parent, hexLayer, `t=${now} 点击动画（脉冲 ∥ 缩没）不换父`);
        assert.equal(view.node.getSiblingIndex(), 1, '点击动画不动画家排序');
        assert.equal(view.node.position.y, 500, '点击动画不抬升');
        assert.equal(view.node.position.x, 300, '换父不改局部坐标的机制不因点击动画失效');
    }
    // overlays 全程排在 HexLayer 之后（层级没有被激活表现搅动：点击动画既不换父也不置顶）。
    assert.ok(overlays.every((node) => board.children.indexOf(hexLayer) < board.children.indexOf(node)));

    // 事件过期：照常渲染、归位。
    view.renderActivation(null, 10 + 5);
    assert.equal(view.node.parent, hexLayer);
    assert.equal(view.node.getSiblingIndex(), 1, '归位要回到原索引');
});

// ── 接线：翻面必须每帧推进，不能挂在 0.15s 的静态刷新上 ───────────────────────

test('接线：地块激活表现挂在 renderDynamic（每帧），并保留静态兜底复位', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    // ⚠️ 签名跟着渲染层走过一次重构（`model` → `frame, events`）：这里按**当前**签名定位，
    // 别再钉旧形参名 —— 钉旧名会让这条断言在「接线还在」时也永远红着。
    const start = source.indexOf('renderDynamic(frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {');
    assert.ok(start > 0, 'renderDynamic 必须存在');
    // ⚠️ 先剥注释再匹配：把调用注释掉（`// this.renderHexActivations(frame);`）照样含这个串，
    // 不剥的话这条接线断言会在「接线被删」时静默通过（rule 104）。
    const body = source.slice(start, source.indexOf('\n    }', start))
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
    assert.ok(body.includes('renderHexActivations(frame)'), 'renderDynamic 必须每帧推进地块激活表现');
    // 静态刷新那条兜底仍在（激活事件过期后 ≤0.15s 内把地块复位）。
    assert.ok(source.includes('activation: hex.activation'),
        '静态刷新要按当前快照喂激活事件（过期后兜底复位）');
});

test('ground glow takes the active faction tint before the throttled terrain refresh', () => {
    const { load, FakeNode } = loadViews();
    const { ZCHexView } = load('./ZCHexView');
    const view = new ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.groundGlow = {
        node: new FakeNode('GroundGlow'), enabled: true,
        spriteFrame: null, color: { r: 255, g: 255, b: 255, a: 235 }, customMaterial: null,
    };
    view.setGroundGlowFrames([{ name: 'hex_ground_glow_01' }]);
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };
    // 脉冲段内（染色与抬升解耦：renderActivation 在脉冲段也必须先把归属色写上）。
    const now = HEX_PULSE_WAVE_SECONDS * 0.25;

    view.renderActivation(activation, now, 'player');
    assert.deepEqual(
        [view.groundGlow.color.r, view.groundGlow.color.g, view.groundGlow.color.b],
        [126, 130, 255],
    );
    view.renderActivation(activation, now + 0.01, 'enemy');
    assert.deepEqual(
        [view.groundGlow.color.r, view.groundGlow.color.g, view.groundGlow.color.b],
        [251, 73, 105],
    );

    const renderWorld = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    assert.match(renderWorld, /renderActivation\(activation, now, owner\)/);
});

// ── 销毁期：onDestroy 里不碰子节点的 Sprite（引擎销毁序 = 先子后父组件） ────

test('onDestroy 不写子节点 Sprite 的材质（引擎销毁序 = 先子后父组件）', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const node = new FakeNode('ZCGameHex');
    // `groundGlow` 挂在**子节点** `GroundGlow` 上（见 `ZCGameHex.prefab`），
    // 引擎销毁序「先子节点组件 → 再本节点组件」⇒ 本视图的 `onDestroy` 跑到时那个 Sprite 已销毁完。
    // 桩上用 setter 计数复现：子节点的 Sprite 已被引擎销毁后再写 `customMaterial` 就是引擎崩点。
    const glowNode = new FakeNode('GroundGlow');
    glowNode.setParent(node);
    let writes = 0;
    const view: any = new mod.ZCHexView();
    view.node = node;
    view.groundGlow = {
        get customMaterial() { return null; },
        set customMaterial(_value: unknown) { writes += 1; },
    };
    view.onDestroy();

    assert.equal(writes, 0,
        'onDestroy 不得写 groundGlow.customMaterial —— 那是子节点的 Sprite，引擎已先销毁它，'
        + '再写会进 setSharedMaterial 读已释放的渲染状态抛 "Cannot read properties of null"');
});

test('销毁期禁令钉在源码上：onDestroy 里不出现对 groundGlow 的任何写入', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
    const start = source.indexOf('onDestroy(): void {');
    assert.ok(start >= 0, 'ZCHexView 里找不到 onDestroy');
    // 🔴 必须**剥注释**（规则 104 的同款坑）：`onDestroy` 的注释里会写
    // `this.groundGlow.customMaterial = null` 来解释「为什么不能这么写」，
    // 不剥的话这段解释本身就把断言判红 —— 修完代码反而永远红着。
    const body = source.slice(start, source.indexOf('\n    }\n', start))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(body, /groundGlow\s*\.\s*customMaterial\s*=/,
        'onDestroy 里不许写 groundGlow.customMaterial（规则 176 同族：销毁期不碰其它组件）');
    assert.doesNotMatch(body, /groundGlow\s*\.\s*\w+\s*\(/,
        'onDestroy 里不许调 groundGlow 的任何方法');
    // 2026-10-19 起脉冲段没有克隆材质了（只换帧），这里不再要求 `pulseMaterial.destroy()`；
    // 但「不碰子节点」这条禁令一直有效。
    assert.doesNotMatch(body, /Material/,
        'onDestroy 不该再碰任何材质（脉冲材质那条链已退役）');
});
