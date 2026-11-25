/**
 * 巡逻宝箱「升级摇奖」曲线 —— 星星虚影怎么呼吸、宝箱怎么晃、白到什么程度。
 *
 * 用户原话（2026-11-24，替代 11-22 的进度条方案）：
 * 「删除旧的进度条升级动画，替换成新动画：空的星星槽位里有星星虚影闪烁 + 放大缩小，
 * 持续 1.2~2.5s，越接近成功时间就越久；星星闪烁伴随宝箱左右晃动的动画，同时宝箱逐渐叠加
 * 纯白色（越来越白），升级成功从白色变成下一等级的宝箱，颜色逐渐过渡回来」。
 *
 * 确认口径（2026-11-24，三选一里的第一项）：**1.2~2.5s 指单次呼吸周期从 1.2s 逐渐拉长到
 * 2.5s**（越接近出结果越慢），整段时长仍等回包、但最短演满 1.2s。
 *
 * 当天晚些两次追加（都只动 `TERRITORY_MONSTER_BOX_ROLL` 常量，曲线形状不变）：
 * - 傍晚「摇晃节奏和星星缩放的节奏要加强」⇒ 幅度加大 + 摇晃倍频；
 * - 夜里「宝箱抖动是原地的抖动，不是明显的左右挪，快速的原地抖动（轻微左右 3px + 明显的缩放
 *   + 轻微的跳动/震动），星星闪烁频率再快 3 倍，大小略大 15%」⇒ 呼吸周期整体 ÷3、振动改成
 *   7Hz 三通道（水平/垂直/缩放）并与呼吸**解耦**、虚影缩放整体 ×1.15。
 *
 * 这条判据钉六件事，每件错了都不报错、只是「看起来不对」：
 *
 * 1. **呼吸只会越来越慢** —— 周期若反向变快，玩家会读成「快出结果了」而被骗；
 * 2. **虚影真的在放大缩小**（pulse 取到两端），不是只改透明度；
 * 3. **宝箱是原地颤动、不是挪位** —— 水平只有 ±4 逻辑 px（≈3 屏上 px），主角是 ±8% 缩放与
 *    ±2 跳动；幅度一大就变成「左右挪」，正是用户明确否掉的样子；
 * 4. **震动要快**（≥5Hz，实测 7Hz），慢慢晃会被读成「卡住了」；
 * 5. **白度只涨不落**（等结果期间），落定后才回落到 0；
 * 6. **成功才换图** —— `revealing` 是「换新等级宝箱」的唯一开关，失败不许亮。
 *
 * 纯函数、零 `cc` 依赖，直接 import 真实实现（不复制算法）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TERRITORY_MONSTER_BOX_ROLL,
    monsterBoxPulseAt,
    monsterBoxPulsePhaseAt,
    monsterBoxRollPose,
    monsterBoxRollSettleStart,
    monsterBoxShakeScaleAt,
    monsterBoxShakeXAt,
    monsterBoxShakeYAt,
} from '../assets/script/app/territory/model/TerritoryMonsterBoxRoll';

const {
    minSeconds, pulseFastSeconds, pulseSlowSeconds, pulseRampSeconds,
    whitenSeconds, fadeSeconds, successFreezeSeconds, failFadeSeconds, holdSeconds,
    shakeHz, shakeAmplitudeX, shakeAmplitudeY, shakeScaleAmplitude,
    ghostMinScale, ghostMaxScale,
} = TERRITORY_MONSTER_BOX_ROLL;

/** 扫描出 `pulse` 的局部峰值时刻（阈值 0.9，够滤掉噪声）。 */
function pulsePeaks(until: number, step = 0.002): number[] {
    const peaks: number[] = [];
    let prev2 = monsterBoxPulseAt(0);
    let prev = monsterBoxPulseAt(step);
    for (let t = step * 2; t <= until; t += step) {
        const cur = monsterBoxPulseAt(t);
        if (prev > prev2 && prev >= cur && prev > 0.9) peaks.push(t - step);
        prev2 = prev;
        prev = cur;
    }
    return peaks;
}

