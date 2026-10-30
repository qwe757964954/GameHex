import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    clamp01,
    HEX_FLIP_IDLE_FX,
    HEX_FLIP_LIFT_PIXELS,
    HEX_REVEAL_POP,
    HEX_SHATTER_ERODE_END,
    HEX_SHATTER_FLASH,
    HEX_SHATTER_FLASH_WINDOW,
    HEX_SHATTER_REVEAL_START,
    HEX_SHATTER_SECONDS,
    HEX_SHRINK_MIN_SCALE,
    hexCollapseProgress,
    hexFlipFoldProgress,
    hexFlipGroundGlowStrength,
    hexShatterFx,
    hexShrinkBackFx,
    hexShrinkFx,
} from '../assets/script/core/hex/HexFlipPresentation';
import { assetPath } from './helpers/asset-paths';

/**
 * 领地随机资源格「翻开」的判据。
 *
 * ⚠️ 2026-10-16 口径变更：原先「两套方案随机点将」（`turn` 翻整圈 / `shatter` 原地碎裂）里
 *    用户拍板**只保留破碎那套** ⇒ 方案1 的曲线 / 时长 / 换脸点 / 选型 / `tileSin` 已从
 *    core 删除，着色器里的顶点 3D 旋转 + 透视除法 / 体积明暗 / 侧视淡出 / 补光也一并删除。
 *    所以这里不再有「整圈 cos/sin 必须带符号」「换脸点落在 |cos| = 0」「选型相邻不重复」
 *    那几条用例，取而代之的是**删除的守卫**（方案1 的符号 / uniform 一律不许残留）。
 */

const read = (path: string): string => readFileSync(path, 'utf8');

/** 剥掉注释再断言（rule 104）：注释里抄的表达式/旧值不该被当成实现。 */
const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

// ── 唯一方案：原地快碎裂 → 新地块放大填充 ────────────────────────────────────

test('翻格曲线：全程零位移零旋转零缩放（「原地」碎裂），碎裂进度到 0.55 后停在满值', () => {
    const start = hexShatterFx(0);
    assert.equal(start.tileLift, 0);
    assert.equal(start.tileFlip, 1, '不旋转');
    assert.equal(start.tileScale, 1, '不缩整格');
    assert.equal(start.shatter, 0, '起手完好');
    assert.equal(start.revealScale, 0, '新地皮还没出现');
    assert.equal(start.flash, 0);
    assert.equal(start.hidden, false);
    assert.equal(start.buildingPopScale, 1, '翻格不影响建筑');

    // 「原地」的判据：整段都不许有位移 / 旋转 / 整格缩放。这三条也是着色器能删掉顶点 3D 段的前提。
    for (const k of [0, 0.2, HEX_SHATTER_ERODE_END, 0.8, 1]) {
        const fx = hexShatterFx(k);
        assert.equal(fx.tileLift, 0, `k=${k} 不得有位移（需求原文「原地」）`);
        assert.equal(fx.tileFlip, 1, `k=${k} 不得旋转`);
        assert.equal(fx.tileScale, 1, `k=${k} 不得缩整格（格心放大写在子节点上）`);
    }

    // 碎裂进度：单调不减，到 ERODE_END 满值，之后**保持满值**（旧地皮要一直「碎没了」，
    // 否则新地皮长大到一半会从碎片底下露出一块旧地皮）。
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
        const fx = hexShatterFx(i / 100);
        assert.ok(fx.shatter! >= previous - 1e-9, `碎裂进度不得回退（k=${i / 100}）`);
        previous = fx.shatter!;
    }
    assert.equal(hexShatterFx(HEX_SHATTER_ERODE_END).shatter, 1);
    assert.equal(hexShatterFx(0.8).shatter, 1);
    assert.equal(hexShatterFx(1).shatter, 1, '碎完之后必须停在 1，不能回 0');

    assert.deepEqual(hexShatterFx(-1), start);
});

