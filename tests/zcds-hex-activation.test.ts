// 收场表现的共用参数真源（core 无 cc，用例可直连）；以前是从 ZCHexView 的别名读的。
import {
    HEX_PULSE_CYCLE_SECONDS,
    HEX_PULSE_MAX_SCALE,
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

test('hexActivationFx：点击动画段「波纹向外扩散 ∥ 原地缩没」——相位随秒线性走、格根缩放单调收下去，不抬起、不再有圆环', () => {
    const mod = loadViews().load('./ZCHexView');
    const fx = mod.hexActivationFx as (progress: number) => any;
    // 周期与终值是观感调参 ⇒ 从模块读，不把数值钉死在断言里。
    assert.ok(HEX_PULSE_CYCLE_SECONDS > 0 && HEX_PULSE_CYCLE_SECONDS <= ZC_HEX_PULSE_SECONDS,
        '点击动画段至少要装得下一道波纹（口径已定成「只播一次」⇒ 正好等于）');
    // 🔴 row16：「脉冲效果从缩小改成向外扩散消失，最大扩散 1.25 个单位格子大小」⇒ 峰值必须**往外扩**
    // （> 1）。哪天有人把它改回「比 1 小的下探收缩」，这条立刻红。
    assert.ok(HEX_PULSE_MAX_SCALE > 1 && HEX_PULSE_MAX_SCALE <= 1.5,
        `扩散峰值必须是往外扩的倍数，实际 ${HEX_PULSE_MAX_SCALE}`);
    // 负进度（= 无激活 / 未开始 / 已过期）：常规定格，建筑可见。
    assertIdleFx(fx(-1));
    // 起拍相位 0：波纹从头开始（帧号 0）—— 原位、原尺寸、不虚化，建筑还没长出来。
    const start = fx(0);
    assert.equal(start.hidden, false);
    assert.equal(start.tileLift, 0, '点击动画不抬起');
    assert.equal(start.tileFlip, 1);
    assert.equal(start.tileScale, 1);
    assert.equal(start.buildingPopScale, 0, '刚起拍建筑还没长出来');
    assert.equal(start.pulsePhase, 0, '起拍相位 0 = 序列帧第一张');
    assert.equal(start.pulseScale, 1, '🔴 起拍还没扩散：波纹就是原尺寸（= 1 个格子大小）');
    assert.equal(start.pulseFade, 0, '🔴 起拍外缘还不虚化');
    // 🔴 山猫「中间有个圆圆的圈圈影响视觉」（2026-10-15）：脉冲段**不许再产出圆环**。
    assert.equal(start.glowRadius, 0, '脉冲段不再有 glow 圆环');
    assert.equal(start.glowAlpha, 0);

    // 周期中点：波纹已扩出去、外缘开始虚化；位置不动。
    const peak = fx(atClick(HEX_PULSE_CYCLE_SECONDS / 2));
    assert.equal(peak.tileLift, 0, '点击动画全程不抬起');
    assert.equal(peak.hidden, false);
    assert.ok(Math.abs(peak.pulsePhase - 0.5) < 1e-6, `周期中点相位应为 0.5，实际 ${peak.pulsePhase}`);
    // 🔴 格根的缩放**只剩缩没那一份**（脉冲不再缩格）：半轮时 = `shrinkScaleAt(0.5)`。
    assert.ok(peak.tileScale < 1 && peak.tileScale > HEX_SHRINK_MIN_SCALE,
        `点击动画段整格的收小只由缩没负责，应落在 (${HEX_SHRINK_MIN_SCALE}, 1)，实际 ${peak.tileScale}`);
    assert.ok(peak.pulseScale > 1, `🔴 半轮时波纹应已向外扩散，实际 ${peak.pulseScale}`);
    assert.ok(peak.pulseFade > 0, `🔴 半轮时外缘应已开始虚化，实际 ${peak.pulseFade}`);

    // 位置恒等于布局原位（不抬起 = y 不动），相位线性跟秒走。
    const a = fx(atClick(HEX_PULSE_CYCLE_SECONDS * 0.3));
    const b = fx(atClick(HEX_PULSE_CYCLE_SECONDS * 0.7));
    assert.equal(a.tileLift, 0);
    assert.equal(b.tileLift, 0);
    assert.ok(Math.abs(a.pulsePhase - 0.3) < 1e-6, `相位必须线性跟秒走，实际 ${a.pulsePhase}`);
    assert.ok(Math.abs(b.pulsePhase - 0.7) < 1e-6, `相位必须线性跟秒走，实际 ${b.pulsePhase}`);

    // 🔴 「同步播放」的判据：整段**格根**缩放**单调收下去**。若哪天退回串行（先脉冲、再缩没），
    // 这条会红：那时前半段的 `tileScale` 会停在 1 不动（缩没还没起）。
    let previous = Infinity;
    for (const ratio of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999]) {
        const scale = fx(atClick(ZC_HEX_PULSE_SECONDS * ratio)).tileScale;
        assert.ok(scale <= previous + 1e-9,
            `点击动画内缩放必须单调不增（t = 段长的 ${ratio} 倍），实际 ${scale} > ${previous}`);
        previous = scale;
    }

    // 🔴 扩散判据（row16）：`pulseScale` 与 `pulseFade` **都单调增**（1 → 1.25、0 → 1）。
    // 这两项写的是**波纹层**，格根的 `tileScale` 一根手指都不许碰 —— 脉冲一旦回退成「缩格根」，
    // 上面那条单调性就会跟着变形。
    let lastScale = -Infinity;
    let lastFade = -Infinity;
    for (const ratio of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999]) {
        const sample = fx(atClick(ZC_HEX_PULSE_SECONDS * ratio));
        assert.ok(sample.pulseScale >= lastScale - 1e-9,
            `波纹扩散必须单调不缩（t = 段长的 ${ratio} 倍），实际 ${sample.pulseScale} < ${lastScale}`);
        assert.ok(sample.pulseFade >= lastFade - 1e-9,
            `外缘虚化必须单调加深（t = 段长的 ${ratio} 倍），实际 ${sample.pulseFade} < ${lastFade}`);
        lastScale = sample.pulseScale;
        lastFade = sample.pulseFade;
    }

    // 段末：缩没走完了 ⇒ 整格收到 `HEX_SHRINK_MIN_SCALE`（两段同起同收的落点），波纹扩散到峰值、
    // 外缘最虚；但**仍是可见的** —— 进入隐藏段要等卡牌段（见下一条用例）。
    const end = fx(atClick(ZC_HEX_PULSE_SECONDS * 0.999));
    assert.equal(end.hidden, false, '段末还不隐藏，隐藏要等卡牌段');
    assert.ok(end.pulsePhase > 0.9, `段末相位应逼近 1（播到最后一帧），实际 ${end.pulsePhase}`);
    assert.ok(Math.abs(end.tileScale - HEX_SHRINK_MIN_SCALE) < 0.02,
        `段末应已收到 ${HEX_SHRINK_MIN_SCALE}（缩没与脉冲同时收干净），实际 ${end.tileScale}`);
    assert.ok(Math.abs(end.pulseScale - HEX_PULSE_MAX_SCALE) < 0.01,
        `段末波纹应扩到峰值 ${HEX_PULSE_MAX_SCALE}，实际 ${end.pulseScale}`);
    assert.ok(end.pulseFade > 0.99, `段末外缘应最虚，实际 ${end.pulseFade}`);
});