test('★节奏常量自洽：慢周期 > 快周期，最短演满 = 变白爬满', () => {
    assert.ok(pulseSlowSeconds > pulseFastSeconds, '呼吸只能越走越慢');
    assert.ok(pulseRampSeconds > 0);
    assert.equal(minSeconds, 1.2, '需求下界 1.2s');
    // 11-24 晚：闪烁频率快 3 倍 ⇒ 原 1.2 / 2.5 整体 ÷3
    assert.ok(Math.abs(pulseFastSeconds - 1.2 / 3) < 1e-9, `起手周期应为 0.4s，实测 ${pulseFastSeconds}`);
    assert.ok(Math.abs(pulseSlowSeconds - 2.5 / 3) < 1e-9, `最慢周期应为 0.833s，实测 ${pulseSlowSeconds}`);
    assert.equal(whitenSeconds, minSeconds, '落定那一刻正好最白');
    assert.ok(fadeSeconds > 0 && holdSeconds > 0);
});

test('★★呼吸周期只会变慢：整周期越来越长，稳态收敛到 0.833s', () => {
    // 最慢周期 0.833s、ramp 0.6s ⇒ 扫 3s 已经进入稳态并留下 3 个以上整周期
    const peaks = pulsePeaks(3);
    assert.ok(peaks.length >= 4, `3s 内至少要 4 个峰值（实测 ${peaks.length}）`);
    const gaps: number[] = [];
    for (let i = 1; i < peaks.length; i += 1) gaps.push(peaks[i] - peaks[i - 1]);
    for (let i = 1; i < gaps.length; i += 1) {
        assert.ok(gaps[i] >= gaps[i - 1] - 1e-9,
            `第 ${i + 1} 个整周期 ${gaps[i].toFixed(3)}s 比上一个 ${gaps[i - 1].toFixed(3)}s 短 ⇒ 呼吸变快了`);
    }
    // 起手第一个整周期介于快慢之间（周期在涨），稳态整周期收敛到 0.833s
    assert.ok(gaps[0] > pulseFastSeconds && gaps[0] < pulseSlowSeconds + 1e-9,
        `起手整周期应在 0.4~0.833s 之间，实测 ${gaps[0].toFixed(3)}s`);
    assert.ok(Math.abs(gaps[gaps.length - 1] - pulseSlowSeconds) < 0.02,
        `稳态整周期应≈0.833s，实测 ${gaps[gaps.length - 1].toFixed(3)}s`);
    // 起手半周期（0 → 第一个峰）比 0.2s 长、比 0.4167s 短
    assert.ok(peaks[0] > pulseFastSeconds / 2 && peaks[0] < pulseSlowSeconds / 2,
        `起手半周期应在 0.2~0.4167s 之间，实测 ${peaks[0].toFixed(3)}s`);
});

test('★★虚影真的在放大缩小（pulse 取到两端，不只是改透明度）', () => {
    let min = 1;
    let max = 0;
    for (let t = 0; t <= 3; t += 0.005) {
        const pulse = monsterBoxPulseAt(t);
        assert.ok(pulse >= 0 && pulse <= 1, `pulse 越界 ${pulse}`);
        min = Math.min(min, pulse);
        max = Math.max(max, pulse);
    }
    assert.ok(max > 0.99, `要从最小涨到最大（实测 max ${max.toFixed(3)}）`);
    assert.ok(min < 0.01, `也要缩回最小（实测 min ${min.toFixed(3)}）`);
});

/**
 * 2026-11-24 晚用户第二次改口：「宝箱抖动是原地的抖动，不是明显的左右挪，快速的原地抖动
 * （轻微左右 3px + 明显的缩放 + 轻微的跳动/震动）」。
 *
 * 三条通道各管一件事：`shakeX` 轻微左右、`shakeY` 轻微跳动、`shakeScale` 明显缩放。
 * 这条用例钉「原地 / 轻微 / 快速」：别再把水平幅度调回两位数（那叫挪位）。
 */