test('新地皮放大段从 0 到 1，末尾轻微过冲再收回（不是弹跳）', () => {
    assert.ok(HEX_SHATTER_REVEAL_START > 0 && HEX_SHATTER_REVEAL_START < HEX_SHATTER_ERODE_END,
        '放大要**早于**碎裂结束（留一段重叠），否则会有一段「格子全空」的空窗');
    for (const k of [0, 0.2, HEX_SHATTER_REVEAL_START]) {
        assert.equal(hexShatterFx(k).revealScale, 0, `k=${k} 新地皮还没出现`);
    }
    assert.equal(hexShatterFx(1).revealScale, 1, '终点必须正好铺满（不能停在 1 以外）');

    // 旧地皮碎完的那一刻，新地皮还很小（重叠但不喧宾夺主）。
    const handover = hexShatterFx(HEX_SHATTER_ERODE_END).revealScale!;
    assert.ok(handover > 0 && handover < 0.25, `碎完时新地皮该还很小，实际 ${handover}`);

    // 先涨过 1 再收回：峰值之前单调不降、之后单调不升（是「填充过冲」而不是「弹跳」）。
    let peak = 0;
    let peakAt = 0;
    for (let i = 0; i <= 200; i += 1) {
        const scale = hexShatterFx(i / 200).revealScale!;
        if (scale > peak) {
            peak = scale;
            peakAt = i / 200;
        }
    }
    assert.ok(peak > 1, `末尾该有过冲（长到略大于 1 再收回），实际峰值 ${peak}`);
    assert.ok(peak <= 1 + HEX_REVEAL_POP + 1e-9, `过冲不得超过 HEX_REVEAL_POP，实际 ${peak}`);

    let previous = 0;
    for (let i = 0; i <= 200; i += 1) {
        const k = i / 200;
        const scale = hexShatterFx(k).revealScale!;
        if (k <= peakAt) assert.ok(scale >= previous - 1e-9, `峰值前不得回退（k=${k}）`);
        else assert.ok(scale <= previous + 1e-9, `峰值后必须收回（k=${k}）`);
        previous = scale;
    }
});

test('起手白闪在窗口内冲上去再退掉，窗口之外恒 0', () => {
    assert.equal(hexShatterFx(0).flash, 0);
    assert.equal(hexShatterFx(HEX_SHATTER_FLASH_WINDOW).flash, 0, '窗口末端刚好归零');
    for (const k of [0.2, 0.5, 1]) {
        assert.equal(hexShatterFx(k).flash, 0, `k=${k} 白闪已退掉`);
    }
    const peak = hexShatterFx(HEX_SHATTER_FLASH_WINDOW / 2).flash!;
    assert.ok(Math.abs(peak - HEX_SHATTER_FLASH) < 1e-9, `峰值应是 ${HEX_SHATTER_FLASH}，实际 ${peak}`);
    // 窗口内先升后降。
    assert.ok(hexShatterFx(0.04).flash! > hexShatterFx(0.01).flash!);
    assert.ok(hexShatterFx(0.12).flash! < hexShatterFx(0.08).flash!);
});

// ── 不变的部分：静止态 / 对局的两条收场曲线 / 塌陷轴 / 底光 ─────────────────────

test('静止态是只读单例，曲线产出的对象都是新对象', () => {
    assert.equal(HEX_FLIP_IDLE_FX.tileLift, 0);
    assert.equal(HEX_FLIP_IDLE_FX.tileFlip, 1);
    assert.equal(HEX_FLIP_IDLE_FX.tileScale, 1);
    assert.ok(!hexShatterFx(0).hidden && !hexShatterFx(1).hidden);
    // 领地翻格不影响建筑：buildingPopScale 恒 1。
    for (const fx of [hexShatterFx(0.2), hexShatterFx(0.7)]) {
        assert.notEqual(fx, HEX_FLIP_IDLE_FX);
        assert.equal(fx.buildingPopScale, 1);
        assert.equal(fx.glowRadius, 0);
    }
    // 对局缩没 / 缩回段：建筑还没长出来（buildingPopScale 0），其余仍是新对象。
    for (const fx of [hexShrinkFx(0.6), hexShrinkBackFx(0.4)]) {
        assert.notEqual(fx, HEX_FLIP_IDLE_FX);
        assert.equal(fx.buildingPopScale, 0, '对局缩没段建筑还没长出来（要等卡牌淡出那段才换上来）');
        assert.equal(fx.glowRadius, 0);
    }
});

