/**
 * 章节宝箱**开箱时间轴**（`docs/章节地图动画实现规格.md` §3，用户 2026-10-22 确认三档口径）。
 *
 * 判据钉七件事（都是「口径」不是「手感」，所以必须有断言）：
 *  1. 三档时长由**最后一枚奖励落袋**推出来：`totalSeconds = 末枚落袋 + settle + fade`
 *     （弱 2.26s / 中 2.38s / 强 3.23s；2026-10-22 用户「获取奖励后快速消失，
 *     现在停止的时间太长了」—— 老值 3.0/2.6/4.0 在末枚落袋后还留了 0.67/0.30/0.83s 空转）；
 *  2. **禁止项**：弱档无全屏光柱、无彩虹、无暗角、无粒子（规格把这几条列为禁止，不是「暂未实现」）；
 *     弱档**有**轻微推镜（1.06×，2026-10-22 用户要求），但幅度 ≤1.12、且不许出现暗角；
 *  3. **独占项**：光柱只有中档、彩虹只有强档 —— 二者永不共存（否则强档既打柱子又转彩虹，画面糊）；
 *  4. 时序单调性：`pop ≤ charge ≤ lid ≤ flash ≤ fly`，且所有窗口都收在**收尾起点**之前；
 *  5. `SpringPop` 的**峰值恒等于 1.15**（旧实现用 `Back.easeOut` 只冲到 1.02，写死 1.15 冲不到）；
 *  6. 粒子 / 飞行的窗口边界与**确定性**（同 seed 同 index 恒等，不用 `Math.random()`）；
 *  7. **收尾锚点**：淡出起点 = 末枚落袋 + `settleSeconds`，不许再出现「空箱子静置」（本轮新增）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORY_CHEST_FLY_STAGGER,
    TERRITORY_CHEST_OPEN_FRAMES,
    TERRITORY_CHEST_POP_OVERSHOOT,
    TERRITORY_CHEST_SPECS,
    territoryChestBeamAlpha,
    territoryChestBodyFx,
    territoryChestCameraFx,
    territoryChestEndSeconds,
    territoryChestFadeStart,
    territoryChestFlashAlpha,
    territoryChestFlyFx,
    territoryChestFountainFx,
    territoryChestLastRewardAt,
    territoryChestOpenFrame,
    territoryChestRainbowFx,
    territoryChestRayFx,
    territoryChestStarFx,
    territoryChestTailFade,
    type ITerritoryChestSpec,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { TERRITORY_CHEST_TIER, type TerritoryChestTier } from '../assets/script/app/territory/model/TerritoryChestTier';

const WEAK = TERRITORY_CHEST_SPECS[TERRITORY_CHEST_TIER.weak];
const MEDIUM = TERRITORY_CHEST_SPECS[TERRITORY_CHEST_TIER.medium];
const STRONG = TERRITORY_CHEST_SPECS[TERRITORY_CHEST_TIER.strong];
const ALL_SPECS: readonly ITerritoryChestSpec[] = [WEAK, MEDIUM, STRONG];

/** 按 1/120s 采样整段（含收尾一帧）：能抓住「某个窗口漏出区间外」这种边界 bug。 */
function sampleTimes(spec: ITerritoryChestSpec, step = 1 / 120): number[] {
    const out: number[] = [];
    for (let t = 0; t <= spec.totalSeconds + step; t += step) out.push(Number(t.toFixed(4)));
    return out;
}

// ============================================================
// 时长与档位
// ============================================================

test('三档时长：2.26 / 2.38 / 3.23（= 末枚落袋 + settle + fade）', () => {
    assert.equal(WEAK.totalSeconds, 2.26);
    assert.equal(MEDIUM.totalSeconds, 2.38);
    assert.equal(STRONG.totalSeconds, 3.23);
    // 表里的数必须与推导值一致 —— 填歪了就会出现「奖励拿完了、空箱子还在」
    for (const spec of ALL_SPECS) {
        assert.ok(Math.abs(territoryChestEndSeconds(spec) - spec.totalSeconds) < 1e-9,
            `${spec.tier} 表里 ${spec.totalSeconds}s，推导出来 ${territoryChestEndSeconds(spec)}s`);
    }
});

test('三者时长严格递增（弱 < 中 < 强）', () => {
    assert.ok(WEAK.totalSeconds < MEDIUM.totalSeconds || WEAK.totalSeconds < STRONG.totalSeconds);
    assert.ok(MEDIUM.totalSeconds < STRONG.totalSeconds);
});

test('参数表的 tier 字段与键一致（防止复制粘贴改漏）', () => {
    for (const tier of Object.values(TERRITORY_CHEST_TIER)) {
        assert.equal(TERRITORY_CHEST_SPECS[tier as TerritoryChestTier].tier, tier);
    }
});

