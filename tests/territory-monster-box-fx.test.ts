/**
 * 「巡逻宝箱」数字反馈时间轴（成功率滚动 / 奖励数字刷光）的行为网。
 *
 * ## 为什么要有这条
 *
 * 这两条动效**算错了不会报错，只会「看起来不对劲」**：
 *
 *   · 成功率从 `90%` 直接跳 `60%` ⇒ 玩家看不出「降了」，只觉得界面闪了一下；
 *   · 光带尺寸写死像素 ⇒ 在另一套字号的面板里不是糊住数字就是一细条；
 *   · 亮度包络如果跟着「快出」的位移走 ⇒ 收尾几十毫秒内掉到 0，像被硬切断；
 *   · `progress` 不给「结束」信号 ⇒ 光带永远停在框外，下次开面板还挂在数字旁边。
 *
 * 纯函数、零 `cc` 依赖，直接 import 真实实现（不复制算法）；另加几条源码守卫，
 * 防止有人把「直写数字」或「写死尺寸」重新塞回面板。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    monsterBoxRatePunchAt,
    monsterBoxRateRollAt,
    monsterBoxShineAlphaAt,
    monsterBoxShineBandOf,
    monsterBoxShineProgressAt,
    monsterBoxShineSweepAt,
    monsterBoxShineXAt,
    TERRITORY_MONSTER_BOX_FX,
} from '../assets/script/app/territory/model/TerritoryMonsterBoxFx';

const PANEL_SRC = readFileSync('assets/script/app/territory/view/TerritoryMonsterBoxPanel.ts', 'utf8');

// ------------------------------------------------------------------
// 成功率滚动
// ------------------------------------------------------------------

test('★成功率从旧值滚到新值：两端精确、中途单调、起手先快后慢', () => {
    const { rateRollSeconds } = TERRITORY_MONSTER_BOX_FX;
    // 90 → 60（升到下一级成功率下降）
    assert.equal(monsterBoxRateRollAt(90, 60, 0), 90, '起手就是旧值，不能先跳到新值再滚回去');
    assert.equal(monsterBoxRateRollAt(90, 60, rateRollSeconds), 60);
    assert.equal(monsterBoxRateRollAt(90, 60, rateRollSeconds + 10), 60, '超时也停在终值');

    const samples: number[] = [];
    for (let step = 0; step <= 20; step += 1) {
        samples.push(monsterBoxRateRollAt(90, 60, (rateRollSeconds * step) / 20));
    }
    for (let index = 1; index < samples.length; index += 1) {
        assert.ok(samples[index] <= samples[index - 1], `第 ${index} 帧回涨了：${samples[index - 1]} → ${samples[index]}`);
        assert.equal(Number.isInteger(samples[index]), true, '界面上只有整数百分比');
    }
    // outCubic：到 1/4 时长时已经走过一半以上的变化量（否则小字号上看不出在动）
    const quarter = monsterBoxRateRollAt(90, 60, rateRollSeconds / 4);
    assert.ok((90 - quarter) / 30 > 0.5, `1/4 时长只走了 ${((90 - quarter) / 30).toFixed(2)}，太肉`);
});

test('成功率滚动：脏入参不把 NaN 写进 Label', () => {
    const dirty = monsterBoxRateRollAt(Number.NaN, 60, 0.1);
    assert.ok(Number.isInteger(dirty) && dirty > 0 && dirty < 60, `NaN 起点应按 0 起滚，实际 ${dirty}`);
    assert.equal(monsterBoxRateRollAt(90, Number.NaN, TERRITORY_MONSTER_BOX_FX.rateRollSeconds), 0);
    assert.equal(monsterBoxRateRollAt(90, 60, Number.NaN), 90, 'elapsed 坏了就停在起点，别跳数');
});

test('滚动的「弹一下」：两端都是 1，中间高于 1（收尾不能啪地停住）', () => {
    const { ratePunchPeak, ratePunchSeconds } = TERRITORY_MONSTER_BOX_FX;
    assert.equal(monsterBoxRatePunchAt(0), 1);
    assert.equal(monsterBoxRatePunchAt(ratePunchSeconds), 1);
    assert.equal(monsterBoxRatePunchAt(ratePunchSeconds + 1), 1);
    const peak = monsterBoxRatePunchAt(ratePunchSeconds / 2);
    assert.ok(Math.abs(peak - ratePunchPeak) < 1e-9, `峰值应是 ${ratePunchPeak}，实际 ${peak}`);
    // 两端附近的导数接近 0（sin 的形状）：不会「瞬间放大 / 瞬间归位」
    assert.ok(monsterBoxRatePunchAt(ratePunchSeconds * 0.05) < 1.05);
    assert.ok(monsterBoxRatePunchAt(ratePunchSeconds * 0.95) < 1.05);
});

// ------------------------------------------------------------------
// 刷光：进度 / 位移 / 亮度
// ------------------------------------------------------------------

test('★刷光进度给「结束」信号（-1）：否则光带会常驻在数字旁边', () => {
    const { shineSeconds } = TERRITORY_MONSTER_BOX_FX;
    assert.equal(monsterBoxShineProgressAt(-0.01), -1);
    assert.equal(monsterBoxShineProgressAt(0), 0);
    assert.ok(monsterBoxShineProgressAt(shineSeconds - 1e-6) > 0.99);
    assert.equal(monsterBoxShineProgressAt(shineSeconds), -1);
    assert.equal(monsterBoxShineProgressAt(Number.NaN), -1);
});

test('位移「缓进快出」：中段还没走到一半，末段收干净', () => {
    const { shineSweepEase } = TERRITORY_MONSTER_BOX_FX;
    assert.equal(monsterBoxShineSweepAt(0), 0);
    assert.equal(monsterBoxShineSweepAt(1), 1);
    assert.ok(shineSweepEase > 1, '指数 >1 才是缓进快出');
    assert.ok(Math.abs(monsterBoxShineSweepAt(0.5) - Math.pow(0.5, shineSweepEase)) < 1e-9);
    assert.ok(monsterBoxShineSweepAt(0.5) < 0.5, '中段应该还在框里（慢进）');
    assert.ok(monsterBoxShineSweepAt(0.9) > 0.8, '后段要甩出去（快出）');
    assert.equal(monsterBoxShineSweepAt(-1), 0, '越界收敛，别让带子跑出行程');
    assert.equal(monsterBoxShineSweepAt(2), 1);
});

test('亮度梯形包络：两端 0、中段满、没有光带时恒 0', () => {
    const { shineFade } = TERRITORY_MONSTER_BOX_FX;
    assert.equal(monsterBoxShineAlphaAt(-1), 0, '-1 = 此刻没有刷光');
    assert.equal(monsterBoxShineAlphaAt(0), 0);
    assert.equal(monsterBoxShineAlphaAt(1), 0);
    assert.equal(monsterBoxShineAlphaAt(0.5), 1);
    // 包络的端点处是「刚好淡满」，浮点除法会差最后一位，别用 === 卡死
    assert.ok(Math.abs(monsterBoxShineAlphaAt(shineFade) - 1) < 1e-9);
    assert.ok(Math.abs(monsterBoxShineAlphaAt(1 - shineFade) - 1) < 1e-9);
    // 淡入段单调涨
    let prev = -1;
    for (let step = 0; step <= 10; step += 1) {
        const value = monsterBoxShineAlphaAt((shineFade * step) / 10);
        assert.ok(value >= prev, '淡入段出现回落');
        prev = value;
    }
});

// ------------------------------------------------------------------
// 尺寸：必须按数字 UI 反算（用户原话「刷光特效的大小要匹配数字UI大小」）
// ------------------------------------------------------------------

test('★光带尺寸按数字框反算，窄框有下限、脏值有兜底', () => {
    const { shineBandWidthRatio, shineBandHeightRatio, shineMinBandWidthPx } = TERRITORY_MONSTER_BOX_FX;
    const wide = monsterBoxShineBandOf(100, 40);
    assert.equal(wide.width, Math.round(100 * shineBandWidthRatio));
    assert.equal(wide.height, Math.round(40 * shineBandHeightRatio));

    // 一个 "3" 的窄框：不能被比例算成一根线
    assert.equal(monsterBoxShineBandOf(20, 40).width, shineMinBandWidthPx);
    // 量不到框（0 / NaN）：退化成「小一点的光带」，不能变成「没有光带」
    assert.equal(monsterBoxShineBandOf(0, 0).width, shineMinBandWidthPx);
    assert.ok(monsterBoxShineBandOf(Number.NaN, Number.NaN).height > 0);
    // 尺寸变大方向必须跟着框走（不是写死像素）
    assert.ok(monsterBoxShineBandOf(200, 40).width > wide.width);
});

test('★行程从框外扫到框外：0 在左外、1 在右外、中段单调', () => {
    const width = 120;
    const band = monsterBoxShineBandOf(width, 40).width;
    const bleed = TERRITORY_MONSTER_BOX_FX.shineBleedPx;
    const travel = width + band + bleed * 2;
    assert.ok(Math.abs(monsterBoxShineXAt(0, width, band) + travel / 2) < 1e-9);
    assert.ok(Math.abs(monsterBoxShineXAt(1, width, band) - travel / 2) < 1e-9);
    // 起点必须在框左缘之外（框半宽 + 带半宽），否则会「凭空出现在框里」
    assert.ok(monsterBoxShineXAt(0, width, band) < -(width / 2 + band / 2));
    let prev = -Infinity;
    for (let step = 0; step <= 20; step += 1) {
        const x = monsterBoxShineXAt(step / 20, width, band);
        assert.ok(x >= prev, '行程出现回退');
        prev = x;
    }
    // 框越窄行程越短（尺寸跟着 UI 走）
    assert.ok(monsterBoxShineXAt(1, 40, 18) < monsterBoxShineXAt(1, 200, 18));
});

// ------------------------------------------------------------------
// 面板接线守卫
// ------------------------------------------------------------------

test('★★面板不许直写成功率：值变了必须走 syncSuccessRate 的滚动', () => {
    assert.match(PANEL_SRC, /private syncSuccessRate\(rate: number, hasRate: boolean\): void \{/);
    assert.match(PANEL_SRC, /this\.syncSuccessRate\(content\.successRate, hasRate\);/);
    // 老写法（直接拼字符串）回潮就会「值变了也不过渡」
    assert.doesNotMatch(PANEL_SRC, /rateLabel\.string = hasRate \?/);
});

test('★★刷光只由「同一种资源 + 文案变了」触发（同一份内容重复重绘不能每次都闪）', () => {
    assert.match(PANEL_SRC, /private rewardSignatures: IMonsterBoxRewardSignature\[\] = \[\];/);
    assert.match(
        PANEL_SRC,
        /if \(!before \|\| before\.resId !== after\.resId \|\| before\.text === after\.text\) continue;/,
    );
    // 首趟铺数据（没有上一趟）不演
    assert.match(PANEL_SRC, /private startRewardShine\(index: number, startedAt: number\): void \{/);
});

test('★★光带尺寸取自数字 Label 的 UITransform（不是写死像素）', () => {
    assert.match(PANEL_SRC, /const band = monsterBoxShineBandOf\(label\?\.width \?\? 0, label\?\.height \?\? 0\);/);
    assert.match(PANEL_SRC, /transform\.setContentSize\(band\.width, band\.height\);/);
    // 尺寸必须 CUSTOM：TRIMMED 会让节点跟帧裁剪尺寸走，宽度就匹配不上数字框
    assert.match(PANEL_SRC, /sprite\.sizeMode = Sprite\.SizeMode\.CUSTOM;/);
    // 插在数字 Label 之前 = 文字之下（盖在数字上会糊住数值）
    assert.match(PANEL_SRC, /parent\.insertChild\(node, target\.getSiblingIndex\(\)\);/);
});

test('刷光贴图走 bundleForPath（图在 main-pages 分包，不路由会直接报 doesn\'t contain）', () => {
    assert.match(PANEL_SRC, /const SHINE_FRAME_PATH = 'image\/card_effect_levelup\/shine\/spriteFrame';/);
    assert.match(PANEL_SRC, /this\.assets\.load\(SHINE_FRAME_PATH, SpriteFrame, \{ bundle: bundleForPath\(SHINE_FRAME_PATH\) \}\)/);
});

test('★每次 open 重拉贴图：作用域重建后上一趟的帧已被释放（不清就第二次开面板没刷光）', () => {
    assert.match(PANEL_SRC, /this\.shineFrame = null;\s*\n\s*this\.shineLoaded = false;/);
    assert.match(PANEL_SRC, /private loadShineFrame\(\): void \{\s*\n\s*if \(this\.shineLoaded\) return;/);
});

test('两条时间轴都在 update 里驱动（不另起 tween / schedule）', () => {
    assert.match(PANEL_SRC, /this\.stepRateRoll\(\);/);
    assert.match(PANEL_SRC, /this\.stepRewardShines\(\);/);
    // 时长常量只在 model 里；面板出现魔数就说明有人又算了一条时间
    assert.doesNotMatch(PANEL_SRC, /\* 1000\) \/ \d{3,}/, '面板不该自己除毫秒常量');
    assert.match(PANEL_SRC, /TERRITORY_MONSTER_BOX_FX\.rateRollSeconds/);
});

test('关面板 / 换格子把数字过渡态清干净（不然下次打开带着半截数字和光带）', () => {
    assert.match(PANEL_SRC, /private clearNumberFx\(\): void \{/);
    assert.match(PANEL_SRC, /this\.clearNumberFx\(\);/);
    assert.match(PANEL_SRC, /if \(this\.content && this\.content\.cellId !== content\.cellId\) this\.clearNumberFx\(\);/);
});
