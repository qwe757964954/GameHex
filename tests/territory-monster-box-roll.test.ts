/**
 * 巡逻宝箱「升级摇奖」曲线 —— 黄条停在哪、演多久。
 *
 * 用户原话（2026-11-22，配图 = 灰底 + 绿条 + 黄色竖条的示意）：
 * 「升级动画 DotLabel 圆点过渡切换成进度条样式，进度绿色和底框灰色比例代表成功率，
 * 黄色竖条在进度上来回移动，停在绿色框内代表升级成功（根据服务端的回调，做个前端动画，
 * 整个动画的总时间为 2.2s）」。
 *
 * 这条判据钉四件事，每件错了都不报错、只是「看起来不对」：
 *
 * 1. **总时长 2.2s** —— 三个段之和必须等于它，改节奏时别漏改某一项；
 * 2. **落点必须在对应的区里** —— 成功停绿区、失败停灰区；停反了玩家会以为服务端判错；
 * 3. **绿色占比恒等于成功率** —— 它代表概率，不随进度变（变了下一次点之前玩家会误读概率）；
 * 4. **回包迟到不跳帧** —— 继续滚、落点顺延，不能让黄条停住等网络（观感是卡死）。
 *
 * 纯函数、零 `cc` 依赖，直接 import 真实实现（不复制算法）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TERRITORY_MONSTER_BOX_ROLL,
    monsterBoxRollMarkerAt,
    monsterBoxRollPose,
    monsterBoxRollTarget,
} from '../assets/script/app/territory/model/TerritoryMonsterBoxRoll';

const { rollSeconds, settleSeconds, holdSeconds, durationSeconds } = TERRITORY_MONSTER_BOX_ROLL;

test('★总时长 = 2.2s，且正好等于「滚动 + 滑落 + 定格」', () => {
    assert.equal(durationSeconds, 2.2, '需求写死 2.2s');
    assert.equal(rollSeconds + settleSeconds + holdSeconds, durationSeconds);
    // 滚动段是整数个来回：收在左端，滑落才有「从边上滑过去」的动作
    assert.equal(rollSeconds % TERRITORY_MONSTER_BOX_ROLL.cycleSeconds, 0);
});

test('★★成功停绿区、失败停灰区（停反了等于把服务端结果演错）', () => {
    for (const rate of [0.4, 0.6, 0.9, 0.99]) {
        const success = monsterBoxRollTarget(rate, true);
        const failed = monsterBoxRollTarget(rate, false);
        assert.ok(success > 0 && success < rate, `成功率 ${rate} 的成功落点 ${success} 不在绿区`);
        assert.ok(failed > rate && failed <= 1, `成功率 ${rate} 的失败落点 ${failed} 不在灰区`);
    }
});

test('成功率是 0% / 100% 时另一侧没有宽度 ⇒ 退回中线（不假装落进不存在的区）', () => {
    assert.equal(monsterBoxRollTarget(1, false), 0.5);
    assert.equal(monsterBoxRollTarget(0, true), 0.5);
    // 脏值当 0：不许把 NaN 传到节点坐标上
    assert.equal(monsterBoxRollTarget(Number.NaN, true), 0.5);
    assert.ok(Number.isFinite(monsterBoxRollTarget(-3, false)));
});

test('★回包在滚动段内到达 ⇒ 整条动画正好 2.2s 收尾', () => {
    const input = { rate: 0.9, success: true, resultAt: 0.2 } as const;
    assert.equal(monsterBoxRollPose({ ...input, elapsed: 0 }).phase, 'rolling');
    assert.equal(monsterBoxRollPose({ ...input, elapsed: 1.49 }).phase, 'rolling');
    assert.equal(monsterBoxRollPose({ ...input, elapsed: 1.6 }).phase, 'settling', '1.5s 后开始滑向落点');
    assert.equal(monsterBoxRollPose({ ...input, elapsed: 2.19 }).finished, false);
    const final = monsterBoxRollPose({ ...input, elapsed: 2.2 });
    assert.equal(final.finished, true, '2.2s 必须演完');
    assert.equal(final.marker, monsterBoxRollTarget(0.9, true));
});

test('★回包迟到 ⇒ 黄条继续来回滚（不停住），落点顺延', () => {
    const late = { rate: 0.9, success: false, resultAt: 1.9 } as const;
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 1.6 }).phase, 'rolling', '结果没到之前不许落定');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 1.8 }).phase, 'rolling');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 1.95 }).phase, 'settling', '1.9s 到结果才开始滑');
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.25 }).finished, false);
    assert.equal(monsterBoxRollPose({ ...late, elapsed: 2.6 }).finished, true);
});

test('回包还没到（success = null）⇒ 任何时刻都是 rolling，且黄条位置和「纯滚动」一致', () => {
    for (const elapsed of [0, 0.4, 1.5, 2.2, 5]) {
        const pose = monsterBoxRollPose({ elapsed, rate: 0.6, success: null, resultAt: null });
        assert.equal(pose.phase, 'rolling');
        assert.equal(pose.finished, false);
        assert.equal(pose.marker, monsterBoxRollMarkerAt(elapsed), '不跳帧：位置只由时间决定');
    }
});

test('★绿色占比恒等于成功率（代表概率，不随进度走）', () => {
    for (const elapsed of [0, 0.7, 1.5, 2.0, 2.2]) {
        for (const success of [null, true, false]) {
            const pose = monsterBoxRollPose({ elapsed, rate: 0.65, success, resultAt: success === null ? null : 0.1 });
            assert.equal(pose.fill, 0.65);
        }
    }
    // 成功率从百分数换算进来的越界值要夹住，不能把 fillRange 写成 1.5
    assert.equal(monsterBoxRollPose({ elapsed: 0, rate: 1.5, success: null, resultAt: null }).fill, 1);
    assert.equal(monsterBoxRollPose({ elapsed: 0, rate: -1, success: null, resultAt: null }).fill, 0);
});

test('黄条在条内往返 0 → 1 → 0，收在左端', () => {
    assert.equal(monsterBoxRollMarkerAt(0), 0);
    assert.ok(Math.abs(monsterBoxRollMarkerAt(TERRITORY_MONSTER_BOX_ROLL.cycleSeconds / 2) - 1) < 1e-12, '半周期到最右');
    assert.ok(Math.abs(monsterBoxRollMarkerAt(TERRITORY_MONSTER_BOX_ROLL.cycleSeconds)) < 1e-12, '整周期回左端');
    assert.ok(Math.abs(monsterBoxRollMarkerAt(rollSeconds)) < 1e-12, '滚动段结束时正好在左端（滑落从那出发）');
});

test('滑落段连续：从滚动末位平滑接到落点，不跳变', () => {
    const rate = 0.8;
    const resultAt = 0.1;
    const start = monsterBoxRollPose({ elapsed: rollSeconds, rate, success: true, resultAt });
    // 1ms 之后的位置必须只挪一点点（缓出曲线起手最快，所以步长取 1ms 而不是 10ms）
    const next = monsterBoxRollPose({ elapsed: rollSeconds + 0.001, rate, success: true, resultAt });
    assert.ok(Math.abs(next.marker - start.marker) < 0.01, '接口处不许跳');
    const target = monsterBoxRollTarget(rate, true);
    assert.ok(Math.abs(start.marker - 0) < 1e-12, '滚动段收在左端');
    assert.ok(Math.abs(next.marker - target) < Math.abs(0 - target), '方向是朝落点走的');

    // 缓出：越接近落点每帧挪得越少（否则最后一帧会「啪」地弹到落点）
    const nearEnd = monsterBoxRollPose({ elapsed: rollSeconds + settleSeconds - 0.05, rate, success: true, resultAt });
    const atEnd = monsterBoxRollPose({ elapsed: rollSeconds + settleSeconds, rate, success: true, resultAt });
    assert.ok(Math.abs(atEnd.marker - nearEnd.marker) < 0.01);
    assert.equal(atEnd.marker, target);
});

test('脏输入不炸也不越界（NaN / 负数时间）', () => {
    const pose = monsterBoxRollPose({ elapsed: Number.NaN, rate: Number.NaN, success: true, resultAt: 0 });
    assert.ok(Number.isFinite(pose.marker) && pose.marker >= 0 && pose.marker <= 1);
    assert.equal(pose.fill, 0);
    const negative = monsterBoxRollPose({ elapsed: -5, rate: 0.5, success: null, resultAt: null });
    assert.equal(negative.marker, 0);
});