// ============================================================
// 禁止项 / 独占项
// ============================================================

test('弱档：全程没有光柱（不是透明度 0，而是 null = 视图不画）', () => {
    for (const t of sampleTimes(WEAK)) {
        assert.equal(territoryChestBeamAlpha(WEAK, t), null, `t=${t} 弱档不该有光柱`);
    }
});

test('弱档：全程没有彩虹光束', () => {
    for (const t of sampleTimes(WEAK)) {
        assert.equal(territoryChestRainbowFx(WEAK, t), null, `t=${t} 弱档不该有彩虹`);
    }
});

test('弱档：镜头只做**轻微**推进（≤1.12）且全程无暗角', () => {
    // 2026-10-22 起弱档有轻推镜（用户：「宝箱打开时，增加镜头轻微推进动画效果」），
    // 但仍然禁止全屏压暗 —— 大推镜 + 遮罩是强档的独占项。
    assert.equal(WEAK.vignetteAlpha, 0);
    let peak = 1;
    for (const t of sampleTimes(WEAK)) {
        const fx = territoryChestCameraFx(WEAK, t);
        assert.equal(fx.vignette, 0, `t=${t} 弱档不许压暗`);
        assert.ok(fx.scale >= 1 - 1e-9, `t=${t} 倍率不该小于 1（不许先缩远）`);
        peak = Math.max(peak, fx.scale);
    }
    assert.ok(Math.abs(peak - WEAK.cameraZoom) < 1e-6, `峰值 ${peak} 应等于 cameraZoom ${WEAK.cameraZoom}`);
    assert.ok(peak > 1.02, '弱档必须真的推（否则等于没做）');
    assert.ok(peak <= 1.12, `弱档推 ${peak}× 太狠了 —— "轻微"的上限是 1.12`);
});

test('弱档：没有粒子雨（喷泉 / 星光恒 null）', () => {
    for (const t of sampleTimes(WEAK)) {
        assert.equal(territoryChestFountainFx(WEAK, 7, 0, t), null, `t=${t} 弱档不该有喷泉`);
        assert.equal(territoryChestStarFx(WEAK, 7, 0, t), null, `t=${t} 弱档不该有星光`);
    }
});

test('中档：镜头轻推 1.10× + 无暗角，无彩虹，但有光柱', () => {
    assert.equal(MEDIUM.vignetteAlpha, 0);
    assert.ok(MEDIUM.cameraZoom > 1 && MEDIUM.cameraZoom <= 1.12, `中档镜头 ${MEDIUM.cameraZoom}× 应在 1~1.12`);
    let peak = 1;
    for (const t of sampleTimes(MEDIUM)) {
        const fx = territoryChestCameraFx(MEDIUM, t);
        assert.equal(fx.vignette, 0, `t=${t} 中档不许压暗`);
        peak = Math.max(peak, fx.scale);
        assert.equal(territoryChestRainbowFx(MEDIUM, t), null, `t=${t} 中档不该有彩虹`);
    }
    assert.ok(Math.abs(peak - MEDIUM.cameraZoom) < 1e-6);
    const beams = sampleTimes(MEDIUM).map((t) => territoryChestBeamAlpha(MEDIUM, t)).filter((a) => a !== null);
    assert.ok(beams.length > 0, '中档必须有光柱');
    assert.ok(Math.max(...(beams as number[])) > 0.5, '光柱得真的亮起来');
});

test('三档推镜的时机与幅度：开箱那一瞬开始、收尾拉回 1、起点必须是 1', () => {
    for (const spec of ALL_SPECS) {
        // ① t=0 恒为 1：点下去那一帧必须与地图上静止的宝箱同样大（上一轮刚修过的跳变）
        assert.equal(territoryChestCameraFx(spec, 0).scale, 1, `${spec.tier} 起手必须 1:1`);
        // ② 覆盖到「开盖」：推近窗口在开盖结束前就起步，不能等箱子都开完了才凑近
        assert.ok(spec.cameraInStart <= spec.lidStart + spec.lidSeconds,
            `${spec.tier} 推近起点 ${spec.cameraInStart}s 晚于开盖结束 ${spec.lidStart + spec.lidSeconds}s`);
        // ③ 收尾必须回到 1（否则停播时画面会"跳"一下）
        const end = territoryChestEndSeconds(spec);
        assert.ok(Math.abs(territoryChestCameraFx(spec, end).scale - 1) < 1e-6, `${spec.tier} 结束时应回到 1`);
        // ④ 回拉与淡出同起同落
        assert.ok(Math.abs(spec.cameraOutStart - territoryChestFadeStart(spec)) < 1e-9, `${spec.tier} 回拉应与收尾同起`);
        assert.ok(Math.abs(spec.cameraOutStart + spec.cameraOutSeconds - end) < 1e-9, `${spec.tier} 回拉应与淡出同落`);
        // ⑤ 峰值恰好等于参数（缓动不该把幅度吃掉，也不该超过去）
        let peak = 0;
        for (const t of sampleTimes(spec, 1 / 240)) peak = Math.max(peak, territoryChestCameraFx(spec, t).scale);
        assert.ok(Math.abs(peak - spec.cameraZoom) < 1e-3, `${spec.tier} 峰值 ${peak} 应等于 ${spec.cameraZoom}`);
        // ⑥ 单调：推上去、再落回来，中间不该抖
        let previous = 0;
        let rising = true;
        for (const t of sampleTimes(spec, 1 / 240)) {
            const scale = territoryChestCameraFx(spec, t).scale;
            if (rising && scale + 1e-9 < previous) rising = false;
            if (!rising) assert.ok(scale <= previous + 1e-3, `${spec.tier} t=${t} 回拉阶段又推上去了`);
            previous = scale;
        }
    }
});