test('★★宝箱原地快速震动：起手归零、水平只有轻微 ±4、缩放明显 ±8%', () => {
    // 起手三路都必须在「归零」姿态，否则点下去会「跳一下」
    assert.ok(Math.abs(monsterBoxShakeXAt(0)) < 1e-12, '起手水平必须居中');
    assert.ok(Math.abs(monsterBoxShakeYAt(0)) < 1e-12, '起手垂直必须归零');
    assert.equal(monsterBoxShakeScaleAt(0), 1, '起手缩放必须正好 1');

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    let minScale = 2;
    let maxScale = 0;
    for (let t = 0; t <= 1; t += 0.001) {
        const x = monsterBoxShakeXAt(t);
        const y = monsterBoxShakeYAt(t);
        const s = monsterBoxShakeScaleAt(t);
        assert.ok(Math.abs(x) <= shakeAmplitudeX + 1e-9, `水平越界 ${x}`);
        assert.ok(Math.abs(y) <= shakeAmplitudeY + 1e-9, `垂直越界 ${y}`);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minScale = Math.min(minScale, s); maxScale = Math.max(maxScale, s);
    }
    // 左右/上下都要走满（只往一边偏就是挪位，不是震）
    assert.ok(minX < -shakeAmplitudeX * 0.99 && maxX > shakeAmplitudeX * 0.99, '水平没走满左右两端');
    assert.ok(minY < -shakeAmplitudeY * 0.99 && maxY > shakeAmplitudeY * 0.99, '垂直没走满上下两端');
    assert.ok(maxScale > 1.07 && minScale < 0.93, `缩放没走满 ±8%（实测 ${minScale.toFixed(3)}~${maxScale.toFixed(3)}）`);

    // 「轻微」：屏上 ≈3px ⇒ 逻辑 px 不超过 5（旧版 16 是挪位不是抖）
    assert.ok(shakeAmplitudeX > 0 && shakeAmplitudeX <= 5, `水平幅度 ${shakeAmplitudeX} 超出「轻微」范围`);
    // 「明显」：缩放至少 ±5%
    assert.ok(shakeScaleAmplitude >= 0.05, `缩放幅度 ${shakeScaleAmplitude} 不够明显`);
    // 「快速」：≥5Hz（每次来回 ≤0.2s）
    assert.ok(shakeHz >= 5, `震动频率 ${shakeHz}Hz 太慢，看着像慢慢歪`);
});

test('★★震动手感：反复来回、且尺寸变化比位移更显眼', () => {
    // 1s 内水平至少来回 8 次（7Hz ⇒ 12 次过零）
    let crossings = 0;
    let sign = Math.sign(monsterBoxShakeXAt(0.001));
    for (let t = 0.002; t <= 1; t += 0.001) {
        const s = Math.sign(monsterBoxShakeXAt(t));
        if (s !== 0 && sign !== 0 && s !== sign) crossings += 1;
        if (s !== 0) sign = s;
    }
    assert.ok(crossings >= 8, `1s 内只换向 ${crossings} 次 ⇒ 抖得不够快`);

    // 「位移轻、缩放重」：宝箱约 90px 宽，±8% ⇒ 边缘 ±7.2px，远大于水平的 4px
    const edgeMove = 90 * shakeScaleAmplitude;
    assert.ok(edgeMove > shakeAmplitudeX, `缩放带来的边缘位移 ${edgeMove.toFixed(1)} 应大于水平位移 ${shakeAmplitudeX}`);
});

test('★虚影整体放大 15%：摆幅仍 ±30%，中位落在 1.15', () => {
    const span = ghostMaxScale - ghostMinScale;
    assert.ok(span >= 0.6, `缩放摆幅只有 ${span.toFixed(2)}（应保持 ±30% ≈ 0.6）`);
    assert.ok(ghostMinScale < 0.85, `最小缩放 ${ghostMinScale} 不够小`);
    assert.ok(ghostMaxScale > 1.45, `最大缩放 ${ghostMaxScale} 不够大`);
    const mid = (ghostMinScale + ghostMaxScale) / 2;
    assert.ok(Math.abs(mid - 1.15) < 0.02,
        `缩放中位应≈1.15（整体比 0.7/1.3 大 15%），实测 ${mid.toFixed(3)}`);
});