/**
 * 🔴 回归（2026-10-15）：对局的收场**不许有任何位移**。
 *
 * 之前是「先抬起一段、停在最高点再缩」—— 格心整段动画都在往上跑，
 * 缩没读起来是「飞走并变小」而不是「原地收掉」，格内图标 / 价格数字的中心也跟着偏。
 * 现在整条曲线 `tileLift` 恒 `0`：中心点坐标不变，缩放绕它走 ⇒ 原地缩。
 */
test('缩没段：全程零位移（中心点坐标不变），只缩不压扁，末尾停在最小尺寸', () => {
    const start = hexShrinkFx(0);
    assert.equal(start.tileScale, 1, '起手是原尺寸');
    assert.equal(start.tileFlip, 1);

    for (const k of [0, 0.15, 0.135, 0.45, 0.7, 1]) {
        assert.equal(hexShrinkFx(k).tileLift, 0, `k=${k} 不得有位移（原地缩）`);
    }
    // 反向守卫：抬升常量本身不能被清零 —— 它现在没有「抬起曲线」可服务了，但仍是底光那两条
    // 式子的**归一化分母**（`hexFlipFoldProgress` / `hexFlipGroundGlowStrength`），别顺手删掉。
    assert.ok(HEX_FLIP_LIFT_PIXELS > 0);

    // 与「原地碎裂」那条的差别只在 `tileScale` / `buildingPopScale`，其余同口径（两条都「原地」）。
    const shrink = hexShrinkFx(0.5);
    const shatter = hexShatterFx(0.5);
    assert.equal(shrink.hidden, shatter.hidden);
    assert.equal(shrink.tileLift, shatter.tileLift, '两条都不许有位移');
    assert.equal(shrink.tileFlip, shatter.tileFlip, '两条都不旋转');
    assert.equal(shrink.glowRadius, shatter.glowRadius);
    assert.equal(shrink.glowAlpha, shatter.glowAlpha);
    assert.ok(shrink.tileScale < shatter.tileScale, '缩没收整格，碎裂不收');
    assert.equal(shatter.tileScale, 1, '碎裂不动格根缩放（新地皮放大写在子节点上）');
    assert.equal(shrink.buildingPopScale, 0, '对局缩没段建筑还没长出来');
    assert.equal(shatter.buildingPopScale, 1, '领地翻格不影响建筑');

    // 两段式取消后不该留空窗：整段都在缩，中点就已经明显小于 1 了。
    const mid = hexShrinkFx(0.5);
    assert.equal(mid.tileFlip, 1, '对局不压扁地块');
    assert.ok(mid.tileScale < 1 && mid.tileScale > HEX_SHRINK_MIN_SCALE,
        `中点应已开始收（前 45% 不再是空窗），实际 ${mid.tileScale}`);

    const end = hexShrinkFx(1);
    assert.ok(Math.abs(end.tileScale - HEX_SHRINK_MIN_SCALE) < 1e-9, '终点必须是 0.1');
    assert.equal(end.tileLift, 0);
    assert.equal(end.hidden, false, '缩没段本身不负责隐藏（隐藏是下一段的事）');
    // 进度越界按边界处理（超时的激活事件不该算出负抬升 / 放大到 1 以外）。
    assert.deepEqual(hexShrinkFx(-1), start);
    assert.deepEqual(hexShrinkFx(2), end);
    // 缩放单调收小（easeInCubic 的末段最快）。
    for (const k of [0.2, 0.5, 0.8]) {
        assert.ok(hexShrinkFx(k + 0.1).tileScale < hexShrinkFx(k).tileScale, `k=${k} 之后应更小`);
    }
});