test('推镜只作用在「镜头层」，飞向栏位的图标不跟着放大', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 倍率乘在 Stage 上（Chest/Fly 的父子关系决定：Fly 是 Root 的孩子、Stage 是兄弟）
    assert.match(body, /this\.stage\.setScale\(fx\.scale/, '镜头倍率必须写在 Stage 上');
    assert.doesNotMatch(body, /this\.node\.setScale\(fx\.scale/, '整页根节点不许缩放（会把飞出的图标一起放大）');
    assert.doesNotMatch(body, /this\.chest\.setScale\(fx\.scale, fx\.scale, 1\);\s*\/\/ camera/i, '宝箱自己不该再乘镜头');
});

test('强档：镜头推近 2.3x + 暗角，但**没有直光柱**', () => {
    for (const t of sampleTimes(STRONG)) {
        assert.equal(territoryChestBeamAlpha(STRONG, t), null, `t=${t} 强档改用彩虹，不该有直光柱`);
    }
    assert.equal(territoryChestCameraFx(STRONG, 1.0).scale, STRONG.cameraZoom);
    assert.ok(Math.abs(territoryChestCameraFx(STRONG, 1.0).vignette - STRONG.vignetteAlpha) < 1e-9);
});

test('强档：彩虹在窗口内出现、窗口外消失、且不越过总时长', () => {
    assert.equal(territoryChestRainbowFx(STRONG, 0.5), null);
    assert.ok(territoryChestRainbowFx(STRONG, 1.5) !== null);
    // 彩虹一直转到**收尾起点**（与镜头回拉同一条线），不是转到总时长
    assert.ok(territoryChestRainbowFx(STRONG, STRONG.rainbowEnd - 0.1) !== null);
    assert.equal(territoryChestRainbowFx(STRONG, STRONG.totalSeconds), null);
    assert.ok(STRONG.rainbowEnd <= STRONG.totalSeconds);
});

test('光柱与彩虹互斥：任一时长下不会同时在画', () => {
    for (const spec of ALL_SPECS) {
        for (const t of sampleTimes(spec)) {
            const beam = territoryChestBeamAlpha(spec, t);
            const rainbow = territoryChestRainbowFx(spec, t);
            const beamOn = beam !== null && beam > 0;
            const rainbowOn = rainbow !== null && rainbow.alpha > 0;
            assert.ok(!(beamOn && rainbowOn), `${spec.tier} t=${t} 光柱与彩虹不能同时亮`);
        }
    }
});

// ============================================================
// 时序
// ============================================================

test('时序单调性：pop ≤ charge ≤ lid ≤ flash', () => {
    for (const spec of ALL_SPECS) {
        assert.ok(spec.popStart <= spec.chargeStart, `${spec.tier} pop 先于 charge`);
        assert.ok(spec.chargeStart <= spec.lidStart, `${spec.tier} charge 先于 lid`);
        assert.ok(spec.lidStart <= spec.flashStart, `${spec.tier} 箱盖先开、白光后爆`);
        // 光条是「从箱缝里漏出来的光」，蓄力期就该起，不必等箱盖完全张开
        assert.ok(spec.rayStart >= spec.chargeStart, `${spec.tier} 光条不该早于蓄力`);
        assert.ok(spec.rayStart <= spec.flashStart, `${spec.tier} 光条先于白光爆点`);
        assert.ok(spec.flyStart >= spec.flashStart, `${spec.tier} 先爆光再飞图标`);
    }
});

test('所有窗口都收在总时长之内（不出现「收尾之后还在开盖」）', () => {
    for (const spec of ALL_SPECS) {
        const ends: [string, number][] = [
            ['pop', spec.popStart + spec.popSeconds],
            ['charge', spec.chargeStart + spec.chargeSeconds],
            ['lid', spec.lidStart + spec.lidSeconds],
            ['flash', spec.flashStart + spec.flashSeconds],
            ['ray', spec.rayStart + spec.raySeconds],
            ['beam', spec.beamStart + spec.beamDownSeconds + spec.beamHoldSeconds + spec.beamFadeSeconds],
            ['cameraOut', spec.cameraOutStart + spec.cameraOutSeconds],
            ['fountain', spec.fountainStart + spec.fountainSeconds],
            ['star', spec.starStart + spec.starSeconds],
            ['fly', spec.flyStart + spec.flySeconds + (spec.flyCount - 1) * 0.06],
        ];
        for (const [name, end] of ends) {
            if (end <= 0) continue;
            assert.ok(end <= spec.totalSeconds + 1e-9, `${spec.tier} ${name} 结束于 ${end}s，超过总时长 ${spec.totalSeconds}s`);
        }
    }
});

// ============================================================
// 宝箱本体
// ============================================================

test('出场前 visible=false（视图据此整块藏起来）', () => {
    assert.equal(territoryChestBodyFx(WEAK, -0.01).visible, false);
    assert.equal(territoryChestBodyFx(STRONG, 0.29).visible, false, '强档 0.30 才出场');
    assert.equal(territoryChestBodyFx(STRONG, 0.31).visible, true);
});

test('SpringPop 峰值恰好等于 1.15（Back.easeOut 冲不到）', () => {
    const times = sampleTimes(WEAK);
    let peak = 0;
    for (const t of times) {
        const fx = territoryChestBodyFx(WEAK, t);
        if (fx.visible) peak = Math.max(peak, fx.scale);
    }
    assert.ok(Math.abs(peak - TERRITORY_CHEST_POP_OVERSHOOT) < 0.01, `实测峰值 ${peak}，应约 ${TERRITORY_CHEST_POP_OVERSHOOT}`);
    assert.equal(TERRITORY_CHEST_POP_OVERSHOOT, 1.15);
});

test('宝箱最终落回 1.0（不许停在过冲值上）', () => {
    for (const spec of ALL_SPECS) {
        const fx = territoryChestBodyFx(spec, spec.totalSeconds);
        assert.ok(Math.abs(fx.scale - 1) < 1e-6, `${spec.tier} 收尾缩放 ${fx.scale} 应为 1`);
        assert.ok(Math.abs(fx.scaleY - 1) < 1e-6, `${spec.tier} 收尾 scaleY 应为 1`);
        assert.equal(fx.offsetY, 0);
    }
});

test('开盖换帧：开盖前恒第 0 张（闭合），窗口内递增，之后恒停最后一张', () => {
    for (const spec of ALL_SPECS) {
        const last = spec.openFrames - 1;
        // 出场到开盖之前：一直是闭合（与地图格子上那只宝箱一致，切换时不会"跳一下"）
        assert.equal(territoryChestOpenFrame(spec, spec.popStart), 0, spec.tier);
        assert.equal(territoryChestOpenFrame(spec, spec.lidStart - 0.01), 0, spec.tier);
        // 窗口结束：完全开盖
        assert.equal(territoryChestOpenFrame(spec, spec.lidStart + spec.lidSeconds), last, spec.tier);
        assert.equal(territoryChestOpenFrame(spec, spec.totalSeconds), last, spec.tier);
        // 窗口内单调递增，且**每一张都真的被用到**（中间帧不许被时间轴跳过）
        const seen = new Set<number>();
        let previous = -1;
        for (const t of sampleTimes(spec, 1 / 240)) {
            const index = territoryChestOpenFrame(spec, t);
            assert.ok(index >= 0 && index < spec.openFrames, `${spec.tier} t=${t} 帧号越界：${index}`);
            assert.ok(index >= previous, `${spec.tier} t=${t} 帧号回退了（${previous} → ${index}）`);
            previous = index;
            seen.add(index);
        }
        assert.equal(seen.size, spec.openFrames, `${spec.tier} 有帧没播到：只用了 ${seen.size}/${spec.openFrames} 张`);
    }
});

test('开盖换帧：三档都至少 3 张（两张就没有"补帧"可言）', () => {
    for (const spec of ALL_SPECS) {
        assert.ok(spec.openFrames >= 3, `${spec.tier} openFrames=${spec.openFrames}，至少 3 张`);
        // 张数与美术目录一致（`chest_seq_0 … chest_seq_N-1`），改一处必须改两处
        assert.equal(spec.openFrames, TERRITORY_CHEST_OPEN_FRAMES, `${spec.tier} 与全局帧数不一致`);
    }
});

test('开盖换帧：脏数据不越界（帧数 0 / t 为 NaN 都退回第 0 张）', () => {
    const broken: ITerritoryChestSpec = { ...WEAK, openFrames: 0 };
    assert.equal(territoryChestOpenFrame(broken, WEAK.lidStart + 0.05), 0);
    assert.equal(territoryChestOpenFrame(WEAK, Number.NaN), 0);
    assert.equal(territoryChestOpenFrame(WEAK, Number.POSITIVE_INFINITY), 0);
});

test('开盖换帧：帧数调小时不会取到不存在的帧', () => {
    const short: ITerritoryChestSpec = { ...MEDIUM, openFrames: 4 };
    for (const t of sampleTimes(short, 1 / 240)) {
        assert.ok(territoryChestOpenFrame(short, t) <= 3, `t=${t} 超出 4 帧`);
    }
    assert.equal(territoryChestOpenFrame(short, short.totalSeconds), 3);
});

test('弱档蓄力是「下压」（float=0、squashY<1）；中强档是「浮动」', () => {
    assert.equal(WEAK.chargeFloatPx, 0);
    assert.ok(WEAK.chargeSquashY < 1);
    assert.ok(MEDIUM.chargeFloatPx > 0);
    assert.ok(STRONG.chargeFloatPx > 0);
});

// ============================================================
// 光效
// ============================================================

test('白光：起手即峰值、窗口外为 0', () => {
    for (const spec of ALL_SPECS) {
        assert.equal(territoryChestFlashAlpha(spec, spec.flashStart - 0.01), 0, spec.tier);
        assert.ok(Math.abs(territoryChestFlashAlpha(spec, spec.flashStart) - spec.flashPeak) < 1e-9, spec.tier);
        assert.equal(territoryChestFlashAlpha(spec, spec.flashStart + spec.flashSeconds), 0, spec.tier);
        assert.ok(spec.flashPeak > 0 && spec.flashPeak <= 1, `${spec.tier} 白光峰值应在 (0,1]`);
    }
});

test('放射光条：窗口内由小到大、由亮到暗；窗口外 null', () => {
    for (const spec of ALL_SPECS) {
        assert.equal(territoryChestRayFx(spec, spec.rayStart - 0.01), null, spec.tier);
        const first = territoryChestRayFx(spec, spec.rayStart)!;
        const last = territoryChestRayFx(spec, spec.rayStart + spec.raySeconds * 0.95)!;
        assert.ok(last.scale > first.scale, `${spec.tier} 光条应向外扩散`);
        assert.ok(last.alpha < first.alpha, `${spec.tier} 光条应淡出`);
    }
});

test('光柱：淡出段走完必须干净归零（不留底噪）', () => {
    const end = MEDIUM.beamStart + MEDIUM.beamDownSeconds + MEDIUM.beamHoldSeconds + MEDIUM.beamFadeSeconds;
    assert.equal(territoryChestBeamAlpha(MEDIUM, end), 0);
    assert.equal(territoryChestBeamAlpha(MEDIUM, end + 0.5), 0);
    // 呼吸峰值不许溢出 1（视图还要再夹一次 alpha）
    for (const t of sampleTimes(MEDIUM)) {
        const a = territoryChestBeamAlpha(MEDIUM, t);
        assert.ok(a === null || (a >= 0 && a <= 1), `t=${t} 光柱 alpha=${a} 越界`);
    }
});

// ============================================================
// 粒子 / 飞行：窗口边界 + 确定性
// ============================================================

test('喷泉：窗口外为 null，索引越界为 null', () => {
    assert.equal(territoryChestFountainFx(MEDIUM, 1, -1, 1.5), null);
    assert.equal(territoryChestFountainFx(MEDIUM, 1, MEDIUM.fountainCount, 1.5), null);
    // ⚠️ 用 `fountainStart` 相对判，不再写死 0.5：粒子现在与**开盖同一时刻**起（2026-10-22），
    //    写死时间的话每次调节奏都要改断言。
    assert.equal(territoryChestFountainFx(MEDIUM, 1, 0, MEDIUM.fountainStart - 0.01), null, '还没开始喷');
    assert.equal(territoryChestFountainFx(MEDIUM, 1, 0, MEDIUM.totalSeconds + 1), null, '早该落地了');
    assert.ok(territoryChestFountainFx(MEDIUM, 1, 0, MEDIUM.fountainStart + 0.2) !== null);
});

test('喷泉：`y` 永不穿到箱口以下（`>= 0`）', () => {
    for (const spec of [MEDIUM, STRONG]) {
        for (let index = 0; index < spec.fountainCount; index += 1) {
            for (const t of sampleTimes(spec, 1 / 60)) {
                const fx = territoryChestFountainFx(spec, 3, index, t);
                if (fx) assert.ok(fx.y >= 0, `${spec.tier} #${index} t=${t} y=${fx.y}`);
            }
        }
    }
});

test('星光：窗口外为 null，索引越界为 null', () => {
    assert.equal(territoryChestStarFx(STRONG, 1, -1, 2), null);
    assert.equal(territoryChestStarFx(STRONG, 1, STRONG.starCount, 2), null);
    assert.equal(territoryChestStarFx(STRONG, 1, 0, 0.5), null);
    assert.equal(territoryChestStarFx(STRONG, 1, 0, STRONG.totalSeconds + 1), null);
    // 出场时刻本身带 0~0.15s 抖动，所以取「抖动窗口之后、寿命之内」的一帧（1.5s）
    assert.ok(territoryChestStarFx(STRONG, 1, 0, 1.5) !== null);
});

test('粒子确定性：同 seed 同 index 同 t 恒等（不用 Math.random）', () => {
    for (const t of [1.3, 1.8, 2.4]) {
        assert.deepEqual(territoryChestFountainFx(MEDIUM, 42, 7, t), territoryChestFountainFx(MEDIUM, 42, 7, t));
        assert.deepEqual(territoryChestStarFx(STRONG, 42, 7, t), territoryChestStarFx(STRONG, 42, 7, t));
    }
    // 不同 seed ⇒ 至少有一颗不一样（否则「每次开箱都一样」会看腻）
    const a = territoryChestFountainFx(MEDIUM, 1, 3, 1.6);
    const b = territoryChestFountainFx(MEDIUM, 2, 3, 1.6);
    assert.notDeepEqual(a, b);
});

test('飞行：窗口外 null、索引越界 null、终点前缩小并被吸入', () => {
    for (const spec of ALL_SPECS) {
        assert.equal(territoryChestFlyFx(spec, -1, spec.flyStart), null);
        assert.equal(territoryChestFlyFx(spec, spec.flyCount, spec.flyStart), null);
        assert.equal(territoryChestFlyFx(spec, 0, spec.flyStart - 0.01), null, spec.tier);
        const nearEnd = territoryChestFlyFx(spec, 0, spec.flyStart + spec.flySeconds * 0.95)!;
        assert.ok(nearEnd.scale < 0.8, `${spec.tier} 到终点应被吸小`);
        assert.ok(nearEnd.progress > 0.99, `${spec.tier} 位移应已走完`);
        assert.equal(territoryChestFlyFx(spec, 0, spec.flyStart + spec.flySeconds), null, spec.tier);
    }
});

test('飞行：进度单调不回退（错峰不影响单枚的单调）', () => {
    const times = sampleTimes(MEDIUM, 1 / 60).filter((t) => t >= MEDIUM.flyStart && t < MEDIUM.flyStart + MEDIUM.flySeconds);
    let last = -1;
    for (const t of times) {
        const fx = territoryChestFlyFx(MEDIUM, 0, t);
        if (!fx) continue;
        assert.ok(fx.progress >= last - 1e-9, `t=${t} 飞行进度回退了`);
        last = fx.progress;
    }
    assert.ok(last > 0.9);
});

// ============================================================
// 开盖节奏 / 收尾
// ============================================================

test('开盖：每张补帧至少 60ms（读得出「闭合 → 半开 → 全开」，不是一闪而过）', () => {
    for (const spec of ALL_SPECS) {
        const perFrame = spec.lidSeconds / spec.openFrames;
        assert.ok(perFrame >= 0.06, `${spec.tier} 每帧 ${(perFrame * 1000).toFixed(0)}ms，太短读不出开盖过程`);
        assert.ok(spec.lidSeconds >= 0.30, `${spec.tier} 整段开盖 ${spec.lidSeconds}s，至少 0.30s`);
    }
});

test('奖励生成动画与开盖同时开始（粒子不许晚于开盖结束才起）', () => {
    for (const spec of ALL_SPECS) {
        if (spec.fountainCount > 0) {
            assert.ok(spec.fountainStart <= spec.lidStart + spec.lidSeconds + 1e-9,
                `${spec.tier} 喷泉 ${spec.fountainStart}s 晚于开盖结束 ${spec.lidStart + spec.lidSeconds}s`);
        }
        if (spec.starCount > 0) {
            assert.ok(spec.starStart <= spec.lidStart + spec.lidSeconds + 1e-9,
                `${spec.tier} 星光 ${spec.starStart}s 晚于开盖结束`);
        }
    }
});

test('收尾淡出：窗口前恒 1、总时长处归 0、单调不回升', () => {
    for (const spec of ALL_SPECS) {
        assert.ok(spec.fadeOutSeconds > 0, `${spec.tier} 要有收尾淡出`);
        assert.ok(spec.fadeOutSeconds < spec.totalSeconds, `${spec.tier} 淡出不能盖住整段`);
        const start = spec.totalSeconds - spec.fadeOutSeconds;
        assert.equal(territoryChestTailFade(spec, 0), 1, `${spec.tier} 开头不该淡`);
        assert.equal(territoryChestTailFade(spec, start), 1, `${spec.tier} 淡出窗口起点应仍为 1`);
        assert.equal(territoryChestTailFade(spec, spec.totalSeconds), 0, `${spec.tier} 收尾必须归 0`);
        let last = 1;
        for (const t of sampleTimes(spec, 1 / 240)) {
            const fade = territoryChestTailFade(spec, t);
            assert.ok(fade >= 0 && fade <= 1, `${spec.tier} t=${t} 系数越界：${fade}`);
            assert.ok(fade <= last + 1e-9, `${spec.tier} t=${t} 系数回升了（${last} → ${fade}）`);
            last = fade;
        }
    }
});

test('收尾淡出：脏数据不产出 NaN', () => {
    assert.equal(territoryChestTailFade(WEAK, Number.NaN), 0);
    const noFade: ITerritoryChestSpec = { ...WEAK, fadeOutSeconds: 0 };
    assert.equal(territoryChestTailFade(noFade, WEAK.totalSeconds), 1, '没配淡出就恒 1');
});

// ============================================================
// 收尾锚点（2026-10-22 用户：「宝箱打开后，获取奖励后快速消失，现在停止的时间太长了」）
// ============================================================

test('收尾紧跟最后一枚奖励落袋：空转恒为 settleSeconds，不再随总时长飘', () => {
    for (const spec of ALL_SPECS) {
        const last = territoryChestLastRewardAt(spec);
        const fadeStart = territoryChestFadeStart(spec);
        const idle = fadeStart - last;
        // 空转 = 从"最后一枚图标飞走"到"开始消失"之间的静止。它必须等于 settleSeconds，
        // 而不是「总时长减淡出减末枚」那种一改参数就飘的差值。
        assert.ok(Math.abs(idle - spec.settleSeconds) < 1e-9,
            `${spec.tier} 末枚落袋 ${last.toFixed(2)}s、收尾起点 ${fadeStart.toFixed(2)}s ⇒ 空转 ${(idle * 1000).toFixed(0)}ms，应为 ${(spec.settleSeconds * 1000).toFixed(0)}ms`);
        assert.ok(idle <= 0.25, `${spec.tier} 空转 ${(idle * 1000).toFixed(0)}ms 太长（上限 250ms）`);
        // 落袋到"整段消失"= 空转 + 淡出，总尾巴不许超过 0.65s
        const tail = territoryChestEndSeconds(spec) - last;
        assert.ok(tail <= 0.65, `${spec.tier} 落袋后还要 ${tail.toFixed(2)}s 才消失，太拖`);
    }
});

test('回归护栏：老口径的总时长会留下空转（数值留档，防有人改回去）', () => {
    // 2026-10-22 之前：弱 3.0 / 中 2.6 / 强 4.0，收尾起点 = total - fadeOut
    const legacy: readonly [TerritoryChestTier, number, number][] = [
        [TERRITORY_CHEST_TIER.weak, 3.0, 0.55],
        [TERRITORY_CHEST_TIER.medium, 2.6, 0.40],
        [TERRITORY_CHEST_TIER.strong, 4.0, 0.50],
    ];
    for (const [tier, total, fade] of legacy) {
        const spec = TERRITORY_CHEST_SPECS[tier];
        const legacyIdle = (total - fade) - territoryChestLastRewardAt(spec);
        // 这段就是用户说的"停太久"：0.30 ~ 0.83s 的开着的空箱子
        assert.ok(legacyIdle > 0.3, `${tier} 老口径空转应有明显空转，实测 ${legacyIdle.toFixed(2)}s`);
        // 新口径必须真的把它压下来
        assert.ok(legacyIdle - spec.settleSeconds > 0.1, `${tier} 本轮应至少削掉 100ms 空转`);
        // 末枚落袋的时刻没变 ⇒ 削掉的是"尾巴"，不是把奖励飞行提前（那会把空转挪到中间）
        assert.ok(territoryChestLastRewardAt(spec) < total, `${tier} 末枚落袋应在老总时长之内`);
    }
});

test('飞行错峰只有一个真源（0.06 不许在两处各写一份）', () => {
    assert.equal(TERRITORY_CHEST_FLY_STAGGER, 0.06);
    for (const spec of ALL_SPECS) {
        if (!(spec.flyCount > 0)) continue;
        // 末枚起飞时刻 = flyStart + stagger×(count-1)，再用 flyFx 反查一次
        const lastStart = spec.flyStart + TERRITORY_CHEST_FLY_STAGGER * (spec.flyCount - 1);
        assert.ok(territoryChestFlyFx(spec, spec.flyCount - 1, lastStart) !== null,
            `${spec.tier} 末枚应在 ${lastStart.toFixed(2)}s 起飞`);
        assert.equal(territoryChestFlyFx(spec, spec.flyCount - 1, lastStart - 0.002), null,
            `${spec.tier} 末枚不该提前起飞`);
    }
});

test('视图按「推导出的结束时刻」停播（不是 totalSeconds）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /territoryChestEndSeconds\(spec\)/, 'step() 必须按推导结束时刻停播');
    assert.doesNotMatch(body, /elapsed >= spec\.totalSeconds/, '不许再按手填总时长停播');
    // 光晕不再自己算一条「总时长前 0.6s 变暗」的曲线（会与 tailFade 打架、比宝箱早灭）
    assert.doesNotMatch(body, /spec\.totalSeconds - 0\.6/, '光晕的收尾只许乘 tailFade');
});