test('★等结果期间白度只涨不落，1.2s 爬到顶后保持', () => {
    let last = -1;
    for (let t = 0; t <= 3; t += 0.02) {
        const pose = monsterBoxRollPose({ elapsed: t, success: null, resultAt: null });
        assert.equal(pose.phase, 'pulsing');
        assert.equal(pose.finished, false);
        assert.ok(pose.whiten >= last - 1e-9, `白度回退了：${last} → ${pose.whiten}`);
        last = pose.whiten;
    }
    assert.equal(monsterBoxRollPose({ elapsed: whitenSeconds, success: null, resultAt: null }).whiten, 1);
    assert.equal(monsterBoxRollPose({ elapsed: 5, success: null, resultAt: null }).whiten, 1, '等再久也保持最白');
});

test('★落定时刻 = max(最短演满 1.2s, 回包时刻)，回包再快也演满', () => {
    assert.equal(monsterBoxRollSettleStart(0.2), minSeconds, '回包秒回 ⇒ 1.2s 才落定');
    assert.equal(monsterBoxRollSettleStart(2.6), 2.6, '回包迟到 ⇒ 顺延到回包时刻');
    assert.equal(monsterBoxRollSettleStart(null), Number.POSITIVE_INFINITY, '没回包 ⇒ 永不落定');
});

test('★★成功后先「顿」：最白 + 姿势冻结，顿完才换图', () => {
    const input = { success: true, resultAt: 0.2 } as const;
    assert.equal(monsterBoxRollPose({ ...input, elapsed: 1.19 }).revealing, false, '落定前不许换图');
    assert.ok(monsterBoxRollPose({ ...input, elapsed: 1.19 }).whiten > 0.99, '落定前一帧已接近最白');

    // 顿的窗口内：白度 1、姿势一动不动、phase 是 pausing、绝不能换图
    const first = monsterBoxRollPose({ ...input, elapsed: minSeconds });
    assert.equal(first.phase, 'pausing');
    assert.equal(first.whiten, 1, '顿的时候必须是最白');
    assert.equal(first.revealing, false, '顿的这一拍不许换图（否则「白着换图」就看不见顿了）');
    for (let t = minSeconds; t < minSeconds + successFreezeSeconds; t += 0.005) {
        const pose = monsterBoxRollPose({ ...input, elapsed: t });
        assert.equal(pose.phase, 'pausing', `${t.toFixed(3)}s 还在顿，phase 应为 pausing`);
        assert.equal(pose.pulse, first.pulse, '顿的时候虚影不许动');
        assert.equal(pose.shakeX, first.shakeX, '顿的时候宝箱不许动');
        assert.equal(pose.shakeScale, first.shakeScale, '顿的时候缩放不许动');
        assert.equal(pose.whiten, 1);
        assert.equal(pose.revealing, false);
    }
    // 顿完这一帧才开始变化
    const afterFreeze = monsterBoxRollPose({ ...input, elapsed: minSeconds + successFreezeSeconds });
    assert.equal(afterFreeze.phase, 'revealing');
    assert.equal(afterFreeze.revealing, true, '顿完才把宝箱换成新等级图');
    assert.equal(afterFreeze.whiten, 1);
});

test('★成功后：换图后白度 1→0 缓出，1.2s + 顿 + 0.45s + 定格 演完', () => {
    const input = { success: true, resultAt: 0.2 } as const;
    const fadeStart = minSeconds + successFreezeSeconds;

    // 白度单调回落
    let last = 1.01;
    for (let t = fadeStart; t < fadeStart + fadeSeconds; t += 0.01) {
        const pose = monsterBoxRollPose({ ...input, elapsed: t });
        assert.ok(pose.whiten <= last + 1e-9, `白度回升了：${last} → ${pose.whiten}`);
        assert.equal(pose.revealing, true, '褪白期间仍处于「显示新宝箱」态');
        last = pose.whiten;
    }
    assert.equal(monsterBoxRollPose({ ...input, elapsed: fadeStart + fadeSeconds }).whiten, 0);

    const total = fadeStart + fadeSeconds;
    assert.equal(monsterBoxRollPose({ ...input, elapsed: total + holdSeconds - 0.01 }).finished, false);
    const end = monsterBoxRollPose({ ...input, elapsed: total + holdSeconds });
    assert.equal(end.finished, true);
    assert.equal(end.pulse, 0, '收尾时虚影归位');
    assert.equal(end.shakeX, 0, '收尾时宝箱归位');
    assert.equal(end.shakeScale, 1);
});