/**
 * 「只播一次」下**段内不再有周期边界**（原来 2 道波时 `t = 周期` 会回绕到下一道）。
 *
 * 相位回绕本身仍是 `hexPulseFx` 的固有行为（给「以后要几道波」留的），
 * 所以在**曲线层**钉一条：整数周期处相位回到 0（扩散与虚化也跟着回到起点）。
 *
 * 🔴 同时钉死 row16 的核心改动：**脉冲曲线一根手指都不许碰格根**（`tileScale` 恒 1）——
 * 整格的收小归缩没段，需求「其他阶段的动画保持不变」就落在这一条上。
 */
test('hexPulseFx：相位按周期回绕（整数周期 = 相位 0、扩散回到原尺寸），且永不写格根缩放', () => {
    const fx = hexPulseFx as (seconds: number) => any;
    assert.ok(Math.abs(fx(0).pulsePhase) < 1e-9, '起点相位 0');
    const boundary = fx(HEX_PULSE_CYCLE_SECONDS);
    assert.ok(boundary.pulsePhase < 1e-6 || boundary.pulsePhase > 1 - 1e-6,
        `整数周期处相位必须回绕，实际 ${boundary.pulsePhase}`);
    assert.ok(Math.abs(boundary.pulseScale - 1) < 1e-6, `整数周期处扩散回到原尺寸，实际 ${boundary.pulseScale}`);
    assert.ok(Math.abs(boundary.pulseFade) < 1e-6, `整数周期处外缘回到不虚化，实际 ${boundary.pulseFade}`);
    // 相位在 [0,1) 之间扫一遍（含周期回绕的前后），格根缩放必须恒 1。
    for (let seconds = 0; seconds < HEX_PULSE_CYCLE_SECONDS * 2; seconds += 0.013) {
        const sample = fx(seconds);
        assert.equal(sample.tileScale, 1,
            `脉冲曲线不许缩格根（t=${seconds.toFixed(3)}s 得到 ${sample.tileScale}）—— 收小由缩没段负责`);
        assert.ok(sample.pulseScale >= 1 && sample.pulseScale <= HEX_PULSE_MAX_SCALE + 1e-9,
            `扩散倍率必须落在 [1, ${HEX_PULSE_MAX_SCALE}]，实际 ${sample.pulseScale}`);
        assert.ok(sample.pulseFade >= 0 && sample.pulseFade <= 1,
            `虚化强度必须落在 [0,1]，实际 ${sample.pulseFade}`);
    }
});