test('缩没段零位移的连带影响：底部开口光不再点亮（那道光画的是抬起后露出的开口）', () => {
    // `hexFlipGroundGlowStrength` 的强度里含 `clamp01(tileLift / HEX_FLIP_LIFT_PIXELS)`：
    // 现在**没有任何曲线产出非零抬升**（碎裂 / 缩没 / 脉冲都是「原地」）⇒ 整段恒不点亮。
    // ⚠️ 别为了让这道光亮起来把 `tileLift` 填回非零 —— 那等于把「原地」这条需求破坏掉。
    // 反向守卫：式子本身**能**亮（抬到位就该亮），免得把「恒灭」误读成式子写坏了。
    assert.ok(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1) > 0, '式子本身没问题：抬起时应当点亮');
    for (const k of [0, 0.3, 0.6, 1]) {
        const fx = hexShrinkFx(k);
        const collapseFlip = 1 - hexCollapseProgress(fx.tileFlip, fx.tileScale);
        assert.equal(hexFlipGroundGlowStrength(fx.tileLift, collapseFlip), 0, `k=${k} 底光恒灭`);
    }
    // 碎裂全程不抬 ⇒ 底光恒灭（「原地碎裂」不该有「露出开口」那道光）。
    for (const k of [0, 0.3, 0.7, 1]) {
        assert.equal(hexFlipGroundGlowStrength(hexShatterFx(k).tileLift, hexShatterFx(k).tileFlip), 0);
    }
});

test('缩回段：同样零位移，末尾回到原尺寸', () => {
    const start = hexShrinkBackFx(0);
    assert.ok(Math.abs(start.tileScale - HEX_SHRINK_MIN_SCALE) < 1e-9, '接力点仍在最小尺寸');
    assert.equal(start.tileLift, 0, '接力点没有位移');

    const mid = hexShrinkBackFx(0.5);
    assert.ok(mid.tileScale > HEX_SHRINK_MIN_SCALE && mid.tileScale < 1);
    assert.equal(mid.tileLift, 0, '缩回全程不许有位移');

    const end = hexShrinkBackFx(1);
    assert.equal(end.tileLift, 0);
    assert.equal(end.tileScale, 1);
    assert.equal(end.tileFlip, 1);
    assert.equal(end.hidden, false, '缩回全程可见 —— 不能落在「整格隐藏」上');
});

test('塌陷轴：两种收场（压扁 / 缩没）换出同一条进度，底部光不用各写一套', () => {
    // 完好态：两根轴都报 0。
    assert.equal(hexCollapseProgress(1, 1), 0);
    // 压扁收场：塌陷轴 = 1 − flip。
    assert.ok(Math.abs(hexCollapseProgress(0.25, 1) - 0.75) < 1e-9);
    // 缩没收场：塌陷轴由缩放反推，终点与压扁一样到 1。
    assert.equal(hexCollapseProgress(1, HEX_SHRINK_MIN_SCALE), 1);
    const half = hexCollapseProgress(1, (1 + HEX_SHRINK_MIN_SCALE) / 2);
    assert.ok(Math.abs(half - 0.5) < 1e-9, `缩到一半应报 0.5，实际 ${half}`);
    // 越界 clamp：池化复用回来的脏值不该产出 <0 / >1 的进度。
    assert.equal(hexCollapseProgress(1, 2), 0);
    assert.equal(hexCollapseProgress(1, -1), 1);
});

test('地面光斑强度：翻到侧视前平滑归零，抬升为 0 时不亮', () => {
    assert.equal(hexFlipGroundGlowStrength(0, 1), 0, '没抬起来就不该有光斑');
    const peak = hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1);
    assert.ok(peak > 0);
    // 压扁到侧视（→ 0）时归零：那会儿地块只剩一条线，留着光带会读成悬空亮片。
    assert.equal(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 0), 0);
    // 缩没也走同一条「等价 flip」：缩到底时同样归零。
    assert.equal(hexFlipGroundGlowStrength(HEX_FLIP_LIFT_PIXELS, 1 - hexCollapseProgress(1, HEX_SHRINK_MIN_SCALE)), 0);
    assert.ok(clamp01(2) === 1 && clamp01(-3) === 0);
});

/**
 * `hexFlipFoldProgress` 的两个分支都要能到：`tileFlip >= 1` 走「抬升段」，`< 1` 走「压扁段」。
 *
 * ⚠️ 现在只有**对局的缩没段**会走压扁分支（它传的是 `hexCollapseProgress` 换出来的等价 flip）；
 * 领地的碎裂 `tileFlip` 恒 `1` ⇒ 走抬升分支，而 `tileLift` 也恒 `0` ⇒ 恒得第 0 帧
 * （这道光在领地本来就不点亮）。
 */