test('★★失败：revealing 恒为 false，且没有「顿」那一拍', () => {
    const input = { success: false, resultAt: 0.3 } as const;
    for (let t = 0; t <= 3; t += 0.02) {
        const pose = monsterBoxRollPose({ ...input, elapsed: t });
        assert.equal(pose.revealing, false, `${t.toFixed(2)}s 失败却亮了换图开关`);
        assert.notEqual(pose.phase, 'pausing', `${t.toFixed(2)}s 失败不该有「顿」`);
    }
    // 失败在白到顶之后立刻开始退，不像成功那样先定住
    assert.ok(monsterBoxRollPose({ ...input, elapsed: minSeconds + 0.01 }).whiten < 1,
        '失败必须紧接着褪白，不许顿');
    const settled = monsterBoxRollPose({ ...input, elapsed: minSeconds + failFadeSeconds + holdSeconds + 0.01 });
    assert.equal(settled.finished, true);
    assert.equal(settled.whiten, 0, '失败也要褪回原色');
});

test('★★失败节奏逐渐变缓：越到后面晃得越慢（相邻换向间隔递增）', () => {
    const input = { success: false, resultAt: 0.2 } as const;
    const turns: number[] = [];
    let prev = monsterBoxShakeXAt(0);
    let sign = Math.sign(prev);
    for (let t = minSeconds; t <= minSeconds + failFadeSeconds; t += 0.001) {
        const pose = monsterBoxRollPose({ ...input, elapsed: t });
        const s = Math.sign(pose.shakeX);
        if (s !== 0 && sign !== 0 && s !== sign) turns.push(t);
        if (s !== 0) sign = s;
        prev = pose.shakeX;
    }
    assert.ok(turns.length >= 3, `收尾段至少要换向 3 次才看得出「变缓」（实测 ${turns.length}）`);
    const gaps: number[] = [];
    for (let i = 1; i < turns.length; i += 1) gaps.push(turns[i] - turns[i - 1]);
    for (let i = 1; i < gaps.length; i += 1) {
        assert.ok(gaps[i] > gaps[i - 1] - 1e-9,
            `第 ${i + 1} 个间隔 ${gaps[i].toFixed(3)}s 比上一个 ${gaps[i - 1].toFixed(3)}s 短 ⇒ 节奏没变缓`);
    }
    assert.ok(gaps[gaps.length - 1] > gaps[0] * 1.5,
        `末段间隔 ${gaps[gaps.length - 1].toFixed(3)}s 应明显长于起手 ${gaps[0].toFixed(3)}s`);
    // 失败了也不能拖太久：整段收尾比成功长，但不能翻倍
    assert.ok(failFadeSeconds > fadeSeconds, '失败收尾要比成功长，才看得出「变缓」');
    assert.ok(failFadeSeconds < fadeSeconds * 2, '失败收尾也别长到让玩家以为卡住了');
});

test('★回包迟到：呼吸继续、不跳帧，落定时刻从回包算', () => {
    const late = { success: true, resultAt: 2.4 } as const;
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.3 }).phase, 'pulsing', '结果没到不许落定');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.3 }).whiten, 1, '等的时候一直是最白');
    // 呼吸没停：2.3s 的 pulse 仍按曲线走，不是定值
    const a = monsterBoxRollPose({ ...late, elapsed: 2.3 }).pulse;
    const b = monsterBoxRollPose({ ...late, elapsed: 2.35 }).pulse;
    assert.notEqual(a, b, '迟到时星星必须还在动');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.45 }).phase, 'pausing', '落定后先顿，不是直接换图');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.4 + successFreezeSeconds + 0.01 }).phase, 'revealing');
    assert.equal(
        monsterBoxRollPose({ ...late, elapsed: 2.4 + successFreezeSeconds + fadeSeconds + holdSeconds }).finished,
        true,
    );
});