/**
 * 🔴 口径（2026-10-15 v3「播放改成一次」+ v4「脉冲 + 缩没两段都要」+ row13「两段同步播放」）：
 * 点击动画 = **恰好 1 道完整的波纹**（`HEX_PULSE_CYCLE_SECONDS` = 0.7s / 30 帧 ≈ 43fps）
 * **同时**把整格原地缩没，两者同起同收 ⇒ 点击动画就是 0.7s；之后接卡牌段 1.156s，
 * 总长 = **1.856s**。
 * 卡牌 / 首批兵都锚在 `ZC_CARD_START_SECONDS`（= 点击动画结束）上 ⇒ 改「几道波 / 多快」
 * 只动 `HEX_PULSE_CYCLE_SECONDS`（段长与缩没跨度都跟着它）。
 */
test('hexActivationFx：点击动画 = 1 个波纹周期（只播一次），且比旧的 1s 周期更快', () => {
    assert.ok(HEX_PULSE_CYCLE_SECONDS < 1, `山猫要「稍微加快」，周期必须短于旧的 1s，实际 ${HEX_PULSE_CYCLE_SECONDS}`);
    assert.equal(ZC_HEX_PULSE_SECONDS, HEX_PULSE_CYCLE_SECONDS,
        '🔴 山猫口径「播放改成一次」：点击动画 = 1 道波纹，不多不少');
    // 🔴 row13「同步播放」：缩没跨度必须跟着脉冲走 —— 收得比波快会长出「格子没了、波还在扩」的空窗。
    assert.equal(ZC_HEX_SHRINK_SECONDS, ZC_HEX_PULSE_SECONDS, '缩没与脉冲同起同收');
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
    const mid = fx(atClick(HEX_PULSE_CYCLE_SECONDS / 2), false);
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
    view.renderActivation(activation, 10 + HEX_PULSE_CYCLE_SECONDS / 2);
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
        HEX_PULSE_CYCLE_SECONDS / 2,
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
    const moments = [0, HEX_PULSE_CYCLE_SECONDS * 0.25, HEX_PULSE_CYCLE_SECONDS / 2,
        HEX_PULSE_CYCLE_SECONDS * 0.75, ZC_HEX_PULSE_SECONDS * 0.999];
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
    view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS / 2);
    assert.equal(glowNode.active, false, '没拿到序列帧时整块关掉，不能露出一张半截的图');
});

// ── 脉冲段的水波纹（2026-10-15 v2 / row16）：中间层播序列帧 + 按类型染色 + 向外扩散虚化 ──