// ============================================================
// 接线（页面真的把美术与停播接上了）
// ============================================================

test('页面接线：加载**补帧序列** + 销毁时停播（漏了就是「有动画没箱子」）', () => {
    const src = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.ok(src.includes('loadChestArt'), '必须有 loadChestArt');
    assert.ok(src.includes('chest_seq_'), '宝箱走补帧序列 image/territory/chest/chest_seq_N');
    assert.ok(src.includes('TERRITORY_CHEST_OPEN_FRAMES'), '帧数必须取 model 常量，不写死 6');
    assert.ok(src.includes('setChestArt'), '加载完要注入视图');
    assert.ok(src.includes('stopChestPlay'), 'onDestroy 要停播');
    assert.ok(src.includes('territoryChestTierOfRewards'), '档位必须由 model 判，不在页面 if');
});

test('视图接线：换帧走 model，别在视图里再算一条时间轴', () => {
    // 曲线/帧号是产品口径（单测钉在上面），视图只许「读帧号 → 写 spriteFrame」。
    const src = readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /territoryChestOpenFrame\(spec, t\)/, '帧号必须来自 model');
    assert.doesNotMatch(body, /lidAngleDeg/, '箱盖不再旋转 —— 开盖是换帧，不是分片转动');
    assert.doesNotMatch(body, /CHEST_LID_RATIO/, '不再按比例裁箱盖');
    // 「基准缩放」和「动画缩放」必须分层：合成一层的话每帧 setScale 会把基准覆盖掉。
    assert.match(body, /this\.chestArt\.setScale/, '基准缩放写在 ChestArt 上');
    assert.match(body, /this\.chest\.setScale\(fx\.scale/, '动画缩放写在 Chest 上');
    // 箱口光晕按**时间**推进（开盖后常亮到收尾）：不再有箱盖角度可当判据。
    assert.match(body, /\(t - spec\.lidStart\) \/ spec\.lidSeconds/, '光晕要按时间推进');
});