test('接口处不跳：落定那一帧的呼吸 / 颤动 / 白度从上一帧平滑接上', () => {
    const resultAt = 0.5;
    const before = monsterBoxRollPose({ elapsed: minSeconds - 0.001, success: true, resultAt });
    const at = monsterBoxRollPose({ elapsed: minSeconds, success: true, resultAt });
    assert.ok(Math.abs(at.pulse - before.pulse) < 0.02, `pulse 跳了 ${before.pulse} → ${at.pulse}`);
    assert.ok(Math.abs(at.shakeX - before.shakeX) < 0.5, `shakeX 跳了 ${before.shakeX} → ${at.shakeX}`);
    assert.ok(Math.abs(at.shakeY - before.shakeY) < 0.5, `shakeY 跳了 ${before.shakeY} → ${at.shakeY}`);
    assert.ok(Math.abs(at.shakeScale - before.shakeScale) < 0.01, `shakeScale 跳了 ${before.shakeScale} → ${at.shakeScale}`);
    assert.ok(Math.abs(at.whiten - before.whiten) < 0.02, 'whiten 跳了');

    // 顿完进入褪白也要连续（白度从 1 开始缓出；缩放收敛到 1 而不是 0）
    const fadeStart = minSeconds + successFreezeSeconds;
    const nearEnd = monsterBoxRollPose({ elapsed: fadeStart + fadeSeconds - 0.005, success: true, resultAt });
    const atEnd = monsterBoxRollPose({ elapsed: fadeStart + fadeSeconds, success: true, resultAt });
    assert.ok(Math.abs(atEnd.whiten - nearEnd.whiten) < 0.02);
    assert.ok(Math.abs(atEnd.shakeScale - nearEnd.shakeScale) < 0.01);
    assert.equal(atEnd.shakeScale, 1, '收尾后缩放必须回到 1');

    // 失败的收尾同样不许「啪」地归零
    const failNear = monsterBoxRollPose({ elapsed: minSeconds + failFadeSeconds - 0.005, success: false, resultAt });
    const failEnd = monsterBoxRollPose({ elapsed: minSeconds + failFadeSeconds, success: false, resultAt });
    assert.ok(Math.abs(failEnd.whiten - failNear.whiten) < 0.02, '失败褪白最后一帧跳了');
});

test('脏输入不炸也不越界（NaN / 负数时间）', () => {
    const pose = monsterBoxRollPose({ elapsed: Number.NaN, success: true, resultAt: 0 });
    assert.ok(Number.isFinite(pose.pulse) && pose.pulse >= 0 && pose.pulse <= 1);
    assert.ok(Number.isFinite(pose.shakeX) && Math.abs(pose.shakeX) <= shakeAmplitudeX);
    assert.ok(Number.isFinite(pose.shakeY) && Math.abs(pose.shakeY) <= shakeAmplitudeY);
    assert.ok(Number.isFinite(pose.shakeScale) && Math.abs(pose.shakeScale - 1) <= shakeScaleAmplitude + 1e-9);
    assert.ok(Number.isFinite(pose.whiten) && pose.whiten >= 0 && pose.whiten <= 1);
    const negative = monsterBoxRollPose({ elapsed: -5, success: null, resultAt: null });
    assert.equal(negative.pulse, 0);
    assert.equal(negative.shakeX, 0);
    assert.equal(negative.shakeY, 0);
    assert.equal(negative.shakeScale, 1);
    assert.equal(negative.whiten, 0);
    // 相位函数同样不许出 NaN（视图每帧直接喂节点）
    assert.ok(Number.isFinite(monsterBoxPulsePhaseAt(Number.NaN)));
    assert.equal(monsterBoxPulsePhaseAt(-1), 0);
    assert.equal(monsterBoxShakeXAt(Number.NaN), 0);
    assert.equal(monsterBoxShakeScaleAt(-1), 1);
});