test('脉冲水波纹：注入序列帧后按相位选帧，没帧时降级为只剩缩没（不报错、不残留）', () => {
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
    // 美术帧 `fkz_00..29`， loader 已按文件名排好序。
    const frames = Array.from({ length: 30 }, (_, index) => ({ name: `fkz_${String(index).padStart(2, '0')}` }));
    view.setHexPulseFrames(frames);
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    view.renderActivation(activation, 0);
    assert.equal(rippleNode.active, true, '脉冲段必须点亮中间层');
    assert.equal(rippleSprite.spriteFrame, frames[0], '相位 0 = 第一帧');
    // 一轮下来帧号**单调推进**并走遍首尾：30 帧也正是这么被播完的。
    const indices: number[] = [0, 0.25, 0.5, 0.75, 0.999].map((ratio) => {
        view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS * ratio);
        return frames.indexOf(rippleSprite.spriteFrame);
    });
    assert.ok(indices.every((index, i) => i === 0 || index >= indices[i - 1]),
        `帧号必须随相位单调推进，实际 ${indices.join(',')}`);
    // ⚠️ 「周期 → 秒 → 相位」两步反推会留 ~1e-15 尾差（0.5 那拍算出来可能是 0.49999…），
    // 帧号又走 floor ⇒ 允许比「正中」少一帧，别用裸相等（rule 244：假红先怀疑判据）。
    assert.ok(Math.abs(indices[2] - Math.floor(frames.length / 2)) <= 1,
        `半轮应落在正中那一帧 ±1 内，实际 ${indices[2]}`);
    assert.equal(indices[4], frames.length - 1, '相位逼近 1 = 最后一帧');
    // 波纹落点钉在**可见台面中心**：写 0 会整道偏到格底（台面中心不在格节点原点）。
    // 🔴 row16：波纹挂在**格根**上、而格根正被缩没收小 ⇒ 局部 y 要按格根缩放**反补**，
    // 世界落点才恒等于台面中心（判据用「局部 y × 格根缩放」而不是裸的局部 y）。
    assert.ok(Math.abs(rippleNode.position.y * view.node.scale.x - ZC_LAND_TOP_CENTER_LIFT) < 1e-6,
        `波纹世界落点必须钉在台面中心，实际 ${rippleNode.position.y * view.node.scale.x}`);

    // 🔴 2026-10-15 v3/v4 + row13：点击动画 = **1 道波 ∥ 原地缩没**（同起同收）⇒ 段内没有周期边界
    // 可回绕，段末那一拍播的是最后一帧；波纹与缩没一起收干净，之后才进卡牌段的整格隐藏。
    view.renderActivation(activation, ZC_HEX_PULSE_SECONDS * 0.5);
    assert.equal(rippleNode.active, true, '点击动画段内波纹全程在播（与缩没并发）');
    assert.ok(view.node.scale.x < 1, `缩没与脉冲并发 ⇒ 中段整格已在缩，实际 ${view.node.scale.x}`);
    view.renderActivation(activation, ZC_HEX_PULSE_SECONDS * 0.999);
    assert.equal(rippleSprite.spriteFrame, frames[frames.length - 1], '段末播到最后一帧');
    // 点击动画播完 → 卡牌段：波纹退场 + 整格隐藏（缩没已把格子收干净）。
    view.renderActivation(activation, ZC_CARD_START_SECONDS + 0.01);
    assert.equal(rippleNode.active, false, '卡牌段波纹退场（只有点击动画那一道波）');
    assert.equal(rippleNode.scale.x, 1, '离开脉冲段波纹层缩放必须归 1（池化复用不留残影）');
    assert.equal(view.node.active, false, '点击动画结束即切卡牌段：整格隐藏');

    // 没拿到帧：波纹不显示，但缩没照旧（降级不能把整段带走）。
    view.setHexPulseFrames([]);
    view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS / 2);
    assert.equal(rippleNode.active, false, '没帧时中间层熄灭');
    assert.ok(view.node.scale.x < 1, '没帧也要继续缩没');

    // 事件过期：中间层交还给「抬升开口光」那条老路径（熄灭 + 落点回到开口基准 24）。
    view.renderActivation(null, 99);
    assert.equal(rippleNode.active, false);
    assert.equal(rippleNode.position.y, 24);
});

/**
 * 🔴 row16 需求：「脉冲效果从缩小改成向外扩散消失，最大扩散 1.25 个单位格子大小，扩散的部分虚化，
 * 其他阶段的动画保持不变」。
 *
 * 这一组钉的是**波纹层**（`GroundGlow`）的三件事：
 *  1. **向外扩散**：节点缩放 = `pulseScale / 格根缩放` ⇒ **有效**倍率（×格根缩放）恒等于
 *     `pulseScale`（1 → `HEX_PULSE_MAX_SCALE`）。不抵消父缩放的话，波纹会跟着缩没一起缩 ——
 *     那正是需求要改掉的「缩小」。
 *  2. **外缘虚化**：强度写进脉冲专用材质的 `pulseFade` uniform（径向遮罩在着色器里）。
 *  3. **不打扰其他阶段**：离开脉冲段后波纹层缩放归 1（对象池复用不留残影）。
 */
