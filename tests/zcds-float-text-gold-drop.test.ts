import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 金币飘字「掉落原地 + 迅速缩小消失」（2026-10-23 用户口径）。
 *
 * > 「战斗内击杀，掉落的金币动画修改：从上升的动画改成掉落在原地，迅速缩小消失」
 *
 * 改前金币和伤害共用一套「快进慢出」：`y = offsetY + enter × riseDistance` —— 数字和金币图标
 * 一路往上爬 46px，最后被调透明度。掉落物往上飞，读起来像"战利品逃跑了"。
 *
 * 现在走 `ZCGameViewUtil.floatTextGoldDrop`，三段：
 *
 * | 段 | 区间（占整条时长） | 表现 |
 * | --- | --- | --- |
 * | 掉落 | 0 ~ 30% | 从落点上方 18px **加速**落到落点（`k²`），1.18 → 1，图标转一圈 |
 * | 停住 | 30% ~ 45% | 完全静止 —— 「掉落在原地」 |
 * | 缩没 | 45% ~ 100% | 边长 `1 - k²` 加速缩到 0，同时淡出 |
 *
 * 本用例钉的四件事：
 *  1. **只往下、不往上**（`drop >= 0` 全程成立）—— 一旦变负就是又飘起来了；
 *  2. 三段各自的端点精确（起点 18px / 落地 0 / 停住不动 / 末尾 scale 与 fade 都是 0）；
 *  3. 单调：`drop` 单调不增、缩小段 `scale` 单调不增（不许"缩一下又弹回来"）；
 *  4. 接线：视图真的用了这条曲线，且**没有**再碰 `riseDistance` / `floatTextEntrance`（金币）；
 *     模型侧的金币时长也确实压到了「迅速」的量级。
 */

const VIEW_PATH = 'assets/script/app/zcds/view/ZCFloatTextView.ts';
const UTIL_PATH = 'assets/script/app/zcds/view/ZCGameViewUtil.ts';
const MODEL_PATH = 'assets/script/app/zcds/model/ZCGameModel.ts';

function util() {
    return loadViews().load('./ZCGameViewUtil') as Record<string, any>;
}

/** 按 1/240 采样整条（含两端），抓边界与抖动。 */
function sample(step = 1 / 240): number[] {
    const out: number[] = [];
    for (let p = 0; p <= 1 + 1e-9; p += step) out.push(Number(p.toFixed(4)));
    out.push(1);
    return out;
}

test('金币只往下落：全程 drop ≥ 0（值一旦为负就是"又飘起来了"）', () => {
    const { floatTextGoldDrop, FLOAT_TEXT_GOLD_DROP_PX } = util();
    for (const progress of sample()) {
        const frame = floatTextGoldDrop(progress);
        assert.ok(frame.drop >= -1e-9, `t=${progress} 的 drop=${frame.drop}，金币不许向上飘`);
        assert.ok(frame.drop <= FLOAT_TEXT_GOLD_DROP_PX + 1e-9, `t=${progress} 掉得比起点还高`);
    }
});

test('三段端点：起点在 18px 高、落地归 0、停住不动、末尾缩没', () => {
    const { floatTextGoldDrop, FLOAT_TEXT_GOLD_DROP_PX, FLOAT_TEXT_GOLD_DROP_SPAN, FLOAT_TEXT_GOLD_HOLD_SPAN, FLOAT_TEXT_GOLD_POP } = util();
    const dropSpan = FLOAT_TEXT_GOLD_DROP_SPAN as number;
    const holdEnd = dropSpan + (FLOAT_TEXT_GOLD_HOLD_SPAN as number);

    const start = floatTextGoldDrop(0);
    assert.equal(start.drop, FLOAT_TEXT_GOLD_DROP_PX, '起手应在落点上方 18px');
    assert.equal(start.scale, FLOAT_TEXT_GOLD_POP, '起手带一点弹出');
    assert.equal(start.fade, 1);
    assert.equal(start.spin, 0, '起手不自转');

    const landed = floatTextGoldDrop(dropSpan);
    assert.ok(Math.abs(landed.drop) < 1e-9, `落地应归 0，实测 ${landed.drop}`);
    assert.ok(Math.abs(landed.scale - 1) < 1e-9, '落地收回 1');
    assert.equal(landed.spin, 1, '落地正好转满一圈');

    for (const progress of [dropSpan + 0.01, holdEnd * 0.99]) {
        const held = floatTextGoldDrop(progress);
        assert.equal(held.drop, 0, `t=${progress} 停住段不该再移动`);
        assert.equal(held.scale, 1, `t=${progress} 停住段不该缩放`);
        assert.equal(held.fade, 1, `t=${progress} 停住段不该变淡`);
    }

    const gone = floatTextGoldDrop(1);
    assert.equal(gone.scale, 0, '末尾必须缩到 0');
    assert.equal(gone.fade, 0, '末尾必须淡到 0（不能留一张 0.02 的残影）');
});

