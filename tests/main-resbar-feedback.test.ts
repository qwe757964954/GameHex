/**
 * 资源栏「被奖励击中」的反馈曲线（`MainResBarFeedback`）。
 *
 * 用户 2026-10-26 原话：
 * > 「宝箱打开的体力或银币 icon 飞到对应的资源栏中，资源栏的 icon 和数字有跳动增加的反馈，
 * >   资源栏整体闪光」
 *
 * ⚠️ 同一天稍后改了口径：
 * > 「宝箱打开获取体力资源，只有对应的资源条闪烁，银币资源栏不闪烁」
 * ⇒ 闪光的作用域从「整条栏」收成「**命中的那一格**」。曲线本身不动，只是画框换了；
 *   作用域由 `ResBar.flash(target)` 决定，那条源码契约钉在 `main-resbar.test.ts` 里。
 *
 * 这里钉的是**曲线口径**（时序 / 端点 / 峰值），不是手感：
 *
 *  1. 反馈有明确的起止（窗口外一律 `null`，视图才不会留一个 1.0001 倍的残影）；
 *  2. **端点恒等于 1**：`resBarHitFx(0).iconScale === 1` 且窗口末帧也回到 1 ——
 *     「起手」「收尾」都不需要额外的归位帧；
 *  3. 峰值是**常量**（不是"大概 1.3 几"）：`1 + RES_BAR_HIT_ICON_POP`；
 *  4. 数字滚动**单调不减**且首尾精确落在 `from` / `to`（差一个整数都读得出来）；
 *  5. 文本拆分不能把体力的 `/上限` 弄丢（`50/60` 滚成 `55` 就是真 bug）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    RES_BAR_FLASH_PEAK_ALPHA,
    RES_BAR_FLASH_SECONDS,
    RES_BAR_HIT_ICON_POP,
    RES_BAR_HIT_LABEL_POP,
    RES_BAR_HIT_SECONDS,
    formatResBarCountText,
    parseResBarCountText,
    resBarCountValue,
    resBarFlashFx,
    resBarHitFx,
} from '../assets/script/app/main/MainResBarFeedback';

/** 在窗口内采样（`n` 个点，含端点内侧）。 */
function sample(duration: number, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push((duration * i) / n);
    return out;
}

test('时长常量：单格跳动比闪光短（数字先落地，闪光先亮起来）', () => {
    assert.ok(RES_BAR_HIT_SECONDS > 0 && RES_BAR_HIT_SECONDS < 1, '单格反馈是「一点就完」，不许长过 1s');
    assert.ok(RES_BAR_FLASH_SECONDS > 0 && RES_BAR_FLASH_SECONDS < 1);
    // 相差不到 0.2s：两者是同一件事的两半，错开太远会读成"闪完了才跳"。
    assert.ok(Math.abs(RES_BAR_FLASH_SECONDS - RES_BAR_HIT_SECONDS) < 0.2);
    assert.ok(RES_BAR_FLASH_PEAK_ALPHA > 0 && RES_BAR_FLASH_PEAK_ALPHA <= 0.5,
        '闪光峰值不许过半 —— 42% 才读作"确认"，再高就盖住数字了');
});

test('resBarHitFx：窗口外返回 null（不许留残影）', () => {
    assert.equal(resBarHitFx(-0.001), null);
    assert.equal(resBarHitFx(RES_BAR_HIT_SECONDS), null);
    assert.equal(resBarHitFx(RES_BAR_HIT_SECONDS + 1), null);
    assert.equal(resBarHitFx(Number.NaN), null);
    assert.ok(resBarHitFx(0), '0 秒是合法起点（第一帧就要有值）');
});

test('resBarHitFx：起手恒等 1 / 数字从 0 开始滚', () => {
    const fx = resBarHitFx(0)!;
    assert.equal(fx.iconScale, 1, '起手图标不许已经放大');
    assert.equal(fx.labelScale, 1);
    assert.equal(fx.countRatio, 0, '数字滚动的第一帧必须是 from（还没涨）');
});

test('resBarHitFx：图标峰值 = 1 + RES_BAR_HIT_ICON_POP，数字峰值更克制', () => {
    let iconPeak = 0;
    let labelPeak = 0;
    for (const t of sample(RES_BAR_HIT_SECONDS, 200)) {
        const fx = resBarHitFx(t)!;
        iconPeak = Math.max(iconPeak, fx.iconScale);
        labelPeak = Math.max(labelPeak, fx.labelScale);
    }
    assert.ok(Math.abs(iconPeak - (1 + RES_BAR_HIT_ICON_POP)) < 1e-6,
        `图标峰值必须是常量 ${1 + RES_BAR_HIT_ICON_POP}，实际 ${iconPeak}`);
    assert.ok(Math.abs(labelPeak - (1 + RES_BAR_HIT_LABEL_POP)) < 1e-6);
    assert.ok(labelPeak < iconPeak, '文字放大会糊 ⇒ 数字的弹跳必须比图标小');
});