test('脉冲水波纹向外扩散：波纹层有效倍率 1 → 1.25 格（抵消缩没）、外缘虚化随扩散加深', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    view.node.setPosition(300, 500, 0);
    const rippleNode = new FakeNode('GroundGlow');
    rippleNode.active = false;
    const rippleSprite: any = {
        node: rippleNode, enabled: true, spriteFrame: null,
        color: { r: 255, g: 255, b: 255, a: 255 }, customMaterial: null,
    };
    view.groundGlow = rippleSprite;
    view.setHexPulseFrames(Array.from({ length: 30 }, (_, index) => ({ name: `fkz_${index}` })));
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };

    /** 波纹层**有效**倍率（= 局部缩放 × 格根缩放）：需求说的「多少个格子大小」就是这个量。 */
    const effectiveScale = (): number => rippleNode.scale.x * view.node.scale.x;

    view.renderActivation(activation, 0);
    assert.ok(Math.abs(effectiveScale() - 1) < 1e-6,
        `起拍波纹应是原尺寸（1 个格子大小），实际 ${effectiveScale()}`);

    // 逐拍推进：有效倍率单调增、段末抵达 `HEX_PULSE_MAX_SCALE`；同时格根本身在收（缩没照走）。
    let previous = 0;
    for (const ratio of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
        view.renderActivation(activation, ZC_HEX_PULSE_SECONDS * ratio);
        const effective = effectiveScale();
        assert.ok(effective >= previous - 1e-9,
            `波纹必须**向外**扩（t=${ratio}×段长），实际 ${effective} < ${previous}`);
        assert.ok(effective >= 1 - 1e-9 && effective <= HEX_PULSE_MAX_SCALE + 1e-9,
            `有效倍率必须落在 [1, ${HEX_PULSE_MAX_SCALE}]，实际 ${effective}`);
        previous = effective;
    }
    assert.ok(Math.abs(effectiveScale() - HEX_PULSE_MAX_SCALE) < 0.01,
        `段末波纹应扩到 ${HEX_PULSE_MAX_SCALE} 个格子大小，实际 ${effectiveScale()}`);
    // 🔴 「其他阶段的动画保持不变」：格根此刻仍由缩没收到 `HEX_SHRINK_MIN_SCALE`。
    assert.ok(Math.abs(view.node.scale.x - HEX_SHRINK_MIN_SCALE) < 0.02,
        `缩没不受影响（段末仍收到 ${HEX_SHRINK_MIN_SCALE}），实际 ${view.node.scale.x}`);

    // 离开脉冲段（卡牌段 / 复位）：波纹层缩放必须回到 1。
    view.renderActivation(activation, ZC_CARD_START_SECONDS + 0.01);
    assert.equal(rippleNode.scale.x, 1, '卡牌段波纹层缩放归 1');
    assert.equal(rippleNode.scale.y, 1);
    view.renderActivation(null, 99);
    assert.equal(rippleNode.scale.x, 1, '复位后波纹层缩放仍归 1（池化复用不留残影）');
});