test('底光帧序推导：抬升段与压扁段各走一个分支，脏输入不产出越界帧号', () => {
    // 抬升段：按抬升量归一化 —— 不抬就是第 0 帧；抬满落在 (0,1) 中间（后面还有压扁段要占）。
    assert.equal(hexFlipFoldProgress(0, 1), 0, '不抬 ⇒ 第 0 帧');
    const lifted = hexFlipFoldProgress(HEX_FLIP_LIFT_PIXELS, 1);
    assert.ok(lifted > 0 && lifted < 1, `抬满应落在段内，实际 ${lifted}`);
    // 压扁段：由「离开正面多少」推进，越接近侧视帧序越靠后，压到侧视正好末帧。
    const quarter = hexFlipFoldProgress(0, 0.75);
    const nearSide = hexFlipFoldProgress(0, 0.05);
    assert.ok(quarter < nearSide && nearSide < 1, `越接近侧视越靠后，实际 ${quarter} → ${nearSide}`);
    assert.equal(hexFlipFoldProgress(0, 0), 1, '压到侧视 ⇒ 末帧');
    // 池化复用 / 超时事件可能带回脏值：一律 clamp 到 [0,1]，不许 NaN。
    for (const [lift, flip] of [[-5, 1], [1e6, 1], [0, -1], [0, 2]]) {
        const progress = hexFlipFoldProgress(lift, flip);
        assert.ok(Number.isFinite(progress) && progress >= 0 && progress <= 1, `(${lift}, ${flip}) ⇒ ${progress}`);
    }
});

// ── 两处必须共用同一份（这是「领地翻格与游戏内共用这套体验」的判据） ──────────

test('领地的曲线 / 时长 / 碎块参数都由 core 提供，领地侧不自算一套', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    assert.match(flip, /from '\.\.\/\.\.\/\.\.\/core\/hex\/HexFlipPresentation'/,
        '领地翻格必须从 core 的共用模块取曲线与参数');
    for (const symbol of [
        'hexShatterFx', 'HEX_SHATTER_SECONDS', 'HEX_SHATTER_ERODE_END',
        'HEX_SHATTER_GRID_X', 'HEX_SHATTER_GRID_Y', 'HEX_SHATTER_JITTER',
    ]) {
        assert.ok(flip.includes(symbol), `领地翻格应复用 ${symbol}`);
    }
    // 不许把时长 / 换脸点写死在领地侧（0.68 / 0.55）。
    assert.doesNotMatch(flip, /0\.68|0\.55/, '不许把时长 / 换脸点写死在领地侧');
    // 只剩一套方案 ⇒ 时长**只有 core 一份**：领地侧不许再造「自己的时长」别名 / 第二份字面量。
    assert.doesNotMatch(flip, /TERRITORY_HEX_FLIP_MAX_SECONDS/,
        '不许再造领地自己的时长常量 —— 时长只存在 core 的 HEX_SHATTER_SECONDS，别再 Math.max 也别再别名转发');
    // 与着色器同一套 uniform 协议（碎裂只用到这 6 个）+ 同一个半高来源（两块地都是 126×117 的整图）。
    for (const uniform of [
        'flipCenter', 'flipHalfHeight', 'flipHalfWidth',
        'flashParams', 'shatterParams', 'shardGrid',
    ]) {
        assert.ok(flip.includes(`'${uniform}'`), `领地翻格应写材质参数 ${uniform}`);
    }
    // 方案1 专属的参数一个都不许留（着色器里也已删除）。
    for (const gone of ['flipCos', 'flipSin', 'flipPerspective', 'turnParams', 'glowStrength']) {
        assert.ok(!flip.includes(`'${gone}'`), `方案1 删除后不该再写材质参数 ${gone}`);
    }
    // 半尺寸必须由**格子实际尺寸**派生（帧到位后是 126×117，与设计常量 130×119 差一圈），
    // 取不到才退回整图常量。
    assert.match(flip, /readTileHalfSize/, 'flipHalfHeight / flipHalfWidth 要由格子的实际尺寸派生');
    assert.match(flip, /HEX_GRID_IMAGE_HEIGHT/, '取不到实际尺寸时要退回整图常量');
    assert.match(flip, /getComponent\(UITransform\)/, '实际尺寸要从 UITransform 读');
});