test('视图接线：宝箱与所有光效共用同一个收尾系数（不许各灭各的）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /territoryChestTailFade\(spec, t\)/, '系数必须来自 model');
    // 宝箱本体：用 UIOpacity 淡出（不是 `stop()` 一刀切）
    assert.match(body, /chestOpacity\.opacity = alpha/, '宝箱本体要按系数淡出');
    // 逐层乘：数一数乘了多少处 —— 少了任何一层就会出现「某个光效比宝箱晚灭」。
    const multiplied = body.match(/\* this\.tailFade/g) ?? [];
    assert.ok(multiplied.length >= 7, `tailFade 只乘了 ${multiplied.length} 处，光效层没覆盖全`);
});

test('地图视图：宝箱生成抖动比地块晚一点（走延迟队列，不立刻播）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /CHEST_SPAWN_SHAKE_DELAY_SECONDS\s*=\s*0\.\d+/, '要有明确的延迟常量');
    assert.match(body, /stepChestSpawnDelays\(dt\)/, '延迟要在 update 里推进');
    assert.match(body, /chestSpawnDelay\.set\(site\.cellId, CHEST_SPAWN_SHAKE_DELAY_SECONDS\)/,
        '新宝箱要排队，而不是当场 playBuildingShake');
    // 排队后到点才抖：`stepChestSpawnDelays` 里那一句是唯一的触发点
    const step = body.slice(body.indexOf('private stepChestSpawnDelays'));
    assert.match(step.slice(0, step.indexOf('\n    }')), /playBuildingShake\(\)/, '到点要真的抖');
});