test('脉冲外缘虚化：强度每帧写进脉冲材质的 pulseFade，各格独占一份材质不互相覆盖', () => {
    const { load, FakeNode, cc } = loadViews();
    const mod = load('./ZCHexView');
    const effect = { name: 'hex-pulse' };

    const makeView = () => {
        const view = new mod.ZCHexView();
        view.buildingSprite = { node: new FakeNode() };
        view.node.setPosition(300, 500, 0);
        const node = new FakeNode('GroundGlow');
        node.active = false;
        const sprite: any = {
            node, enabled: true, spriteFrame: null,
            color: { r: 255, g: 255, b: 255, a: 255 }, customMaterial: null,
        };
        view.groundGlow = sprite;
        view.setHexPulseFrames([{ name: 'fkz_00' }]);
        // 原型材质（渲染层注入的那一份）；`effectAsset` 由桩的 `initialize` 记下来。
        const prototype = new cc.Material();
        prototype.initialize({ effectAsset: effect });
        view.setHexPulseMaterial(prototype);
        return { view, sprite, prototype };
    };

    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };
    const a = makeView();
    const b = makeView();
    /** 当前写进材质的虚化强度（未挂材质 ⇒ NaN）。 */
    const fadeOf = (target: { sprite: any }): number =>
        target.sprite.customMaterial?.properties.get('pulseFade')?.x ?? Number.NaN;

    // 起拍：虚化强度 0。
    a.view.renderActivation(activation, 0);
    assert.equal(fadeOf(a), 0, '起拍不虚化');
    // 走到半轮：强度应等于相位（0.5）。
    a.view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS / 2);
    assert.ok(Math.abs(fadeOf(a) - 0.5) < 1e-3, `虚化强度应随相位推进（半轮 ≈ 0.5），实际 ${fadeOf(a)}`);

    // 🔴 各格**独占**一份材质：两个视图写各自的强度，谁也不许盖掉谁。
    assert.notEqual(a.sprite.customMaterial, b.sprite.customMaterial,
        '每格必须克隆一份脉冲材质 —— 共用一份时 `pulseFade` 会被后写的那格盖掉');
    assert.notEqual(a.sprite.customMaterial, a.prototype, '原型只作样式来源，不直接挂上去');
    b.view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS * 0.25);
    assert.ok(Math.abs(fadeOf(a) - 0.5) < 1e-3, 'b 格写自己的强度不该动到 a 格');
    assert.ok(Math.abs(fadeOf(b) - 0.25) < 1e-3, `b 格应写自己的相位强度，实际 ${fadeOf(b)}`);

    // 离开脉冲段（复位回常规定格）必须摘掉材质：非脉冲段这个节点装的是开口光序列帧。
    a.view.renderActivation(null, 99);
    assert.equal(a.sprite.customMaterial, null, '离开脉冲段要摘掉脉冲材质');

    // 视图销毁时必须释放这份克隆材质（`new Material()` 不归资源管理器管，漏了就是显存泄漏）。
    const owned = b.sprite.customMaterial;
    assert.ok(owned, 'b 格此刻应挂着自己那份脉冲材质');
    b.view.onDestroy();
    assert.equal(owned.isValid, false, '销毁视图要释放它独占的脉冲材质');
});

test('脉冲专用着色器的外缘虚化：径向遮罩 + 原图半尺寸与美术图一致', () => {
    // ⚠️ 先剥注释（rule 104）：GLSL 注释里也会写出同样的算式，不剥的话「算式被删」时断言静默通过。
    const strip = (text: string): string => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    const effectSource = readFileSync('assets/resources/shaders/hex-pulse.effect', 'utf8');
    const effect = strip(effectSource);

    // 径向遮罩：半径必须由**顶点局部坐标**算（SpriteFrame 被裁过，UV 不覆盖原图）。
    assert.match(effect, /out vec2 localPos;/, '顶点着色器要传出局部坐标（半径的唯一可靠来源）');
    assert.match(effect, /localPos = a_position\.xy;/, '局部坐标必须从 a_position 取（不是 a_texCoord）');
    assert.match(effect, /float radius = length\(localPos \/ halfSize\);/,
        '半径必须按原图半尺寸归一化（0 = 中心，1 = 原图边缘）');
    assert.match(effect, /float edge = smoothstep\(clamp\(pulseShape\.x, 0\.0, 1\.0\), 1\.0, radius\);/,
        '虚化必须是「起始半径之外才生效」的径向遮罩，中心保持较实');
    assert.match(effect, /float alpha = tex\.a \* \(1\.0 - clamp\(pulseFade\.x, 0\.0, 1\.0\) \* edge\);/,
        '虚化强度必须按 pulseFade.x 乘进 alpha（视图每帧写它）');
    // 既有口径不许被这轮改动带跑（填充恒等映射 + 回退开关）。
    assert.match(effect, /float k = mix\(clamp\(pulseParams\.x, 0\.0, 1\.0\), 1\.0, lum\);/);
    assert.match(effectSource, /pulseParams: \{ value: \[0\.72, 0, 0, 0\] \}/);

    // 🔴 `pulseShape.yz` 是**美术图的原始半尺寸**，写错会让整个虚化圈缩放错位 ⇒ 与 PNG 实测对齐。
    const shape = /pulseShape: \{ value: \[([^\]]+)\] \}/.exec(effectSource);
    assert.ok(shape, 'effect 必须声明 pulseShape（虚化起始半径 + 原图半尺寸）');
    const [startRadius, halfWidth, halfHeight] = shape![1].split(',').map((value) => Number(value));
    assert.ok(startRadius > 0 && startRadius < 1, `虚化起始半径必须落在 (0,1)，实际 ${startRadius}`);
    const header = readFileSync('assets/resources/image/effects/hex_pulse/fkz_00.png').subarray(16, 24);
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    assert.ok(Math.abs(halfWidth - width / 2) < 1,
        `pulseShape.y 必须等于 fkz_*.png 的半宽（${width / 2}），实际 ${halfWidth}`);
    assert.ok(Math.abs(halfHeight - height / 2) < 1,
        `pulseShape.z 必须等于 fkz_*.png 的半高（${height / 2}），实际 ${halfHeight}`);
});