test('对局的脉冲 + 缩没曲线都来自 core（两边共用模块），且对局不掺领地的碎裂方案', () => {
    const view = stripComments(read('assets/script/app/zcds/view/ZCHexView.ts'));
    // 收场的**形状**两边不同（对局 = 原地脉冲呼吸 + 原地缩没，领地 = 原地碎裂），
    // 但曲线都落在 core 的同一个模块里（对局没有自己写一套呼吸 / 缩没曲线）。
    assert.match(view, /from '\.\.\/\.\.\/\.\.\/core\/hex\/HexFlipPresentation'/,
        '对局的脉冲 / 缩没曲线必须从 core 取');
    assert.match(view, /hexPulseFx\(/, '对局的脉冲段应直接调 core 的呼吸曲线');
    // 🔴 2026-10-15：脉冲段之后接**缩没段**（用户口径「水波纹 + 缩没两段都要」）——
    // 这一段曾因 SVN 冲突整个丢失（用户报「点击地块收缩替换的动画丢失」），守卫必须钉住它在。
    assert.match(view, /hexShrinkFx\(/,
        '对局的缩没段应直接调 core 的缩没曲线（收场 = 脉冲 + 缩没，缺一不可）');
    assert.doesNotMatch(view, /hexShrinkBackFx\(/,
        '对局只用「缩掉」那一条，不播反向回缩（回场直接原尺寸）');
    // 对局不碰领地的那条（对局地块是合批的，挂自定义材质会整格退出合批 ⇒ 不能挂 hex-flip）。
    assert.doesNotMatch(view, /hexShatterFx/,
        '对局不许接领地的翻格曲线，别把两条路径混着调');

    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    // 领地没有卡牌揭示接棒 ⇒ 永远不走「整格隐藏」（`hidden` 由 idle 常量给出，恒 false）。
    assert.doesNotMatch(flip, /hidden:\s*true/, '领地翻格不能进整格隐藏段（会露出棋盘底）');
});

test('领地的底部发光也用同一份序列帧，位置抵消父节点上移', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    assert.match(flip, /setGroundGlowFrames/, '领地播放器要提供序列帧注入入口');
    assert.match(flip, /HEX_FLIP_GLOW_MASK_OFFSET_Y - fx\.tileLift/,
        '光带下沿要钉在原格开口（父节点抬多少、Sprite 往下补多少）');
    assert.match(flip, /hexFlipFoldProgress\(/, '帧序按翻面段进度推导（与对局同一套）');
    assert.match(flip, /hexFlipGroundGlowStrength\(/, '亮灭判断也要走 core 的共用强度');
    // ⚠️ 碎裂不抬起 ⇒ 这道光恒灭（强度式子里的抬升项恒 0）—— 它现在只是「关灯 + 复用同一份
    // 推导」的通道，不是「有东西会亮」的通道。别为了让底光出现去伪造抬升量。
    assert.doesNotMatch(flip, /hex-ground-glow/, '不再走 shader 版底光');

    // 地图格子上的 GroundGlow 子节点由 TerritoryMapView 挂：序列帧必须 RAW（8 帧同画布，尺寸跟帧走）。
    const mapView = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.match(mapView, /new Node\('GroundGlow'\)/, '格子要挂 GroundGlow 子节点');
    assert.match(mapView, /SizeMode\.RAW/, '序列帧必须 RAW：尺寸由帧决定，别写死高度');
});

test('「新地皮」写在子节点上，池化复用要还原（倍率与显隐都收口）', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    // 放大写 Reveal 子节点、**不动格根**（格根缩放归对局的缩没段）。
    assert.match(flip, /TERRITORY_HEX_REVEAL_NODE = 'Reveal'/, '子节点名要导出（视图按它挂）');
    const reveal = /private applyReveal[\s\S]*?\n    \}/.exec(flip);
    assert.ok(reveal, '没读到 applyReveal');
    assert.match(reveal![0], /reveal\.node\.setScale\(/, '放大要写在 Reveal 子节点上');
    assert.match(reveal![0], /reveal\.node\.active !== visible/, '倍率 0 时整个节点要收起');
    assert.doesNotMatch(reveal![0], /(?<![.\w])node\.setScale\(/, 'applyReveal 不许动格根缩放');
    // 复位路径必须把缩放还原（否则下一次播放会从「半个格子」开始）。
    const hide = /private hideReveal[\s\S]*?\n    \}/.exec(flip);
    assert.ok(hide, '没读到 hideReveal');
    assert.match(hide![0], /reveal\.node\.setScale\(1, 1, 1\)/, '收起时要还原缩放');

    const mapView = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.match(mapView, /new Node\(TERRITORY_HEX_REVEAL_NODE\)/, '格子要挂 Reveal 子节点');
});

test('碎裂的接线：一个时长 + 一个换脸点，每帧重写旧 / 新地皮，播完落回新地皮', () => {
    const flip = stripComments(read('assets/script/app/territory/view/TerritoryHexFlip.ts'));
    // 只有一条曲线 ⇒ 播完判据与进度归一化都直接取 core 的时长。
    assert.match(flip, /elapsed >= HEX_SHATTER_SECONDS/, '播完判据按 core 的时长');
    assert.match(flip, /hexShatterFx\(elapsed \/ HEX_SHATTER_SECONDS\)/, '进度按 core 的时长归一化');
    // 方案选型的残留必须清掉（随机点将 / 每格方案 / 按时长选择）。
    assert.doesNotMatch(flip, /variant|pickHexFlipVariant|totalSecondsOf|hexTurnFx|tileSin/,
        '方案选型与 tileSin 的残留必须清掉');
    // 换脸点每帧重写 ⇒ `paintHexes` 的全量重绘顶掉也不会「碎到一半换地皮」。
    const face = /private applyFace[\s\S]*?\n    \}/.exec(flip);
    assert.ok(face, '没读到 applyFace');
    assert.match(face![0], /active\.elapsed \/ HEX_SHATTER_SECONDS >= HEX_SHATTER_ERODE_END/,
        '换脸点要落在「旧地皮已碎没」那一帧');
    assert.match(face![0], /sprite\.spriteFrame !== frame/, '每帧比对引用（自愈被 paintHexes 顶掉的帧）');
    // 打断时落回**新地皮**（否则永远停在泥巴块）。
    const settle = /private settle[\s\S]*?\n    \}/.exec(flip);
    assert.ok(settle, '没读到 settle');
    assert.match(settle![0], /sprite\.spriteFrame !== active\.toFrame/, 'settle 要落回新地皮');
    assert.match(settle![0], /sprite\.customMaterial = null/, '必须摘回内置材质（否则永久退出合批）');
    // 「原地」⇒ 不许再动画家排序（早先那套翻整圈才需要「抬起期间提到同层末位」）。
    assert.doesNotMatch(flip, /reindex|raised|homeIndex|setSiblingIndex/, '原地碎裂不该再动画家排序');
});

test('领地翻格的触发只在首帧快照之后（免得历史已开启格一次性全播）', () => {
    const mapView = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.match(mapView, /hexFlipBootstrapped/, '缺少首帧快照开关 ⇒ 进页面会闪一串翻格');
    assert.match(mapView, /update\(dt: number\): void \{\s*this\.hexFlip\.step\(dt\)/,
        '翻格要挂在每帧推进上');
    const play = /private syncFlip[\s\S]*?\n    \}/.exec(mapView);
    assert.ok(play, '没读到 syncFlip');
    assert.match(play![0], /if \(!this\.hexFlipBootstrapped\)[\s\S]*?return;/,
        '首帧必须先做快照再返回，不能直接播');
    // 点击那一帧 `paintHexes` 已把地皮换成新的 ⇒ **旧地皮必须显式传进来**，否则读不出「翻开」。
    assert.match(play![0], /from: input\.art\.tileLocked/, '要把旧地皮传给播放器');
    assert.match(play![0], /to: input\.art\.tileCleared/, '要把新地皮传给播放器');
});

// ── 着色器（只剩「原地碎裂」那部分） ──────────────────────────────────────────

const HEX_FLIP_EFFECT = assetPath('shaders/hex-flip.effect');

/** 碎裂那一段用到的 uniform（顶点 / 片元两块必须一字不差）。 */
const UNIFORM_MEMBERS = [
    'flipCenter', 'flipHalfHeight', 'flipHalfWidth', 'flashParams', 'shatterParams', 'shardGrid',
];

/** 取 `uniform HexFlip { ... }` 的成员名（按声明顺序）。 */
const uniformMembers = (source: string): string[][] => [...stripComments(source)
    .matchAll(/uniform\s+HexFlip\s*\{([\s\S]*?)\}/g)]
    .map((match) => match[1]
        .split(';')
        .map((line) => line.trim().split(/\s+/).pop() ?? '')
        .filter((name) => name.length > 0));

test('着色器的两段 uniform 块必须逐字一致（layout 不一致会静默错读）', () => {
    const blocks = uniformMembers(read(HEX_FLIP_EFFECT));
    assert.equal(blocks.length, 2, '顶点 / 片元各要有一份 HexFlip 块');
    assert.deepEqual(blocks[0], blocks[1], '两段的成员与顺序必须一模一样');
    assert.deepEqual(blocks[1], UNIFORM_MEMBERS, 'uniform 成员表变了就要同步这句与写侧');
});

test('着色器：碎裂由 shatterParams.x 总开关包住，为 0 时逐像素等价「没有碎裂」', () => {
    const shader = stripComments(read(HEX_FLIP_EFFECT));
    assert.match(shader, /if\s*\(\s*shatterParams\.x\s*>\s*0\.5\s*\)/,
        '碎裂整段必须挂在 shatterParams.x 上（起手那几帧与静止态都不该被影响）');
    // 碎块划分用格内归一化坐标，**不能用 a_texCoord**（SpriteFrame 可能裁剪 / 进图集）。
    assert.match(shader, /vQuad = vec2\(clamp\(lx \/ hw/, 'vQuad 要由格内世界坐标归一化得到');
    assert.match(shader, /for \(int oy = -1/, '碎块划分要走 3×3 邻域的 Voronoi');
    // 遮罩必须**先乘后加裂缝**：先加会被自己那圈 `shardMask < 1` 抹掉。
    const maskAt = shader.indexOf('result *= shardMask');
    const seamAt = shader.indexOf('result.rgb += mix(color.rgb, vec3(1.0), 0.65) * seam');
    assert.ok(maskAt > 0 && seamAt > maskAt, '裂缝亮线要在遮罩之后叠加');
});

/**
 * 🔴 2026-10-16 删除守卫：方案1（翻整圈）在着色器里的四段 —— 顶点 3D 旋转 + 透视除法、
 * 体积明暗、侧视淡出、正面开口补光 —— 必须一个不剩。
 *
 * 删掉它们**逐像素等价**，因为碎裂曲线全程 `tileFlip(cos) = 1` 且 `tileLift = 0`。
 * 留着才是危险的：那些是只服务另一套方案的死代码，混进来会让人以为还有一条旋转路径。
 */
test('着色器：方案1 的顶点 3D / 明暗 / 淡出 / 补光四段已删除，顶点不再做形变', () => {
    const shader = stripComments(read(HEX_FLIP_EFFECT));
    for (const gone of [
        'flipCos', 'flipSin', 'flipPerspective', 'turnParams', 'glowStrength',
        'vDepth', 'vTurn', 'vCos', 'vLocalY', 'faceMask', 'glowPulse',
    ]) {
        assert.ok(!shader.includes(gone), `方案1 删除后不该再留 ${gone}`);
    }
    // 顶点**不许再写坐标**：旋转 / 透视变形没有了，碎裂是「原地」的。
    assert.doesNotMatch(shader, /pos\.[xy]\s*=/, '顶点不该再写 pos.x / pos.y（原地碎裂不需要形变）');
    // 但格内归一化坐标还得算（碎块划分靠它），且必须用**世界坐标 ÷ 实际半尺寸**。
    assert.match(shader, /float u = clamp\(ly \/ hh, -1\.0, 1\.0\)/, 'vQuad 的归一化要保留');
});