test('单调：下落不回弹、缩小不回弹', () => {
    const { floatTextGoldDrop } = util();
    let lastDrop = Infinity;
    let shrinking = false;
    let lastScale = Infinity;
    for (const progress of sample(1 / 480)) {
        const frame = floatTextGoldDrop(progress);
        assert.ok(frame.drop <= lastDrop + 1e-9, `t=${progress} 下落回弹（${lastDrop} → ${frame.drop}）`);
        lastDrop = frame.drop;
        // 停住段 scale 恒 1、缩没段单调递减：一旦开始掉就不再上涨
        if (shrinking) assert.ok(frame.scale <= lastScale + 1e-9, `t=${progress} 缩小时又弹回来了`);
        if (frame.scale < lastScale - 1e-9) shrinking = true;
        lastScale = frame.scale;
    }
    assert.ok(shrinking, '整条里必须真的发生过缩小');
});

test('脏数据不产出 NaN、也不反向', () => {
    const { floatTextGoldDrop } = util();
    for (const progress of [Number.NaN, -1, -0.5, 2, Number.POSITIVE_INFINITY]) {
        const frame = floatTextGoldDrop(progress);
        for (const [key, value] of Object.entries(frame)) {
            assert.ok(Number.isFinite(value as number), `t=${progress} 的 ${key} 不是有限数：${value}`);
        }
        assert.ok(frame.drop >= 0 && frame.drop <= 20, `t=${progress} 的 drop=${frame.drop} 越界`);
        assert.ok(frame.scale >= 0 && frame.scale <= 2, `t=${progress} 的 scale=${frame.scale} 越界`);
        assert.ok(frame.fade >= 0 && frame.fade <= 1, `t=${progress} 的 fade=${frame.fade} 越界`);
    }
    // 越界的进度直接夹到两端（不是"回到起点"——那会让飘字在末尾倒放一次）
    assert.deepEqual(floatTextGoldDrop(-1), floatTextGoldDrop(0));
    assert.deepEqual(floatTextGoldDrop(2), floatTextGoldDrop(1));
});

test('时长：金币比伤害更快消失（"迅速"是硬要求）', () => {
    const src = readFileSync(MODEL_PATH, 'utf8');
    const gold = Number(/const FLOAT_TEXT_GOLD_SECONDS = ([\d.]+);/.exec(src)?.[1]);
    const damage = Number(/const FLOAT_TEXT_DAMAGE_SECONDS = ([\d.]+);/.exec(src)?.[1]);
    assert.ok(Number.isFinite(gold), '找不到 FLOAT_TEXT_GOLD_SECONDS');
    assert.ok(Number.isFinite(damage), '找不到 FLOAT_TEXT_DAMAGE_SECONDS');
    assert.ok(gold <= 0.7, `金币飘字 ${gold}s 还是太长（"迅速消失"上限 0.7s）`);
    assert.ok(gold < damage, `金币 ${gold}s 应比伤害 ${damage}s 更快收掉 —— 掉落物不该赖在场上`);
});

test('接线：金币走掉落曲线，落点是角色中心，且不再碰 riseDistance / 入场曲线', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /floatTextGoldDrop\(progress\)/, '金币必须走 floatTextGoldDrop');
    // 2026-10-23：落点从 `offsetY`(26) 改成 `goldCenterY`(兵种画布中心 49) —— 用户要「角色中心点」。
    assert.match(body, /this\.textLabel\.node\.setPosition\(0, this\.goldCenterY \+ gold\.drop, 0\)/,
        '金币定位必须是「角色中心 + 掉落位移」');
    assert.match(body, /this\.textLabel\.node\.setScale\(gold\.scale/, '金币缩放必须来自曲线');
    assert.match(body, /this\.renderGoldIcon\(gold\.spin, fade\)/, '图标自转要用掉落进度（spin）');
    // 反向守卫：金币分支里不许再出现上升 / 漂移 / 旧的基准偏移
    assert.doesNotMatch(body, /offsetY \+ enter \* this\.riseDistance/, '金币不许再上飘');
    assert.doesNotMatch(body, /this\.offsetY \+ gold\.drop/, '金币不许再叠 offsetY（那是下半身，不是角色中心）');
});

test('接线：金币没有文字（加号 / 数字都不显示），只留硬币', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 文案侧：gold 直接给空串（不是 `+${value}`）。
    assert.match(body, /case 'gold': return \{ prefix: '', value: '' \}/,
        '金币不该再拼「+」与数值');
    // 渲染侧：每帧把数字 Label 关掉。⚠️ 必须是 `enabled` 不是 `node.active` ——
    // 金币图标是 Text 的子节点，关节点会把硬币一起关掉。
    assert.match(body, /if \(gold\) \{\s*(?:\/\/[^\n]*\n\s*)*this\.textLabel\.enabled = false;/,
        '金币必须关掉数字 Label（用 enabled，别用 node.active）');
    assert.doesNotMatch(body, /if \(gold\) \{\s*(?:\/\/[^\n]*\n\s*)*this\.textLabel\.node\.active = false/,
        '不能用 node.active 关 Text —— 硬币是它的子节点，会一起消失');
});

test('曲线真源在 util 里、而且标注了「只往下」的口径', () => {
    const src = readFileSync(UTIL_PATH, 'utf8');
    assert.match(src, /export function floatTextGoldDrop\(/);
    assert.match(src, /FLOAT_TEXT_GOLD_DROP_PX/);
    assert.match(src, /恒 `>= 0`/, '注释里要写清 drop 恒非负 —— 这是与"上飘"的分界线');
});