test('脉冲水波纹按地块类型染色：兵营蓝紫 / 金矿绿，两者同 alpha 平级', () => {
    const { load, FakeNode } = loadViews();
    const mod = load('./ZCHexView');
    const tintFor = mod.pulseTintForTileType as (type: number) => any;
    const barracks = tintFor(ZCPvpTileType.BarracksCommon);
    const mine = tintFor(ZCPvpTileType.Mine);
    assert.notDeepEqual([barracks.r, barracks.g, barracks.b], [mine.r, mine.g, mine.b],
        '兵营与金矿必须看得出色相差（否则「按类型染色」等于没做）');
    assert.ok(mine.g > mine.r && mine.g > mine.b, `金矿要走绿，实际 ${JSON.stringify(mine)}`);
    assert.equal(barracks.a, mine.a,
        '🔴 山猫口径「金矿和绿色平级」：两类同一个 alpha，不许把金矿压淡成次级');
    // 三级兵营与没单独配色的类型都落同一套色（与 `frameForTileType` 同口径）。
    assert.equal(tintFor(ZCPvpTileType.BarracksMedium), barracks);
    assert.equal(tintFor(ZCPvpTileType.BarracksAdvanced), barracks);
    assert.equal(tintFor(ZCPvpTileType.AllRandom), barracks);

    // 真正写到 Sprite 上：类型色必须**压过** `renderActivation` 里先写的阵营色。
    const view = new mod.ZCHexView();
    view.buildingSprite = { node: new FakeNode() };
    const node = new FakeNode('GroundGlow');
    const sprite: any = { node, enabled: true, spriteFrame: null, color: { r: 255, g: 255, b: 255, a: 255 } };
    view.groundGlow = sprite;
    view.setHexPulseFrames([{ name: 'fkz_00' }]);
    const activation = { id: 1, hexId: 7, startedAt: 0, durationSeconds: ZC_HEX_ACTIVATION_SECONDS };
    // `pulseTint` 由静态刷新的 `render()` 按 `state.tileType` 写（每帧那条路径没有 state）。
    view.pulseTint = mine;
    view.renderActivation(activation, HEX_PULSE_CYCLE_SECONDS / 2, 'player');
    assert.deepEqual([sprite.color.r, sprite.color.g, sprite.color.b], [mine.r, mine.g, mine.b],
        '波纹 Sprite 必须按地块类型上色，而不是被阵营 tint 覆写');
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
    assert.match(view, /pulseTintForTileType/, '要有按地块类型染色的出口');
    // 加载器 → ArtPaths 真源 → 渲染层注入，三步都得接通。
    const loader = strip('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /HEX_FLIP_PULSE_ART_ROOT/, '序列帧目录必须走 ArtPaths 的唯一真源');
    assert.match(readFileSync('assets/script/app/ArtPaths.ts', 'utf8'),
        /HEX_FLIP_PULSE_ART_ROOT = `\$\{ART_ROOT\}\/effects\/hex_pulse`/);
    assert.match(strip('assets/script/app/zcds/view/ZCGameRenderWorld.ts'),
        /setHexPulseFrames\(this\.options\.hexPulseFrames/, '渲染层要真的把帧喂给每个地块视图');
});

// ── 脉冲专用着色器（row13 第 1 条）：把灰度帧的黑边抬亮，且不碰填充色 ──────────────

test('脉冲黑边靠专用着色器抬亮：保底乘算式 + 材质只挂脉冲分支 + 全链接通', () => {
    // ⚠️ 先剥注释（rule 104）：GLSL 注释里也会写出同样的算式，不剥的话「算式被删」时断言静默通过。
    const stripJs = (path: string): string => readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const effect = readFileSync('assets/resources/shaders/hex-pulse.effect', 'utf8')
        .replace(/\/\/[^\n]*/g, '');
    // 保底乘的判别式：填充（lum = 1）必须是恒等映射，否则「改边缘」会连带改掉本来正常的填充色。
    assert.match(effect, /float lum = clamp\(max\(max\(tex\.r, tex\.g\), tex\.b\), 0\.0, 1\.0\);/,
        '亮度必须取灰度帧的 max 通道（加权和会把纯色边读歪）');
    assert.match(effect, /float k = mix\(clamp\(pulseParams\.x, 0\.0, 1\.0\), 1\.0, lum\);/,
        '保底乘算式不能改：lum = 1 ⇒ k = 1（不碰填充），暗部抬到 pulseParams.x');
    assert.match(effect, /pulseParams: \{ value: \[0\.72, 0, 0, 0\] \}/,
        '默认保底亮度 0.72 要留在 properties 里（= 0 是退回旧观感的开关）');
    assert.doesNotMatch(effect, /exp\(-abs\(/,
        '别退回领地那套「转轴亮带」写法：会在正面形成整条横向白纹');

    // 视图：入口 + **只挂脉冲分支**（GroundGlow 与底光序列帧共用，整段挂着会把底光一起抬亮）。
    const view = stripJs('assets/script/app/zcds/view/ZCHexView.ts');
    assert.match(view, /setHexPulseMaterial/, '视图应提供脉冲材质注入入口');
    assert.match(view, /applyPulseMaterial\(true\)/, '进脉冲分支要挂材质');
    assert.match(view, /applyPulseMaterial\(false\)/, '离开脉冲分支要摘材质');
    assert.match(view, /private pulseMaterialApplied = false;/, '材质状态要有字段去重（每帧都会调）');

    // 加载链：effect 走 assets.load + 运行时 new Material，不新增 *.mtl 文件。
    const loader = stripJs('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /HEX_PULSE_EFFECT_URL = 'shaders\/hex-pulse'/, 'effect 路径真源在加载器常量里');
    assert.match(loader, /loadHexPulseMaterial/, '要有专门的材质构建方法');
    assert.match(loader, /material\.initialize\(\{ effectAsset: effect \}\)/, '材质运行时初始化，不依赖 *.mtl');
    assert.match(stripJs('assets/script/app/zcds/ZCGame.ts'), /hexPulseMaterial: prepared\.hexPulseMaterial/,
        'ZCGame 要把材质从 prepared 透传给渲染层');
    assert.match(stripJs('assets/script/app/zcds/view/ZCGameRenderWorld.ts'),
        /setHexPulseMaterial\(this\.options\.hexPulseMaterial/, '渲染层要真的把材质喂给每个地块视图');
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
        10 + HEX_PULSE_CYCLE_SECONDS / 2,
        10 + HEX_PULSE_CYCLE_SECONDS * 0.75,
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
    const start = source.indexOf('renderDynamic(model: ZCGameModel): void {');
    assert.ok(start > 0, 'renderDynamic 必须存在');
    // ⚠️ 先剥注释再匹配：把调用注释掉（`// this.renderHexActivations(model);`）照样含这个串，
    // 不剥的话这条接线断言会在「接线被删」时静默通过（rule 104）。
    const body = source.slice(start, source.indexOf('\n    }', start))
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
    assert.ok(body.includes('renderHexActivations(model)'), 'renderDynamic 必须每帧推进地块激活表现');
    // 静态刷新那条兜底仍在（激活事件过期后 ≤0.15s 内把地块复位）。
    assert.ok(source.includes('activation: model.activationOf(state.id)'));
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
    const now = HEX_PULSE_CYCLE_SECONDS * 0.25;

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

test('onDestroy 只释放自己克隆的脉冲材质，不去写子节点 Sprite 的材质', () => {
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
    // 挂一份克隆材质（`new Material()` 不归资源管理器管，必须由视图自己 destroy）。
    const clone = { isValid: true, destroy() { clone.isValid = false; } };
    view.pulseMaterial = clone;
    view.pulseMaterialSource = { effectAsset: {} };
    view.pulseMaterialApplied = true;
    view.onDestroy();

    assert.equal(clone.isValid, false, '视图必须释放自己克隆的脉冲材质（否则显存泄漏）');
    assert.equal(view.pulseMaterial, null);
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
    assert.match(body, /this\.pulseMaterial\.destroy\(\)/,
        '克隆材质的释放必须留着（new Material() 不归资源管理器管）');
});