test('resBarHitFx：弹跳收尾回到 1（不需要额外的归位帧）', () => {
    const last = resBarHitFx(RES_BAR_HIT_SECONDS - 1e-9)!;
    assert.ok(Math.abs(last.iconScale - 1) < 1e-6, `收尾该回到 1，实际 ${last.iconScale}`);
    assert.ok(Math.abs(last.labelScale - 1) < 1e-6);
    assert.ok(last.countRatio > 0.999, '收尾时数字必须已经滚到 to');
});

test('resBarHitFx：数字滚动单调不减（掉帧 / 反向都读得出来）', () => {
    let prev = -1;
    for (const t of sample(RES_BAR_HIT_SECONDS, 120)) {
        const ratio = resBarHitFx(t)!.countRatio;
        assert.ok(ratio >= prev - 1e-9, `countRatio 在 ${t}s 处回头了：${prev} → ${ratio}`);
        assert.ok(ratio >= 0 && ratio <= 1);
        prev = ratio;
    }
});

test('resBarFlashFx：中点最亮，两端为 0，窗口外 null', () => {
    assert.equal(resBarFlashFx(-1), null);
    assert.equal(resBarFlashFx(RES_BAR_FLASH_SECONDS), null);
    assert.equal(resBarFlashFx(0), 0);
    assert.ok(Math.abs(resBarFlashFx(RES_BAR_FLASH_SECONDS / 2)! - 1) < 1e-9);
    let prev = 0;
    for (const t of sample(RES_BAR_FLASH_SECONDS / 2, 40)) {
        const strength = resBarFlashFx(t)!;
        assert.ok(strength >= prev - 1e-9, '上升段不许回头');
        prev = strength;
    }
});

test('parseResBarCountText：体力的「当前/上限」不会丢后缀', () => {
    assert.deepEqual(parseResBarCountText('50/60'), { value: 50, suffix: '/60' });
    assert.deepEqual(parseResBarCountText('0/120'), { value: 0, suffix: '/120' });
    assert.deepEqual(parseResBarCountText('1234'), { value: 1234, suffix: '' });
    // 千分位：`CmdRole` 不该有，但脏缓存里出现过 —— 剔掉而不是解析成 1。
    assert.deepEqual(parseResBarCountText('1,234'), { value: 1234, suffix: '' });
    // 负数（服务端兜底值）：照原样解析，交给 `resBarCountValue` 决定要不要夹。
    assert.deepEqual(parseResBarCountText('-5'), { value: -5, suffix: '' });
    // 解析不出数字（骨架期空串 / 纯文字）：给 0，调用方据此跳过滚动只做弹跳。
    assert.deepEqual(parseResBarCountText(''), { value: 0, suffix: '' });
    assert.deepEqual(parseResBarCountText('--'), { value: 0, suffix: '' });
});

test('formatResBarCountText：取整后拼回后缀（体力仍是 当前/上限）', () => {
    const stamina = parseResBarCountText('50/60');
    assert.equal(formatResBarCountText(stamina, 55.4), '55/60');
    assert.equal(formatResBarCountText(stamina, 60), '60/60');
    const gold = parseResBarCountText('1234');
    assert.equal(formatResBarCountText(gold, 999), '999');
    // 脏输入不许产出 `NaN` 字面量。
    assert.equal(formatResBarCountText(gold, Number.NaN), '0');
});

test('resBarCountValue：首尾精确，中间夹紧（方向不猜）', () => {
    assert.equal(resBarCountValue(50, 100, 0), 50);
    assert.equal(resBarCountValue(50, 100, 1), 100);
    assert.equal(resBarCountValue(50, 100, 0.5), 75);
    // 反向（换角色 / 数据回落）也照算，不夹方向。
    assert.equal(resBarCountValue(100, 40, 1), 40);
    // `ratio` 越界夹紧，脏值当 0。
    assert.equal(resBarCountValue(50, 100, 2), 100);
    assert.equal(resBarCountValue(50, 100, -3), 50);
    assert.equal(resBarCountValue(Number.NaN, 100, 0.5), 50);
});

test('滚动整条链：from = 当前值 - amount，逐帧文本只增不减且收尾等于当前值', () => {
    // 实机口径：label 上已经是发奖后的数值（CmdRole 推包早于表演落地）
    const base = parseResBarCountText('1234');
    const to = base.value;
    const amount = 234;
    const from = Math.max(0, to - amount);
    assert.equal(from, 1000);

    let prevText = -1;
    for (const t of sample(RES_BAR_HIT_SECONDS, 80)) {
        const fx = resBarHitFx(t)!;
        const text = formatResBarCountText(base, resBarCountValue(from, to, fx.countRatio));
        const value = Number(text);
        assert.ok(value >= prevText, `数字回退了：${prevText} → ${value}`);
        prevText = value;
    }
    const finalFx = resBarHitFx(RES_BAR_HIT_SECONDS - 1e-9)!;
    assert.equal(
        formatResBarCountText(base, resBarCountValue(from, to, finalFx.countRatio)),
        '1234',
        '收尾必须精确落在当前值上（差 1 就是实机可见的"数字没对齐"）',
    );
});
